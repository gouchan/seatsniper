/**
 * Event Matching Module
 * Re-exports matching service and venue aliases.
 */

export {
  matchEvents,
  findMatchesForEvent,
  type EventMatch,
} from './event-matching.service.js';

export {
  getVenueCanonicalName,
  venuesMatch,
  getVenueAliases,
} from './venue-aliases.js';
