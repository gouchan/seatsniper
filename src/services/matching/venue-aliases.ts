/**
 * Venue Aliases
 * Maps different spellings and names of venues to a canonical name.
 * Focused on Pacific Northwest venues for Trail Blazers and Seattle events.
 */

// ============================================================================
// Venue Alias Mapping
// ============================================================================

/**
 * Map of venue name variations to canonical names.
 * Keys are lowercase for case-insensitive matching.
 */
const VENUE_ALIASES: Record<string, string> = {
  // Portland - Moda Center (Trail Blazers)
  'moda center': 'Moda Center',
  'moda': 'Moda Center',
  'rose garden': 'Moda Center',
  'rose garden arena': 'Moda Center',
  'portland moda center': 'Moda Center',
  'moda center at the rose quarter': 'Moda Center',

  // Portland - Providence Park (Timbers/Thorns)
  'providence park': 'Providence Park',
  'providence': 'Providence Park',
  'jeld-wen field': 'Providence Park',
  'pge park': 'Providence Park',
  'civic stadium': 'Providence Park',

  // Seattle - Climate Pledge Arena (Kraken)
  'climate pledge arena': 'Climate Pledge Arena',
  'climate pledge': 'Climate Pledge Arena',
  'key arena': 'Climate Pledge Arena',
  'keyarena': 'Climate Pledge Arena',
  'seattle center arena': 'Climate Pledge Arena',
  'amazon climate pledge arena': 'Climate Pledge Arena',

  // Seattle - Lumen Field (Seahawks/Sounders)
  'lumen field': 'Lumen Field',
  'lumen': 'Lumen Field',
  'centurylink field': 'Lumen Field',
  'qwest field': 'Lumen Field',
  'seahawks stadium': 'Lumen Field',

  // Seattle - T-Mobile Park (Mariners)
  't-mobile park': 'T-Mobile Park',
  'tmobile park': 'T-Mobile Park',
  't mobile park': 'T-Mobile Park',
  'safeco field': 'T-Mobile Park',
  'safeco': 'T-Mobile Park',

  // Tacoma Dome
  'tacoma dome': 'Tacoma Dome',
  'tacoma': 'Tacoma Dome',

  // Portland - Theater of the Clouds (Moda Center theater)
  'theater of the clouds': 'Theater of the Clouds',
  'theatre of the clouds': 'Theater of the Clouds',

  // Portland - Keller Auditorium
  'keller auditorium': 'Keller Auditorium',
  'keller': 'Keller Auditorium',
  'portland civic auditorium': 'Keller Auditorium',

  // Portland - Arlene Schnitzer Concert Hall
  'arlene schnitzer concert hall': 'Arlene Schnitzer Concert Hall',
  'schnitzer': 'Arlene Schnitzer Concert Hall',
  'schnitzer concert hall': 'Arlene Schnitzer Concert Hall',
  'the schnitz': 'Arlene Schnitzer Concert Hall',

  // Seattle - Paramount Theatre
  'paramount theatre': 'Paramount Theatre Seattle',
  'paramount theater': 'Paramount Theatre Seattle',
  'seattle paramount': 'Paramount Theatre Seattle',
  'paramount theatre seattle': 'Paramount Theatre Seattle',

  // Seattle - Moore Theatre
  'moore theatre': 'Moore Theatre',
  'moore theater': 'Moore Theatre',
  'the moore': 'Moore Theatre',

  // Portland - McMenamins venues
  'crystal ballroom': 'Crystal Ballroom',
  'crystal': 'Crystal Ballroom',
  'mcmenamins crystal ballroom': 'Crystal Ballroom',

  // Portland - Revolution Hall
  'revolution hall': 'Revolution Hall',
  'rev hall': 'Revolution Hall',

  // Portland - Roseland Theater
  'roseland theater': 'Roseland Theater',
  'roseland theatre': 'Roseland Theater',
  'roseland': 'Roseland Theater',

  // Seattle - The Showbox
  'showbox': 'The Showbox',
  'the showbox': 'The Showbox',
  'showbox at the market': 'The Showbox',
  'showbox sodo': 'Showbox SoDo',

  // Seattle - Gorge Amphitheatre
  'gorge amphitheatre': 'Gorge Amphitheatre',
  'the gorge': 'Gorge Amphitheatre',
  'gorge amphitheater': 'Gorge Amphitheatre',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the canonical name for a venue.
 * If no alias is found, returns the original name (title-cased).
 */
export function getVenueCanonicalName(venueName: string): string {
  const normalized = venueName.toLowerCase().trim();

  // Check for exact match in aliases
  if (VENUE_ALIASES[normalized]) {
    return VENUE_ALIASES[normalized];
  }

  // Check for partial matches (venue name contains alias)
  for (const [alias, canonical] of Object.entries(VENUE_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return canonical;
    }
  }

  // No match found, return original with title case
  return venueName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Check if two venue names refer to the same venue
 */
export function venuesMatch(venueA: string, venueB: string): boolean {
  return getVenueCanonicalName(venueA) === getVenueCanonicalName(venueB);
}

/**
 * Get all known aliases for a canonical venue name
 */
export function getVenueAliases(canonicalName: string): string[] {
  const aliases: string[] = [];
  for (const [alias, canonical] of Object.entries(VENUE_ALIASES)) {
    if (canonical === canonicalName) {
      aliases.push(alias);
    }
  }
  return aliases;
}
