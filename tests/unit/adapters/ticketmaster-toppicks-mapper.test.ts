/**
 * Ticketmaster Top Picks Mapper Tests
 * Validates the mapping of Top Picks API responses to normalized listings
 */

import { describe, it, expect } from 'vitest';
import { mapTopPicksToNormalized } from '../../../src/adapters/ticketmaster/ticketmaster.mapper.js';
import type { TopPicksListing } from '../../../src/adapters/ticketmaster/ticketmaster.types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockPick = (overrides: Partial<TopPicksListing> = {}): TopPicksListing => ({
  id: 'pick-123',
  type: 'primary',
  section: 'Floor A',
  row: '5',
  seatNumbers: ['10', '11'],
  quality: 0.85,
  listingType: 'primary',
  totalPrice: 275.0,
  faceValue: 225.0,
  fees: 50.0,
  currency: 'USD',
  quantity: { available: 2, min: 1, max: 8 },
  deliveryMethods: ['MobileEntry'],
  ...overrides,
});

// ============================================================================
// Core Field Mapping Tests
// ============================================================================

describe('Top Picks Mapper - Core Fields', () => {
  it('should map basic listing fields correctly', () => {
    const picks = [createMockPick()];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings).toHaveLength(1);
    expect(listings[0].platformListingId).toBe('pick-123');
    expect(listings[0].platform).toBe('ticketmaster');
    expect(listings[0].eventId).toBe('event-456');
    expect(listings[0].section).toBe('Floor A');
    expect(listings[0].row).toBe('5');
    expect(listings[0].seatNumbers).toEqual(['10', '11']);
  });

  it('should map quantity from quantity.available', () => {
    const picks = [createMockPick({ quantity: { available: 4, min: 1, max: 8 } })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].quantity).toBe(4);
  });

  it('should default quantity to 1 when quantity is undefined', () => {
    const pick = createMockPick();
    // @ts-expect-error - Testing undefined quantity edge case
    pick.quantity = undefined;
    const listings = mapTopPicksToNormalized([pick], 'event-456');

    expect(listings[0].quantity).toBe(1);
  });
});

// ============================================================================
// Pricing Tests
// ============================================================================

describe('Top Picks Mapper - Pricing', () => {
  it('should map pricing correctly', () => {
    const picks = [createMockPick()];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].pricePerTicket).toBe(225.0);
    expect(listings[0].totalPrice).toBe(275.0);
    expect(listings[0].fees).toBe(50.0);
  });

  it('should map quality score to sellerRating', () => {
    const picks = [createMockPick({ quality: 0.92 })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].sellerRating).toBe(0.92);
  });

  it('should handle zero fees', () => {
    const picks = [createMockPick({ fees: 0, totalPrice: 100, faceValue: 100 })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].fees).toBe(0);
    expect(listings[0].pricePerTicket).toBe(100);
    expect(listings[0].totalPrice).toBe(100);
  });
});

// ============================================================================
// Delivery Type Mapping Tests
// ============================================================================

describe('Top Picks Mapper - Delivery Types', () => {
  it('should map MobileEntry to instant delivery', () => {
    const picks = [createMockPick({ deliveryMethods: ['MobileEntry'] })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].deliveryType).toBe('instant');
  });

  it('should map electronic delivery types', () => {
    const picks = [createMockPick({ deliveryMethods: ['Electronic'] })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].deliveryType).toBe('electronic');
  });

  it('should map Digital to electronic', () => {
    const picks = [createMockPick({ deliveryMethods: ['DigitalDelivery'] })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].deliveryType).toBe('electronic');
  });

  it('should map WillCall delivery', () => {
    const picks = [createMockPick({ deliveryMethods: ['WillCall'] })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].deliveryType).toBe('willcall');
  });

  it('should map mail/shipping to physical', () => {
    const picks = [createMockPick({ deliveryMethods: ['StandardMail'] })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].deliveryType).toBe('physical');
  });

  it('should default to electronic when deliveryMethods is undefined', () => {
    const pick = createMockPick();
    // @ts-expect-error - Testing undefined deliveryMethods edge case
    pick.deliveryMethods = undefined;
    const listings = mapTopPicksToNormalized([pick], 'event-456');

    expect(listings[0].deliveryType).toBe('electronic');
  });

  it('should default to electronic when deliveryMethods is empty', () => {
    const picks = [createMockPick({ deliveryMethods: [] })];
    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings[0].deliveryType).toBe('electronic');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Top Picks Mapper - Edge Cases', () => {
  it('should handle empty picks array', () => {
    const listings = mapTopPicksToNormalized([], 'event-456');
    expect(listings).toHaveLength(0);
  });

  it('should handle missing optional fields', () => {
    const pick = createMockPick();
    delete pick.seatNumbers;
    delete pick.attributes;
    delete pick.sellerNotes;

    const listings = mapTopPicksToNormalized([pick], 'event-456');

    expect(listings[0].seatNumbers).toBeUndefined();
  });

  it('should map multiple picks correctly', () => {
    const picks = [
      createMockPick({ id: 'pick-1', section: 'Section A' }),
      createMockPick({ id: 'pick-2', section: 'Section B' }),
      createMockPick({ id: 'pick-3', section: 'Section C' }),
    ];

    const listings = mapTopPicksToNormalized(picks, 'event-456');

    expect(listings).toHaveLength(3);
    expect(listings[0].section).toBe('Section A');
    expect(listings[1].section).toBe('Section B');
    expect(listings[2].section).toBe('Section C');
  });

  it('should generate deepLink with correct format', () => {
    const picks = [createMockPick({ id: 'listing-xyz' })];
    const listings = mapTopPicksToNormalized(picks, 'event-abc');

    expect(listings[0].deepLink).toBeDefined();
    expect(listings[0].deepLink).toContain('ticketmaster');
  });

  it('should set capturedAt to current date', () => {
    const picks = [createMockPick()];
    const before = new Date();
    const listings = mapTopPicksToNormalized(picks, 'event-456');
    const after = new Date();

    expect(listings[0].capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(listings[0].capturedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
