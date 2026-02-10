/**
 * Watchlist Repository
 * Stores events that users are watching for price drops
 */

import { query } from '../database.js';
import { logger } from '../../utils/logger.js';
import type { NormalizedEvent, Platform } from '../../adapters/base/platform-adapter.interface.js';

// ============================================================================
// Types
// ============================================================================

export interface WatchedEvent {
  id: number;
  userId: string;
  platform: Platform;
  platformEventId: string;
  eventName: string;
  venueName: string;
  venueCity: string;
  eventDate: Date;
  eventUrl: string;
  imageUrl?: string;
  /** Price when user started watching */
  initialPriceMin?: number;
  initialPriceMax?: number;
  /** Last known price */
  lastPriceMin?: number;
  lastPriceMax?: number;
  /** Alert when price drops below this (optional) */
  priceAlertThreshold?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchedEventInput {
  userId: string;
  event: NormalizedEvent;
  priceAlertThreshold?: number;
}

// ============================================================================
// In-Memory Fallback (when DB unavailable)
// ============================================================================

const inMemoryWatchlist: Map<string, WatchedEvent[]> = new Map();
let inMemoryIdCounter = 1;

/** Max watched events per user to prevent abuse */
const MAX_WATCHED_PER_USER = 50;

// ============================================================================
// Schema
// ============================================================================

export async function ensureTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        platform VARCHAR(32) NOT NULL,
        platform_event_id VARCHAR(128) NOT NULL,
        event_name VARCHAR(512) NOT NULL,
        venue_name VARCHAR(256) NOT NULL,
        venue_city VARCHAR(128) NOT NULL,
        event_date TIMESTAMPTZ NOT NULL,
        event_url TEXT NOT NULL,
        image_url TEXT,
        initial_price_min DECIMAL(10, 2),
        initial_price_max DECIMAL(10, 2),
        last_price_min DECIMAL(10, 2),
        last_price_max DECIMAL(10, 2),
        price_alert_threshold DECIMAL(10, 2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, platform, platform_event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
      CREATE INDEX IF NOT EXISTS idx_watchlist_event_date ON watchlist(event_date);
    `);
    logger.debug('[WatchlistRepo] Table ensured');
  } catch (error) {
    logger.warn('[WatchlistRepo] Failed to create table (DB may be unavailable)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Add an event to user's watchlist
 */
export async function addToWatchlist(input: WatchedEventInput): Promise<WatchedEvent> {
  const { userId, event, priceAlertThreshold } = input;

  // Try database first
  try {
    const result = await query(
      `INSERT INTO watchlist (
        user_id, platform, platform_event_id, event_name, venue_name, venue_city,
        event_date, event_url, image_url, initial_price_min, initial_price_max,
        last_price_min, last_price_max, price_alert_threshold
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (user_id, platform, platform_event_id)
      DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        userId,
        event.platform,
        event.platformId,
        event.name,
        event.venue.name,
        event.venue.city,
        event.dateTime,
        event.url,
        event.imageUrl || null,
        event.priceRange?.min || null,
        event.priceRange?.max || null,
        event.priceRange?.min || null,
        event.priceRange?.max || null,
        priceAlertThreshold || null,
      ]
    );

    return mapRowToWatchedEvent(result.rows[0]);
  } catch (dbError) {
    // Fall back to in-memory
    logger.debug('[WatchlistRepo] DB unavailable, using in-memory');
    return addToWatchlistInMemory(input);
  }
}

function addToWatchlistInMemory(input: WatchedEventInput): WatchedEvent {
  const { userId, event, priceAlertThreshold } = input;

  let userWatchlist = inMemoryWatchlist.get(userId) || [];

  // Check for duplicate
  const existing = userWatchlist.find(
    w => w.platform === event.platform && w.platformEventId === event.platformId
  );
  if (existing) {
    existing.updatedAt = new Date();
    return existing;
  }

  // Enforce max limit
  if (userWatchlist.length >= MAX_WATCHED_PER_USER) {
    throw new Error(`Maximum ${MAX_WATCHED_PER_USER} watched events reached`);
  }

  const watched: WatchedEvent = {
    id: inMemoryIdCounter++,
    userId,
    platform: event.platform,
    platformEventId: event.platformId,
    eventName: event.name,
    venueName: event.venue.name,
    venueCity: event.venue.city,
    eventDate: event.dateTime,
    eventUrl: event.url,
    imageUrl: event.imageUrl,
    initialPriceMin: event.priceRange?.min,
    initialPriceMax: event.priceRange?.max,
    lastPriceMin: event.priceRange?.min,
    lastPriceMax: event.priceRange?.max,
    priceAlertThreshold,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  userWatchlist.push(watched);
  inMemoryWatchlist.set(userId, userWatchlist);

  return watched;
}

/**
 * Get user's watchlist
 */
export async function getWatchlist(userId: string): Promise<WatchedEvent[]> {
  try {
    const result = await query(
      `SELECT * FROM watchlist
       WHERE user_id = $1 AND event_date > NOW()
       ORDER BY event_date ASC`,
      [userId]
    );
    return result.rows.map(mapRowToWatchedEvent);
  } catch (dbError) {
    // Fall back to in-memory
    const userWatchlist = inMemoryWatchlist.get(userId) || [];
    const now = new Date();
    return userWatchlist.filter(w => w.eventDate > now);
  }
}

/**
 * Remove event from watchlist
 */
export async function removeFromWatchlist(userId: string, platform: string, platformEventId: string): Promise<boolean> {
  try {
    const result = await query(
      `DELETE FROM watchlist
       WHERE user_id = $1 AND platform = $2 AND platform_event_id = $3`,
      [userId, platform, platformEventId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (dbError) {
    // Fall back to in-memory
    const userWatchlist = inMemoryWatchlist.get(userId) || [];
    const before = userWatchlist.length;
    const filtered = userWatchlist.filter(
      w => !(w.platform === platform && w.platformEventId === platformEventId)
    );
    inMemoryWatchlist.set(userId, filtered);
    return filtered.length < before;
  }
}

/**
 * Check if user is watching an event
 */
export async function isWatching(userId: string, platform: string, platformEventId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT 1 FROM watchlist
       WHERE user_id = $1 AND platform = $2 AND platform_event_id = $3`,
      [userId, platform, platformEventId]
    );
    return result.rows.length > 0;
  } catch (dbError) {
    // Fall back to in-memory
    const userWatchlist = inMemoryWatchlist.get(userId) || [];
    return userWatchlist.some(
      w => w.platform === platform && w.platformEventId === platformEventId
    );
  }
}

/**
 * Update last known prices for a watched event
 */
export async function updatePrices(
  userId: string,
  platform: string,
  platformEventId: string,
  priceMin: number,
  priceMax: number
): Promise<void> {
  try {
    await query(
      `UPDATE watchlist
       SET last_price_min = $4, last_price_max = $5, updated_at = NOW()
       WHERE user_id = $1 AND platform = $2 AND platform_event_id = $3`,
      [userId, platform, platformEventId, priceMin, priceMax]
    );
  } catch (dbError) {
    // Fall back to in-memory
    const userWatchlist = inMemoryWatchlist.get(userId) || [];
    const watched = userWatchlist.find(
      w => w.platform === platform && w.platformEventId === platformEventId
    );
    if (watched) {
      watched.lastPriceMin = priceMin;
      watched.lastPriceMax = priceMax;
      watched.updatedAt = new Date();
    }
  }
}

/**
 * Get all watched events (for monitoring price changes)
 */
export async function getAllWatchedEvents(): Promise<WatchedEvent[]> {
  try {
    const result = await query(
      `SELECT * FROM watchlist WHERE event_date > NOW() ORDER BY event_date ASC`
    );
    return result.rows.map(mapRowToWatchedEvent);
  } catch (dbError) {
    // Fall back to in-memory
    const all: WatchedEvent[] = [];
    const now = new Date();
    for (const userWatchlist of inMemoryWatchlist.values()) {
      all.push(...userWatchlist.filter(w => w.eventDate > now));
    }
    return all;
  }
}

/**
 * Clear watchlist for user (for testing/reset)
 */
export async function clearWatchlist(userId: string): Promise<void> {
  try {
    await query(`DELETE FROM watchlist WHERE user_id = $1`, [userId]);
  } catch (dbError) {
    inMemoryWatchlist.delete(userId);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function mapRowToWatchedEvent(row: any): WatchedEvent {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform as Platform,
    platformEventId: row.platform_event_id,
    eventName: row.event_name,
    venueName: row.venue_name,
    venueCity: row.venue_city,
    eventDate: new Date(row.event_date),
    eventUrl: row.event_url,
    imageUrl: row.image_url || undefined,
    initialPriceMin: row.initial_price_min ? parseFloat(row.initial_price_min) : undefined,
    initialPriceMax: row.initial_price_max ? parseFloat(row.initial_price_max) : undefined,
    lastPriceMin: row.last_price_min ? parseFloat(row.last_price_min) : undefined,
    lastPriceMax: row.last_price_max ? parseFloat(row.last_price_max) : undefined,
    priceAlertThreshold: row.price_alert_threshold ? parseFloat(row.price_alert_threshold) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
