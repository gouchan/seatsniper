/**
 * Section Ranker Unit Tests
 * Tests: rank(), getTierFromSectionName(), isPremiumSection()
 */

import { describe, it, expect } from 'vitest';
import { SectionRanker } from '../../../src/services/value-engine/scoring/section-ranker.js';
import { SectionTier } from '../../../src/services/value-engine/value-score.types.js';

describe('SectionRanker', () => {
  const ranker = new SectionRanker();

  // ==========================================================================
  // rank() — tier to score conversion
  // ==========================================================================

  describe('rank()', () => {
    it('returns 100 for PREMIUM', () => {
      expect(ranker.rank(SectionTier.PREMIUM)).toBe(100);
    });

    it('returns 80 for UPPER_PREMIUM', () => {
      expect(ranker.rank(SectionTier.UPPER_PREMIUM)).toBe(80);
    });

    it('returns 60 for MID_TIER', () => {
      expect(ranker.rank(SectionTier.MID_TIER)).toBe(60);
    });

    it('returns 40 for UPPER_LEVEL', () => {
      expect(ranker.rank(SectionTier.UPPER_LEVEL)).toBe(40);
    });

    it('returns 20 for OBSTRUCTED', () => {
      expect(ranker.rank(SectionTier.OBSTRUCTED)).toBe(20);
    });
  });

  // ==========================================================================
  // getTierFromSectionName() — section name resolution
  // ==========================================================================

  describe('getTierFromSectionName()', () => {
    it('does direct lookup when section name exists in map', () => {
      const tiers = { 'Section 102': SectionTier.UPPER_PREMIUM };
      expect(ranker.getTierFromSectionName('Section 102', tiers)).toBe(SectionTier.UPPER_PREMIUM);
    });

    it('does normalized lookup (case insensitive)', () => {
      const tiers = { '102': SectionTier.UPPER_PREMIUM };
      expect(ranker.getTierFromSectionName('Section 102', tiers)).toBe(SectionTier.UPPER_PREMIUM);
    });

    it('infers PREMIUM from "Floor" name', () => {
      expect(ranker.getTierFromSectionName('Floor A', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers PREMIUM from "VIP" name', () => {
      expect(ranker.getTierFromSectionName('VIP Box 1', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers PREMIUM from "Pit" name', () => {
      expect(ranker.getTierFromSectionName('The Pit', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers PREMIUM from "Club" name', () => {
      expect(ranker.getTierFromSectionName('Club Level', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers PREMIUM from "Courtside" name', () => {
      expect(ranker.getTierFromSectionName('Courtside Row A', {})).toBe(SectionTier.PREMIUM);
    });

    it('infers UPPER_PREMIUM from "Lower" name', () => {
      expect(ranker.getTierFromSectionName('Lower Bowl 102', {})).toBe(SectionTier.UPPER_PREMIUM);
    });

    it('infers UPPER_PREMIUM from "Terrace" name', () => {
      expect(ranker.getTierFromSectionName('Terrace Level', {})).toBe(SectionTier.UPPER_PREMIUM);
    });

    it('infers UPPER_LEVEL from "Upper" name', () => {
      expect(ranker.getTierFromSectionName('Upper Deck 301', {})).toBe(SectionTier.UPPER_LEVEL);
    });

    it('infers UPPER_LEVEL from "Balcony" name', () => {
      expect(ranker.getTierFromSectionName('Balcony', {})).toBe(SectionTier.UPPER_LEVEL);
    });

    it('infers UPPER_LEVEL from "Mezzanine" name', () => {
      expect(ranker.getTierFromSectionName('Mezzanine 3', {})).toBe(SectionTier.UPPER_LEVEL);
    });

    it('infers OBSTRUCTED from "Limited" name', () => {
      expect(ranker.getTierFromSectionName('Limited View 205', {})).toBe(SectionTier.OBSTRUCTED);
    });

    it('infers OBSTRUCTED from "Obstructed" name', () => {
      expect(ranker.getTierFromSectionName('Obstructed View', {})).toBe(SectionTier.OBSTRUCTED);
    });

    it('infers UPPER_PREMIUM from numeric 100-199', () => {
      expect(ranker.getTierFromSectionName('Section 102', {})).toBe(SectionTier.UPPER_PREMIUM);
      expect(ranker.getTierFromSectionName('Section 150', {})).toBe(SectionTier.UPPER_PREMIUM);
    });

    it('infers MID_TIER from numeric 200-299', () => {
      expect(ranker.getTierFromSectionName('Section 204', {})).toBe(SectionTier.MID_TIER);
    });

    it('infers UPPER_LEVEL from numeric 300+', () => {
      expect(ranker.getTierFromSectionName('Section 308', {})).toBe(SectionTier.UPPER_LEVEL);
    });

    it('defaults to MID_TIER for unknown section names', () => {
      expect(ranker.getTierFromSectionName('Weird Section Name', {})).toBe(SectionTier.MID_TIER);
    });
  });

  // ==========================================================================
  // isPremiumSection()
  // ==========================================================================

  describe('isPremiumSection()', () => {
    it('returns true for PREMIUM', () => {
      expect(ranker.isPremiumSection(SectionTier.PREMIUM)).toBe(true);
    });

    it('returns true for UPPER_PREMIUM', () => {
      expect(ranker.isPremiumSection(SectionTier.UPPER_PREMIUM)).toBe(true);
    });

    it('returns false for MID_TIER and below', () => {
      expect(ranker.isPremiumSection(SectionTier.MID_TIER)).toBe(false);
      expect(ranker.isPremiumSection(SectionTier.UPPER_LEVEL)).toBe(false);
      expect(ranker.isPremiumSection(SectionTier.OBSTRUCTED)).toBe(false);
    });
  });
});
