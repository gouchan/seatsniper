/**
 * Mock Notifier
 * In-memory notification channel that captures all sent alerts for assertion.
 */

import type {
  INotifier,
  NotificationChannel,
  AlertPayload,
  NotificationResult,
  DeliveryStatus,
} from '../../src/notifications/base/notifier.interface.js';

export class MockNotifier implements INotifier {
  readonly channel: NotificationChannel;

  /** All alerts that were sent (for assertions) */
  sentAlerts: AlertPayload[] = [];

  /** Configurable behavior */
  private shouldSucceed = true;
  private errorMessage = '';
  private shouldThrow = false;
  private validRecipients = new Set<string>();

  /** Call tracking */
  calls = {
    initialize: 0,
    sendAlert: 0,
    validateRecipient: 0,
    getDeliveryStatus: 0,
  };

  constructor(channel: NotificationChannel = 'telegram') {
    this.channel = channel;
  }

  // ==========================================================================
  // Configuration Helpers
  // ==========================================================================

  /** Make sendAlert succeed or fail */
  setSuccess(succeed: boolean, errorMessage: string = ''): this {
    this.shouldSucceed = succeed;
    this.errorMessage = errorMessage;
    return this;
  }

  /** Make sendAlert throw an exception */
  setThrow(shouldThrow: boolean, message: string = 'Notifier error'): this {
    this.shouldThrow = shouldThrow;
    this.errorMessage = message;
    return this;
  }

  /** Set which recipients are considered valid */
  setValidRecipients(recipientIds: string[]): this {
    this.validRecipients = new Set(recipientIds);
    return this;
  }

  /** Reset call counters and sent alerts */
  reset(): void {
    this.sentAlerts = [];
    this.calls = { initialize: 0, sendAlert: 0, validateRecipient: 0, getDeliveryStatus: 0 };
    this.shouldSucceed = true;
    this.errorMessage = '';
    this.shouldThrow = false;
  }

  // ==========================================================================
  // INotifier Implementation
  // ==========================================================================

  async initialize(): Promise<void> {
    this.calls.initialize++;
  }

  async sendAlert(payload: AlertPayload): Promise<NotificationResult> {
    this.calls.sendAlert++;
    this.sentAlerts.push(payload);

    if (this.shouldThrow) {
      throw new Error(this.errorMessage || 'Notifier threw an error');
    }

    return {
      success: this.shouldSucceed,
      channel: this.channel,
      messageId: this.shouldSucceed ? `msg-${Date.now()}` : undefined,
      error: this.shouldSucceed ? undefined : (this.errorMessage || 'Send failed'),
      timestamp: new Date(),
      deliveryStatus: this.shouldSucceed ? 'delivered' : 'failed',
    };
  }

  async validateRecipient(recipientId: string): Promise<boolean> {
    this.calls.validateRecipient++;

    if (this.validRecipients.size === 0) return true; // Default: all valid
    return this.validRecipients.has(recipientId);
  }

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    this.calls.getDeliveryStatus++;
    return this.shouldSucceed ? 'delivered' : 'failed';
  }
}
