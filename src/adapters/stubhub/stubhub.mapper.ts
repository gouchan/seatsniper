/**
 * StubHub Data Mapper
 * Transforms StubHub API responses to normalized types
 */

import {
  EventCategory,
  type NormalizedEvent,
  type NormalizedListing,
  type DeliveryType,
} from '../base/platform-adapter.interface.js';
import type { StubHubEvent, StubHubListing } from './stubhub.types.js';
import { generateDeepLink } from '../../utils/deep-link-generator.js';

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * Map StubHub event to normalized event format
 */
export function mapToNormalizedEvent(event: StubHubEvent): NormalizedEvent {
  return {
    platformId: event.id.toString(),
    platform: 'stubhub',
    name: event.name,
    venue: {
      id: event.venue.id.toString(),
      name: event.venue.name,
      city: event.venue.city,
      state: event.venue.state,
    },
    dateTime: new Date(event.eventDateUTC),
    category: mapCategory(event.ancestors),
    url: `https://www.stubhub.com${event.webURI}`,
    imageUrl: event.imageUrl,
  };
}

/**
 * Map StubHub category ancestors to normalized category
 */
function mapCategory(ancestors?: StubHubEvent['ancestors']): EventCategory {
  if (!ancestors?.categories?.length) {
    return EventCategory.CONCERTS; // Default
  }

  const categoryName = ancestors.categories[0].name.toLowerCase();

  if (categoryName.includes('concert') || categoryName.includes('music')) {
    return EventCategory.CONCERTS;
  }
  if (categoryName.includes('sport') || categoryName.includes('basketball') ||
      categoryName.includes('football') || categoryName.includes('baseball') ||
      categoryName.includes('hockey') || categoryName.includes('soccer')) {
    return EventCategory.SPORTS;
  }
  if (categoryName.includes('theater') || categoryName.includes('theatre') ||
      categoryName.includes('broadway') || categoryName.includes('musical')) {
    return EventCategory.THEATER;
  }
  if (categoryName.includes('comedy') || categoryName.includes('standup')) {
    return EventCategory.COMEDY;
  }
  if (categoryName.includes('festival')) {
    return EventCategory.FESTIVALS;
  }

  return EventCategory.CONCERTS; // Default fallback
}

// ============================================================================
// Listing Mapping
// ============================================================================

/**
 * Map StubHub listing to normalized listing format
 */
export function mapToNormalizedListing(
  listing: StubHubListing,
  eventId: string
): NormalizedListing {
  const section = listing.sectionName || listing.sellerSectionName || 'Unknown';
  const row = listing.row || '';
  const seatNumbers = parseSeatNumbers(listing.seatNumbers);

  // Calculate total price (StubHub currentPrice is per ticket including fees)
  const pricePerTicket = listing.currentPrice.amount;
  const totalPrice = pricePerTicket * listing.quantity;

  // Calculate fees (difference between currentPrice and listingPrice if available)
  const fees = listing.listingPrice
    ? (pricePerTicket - listing.listingPrice.amount) * listing.quantity
    : 0;

  return {
    platformListingId: listing.listingId.toString(),
    platform: 'stubhub',
    eventId,
    section,
    row,
    seatNumbers,
    quantity: listing.quantity,
    pricePerTicket,
    totalPrice,
    fees: Math.max(0, fees),
    deliveryType: mapDeliveryType(listing.deliveryTypeList),
    sellerRating: listing.sellerRating?.rating,
    deepLink: generateDeepLink({
      platform: 'stubhub',
      eventId,
      listingId: listing.listingId.toString(),
      quantity: listing.quantity,
    }),
    capturedAt: new Date(),
  };
}

/**
 * Parse seat numbers from StubHub format
 * StubHub returns seat numbers as a comma-separated string like "1,2,3"
 */
function parseSeatNumbers(seatStr?: string): string[] | undefined {
  if (!seatStr) return undefined;

  return seatStr
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Map StubHub delivery types to normalized delivery type
 */
function mapDeliveryType(deliveryTypes: string[]): DeliveryType {
  const types = deliveryTypes.map(t => t.toLowerCase());

  if (types.includes('instant') || types.includes('instant download')) {
    return 'instant';
  }
  if (types.includes('electronic') || types.includes('mobile') ||
      types.includes('mobile ticket') || types.includes('barcode')) {
    return 'electronic';
  }
  if (types.includes('willcall') || types.includes('will call')) {
    return 'willcall';
  }
  if (types.includes('ups') || types.includes('fedex') || types.includes('mail')) {
    return 'physical';
  }

  return 'electronic'; // Default
}

// ============================================================================
// Batch Mapping
// ============================================================================

/**
 * Map array of StubHub events to normalized events
 */
export function mapEventsToNormalized(events: StubHubEvent[]): NormalizedEvent[] {
  return events.map(mapToNormalizedEvent);
}

/**
 * Map array of StubHub listings to normalized listings
 */
export function mapListingsToNormalized(
  listings: StubHubListing[],
  eventId: string
): NormalizedListing[] {
  return listings.map(listing => mapToNormalizedListing(listing, eventId));
}
