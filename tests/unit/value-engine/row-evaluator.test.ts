/**
 * Row Evaluator Unit Tests
 * Tests: evaluate(), parseRowToRank(), isFrontRow(), estimateTotalRows()
 */

import { describe, it, expect } from 'vitest';
import { RowEvaluator } from '../../../src/services/value-engine/scoring/row-evaluator.js';

describe('RowEvaluator', () => {
  const evaluator = new RowEvaluator();

  // ==========================================================================
  // evaluate() — row position scoring
  // ==========================================================================

  describe('evaluate()', () => {
    it('returns 100 for front row', () => {
      expect(evaluator.evaluate(1, 20)).toBe(100);
    });

    it('returns at least 20 for the back row', () => {
      expect(evaluator.evaluate(20, 20)).toBeGreaterThanOrEqual(20);
    });

    it('returns 50 (neutral) for invalid totalRows', () => {
      expect(evaluator.evaluate(5, 0)).toBe(50);
    });

    it('returns 50 (neutral) for invalid rowRank', () => {
      expect(evaluator.evaluate(0, 20)).toBe(50);
    });

    it('caps rowRank at totalRows', () => {
      // rowRank > totalRows should be treated as last row
      const result = evaluator.evaluate(100, 20);
      expect(result).toBeGreaterThanOrEqual(20);
    });

    it('front rows score higher than back rows (non-linear)', () => {
      const row2 = evaluator.evaluate(2, 20);
      const row10 = evaluator.evaluate(10, 20);
      const row19 = evaluator.evaluate(19, 20);

      expect(row2).toBeGreaterThan(row10);
      expect(row10).toBeGreaterThan(row19);
    });

    it('scores decrease with sqrt curve (front rows disproportionately better)', () => {
      // Row 2 out of 20 should be much better than row 10 out of 20
      // due to sqrt-based scoring
      const row2 = evaluator.evaluate(2, 20);
      const row10 = evaluator.evaluate(10, 20);

      // Row 2 is 95% position, row 10 is ~50% position
      // The gap should be significant
      expect(row2 - row10).toBeGreaterThan(10);
    });
  });

  // ==========================================================================
  // parseRowToRank() — string to number parsing
  // ==========================================================================

  describe('parseRowToRank()', () => {
    it('parses numeric rows', () => {
      expect(evaluator.parseRowToRank('15')).toBe(15);
      expect(evaluator.parseRowToRank('1')).toBe(1);
      expect(evaluator.parseRowToRank('42')).toBe(42);
    });

    it('parses single letter rows (A=1, B=2, K=11)', () => {
      expect(evaluator.parseRowToRank('A')).toBe(1);
      expect(evaluator.parseRowToRank('B')).toBe(2);
      expect(evaluator.parseRowToRank('K')).toBe(11);
      expect(evaluator.parseRowToRank('Z')).toBe(26);
    });

    it('parses lowercase letters', () => {
      expect(evaluator.parseRowToRank('a')).toBe(1);
      expect(evaluator.parseRowToRank('k')).toBe(11);
    });

    it('parses double letter rows (AA=27)', () => {
      expect(evaluator.parseRowToRank('AA')).toBe(27);
      expect(evaluator.parseRowToRank('AB')).toBe(28);
    });

    it('parses "GA" as 1 (General Admission)', () => {
      expect(evaluator.parseRowToRank('GA')).toBe(1);
    });

    it('parses "GENERAL ADMISSION" as 1', () => {
      expect(evaluator.parseRowToRank('GENERAL ADMISSION')).toBe(1);
    });

    it('parses "PIT" as 1', () => {
      expect(evaluator.parseRowToRank('PIT')).toBe(1);
    });

    it('returns -1 for empty string', () => {
      expect(evaluator.parseRowToRank('')).toBe(-1);
    });

    it('returns -1 for unrecognized format', () => {
      expect(evaluator.parseRowToRank('XYZ')).toBe(-1);
      expect(evaluator.parseRowToRank('Row-5')).toBe(-1);
    });

    it('trims whitespace', () => {
      expect(evaluator.parseRowToRank('  5  ')).toBe(5);
      expect(evaluator.parseRowToRank('  A  ')).toBe(1);
    });
  });

  // ==========================================================================
  // isFrontRow()
  // ==========================================================================

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

    it('returns false for invalid ranks', () => {
      expect(evaluator.isFrontRow(0)).toBe(false);
      expect(evaluator.isFrontRow(-1)).toBe(false);
    });
  });

  // ==========================================================================
  // estimateTotalRows()
  // ==========================================================================

  describe('estimateTotalRows()', () => {
    it('returns 20 for PREMIUM (tier 1)', () => {
      expect(evaluator.estimateTotalRows(1)).toBe(20);
    });

    it('returns 30 for UPPER_PREMIUM (tier 2)', () => {
      expect(evaluator.estimateTotalRows(2)).toBe(30);
    });

    it('returns 25 for MID_TIER (tier 3)', () => {
      expect(evaluator.estimateTotalRows(3)).toBe(25);
    });

    it('returns 20 for UPPER_LEVEL (tier 4)', () => {
      expect(evaluator.estimateTotalRows(4)).toBe(20);
    });

    it('returns 15 for OBSTRUCTED (tier 5)', () => {
      expect(evaluator.estimateTotalRows(5)).toBe(15);
    });

    it('returns 25 for unknown tier', () => {
      expect(evaluator.estimateTotalRows(99)).toBe(25);
    });
  });
});
