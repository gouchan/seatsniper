/**
 * SeatGeek Platform Adapter
 * Integrates with SeatGeek API for event discovery and listings
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { CircuitBreakerPolicy } from 'cockatiel';
import type {
  IPlatformAdapter,
  PlatformConfig,
  EventSearchParams,
  NormalizedEvent,
  NormalizedListing,
  HealthStatus,
} from '../base/platform-adapter.interface.js';
import { createResiliencePolicies, type ResiliencePolicies } from '../base/circuit-breaker.js';
import type {
  SeatGeekResponse,
  SeatGeekEvent,
  SeatGeekListingsResponse,
  SeatGeekSearchParams,
} from './seatgeek.types.js';
import { isSeatGeekError } from './seatgeek.types.js';
import { mapEventsToNormalized, mapListingsToNormalized } from './seatgeek.mapper.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

// ============================================================================
// SeatGeek Adapter Implementation
// ============================================================================

export class SeatGeekAdapter implements IPlatformAdapter {
  readonly config: PlatformConfig = {
    name: 'SeatGeek',
    baseUrl: config.seatgeek.baseUrl,
    rateLimit: {
      requestsPerMinute: config.seatgeek.rateLimit.requestsPerMinute,
    },
    timeout: config.seatgeek.timeout,
    retryAttempts: config.seatgeek.retryAttempts,
  };

  readonly circuitBreaker: CircuitBreakerPolicy;

  private resilience: ResiliencePolicies;
  private client: AxiosInstance;
  private isInitialized: boolean = false;

  constructor() {
    this.resilience = createResiliencePolicies({
      platformName: 'SeatGeek',
      circuitBreakerThreshold: 5,
      circuitBreakerHalfOpenAfter: 30_000,
      maxRetryAttempts: config.seatgeek.retryAttempts,
      timeoutMs: config.seatgeek.timeout,
    });
    this.circuitBreaker = this.resilience.circuitBreaker;

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!config.seatgeek.clientId) {
      throw new Error('SeatGeek client ID not configured');
    }

    try {
      // Test API connectivity with a simple venues query
      const response = await this.client.get('/venues', {
        params: {
          client_id: config.seatgeek.clientId,
          client_secret: config.seatgeek.clientSecret,
          city: 'Portland',
          state: 'OR',
          per_page: 1,
        },
      });

      if (isSeatGeekError(response.data)) {
        throw new Error(response.data.message);
      }

      logger.info('[SeatGeek] API connection verified');
      this.isInitialized = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to initialize SeatGeek adapter: ${message}`);
    }
  }

  // ==========================================================================
  // Event Search
  // ==========================================================================

  async searchEvents(params: EventSearchParams): Promise<NormalizedEvent[]> {
    return this.resilience.policy.execute(async () => {
      const searchParams = this.buildSearchParams(params);

      const response = await this.client.get<SeatGeekResponse<SeatGeekEvent>>(
        '/events',
        { params: searchParams }
      );

      if (isSeatGeekError(response.data)) {
        throw new Error(response.data.message);
      }

      const events = response.data.events || [];

      logger.debug(`[SeatGeek] Found ${events.length} events`, {
        city: params.city,
        total: response.data.meta?.total || 0,
      });

      return mapEventsToNormalized(events);
    });
  }

  /**
   * Build SeatGeek search parameters from normalized params
   */
  private buildSearchParams(params: EventSearchParams): SeatGeekSearchParams {
    const searchParams: SeatGeekSearchParams = {
      client_id: config.seatgeek.clientId,
      client_secret: config.seatgeek.clientSecret || undefined,
      'venue.city': params.city,
      'datetime_local.gte': params.startDate.toISOString().split('T')[0],
      'datetime_local.lte': params.endDate.toISOString().split('T')[0],
      per_page: params.limit || 50,
      sort: 'datetime_local',
    };

    // Map categories to SeatGeek taxonomies
    if (params.categories?.length) {
      const taxonomyMap: Record<string, string> = {
        concerts: 'concert',
        sports: 'sports',
        theater: 'theater',
        comedy: 'comedy',
        festivals: 'concert',
      };

      const firstCategory = params.categories[0];
      const taxonomy = taxonomyMap[firstCategory];
      if (taxonomy) {
        searchParams['taxonomies.name'] = taxonomy;
      }
    }

    if (params.keyword) {
      searchParams.q = params.keyword;
    }

    return searchParams;
  }

  // ==========================================================================
  // Event Listings
  // ==========================================================================

  async getEventListings(platformEventId: string): Promise<NormalizedListing[]> {
    return this.resilience.policy.execute(async () => {
      // SeatGeek listings endpoint
      const response = await this.client.get<SeatGeekListingsResponse>(
        `/events/${platformEventId}/listings`,
        {
          params: {
            client_id: config.seatgeek.clientId,
            client_secret: config.seatgeek.clientSecret || undefined,
          },
        }
      );

      if (isSeatGeekError(response.data)) {
        throw new Error(response.data.message);
      }

      const listings = response.data.listings || [];

      logger.debug(`[SeatGeek] Found ${listings.length} listings for event ${platformEventId}`);

      return mapListingsToNormalized(listings, platformEventId);
    });
  }

  // ==========================================================================
  // Venue Seat Map URL
  // ==========================================================================

  /**
   * Get seat map URL for a venue
   * SeatGeek provides seating chart URLs in venue data
   */
  async getVenueSeatMapUrl(venueId: string): Promise<string | undefined> {
    try {
      const response = await this.client.get(`/venues/${venueId}`, {
        params: {
          client_id: config.seatgeek.clientId,
          client_secret: config.seatgeek.clientSecret || undefined,
        },
      });

      if (isSeatGeekError(response.data)) {
        return undefined;
      }

      const venue = response.data;
      return venue.seating_chart_url_large || venue.seating_chart_url;
    } catch {
      return undefined;
    }
  }

  /**
   * Search for a venue by name and city
   */
  async findVenue(name: string, city: string): Promise<{
    id: string;
    seatMapUrl?: string;
  } | undefined> {
    try {
      const response = await this.client.get('/venues', {
        params: {
          client_id: config.seatgeek.clientId,
          client_secret: config.seatgeek.clientSecret || undefined,
          q: name,
          city,
          per_page: 5,
        },
      });

      if (isSeatGeekError(response.data)) {
        return undefined;
      }

      const venues = response.data.venues || [];
      if (venues.length === 0) return undefined;

      // Find best match
      const normalizedName = name.toLowerCase();
      const match = venues.find((v: { name: string }) =>
        v.name.toLowerCase().includes(normalizedName) ||
        normalizedName.includes(v.name.toLowerCase())
      ) || venues[0];

      return {
        id: match.id.toString(),
        seatMapUrl: match.seating_chart_url_large || match.seating_chart_url,
      };
    } catch {
      return undefined;
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  async getHealthStatus(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      const response = await this.client.get('/venues', {
        params: {
          client_id: config.seatgeek.clientId,
          per_page: 1,
        },
        timeout: 5000,
      });

      const latency = Date.now() - startTime;

      if (isSeatGeekError(response.data)) {
        return {
          healthy: false,
          latency,
          lastChecked: new Date(),
          errorMessage: response.data.message,
        };
      }

      return {
        healthy: true,
        latency,
        lastChecked: new Date(),
        circuitState: 'closed',
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        lastChecked: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
