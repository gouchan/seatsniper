/**
 * Database Connection Pool
 * Provides a shared pg Pool with health checking and graceful shutdown.
 */

import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// ============================================================================
// Pool Singleton
// ============================================================================

let pool: pg.Pool | null = null;

/**
 * Get or create the shared database pool.
 * The pool is lazy-initialized on first call.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    // If a full connection string is provided, use it exclusively.
    // Mixing connectionString with host/port/db causes ambiguous behaviour in pg.
    const connectionConfig: pg.PoolConfig = config.database.url
      ? { connectionString: config.database.url }
      : {
          host: config.database.host,
          port: config.database.port,
          database: config.database.name,
          user: config.database.user,
          password: config.database.password,
        };

    pool = new Pool({
      ...connectionConfig,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.error('[DB] Unexpected pool error', { error: err.message });
    });

    pool.on('connect', () => {
      logger.debug('[DB] New client connected');
    });
  }

  return pool;
}

/**
 * Run a single query (convenience wrapper).
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  const start = Date.now();
  const result = await p.query<T>(text, params);
  const duration = Date.now() - start;

  logger.debug('[DB] Query executed', {
    text: text.slice(0, 80),
    duration,
    rows: result.rowCount,
  });

  return result;
}

/**
 * Test database connectivity.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW() AS time');
    logger.info('[DB] Connection verified', { serverTime: result.rows[0].time });
    return true;
  } catch (error) {
    logger.error('[DB] Connection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Gracefully close the pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('[DB] Pool closed');
  }
}
