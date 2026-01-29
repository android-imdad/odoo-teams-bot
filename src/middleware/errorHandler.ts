import { TurnContext } from 'botbuilder';
import { logger } from '../config/logger';
import { BotError } from '../types/bot.types';

export class ErrorHandler {
  /**
   * Wrap async function with error handling
   */
  static async handleAsync<T>(
    fn: () => Promise<T>,
    context?: TurnContext,
    errorMessage?: string
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      logger.error('Async operation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      if (context) {
        const userMessage = errorMessage || 'An error occurred. Please try again.';
        await context.sendActivity(userMessage);
      }

      return null;
    }
  }

  /**
   * Create a bot error with additional context
   */
  static createBotError(
    message: string,
    code?: string,
    context?: any,
    recoverable: boolean = true
  ): BotError {
    const error = new Error(message) as BotError;
    error.code = code;
    error.context = context;
    error.recoverable = recoverable;
    return error;
  }

  /**
   * Check if error is recoverable
   */
  static isRecoverable(error: Error | BotError): boolean {
    if ('recoverable' in error) {
      return error.recoverable ?? true;
    }
    return true;
  }
}
