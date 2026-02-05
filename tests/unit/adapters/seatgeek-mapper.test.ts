/**
 * SeatGeek Mapper Tests
 * Validates the mapping of SeatGeek API responses to normalized types
 */

import { describe, it, expect } from 'vitest';
import { mapToNormalizedEvent, mapEventsToNormalized } from '../../../src/adapters/seatgeek/seatgeek.mapper.js';
import type { SeatGeekEvent } from '../../../src/adapters/seatgeek/seatgeek.types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockEvent = (overrides: Partial<SeatGeekEvent> = {}): SeatGeekEvent => ({
  id: 12345,
  type: 'concert',
  datetime_local: '2025-03-15T19:00:00',
  datetime_utc: '2025-03-16T02:00:00',
  datetime_tbd: false,
  time_tbd: false,
  title: 'Test Concert',
  short_title: 'Test',
  url: 'https://seatgeek.com/test-concert',
  score: 0.75,
  announce_date: '2024-12-01',
  visible_until_utc: '2025-03-16T02:00:00',
  is_open: true,
  status: 'normal',
  venue: {
    id: 999,
    name: 'Test Arena',
    url: 'https://seatgeek.com/venues/test-arena',
    score: 0.8,
    postal_code: '97201',
    city: 'Portland',
    state: 'OR',
    country: 'US',
    address: '123 Test St',
    timezone: 'America/Los_Angeles',
    location: { lat: 45.5, lon: -122.6 },
    capacity: 20000,
    slug: 'test-arena',
    has_upcoming_events: true,
    num_upcoming_events: 10,
  },
  performers: [
    {
      id: 111,
      name: 'Test Artist',
      short_name: 'Test',
      url: 'https://seatgeek.com/test-artist',
      image: 'https://example.com/image.jpg',
      slug: 'test-artist',
      type: 'band',
      score: 0.9,
      has_upcoming_events: true,
      num_upcoming_events: 5,
      primary: true,
    },
  ],
  taxonomies: [
    { id: 1, name: 'concert' },
  ],
  stats: {
    listing_count: 150,
    average_price: 85,
    lowest_price: 45,
    highest_price: 250,
    lowest_price_good_deals: 50,
    lowest_sg_base_price: 40,
    lowest_sg_base_price_good_deals: 45,
    median_price: 75,
    visible_listing_count: 140,
  },
  ...overrides,
});

// ============================================================================
// Price Range Mapping Tests
// ============================================================================

describe('SeatGeek Mapper - priceRange', () => {
  it('should map priceRange when stats has positive prices', () => {
    const event = createMockEvent();
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.priceRange).toBeDefined();
    expect(normalized.priceRange?.min).toBe(45);
    expect(normalized.priceRange?.max).toBe(250);
    expect(normalized.priceRange?.currency).toBe('USD');
  });

  it('should return undefined priceRange when lowest_price is 0', () => {
    const event = createMockEvent({
      stats: {
        listing_count: 0,
        average_price: 0,
        lowest_price: 0,
        highest_price: 0,
        lowest_price_good_deals: 0,
        lowest_sg_base_price: 0,
        lowest_sg_base_price_good_deals: 0,
        median_price: 0,
        visible_listing_count: 0,
      },
    });
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.priceRange).toBeUndefined();
  });

  it('should return undefined priceRange when highest_price is 0', () => {
    const event = createMockEvent({
      stats: {
        listing_count: 1,
        average_price: 50,
        lowest_price: 50,
        highest_price: 0, // Edge case: lowest but no highest
        lowest_price_good_deals: 50,
        lowest_sg_base_price: 45,
        lowest_sg_base_price_good_deals: 45,
        median_price: 50,
        visible_listing_count: 1,
      },
    });
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.priceRange).toBeUndefined();
  });

  it('should return undefined priceRange when stats is undefined', () => {
    const event = createMockEvent();
    // @ts-expect-error - Testing undefined stats edge case
    event.stats = undefined;
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.priceRange).toBeUndefined();
  });

  it('should handle batch mapping with mixed price data', () => {
    const eventWithPrices = createMockEvent();
    const eventWithoutPrices = createMockEvent({
      id: 99999,
      stats: {
        listing_count: 0,
        average_price: 0,
        lowest_price: 0,
        highest_price: 0,
        lowest_price_good_deals: 0,
        lowest_sg_base_price: 0,
        lowest_sg_base_price_good_deals: 0,
        median_price: 0,
        visible_listing_count: 0,
      },
    });

    const normalized = mapEventsToNormalized([eventWithPrices, eventWithoutPrices]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].priceRange).toBeDefined();
    expect(normalized[1].priceRange).toBeUndefined();
  });
});

// ============================================================================
// Core Event Mapping Tests
// ============================================================================

describe('SeatGeek Mapper - Core Fields', () => {
  it('should map all core event fields correctly', () => {
    const event = createMockEvent();
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.platformId).toBe('12345');
    expect(normalized.platform).toBe('seatgeek');
    expect(normalized.name).toBe('Test Concert');
    expect(normalized.venue.id).toBe('999');
    expect(normalized.venue.name).toBe('Test Arena');
    expect(normalized.venue.city).toBe('Portland');
    expect(normalized.venue.state).toBe('OR');
    expect(normalized.url).toBe('https://seatgeek.com/test-concert');
  });

  it('should map dateTime from datetime_utc', () => {
    const event = createMockEvent();
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.dateTime).toBeInstanceOf(Date);
    expect(normalized.dateTime.toISOString()).toContain('2025-03-16');
  });

  it('should map category from taxonomies', () => {
    const concertEvent = createMockEvent({ taxonomies: [{ id: 1, name: 'concert' }] });
    const sportsEvent = createMockEvent({ taxonomies: [{ id: 2, name: 'nba' }] });
    const comedyEvent = createMockEvent({ taxonomies: [{ id: 3, name: 'comedy' }] });

    expect(mapToNormalizedEvent(concertEvent).category).toBe('concerts');
    expect(mapToNormalizedEvent(sportsEvent).category).toBe('sports');
    expect(mapToNormalizedEvent(comedyEvent).category).toBe('comedy');
  });

  it('should default to concerts category when taxonomies empty', () => {
    const event = createMockEvent({ taxonomies: [] });
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.category).toBe('concerts');
  });

  it('should select best performer image', () => {
    const event = createMockEvent({
      performers: [
        {
          id: 111,
          name: 'Test Artist',
          short_name: 'Test',
          url: 'https://seatgeek.com/test-artist',
          image: 'https://example.com/fallback.jpg',
          images: {
            huge: 'https://example.com/huge.jpg',
            large: 'https://example.com/large.jpg',
          },
          slug: 'test-artist',
          type: 'band',
          score: 0.9,
          has_upcoming_events: true,
          num_upcoming_events: 5,
          primary: true,
        },
      ],
    });
    const normalized = mapToNormalizedEvent(event);

    expect(normalized.imageUrl).toBe('https://example.com/huge.jpg');
  });
});
