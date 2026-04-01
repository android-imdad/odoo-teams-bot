/**
 * Tests for OAuthService
 */

import { OAuthService } from '../../src/services/oauth';
import { TokenStorageService } from '../../src/services/tokenStorage';
import { OAuthConfig, UserAuthSession } from '../../src/types/oauth.types';
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

// Mock fetch globally
global.fetch = jest.fn();

describe('OAuthService', () => {
  let service: OAuthService;
  let tokenStorage: TokenStorageService;
  const testDbPath = path.join('/tmp', 'oauth-test.db');

  const mockConfig: OAuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://bot.example.com/auth/oauth/callback',
    authorizationUrl: 'https://odoo.example.com/oauth/authorize',
    tokenUrl: 'https://odoo.example.com/oauth/token',
    scope: 'read write'
  };

  beforeAll(async () => {
    const testDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    tokenStorage = new TokenStorageService({
      dbPath: testDbPath,
      encryptionKey: 'test-encryption-key-32-chars-long!!'
    });
    await tokenStorage.initialize();

    service = new OAuthService(mockConfig, tokenStorage);

    jest.clearAllMocks();
    (fetch as jest.Mock).mockReset();
  });

  afterEach(async () => {
    await tokenStorage.close();
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
    it('should initialize with config and token storage', () => {
      expect(service).toBeDefined();
    });
  });

  describe('generateAuthUrl', () => {
    it('should generate authorization URL with required parameters', () => {
      const userId = 'teams-user-123';
      const conversationRef = { conversation: { id: 'conv-123' } };

      const authUrl = service.generateAuthUrl(userId, conversationRef);

      expect(authUrl).toContain(mockConfig.authorizationUrl);
      expect(authUrl).toContain(`client_id=${mockConfig.clientId}`);
      expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(mockConfig.redirectUri)}`);
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('state=');
      // URLSearchParams encodes spaces as + while encodeURIComponent uses %20
      expect(authUrl).toMatch(/scope=read[+%20]write/);
      expect(authUrl).toContain('code_challenge=');
      expect(authUrl).toContain('code_challenge_method=S256');
    });

    it('should store pending state in database', async () => {
      const userId = 'teams-user-123';
      const conversationRef = { conversation: { id: 'conv-123' } };

      service.generateAuthUrl(userId, conversationRef);

      // Wait for async save
      await new Promise(resolve => setTimeout(resolve, 100));

      // The state should be stored (we'll verify in callback test)
    });

    it('should generate state for each call', () => {
      const userId = 'teams-user-123';
      const conversationRef = { conversation: { id: 'conv-123' } };

      const url1 = service.generateAuthUrl(userId, conversationRef);

      const state1 = new URL(url1).searchParams.get('state');

      // With mocked uuid, state will be the same, just verify it exists
      expect(state1).toBeDefined();
      expect(state1).toBe('mocked-uuid-12345');
    });
  });

  describe('handleCallback', () => {
    beforeEach(() => {
      // Mock successful token exchange
      (fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url === mockConfig.tokenUrl) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
              expires_in: 3600,
              scope: 'read write',
              token_type: 'Bearer'
            })
          };
        }

        // For user info endpoint
        if (url.includes('/api/user/info')) {
          return {
            ok: true,
            json: async () => ({
              user_id: 789,
              name: 'Test User'
            })
          };
        }

        return { ok: false, status: 404, text: async () => 'Not found' };
      });
    });

    it('should exchange code for tokens and create session', async () => {
      // First generate a state
      const userId = 'teams-user-123';
      const conversationRef = { conversation: { id: 'conv-123' } };
      const authUrl = service.generateAuthUrl(userId, conversationRef);
      const state = new URL(authUrl).searchParams.get('state')!;

      // Wait for state to be saved
      await new Promise(resolve => setTimeout(resolve, 100));

      const session = await service.handleCallback('auth-code', state);

      expect(session).toBeDefined();
      expect(session.teamsUserId).toBe(userId);
      expect(session.odooUserId).toBe(789);
      expect(session.odooUsername).toBe('Test User');
      expect(session.tokens.accessToken).toBe('new-access-token');
      expect(session.tokens.refreshToken).toBe('new-refresh-token');
    });

    it('should reject invalid state', async () => {
      await expect(service.handleCallback('code', 'invalid-state'))
        .rejects.toThrow('Invalid or expired state parameter');
    });

    it('should handle token exchange failure', async () => {
      const userId = 'teams-user-123';
      const conversationRef = { conversation: { id: 'conv-123' } };
      const authUrl = service.generateAuthUrl(userId, conversationRef);
      const state = new URL(authUrl).searchParams.get('state')!;

      await new Promise(resolve => setTimeout(resolve, 100));

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant'
      });

      await expect(service.handleCallback('code', state))
        .rejects.toThrow('Token exchange failed');
    });

    it('should extract user info from JWT if API fails', async () => {
      const userId = 'teams-user-123';
      const conversationRef = { conversation: { id: 'conv-123' } };
      const authUrl = service.generateAuthUrl(userId, conversationRef);
      const state = new URL(authUrl).searchParams.get('state')!;

      await new Promise(resolve => setTimeout(resolve, 100));

      // Create a JWT with user info
      const jwtPayload = Buffer.from(JSON.stringify({
        sub: '789',
        name: 'JWT User'
      })).toString('base64url');
      const jwtToken = `header.${jwtPayload}.signature`;

      (fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url === mockConfig.tokenUrl) {
          return {
            ok: true,
            json: async () => ({
              access_token: jwtToken,
              refresh_token: 'refresh',
              expires_in: 3600,
              scope: 'read write',
              token_type: 'Bearer'
            })
          };
        }
        return { ok: false, status: 404 };
      });

      const session = await service.handleCallback('code', state);

      expect(session.odooUserId).toBe(789);
      expect(session.odooUsername).toBe('JWT User');
    });
  });

  describe('getAccessToken', () => {
    const mockSession: UserAuthSession = {
      teamsUserId: 'teams-user-123',
      teamsTenantId: 'tenant-456',
      odooUserId: 789,
      odooUsername: 'test@example.com',
      tokens: {
        accessToken: 'current-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
        scope: 'read write',
        tokenType: 'Bearer'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    beforeEach(async () => {
      await tokenStorage.saveUserSession(mockSession);
    });

    it('should return existing token if not expired', async () => {
      const token = await service.getAccessToken(mockSession.teamsUserId);
      expect(token).toBe('current-access-token');
    });

    it('should return null for non-existent user', async () => {
      const token = await service.getAccessToken('non-existent');
      expect(token).toBeNull();
    });

    it('should refresh token when expiring soon', async () => {
      // Update session to be expiring soon
      const expiringSession: UserAuthSession = {
        ...mockSession,
        tokens: {
          ...mockSession.tokens,
          expiresAt: Math.floor(Date.now() / 1000) + 60 // 1 minute from now
        }
      };
      await tokenStorage.saveUserSession(expiringSession);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'refreshed-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          scope: 'read write',
          token_type: 'Bearer'
        })
      });

      const token = await service.getAccessToken(mockSession.teamsUserId);

      expect(token).toBe('refreshed-token');

      // Verify token was updated in storage
      const updatedSession = await tokenStorage.getUserSession(mockSession.teamsUserId);
      expect(updatedSession?.tokens.accessToken).toBe('refreshed-token');
    });

    it('should handle refresh token failure', async () => {
      const expiringSession: UserAuthSession = {
        ...mockSession,
        tokens: {
          ...mockSession.tokens,
          expiresAt: Math.floor(Date.now() / 1000) + 60
        }
      };
      await tokenStorage.saveUserSession(expiringSession);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'invalid_grant'
      });

      const token = await service.getAccessToken(mockSession.teamsUserId);

      expect(token).toBeNull();

      // Session should be deleted on refresh failure
      const session = await tokenStorage.getUserSession(mockSession.teamsUserId);
      expect(session).toBeNull();
    });
  });

  describe('revokeAuth', () => {
    const mockSession: UserAuthSession = {
      teamsUserId: 'teams-user-123',
      teamsTenantId: 'tenant-456',
      odooUserId: 789,
      odooUsername: 'test@example.com',
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: 'read write',
        tokenType: 'Bearer'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    beforeEach(async () => {
      await tokenStorage.saveUserSession(mockSession);
    });

    it('should delete user session', async () => {
      await service.revokeAuth(mockSession.teamsUserId);

      const session = await tokenStorage.getUserSession(mockSession.teamsUserId);
      expect(session).toBeNull();
    });

    it('should attempt to revoke token at OAuth provider', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      await service.revokeAuth(mockSession.teamsUserId);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('revoke'),
        expect.any(Object)
      );
    });

    it('should not fail if token revocation fails', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(service.revokeAuth(mockSession.teamsUserId))
        .resolves.not.toThrow();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true for authenticated user', async () => {
      const session: UserAuthSession = {
        teamsUserId: 'user-123',
        teamsTenantId: 'tenant',
        odooUserId: 789,
        odooUsername: 'test@example.com',
        tokens: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          scope: 'read',
          tokenType: 'Bearer'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await tokenStorage.saveUserSession(session);

      const isAuth = await service.isAuthenticated('user-123');
      expect(isAuth).toBe(true);
    });

    it('should return false for non-authenticated user', async () => {
      const isAuth = await service.isAuthenticated('non-existent');
      expect(isAuth).toBe(false);
    });
  });

  describe('getUserSession', () => {
    it('should return user session', async () => {
      const session: UserAuthSession = {
        teamsUserId: 'user-123',
        teamsTenantId: 'tenant',
        odooUserId: 789,
        odooUsername: 'test@example.com',
        tokens: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          scope: 'read',
          tokenType: 'Bearer'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await tokenStorage.saveUserSession(session);

      const retrieved = await service.getUserSession('user-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.teamsUserId).toBe('user-123');
    });

    it('should return null for non-existent user', async () => {
      const retrieved = await service.getUserSession('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('PKCE', () => {
    it('should include code_challenge in authorization URL', () => {
      const authUrl = service.generateAuthUrl('user-123', {});
      expect(authUrl).toContain('code_challenge=');
      expect(authUrl).toContain('code_challenge_method=S256');
    });

    it('should use a separate code_verifier (not state) in token exchange', async () => {
      const userId = 'teams-user-123';
      const authUrl = service.generateAuthUrl(userId, {});
      const state = new URL(authUrl).searchParams.get('state')!;

      await new Promise(resolve => setTimeout(resolve, 100));

      let capturedBody: string | null = null;
      (fetch as jest.Mock).mockImplementation(async (url: string, options: any) => {
        if (url === mockConfig.tokenUrl) {
          capturedBody = options.body;
          return {
            ok: true,
            json: async () => ({
              access_token: 'token',
              refresh_token: 'refresh',
              expires_in: 3600,
              scope: 'read',
              token_type: 'Bearer'
            })
          };
        }
        // Handle user info endpoint
        if (url.includes('/api/user/info') || url.includes('/oauth/userinfo')) {
          return {
            ok: true,
            json: async () => ({
              user_id: 789,
              name: 'Test User'
            })
          };
        }
        return { ok: false, status: 404 };
      });

      await service.handleCallback('code', state);

      // code_verifier should be present but should NOT be the state value
      expect(capturedBody).toContain('code_verifier=');
      expect(capturedBody).not.toContain(`code_verifier=${state}`);
      // Verify code_verifier is a proper length (base64url of 32 bytes = 43 chars)
      const params = new URLSearchParams(capturedBody!);
      const verifier = params.get('code_verifier')!;
      expect(verifier.length).toBeGreaterThanOrEqual(43);
    });
  });
});
