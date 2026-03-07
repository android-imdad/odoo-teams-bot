import { UserMappingService, OdooUserInfo } from '../../src/services/userMapping';
import { logger } from '../../src/config/logger';

// Mock the logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('UserMappingService', () => {
  let service: UserMappingService;
  let mockExecuteKw: jest.Mock;

  const mockOdooUser: OdooUserInfo = {
    id: 42,
    login: 'john.doe@company.com',
    name: 'John Doe',
    email: 'john.doe@company.com',
    partner_id: 123
  };

  beforeEach(() => {
    mockExecuteKw = jest.fn();
    service = new UserMappingService(mockExecuteKw, 3600000);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any intervals
    service.clearAllCaches();
  });

  describe('lookupUserByEmail', () => {
    it('should successfully look up a user by email', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42]) // search returns user IDs
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      const result = await service.lookupUserByEmail('john.doe@company.com');

      expect(result).toEqual(mockOdooUser);
      expect(mockExecuteKw).toHaveBeenCalledWith(
        'res.users',
        'search',
        [[['login', '=ilike', 'john.doe@company.com'], ['active', '=', true]]]
      );
      expect(mockExecuteKw).toHaveBeenCalledWith(
        'res.users',
        'read',
        [[42], ['id', 'login', 'name', 'partner_id', 'email']]
      );
    });

    it('should handle case-insensitive email matching', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      const result = await service.lookupUserByEmail('JOHN.DOE@COMPANY.COM');

      expect(result).toEqual(mockOdooUser);
      expect(mockExecuteKw).toHaveBeenCalledWith(
        'res.users',
        'search',
        [[['login', '=ilike', 'john.doe@company.com'], ['active', '=', true]]]
      );
    });

    it('should handle email with whitespace', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      const result = await service.lookupUserByEmail('  john.doe@company.com  ');

      expect(result).toEqual(mockOdooUser);
      expect(mockExecuteKw).toHaveBeenCalledWith(
        'res.users',
        'search',
        [[['login', '=ilike', 'john.doe@company.com'], ['active', '=', true]]]
      );
    });

    it('should return cached user on subsequent lookups', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      // First lookup
      const result1 = await service.lookupUserByEmail('john.doe@company.com');
      expect(result1).toEqual(mockOdooUser);
      expect(mockExecuteKw).toHaveBeenCalledTimes(2);

      // Second lookup should use cache
      const result2 = await service.lookupUserByEmail('john.doe@company.com');
      expect(result2).toEqual(mockOdooUser);
      expect(mockExecuteKw).toHaveBeenCalledTimes(2); // No additional calls

      expect(logger.debug).toHaveBeenCalledWith(
        'User found in cache',
        expect.any(Object)
      );
    });

    it('should return null when user is not found', async () => {
      mockExecuteKw.mockResolvedValueOnce([]);

      const result = await service.lookupUserByEmail('unknown@company.com');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'No Odoo user found with email',
        expect.any(Object)
      );
    });

    it('should cache failed lookups to avoid repeated attempts', async () => {
      mockExecuteKw.mockResolvedValueOnce([]);

      // First lookup - fails
      const result1 = await service.lookupUserByEmail('unknown@company.com');
      expect(result1).toBeNull();
      expect(mockExecuteKw).toHaveBeenCalledTimes(1);

      // Second lookup - should skip due to failed lookup cache
      const result2 = await service.lookupUserByEmail('unknown@company.com');
      expect(result2).toBeNull();
      expect(mockExecuteKw).toHaveBeenCalledTimes(1); // No additional call

      expect(logger.debug).toHaveBeenCalledWith(
        'Skipping lookup for recently failed email',
        expect.any(Object)
      );
    });

    it('should handle multiple users with same email (use first)', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42, 43]) // Multiple users
        .mockResolvedValueOnce([
          {
            id: 42,
            login: 'john.doe@company.com',
            name: 'John Doe',
            email: 'john.doe@company.com',
            partner_id: [123, 'John Doe']
          },
          {
            id: 43,
            login: 'john.doe@company.com',
            name: 'John Doe Duplicate',
            email: 'john.doe@company.com',
            partner_id: [124, 'John Doe Duplicate']
          }
        ]);

      const result = await service.lookupUserByEmail('john.doe@company.com');

      expect(result).toEqual(mockOdooUser); // First one returned
      expect(logger.warn).toHaveBeenCalledWith(
        'Multiple Odoo users found with same email, using first',
        expect.any(Object)
      );
    });

    it('should handle user with missing email field (fallback to login)', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: false, // No email set
          partner_id: [123, 'John Doe']
        }]);

      const result = await service.lookupUserByEmail('john.doe@company.com');

      expect(result).toEqual({
        ...mockOdooUser,
        email: 'john.doe@company.com' // Falls back to login
      });
    });

    it('should handle user without partner_id', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: false // No partner
        }]);

      const result = await service.lookupUserByEmail('john.doe@company.com');

      expect(result).toEqual({
        ...mockOdooUser,
        partner_id: undefined
      });
    });

    it('should handle executeKw errors gracefully', async () => {
      mockExecuteKw.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.lookupUserByEmail('john.doe@company.com');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to look up Odoo user by email',
        expect.any(Object)
      );
    });

    it('should handle null/undefined email input', async () => {
      const result = await service.lookupUserByEmail('');

      expect(result).toBeNull();
    });

    it('should handle special characters in email', async () => {
      const specialEmail = 'user+tag@sub.domain.company.com';
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: specialEmail,
          name: 'Test User',
          email: specialEmail,
          partner_id: [123, 'Test User']
        }]);

      const result = await service.lookupUserByEmail(specialEmail);

      expect(result?.login).toBe(specialEmail);
    });
  });

  describe('getCachedUser', () => {
    it('should return cached user if available', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      await service.lookupUserByEmail('john.doe@company.com');

      const cached = service.getCachedUser('john.doe@company.com');
      expect(cached).toEqual(mockOdooUser);
    });

    it('should return null if user not in cache', () => {
      const cached = service.getCachedUser('not-in-cache@company.com');
      expect(cached).toBeNull();
    });

    it('should handle case-insensitive cache lookup', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      await service.lookupUserByEmail('john.doe@company.com');

      const cached = service.getCachedUser('JOHN.DOE@COMPANY.COM');
      expect(cached).toEqual(mockOdooUser);
    });
  });

  describe('clearUserCache', () => {
    it('should clear specific user from cache', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      await service.lookupUserByEmail('john.doe@company.com');
      expect(service.getCachedUser('john.doe@company.com')).toEqual(mockOdooUser);

      service.clearUserCache('john.doe@company.com');
      expect(service.getCachedUser('john.doe@company.com')).toBeNull();
    });

    it('should clear failed lookup cache as well', async () => {
      mockExecuteKw.mockResolvedValueOnce([]);

      await service.lookupUserByEmail('unknown@company.com');
      expect(mockExecuteKw).toHaveBeenCalledTimes(1);

      service.clearUserCache('unknown@company.com');

      // After clearing, should attempt lookup again
      mockExecuteKw.mockResolvedValueOnce([]);
      await service.lookupUserByEmail('unknown@company.com');
      expect(mockExecuteKw).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAllCaches', () => {
    it('should clear all caches', async () => {
      mockExecuteKw
        .mockResolvedValueOnce([42])
        .mockResolvedValueOnce([{
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }]);

      await service.lookupUserByEmail('john.doe@company.com');
      expect(service.getCachedUser('john.doe@company.com')).toEqual(mockOdooUser);

      service.clearAllCaches();

      expect(service.getCachedUser('john.doe@company.com')).toBeNull();
      expect(logger.info).toHaveBeenCalledWith('All user mapping caches cleared');
    });
  });

  describe('preloadMappings', () => {
    it('should preload multiple user mappings', () => {
      const mappings = new Map([
        ['user1@company.com', { id: 1, login: 'user1@company.com', name: 'User 1', email: 'user1@company.com' }],
        ['user2@company.com', { id: 2, login: 'user2@company.com', name: 'User 2', email: 'user2@company.com' }],
        ['user3@company.com', { id: 3, login: 'user3@company.com', name: 'User 3', email: 'user3@company.com' }]
      ]);

      service.preloadMappings(mappings);

      expect(service.getCachedUser('user1@company.com')).toEqual(mappings.get('user1@company.com'));
      expect(service.getCachedUser('user2@company.com')).toEqual(mappings.get('user2@company.com'));
      expect(service.getCachedUser('user3@company.com')).toEqual(mappings.get('user3@company.com'));
    });

    it('should handle empty mappings', () => {
      service.preloadMappings(new Map());
      expect(logger.info).toHaveBeenCalledWith('Preloaded user mappings', { count: 0 });
    });
  });

  describe('concurrent lookups', () => {
    it('should handle concurrent lookups for same user without throwing errors', async () => {
      // Setup mock to handle multiple concurrent calls
      mockExecuteKw.mockImplementation(async () => {
        // Simulate some async work
        await new Promise(resolve => setTimeout(resolve, 10));
        // Return consistent result for search calls
        if (mockExecuteKw.mock.calls.length % 2 === 1) {
          return [42]; // search result
        }
        return [{ // read result
          id: 42,
          login: 'john.doe@company.com',
          name: 'John Doe',
          email: 'john.doe@company.com',
          partner_id: [123, 'John Doe']
        }];
      });

      // Start two concurrent lookups - should not throw
      const results = await Promise.all([
        service.lookupUserByEmail('john.doe@company.com'),
        service.lookupUserByEmail('john.doe@company.com')
      ]);

      // Both calls should complete without errors
      // Results may vary due to timing, but should not throw
      expect(results).toHaveLength(2);
    });
  });
});
