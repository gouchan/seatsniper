/**
 * Monitoring Service
 * Core polling loop that discovers events, scores listings,
 * and triggers alerts when high-value deals are found.
 */

import type {
  IPlatformAdapter,
  NormalizedEvent,
  NormalizedListing,
  EventSearchParams,
} from '../../adapters/base/platform-adapter.interface.js';
import type { INotifier, TopValueListing, AlertPayload } from '../../notifications/base/notifier.interface.js';
import { AlertType } from '../../notifications/base/notifier.interface.js';
import { ValueEngineService } from '../value-engine/value-engine.service.js';
import type { ScoredListing, HistoricalPrice } from '../value-engine/value-score.types.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import * as PriceHistoryRepo from '../../data/repositories/price-history.repository.js';
import * as AlertRepo from '../../data/repositories/alert.repository.js';
import * as EventGroupRepo from '../../data/repositories/event-group.repository.js';
import { matchEvents, findMatchesForEvent, type EventMatch } from '../matching/event-matching.service.js';
import { comparePrices, type EventComparison } from '../value-engine/price-comparator.js';

// ============================================================================
// Types
// ============================================================================

export interface Subscription {
  /** User identifier (Telegram chat ID, phone number) */
  userId: string;
  /** Notification channel to use */
  channel: 'telegram' | 'sms' | 'whatsapp';
  /** Cities to monitor */
  cities: string[];
  /** Minimum value score to trigger alerts */
  minScore: number;
  /** Minimum number of consecutive seats needed (for families) */
  minQuantity: number;
  /** Maximum price per ticket (budget cap). 0 = no limit. */
  maxPricePerTicket: number;
  /** Keywords to filter events (optional) */
  keywords?: string[];
  /** Event categories to watch */
  categories?: string[];
  /** Active flag (false = soft-deleted) */
  active: boolean;
  /** Paused flag (true = temporarily muted, settings preserved) */
  paused: boolean;
  /** User tier for payment readiness */
  userTier: 'free' | 'pro' | 'premium';
}

export interface MonitorConfig {
  /** Score threshold to trigger alerts (default: 70) */
  alertScoreThreshold: number;
  /** Number of top picks to include in alerts (default: 5) */
  topPicksCount: number;
  /** Alert cooldown per event per user in ms (default: 30 min) */
  alertCooldownMs: number;
  /** Maximum events to process per poll cycle (default: 50) */
  maxEventsPerCycle: number;
}

interface TrackedEvent {
  event: NormalizedEvent;
  lastPolled: Date;
  lastListingCount: number;
}

interface AlertRecord {
  eventId: string;
  userId: string;
  sentAt: Date;
  topScore: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  alertScoreThreshold: 70,
  topPicksCount: 5,
  alertCooldownMs: 30 * 60 * 1000, // 30 minutes
  maxEventsPerCycle: 50,
};

// ============================================================================
// Monitor Service
// ============================================================================

export class MonitorService {
  private adapters: Map<string, IPlatformAdapter>;
  private notifiers: Map<string, INotifier>;
  private valueEngine: ValueEngineService;
  private monitorConfig: MonitorConfig;

  // State
  private isRunning = false;
  private timers: NodeJS.Timeout[] = [];
  private trackedEvents: Map<string, TrackedEvent> = new Map();
  private alertHistory: AlertRecord[] = [];
  private subscriptions: Map<string, Subscription> = new Map(); // keyed by userId
  private activeCycles: Set<string> = new Set(); // guards against overlapping cycles
  private eventMatches: Map<string, EventMatch> = new Map(); // groupId -> match

  constructor(
    adapters: Map<string, IPlatformAdapter>,
    notifiers: Map<string, INotifier>,
    valueEngine: ValueEngineService,
    monitorConfig: Partial<MonitorConfig> = {},
  ) {
    this.adapters = adapters;
    this.notifiers = notifiers;
    this.valueEngine = valueEngine;
    this.monitorConfig = { ...DEFAULT_MONITOR_CONFIG, ...monitorConfig };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the monitoring loop with priority-based polling
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[Monitor] Already running');
      return;
    }

    this.isRunning = true;
    logger.info('[Monitor] Starting monitoring loop', {
      cities: config.monitoring.cities,
      adapters: [...this.adapters.keys()],
      notifiers: [...this.notifiers.keys()],
      alertThreshold: this.monitorConfig.alertScoreThreshold,
    });

    // Run initial discovery immediately
    void this.runDiscoveryCycle();

    // Schedule polling at different priorities
    const { pollingIntervals } = config.monitoring;

    // High priority: events within 7 days — poll every 2 minutes
    const highTimer = setInterval(
      () => void this.runListingsCycle('high'),
      pollingIntervals.highPriority,
    );
    this.timers.push(highTimer);

    // Medium priority: events within 30 days — poll every 10 minutes
    const medTimer = setInterval(
      () => void this.runListingsCycle('medium'),
      pollingIntervals.mediumPriority,
    );
    this.timers.push(medTimer);

    // Low priority: events beyond 30 days — poll every 30 minutes
    const lowTimer = setInterval(
      () => void this.runListingsCycle('low'),
      pollingIntervals.lowPriority,
    );
    this.timers.push(lowTimer);

    // Discovery cycle: find new events every 15 minutes
    const discoveryTimer = setInterval(
      () => void this.runDiscoveryCycle(),
      15 * 60 * 1000,
    );
    this.timers.push(discoveryTimer);

    // Prune stale alert history every hour
    const pruneTimer = setInterval(
      () => this.pruneAlertHistory(),
      60 * 60 * 1000,
    );
    this.timers.push(pruneTimer);

    logger.info('[Monitor] Polling timers started');
  }

  /**
   * Stop the monitoring loop and clean up
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];

    logger.info('[Monitor] Stopped', {
      trackedEvents: this.trackedEvents.size,
      alertsSent: this.alertHistory.length,
    });
  }

  // ==========================================================================
  // Subscriptions
  // ==========================================================================

  addSubscription(sub: Subscription): void {
    this.subscriptions.set(sub.userId, sub);
    logger.info('[Monitor] Subscription added', {
      userId: sub.userId,
      channel: sub.channel,
      cities: sub.cities,
      minScore: sub.minScore,
      minQuantity: sub.minQuantity,
    });
  }

  removeSubscription(userId: string): void {
    this.subscriptions.delete(userId);
    logger.info('[Monitor] Subscription removed', { userId });
  }

  getSubscriptions(): Subscription[] {
    return [...this.subscriptions.values()];
  }

  // ==========================================================================
  // Discovery Cycle — find new events
  // ==========================================================================

  private async runDiscoveryCycle(): Promise<void> {
    if (!this.isRunning) return;
    if (this.activeCycles.has('discovery')) {
      logger.debug('[Monitor] Discovery cycle already running, skipping');
      return;
    }

    this.activeCycles.add('discovery');
    try {
      logger.info('[Monitor] Running event discovery cycle');

      // Prune past events first (>1 day past)
      this.pruneTrackedEvents();

      const cities = config.monitoring.cities;
      const now = new Date();

      // Parallelize across cities
      const cityPromises = cities.map(async (city) => {
        const searchParams: EventSearchParams = {
          city,
          startDate: now,
          endDate: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), // 90 days out
          limit: 100,
        };

        // Query all adapters in parallel per city
        const adapterPromises = [...this.adapters.entries()].map(
          async ([name, adapter]) => {
            try {
              const events = await adapter.searchEvents(searchParams);
              logger.debug(`[Monitor] ${name} found ${events.length} events in ${city}`);
              return events;
            } catch (error) {
              logger.warn(`[Monitor] ${name} discovery failed for ${city}`, {
                error: error instanceof Error ? error.message : String(error),
              });
              return [] as NormalizedEvent[];
            }
          },
        );

        const results = await Promise.allSettled(adapterPromises);
        return results
          .filter((r): r is PromiseFulfilledResult<NormalizedEvent[]> => r.status === 'fulfilled')
          .flatMap(r => r.value);
      });

      const citiesResults = await Promise.allSettled(cityPromises);
      const allEvents = citiesResults
        .filter((r): r is PromiseFulfilledResult<NormalizedEvent[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);

      for (const event of allEvents) {
        const key = `${event.platform}:${event.platformId}`;
        if (!this.trackedEvents.has(key)) {
          this.trackedEvents.set(key, {
            event,
            lastPolled: new Date(0), // Never polled
            lastListingCount: 0,
          });
        }
      }

      // Run cross-platform matching on all discovered events
      if (allEvents.length > 0) {
        await this.runEventMatching(allEvents);
      }

      logger.info('[Monitor] Discovery complete', {
        totalTracked: this.trackedEvents.size,
        crossPlatformMatches: this.eventMatches.size,
      });
    } finally {
      this.activeCycles.delete('discovery');
    }
  }

  /**
   * Match events across platforms and persist groups
   */
  private async runEventMatching(events: NormalizedEvent[]): Promise<void> {
    const matches = matchEvents(events);

    for (const match of matches) {
      this.eventMatches.set(match.groupId, match);

      // Persist to database (best-effort)
      try {
        const members = Array.from(match.events.entries()).map(([platform, event]) => ({
          platform,
          platformEventId: event.platformId,
        }));

        await EventGroupRepo.upsertEventGroup({
          groupId: match.groupId,
          canonicalName: match.canonicalName,
          venueName: match.venueName,
          eventDate: match.eventDate,
          members,
        });
      } catch (err) {
        // Non-fatal - matching still works in-memory
        logger.debug('[Monitor] Failed to persist event group', {
          groupId: match.groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (matches.length > 0) {
      logger.info('[Monitor] Cross-platform matches found', {
        matchCount: matches.length,
        avgConfidence: Math.round(
          matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length,
        ),
      });
    }
  }

  /**
   * Remove past events (>1 day old) to prevent memory leak
   */
  private pruneTrackedEvents(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const [key, tracked] of this.trackedEvents) {
      if (tracked.event.dateTime.getTime() < cutoff) {
        this.trackedEvents.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.debug(`[Monitor] Pruned ${pruned} past events`);
    }
  }

  // ==========================================================================
  // Listings Cycle — fetch listings and score
  // ==========================================================================

  private async runListingsCycle(priority: 'high' | 'medium' | 'low'): Promise<void> {
    if (!this.isRunning) return;
    if (this.subscriptions.size === 0) {
      logger.debug(`[Monitor] Skipping ${priority} cycle — no subscriptions`);
      return;
    }
    if (this.activeCycles.has(priority)) {
      logger.debug(`[Monitor] ${priority} cycle already running, skipping`);
      return;
    }

    this.activeCycles.add(priority);
    try {
      const now = new Date();
      const eventsToProcess = this.getEventsForPriority(priority, now);

      if (eventsToProcess.length === 0) {
        logger.debug(`[Monitor] No ${priority}-priority events to process`);
        return;
      }

      logger.info(`[Monitor] Processing ${eventsToProcess.length} ${priority}-priority events`);

      // Process events in batches to respect rate limits
      const batchSize = 5;
      for (let i = 0; i < eventsToProcess.length; i += batchSize) {
        if (!this.isRunning) break;

        const batch = eventsToProcess.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(tracked => this.processEvent(tracked)),
        );
      }
    } finally {
      this.activeCycles.delete(priority);
    }
  }

  /**
   * Get events matching a priority tier based on how soon they occur
   */
  private getEventsForPriority(
    priority: 'high' | 'medium' | 'low',
    now: Date,
  ): TrackedEvent[] {
    const msInDay = 24 * 60 * 60 * 1000;
    const maxEvents = this.monitorConfig.maxEventsPerCycle;

    return [...this.trackedEvents.values()]
      .filter(tracked => {
        const daysUntil = (tracked.event.dateTime.getTime() - now.getTime()) / msInDay;

        // Skip past events
        if (daysUntil < 0) return false;

        switch (priority) {
          case 'high':
            return daysUntil <= 7;
          case 'medium':
            return daysUntil > 7 && daysUntil <= 30;
          case 'low':
            return daysUntil > 30;
        }
      })
      .sort((a, b) => a.event.dateTime.getTime() - b.event.dateTime.getTime())
      .slice(0, maxEvents);
  }

  // ==========================================================================
  // Event Processing — fetch listings, score, alert
  // ==========================================================================

  private async processEvent(tracked: TrackedEvent): Promise<void> {
    const { event } = tracked;
    const adapter = this.adapters.get(event.platform);
    if (!adapter) return;

    // Skip past events
    const daysUntilEvent = Math.ceil(
      (event.dateTime.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    if (daysUntilEvent < 0) {
      return;
    }

    try {
      // Fetch current listings
      const listings = await adapter.getEventListings(event.platformId);
      tracked.lastPolled = new Date();

      if (listings.length === 0) {
        tracked.lastListingCount = 0;
        return;
      }

      // Calculate context for scoring
      const averagePrice = this.valueEngine.calculateAveragePrice(listings);

      // Load historical price data from DB (best-effort, falls back to empty)
      let historicalData = new Map<string, HistoricalPrice[]>();
      try {
        historicalData = await PriceHistoryRepo.getEventHistoricalPrices(event.platformId);
      } catch (err) {
        // DB unavailable - continue with empty history
      }

      // Record current prices for future historical comparison (best-effort)
      this.recordPriceSnapshot(event.platformId, listings).catch(() => {
        // Ignore failures - this is non-critical
      });

      // Score all listings
      const scoredListings = this.valueEngine.scoreListings(listings, {
        averagePrice,
        sectionTiers: {}, // Will use defaults from SectionRanker
        historicalData,
        eventPopularity: 50, // TODO: Calculate from tracked event interest
        daysUntilEvent,
      });

      // Get top picks above threshold
      const topPicks = this.valueEngine
        .getTopValuePicks(scoredListings, this.monitorConfig.topPicksCount)
        .filter(sl => sl.score.totalScore >= this.monitorConfig.alertScoreThreshold);

      if (topPicks.length === 0) {
        tracked.lastListingCount = listings.length;
        return;
      }

      logger.info(`[Monitor] Found ${topPicks.length} high-value listings for "${event.name}"`, {
        event: event.name,
        topScore: topPicks[0].score.totalScore,
        avgPrice: Math.round(averagePrice),
      });

      // Send alerts to matching subscribers
      await this.sendAlerts(event, topPicks);
      tracked.lastListingCount = listings.length;
    } catch (error) {
      logger.warn(`[Monitor] Failed to process event "${event.name}"`, {
        eventId: event.platformId,
        platform: event.platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ==========================================================================
  // Alert Dispatch
  // ==========================================================================

  private async sendAlerts(
    event: NormalizedEvent,
    topPicks: ScoredListing[],
  ): Promise<void> {
    // Find matching subscribers (basic filters first)
    const potentialSubscribers = [...this.subscriptions.values()].filter(sub => {
      if (!sub.active) return false;
      if (sub.paused) return false;
      if (!sub.cities.some(c => c.toLowerCase() === event.venue.city.toLowerCase())) return false;

      // Category filter (if specified)
      if (sub.categories && sub.categories.length > 0) {
        if (!sub.categories.some(c => c.toLowerCase() === event.category.toLowerCase())) {
          return false;
        }
      }

      // Keyword filter (if specified) - match against event name
      if (sub.keywords && sub.keywords.length > 0) {
        const eventNameLower = event.name.toLowerCase();
        const hasMatch = sub.keywords.some(kw => eventNameLower.includes(kw.toLowerCase()));
        if (!hasMatch) return false;
      }

      return true;
    });

    if (potentialSubscribers.length === 0) return;

    // Check cooldowns asynchronously
    const cooldownChecks = await Promise.all(
      potentialSubscribers.map(async sub => ({
        sub,
        onCooldown: await this.isAlertOnCooldown(event.platformId, sub.userId),
      })),
    );
    const matchingSubscribers = cooldownChecks
      .filter(c => !c.onCooldown)
      .map(c => c.sub);

    if (matchingSubscribers.length === 0) return;

    // Get seat map URL (try event first, then venue lookup)
    let seatMapUrl = event.seatMapUrl;
    if (!seatMapUrl) {
      // Try SeatGeek venue lookup if it has the adapter
      const seatgeek = this.adapters.get('seatgeek');
      if (seatgeek && 'findVenue' in seatgeek) {
        try {
          const venueInfo = await (seatgeek as any).findVenue(
            event.venue.name,
            event.venue.city,
          );
          if (venueInfo?.seatMapUrl) {
            seatMapUrl = venueInfo.seatMapUrl;
          }
        } catch {
          // Non-fatal
        }
      }
    }

    for (const sub of matchingSubscribers) {
      // Filter picks by quantity (family seat requirement)
      let qualifyingPicks = sub.minQuantity > 1
        ? topPicks.filter(sp => sp.listing.quantity >= sub.minQuantity)
        : topPicks;

      // Filter picks by budget (max price per ticket)
      if (sub.maxPricePerTicket > 0) {
        qualifyingPicks = qualifyingPicks.filter(
          sp => sp.listing.pricePerTicket <= sub.maxPricePerTicket,
        );
      }

      if (qualifyingPicks.length === 0) continue;

      // Get cross-platform comparison (best-effort)
      let crossPlatformComparison: AlertPayload['crossPlatformComparison'];
      try {
        const comparison = await this.getCrossPlatformComparison(event);
        if (comparison && comparison.platformsCompared.length >= 2) {
          crossPlatformComparison = {
            platformsCompared: comparison.platformsCompared,
            sections: comparison.sections.map(s => ({
              section: s.section,
              prices: s.prices.map(p => ({ platform: p.platform, price: p.price, url: p.url })),
              bestDeal: s.bestDeal ? {
                platform: s.bestDeal.platform,
                price: s.bestDeal.price,
                savings: s.bestDeal.savings,
              } : null,
            })),
            overallBestDeal: comparison.overallBestDeal,
          };
        }
      } catch (err) {
        // Non-fatal - continue without comparison
        logger.debug('[Monitor] Cross-platform comparison failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Build alert payload
      const payload: AlertPayload = {
        userId: sub.userId,
        eventName: event.name,
        venueName: event.venue.name,
        venueCity: event.venue.city,
        eventDate: event.dateTime,
        listings: qualifyingPicks.map((sp, idx) => this.scoredToAlertListing(sp, idx + 1)),
        alertType: AlertType.HIGH_VALUE,
        seatMapUrl,
        crossPlatformComparison,
      };

      // Send via the appropriate notifier
      const notifier = this.notifiers.get(sub.channel);
      if (!notifier) {
        logger.warn(`[Monitor] No notifier for channel "${sub.channel}"`);
        continue;
      }

      try {
        const result = await notifier.sendAlert(payload);
        if (result.success) {
          this.recordAlert(event.platformId, sub.userId, qualifyingPicks[0].score.totalScore, sub.channel);
          logger.info(`[Monitor] Alert sent to ${sub.userId} via ${sub.channel}`, {
            event: event.name,
            picks: qualifyingPicks.length,
            topScore: qualifyingPicks[0].score.totalScore,
          });
        } else {
          logger.warn(`[Monitor] Alert delivery failed: ${result.error}`, {
            userId: sub.userId,
            channel: sub.channel,
          });
          // Auto-deactivate if user blocked bot or chat not found
          if (this.shouldDeactivateOnError(result.error)) {
            this.deactivateSubscription(sub.userId);
          }
        }
      } catch (error) {
        logger.error(`[Monitor] Alert send error`, {
          userId: sub.userId,
          channel: sub.channel,
          error: error instanceof Error ? error.message : String(error),
        });
        // Check for block/not-found errors in exceptions too
        const msg = error instanceof Error ? error.message.toLowerCase() : '';
        if (msg.includes('forbidden') || msg.includes('blocked') || msg.includes('chat not found')) {
          this.deactivateSubscription(sub.userId);
        }
      }
    }
  }

  // ==========================================================================
  // Alert Deduplication
  // ==========================================================================

  private async isAlertOnCooldown(eventId: string, userId: string): Promise<boolean> {
    // Check in-memory first (faster, handles case where DB is unavailable)
    const now = Date.now();
    const inMemoryCooldown = this.alertHistory.some(
      record =>
        record.eventId === eventId &&
        record.userId === userId &&
        now - record.sentAt.getTime() < this.monitorConfig.alertCooldownMs,
    );
    if (inMemoryCooldown) return true;

    // Also check DB for persistence across restarts
    try {
      return await AlertRepo.isAlertOnCooldown(eventId, userId, this.monitorConfig.alertCooldownMs);
    } catch {
      // DB unavailable - rely on in-memory only
      return false;
    }
  }

  private recordAlert(eventId: string, userId: string, topScore: number, channel: string): void {
    // Record in-memory for fast deduplication
    this.alertHistory.push({
      eventId,
      userId,
      sentAt: new Date(),
      topScore,
    });

    // Persist to DB (best-effort, non-blocking)
    AlertRepo.recordAlert({
      eventId,
      userId,
      channel,
      alertType: 'high_value',
      topScore,
      success: true,
    }).catch(err => {
      logger.warn('[Monitor] Failed to persist alert', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private pruneAlertHistory(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // Keep 24 hours
    const before = this.alertHistory.length;
    this.alertHistory = this.alertHistory.filter(r => r.sentAt.getTime() > cutoff);

    if (before !== this.alertHistory.length) {
      logger.debug(`[Monitor] Pruned ${before - this.alertHistory.length} alert records`);
    }
  }

  // ==========================================================================
  // Price History Recording
  // ==========================================================================

  /**
   * Record current prices per section for historical tracking.
   * Groups listings by section and records aggregate stats.
   */
  private async recordPriceSnapshot(
    eventId: string,
    listings: Array<{ section: string; pricePerTicket: number }>,
  ): Promise<void> {
    // Group listings by section
    const sectionMap = new Map<string, number[]>();
    for (const listing of listings) {
      if (listing.pricePerTicket <= 0) continue; // Skip invalid prices
      const prices = sectionMap.get(listing.section) || [];
      prices.push(listing.pricePerTicket);
      sectionMap.set(listing.section, prices);
    }

    // Build snapshot records
    const snapshots: Array<{
      section: string;
      averagePrice: number;
      lowestPrice: number;
      highestPrice: number;
      listingCount: number;
    }> = [];

    for (const [section, prices] of sectionMap) {
      if (prices.length === 0) continue;
      snapshots.push({
        section,
        averagePrice: prices.reduce((a, b) => a + b, 0) / prices.length,
        lowestPrice: Math.min(...prices),
        highestPrice: Math.max(...prices),
        listingCount: prices.length,
      });
    }

    if (snapshots.length > 0) {
      await PriceHistoryRepo.recordPriceSnapshots(eventId, snapshots);
    }
  }

  // ==========================================================================
  // Subscription Lifecycle
  // ==========================================================================

  /**
   * Pause a subscription (preserves settings, stops alerts)
   */
  pauseSubscription(userId: string): boolean {
    const sub = this.subscriptions.get(userId);
    if (!sub || !sub.active) return false;
    sub.paused = true;
    logger.info('[Monitor] Subscription paused', { userId });
    return true;
  }

  /**
   * Resume a paused subscription
   */
  resumeSubscription(userId: string): boolean {
    const sub = this.subscriptions.get(userId);
    if (!sub || !sub.active) return false;
    sub.paused = false;
    logger.info('[Monitor] Subscription resumed', { userId });
    return true;
  }

  /**
   * Deactivate a subscription (e.g., user blocked bot)
   */
  private deactivateSubscription(userId: string): void {
    const sub = this.subscriptions.get(userId);
    if (sub) {
      sub.active = false;
      logger.warn('[Monitor] Subscription auto-deactivated', { userId });
    }
  }

  /**
   * Check if an error message indicates the subscription should be deactivated
   */
  private shouldDeactivateOnError(errorMsg?: string): boolean {
    if (!errorMsg) return false;
    const lower = errorMsg.toLowerCase();
    return (
      lower.includes('blocked') ||
      lower.includes('forbidden') ||
      lower.includes('chat not found') ||
      lower.includes('user is deactivated') ||
      lower.includes('bot was kicked')
    );
  }

  // ==========================================================================
  // Cross-Platform Comparison
  // ==========================================================================

  /**
   * Get cross-platform price comparison for an event.
   * Returns null if no cross-platform matches exist.
   */
  async getCrossPlatformComparison(event: NormalizedEvent): Promise<EventComparison | null> {
    // Find matches for this event
    const allTrackedEvents = [...this.trackedEvents.values()].map(t => t.event);
    const match = findMatchesForEvent(event, allTrackedEvents);

    if (!match || match.events.size < 2) {
      return null;
    }

    // Fetch listings from each platform
    const platformListings = new Map<string, { event: NormalizedEvent; listings: any[] }>();

    for (const [platform, matchedEvent] of match.events) {
      const adapter = this.adapters.get(platform);
      if (!adapter) continue;

      try {
        const listings = await adapter.getEventListings(matchedEvent.platformId);
        platformListings.set(platform, { event: matchedEvent, listings });
      } catch (err) {
        logger.debug(`[Monitor] Failed to fetch listings from ${platform} for comparison`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (platformListings.size < 2) {
      return null;
    }

    return comparePrices(platformListings);
  }

  /**
   * Get cross-platform matches for display
   */
  getEventMatches(): EventMatch[] {
    return [...this.eventMatches.values()];
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private scoredToAlertListing(scored: ScoredListing, rank: number): TopValueListing {
    return {
      rank,
      section: scored.listing.section,
      row: scored.listing.row,
      quantity: scored.listing.quantity,
      pricePerTicket: scored.listing.pricePerTicket,
      valueScore: scored.score.totalScore,
      recommendation: scored.score.reasoning,
      deepLink: scored.listing.deepLink,
      platform: scored.listing.platform,
    };
  }

  // ==========================================================================
  // Diagnostic Methods
  // ==========================================================================

  getStatus(): {
    running: boolean;
    trackedEvents: number;
    subscriptions: number;
    pausedSubscriptions: number;
    alertsSent: number;
    eventsByPriority: { high: number; medium: number; low: number; past: number };
  } {
    const now = new Date();
    const msInDay = 24 * 60 * 60 * 1000;
    let high = 0;
    let medium = 0;
    let low = 0;
    let past = 0;

    for (const tracked of this.trackedEvents.values()) {
      const daysUntil = (tracked.event.dateTime.getTime() - now.getTime()) / msInDay;
      if (daysUntil < 0) past++;
      else if (daysUntil <= 7) high++;
      else if (daysUntil <= 30) medium++;
      else low++;
    }

    const allSubs = [...this.subscriptions.values()];
    const pausedCount = allSubs.filter(s => s.paused).length;

    return {
      running: this.isRunning,
      trackedEvents: this.trackedEvents.size,
      subscriptions: this.subscriptions.size,
      pausedSubscriptions: pausedCount,
      alertsSent: this.alertHistory.length,
      eventsByPriority: { high, medium, low, past },
    };
  }

  /**
   * Run a one-shot scan for a specific city (useful for testing)
   */
  async scanCity(city: string): Promise<{
    events: number;
    listings: number;
    topPicks: ScoredListing[];
    /** Up to 10 upcoming events with details (name, venue, date, price range) */
    upcomingEvents: NormalizedEvent[];
  }> {
    const now = new Date();
    const searchParams: EventSearchParams = {
      city,
      startDate: now,
      endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      limit: 20,
    };

    let totalEvents = 0;
    let totalListings = 0;
    const allScoredListings: ScoredListing[] = [];
    const allEvents: NormalizedEvent[] = [];

    // Parallelize across adapters
    const adapterResults = await Promise.allSettled(
      [...this.adapters.entries()].map(async ([name, adapter]) => {
        try {
          const events = await adapter.searchEvents(searchParams);
          let listingCount = 0;
          const scored: ScoredListing[] = [];

          // Sample first few events for listings
          const sampleEvents = events.slice(0, 3);
          for (const event of sampleEvents) {
            const listings = await adapter.getEventListings(event.platformId);
            listingCount += listings.length;

            if (listings.length > 0) {
              const averagePrice = this.valueEngine.calculateAveragePrice(listings);
              const daysUntilEvent = Math.max(
                0,
                Math.ceil((event.dateTime.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
              );

              // Load historical data (best-effort)
              let historicalData = new Map<string, HistoricalPrice[]>();
              try {
                historicalData = await PriceHistoryRepo.getEventHistoricalPrices(event.platformId);
              } catch {
                // DB unavailable - continue with empty history
              }

              scored.push(...this.valueEngine.scoreListings(listings, {
                averagePrice,
                sectionTiers: {},
                historicalData,
                eventPopularity: 50,
                daysUntilEvent,
              }));
            }
          }

          return { events, eventCount: events.length, listings: listingCount, scored };
        } catch (error) {
          logger.warn(`[Monitor] scanCity failed for ${name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          return { events: [] as NormalizedEvent[], eventCount: 0, listings: 0, scored: [] as ScoredListing[] };
        }
      }),
    );

    for (const result of adapterResults) {
      if (result.status === 'fulfilled') {
        totalEvents += result.value.eventCount;
        totalListings += result.value.listings;
        allScoredListings.push(...result.value.scored);
        allEvents.push(...result.value.events);
      }
    }

    const topPicks = this.valueEngine.getTopValuePicks(allScoredListings, 10);

    // Sort events by date and return the first 10 upcoming
    const upcomingEvents = allEvents
      .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime())
      .slice(0, 10);

    return { events: totalEvents, listings: totalListings, topPicks, upcomingEvents };
  }

  /**
   * Get listings for a specific event (for on-demand "View Tickets" feature)
   */
  async getListingsForEvent(
    platform: string,
    eventId: string,
  ): Promise<NormalizedListing[]> {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      logger.warn(`[Monitor] No adapter for platform: ${platform}`);
      return [];
    }

    try {
      const listings = await adapter.getEventListings(eventId);
      logger.debug(`[Monitor] Fetched ${listings.length} listings for ${platform}:${eventId}`);
      return listings;
    } catch (error) {
      logger.warn(`[Monitor] Failed to get listings for ${platform}:${eventId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for events by keyword in a specific city
   */
  async searchEvents(keyword: string, city: string): Promise<{
    events: number;
    upcomingEvents: NormalizedEvent[];
  }> {
    const now = new Date();
    const searchParams: EventSearchParams = {
      city,
      startDate: now,
      endDate: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), // 90 days out for search
      keyword,
      limit: 20,
    };

    const allEvents: NormalizedEvent[] = [];

    // Parallelize across adapters
    const adapterResults = await Promise.allSettled(
      [...this.adapters.entries()].map(async ([name, adapter]) => {
        try {
          const events = await adapter.searchEvents(searchParams);
          logger.debug(`[Monitor] ${name} found ${events.length} events for "${keyword}" in ${city}`);
          return events;
        } catch (error) {
          logger.warn(`[Monitor] searchEvents failed for ${name}`, {
            keyword,
            city,
            error: error instanceof Error ? error.message : String(error),
          });
          return [] as NormalizedEvent[];
        }
      }),
    );

    for (const result of adapterResults) {
      if (result.status === 'fulfilled') {
        allEvents.push(...result.value);
      }
    }

    // Sort by date and return up to 10
    const upcomingEvents = allEvents
      .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime())
      .slice(0, 10);

    return { events: allEvents.length, upcomingEvents };
  }
}
