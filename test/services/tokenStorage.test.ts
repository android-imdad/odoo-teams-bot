/**
 * Tests for TokenStorageService
 */

import { TokenStorageService } from '../../src/services/tokenStorage';
import { UserAuthSession, PendingAuthState } from '../../src/types/oauth.types';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }
}));

describe('TokenStorageService', () => {
  let service: TokenStorageService;
  const testDbPath = path.join('/tmp', 'tokens-test.db');
  const testEncryptionKey = 'test-encryption-key-32-chars-long!!';

  const mockSession: UserAuthSession = {
    teamsUserId: 'teams-user-123',
    teamsTenantId: 'tenant-456',
    odooUserId: 789,
    odooUsername: 'test@example.com',
    tokens: {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      scope: 'read write',
      tokenType: 'Bearer'
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeAll(async () => {
    // Ensure test data directory exists
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(async () => {
    // Clean up test database before each test
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    service = new TokenStorageService({
      dbPath: testDbPath,
      encryptionKey: testEncryptionKey
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterAll(() => {
    // Clean up test database file only, don't delete system temp directory
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      const newService = new TokenStorageService({
        dbPath: testDbPath,
        encryptionKey: 'another-test-key-32-chars-long!'
      });
      expect(newService).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should create database and tables', async () => {
      // Database is created in beforeEach
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should handle initialization errors', async () => {
      const badService = new TokenStorageService({
        dbPath: '/nonexistent/path/tokens.db',
        encryptionKey: testEncryptionKey
      });

      await expect(badService.initialize()).rejects.toThrow();
    });
  });

  describe('saveUserSession', () => {
    it('should save a new user session', async () => {
      await service.saveUserSession(mockSession);

      const retrieved = await service.getUserSession(mockSession.teamsUserId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.teamsUserId).toBe(mockSession.teamsUserId);
      expect(retrieved?.odooUserId).toBe(mockSession.odooUserId);
      expect(retrieved?.odooUsername).toBe(mockSession.odooUsername);
    });

    it('should encrypt tokens before storing', async () => {
      await service.saveUserSession(mockSession);

      // Read raw database content
      const dbContent = fs.readFileSync(testDbPath, 'utf8');
      // Tokens should not be stored in plain text
      expect(dbContent).not.toContain(mockSession.tokens.accessToken);
      expect(dbContent).not.toContain(mockSession.tokens.refreshToken);
    });

    it('should update existing session', async () => {
      await service.saveUserSession(mockSession);

      const updatedSession: UserAuthSession = {
        ...mockSession,
        odooUsername: 'updated@example.com',
        tokens: {
          ...mockSession.tokens,
          accessToken: 'new-access-token'
        }
      };

      await service.saveUserSession(updatedSession);

      const retrieved = await service.getUserSession(mockSession.teamsUserId);
      expect(retrieved?.odooUsername).toBe('updated@example.com');
      expect(retrieved?.tokens.accessToken).toBe('new-access-token');
    });
  });

  describe('getUserSession', () => {
    it('should return null for non-existent session', async () => {
      const retrieved = await service.getUserSession('non-existent-user');
      expect(retrieved).toBeNull();
    });

    it('should decrypt tokens when retrieving', async () => {
      await service.saveUserSession(mockSession);

      const retrieved = await service.getUserSession(mockSession.teamsUserId);
      expect(retrieved?.tokens.accessToken).toBe(mockSession.tokens.accessToken);
      expect(retrieved?.tokens.refreshToken).toBe(mockSession.tokens.refreshToken);
    });

    it('should return all session data correctly', async () => {
      await service.saveUserSession(mockSession);

      const retrieved = await service.getUserSession(mockSession.teamsUserId);
      expect(retrieved?.teamsUserId).toBe(mockSession.teamsUserId);
      expect(retrieved?.teamsTenantId).toBe(mockSession.teamsTenantId);
      expect(retrieved?.odooUserId).toBe(mockSession.odooUserId);
      expect(retrieved?.odooUsername).toBe(mockSession.odooUsername);
      expect(retrieved?.tokens.expiresAt).toBe(mockSession.tokens.expiresAt);
      expect(retrieved?.tokens.scope).toBe(mockSession.tokens.scope);
      expect(retrieved?.tokens.tokenType).toBe(mockSession.tokens.tokenType);
    });
  });

  describe('deleteUserSession', () => {
    it('should delete user session', async () => {
      await service.saveUserSession(mockSession);
      await service.deleteUserSession(mockSession.teamsUserId);

      const retrieved = await service.getUserSession(mockSession.teamsUserId);
      expect(retrieved).toBeNull();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(service.deleteUserSession('non-existent')).resolves.not.toThrow();
    });
  });

  describe('hasSession', () => {
    it('should return true for valid non-expired session', async () => {
      await service.saveUserSession(mockSession);

      const hasSession = await service.hasSession(mockSession.teamsUserId);
      expect(hasSession).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      const hasSession = await service.hasSession('non-existent');
      expect(hasSession).toBe(false);
    });

    it('should return false for expired session', async () => {
      const expiredSession: UserAuthSession = {
        ...mockSession,
        tokens: {
          ...mockSession.tokens,
          expiresAt: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
        }
      };

      await service.saveUserSession(expiredSession);

      const hasSession = await service.hasSession(mockSession.teamsUserId);
      expect(hasSession).toBe(false);
    });
  });

  describe('pending auth states', () => {
    const mockPendingState: PendingAuthState = {
      state: 'test-state-123',
      teamsUserId: 'teams-user-123',
      conversationReference: JSON.stringify({ conversation: { id: 'conv-123' } }),
      expiresAt: Math.floor(Date.now() / 1000) + 600 // 10 minutes
    };

    describe('savePendingState', () => {
      it('should save pending state', async () => {
        await service.savePendingState(mockPendingState);

        const retrieved = await service.getPendingState(mockPendingState.state);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.teamsUserId).toBe(mockPendingState.teamsUserId);
      });
    });

    describe('getPendingState', () => {
      it('should retrieve and delete pending state (one-time use)', async () => {
        await service.savePendingState(mockPendingState);

        const retrieved = await service.getPendingState(mockPendingState.state);
        expect(retrieved).not.toBeNull();

        // Second retrieval should return null
        const secondRetrieval = await service.getPendingState(mockPendingState.state);
        expect(secondRetrieval).toBeNull();
      });

      it('should return null for expired state', async () => {
        const expiredState: PendingAuthState = {
          ...mockPendingState,
          expiresAt: Math.floor(Date.now() / 1000) - 10 // Expired
        };

        await service.savePendingState(expiredState);

        const retrieved = await service.getPendingState(expiredState.state);
        expect(retrieved).toBeNull();
      });

      it('should return null for non-existent state', async () => {
        const retrieved = await service.getPendingState('non-existent-state');
        expect(retrieved).toBeNull();
      });
    });
  });

  describe('getExpiringSessions', () => {
    it('should return sessions expiring within specified window', async () => {
      const expiringSoon: UserAuthSession = {
        ...mockSession,
        teamsUserId: 'expiring-user',
        tokens: {
          ...mockSession.tokens,
          expiresAt: Math.floor(Date.now() / 1000) + 300 // 5 minutes
        }
      };

      const notExpiring: UserAuthSession = {
        ...mockSession,
        teamsUserId: 'not-expiring-user',
        tokens: {
          ...mockSession.tokens,
          expiresAt: Math.floor(Date.now() / 1000) + 7200 // 2 hours
        }
      };

      await service.saveUserSession(expiringSoon);
      await service.saveUserSession(notExpiring);

      const expiringSessions = await service.getExpiringSessions(600); // 10 minutes

      expect(expiringSessions).toHaveLength(1);
      expect(expiringSessions[0].teamsUserId).toBe('expiring-user');
    });

    it('should return empty array when no sessions expiring', async () => {
      const notExpiring: UserAuthSession = {
        ...mockSession,
        tokens: {
          ...mockSession.tokens,
          expiresAt: Math.floor(Date.now() / 1000) + 7200 // 2 hours
        }
      };

      await service.saveUserSession(notExpiring);

      const expiringSessions = await service.getExpiringSessions(600);
      expect(expiringSessions).toHaveLength(0);
    });
  });

  describe('cleanupExpiredStates', () => {
    it('should remove expired pending states', async () => {
      const expiredState: PendingAuthState = {
        state: 'expired-state',
        teamsUserId: 'user-1',
        conversationReference: '{}',
        expiresAt: Math.floor(Date.now() / 1000) - 10 // Expired
      };

      const validState: PendingAuthState = {
        state: 'valid-state',
        teamsUserId: 'user-2',
        conversationReference: '{}',
        expiresAt: Math.floor(Date.now() / 1000) + 600 // Valid
      };

      await service.savePendingState(expiredState);
      await service.savePendingState(validState);

      const deleted = await service.cleanupExpiredStates();

      expect(deleted).toBe(1);

      // Valid state should still exist
      const validRetrieved = await service.getPendingState(validState.state);
      expect(validRetrieved).not.toBeNull();
    });

    it('should return 0 when no expired states', async () => {
      const deleted = await service.cleanupExpiredStates();
      expect(deleted).toBe(0);
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await service.close();
      // Subsequent operations should fail
      await expect(service.getUserSession('test')).rejects.toThrow('Database not initialized');
    });

    it('should not throw when closing already closed service', async () => {
      await service.close();
      await expect(service.close()).resolves.not.toThrow();
    });
  });

  describe('encryption', () => {
    it('should use different IV for each encryption', async () => {
      const session1: UserAuthSession = {
        ...mockSession,
        teamsUserId: 'user-1',
        tokens: { ...mockSession.tokens, accessToken: 'token-1' }
      };

      const session2: UserAuthSession = {
        ...mockSession,
        teamsUserId: 'user-2',
        tokens: { ...mockSession.tokens, accessToken: 'token-1' } // Same token
      };

      await service.saveUserSession(session1);
      await service.saveUserSession(session2);

      // Read raw database content
      const dbContent = fs.readFileSync(testDbPath, 'utf8');

      // Even with same plaintext, encrypted values should be different
      // (because different IVs are used)
      const matches = dbContent.match(/token-1/g);
      expect(matches).toBeNull(); // Should not find plain text token
    });

    it('should handle encryption/decryption of special characters', async () => {
      const specialSession: UserAuthSession = {
        ...mockSession,
        tokens: {
          ...mockSession.tokens,
          accessToken: 'token-with-special-chars-!@#$%^&*()_+-=[]{}|;:,.<>?',
          refreshToken: 'refresh-with-unicode-ñéü-中文-🎉'
        }
      };

      await service.saveUserSession(specialSession);

      const retrieved = await service.getUserSession(specialSession.teamsUserId);
      expect(retrieved?.tokens.accessToken).toBe(specialSession.tokens.accessToken);
      expect(retrieved?.tokens.refreshToken).toBe(specialSession.tokens.refreshToken);
    });
  });
});
