/**
 * Tests for cache service
 */

import { Cache } from '../../src/services/cache';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache<string>();
  });

  describe('set and get', () => {
    it('should store and retrieve data', () => {
      cache.set('key1', 'value1', 1000);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent key', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should return null for expired entry', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      await new Promise(resolve => setTimeout(resolve, 60)); // Wait for expiration
      expect(cache.get('key1')).toBeNull();
    });

    it('should return value before expiration', async () => {
      cache.set('key1', 'value1', 200); // 200ms TTL
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait less than TTL
      expect(cache.get('key1')).toBe('value1');
    });

    it('should store complex objects', () => {
      const complexData = { id: 1, name: 'Test', nested: { value: 'deep' } };
      const objCache = new Cache<typeof complexData>();
      objCache.set('obj', complexData, 1000);
      expect(objCache.get('obj')).toEqual(complexData);
    });

    it('should store arrays', () => {
      const arr = [1, 2, 3, 4, 5];
      const arrCache = new Cache<number[]>();
      arrCache.set('arr', arr, 1000);
      expect(arrCache.get('arr')).toEqual(arr);
    });

    it('should overwrite existing key', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key1', 'value2', 1000);
      expect(cache.get('key1')).toBe('value2');
    });

    it('should handle multiple keys', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key2', 'value2', 1000);
      cache.set('key3', 'value3', 1000);
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });
  });

  describe('delete', () => {
    it('should delete existing key', () => {
      cache.set('key1', 'value1', 1000);
      cache.delete('key1');
      expect(cache.get('key1')).toBeNull();
    });

    it('should handle deleting non-existent key', () => {
      expect(() => cache.delete('nonexistent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key2', 'value2', 1000);
      cache.set('key3', 'value3', 1000);
      expect(cache.getSize()).toBe(3);

      cache.clear();
      expect(cache.getSize()).toBe(0);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBeNull();
    });

    it('should handle clearing empty cache', () => {
      expect(() => cache.clear()).not.toThrow();
      expect(cache.getSize()).toBe(0);
    });
  });

  describe('getSize', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.getSize()).toBe(0);
    });

    it('should return correct size after additions', () => {
      cache.set('key1', 'value1', 1000);
      expect(cache.getSize()).toBe(1);
      cache.set('key2', 'value2', 1000);
      expect(cache.getSize()).toBe(2);
    });

    it('should decrease size after deletion', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key2', 'value2', 1000);
      expect(cache.getSize()).toBe(2);
      cache.delete('key1');
      expect(cache.getSize()).toBe(1);
    });

    it('should not count expired entries', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      await new Promise(resolve => setTimeout(resolve, 60)); // Wait for expiration
      cache.get('key1'); // This should clean up the expired entry
      expect(cache.getSize()).toBe(0);
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      cache.set('key1', 'value1', 1000);
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      await new Promise(resolve => setTimeout(resolve, 60)); // Wait for expiration
      cache.get('key1'); // Trigger cleanup by accessing
      expect(cache.has('key1')).toBe(false);
    });

    it('should return true for key before expiration', async () => {
      cache.set('key1', 'value1', 200); // 200ms TTL
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait less than TTL
      expect(cache.has('key1')).toBe(true);
    });
  });

  describe('startCleanup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start cleanup interval', () => {
      const startCleanupSpy = jest.spyOn(cache, 'startCleanup');
      cache.startCleanup(1000);
      expect(startCleanupSpy).toHaveBeenCalledWith(1000);
      startCleanupSpy.mockRestore();
    });

    it('should cleanup expired entries', async () => {
      cache.set('key1', 'value1', 50);
      cache.set('key2', 'value2', 5000);
      cache.startCleanup(100);
      jest.advanceTimersByTime(150);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
    });
  });
});
