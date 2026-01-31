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
  private queue: Array<() => void> = [];
  private processing: boolean = false;

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
   * Try to acquire a token immediately (synchronous, no queue).
   * Safe to call from a single caller; for concurrent use, prefer acquire().
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
   * Acquire a token, waiting if necessary.
   * Serialized via an internal queue so concurrent callers cannot
   * race on the token count — each caller is processed one at a time.
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.drainQueue();
    });
  }

  /**
   * Process queued callers one at a time.
   * Only one invocation of drainQueue runs at any moment (guarded by
   * `this.processing`), which eliminates the read-check-subtract race.
   */
  private drainQueue(): void {
    if (this.processing) return;
    this.processing = true;

    const processNext = (): void => {
      if (this.queue.length === 0) {
        this.processing = false;
        return;
      }

      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        const next = this.queue.shift();
        next?.();
        // Continue draining synchronously while tokens are available
        processNext();
      } else {
        // Wait until the next token is available, then resume
        const tokensNeeded = 1 - this.tokens;
        const waitTime = Math.max(
          1,
          (tokensNeeded / this.tokensPerInterval) * this.intervalMs,
        );
        setTimeout(processNext, waitTime);
      }
    };

    processNext();
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
