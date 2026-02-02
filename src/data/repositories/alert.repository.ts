/**
 * Alert Repository
 * Persists alert history for deduplication and audit logging.
 */

import { query } from '../database.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Ensure MVP table exists (idempotent)
// ============================================================================

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS alert_log (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(200) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'telegram',
    alert_type VARCHAR(30) NOT NULL DEFAULT 'high_value',
    top_score INTEGER,
    message_id VARCHAR(100),
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_alert_log_dedup
    ON alert_log (event_id, user_id, sent_at DESC);

  CREATE INDEX IF NOT EXISTS idx_alert_log_user
    ON alert_log (user_id, sent_at DESC);
`;

export async function ensureTable(): Promise<void> {
  try {
    await query(CREATE_TABLE_SQL);
    logger.debug('[AlertRepo] Table ensured');
  } catch (error) {
    logger.warn('[AlertRepo] Could not ensure table', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Operations
// ============================================================================

export async function recordAlert(params: {
  eventId: string;
  userId: string;
  channel: string;
  alertType: string;
  topScore: number;
  messageId?: string;
  success: boolean;
  errorMessage?: string;
}): Promise<void> {
  const sql = `
    INSERT INTO alert_log (event_id, user_id, channel, alert_type, top_score, message_id, success, error_message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `;

  await query(sql, [
    params.eventId,
    params.userId,
    params.channel,
    params.alertType,
    params.topScore,
    params.messageId || null,
    params.success,
    params.errorMessage || null,
  ]);
}

/**
 * Check if an alert was sent recently (within cooldown period).
 * Returns true if an alert exists within the cooldown window.
 */
export async function isAlertOnCooldown(
  eventId: string,
  userId: string,
  cooldownMs: number,
): Promise<boolean> {
  // Use make_interval with seconds to avoid SQL injection via string concatenation.
  // $3 is always a number (cooldownMs / 1000), but parameterized for safety.
  const cooldownSec = Math.max(0, Math.floor(cooldownMs / 1000));

  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM alert_log
      WHERE event_id = $1
        AND user_id = $2
        AND success = true
        AND sent_at > NOW() - ($3::numeric * interval '1 second')
    ) AS exists`,
    [eventId, userId, cooldownSec],
  );

  return result.rows[0]?.exists ?? false;
}

/**
 * Get recent alerts for a user (for /history command).
 */
export async function getRecentAlerts(
  userId: string,
  limit: number = 10,
): Promise<Array<{
  eventId: string;
  alertType: string;
  topScore: number;
  sentAt: Date;
}>> {
  const result = await query<{
    event_id: string;
    alert_type: string;
    top_score: number;
    sent_at: Date;
  }>(
    `SELECT event_id, alert_type, top_score, sent_at
     FROM alert_log
     WHERE user_id = $1 AND success = true
     ORDER BY sent_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows.map(row => ({
    eventId: row.event_id,
    alertType: row.alert_type,
    topScore: row.top_score,
    sentAt: row.sent_at,
  }));
}
