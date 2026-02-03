/**
 * Row Evaluator
 * Evaluates row position within a section
 */

// ============================================================================
// Row Evaluator
// ============================================================================

export class RowEvaluator {
  /**
   * Evaluate row position and return score (0-100)
   * Front rows score higher than back rows
   *
   * @param rowRank Position of this row (1 = front row)
   * @param totalRows Total rows in the section
   */
  evaluate(rowRank: number, totalRows: number): number {
    // Handle edge cases
    if (totalRows <= 0) return 50; // No data
    if (rowRank <= 0) return 50; // Invalid input
    if (rowRank > totalRows) rowRank = totalRows; // Cap at max

    // Front row always gets 100
    if (rowRank === 1) return 100;

    // Calculate position percentage (0 = front, 1 = back)
    const position = (rowRank - 1) / (totalRows - 1);

    // Non-linear scoring: front rows are disproportionately better
    // Use square root to give more value to front positions
    const score = 100 - Math.sqrt(position) * 80;

    return Math.round(Math.max(20, score));
  }

  /**
   * Parse row string to numeric rank
   * Handles both numeric ("15") and alphabetic ("K") rows
   */
  parseRowToRank(row: string): number {
    if (!row || row.trim() === '') return -1;

    const trimmed = row.trim().toUpperCase();

    // Check for numeric row
    const numericMatch = trimmed.match(/^(\d+)$/);
    if (numericMatch) {
      return parseInt(numericMatch[1], 10);
    }

    // Handle special rows BEFORE letter-based parsing
    // (otherwise "GA" matches double-letter regex as G*26+A = 183)
    if (trimmed === 'GA' || trimmed === 'GENERAL ADMISSION') {
      return 1; // GA is typically good
    }
    if (trimmed === 'PIT') {
      return 1; // Pit is front
    }

    // Check for single letter row (A=1, B=2, etc.)
    const letterMatch = trimmed.match(/^([A-Z])$/);
    if (letterMatch) {
      return letterMatch[1].charCodeAt(0) - 'A'.charCodeAt(0) + 1;
    }

    // Check for double letter row (AA=27, AB=28, etc.)
    const doubleLetterMatch = trimmed.match(/^([A-Z])([A-Z])$/);
    if (doubleLetterMatch) {
      const first = doubleLetterMatch[1].charCodeAt(0) - 'A'.charCodeAt(0);
      const second = doubleLetterMatch[2].charCodeAt(0) - 'A'.charCodeAt(0) + 1;
      return 26 + first * 26 + second;
    }

    // Unknown format
    return -1;
  }

  /**
   * Check if this is a front row (top 3 rows)
   */
  isFrontRow(rowRank: number): boolean {
    return rowRank >= 1 && rowRank <= 3;
  }

  /**
   * Estimate total rows in a section based on section tier
   * Used when actual row count is unknown
   */
  estimateTotalRows(sectionTier: number): number {
    // Common row counts by section type
    const estimates: Record<number, number> = {
      1: 20, // Premium (floor, VIP) - often smaller
      2: 30, // Lower bowl
      3: 25, // Mid level
      4: 20, // Upper level
      5: 15, // Obstructed/gallery
    };

    return estimates[sectionTier] ?? 25;
  }
}
