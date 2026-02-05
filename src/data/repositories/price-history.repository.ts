/**
 * Price History Repository
 * Stores and retrieves historical pricing data for value scoring.
 */

import { query } from '../database.js';
import { logger } from '../../utils/logger.js';
import type { HistoricalPrice } from '../../services/value-engine/value-score.types.js';

// ============================================================================
// Ensure MVP table exists (idempotent)
// ============================================================================

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(200) NOT NULL,
    section VARCHAR(100) NOT NULL,
    average_price NUMERIC(10,2) NOT NULL,
    lowest_price NUMERIC(10,2) NOT NULL,
    highest_price NUMERIC(10,2) NOT NULL,
    listing_count INTEGER NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_price_history_event_section
    ON price_history (event_id, section, recorded_at DESC);

  CREATE INDEX IF NOT EXISTS idx_price_history_event_time
    ON price_history (event_id, recorded_at DESC);
`;

export async function ensureTable(): Promise<void> {
  try {
    await query(CREATE_TABLE_SQL);
    logger.debug('[PriceHistoryRepo] Table ensured');
  } catch (error) {
    logger.warn('[PriceHistoryRepo] Could not ensure table', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Record a price snapshot for a section at an event.
 * Call this during each polling cycle to build historical data.
 */
export async function recordPriceSnapshot(params: {
  eventId: string;
  section: string;
  averagePrice: number;
  lowestPrice: number;
  highestPrice: number;
  listingCount: number;
}): Promise<void> {
  const sql = `
    INSERT INTO price_history (event_id, section, average_price, lowest_price, highest_price, listing_count)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;

  await query(sql, [
    params.eventId,
    params.section,
    params.averagePrice,
    params.lowestPrice,
    params.highestPrice,
    params.listingCount,
  ]);
}

/**
 * Record price snapshots for multiple sections in a single transaction.
 * More efficient for bulk updates during polling.
 */
export async function recordPriceSnapshots(
  eventId: string,
  sections: Array<{
    section: string;
    averagePrice: number;
    lowestPrice: number;
    highestPrice: number;
    listingCount: number;
  }>,
): Promise<void> {
  if (sections.length === 0) return;

  // Build a multi-row INSERT
  const values: unknown[] = [];
  const placeholders: string[] = [];

  sections.forEach((s, i) => {
    const offset = i * 6;
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
    values.push(eventId, s.section, s.averagePrice, s.lowestPrice, s.highestPrice, s.listingCount);
  });

  const sql = `
    INSERT INTO price_history (event_id, section, average_price, lowest_price, highest_price, listing_count)
    VALUES ${placeholders.join(', ')}
  `;

  await query(sql, values);
}

/**
 * Get historical price data for a specific event and section.
 * Returns data from the last N days.
 */
export async function getHistoricalPrices(
  eventId: string,
  section: string,
  daysBack: number = 30,
): Promise<HistoricalPrice[]> {
  const result = await query<{
    recorded_at: Date;
    section: string;
    average_price: string;
    lowest_price: string;
    highest_price: string;
    listing_count: number;
  }>(
    `SELECT recorded_at, section, average_price, lowest_price, highest_price, listing_count
     FROM price_history
     WHERE event_id = $1
       AND section = $2
       AND recorded_at > NOW() - ($3::numeric * interval '1 day')
     ORDER BY recorded_at DESC
     LIMIT 100`,
    [eventId, section, daysBack],
  );

  return result.rows.map(row => ({
    date: row.recorded_at,
    section: row.section,
    averagePrice: parseFloat(row.average_price),
    lowestPrice: parseFloat(row.lowest_price),
    highestPrice: parseFloat(row.highest_price),
    listingCount: row.listing_count,
  }));
}

/**
 * Get historical price data for all sections of an event.
 * Returns a Map keyed by section name.
 */
export async function getEventHistoricalPrices(
  eventId: string,
  daysBack: number = 30,
): Promise<Map<string, HistoricalPrice[]>> {
  const result = await query<{
    recorded_at: Date;
    section: string;
    average_price: string;
    lowest_price: string;
    highest_price: string;
    listing_count: number;
  }>(
    `SELECT recorded_at, section, average_price, lowest_price, highest_price, listing_count
     FROM price_history
     WHERE event_id = $1
       AND recorded_at > NOW() - ($2::numeric * interval '1 day')
     ORDER BY section, recorded_at DESC`,
    [eventId, daysBack],
  );

  const historyMap = new Map<string, HistoricalPrice[]>();

  for (const row of result.rows) {
    const entry: HistoricalPrice = {
      date: row.recorded_at,
      section: row.section,
      averagePrice: parseFloat(row.average_price),
      lowestPrice: parseFloat(row.lowest_price),
      highestPrice: parseFloat(row.highest_price),
      listingCount: row.listing_count,
    };

    const existing = historyMap.get(row.section) || [];
    existing.push(entry);
    historyMap.set(row.section, existing);
  }

  return historyMap;
}

/**
 * Clean up old price history data (run periodically).
 * Keeps data for events in the future + 7 days past.
 */
export async function pruneOldHistory(daysToKeep: number = 90): Promise<number> {
  const result = await query(
    `DELETE FROM price_history
     WHERE recorded_at < NOW() - ($1::numeric * interval '1 day')`,
    [daysToKeep],
  );

  const deleted = result.rowCount || 0;
  if (deleted > 0) {
    logger.info('[PriceHistoryRepo] Pruned old records', { deleted });
  }

  return deleted;
}
