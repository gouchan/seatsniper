/**
 * Configuration Module
 * Centralized configuration management with validation
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Environment Schema
// ============================================================================

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Database
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().transform(Number).default('5432'),
  DB_NAME: z.string().default('seatsniper'),
  DB_USER: z.string().default('seatsniper'),
  DB_PASSWORD: z.string().optional(),

  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),

  // StubHub API
  STUBHUB_CLIENT_ID: z.string().optional(),
  STUBHUB_CLIENT_SECRET: z.string().optional(),

  // Ticketmaster API
  TICKETMASTER_API_KEY: z.string().optional(),

  // SeatGeek API
  SEATGEEK_CLIENT_ID: z.string().optional(),
  SEATGEEK_CLIENT_SECRET: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),

  // Monitoring
  MONITORED_CITIES: z.string().default('portland,seattle'),
});

// Validate environment
const env = envSchema.parse(process.env);

// ============================================================================
// Configuration Object
// ============================================================================

export const config = {
  // Application settings
  app: {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  },

  // Database configuration
  database: {
    url: env.DATABASE_URL || `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`,
    host: env.DB_HOST,
    port: env.DB_PORT,
    name: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  },

  // Redis configuration
  redis: {
    url: env.REDIS_URL || `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`,
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },

  // StubHub API configuration
  stubhub: {
    clientId: env.STUBHUB_CLIENT_ID || '',
    clientSecret: env.STUBHUB_CLIENT_SECRET || '',
    baseUrl: 'https://api.stubhub.com',
    rateLimit: {
      requestsPerMinute: 10,
    },
    timeout: 10_000,
    retryAttempts: 3,
  },

  // Ticketmaster API configuration
  ticketmaster: {
    apiKey: env.TICKETMASTER_API_KEY || '',
    baseUrl: 'https://app.ticketmaster.com/discovery/v2',
    rateLimit: {
      requestsPerDay: 5000,
    },
    timeout: 10_000,
    retryAttempts: 3,
  },

  // SeatGeek API configuration
  seatgeek: {
    clientId: env.SEATGEEK_CLIENT_ID || '',
    clientSecret: env.SEATGEEK_CLIENT_SECRET || '',
    baseUrl: 'https://api.seatgeek.com/2',
    rateLimit: {
      requestsPerMinute: 60, // SeatGeek is more generous
    },
    timeout: 10_000,
    retryAttempts: 3,
  },

  // Telegram configuration
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN || '',
  },

  // Twilio configuration
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: env.TWILIO_PHONE_NUMBER || '',
    whatsappNumber: env.TWILIO_WHATSAPP_NUMBER || '',
  },

  // Monitoring configuration
  monitoring: {
    cities: env.MONITORED_CITIES.split(',').map(c => c.trim().toLowerCase()),
    pollingIntervals: {
      highPriority: 2 * 60 * 1000,    // 2 minutes for events <7 days out
      mediumPriority: 10 * 60 * 1000, // 10 minutes for events <30 days out
      lowPriority: 30 * 60 * 1000,    // 30 minutes for events >30 days out
    },
  },

  // City to state mapping for API queries
  cityStateMap: {
    portland: 'OR',
    seattle: 'WA',
    tacoma: 'WA',
    eugene: 'OR',
    spokane: 'WA',
    boise: 'ID',
  } as Record<string, string>,
} as const;

// Export type for use in other modules
export type Config = typeof config;
