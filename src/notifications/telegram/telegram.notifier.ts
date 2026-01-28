/**
 * Telegram Notifier
 * Sends alerts via Telegram Bot API with seat map visualization
 */

import { Telegraf } from 'telegraf';
import type {
  INotifier,
  AlertPayload,
  NotificationResult,
  NotificationChannel,
  DeliveryStatus,
} from '../base/notifier.interface.js';
import { TelegramFormatter } from './telegram.formatter.js';
import { SeatMapService } from '../../venues/seat-map.service.js';
import { logger, logAlertDelivery } from '../../utils/logger.js';
import { config } from '../../config/index.js';

// ============================================================================
// Telegram Notifier Implementation
// ============================================================================

export class TelegramNotifier implements INotifier {
  readonly channel: NotificationChannel = 'telegram';

  private bot: Telegraf;
  private formatter: TelegramFormatter;
  private seatMapService: SeatMapService;
  private isInitialized: boolean = false;

  constructor() {
    this.bot = new Telegraf(config.telegram.botToken);
    this.formatter = new TelegramFormatter();
    this.seatMapService = new SeatMapService();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!config.telegram.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    try {
      // Verify bot token by getting bot info
      const botInfo = await this.bot.telegram.getMe();
      logger.info(`[Telegram] Bot initialized: @${botInfo.username}`, {
        botId: botInfo.id,
        username: botInfo.username,
      });

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Telegram bot: ${error}`);
    }
  }

  // ==========================================================================
  // Send Alert
  // ==========================================================================

  async sendAlert(payload: AlertPayload): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      await this.ensureInitialized();

      // Try to send seat map image first (if available)
      await this.sendSeatMapImage(payload);

      const message = this.formatter.formatAlert(payload);

      const result = await this.bot.telegram.sendMessage(
        payload.userId,
        message,
        {
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false,
        }
      );

      const latency = Date.now() - startTime;

      logAlertDelivery(
        'telegram',
        payload.userId,
        true,
        result.message_id.toString()
      );

      logger.info(`[Telegram] Alert sent successfully`, {
        chatId: payload.userId,
        messageId: result.message_id,
        latency,
        listingsCount: payload.listings.length,
      });

      return {
        success: true,
        channel: 'telegram',
        messageId: result.message_id.toString(),
        timestamp: new Date(),
        deliveryStatus: 'delivered',
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logAlertDelivery('telegram', payload.userId, false, undefined, errorMessage);

      logger.error(`[Telegram] Failed to send alert`, {
        chatId: payload.userId,
        error: errorMessage,
        latency,
      });

      // Handle specific Telegram errors
      const handled = this.handleTelegramError(error, payload.userId);

      return {
        success: false,
        channel: 'telegram',
        error: handled.message,
        timestamp: new Date(),
        deliveryStatus: 'failed',
      };
    }
  }

  // ==========================================================================
  // Seat Map Image Support
  // ==========================================================================

  /**
   * Send a seat map image before the text alert
   * Tries: 1) Platform API URL (Ticketmaster/SeatGeek), 2) Local highlighted map, 3) Skip
   */
  private async sendSeatMapImage(payload: AlertPayload): Promise<void> {
    try {
      // Check if we can get a seat map (from URL or local)
      if (!this.seatMapService.canGetSeatMap(payload.seatMapUrl, payload.venueName)) {
        logger.debug(`[Telegram] No seat map available for ${payload.venueName}`);
        return;
      }

      let imageBuffer: Buffer | null = null;
      let mapSource: 'api' | 'local' = 'api';

      // Strategy 1: Try to fetch from platform API URL (Ticketmaster/SeatGeek)
      if (payload.seatMapUrl) {
        imageBuffer = await this.seatMapService.fetchSeatMapFromUrl(payload.seatMapUrl);
        if (imageBuffer) {
          mapSource = 'api';
        }
      }

      // Strategy 2: Fall back to local highlighted map (if we have section coordinates)
      if (!imageBuffer && this.seatMapService.hasVenue(payload.venueName)) {
        const sections = payload.listings.slice(0, 5).map((listing, idx) => ({
          sectionName: listing.section,
          rank: idx + 1,
        }));

        imageBuffer = await this.seatMapService.generateMultiHighlightMap(
          payload.venueName,
          sections
        );
        mapSource = 'local';
      }

      if (!imageBuffer) {
        logger.debug(`[Telegram] Failed to get seat map for ${payload.venueName}`);
        return;
      }

      // Build caption with venue info
      const officialMapUrl = this.seatMapService.getOfficialMapUrl(payload.venueName);
      let caption = `🗺️ *${this.formatter.escapeMarkdown(payload.venueName)} Seat Map*\n`;

      if (mapSource === 'local') {
        caption += `_Highlighted sections show your top deals_\n\n`;
        caption += `🥇 Gold \\= \\#1 Deal  🥈 Silver \\= \\#2  🥉 Bronze \\= \\#3`;
      } else {
        caption += `_Review seating layout before purchase_`;
      }

      if (officialMapUrl) {
        caption += `\n\n[📍 View Interactive Map](${officialMapUrl})`;
      }

      // Send the image
      await this.bot.telegram.sendPhoto(
        payload.userId,
        { source: imageBuffer },
        {
          caption,
          parse_mode: 'MarkdownV2',
        }
      );

      logger.info(`[Telegram] Seat map sent for ${payload.venueName}`, {
        chatId: payload.userId,
        source: mapSource,
      });
    } catch (error) {
      // Non-fatal - log and continue with text alert
      logger.warn(`[Telegram] Failed to send seat map image`, {
        venue: payload.venueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // ==========================================================================
  // Recipient Validation
  // ==========================================================================

  async validateRecipient(chatId: string): Promise<boolean> {
    try {
      await this.ensureInitialized();

      // Try to get chat info - will fail if bot can't access the chat
      await this.bot.telegram.getChat(chatId);
      return true;
    } catch (error) {
      logger.warn(`[Telegram] Invalid recipient: ${chatId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // ==========================================================================
  // Delivery Status
  // ==========================================================================

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    // Telegram doesn't provide delivery receipts for bots
    // If sendMessage succeeded, we assume it was delivered
    return 'delivered';
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Handle Telegram-specific errors
   */
  private handleTelegramError(
    error: unknown,
    chatId: string
  ): { message: string; shouldDeactivate: boolean } {
    if (!(error instanceof Error)) {
      return { message: 'Unknown error', shouldDeactivate: false };
    }

    const message = error.message.toLowerCase();

    // User blocked the bot
    if (message.includes('forbidden') || message.includes('blocked')) {
      logger.warn(`[Telegram] User blocked bot: ${chatId}`);
      return {
        message: 'User has blocked the bot',
        shouldDeactivate: true,
      };
    }

    // Chat not found (user deleted account or never started chat)
    if (message.includes('chat not found')) {
      logger.warn(`[Telegram] Chat not found: ${chatId}`);
      return {
        message: 'Chat not found - user may have deleted account',
        shouldDeactivate: true,
      };
    }

    // Rate limited
    if (message.includes('too many requests') || message.includes('429')) {
      logger.warn(`[Telegram] Rate limited`);
      return {
        message: 'Rate limited - will retry later',
        shouldDeactivate: false,
      };
    }

    // Bad request (malformed message)
    if (message.includes('bad request') || message.includes('400')) {
      logger.error(`[Telegram] Bad request - message may be malformed`);
      return {
        message: 'Invalid message format',
        shouldDeactivate: false,
      };
    }

    return { message: error.message, shouldDeactivate: false };
  }

  /**
   * Send a simple text message (for testing)
   */
  async sendTestMessage(chatId: string, text: string): Promise<boolean> {
    try {
      await this.ensureInitialized();
      await this.bot.telegram.sendMessage(chatId, text);
      return true;
    } catch {
      return false;
    }
  }
}
