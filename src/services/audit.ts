/**
 * Audit trail service for tracking all user actions and system events.
 * Provides compliance support and security monitoring.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../config/logger';
import { config } from '../config/config';

export enum AuditEventType {
  // User actions
  TIMESHEET_CREATE = 'timesheet.create',
  TIMESHEET_UPDATE = 'timesheet.update',
  TIMESHEET_DELETE = 'timesheet.delete',
  USER_LOGIN = 'user.login',
  USER_LOGOUT = 'user.logout',

  // System events
  SYSTEM_START = 'system.start',
  SYSTEM_STOP = 'system.stop',
  SYSTEM_ERROR = 'system.error',

  // API events
  API_CALL = 'api.call',
  API_SUCCESS = 'api.success',
  API_FAILURE = 'api.failure',
  API_RATE_LIMITED = 'api.rate_limited',

  // Security events
  AUTH_FAILURE = 'auth.failure',
  SUSPICIOUS_ACTIVITY = 'suspicious.activity',
  RATE_LIMIT_EXCEEDED = 'rate_limit.exceeded',

  // Data events
  DATA_CREATE = 'data.create',
  DATA_UPDATE = 'data.update',
  DATA_DELETE = 'data.delete',
  DATA_EXPORT = 'data.export'
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  userId?: string;
  userName?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export class AuditService {
  private auditLogPath: string;
  private isEnabled: boolean;
  private batchSize: number = 100;
  private batch: AuditEvent[] = [];
  private batchTimeout?: NodeJS.Timeout;
  private lastHash: string = '0';

  constructor(options: {
    auditLogPath?: string;
    enabled?: boolean;
    batchSize?: number;
  } = {}) {
    this.auditLogPath = options.auditLogPath || path.join(process.cwd(), 'logs', 'audit.jsonl');
    this.isEnabled = options.enabled !== false;
    this.batchSize = options.batchSize || 100;

    // Ensure audit log directory exists
    const logDir = path.dirname(this.auditLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Start batch flush interval
    this.startBatchFlush();

    logger.info('AuditService initialized', {
      auditLogPath: this.auditLogPath,
      enabled: this.isEnabled,
      batchSize: this.batchSize
    });
  }

  /**
   * Generate a unique audit event ID
   */
  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Write an audit event to the log.
   * R-2: Each event includes a hash of the previous event for tamper detection.
   */
  private writeEvent(event: AuditEvent): void {
    if (!this.isEnabled) return;

    try {
      (event as any).prevHash = this.lastHash;
      const logLine = JSON.stringify(event);
      this.lastHash = crypto.createHash('sha256').update(logLine).digest('hex');
      (event as any).hash = this.lastHash;
      fs.appendFileSync(this.auditLogPath, JSON.stringify(event) + '\n', 'utf8');
    } catch (error) {
      logger.error('Failed to write audit event', { error, eventId: event.id });
    }
  }

  /**
   * Flush batched events to disk
   */
  private flushBatch(): void {
    if (this.batch.length === 0) return;

    const eventsToWrite = [...this.batch];
    this.batch = [];

    for (const event of eventsToWrite) {
      this.writeEvent(event);
    }

    logger.debug(`Flushed ${eventsToWrite.length} audit events`, {
      batchCount: eventsToWrite.length
    });
  }

  /**
   * Start periodic batch flushing
   */
  private startBatchFlush(): void {
    // Flush every 10 seconds
    this.batchTimeout = setInterval(() => {
      this.flushBatch();
    }, 10000);
  }

  /**
   * Stop batch flushing
   */
  public stop(): void {
    if (this.batchTimeout) {
      clearInterval(this.batchTimeout);
    }
    this.flushBatch();
  }

  /**
   * Log an audit event
   */
  public log(event: Omit<AuditEvent, 'id' | 'timestamp'>): string {
    if (!this.isEnabled) {
      return '';
    }

    const auditEvent: AuditEvent = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...event
    };

    // Add to batch
    this.batch.push(auditEvent);

    // Flush if batch is full
    if (this.batch.length >= this.batchSize) {
      this.flushBatch();
    }

    // Also log to regular logger for immediate visibility
    logger.info('Audit event', {
      id: auditEvent.id,
      eventType: auditEvent.eventType,
      userId: auditEvent.userId,
      action: auditEvent.action,
      success: auditEvent.success
    });

    return auditEvent.id;
  }

  /**
   * Log a timesheet creation event
   */
  public logTimesheetCreate(params: {
    userId: string;
    userName?: string;
    projectId: number;
    projectName: string;
    hours: number;
    date: string;
    ipAddress?: string;
    success: boolean;
    errorMessage?: string;
  }): string {
    return this.log({
      eventType: AuditEventType.TIMESHEET_CREATE,
      userId: params.userId,
      userName: params.userName,
      action: 'Created timesheet entry',
      resource: 'timesheet',
      resourceId: `${params.userId}_${params.date}_${params.projectId}`,
      details: {
        projectId: params.projectId,
        projectName: params.projectName,
        hours: params.hours,
        date: params.date
      },
      ipAddress: params.ipAddress,
      success: params.success,
      errorMessage: params.errorMessage
    });
  }

  /**
   * Log an API call event
   */
  public logApiCall(params: {
    userId?: string;
    apiName: string;
    method: string;
    endpoint: string;
    success: boolean;
    statusCode?: number;
    duration?: number;
    errorMessage?: string;
  }): string {
    return this.log({
      eventType: params.success ? AuditEventType.API_SUCCESS : AuditEventType.API_FAILURE,
      userId: params.userId,
      action: `${params.method} ${params.endpoint}`,
      resource: params.apiName,
      details: {
        method: params.method,
        endpoint: params.endpoint,
        statusCode: params.statusCode,
        duration: params.duration
      },
      success: params.success,
      errorMessage: params.errorMessage
    });
  }

  /**
   * Log a security event
   */
  public logSecurityEvent(params: {
    userId?: string;
    eventType: AuditEventType.AUTH_FAILURE | AuditEventType.SUSPICIOUS_ACTIVITY | AuditEventType.RATE_LIMIT_EXCEEDED;
    action: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }): string {
    return this.log({
      eventType: params.eventType,
      userId: params.userId,
      action: params.action,
      details: params.details,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      success: false,
      metadata: {
        severity: 'high',
        requiresReview: true
      }
    });
  }

  /**
   * Log a system event
   */
  public logSystemEvent(params: {
    eventType: AuditEventType.SYSTEM_START | AuditEventType.SYSTEM_STOP | AuditEventType.SYSTEM_ERROR;
    action: string;
    details?: Record<string, any>;
    errorMessage?: string;
  }): string {
    return this.log({
      eventType: params.eventType,
      action: params.action,
      details: params.details,
      success: params.eventType !== AuditEventType.SYSTEM_ERROR,
      errorMessage: params.errorMessage
    });
  }

  /**
   * Query audit log for events
   */
  public async query(options: {
    userId?: string;
    eventType?: AuditEventType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): Promise<AuditEvent[]> {
    const {
      userId,
      eventType,
      startDate,
      endDate,
      limit = 1000
    } = options;

    try {
      if (!fs.existsSync(this.auditLogPath)) {
        return [];
      }

      const logContent = fs.readFileSync(this.auditLogPath, 'utf8');
      const lines = logContent.split('\n').filter(line => line.trim());

      const events: AuditEvent[] = [];

      for (const line of lines) {
        try {
          const event: AuditEvent = JSON.parse(line);

          // Apply filters
          if (userId && event.userId !== userId) continue;
          if (eventType && event.eventType !== eventType) continue;

          const eventDate = new Date(event.timestamp);
          if (startDate && eventDate < startDate) continue;
          if (endDate && eventDate > endDate) continue;

          events.push(event);

          if (events.length >= limit) break;
        } catch (parseError) {
          logger.warn('Failed to parse audit log line', { line });
        }
      }

      return events.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

    } catch (error) {
      logger.error('Failed to query audit log', { error });
      return [];
    }
  }

  /**
   * Get audit statistics
   */
  public async getStatistics(options: {
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    successRate: number;
    failureCount: number;
  }> {
    const events = await this.query({
      ...options,
      limit: 100000
    });

    const eventsByType: Record<string, number> = {};
    let failureCount = 0;

    for (const event of events) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      if (!event.success) {
        failureCount++;
      }
    }

    return {
      totalEvents: events.length,
      eventsByType,
      successRate: events.length > 0 ? (events.length - failureCount) / events.length : 0,
      failureCount
    };
  }

  /**
   * Archive old audit logs
   */
  public archive(beforeDate: Date): void {
    const archivePath = this.auditLogPath.replace('.jsonl', `_archived_${Date.now()}.jsonl`);

    try {
      if (!fs.existsSync(this.auditLogPath)) {
        return;
      }

      const logContent = fs.readFileSync(this.auditLogPath, 'utf8');
      const lines = logContent.split('\n').filter(line => line.trim());

      const toKeep: string[] = [];
      const toArchive: string[] = [];

      for (const line of lines) {
        try {
          const event: AuditEvent = JSON.parse(line);
          const eventDate = new Date(event.timestamp);

          if (eventDate < beforeDate) {
            toArchive.push(line);
          } else {
            toKeep.push(line);
          }
        } catch {
          // Keep malformed lines
          toKeep.push(line);
        }
      }

      if (toArchive.length > 0) {
        // Write archived events
        fs.writeFileSync(archivePath, toArchive.join('\n') + '\n', 'utf8');

        // Overwrite with remaining events
        fs.writeFileSync(this.auditLogPath, toKeep.join('\n') + '\n', 'utf8');

        logger.info('Audit log archived', {
          archivedCount: toArchive.length,
          remainingCount: toKeep.length,
          archivePath
        });
      }

    } catch (error) {
      logger.error('Failed to archive audit log', { error });
    }
  }
}

// Export singleton instance
export const auditService = new AuditService({
  enabled: config.environment !== 'test',
  batchSize: 100
});

// Flush on process exit
process.on('exit', () => {
  auditService.stop();
});

process.on('SIGINT', () => {
  auditService.stop();
});

process.on('SIGTERM', () => {
  auditService.stop();
});
