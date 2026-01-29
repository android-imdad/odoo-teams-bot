/**
 * Response cache for AI API calls to reduce costs and improve latency.
 * Uses semantic hashing to identify similar queries.
 */

import { logger } from '../config/logger';
import { Cache } from './cache';
import * as crypto from 'crypto';

export interface CachedResponse<T> {
  response: T;
  timestamp: number;
  ttl: number;
  hitCount: number;
  metadata: {
    inputHash: string;
    responseTime?: number;
    model: string;
  };
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalCached: number;
  totalEvicted: number;
}

export class ResponseCache<T> {
  private cache: Cache<CachedResponse<T>>;
  private stats: CacheStats;
  private maxCacheSize: number;

  constructor(options: {
    defaultTtl?: number;
    maxCacheSize?: number;
    cleanupInterval?: number;
  } = {}) {
    const {
      defaultTtl = 3600000, // 1 hour
      maxCacheSize = 1000,
      cleanupInterval = 300000 // 5 minutes
    } = options;

    this.cache = new Cache<CachedResponse<T>>();
    this.cache.startCleanup(cleanupInterval);
    this.maxCacheSize = maxCacheSize;

    this.stats = {
      size: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalCached: 0,
      totalEvicted: 0
    };

    logger.info('ResponseCache initialized', {
      defaultTtl,
      maxCacheSize,
      cleanupInterval
    });
  }

  /**
   * Generate a hash for cache key
   */
  private generateHash(input: string): string {
    // Normalize input for better cache hits
    const normalized = input
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');

    return crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Check if cache is full and evict oldest entries if needed
   */
  private evictIfNeeded(): void {
    const keys = this.cache.getSize();
    if (keys > this.maxCacheSize) {
      // In a real implementation, we'd evict the oldest entries
      // For now, we'll just clear the cache
      logger.warn('Cache size exceeded, clearing cache', {
        currentSize: keys,
        maxSize: this.maxCacheSize
      });
      this.cache.clear();
      this.stats.totalEvicted += keys;
    }
  }

  /**
   * Get cache key for input
   */
  private getCacheKey(input: string, model: string): string {
    const inputHash = this.generateHash(input);
    return `${model}:${inputHash}`;
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Get a cached response
   */
  public get(input: string, model: string): T | null {
    const key = this.getCacheKey(input, model);
    const cached = this.cache.get(key);

    if (!cached) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Increment hit count for analytics
    cached.hitCount++;

    this.stats.hits++;
    this.updateHitRate();

    logger.debug('Cache hit', {
      key,
      hitCount: cached.hitCount,
      age: Date.now() - cached.timestamp
    });

    return cached.response;
  }

  /**
   * Set a cached response
   */
  public set(
    input: string,
    model: string,
    response: T,
    options: {
      ttl?: number;
      responseTime?: number;
    } = {}
  ): void {
    const { ttl = 3600000, responseTime } = options;
    const key = this.getCacheKey(input, model);

    this.evictIfNeeded();

    const cached: CachedResponse<T> = {
      response,
      timestamp: Date.now(),
      ttl,
      hitCount: 0,
      metadata: {
        inputHash: this.generateHash(input),
        responseTime,
        model
      }
    };

    this.cache.set(key, cached, ttl);
    this.stats.totalCached++;

    logger.debug('Cached response', {
      key,
      ttl,
      responseTime
    });
  }

  /**
   * Check if an input is cached
   */
  public has(input: string, model: string): boolean {
    const key = this.getCacheKey(input, model);
    return this.cache.get(key) !== null;
  }

  /**
   * Invalidate specific cache entry
   */
  public invalidate(input: string, model: string): void {
    const key = this.getCacheKey(input, model);
    this.cache.delete(key);

    logger.debug('Cache entry invalidated', { key });
  }

  /**
   * Clear all cached responses
   */
  public clear(): void {
    this.cache.clear();
    this.stats.size = 0;

    logger.info('Response cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    this.stats.size = this.cache.getSize();
    return { ...this.stats };
  }

  /**
   * Get or set pattern for lazy loading
   */
  public async getOrSet(
    input: string,
    model: string,
    factory: () => Promise<T>,
    options: {
      ttl?: number;
    } = {}
  ): Promise<T> {
    // Try to get from cache
    const cached = this.get(input, model);
    if (cached !== null) {
      return cached;
    }

    // Generate new response
    const startTime = Date.now();
    const response = await factory();
    const responseTime = Date.now() - startTime;

    // Cache the response
    this.set(input, model, response, {
      ...options,
      responseTime
    });

    return response;
  }

  /**
   * Get cache entries for a specific model
   */
  public getEntriesByModel(_model: string): Array<{
    key: string;
    cached: CachedResponse<T>;
  }> {
    // This would require extending the Cache class to support iteration
    // For now, return empty array
    return [];
  }

  /**
   * Warm up cache with pre-defined inputs
   */
  public async warmup(
    entries: Array<{
      input: string;
      model: string;
      factory: () => Promise<T>;
    }>
  ): Promise<void> {
    logger.info('Warming up cache', { entryCount: entries.length });

    for (const entry of entries) {
      try {
        await this.getOrSet(entry.input, entry.model, entry.factory);
      } catch (error) {
        logger.warn('Failed to warmup cache entry', {
          input: entry.input,
          model: entry.model,
          error
        });
      }
    }

    logger.info('Cache warmup complete');
  }

  /**
   * Export cache for backup/analysis
   */
  public export(): Record<string, CachedResponse<T>> {
    // This would require extending the Cache class
    // For now, return empty object
    logger.warn('Cache export not implemented');
    return {};
  }

  /**
   * Import cache from backup
   */
  public import(_data: Record<string, CachedResponse<T>>): void {
    // This would require extending the Cache class
    // For now, log warning
    logger.warn('Cache import not implemented');
  }
}

/**
 * Predefined cache configurations
 */
export const CachePresets = {
  /** Cache for AI parsing responses */
  AI_RESPONSES: {
    defaultTtl: 7200000, // 2 hours - AI responses don't change often
    maxCacheSize: 500
  },

  /** Cache for project list */
  PROJECT_LIST: {
    defaultTtl: 3600000, // 1 hour
    maxCacheSize: 100
  },

  /** Cache for user preferences */
  USER_PREFERENCES: {
    defaultTtl: 86400000, // 24 hours
    maxCacheSize: 1000
  }
};

/**
 * Create a response cache for AI API calls
 */
export function createAIResponseCache<T>(): ResponseCache<T> {
  return new ResponseCache<T>(CachePresets.AI_RESPONSES);
}

/**
 * Global AI response cache instance
 */
export const aiResponseCache = createAIResponseCache<any>();
