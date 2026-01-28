/**
 * Price Analyzer
 * Calculates price-based components of the Value Score
 */

import type { HistoricalPrice } from '../value-score.types.js';

// ============================================================================
// Price Analyzer
// ============================================================================

export class PriceAnalyzer {
  /**
   * Analyze price vs current market average
   * Returns score 0-100 where lower price relative to average = higher score
   *
   * Scoring logic:
   * - 50% below average → 100
   * - At average → 50
   * - 50% above average → 0
   */
  analyze(price: number, averagePrice: number): number {
    if (averagePrice <= 0) return 50; // No data, neutral score

    const priceDifferencePercent = ((averagePrice - price) / averagePrice) * 100;

    // Map to 0-100 score:
    // Clamped linear mapping from [-50%, +50%] to [0, 100]
    const score = 50 + priceDifferencePercent;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Analyze price vs historical data
   * Returns score 0-100 based on how price compares to historical trends
   *
   * Scoring logic:
   * - At or below all-time low → 100
   * - Between lowest and average → 50-100
   * - At average → 50
   * - Above average → 0-50
   */
  analyzeHistorical(
    currentPrice: number,
    historicalData: HistoricalPrice[]
  ): number {
    if (historicalData.length === 0) return 50; // No data, neutral score

    // Calculate historical metrics
    const avgHistoricalPrice = this.calculateWeightedAverage(historicalData);
    const lowestHistoricalPrice = this.findLowestPrice(historicalData);

    // At or below historical low - excellent!
    if (currentPrice <= lowestHistoricalPrice) {
      return 100;
    }

    // Above historical average - penalize
    if (currentPrice >= avgHistoricalPrice) {
      const overage = (currentPrice - avgHistoricalPrice) / avgHistoricalPrice;
      // Map 0-50% above average to 50-0 score
      return Math.max(0, Math.round(50 - overage * 100));
    }

    // Between lowest and average - interpolate
    const range = avgHistoricalPrice - lowestHistoricalPrice;
    if (range === 0) return 75; // All prices the same

    const position = (avgHistoricalPrice - currentPrice) / range;
    // Map position (0 = at average, 1 = at lowest) to (50, 100)
    return Math.round(50 + position * 50);
  }

  /**
   * Check if price is at or near historical low
   */
  isHistoricalLow(
    currentPrice: number,
    historicalData: HistoricalPrice[],
    threshold: number = 0.05 // 5% tolerance
  ): boolean {
    if (historicalData.length === 0) return false;

    const lowestPrice = this.findLowestPrice(historicalData);
    return currentPrice <= lowestPrice * (1 + threshold);
  }

  /**
   * Check if price is significantly below average (outlier)
   */
  isPriceOutlier(
    currentPrice: number,
    averagePrice: number,
    threshold: number = 0.25 // 25% below average
  ): boolean {
    if (averagePrice <= 0) return false;

    const percentBelow = (averagePrice - currentPrice) / averagePrice;
    return percentBelow >= threshold;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Calculate weighted average price, giving more weight to recent data
   */
  private calculateWeightedAverage(data: HistoricalPrice[]): number {
    if (data.length === 0) return 0;

    // Sort by date descending (most recent first)
    const sorted = [...data].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );

    // Apply decay factor - more recent data has more weight
    let weightSum = 0;
    let valueSum = 0;
    const decayFactor = 0.9;

    sorted.forEach((point, index) => {
      const weight = Math.pow(decayFactor, index);
      weightSum += weight;
      valueSum += point.averagePrice * weight;
    });

    return valueSum / weightSum;
  }

  /**
   * Find the lowest recorded price from historical data
   */
  private findLowestPrice(data: HistoricalPrice[]): number {
    if (data.length === 0) return 0;

    return Math.min(...data.map(d => d.lowestPrice));
  }
}
