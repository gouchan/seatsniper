/**
 * Subscription Repository
 * Persists user monitoring subscriptions to PostgreSQL.
 *
 * Uses a `user_subscriptions` table (auto-created if missing) with support for:
 *   - City-level subscriptions with multi-city arrays
 *   - Budget cap (max_price_per_ticket)
 *   - Pause/resume without losing settings
 *   - User tier for future payment readiness
 */

import { query } from '../database.js';
import type { Subscription } from '../../services/monitoring/monitor.service.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Ensure MVP table exists (idempotent) + migrate new columns
// ============================================================================

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'telegram',
    cities TEXT[] NOT NULL DEFAULT '{}',
    min_score INTEGER NOT NULL DEFAULT 70,
    min_quantity INTEGER NOT NULL DEFAULT 1,
    max_price_per_ticket INTEGER NOT NULL DEFAULT 0,
    keywords TEXT[],
    categories TEXT[],
    active BOOLEAN NOT NULL DEFAULT true,
    paused BOOLEAN NOT NULL DEFAULT false,
    user_tier VARCHAR(20) NOT NULL DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_channel UNIQUE (user_id, channel)
  );
`;

/**
 * Add new columns to existing tables (safe — uses IF NOT EXISTS pattern).
 * This handles upgrades from the original schema without requiring migrations.
 */
const MIGRATE_COLUMNS_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'max_price_per_ticket') THEN
      ALTER TABLE user_subscriptions ADD COLUMN max_price_per_ticket INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'paused') THEN
      ALTER TABLE user_subscriptions ADD COLUMN paused BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_subscriptions' AND column_name = 'user_tier') THEN
      ALTER TABLE user_subscriptions ADD COLUMN user_tier VARCHAR(20) NOT NULL DEFAULT 'free';
    END IF;
  END $$;
`;

export async function ensureTable(): Promise<void> {
  try {
    await query(CREATE_TABLE_SQL);
    await query(MIGRATE_COLUMNS_SQL);
    logger.debug('[SubRepo] Table ensured (with new columns)');
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
    INSERT INTO user_subscriptions (
      user_id, channel, cities, min_score, min_quantity, max_price_per_ticket,
      keywords, categories, active, paused, user_tier
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (user_id, channel)
    DO UPDATE SET
      cities = EXCLUDED.cities,
      min_score = EXCLUDED.min_score,
      min_quantity = EXCLUDED.min_quantity,
      max_price_per_ticket = EXCLUDED.max_price_per_ticket,
      keywords = EXCLUDED.keywords,
      categories = EXCLUDED.categories,
      active = EXCLUDED.active,
      paused = EXCLUDED.paused,
      user_tier = EXCLUDED.user_tier,
      updated_at = NOW()
  `;

  await query(sql, [
    sub.userId,
    sub.channel,
    sub.cities,
    sub.minScore,
    sub.minQuantity,
    sub.maxPricePerTicket,
    sub.keywords || null,
    sub.categories || null,
    sub.active,
    sub.paused,
    sub.userTier,
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
    max_price_per_ticket: number;
    keywords: string[] | null;
    categories: string[] | null;
    active: boolean;
    paused: boolean;
    user_tier: string;
  }>(`SELECT * FROM user_subscriptions WHERE active = true`);

  return result.rows.map(row => mapRow(row));
}

export async function getSubscriptionByUser(userId: string): Promise<Subscription | null> {
  const result = await query<{
    user_id: string;
    channel: 'telegram' | 'sms' | 'whatsapp';
    cities: string[];
    min_score: number;
    min_quantity: number;
    max_price_per_ticket: number;
    keywords: string[] | null;
    categories: string[] | null;
    active: boolean;
    paused: boolean;
    user_tier: string;
  }>(
    `SELECT * FROM user_subscriptions WHERE user_id = $1 AND active = true LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

// ============================================================================
// Row Mapper
// ============================================================================

function mapRow(row: {
  user_id: string;
  channel: 'telegram' | 'sms' | 'whatsapp';
  cities: string[];
  min_score: number;
  min_quantity: number;
  max_price_per_ticket: number;
  keywords: string[] | null;
  categories: string[] | null;
  active: boolean;
  paused: boolean;
  user_tier: string;
}): Subscription {
  return {
    userId: row.user_id,
    channel: row.channel,
    cities: row.cities,
    minScore: row.min_score,
    minQuantity: row.min_quantity,
    maxPricePerTicket: row.max_price_per_ticket ?? 0,
    keywords: row.keywords || undefined,
    categories: row.categories || undefined,
    active: row.active,
    paused: row.paused ?? false,
    userTier: (row.user_tier as Subscription['userTier']) ?? 'free',
  };
}
