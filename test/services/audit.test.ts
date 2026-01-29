/**
 * Tests for Audit Service
 */

import * as fs from 'fs';
import { AuditService, AuditEventType } from '../../src/services/audit';

// Mock logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock config
jest.mock('../../src/config/config', () => ({
  config: {
    environment: 'test'
  }
}));

// Mock fs module
jest.mock('fs');
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((p) => p.split('/').slice(0, -1).join('/'))
}));

describe('AuditService', () => {
  let auditService: AuditService;
  let mockWriteFileSync: jest.Mock;
  let mockAppendFileSync: jest.Mock;
  let mockExistsSync: jest.Mock;
  let mockReadFileSync: jest.Mock;
  let mockMkdirSync: jest.Mock;

  const mockAuditPath = '/tmp/test-audit.jsonl';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup fs mocks
    mockWriteFileSync = fs.writeFileSync as jest.Mock;
    mockAppendFileSync = fs.appendFileSync as jest.Mock;
    mockExistsSync = fs.existsSync as jest.Mock;
    mockReadFileSync = fs.readFileSync as jest.Mock;
    mockMkdirSync = fs.mkdirSync as jest.Mock;

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');
    mockMkdirSync.mockImplementation(() => {});

    // Create service with test options
    auditService = new AuditService({
      auditLogPath: mockAuditPath,
      enabled: true,
      batchSize: 5
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    auditService.stop();
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const service = new AuditService();

      expect(service).toBeDefined();
    });

    it('should initialize with custom options', () => {
      const service = new AuditService({
        auditLogPath: '/custom/path.jsonl',
        enabled: true,
        batchSize: 50
      });

      expect(service).toBeDefined();
    });

    it('should create audit directory if not exists', () => {
      mockExistsSync.mockReturnValue(false);

      new AuditService({
        auditLogPath: '/new/path/audit.jsonl',
        enabled: true
      });

      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/new/path',
        { recursive: true }
      );
    });

    it('should start batch flush interval', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      new AuditService({
        enabled: true,
        batchSize: 10
      });

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);

      setIntervalSpy.mockRestore();
    });

    it('should handle disabled service', () => {
      const service = new AuditService({
        enabled: false
      });

      const eventId = service.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });

      expect(eventId).toBe('');
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = (auditService as any).generateId();
      const id2 = (auditService as any).generateId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^audit_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^audit_\d+_[a-z0-9]+$/);
    });

    it('should include timestamp in ID', () => {
      const id = (auditService as any).generateId();

      const parts = id.split('_');
      expect(parts[1]).toBeDefined();

      const timestamp = parseInt(parts[1], 10);
      expect(timestamp).toBeGreaterThan(0);
    });
  });

  describe('log', () => {
    it('should log an audit event successfully', () => {
      mockAppendFileSync.mockImplementation(() => {});

      const eventId = auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Created timesheet entry',
        success: true
      });

      expect(eventId).toMatch(/^audit_\d+_[a-z0-9]+$/);
    });

    it('should add timestamp to event', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data);
        expect(event.timestamp).toBeDefined();
        expect(event.id).toBeDefined();
      });

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });
    });

    it('should batch events before writing', () => {
      mockAppendFileSync.mockClear();

      // Log 3 events (less than batch size of 5)
      for (let i = 0; i < 3; i++) {
        auditService.log({
          eventType: AuditEventType.TIMESHEET_CREATE,
          action: `Test ${i}`,
          success: true
        });
      }

      // Should not have written yet
      expect(mockAppendFileSync).not.toHaveBeenCalled();
    });

    it('should flush batch when batch size is reached', () => {
      mockAppendFileSync.mockImplementation(() => {});

      // Log 5 events (exactly batch size)
      for (let i = 0; i < 5; i++) {
        auditService.log({
          eventType: AuditEventType.TIMESHEET_CREATE,
          action: `Test ${i}`,
          success: true
        });
      }

      // Should have flushed
      expect(mockAppendFileSync).toHaveBeenCalled();
    });

    it('should flush batch on periodic interval', () => {
      mockAppendFileSync.mockImplementation(() => {});

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });

      expect(mockAppendFileSync).not.toHaveBeenCalled();

      // Advance time past flush interval
      jest.advanceTimersByTime(10000);

      expect(mockAppendFileSync).toHaveBeenCalled();
    });

    it('should write events as JSONL format', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        expect(data).toMatch(/^\{.*\}\n$/);
        const event = JSON.parse(data.trim());
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('eventType');
      });

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });

      jest.advanceTimersByTime(10000);
    });

    it('should handle all event fields', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('eventType');
        expect(event).toHaveProperty('action');
        expect(event).toHaveProperty('userId');
        expect(event).toHaveProperty('success');
      });

      auditService.log({
        eventType: AuditEventType.API_CALL,
        action: 'GET /api/test',
        userId: 'user123',
        success: true,
        details: { method: 'GET', endpoint: '/api/test' }
      });

      jest.advanceTimersByTime(10000);
    });

    it('should handle optional fields', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.userId).toBe('user123');
        expect(event.resource).toBe('timesheet');
        expect(event.ipAddress).toBe('127.0.0.1');
      });

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        userId: 'user123',
        resource: 'timesheet',
        ipAddress: '127.0.0.1',
        success: true
      });

      jest.advanceTimersByTime(10000);
    });

    it('should handle write errors gracefully', () => {
      mockAppendFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      expect(() => {
        auditService.log({
          eventType: AuditEventType.TIMESHEET_CREATE,
          action: 'Test',
          success: true
        });
      }).not.toThrow();
    });

    it('should return empty string when disabled', () => {
      const disabledService = new AuditService({ enabled: false });

      const eventId = disabledService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });

      expect(eventId).toBe('');
    });
  });

  describe('logTimesheetCreate', () => {
    it('should log timesheet creation with all fields', () => {
      mockAppendFileSync.mockImplementation(() => {});

      const eventId = auditService.logTimesheetCreate({
        userId: 'user123',
        userName: 'Test User',
        projectId: 1,
        projectName: 'Test Project',
        hours: 4.5,
        date: '2024-01-15',
        success: true
      });

      expect(eventId).toMatch(/^audit_\d+_[a-z0-9]+$/);
    });

    it('should include error details on failure', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.success).toBe(false);
        expect(event.errorMessage).toBe('Creation failed');
      });

      auditService.logTimesheetCreate({
        userId: 'user123',
        projectId: 1,
        projectName: 'Test Project',
        hours: 4.5,
        date: '2024-01-15',
        success: false,
        errorMessage: 'Creation failed'
      });

      jest.advanceTimersByTime(10000);
    });

    it('should include optional IP address', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.ipAddress).toBe('192.168.1.1');
      });

      auditService.logTimesheetCreate({
        userId: 'user123',
        projectId: 1,
        projectName: 'Test Project',
        hours: 4.5,
        date: '2024-01-15',
        ipAddress: '192.168.1.1',
        success: true
      });

      jest.advanceTimersByTime(10000);
    });
  });

  describe('logApiCall', () => {
    it('should log successful API call', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.API_SUCCESS);
        expect(event.success).toBe(true);
      });

      auditService.logApiCall({
        apiName: 'OdooAPI',
        method: 'POST',
        endpoint: '/xmlrpc/2/object',
        success: true,
        statusCode: 200,
        duration: 150
      });

      jest.advanceTimersByTime(10000);
    });

    it('should log failed API call', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.API_FAILURE);
        expect(event.success).toBe(false);
        expect(event.errorMessage).toBe('Connection failed');
      });

      auditService.logApiCall({
        apiName: 'OdooAPI',
        method: 'POST',
        endpoint: '/xmlrpc/2/object',
        success: false,
        statusCode: 500,
        errorMessage: 'Connection failed'
      });

      jest.advanceTimersByTime(10000);
    });

    it('should include duration in details', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.details.duration).toBe(250);
      });

      auditService.logApiCall({
        apiName: 'GeminiAPI',
        method: 'POST',
        endpoint: '/generate',
        success: true,
        duration: 250
      });

      jest.advanceTimersByTime(10000);
    });
  });

  describe('logSecurityEvent', () => {
    it('should log authentication failure', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.AUTH_FAILURE);
        expect(event.success).toBe(false);
        expect(event.metadata.severity).toBe('high');
        expect(event.metadata.requiresReview).toBe(true);
      });

      auditService.logSecurityEvent({
        eventType: AuditEventType.AUTH_FAILURE,
        action: 'Failed authentication attempt',
        userId: 'user123',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0'
      });

      jest.advanceTimersByTime(10000);
    });

    it('should log suspicious activity', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.SUSPICIOUS_ACTIVITY);
      });

      auditService.logSecurityEvent({
        eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
        action: 'Multiple failed login attempts',
        userId: 'user123',
        details: { attempts: 5 }
      });

      jest.advanceTimersByTime(10000);
    });

    it('should log rate limit exceeded', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.RATE_LIMIT_EXCEEDED);
      });

      auditService.logSecurityEvent({
        eventType: AuditEventType.RATE_LIMIT_EXCEEDED,
        action: 'Rate limit exceeded',
        ipAddress: '192.168.1.100'
      });

      jest.advanceTimersByTime(10000);
    });
  });

  describe('logSystemEvent', () => {
    it('should log system start event', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.SYSTEM_START);
        expect(event.success).toBe(true);
      });

      auditService.logSystemEvent({
        eventType: AuditEventType.SYSTEM_START,
        action: 'System started'
      });

      jest.advanceTimersByTime(10000);
    });

    it('should log system error event', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.SYSTEM_ERROR);
        expect(event.success).toBe(false);
        expect(event.errorMessage).toBe('Database connection failed');
      });

      auditService.logSystemEvent({
        eventType: AuditEventType.SYSTEM_ERROR,
        action: 'Database error',
        errorMessage: 'Database connection failed'
      });

      jest.advanceTimersByTime(10000);
    });

    it('should log system stop event', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.eventType).toBe(AuditEventType.SYSTEM_STOP);
      });

      auditService.logSystemEvent({
        eventType: AuditEventType.SYSTEM_STOP,
        action: 'System stopped'
      });

      jest.advanceTimersByTime(10000);
    });
  });

  describe('query', () => {
    it('should return empty array when log file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const results = await auditService.query();

      expect(results).toEqual([]);
    });

    it('should parse and return events from log file', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const results = await auditService.query();

      expect(results).toHaveLength(2);
      expect(results[0].action).toBe('Test 2');
      expect(results[1].action).toBe('Test 1');
    });

    it('should filter by userId', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', userId: 'user1', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', userId: 'user2', action: 'Test 2', success: true }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const results = await auditService.query({ userId: 'user1' });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user1');
    });

    it('should filter by eventType', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'api.failure', action: 'Test 2', success: false }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const results = await auditService.query({ eventType: AuditEventType.TIMESHEET_CREATE });

      expect(results).toHaveLength(1);
      expect(results[0].eventType).toBe('timesheet.create');
    });

    it('should filter by date range', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-10T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true },
        { id: 'audit_3_ghi', timestamp: '2024-01-20T12:00:00.000Z', eventType: 'timesheet.create', action: 'Test 3', success: true }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const startDate = new Date('2024-01-12T00:00:00.000Z');
      const endDate = new Date('2024-01-18T00:00:00.000Z');

      const results = await auditService.query({ startDate, endDate });

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('Test 2');
    });

    it('should limit results', async () => {
      const mockEvents = Array.from({ length: 100 }, (_, i) => ({
        id: `audit_${i}_abc`,
        timestamp: '2024-01-15T10:00:00.000Z',
        eventType: 'timesheet.create',
        action: `Test ${i}`,
        success: true
      }));

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const results = await auditService.query({ limit: 10 });

      expect(results.length).toBeLessThanOrEqual(10);
    });

    it('should sort results by timestamp descending', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T12:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true },
        { id: 'audit_3_ghi', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 3', success: true }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const results = await auditService.query();

      expect(results[0].id).toBe('audit_2_def');
      expect(results[1].id).toBe('audit_3_ghi');
      expect(results[2].id).toBe('audit_1_abc');
    });

    it('should handle malformed log lines gracefully', async () => {
      const mockLogContent = JSON.stringify({ id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true }) + '\n' +
        'invalid json line\n' +
        JSON.stringify({ id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true }) + '\n';

      mockReadFileSync.mockReturnValue(mockLogContent);

      const results = await auditService.query();

      expect(results).toHaveLength(2);
    });

    it('should return empty array on read error', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read failed');
      });

      const results = await auditService.query();

      expect(results).toEqual([]);
    });
  });

  describe('getStatistics', () => {
    it('should return zero statistics for empty log', async () => {
      mockReadFileSync.mockReturnValue('');

      const stats = await auditService.getStatistics();

      expect(stats.totalEvents).toBe(0);
      expect(stats.eventsByType).toEqual({});
      expect(stats.successRate).toBe(0);
      expect(stats.failureCount).toBe(0);
    });

    it('should calculate event counts by type', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true },
        { id: 'audit_3_ghi', timestamp: '2024-01-15T12:00:00.000Z', eventType: 'api.failure', action: 'Test 3', success: false }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const stats = await auditService.getStatistics();

      expect(stats.totalEvents).toBe(3);
      expect(stats.eventsByType['timesheet.create']).toBe(2);
      expect(stats.eventsByType['api.failure']).toBe(1);
    });

    it('should calculate success rate', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true },
        { id: 'audit_3_ghi', timestamp: '2024-01-15T12:00:00.000Z', eventType: 'api.failure', action: 'Test 3', success: false }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const stats = await auditService.getStatistics();

      expect(stats.successRate).toBe(2 / 3);
      expect(stats.failureCount).toBe(1);
    });

    it('should handle date range filtering', async () => {
      const mockEvents = [
        { id: 'audit_1_abc', timestamp: '2024-01-10T10:00:00.000Z', eventType: 'timesheet.create', action: 'Test 1', success: true },
        { id: 'audit_2_def', timestamp: '2024-01-15T11:00:00.000Z', eventType: 'timesheet.create', action: 'Test 2', success: true }
      ];

      mockReadFileSync.mockReturnValue(mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

      const startDate = new Date('2024-01-12T00:00:00.000Z');

      const stats = await auditService.getStatistics({ startDate });

      expect(stats.totalEvents).toBe(1);
    });
  });

  describe('archive', () => {
    it('should archive old events', () => {
      const oldEvent = { id: 'audit_1_old', timestamp: '2023-01-01T10:00:00.000Z', eventType: 'timesheet.create', action: 'Old', success: true };
      const newEvent = { id: 'audit_2_new', timestamp: '2024-01-15T10:00:00.000Z', eventType: 'timesheet.create', action: 'New', success: true };

      mockReadFileSync.mockReturnValue([oldEvent, newEvent].map(e => JSON.stringify(e)).join('\n') + '\n');
      mockWriteFileSync.mockImplementation(() => {});

      auditService.archive(new Date('2024-01-01T00:00:00.000Z'));

      expect(mockWriteFileSync).toHaveBeenCalledTimes(2); // Archive and rewrite
    });

    it('should not archive when log file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      auditService.archive(new Date('2024-01-01T00:00:00.000Z'));

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('should handle archive errors gracefully', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Read failed');
      });

      expect(() => {
        auditService.archive(new Date('2024-01-01T00:00:00.000Z'));
      }).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should flush batch on stop', () => {
      mockAppendFileSync.mockImplementation(() => {});

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });

      auditService.stop();

      expect(mockAppendFileSync).toHaveBeenCalled();
    });

    it('should clear batch flush interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      auditService.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long event data', () => {
      mockAppendFileSync.mockImplementation(() => {});

      const longDescription = 'A'.repeat(10000);

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: longDescription,
        success: true
      });

      jest.advanceTimersByTime(10000);

      expect(mockAppendFileSync).toHaveBeenCalled();
    });

    it('should handle special characters in event data', () => {
      mockAppendFileSync.mockImplementation(() => {});

      const specialAction = 'Action with "quotes", \'apostrophes\', & <symbols>';

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: specialAction,
        success: true
      });

      jest.advanceTimersByTime(10000);

      expect(mockAppendFileSync).toHaveBeenCalled();
    });

    it('should handle concurrent logging', () => {
      mockAppendFileSync.mockImplementation(() => {});

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          auditService.log({
            eventType: AuditEventType.TIMESHEET_CREATE,
            action: `Test ${i}`,
            success: true
          })
        );
      }

      jest.advanceTimersByTime(10000);

      expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle events with null/undefined optional fields', () => {
      mockAppendFileSync.mockImplementation((_filePath: string, data: string) => {
        const event = JSON.parse(data.trim());

        expect(event.userId).toBeUndefined();
        expect(event.ipAddress).toBeUndefined();
      });

      auditService.log({
        eventType: AuditEventType.TIMESHEET_CREATE,
        action: 'Test',
        success: true
      });

      jest.advanceTimersByTime(10000);
    });

    it('should handle events with complex nested objects', () => {
      mockAppendFileSync.mockImplementation(() => {});

      auditService.log({
        eventType: AuditEventType.API_CALL,
        action: 'API call',
        success: true,
        details: {
          nested: {
            deeply: {
              value: 'test'
            }
          },
          array: [1, 2, 3]
        }
      });

      jest.advanceTimersByTime(10000);

      expect(mockAppendFileSync).toHaveBeenCalled();
    });

    it('should handle empty log file in query', async () => {
      mockReadFileSync.mockReturnValue('\n');

      const results = await auditService.query();

      expect(results).toEqual([]);
    });

    it('should handle log file with only blank lines', async () => {
      mockReadFileSync.mockReturnValue('\n\n\n\n');

      const results = await auditService.query();

      expect(results).toEqual([]);
    });
  });
});
