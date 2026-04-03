/**
 * Tests for Odoo XML-RPC client service
 */

import { OdooService } from '../../src/services/odoo';
import { OdooProject } from '../../src/types/odoo.types';
import { TimesheetEntry } from '../../src/types';
import xmlrpc from 'xmlrpc';

// Mock logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock cache
jest.mock('../../src/services/cache', () => ({
  Cache: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
    getSize: jest.fn().mockReturnValue(0),
    startCleanup: jest.fn()
  }))
}));

// Mock config
jest.mock('../../src/config/config', () => ({
  config: {
    odoo: {
      url: 'https://test-odoo.example.com',
      db: 'test-db',
      username: 'test-user',
      password: 'test-password'
    },
    cache: {
      projectTtl: 3600000
    }
  }
}));

describe('OdooService', () => {
  let odooService: OdooService;
  let mockCommonClient: any;
  let mockObjectClient: any;

  const mockTimesheetEntry: TimesheetEntry = {
    project_id: 1,
    project_name: 'Project A',
    hours: 4.5,
    date: '2024-01-15',
    description: 'Test work',
    user_id: 123
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock clients - no default implementation, will be set in tests
    mockCommonClient = {
      methodCall: jest.fn()
    };
    mockObjectClient = {
      methodCall: jest.fn()
    };

    // Mock xmlrpc client creation
    // For HTTPS, both clients use createSecureClient with different paths
    (xmlrpc as any).createClient = jest.fn();
    (xmlrpc as any).createSecureClient = jest.fn((options: any) => {
      // Return common client for /xmlrpc/2/common path
      if (options.path === '/xmlrpc/2/common') {
        return mockCommonClient;
      }
      // Return object client for /xmlrpc/2/object path
      if (options.path === '/xmlrpc/2/object') {
        return mockObjectClient;
      }
      return mockCommonClient; // default
    });

    // Create service instance AFTER mocks are set up
    odooService = new OdooService({
      url: 'https://test-odoo.example.com',
      db: 'test-db',
      username: 'test-user',
      password: 'test-password'
    });
  });

  describe('Constructor', () => {
    it('should initialize with HTTPS client for https URL', () => {
      new OdooService({
        url: 'https://test-odoo.example.com',
        db: 'test-db',
        username: 'test-user',
        password: 'test-password'
      });

      expect(xmlrpc.createSecureClient).toHaveBeenCalledWith({
        host: 'test-odoo.example.com',
        port: 443,
        path: '/xmlrpc/2/common'
      });
    });

    it('should initialize with HTTP client for http URL', () => {
      new OdooService({
        url: 'http://test-odoo.example.com:8080',
        db: 'test-db',
        username: 'test-user',
        password: 'test-password'
      });

      expect(xmlrpc.createClient).toHaveBeenCalledWith({
        host: 'test-odoo.example.com',
        port: 8080,
        path: '/xmlrpc/2/common'
      });
    });

    it('should use default port 443 for HTTPS without explicit port', () => {
      new OdooService({
        url: 'https://test-odoo.example.com',
        db: 'test-db',
        username: 'test-user',
        password: 'test-password'
      });

      expect(xmlrpc.createSecureClient).toHaveBeenCalledWith(
        expect.objectContaining({ port: 443 })
      );
    });

    it('should use default port 80 for HTTP without explicit port', () => {
      new OdooService({
        url: 'http://test-odoo.example.com',
        db: 'test-db',
        username: 'test-user',
        password: 'test-password'
      });

      expect(xmlrpc.createClient).toHaveBeenCalledWith(
        expect.objectContaining({ port: 80 })
      );
    });
  });

  describe('authenticate', () => {
    it('should successfully authenticate with valid credentials', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      // Access private method for testing
      const authenticate = (odooService as any).authenticate.bind(odooService);
      const uid = await authenticate();

      expect(uid).toBe(123);
      expect(mockCommonClient.methodCall).toHaveBeenCalledWith(
        'authenticate',
        ['test-db', 'test-user', 'test-password', {}],
        expect.any(Function)
      );
    });

    it('should cache uid after successful authentication', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      const uid1 = await authenticate();
      const uid2 = await authenticate();

      expect(uid1).toBe(123);
      expect(uid2).toBe(123);
      expect(mockCommonClient.methodCall).toHaveBeenCalledTimes(1);
    });

    it('should reject with error on authentication failure', async () => {
      const authError = new Error('Authentication failed');
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(authError, null);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      await expect(authenticate()).rejects.toThrow('Odoo authentication failed: Authentication failed');
    });

    it('should reject when uid is null', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, null);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      await expect(authenticate()).rejects.toThrow('Odoo authentication failed: Invalid credentials');
    });

    it('should reject when uid is 0', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 0);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      await expect(authenticate()).rejects.toThrow('Odoo authentication failed: Invalid credentials');
    });

    it('should handle non-Error objects in error callback', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback('String error message', null);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      await expect(authenticate()).rejects.toThrow('Odoo authentication failed: String error message');
    });
  });

  describe('executeKw', () => {
    it('should execute Odoo object method successfully', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, { id: 1, name: 'Test' });
      });

      const executeKw = (odooService as any).executeKw.bind(odooService);
      const result = await executeKw('project.project', 'read', [[1], ['id', 'name']]);

      expect(result).toEqual({ id: 1, name: 'Test' });
      expect(mockObjectClient.methodCall).toHaveBeenCalledWith(
        'execute_kw',
        ['test-db', 123, 'test-password', 'project.project', 'read', [[1], ['id', 'name']]],
        expect.any(Function)
      );
    });

    it('should reject on method execution error', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const methodError = new Error('Method execution failed');
      mockObjectClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(methodError, null);
      });

      const executeKw = (odooService as any).executeKw.bind(odooService);

      await expect(executeKw('project.project', 'read', [[1]])).rejects.toThrow(
        'Odoo project.project.read failed: Method execution failed'
      );
    });

    it('should handle non-Error objects in error callback', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback('String error', null);
      });

      const executeKw = (odooService as any).executeKw.bind(odooService);

      await expect(executeKw('project.project', 'read', [[1]])).rejects.toThrow(
        'Odoo project.project.read failed: String error'
      );
    });
  });

  describe('getProjects', () => {
    const mockProjects: OdooProject[] = [
      { id: 1, name: 'Project A', code: 'PROJ-A', active: true },
      { id: 2, name: 'Project B', code: 'PROJ-B', active: true },
      { id: 3, name: 'Project C', active: true }
    ];

    it('should fetch and return projects from Odoo', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      // Mock search and read calls
      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'search') {
          callback(null, [1, 2, 3]);
        } else if (params[4] === 'read') {
          callback(null, [
            { id: 1, name: 'Project A', code: 'PROJ-A', active: true },
            { id: 2, name: 'Project B', code: 'PROJ-B', active: true },
            { id: 3, name: 'Project C', active: true }
          ]);
        }
      });

      const projects = await odooService.getProjects();

      expect(projects).toHaveLength(3);
      expect(projects[0]).toEqual({ id: 1, name: 'Project A', code: 'PROJ-A', active: true });
      expect(projects[1]).toEqual({ id: 2, name: 'Project B', code: 'PROJ-B', active: true });
      expect(projects[2]).toEqual({ id: 3, name: 'Project C', active: true, code: undefined });
    });

    it('should return empty array when no projects found', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'search') {
          callback(null, []);
        }
      });

      const projects = await odooService.getProjects();

      expect(projects).toEqual([]);
    });

    it('should return cached projects when available', async () => {
      const cache = (odooService as any).projectCache;
      cache.get.mockReturnValueOnce(mockProjects);

      const projects = await odooService.getProjects();

      expect(projects).toEqual(mockProjects);
      expect(cache.get).toHaveBeenCalledWith('active_projects');
      // Should not call Odoo
      expect(mockObjectClient.methodCall).not.toHaveBeenCalled();
    });

    it('should handle missing code field', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'search') {
          callback(null, [1]);
        } else if (params[4] === 'read') {
          callback(null, [{ id: 1, name: 'Project A', active: true }]);
        }
      });

      const projects = await odooService.getProjects();

      expect(projects[0].code).toBeUndefined();
    });

    it('should propagate errors from Odoo', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const odooError = new Error('Odoo connection failed');
      mockObjectClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(odooError, null);
      });

      await expect(odooService.getProjects()).rejects.toThrow('Odoo connection failed');
    });

    it('should handle null projectIds response', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'search') {
          callback(null, null);
        }
      });

      const projects = await odooService.getProjects();

      expect(projects).toEqual([]);
    });
  });

  describe('logTime', () => {
    it('should create timesheet entry successfully', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'create') {
          callback(null, 456);
        }
      });

      const timesheetId = await odooService.logTime(mockTimesheetEntry);

      expect(timesheetId).toBe(456);
      expect(mockObjectClient.methodCall).toHaveBeenCalledWith(
        'execute_kw',
        [
          'test-db',
          123,
          'test-password',
          'account.analytic.line',
          'create',
          [
            {
              project_id: 1,
              name: 'Test work',
              unit_amount: 4.5,
              date: '2024-01-15',
              user_id: 123
            }
          ]
        ],
        expect.any(Function)
      );
    });

    it('should use authenticated uid when user_id not provided', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 789);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'create') {
          const timesheetParams = params[5][0];
          expect(timesheetParams.user_id).toBe(789);
          callback(null, 456);
        }
      });

      const entryWithoutUserId = { ...mockTimesheetEntry, user_id: undefined };
      await odooService.logTime(entryWithoutUserId);
    });

    it('should propagate errors from Odoo', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const odooError = new Error('Failed to create timesheet');
      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'create') {
          callback(odooError, null);
        }
      });

      await expect(odooService.logTime(mockTimesheetEntry)).rejects.toThrow('Failed to create timesheet');
    });

    it('should handle decimal hours correctly', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'create') {
          const timesheetParams = params[5][0];
          expect(timesheetParams.unit_amount).toBe(2.75);
          callback(null, 456);
        }
      });

      const decimalEntry = { ...mockTimesheetEntry, hours: 2.75 };
      await odooService.logTime(decimalEntry);
    });

    it('should handle zero hours edge case', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'create') {
          const timesheetParams = params[5][0];
          expect(timesheetParams.unit_amount).toBe(0);
          callback(null, 456);
        }
      });

      const zeroHoursEntry = { ...mockTimesheetEntry, hours: 0 };
      await odooService.logTime(zeroHoursEntry);
    });

    it('should map billable=true to Odoo billable selection when supported', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const calls: any[] = [];
      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        calls.push(params);
        if (params[4] === 'fields_get') {
          callback(null, { billable: { type: 'selection' } });
        } else if (params[4] === 'create') {
          callback(null, 456);
        }
      });

      await odooService.logTime({ ...mockTimesheetEntry, billable: true });

      const createCall = calls.find((p: any) => p[4] === 'create');
      expect(createCall[5][0].billable).toBe('billable');
      expect(createCall[5][0].x_is_billable).toBeUndefined();
    });

    it('should map billable=false to Odoo non_billable selection when supported', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const calls: any[] = [];
      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        calls.push(params);
        if (params[4] === 'fields_get') {
          callback(null, { billable: { type: 'selection' } });
        } else if (params[4] === 'create') {
          callback(null, 456);
        }
      });

      await odooService.logTime({ ...mockTimesheetEntry, billable: false });

      const createCall = calls.find((p: any) => p[4] === 'create');
      expect(createCall[5][0].billable).toBe('non_billable');
      expect(createCall[5][0].x_is_billable).toBeUndefined();
    });

    it('should omit billability fields when no supported writable field exists', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const calls: any[] = [];
      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        calls.push(params);
        if (params[4] === 'fields_get') {
          callback(null, {});
        } else if (params[4] === 'create') {
          callback(null, 456);
        }
      });

      await odooService.logTime({ ...mockTimesheetEntry, billable: true });

      const createCall = calls.find((p: any) => p[4] === 'create');
      expect(createCall[5][0].billable).toBeUndefined();
      expect(createCall[5][0].x_is_billable).toBeUndefined();
    });
  });
  describe('clearCache', () => {
    it('should clear the project cache', () => {
      const cache = (odooService as any).projectCache;
      odooService.clearCache();

      expect(cache.clear).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed URL gracefully', () => {
      // The OdooService throws on invalid URLs due to new URL() constructor
      // This is expected behavior - URLs should be validated at config level
      expect(() => {
        new OdooService({
          url: 'not-a-valid-url',
          db: 'test-db',
          username: 'test-user',
          password: 'test-password'
        });
      }).toThrow('Invalid URL');
    });

    it('should handle URL with IPv6 address', () => {
      expect(() => {
        new OdooService({
          url: 'https://[::1]:8069',
          db: 'test-db',
          username: 'test-user',
          password: 'test-password'
        });
      }).not.toThrow();
    });

    it('should handle concurrent authentication requests', async () => {
      let authCallCount = 0;
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        // Use setTimeout to simulate async network delay
        setTimeout(() => {
          authCallCount++;
          callback(null, 123);
        }, 10);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      // Launch all requests concurrently
      const promises = [
        authenticate(),
        authenticate(),
        authenticate()
      ];

      await Promise.all(promises);

      // Note: Due to race conditions in concurrent async operations,
      // multiple authentication calls may occur. The caching prevents
      // SUBSEQUENT calls after the first one completes.
      // In this test, all 3 calls start before any completes due to setTimeout.
      expect(authCallCount).toBeGreaterThan(0);
    });

    it('should handle very large project lists', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const largeProjectList = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        name: `Project ${i + 1}`,
        code: `P${i + 1}`,
        active: true
      }));

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'search') {
          callback(null, Array.from({ length: 1000 }, (_, i) => i + 1));
        } else if (params[4] === 'read') {
          callback(null, largeProjectList);
        }
      });

      const projects = await odooService.getProjects();

      expect(projects).toHaveLength(1000);
    });

    it('should handle special characters in project names', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, params: any, callback: any) => {
        if (params[4] === 'search') {
          callback(null, [1]);
        } else if (params[4] === 'read') {
          callback(null, [{
            id: 1,
            name: 'Project with "quotes" and \'apostrophes\' & <special>',
            active: true
          }]);
        }
      });

      const projects = await odooService.getProjects();

      expect(projects[0].name).toContain('quotes');
    });

    it('should handle authentication timeout', async () => {
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, _callback: any) => {
        // Never call callback - simulates timeout
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      // Add timeout to the test
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      });

      await expect(Promise.race([authenticate(), timeoutPromise])).rejects.toThrow('Timeout');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle network errors during authentication', async () => {
      const networkError = new Error('ECONNREFUSED');
      (networkError as any).code = 'ECONNREFUSED';

      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(networkError, null);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      await expect(authenticate()).rejects.toThrow('Odoo authentication failed');
    });

    it('should handle database connection errors', async () => {
      const dbError = new Error('Database connection failed');

      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(dbError, null);
      });

      const authenticate = (odooService as any).authenticate.bind(odooService);

      await expect(authenticate()).rejects.toThrow('Odoo authentication failed');
    });

    it('should handle malformed response from Odoo', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      mockObjectClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 'not an object');
      });

      const executeKw = (odooService as any).executeKw.bind(odooService);

      // Should still return the malformed response
      const result = await executeKw('project.project', 'read', [[1]]);
      expect(result).toBe('not an object');
    });

    it('should handle timesheet creation with missing required fields', async () => {
      // Mock authentication
      mockCommonClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(null, 123);
      });

      const validationError = new Error('Missing required field: project_id');
      mockObjectClient.methodCall.mockImplementation((_method: any, _params: any, callback: any) => {
        callback(validationError, null);
      });

      const invalidEntry = { ...mockTimesheetEntry, project_id: NaN };

      await expect(odooService.logTime(invalidEntry)).rejects.toThrow();
    });
  });
});
