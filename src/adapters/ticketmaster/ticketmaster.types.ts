/**
 * Ticketmaster Discovery API Response Types
 * Based on Ticketmaster Discovery API v2 documentation
 */

// ============================================================================
// HAL+JSON Wrapper
// ============================================================================

export interface TicketmasterPagedResponse<T> {
  _embedded?: T;
  _links?: {
    self?: { href: string };
    next?: { href: string };
    prev?: { href: string };
  };
  page?: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

// ============================================================================
// Event Types
// ============================================================================

export interface TicketmasterEventResponse {
  events?: TicketmasterEvent[];
}

export interface TicketmasterEvent {
  id: string;
  name: string;
  type: string;
  url: string;
  locale: string;
  images?: TicketmasterImage[];
  dates: {
    start: {
      localDate: string;
      localTime?: string;
      dateTime?: string;
      dateTBD?: boolean;
      dateTBA?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    timezone?: string;
    status?: {
      code: 'onsale' | 'offsale' | 'canceled' | 'postponed' | 'rescheduled';
    };
  };
  classifications?: TicketmasterClassification[];
  promoter?: {
    id: string;
    name: string;
  };
  priceRanges?: Array<{
    type: string;
    currency: string;
    min: number;
    max: number;
  }>;
  seatmap?: {
    staticUrl?: string;
  };
  _embedded?: {
    venues?: TicketmasterVenue[];
    attractions?: TicketmasterAttraction[];
  };
}

export interface TicketmasterVenue {
  id: string;
  name: string;
  type: string;
  url?: string;
  locale?: string;
  postalCode?: string;
  timezone?: string;
  city: {
    name: string;
  };
  state?: {
    name: string;
    stateCode: string;
  };
  country: {
    name: string;
    countryCode: string;
  };
  address?: {
    line1?: string;
    line2?: string;
  };
  location?: {
    longitude: string;
    latitude: string;
  };
}

export interface TicketmasterAttraction {
  id: string;
  name: string;
  type: string;
  url?: string;
  classifications?: TicketmasterClassification[];
}

export interface TicketmasterClassification {
  primary?: boolean;
  segment?: { id: string; name: string };
  genre?: { id: string; name: string };
  subGenre?: { id: string; name: string };
  type?: { id: string; name: string };
  subType?: { id: string; name: string };
}

export interface TicketmasterImage {
  url: string;
  ratio?: string;
  width?: number;
  height?: number;
  fallback?: boolean;
}

// ============================================================================
// Offers/Listings Types (Resale)
// ============================================================================

export interface TicketmasterOffersResponse {
  offers: TicketmasterOffer[];
  limits?: {
    max: number;
  };
  prices?: {
    min: number;
    max: number;
  };
}

export interface TicketmasterOffer {
  id: string;
  type: 'primary' | 'resale';
  name?: string;
  description?: string;
  rank?: number;
  currency?: string;
  prices?: TicketmasterOfferPrice[];
  attributes?: TicketmasterOfferAttribute[];
  area?: {
    id?: string;
    name?: string;
    rank?: number;
  };
  section?: string;
  row?: string;
  seats?: string[];
  quantity?: {
    total: number;
    sellableQuantities?: number[];
  };
  deliveryMethods?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

export interface TicketmasterOfferPrice {
  type: 'total' | 'face' | 'fee';
  value: number;
  currency: string;
}

export interface TicketmasterOfferAttribute {
  type: string;
  value: string;
  description?: string;
}

// ============================================================================
// Search Parameters
// ============================================================================

export interface TicketmasterSearchParams {
  apikey?: string;
  keyword?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  postalCode?: string;
  latlong?: string;
  radius?: number;
  unit?: 'miles' | 'km';
  startDateTime?: string;
  endDateTime?: string;
  size?: number;
  page?: number;
  sort?: 'name,asc' | 'name,desc' | 'date,asc' | 'date,desc' | 'relevance,asc' | 'relevance,desc';
  classificationId?: string[];
  classificationName?: string[];
  venueId?: string;
  attractionId?: string;
  segmentId?: string;
  segmentName?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export interface TicketmasterError {
  errors?: Array<{
    code: string;
    detail: string;
    status: string;
  }>;
  fault?: {
    faultstring: string;
    detail: {
      errorcode: string;
    };
  };
}

export function isTicketmasterError(data: unknown): data is TicketmasterError {
  return (
    typeof data === 'object' &&
    data !== null &&
    ('errors' in data || 'fault' in data)
  );
}

// ============================================================================
// Top Picks API Types (for individual ticket listings)
// ============================================================================

export interface TopPicksResponse {
  picks: TopPicksListing[];
  offers?: TopPicksOffer[];
  eventDetails?: TopPicksEventDetails;
  _embedded?: {
    event?: TicketmasterEvent;
  };
}

export interface TopPicksListing {
  id: string;
  type: string;
  section: string;
  row: string;
  seatNumbers?: string[];
  quality: number; // TM quality score (0-1)
  listingType: 'primary' | 'resale';
  totalPrice: number;
  faceValue: number;
  fees: number;
  currency: string;
  quantity: {
    available: number;
    min: number;
    max: number;
  };
  deliveryMethods: string[];
  attributes?: string[]; // e.g., ["aisle", "obstructed-view"]
  sellerNotes?: string;
  accessible?: boolean;
}

export interface TopPicksOffer {
  offerId: string;
  name: string;
  rank: number;
  area: {
    id: string;
    name: string;
    type: string;
  };
  prices: {
    total: { min: number; max: number };
    face: { min: number; max: number };
    fees: { min: number; max: number };
  };
  currency: string;
  listingCount: number;
}

export interface TopPicksEventDetails {
  id: string;
  name: string;
  venue: {
    id: string;
    name: string;
    seatMapUrl?: string;
  };
  date: {
    localDate: string;
    localTime?: string;
  };
}

export interface TopPicksSearchParams {
  apikey?: string;
  qty?: number; // Number of tickets (1-8)
  sort?: 'quality' | 'price';
  page?: number;
  size?: number;
}
