/**
 * Rate Limiter Utility
 * Token bucket implementation for API rate limiting
 */

interface RateLimiterConfig {
  /** Number of tokens added per interval */
  tokensPerInterval: number;

  /** Interval type */
  interval: 'second' | 'minute' | 'hour' | 'day';

  /** Maximum tokens that can be stored (burst capacity) */
  maxTokens?: number;
}

const INTERVAL_MS: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private tokensPerInterval: number;
  private intervalMs: number;
  private lastRefill: number;
  private waitQueue: Array<() => void> = [];

  constructor(config: RateLimiterConfig) {
    this.tokensPerInterval = config.tokensPerInterval;
    this.maxTokens = config.maxTokens ?? config.tokensPerInterval;
    this.intervalMs = INTERVAL_MS[config.interval];
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillAmount = (elapsed / this.intervalMs) * this.tokensPerInterval;

    this.tokens = Math.min(this.maxTokens, this.tokens + refillAmount);
    this.lastRefill = now;
  }

  /**
   * Try to acquire a token immediately
   * @returns true if token was acquired, false otherwise
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Acquire a token, waiting if necessary
   * @returns Promise that resolves when token is acquired
   */
  async acquire(): Promise<void> {
    if (this.tryAcquire()) {
      return;
    }

    // Calculate wait time until next token
    const tokensNeeded = 1 - this.tokens;
    const waitTime = (tokensNeeded / this.tokensPerInterval) * this.intervalMs;

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve();
        this.processQueue();
      }, waitTime);
    });
  }

  /**
   * Process any waiting requests
   */
  private processQueue(): void {
    while (this.waitQueue.length > 0 && this.tryAcquire()) {
      const next = this.waitQueue.shift();
      next?.();
    }
  }

  /**
   * Get current token count
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Get estimated wait time for next token (in ms)
   */
  getWaitTime(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    const tokensNeeded = 1 - this.tokens;
    return (tokensNeeded / this.tokensPerInterval) * this.intervalMs;
  }
}

/**
 * Create a rate limiter from requests per day
 */
export function createDailyRateLimiter(requestsPerDay: number): RateLimiter {
  // Convert to requests per minute for smoother distribution
  const requestsPerMinute = Math.max(1, Math.floor(requestsPerDay / (24 * 60)));

  return new RateLimiter({
    tokensPerInterval: requestsPerMinute,
    interval: 'minute',
    maxTokens: Math.min(requestsPerMinute * 5, 50), // Allow some burst
  });
}

/**
 * Create a rate limiter from requests per minute
 */
export function createMinuteRateLimiter(requestsPerMinute: number): RateLimiter {
  return new RateLimiter({
    tokensPerInterval: requestsPerMinute,
    interval: 'minute',
    maxTokens: requestsPerMinute,
  });
}
