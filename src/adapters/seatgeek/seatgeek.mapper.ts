/**
 * SeatGeek Data Mapper
 * Transforms SeatGeek API responses to normalized types
 */

import {
  EventCategory,
  type NormalizedEvent,
  type NormalizedListing,
  type DeliveryType,
} from '../base/platform-adapter.interface.js';
import type {
  SeatGeekEvent,
  SeatGeekListing,
  SeatGeekTaxonomy,
} from './seatgeek.types.js';
import { generateDeepLink } from '../../utils/deep-link-generator.js';

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * Map SeatGeek event to normalized event format
 */
export function mapToNormalizedEvent(event: SeatGeekEvent): NormalizedEvent {
  // Extract price range from SeatGeek stats (comes free with every event search)
  // Only populate if real listings exist (lowest_price > 0)
  const priceRange =
    event.stats?.lowest_price > 0 && event.stats?.highest_price > 0
      ? {
          min: event.stats.lowest_price,
          max: event.stats.highest_price,
          currency: 'USD',
        }
      : undefined;

  return {
    platformId: event.id.toString(),
    platform: 'seatgeek',
    name: event.title,
    venue: {
      id: event.venue.id.toString(),
      name: event.venue.name,
      city: event.venue.city,
      state: event.venue.state,
    },
    dateTime: new Date(event.datetime_utc),
    category: mapCategory(event.taxonomies),
    url: event.url,
    imageUrl: selectBestImage(event.performers),
    seatMapUrl: event.venue.seating_chart_url_large || event.venue.seating_chart_url,
    priceRange,
  };
}

/**
 * Map SeatGeek taxonomy to normalized category
 */
function mapCategory(taxonomies?: SeatGeekTaxonomy[]): EventCategory {
  if (!taxonomies?.length) {
    return EventCategory.CONCERTS;
  }

  const names = taxonomies.map(t => t.name.toLowerCase());

  if (names.some(n => n.includes('concert') || n.includes('music'))) {
    return EventCategory.CONCERTS;
  }
  if (names.some(n => n.includes('sports') || n.includes('nba') ||
      n.includes('nfl') || n.includes('mlb') || n.includes('nhl') ||
      n.includes('mls') || n.includes('soccer'))) {
    return EventCategory.SPORTS;
  }
  if (names.some(n => n.includes('theater') || n.includes('theatre') ||
      n.includes('broadway') || n.includes('musical'))) {
    return EventCategory.THEATER;
  }
  if (names.some(n => n.includes('comedy'))) {
    return EventCategory.COMEDY;
  }
  if (names.some(n => n.includes('festival'))) {
    return EventCategory.FESTIVALS;
  }

  return EventCategory.CONCERTS;
}

/**
 * Select best performer image
 */
function selectBestImage(performers?: SeatGeekEvent['performers']): string | undefined {
  if (!performers?.length) return undefined;

  const primary = performers.find(p => p.primary) || performers[0];

  // Prefer larger images
  return primary.images?.huge ||
         primary.images?.large ||
         primary.images?.medium ||
         primary.image;
}

// ============================================================================
// Listing Mapping
// ============================================================================

/**
 * Map SeatGeek listing to normalized listing format
 */
export function mapToNormalizedListing(
  listing: SeatGeekListing,
  eventId: string
): NormalizedListing {
  return {
    platformListingId: listing.id.toString(),
    platform: 'seatgeek',
    eventId,
    section: listing.section || 'General Admission',
    row: listing.row || '',
    seatNumbers: listing.seat_numbers,
    quantity: listing.quantity,
    pricePerTicket: listing.display_price,
    totalPrice: listing.display_price * listing.quantity,
    fees: 0, // SeatGeek includes fees in display_price
    deliveryType: mapDeliveryType(listing),
    sellerRating: undefined, // SeatGeek doesn't expose seller ratings
    deepLink: generateDeepLink({
      platform: 'seatgeek',
      eventId,
      listingId: listing.id.toString(),
    }),
    capturedAt: new Date(),
  };
}

/**
 * Map SeatGeek delivery type
 */
function mapDeliveryType(listing: SeatGeekListing): DeliveryType {
  if (listing.instant_delivery) {
    return 'instant';
  }

  const types = listing.delivery_type?.map(t => t.toLowerCase()) || [];

  if (types.some(t => t.includes('electronic') || t.includes('mobile'))) {
    return 'electronic';
  }
  if (types.some(t => t.includes('will call'))) {
    return 'willcall';
  }
  if (types.some(t => t.includes('fedex') || t.includes('ups') || t.includes('mail'))) {
    return 'physical';
  }

  return 'electronic';
}

// ============================================================================
// Batch Mapping
// ============================================================================

/**
 * Map array of SeatGeek events to normalized events
 */
export function mapEventsToNormalized(events: SeatGeekEvent[]): NormalizedEvent[] {
  return events.map(mapToNormalizedEvent);
}

/**
 * Map array of SeatGeek listings to normalized listings
 */
export function mapListingsToNormalized(
  listings: SeatGeekListing[],
  eventId: string
): NormalizedListing[] {
  return listings.map(listing => mapToNormalizedListing(listing, eventId));
}
