/**
 * Section Ranker
 * Evaluates section quality based on venue data
 */

import { SectionTier } from '../value-score.types.js';

// ============================================================================
// Section Ranker
// ============================================================================

export class SectionRanker {
  /**
   * Convert section tier to score (0-100)
   *
   * Tier mapping:
   * - PREMIUM (1) → 100
   * - UPPER_PREMIUM (2) → 80
   * - MID_TIER (3) → 60
   * - UPPER_LEVEL (4) → 40
   * - OBSTRUCTED (5) → 20
   */
  rank(tier: SectionTier): number {
    const tierScores: Record<SectionTier, number> = {
      [SectionTier.PREMIUM]: 100,
      [SectionTier.UPPER_PREMIUM]: 80,
      [SectionTier.MID_TIER]: 60,
      [SectionTier.UPPER_LEVEL]: 40,
      [SectionTier.OBSTRUCTED]: 20,
    };

    return tierScores[tier] ?? 50; // Default to mid score if unknown
  }

  /**
   * Determine section tier from section name using venue data
   */
  getTierFromSectionName(
    sectionName: string,
    sectionTiers: Record<string, number>
  ): SectionTier {
    // Normalize section name for lookup
    const normalized = this.normalizeSectionName(sectionName);

    // Direct match
    if (sectionTiers[sectionName] !== undefined) {
      return sectionTiers[sectionName] as SectionTier;
    }

    // Normalized match
    if (sectionTiers[normalized] !== undefined) {
      return sectionTiers[normalized] as SectionTier;
    }

    // Partial match (e.g., "Section 102" → "102")
    const numericPart = sectionName.replace(/\D/g, '');
    if (numericPart && sectionTiers[numericPart] !== undefined) {
      return sectionTiers[numericPart] as SectionTier;
    }

    // Heuristic fallback based on common patterns
    return this.inferTierFromName(sectionName);
  }

  /**
   * Check if a section is premium tier (1 or 2)
   */
  isPremiumSection(tier: SectionTier): boolean {
    return tier === SectionTier.PREMIUM || tier === SectionTier.UPPER_PREMIUM;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Normalize section name for consistent lookup
   */
  private normalizeSectionName(name: string): string {
    return name
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .replace(/SECTION\s*/i, '')
      .replace(/SEC\s*/i, '');
  }

  /**
   * Infer tier from section name patterns when venue data unavailable
   */
  private inferTierFromName(name: string): SectionTier {
    const lower = name.toLowerCase();

    // Premium indicators
    if (
      lower.includes('floor') ||
      lower.includes('pit') ||
      lower.includes('vip') ||
      lower.includes('club') ||
      lower.includes('courtside') ||
      lower.includes('field') ||
      lower.includes('diamond')
    ) {
      return SectionTier.PREMIUM;
    }

    // Upper premium indicators
    if (
      lower.includes('lower') ||
      lower.includes('terrace') ||
      lower.includes('box')
    ) {
      return SectionTier.UPPER_PREMIUM;
    }

    // Upper level indicators
    if (
      lower.includes('upper') ||
      lower.includes('balcony') ||
      lower.includes('gallery') ||
      lower.includes('mezzanine')
    ) {
      return SectionTier.UPPER_LEVEL;
    }

    // Obstructed indicators
    if (
      lower.includes('obstructed') ||
      lower.includes('limited') ||
      lower.includes('partial') ||
      lower.includes('behind')
    ) {
      return SectionTier.OBSTRUCTED;
    }

    // Numeric section heuristics
    const numericMatch = name.match(/(\d+)/);
    if (numericMatch) {
      const num = parseInt(numericMatch[1], 10);

      // Common arena patterns: 100s = lower, 200s = mid, 300s = upper
      if (num >= 100 && num < 200) return SectionTier.UPPER_PREMIUM;
      if (num >= 200 && num < 300) return SectionTier.MID_TIER;
      if (num >= 300) return SectionTier.UPPER_LEVEL;
    }

    // Default to mid-tier
    return SectionTier.MID_TIER;
  }
}
