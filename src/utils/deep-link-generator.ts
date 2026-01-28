/**
 * Deep Link Generator
 * Generates platform-specific purchase links for ticket listings
 */

import type { Platform } from '../adapters/base/platform-adapter.interface.js';

interface DeepLinkParams {
  platform: Platform;
  eventId: string;
  listingId: string;
  quantity?: number;
}

/**
 * Generate a deep link to the purchase page for a listing
 */
export function generateDeepLink(params: DeepLinkParams): string {
  const { platform, eventId, listingId, quantity } = params;

  switch (platform) {
    case 'stubhub':
      return generateStubHubLink(eventId, listingId, quantity);

    case 'ticketmaster':
      return generateTicketmasterLink(eventId, listingId);

    case 'seatgeek':
      return generateSeatGeekLink(eventId, listingId);

    case 'vividseats':
      return generateVividSeatsLink(eventId, listingId);

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * StubHub deep link
 * Format: https://www.stubhub.com/event/{eventId}/?ticket={listingId}&qty={quantity}
 */
function generateStubHubLink(eventId: string, listingId: string, quantity?: number): string {
  const baseUrl = `https://www.stubhub.com/event/${eventId}/`;
  const params = new URLSearchParams({
    ticket: listingId,
  });

  if (quantity) {
    params.set('qty', quantity.toString());
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Ticketmaster deep link
 * Format: https://www.ticketmaster.com/event/{eventId}?listingId={listingId}
 */
function generateTicketmasterLink(eventId: string, listingId: string): string {
  const baseUrl = `https://www.ticketmaster.com/event/${eventId}`;
  const params = new URLSearchParams({
    listingId,
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * SeatGeek deep link
 * Format: https://seatgeek.com/checkout/{eventId}/{listingId}
 */
function generateSeatGeekLink(eventId: string, listingId: string): string {
  return `https://seatgeek.com/checkout/${eventId}/${listingId}`;
}

/**
 * Vivid Seats deep link
 * Format: https://www.vividseats.com/checkout?productionId={eventId}&ticketId={listingId}
 */
function generateVividSeatsLink(eventId: string, listingId: string): string {
  const params = new URLSearchParams({
    productionId: eventId,
    ticketId: listingId,
  });

  return `https://www.vividseats.com/checkout?${params.toString()}`;
}

/**
 * Validate that a deep link is properly formatted
 */
export function validateDeepLink(link: string): boolean {
  try {
    const url = new URL(link);
    const validHosts = [
      'www.stubhub.com',
      'stubhub.com',
      'www.ticketmaster.com',
      'ticketmaster.com',
      'seatgeek.com',
      'www.seatgeek.com',
      'www.vividseats.com',
      'vividseats.com',
    ];

    return validHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Extract platform from a deep link URL
 */
export function extractPlatformFromLink(link: string): Platform | null {
  try {
    const url = new URL(link);
    const host = url.hostname.replace('www.', '');

    if (host.includes('stubhub')) return 'stubhub';
    if (host.includes('ticketmaster')) return 'ticketmaster';
    if (host.includes('seatgeek')) return 'seatgeek';
    if (host.includes('vividseats')) return 'vividseats';

    return null;
  } catch {
    return null;
  }
}
