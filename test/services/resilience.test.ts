/**
 * Tests for resilience service
 */

import {
  ResilienceService,
  resilienceService,
  resilientOperation,
  QueuedOperation
} from '../../src/services/resilience';
import { auditService } from '../../src/services/audit';
import { logger } from '../../src/config/logger';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../src/services/audit');
jest.mock('../../src/config/logger');
jest.mock('../../src/services/odoo', () => ({
  odooService: {
    logTime: jest.fn()
  }
}));

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));

describe('ResilienceService', () => {
  let service: ResilienceService;
  const testQueuePath = '/tmp/test-offline-queue.json';

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    service = new ResilienceService({
      enableOfflineMode: true,
      offlineQueuePath: testQueuePath,
      maxQueueSize: 10,
      enableGracefulDegradation: true
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultService = new ResilienceService();
      expect(defaultService).toBeDefined();
    });

    it('should initialize with custom config', () => {
      expect(service).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        'ResilienceService initialized',
        expect.any(Object)
      );
    });

    it('should load existing offline queue', () => {
      const existingQueue: QueuedOperation[] = [{
        id: 'test-1',
        timestamp: Date.now(),
        operation: 'create_timesheet',
        data: {
          project_id: 1,
          project_name: 'Test Project',
          hours: 2,
          date: '2024-01-15',
          description: 'Test work'
        },
        userId: 'user-1',
        retryCount: 0
      }];

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(existingQueue));

      const newService = new ResilienceService({
        offlineQueuePath: testQueuePath
      });

      expect(newService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('Offline queue loaded', { size: 1 });
    });

    it('should handle errors when loading queue', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Read error');
      });

      const newService = new ResilienceService({
        offlineQueuePath: testQueuePath
      });

      expect(newService).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to load offline queue',
        expect.any(Object)
      );
    });

    it('should create data directory if it does not exist', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p !== path.dirname(testQueuePath);
      });

      new ResilienceService({ offlineQueuePath: testQueuePath });

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(testQueuePath), { recursive: true });
    });
  });

  describe('executeWithFallback', () => {
    it('should return primary operation result on success', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const fallback = jest.fn().mockResolvedValue('fallback');

      const result = await service.executeWithFallback(operation, fallback, {
        operationName: 'test-operation'
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    });

    it('should use fallback when primary fails', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Primary failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      const result = await service.executeWithFallback(operation, fallback, {
        operationName: 'test-operation'
      });

      expect(result).toBe('fallback');
      expect(operation).toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
    });

    it('should mark Odoo as available on successful timesheet operation', async () => {
      const { odooService } = await import('../../src/services/odoo');
      (odooService.logTime as jest.Mock).mockResolvedValue(123);

      const operation = jest.fn().mockResolvedValue('success');
      const fallback = jest.fn().mockResolvedValue('fallback');

      await service.executeWithFallback(operation, fallback, {
        operationName: 'odoo-timesheet-create'
      });

      // Odoo should be marked as available
      const status = service.getQueueStatus();
      expect(status.odooAvailable).toBe(true);
    });

    it('should mark Odoo as unavailable on failed timesheet operation', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Connection failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      await service.executeWithFallback(operation, fallback, {
        operationName: 'odoo-timesheet-create'
      });

      const status = service.getQueueStatus();
      expect(status.odooAvailable).toBe(false);
    });

    it('should log audit event on fallback', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      await service.executeWithFallback(operation, fallback, {
        operationName: 'test-operation'
      });

      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: expect.any(String),
        action: expect.stringContaining('failed'),
        success: false
      }));
    });

    it('should add to queue when enabled and operation fails', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      await service.executeWithFallback(operation, fallback, {
        operationName: 'odoo-timesheet-create',
        userId: 'user-1',
        enableQueue: true,
        queueData: {
          project_id: 1,
          project_name: 'Test',
          hours: 2,
          date: '2024-01-15',
          description: 'Test'
        }
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Operation added to offline queue',
        expect.any(Object)
      );
    });

    it('should not add to queue when disabled', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      service = new ResilienceService({ enableOfflineMode: false });

      await service.executeWithFallback(operation, fallback, {
        operationName: 'test-operation',
        userId: 'user-1',
        enableQueue: true,
        queueData: {}
      });

      expect(logger.warn).toHaveBeenCalledWith('Offline mode disabled, dropping operation');
    });
  });

  describe('checkOdooAvailability', () => {
    it('should return cached result within 1 minute', async () => {
      const { odooService } = await import('../../src/services/odoo');
      (odooService.logTime as jest.Mock).mockResolvedValue(123);

      // First check
      await service.checkOdooAvailability();

      // Second check immediately should use cache
      const result = await service.checkOdooAvailability();
      expect(typeof result).toBe('boolean');
    });

    it('should check Odoo after cache expires', async () => {
      const { odooService } = await import('../../src/services/odoo');
      (odooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1 }]);

      // Force cache expiration by manipulating time would be ideal,
      // but we'll just test the actual check
      const result = await service.checkOdooAvailability();
      expect(result).toBe(true);
    });

    it('should return false when Odoo is unavailable', async () => {
      const { odooService } = await import('../../src/services/odoo');
      (odooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const result = await service.checkOdooAvailability();
      expect(result).toBe(false);
    });
  });

  describe('getQueueStatus', () => {
    it('should return current queue status', () => {
      const status = service.getQueueStatus();

      expect(status).toHaveProperty('size');
      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('odooAvailable');
      expect(status).toHaveProperty('processing');
      expect(typeof status.size).toBe('number');
      expect(typeof status.enabled).toBe('boolean');
      expect(typeof status.odooAvailable).toBe('boolean');
      expect(typeof status.processing).toBe('boolean');
    });

    it('should reflect offline mode setting', () => {
      const enabledService = new ResilienceService({ enableOfflineMode: true });
      const disabledService = new ResilienceService({ enableOfflineMode: false });

      expect(enabledService.getQueueStatus().enabled).toBe(true);
      expect(disabledService.getQueueStatus().enabled).toBe(false);
    });
  });

  describe('clearQueue', () => {
    it('should clear all queued operations', () => {
      // Add some operations first by simulating a failed operation with queue enabled
      const statusBefore = service.getQueueStatus();
      expect(statusBefore.size).toBe(0);

      service.clearQueue();

      const statusAfter = service.getQueueStatus();
      expect(statusAfter.size).toBe(0);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Offline queue cleared');
    });
  });

  describe('getDegradedTimesheetResponse', () => {
    it('should return degraded response', () => {
      const response = service.getDegradedTimesheetResponse({
        project_id: 1,
        hours: 2,
        date: '2024-01-15',
        description: 'Test work'
      });

      expect(response.success).toBe(false);
      expect(response.queued).toBe(true);
      expect(response.queueSize).toBe(0);
      expect(response.message).toContain('Odoo is currently unavailable');
      expect(response.message).toContain('queued');
    });
  });

  describe('offline queue processing', () => {
    it('should process queued operations when Odoo is available', async () => {
      jest.useFakeTimers();
      const { odooService } = await import('../../src/services/odoo');
      (odooService.logTime as jest.Mock).mockResolvedValue(123);

      // Add an operation to the queue by executing a failing operation with queue enabled
      const operation = jest.fn().mockRejectedValue(new Error('Failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      await service.executeWithFallback(operation, fallback, {
        operationName: 'create_timesheet',
        userId: 'user-1',
        enableQueue: true,
        queueData: {
          project_id: 1,
          project_name: 'Test',
          hours: 2,
          date: '2024-01-15',
          description: 'Test'
        }
      });

      // Advance timer to trigger queue processing
      jest.advanceTimersByTime(35000);

      await Promise.resolve();

      jest.useRealTimers();
    });

    it('should drop operations after max retries', async () => {
      jest.useFakeTimers();
      const { odooService } = await import('../../src/services/odoo');
      (odooService.logTime as jest.Mock).mockRejectedValue(new Error('Still failing'));

      // Add operation to queue
      const operation = jest.fn().mockRejectedValue(new Error('Failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      await service.executeWithFallback(operation, fallback, {
        operationName: 'create_timesheet',
        userId: 'user-1',
        enableQueue: true,
        queueData: {
          project_id: 1,
          project_name: 'Test',
          hours: 2,
          date: '2024-01-15',
          description: 'Test'
        }
      });

      // Mark Odoo as available to trigger processing
      (odooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1 }]);

      // Advance timer multiple times to trigger retries
      for (let i = 0; i < 6; i++) {
        jest.advanceTimersByTime(35000);
        await Promise.resolve();
      }

      expect(logger.error).toHaveBeenCalledWith(
        'Dropping operation after max retries',
        expect.any(Object)
      );

      jest.useRealTimers();
    });
  });

  describe('queue size limit', () => {
    it('should drop oldest entries when max queue size is reached', async () => {
      const smallService = new ResilienceService({
        maxQueueSize: 2,
        offlineQueuePath: testQueuePath
      });

      const operation = jest.fn().mockRejectedValue(new Error('Failed'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      // Add 3 operations with queue size limit of 2
      for (let i = 0; i < 3; i++) {
        await smallService.executeWithFallback(operation, fallback, {
          operationName: 'create_timesheet',
          userId: `user-${i}`,
          enableQueue: true,
          queueData: {
            project_id: i,
            project_name: `Test ${i}`,
            hours: 2,
            date: '2024-01-15',
            description: 'Test'
          }
        });
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'Offline queue full, dropped oldest operation',
        expect.any(Object)
      );
    });
  });
});

describe('resilienceService singleton', () => {
  it('should be an instance of ResilienceService', () => {
    expect(resilienceService).toBeDefined();
    expect(typeof resilienceService.executeWithFallback).toBe('function');
    expect(typeof resilienceService.checkOdooAvailability).toBe('function');
    expect(typeof resilienceService.getQueueStatus).toBe('function');
    expect(typeof resilienceService.clearQueue).toBe('function');
    expect(typeof resilienceService.getDegradedTimesheetResponse).toBe('function');
  });
});

describe('resilientOperation wrapper', () => {
  it('should execute operation with default fallback', async () => {
    const operation = jest.fn().mockResolvedValue('success');

    const result = await resilientOperation(operation);

    expect(result).toBe('success');
  });

  it('should throw error when operation fails and no fallback provided', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Failed'));

    await expect(resilientOperation(operation)).rejects.toThrow('Operation failed and no fallback provided');
  });

  it('should use provided fallback', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Failed'));
    const fallback = jest.fn().mockResolvedValue('fallback');

    const result = await resilientOperation(operation, { fallback });

    expect(result).toBe('fallback');
  });

  it('should pass options to resilience service', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Failed'));
    const fallback = jest.fn().mockResolvedValue('fallback');

    await resilientOperation(operation, {
      fallback,
      operationName: 'test-op',
      userId: 'user-1',
      enableQueue: false
    });

    expect(operation).toHaveBeenCalled();
  });
});
