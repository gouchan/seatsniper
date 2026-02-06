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
import type { NormalizedEvent, NormalizedListing } from '../../adapters/base/platform-adapter.interface.js';
import * as SubRepo from '../../data/repositories/subscription.repository.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

// ============================================================================
// Types
// ============================================================================

interface UserSession {
  /** Step in the subscribe flow or search flow */
  step: 'idle' | 'awaiting_city' | 'awaiting_quantity' | 'awaiting_budget' | 'awaiting_score'
      | 'awaiting_search_keyword' | 'awaiting_search_city';
  /** Partially built subscription */
  pendingSub: Partial<Subscription>;
  /** Cities selected so far (for multi-city selection) */
  selectedCities: string[];
  /** When this session was created (for TTL expiry) */
  createdAt: number;
  /** Pending keyword for search flow */
  pendingKeyword?: string;
}

/** Sessions expire after 10 minutes of inactivity */
const SESSION_TTL_MS = 10 * 60 * 1000;

/** Maximum time for a scan operation (45 seconds) */
const SCAN_TIMEOUT_MS = 45_000;

/** Set of muted event IDs per user (eventPlatformId → Set<userId>) */
type MutedEvents = Map<string, Set<string>>;

// ============================================================================
// Persistent Reply Keyboard — Main Menu Buttons
// ============================================================================

const MENU = {
  SCAN:      '🔍 Scan',
  SEARCH:    '🔎 Search',
  SUBSCRIBE: '📋 Subscribe',
  STATUS:    '📊 Status',
  SETTINGS:  '⚙️ Settings',
  PAUSE:     '⏸️ Pause Alerts',
  RESUME:    '▶️ Resume Alerts',
  HELP:      '❓ Help',
} as const;

/** All menu button labels for quick lookup */
const MENU_LABELS = new Set<string>(Object.values(MENU));

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

  /** Maximum number of reconnection attempts before giving up */
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  /** Base delay between reconnection attempts (doubles each time) */
  private static readonly RECONNECT_BASE_DELAY_MS = 5000;
  /** Current reconnection attempt count */
  private reconnectAttempts = 0;
  /** Flag to prevent multiple recovery attempts */
  private isRecovering = false;

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Pre-launch: just clear webhook, don't logOut (that's too aggressive for normal startup)
      await this.clearWebhook();

      const botInfo = await this.bot.telegram.getMe();
      logger.info(`[TelegramBot] Starting @${botInfo.username}`);

      // Launch long-polling
      this.launchPolling();

      this.isRunning = true;

      // Prune stale sessions every 5 minutes
      this.sessionPruneTimer = setInterval(() => this.pruneSessions(), 5 * 60 * 1000);

      logger.info(`[TelegramBot] Bot is live — @${botInfo.username}`);
    } catch (error) {
      logger.error('[TelegramBot] Failed to start', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Clear webhook and drop pending updates (light cleanup)
   */
  private async clearWebhook(): Promise<void> {
    try {
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      logger.debug('[TelegramBot] Cleared webhook and pending updates');
    } catch (error) {
      // Non-fatal - might fail if already cleared
      logger.debug('[TelegramBot] Webhook clear skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Force clean session for 409 recovery
   * Note: We do NOT use logOut anymore because it causes a 10+ second cooldown
   * that affects all API calls, making the situation worse.
   */
  private async forceCleanSession(): Promise<void> {
    // Just clear webhook - don't call logOut as it causes more problems than it solves
    await this.clearWebhook();
  }

  /**
   * Launch polling with automatic recovery on 409 conflicts
   */
  private launchPolling(): void {
    this.bot.launch({ dropPendingUpdates: true })
      .catch(async (err: Error) => {
        await this.handlePollingError(err);
      });
  }

  /**
   * Handle polling errors with automatic recovery
   */
  private async handlePollingError(err: Error): Promise<void> {
    const is409 = err.message.includes('409') || err.message.includes('Conflict');

    if (!is409) {
      logger.error('[TelegramBot] Polling error (non-409)', {
        error: err.message,
      });
      return;
    }

    // Prevent multiple simultaneous recovery attempts
    if (this.isRecovering) {
      logger.debug('[TelegramBot] Recovery already in progress, skipping');
      return;
    }

    this.isRecovering = true;

    try {
      if (this.reconnectAttempts >= TelegramBotService.MAX_RECONNECT_ATTEMPTS) {
        logger.error('[TelegramBot] Max reconnect attempts reached, giving up', {
          attempts: this.reconnectAttempts,
        });
        this.isRecovering = false;
        return;
      }

      this.reconnectAttempts++;
      const delay = TelegramBotService.RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);

      logger.warn(`[TelegramBot] 409 Conflict - attempt ${this.reconnectAttempts}/${TelegramBotService.MAX_RECONNECT_ATTEMPTS}, waiting ${delay / 1000}s...`);

      // Stop the current bot instance
      try {
        this.bot.stop('SIGTERM');
      } catch {
        // Ignore
      }

      // Wait before retrying
      await new Promise(r => setTimeout(r, delay));

      // Try to force clean and restart
      await this.forceCleanSession();
      this.launchPolling();

      logger.info('[TelegramBot] Recovery attempt initiated');
    } finally {
      this.isRecovering = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.sessionPruneTimer) {
      clearInterval(this.sessionPruneTimer);
      this.sessionPruneTimer = null;
    }
    this.sessions.clear();

    try {
      this.bot.stop('SIGTERM');
    } catch (error) {
      logger.warn('[TelegramBot] Error during stop (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('[TelegramBot] Stopped');
  }

  /**
   * Check if the bot is healthy and can communicate with Telegram
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.isRunning) {
      return { healthy: false, error: 'Bot is not running' };
    }

    try {
      const me = await this.bot.telegram.getMe();
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the running status
   */
  get running(): boolean {
    return this.isRunning;
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
  // Persistent Reply Keyboard Helpers
  // ==========================================================================

  /** Single source of truth for the main menu keyboard layout */
  private mainMenuKeyboard() {
    return Markup.keyboard([
      [MENU.SCAN, MENU.SEARCH],
      [MENU.SUBSCRIBE, MENU.STATUS],
      [MENU.SETTINGS, MENU.PAUSE],
      [MENU.RESUME, MENU.HELP],
    ]).resize().persistent();
  }

  /** Send a message with the main menu keyboard attached */
  private async sendWithMainMenu(
    ctx: TelegrafContext,
    text: string,
    extra?: { parse_mode?: 'MarkdownV2' },
  ): Promise<void> {
    await ctx.reply(text, {
      ...extra,
      ...this.mainMenuKeyboard(),
    });
  }

  // ==========================================================================
  // Command Registration
  // ==========================================================================

  private registerHandlers(): void {
    // Helper to wrap handlers with error catching
    const safeHandler = <T extends TelegrafContext>(
      handler: (ctx: T) => Promise<void>,
      name: string,
    ) => {
      return async (ctx: T) => {
        try {
          await handler(ctx);
        } catch (error) {
          logger.error(`[TelegramBot] Error in ${name}`, {
            error: error instanceof Error ? error.message : String(error),
            chatId: ctx.chat?.id,
          });
          // Try to notify the user something went wrong
          try {
            await ctx.reply('❌ Something went wrong. Please try again.');
          } catch {
            // If we can't even reply, just log it
          }
        }
      };
    };

    // ---- Commands ----
    this.bot.start(safeHandler(ctx => this.handleStart(ctx), 'start'));
    this.bot.command('subscribe', safeHandler(ctx => this.handleSubscribe(ctx), 'subscribe'));
    this.bot.command('unsub', safeHandler(ctx => this.handleUnsub(ctx), 'unsub'));
    this.bot.command('scan', safeHandler(ctx => this.handleScan(ctx), 'scan'));
    this.bot.command('status', safeHandler(ctx => this.handleStatus(ctx), 'status'));
    this.bot.command('settings', safeHandler(ctx => this.handleSettings(ctx), 'settings'));
    this.bot.command('pause', safeHandler(ctx => this.handlePause(ctx), 'pause'));
    this.bot.command('resume', safeHandler(ctx => this.handleResume(ctx), 'resume'));
    this.bot.help(safeHandler(ctx => this.handleHelp(ctx), 'help'));

    // ---- Callback queries (inline keyboard buttons) ----
    this.bot.on('callback_query', safeHandler(ctx => this.handleCallback(ctx), 'callback'));

    // ---- Text messages (for conversational flows) ----
    this.bot.on('text', safeHandler(ctx => this.handleText(ctx), 'text'));

    // ---- Global error handler (last resort) ----
    this.bot.catch((err, ctx) => {
      const is409 = err instanceof Error && (err.message.includes('409') || err.message.includes('Conflict'));

      if (is409) {
        // Route 409s to recovery logic
        logger.warn('[TelegramBot] 409 Conflict caught by global handler, triggering recovery');
        this.handlePollingError(err as Error);
      } else {
        logger.error('[TelegramBot] Unhandled error', {
          error: err instanceof Error ? err.message : String(err),
          chatId: ctx?.chat?.id,
        });
      }
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
      `*Get Started:*\n` +
      `🔍 *Scan* — Quick scan for deals in a city\n` +
      `📋 *Subscribe* — Set up automatic deal alerts\n` +
      `📊 *Status* — Check monitoring activity\n` +
      `⚙️ *Settings* — View your preferences\n\n` +
      `_Tap a button below to begin 👇_`;

    await this.sendWithMainMenu(ctx, welcome, { parse_mode: 'MarkdownV2' });
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
      await this.sendWithMainMenu(ctx, 'You don\'t have an active subscription. Tap 📋 Subscribe to set one up.');
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
      await this.sendWithMainMenu(ctx, 'No active subscription to pause. Tap 📋 Subscribe to set one up.');
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

    await this.sendWithMainMenu(
      ctx,
      '⏸️ Alerts paused. Your settings are preserved.\n\nTap ▶️ Resume Alerts when you\'re ready.',
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
      await this.sendWithMainMenu(ctx, 'No paused subscription found. Tap 📋 Subscribe to set one up.');
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

    await this.sendWithMainMenu(
      ctx,
      '▶️ Alerts resumed! You\'ll start receiving deal notifications again.',
    );
  }

  // ==========================================================================
  // /scan — One-shot city scan (with typing + timeout)
  // ==========================================================================

  private async handleScan(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const rawText = (ctx.message && 'text' in ctx.message) ? ctx.message.text : '';

    // If called from reply keyboard ("🔍 Scan") or bare /scan, show city picker.
    // Only parse a city arg from "/scan <city>" — not from the button label.
    const isSlashCommand = rawText.startsWith('/scan');
    const city = isSlashCommand ? rawText.split(/\s+/)[1]?.toLowerCase() : undefined;

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
      await this.sendWithMainMenu(ctx, 'Please enter a valid city name (letters only, max 50 chars).');
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
        await this.sendWithMainMenu(ctx, `No events found in ${sanitized} for the next 30 days.`);
        return;
      }

      const cityTitle = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
      let response =
        `📊 *${this.escapeMarkdown(cityTitle)} — ${result.events} Events Found*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Show upcoming events with details
      // Build inline buttons for each event (View Tickets)
      const eventButtons: ReturnType<typeof Markup.button.callback>[][] = [];

      if (result.upcomingEvents.length > 0) {
        for (const evt of result.upcomingEvents) {
          const dateStr = evt.dateTime.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          });
          const timeStr = evt.dateTime.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit',
          });

          const categoryIcon = this.getCategoryIcon(evt.category);
          const platformIcon = this.getPlatformIndicator(evt.platform);
          const priceLine = evt.priceRange
            ? `💰 $${evt.priceRange.min}–$${evt.priceRange.max}`
            : '💰 Price TBD';

          response +=
            `${categoryIcon}${platformIcon} *${this.escapeMarkdown(evt.name)}*\n` +
            `   📍 ${this.escapeMarkdown(evt.venue.name)}\n` +
            `   📅 ${this.escapeMarkdown(dateStr + ', ' + timeStr)}\n` +
            `   ${this.escapeMarkdown(priceLine)}\n\n`;

          // Add "View Tickets" button for this event (truncate name for button)
          const shortName = evt.name.length > 20 ? evt.name.slice(0, 20) + '...' : evt.name;
          const buttonRow: ReturnType<typeof Markup.button.callback>[] = [
            Markup.button.callback(
              `🎟️ ${shortName}`,
              `tickets:${evt.platform}:${evt.platformId}`,
            ),
          ];
          // Only add URL button if we have a valid URL
          if (evt.url && evt.url.startsWith('http')) {
            buttonRow.push(Markup.button.url('🔗 Buy', evt.url));
          }
          eventButtons.push(buttonRow);
        }

        if (result.events > result.upcomingEvents.length) {
          response += `_\\.\\.\\. and ${result.events - result.upcomingEvents.length} more events_\n\n`;
        }
      }

      // Show top picks if any listings were scored
      if (result.topPicks.length > 0) {
        response += `🔥 *Best Deals:*\n`;
        for (const pick of result.topPicks.slice(0, 5)) {
          const l = pick.listing;
          const s = pick.score;
          const buyLink = l.deepLink ? ` [Buy](${l.deepLink})` : '';
          response +=
            `\n${this.getScoreEmoji(s.totalScore)} *Score ${s.totalScore}/100*\n` +
            `   ${this.escapeMarkdown(l.section)} Row ${this.escapeMarkdown(l.row)} — ` +
            `${this.escapeMarkdown(`$${l.pricePerTicket}/ea`)} ${this.escapeMarkdown(`(${l.quantity} avail)`)}` +
            `${buyLink}\n` +
            `   _${this.escapeMarkdown(s.reasoning)}_\n`;
        }
      }

      response += `\n_Tap 🎟️ to see available tickets, or 📋 Subscribe for alerts${this.escapeMarkdown('!')}_`;

      // Send with inline buttons if we have events
      if (eventButtons.length > 0) {
        await ctx.reply(response, {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard(eventButtons),
        });
        // Follow up with the main menu keyboard
        await this.sendWithMainMenu(ctx, '👆 Tap an event above to see tickets');
      } else {
        await this.sendWithMainMenu(ctx, response, { parse_mode: 'MarkdownV2' });
      }
    } catch (error) {
      logger.error('[TelegramBot] Scan failed', {
        city: sanitized,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendWithMainMenu(ctx, `❌ ${error instanceof Error ? error.message : 'Scan failed. Try again later.'}`);
    }
  }

  // ==========================================================================
  // /search — Search events by keyword
  // ==========================================================================

  private async handleSearch(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    this.sessions.set(chatId, {
      step: 'awaiting_search_keyword',
      pendingSub: {},
      selectedCities: [],
      createdAt: Date.now(),
    });

    await ctx.reply(
      '🔎 What event are you looking for?\n\n' +
      '_Example: Taylor Swift, Trail Blazers, Hamilton_',
      { parse_mode: 'MarkdownV2' },
    );
  }

  private async executeSearch(ctx: TelegrafContext, keyword: string, city: string): Promise<void> {
    // Show typing indicator
    await ctx.sendChatAction('typing');
    await ctx.reply(`🔎 Searching for "${keyword}" in ${city}...`);

    try {
      const result = await Promise.race([
        this.monitor.searchEvents(keyword, city),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Search timed out')), SCAN_TIMEOUT_MS),
        ),
      ]);

      if (result.events === 0) {
        await this.sendWithMainMenu(
          ctx,
          `🔎 No events found for "${keyword}" in ${city}.\n\nTry a different search term or city.`,
        );
        return;
      }

      const cityTitle = city.charAt(0).toUpperCase() + city.slice(1);
      let response =
        `🔎 *${this.escapeMarkdown(keyword)}* in ${this.escapeMarkdown(cityTitle)} — ${result.events} Events\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Build inline buttons for each event
      const eventButtons: ReturnType<typeof Markup.button.callback>[][] = [];

      for (const evt of result.upcomingEvents) {
        const dateStr = evt.dateTime.toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        });
        const timeStr = evt.dateTime.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit',
        });

        const categoryIcon = this.getCategoryIcon(evt.category);
        const platformIcon = this.getPlatformIndicator(evt.platform);
        const priceLine = evt.priceRange
          ? `💰 $${evt.priceRange.min}–$${evt.priceRange.max}`
          : '💰 Price TBD';

        response +=
          `${categoryIcon}${platformIcon} *${this.escapeMarkdown(evt.name)}*\n` +
          `   📍 ${this.escapeMarkdown(evt.venue.name)}\n` +
          `   📅 ${this.escapeMarkdown(dateStr + ', ' + timeStr)}\n` +
          `   ${this.escapeMarkdown(priceLine)}\n\n`;

        // Add "View Tickets" button
        const shortName = evt.name.length > 20 ? evt.name.slice(0, 20) + '...' : evt.name;
        eventButtons.push([
          Markup.button.callback(
            `🎟️ ${shortName}`,
            `tickets:${evt.platform}:${evt.platformId}`,
          ),
          Markup.button.url('🔗 Buy', evt.url),
        ]);
      }

      if (result.events > result.upcomingEvents.length) {
        response += `_\\.\\.\\. and ${result.events - result.upcomingEvents.length} more events_\n\n`;
      }

      response += `\n_Tap 🎟️ to see available tickets${this.escapeMarkdown('!')}_`;

      // Send with inline buttons
      if (eventButtons.length > 0) {
        await ctx.reply(response, {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard(eventButtons),
        });
        await this.sendWithMainMenu(ctx, '👆 Tap an event above to see tickets');
      } else {
        await this.sendWithMainMenu(ctx, response, { parse_mode: 'MarkdownV2' });
      }
    } catch (error) {
      logger.error('[TelegramBot] Search failed', {
        keyword,
        city,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendWithMainMenu(
        ctx,
        `❌ ${error instanceof Error ? error.message : 'Search failed. Try again later.'}`,
      );
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

    await this.sendWithMainMenu(ctx, msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /settings — View current subscription (with edit actions)
  // ==========================================================================

  private async handleSettings(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const subs = this.monitor.getSubscriptions().filter(s => s.userId === chatId);

    if (subs.length === 0) {
      await this.sendWithMainMenu(ctx, 'No active subscriptions. Tap 📋 Subscribe to set one up.');
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
      `_Tap 📋 Subscribe to change, ⏸️ Pause to mute, or type /unsub to remove\\._`;

    await this.sendWithMainMenu(ctx, msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /help
  // ==========================================================================

  private async handleHelp(ctx: TelegrafContext): Promise<void> {
    const msg =
      `🎯 *SeatSniper Help*\n\n` +
      `*Menu Buttons:*\n` +
      `🔍 *Scan* — Quick scan a city for deals\n` +
      `📋 *Subscribe* — Set up automatic alerts\n` +
      `📊 *Status* — Check monitoring activity\n` +
      `⚙️ *Settings* — View your preferences\n` +
      `⏸️ *Pause* / ▶️ *Resume* — Toggle alerts\n\n` +
      `*How it works:*\n` +
      `1\\. Subscribe with city, seats, budget, and score\n` +
      `2\\. I poll StubHub, Ticketmaster, and SeatGeek\n` +
      `3\\. When high\\-value tickets are found, I send:\n` +
      `   🗺️ Venue seat map with highlighted section\n` +
      `   💰 Value score and price analysis\n` +
      `   🛒 Direct buy link\n\n` +
      `*On each alert you can:*\n` +
      `   🔕 Mute that event\n` +
      `   🔄 Refresh prices\n\n` +
      `_Slash commands also work: /scan, /subscribe, /status, /unsub_`;

    await this.sendWithMainMenu(ctx, msg, { parse_mode: 'MarkdownV2' });
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
        `Each alert includes a venue seat map so you can see exactly where you'd sit\\.`,
        { parse_mode: 'MarkdownV2' },
      );

      // Follow-up with main menu (editMessageText can't carry reply keyboards)
      await this.sendWithMainMenu(ctx, '🎯 You\'re all set! Use the menu below to continue.');

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

    // --- Search city from button ---
    if (data.startsWith('search_city:')) {
      const city = data.replace('search_city:', '');
      const session = this.sessions.get(chatId);
      const keyword = session?.pendingKeyword;

      if (!keyword) {
        await this.sendWithMainMenu(ctx, 'Search session expired. Tap 🔎 Search to try again.');
        return;
      }

      this.sessions.delete(chatId);
      await this.executeSearch(ctx, keyword, city);
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
        '✅ Subscription removed. You will no longer receive alerts.',
      );
      await this.sendWithMainMenu(ctx, 'Tap 📋 Subscribe to set up again anytime.');
      return;
    }

    if (data === 'unsub:cancel') {
      await ctx.editMessageText('👍 Your subscription is still active. Alerts will continue.');
      await this.sendWithMainMenu(ctx, '👍 Keeping your alerts active.');
      return;
    }

    // --- View tickets for an event ---
    if (data.startsWith('tickets:')) {
      const parts = data.split(':');
      if (parts.length >= 3) {
        const platform = parts[1];
        const eventId = parts.slice(2).join(':'); // Handle IDs with colons
        await this.handleViewTickets(ctx, platform, eventId);
      }
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

    const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text?.trim() : '';
    if (!text) return;

    // --- Reply keyboard button routing ---
    // If user taps a menu button while mid-wizard, clear the session first
    if (MENU_LABELS.has(text)) {
      this.sessions.delete(chatId);

      switch (text) {
        case MENU.SCAN:      return this.handleScan(ctx);
        case MENU.SEARCH:    return this.handleSearch(ctx);
        case MENU.SUBSCRIBE: return this.handleSubscribe(ctx);
        case MENU.STATUS:    return this.handleStatus(ctx);
        case MENU.SETTINGS:  return this.handleSettings(ctx);
        case MENU.PAUSE:     return this.handlePause(ctx);
        case MENU.RESUME:    return this.handleResume(ctx);
        case MENU.HELP:      return this.handleHelp(ctx);
      }
    }

    // --- Search flow: user typed a keyword ---
    const session = this.sessions.get(chatId);
    if (session?.step === 'awaiting_search_keyword') {
      const keyword = text.trim();
      if (keyword.length < 2 || keyword.length > 100) {
        await ctx.reply('Please enter a search term (2–100 characters).');
        return;
      }

      session.pendingKeyword = keyword;
      session.step = 'awaiting_search_city';

      const cities = config.monitoring.cities;
      const buttons = cities.map(c => [
        Markup.button.callback(
          c.charAt(0).toUpperCase() + c.slice(1),
          `search_city:${c}`,
        ),
      ]);

      await ctx.reply('📍 Which city?', Markup.inlineKeyboard(buttons));
      return;
    }

    // --- Active session flow (user typed text during wizard) ---
    if (session && session.step !== 'idle') {
      await ctx.reply('Please use the buttons above to make your selection.');
      return;
    }

    // --- Fallback for unrecognized text ---
    await this.sendWithMainMenu(ctx, 'Tap a button below to get started 👇');
  }

  // ==========================================================================
  // View Tickets — Fetch and display listings for an event
  // ==========================================================================

  private async handleViewTickets(
    ctx: TelegrafContext,
    platform: string,
    eventId: string,
  ): Promise<void> {
    try {
      // Look up the event from our tracked events
      const event = this.monitor.getEventById(platform, eventId);

      if (!event) {
        await ctx.answerCbQuery('Event not found');
        await this.sendWithMainMenu(
          ctx,
          '❌ Event not found. Try scanning again.',
        );
        return;
      }

      // Build event details message
      const dateStr = event.dateTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const timeStr = event.dateTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });

      const priceLine = event.priceRange
        ? `💰 *Price Range:* $${event.priceRange.min} – $${event.priceRange.max}`
        : '💰 *Price:* See link for current prices';

      const platformName = platform === 'ticketmaster' ? 'Ticketmaster' : platform;

      let response = `🎟️ *${this.escapeMarkdown(event.name)}*\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
      response += `📍 *Venue:* ${this.escapeMarkdown(event.venue.name)}\n`;
      response += `📅 *Date:* ${this.escapeMarkdown(dateStr)}\n`;
      response += `🕐 *Time:* ${this.escapeMarkdown(timeStr)}\n`;
      response += `${priceLine}\n\n`;
      response += `👆 Tap the button below to view available seats and buy tickets on ${this.escapeMarkdown(platformName)}\\!`;

      // Create inline button to open Ticketmaster
      const buyButton = event.url && event.url.startsWith('http')
        ? [[Markup.button.url(`🎫 Buy on ${platformName}`, event.url)]]
        : [];

      await ctx.answerCbQuery('Opening event details...');
      await ctx.reply(response, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(buyButton),
      });
    } catch (error) {
      logger.error('[TelegramBot] View tickets failed', {
        platform,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.answerCbQuery('Failed to load event');
      await this.sendWithMainMenu(ctx, '❌ Failed to load event. Try again later.');
    }
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

  private getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      concerts: '🎵',
      sports: '🏟️',
      theater: '🎭',
      comedy: '😂',
      festivals: '🎪',
    };
    return icons[category] || '🎫';
  }

  private getPlatformIndicator(platform: string): string {
    const indicators: Record<string, string> = {
      ticketmaster: '🎫',
      seatgeek: '🪑',
      stubhub: '🎟️',
      vividseats: '💜',
    };
    return indicators[platform] || '';
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
