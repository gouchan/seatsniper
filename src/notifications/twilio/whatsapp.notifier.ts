/**
 * WhatsApp Notifier
 * Sends alerts via Twilio WhatsApp Business API
 */

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import type { MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';
import type {
  INotifier,
  AlertPayload,
  NotificationResult,
  NotificationChannel,
  DeliveryStatus,
} from '../base/notifier.interface.js';
import { WhatsAppFormatter } from './whatsapp.formatter.js';
import { logger, logAlertDelivery } from '../../utils/logger.js';
import { config } from '../../config/index.js';

// ============================================================================
// WhatsApp Notifier Implementation
// ============================================================================

export class WhatsAppNotifier implements INotifier {
  readonly channel: NotificationChannel = 'whatsapp';

  private client: Twilio;
  private formatter: WhatsAppFormatter;
  private fromNumber: string;
  private isInitialized: boolean = false;

  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    this.formatter = new WhatsAppFormatter();
    // WhatsApp numbers must be prefixed with 'whatsapp:'
    this.fromNumber = `whatsapp:${config.twilio.whatsappNumber || config.twilio.phoneNumber}`;
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!config.twilio.accountSid || !config.twilio.authToken) {
      throw new Error('Twilio credentials not configured');
    }

    const whatsappNumber = config.twilio.whatsappNumber || config.twilio.phoneNumber;
    if (!whatsappNumber) {
      throw new Error('Twilio WhatsApp number not configured');
    }

    try {
      // Verify account
      const account = await this.client.api.accounts(config.twilio.accountSid).fetch();

      logger.info(`[WhatsApp] Twilio WhatsApp initialized`, {
        accountName: account.friendlyName,
        fromNumber: this.fromNumber,
      });

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Twilio WhatsApp: ${error}`);
    }
  }

  // ==========================================================================
  // Send Alert
  // ==========================================================================

  async sendAlert(payload: AlertPayload): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      await this.ensureInitialized();

      const message = this.formatter.formatAlert(payload);

      // Format recipient with whatsapp: prefix
      const toNumber = this.formatWhatsAppNumber(payload.userId);

      logger.debug(`[WhatsApp] Sending message`, {
        to: toNumber,
        length: message.length,
      });

      const result: MessageInstance = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: toNumber,
      });

      const latency = Date.now() - startTime;

      logAlertDelivery('whatsapp', payload.userId, true, result.sid);

      logger.info(`[WhatsApp] Alert sent successfully`, {
        to: payload.userId,
        sid: result.sid,
        status: result.status,
        latency,
      });

      return {
        success: true,
        channel: 'whatsapp',
        messageId: result.sid,
        timestamp: new Date(),
        deliveryStatus: this.mapTwilioStatus(result.status),
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logAlertDelivery('whatsapp', payload.userId, false, undefined, errorMessage);

      logger.error(`[WhatsApp] Failed to send alert`, {
        to: payload.userId,
        error: errorMessage,
        latency,
      });

      const handled = this.handleWhatsAppError(error, payload.userId);

      return {
        success: false,
        channel: 'whatsapp',
        error: handled.message,
        timestamp: new Date(),
        deliveryStatus: 'failed',
      };
    }
  }

  // ==========================================================================
  // Template Messages (for WhatsApp Business API)
  // ==========================================================================

  /**
   * Send a pre-approved template message
   * Required for initiating conversations with users who haven't messaged first
   */
  async sendTemplateMessage(
    userId: string,
    templateSid: string,
    parameters: Record<string, string>
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      await this.ensureInitialized();

      const toNumber = this.formatWhatsAppNumber(userId);

      // Build content variables for template
      const contentVariables = JSON.stringify(parameters);

      const result = await this.client.messages.create({
        from: this.fromNumber,
        to: toNumber,
        contentSid: templateSid,
        contentVariables,
      });

      const latency = Date.now() - startTime;

      logger.info(`[WhatsApp] Template message sent`, {
        to: userId,
        sid: result.sid,
        templateSid,
        latency,
      });

      return {
        success: true,
        channel: 'whatsapp',
        messageId: result.sid,
        timestamp: new Date(),
        deliveryStatus: this.mapTwilioStatus(result.status),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`[WhatsApp] Failed to send template message`, {
        to: userId,
        error: errorMessage,
      });

      return {
        success: false,
        channel: 'whatsapp',
        error: errorMessage,
        timestamp: new Date(),
        deliveryStatus: 'failed',
      };
    }
  }

  // ==========================================================================
  // Recipient Validation
  // ==========================================================================

  async validateRecipient(phoneNumber: string): Promise<boolean> {
    try {
      await this.ensureInitialized();

      // Use Twilio Lookup API to validate phone number
      const lookup = await this.client.lookups.v2
        .phoneNumbers(phoneNumber)
        .fetch();

      // WhatsApp requires mobile numbers
      if (!lookup.valid) return false;

      // Could additionally check if WhatsApp is available on this number
      // using carrier info, but that requires additional API access

      return true;
    } catch (error) {
      logger.warn(`[WhatsApp] Invalid phone number: ${phoneNumber}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // ==========================================================================
  // Delivery Status
  // ==========================================================================

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      await this.ensureInitialized();

      const message = await this.client.messages(messageId).fetch();
      return this.mapTwilioStatus(message.status);
    } catch (error) {
      logger.error(`[WhatsApp] Failed to get delivery status`, {
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 'unknown';
    }
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
   * Format phone number with whatsapp: prefix
   */
  private formatWhatsAppNumber(phoneNumber: string): string {
    // Remove any existing whatsapp: prefix
    const cleaned = phoneNumber.replace(/^whatsapp:/, '');

    // Ensure E.164 format (starts with +)
    const formatted = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;

    return `whatsapp:${formatted}`;
  }

  /**
   * Map Twilio message status to our DeliveryStatus
   */
  private mapTwilioStatus(status: string): DeliveryStatus {
    const statusMap: Record<string, DeliveryStatus> = {
      delivered: 'delivered',
      read: 'delivered',
      sent: 'pending',
      sending: 'pending',
      queued: 'pending',
      accepted: 'pending',
      failed: 'failed',
      undelivered: 'failed',
      canceled: 'failed',
    };

    return statusMap[status] || 'unknown';
  }

  /**
   * Handle WhatsApp-specific errors
   */
  private handleWhatsAppError(
    error: unknown,
    phoneNumber: string
  ): { message: string; shouldDeactivate: boolean } {
    if (!(error instanceof Error)) {
      return { message: 'Unknown error', shouldDeactivate: false };
    }

    const twilioError = error as { code?: number; message: string };

    switch (twilioError.code) {
      case 21211: // Invalid phone number
        logger.warn(`[WhatsApp] Invalid phone number: ${phoneNumber}`);
        return {
          message: 'Invalid phone number format',
          shouldDeactivate: true,
        };

      case 21408: // Permission denied (user hasn't opted in)
        logger.warn(`[WhatsApp] User not opted in: ${phoneNumber}`);
        return {
          message: 'User has not opted in to receive WhatsApp messages',
          shouldDeactivate: false,
        };

      case 21610: // Unsubscribed
        logger.warn(`[WhatsApp] User unsubscribed: ${phoneNumber}`);
        return {
          message: 'User has unsubscribed from WhatsApp messages',
          shouldDeactivate: true,
        };

      case 63001: // Channel not found
        logger.error(`[WhatsApp] WhatsApp channel not configured`);
        return {
          message: 'WhatsApp channel not properly configured',
          shouldDeactivate: false,
        };

      case 63003: // Outside of message window
        logger.warn(`[WhatsApp] Outside 24-hour window: ${phoneNumber}`);
        return {
          message: 'Outside 24-hour messaging window - use template message',
          shouldDeactivate: false,
        };

      case 63007: // Template not found
        logger.error(`[WhatsApp] Message template not found`);
        return {
          message: 'WhatsApp message template not found',
          shouldDeactivate: false,
        };

      case 63016: // Message failed to send
        return {
          message: 'WhatsApp message failed to send',
          shouldDeactivate: false,
        };

      default:
        return {
          message: twilioError.message,
          shouldDeactivate: false,
        };
    }
  }

  /**
   * Send a test WhatsApp message
   */
  async sendTestMessage(phoneNumber: string, text: string): Promise<boolean> {
    try {
      await this.ensureInitialized();

      const toNumber = this.formatWhatsAppNumber(phoneNumber);

      await this.client.messages.create({
        body: text,
        from: this.fromNumber,
        to: toNumber,
      });

      return true;
    } catch {
      return false;
    }
  }
}
