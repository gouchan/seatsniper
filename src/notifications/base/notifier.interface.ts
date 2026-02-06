/**
 * Notifier Interface
 * Defines the contract for all notification channels (Telegram, SMS, WhatsApp)
 */

import type { Platform } from '../../adapters/base/platform-adapter.interface.js';

// ============================================================================
// Notification Channel Types
// ============================================================================

export type NotificationChannel = 'telegram' | 'sms' | 'whatsapp' | 'email';

// ============================================================================
// Alert Payload Types
// ============================================================================

export interface TopValueListing {
  rank: number;
  section: string;
  row: string;
  quantity: number;
  pricePerTicket: number;
  valueScore: number;
  recommendation: string;
  deepLink: string;
  platform: Platform;
}

export interface AlertPayload {
  /** User identifier (Telegram chat ID, phone number, etc.) */
  userId: string;

  /** Event details */
  eventName: string;
  venueName: string;
  venueCity: string;
  eventDate: Date;

  /** Top value listings to include in alert */
  listings: TopValueListing[];

  /** Type of alert */
  alertType: AlertType;

  /** Optional additional context */
  priceDropPercent?: number;
  previousPrice?: number;

  /** Seat map URL from platform API (Ticketmaster/SeatGeek) */
  seatMapUrl?: string;

  /** Cross-platform price comparison (if available) */
  crossPlatformComparison?: {
    platformsCompared: string[];
    sections: Array<{
      section: string;
      prices: Array<{ platform: string; price: number; url: string }>;
      bestDeal: { platform: string; price: number; savings: number } | null;
    }>;
    overallBestDeal: { section: string; platform: string; price: number; url: string } | null;
  };
}

export enum AlertType {
  /** New listing matches user criteria */
  NEW_LISTING = 'new_listing',

  /** Existing listing dropped in price */
  PRICE_DROP = 'price_drop',

  /** Exceptional value score detected */
  HIGH_VALUE = 'high_value',

  /** Periodic digest of top picks */
  DAILY_DIGEST = 'daily_digest',
}

// ============================================================================
// Notification Result Types
// ============================================================================

export type DeliveryStatus = 'delivered' | 'pending' | 'failed' | 'unknown';

export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  messageId?: string;
  error?: string;
  timestamp: Date;
  deliveryStatus: DeliveryStatus;
}

// ============================================================================
// Notifier Interface
// ============================================================================

export interface INotifier {
  /** The notification channel this notifier handles */
  readonly channel: NotificationChannel;

  /**
   * Initialize the notifier (connect to service, validate credentials)
   * @throws Error if initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Send an alert to a user
   * @param payload The alert content and recipient
   * @returns Result including success status and message ID
   */
  sendAlert(payload: AlertPayload): Promise<NotificationResult>;

  /**
   * Validate that a recipient identifier is valid
   * @param recipientId User identifier (chat ID, phone number, etc.)
   * @returns True if the recipient is valid and reachable
   */
  validateRecipient(recipientId: string): Promise<boolean>;

  /**
   * Check the delivery status of a sent message
   * @param messageId The message ID returned from sendAlert
   * @returns Current delivery status
   */
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
}
