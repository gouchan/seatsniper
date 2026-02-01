/**
 * Ticketmaster Platform Adapter
 * Implements IPlatformAdapter for Ticketmaster Discovery API v2
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { CircuitBreakerPolicy } from 'cockatiel';
import {
  IPlatformAdapter,
  PlatformConfig,
  EventSearchParams,
  NormalizedEvent,
  NormalizedListing,
  HealthStatus,
} from '../base/platform-adapter.interface.js';
import { createResiliencePolicies, type ResiliencePolicies } from '../base/circuit-breaker.js';
import { createDailyRateLimiter, RateLimiter } from '../../utils/rate-limiter.js';
import { logger, logAdapterOperation } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import type {
  TicketmasterPagedResponse,
  TicketmasterEventResponse,
  TicketmasterOffersResponse,
  TicketmasterSearchParams,
} from './ticketmaster.types.js';
import { mapEventsToNormalized, mapOffersToNormalized } from './ticketmaster.mapper.js';

// ============================================================================
// Ticketmaster Adapter Implementation
// ============================================================================

export class TicketmasterAdapter implements IPlatformAdapter {
  readonly config: PlatformConfig = {
    name: 'ticketmaster',
    baseUrl: config.ticketmaster.baseUrl,
    rateLimit: config.ticketmaster.rateLimit,
    timeout: config.ticketmaster.timeout,
    retryAttempts: config.ticketmaster.retryAttempts,
  };

  readonly circuitBreaker: CircuitBreakerPolicy;

  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private resilience: ResiliencePolicies;

  constructor() {
    // Initialize resilience policies
    this.resilience = createResiliencePolicies({
      platformName: 'ticketmaster',
      circuitBreakerThreshold: 5,
      circuitBreakerHalfOpenAfter: 30_000,
      maxRetryAttempts: 3,
      timeoutMs: this.config.timeout,
    });

    this.circuitBreaker = this.resilience.circuitBreaker;

    // Initialize rate limiter (5000 requests per day)
    this.rateLimiter = createDailyRateLimiter(
      this.config.rateLimit.requestsPerDay || 5000
    );

    // Initialize HTTP client with API key
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      params: {
        apikey: config.ticketmaster.apiKey,
      },
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    logger.info('[Ticketmaster] Initializing adapter...');

    if (!config.ticketmaster.apiKey) {
      throw new Error('Ticketmaster API key not configured');
    }

    // Verify API key with a simple request
    try {
      await this.client.get('/events', { params: { size: 1 } });
      logger.info('[Ticketmaster] Adapter initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize Ticketmaster adapter: ${error}`);
    }
  }

  // ==========================================================================
  // Event Search
  // ==========================================================================

  async searchEvents(params: EventSearchParams): Promise<NormalizedEvent[]> {
    await this.rateLimiter.acquire();

    const startTime = Date.now();
    const searchParams = this.buildSearchParams(params);

    try {
      const response = (await this.resilience.policy.execute(async () => {
        return this.client.get<TicketmasterPagedResponse<TicketmasterEventResponse>>(
          '/events',
          { params: searchParams }
        );
      })) as any;

      const events = mapEventsToNormalized(
        response.data._embedded?.events || []
      );

      logAdapterOperation('ticketmaster', 'search_events', startTime, true, {
        city: params.city,
        resultsFound: events.length,
        totalAvailable: response.data.page?.totalElements,
      });

      return events;
    } catch (error) {
      logAdapterOperation('ticketmaster', 'search_events', startTime, false, {
        city: params.city,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw this.handleError(error);
    }
  }

  private buildSearchParams(params: EventSearchParams): TicketmasterSearchParams {
    const state = config.cityStateMap[params.city.toLowerCase()];

    // Ticketmaster requires ISO 8601 format with timezone
    const formatDateTime = (date: Date): string => {
      return date.toISOString().replace('.000Z', 'Z');
    };

    return {
      city: params.city,
      stateCode: state,
      countryCode: 'US',
      startDateTime: formatDateTime(params.startDate),
      endDateTime: formatDateTime(params.endDate),
      keyword: params.keyword,
      size: params.limit || 100,
      sort: 'date,asc',
    };
  }

  // ==========================================================================
  // Event Listings (Resale Offers)
  // ==========================================================================

  async getEventListings(platformEventId: string): Promise<NormalizedListing[]> {
    await this.rateLimiter.acquire();

    const startTime = Date.now();

    try {
      // Note: Ticketmaster's resale offers endpoint structure varies
      // This uses the standard Discovery API offers endpoint
      const response = (await this.resilience.policy.execute(async () => {
        return this.client.get<TicketmasterOffersResponse>(
          `/events/${platformEventId}/offers`
        );
      })) as any;

      const listings = mapOffersToNormalized(
        response.data.offers || [],
        platformEventId
      );

      logAdapterOperation('ticketmaster', 'get_listings', startTime, true, {
        eventId: platformEventId,
        listingsFound: listings.length,
      });

      return listings;
    } catch (error) {
      // 404 is expected if event has no resale offers
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logAdapterOperation('ticketmaster', 'get_listings', startTime, true, {
          eventId: platformEventId,
          listingsFound: 0,
          note: 'No resale offers available',
        });
        return [];
      }

      logAdapterOperation('ticketmaster', 'get_listings', startTime, false, {
        eventId: platformEventId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw this.handleError(error);
    }
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  async getHealthStatus(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      // Simple health check - search for any event
      await this.client.get('/events', {
        params: { size: 1 },
        timeout: 5_000,
      });

      return {
        healthy: true,
        latency: Date.now() - startTime,
        lastChecked: new Date(),
        circuitState: this.getCircuitState(),
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        lastChecked: new Date(),
        circuitState: this.getCircuitState(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private getCircuitState(): HealthStatus['circuitState'] {
    const state = this.resilience.getCircuitState();
    if (state === 0) return 'closed';
    if (state === 1) return 'open';
    return 'half-open';
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;

        if (status === 401) {
          return new Error('Ticketmaster API key is invalid');
        }

        if (status === 429) {
          return new Error('Ticketmaster rate limit exceeded (5000/day)');
        }

        if (status === 404) {
          return new Error('Ticketmaster resource not found');
        }

        if (status >= 500) {
          return new Error(`Ticketmaster server error: ${status}`);
        }

        // Try to extract error message from response
        const data = axiosError.response.data as { fault?: { faultstring?: string } };
        const message = data?.fault?.faultstring || axiosError.response.statusText;

        return new Error(`Ticketmaster API error: ${status} - ${message}`);
      }

      if (axiosError.code === 'ECONNABORTED') {
        return new Error('Ticketmaster request timed out');
      }

      return new Error(`Ticketmaster network error: ${axiosError.message}`);
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(`Ticketmaster unknown error: ${String(error)}`);
  }
}
