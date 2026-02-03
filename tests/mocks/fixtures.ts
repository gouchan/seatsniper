/**
 * Test Fixtures
 * Shared fake data for all tests — events, listings, subscriptions, and alert payloads.
 */

import type {
  NormalizedEvent,
  NormalizedListing,
  EventCategory,
} from '../../src/adapters/base/platform-adapter.interface.js';
import type { Subscription } from '../../src/services/monitoring/monitor.service.js';
import type { AlertPayload, TopValueListing } from '../../src/notifications/base/notifier.interface.js';
import { AlertType } from '../../src/notifications/base/notifier.interface.js';
import type { HistoricalPrice } from '../../src/services/value-engine/value-score.types.js';

// ============================================================================
// Events
// ============================================================================

export function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platformId: 'evt-001',
    platform: 'stubhub',
    name: 'Portland Trail Blazers vs LA Lakers',
    venue: {
      id: 'venue-moda',
      name: 'Moda Center',
      city: 'Portland',
      state: 'OR',
    },
    dateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days out
    category: 'sports' as EventCategory,
    url: 'https://stubhub.com/event/evt-001',
    seatMapUrl: 'https://stubhub.com/seatmap/evt-001.png',
    ...overrides,
  };
}

export function makeFarEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return makeEvent({
    platformId: 'evt-far-001',
    name: 'Pearl Jam Summer Tour',
    dateTime: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days out
    ...overrides,
  });
}

export function makePastEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return makeEvent({
    platformId: 'evt-past-001',
    name: 'Yesterday Concert',
    dateTime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    ...overrides,
  });
}

// ============================================================================
// Listings
// ============================================================================

export function makeListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    platformListingId: 'lst-001',
    platform: 'stubhub',
    eventId: 'evt-001',
    section: 'Section 102',
    row: '5',
    quantity: 2,
    pricePerTicket: 85,
    totalPrice: 170,
    fees: 20,
    deliveryType: 'electronic',
    sellerRating: 4.5,
    deepLink: 'https://stubhub.com/buy/lst-001',
    capturedAt: new Date(),
    ...overrides,
  };
}

export function makePremiumListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return makeListing({
    platformListingId: 'lst-premium',
    section: 'Floor A',
    row: '1',
    pricePerTicket: 250,
    totalPrice: 500,
    fees: 60,
    ...overrides,
  });
}

export function makeCheapListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return makeListing({
    platformListingId: 'lst-cheap',
    section: 'Section 308',
    row: '20',
    pricePerTicket: 35,
    totalPrice: 70,
    fees: 10,
    ...overrides,
  });
}

export function makeFamilyListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return makeListing({
    platformListingId: 'lst-family',
    section: 'Section 204',
    row: 'C',
    quantity: 4,
    pricePerTicket: 65,
    totalPrice: 260,
    fees: 30,
    ...overrides,
  });
}

/**
 * Generates a batch of listings with varying prices/sections for realistic scoring tests
 */
export function makeListingBatch(count: number = 10): NormalizedListing[] {
  const sections = ['Floor A', 'Section 102', 'Section 110', 'Section 204', 'Section 308', 'Balcony'];
  const rows = ['1', '3', 'A', 'K', '15', '22'];

  return Array.from({ length: count }, (_, i) => ({
    platformListingId: `lst-batch-${i}`,
    platform: 'stubhub' as const,
    eventId: 'evt-001',
    section: sections[i % sections.length],
    row: rows[i % rows.length],
    quantity: [1, 2, 2, 4, 2, 1][i % 6],
    pricePerTicket: 40 + i * 20,
    totalPrice: (40 + i * 20) * 2,
    fees: 10 + i * 3,
    deliveryType: 'electronic' as const,
    sellerRating: 4.0 + (i % 5) * 0.2,
    deepLink: `https://stubhub.com/buy/lst-batch-${i}`,
    capturedAt: new Date(),
  }));
}

// ============================================================================
// Subscriptions
// ============================================================================

export function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    userId: 'user-123',
    channel: 'telegram',
    cities: ['portland'],
    minScore: 70,
    minQuantity: 1,
    maxPricePerTicket: 0,
    active: true,
    paused: false,
    userTier: 'free',
    ...overrides,
  };
}

export function makeFamilySubscription(overrides: Partial<Subscription> = {}): Subscription {
  return makeSubscription({
    userId: 'family-user-456',
    minQuantity: 4,
    maxPricePerTicket: 100,
    ...overrides,
  });
}

// ============================================================================
// Historical Prices
// ============================================================================

export function makeHistoricalPrices(count: number = 5): HistoricalPrice[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.now() - (count - i) * 7 * 24 * 60 * 60 * 1000), // Weekly data points
    section: 'Section 102',
    averagePrice: 100 - i * 5, // Prices trending down
    lowestPrice: 80 - i * 5,
    highestPrice: 130 - i * 3,
    listingCount: 20 + i * 2,
  }));
}

// ============================================================================
// Alert Payloads
// ============================================================================

export function makeAlertPayload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    userId: 'user-123',
    eventName: 'Portland Trail Blazers vs LA Lakers',
    venueName: 'Moda Center',
    venueCity: 'Portland',
    eventDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    listings: [makeTopValueListing()],
    alertType: AlertType.HIGH_VALUE,
    seatMapUrl: 'https://stubhub.com/seatmap/evt-001.png',
    ...overrides,
  };
}

export function makeTopValueListing(overrides: Partial<TopValueListing> = {}): TopValueListing {
  return {
    rank: 1,
    section: 'Section 102',
    row: '5',
    quantity: 2,
    pricePerTicket: 85,
    valueScore: 82,
    recommendation: '15% below average price. Premium seating location.',
    deepLink: 'https://stubhub.com/buy/lst-001',
    platform: 'stubhub',
    ...overrides,
  };
}
