/**
 * Tests for retry mechanism
 */

import {
  withRetry,
  withRetryDetailed,
  RetryPresets,
  createRetriedFunction
} from '../../src/utils/retry';

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn, RetryPresets.QUICK);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, RetryPresets.QUICK);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('temporary failure'));

    await expect(withRetry(fn, { maxAttempts: 2, initialDelay: 100 }))
      .rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('validation error'));

    await expect(withRetry(fn, {
      maxAttempts: 3,
      shouldRetry: () => false
    })).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withRetryDetailed', () => {
  it('should return detailed result', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetryDetailed(fn, RetryPresets.QUICK);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.totalDelay).toBe(0);
  });

  it('should return failure result', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('failed'));

    const result = await withRetryDetailed(fn, {
      maxAttempts: 1,
      initialDelay: 100
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.attempts).toBe(1);
  });
});

describe('createRetriedFunction', () => {
  it('should create a retried version of a function', async () => {
    const originalFn = jest.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('success');

    const retriedFn = createRetriedFunction(originalFn, RetryPresets.QUICK);
    const result = await retriedFn();

    expect(result).toBe('success');
    expect(originalFn).toHaveBeenCalledTimes(2);
  });
});
