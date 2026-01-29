/**
 * Retry mechanism for API calls with exponential backoff.
 * Provides resilience against transient failures.
 */

import { logger } from '../config/logger';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay between retries in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Jitter factor to add randomness (0-1, default: 0.1) */
  jitterFactor?: number;
  /** Custom retry condition function */
  shouldRetry?: (error: any, attempt: number) => boolean;
  /** Callback before each retry */
  onRetry?: (error: any, attempt: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
}

/**
 * Default retry condition - retry on network errors and 5xx status codes
 */
function defaultShouldRetry(error: any, attempt: number): boolean {
  // Don't retry if max attempts exceeded
  if (attempt >= 3) return false;

  // Retry on network errors
  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // Retry on 5xx status codes
  if (error.status && error.status >= 500 && error.status < 600) {
    return true;
  }

  // Retry on 429 (Too Many Requests)
  if (error.status === 429) {
    return true;
  }

  // Retry on specific error messages
  const errorMessage = error.message?.toLowerCase() || '';
  const retryablePatterns = [
    'timeout',
    'network',
    'temporary',
    'try again',
    'rate limit',
    'too many requests'
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  jitterFactor: number
): number {
  // Exponential backoff
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt);

  // Add jitter to prevent thundering herd
  const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);

  // Calculate final delay with bounds
  const delay = Math.min(exponentialDelay + jitter, maxDelay);

  return Math.max(delay, 0); // Ensure non-negative
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    jitterFactor = 0.1,
    shouldRetry = defaultShouldRetry,
    onRetry
  } = options;

  let lastError: Error | undefined;
  let totalDelay = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Attempt the operation
      const result = await fn();

      if (attempt > 0) {
        logger.info('Operation succeeded after retry', {
          attempt: attempt + 1,
          totalDelay
        });
      }

      return result;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt < maxAttempts - 1 && shouldRetry(error, attempt)) {
        const delay = calculateDelay(
          attempt,
          initialDelay,
          maxDelay,
          backoffMultiplier,
          jitterFactor
        );

        totalDelay += delay;

        logger.warn('Operation failed, retrying...', {
          attempt: attempt + 1,
          maxAttempts,
          delay: Math.round(delay),
          error: lastError.message
        });

        // Call onRetry callback if provided
        if (onRetry) {
          onRetry(error, attempt + 1);
        }

        // Wait before retrying
        await sleep(delay);
      } else {
        // No more retries or not retryable
        logger.error('Operation failed after all retries', {
          attempts: attempt + 1,
          maxAttempts,
          error: lastError.message
        });

        throw new Error(
          `Operation failed after ${attempt + 1} attempt${attempt > 0 ? 's' : ''}: ${lastError.message}`
        );
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}

/**
 * Execute with retry and return detailed result
 */
export async function withRetryDetailed<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    jitterFactor = 0.1,
    shouldRetry = defaultShouldRetry
  } = options;

  let lastError: Error | undefined;
  let totalDelay = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();

      return {
        success: true,
        data: result,
        attempts: attempt + 1,
        totalDelay
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts - 1 && shouldRetry(error, attempt)) {
        const delay = calculateDelay(
          attempt,
          initialDelay,
          maxDelay,
          backoffMultiplier,
          jitterFactor
        );

        totalDelay += delay;
        await sleep(delay);
      } else {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDelay
        };
      }
    }
  }

  return {
    success: false,
    error: lastError || new Error('Retry failed'),
    attempts: maxAttempts,
    totalDelay
  };
}

/**
 * Create a retried version of a function
 */
export function createRetriedFunction<T extends (...args: any[]) => any>(
  fn: T,
  options: RetryOptions = {}
): T {
  return (async (...args: Parameters<T>) => {
    return withRetry(() => fn(...args), options);
  }) as T;
}

/**
 * Predefined retry configurations
 */
export const RetryPresets = {
  /** Quick retries for fast-failing operations */
  QUICK: {
    maxAttempts: 2,
    initialDelay: 500,
    maxDelay: 2000
  },

  /** Standard retries for most API calls */
  STANDARD: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000
  },

  /** Extended retries for critical operations */
  EXTENDED: {
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000
  },

  /** Patient retries for external APIs (like Gemini) */
  PATIENT: {
    maxAttempts: 4,
    initialDelay: 2000,
    maxDelay: 60000
  }
};

/**
 * Retry configuration specifically for AI API calls
 */
export const AI_RETRY_OPTIONS: RetryOptions = {
  ...RetryPresets.PATIENT,
  shouldRetry: (error: any, attempt: number) => {
    // Retry on rate limiting for AI APIs
    if (error.status === 429 || error.status === 503) {
      return true;
    }

    // Retry on network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    // Don't retry on validation errors or auth failures
    if (error.status === 400 || error.status === 401 || error.status === 403) {
      return false;
    }

    return attempt < 3;
  },
  onRetry: (error: any, attempt: number) => {
    logger.warn('Retrying AI API call', {
      attempt,
      error: error.message
    });
  }
};

/**
 * Retry configuration for Odoo API calls
 */
export const ODOO_RETRY_OPTIONS: RetryOptions = {
  ...RetryPresets.STANDARD,
  shouldRetry: (error: any, attempt: number) => {
    // Retry on connection errors
    if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
      return true;
    }

    // Don't retry on authentication failures
    if (error.message?.includes('authentication')) {
      return false;
    }

    // Retry on Odoo internal errors
    if (error.message?.includes('Odoo')) {
      return attempt < 2;
    }

    return attempt < 3;
  }
};
