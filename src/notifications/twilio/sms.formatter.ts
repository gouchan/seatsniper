/**
 * SMS Message Formatter
 * Formats alerts for SMS with character limits in mind
 */

import type { AlertPayload, TopValueListing } from '../base/notifier.interface.js';

// ============================================================================
// Constants
// ============================================================================

// Single SMS segment = 160 chars (used in countSegments() method)
const MAX_TOTAL_LENGTH = 1600; // Maximum total for multi-segment SMS

// ============================================================================
// SMS Formatter
// ============================================================================

export class SMSFormatter {
  /**
   * Format a full alert message for SMS
   * Optimized for brevity while maintaining key info
   */
  formatAlert(payload: AlertPayload): string {
    const header = this.formatHeader(payload);
    const topListings = payload.listings.slice(0, 3); // Max 3 listings for SMS
    const listings = topListings.map((l, i) => this.formatListing(l, i + 1)).join('\n');
    const footer = this.formatFooter();

    const fullMessage = `${header}\n\n${listings}\n\n${footer}`;

    // Truncate if too long
    if (fullMessage.length > MAX_TOTAL_LENGTH) {
      return this.formatCompact(payload);
    }

    return fullMessage;
  }

  /**
   * Format compact header
   */
  private formatHeader(payload: AlertPayload): string {
    const date = this.formatShortDate(payload.eventDate);

    return (
      `🎫 ${this.truncate(payload.eventName, 40)}\n` +
      `📍 ${payload.venueName}\n` +
      `📅 ${date}`
    );
  }

  /**
   * Format a single listing (compact)
   */
  private formatListing(listing: TopValueListing, rank: number): string {
    return (
      `${rank}. Sec ${listing.section} Row ${listing.row}\n` +
      `   $${listing.pricePerTicket}/ea | Score: ${listing.valueScore}\n` +
      `   ${listing.deepLink}`
    );
  }

  /**
   * Format footer
   */
  private formatFooter(): string {
    return 'Reply STOP to unsubscribe';
  }

  /**
   * Format very compact message (single SMS if possible)
   */
  formatCompact(payload: AlertPayload): string {
    const topListing = payload.listings[0];
    if (!topListing) {
      return `🎫 ${payload.eventName} - No deals found`;
    }

    const date = this.formatShortDate(payload.eventDate);

    return (
      `🎫 ${this.truncate(payload.eventName, 30)}\n` +
      `${date} @ ${payload.venueName}\n\n` +
      `TOP: Sec ${topListing.section} $${topListing.pricePerTicket} (Score: ${topListing.valueScore})\n` +
      `${topListing.deepLink}\n\n` +
      `STOP to unsub`
    );
  }

  /**
   * Format just the essentials (minimal SMS)
   */
  formatMinimal(payload: AlertPayload): string {
    const topListing = payload.listings[0];
    if (!topListing) return '';

    return (
      `${this.truncate(payload.eventName, 25)} - ` +
      `$${topListing.pricePerTicket} Sec ${topListing.section} Score:${topListing.valueScore} ` +
      `${topListing.deepLink}`
    );
  }

  /**
   * Format date compactly
   */
  private formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /**
   * Truncate text with ellipsis
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Count SMS segments for a message
   */
  countSegments(message: string): number {
    // GSM-7 encoding: 160 chars per segment, or 153 for multi-segment
    // Unicode: 70 chars per segment, or 67 for multi-segment
    const hasUnicode = /[^\x00-\x7F]/.test(message);

    if (hasUnicode) {
      if (message.length <= 70) return 1;
      return Math.ceil(message.length / 67);
    } else {
      if (message.length <= 160) return 1;
      return Math.ceil(message.length / 153);
    }
  }

  /**
   * Estimate cost for sending this message
   * Based on Twilio rates (~$0.0075 per segment)
   */
  estimateCost(message: string, ratePerSegment: number = 0.0075): number {
    const segments = this.countSegments(message);
    return segments * ratePerSegment;
  }
}
