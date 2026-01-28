/**
 * SMS Notifier
 * Sends alerts via Twilio SMS API
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
import { SMSFormatter } from './sms.formatter.js';
import { logger, logAlertDelivery } from '../../utils/logger.js';
import { config } from '../../config/index.js';

// ============================================================================
// SMS Notifier Implementation
// ============================================================================

export class SMSNotifier implements INotifier {
  readonly channel: NotificationChannel = 'sms';

  private client: Twilio;
  private formatter: SMSFormatter;
  private fromNumber: string;
  private isInitialized: boolean = false;

  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    this.formatter = new SMSFormatter();
    this.fromNumber = config.twilio.phoneNumber;
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!config.twilio.accountSid || !config.twilio.authToken) {
      throw new Error('Twilio credentials not configured');
    }

    if (!config.twilio.phoneNumber) {
      throw new Error('Twilio phone number not configured');
    }

    try {
      // Verify account by fetching account info
      const account = await this.client.api.accounts(config.twilio.accountSid).fetch();

      logger.info(`[SMS] Twilio initialized`, {
        accountName: account.friendlyName,
        fromNumber: this.fromNumber,
      });

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Twilio: ${error}`);
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
      const segments = this.formatter.countSegments(message);

      logger.debug(`[SMS] Sending message`, {
        to: payload.userId,
        length: message.length,
        segments,
        estimatedCost: this.formatter.estimateCost(message),
      });

      const result: MessageInstance = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: payload.userId,
      });

      const latency = Date.now() - startTime;

      logAlertDelivery('sms', payload.userId, true, result.sid);

      logger.info(`[SMS] Alert sent successfully`, {
        to: payload.userId,
        sid: result.sid,
        status: result.status,
        latency,
        segments,
      });

      return {
        success: true,
        channel: 'sms',
        messageId: result.sid,
        timestamp: new Date(),
        deliveryStatus: this.mapTwilioStatus(result.status),
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logAlertDelivery('sms', payload.userId, false, undefined, errorMessage);

      logger.error(`[SMS] Failed to send alert`, {
        to: payload.userId,
        error: errorMessage,
        latency,
      });

      // Handle specific Twilio errors
      const handled = this.handleTwilioError(error, payload.userId);

      return {
        success: false,
        channel: 'sms',
        error: handled.message,
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

      return lookup.valid;
    } catch (error) {
      logger.warn(`[SMS] Invalid phone number: ${phoneNumber}`, {
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
      logger.error(`[SMS] Failed to get delivery status`, {
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
   * Map Twilio message status to our DeliveryStatus
   */
  private mapTwilioStatus(status: string): DeliveryStatus {
    const statusMap: Record<string, DeliveryStatus> = {
      delivered: 'delivered',
      sent: 'pending',
      sending: 'pending',
      queued: 'pending',
      accepted: 'pending',
      receiving: 'pending',
      received: 'delivered',
      failed: 'failed',
      undelivered: 'failed',
      canceled: 'failed',
    };

    return statusMap[status] || 'unknown';
  }

  /**
   * Handle Twilio-specific errors
   */
  private handleTwilioError(
    error: unknown,
    phoneNumber: string
  ): { message: string; shouldDeactivate: boolean } {
    if (!(error instanceof Error)) {
      return { message: 'Unknown error', shouldDeactivate: false };
    }

    // Extract Twilio error code if available
    const twilioError = error as { code?: number; message: string };

    switch (twilioError.code) {
      case 21211: // Invalid phone number
        logger.warn(`[SMS] Invalid phone number: ${phoneNumber}`);
        return {
          message: 'Invalid phone number format',
          shouldDeactivate: true,
        };

      case 21612: // Unsubscribed
      case 21614: // Unsubscribed
        logger.warn(`[SMS] User unsubscribed: ${phoneNumber}`);
        return {
          message: 'User has unsubscribed from SMS',
          shouldDeactivate: true,
        };

      case 30003: // Unreachable
        logger.warn(`[SMS] Phone unreachable: ${phoneNumber}`);
        return {
          message: 'Phone number is unreachable',
          shouldDeactivate: false,
        };

      case 30004: // Blocked by carrier
        logger.warn(`[SMS] Blocked by carrier: ${phoneNumber}`);
        return {
          message: 'Message blocked by carrier',
          shouldDeactivate: false,
        };

      case 30005: // Unknown destination
        logger.warn(`[SMS] Unknown destination: ${phoneNumber}`);
        return {
          message: 'Unknown phone number',
          shouldDeactivate: true,
        };

      case 30006: // Landline
        logger.warn(`[SMS] Landline number: ${phoneNumber}`);
        return {
          message: 'Cannot send SMS to landline',
          shouldDeactivate: true,
        };

      case 20003: // Authentication error
        logger.error(`[SMS] Twilio authentication failed`);
        return {
          message: 'SMS service authentication error',
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
   * Send a test SMS message
   */
  async sendTestMessage(phoneNumber: string, text: string): Promise<boolean> {
    try {
      await this.ensureInitialized();

      await this.client.messages.create({
        body: text,
        from: this.fromNumber,
        to: phoneNumber,
      });

      return true;
    } catch {
      return false;
    }
  }
}
