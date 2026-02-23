import { TokenStorageService } from './tokenStorage';
import { logger } from '../config/logger';

export interface ApiKeySession {
  teamsUserId: string;
  odooUsername: string;
  odooUserId: number;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ApiKeyAuthService {
  private tokenStorage: TokenStorageService;

  constructor(tokenStorage: TokenStorageService) {
    this.tokenStorage = tokenStorage;
    logger.info('ApiKeyAuthService initialized');
  }

  /**
   * Store API key for a user
   */
  async storeApiKey(
    teamsUserId: string,
    odooUsername: string,
    odooUserId: number,
    apiKey: string
  ): Promise<void> {
    // API keys don't expire, so we set a far future date
    const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    await this.tokenStorage.saveUserSession({
      teamsUserId,
      teamsTenantId: '', // Not used for API key auth
      odooUserId,
      odooUsername,
      tokens: {
        accessToken: apiKey,
        refreshToken: '',
        expiresAt: oneYearFromNow,
        scope: 'read write',
        tokenType: 'api_key'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    logger.info('API key stored for user', { teamsUserId, odooUsername });
  }

  /**
   * Get API key for a user
   */
  async getApiKey(teamsUserId: string): Promise<string | null> {
    const session = await this.tokenStorage.getUserSession(teamsUserId);
    if (!session) {
      return null;
    }
    return session.tokens.accessToken;
  }

  /**
   * Get full session for a user
   */
  async getSession(teamsUserId: string): Promise<ApiKeySession | null> {
    const session = await this.tokenStorage.getUserSession(teamsUserId);
    if (!session) {
      return null;
    }

    return {
      teamsUserId: session.teamsUserId,
      odooUsername: session.odooUsername,
      odooUserId: session.odooUserId,
      apiKey: session.tokens.accessToken,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  }

  /**
   * Check if user has a valid API key
   */
  async isAuthenticated(teamsUserId: string): Promise<boolean> {
    const session = await this.tokenStorage.getUserSession(teamsUserId);
    return !!session && !!session.tokens.accessToken;
  }

  /**
   * Revoke API key for a user
   */
  async revokeAuth(teamsUserId: string): Promise<void> {
    await this.tokenStorage.deleteUserSession(teamsUserId);
    logger.info('API key revoked for user', { teamsUserId });
  }

  /**
   * Validate API key by testing authentication with Odoo
   */
  async validateApiKey(
    apiKey: string,
    odooUrl: string,
    db: string,
    username: string
  ): Promise<{ valid: boolean; userId?: number; error?: string }> {
    const xmlrpc = await import('xmlrpc');
    const url = new URL(odooUrl);
    const isSecure = url.protocol === 'https:';
    const port = parseInt(url.port || (isSecure ? '443' : '80'));

    const clientOptions = {
      host: url.hostname,
      port: port,
      path: '/xmlrpc/2/common'
    };

    const client = isSecure
      ? xmlrpc.createSecureClient(clientOptions)
      : xmlrpc.createClient(clientOptions);

    return new Promise((resolve) => {
      client.methodCall(
        'authenticate',
        [db, username, apiKey, {}],
        (error: any, uid: number) => {
          if (error) {
            resolve({ valid: false, error: error.message });
            return;
          }

          if (!uid) {
            resolve({ valid: false, error: 'Invalid API key' });
            return;
          }

          resolve({ valid: true, userId: uid });
        }
      );
    });
  }
}
