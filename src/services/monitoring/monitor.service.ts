/**
 * Monitoring Service
 * Core polling loop that discovers events, scores listings,
 * and triggers alerts when high-value deals are found.
 */

import type {
  IPlatformAdapter,
  NormalizedEvent,
  EventSearchParams,
} from '../../adapters/base/platform-adapter.interface.js';
import type { INotifier, TopValueListing, AlertPayload } from '../../notifications/base/notifier.interface.js';
import { AlertType } from '../../notifications/base/notifier.interface.js';
import { ValueEngineService } from '../value-engine/value-engine.service.js';
import type { ScoredListing } from '../value-engine/value-score.types.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

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

      logger.info('[Monitor] Discovery complete', {
        totalTracked: this.trackedEvents.size,
      });
    } finally {
      this.activeCycles.delete('discovery');
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
      const daysUntilEvent = Math.max(
        0,
        Math.ceil((event.dateTime.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      );

      // Score all listings
      const scoredListings = this.valueEngine.scoreListings(listings, {
        averagePrice,
        sectionTiers: {}, // Will use defaults from SectionRanker
        historicalData: new Map(), // TODO: Wire up DB historical data
        eventPopularity: 50, // Default until DB is wired up
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
    // Find matching subscribers
    const matchingSubscribers = [...this.subscriptions.values()].filter(sub => {
      if (!sub.active) return false;
      if (sub.paused) return false;
      if (!sub.cities.some(c => c.toLowerCase() === event.venue.city.toLowerCase())) return false;
      // Check cooldown
      if (this.isAlertOnCooldown(event.platformId, sub.userId)) return false;
      return true;
    });

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
          this.recordAlert(event.platformId, sub.userId, qualifyingPicks[0].score.totalScore);
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

  private isAlertOnCooldown(eventId: string, userId: string): boolean {
    const now = Date.now();
    return this.alertHistory.some(
      record =>
        record.eventId === eventId &&
        record.userId === userId &&
        now - record.sentAt.getTime() < this.monitorConfig.alertCooldownMs,
    );
  }

  private recordAlert(eventId: string, userId: string, topScore: number): void {
    this.alertHistory.push({
      eventId,
      userId,
      sentAt: new Date(),
      topScore,
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

              scored.push(...this.valueEngine.scoreListings(listings, {
                averagePrice,
                sectionTiers: {},
                historicalData: new Map(),
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
