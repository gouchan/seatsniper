/**
 * Value Score Types
 * Types for the ticket valuation algorithm
 */

import type { NormalizedListing } from '../../adapters/base/platform-adapter.interface.js';

// ============================================================================
// Scoring Configuration
// ============================================================================

/**
 * Weights for each component of the Value Score (must sum to 1.0)
 */
export interface ValueScoreWeights {
  /** How price compares to current market average (35%) */
  priceVsAverage: number;

  /** Quality of the section based on venue data (25%) */
  sectionQuality: number;

  /** Position within the section - front rows score higher (15%) */
  rowPosition: number;

  /** How price compares to historical data (15%) */
  historicalPricing: number;

  /** Predicted resale potential (10%) */
  resalePotential: number;
}

export const DEFAULT_WEIGHTS: ValueScoreWeights = {
  priceVsAverage: 0.35,
  sectionQuality: 0.25,
  rowPosition: 0.15,
  historicalPricing: 0.15,
  resalePotential: 0.10,
};

// ============================================================================
// Section Quality Types
// ============================================================================

/**
 * Section tier classification for venues
 * Lower number = better section
 */
export enum SectionTier {
  /** Floor, VIP, Club Level */
  PREMIUM = 1,

  /** Lower bowl center sections */
  UPPER_PREMIUM = 2,

  /** Lower bowl sides, upper bowl center */
  MID_TIER = 3,

  /** Upper bowl sides, balcony */
  UPPER_LEVEL = 4,

  /** Limited view, behind stage, obstructed */
  OBSTRUCTED = 5,
}

// ============================================================================
// Historical Price Data
// ============================================================================

export interface HistoricalPrice {
  date: Date;
  section: string;
  averagePrice: number;
  lowestPrice: number;
  highestPrice: number;
  listingCount: number;
}

// ============================================================================
// Value Score Input
// ============================================================================

export interface ValueScoreInput {
  /** The listing being scored */
  listing: NormalizedListing;

  /** Current average price for this event across all listings */
  averagePrice: number;

  /** Average price for this specific section */
  sectionAveragePrice?: number;

  /** Quality tier of this section */
  sectionTier: SectionTier;

  /** Row rank within section (1 = front row) */
  rowRank: number;

  /** Total number of rows in this section */
  totalRowsInSection: number;

  /** Historical price data for comparison */
  historicalPriceData: HistoricalPrice[];

  /** Event popularity score (0-100) */
  eventPopularity: number;

  /** Days until the event occurs */
  daysUntilEvent: number;
}

// ============================================================================
// Value Score Result
// ============================================================================

export type ValueRecommendation =
  | 'excellent'   // 85-100: Buy immediately
  | 'good'        // 70-84: Strong buy
  | 'fair'        // 55-69: Average value
  | 'below_average' // 40-54: Wait for better
  | 'poor';       // <40: Overpriced

export interface ValueScoreBreakdown {
  priceScore: number;
  sectionScore: number;
  rowScore: number;
  historicalScore: number;
  resaleScore: number;
}

export interface ValueScoreResult {
  /** Total value score (1-100) */
  totalScore: number;

  /** Individual component scores */
  breakdown: ValueScoreBreakdown;

  /** Human-readable recommendation */
  recommendation: ValueRecommendation;

  /** Explanation of the score */
  reasoning: string;

  /** Flags for special conditions */
  flags: {
    /** Price is at or near all-time low */
    isHistoricalLow: boolean;

    /** Section is premium tier */
    isPremiumSection: boolean;

    /** Front row within section */
    isFrontRow: boolean;

    /** Significantly below average price */
    isPriceOutlier: boolean;
  };
}

// ============================================================================
// Scored Listing (listing + score combined)
// ============================================================================

export interface ScoredListing {
  listing: NormalizedListing;
  score: ValueScoreResult;
}
