/**
 * Google Events Platform Adapter
 * Uses Apify's Google Events API actor to scrape event data from Google
 *
 * This is a fallback/alternative data source that doesn't require
 * direct API access to SeatGeek, StubHub, etc.
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
import { logger, logAdapterOperation } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import type {
  ApifyRunResponse,
  GoogleEventsSearchResult,
} from './google-events.types.js';
import { mapGoogleEventsToNormalized } from './google-events.mapper.js';

// ============================================================================
// Constants
// ============================================================================

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const GOOGLE_EVENTS_ACTOR_ID = 'DfdUgh7nBLKe78irv';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // 2 minutes max wait

// ============================================================================
// Google Events Adapter Implementation
// ============================================================================

export class GoogleEventsAdapter implements IPlatformAdapter {
  readonly config: PlatformConfig = {
    name: 'google-events',
    baseUrl: APIFY_BASE_URL,
    rateLimit: {
      requestsPerDay: 100, // Based on $3.30 budget at ~$0.035/request
    },
    timeout: 120_000, // 2 minutes for scraping
    retryAttempts: 2,
  };

  readonly circuitBreaker: CircuitBreakerPolicy;

  private client: AxiosInstance;
  private resilience: ResiliencePolicies;
  private apifyToken: string;
  private enabled: boolean = false;

  constructor() {
    // Get Apify token from config
    this.apifyToken = config.apify?.token || '';

    // Initialize resilience policies
    this.resilience = createResiliencePolicies({
      platformName: 'google-events',
      circuitBreakerThreshold: 3,
      circuitBreakerHalfOpenAfter: 60_000,
      maxRetryAttempts: 2,
      timeoutMs: this.config.timeout,
    });

    this.circuitBreaker = this.resilience.circuitBreaker;

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: APIFY_BASE_URL,
      timeout: 30_000, // 30s for API calls (not scraping)
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
    logger.info('[GoogleEvents] Initializing adapter...');

    if (!this.apifyToken) {
      logger.warn('[GoogleEvents] APIFY_TOKEN not configured - adapter disabled');
      this.enabled = false;
      return;
    }

    // Verify token works
    try {
      await this.client.get('/users/me', {
        params: { token: this.apifyToken },
      });
      this.enabled = true;
      logger.info('[GoogleEvents] Adapter initialized successfully');
    } catch (error) {
      logger.warn(`[GoogleEvents] Failed to verify Apify token: ${error}`);
      this.enabled = false;
    }
  }

  /**
   * Check if this adapter is enabled and usable
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ==========================================================================
  // Event Search
  // ==========================================================================

  async searchEvents(params: EventSearchParams): Promise<NormalizedEvent[]> {
    if (!this.enabled) {
      logger.debug('[GoogleEvents] Adapter disabled, skipping search');
      return [];
    }

    const startTime = Date.now();
    const query = this.buildSearchQuery(params);

    logger.info(`[GoogleEvents] Searching for: "${query}"`);

    try {
      // Start the actor run
      const runResponse = await this.startActorRun(query);
      const runId = runResponse.data.id;
      const datasetId = runResponse.data.defaultDatasetId;

      logger.debug(`[GoogleEvents] Started run ${runId}, waiting for completion...`);

      // Poll for completion
      await this.waitForCompletion(runId);

      // Fetch results
      const results = await this.fetchResults(datasetId);

      // Extract events from results
      const allEvents = results.flatMap(r => r.events || []);
      const normalizedEvents = mapGoogleEventsToNormalized(allEvents);

      // Filter by city if needed
      const filteredEvents = this.filterByLocation(normalizedEvents, params.city);

      logAdapterOperation('google-events', 'search_events', startTime, true, {
        query,
        rawEventsFound: allEvents.length,
        normalizedEvents: filteredEvents.length,
      });

      return filteredEvents;
    } catch (error) {
      logAdapterOperation('google-events', 'search_events', startTime, false, {
        query,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw this.handleError(error);
    }
  }

  private buildSearchQuery(params: EventSearchParams): string {
    const parts: string[] = [];

    // Add keyword if specified
    if (params.keyword) {
      parts.push(params.keyword);
    } else {
      // Default to "events" for general search
      parts.push('events');
    }

    // Add city and state
    const state = config.cityStateMap[params.city.toLowerCase()] || '';
    parts.push(`in ${params.city}${state ? ` ${state}` : ''}`);

    return parts.join(' ');
  }

  private async startActorRun(query: string): Promise<ApifyRunResponse> {
    const response = await this.client.post<ApifyRunResponse['data']>(
      `/acts/${GOOGLE_EVENTS_ACTOR_ID}/runs`,
      {
        q: query,
        maxResults: 20, // Limit to control costs
      },
      {
        params: { token: this.apifyToken },
      }
    );

    return { data: response.data };
  }

  private async waitForCompletion(runId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const response = await this.client.get(`/actor-runs/${runId}`, {
        params: { token: this.apifyToken },
      });

      const status = response.data.data?.status;

      if (status === 'SUCCEEDED') {
        return;
      }

      if (status === 'FAILED' || status === 'ABORTED') {
        throw new Error(`Apify run ${runId} ${status.toLowerCase()}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error(`Apify run ${runId} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
  }

  private async fetchResults(datasetId: string): Promise<GoogleEventsSearchResult[]> {
    const response = await this.client.get<GoogleEventsSearchResult[]>(
      `/datasets/${datasetId}/items`,
      {
        params: { token: this.apifyToken },
      }
    );

    return response.data;
  }

  private filterByLocation(events: NormalizedEvent[], targetCity: string): NormalizedEvent[] {
    const normalizedTarget = targetCity.toLowerCase();

    return events.filter(event => {
      const venueCity = event.venue.city.toLowerCase();
      return venueCity.includes(normalizedTarget) || normalizedTarget.includes(venueCity);
    });
  }

  // ==========================================================================
  // Event Listings
  // ==========================================================================

  /**
   * Google Events doesn't provide individual ticket listings
   * This returns an empty array - use for event discovery only
   */
  async getEventListings(_platformEventId: string): Promise<NormalizedListing[]> {
    logger.debug('[GoogleEvents] getEventListings not supported - use primary adapter');
    return [];
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  async getHealthStatus(): Promise<HealthStatus> {
    if (!this.enabled) {
      return {
        healthy: false,
        latency: 0,
        lastChecked: new Date(),
        circuitState: 'open',
        errorMessage: 'Adapter disabled - APIFY_TOKEN not configured',
      };
    }

    const startTime = Date.now();

    try {
      await this.client.get('/users/me', {
        params: { token: this.apifyToken },
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
          this.enabled = false;
          return new Error('Apify API token is invalid');
        }

        if (status === 402) {
          this.enabled = false;
          return new Error('Apify account out of credits');
        }

        if (status === 429) {
          return new Error('Apify rate limit exceeded');
        }

        return new Error(`Apify API error: ${status}`);
      }

      if (axiosError.code === 'ECONNABORTED') {
        return new Error('Apify request timed out');
      }

      return new Error(`Apify network error: ${axiosError.message}`);
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(`Google Events unknown error: ${String(error)}`);
  }
}
