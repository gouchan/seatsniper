/**
 * WhatsApp Message Formatter
 * Formats alerts for WhatsApp with rich formatting support
 */

import type { AlertPayload, TopValueListing } from '../base/notifier.interface.js';

// ============================================================================
// WhatsApp Formatter
// ============================================================================

export class WhatsAppFormatter {
  /**
   * Format a full alert message for WhatsApp
   * WhatsApp supports basic formatting: *bold*, _italic_, ~strikethrough~, ```monospace```
   */
  formatAlert(payload: AlertPayload): string {
    const header = this.formatHeader(payload);
    const listings = payload.listings.slice(0, 5).map(l => this.formatListing(l)).join('\n\n');
    const footer = this.formatFooter();

    return `${header}\n\n${listings}\n\n${footer}`;
  }

  /**
   * Format the alert header
   */
  private formatHeader(payload: AlertPayload): string {
    const eventDate = this.formatDate(payload.eventDate);
    const alertIcon = this.getAlertIcon(payload.alertType);

    return (
      `${alertIcon} *SEATSNIPER ALERT*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🎫 *${payload.eventName}*\n` +
      `📍 ${payload.venueName}, ${payload.venueCity}\n` +
      `📅 ${eventDate}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔥 *TOP ${payload.listings.length} VALUE PICKS:*`
    );
  }

  /**
   * Format a single listing
   */
  private formatListing(listing: TopValueListing): string {
    const platformBadge = this.getPlatformBadge(listing.platform);
    const scoreEmoji = this.getScoreEmoji(listing.valueScore);

    return (
      `*${listing.rank}.* ${platformBadge} Section ${listing.section}, Row ${listing.row}\n` +
      `    💰 $${listing.pricePerTicket}/ticket (${listing.quantity} avail)\n` +
      `    ${scoreEmoji} Value Score: *${listing.valueScore}/100*\n` +
      `    📊 _${listing.recommendation}_\n` +
      `    🛒 ${listing.deepLink}`
    );
  }

  /**
   * Format the footer
   */
  private formatFooter(): string {
    return (
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ _Prices subject to change. Click links to purchase._\n` +
      `Reply STOP to unsubscribe`
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
      stubhub: '🟢',
      ticketmaster: '🔵',
      seatgeek: '🟠',
      vividseats: '🟣',
    };
    return badges[platform] || '⚪';
  }

  /**
   * Get score emoji based on value
   */
  private getScoreEmoji(score: number): string {
    if (score >= 85) return '🌟';
    if (score >= 70) return '✨';
    if (score >= 55) return '👍';
    return '📊';
  }

  /**
   * Format a compact message (shorter version)
   */
  formatCompact(payload: AlertPayload): string {
    const topListing = payload.listings[0];
    if (!topListing) {
      return `🎫 ${payload.eventName} - No deals found`;
    }

    const date = this.formatShortDate(payload.eventDate);

    return (
      `🎫 *${this.truncate(payload.eventName, 40)}*\n` +
      `📍 ${payload.venueName}\n` +
      `📅 ${date}\n\n` +
      `*TOP DEAL:*\n` +
      `Section ${topListing.section}, Row ${topListing.row}\n` +
      `💰 *$${topListing.pricePerTicket}* | Score: *${topListing.valueScore}*\n` +
      `🛒 ${topListing.deepLink}`
    );
  }

  /**
   * Format template message (for WhatsApp Business API templates)
   * Templates must be pre-approved by WhatsApp
   */
  formatTemplateMessage(payload: AlertPayload): {
    templateName: string;
    parameters: string[];
  } {
    const topListing = payload.listings[0];

    return {
      templateName: 'ticket_alert',
      parameters: [
        payload.eventName,
        payload.venueName,
        this.formatShortDate(payload.eventDate),
        topListing?.section || 'N/A',
        topListing?.pricePerTicket.toString() || 'N/A',
        topListing?.valueScore.toString() || 'N/A',
        topListing?.deepLink || '',
      ],
    };
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
}
