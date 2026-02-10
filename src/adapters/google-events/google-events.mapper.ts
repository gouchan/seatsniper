/**
 * Google Events Mapper
 * Transforms Google Events search results to normalized format
 */

import {
  NormalizedEvent,
  EventCategory,
  Platform,
} from '../base/platform-adapter.interface.js';
import type {
  GoogleEventItem,
  GoogleTicketSource,
  ExtractedTicketInfo,
} from './google-events.types.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * Map Google Events items to normalized events
 */
export function mapGoogleEventsToNormalized(events: GoogleEventItem[]): NormalizedEvent[] {
  return events
    .map(mapSingleEvent)
    .filter((event): event is NormalizedEvent => event !== null);
}

function mapSingleEvent(event: GoogleEventItem): NormalizedEvent | null {
  try {
    const dateTime = parseEventDateTime(event.date.when, event.date.start_date);
    if (!dateTime) {
      logger.debug(`[GoogleEvents] Skipping event with unparseable date: ${event.title}`);
      return null;
    }

    const venue = parseVenueInfo(event);
    const ticketInfo = extractTicketInfo(event.ticket_info);
    const priceRange = extractPriceRange(ticketInfo);
    const bestTicketUrl = selectBestTicketUrl(ticketInfo, event.link);

    return {
      platformId: generateEventId(event),
      platform: 'ticketmaster' as Platform, // Use ticketmaster as base platform
      name: event.title,
      venue: {
        id: generateVenueId(event.venue.name),
        name: event.venue.name,
        city: venue.city,
        state: venue.state,
      },
      dateTime,
      category: inferCategory(event.title, event.description),
      url: bestTicketUrl,
      imageUrl: event.image,
      priceRange,
    };
  } catch (error) {
    logger.warn(`[GoogleEvents] Error mapping event "${event.title}": ${error}`);
    return null;
  }
}

// ============================================================================
// Date Parsing
// ============================================================================

function parseEventDateTime(when: string, startDate: string): Date | null {
  try {
    // Example: "Thu, Feb 19, 8 – 10 PM"
    // Example: "Wed, Feb 11, 7 – 10 PM"
    const whenMatch = when.match(/(\w+),\s+(\w+)\s+(\d+),?\s+(\d+)(?::(\d+))?\s*(AM|PM)?/i);

    if (whenMatch) {
      const [, , month, day, hour, minute = '0', ampm] = whenMatch;
      const year = new Date().getFullYear();

      // If the date has passed this year, assume next year
      const monthIndex = getMonthIndex(month);
      let eventYear = year;

      const testDate = new Date(year, monthIndex, parseInt(day, 10));
      if (testDate < new Date()) {
        eventYear = year + 1;
      }

      let hours = parseInt(hour, 10);
      if (ampm?.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (ampm?.toUpperCase() === 'AM' && hours === 12) hours = 0;

      return new Date(eventYear, monthIndex, parseInt(day, 10), hours, parseInt(minute, 10));
    }

    // Try parsing startDate like "Feb 19"
    const startMatch = startDate.match(/(\w+)\s+(\d+)/);
    if (startMatch) {
      const [, month, day] = startMatch;
      const year = new Date().getFullYear();
      const monthIndex = getMonthIndex(month);

      let eventYear = year;
      const testDate = new Date(year, monthIndex, parseInt(day, 10));
      if (testDate < new Date()) {
        eventYear = year + 1;
      }

      return new Date(eventYear, monthIndex, parseInt(day, 10), 20, 0); // Default to 8 PM
    }

    return null;
  } catch (error) {
    logger.debug(`[GoogleEvents] Failed to parse date: ${when}, ${startDate}`);
    return null;
  }
}

function getMonthIndex(monthStr: string): number {
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  return months[monthStr.toLowerCase()] ?? 0;
}

// ============================================================================
// Venue Parsing
// ============================================================================

interface ParsedVenue {
  city: string;
  state: string;
}

function parseVenueInfo(event: GoogleEventItem): ParsedVenue {
  // Address is usually ["Venue Name, Address", "City, State"]
  const cityStateAddr = event.address[1] || event.address[0] || '';

  // Try to extract "City, ST" or "City, State"
  const match = cityStateAddr.match(/([^,]+),\s*([A-Z]{2}|\w+)$/);

  if (match) {
    return {
      city: match[1].trim(),
      state: match[2].trim(),
    };
  }

  return {
    city: 'Unknown',
    state: 'US',
  };
}

// ============================================================================
// Ticket Info Extraction
// ============================================================================

/**
 * Extract ticket info from Google Events sources
 * Parses prices from URL params where available
 */
export function extractTicketInfo(sources: GoogleTicketSource[]): ExtractedTicketInfo[] {
  return sources.map(source => {
    const info: ExtractedTicketInfo = {
      source: source.source.toLowerCase(),
      link: source.link,
    };

    // Extract price from SeatGeek URLs (ref_price=XX.XX)
    const priceMatch = source.link.match(/ref_price=(\d+\.?\d*)/);
    if (priceMatch) {
      info.price = parseFloat(priceMatch[1]);
    }

    // Extract event IDs from various platforms
    const seatgeekIdMatch = source.link.match(/concert\/(\d+)/);
    if (seatgeekIdMatch) {
      info.eventId = seatgeekIdMatch[1];
    }

    const stubhubIdMatch = source.link.match(/event\/(\d+)/);
    if (stubhubIdMatch) {
      info.eventId = stubhubIdMatch[1];
    }

    return info;
  });
}

/**
 * Extract min/max price range from ticket sources
 */
function extractPriceRange(ticketInfo: ExtractedTicketInfo[]): NormalizedEvent['priceRange'] | undefined {
  const prices = ticketInfo
    .filter(t => t.price !== undefined)
    .map(t => t.price as number);

  if (prices.length === 0) return undefined;

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    currency: 'USD',
  };
}

/**
 * Select the best ticket URL (prefer primary sources)
 */
function selectBestTicketUrl(ticketInfo: ExtractedTicketInfo[], fallback: string): string {
  // Priority order for ticket sources
  const priorities = ['ticketmaster', 'etix', 'seatgeek', 'stubhub', 'eventbrite'];

  for (const priority of priorities) {
    const match = ticketInfo.find(t => t.source.includes(priority));
    if (match) return match.link;
  }

  // Return first ticket link or fallback
  return ticketInfo[0]?.link || fallback;
}

// ============================================================================
// Category Inference
// ============================================================================

function inferCategory(title: string, description: string): EventCategory {
  const text = `${title} ${description}`.toLowerCase();

  if (/concert|tour|live music|band|dj|musician|singer|album/i.test(text)) {
    return EventCategory.CONCERTS;
  }
  if (/nba|nfl|mlb|nhl|soccer|football|basketball|baseball|hockey|game|match/i.test(text)) {
    return EventCategory.SPORTS;
  }
  if (/theater|theatre|musical|broadway|play|ballet|opera/i.test(text)) {
    return EventCategory.THEATER;
  }
  if (/comedy|comedian|stand-up|standup|funny|laugh/i.test(text)) {
    return EventCategory.COMEDY;
  }
  if (/festival|fest|fair/i.test(text)) {
    return EventCategory.FESTIVALS;
  }

  return EventCategory.CONCERTS; // Default to concerts
}

// ============================================================================
// ID Generation
// ============================================================================

function generateEventId(event: GoogleEventItem): string {
  // Create a stable ID from event properties
  const base = `${event.title}-${event.date.start_date}-${event.venue.name}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64);
}

function generateVenueId(venueName: string): string {
  return venueName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
}
