/**
 * Event Group Repository
 * Stores and retrieves cross-platform event matches.
 */

import { query } from '../database.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface EventGroup {
  groupId: string;
  canonicalName: string;
  venueName: string;
  eventDate: Date;
  createdAt: Date;
}

export interface EventGroupMember {
  groupId: string;
  platform: string;
  platformEventId: string;
}

// ============================================================================
// Ensure Table Exists
// ============================================================================

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS event_groups (
    id SERIAL PRIMARY KEY,
    group_id VARCHAR(200) UNIQUE NOT NULL,
    canonical_name VARCHAR(500) NOT NULL,
    venue_name VARCHAR(200) NOT NULL,
    event_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_event_groups_date
    ON event_groups (event_date);

  CREATE TABLE IF NOT EXISTS event_group_members (
    id SERIAL PRIMARY KEY,
    group_id VARCHAR(200) NOT NULL REFERENCES event_groups(group_id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    platform_event_id VARCHAR(200) NOT NULL,
    UNIQUE (group_id, platform),
    UNIQUE (platform, platform_event_id)
  );

  CREATE INDEX IF NOT EXISTS idx_event_group_members_platform
    ON event_group_members (platform, platform_event_id);
`;

export async function ensureTable(): Promise<void> {
  try {
    await query(CREATE_TABLES_SQL);
    logger.debug('[EventGroupRepo] Tables ensured');
  } catch (error) {
    logger.warn('[EventGroupRepo] Could not ensure tables', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Save or update an event group with its members
 */
export async function upsertEventGroup(params: {
  groupId: string;
  canonicalName: string;
  venueName: string;
  eventDate: Date;
  members: { platform: string; platformEventId: string }[];
}): Promise<void> {
  // Insert or update the group
  await query(
    `INSERT INTO event_groups (group_id, canonical_name, venue_name, event_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       venue_name = EXCLUDED.venue_name,
       event_date = EXCLUDED.event_date`,
    [params.groupId, params.canonicalName, params.venueName, params.eventDate]
  );

  // Insert members (ignore conflicts)
  for (const member of params.members) {
    await query(
      `INSERT INTO event_group_members (group_id, platform, platform_event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, platform) DO UPDATE SET
         platform_event_id = EXCLUDED.platform_event_id`,
      [params.groupId, member.platform, member.platformEventId]
    );
  }
}

/**
 * Get event group by group ID
 */
export async function getEventGroup(groupId: string): Promise<EventGroup | null> {
  const result = await query<{
    group_id: string;
    canonical_name: string;
    venue_name: string;
    event_date: Date;
    created_at: Date;
  }>(
    `SELECT group_id, canonical_name, venue_name, event_date, created_at
     FROM event_groups
     WHERE group_id = $1`,
    [groupId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    groupId: row.group_id,
    canonicalName: row.canonical_name,
    venueName: row.venue_name,
    eventDate: row.event_date,
    createdAt: row.created_at,
  };
}

/**
 * Get all members of an event group
 */
export async function getEventGroupMembers(groupId: string): Promise<EventGroupMember[]> {
  const result = await query<{
    group_id: string;
    platform: string;
    platform_event_id: string;
  }>(
    `SELECT group_id, platform, platform_event_id
     FROM event_group_members
     WHERE group_id = $1`,
    [groupId]
  );

  return result.rows.map(row => ({
    groupId: row.group_id,
    platform: row.platform,
    platformEventId: row.platform_event_id,
  }));
}

/**
 * Find event group by platform and event ID
 */
export async function findGroupByPlatformEvent(
  platform: string,
  platformEventId: string
): Promise<EventGroup | null> {
  const result = await query<{
    group_id: string;
    canonical_name: string;
    venue_name: string;
    event_date: Date;
    created_at: Date;
  }>(
    `SELECT g.group_id, g.canonical_name, g.venue_name, g.event_date, g.created_at
     FROM event_groups g
     JOIN event_group_members m ON g.group_id = m.group_id
     WHERE m.platform = $1 AND m.platform_event_id = $2`,
    [platform, platformEventId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    groupId: row.group_id,
    canonicalName: row.canonical_name,
    venueName: row.venue_name,
    eventDate: row.event_date,
    createdAt: row.created_at,
  };
}

/**
 * Get all platform event IDs in a group (excluding a specific platform)
 */
export async function getCrossplatformEvents(
  groupId: string,
  excludePlatform?: string
): Promise<EventGroupMember[]> {
  let sql = `SELECT group_id, platform, platform_event_id FROM event_group_members WHERE group_id = $1`;
  const params: unknown[] = [groupId];

  if (excludePlatform) {
    sql += ` AND platform != $2`;
    params.push(excludePlatform);
  }

  const result = await query<{
    group_id: string;
    platform: string;
    platform_event_id: string;
  }>(sql, params);

  return result.rows.map(row => ({
    groupId: row.group_id,
    platform: row.platform,
    platformEventId: row.platform_event_id,
  }));
}

/**
 * Delete old event groups (past events)
 */
export async function pruneOldGroups(daysToKeep: number = 1): Promise<number> {
  const result = await query(
    `DELETE FROM event_groups
     WHERE event_date < NOW() - ($1::numeric * interval '1 day')`,
    [daysToKeep]
  );

  const deleted = result.rowCount || 0;
  if (deleted > 0) {
    logger.info('[EventGroupRepo] Pruned old groups', { deleted });
  }

  return deleted;
}
