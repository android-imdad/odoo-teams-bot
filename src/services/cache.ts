import { CacheEntry } from '../types';
import { logger } from '../config/logger';

export class Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();

  set(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
    logger.debug(`Cache set: ${key} with TTL ${ttl}ms`);
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      logger.debug(`Cache miss: ${key}`);
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      logger.debug(`Cache expired: ${key} (age: ${age}ms)`);
      this.cache.delete(key);
      return null;
    }

    logger.debug(`Cache hit: ${key}`);
    return entry.data;
  }

  clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  delete(key: string): void {
    this.cache.delete(key);
    logger.debug(`Cache deleted: ${key}`);
  }

  getSize(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  // Cleanup expired entries periodically
  startCleanup(interval: number = 300000): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          this.cache.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info(`Cache cleanup: removed ${cleaned} expired entries`);
      }
    }, interval);
  }
}
