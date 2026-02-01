/**
 * Telegram Bot — Interactive Command Handler
 *
 * Provides a conversational UX for managing SeatSniper:
 *   /start     — Onboarding & help
 *   /subscribe — Set up monitoring (city, score, quantity)
 *   /unsub     — Remove subscription
 *   /scan      — One-shot scan of a city
 *   /status    — Show monitoring status
 *   /settings  — View/edit preferences
 *   /help      — Show commands
 *
 * Seat map images are delivered as part of the alert flow
 * (handled by TelegramNotifier.sendSeatMapImage).
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
  step: 'idle' | 'awaiting_city' | 'awaiting_quantity' | 'awaiting_score';
  /** Partially built subscription */
  pendingSub: Partial<Subscription>;
}

// ============================================================================
// Telegram Bot Service
// ============================================================================

export class TelegramBotService {
  private bot: Telegraf;
  private monitor: MonitorService;
  private sessions: Map<string, UserSession> = new Map();
  private isRunning = false;

  constructor(monitor: MonitorService) {
    if (!config.telegram.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    this.bot = new Telegraf(config.telegram.botToken);
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

    // Use long-polling (webhook can be configured for production)
    void this.bot.launch();
    this.isRunning = true;

    logger.info(`[TelegramBot] Bot is live — @${botInfo.username}`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.bot.stop('SIGTERM');
    this.isRunning = false;
    logger.info('[TelegramBot] Stopped');
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
      `4\\. /help — All commands\n\n` +
      `_Alerts include venue seat maps, value scores, and direct buy links\\._`;

    await ctx.reply(welcome, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /subscribe — Interactive subscription setup
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
      },
    });

    const cities = config.monitoring.cities;
    const buttons = cities.map(city => [
      Markup.button.callback(
        city.charAt(0).toUpperCase() + city.slice(1),
        `city:${city}`,
      ),
    ]);

    // Add an "All Cities" option
    buttons.push([Markup.button.callback('📍 All Cities', 'city:all')]);

    await ctx.reply(
      '🏙️ Which cities do you want to monitor?\n\n_Select one or tap "All Cities"_',
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  }

  // ==========================================================================
  // /unsub — Remove subscription
  // ==========================================================================

  private async handleUnsub(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    this.monitor.removeSubscription(chatId);

    // Persist to database (best-effort)
    SubRepo.removeSubscription(chatId).catch(err => {
      logger.warn('[TelegramBot] Failed to persist unsub', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    await ctx.reply('✅ Subscription removed. You will no longer receive alerts.\n\nUse /subscribe to set up again.');
  }

  // ==========================================================================
  // /scan — One-shot city scan
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
    await ctx.reply(`🔍 Scanning ${city}... This may take a moment.`);

    try {
      const result = await this.monitor.scanCity(city);

      if (result.events === 0) {
        await ctx.reply(`No events found in ${city} for the next 30 days.`);
        return;
      }

      let response =
        `📊 *${this.escapeMarkdown(city.charAt(0).toUpperCase() + city.slice(1))} Scan Results*\n\n` +
        `🎫 Events found: ${result.events}\n` +
        `🎟️ Listings sampled: ${result.listings}\n` +
        `⭐ Top picks: ${result.topPicks.length}\n\n`;

      if (result.topPicks.length > 0) {
        response += `*Best Deals:*\n`;
        for (const pick of result.topPicks.slice(0, 5)) {
          const l = pick.listing;
          const s = pick.score;
          response +=
            `\n${this.getScoreEmoji(s.totalScore)} *Score ${s.totalScore}/100*\n` +
            `   ${this.escapeMarkdown(l.section)} Row ${this.escapeMarkdown(l.row)} — ` +
            `$${l.pricePerTicket}/ea \\(${l.quantity} avail\\)\n` +
            `   _${this.escapeMarkdown(s.reasoning)}_\n`;
        }
      }

      response += `\n_Use /subscribe to get alerts when great deals appear\\!_`;

      await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      logger.error('[TelegramBot] Scan failed', {
        city,
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply(`❌ Scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ==========================================================================
  // /status — Monitoring status
  // ==========================================================================

  private async handleStatus(ctx: TelegrafContext): Promise<void> {
    const status = this.monitor.getStatus();

    const msg =
      `📡 *SeatSniper Status*\n\n` +
      `Running: ${status.running ? '✅' : '❌'}\n` +
      `Tracked Events: ${status.trackedEvents}\n` +
      `Active Subscriptions: ${status.subscriptions}\n` +
      `Alerts Sent: ${status.alertsSent}\n\n` +
      `*Events by Priority:*\n` +
      `🔴 High \\(<7 days\\): ${status.eventsByPriority.high}\n` +
      `🟡 Medium \\(<30 days\\): ${status.eventsByPriority.medium}\n` +
      `🟢 Low \\(>30 days\\): ${status.eventsByPriority.low}\n` +
      `⚪ Past: ${status.eventsByPriority.past}`;

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /settings — View current subscription
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
    const msg =
      `⚙️ *Your Settings*\n\n` +
      `🏙️ Cities: ${this.escapeMarkdown(sub.cities.join(', '))}\n` +
      `🎯 Min Score: ${sub.minScore}/100\n` +
      `👥 Min Seats Together: ${sub.minQuantity}\n` +
      `📡 Channel: ${sub.channel}\n` +
      `✅ Active: ${sub.active ? 'Yes' : 'No'}\n\n` +
      `_Use /subscribe to change or /unsub to remove\\._`;

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  }

  // ==========================================================================
  // /help
  // ==========================================================================

  private async handleHelp(ctx: TelegrafContext): Promise<void> {
    const msg =
      `🎯 *SeatSniper Commands*\n\n` +
      `/subscribe — Set up deal alerts\n` +
      `/unsub — Remove your subscription\n` +
      `/scan \\[city\\] — Quick scan for deals\n` +
      `/status — Monitoring status\n` +
      `/settings — View your preferences\n` +
      `/help — This message\n\n` +
      `*How it works:*\n` +
      `1\\. Subscribe with your city and seat preferences\n` +
      `2\\. I poll StubHub, Ticketmaster, and SeatGeek\n` +
      `3\\. When high\\-value tickets are found, I send you:\n` +
      `   🗺️ Venue seat map with highlighted section\n` +
      `   💰 Value score and price analysis\n` +
      `   🛒 Direct buy link\n\n` +
      `_Family\\-friendly: filter by consecutive seats available\\!_`;

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

    // --- City selection (subscribe flow) ---
    if (data.startsWith('city:')) {
      const city = data.replace('city:', '');
      const session = this.sessions.get(chatId);
      if (!session || session.step !== 'awaiting_city') return;

      session.pendingSub.cities = city === 'all'
        ? [...config.monitoring.cities]
        : [city];

      // Move to quantity step
      session.step = 'awaiting_quantity';

      const buttons = [
        [Markup.button.callback('👤 1 (Solo)', 'qty:1')],
        [Markup.button.callback('👥 2 (Pair)', 'qty:2')],
        [Markup.button.callback('👨‍👩‍👧‍👦 4 (Family)', 'qty:4')],
        [Markup.button.callback('🎉 Any quantity', 'qty:1')],
      ];

      const selectedCity = city === 'all'
        ? 'All cities'
        : city.charAt(0).toUpperCase() + city.slice(1);

      await ctx.editMessageText(
        `✅ Monitoring: ${selectedCity}\n\n` +
        `👥 How many seats together do you need?\n` +
        `_This filters for consecutive seats available._`,
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

      // Move to score threshold step
      session.step = 'awaiting_score';

      const buttons = [
        [Markup.button.callback('🌟 85+ (Excellent only)', 'score:85')],
        [Markup.button.callback('✨ 70+ (Good+) — Recommended', 'score:70')],
        [Markup.button.callback('👍 55+ (Fair+)', 'score:55')],
        [Markup.button.callback('📊 40+ (Show most)', 'score:40')],
      ];

      await ctx.editMessageText(
        `✅ Seats together: ${qty}+\n\n` +
        `🎯 What minimum value score should trigger an alert?\n` +
        `_Higher = fewer but better deals._`,
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
        active: true,
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

      await ctx.editMessageText(
        `✅ *Subscription Active\\!*\n\n` +
        `🏙️ Cities: ${this.escapeMarkdown(sub.cities.join(', '))}\n` +
        `👥 Min seats together: ${sub.minQuantity}\n` +
        `🎯 Alert threshold: ${scoreLabel}\n\n` +
        `I'm now monitoring ticket platforms and will alert you when great deals appear\\. ` +
        `Each alert includes a venue seat map so you can see exactly where you'd sit\\.\n\n` +
        `_Use /settings to view or /unsub to remove\\._`,
        { parse_mode: 'MarkdownV2' },
      );

      logger.info('[TelegramBot] New subscription', {
        userId: chatId,
        cities: sub.cities,
        minScore: sub.minScore,
        minQuantity: sub.minQuantity,
      });
      return;
    }

    // --- Scan city from button ---
    if (data.startsWith('scan:')) {
      const city = data.replace('scan:', '');
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
}
