/**
 * Event Matching Service
 * Matches identical events across different ticket platforms using
 * fuzzy name matching, venue comparison, and date/time proximity.
 */

import type { NormalizedEvent } from '../../adapters/base/platform-adapter.interface.js';
import { getVenueCanonicalName } from './venue-aliases.js';

// ============================================================================
// Types
// ============================================================================

export interface EventMatch {
  groupId: string;
  canonicalName: string;
  venueName: string;
  eventDate: Date;
  events: Map<string, NormalizedEvent>; // platform -> event
  confidence: number; // 0-100
}

// ============================================================================
// Levenshtein Distance (for fuzzy string matching)
// ============================================================================

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity between two strings (0-100)
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 100;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return Math.round((1 - distance / maxLength) * 100);
}

// ============================================================================
// Event Name Normalization
// ============================================================================

/**
 * Normalize event name for comparison:
 * - Lowercase
 * - Remove "vs" / "vs." / "v." variations
 * - Remove extra whitespace
 * - Remove common suffixes like "Tickets" or "Live"
 */
function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bvs\.?\b/gi, 'vs')
    .replace(/\bv\.?\b/gi, 'vs')
    .replace(/\btickets?\b/gi, '')
    .replace(/\blive\b/gi, '')
    .replace(/\bconcert\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Matching Logic
// ============================================================================

/**
 * Check if two events match based on name, venue, and date
 */
function eventsMatch(a: NormalizedEvent, b: NormalizedEvent): { match: boolean; confidence: number } {
  // 1. Compare dates (must be within 30 minutes)
  const timeDiff = Math.abs(a.dateTime.getTime() - b.dateTime.getTime());
  const thirtyMinutes = 30 * 60 * 1000;
  if (timeDiff > thirtyMinutes) {
    return { match: false, confidence: 0 };
  }

  // 2. Compare venues (must match or be known aliases)
  const venueA = getVenueCanonicalName(a.venue.name);
  const venueB = getVenueCanonicalName(b.venue.name);
  if (venueA !== venueB) {
    return { match: false, confidence: 0 };
  }

  // 3. Compare event names (fuzzy match, >85% similarity)
  const nameA = normalizeEventName(a.name);
  const nameB = normalizeEventName(b.name);
  const nameSimilarity = stringSimilarity(nameA, nameB);

  if (nameSimilarity < 85) {
    return { match: false, confidence: 0 };
  }

  // Calculate overall confidence
  // 50% from name similarity, 30% from exact venue, 20% from time proximity
  const timeScore = Math.round((1 - timeDiff / thirtyMinutes) * 100);
  const confidence = Math.round(
    nameSimilarity * 0.5 +
    100 * 0.3 + // venue matched exactly
    timeScore * 0.2
  );

  return { match: true, confidence };
}

/**
 * Generate a group ID for matched events
 */
function generateGroupId(event: NormalizedEvent): string {
  const venueName = getVenueCanonicalName(event.venue.name);
  const dateStr = event.dateTime.toISOString().slice(0, 10); // YYYY-MM-DD
  const nameHash = normalizeEventName(event.name).slice(0, 30).replace(/\s+/g, '-');
  return `${nameHash}_${venueName.toLowerCase().replace(/\s+/g, '-')}_${dateStr}`;
}

// ============================================================================
// Main Matching Function
// ============================================================================

/**
 * Match events across platforms.
 * Returns a list of EventMatch groups where each group contains
 * the same event from different platforms.
 */
export function matchEvents(events: NormalizedEvent[]): EventMatch[] {
  const matches: EventMatch[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const eventA = events[i];
    const keyA = `${eventA.platform}:${eventA.platformId}`;

    if (processed.has(keyA)) continue;

    // Start a new group with this event
    const group: EventMatch = {
      groupId: generateGroupId(eventA),
      canonicalName: eventA.name,
      venueName: getVenueCanonicalName(eventA.venue.name),
      eventDate: eventA.dateTime,
      events: new Map([[eventA.platform, eventA]]),
      confidence: 100,
    };

    processed.add(keyA);

    // Find matching events from other platforms
    for (let j = i + 1; j < events.length; j++) {
      const eventB = events[j];
      const keyB = `${eventB.platform}:${eventB.platformId}`;

      if (processed.has(keyB)) continue;
      if (eventA.platform === eventB.platform) continue; // Same platform, skip

      const result = eventsMatch(eventA, eventB);
      if (result.match) {
        group.events.set(eventB.platform, eventB);
        group.confidence = Math.min(group.confidence, result.confidence);
        processed.add(keyB);
      }
    }

    // Only include groups with events from multiple platforms
    if (group.events.size > 1) {
      matches.push(group);
    }
  }

  return matches;
}

/**
 * Find cross-platform matches for a specific event
 */
export function findMatchesForEvent(
  targetEvent: NormalizedEvent,
  allEvents: NormalizedEvent[]
): EventMatch | null {
  const matchingEvents = new Map<string, NormalizedEvent>();
  matchingEvents.set(targetEvent.platform, targetEvent);

  let minConfidence = 100;

  for (const event of allEvents) {
    if (event.platform === targetEvent.platform) continue;
    if (event.platformId === targetEvent.platformId) continue;

    const result = eventsMatch(targetEvent, event);
    if (result.match) {
      matchingEvents.set(event.platform, event);
      minConfidence = Math.min(minConfidence, result.confidence);
    }
  }

  if (matchingEvents.size <= 1) {
    return null;
  }

  return {
    groupId: generateGroupId(targetEvent),
    canonicalName: targetEvent.name,
    venueName: getVenueCanonicalName(targetEvent.venue.name),
    eventDate: targetEvent.dateTime,
    events: matchingEvents,
    confidence: minConfidence,
  };
}
