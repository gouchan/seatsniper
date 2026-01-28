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

// Notifications
import { TelegramNotifier } from './notifications/telegram/telegram.notifier.js';
import { SMSNotifier } from './notifications/twilio/sms.notifier.js';
import { WhatsAppNotifier } from './notifications/twilio/whatsapp.notifier.js';
import type { INotifier } from './notifications/base/notifier.interface.js';

// ============================================================================
// Application Class
// ============================================================================

export class SeatSniperApp {
  private adapters: Map<string, IPlatformAdapter> = new Map();
  private notifiers: Map<string, INotifier> = new Map();
  private valueEngine: ValueEngineService;
  private isRunning: boolean = false;

  constructor() {
    this.valueEngine = new ValueEngineService();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    logger.info('🎯 SeatSniper initializing...');

    // Initialize platform adapters
    await this.initializeAdapters();

    // Initialize notification channels
    await this.initializeNotifiers();

    logger.info('✅ SeatSniper initialized successfully');
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
   * Start the monitoring loop (placeholder for full implementation)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('SeatSniper is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 SeatSniper started');

    // TODO: Implement inventory monitoring loop
    // This would include:
    // 1. Polling events from adapters
    // 2. Scoring listings with ValueEngine
    // 3. Triggering alerts via notifiers
    // 4. Storing data in database
  }

  /**
   * Stop the monitoring loop
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
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

  try {
    await app.initialize();

    // Perform health check
    const health = await app.healthCheck();
    logger.info('Health check:', health);

    // For now, just log status
    logger.info('🎫 SeatSniper MVP ready!');
    logger.info(`   Adapters: ${[...app.getAdapters().keys()].join(', ') || 'none'}`);
    logger.info(`   Notifiers: ${[...app.getNotifiers().keys()].join(', ') || 'none'}`);
    logger.info(`   Cities: ${config.monitoring.cities.join(', ')}`);

    // In production, would call app.start() to begin monitoring

  } catch (error) {
    logger.error('Failed to start SeatSniper', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Run if this is the main module
main().catch(console.error);
