/**
 * Comprehensive error recovery system for handling all types of errors.
 * Provides classification, recovery strategies, and fallback mechanisms.
 */

import { logger } from '../config/logger';
import { auditService, AuditEventType } from '../services/audit';
import { ErrorHandler } from './errorHandler';

export enum ErrorCategory {
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  RATE_LIMIT = 'rate_limit',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ClassifiedError {
  originalError: Error;
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoverable: boolean;
  retryable: boolean;
  userMessage: string;
  suggestedAction: string;
  context: Record<string, any>;
}

export interface RecoveryStrategy {
  canRecover: (error: ClassifiedError) => boolean;
  recover: (error: ClassifiedError) => Promise<any>;
  fallback?: () => any;
}

export class ErrorRecoveryService {
  private strategies: Map<ErrorCategory, RecoveryStrategy[]> = new Map();
  private errorHistory: Map<string, { count: number; lastSeen: number }> = new Map();

  constructor() {
    this.initializeDefaultStrategies();
    this.startHistoryCleanup();
    logger.info('ErrorRecoveryService initialized');
  }

  /**
   * Initialize default recovery strategies
   */
  private initializeDefaultStrategies(): void {
    // Network error strategies
    this.addStrategy(ErrorCategory.NETWORK, {
      canRecover: (error) => error.recoverable,
      recover: async (error) => {
        logger.info('Attempting network error recovery', { error: error.originalError.message });

        // Wait and retry could be implemented here
        await this.delay(1000);

        // Return a signal to retry
        return { retry: true };
      }
    });

    // Rate limit strategies
    this.addStrategy(ErrorCategory.RATE_LIMIT, {
      canRecover: () => true,
      recover: async (error) => {
        const waitTime = this.extractRetryAfter(error.context) || 60000;

        logger.warn('Rate limit hit, waiting', { waitTime });

        await this.delay(waitTime);

        return { retry: true };
      },
      fallback: () => ({
        success: false,
        message: 'Rate limit exceeded. Please try again later.'
      })
    });

    // Timeout strategies
    this.addStrategy(ErrorCategory.TIMEOUT, {
      canRecover: () => true,
      recover: async (_error) => {
        logger.warn('Timeout occurred, retrying with longer timeout');

        await this.delay(2000);

        return { retry: true, timeout: 60000 };
      }
    });
  }

  /**
   * Add a custom recovery strategy
   */
  public addStrategy(category: ErrorCategory, strategy: RecoveryStrategy): void {
    if (!this.strategies.has(category)) {
      this.strategies.set(category, []);
    }
    this.strategies.get(category)!.push(strategy);
  }

  /**
   * Classify an error into category and severity
   */
  public classifyError(error: Error, context: Record<string, any> = {}): ClassifiedError {
    // Handle null, undefined, or non-Error objects
    const normalizedError =
      error instanceof Error
        ? error
        : new Error(error == null ? 'Unknown error' : String(error));

    const errorMessage = normalizedError.message.toLowerCase();
    const errorCode = (normalizedError as any).code;

    let category = ErrorCategory.UNKNOWN;
    let severity = ErrorSeverity.MEDIUM;
    let recoverable = true;
    let retryable = true;

    // Network errors
    if (
      errorCode === 'ECONNRESET' ||
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ENOTFOUND' ||
      errorCode === 'ETIMEDOUT' ||
      errorMessage.includes('network') ||
      errorMessage.includes('connection')
    ) {
      category = ErrorCategory.NETWORK;
      severity = ErrorSeverity.MEDIUM;
      recoverable = true;
      retryable = true;
    }

    // Authentication errors
    if (
      errorMessage.includes('authentication') ||
      errorMessage.includes('unauthorized') ||
      (normalizedError as any).status === 401
    ) {
      category = ErrorCategory.AUTHENTICATION;
      severity = ErrorSeverity.HIGH;
      recoverable = false; // Auth errors usually require user intervention
      retryable = false;
    }

    // Authorization errors
    if (
      errorMessage.includes('forbidden') ||
      errorMessage.includes('permission') ||
      (normalizedError as any).status === 403
    ) {
      category = ErrorCategory.AUTHORIZATION;
      severity = ErrorSeverity.HIGH;
      recoverable = false;
      retryable = false;
    }

    // Validation errors
    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid') ||
      (normalizedError as any).status === 400
    ) {
      category = ErrorCategory.VALIDATION;
      severity = ErrorSeverity.LOW;
      recoverable = false; // Validation errors need user input
      retryable = false;
    }

    // Rate limiting
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      (normalizedError as any).status === 429
    ) {
      category = ErrorCategory.RATE_LIMIT;
      severity = ErrorSeverity.MEDIUM;
      recoverable = true;
      retryable = true;
    }

    // Service unavailable
    if (
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('maintenance') ||
      (normalizedError as any).status === 503
    ) {
      category = ErrorCategory.SERVICE_UNAVAILABLE;
      severity = ErrorSeverity.HIGH;
      recoverable = true;
      retryable = true;
    }

    // Timeout
    if (
      errorCode === 'ETIMEDOUT' ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('timed out')
    ) {
      category = ErrorCategory.TIMEOUT;
      severity = ErrorSeverity.MEDIUM;
      recoverable = true;
      retryable = true;
    }

    const userMessage = this.getUserMessage(category);
    const suggestedAction = this.getSuggestedAction(category);

    // Track error history
    this.trackError(category, normalizedError);

    return {
      originalError: normalizedError,
      category,
      severity,
      recoverable,
      retryable,
      userMessage,
      suggestedAction,
      context
    };
  }

  /**
   * Get user-friendly error message
   */
  private getUserMessage(category: ErrorCategory): string {
    const messages: Record<ErrorCategory, string> = {
      [ErrorCategory.NETWORK]: 'Network connection issue. Please check your internet connection.',
      [ErrorCategory.AUTHENTICATION]: 'Authentication failed. Please check your credentials.',
      [ErrorCategory.AUTHORIZATION]: 'You do not have permission to perform this action.',
      [ErrorCategory.VALIDATION]: 'Invalid input. Please check your data and try again.',
      [ErrorCategory.RATE_LIMIT]: 'Too many requests. Please wait a moment and try again.',
      [ErrorCategory.SERVICE_UNAVAILABLE]: 'Service is temporarily unavailable. Please try again later.',
      [ErrorCategory.TIMEOUT]: 'Request timed out. Please try again.',
      [ErrorCategory.UNKNOWN]: 'An unexpected error occurred. Please try again.'
    };

    return messages[category] || messages[ErrorCategory.UNKNOWN];
  }

  /**
   * Get suggested action for the user
   */
  private getSuggestedAction(category: ErrorCategory): string {
    const actions: Record<ErrorCategory, string> = {
      [ErrorCategory.NETWORK]: 'Check your internet connection and try again.',
      [ErrorCategory.AUTHENTICATION]: 'Verify your credentials and contact support if the issue persists.',
      [ErrorCategory.AUTHORIZATION]: 'Contact your administrator for access.',
      [ErrorCategory.VALIDATION]: 'Review your input and ensure all required fields are correct.',
      [ErrorCategory.RATE_LIMIT]: 'Wait a few moments before trying again.',
      [ErrorCategory.SERVICE_UNAVAILABLE]: 'Please try again in a few minutes.',
      [ErrorCategory.TIMEOUT]: 'Try again with a simpler request.',
      [ErrorCategory.UNKNOWN]: 'If the problem persists, please contact support.'
    };

    return actions[category] || actions[ErrorCategory.UNKNOWN];
  }

  /**
   * Extract retry-after time from context
   */
  private extractRetryAfter(context: Record<string, any>): number | null {
    if (context.retryAfter) {
      return parseInt(context.retryAfter, 10) * 1000;
    }
    return null;
  }

  /**
   * Track error in history
   */
  private trackError(category: ErrorCategory, error: Error): void {
    const key = `${category}:${error.message}`;
    const existing = this.errorHistory.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
    } else {
      this.errorHistory.set(key, {
        count: 1,
        lastSeen: Date.now()
      });
    }
  }

  /**
   * Start periodic cleanup of error history
   */
  private startHistoryCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const maxAge = 3600000; // 1 hour

      for (const [key, value] of this.errorHistory.entries()) {
        if (now - value.lastSeen > maxAge) {
          this.errorHistory.delete(key);
        }
      }
    }, 600000); // Clean up every 10 minutes
  }

  /**
   * Attempt to recover from an error
   */
  public async recover(error: ClassifiedError): Promise<any> {
    const strategies = this.strategies.get(error.category) || [];

    for (const strategy of strategies) {
      if (strategy.canRecover(error)) {
        try {
          auditService.log({
            eventType: AuditEventType.SYSTEM_ERROR,
            action: `Attempting recovery for ${error.category}`,
            details: {
              category: error.category,
              severity: error.severity
            },
            success: false
          });

          const result = await strategy.recover(error);

          auditService.log({
            eventType: AuditEventType.SYSTEM_ERROR,
            action: `Recovery succeeded for ${error.category}`,
            details: {
              category: error.category,
              severity: error.severity
            },
            success: true
          });

          return result;
        } catch (recoveryError) {
          logger.error('Recovery strategy failed', {
            category: error.category,
            error: recoveryError
          });
        }
      }
    }

    // No recovery strategy worked, try fallback
    for (const strategy of strategies) {
      if (strategy.fallback) {
        return strategy.fallback();
      }
    }

    throw error.originalError;
  }

  /**
   * Handle error with automatic recovery
   */
  public async handle<T>(
    fn: () => Promise<T>,
    context: Record<string, any> = {}
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const classified = this.classifyError(
        error instanceof Error ? error : new Error(String(error)),
        context
      );

      logger.error('Error occurred, attempting recovery', {
        category: classified.category,
        severity: classified.severity,
        message: classified.originalError.message
      });

      const recoveryResult = await this.recover(classified);

      // If recovery indicates retry, retry the original function
      if (recoveryResult?.retry) {
        logger.info('Retrying operation after recovery');

        // Update context with any new parameters from recovery
        const updatedContext = { ...context, ...recoveryResult };

        try {
          return await fn();
        } catch (retryError) {
          // If retry also fails, classify the new error
          const retryClassified = this.classifyError(
            retryError instanceof Error ? retryError : new Error(String(retryError)),
            updatedContext
          );

          // Only retry once
          if (retryClassified.retryable && classified.retryable) {
            throw ErrorHandler.createBotError(
              retryClassified.userMessage,
              classified.category,
              { originalError: retryClassified },
              true
            );
          }

          throw retryError;
        }
      }

      throw classified.originalError;
    }
  }

  /**
   * Get error statistics
   */
  public getStatistics(): {
    totalErrors: number;
    byCategory: Record<string, number>;
    recentErrors: Array<{ category: string; count: number; lastSeen: number }>;
  } {
    let totalErrors = 0;
    const byCategory: Record<string, number> = {};

    for (const [key, value] of this.errorHistory.entries()) {
      const category = key.split(':')[0];
      totalErrors += value.count;
      byCategory[category] = (byCategory[category] || 0) + value.count;
    }

    const recentErrors = Array.from(this.errorHistory.entries())
      .map(([key, value]) => ({
        category: key.split(':')[0],
        count: value.count,
        lastSeen: value.lastSeen
      }))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 10);

    return {
      totalErrors,
      byCategory,
      recentErrors
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const errorRecoveryService = new ErrorRecoveryService();

/**
 * Wrapper function for error handling with recovery
 */
export async function withErrorRecovery<T>(
  fn: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  return errorRecoveryService.handle(fn, context);
}
