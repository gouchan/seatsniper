/**
 * StubHub API Response Types
 * Based on StubHub Catalog API documentation
 */

// ============================================================================
// OAuth Types
// ============================================================================

export interface StubHubTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// ============================================================================
// Event Types
// ============================================================================

export interface StubHubEventResponse {
  numFound: number;
  events: StubHubEvent[];
}

export interface StubHubEvent {
  id: number;
  name: string;
  eventDateLocal: string;
  eventDateUTC: string;
  timezone: string;
  webURI: string;
  status: string;
  locale: string;
  venue: StubHubVenue;
  performers?: StubHubPerformer[];
  ancestors?: StubHubAncestor;
  imageUrl?: string;
  ticketInfo?: {
    minPrice?: number;
    maxPrice?: number;
    totalTickets?: number;
    totalListings?: number;
  };
}

export interface StubHubVenue {
  id: number;
  name: string;
  city: string;
  state: string;
  postalCode?: string;
  country: string;
  venueConfigId?: number;
  latitude?: number;
  longitude?: number;
}

export interface StubHubPerformer {
  id: number;
  name: string;
  role?: string;
}

export interface StubHubAncestor {
  categories?: Array<{
    id: number;
    name: string;
  }>;
  groupings?: Array<{
    id: number;
    name: string;
  }>;
}

// ============================================================================
// Listing Types
// ============================================================================

export interface StubHubListingResponse {
  eventId: number;
  totalListings: number;
  totalTickets: number;
  minPrice: number;
  maxPrice: number;
  pricingSummary?: {
    averagePrice: number;
    medianPrice: number;
  };
  listings: StubHubListing[];
}

export interface StubHubListing {
  listingId: number;
  currentPrice: {
    amount: number;
    currency: string;
  };
  listingPrice?: {
    amount: number;
    currency: string;
  };
  faceValue?: {
    amount: number;
    currency: string;
  };
  deliveryTypeList: string[];
  deliveryMethodList?: string[];
  sellerOwnInd?: boolean;
  quantity: number;
  splitOption?: string;
  splitQuantity?: number;
  row?: string;
  seatNumbers?: string;
  sellerSectionName?: string;
  sectionId?: number;
  sectionName?: string;
  zoneId?: number;
  zoneName?: string;
  score?: number;
  dirtyTicketInd?: boolean;
  listingAttributeList?: string[];
  listingAttributeCategoryList?: string[];
  ticketSplit?: string;
  sellerRating?: {
    rating: number;
    totalTransactions: number;
  };
}

// ============================================================================
// Search Parameters
// ============================================================================

export interface StubHubSearchParams {
  city?: string;
  state?: string;
  country?: string;
  minDate?: string;
  maxDate?: string;
  q?: string;
  performerId?: number;
  venueId?: number;
  categoryId?: number;
  rows?: number;
  start?: number;
  sort?: 'eventDateLocal asc' | 'eventDateLocal desc' | 'popularity' | 'distance';
  parking?: boolean;
  lat?: number;
  long?: number;
  radius?: number;
}

export interface StubHubListingParams {
  rows?: number;
  start?: number;
  sort?: 'price asc' | 'price desc' | 'quality' | 'value';
  quantity?: number;
  sectionIdList?: string;
  zoneIdList?: string;
  priceMin?: number;
  priceMax?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export interface StubHubError {
  error: string;
  error_description?: string;
  status?: number;
  code?: string;
}

export function isStubHubError(data: unknown): data is StubHubError {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as StubHubError).error === 'string'
  );
}
