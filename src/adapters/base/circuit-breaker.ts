/**
 * Circuit Breaker and Resilience Utilities
 * Provides fault tolerance patterns for platform API calls
 */

import {
  CircuitBreakerPolicy,
  ExponentialBackoff,
  retry,
  circuitBreaker,
  bulkhead,
  timeout,
  wrap,
  handleAll,
  ConsecutiveBreaker,
  CircuitState,
} from 'cockatiel';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ResilienceConfig {
  /** Platform name for logging */
  platformName: string;

  /** Circuit breaker failure threshold before opening */
  circuitBreakerThreshold?: number;

  /** Time in ms before attempting to close circuit */
  circuitBreakerHalfOpenAfter?: number;

  /** Maximum retry attempts */
  maxRetryAttempts?: number;

  /** Initial retry delay in ms */
  initialRetryDelay?: number;

  /** Maximum retry delay in ms */
  maxRetryDelay?: number;

  /** Request timeout in ms */
  timeoutMs?: number;

  /** Maximum concurrent requests */
  maxConcurrent?: number;

  /** Queue size for bulkhead */
  queueSize?: number;
}

export interface ResiliencePolicies {
  /** Combined policy wrapping all resilience patterns */
  policy: ReturnType<typeof wrap>;

  /** Circuit breaker for monitoring and manual control */
  circuitBreaker: CircuitBreakerPolicy;

  /** Get current circuit state */
  getCircuitState: () => CircuitState;

  /** Check if circuit is allowing requests */
  isHealthy: () => boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<ResilienceConfig, 'platformName'>> = {
  circuitBreakerThreshold: 5,
  circuitBreakerHalfOpenAfter: 30_000, // 30 seconds
  maxRetryAttempts: 3,
  initialRetryDelay: 1_000, // 1 second
  maxRetryDelay: 10_000, // 10 seconds
  timeoutMs: 10_000, // 10 seconds
  maxConcurrent: 5,
  queueSize: 10,
};

// ============================================================================
// Create Resilience Policies
// ============================================================================

/**
 * Create a set of resilience policies for a platform adapter
 *
 * Policy composition (outer to inner):
 * timeout → retry → circuitBreaker → bulkhead → actual call
 *
 * This means:
 * 1. Overall timeout applies to entire operation including retries
 * 2. Retries happen within the timeout
 * 3. Circuit breaker tracks failures across retries
 * 4. Bulkhead limits concurrent operations
 */
export function createResiliencePolicies(
  config: ResilienceConfig
): ResiliencePolicies {
  const {
    platformName,
    circuitBreakerThreshold = DEFAULT_CONFIG.circuitBreakerThreshold,
    circuitBreakerHalfOpenAfter = DEFAULT_CONFIG.circuitBreakerHalfOpenAfter,
    maxRetryAttempts = DEFAULT_CONFIG.maxRetryAttempts,
    initialRetryDelay = DEFAULT_CONFIG.initialRetryDelay,
    maxRetryDelay = DEFAULT_CONFIG.maxRetryDelay,
    timeoutMs = DEFAULT_CONFIG.timeoutMs,
    maxConcurrent = DEFAULT_CONFIG.maxConcurrent,
    queueSize = DEFAULT_CONFIG.queueSize,
  } = config;

  // -------------------------------------------------------------------------
  // Circuit Breaker
  // Opens after consecutive failures, half-opens after cooldown
  // -------------------------------------------------------------------------
  const breaker = circuitBreaker(handleAll, {
    halfOpenAfter: circuitBreakerHalfOpenAfter,
    breaker: new ConsecutiveBreaker(circuitBreakerThreshold),
  });

  // Log circuit state changes
  breaker.onStateChange((state) => {
    const stateNames: Record<CircuitState, string> = {
      [CircuitState.Closed]: 'CLOSED (healthy)',
      [CircuitState.Open]: 'OPEN (failing)',
      [CircuitState.HalfOpen]: 'HALF-OPEN (testing)',
      [CircuitState.Isolated]: 'ISOLATED (manual)',
    };

    logger.warn(`[${platformName}] Circuit breaker: ${stateNames[state]}`, {
      platform: platformName,
      circuitState: state,
    });
  });

  breaker.onBreak(() => {
    logger.error(`[${platformName}] Circuit breaker OPENED - stopping requests`, {
      platform: platformName,
    });
  });

  breaker.onReset(() => {
    logger.info(`[${platformName}] Circuit breaker CLOSED - resuming requests`, {
      platform: platformName,
    });
  });

  // -------------------------------------------------------------------------
  // Retry with Exponential Backoff + Jitter
  // -------------------------------------------------------------------------
  const retryPolicy = retry(handleAll, {
    maxAttempts: maxRetryAttempts,
    backoff: new ExponentialBackoff({
      initialDelay: initialRetryDelay,
      maxDelay: maxRetryDelay,
      exponent: 2,
    }),
  });

  retryPolicy.onRetry((event) => {
    logger.warn(`[${platformName}] Retrying request (attempt ${event.attempt})`, {
      platform: platformName,
      attempt: event.attempt,
      delay: event.delay,
      error: event.reason?.message,
    });
  });

  retryPolicy.onGiveUp((event) => {
    logger.error(`[${platformName}] Giving up after ${event.attempt} attempts`, {
      platform: platformName,
      attempts: event.attempt,
      error: event.reason?.message,
    });
  });

  // -------------------------------------------------------------------------
  // Bulkhead (Concurrency Limiter)
  // -------------------------------------------------------------------------
  const bulkheadPolicy = bulkhead(maxConcurrent, queueSize);

  bulkheadPolicy.onReject(() => {
    logger.warn(`[${platformName}] Request rejected by bulkhead (queue full)`, {
      platform: platformName,
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------
  const timeoutPolicy = timeout(timeoutMs, 'aggressive');

  timeoutPolicy.onTimeout(() => {
    logger.warn(`[${platformName}] Request timed out after ${timeoutMs}ms`, {
      platform: platformName,
      timeoutMs,
    });
  });

  // -------------------------------------------------------------------------
  // Compose Policies
  // Order: timeout → retry → circuitBreaker → bulkhead
  // -------------------------------------------------------------------------
  const combinedPolicy = wrap(timeoutPolicy, retryPolicy, breaker, bulkheadPolicy);

  return {
    policy: combinedPolicy,
    circuitBreaker: breaker,
    getCircuitState: () => breaker.state,
    isHealthy: () => breaker.state === CircuitState.Closed,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an error is a circuit breaker rejection
 */
export function isCircuitBreakerOpen(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'BrokenCircuitError'
  );
}

/**
 * Check if an error is a timeout
 */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'TaskCancelledError'
  );
}

/**
 * Check if an error is a bulkhead rejection
 */
export function isBulkheadRejection(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'BulkheadRejectedError'
  );
}

/**
 * Categorize an error for better handling
 */
export function categorizeError(error: unknown): {
  category: 'circuit_open' | 'timeout' | 'bulkhead_full' | 'api_error' | 'unknown';
  retryable: boolean;
  message: string;
} {
  if (isCircuitBreakerOpen(error)) {
    return {
      category: 'circuit_open',
      retryable: false,
      message: 'Circuit breaker is open - platform may be unavailable',
    };
  }

  if (isTimeoutError(error)) {
    return {
      category: 'timeout',
      retryable: true,
      message: 'Request timed out',
    };
  }

  if (isBulkheadRejection(error)) {
    return {
      category: 'bulkhead_full',
      retryable: true,
      message: 'Too many concurrent requests - try again later',
    };
  }

  if (error instanceof Error) {
    return {
      category: 'api_error',
      retryable: false,
      message: error.message,
    };
  }

  return {
    category: 'unknown',
    retryable: false,
    message: String(error),
  };
}
