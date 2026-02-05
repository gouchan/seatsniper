/**
 * Ticketmaster Data Mapper
 * Transforms Ticketmaster API responses to normalized types
 */

import {
  EventCategory,
  type NormalizedEvent,
  type NormalizedListing,
  type DeliveryType,
} from '../base/platform-adapter.interface.js';
import type {
  TicketmasterEvent,
  TicketmasterOffer,
  TicketmasterClassification,
  TopPicksListing,
} from './ticketmaster.types.js';
import { generateDeepLink } from '../../utils/deep-link-generator.js';

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * Map Ticketmaster event to normalized event format
 */
export function mapToNormalizedEvent(event: TicketmasterEvent): NormalizedEvent {
  const venue = event._embedded?.venues?.[0];

  // Parse datetime - prefer dateTime, fallback to localDate + localTime
  let eventDateTime: Date;
  if (event.dates.start.dateTime) {
    eventDateTime = new Date(event.dates.start.dateTime);
  } else {
    const dateStr = event.dates.start.localDate;
    const timeStr = event.dates.start.localTime || '19:00:00';
    eventDateTime = new Date(`${dateStr}T${timeStr}`);
  }

  // Extract price range (Ticketmaster provides min/max for most events)
  const priceInfo = event.priceRanges?.[0];
  const priceRange = priceInfo
    ? { min: priceInfo.min, max: priceInfo.max, currency: priceInfo.currency || 'USD' }
    : undefined;

  return {
    platformId: event.id,
    platform: 'ticketmaster',
    name: event.name,
    venue: {
      id: venue?.id || 'unknown',
      name: venue?.name || 'Unknown Venue',
      city: venue?.city?.name || 'Unknown',
      state: venue?.state?.stateCode || 'XX',
    },
    dateTime: eventDateTime,
    category: mapCategory(event.classifications),
    url: event.url,
    imageUrl: selectBestImage(event.images),
    seatMapUrl: event.seatmap?.staticUrl,
    priceRange,
  };
}

/**
 * Map Ticketmaster classification to normalized category
 */
function mapCategory(
  classifications?: TicketmasterClassification[]
): EventCategory {
  if (!classifications?.length) {
    return EventCategory.CONCERTS; // Default
  }

  const primary = classifications.find(c => c.primary) || classifications[0];
  const segmentName = primary.segment?.name?.toLowerCase() || '';
  const genreName = primary.genre?.name?.toLowerCase() || '';

  if (segmentName === 'music' || genreName.includes('rock') ||
      genreName.includes('pop') || genreName.includes('hip-hop')) {
    return EventCategory.CONCERTS;
  }
  if (segmentName === 'sports') {
    return EventCategory.SPORTS;
  }
  if (segmentName === 'arts & theatre' || genreName.includes('theatre') ||
      genreName.includes('broadway') || genreName.includes('musical')) {
    return EventCategory.THEATER;
  }
  if (genreName.includes('comedy')) {
    return EventCategory.COMEDY;
  }
  if (genreName.includes('festival') || segmentName.includes('festival')) {
    return EventCategory.FESTIVALS;
  }

  return EventCategory.CONCERTS; // Default fallback
}

/**
 * Select the best quality image from available images
 */
function selectBestImage(images?: TicketmasterEvent['images']): string | undefined {
  if (!images?.length) return undefined;

  // Prefer 16_9 ratio, then largest by width
  const preferred = images.find(
    img => img.ratio === '16_9' && (img.width || 0) >= 640
  );

  if (preferred) return preferred.url;

  // Sort by width descending and return largest
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url;
}

// ============================================================================
// Listing/Offer Mapping
// ============================================================================

/**
 * Map Ticketmaster offer to normalized listing format
 * Note: Ticketmaster offers structure varies between primary and resale
 */
export function mapToNormalizedListing(
  offer: TicketmasterOffer,
  eventId: string
): NormalizedListing {
  // Parse section/row from offer
  const section = offer.section || offer.area?.name || 'Unknown';
  const row = offer.row || '';
  const seatNumbers = offer.seats;

  // Calculate prices
  const totalPrice = offer.prices?.find(p => p.type === 'total');
  const facePrice = offer.prices?.find(p => p.type === 'face');
  const feePrice = offer.prices?.find(p => p.type === 'fee');

  const quantity = offer.quantity?.total || 1;
  const pricePerTicket = totalPrice
    ? totalPrice.value / quantity
    : facePrice?.value || 0;

  return {
    platformListingId: offer.id,
    platform: 'ticketmaster',
    eventId,
    section,
    row,
    seatNumbers,
    quantity,
    pricePerTicket,
    totalPrice: totalPrice?.value || pricePerTicket * quantity,
    fees: feePrice?.value || 0,
    deliveryType: mapDeliveryType(offer.deliveryMethods),
    sellerRating: undefined, // Ticketmaster doesn't provide seller ratings
    deepLink: generateDeepLink({
      platform: 'ticketmaster',
      eventId,
      listingId: offer.id,
    }),
    capturedAt: new Date(),
  };
}

/**
 * Map Ticketmaster delivery methods to normalized delivery type
 */
function mapDeliveryType(
  methods?: Array<{ type: string; name: string }>
): DeliveryType {
  if (!methods?.length) return 'electronic';

  const types = methods.map(m => m.type.toLowerCase());

  if (types.some(t => t.includes('instant') || t.includes('mobile'))) {
    return 'instant';
  }
  if (types.some(t => t.includes('electronic') || t.includes('digital'))) {
    return 'electronic';
  }
  if (types.some(t => t.includes('willcall') || t.includes('will call'))) {
    return 'willcall';
  }
  if (types.some(t => t.includes('mail') || t.includes('ship'))) {
    return 'physical';
  }

  return 'electronic'; // Default
}

// ============================================================================
// Batch Mapping
// ============================================================================

/**
 * Map array of Ticketmaster events to normalized events
 */
export function mapEventsToNormalized(
  events: TicketmasterEvent[]
): NormalizedEvent[] {
  return events.map(mapToNormalizedEvent);
}

/**
 * Map array of Ticketmaster offers to normalized listings
 * Filters to resale offers only (primary sales are not what we track)
 */
export function mapOffersToNormalized(
  offers: TicketmasterOffer[],
  eventId: string
): NormalizedListing[] {
  return offers
    .filter(offer => offer.type === 'resale')
    .map(offer => mapToNormalizedListing(offer, eventId));
}

// ============================================================================
// Top Picks Mapping
// ============================================================================

/**
 * Map Top Picks listings to normalized listing format
 * Top Picks API returns individual ticket listings with full pricing breakdown
 */
export function mapTopPicksToNormalized(
  picks: TopPicksListing[],
  eventId: string
): NormalizedListing[] {
  return picks.map(pick => ({
    platformListingId: pick.id,
    platform: 'ticketmaster',
    eventId,
    section: pick.section,
    row: pick.row,
    seatNumbers: pick.seatNumbers,
    quantity: pick.quantity?.available || 1,
    pricePerTicket: pick.faceValue,
    totalPrice: pick.totalPrice,
    fees: pick.fees,
    deliveryType: mapTopPicksDelivery(pick.deliveryMethods),
    sellerRating: pick.quality, // Use TM quality score as seller rating
    deepLink: generateDeepLink({
      platform: 'ticketmaster',
      eventId,
      listingId: pick.id,
    }),
    capturedAt: new Date(),
  }));
}

/**
 * Map Top Picks delivery methods to normalized delivery type
 * Top Picks uses string array instead of objects
 */
function mapTopPicksDelivery(methods?: string[]): DeliveryType {
  if (!methods?.length) return 'electronic';

  const methodsLower = methods.map(m => m.toLowerCase());

  if (methodsLower.some(m => m.includes('mobile') || m.includes('instant'))) {
    return 'instant';
  }
  if (methodsLower.some(m => m.includes('electronic') || m.includes('digital'))) {
    return 'electronic';
  }
  if (methodsLower.some(m => m.includes('willcall'))) {
    return 'willcall';
  }
  if (methodsLower.some(m => m.includes('mail') || m.includes('ship'))) {
    return 'physical';
  }

  return 'electronic';
}
