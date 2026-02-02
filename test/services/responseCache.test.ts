/**
 * Tests for response cache service
 */

import {
  ResponseCache,
  createAIResponseCache,
  CachePresets,
  aiResponseCache
} from '../../src/services/responseCache';
import { logger } from '../../src/config/logger';

jest.mock('../../src/config/logger');
jest.useFakeTimers();

describe('ResponseCache', () => {
  let cache: ResponseCache<string>;

  beforeEach(() => {
    jest.clearAllMocks();
    cache = new ResponseCache<string>();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(cache).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        'ResponseCache initialized',
        expect.objectContaining({
          defaultTtl: 3600000,
          maxCacheSize: 1000,
          cleanupInterval: 300000
        })
      );
    });

    it('should initialize with custom options', () => {
      const customCache = new ResponseCache<string>({
        defaultTtl: 60000,
        maxCacheSize: 500,
        cleanupInterval: 60000
      });

      expect(customCache).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        'ResponseCache initialized',
        expect.objectContaining({
          defaultTtl: 60000,
          maxCacheSize: 500,
          cleanupInterval: 60000
        })
      );
    });

    it('should initialize stats correctly', () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.totalCached).toBe(0);
      expect(stats.totalEvicted).toBe(0);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve cached response', () => {
      cache.set('test input', 'test-model', 'test response');

      const result = cache.get('test input', 'test-model');

      expect(result).toBe('test response');
    });

    it('should return null for non-existent key', () => {
      const result = cache.get('non-existent', 'test-model');

      expect(result).toBeNull();
    });

    it('should track cache misses', () => {
      cache.get('non-existent', 'test-model');

      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0);
    });

    it('should track cache hits', () => {
      cache.set('test input', 'test-model', 'test response');
      cache.get('test input', 'test-model');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.hitRate).toBe(1);
    });

    it('should increment hit count on each access', () => {
      cache.set('test input', 'test-model', 'test response');
      cache.get('test input', 'test-model');
      cache.get('test input', 'test-model');
      cache.get('test input', 'test-model');

      expect(logger.debug).toHaveBeenCalledWith(
        'Cache hit',
        expect.objectContaining({ hitCount: 3 })
      );
    });

    it('should use custom TTL when provided', () => {
      cache.set('test input', 'test-model', 'response', { ttl: 1000 });

      // Should still be available
      expect(cache.get('test input', 'test-model')).toBe('response');
    });

    it('should track response time when provided', () => {
      cache.set('test input', 'test-model', 'response', { responseTime: 150 });

      expect(logger.debug).toHaveBeenCalledWith(
        'Cached response',
        expect.objectContaining({ responseTime: 150 })
      );
    });

    it('should normalize input for cache key', () => {
      cache.set('  Test INPUT  ', 'test-model', 'response');

      // Should match with different spacing/casing
      const result = cache.get('test input', 'test-model');
      expect(result).toBe('response');
    });

    it('should handle different models separately', () => {
      cache.set('test input', 'model-a', 'response-a');
      cache.set('test input', 'model-b', 'response-b');

      expect(cache.get('test input', 'model-a')).toBe('response-a');
      expect(cache.get('test input', 'model-b')).toBe('response-b');
    });
  });

  describe('has', () => {
    it('should return true for existing entry', () => {
      cache.set('test input', 'test-model', 'response');

      expect(cache.has('test input', 'test-model')).toBe(true);
    });

    it('should return false for non-existing entry', () => {
      expect(cache.has('non-existent', 'test-model')).toBe(false);
    });

    it('should return false after expiration', async () => {
      jest.useRealTimers();
      cache.set('test input', 'test-model', 'response', { ttl: 50 });

      expect(cache.has('test input', 'test-model')).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 60));

      expect(cache.has('test input', 'test-model')).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('should remove specific cache entry', () => {
      cache.set('test input', 'test-model', 'response');
      cache.invalidate('test input', 'test-model');

      expect(cache.get('test input', 'test-model')).toBeNull();
    });

    it('should log invalidation', () => {
      cache.set('test input', 'test-model', 'response');
      cache.invalidate('test input', 'test-model');

      expect(logger.debug).toHaveBeenCalledWith(
        'Cache entry invalidated',
        expect.any(Object)
      );
    });

    it('should not throw for non-existent entry', () => {
      expect(() => {
        cache.invalidate('non-existent', 'test-model');
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all cached entries', () => {
      cache.set('input1', 'model', 'response1');
      cache.set('input2', 'model', 'response2');
      cache.set('input3', 'model', 'response3');

      cache.clear();

      expect(cache.get('input1', 'model')).toBeNull();
      expect(cache.get('input2', 'model')).toBeNull();
      expect(cache.get('input3', 'model')).toBeNull();
    });

    it('should reset size stat', () => {
      cache.set('input', 'model', 'response');
      cache.clear();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should log clearing', () => {
      cache.clear();

      expect(logger.info).toHaveBeenCalledWith('Response cache cleared');
    });
  });

  describe('getStats', () => {
    it('should return current stats', () => {
      cache.set('input1', 'model', 'response1');
      cache.set('input2', 'model', 'response2');
      cache.get('input1', 'model'); // hit
      cache.get('non-existent', 'model'); // miss

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.totalCached).toBe(2);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      cache.set('test input', 'model', 'cached response');
      const factory = jest.fn().mockResolvedValue('new response');

      const result = await cache.getOrSet('test input', 'model', factory);

      expect(result).toBe('cached response');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache result if not exists', async () => {
      const factory = jest.fn().mockResolvedValue('new response');

      const result = await cache.getOrSet('test input', 'model', factory);

      expect(result).toBe('new response');
      expect(factory).toHaveBeenCalled();
      expect(cache.get('test input', 'model')).toBe('new response');
    });

    it('should pass custom TTL to set', async () => {
      const factory = jest.fn().mockResolvedValue('response');

      await cache.getOrSet('test input', 'model', factory, { ttl: 60000 });

      expect(cache.get('test input', 'model')).toBe('response');
    });

    it('should track response time', async () => {
      const factory = jest.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve('response'), 100))
      );

      await cache.getOrSet('test input', 'model', factory);

      expect(logger.debug).toHaveBeenCalledWith(
        'Cached response',
        expect.objectContaining({
          responseTime: expect.any(Number)
        })
      );
    });
  });

  describe('warmup', () => {
    it('should pre-populate cache with provided entries', async () => {
      const factory1 = jest.fn().mockResolvedValue('response1');
      const factory2 = jest.fn().mockResolvedValue('response2');

      await cache.warmup([
        { input: 'input1', model: 'model', factory: factory1 },
        { input: 'input2', model: 'model', factory: factory2 }
      ]);

      expect(factory1).toHaveBeenCalled();
      expect(factory2).toHaveBeenCalled();
      expect(cache.get('input1', 'model')).toBe('response1');
      expect(cache.get('input2', 'model')).toBe('response2');
    });

    it('should log warmup start and completion', async () => {
      await cache.warmup([
        { input: 'input', model: 'model', factory: jest.fn().mockResolvedValue('response') }
      ]);

      expect(logger.info).toHaveBeenCalledWith('Warming up cache', { entryCount: 1 });
      expect(logger.info).toHaveBeenCalledWith('Cache warmup complete');
    });

    it('should handle factory errors gracefully', async () => {
      const errorFactory = jest.fn().mockRejectedValue(new Error('Factory failed'));

      await cache.warmup([
        { input: 'input', model: 'model', factory: errorFactory }
      ]);

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to warmup cache entry',
        expect.any(Object)
      );
    });

    it('should continue warmup after individual failures', async () => {
      const errorFactory = jest.fn().mockRejectedValue(new Error('Failed'));
      const successFactory = jest.fn().mockResolvedValue('success');

      await cache.warmup([
        { input: 'input1', model: 'model', factory: errorFactory },
        { input: 'input2', model: 'model', factory: successFactory }
      ]);

      expect(successFactory).toHaveBeenCalled();
      expect(cache.get('input2', 'model')).toBe('success');
    });
  });

  describe('getEntriesByModel', () => {
    it('should return empty array (not implemented)', () => {
      cache.set('input', 'model', 'response');

      const entries = cache.getEntriesByModel('model');

      expect(entries).toEqual([]);
    });
  });

  describe('export', () => {
    it('should return empty object (not implemented)', () => {
      cache.set('input', 'model', 'response');

      const data = cache.export();

      expect(data).toEqual({});
      expect(logger.warn).toHaveBeenCalledWith('Cache export not implemented');
    });
  });

  describe('import', () => {
    it('should log warning (not implemented)', () => {
      cache.import({});

      expect(logger.warn).toHaveBeenCalledWith('Cache import not implemented');
    });
  });

  describe('eviction', () => {
    it('should clear cache when max size exceeded', () => {
      const smallCache = new ResponseCache<string>({ maxCacheSize: 5 });

      // Add entries beyond max size
      for (let i = 0; i < 6; i++) {
        smallCache.set(`input${i}`, 'model', `response${i}`);
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'Cache size exceeded, clearing cache',
        expect.objectContaining({ currentSize: 6, maxSize: 5 })
      );
    });

    it('should track evicted count', () => {
      const smallCache = new ResponseCache<string>({ maxCacheSize: 3 });

      // Add entries beyond max size
      for (let i = 0; i < 5; i++) {
        smallCache.set(`input${i}`, 'model', `response${i}`);
      }

      const stats = smallCache.getStats();
      expect(stats.totalEvicted).toBeGreaterThan(0);
    });
  });

  describe('hash generation', () => {
    it('should generate consistent hashes for similar inputs', () => {
      cache.set('Hello World', 'model', 'response');

      // Different case, extra spaces
      const result1 = cache.get('HELLO WORLD', 'model');
      const result2 = cache.get('hello   world', 'model');
      const result3 = cache.get('  hello world  ', 'model');

      expect(result1).toBe('response');
      expect(result2).toBe('response');
      expect(result3).toBe('response');
    });

    it('should remove punctuation during normalization', () => {
      cache.set('hello, world!', 'model', 'response');

      const result = cache.get('hello world', 'model');

      expect(result).toBe('response');
    });
  });
});

describe('CachePresets', () => {
  it('should have AI_RESPONSES preset', () => {
    expect(CachePresets.AI_RESPONSES).toEqual({
      defaultTtl: 7200000,
      maxCacheSize: 500
    });
  });

  it('should have PROJECT_LIST preset', () => {
    expect(CachePresets.PROJECT_LIST).toEqual({
      defaultTtl: 3600000,
      maxCacheSize: 100
    });
  });

  it('should have USER_PREFERENCES preset', () => {
    expect(CachePresets.USER_PREFERENCES).toEqual({
      defaultTtl: 86400000,
      maxCacheSize: 1000
    });
  });
});

describe('createAIResponseCache', () => {
  it('should create cache with AI_RESPONSES preset', () => {
    const cache = createAIResponseCache<string>();

    expect(cache).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      'ResponseCache initialized',
      expect.objectContaining({
        defaultTtl: 7200000,
        maxCacheSize: 500
      })
    );
  });
});

describe('aiResponseCache singleton', () => {
  it('should be a ResponseCache instance', () => {
    expect(aiResponseCache).toBeDefined();
    expect(typeof aiResponseCache.get).toBe('function');
    expect(typeof aiResponseCache.set).toBe('function');
    expect(typeof aiResponseCache.has).toBe('function');
    expect(typeof aiResponseCache.invalidate).toBe('function');
    expect(typeof aiResponseCache.clear).toBe('function');
    expect(typeof aiResponseCache.getStats).toBe('function');
    expect(typeof aiResponseCache.getOrSet).toBe('function');
    expect(typeof aiResponseCache.warmup).toBe('function');
    expect(typeof aiResponseCache.export).toBe('function');
    expect(typeof aiResponseCache.import).toBe('function');
  });
});
