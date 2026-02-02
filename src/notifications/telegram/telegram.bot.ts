/**
 * Telegram Bot — Interactive Command Handler
 *
 * Provides a conversational UX for managing SeatSniper:
 *   /start     — Onboarding & help
 *   /subscribe — Set up monitoring (city → quantity → budget → score)
 *   /unsub     — Remove subscription (with confirmation)
 *   /scan      — One-shot scan of a city (with typing indicator + timeout)
 *   /status    — Show monitoring status
 *   /settings  — View/edit preferences
 *   /pause     — Temporarily mute alerts
 *   /resume    — Resume alerts
 *   /help      — Show commands
 *
 * Alert messages include inline action buttons:
 *   🔕 Mute Event | ⭐ Save | 🔄 Refresh Prices
 */

import { Telegraf, Markup } from 'telegraf';
import type { Context as TelegrafContext } from 'telegraf';
import type { MonitorService, Subscription } from '../../services/monitoring/monitor.service.js';
import * as SubRepo from '../../data/repositories/subscription.repository.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

// ============================================================================
// Types
// ============================================================================

interface UserSession {
  /** Step in the subscribe flow */
  step: 'idle' | 'awaiting_city' | 'awaiting_quantity' | 'awaiting_budget' | 'awaiting_score';
  /** Partially built subscription */
  pendingSub: Partial<Subscription>;
  /** Cities selected so far (for multi-city selection) */
  selectedCities: string[];
  /** When this session was created (for TTL expiry) */
  createdAt: number;
}

/** Sessions expire after 10 minutes of inactivity */
const SESSION_TTL_MS = 10 * 60 * 1000;

/** Maximum time for a scan operation (45 seconds) */
const SCAN_TIMEOUT_MS = 45_000;

/** Set of muted event IDs per user (eventPlatformId → Set<userId>) */
type MutedEvents = Map<string, Set<string>>;

// ============================================================================
// Telegram Bot Service
// ============================================================================

export class TelegramBotService {
  private bot: Telegraf;
  private monitor: MonitorService;
  private sessions: Map<string, UserSession> = new Map();
  private sessionPruneTimer: NodeJS.Timeout | null = null;
  private mutedEvents: MutedEvents = new Map();
  private isRunning = false;

  /**
   * @param monitor - The monitoring service to wire commands to
   * @param existingBot - Optional shared Telegraf instance (from TelegramNotifier).
   *                      If provided, this service registers handlers on it and
   *                      manages the long-polling lifecycle.
   */
  constructor(monitor: MonitorService, existingBot?: Telegraf) {
    if (!existingBot && !config.telegram.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    this.bot = existingBot ?? new Telegraf(config.telegram.botToken);
    this.monitor = monitor;
    this.registerHandlers();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this.isRunning) return;

    const botInfo = await this.bot.telegram.getMe();
    logger.info(`[TelegramBot] Starting @${botInfo.username}`);

    // Always launch long-polling — this is the component that needs updates.
    // TelegramNotifier only uses bot.telegram.* API calls (no polling needed).
    void this.bot.launch();
    this.isRunning = true;

    // Prune stale sessions every 5 minutes
    this.sessionPruneTimer = setInterval(() => this.pruneSessions(), 5 * 60 * 1000);

    logger.info(`[TelegramBot] Bot is live — @${botInfo.username}`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    if (this.sessionPruneTimer) {
      clearInterval(this.sessionPruneTimer);
      this.sessionPruneTimer = null;
    }
    this.sessions.clear();
    this.bot.stop('SIGTERM');
    this.isRunning = false;
    logger.info('[TelegramBot] Stopped');
  }

  private pruneSessions(): void {
    const now = Date.now();
    let pruned = 0;
    for (const [chatId, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(chatId);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.debug(`[TelegramBot] Pruned ${pruned} stale sessions`);
    }
  }

  // ==========================================================================
  // Command Registration
  // ==========================================================================

  private registerHandlers(): void {
    // ---- Commands ----
    this.bot.start(ctx => this.handleStart(ctx));
    this.bot.command('subscribe', ctx => this.handleSubscribe(ctx));
    this.bot.command('unsub', ctx => this.handleUnsub(ctx));
    this.bot.command('scan', ctx => this.handleScan(ctx));
    this.bot.command('status', ctx => this.handleStatus(ctx));
    this.bot.command('settings', ctx => this.handleSettings(ctx));
    this.bot.command('pause', ctx => this.handlePause(ctx));
    this.bot.command('resume', ctx => this.handleResume(ctx));
    this.bot.help(ctx => this.handleHelp(ctx));

    // ---- Callback queries (inline keyboard buttons) ----
    this.bot.on('callback_query', ctx => this.handleCallback(ctx));

    // ---- Text messages (for conversational flows) ----
    this.bot.on('text', ctx => this.handleText(ctx));

    // ---- Error handler ----
    this.bot.catch((err, ctx) => {
      logger.error('[TelegramBot] Unhandled error', {
        error: err instanceof Error ? err.message : String(err),
        chatId: ctx.chat?.id,
      });
    });
  }

  // ==========================================================================
  // /start — Onboarding
  // ==========================================================================

  private async handleStart(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const welcome =
      `🎯 *Welcome to SeatSniper\\!*\n\n` +
      `I find the best\\-value tickets across StubHub, Ticketmaster, and SeatGeek — ` +
      `then alert you with seat map images so you know exactly where you'll sit\\.\n\n` +
      `🏠 *Quick Start:*\n` +
      `1\\. /subscribe — Set up your alerts\n` +
      `2\\. /scan — One\\-shot city scan\n` +
      `3\\. /status — Check monitoring\n` +
      `4\\. /pause / /resume — Mute alerts temporarily\n` +
      `5\\. /help — All commands\n\n` +
      `_Alerts include venue seat maps, value scores, and direct buy links\\._`;

    await ctx.reply(welcome, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /subscribe — Interactive subscription setup (multi-city + budget)
  // ==========================================================================

  private async handleSubscribe(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    // Start the subscribe flow
    this.sessions.set(chatId, {
      step: 'awaiting_city',
      pendingSub: {
        userId: chatId,
        channel: 'telegram',
        active: true,
        paused: false,
        userTier: 'free',
      },
      selectedCities: [],
      createdAt: Date.now(),
    });

    const cities = config.monitoring.cities;

    // Build multi-select city buttons (two per row for compact layout)
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (let i = 0; i < cities.length; i += 2) {
      const row = [
        Markup.button.callback(
          cities[i].charAt(0).toUpperCase() + cities[i].slice(1),
          `city:${cities[i]}`,
        ),
      ];
      if (cities[i + 1]) {
        row.push(
          Markup.button.callback(
            cities[i + 1].charAt(0).toUpperCase() + cities[i + 1].slice(1),
            `city:${cities[i + 1]}`,
          ),
        );
      }
      buttons.push(row);
    }

    // Add "All Cities" and "Done" options
    buttons.push([Markup.button.callback('📍 All Cities', 'city:all')]);

    await ctx.reply(
      `🏙️ Which cities do you want to monitor?\n\n` +
      `_Tap cities to select them, then tap "All Cities" for everything\\._`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  }

  // ==========================================================================
  // /unsub — Remove subscription (with confirmation)
  // ==========================================================================

  private async handleUnsub(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    // Check if they even have a subscription
    const subs = this.monitor.getSubscriptions().filter(s => s.userId === chatId);
    if (subs.length === 0) {
      await ctx.reply('You don\'t have an active subscription. Use /subscribe to set one up.');
      return;
    }

    // Ask for confirmation
    const buttons = [
      [
        Markup.button.callback('❌ Yes, unsubscribe', 'unsub:confirm'),
        Markup.button.callback('↩️ Keep my alerts', 'unsub:cancel'),
      ],
    ];

    await ctx.reply(
      '⚠️ Are you sure you want to unsubscribe? You\'ll stop receiving deal alerts.\n\n' +
      '_Tip: Use /pause to mute alerts temporarily instead._',
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  }

  // ==========================================================================
  // /pause — Temporarily mute alerts
  // ==========================================================================

  private async handlePause(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const paused = this.monitor.pauseSubscription(chatId);
    if (!paused) {
      await ctx.reply('No active subscription to pause. Use /subscribe first.');
      return;
    }

    // Persist to DB (best-effort)
    void SubRepo.getSubscriptionByUser(chatId).then(sub => {
      if (sub) {
        sub.paused = true;
        return SubRepo.upsertSubscription(sub);
      }
      return undefined;
    }).catch(err => {
      logger.warn('[TelegramBot] Failed to persist pause', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    await ctx.reply(
      '⏸️ Alerts paused. Your settings are preserved.\n\n' +
      'Use /resume when you\'re ready for alerts again.',
    );
  }

  // ==========================================================================
  // /resume — Resume paused alerts
  // ==========================================================================

  private async handleResume(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const resumed = this.monitor.resumeSubscription(chatId);
    if (!resumed) {
      await ctx.reply('No paused subscription found. Use /subscribe to set one up.');
      return;
    }

    // Persist to DB (best-effort)
    void SubRepo.getSubscriptionByUser(chatId).then(sub => {
      if (sub) {
        sub.paused = false;
        return SubRepo.upsertSubscription(sub);
      }
      return undefined;
    }).catch(err => {
      logger.warn('[TelegramBot] Failed to persist resume', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    await ctx.reply(
      '▶️ Alerts resumed! You\'ll start receiving deal notifications again.\n\n' +
      'Use /status to check monitoring activity.',
    );
  }

  // ==========================================================================
  // /scan — One-shot city scan (with typing + timeout)
  // ==========================================================================

  private async handleScan(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';
    const parts = text.split(/\s+/);
    const city = parts[1]?.toLowerCase();

    if (!city) {
      const cities = config.monitoring.cities;
      const buttons = cities.map(c => [
        Markup.button.callback(
          c.charAt(0).toUpperCase() + c.slice(1),
          `scan:${c}`,
        ),
      ]);

      await ctx.reply(
        '🔍 Which city do you want to scan?',
        Markup.inlineKeyboard(buttons),
      );
      return;
    }

    await this.executeScan(ctx, city);
  }

  private async executeScan(ctx: TelegrafContext, city: string): Promise<void> {
    // Sanitize city input: only allow letters, spaces, hyphens
    const sanitized = city.replace(/[^a-zA-Z\s-]/g, '').trim().toLowerCase();
    if (!sanitized || sanitized.length > 50) {
      await ctx.reply('Please enter a valid city name (letters only, max 50 chars).');
      return;
    }

    // Show typing indicator so user sees activity
    await ctx.sendChatAction('typing');

    await ctx.reply(`🔍 Scanning ${sanitized}... This may take up to 30 seconds.`);

    try {
      // Race the scan against a timeout
      const result = await Promise.race([
        this.monitor.scanCity(sanitized),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Scan timed out — platforms may be slow. Try again later.')), SCAN_TIMEOUT_MS),
        ),
      ]);

      if (result.events === 0) {
        await ctx.reply(`No events found in ${sanitized} for the next 30 days.`);
        return;
      }

      let response =
        `📊 *${this.escapeMarkdown(sanitized.charAt(0).toUpperCase() + sanitized.slice(1))} Scan Results*\n\n` +
        `🎫 Events found: ${result.events}\n` +
        `🎟️ Listings sampled: ${result.listings}\n` +
        `⭐ Top picks: ${result.topPicks.length}\n\n`;

      if (result.topPicks.length > 0) {
        response += `*Best Deals:*\n`;
        for (const pick of result.topPicks.slice(0, 5)) {
          const l = pick.listing;
          const s = pick.score;
          // Include buy link for each listing
          const buyLink = l.deepLink ? ` [Buy](${l.deepLink})` : '';
          response +=
            `\n${this.getScoreEmoji(s.totalScore)} *Score ${s.totalScore}/100*\n` +
            `   ${this.escapeMarkdown(l.section)} Row ${this.escapeMarkdown(l.row)} — ` +
            `${this.escapeMarkdown(`$${l.pricePerTicket}/ea`)} ${this.escapeMarkdown(`(${l.quantity} avail)`)}` +
            `${buyLink}\n` +
            `   _${this.escapeMarkdown(s.reasoning)}_\n`;
        }
      }

      response += `\n_Use /subscribe to get alerts when great deals appear${this.escapeMarkdown('!')}_`;

      await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      logger.error('[TelegramBot] Scan failed', {
        city: sanitized,
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Scan failed. Try again later.'}`);
    }
  }

  // ==========================================================================
  // /status — Monitoring status
  // ==========================================================================

  private async handleStatus(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const status = this.monitor.getStatus();

    // Check this user's subscription status
    const userSub = this.monitor.getSubscriptions().find(s => s.userId === chatId);
    let userLine = '👤 You: Not subscribed';
    if (userSub) {
      if (userSub.paused) {
        userLine = '👤 You: ⏸️ Paused';
      } else {
        userLine = `👤 You: ✅ Active ${this.escapeMarkdown('(')}${this.escapeMarkdown(userSub.cities.join(', '))}${this.escapeMarkdown(')')}`;
      }
    }

    const msg =
      `📡 *SeatSniper Status*\n\n` +
      `${userLine}\n\n` +
      `Running: ${status.running ? '✅' : '❌'}\n` +
      `Tracked Events: ${status.trackedEvents}\n` +
      `Active Subs: ${status.subscriptions}` +
      `${status.pausedSubscriptions > 0 ? ` ${this.escapeMarkdown('(')}${status.pausedSubscriptions} paused${this.escapeMarkdown(')')}` : ''}\n` +
      `Alerts Sent: ${status.alertsSent}\n\n` +
      `*Events by Priority:*\n` +
      `🔴 High ${this.escapeMarkdown('(<7 days)')}: ${status.eventsByPriority.high}\n` +
      `🟡 Medium ${this.escapeMarkdown('(<30 days)')}: ${status.eventsByPriority.medium}\n` +
      `🟢 Low ${this.escapeMarkdown('(>30 days)')}: ${status.eventsByPriority.low}\n` +
      `⚪ Past: ${status.eventsByPriority.past}`;

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /settings — View current subscription (with edit actions)
  // ==========================================================================

  private async handleSettings(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const subs = this.monitor.getSubscriptions().filter(s => s.userId === chatId);

    if (subs.length === 0) {
      await ctx.reply('No active subscriptions. Use /subscribe to set one up.');
      return;
    }

    const sub = subs[0];
    const budgetLine = sub.maxPricePerTicket > 0
      ? `💰 Max Price: $${sub.maxPricePerTicket}/ticket`
      : '💰 Max Price: No limit';
    const statusLine = sub.paused ? '⏸️ Status: Paused' : '✅ Status: Active';

    const msg =
      `⚙️ *Your Settings*\n\n` +
      `🏙️ Cities: ${this.escapeMarkdown(sub.cities.join(', '))}\n` +
      `🎯 Min Score: ${sub.minScore}/100\n` +
      `👥 Min Seats Together: ${sub.minQuantity}\n` +
      `${this.escapeMarkdown(budgetLine)}\n` +
      `📡 Channel: ${sub.channel}\n` +
      `${statusLine}\n\n` +
      `_Use /subscribe to change, /pause to mute, or /unsub to remove\\._`;

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /help
  // ==========================================================================

  private async handleHelp(ctx: TelegrafContext): Promise<void> {
    const msg =
      `🎯 *SeatSniper Commands*\n\n` +
      `*Setup:*\n` +
      `/subscribe — Set up deal alerts\n` +
      `/unsub — Remove subscription\n` +
      `/settings — View your preferences\n\n` +
      `*Monitoring:*\n` +
      `/scan \\[city\\] — Quick scan for deals\n` +
      `/status — System status\n` +
      `/pause — Mute alerts temporarily\n` +
      `/resume — Resume alerts\n\n` +
      `*How it works:*\n` +
      `1\\. Subscribe with city, seats, budget, and score\n` +
      `2\\. I poll StubHub, Ticketmaster, and SeatGeek\n` +
      `3\\. When high\\-value tickets are found, I send you:\n` +
      `   🗺️ Venue seat map with highlighted section\n` +
      `   💰 Value score and price analysis\n` +
      `   🛒 Direct buy link\n\n` +
      `*On each alert you can:*\n` +
      `   🔕 Mute that event\n` +
      `   🔄 Refresh prices\n\n` +
      `_Family\\-friendly: filter by seats together and max budget\\!_`;

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // Callback Query Handler (inline keyboard buttons)
  // ==========================================================================

  private async handleCallback(ctx: TelegrafContext): Promise<void> {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery(); // Acknowledge button press

    // --- City selection (subscribe flow, supports multi-select) ---
    if (data.startsWith('city:')) {
      const city = data.replace('city:', '');
      const session = this.sessions.get(chatId);
      if (!session || session.step !== 'awaiting_city') return;

      if (city === 'all') {
        session.pendingSub.cities = [...config.monitoring.cities];
      } else if (city === 'done') {
        // "Done selecting" — proceed with selected cities
        if (session.selectedCities.length === 0) {
          await ctx.answerCbQuery('Please select at least one city');
          return;
        }
        session.pendingSub.cities = [...session.selectedCities];
      } else {
        // Toggle city selection
        const idx = session.selectedCities.indexOf(city);
        if (idx >= 0) {
          session.selectedCities.splice(idx, 1);
        } else {
          session.selectedCities.push(city);
        }

        // Update the message to show selection state
        const cities = config.monitoring.cities;
        const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
        for (let i = 0; i < cities.length; i += 2) {
          const row = [this.cityButton(cities[i], session.selectedCities)];
          if (cities[i + 1]) {
            row.push(this.cityButton(cities[i + 1], session.selectedCities));
          }
          buttons.push(row);
        }
        buttons.push([Markup.button.callback('📍 All Cities', 'city:all')]);
        if (session.selectedCities.length > 0) {
          buttons.push([Markup.button.callback(`✅ Done (${session.selectedCities.length} selected)`, 'city:done')]);
        }

        const selected = session.selectedCities.length > 0
          ? `\n\n_Selected: ${session.selectedCities.join(', ')}_`
          : '';

        await ctx.editMessageText(
          `🏙️ Which cities do you want to monitor?${selected}\n\n_Tap to select/deselect, then "Done" or "All Cities"\\._`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(buttons),
          },
        );
        return;
      }

      // Move to quantity step
      session.step = 'awaiting_quantity';

      const buttons = [
        [Markup.button.callback('👤 1 (Solo)', 'qty:1')],
        [Markup.button.callback('👥 2 (Pair)', 'qty:2')],
        [Markup.button.callback('👨‍👩‍👧‍👦 4 (Family)', 'qty:4')],
        [Markup.button.callback('🎉 Any quantity', 'qty:1')],
      ];

      const selectedCities = session.pendingSub.cities || [];
      const cityLabel = selectedCities.length === config.monitoring.cities.length
        ? 'All cities'
        : selectedCities.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ');

      await ctx.editMessageText(
        `✅ Monitoring: ${cityLabel}\n\n` +
        `👥 How many seats together do you need?\n` +
        `_This filters for consecutive seats available\\._`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard(buttons),
        },
      );
      return;
    }

    // --- Quantity selection (subscribe flow) ---
    if (data.startsWith('qty:')) {
      const qty = parseInt(data.replace('qty:', ''), 10);
      const session = this.sessions.get(chatId);
      if (!session || session.step !== 'awaiting_quantity') return;

      session.pendingSub.minQuantity = qty;

      // Move to budget step (NEW)
      session.step = 'awaiting_budget';

      const buttons = [
        [Markup.button.callback('💰 $50/ticket', 'budget:50')],
        [Markup.button.callback('💰 $100/ticket', 'budget:100')],
        [Markup.button.callback('💰 $200/ticket', 'budget:200')],
        [Markup.button.callback('♾️ No limit', 'budget:0')],
      ];

      await ctx.editMessageText(
        `✅ Seats together: ${qty}\\+\n\n` +
        `💰 What's your max budget per ticket?\n` +
        `_Only deals within your budget will trigger alerts\\._`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard(buttons),
        },
      );
      return;
    }

    // --- Budget selection (subscribe flow) ---
    if (data.startsWith('budget:')) {
      const budget = parseInt(data.replace('budget:', ''), 10);
      const session = this.sessions.get(chatId);
      if (!session || session.step !== 'awaiting_budget') return;

      session.pendingSub.maxPricePerTicket = budget;

      // Move to score threshold step
      session.step = 'awaiting_score';

      const buttons = [
        [Markup.button.callback('🌟 85+ (Excellent only)', 'score:85')],
        [Markup.button.callback('✨ 70+ (Good+) — Recommended', 'score:70')],
        [Markup.button.callback('👍 55+ (Fair+)', 'score:55')],
        [Markup.button.callback('📊 40+ (Show most)', 'score:40')],
      ];

      const budgetLabel = budget > 0 ? `$${budget}/ticket` : 'No limit';

      await ctx.editMessageText(
        `✅ Budget: ${budgetLabel}\n\n` +
        `🎯 What minimum value score should trigger an alert?\n` +
        `_Higher \\= fewer but better deals\\._`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard(buttons),
        },
      );
      return;
    }

    // --- Score threshold (subscribe flow, final step) ---
    if (data.startsWith('score:')) {
      const score = parseInt(data.replace('score:', ''), 10);
      const session = this.sessions.get(chatId);
      if (!session || session.step !== 'awaiting_score') return;

      session.pendingSub.minScore = score;

      // Complete the subscription
      const sub: Subscription = {
        userId: chatId,
        channel: 'telegram',
        cities: session.pendingSub.cities || config.monitoring.cities,
        minScore: score,
        minQuantity: session.pendingSub.minQuantity || 1,
        maxPricePerTicket: session.pendingSub.maxPricePerTicket || 0,
        active: true,
        paused: false,
        userTier: 'free',
      };

      // Remove any existing subscription for this user first
      this.monitor.removeSubscription(chatId);
      this.monitor.addSubscription(sub);

      // Persist to database (best-effort)
      SubRepo.upsertSubscription(sub).catch(err => {
        logger.warn('[TelegramBot] Failed to persist subscription', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Clear session
      this.sessions.delete(chatId);

      const scoreLabel =
        score >= 85 ? '🌟 Excellent (85+)' :
        score >= 70 ? '✨ Good+ (70+)' :
        score >= 55 ? '👍 Fair+ (55+)' :
        '📊 Most deals (40+)';

      const budgetLabel = sub.maxPricePerTicket > 0
        ? `$${sub.maxPricePerTicket}/ticket`
        : 'No limit';

      await ctx.editMessageText(
        `✅ *Subscription Active\\!*\n\n` +
        `🏙️ Cities: ${this.escapeMarkdown(sub.cities.join(', '))}\n` +
        `👥 Min seats together: ${sub.minQuantity}\n` +
        `💰 Budget: ${this.escapeMarkdown(budgetLabel)}\n` +
        `🎯 Alert threshold: ${scoreLabel}\n\n` +
        `I'm now monitoring ticket platforms and will alert you when great deals appear\\. ` +
        `Each alert includes a venue seat map so you can see exactly where you'd sit\\.\n\n` +
        `_Use /settings to view, /pause to mute, or /unsub to remove\\._`,
        { parse_mode: 'MarkdownV2' },
      );

      logger.info('[TelegramBot] New subscription', {
        userId: chatId,
        cities: sub.cities,
        minScore: sub.minScore,
        minQuantity: sub.minQuantity,
        maxPrice: sub.maxPricePerTicket,
      });
      return;
    }

    // --- Scan city from button ---
    if (data.startsWith('scan:')) {
      const city = data.replace('scan:', '');
      await this.executeScan(ctx, city);
      return;
    }

    // --- Unsub confirmation ---
    if (data === 'unsub:confirm') {
      this.monitor.removeSubscription(chatId);

      // Persist to database (best-effort)
      SubRepo.removeSubscription(chatId).catch(err => {
        logger.warn('[TelegramBot] Failed to persist unsub', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      await ctx.editMessageText(
        '✅ Subscription removed. You will no longer receive alerts.\n\n' +
        'Use /subscribe to set up again anytime.',
      );
      return;
    }

    if (data === 'unsub:cancel') {
      await ctx.editMessageText('👍 Your subscription is still active. Alerts will continue.');
      return;
    }

    // --- Alert action: Mute event ---
    if (data.startsWith('mute:')) {
      const eventId = data.replace('mute:', '');
      if (!this.mutedEvents.has(eventId)) {
        this.mutedEvents.set(eventId, new Set());
      }
      this.mutedEvents.get(eventId)!.add(chatId);

      await ctx.answerCbQuery('🔕 Event muted — no more alerts for this event.');
      logger.info('[TelegramBot] Event muted', { userId: chatId, eventId });
      return;
    }

    // --- Alert action: Refresh prices ---
    if (data.startsWith('refresh:')) {
      const city = data.replace('refresh:', '');
      await ctx.answerCbQuery('🔄 Refreshing...');
      await this.executeScan(ctx, city);
      return;
    }
  }

  // ==========================================================================
  // Text Message Handler (for conversational flows)
  // ==========================================================================

  private async handleText(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const session = this.sessions.get(chatId);
    if (!session || session.step === 'idle') {
      // No active flow — show help hint
      await ctx.reply('Use /help to see available commands, or /subscribe to get started.');
      return;
    }

    // If user types text during a button-driven flow, prompt them to use buttons
    await ctx.reply('Please use the buttons above to make your selection, or type /subscribe to restart.');
  }

  // ==========================================================================
  // Alert Action Buttons — Called by TelegramNotifier after sending alerts
  // ==========================================================================

  /**
   * Build inline keyboard for alert messages.
   * TelegramNotifier can call this to get the action buttons for each alert.
   */
  buildAlertActions(eventCity: string, eventPlatformId: string): ReturnType<typeof Markup.inlineKeyboard> {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🔕 Mute Event', `mute:${eventPlatformId}`),
        Markup.button.callback('🔄 Refresh', `refresh:${eventCity}`),
      ],
    ]);
  }

  /**
   * Check if a user has muted a specific event
   */
  isEventMutedForUser(eventPlatformId: string, userId: string): boolean {
    return this.mutedEvents.get(eventPlatformId)?.has(userId) ?? false;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  private getScoreEmoji(score: number): string {
    if (score >= 85) return '🌟';
    if (score >= 70) return '✨';
    if (score >= 55) return '👍';
    return '📊';
  }

  /** Build a city button with ✅ prefix if selected */
  private cityButton(city: string, selected: string[]): ReturnType<typeof Markup.button.callback> {
    const isSelected = selected.includes(city);
    const label = (isSelected ? '✅ ' : '') + city.charAt(0).toUpperCase() + city.slice(1);
    return Markup.button.callback(label, `city:${city}`);
  }
}
