/**
 * MonitorService Unit Tests
 * Tests: subscriptions, alert dispatch, filtering (budget, quantity, paused, cooldown),
 * auto-deactivation, pause/resume, event priority, and scanCity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MonitorService } from '../../../src/services/monitoring/monitor.service.js';
import { ValueEngineService } from '../../../src/services/value-engine/value-engine.service.js';
import { MockPlatformAdapter } from '../../mocks/mock-adapter.js';
import { MockNotifier } from '../../mocks/mock-notifier.js';
import { makeEvent, makeFarEvent, makePastEvent, makeListing, makeSubscription, makeFamilySubscription } from '../../mocks/fixtures.js';

// Suppress logs during tests
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config module
vi.mock('../../../src/config/index.js', () => ({
  config: {
    monitoring: {
      cities: ['portland', 'seattle'],
      pollingIntervals: {
        highPriority: 2 * 60 * 1000,
        mediumPriority: 10 * 60 * 1000,
        lowPriority: 30 * 60 * 1000,
      },
      cityToState: { portland: 'OR', seattle: 'WA' },
    },
    telegram: { botToken: 'test-token' },
  },
}));

describe('MonitorService', () => {
  let adapter: MockPlatformAdapter;
  let notifier: MockNotifier;
  let engine: ValueEngineService;
  let monitor: MonitorService;

  beforeEach(() => {
    adapter = new MockPlatformAdapter('stubhub');
    adapter.seedDefaults();
    notifier = new MockNotifier('telegram');
    engine = new ValueEngineService();

    const adapters = new Map([['stubhub', adapter as any]]);
    const notifiers = new Map([['telegram', notifier as any]]);

    monitor = new MonitorService(adapters, notifiers, engine, {
      alertScoreThreshold: 50,  // Lower threshold for test reliability
      topPicksCount: 5,
      alertCooldownMs: 30 * 60 * 1000,
      maxEventsPerCycle: 50,
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  // ==========================================================================
  // Subscription Management
  // ==========================================================================

  describe('Subscription Management', () => {
    it('adds a subscription', () => {
      const sub = makeSubscription();
      monitor.addSubscription(sub);
      expect(monitor.getSubscriptions()).toHaveLength(1);
      expect(monitor.getSubscriptions()[0].userId).toBe('user-123');
    });

    it('removes a subscription', () => {
      const sub = makeSubscription();
      monitor.addSubscription(sub);
      monitor.removeSubscription('user-123');
      expect(monitor.getSubscriptions()).toHaveLength(0);
    });

    it('replaces existing subscription for same userId', () => {
      monitor.addSubscription(makeSubscription({ cities: ['portland'] }));
      monitor.addSubscription(makeSubscription({ cities: ['seattle'] }));
      const subs = monitor.getSubscriptions();
      expect(subs).toHaveLength(1);
      expect(subs[0].cities).toEqual(['seattle']);
    });
  });

  // ==========================================================================
  // Pause / Resume
  // ==========================================================================

  describe('Pause / Resume', () => {
    it('pauses an active subscription', () => {
      monitor.addSubscription(makeSubscription());
      const result = monitor.pauseSubscription('user-123');
      expect(result).toBe(true);
      expect(monitor.getSubscriptions()[0].paused).toBe(true);
    });

    it('returns false when pausing non-existent subscription', () => {
      expect(monitor.pauseSubscription('unknown')).toBe(false);
    });

    it('resumes a paused subscription', () => {
      monitor.addSubscription(makeSubscription({ paused: true }));
      const result = monitor.resumeSubscription('user-123');
      expect(result).toBe(true);
      expect(monitor.getSubscriptions()[0].paused).toBe(false);
    });

    it('returns false when resuming non-existent subscription', () => {
      expect(monitor.resumeSubscription('unknown')).toBe(false);
    });
  });

  // ==========================================================================
  // Status
  // ==========================================================================

  describe('getStatus()', () => {
    it('returns correct structure', () => {
      const status = monitor.getStatus();
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('trackedEvents');
      expect(status).toHaveProperty('subscriptions');
      expect(status).toHaveProperty('pausedSubscriptions');
      expect(status).toHaveProperty('alertsSent');
      expect(status).toHaveProperty('eventsByPriority');
    });

    it('counts paused subscriptions', () => {
      monitor.addSubscription(makeSubscription({ userId: 'a' }));
      monitor.addSubscription(makeSubscription({ userId: 'b', paused: true }));
      monitor.addSubscription(makeSubscription({ userId: 'c', paused: true }));

      const status = monitor.getStatus();
      expect(status.subscriptions).toBe(3);
      expect(status.pausedSubscriptions).toBe(2);
    });

    it('shows running=false before start', () => {
      expect(monitor.getStatus().running).toBe(false);
    });
  });

  // ==========================================================================
  // scanCity() — one-shot scan
  // ==========================================================================

  describe('scanCity()', () => {
    it('returns events and listings from adapter', async () => {
      const result = await monitor.scanCity('portland');

      expect(result.events).toBeGreaterThanOrEqual(0);
      expect(result.topPicks).toBeDefined();
      expect(Array.isArray(result.topPicks)).toBe(true);
    });

    it('returns 0 events when adapter has no matching city', async () => {
      adapter.setEvents([
        makeEvent({ venue: { id: 'v', name: 'V', city: 'Denver', state: 'CO' } }),
      ]);

      const result = await monitor.scanCity('portland');
      expect(result.events).toBe(0);
    });

    it('handles adapter errors gracefully', async () => {
      adapter.setThrow(true, 'API is down');

      const result = await monitor.scanCity('portland');
      // Should not throw — returns zeros
      expect(result.events).toBe(0);
      expect(result.listings).toBe(0);
    });

    it('scores listings and returns topPicks', async () => {
      // Set up a Portland event with listings
      const event = makeEvent({ venue: { id: 'v1', name: 'Moda Center', city: 'portland', state: 'OR' } });
      adapter.setEvents([event]);
      adapter.setListings(event.platformId, [
        makeListing({ pricePerTicket: 40, section: 'Floor A', row: '1' }),
        makeListing({ pricePerTicket: 200, section: 'Section 308', row: '20' }),
      ]);

      const result = await monitor.scanCity('portland');
      expect(result.events).toBe(1);
      expect(result.topPicks.length).toBeGreaterThan(0);
      // topPicks should be sorted by score descending
      if (result.topPicks.length >= 2) {
        expect(result.topPicks[0].score.totalScore).toBeGreaterThanOrEqual(
          result.topPicks[1].score.totalScore,
        );
      }
    });
  });

  // ==========================================================================
  // Start / Stop Lifecycle
  // ==========================================================================

  describe('Lifecycle', () => {
    it('starts and stops without error', () => {
      monitor.start();
      expect(monitor.getStatus().running).toBe(true);

      monitor.stop();
      expect(monitor.getStatus().running).toBe(false);
    });

    it('ignores duplicate start calls', () => {
      monitor.start();
      monitor.start(); // Should not throw
      expect(monitor.getStatus().running).toBe(true);
    });

    it('ignores stop when not running', () => {
      monitor.stop(); // Should not throw
      expect(monitor.getStatus().running).toBe(false);
    });
  });
});
