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
import type { IPlatformAdapter, EventSearchParams } from '../../adapters/base/platform-adapter.interface.js';
import * as SubRepo from '../../data/repositories/subscription.repository.js';
import * as WatchlistRepo from '../../data/repositories/watchlist.repository.js';
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
  SCAN:      '🎯 Snipe',
  SEARCH:    '🔎 Search',
  WATCHLIST: '⭐ Watchlist',
  SUBSCRIBE: '🔔 Alert Me',
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

/** Maximum size for muted events map to prevent memory leaks */
const MAX_MUTED_EVENTS = 10000;

/** Maximum size for sessions map */
const MAX_SESSIONS = 5000;

export class TelegramBotService {
  private bot: Telegraf;
  private monitor: MonitorService;
  private onDemandAdapters: Map<string, IPlatformAdapter>;
  private sessions: Map<string, UserSession> = new Map();
  private sessionPruneTimer: NodeJS.Timeout | null = null;
  private mutedEvents: MutedEvents = new Map();
  private isRunning = false;
  private isShuttingDown = false;

  /**
   * @param monitor - The monitoring service to wire commands to
   * @param existingBot - Optional shared Telegraf instance (from TelegramNotifier).
   *                      If provided, this service registers handlers on it and
   *                      manages the long-polling lifecycle.
   * @param onDemandAdapters - Paid adapters (like Google Events) only triggered by user action
   */
  constructor(
    monitor: MonitorService,
    existingBot?: Telegraf,
    onDemandAdapters?: Map<string, IPlatformAdapter>,
  ) {
    if (!existingBot && !config.telegram.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    this.bot = existingBot ?? new Telegraf(config.telegram.botToken);
    this.monitor = monitor;
    this.onDemandAdapters = onDemandAdapters ?? new Map();
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
      this.isShuttingDown = false;

      // Clear any existing timer before creating new one (prevent duplicate timers)
      if (this.sessionPruneTimer) {
        clearInterval(this.sessionPruneTimer);
      }

      // Prune stale sessions and muted events every 5 minutes
      this.sessionPruneTimer = setInterval(() => this.pruneResources(), 5 * 60 * 1000);

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

    // Set shutdown flag to reject new handlers
    this.isShuttingDown = true;
    this.isRunning = false;

    if (this.sessionPruneTimer) {
      clearInterval(this.sessionPruneTimer);
      this.sessionPruneTimer = null;
    }
    this.sessions.clear();
    this.mutedEvents.clear();

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
      await this.bot.telegram.getMe();
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

  /**
   * Prune stale sessions and enforce size limits on maps to prevent memory leaks
   */
  private pruneResources(): void {
    const now = Date.now();

    // Prune expired sessions
    let prunedSessions = 0;
    for (const [chatId, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(chatId);
        prunedSessions++;
      }
    }

    // Enforce max sessions limit (remove oldest if over limit)
    if (this.sessions.size > MAX_SESSIONS) {
      const excess = this.sessions.size - MAX_SESSIONS;
      const iterator = this.sessions.keys();
      for (let i = 0; i < excess; i++) {
        const key = iterator.next().value;
        if (key) this.sessions.delete(key);
      }
      prunedSessions += excess;
    }

    // Enforce max muted events limit (clear oldest entries)
    if (this.mutedEvents.size > MAX_MUTED_EVENTS) {
      const excess = this.mutedEvents.size - MAX_MUTED_EVENTS;
      const iterator = this.mutedEvents.keys();
      for (let i = 0; i < excess; i++) {
        const key = iterator.next().value;
        if (key) this.mutedEvents.delete(key);
      }
      logger.debug(`[TelegramBot] Pruned ${excess} old muted events (size limit)`);
    }

    if (prunedSessions > 0) {
      logger.debug(`[TelegramBot] Pruned ${prunedSessions} stale sessions`);
    }
  }


  // ==========================================================================
  // Persistent Reply Keyboard Helpers
  // ==========================================================================

  /** Single source of truth for the main menu keyboard layout */
  private mainMenuKeyboard() {
    // Flywheel order: Discover → Track → Monitor → Control → Utility
    return Markup.keyboard([
      [MENU.SCAN, MENU.SEARCH, MENU.WATCHLIST],  // Discovery
      [MENU.STATUS, MENU.SUBSCRIBE],              // Monitor & Alert
      [MENU.PAUSE, MENU.RESUME],                  // Alert control
      [MENU.SETTINGS, MENU.HELP],                 // Utility
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
  // Helpers
  // ==========================================================================

  /**
   * Safely extract chatId from context, handling edge cases
   * Returns null if chatId cannot be determined
   */
  private getChatId(ctx: TelegrafContext): string | null {
    const id = ctx.chat?.id;
    // Handle undefined, null, and edge case where id is 0 (falsy but valid)
    if (id === undefined || id === null) return null;
    return String(id);
  }

  // ==========================================================================
  // Command Registration
  // ==========================================================================

  private registerHandlers(): void {
    // Helper to wrap handlers with error catching and shutdown check
    const safeHandler = <T extends TelegrafContext>(
      handler: (ctx: T) => Promise<void>,
      name: string,
    ) => {
      return async (ctx: T) => {
        // Reject handlers during shutdown
        if (this.isShuttingDown) {
          logger.debug(`[TelegramBot] Rejecting ${name} handler during shutdown`);
          return;
        }

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
    this.bot.command('watchlist', safeHandler(ctx => this.handleWatchlist(ctx), 'watchlist'));
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
    const chatId = this.getChatId(ctx);
    if (!chatId) return;

    const welcome =
      `🎯 Welcome to SeatSniper!\n\n` +
      `I find the best-value tickets across multiple platforms and alert you when great deals appear.\n\n` +
      `GET STARTED:\n` +
      `🎯 Snipe — Quick scan a city for deals\n` +
      `🔔 Alert Me — Set up automatic deal alerts\n` +
      `⭐ Watchlist — Track specific events\n\n` +
      `Tap a button below to begin 👇`;

    await this.sendWithMainMenu(ctx, welcome);
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

    // Add "All Cities" option
    buttons.push([Markup.button.callback('📍 All Cities', 'city:all')]);

    await ctx.reply(
      `🔔 Set Up Alerts\n\n` +
      `🏙️ Which cities do you want alerts for?`,
      Markup.inlineKeyboard(buttons),
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
      await this.sendWithMainMenu(ctx, 'You don\'t have alerts set up. Tap 🔔 Alert Me to get started.');
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
      'Tip: Use /pause to mute alerts temporarily instead.',
      Markup.inlineKeyboard(buttons),
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
      await this.sendWithMainMenu(ctx, 'No active alerts to pause. Tap 🔔 Alert Me to set them up.');
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
      await this.sendWithMainMenu(ctx, 'No paused alerts found. Tap 🔔 Alert Me to set them up.');
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

    // If called from reply keyboard ("🎯 Snipe") or bare /scan, show city picker.
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

    await ctx.reply(`🎯 Sniping ${sanitized}... This may take up to 30 seconds.`);

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
      let response = `📊 ${cityTitle} — ${result.events} Events Found\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Show upcoming events with details
      // Build inline buttons for each event (View Tickets)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventButtons: any[][] = [];

      if (result.upcomingEvents.length > 0) {
        for (const evt of result.upcomingEvents) {
          const dateStr = evt.dateTime.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric',
          });
          const timeStr = evt.dateTime.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit',
          });

          const categoryIcon = this.getCategoryIcon(evt.category);
          const platformIcon = this.getPlatformIndicator(evt.platform);
          const priceLine = evt.priceRange
            ? `💰 $${evt.priceRange.min}-$${evt.priceRange.max}`
            : '💰 Price TBD';

          response +=
            `${categoryIcon}${platformIcon} ${evt.name}\n` +
            `   📍 ${evt.venue.name}\n` +
            `   📅 ${dateStr}, ${timeStr}\n` +
            `   ${priceLine}\n\n`;

          // Button label: include date to differentiate events
          const buttonLabel = `🎟️ ${dateStr} - Buy`;

          // Use URL button if we have a valid URL, otherwise fallback to callback
          if (evt.url && evt.url.startsWith('http')) {
            eventButtons.push([
              Markup.button.url(buttonLabel, evt.url),
              Markup.button.callback('⭐ Watch', `watch:${evt.platform}:${evt.platformId}`),
            ]);
          } else {
            eventButtons.push([
              Markup.button.callback(`🎟️ ${dateStr}`, `tickets:${evt.platform}:${evt.platformId}`),
              Markup.button.callback('⭐ Watch', `watch:${evt.platform}:${evt.platformId}`),
            ]);
          }
        }

        if (result.events > result.upcomingEvents.length) {
          response += `... and ${result.events - result.upcomingEvents.length} more events\n\n`;
        }
      }

      // Show top picks if any listings were scored
      if (result.topPicks.length > 0) {
        response += `🔥 Best Deals:\n`;
        for (const pick of result.topPicks.slice(0, 5)) {
          const l = pick.listing;
          const s = pick.score;
          response +=
            `\n${this.getScoreEmoji(s.totalScore)} Score ${s.totalScore}/100\n` +
            `   ${l.section} Row ${l.row} — $${l.pricePerTicket}/ea (${l.quantity} avail)\n` +
            `   ${s.reasoning}\n`;
        }
      }

      response += `\nTap 🎟️ to buy, ⭐ to track, or 🔔 Alert Me for deals!`;

      // Send with inline buttons if we have events
      if (eventButtons.length > 0) {
        await ctx.reply(response, Markup.inlineKeyboard(eventButtons));
        // Follow up with the main menu keyboard
        await this.sendWithMainMenu(ctx, '👆 Tap an event above to see tickets');
      } else {
        await this.sendWithMainMenu(ctx, response);
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
      'Example: Taylor Swift, Trail Blazers, Hamilton',
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
      let response = `🔎 "${keyword}" in ${cityTitle} — ${result.events} Events\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Build inline buttons for each event
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventButtons: any[][] = [];

      for (const evt of result.upcomingEvents) {
        const dateStr = evt.dateTime.toLocaleDateString('en-US', {
          month: 'short', day: 'numeric',
        });
        const timeStr = evt.dateTime.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit',
        });

        const categoryIcon = this.getCategoryIcon(evt.category);
        const platformIcon = this.getPlatformIndicator(evt.platform);
        const priceLine = evt.priceRange
          ? `💰 $${evt.priceRange.min}-$${evt.priceRange.max}`
          : '💰 Price TBD';

        response +=
          `${categoryIcon}${platformIcon} ${evt.name}\n` +
          `   📍 ${evt.venue.name}\n` +
          `   📅 ${dateStr}, ${timeStr}\n` +
          `   ${priceLine}\n\n`;

        // Button label: include date to differentiate games
        const buttonLabel = `🎟️ ${dateStr} - Buy`;

        // Use URL button if we have a valid URL, otherwise callback
        if (evt.url && evt.url.startsWith('http')) {
          eventButtons.push([
            Markup.button.url(buttonLabel, evt.url),
            Markup.button.callback('⭐ Watch', `watch:${evt.platform}:${evt.platformId}`),
          ]);
        } else {
          eventButtons.push([
            Markup.button.callback(`🎟️ ${dateStr}`, `tickets:${evt.platform}:${evt.platformId}`),
            Markup.button.callback('⭐ Watch', `watch:${evt.platform}:${evt.platformId}`),
          ]);
        }
      }

      if (result.events > result.upcomingEvents.length) {
        response += `... and ${result.events - result.upcomingEvents.length} more events\n\n`;
      }

      response += `\nTap 🎟️ to buy, ⭐ to track!`;

      // Send with inline buttons
      if (eventButtons.length > 0) {
        await ctx.reply(response, Markup.inlineKeyboard(eventButtons));
        await this.sendWithMainMenu(ctx, '👆 Tap an event above to see tickets');
      } else {
        await this.sendWithMainMenu(ctx, response);
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
        userLine = `👤 You: ✅ Active (${userSub.cities.join(', ')})`;
      }
    }

    const pausedNote = status.pausedSubscriptions > 0
      ? ` (${status.pausedSubscriptions} paused)`
      : '';

    const msg =
      `📡 SeatSniper Status\n\n` +
      `${userLine}\n\n` +
      `Running: ${status.running ? '✅' : '❌'}\n` +
      `Tracked Events: ${status.trackedEvents}\n` +
      `Active Subs: ${status.subscriptions}${pausedNote}\n` +
      `Alerts Sent: ${status.alertsSent}\n\n` +
      `Events by Priority:\n` +
      `🔴 High (<7 days): ${status.eventsByPriority.high}\n` +
      `🟡 Medium (<30 days): ${status.eventsByPriority.medium}\n` +
      `🟢 Low (>30 days): ${status.eventsByPriority.low}\n` +
      `⚪ Past: ${status.eventsByPriority.past}`;

    await this.sendWithMainMenu(ctx, msg);
  }

  // ==========================================================================
  // /settings — View current subscription (with edit actions)
  // ==========================================================================

  private async handleSettings(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    const subs = this.monitor.getSubscriptions().filter(s => s.userId === chatId);

    if (subs.length === 0) {
      await this.sendWithMainMenu(ctx, 'No alerts set up yet. Tap 🔔 Alert Me to get started.');
      return;
    }

    const sub = subs[0];
    const budgetLine = sub.maxPricePerTicket > 0
      ? `💰 Max Price: $${sub.maxPricePerTicket}/ticket`
      : '💰 Max Price: No limit';
    const statusLine = sub.paused ? '⏸️ Status: Paused' : '✅ Status: Active';

    const msg =
      `⚙️ Your Settings\n\n` +
      `🏙️ Cities: ${sub.cities.join(', ')}\n` +
      `🎯 Min Score: ${sub.minScore}/100\n` +
      `👥 Min Seats Together: ${sub.minQuantity}\n` +
      `${budgetLine}\n` +
      `📡 Channel: ${sub.channel}\n` +
      `${statusLine}\n\n` +
      `Tap 🔔 Alert Me to change, ⏸️ Pause to mute, or /unsub to remove.`;

    await this.sendWithMainMenu(ctx, msg);
  }

  // ==========================================================================
  // /help
  // ==========================================================================

  private async handleHelp(ctx: TelegrafContext): Promise<void> {
    const msg =
      `🎯 SeatSniper Help\n\n` +
      `MENU BUTTONS:\n` +
      `🎯 Snipe — Quick scan a city for deals\n` +
      `🔎 Search — Search events by keyword\n` +
      `⭐ Watchlist — View events you're tracking\n` +
      `🔔 Alert Me — Set up automatic alerts\n` +
      `📊 Status — Check monitoring activity\n` +
      `⚙️ Settings — View your preferences\n` +
      `⏸️ Pause / ▶️ Resume — Toggle alerts\n\n` +
      `HOW IT WORKS:\n` +
      `1. 🎯 Snipe a city to discover deals (FREE)\n` +
      `2. ⭐ Watch events you're interested in\n` +
      `3. 💰 Compare Prices across platforms (~$0.03)\n` +
      `4. 🔔 Alert Me for automatic deal alerts\n\n` +
      `ON EACH ALERT:\n` +
      `   🔕 Mute that event\n` +
      `   🔄 Refresh prices\n\n` +
      `Commands: /scan /search /watchlist /subscribe /status /unsub`;

    await this.sendWithMainMenu(ctx, msg);
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
          ? `\n\nSelected: ${session.selectedCities.join(', ')}`
          : '';

        await ctx.editMessageText(
          `🏙️ Which cities do you want to monitor?${selected}\n\nTap to select/deselect, then "Done" or "All Cities".`,
          Markup.inlineKeyboard(buttons),
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
        `👥 How many seats together do you need?`,
        Markup.inlineKeyboard(buttons),
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
        `✅ Seats: ${qty}+\n\n` +
        `💰 Max budget per ticket?`,
        Markup.inlineKeyboard(buttons),
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
        [Markup.button.callback('✨ 70+ (Recommended)', 'score:70')],
        [Markup.button.callback('👍 55+ (Fair+)', 'score:55')],
        [Markup.button.callback('📊 40+ (Show all)', 'score:40')],
      ];

      const budgetLabel = budget > 0 ? `$${budget}/ticket` : 'No limit';

      await ctx.editMessageText(
        `✅ Budget: ${budgetLabel}\n\n` +
        `🎯 Minimum deal score to alert you?\n` +
        `(Higher = fewer but better deals)`,
        Markup.inlineKeyboard(buttons),
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
        `✅ Subscription Active!\n\n` +
        `🏙️ Cities: ${sub.cities.join(', ')}\n` +
        `👥 Seats: ${sub.minQuantity}+\n` +
        `💰 Budget: ${budgetLabel}\n` +
        `🎯 Threshold: ${scoreLabel}\n\n` +
        `I'll alert you when great deals appear!`,
      );

      // Follow-up with main menu
      await this.sendWithMainMenu(ctx, '🎯 You\'re all set! Use the menu below.');

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
      await this.sendWithMainMenu(ctx, 'Tap 🔔 Alert Me to set up again anytime.');
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
        // Validate platform and eventId are non-empty
        if (platform && eventId) {
          await this.handleViewTickets(ctx, platform, eventId);
        } else {
          logger.warn('[TelegramBot] Invalid ticket callback data', { data });
          await ctx.answerCbQuery('Invalid event data');
        }
      } else {
        logger.warn('[TelegramBot] Malformed ticket callback', { data, parts: parts.length });
        await ctx.answerCbQuery('Invalid request');
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

    // --- Watch event (add to watchlist) ---
    if (data.startsWith('watch:')) {
      const parts = data.split(':');
      if (parts.length >= 3) {
        const platform = parts[1];
        const eventId = parts.slice(2).join(':');
        await this.handleWatchEvent(ctx, chatId, platform, eventId);
      }
      return;
    }

    // --- Already watched (button already shows ✅ Watching) ---
    if (data.startsWith('already_watched:')) {
      await ctx.answerCbQuery('✅ Already on your watchlist!\n\nTap ⭐ Watchlist to view.', { show_alert: true });
      return;
    }

    // --- Unwatch event (remove from watchlist) ---
    if (data.startsWith('unwatch:')) {
      const parts = data.split(':');
      if (parts.length >= 3) {
        const platform = parts[1];
        const eventId = parts.slice(2).join(':');
        await this.handleUnwatchEvent(ctx, chatId, platform, eventId);
      }
      return;
    }

    // --- Compare prices (triggers paid Google Events search) ---
    if (data.startsWith('compare:')) {
      const parts = data.split(':');
      if (parts.length >= 3) {
        const platform = parts[1];
        const eventId = parts.slice(2).join(':');
        await this.handleComparePrice(ctx, chatId, platform, eventId);
      }
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

    // Skip if it's a command (starts with /)
    if (text.startsWith('/')) {
      logger.debug('[TelegramBot] Skipping text handler for command', { text });
      return;
    }

    logger.debug('[TelegramBot] handleText received', { chatId, text, isMenuLabel: MENU_LABELS.has(text) });

    // --- Reply keyboard button routing ---
    // If user taps a menu button while mid-wizard, clear the session first
    if (MENU_LABELS.has(text)) {
      logger.debug('[TelegramBot] Menu button matched', { text });
      this.sessions.delete(chatId);

      switch (text) {
        case MENU.SCAN:      return this.handleScan(ctx);
        case MENU.SEARCH:    return this.handleSearch(ctx);
        case MENU.WATCHLIST: return this.handleWatchlist(ctx);
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
        ? `💰 Price Range: $${event.priceRange.min} - $${event.priceRange.max}`
        : '💰 Price: See link for current prices';

      const platformName = platform === 'ticketmaster' ? 'Ticketmaster' : platform;

      let response = `🎟️ ${event.name}\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
      response += `📍 Venue: ${event.venue.name}\n`;
      response += `📅 Date: ${dateStr}\n`;
      response += `🕐 Time: ${timeStr}\n`;
      response += `${priceLine}\n\n`;
      response += `👆 Tap the button below to view available seats and buy tickets on ${platformName}!`;

      // Create inline button to open Ticketmaster
      const buyButton = event.url && event.url.startsWith('http')
        ? [[Markup.button.url(`🎫 Buy on ${platformName}`, event.url)]]
        : [];

      await ctx.answerCbQuery('Opening event details...');
      await ctx.reply(response, Markup.inlineKeyboard(buyButton));
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
  // Watchlist — User's watched events
  // ==========================================================================

  private async handleWatchlist(ctx: TelegrafContext): Promise<void> {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    try {
      const watchlist = await WatchlistRepo.getWatchlist(chatId);
      logger.info('[TelegramBot] Watchlist loaded', { userId: chatId, count: watchlist.length });

      if (watchlist.length === 0) {
        await this.sendWithMainMenu(
          ctx,
          '⭐ Your Watchlist\n\n' +
          'No events watched yet.\n\n' +
          'Tap 🎯 Snipe to find events, then tap ⭐ Watch to track them!',
        );
        return;
      }

      // Use plain text to avoid MarkdownV2 escaping issues
      let response = `⭐ Your Watchlist (${watchlist.length} events)\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const eventButtons: ReturnType<typeof Markup.button.callback>[][] = [];

      for (const watched of watchlist) {
        const dateStr = watched.eventDate.toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        });

        const priceLine = watched.lastPriceMin
          ? `$${watched.lastPriceMin}${watched.lastPriceMax ? `-$${watched.lastPriceMax}` : ''}`
          : 'Price TBD';

        response +=
          `🎫 ${watched.eventName}\n` +
          `   📍 ${watched.venueName}\n` +
          `   📅 ${dateStr}\n` +
          `   💰 ${priceLine}\n\n`;

        // Buttons: Compare Prices (paid) | Remove
        eventButtons.push([
          Markup.button.callback(
            `💰 Compare Prices`,
            `compare:${watched.platform}:${watched.platformEventId}`,
          ),
          Markup.button.callback(
            '❌ Remove',
            `unwatch:${watched.platform}:${watched.platformEventId}`,
          ),
        ]);
      }

      response += `\n💡 Compare Prices searches other platforms (~$0.03)`;

      if (eventButtons.length > 0) {
        await ctx.reply(response, Markup.inlineKeyboard(eventButtons));
        await this.sendWithMainMenu(ctx, '👆 Tap to compare prices across platforms');
      } else {
        await this.sendWithMainMenu(ctx, response);
      }
    } catch (error) {
      logger.error('[TelegramBot] Watchlist failed', {
        userId: chatId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await this.sendWithMainMenu(ctx, '❌ Failed to load watchlist. Try again.');
    }
  }

  private async handleWatchEvent(
    ctx: TelegrafContext,
    userId: string,
    platform: string,
    eventId: string,
  ): Promise<void> {
    try {
      // Get event details from monitor
      const event = this.monitor.getEventById(platform, eventId);

      if (!event) {
        await ctx.answerCbQuery('Event not found');
        return;
      }

      // Check if already watching
      const isAlreadyWatching = await WatchlistRepo.isWatching(userId, platform, eventId);
      if (isAlreadyWatching) {
        await ctx.answerCbQuery('⭐ Already watching this event!', { show_alert: true });
        return;
      }

      // Add to watchlist
      await WatchlistRepo.addToWatchlist({
        userId,
        event,
      });

      // Show popup alert (more visible than toast)
      await ctx.answerCbQuery('✅ Added to watchlist!\n\nTap ⭐ Watchlist to see your events.', { show_alert: true });

      // Update the button to show it's now watched
      try {
        if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
          const msg = ctx.callbackQuery.message;
          if ('reply_markup' in msg && msg.reply_markup?.inline_keyboard) {
            // Replace the Watch button with a "Watching ✓" button
            const newKeyboard = msg.reply_markup.inline_keyboard.map(row =>
              row.map(btn => {
                if ('callback_data' in btn && btn.callback_data === `watch:${platform}:${eventId}`) {
                  return Markup.button.callback('✅ Watching', `already_watched:${platform}:${eventId}`);
                }
                return btn;
              })
            );
            await ctx.editMessageReplyMarkup({ inline_keyboard: newKeyboard });
          }
        }
      } catch {
        // Ignore edit errors (message might be too old)
      }

      logger.info('[TelegramBot] Event added to watchlist', {
        userId,
        platform,
        eventId,
        eventName: event.name,
      });
    } catch (error) {
      logger.error('[TelegramBot] Watch event failed', {
        userId,
        platform,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.answerCbQuery('Failed to add to watchlist');
    }
  }

  private async handleUnwatchEvent(
    ctx: TelegrafContext,
    userId: string,
    platform: string,
    eventId: string,
  ): Promise<void> {
    try {
      const removed = await WatchlistRepo.removeFromWatchlist(userId, platform, eventId);

      if (removed) {
        await ctx.answerCbQuery('❌ Removed from watchlist');
        // Refresh the watchlist view
        await this.handleWatchlist(ctx);
      } else {
        await ctx.answerCbQuery('Event not in watchlist');
      }
    } catch (error) {
      logger.error('[TelegramBot] Unwatch event failed', {
        userId,
        platform,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.answerCbQuery('Failed to remove from watchlist');
    }
  }

  private async handleComparePrice(
    ctx: TelegrafContext,
    userId: string,
    platform: string,
    eventId: string,
  ): Promise<void> {
    await ctx.answerCbQuery('🔍 Searching multiple platforms...');
    await ctx.sendChatAction('typing');

    // Try to get event from monitor first, then fall back to watchlist
    let eventName = 'Unknown Event';
    let venueCity = 'Portland';

    const monitorEvent = this.monitor.getEventById(platform, eventId);
    if (monitorEvent) {
      eventName = monitorEvent.name;
      venueCity = monitorEvent.venue?.city || 'Portland';
    } else {
      // Event not in monitor - get from watchlist
      const watchlist = await WatchlistRepo.getWatchlist(userId);
      const watchedEvent = watchlist.find(w => w.platform === platform && w.platformEventId === eventId);
      if (watchedEvent) {
        eventName = watchedEvent.eventName;
        venueCity = watchedEvent.venueCity || 'Portland';
      }
    }

    // Check if Google Events adapter is available
    const googleEventsAdapter = this.onDemandAdapters.get('google-events');

    if (!googleEventsAdapter) {
      // No Google Events adapter configured - show manual search links
      await this.sendWithMainMenu(
        ctx,
        `💰 Price Comparison: ${eventName}\n\n` +
        `Google Events not configured.\n\n` +
        `Check these sites manually:\n` +
        `• Ticketmaster: ticketmaster.com\n` +
        `• SeatGeek: seatgeek.com\n` +
        `• StubHub: stubhub.com`,
      );
      return;
    }

    try {
      // Build search query from event name
      const searchParams: EventSearchParams = {
        city: venueCity,
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        keyword: eventName,
        limit: 10,
      };

      logger.info('[TelegramBot] Compare Prices: calling Google Events', {
        userId,
        platform,
        eventId,
        eventName,
        venueCity,
      });

      // Call the Google Events adapter (~$0.035 per search)
      const results = await googleEventsAdapter.searchEvents(searchParams);

      if (results.length === 0) {
        await this.sendWithMainMenu(
          ctx,
          `💰 Price Comparison: ${eventName}\n\n` +
          `No additional listings found on other platforms.\n\n` +
          `This event may only be available on ${platform}.\n` +
          `Cost: ~$0.03`,
        );
        return;
      }

      // Build comparison response (plain text for reliability)
      let msg = `💰 Price Comparison: ${eventName}\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Group by platform
      const byPlatform = new Map<string, typeof results>();
      for (const evt of results) {
        const p = evt.platform;
        if (!byPlatform.has(p)) byPlatform.set(p, []);
        byPlatform.get(p)!.push(evt);
      }

      for (const [plat, events] of byPlatform) {
        const platIcon = plat === 'ticketmaster' ? '🎫' : plat === 'seatgeek' ? '🎟️' : '🎪';
        const platName = plat.charAt(0).toUpperCase() + plat.slice(1);
        msg += `${platIcon} ${platName}\n`;

        for (const evt of events.slice(0, 3)) {
          const priceStr = evt.priceRange
            ? `$${evt.priceRange.min}${evt.priceRange.max ? `-$${evt.priceRange.max}` : ''}`
            : 'Price TBD';
          msg += `   ${priceStr}`;
          if (evt.url) {
            msg += ` - ${evt.url}`;
          }
          msg += `\n`;
        }
        msg += `\n`;
      }

      msg += `Found ${results.length} listing(s) | Cost: ~$0.03`;

      // Update watchlist with latest prices if found
      if (results.length > 0 && results[0].priceRange?.min) {
        await WatchlistRepo.updatePrices(
          userId,
          platform,
          eventId,
          results[0].priceRange.min,
          results[0].priceRange.max || results[0].priceRange.min,
        );
      }

      await this.sendWithMainMenu(ctx, msg);

      logger.info('[TelegramBot] Compare Prices: complete', {
        userId,
        resultsFound: results.length,
      });
    } catch (error) {
      logger.error('[TelegramBot] Compare Prices failed', {
        userId,
        platform,
        eventId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      await this.sendWithMainMenu(
        ctx,
        `💰 Price Comparison: ${eventName}\n\n` +
        `❌ Search failed. Please try again later.`,
      );
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
