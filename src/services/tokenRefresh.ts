import { logger } from '../config/logger';
import { OAuthService } from './oauth';
import { TokenStorageService } from './tokenStorage';

export class TokenRefreshJob {
  private oauthService: OAuthService;
  private tokenStorage: TokenStorageService;
  private intervalId?: NodeJS.Timeout;
  private readonly checkIntervalMs: number;
  private readonly refreshWindowSeconds: number;

  constructor(
    oauthService: OAuthService,
    tokenStorage: TokenStorageService,
    checkIntervalMinutes: number = 5,
    refreshWindowMinutes: number = 10
  ) {
    this.oauthService = oauthService;
    this.tokenStorage = tokenStorage;
    this.checkIntervalMs = checkIntervalMinutes * 60 * 1000;
    this.refreshWindowSeconds = refreshWindowMinutes * 60;
  }

  /**
   * Start the token refresh job
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('TokenRefreshJob already running');
      return;
    }

    logger.info('Starting TokenRefreshJob', {
      checkIntervalMinutes: this.checkIntervalMs / 60000,
      refreshWindowMinutes: this.refreshWindowSeconds / 60
    });

    // Run immediately on start
    this.refreshExpiringTokens();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.refreshExpiringTokens();
    }, this.checkIntervalMs);

    // Also clean up expired pending states
    setInterval(() => {
      this.cleanupExpiredStates();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the token refresh job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('TokenRefreshJob stopped');
    }
  }

  /**
   * Refresh all tokens that are expiring soon
   */
  private async refreshExpiringTokens(): Promise<void> {
    try {
      logger.debug('Checking for expiring tokens');

      const sessions = await this.tokenStorage.getExpiringSessions(this.refreshWindowSeconds);

      if (sessions.length === 0) {
        return;
      }

      logger.info(`Found ${sessions.length} sessions with expiring tokens`);

      for (const session of sessions) {
        try {
          // This will refresh the token if needed
          await this.oauthService.getAccessToken(session.teamsUserId);
        } catch (error) {
          logger.error('Failed to refresh token for user', {
            teamsUserId: session.teamsUserId,
            error
          });

          // If refresh failed, the session may be invalid - delete it
          if (this.isTokenError(error)) {
            await this.tokenStorage.deleteUserSession(session.teamsUserId);
            logger.info('Deleted invalid session', { teamsUserId: session.teamsUserId });
          }
        }
      }
    } catch (error) {
      logger.error('Token refresh job failed', { error });
    }
  }

  /**
   * Clean up expired pending auth states
   */
  private async cleanupExpiredStates(): Promise<void> {
    try {
      const deleted = await this.tokenStorage.cleanupExpiredStates();
      if (deleted > 0) {
        logger.debug('Cleaned up expired pending states', { count: deleted });
      }
    } catch (error) {
      logger.error('Failed to cleanup expired states', { error });
    }
  }

  /**
   * Check if error indicates token is invalid
   */
  private isTokenError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    return (
      errorMessage.includes('invalid_grant') ||
      errorMessage.includes('invalid_token') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('token expired') ||
      error.name === 'TokenExpiredError'
    );
  }
}
