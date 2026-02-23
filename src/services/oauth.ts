import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { TokenStorageService } from './tokenStorage';
import {
  OAuthConfig,
  OAuthTokens,
  UserAuthSession,
  PendingAuthState,
  TokenExpiredError
} from '../types/oauth.types';

export class OAuthService {
  private config: OAuthConfig;
  private tokenStorage: TokenStorageService;

  constructor(config: OAuthConfig, tokenStorage: TokenStorageService) {
    this.config = config;
    this.tokenStorage = tokenStorage;
    logger.info('OAuthService initialized');
  }

  /**
   * Generate OAuth authorization URL for user
   */
  generateAuthUrl(teamsUserId: string, conversationReference: any): string {
    const state = uuidv4();

    // Store pending state for validation on callback
    const pendingState: PendingAuthState = {
      state,
      teamsUserId,
      conversationReference: JSON.stringify(conversationReference),
      expiresAt: Math.floor(Date.now() / 1000) + 600 // 10 minutes expiry
    };

    // Store synchronously - caller should handle errors
    this.tokenStorage.savePendingState(pendingState).catch(error => {
      logger.error('Failed to save pending state', { error, teamsUserId });
    });

    // Build authorization URL with PKCE
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      state: state,
      scope: this.config.scope,
      // PKCE parameters for security
      code_challenge: this.generateCodeChallenge(state),
      code_challenge_method: 'S256'
    });

    const authUrl = `${this.config.authorizationUrl}?${params.toString()}`;

    logger.debug('Generated OAuth authorization URL', {
      teamsUserId,
      state: state.substring(0, 8) + '...'
    });

    return authUrl;
  }

  /**
   * Handle OAuth callback - exchange code for tokens
   */
  async handleCallback(code: string, state: string): Promise<UserAuthSession> {
    // Validate state parameter
    const pendingState = await this.tokenStorage.getPendingState(state);
    if (!pendingState) {
      throw new Error('Invalid or expired state parameter');
    }

    logger.debug('Processing OAuth callback', {
      teamsUserId: pendingState.teamsUserId,
      state: state.substring(0, 8) + '...'
    });

    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(code, state);

    // Fetch user info from Odoo to get user ID
    const userInfo = await this.fetchUserInfo(tokens.accessToken);

    // Create and store session
    const session: UserAuthSession = {
      teamsUserId: pendingState.teamsUserId,
      teamsTenantId: '', // Will be populated from conversation context
      odooUserId: userInfo.userId,
      odooUsername: userInfo.username,
      tokens,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.tokenStorage.saveUserSession(session);

    logger.info('OAuth authentication successful', {
      teamsUserId: session.teamsUserId,
      odooUserId: session.odooUserId,
      odooUsername: session.odooUsername
    });

    return session;
  }

  /**
   * Get valid access token for user (refresh if needed)
   */
  async getAccessToken(teamsUserId: string): Promise<string | null> {
    const session = await this.tokenStorage.getUserSession(teamsUserId);

    if (!session) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const bufferTime = 300; // 5 minutes buffer

    // Check if token needs refresh
    if (session.tokens.expiresAt <= now + bufferTime) {
      logger.debug('Token expiring soon, refreshing', {
        teamsUserId,
        expiresAt: session.tokens.expiresAt,
        now
      });

      try {
        const newTokens = await this.refreshTokens(session.tokens.refreshToken);

        // Update session with new tokens
        session.tokens = newTokens;
        session.updatedAt = new Date();
        await this.tokenStorage.saveUserSession(session);

        logger.debug('Token refreshed successfully', { teamsUserId });
        return newTokens.accessToken;
      } catch (error) {
        logger.error('Token refresh failed', { teamsUserId, error });
        // Delete invalid session
        await this.tokenStorage.deleteUserSession(teamsUserId);
        return null;
      }
    }

    return session.tokens.accessToken;
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new TokenExpiredError(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Use new refresh token if provided
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      scope: data.scope || this.config.scope,
      tokenType: data.token_type || 'Bearer'
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string, state: string): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      // PKCE verifier
      code_verifier: state
    });

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      scope: data.scope || this.config.scope,
      tokenType: data.token_type || 'Bearer'
    };
  }

  /**
   * Fetch user info from Odoo using access token
   * Note: This assumes Odoo has an endpoint to get current user info
   */
  private async fetchUserInfo(accessToken: string): Promise<{ userId: number; username: string }> {
    // For Odoo, we need to call the XML-RPC or JSON-RPC endpoint with the OAuth token
    // The specific endpoint depends on your Odoo setup
    // Here we assume a standard Odoo JSON-RPC endpoint

    const odooUrl = new URL(this.config.tokenUrl);
    const baseUrl = `${odooUrl.protocol}//${odooUrl.host}`;

    try {
      // Try to get user info from Odoo's /web/session/get_session_info or similar
      const response = await fetch(`${baseUrl}/api/user/info`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // Fallback: decode JWT token if Odoo returns JWT
        const payload = this.decodeJwtPayload(accessToken);
        if (payload && payload.sub && payload.name) {
          return {
            userId: parseInt(payload.sub, 10),
            username: payload.name
          };
        }

        throw new Error(`Failed to fetch user info: ${response.status}`);
      }

      const data: any = await response.json();
      return {
        userId: data.user_id || data.uid,
        username: data.name || data.username || data.login
      };
    } catch (error) {
      logger.error('Failed to fetch user info', { error });

      // As a last resort, try to extract from JWT
      const payload = this.decodeJwtPayload(accessToken);
      if (payload) {
        return {
          userId: parseInt(payload.sub || payload.user_id || '0', 10),
          username: payload.name || payload.username || payload.login || 'Unknown'
        };
      }

      throw error;
    }
  }

  /**
   * Decode JWT payload without verification
   */
  private decodeJwtPayload(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  /**
   * Revoke user's authentication
   */
  async revokeAuth(teamsUserId: string): Promise<void> {
    try {
      // Optionally notify Odoo to revoke tokens
      const session = await this.tokenStorage.getUserSession(teamsUserId);
      if (session) {
        await this.revokeTokens(session.tokens.accessToken);
      }

      // Delete session from database
      await this.tokenStorage.deleteUserSession(teamsUserId);

      logger.info('User authentication revoked', { teamsUserId });
    } catch (error) {
      logger.error('Failed to revoke authentication', { teamsUserId, error });
      throw error;
    }
  }

  /**
   * Revoke tokens at the OAuth provider
   */
  private async revokeTokens(accessToken: string): Promise<void> {
    try {
      const params = new URLSearchParams({
        token: accessToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      });

      // Attempt to revoke token (Odoo may or may not support this)
      await fetch(`${this.config.tokenUrl}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
    } catch (error) {
      // Non-fatal error - token will expire anyway
      logger.debug('Token revocation attempt failed (non-critical)', { error });
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(teamsUserId: string): Promise<boolean> {
    return await this.tokenStorage.hasSession(teamsUserId);
  }

  /**
   * Get user session info
   */
  async getUserSession(teamsUserId: string): Promise<UserAuthSession | null> {
    return await this.tokenStorage.getUserSession(teamsUserId);
  }

  /**
   * Generate PKCE code challenge from code verifier
   */
  private generateCodeChallenge(verifier: string): string {
    // Simple S256 implementation
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url')
      .replace(/=/g, '');
  }
}
