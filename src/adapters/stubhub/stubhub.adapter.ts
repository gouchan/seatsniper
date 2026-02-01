/**
 * StubHub Platform Adapter
 * Implements IPlatformAdapter for StubHub Catalog API
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
import { createMinuteRateLimiter, RateLimiter } from '../../utils/rate-limiter.js';
import { logger, logAdapterOperation } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import type {
  StubHubTokenResponse,
  StubHubEventResponse,
  StubHubListingResponse,
  StubHubSearchParams,
  StubHubListingParams,
} from './stubhub.types.js';
import { mapEventsToNormalized, mapListingsToNormalized } from './stubhub.mapper.js';

// ============================================================================
// StubHub Adapter Implementation
// ============================================================================

export class StubHubAdapter implements IPlatformAdapter {
  readonly config: PlatformConfig = {
    name: 'stubhub',
    baseUrl: config.stubhub.baseUrl,
    rateLimit: config.stubhub.rateLimit,
    timeout: config.stubhub.timeout,
    retryAttempts: config.stubhub.retryAttempts,
  };

  readonly circuitBreaker: CircuitBreakerPolicy;

  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private resilience: ResiliencePolicies;

  // OAuth state
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    // Initialize resilience policies
    this.resilience = createResiliencePolicies({
      platformName: 'stubhub',
      circuitBreakerThreshold: 5,
      circuitBreakerHalfOpenAfter: 30_000,
      maxRetryAttempts: 3,
      timeoutMs: this.config.timeout,
    });

    this.circuitBreaker = this.resilience.circuitBreaker;

    // Initialize rate limiter (10 requests per minute)
    this.rateLimiter = createMinuteRateLimiter(
      this.config.rateLimit.requestsPerMinute || 10
    );

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    logger.info('[StubHub] Initializing adapter...');

    if (!config.stubhub.clientId || !config.stubhub.clientSecret) {
      throw new Error('StubHub credentials not configured');
    }

    await this.refreshAccessToken();
    logger.info('[StubHub] Adapter initialized successfully');
  }

  // ==========================================================================
  // OAuth Token Management
  // ==========================================================================

  private async refreshAccessToken(): Promise<void> {
    const startTime = Date.now();

    try {
      const response = await axios.post<StubHubTokenResponse>(
        `${this.config.baseUrl}/sellers/oauth/accesstoken`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'read:events',
        }),
        {
          auth: {
            username: config.stubhub.clientId,
            password: config.stubhub.clientSecret,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10_000,
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry to 5 minutes before actual expiry for safety margin
      this.tokenExpiry = new Date(
        Date.now() + (response.data.expires_in - 300) * 1000
      );

      // Update default authorization header
      this.client.defaults.headers.common['Authorization'] =
        `Bearer ${this.accessToken}`;

      logAdapterOperation('stubhub', 'token_refresh', startTime, true);
    } catch (error) {
      logAdapterOperation('stubhub', 'token_refresh', startTime, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to refresh StubHub access token: ${error}`);
    }
  }

  private async ensureValidToken(): Promise<void> {
    // Refresh if no token or expiring within 60 seconds
    if (
      !this.accessToken ||
      !this.tokenExpiry ||
      this.tokenExpiry.getTime() - Date.now() < 60_000
    ) {
      // Coalesce concurrent refresh calls: only the first caller triggers
      // the actual refresh; all others await the same promise.
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshAccessToken().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
    }
  }

  // ==========================================================================
  // Event Search
  // ==========================================================================

  async searchEvents(params: EventSearchParams): Promise<NormalizedEvent[]> {
    await this.ensureValidToken();
    await this.rateLimiter.acquire();

    const startTime = Date.now();
    const searchParams = this.buildSearchParams(params);

    try {
      const response = (await this.resilience.policy.execute(async () => {
        return this.client.get<StubHubEventResponse>('/catalog/events', {
          params: searchParams,
        });
      })) as any;

      const events = mapEventsToNormalized(response.data.events || []);

      logAdapterOperation('stubhub', 'search_events', startTime, true, {
        city: params.city,
        resultsFound: events.length,
      });

      return events;
    } catch (error) {
      logAdapterOperation('stubhub', 'search_events', startTime, false, {
        city: params.city,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw this.handleError(error);
    }
  }

  private buildSearchParams(params: EventSearchParams): StubHubSearchParams {
    const state = config.cityStateMap[params.city.toLowerCase()];

    return {
      city: params.city,
      state,
      country: 'US',
      minDate: params.startDate.toISOString().split('T')[0],
      maxDate: params.endDate.toISOString().split('T')[0],
      q: params.keyword,
      rows: params.limit || 100,
      sort: 'eventDateLocal asc',
    };
  }

  // ==========================================================================
  // Event Listings
  // ==========================================================================

  async getEventListings(platformEventId: string): Promise<NormalizedListing[]> {
    await this.ensureValidToken();
    await this.rateLimiter.acquire();

    const startTime = Date.now();
    const listingParams: StubHubListingParams = {
      rows: 250,
      sort: 'price asc',
    };

    try {
      const response = (await this.resilience.policy.execute(async () => {
        return this.client.get<StubHubListingResponse>(
          `/catalog/events/${platformEventId}/listings`,
          { params: listingParams }
        );
      })) as any;

      const listings = mapListingsToNormalized(
        response.data.listings || [],
        platformEventId
      );

      logAdapterOperation('stubhub', 'get_listings', startTime, true, {
        eventId: platformEventId,
        listingsFound: listings.length,
      });

      return listings;
    } catch (error) {
      logAdapterOperation('stubhub', 'get_listings', startTime, false, {
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
      await this.ensureValidToken();

      // Simple health check - search for any event
      await this.client.get('/catalog/events', {
        params: { rows: 1 },
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
    // Map cockatiel CircuitState to our simplified state
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
          // Clear token to force refresh on next request
          this.accessToken = null;
          this.tokenExpiry = null;
          return new Error('StubHub authentication failed - token cleared');
        }

        if (status === 429) {
          return new Error('StubHub rate limit exceeded');
        }

        if (status >= 500) {
          return new Error(`StubHub server error: ${status}`);
        }

        return new Error(
          `StubHub API error: ${status} - ${axiosError.response.statusText}`
        );
      }

      if (axiosError.code === 'ECONNABORTED') {
        return new Error('StubHub request timed out');
      }

      return new Error(`StubHub network error: ${axiosError.message}`);
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(`StubHub unknown error: ${String(error)}`);
  }
}
