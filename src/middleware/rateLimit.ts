/**
 * Rate limiting middleware to prevent abuse and API quota exhaustion.
 * Uses sliding window algorithm for accurate rate limiting.
 */

import { Request, Response } from 'restify';
import { logger } from '../config/logger';

type NextFunction = () => void;

interface RateLimitOptions {
  /** Number of requests allowed in the window */
  requests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom key generator (default: uses IP address) */
  keyGenerator?: (req: Request) => string;
  /** Skip function to bypass rate limiting for certain requests */
  skip?: (req: Request) => boolean;
  /** Custom error message handler */
  errorHandler?: (req: Request, res: Response) => void;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
  windowStart: number;
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

declare module 'restify' {
  interface Request {
    rateLimit?: RateLimitInfo;
  }
}

/**
 * In-memory rate limiter using sliding window algorithm.
 * For production with multiple instances, use Redis-backed rate limiting.
 */
class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private options: Required<RateLimitOptions>;

  constructor(options: RateLimitOptions) {
    this.options = {
      requests: options.requests,
      windowMs: options.windowMs,
      keyGenerator: options.keyGenerator || this.defaultKeyGenerator,
      skip: options.skip || (() => false),
      errorHandler: options.errorHandler || this.defaultErrorHandler
    };

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  private defaultKeyGenerator(req: Request): string {
    // Try to get user ID from Teams context, otherwise fall back to IP
    const userId = (req as any).activity?.from?.id;
    return userId || req.headers['x-forwarded-for'] as string || req.connection.remoteAddress || 'unknown';
  }

  private defaultErrorHandler(_req: Request, res: Response): void {
    res.header('Retry-After', Math.ceil(this.options.windowMs / 1000).toString());
    res.send(429, {
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again later.`,
      limit: this.options.requests,
      windowMs: this.options.windowMs
    });
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.requests.entries()) {
      if (now - entry.windowStart > this.options.windowMs) {
        this.requests.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Rate limiter cleanup: removed ${cleaned} expired entries`);
    }
  }

  private isExpired(entry: RateLimitEntry): boolean {
    return Date.now() > entry.resetTime;
  }

  /**
   * Reset the rate limit window for a specific key
   */
  public reset(key: string): void {
    this.requests.delete(key);
  }

  /**
   * Get current rate limit info for a key
   */
  public getInfo(key: string): RateLimitInfo | null {
    const entry = this.requests.get(key);
    if (!entry) {
      return {
        limit: this.options.requests,
        remaining: this.options.requests,
        reset: new Date(Date.now() + this.options.windowMs)
      };
    }

    return {
      limit: this.options.requests,
      remaining: Math.max(0, this.options.requests - entry.count),
      reset: new Date(entry.resetTime)
    };
  }

  /**
   * Middleware function to check rate limits
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Skip if configured
      if (this.options.skip(req)) {
        return next();
      }

      const key = this.options.keyGenerator(req);
      const now = Date.now();

      // Get or create entry
      let entry = this.requests.get(key);

      if (!entry || this.isExpired(entry)) {
        // Create new window
        entry = {
          count: 1,
          windowStart: now,
          resetTime: now + this.options.windowMs
        };
        this.requests.set(key, entry);
      } else {
        // Increment counter
        entry.count++;
      }

      // Calculate remaining requests
      const remaining = Math.max(0, this.options.requests - entry.count);

      // Attach rate limit info to request
      req.rateLimit = {
        limit: this.options.requests,
        remaining,
        reset: new Date(entry.resetTime)
      };

      // Set rate limit headers
      res.header('X-RateLimit-Limit', this.options.requests.toString());
      res.header('X-RateLimit-Remaining', remaining.toString());
      res.header('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());

      // Check if limit exceeded
      if (entry.count > this.options.requests) {
        logger.warn('Rate limit exceeded', {
          key,
          count: entry.count,
          limit: this.options.requests,
          path: req.path(),
          method: req.method
        });

        return this.options.errorHandler(req, res);
      }

      next();
    };
  }
}

/**
 * Predefined rate limit configurations for different use cases
 */
export const RateLimitPresets = {
  /** Strict rate limiting for expensive AI operations */
  AI_OPERATIONS: {
    requests: 30,
    windowMs: 60000, // 1 minute
    skip: (req: Request) => req.path() === '/health'
  },

  /** Moderate rate limiting for API calls */
  API_CALLS: {
    requests: 100,
    windowMs: 60000, // 1 minute
    skip: (req: Request) => req.path() === '/health'
  },

  /** Per-user rate limiting for bot messages */
  BOT_MESSAGES: {
    requests: 20,
    windowMs: 60000, // 1 minute
    skip: (req: Request) => req.path() === '/health'
  },

  /** Strict rate limiting for Odoo operations */
  ODOO_OPERATIONS: {
    requests: 50,
    windowMs: 60000, // 1 minute
    skip: (req: Request) => req.path() === '/health'
  }
};

/**
 * Create a rate limit middleware for API routes
 */
export function createRateLimiter(options: RateLimitOptions) {
  const limiter = new RateLimiter(options);
  return limiter.middleware();
}

/**
 * Create a rate limiter for tracking AI API usage specifically
 */
export function createAIRateLimiter() {
  return new RateLimiter(RateLimitPresets.AI_OPERATIONS);
}

/**
 * Create a rate limiter for tracking Odoo API usage specifically
 */
export function createOdooRateLimiter() {
  return new RateLimiter(RateLimitPresets.ODOO_OPERATIONS);
}

/**
 * Rate limiter for general API endpoints
 */
export const apiRateLimiter = createRateLimiter(RateLimitPresets.API_CALLS);

export { RateLimiter, RateLimitInfo, RateLimitOptions };
