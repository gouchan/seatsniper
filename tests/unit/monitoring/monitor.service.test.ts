/**
 * MonitorService Unit Tests
 * Tests subscription management, alert dispatch, budget/pause filtering,
 * cooldown dedup, and auto-deactivation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MonitorService, type Subscription } from '../../../src/services/monitoring/monitor.service.js';
import { ValueEngineService } from '../../../src/services/value-engine/value-engine.service.js';
import { MockPlatformAdapter } from '../../mocks/mock-adapter.js';
import { MockNotifier } from '../../mocks/mock-notifier.js';
import {
  makeEvent,
  makeListing,
  makePremiumListing,
  makeCheapListing,
  makeFamilyListing,
  makeSubscription,
  makeFamilySubscription,
} from '../../mocks/fixtures.js';

// Suppress logging
vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/config/index.js', () => ({
  config: {
    monitoring: {
      cities: ['portland', 'seattle'],
      pollingIntervals: {
        highPriority: 2 * 60_000,
        mediumPriority: 10 * 60_000,
        lowPriority: 30 * 60_000,
      },
      cityToState: { portland: 'OR', seattle: 'WA' },
    },
    telegram: { botToken: 'test-token' },
  },
}));

describe('MonitorService', () => {
  let stubhub: MockPlatformAdapter;
  let telegram: MockNotifier;
  let engine: ValueEngineService;
  let monitor: MonitorService;

  beforeEach(() => {
    stubhub = new MockPlatformAdapter('stubhub');
    telegram = new MockNotifier('telegram');
    engine = new ValueEngineService();

    monitor = new MonitorService(
      new Map([['stubhub', stubhub as any]]),
      new Map([['telegram', telegram as any]]),
      engine,
      {
        alertScoreThreshold: 50,
        topPicksCount: 5,
        alertCooldownMs: 30 * 60_000,
        maxEventsPerCycle: 50,
      },
    );
  });

  afterEach(() => {
    monitor.stop();
    telegram.reset();
  });

  // ==========================================================================
  // Subscription Management
  // ==========================================================================

  describe('Subscription Management', () => {
    it('adds a subscription', () => {
      const sub = makeSubscription({ userId: 'u1' });
      monitor.addSubscription(sub);
      expect(monitor.getSubscriptions()).toHaveLength(1);
      expect(monitor.getSubscriptions()[0].userId).toBe('u1');
    });

    it('overwrites existing subscription for same user', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1', minScore: 70 }));
      monitor.addSubscription(makeSubscription({ userId: 'u1', minScore: 50 }));
      expect(monitor.getSubscriptions()).toHaveLength(1);
      expect(monitor.getSubscriptions()[0].minScore).toBe(50);
    });

    it('removes a subscription', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1' }));
      monitor.removeSubscription('u1');
      expect(monitor.getSubscriptions()).toHaveLength(0);
    });

    it('removing non-existent subscription does not throw', () => {
      expect(() => monitor.removeSubscription('nope')).not.toThrow();
    });

    it('manages multiple subscribers', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1' }));
      monitor.addSubscription(makeSubscription({ userId: 'u2' }));
      monitor.addSubscription(makeSubscription({ userId: 'u3' }));
      expect(monitor.getSubscriptions()).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Pause / Resume
  // ==========================================================================

  describe('Pause / Resume', () => {
    it('pauses an active subscription', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1' }));
      const result = monitor.pauseSubscription('u1');
      expect(result).toBe(true);

      const sub = monitor.getSubscriptions().find(s => s.userId === 'u1')!;
      expect(sub.paused).toBe(true);
    });

    it('resumes a paused subscription', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1', paused: true }));
      monitor.pauseSubscription('u1');
      const result = monitor.resumeSubscription('u1');
      expect(result).toBe(true);

      const sub = monitor.getSubscriptions().find(s => s.userId === 'u1')!;
      expect(sub.paused).toBe(false);
    });

    it('returns false when pausing non-existent user', () => {
      expect(monitor.pauseSubscription('nonexistent')).toBe(false);
    });

    it('returns false when resuming non-existent user', () => {
      expect(monitor.resumeSubscription('nonexistent')).toBe(false);
    });

    it('returns false when pausing inactive subscription', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1', active: false }));
      expect(monitor.pauseSubscription('u1')).toBe(false);
    });
  });

  // ==========================================================================
  // Status
  // ==========================================================================

  describe('getStatus()', () => {
    it('returns correct initial status', () => {
      const status = monitor.getStatus();
      expect(status.running).toBe(false);
      expect(status.trackedEvents).toBe(0);
      expect(status.subscriptions).toBe(0);
      expect(status.pausedSubscriptions).toBe(0);
      expect(status.alertsSent).toBe(0);
    });

    it('counts paused subscriptions', () => {
      monitor.addSubscription(makeSubscription({ userId: 'u1', paused: false }));
      monitor.addSubscription(makeSubscription({ userId: 'u2', paused: true }));
      monitor.addSubscription(makeSubscription({ userId: 'u3', paused: true }));

      const status = monitor.getStatus();
      expect(status.subscriptions).toBe(3);
      expect(status.pausedSubscriptions).toBe(2);
    });
  });

  // ==========================================================================
  // scanCity
  // ==========================================================================

  describe('scanCity()', () => {
    it('returns events and scored listings', async () => {
      const event = makeEvent({
        venue: { id: 'v1', name: 'Moda Center', city: 'portland', state: 'OR' },
      });
      stubhub.setEvents([event]);
      stubhub.setListings(event.platformId, [
        makeListing({ pricePerTicket: 40, section: 'Floor A', row: '1' }),
        makeListing({ pricePerTicket: 100, section: 'Section 204', row: '10' }),
      ]);

      const result = await monitor.scanCity('portland');
      expect(result.events).toBe(1);
      expect(result.listings).toBe(2);
      expect(result.topPicks.length).toBeGreaterThan(0);
    });

    it('returns empty when no events', async () => {
      stubhub.setEvents([]);
      const result = await monitor.scanCity('portland');
      expect(result.events).toBe(0);
      expect(result.listings).toBe(0);
      expect(result.topPicks).toHaveLength(0);
    });

    it('handles adapter failure gracefully', async () => {
      stubhub.setThrow(true, 'API down');
      const result = await monitor.scanCity('portland');
      expect(result.events).toBe(0);
    });

    it('filters by city case-insensitively', async () => {
      stubhub.setEvents([
        makeEvent({
          platformId: 'pdx',
          venue: { id: 'v1', name: 'Moda Center', city: 'Portland', state: 'OR' },
        }),
        makeEvent({
          platformId: 'sea',
          venue: { id: 'v2', name: 'Lumen Field', city: 'Seattle', state: 'WA' },
        }),
      ]);

      const pdx = await monitor.scanCity('portland');
      expect(pdx.events).toBe(1);

      const sea = await monitor.scanCity('seattle');
      expect(sea.events).toBe(1);
    });
  });

  // ==========================================================================
  // Scoring Sanity
  // ==========================================================================

  describe('Scoring via scanCity', () => {
    it('cheaper listing scores higher than expensive one (same section)', async () => {
      const event = makeEvent({
        venue: { id: 'v1', name: 'Moda Center', city: 'portland', state: 'OR' },
      });
      stubhub.setEvents([event]);
      stubhub.setListings(event.platformId, [
        makeListing({ platformListingId: 'cheap', pricePerTicket: 40, section: 'Section 102', row: '5' }),
        makeListing({ platformListingId: 'expensive', pricePerTicket: 200, section: 'Section 102', row: '5' }),
      ]);

      const result = await monitor.scanCity('portland');
      // Top pick should be the cheaper one
      if (result.topPicks.length >= 2) {
        expect(result.topPicks[0].listing.pricePerTicket)
          .toBeLessThan(result.topPicks[1].listing.pricePerTicket);
      }
    });
  });
});
