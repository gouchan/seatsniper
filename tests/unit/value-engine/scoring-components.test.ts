/**
 * Scoring Components Unit Tests
 * Tests each scoring sub-component in isolation:
 *   - PriceAnalyzer
 *   - SectionRanker
 *   - RowEvaluator
 *   - ResalePredictor
 */

import { describe, it, expect } from 'vitest';
import { PriceAnalyzer } from '../../../src/services/value-engine/scoring/price-analyzer.js';
import { SectionRanker } from '../../../src/services/value-engine/scoring/section-ranker.js';
import { RowEvaluator } from '../../../src/services/value-engine/scoring/row-evaluator.js';
import { ResalePredictor } from '../../../src/services/value-engine/scoring/resale-predictor.js';
import { SectionTier } from '../../../src/services/value-engine/value-score.types.js';
import { makeHistoricalPrices } from '../../mocks/fixtures.js';

// ============================================================================
// PriceAnalyzer
// ============================================================================

describe('PriceAnalyzer', () => {
  const analyzer = new PriceAnalyzer();

  describe('analyze()', () => {
    it('returns 100 for 50%+ below average', () => {
      const score = analyzer.analyze(40, 100);
      expect(score).toBeGreaterThanOrEqual(90);
    });

    it('returns ~50 for price equal to average', () => {
      const score = analyzer.analyze(100, 100);
      expect(score).toBeGreaterThanOrEqual(40);
      expect(score).toBeLessThanOrEqual(60);
    });

    it('returns near 0 for 50%+ above average', () => {
      const score = analyzer.analyze(160, 100);
      expect(score).toBeLessThanOrEqual(15);
    });

    it('handles zero average gracefully', () => {
      const score = analyzer.analyze(50, 0);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('analyzeHistorical()', () => {
    it('returns 50 with no historical data', () => {
      const score = analyzer.analyzeHistorical(100, []);
      expect(score).toBe(50);
    });

    it('scores high when at historical low', () => {
      const data = makeHistoricalPrices(5);
      // Find the lowest historical price
      const lowestHistorical = Math.min(...data.map(d => d.lowestPrice));
      const score = analyzer.analyzeHistorical(lowestHistorical, data);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it('scores low when well above historical average', () => {
      const data = makeHistoricalPrices(5);
      const score = analyzer.analyzeHistorical(300, data);
      expect(score).toBeLessThanOrEqual(40);
    });
  });

  describe('isHistoricalLow()', () => {
    it('returns false with empty history', () => {
      expect(analyzer.isHistoricalLow(50, [])).toBe(false);
    });

    it('returns true when at the lowest price', () => {
      const data = makeHistoricalPrices(5);
      const lowest = Math.min(...data.map(d => d.lowestPrice));
      expect(analyzer.isHistoricalLow(lowest, data)).toBe(true);
    });

    it('returns true when within 5% of lowest', () => {
      const data = makeHistoricalPrices(5);
      const lowest = Math.min(...data.map(d => d.lowestPrice));
      expect(analyzer.isHistoricalLow(lowest * 1.04, data)).toBe(true);
    });

    it('returns false when above threshold', () => {
      const data = makeHistoricalPrices(5);
      const lowest = Math.min(...data.map(d => d.lowestPrice));
      expect(analyzer.isHistoricalLow(lowest * 1.2, data)).toBe(false);
    });
  });

  describe('isPriceOutlier()', () => {
    it('returns true when 25%+ below average', () => {
      expect(analyzer.isPriceOutlier(70, 100)).toBe(true);
    });

    it('returns false when near average', () => {
      expect(analyzer.isPriceOutlier(90, 100)).toBe(false);
    });

    it('returns false when above average', () => {
      expect(analyzer.isPriceOutlier(120, 100)).toBe(false);
    });
  });
});

// ============================================================================
// SectionRanker
// ============================================================================

describe('SectionRanker', () => {
  const ranker = new SectionRanker();

  describe('rank()', () => {
    it('PREMIUM scores 100', () => {
      expect(ranker.rank(SectionTier.PREMIUM)).toBe(100);
    });

    it('UPPER_PREMIUM scores 80', () => {
      expect(ranker.rank(SectionTier.UPPER_PREMIUM)).toBe(80);
    });

    it('MID_TIER scores 60', () => {
      expect(ranker.rank(SectionTier.MID_TIER)).toBe(60);
    });

    it('UPPER_LEVEL scores 40', () => {
      expect(ranker.rank(SectionTier.UPPER_LEVEL)).toBe(40);
    });

    it('OBSTRUCTED scores 20', () => {
      expect(ranker.rank(SectionTier.OBSTRUCTED)).toBe(20);
    });
  });

  describe('getTierFromSectionName()', () => {
    it('infers PREMIUM from "Floor"', () => {
      expect(ranker.getTierFromSectionName('Floor A', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers PREMIUM from "VIP"', () => {
      expect(ranker.getTierFromSectionName('VIP Box 1', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers PREMIUM from "pit"', () => {
      expect(ranker.getTierFromSectionName('GA Pit', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers UPPER_PREMIUM from "Lower"', () => {
      const tier = ranker.getTierFromSectionName('Lower Bowl 102', {});
      expect(tier).toBeLessThanOrEqual(SectionTier.UPPER_PREMIUM);
    });

    it('infers UPPER_LEVEL from "Upper"', () => {
      const tier = ranker.getTierFromSectionName('Upper Deck 308', {});
      expect(tier).toBe(SectionTier.UPPER_LEVEL);
    });

    it('infers UPPER_LEVEL from "Balcony"', () => {
      const tier = ranker.getTierFromSectionName('Balcony', {});
      expect(tier).toBe(SectionTier.UPPER_LEVEL);
    });

    it('infers OBSTRUCTED from "Limited View"', () => {
      const tier = ranker.getTierFromSectionName('Limited View 204', {});
      expect(tier).toBe(SectionTier.OBSTRUCTED);
    });

    it('uses numeric heuristic for Section 102 → UPPER_PREMIUM', () => {
      const tier = ranker.getTierFromSectionName('Section 102', {});
      expect(tier).toBe(SectionTier.UPPER_PREMIUM);
    });

    it('uses numeric heuristic for Section 204 → MID_TIER', () => {
      const tier = ranker.getTierFromSectionName('Section 204', {});
      expect(tier).toBe(SectionTier.MID_TIER);
    });

    it('uses numeric heuristic for Section 308 → UPPER_LEVEL', () => {
      const tier = ranker.getTierFromSectionName('Section 308', {});
      expect(tier).toBe(SectionTier.UPPER_LEVEL);
    });

    it('uses explicit tier map if provided', () => {
      const tier = ranker.getTierFromSectionName('Section 102', { 'Section 102': SectionTier.PREMIUM });
      expect(tier).toBe(SectionTier.PREMIUM);
    });
  });

  describe('isPremiumSection()', () => {
    it('returns true for PREMIUM', () => {
      expect(ranker.isPremiumSection(SectionTier.PREMIUM)).toBe(true);
    });

    it('returns true for UPPER_PREMIUM', () => {
      expect(ranker.isPremiumSection(SectionTier.UPPER_PREMIUM)).toBe(true);
    });

    it('returns false for MID_TIER', () => {
      expect(ranker.isPremiumSection(SectionTier.MID_TIER)).toBe(false);
    });

    it('returns false for OBSTRUCTED', () => {
      expect(ranker.isPremiumSection(SectionTier.OBSTRUCTED)).toBe(false);
    });
  });
});

// ============================================================================
// RowEvaluator
// ============================================================================

describe('RowEvaluator', () => {
  const evaluator = new RowEvaluator();

  describe('evaluate()', () => {
    it('front row (rank 1) scores near 100', () => {
      const score = evaluator.evaluate(1, 30);
      expect(score).toBeGreaterThanOrEqual(95);
    });

    it('back row scores near minimum (20)', () => {
      const score = evaluator.evaluate(30, 30);
      expect(score).toBeLessThanOrEqual(30);
    });

    it('mid-row scores between extremes', () => {
      const score = evaluator.evaluate(15, 30);
      expect(score).toBeGreaterThan(20);
      expect(score).toBeLessThan(100);
    });

    it('never goes below 20', () => {
      const score = evaluator.evaluate(100, 100);
      expect(score).toBeGreaterThanOrEqual(20);
    });
  });

  describe('parseRowToRank()', () => {
    it('parses numeric row "5" → 5', () => {
      expect(evaluator.parseRowToRank('5')).toBe(5);
    });

    it('parses "15" → 15', () => {
      expect(evaluator.parseRowToRank('15')).toBe(15);
    });

    it('parses letter row "A" → 1', () => {
      expect(evaluator.parseRowToRank('A')).toBe(1);
    });

    it('parses letter row "K" → 11', () => {
      expect(evaluator.parseRowToRank('K')).toBe(11);
    });

    it('parses double letter "AA" → 27', () => {
      expect(evaluator.parseRowToRank('AA')).toBe(27);
    });

    it('parses "GA" (General Admission) → 1', () => {
      expect(evaluator.parseRowToRank('GA')).toBe(1);
    });

    it('parses "PIT" → 1', () => {
      expect(evaluator.parseRowToRank('PIT')).toBe(1);
    });

    it('returns -1 for invalid/unparseable row', () => {
      expect(evaluator.parseRowToRank('???')).toBe(-1);
    });
  });

  describe('isFrontRow()', () => {
    it('returns true for rows 1-3', () => {
      expect(evaluator.isFrontRow(1)).toBe(true);
      expect(evaluator.isFrontRow(2)).toBe(true);
      expect(evaluator.isFrontRow(3)).toBe(true);
    });

    it('returns false for row 4+', () => {
      expect(evaluator.isFrontRow(4)).toBe(false);
      expect(evaluator.isFrontRow(10)).toBe(false);
    });
  });

  describe('estimateTotalRows()', () => {
    it('estimates more rows for UPPER_PREMIUM than OBSTRUCTED', () => {
      const upper = evaluator.estimateTotalRows(SectionTier.UPPER_PREMIUM);
      const obstructed = evaluator.estimateTotalRows(SectionTier.OBSTRUCTED);
      expect(upper).toBeGreaterThan(obstructed);
    });

    it('returns a positive number for all tiers', () => {
      for (const tier of [1, 2, 3, 4, 5] as SectionTier[]) {
        expect(evaluator.estimateTotalRows(tier)).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================================
// ResalePredictor
// ============================================================================

describe('ResalePredictor', () => {
  const predictor = new ResalePredictor();

  describe('predict()', () => {
    it('high popularity + sweet spot timing + premium section scores high', () => {
      const score = predictor.predict(90, 14, SectionTier.PREMIUM);
      expect(score).toBeGreaterThanOrEqual(85);
    });

    it('low popularity + far out + obstructed scores low', () => {
      const score = predictor.predict(10, 200, SectionTier.OBSTRUCTED);
      expect(score).toBeLessThanOrEqual(35);
    });

    it('sweet spot is 7-30 days out', () => {
      const sweetSpot = predictor.predict(70, 14, SectionTier.MID_TIER);
      const tooClose = predictor.predict(70, 0.5, SectionTier.MID_TIER);
      const tooFar = predictor.predict(70, 200, SectionTier.MID_TIER);
      expect(sweetSpot).toBeGreaterThan(tooClose);
      expect(sweetSpot).toBeGreaterThan(tooFar);
    });

    it('clamps popularity input to 0-100', () => {
      const normal = predictor.predict(100, 14, SectionTier.PREMIUM);
      const overMax = predictor.predict(999, 14, SectionTier.PREMIUM);
      expect(normal).toBe(overMax);
    });

    it('clamps negative days to 0', () => {
      const zero = predictor.predict(50, 0, SectionTier.MID_TIER);
      const negative = predictor.predict(50, -5, SectionTier.MID_TIER);
      expect(zero).toBe(negative);
    });

    it('returns a value between 0 and 100', () => {
      const score = predictor.predict(50, 14, SectionTier.MID_TIER);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('estimateROI()', () => {
    it('high demand + below average → high confidence positive ROI', () => {
      const result = predictor.estimateROI(95, 14, -25);
      expect(result.confidence).toBe('high');
      expect(result.estimatedROI).toBeGreaterThan(0);
      expect(result.recommendation).toContain('Strong');
    });

    it('moderate demand + below average → medium confidence', () => {
      const result = predictor.estimateROI(65, 14, -10);
      expect(result.confidence).toBe('medium');
      expect(result.estimatedROI).toBeGreaterThan(0);
    });

    it('above average price → warns of risk', () => {
      const result = predictor.estimateROI(50, 14, 20);
      expect(result.estimatedROI).toBeLessThan(0);
      expect(result.recommendation).toContain('Caution');
    });

    it('uncertain conditions → low confidence', () => {
      const result = predictor.estimateROI(30, 100, 5);
      expect(result.confidence).toBe('low');
      expect(result.estimatedROI).toBe(0);
    });
  });
});
