/**
 * Mock Platform Adapter
 * In-memory adapter that returns configurable fake events and listings.
 * Used to test the entire pipeline without hitting real APIs.
 */

import type {
  IPlatformAdapter,
  PlatformConfig,
  EventSearchParams,
  NormalizedEvent,
  NormalizedListing,
  HealthStatus,
} from '../../src/adapters/base/platform-adapter.interface.js';
import type { CircuitBreakerPolicy } from 'cockatiel';
import { makeEvent, makeListing, makeListingBatch } from './fixtures.js';

export class MockPlatformAdapter implements IPlatformAdapter {
  readonly config: PlatformConfig;
  readonly circuitBreaker: CircuitBreakerPolicy;

  /** Configurable responses */
  private events: NormalizedEvent[] = [];
  private listings: Map<string, NormalizedListing[]> = new Map();
  private healthy = true;
  private shouldThrow = false;
  private throwMessage = 'Mock adapter error';

  /** Call tracking */
  calls = {
    initialize: 0,
    searchEvents: 0,
    getEventListings: 0,
    getHealthStatus: 0,
  };

  constructor(platformName: string = 'mock-stubhub') {
    this.config = {
      name: platformName,
      baseUrl: 'https://mock.api',
      rateLimit: { requestsPerMinute: 100 },
      timeout: 5000,
      retryAttempts: 1,
    };

    // Minimal circuit breaker stub (never trips)
    this.circuitBreaker = {
      state: 'closed',
      onStateChange: () => ({ dispose: () => {} }),
      execute: async (fn: () => Promise<unknown>) => fn(),
    } as unknown as CircuitBreakerPolicy;
  }

  // ==========================================================================
  // Configuration Helpers
  // ==========================================================================

  /** Set events that will be returned from searchEvents */
  setEvents(events: NormalizedEvent[]): this {
    this.events = events;
    return this;
  }

  /** Set listings that will be returned for a specific event */
  setListings(eventId: string, listings: NormalizedListing[]): this {
    this.listings.set(eventId, listings);
    return this;
  }

  /** Make the adapter throw on next call */
  setThrow(shouldThrow: boolean, message: string = 'Mock adapter error'): this {
    this.shouldThrow = shouldThrow;
    this.throwMessage = message;
    return this;
  }

  /** Set health status */
  setHealthy(healthy: boolean): this {
    this.healthy = healthy;
    return this;
  }

  /** Seed with realistic default data: 3 events, 10 listings each */
  seedDefaults(): this {
    const events = [
      makeEvent({ platformId: 'evt-001', platform: this.config.name as any }),
      makeEvent({
        platformId: 'evt-002',
        platform: this.config.name as any,
        name: 'Seattle Seahawks vs SF 49ers',
        venue: { id: 'v2', name: 'Lumen Field', city: 'Seattle', state: 'WA' },
      }),
      makeEvent({
        platformId: 'evt-003',
        platform: this.config.name as any,
        name: 'Foo Fighters at Climate Pledge',
        venue: { id: 'v3', name: 'Climate Pledge Arena', city: 'Seattle', state: 'WA' },
      }),
    ];

    this.setEvents(events);

    for (const event of events) {
      this.setListings(
        event.platformId,
        makeListingBatch(10).map(l => ({
          ...l,
          eventId: event.platformId,
          platform: this.config.name as any,
        })),
      );
    }

    return this;
  }

  /** Reset call counters */
  resetCalls(): void {
    this.calls = { initialize: 0, searchEvents: 0, getEventListings: 0, getHealthStatus: 0 };
  }

  // ==========================================================================
  // IPlatformAdapter Implementation
  // ==========================================================================

  async initialize(): Promise<void> {
    this.calls.initialize++;
    if (this.shouldThrow) throw new Error(this.throwMessage);
  }

  async searchEvents(_params: EventSearchParams): Promise<NormalizedEvent[]> {
    this.calls.searchEvents++;
    if (this.shouldThrow) throw new Error(this.throwMessage);

    // Filter by city if events have venue city set
    const city = _params.city?.toLowerCase();
    if (city) {
      return this.events.filter(e => e.venue.city.toLowerCase() === city);
    }

    return [...this.events];
  }

  async getEventListings(platformEventId: string): Promise<NormalizedListing[]> {
    this.calls.getEventListings++;
    if (this.shouldThrow) throw new Error(this.throwMessage);

    return this.listings.get(platformEventId) || [];
  }

  async getHealthStatus(): Promise<HealthStatus> {
    this.calls.getHealthStatus++;
    return {
      healthy: this.healthy,
      latency: 42,
      lastChecked: new Date(),
      circuitState: 'closed',
    };
  }
}
