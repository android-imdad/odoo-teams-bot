/**
 * Resilience service for graceful degradation and fallback handling.
 * Ensures the bot continues to function even when external services fail.
 */

import { logger } from '../config/logger';
import { TimesheetEntry } from '../types';
import { auditService, AuditEventType } from './audit';
import { withRetry, RetryPresets } from '../utils/retry';
import { OdooService } from './odoo';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ResilienceConfig {
  /** Enable offline mode when Odoo is unavailable */
  enableOfflineMode: boolean;
  /** Path to offline queue file */
  offlineQueuePath: string;
  /** Maximum queue size before dropping oldest entries */
  maxQueueSize: number;
  /** Enable graceful degradation */
  enableGracefulDegradation: boolean;
}

export interface QueuedOperation {
  id: string;
  timestamp: number;
  operation: 'create_timesheet';
  data: TimesheetEntry;
  userId: string;
  retryCount: number;
}

class ResilienceService {
  private config: ResilienceConfig;
  private offlineQueue: QueuedOperation[] = [];
  private odooAvailable: boolean = true;
  private lastOdooCheck: number = 0;
  private processingQueue: boolean = false;
  private odooService: OdooService;

  constructor(odooService: OdooService, config: Partial<ResilienceConfig> = {}) {
    this.odooService = odooService;
    this.config = {
      enableOfflineMode: config.enableOfflineMode ?? true,
      offlineQueuePath: config.offlineQueuePath ?? path.join(process.cwd(), 'data', 'offline-queue.json'),
      maxQueueSize: config.maxQueueSize ?? 1000,
      enableGracefulDegradation: config.enableGracefulDegradation ?? true
    };

    this.loadOfflineQueue();
    this.startQueueProcessor();

    logger.info('ResilienceService initialized', this.config);
  }

  /**
   * Load offline queue from disk
   */
  private loadOfflineQueue(): void {
    try {
      const dir = path.dirname(this.config.offlineQueuePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.config.offlineQueuePath)) {
        const raw = fs.readFileSync(this.config.offlineQueuePath, 'utf8');
        const parsed = JSON.parse(raw);

        // T-3: Verify HMAC integrity if present
        if (parsed.hmac && parsed.data) {
          const data = JSON.stringify(parsed.data, null, 2);
          const expectedHmac = crypto.createHmac('sha256', this.getHmacKey()).update(data).digest('hex');
          if (parsed.hmac !== expectedHmac) {
            logger.error('Offline queue integrity check failed - queue may have been tampered with');
            this.offlineQueue = [];
            return;
          }
          this.offlineQueue = parsed.data;
        } else {
          // Legacy format without HMAC - migrate on next save
          this.offlineQueue = Array.isArray(parsed) ? parsed : [];
        }
        logger.info('Offline queue loaded', { size: this.offlineQueue.length });
      }
    } catch (error) {
      logger.error('Failed to load offline queue', { error });
      this.offlineQueue = [];
    }
  }

  /**
   * Save offline queue to disk with HMAC integrity check (T-3)
   */
  private saveOfflineQueue(): void {
    try {
      const data = JSON.stringify(this.offlineQueue, null, 2);
      const hmac = crypto.createHmac('sha256', this.getHmacKey()).update(data).digest('hex');
      const payload = JSON.stringify({ data: this.offlineQueue, hmac });
      fs.writeFileSync(this.config.offlineQueuePath, payload, 'utf8');
    } catch (error) {
      logger.error('Failed to save offline queue', { error });
    }
  }

  private getHmacKey(): string {
    return process.env.TOKEN_ENCRYPTION_KEY || process.env.BOT_PASSWORD || 'offline-queue-key';
  }

  /**
   * Start processing the offline queue
   */
  private startQueueProcessor(): void {
    setInterval(async () => {
      if (!this.processingQueue && this.offlineQueue.length > 0) {
        await this.processQueue();
      }
    }, 30000); // Process every 30 seconds
  }

  /**
   * Process the offline queue
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    if (!this.odooAvailable) return;

    this.processingQueue = true;

    try {
      const processed: string[] = [];

      for (const operation of this.offlineQueue) {
        try {
          if (operation.operation === 'create_timesheet') {
            await withRetry(
              () => this.odooService.logTime(operation.data, operation.userId),
              RetryPresets.STANDARD
            );

            auditService.log({
              eventType: AuditEventType.TIMESHEET_CREATE,
              userId: operation.userId,
              action: 'Created timesheet from offline queue',
              resource: 'timesheet',
              resourceId: operation.id,
              details: operation.data,
              success: true
            });

            processed.push(operation.id);
          }
        } catch (error) {
          operation.retryCount++;

          if (operation.retryCount >= 5) {
            logger.error('Operation failed after all retries', {
              operationId: operation.id,
              retryCount: operation.retryCount
            });
            processed.push(operation.id);
          }
        }
      }

      // Remove processed operations
      this.offlineQueue = this.offlineQueue.filter(op => !processed.includes(op.id));

      if (processed.length > 0) {
        this.saveOfflineQueue();
        logger.info('Processed offline queue operations', { count: processed.length });
      }

    } catch (error) {
      logger.error('Failed to process offline queue', { error });
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Add operation to offline queue
   */
  private addToQueue(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retryCount'>): void {
    if (!this.config.enableOfflineMode) {
      logger.warn('Offline mode disabled, dropping operation');
      return;
    }

    const queuedOp: QueuedOperation = {
      ...operation,
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      timestamp: Date.now(),
      retryCount: 0
    };

    // Enforce max queue size
    if (this.offlineQueue.length >= this.config.maxQueueSize) {
      const dropped = this.offlineQueue.shift();
      logger.warn('Offline queue full, dropped oldest operation', {
        droppedId: dropped?.id
      });
    }

    this.offlineQueue.push(queuedOp);
    this.saveOfflineQueue();

    logger.info('Operation added to offline queue', {
      operationId: queuedOp.id,
      queueSize: this.offlineQueue.length
    });
  }

  /**
   * Execute operation with fallback
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: () => T | Promise<T>,
    options: {
      operationName?: string;
      userId?: string;
      enableQueue?: boolean;
      queueData?: any;
    } = {}
  ): Promise<T> {
    const { operationName = 'operation', userId, enableQueue = false, queueData } = options;

    try {
      // Try the primary operation
      const result = await withRetry(operation, RetryPresets.STANDARD);

      // Mark Odoo as available after successful operation
      if (operationName.includes('odoo') || operationName.includes('timesheet')) {
        this.odooAvailable = true;
      }

      return result;

    } catch (error) {
      logger.warn(`${operationName} failed, using fallback`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Update Odoo availability
      if (operationName.includes('odoo') || operationName.includes('timesheet')) {
        this.odooAvailable = false;
      }

      auditService.log({
        eventType: AuditEventType.SYSTEM_ERROR,
        action: `${operationName} failed, using fallback`,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          operationName
        },
        success: false
      });

      // Add to queue if enabled
      if (enableQueue && queueData && userId) {
        this.addToQueue({
          operation: 'create_timesheet',
          data: queueData,
          userId
        });
      }

      // Execute fallback
      return await fallback();
    }
  }

  /**
   * Check if Odoo is available
   */
  async checkOdooAvailability(): Promise<boolean> {
    const now = Date.now();

    // Cache result for 1 minute
    if (now - this.lastOdooCheck < 60000) {
      return this.odooAvailable;
    }

    try {
      await this.odooService.getProjects();
      this.odooAvailable = true;
      this.lastOdooCheck = now;
      return true;
    } catch (error) {
      this.odooAvailable = false;
      this.lastOdooCheck = now;
      return false;
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    size: number;
    enabled: boolean;
    odooAvailable: boolean;
    processing: boolean;
  } {
    return {
      size: this.offlineQueue.length,
      enabled: this.config.enableOfflineMode,
      odooAvailable: this.odooAvailable,
      processing: this.processingQueue
    };
  }

  /**
   * Clear the offline queue
   */
  clearQueue(): void {
    this.offlineQueue = [];
    this.saveOfflineQueue();
    logger.info('Offline queue cleared');
  }

  /**
   * Get degraded response for timesheet creation
   */
  getDegradedTimesheetResponse(_data: {
    project_id: number;
    hours: number;
    date: string;
    description: string;
  }): {
    success: boolean;
    message: string;
    queued: boolean;
    queueSize: number;
  } {
    return {
      success: false,
      message: 'Odoo is currently unavailable. Your timesheet has been queued and will be submitted automatically when the service is restored.',
      queued: true,
      queueSize: this.offlineQueue.length
    };
  }
}

// Note: ResilienceService should be instantiated with OdooService and exported from index.ts
export { ResilienceService };
