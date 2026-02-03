/**
 * Value Engine Service Unit Tests
 * Tests the weighted scoring pipeline end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { ValueEngineService } from '../../../src/services/value-engine/value-engine.service.js';
import { SectionTier, DEFAULT_WEIGHTS } from '../../../src/services/value-engine/value-score.types.js';
import { makeListing, makePremiumListing, makeCheapListing, makeListingBatch, makeHistoricalPrices } from '../../mocks/fixtures.js';

describe('ValueEngineService', () => {
  const engine = new ValueEngineService();

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('accepts default weights', () => {
      expect(() => new ValueEngineService()).not.toThrow();
    });

    it('accepts custom weights that sum to 1.0', () => {
      expect(() => new ValueEngineService({
        priceVsAverage: 0.5,
        sectionQuality: 0.2,
        rowPosition: 0.1,
        historicalPricing: 0.1,
        resalePotential: 0.1,
      })).not.toThrow();
    });

    it('throws if weights do not sum to 1.0', () => {
      expect(() => new ValueEngineService({
        priceVsAverage: 0.5,
        sectionQuality: 0.5,
        rowPosition: 0.5,
        historicalPricing: 0.5,
        resalePotential: 0.5,
      })).toThrow('weights must sum to 1.0');
    });
  });

  // ==========================================================================
  // calculateValueScore()
  // ==========================================================================

  describe('calculateValueScore()', () => {
    it('returns a score between 1 and 100', () => {
      const result = engine.calculateValueScore({
        listing: makeListing({ pricePerTicket: 85 }),
        averagePrice: 100,
        sectionTier: SectionTier.UPPER_PREMIUM,
        rowRank: 5,
        totalRowsInSection: 30,
        historicalPriceData: [],
        eventPopularity: 70,
        daysUntilEvent: 14,
      });

      expect(result.totalScore).toBeGreaterThanOrEqual(1);
      expect(result.totalScore).toBeLessThanOrEqual(100);
    });

    it('returns all breakdown components', () => {
      const result = engine.calculateValueScore({
        listing: makeListing(),
        averagePrice: 100,
        sectionTier: SectionTier.MID_TIER,
        rowRank: 10,
        totalRowsInSection: 25,
        historicalPriceData: [],
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(result.breakdown).toHaveProperty('priceScore');
      expect(result.breakdown).toHaveProperty('sectionScore');
      expect(result.breakdown).toHaveProperty('rowScore');
      expect(result.breakdown).toHaveProperty('historicalScore');
      expect(result.breakdown).toHaveProperty('resaleScore');
    });

    it('maps score to correct recommendation', () => {
      // Low price + premium section + front row = excellent
      const result = engine.calculateValueScore({
        listing: makeListing({ pricePerTicket: 40 }),
        averagePrice: 100,
        sectionTier: SectionTier.PREMIUM,
        rowRank: 1,
        totalRowsInSection: 20,
        historicalPriceData: makeHistoricalPrices(),
        eventPopularity: 90,
        daysUntilEvent: 14,
      });

      expect(result.recommendation).toBe('excellent');
    });

    it('detects front row flag', () => {
      const result = engine.calculateValueScore({
        listing: makeListing(),
        averagePrice: 100,
        sectionTier: SectionTier.MID_TIER,
        rowRank: 1,
        totalRowsInSection: 25,
        historicalPriceData: [],
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(result.flags.isFrontRow).toBe(true);
    });

    it('detects premium section flag', () => {
      const result = engine.calculateValueScore({
        listing: makeListing(),
        averagePrice: 100,
        sectionTier: SectionTier.PREMIUM,
        rowRank: 5,
        totalRowsInSection: 20,
        historicalPriceData: [],
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(result.flags.isPremiumSection).toBe(true);
    });

    it('detects price outlier flag (25%+ below average)', () => {
      const result = engine.calculateValueScore({
        listing: makeListing({ pricePerTicket: 50 }),
        averagePrice: 100,
        sectionTier: SectionTier.MID_TIER,
        rowRank: 10,
        totalRowsInSection: 25,
        historicalPriceData: [],
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(result.flags.isPriceOutlier).toBe(true);
    });

    it('generates reasoning string', () => {
      const result = engine.calculateValueScore({
        listing: makeListing({ pricePerTicket: 50 }),
        averagePrice: 100,
        sectionTier: SectionTier.MID_TIER,
        rowRank: 10,
        totalRowsInSection: 25,
        historicalPriceData: [],
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(result.reasoning).toBeTruthy();
      expect(result.reasoning.length).toBeGreaterThan(5);
      expect(result.reasoning).toContain('.'); // Ends with period
    });
  });

  // ==========================================================================
  // scoreListings() — batch scoring
  // ==========================================================================

  describe('scoreListings()', () => {
    it('scores a batch of listings', () => {
      const listings = makeListingBatch(5);
      const scored = engine.scoreListings(listings, {
        averagePrice: 100,
        sectionTiers: {},
        historicalData: new Map(),
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(scored).toHaveLength(5);
      scored.forEach(s => {
        expect(s.listing).toBeDefined();
        expect(s.score.totalScore).toBeGreaterThanOrEqual(1);
        expect(s.score.totalScore).toBeLessThanOrEqual(100);
      });
    });

    it('handles empty listings array', () => {
      const scored = engine.scoreListings([], {
        averagePrice: 100,
        sectionTiers: {},
        historicalData: new Map(),
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      expect(scored).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getTopValuePicks()
  // ==========================================================================

  describe('getTopValuePicks()', () => {
    it('returns top N listings sorted by score descending', () => {
      const listings = makeListingBatch(10);
      const scored = engine.scoreListings(listings, {
        averagePrice: 120,
        sectionTiers: {},
        historicalData: new Map(),
        eventPopularity: 60,
        daysUntilEvent: 14,
      });

      const top3 = engine.getTopValuePicks(scored, 3);

      expect(top3).toHaveLength(3);
      expect(top3[0].score.totalScore).toBeGreaterThanOrEqual(top3[1].score.totalScore);
      expect(top3[1].score.totalScore).toBeGreaterThanOrEqual(top3[2].score.totalScore);
    });

    it('returns all if limit > array size', () => {
      const listings = makeListingBatch(3);
      const scored = engine.scoreListings(listings, {
        averagePrice: 100,
        sectionTiers: {},
        historicalData: new Map(),
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      const top10 = engine.getTopValuePicks(scored, 10);
      expect(top10).toHaveLength(3);
    });
  });

  // ==========================================================================
  // filterByMinScore()
  // ==========================================================================

  describe('filterByMinScore()', () => {
    it('filters out listings below threshold', () => {
      const listings = makeListingBatch(10);
      const scored = engine.scoreListings(listings, {
        averagePrice: 100,
        sectionTiers: {},
        historicalData: new Map(),
        eventPopularity: 50,
        daysUntilEvent: 14,
      });

      const filtered = engine.filterByMinScore(scored, 70);
      filtered.forEach(s => {
        expect(s.score.totalScore).toBeGreaterThanOrEqual(70);
      });
    });
  });

  // ==========================================================================
  // calculateAveragePrice()
  // ==========================================================================

  describe('calculateAveragePrice()', () => {
    it('returns 0 for empty array', () => {
      expect(engine.calculateAveragePrice([])).toBe(0);
    });

    it('calculates correct average', () => {
      const listings = [
        makeListing({ pricePerTicket: 50 }),
        makeListing({ pricePerTicket: 100 }),
        makeListing({ pricePerTicket: 150 }),
      ];
      expect(engine.calculateAveragePrice(listings)).toBe(100);
    });
  });
});
