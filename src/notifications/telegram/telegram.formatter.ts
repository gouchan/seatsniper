/**
 * Telegram Message Formatter
 * Formats alerts for Telegram using MarkdownV2
 */

import type { AlertPayload, TopValueListing } from '../base/notifier.interface.js';

// ============================================================================
// Telegram Formatter
// ============================================================================

export class TelegramFormatter {
  /**
   * Format a full alert message for Telegram
   */
  formatAlert(payload: AlertPayload): string {
    const header = this.formatHeader(payload);
    const listings = payload.listings.map(l => this.formatListing(l)).join('\n\n');
    const footer = this.formatFooter();

    return `${header}\n\n${listings}${footer}`;
  }

  /**
   * Format the alert header
   */
  private formatHeader(payload: AlertPayload): string {
    const eventDate = this.formatDate(payload.eventDate);
    const alertIcon = this.getAlertIcon(payload.alertType);

    return this.escapeMarkdown(
      `${alertIcon} SEATSNIPER ALERT\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎫 ${payload.eventName}\n` +
      `📍 ${payload.venueName}, ${payload.venueCity}\n` +
      `📅 ${eventDate}\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 TOP ${payload.listings.length} VALUE PICKS:`
    );
  }

  /**
   * Format a single listing
   */
  private formatListing(listing: TopValueListing): string {
    const platformBadge = this.getPlatformBadge(listing.platform);
    const scoreEmoji = this.getScoreEmoji(listing.valueScore);

    const details = this.escapeMarkdown(
      `${listing.rank}. ${platformBadge} Section ${listing.section}, Row ${listing.row}\n` +
      `   💰 $${listing.pricePerTicket}/ticket (${listing.quantity} avail)\n` +
      `   ${scoreEmoji} Value Score: ${listing.valueScore}/100\n` +
      `   📊 ${listing.recommendation}`
    );

    // Deep link is not escaped - Telegram handles URLs specially in []() syntax
    const buyLink = `   [🛒 Buy Now](${listing.deepLink})`;

    return details + '\n' + buyLink;
  }

  /**
   * Format the footer
   */
  private formatFooter(): string {
    return '\n\n' + this.escapeMarkdown(
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      '⚠️ Prices subject to change. Click links to purchase.'
    );
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /**
   * Get alert icon based on type
   */
  private getAlertIcon(alertType: string): string {
    const icons: Record<string, string> = {
      new_listing: '🆕',
      price_drop: '📉',
      high_value: '🎯',
      daily_digest: '📋',
    };
    return icons[alertType] || '🎫';
  }

  /**
   * Get platform badge emoji
   */
  private getPlatformBadge(platform: string): string {
    const badges: Record<string, string> = {
      stubhub: '🟢',      // Green for StubHub
      ticketmaster: '🔵', // Blue for Ticketmaster
      seatgeek: '🟠',     // Orange for SeatGeek
      vividseats: '🟣',   // Purple for Vivid Seats
    };
    return badges[platform] || '⚪';
  }

  /**
   * Get score emoji based on value
   */
  private getScoreEmoji(score: number): string {
    if (score >= 85) return '🌟';  // Excellent
    if (score >= 70) return '✨';  // Good
    if (score >= 55) return '👍';  // Fair
    return '📊';                   // Below average
  }

  /**
   * Escape special characters for MarkdownV2
   * Characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
   *
   * IMPORTANT: Only call this ONCE on raw text. Never pre-escape
   * characters before passing to this function or they'll be double-escaped.
   */
  escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  }

  /**
   * Format a compact message (for SMS-like brevity)
   */
  formatCompact(payload: AlertPayload): string {
    const topListing = payload.listings[0];
    if (!topListing) return '';

    return this.escapeMarkdown(
      `🎫 ${payload.eventName}\n` +
      `📍 ${payload.venueName}\n` +
      `💰 $${topListing.pricePerTicket} | Score: ${topListing.valueScore}\n`
    ) + `[Buy](${topListing.deepLink})`;
  }
}
