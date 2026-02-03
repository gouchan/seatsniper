/**
 * Price Analyzer Unit Tests
 * Tests: analyze(), analyzeHistorical(), isHistoricalLow(), isPriceOutlier()
 */

import { describe, it, expect } from 'vitest';
import { PriceAnalyzer } from '../../../src/services/value-engine/scoring/price-analyzer.js';
import { makeHistoricalPrices } from '../../mocks/fixtures.js';

describe('PriceAnalyzer', () => {
  const analyzer = new PriceAnalyzer();

  // ==========================================================================
  // analyze() — price vs current market average
  // ==========================================================================

  describe('analyze()', () => {
    it('returns 50 when price equals average', () => {
      expect(analyzer.analyze(100, 100)).toBe(50);
    });

    it('returns 100 when price is 50% below average', () => {
      expect(analyzer.analyze(50, 100)).toBe(100);
    });

    it('returns 0 when price is 50% above average', () => {
      expect(analyzer.analyze(150, 100)).toBe(0);
    });

    it('clamps to 0 for extremely overpriced tickets', () => {
      expect(analyzer.analyze(300, 100)).toBe(0);
    });

    it('clamps to 100 for extremely cheap tickets', () => {
      expect(analyzer.analyze(10, 100)).toBe(100);
    });

    it('returns 50 (neutral) when averagePrice is 0', () => {
      expect(analyzer.analyze(85, 0)).toBe(50);
    });

    it('returns 50 (neutral) when averagePrice is negative', () => {
      expect(analyzer.analyze(85, -10)).toBe(50);
    });

    it('scores proportionally: 25% below average → ~75', () => {
      const result = analyzer.analyze(75, 100);
      expect(result).toBe(75);
    });

    it('scores proportionally: 10% above average → ~40', () => {
      const result = analyzer.analyze(110, 100);
      expect(result).toBe(40);
    });
  });

  // ==========================================================================
  // analyzeHistorical() — price vs historical data
  // ==========================================================================

  describe('analyzeHistorical()', () => {
    it('returns 50 (neutral) with no historical data', () => {
      expect(analyzer.analyzeHistorical(85, [])).toBe(50);
    });

    it('returns 100 when at or below historical low', () => {
      const history = makeHistoricalPrices();
      const lowestPrice = Math.min(...history.map(h => h.lowestPrice));
      expect(analyzer.analyzeHistorical(lowestPrice - 5, history)).toBe(100);
    });

    it('returns 100 exactly at historical low', () => {
      const history = makeHistoricalPrices();
      const lowestPrice = Math.min(...history.map(h => h.lowestPrice));
      expect(analyzer.analyzeHistorical(lowestPrice, history)).toBe(100);
    });

    it('returns between 50-100 when between low and average', () => {
      const history = makeHistoricalPrices();
      const lowestPrice = Math.min(...history.map(h => h.lowestPrice));
      // Choose a price between lowest and average
      const midPrice = lowestPrice + 20;
      const result = analyzer.analyzeHistorical(midPrice, history);
      expect(result).toBeGreaterThanOrEqual(50);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('returns below 50 when above historical average', () => {
      const history = [
        { date: new Date(), section: 'A', averagePrice: 100, lowestPrice: 80, highestPrice: 130, listingCount: 10 },
      ];
      const result = analyzer.analyzeHistorical(150, history);
      expect(result).toBeLessThan(50);
    });

    it('returns 0 for extremely overpriced vs history', () => {
      const history = [
        { date: new Date(), section: 'A', averagePrice: 50, lowestPrice: 40, highestPrice: 60, listingCount: 10 },
      ];
      const result = analyzer.analyzeHistorical(100, history);
      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // isHistoricalLow()
  // ==========================================================================

  describe('isHistoricalLow()', () => {
    it('returns false with no data', () => {
      expect(analyzer.isHistoricalLow(50, [])).toBe(false);
    });

    it('returns true when price is below historical low', () => {
      const history = makeHistoricalPrices();
      const lowestPrice = Math.min(...history.map(h => h.lowestPrice));
      expect(analyzer.isHistoricalLow(lowestPrice - 10, history)).toBe(true);
    });

    it('returns true when price is within 5% of historical low', () => {
      const history = [
        { date: new Date(), section: 'A', averagePrice: 100, lowestPrice: 80, highestPrice: 130, listingCount: 10 },
      ];
      // 5% above 80 = 84
      expect(analyzer.isHistoricalLow(84, history)).toBe(true);
    });

    it('returns false when price is far above historical low', () => {
      const history = [
        { date: new Date(), section: 'A', averagePrice: 100, lowestPrice: 80, highestPrice: 130, listingCount: 10 },
      ];
      expect(analyzer.isHistoricalLow(120, history)).toBe(false);
    });
  });

  // ==========================================================================
  // isPriceOutlier()
  // ==========================================================================

  describe('isPriceOutlier()', () => {
    it('returns false when averagePrice is 0', () => {
      expect(analyzer.isPriceOutlier(50, 0)).toBe(false);
    });

    it('returns true when price is 25%+ below average', () => {
      expect(analyzer.isPriceOutlier(70, 100)).toBe(true); // 30% below
    });

    it('returns true when exactly at threshold', () => {
      expect(analyzer.isPriceOutlier(75, 100)).toBe(true); // 25% below
    });

    it('returns false when price is only 10% below average', () => {
      expect(analyzer.isPriceOutlier(90, 100)).toBe(false);
    });

    it('returns false when price is above average', () => {
      expect(analyzer.isPriceOutlier(120, 100)).toBe(false);
    });
  });
});
