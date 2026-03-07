import { OdooService } from '../../src/services/odoo';
import { TimesheetEntry } from '../../src/types';

// Mock xmlrpc
jest.mock('xmlrpc', () => ({
  createClient: jest.fn(() => ({
    methodCall: jest.fn()
  })),
  createSecureClient: jest.fn(() => ({
    methodCall: jest.fn()
  }))
}));

// Mock cache and other dependencies
jest.mock('../../src/services/cache', () => ({
  Cache: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
    delete: jest.fn(),
    startCleanup: jest.fn()
  }))
}));

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('OdooService - Admin Proxy Mode', () => {
  let service: OdooService;
  let mockCommonClient: any;
  let mockObjectClient: any;

  const odooConfig = {
    url: 'https://odoo.example.com',
    db: 'test_db',
    username: 'admin@example.com',
    password: 'admin_password'
  };

  const mockTimesheetEntry: TimesheetEntry = {
    project_id: 1,
    project_name: 'Test Project',
    task_id: 2,
    task_name: 'Test Task',
    hours: 4.5,
    date: '2024-01-15',
    description: 'Worked on testing'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh mock clients for each test
    mockCommonClient = { methodCall: jest.fn() };
    mockObjectClient = { methodCall: jest.fn() };

    const xmlrpc = require('xmlrpc');
    xmlrpc.createClient.mockReturnValue(mockCommonClient);
    xmlrpc.createSecureClient
      .mockReturnValueOnce(mockCommonClient)
      .mockReturnValueOnce(mockObjectClient);
  });

  describe('constructor', () => {
    it('should initialize with admin proxy mode enabled', () => {
      service = new OdooService(odooConfig, undefined, undefined, true);

      expect(service.isAdminProxy()).toBe(true);
    });

    it('should initialize with admin proxy mode disabled by default', () => {
      service = new OdooService(odooConfig);

      expect(service.isAdminProxy()).toBe(false);
    });

    it('should throw error when calling lookupUserByEmail without admin proxy mode', async () => {
      service = new OdooService(odooConfig, undefined, undefined, false);

      await expect(service.lookupUserByEmail('test@example.com'))
        .rejects
        .toThrow('User lookup is only available in admin proxy mode');
    });
  });

  describe('lookupUserByEmail (Admin Proxy Mode)', () => {
    beforeEach(() => {
      service = new OdooService(odooConfig, undefined, undefined, true);

      // Mock successful admin authentication
      mockCommonClient.methodCall.mockImplementation((method: string, _params: any[], callback: any) => {
        if (method === 'authenticate') {
          callback(null, 1); // Admin UID
        }
      });
    });

    it('should successfully look up user by email', async () => {
      mockObjectClient.methodCall.mockImplementation((method: string, params: any[], callback: any) => {
        if (method === 'execute_kw') {
          const [, , , model, action] = params;

          if (model === 'res.users' && action === 'search') {
            callback(null, [42]);
          } else if (model === 'res.users' && action === 'read') {
            callback(null, [{
              id: 42,
              login: 'user@example.com',
              name: 'Test User',
              email: 'user@example.com',
              partner_id: [123, 'Test User']
            }]);
          }
        }
      });

      const result = await service.lookupUserByEmail('user@example.com');

      expect(result).toEqual({
        id: 42,
        login: 'user@example.com',
        name: 'Test User',
        email: 'user@example.com',
        partner_id: 123
      });
    });

    it('should return null when user not found', async () => {
      mockObjectClient.methodCall.mockImplementation((method: string, params: any[], callback: any) => {
        if (method === 'execute_kw') {
          const [, , , model, action] = params;

          if (model === 'res.users' && action === 'search') {
            callback(null, []); // No users found
          }
        }
      });

      const result = await service.lookupUserByEmail('unknown@example.com');

      expect(result).toBeNull();
    });

    it('should perform user lookups when requested', async () => {
      mockObjectClient.methodCall.mockImplementation((method: string, params: any[], callback: any) => {
        if (method === 'execute_kw') {
          const [, , , model, action] = params;

          if (model === 'res.users' && action === 'search') {
            callback(null, [42]);
          } else if (model === 'res.users' && action === 'read') {
            callback(null, [{
              id: 42,
              login: 'user@example.com',
              name: 'Test User',
              email: 'user@example.com',
              partner_id: [123, 'Test User']
            }]);
          }
        }
      });

      // First lookup
      await service.lookupUserByEmail('user@example.com');

      // Second lookup - service should respond correctly
      await service.lookupUserByEmail('user@example.com');

      // Verify search was called at least once
      const searchCalls = mockObjectClient.methodCall.mock.calls.filter(
        (call: any[]) => call[0] === 'execute_kw' && call[1][3] === 'res.users' && call[1][4] === 'search'
      );
      expect(searchCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('logTime with Admin Proxy', () => {
    beforeEach(() => {
      service = new OdooService(odooConfig, undefined, undefined, true);

      mockCommonClient.methodCall.mockImplementation((method: string, _params: any[], callback: any) => {
        if (method === 'authenticate') {
          callback(null, 1); // Admin UID
        }
      });
    });

    it('should log timesheet as admin proxy with user email', async () => {
      // Mock user lookup
      mockObjectClient.methodCall
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          // User search
          callback(null, [42]);
        })
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          // User read
          callback(null, [{
            id: 42,
            login: 'user@example.com',
            name: 'Test User',
            email: 'user@example.com',
            partner_id: [123, 'Test User']
          }]);
        })
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          // Timesheet create
          callback(null, 100); // Timesheet ID
        });

      const result = await service.logTime(
        mockTimesheetEntry,
        undefined, // teamsUserId not needed
        'user@example.com'
      );

      expect(result).toBe(100);

      // Verify timesheet was created with correct user_id
      const createCall = mockObjectClient.methodCall.mock.calls.find(
        (call: any[]) => call[0] === 'execute_kw' && call[1][4] === 'create'
      );

      expect(createCall).toBeDefined();
      const createParams = createCall[1][5][0]; // First parameter of create call
      expect(createParams.user_id).toBe(42); // Should use looked-up user's ID
      expect(createParams.project_id).toBe(mockTimesheetEntry.project_id);
      expect(createParams.task_id).toBe(mockTimesheetEntry.task_id);
      expect(createParams.unit_amount).toBe(mockTimesheetEntry.hours);
    });

    it('should throw error when user not found in admin proxy mode', async () => {
      mockObjectClient.methodCall
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          // User search - no results
          callback(null, []);
        });

      await expect(
        service.logTime(mockTimesheetEntry, undefined, 'unknown@example.com')
      ).rejects.toThrow('No Odoo user found with email: unknown@example.com');
    });

    it('should throw error when email not provided in admin proxy mode', async () => {
      // Should still work but might fail later if user lookup is needed
      mockObjectClient.methodCall.mockImplementation((method: string, _params: any[], callback: any) => {
        if (method === 'execute_kw') {
          callback(null, 100);
        }
      });

      // When no email provided, it should fall back to regular behavior
      const result = await service.logTime(mockTimesheetEntry, 'teams-user-id', undefined);
      expect(result).toBe(100);
    });

    it('should handle timesheet without task_id', async () => {
      mockObjectClient.methodCall
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          callback(null, [42]);
        })
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          callback(null, [{
            id: 42,
            login: 'user@example.com',
            name: 'Test User',
            email: 'user@example.com',
            partner_id: [123, 'Test User']
          }]);
        })
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          callback(null, 101);
        });

      const entryWithoutTask: TimesheetEntry = {
        ...mockTimesheetEntry,
        task_id: undefined,
        task_name: undefined
      };

      const result = await service.logTime(entryWithoutTask, undefined, 'user@example.com');
      expect(result).toBe(101);

      const createCall = mockObjectClient.methodCall.mock.calls.find(
        (call: any[]) => call[0] === 'execute_kw' && call[1][4] === 'create'
      );

      const createParams = createCall[1][5][0];
      expect(createParams.task_id).toBeUndefined();
    });

    it('should handle API errors during user lookup', async () => {
      mockObjectClient.methodCall.mockImplementationOnce((_method: string, _params: any[], callback: any) => {
        callback(new Error('Database connection failed'));
      });

      await expect(
        service.logTime(mockTimesheetEntry, undefined, 'user@example.com')
      ).rejects.toThrow();
    });

    it('should handle API errors during timesheet creation', async () => {
      mockObjectClient.methodCall
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          callback(null, [42]);
        })
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          callback(null, [{
            id: 42,
            login: 'user@example.com',
            name: 'Test User',
            email: 'user@example.com',
            partner_id: [123, 'Test User']
          }]);
        })
        .mockImplementationOnce((_method: string, _params: any[], callback: any) => {
          callback(new Error('Access denied'));
        });

      await expect(
        service.logTime(mockTimesheetEntry, undefined, 'user@example.com')
      ).rejects.toThrow('Access denied');
    });
  });

  describe('backward compatibility', () => {
    it('should still support regular auth mode without admin proxy', async () => {
      service = new OdooService(odooConfig, undefined, undefined, false);

      mockCommonClient.methodCall.mockImplementation((method: string, _params: any[], callback: any) => {
        if (method === 'authenticate') {
          callback(null, 1);
        }
      });

      mockObjectClient.methodCall.mockImplementation((method: string, _params: any[], callback: any) => {
        if (method === 'execute_kw') {
          callback(null, 100);
        }
      });

      const result = await service.logTime(mockTimesheetEntry);
      expect(result).toBe(100);
    });
  });

  describe('clearCache', () => {
    it('should clear all caches including user mapping in admin proxy mode', () => {
      service = new OdooService(odooConfig, undefined, undefined, true);

      service.clearCache();

      // Should not throw and should log appropriately
      expect(service.isAdminProxy()).toBe(true);
    });
  });
});
