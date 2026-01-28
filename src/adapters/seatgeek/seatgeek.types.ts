/**
 * SeatGeek Platform API Response Types
 * Based on SeatGeek API documentation
 */

// ============================================================================
// Common Response Wrapper
// ============================================================================

export interface SeatGeekResponse<T> {
  events?: T[];
  venues?: T[];
  performers?: T[];
  meta: {
    total: number;
    took: number;
    page: number;
    per_page: number;
    geolocation?: {
      lat: number;
      lon: number;
      city: string;
      state: string;
      country: string;
      postal_code: string;
      range: string;
    };
  };
}

// ============================================================================
// Event Types
// ============================================================================

export interface SeatGeekEvent {
  id: number;
  type: string;
  datetime_local: string;
  datetime_utc: string;
  datetime_tbd: boolean;
  time_tbd: boolean;
  title: string;
  short_title: string;
  url: string;
  score: number;
  announce_date: string;
  visible_until_utc: string;
  is_open: boolean;
  status: 'normal' | 'postponed' | 'cancelled';
  venue: SeatGeekVenue;
  performers: SeatGeekPerformer[];
  taxonomies: SeatGeekTaxonomy[];
  stats: {
    listing_count: number;
    average_price: number;
    lowest_price: number;
    highest_price: number;
    lowest_price_good_deals: number;
    lowest_sg_base_price: number;
    lowest_sg_base_price_good_deals: number;
    median_price: number;
    visible_listing_count: number;
  };
}

// ============================================================================
// Venue Types
// ============================================================================

export interface SeatGeekVenue {
  id: number;
  name: string;
  name_v2?: string;
  url: string;
  score: number;
  postal_code: string;
  city: string;
  state: string;
  country: string;
  address: string;
  extended_address?: string;
  timezone: string;
  location: {
    lat: number;
    lon: number;
  };
  capacity: number;
  slug: string;
  has_upcoming_events: boolean;
  num_upcoming_events: number;
  /** URL to static seating chart image */
  seating_chart_url?: string;
  /** URL to interactive seating chart page */
  seating_chart_url_large?: string;
}

// ============================================================================
// Performer Types
// ============================================================================

export interface SeatGeekPerformer {
  id: number;
  name: string;
  short_name: string;
  url: string;
  image: string;
  images?: {
    huge?: string;
    large?: string;
    medium?: string;
    small?: string;
  };
  slug: string;
  type: string;
  score: number;
  taxonomies?: SeatGeekTaxonomy[];
  has_upcoming_events: boolean;
  num_upcoming_events: number;
  primary?: boolean;
}

// ============================================================================
// Taxonomy Types (Categories)
// ============================================================================

export interface SeatGeekTaxonomy {
  id: number;
  name: string;
  parent_id?: number;
  rank?: number;
}

// ============================================================================
// Listing Types
// ============================================================================

export interface SeatGeekListingsResponse {
  listings: SeatGeekListing[];
  event: SeatGeekEvent;
}

export interface SeatGeekListing {
  id: number;
  event_id: number;
  section: string;
  row: string;
  seat_numbers?: string[];
  quantity: number;
  display_price: number;
  average_price: number;
  seller_type: string;
  delivery_type: string[];
  listing_type: string;
  is_ga: boolean; // General admission
  resource_uri: string;
  dq_score?: number; // Deal quality score (SeatGeek's value scoring)
  format: string;
  seating_type: string;
  instant_delivery: boolean;
  note?: string;
}

// ============================================================================
// Search Parameters
// ============================================================================

export interface SeatGeekSearchParams {
  client_id?: string;
  client_secret?: string;
  q?: string; // Query string
  'venue.city'?: string;
  'venue.state'?: string;
  'venue.country'?: string;
  'venue.id'?: number;
  lat?: number;
  lon?: number;
  range?: string; // e.g., "30mi"
  'datetime_local.gte'?: string;
  'datetime_local.lte'?: string;
  'taxonomies.name'?: string;
  'performers.slug'?: string;
  sort?: 'score' | 'datetime_local' | 'announce_date';
  per_page?: number;
  page?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export interface SeatGeekError {
  status: string;
  code: number;
  message: string;
}

export function isSeatGeekError(data: unknown): data is SeatGeekError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    'message' in data
  );
}
