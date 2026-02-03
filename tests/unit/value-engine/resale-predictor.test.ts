/**
 * Resale Predictor Unit Tests
 * Tests: predict(), estimateROI()
 */

import { describe, it, expect } from 'vitest';
import { ResalePredictor } from '../../../src/services/value-engine/scoring/resale-predictor.js';
import { SectionTier } from '../../../src/services/value-engine/value-score.types.js';

describe('ResalePredictor', () => {
  const predictor = new ResalePredictor();

  // ==========================================================================
  // predict()
  // ==========================================================================

  describe('predict()', () => {
    it('returns high score for popular event in sweet spot timing with premium section', () => {
      const score = predictor.predict(90, 15, SectionTier.PREMIUM);
      expect(score).toBeGreaterThan(85);
    });

    it('returns low score for unpopular event far out with obstructed view', () => {
      const score = predictor.predict(10, 200, SectionTier.OBSTRUCTED);
      expect(score).toBeLessThan(35);
    });

    it('clamps popularity to 0-100 range', () => {
      const over = predictor.predict(150, 15, SectionTier.MID_TIER);
      const at100 = predictor.predict(100, 15, SectionTier.MID_TIER);
      expect(over).toBe(at100);

      const under = predictor.predict(-50, 15, SectionTier.MID_TIER);
      const at0 = predictor.predict(0, 15, SectionTier.MID_TIER);
      expect(under).toBe(at0);
    });

    it('handles negative daysUntilEvent', () => {
      // Should clamp to 0 (event already happened)
      const result = predictor.predict(80, -5, SectionTier.MID_TIER);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('sweet spot timing (7-30 days) scores higher than 180+ days', () => {
      const sweetSpot = predictor.predict(70, 15, SectionTier.MID_TIER);
      const farOut = predictor.predict(70, 200, SectionTier.MID_TIER);
      expect(sweetSpot).toBeGreaterThan(farOut);
    });

    it('premium section scores higher than obstructed (same event)', () => {
      const premium = predictor.predict(70, 15, SectionTier.PREMIUM);
      const obstructed = predictor.predict(70, 15, SectionTier.OBSTRUCTED);
      expect(premium).toBeGreaterThan(obstructed);
    });

    it('returns a rounded integer', () => {
      const score = predictor.predict(55, 14, SectionTier.MID_TIER);
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  // ==========================================================================
  // estimateROI()
  // ==========================================================================

  describe('estimateROI()', () => {
    it('returns high confidence for high demand + below average price', () => {
      const roi = predictor.estimateROI(95, 15, -25);
      expect(roi.confidence).toBe('high');
      expect(roi.estimatedROI).toBeGreaterThan(0);
    });

    it('returns medium confidence for moderate demand + below average', () => {
      const roi = predictor.estimateROI(70, 15, -10);
      expect(roi.confidence).toBe('medium');
      expect(roi.estimatedROI).toBeGreaterThan(0);
    });

    it('returns negative ROI for above-average price', () => {
      const roi = predictor.estimateROI(50, 15, 20);
      expect(roi.estimatedROI).toBeLessThan(0);
    });

    it('returns low confidence for uncertain conditions', () => {
      const roi = predictor.estimateROI(30, 100, 5);
      expect(roi.confidence).toBe('low');
      expect(roi.estimatedROI).toBe(0);
    });

    it('always returns an integer estimatedROI', () => {
      const roi = predictor.estimateROI(75, 14, -18);
      expect(Number.isInteger(roi.estimatedROI)).toBe(true);
    });
  });
});
