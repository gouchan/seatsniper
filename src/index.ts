/**
 * SeatSniper - Ticket Intelligence Platform
 * Main Entry Point
 */

import { config } from './config/index.js';
import { logger } from './utils/logger.js';

// Platform Adapters
import { StubHubAdapter } from './adapters/stubhub/stubhub.adapter.js';
import { TicketmasterAdapter } from './adapters/ticketmaster/ticketmaster.adapter.js';
import { SeatGeekAdapter } from './adapters/seatgeek/seatgeek.adapter.js';
import type { IPlatformAdapter } from './adapters/base/platform-adapter.interface.js';

// Services
import { ValueEngineService } from './services/value-engine/value-engine.service.js';
import { MonitorService, type Subscription } from './services/monitoring/monitor.service.js';

// Notifications
import { TelegramNotifier } from './notifications/telegram/telegram.notifier.js';
import { TelegramBotService } from './notifications/telegram/telegram.bot.js';
import { SMSNotifier } from './notifications/twilio/sms.notifier.js';
import { WhatsAppNotifier } from './notifications/twilio/whatsapp.notifier.js';
import type { INotifier } from './notifications/base/notifier.interface.js';

// Database
import { testConnection, closePool } from './data/database.js';
import * as SubRepo from './data/repositories/subscription.repository.js';
import * as AlertRepo from './data/repositories/alert.repository.js';

// ============================================================================
// Application Class
// ============================================================================

export class SeatSniperApp {
  private adapters: Map<string, IPlatformAdapter> = new Map();
  private notifiers: Map<string, INotifier> = new Map();
  private valueEngine: ValueEngineService;
  private monitor: MonitorService | null = null;
  private telegramBot: TelegramBotService | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.valueEngine = new ValueEngineService();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    logger.info('🎯 SeatSniper initializing...');

    // Initialize database (optional — runs without DB too)
    await this.initializeDatabase();

    // Initialize platform adapters
    await this.initializeAdapters();

    // Initialize notification channels
    await this.initializeNotifiers();

    logger.info('✅ SeatSniper initialized successfully');
  }

  private dbAvailable = false;

  private async initializeDatabase(): Promise<void> {
    try {
      const ok = await testConnection();
      if (ok) {
        // Ensure MVP tables exist
        await SubRepo.ensureTable();
        await AlertRepo.ensureTable();
        this.dbAvailable = true;
        logger.info('  ✓ PostgreSQL connected');
      } else {
        logger.warn('  - PostgreSQL unavailable (running in-memory only)');
      }
    } catch (error) {
      logger.warn('  - PostgreSQL skipped', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async initializeAdapters(): Promise<void> {
    // StubHub
    if (config.stubhub.clientId && config.stubhub.clientSecret) {
      try {
        const stubhub = new StubHubAdapter();
        await stubhub.initialize();
        this.adapters.set('stubhub', stubhub);
        logger.info('  ✓ StubHub adapter ready');
      } catch (error) {
        logger.warn('  ✗ StubHub adapter failed to initialize', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      logger.info('  - StubHub adapter skipped (no credentials)');
    }

    // Ticketmaster
    if (config.ticketmaster.apiKey) {
      try {
        const ticketmaster = new TicketmasterAdapter();
        await ticketmaster.initialize();
        this.adapters.set('ticketmaster', ticketmaster);
        logger.info('  ✓ Ticketmaster adapter ready');
      } catch (error) {
        logger.warn('  ✗ Ticketmaster adapter failed to initialize', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      logger.info('  - Ticketmaster adapter skipped (no credentials)');
    }

    // SeatGeek
    if (config.seatgeek.clientId) {
      try {
        const seatgeek = new SeatGeekAdapter();
        await seatgeek.initialize();
        this.adapters.set('seatgeek', seatgeek);
        logger.info('  ✓ SeatGeek adapter ready');
      } catch (error) {
        logger.warn('  ✗ SeatGeek adapter failed to initialize', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      logger.info('  - SeatGeek adapter skipped (no credentials)');
    }

    if (this.adapters.size === 0) {
      throw new Error('No platform adapters initialized. Check your API credentials.');
    }
  }

  private async initializeNotifiers(): Promise<void> {
    // Telegram
    if (config.telegram.botToken) {
      try {
        const telegram = new TelegramNotifier();
        await telegram.initialize();
        this.notifiers.set('telegram', telegram);
        logger.info('  ✓ Telegram notifier ready');
      } catch (error) {
        logger.warn('  ✗ Telegram notifier failed to initialize', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      logger.info('  - Telegram notifier skipped (no bot token)');
    }

    // SMS
    if (config.twilio.accountSid && config.twilio.authToken) {
      try {
        const sms = new SMSNotifier();
        await sms.initialize();
        this.notifiers.set('sms', sms);
        logger.info('  ✓ SMS notifier ready');
      } catch (error) {
        logger.warn('  ✗ SMS notifier failed to initialize', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      logger.info('  - SMS notifier skipped (no credentials)');
    }

    // WhatsApp
    if (config.twilio.accountSid && config.twilio.authToken && config.twilio.whatsappNumber) {
      try {
        const whatsapp = new WhatsAppNotifier();
        await whatsapp.initialize();
        this.notifiers.set('whatsapp', whatsapp);
        logger.info('  ✓ WhatsApp notifier ready');
      } catch (error) {
        logger.warn('  ✗ WhatsApp notifier failed to initialize', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      logger.info('  - WhatsApp notifier skipped (no WhatsApp number configured)');
    }

    if (this.notifiers.size === 0) {
      logger.warn('⚠️  No notification channels initialized. Alerts will not be sent.');
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get available platform adapters
   */
  getAdapters(): Map<string, IPlatformAdapter> {
    return this.adapters;
  }

  /**
   * Get available notifiers
   */
  getNotifiers(): Map<string, INotifier> {
    return this.notifiers;
  }

  /**
   * Get the Value Engine service
   */
  getValueEngine(): ValueEngineService {
    return this.valueEngine;
  }

  /**
   * Check health of all services
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    adapters: Record<string, { healthy: boolean; latency: number }>;
    notifiers: Record<string, boolean>;
  }> {
    const adapterHealth: Record<string, { healthy: boolean; latency: number }> = {};
    const notifierHealth: Record<string, boolean> = {};

    // Check adapters
    for (const [name, adapter] of this.adapters) {
      const status = await adapter.getHealthStatus();
      adapterHealth[name] = {
        healthy: status.healthy,
        latency: status.latency,
      };
    }

    // Check notifiers (basic connectivity)
    for (const [name, _notifier] of this.notifiers) {
      notifierHealth[name] = true; // Simplified - could add more checks
    }

    const allAdaptersHealthy = Object.values(adapterHealth).every(a => a.healthy);
    const hasNotifiers = Object.keys(notifierHealth).length > 0;

    return {
      healthy: allAdaptersHealthy && hasNotifiers,
      adapters: adapterHealth,
      notifiers: notifierHealth,
    };
  }

  /**
   * Start the monitoring loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('SeatSniper is already running');
      return;
    }

    this.monitor = new MonitorService(
      this.adapters,
      this.notifiers,
      this.valueEngine,
    );

    // Restore persisted subscriptions from database
    if (this.dbAvailable) {
      try {
        const savedSubs = await SubRepo.getActiveSubscriptions();
        for (const sub of savedSubs) {
          this.monitor.addSubscription(sub);
        }
        if (savedSubs.length > 0) {
          logger.info(`  ✓ Restored ${savedSubs.length} subscriptions from DB`);
        }
      } catch (error) {
        logger.warn('  - Failed to restore subscriptions from DB', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.monitor.start();

    // Start Telegram bot for interactive commands
    if (config.telegram.botToken && this.notifiers.has('telegram')) {
      try {
        this.telegramBot = new TelegramBotService(this.monitor);
        await this.telegramBot.start();
        logger.info('  ✓ Telegram bot UX active');
      } catch (error) {
        logger.warn('  ✗ Telegram bot failed to start', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.isRunning = true;
    logger.info('🚀 SeatSniper monitoring started');
  }

  /**
   * Get the monitor service (for adding subscriptions, etc.)
   */
  getMonitor(): MonitorService | null {
    return this.monitor;
  }

  /**
   * Add a subscription to the monitor
   */
  addSubscription(sub: Subscription): void {
    if (!this.monitor) {
      throw new Error('Monitor not started. Call start() first.');
    }
    this.monitor.addSubscription(sub);
  }

  /**
   * Stop the monitoring loop and clean up all resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('🛑 SeatSniper stopping...');

    // Stop Telegram bot
    if (this.telegramBot) {
      await this.telegramBot.stop();
      this.telegramBot = null;
    }

    // Stop monitor
    if (this.monitor) {
      this.monitor.stop();
      this.monitor = null;
    }

    // Shut down notifiers
    const shutdownPromises: Promise<void>[] = [];
    for (const [name, notifier] of this.notifiers) {
      if (typeof (notifier as any).stop === 'function') {
        shutdownPromises.push(
          (notifier as any).stop().catch((err: Error) => {
            logger.warn(`Failed to stop notifier ${name}: ${err.message}`);
          })
        );
      }
    }

    await Promise.allSettled(shutdownPromises);

    // Close database pool
    await closePool();

    this.adapters.clear();
    this.notifiers.clear();

    logger.info('🛑 SeatSniper stopped');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════');
  logger.info('  🎯 SEATSNIPER - Ticket Intelligence');
  logger.info('═══════════════════════════════════════════');

  const app = new SeatSniperApp();

  // --- Unhandled rejection / exception handlers ---
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled promise rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception — shutting down', {
      error: error.message,
      stack: error.stack,
    });
    app.stop().finally(() => process.exit(1));
  });

  // --- Graceful shutdown on SIGINT / SIGTERM ---
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await app.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.initialize();

    // Perform health check
    const health = await app.healthCheck();
    logger.info('Health check:', health);

    logger.info('🎫 SeatSniper MVP ready!');
    logger.info(`   Adapters: ${[...app.getAdapters().keys()].join(', ') || 'none'}`);
    logger.info(`   Notifiers: ${[...app.getNotifiers().keys()].join(', ') || 'none'}`);
    logger.info(`   Cities: ${config.monitoring.cities.join(', ')}`);

    // Start monitoring loop
    await app.start();

    logger.info('🔄 Monitoring loop active. Press Ctrl+C to stop.');

  } catch (error) {
    logger.error('Failed to start SeatSniper', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Run if this is the main module
main().catch(console.error);
