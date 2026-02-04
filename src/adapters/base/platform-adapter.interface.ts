/**
 * Platform Adapter Interface
 * Defines the contract for all ticket platform integrations (StubHub, Ticketmaster, etc.)
 */

import type { CircuitBreakerPolicy } from 'cockatiel';

// ============================================================================
// Configuration Types
// ============================================================================

export interface PlatformConfig {
  name: string;
  baseUrl: string;
  rateLimit: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
  };
  timeout: number;
  retryAttempts: number;
}

// ============================================================================
// Event Types
// ============================================================================

export interface EventSearchParams {
  city: string;
  startDate: Date;
  endDate: Date;
  categories?: EventCategory[];
  keyword?: string;
  limit?: number;
}

export enum EventCategory {
  CONCERTS = 'concerts',
  SPORTS = 'sports',
  THEATER = 'theater',
  COMEDY = 'comedy',
  FESTIVALS = 'festivals',
}

export interface NormalizedEvent {
  platformId: string;
  platform: Platform;
  name: string;
  venue: {
    id: string;
    name: string;
    city: string;
    state: string;
  };
  dateTime: Date;
  category: EventCategory;
  url: string;
  imageUrl?: string;
  /** Static seat map image URL from platform (if available) */
  seatMapUrl?: string;
  /** Price range from the platform (if available) */
  priceRange?: {
    min: number;
    max: number;
    currency: string;
  };
}

// ============================================================================
// Listing Types
// ============================================================================

export type Platform = 'stubhub' | 'ticketmaster' | 'seatgeek' | 'vividseats';

export type DeliveryType = 'electronic' | 'instant' | 'physical' | 'willcall';

export interface NormalizedListing {
  platformListingId: string;
  platform: Platform;
  eventId: string;
  section: string;
  row: string;
  seatNumbers?: string[];
  quantity: number;
  pricePerTicket: number;
  totalPrice: number;
  fees: number;
  deliveryType: DeliveryType;
  sellerRating?: number;
  deepLink: string;
  capturedAt: Date;
}

// ============================================================================
// Health Check Types
// ============================================================================

export interface HealthStatus {
  healthy: boolean;
  latency: number;
  lastChecked: Date;
  circuitState?: 'closed' | 'open' | 'half-open';
  errorMessage?: string;
}

// ============================================================================
// Platform Adapter Interface
// ============================================================================

export interface IPlatformAdapter {
  /** Platform configuration */
  readonly config: PlatformConfig;

  /** Circuit breaker policy for resilience */
  readonly circuitBreaker: CircuitBreakerPolicy;

  /**
   * Initialize the adapter (authenticate, validate credentials, etc.)
   * @throws Error if initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Search for events matching the given parameters
   * @param params Search parameters (city, dates, categories)
   * @returns Array of normalized events
   */
  searchEvents(params: EventSearchParams): Promise<NormalizedEvent[]>;

  /**
   * Get all listings for a specific event
   * @param platformEventId The platform-specific event ID
   * @returns Array of normalized listings
   */
  getEventListings(platformEventId: string): Promise<NormalizedListing[]>;

  /**
   * Check the health status of this adapter
   * @returns Health status including latency and circuit state
   */
  getHealthStatus(): Promise<HealthStatus>;
}
