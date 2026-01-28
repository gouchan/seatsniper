/**
 * Value Engine Service
 * Core service for calculating ticket Value Scores
 */

import type { NormalizedListing } from '../../adapters/base/platform-adapter.interface.js';
import {
  ValueScoreWeights,
  ValueScoreInput,
  ValueScoreResult,
  ValueRecommendation,
  ScoredListing,
  DEFAULT_WEIGHTS,
  SectionTier,
} from './value-score.types.js';
import { PriceAnalyzer } from './scoring/price-analyzer.js';
import { SectionRanker } from './scoring/section-ranker.js';
import { RowEvaluator } from './scoring/row-evaluator.js';
import { ResalePredictor } from './scoring/resale-predictor.js';

// ============================================================================
// Value Engine Service
// ============================================================================

export class ValueEngineService {
  private readonly weights: ValueScoreWeights;
  private readonly priceAnalyzer: PriceAnalyzer;
  private readonly sectionRanker: SectionRanker;
  private readonly rowEvaluator: RowEvaluator;
  private readonly resalePredictor: ResalePredictor;

  constructor(weights: ValueScoreWeights = DEFAULT_WEIGHTS) {
    // Validate weights sum to 1.0
    const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1.0) > 0.001) {
      throw new Error(`Value score weights must sum to 1.0, got ${weightSum}`);
    }

    this.weights = weights;
    this.priceAnalyzer = new PriceAnalyzer();
    this.sectionRanker = new SectionRanker();
    this.rowEvaluator = new RowEvaluator();
    this.resalePredictor = new ResalePredictor();
  }

  // ==========================================================================
  // Main Scoring Method
  // ==========================================================================

  /**
   * Calculate Value Score for a single listing
   */
  calculateValueScore(input: ValueScoreInput): ValueScoreResult {
    // 1. Price vs Average (35%)
    const priceScore = this.priceAnalyzer.analyze(
      input.listing.pricePerTicket,
      input.averagePrice
    );

    // 2. Section Quality (25%)
    const sectionScore = this.sectionRanker.rank(input.sectionTier);

    // 3. Row Position (15%)
    const rowScore = this.rowEvaluator.evaluate(
      input.rowRank,
      input.totalRowsInSection
    );

    // 4. Historical Pricing (15%)
    const historicalScore = this.priceAnalyzer.analyzeHistorical(
      input.listing.pricePerTicket,
      input.historicalPriceData
    );

    // 5. Resale Potential (10%)
    const resaleScore = this.resalePredictor.predict(
      input.eventPopularity,
      input.daysUntilEvent,
      input.sectionTier
    );

    // Calculate weighted total
    const totalScore = Math.round(
      priceScore * this.weights.priceVsAverage +
      sectionScore * this.weights.sectionQuality +
      rowScore * this.weights.rowPosition +
      historicalScore * this.weights.historicalPricing +
      resaleScore * this.weights.resalePotential
    );

    // Clamp to 1-100 range
    const clampedScore = Math.min(100, Math.max(1, totalScore));

    // Generate result
    const result: ValueScoreResult = {
      totalScore: clampedScore,
      breakdown: {
        priceScore,
        sectionScore,
        rowScore,
        historicalScore,
        resaleScore,
      },
      recommendation: this.getRecommendation(clampedScore),
      reasoning: this.generateReasoning(
        { priceScore, sectionScore, rowScore, historicalScore, resaleScore },
        clampedScore,
        input
      ),
      flags: {
        isHistoricalLow: this.priceAnalyzer.isHistoricalLow(
          input.listing.pricePerTicket,
          input.historicalPriceData
        ),
        isPremiumSection: this.sectionRanker.isPremiumSection(input.sectionTier),
        isFrontRow: this.rowEvaluator.isFrontRow(input.rowRank),
        isPriceOutlier: this.priceAnalyzer.isPriceOutlier(
          input.listing.pricePerTicket,
          input.averagePrice
        ),
      },
    };

    return result;
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  /**
   * Score multiple listings for an event
   */
  scoreListings(
    listings: NormalizedListing[],
    context: {
      averagePrice: number;
      sectionTiers: Record<string, number>;
      historicalData: Map<string, ValueScoreInput['historicalPriceData']>;
      eventPopularity: number;
      daysUntilEvent: number;
    }
  ): ScoredListing[] {
    return listings.map(listing => {
      const sectionTier = this.sectionRanker.getTierFromSectionName(
        listing.section,
        context.sectionTiers
      );

      const rowRank = this.rowEvaluator.parseRowToRank(listing.row);
      const totalRows = this.rowEvaluator.estimateTotalRows(sectionTier);

      const input: ValueScoreInput = {
        listing,
        averagePrice: context.averagePrice,
        sectionAveragePrice: undefined, // Could be enhanced
        sectionTier,
        rowRank: rowRank > 0 ? rowRank : Math.ceil(totalRows / 2), // Default to middle
        totalRowsInSection: totalRows,
        historicalPriceData: context.historicalData.get(listing.section) || [],
        eventPopularity: context.eventPopularity,
        daysUntilEvent: context.daysUntilEvent,
      };

      return {
        listing,
        score: this.calculateValueScore(input),
      };
    });
  }

  /**
   * Get top N value picks from scored listings
   */
  getTopValuePicks(
    scoredListings: ScoredListing[],
    limit: number = 10
  ): ScoredListing[] {
    return [...scoredListings]
      .sort((a, b) => b.score.totalScore - a.score.totalScore)
      .slice(0, limit);
  }

  /**
   * Filter listings by minimum score threshold
   */
  filterByMinScore(
    scoredListings: ScoredListing[],
    minScore: number
  ): ScoredListing[] {
    return scoredListings.filter(sl => sl.score.totalScore >= minScore);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Calculate average price from listings
   */
  calculateAveragePrice(listings: NormalizedListing[]): number {
    if (listings.length === 0) return 0;

    const total = listings.reduce((sum, l) => sum + l.pricePerTicket, 0);
    return total / listings.length;
  }

  /**
   * Get section tier for a listing
   */
  getSectionTier(
    sectionName: string,
    sectionTiers: Record<string, number>
  ): SectionTier {
    return this.sectionRanker.getTierFromSectionName(sectionName, sectionTiers);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Map total score to recommendation
   */
  private getRecommendation(score: number): ValueRecommendation {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 55) return 'fair';
    if (score >= 40) return 'below_average';
    return 'poor';
  }

  /**
   * Generate human-readable reasoning for the score
   */
  private generateReasoning(
    breakdown: ValueScoreResult['breakdown'],
    totalScore: number,
    input: ValueScoreInput
  ): string {
    const reasons: string[] = [];

    // Price analysis
    if (breakdown.priceScore >= 75) {
      const percentBelow = Math.round(
        ((input.averagePrice - input.listing.pricePerTicket) / input.averagePrice) * 100
      );
      if (percentBelow > 0) {
        reasons.push(`${percentBelow}% below average price`);
      }
    } else if (breakdown.priceScore <= 40) {
      reasons.push('Above average price');
    }

    // Section analysis
    if (breakdown.sectionScore >= 80) {
      reasons.push('Premium seating location');
    } else if (breakdown.sectionScore <= 40) {
      reasons.push('Upper level or obstructed view');
    }

    // Row analysis
    if (breakdown.rowScore >= 90) {
      reasons.push('Front row position');
    }

    // Historical analysis
    if (breakdown.historicalScore >= 90) {
      reasons.push('Near historical low price');
    }

    // Resale analysis
    if (breakdown.resaleScore >= 80) {
      reasons.push('High resale potential');
    }

    // Default reasoning if nothing stands out
    if (reasons.length === 0) {
      if (totalScore >= 70) {
        reasons.push('Solid overall value based on multiple factors');
      } else if (totalScore >= 50) {
        reasons.push('Average value - compare with other options');
      } else {
        reasons.push('Below average value - consider waiting for better deals');
      }
    }

    return reasons.join('. ') + '.';
  }
}
