/**
 * Tests for error handler middleware
 */

import { ErrorHandler } from '../../src/middleware/errorHandler';
import { BotError } from '../../src/types/bot.types';
import { TurnContext } from 'botbuilder';

// Mock TurnContext
const mockContext = {
  sendActivity: jest.fn().mockResolvedValue(undefined)
} as unknown as TurnContext;

describe('ErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleAsync', () => {
    it('should return result when function succeeds', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await ErrorHandler.handleAsync(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should return null when function throws', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      const result = await ErrorHandler.handleAsync(fn);

      expect(result).toBeNull();
    });

    it('should not send message to context when no context provided', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      await ErrorHandler.handleAsync(fn);

      expect(mockContext.sendActivity).not.toHaveBeenCalled();
    });

    it('should send custom error message to context when provided', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      const customMessage = 'Custom error occurred';
      await ErrorHandler.handleAsync(fn, mockContext, customMessage);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(customMessage);
    });

    it('should send default error message when no custom message', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      await ErrorHandler.handleAsync(fn, mockContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith('An error occurred. Please try again.');
    });

    it('should handle non-Error errors', async () => {
      const fn = jest.fn().mockRejectedValue('string error');
      const result = await ErrorHandler.handleAsync(fn);

      expect(result).toBeNull();
    });

    it('should handle null errors', async () => {
      const fn = jest.fn().mockRejectedValue(null);
      const result = await ErrorHandler.handleAsync(fn);

      expect(result).toBeNull();
    });

    it('should handle undefined errors', async () => {
      const fn = jest.fn().mockRejectedValue(undefined);
      const result = await ErrorHandler.handleAsync(fn);

      expect(result).toBeNull();
    });
  });

  describe('createBotError', () => {
    it('should create bot error with message', () => {
      const error = ErrorHandler.createBotError('Test error');

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
    });

    it('should create bot error with code', () => {
      const error = ErrorHandler.createBotError('Test error', 'ERR_001');

      expect(error.message).toBe('Test error');
      expect((error as BotError).code).toBe('ERR_001');
    });

    it('should create bot error with context', () => {
      const context = { userId: '123', action: 'test' };
      const error = ErrorHandler.createBotError('Test error', 'ERR_001', context);

      expect((error as BotError).context).toEqual(context);
    });

    it('should create recoverable bot error by default', () => {
      const error = ErrorHandler.createBotError('Test error');

      expect((error as BotError).recoverable).toBe(true);
    });

    it('should create non-recoverable bot error when specified', () => {
      const error = ErrorHandler.createBotError('Test error', 'ERR_001', {}, false);

      expect((error as BotError).recoverable).toBe(false);
    });

    it('should handle missing optional parameters', () => {
      const error = ErrorHandler.createBotError('Test error');

      expect(error.message).toBe('Test error');
      expect((error as BotError).code).toBeUndefined();
      expect((error as BotError).context).toBeUndefined();
      expect((error as BotError).recoverable).toBe(true);
    });
  });

  describe('isRecoverable', () => {
    it('should return true for plain Error', () => {
      const error = new Error('Test error');
      expect(ErrorHandler.isRecoverable(error)).toBe(true);
    });

    it('should return recoverable property for BotError', () => {
      const error = ErrorHandler.createBotError('Test error', 'ERR_001', {}, true);
      expect(ErrorHandler.isRecoverable(error)).toBe(true);
    });

    it('should return false for non-recoverable BotError', () => {
      const error = ErrorHandler.createBotError('Test error', 'ERR_001', {}, false);
      expect(ErrorHandler.isRecoverable(error)).toBe(false);
    });

    it('should default to true when recoverable is undefined', () => {
      const error = new Error('Test error') as BotError;
      expect(error.recoverable).toBeUndefined();
      expect(ErrorHandler.isRecoverable(error)).toBe(true);
    });

    it('should default to true when recoverable is null', () => {
      const error = new Error('Test error') as BotError;
      (error.recoverable as any) = null;
      expect(ErrorHandler.isRecoverable(error)).toBe(true);
    });
  });

  describe('integration scenarios', () => {
    it('should handle async function with context and custom message', async () => {
      const successFn = jest.fn().mockResolvedValue('result');
      const result = await ErrorHandler.handleAsync(successFn, mockContext, 'Custom message');

      expect(result).toBe('result');
      expect(mockContext.sendActivity).not.toHaveBeenCalled();
    });

    it('should classify and handle errors appropriately', async () => {
      const recoverableError = ErrorHandler.createBotError('Temporary failure', 'TEMP_001');
      const isRecoverable = ErrorHandler.isRecoverable(recoverableError);

      expect(isRecoverable).toBe(true);
      expect((recoverableError as BotError).code).toBe('TEMP_001');
    });
  });
});
