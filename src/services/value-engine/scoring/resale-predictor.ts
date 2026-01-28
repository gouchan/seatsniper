/**
 * Resale Predictor
 * Estimates resale potential based on event popularity and timing
 */

import { SectionTier } from '../value-score.types.js';

// ============================================================================
// Resale Predictor
// ============================================================================

export class ResalePredictor {
  /**
   * Predict resale potential and return score (0-100)
   * Higher score = better resale potential
   *
   * Factors:
   * - Event popularity (high demand = easier resale)
   * - Days until event (sweet spot is 7-30 days)
   * - Section tier (premium sections resell better)
   */
  predict(
    eventPopularity: number, // 0-100
    daysUntilEvent: number,
    sectionTier: SectionTier
  ): number {
    // Validate inputs
    const popularity = Math.min(100, Math.max(0, eventPopularity));
    const days = Math.max(0, daysUntilEvent);

    // Calculate component scores
    const popularityScore = this.scorePopularity(popularity);
    const timingScore = this.scoreTiming(days);
    const sectionScore = this.scoreSection(sectionTier);

    // Weighted combination
    const weights = {
      popularity: 0.5,
      timing: 0.3,
      section: 0.2,
    };

    const totalScore =
      popularityScore * weights.popularity +
      timingScore * weights.timing +
      sectionScore * weights.section;

    return Math.round(totalScore);
  }

  /**
   * Estimate ROI potential based on current conditions
   * Returns estimated percentage gain/loss
   */
  estimateROI(
    eventPopularity: number,
    daysUntilEvent: number,
    currentPriceVsAverage: number // negative = below avg, positive = above avg
  ): {
    estimatedROI: number;
    confidence: 'high' | 'medium' | 'low';
    recommendation: string;
  } {
    const resaleScore = this.predict(
      eventPopularity,
      daysUntilEvent,
      SectionTier.MID_TIER
    );

    // Base ROI on resale potential and current price position
    let estimatedROI = 0;
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    let recommendation = '';

    if (resaleScore >= 80 && currentPriceVsAverage < -15) {
      // High demand event, significantly below average price
      estimatedROI = 20 + Math.abs(currentPriceVsAverage) * 0.5;
      confidence = 'high';
      recommendation = 'Strong resale potential - high demand with good price';
    } else if (resaleScore >= 60 && currentPriceVsAverage < 0) {
      // Moderate demand, below average
      estimatedROI = 10 + Math.abs(currentPriceVsAverage) * 0.3;
      confidence = 'medium';
      recommendation = 'Moderate resale potential';
    } else if (currentPriceVsAverage > 10) {
      // Above average price - risk of loss
      estimatedROI = -currentPriceVsAverage * 0.5;
      confidence = 'medium';
      recommendation = 'Caution - price above average may limit resale';
    } else {
      estimatedROI = 0;
      confidence = 'low';
      recommendation = 'Uncertain resale outcome';
    }

    return { estimatedROI: Math.round(estimatedROI), confidence, recommendation };
  }

  // ==========================================================================
  // Private Scoring Functions
  // ==========================================================================

  /**
   * Score based on event popularity (0-100 input → 0-100 output)
   * Higher popularity = easier to resell
   */
  private scorePopularity(popularity: number): number {
    // Non-linear: very popular events get bonus
    if (popularity >= 90) return 100;
    if (popularity >= 80) return 90;
    if (popularity >= 60) return 70;
    if (popularity >= 40) return 50;
    if (popularity >= 20) return 30;
    return 20;
  }

  /**
   * Score based on timing relative to event date
   * Sweet spot is 7-30 days (urgency without desperation)
   */
  private scoreTiming(daysUntilEvent: number): number {
    // Too close: buyers are fewer, desperation sales
    if (daysUntilEvent < 1) return 20;
    if (daysUntilEvent < 3) return 40;
    if (daysUntilEvent < 7) return 60;

    // Sweet spot: 7-30 days
    if (daysUntilEvent <= 30) return 100;

    // 30-60 days: still good
    if (daysUntilEvent <= 60) return 80;

    // 60-90 days: okay
    if (daysUntilEvent <= 90) return 60;

    // Far out: lower urgency from buyers
    if (daysUntilEvent <= 180) return 40;

    // Very far out
    return 30;
  }

  /**
   * Score based on section tier
   * Premium sections have better resale value
   */
  private scoreSection(tier: SectionTier): number {
    const tierScores: Record<SectionTier, number> = {
      [SectionTier.PREMIUM]: 100,
      [SectionTier.UPPER_PREMIUM]: 85,
      [SectionTier.MID_TIER]: 70,
      [SectionTier.UPPER_LEVEL]: 50,
      [SectionTier.OBSTRUCTED]: 30,
    };

    return tierScores[tier] ?? 50;
  }
}
