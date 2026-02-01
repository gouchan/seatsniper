/**
 * Subscription Repository
 * Persists user monitoring subscriptions to PostgreSQL.
 *
 * Uses the `users` and `alert_subscriptions` tables, but for the MVP
 * we store city-level subscriptions in a simpler `user_subscriptions`
 * table (auto-created if missing) to avoid the full event-specific schema.
 */

import { query } from '../database.js';
import type { Subscription } from '../../services/monitoring/monitor.service.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Ensure MVP table exists (idempotent)
// ============================================================================

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'telegram',
    cities TEXT[] NOT NULL DEFAULT '{}',
    min_score INTEGER NOT NULL DEFAULT 70,
    min_quantity INTEGER NOT NULL DEFAULT 1,
    keywords TEXT[],
    categories TEXT[],
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_channel UNIQUE (user_id, channel)
  );
`;

export async function ensureTable(): Promise<void> {
  try {
    await query(CREATE_TABLE_SQL);
    logger.debug('[SubRepo] Table ensured');
  } catch (error) {
    logger.warn('[SubRepo] Could not ensure table', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function upsertSubscription(sub: Subscription): Promise<void> {
  const sql = `
    INSERT INTO user_subscriptions (user_id, channel, cities, min_score, min_quantity, keywords, categories, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id, channel)
    DO UPDATE SET
      cities = EXCLUDED.cities,
      min_score = EXCLUDED.min_score,
      min_quantity = EXCLUDED.min_quantity,
      keywords = EXCLUDED.keywords,
      categories = EXCLUDED.categories,
      active = EXCLUDED.active,
      updated_at = NOW()
  `;

  await query(sql, [
    sub.userId,
    sub.channel,
    sub.cities,
    sub.minScore,
    sub.minQuantity,
    sub.keywords || null,
    sub.categories || null,
    sub.active,
  ]);

  logger.debug('[SubRepo] Upserted subscription', { userId: sub.userId });
}

export async function removeSubscription(userId: string): Promise<void> {
  await query(
    `UPDATE user_subscriptions SET active = false, updated_at = NOW() WHERE user_id = $1`,
    [userId],
  );
  logger.debug('[SubRepo] Deactivated subscription', { userId });
}

export async function getActiveSubscriptions(): Promise<Subscription[]> {
  const result = await query<{
    user_id: string;
    channel: 'telegram' | 'sms' | 'whatsapp';
    cities: string[];
    min_score: number;
    min_quantity: number;
    keywords: string[] | null;
    categories: string[] | null;
    active: boolean;
  }>(`SELECT * FROM user_subscriptions WHERE active = true`);

  return result.rows.map(row => ({
    userId: row.user_id,
    channel: row.channel,
    cities: row.cities,
    minScore: row.min_score,
    minQuantity: row.min_quantity,
    keywords: row.keywords || undefined,
    categories: row.categories || undefined,
    active: row.active,
  }));
}

export async function getSubscriptionByUser(userId: string): Promise<Subscription | null> {
  const result = await query<{
    user_id: string;
    channel: 'telegram' | 'sms' | 'whatsapp';
    cities: string[];
    min_score: number;
    min_quantity: number;
    keywords: string[] | null;
    categories: string[] | null;
    active: boolean;
  }>(
    `SELECT * FROM user_subscriptions WHERE user_id = $1 AND active = true LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    userId: row.user_id,
    channel: row.channel,
    cities: row.cities,
    minScore: row.min_score,
    minQuantity: row.min_quantity,
    keywords: row.keywords || undefined,
    categories: row.categories || undefined,
    active: row.active,
  };
}
