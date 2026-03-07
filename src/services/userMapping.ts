import { logger } from '../config/logger';
import { Cache } from './cache';

export interface OdooUserInfo {
  id: number;
  login: string;
  name: string;
  email: string;
  partner_id?: number;
}

export interface UserMapping {
  teamsUserId: string;
  teamsEmail: string;
  odooUserId: number;
  odooUsername: string;
  odooName: string;
  lastVerified: Date;
}

/**
 * Service to map Teams users to Odoo users via email lookup
 * Uses an admin service account to search res.users by email
 */
export class UserMappingService {
  private userCache: Cache<OdooUserInfo>;
  private failedLookups: Cache<boolean>; // Track failed lookups to avoid repeated attempts

  constructor(
    private executeKw: (model: string, method: string, params: any[]) => Promise<any>,
    _cacheTtl: number = 3600000 // 1 hour default - passed from config
  ) {
    this.userCache = new Cache<OdooUserInfo>();
    this.userCache.startCleanup();
    this.failedLookups = new Cache<boolean>();
    this.failedLookups.startCleanup();

    logger.info('UserMappingService initialized');
  }

  /**
   * Look up an Odoo user by email address
   * Searches res.users model where login = email
   */
  async lookupUserByEmail(email: string): Promise<OdooUserInfo | null> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check cache first
    const cached = this.userCache.get(normalizedEmail);
    if (cached) {
      logger.debug('User found in cache', { email: normalizedEmail, userId: cached.id });
      return cached;
    }

    // Check if we've recently failed to find this user
    const recentFailure = this.failedLookups.get(normalizedEmail);
    if (recentFailure) {
      logger.debug('Skipping lookup for recently failed email', { email: normalizedEmail });
      return null;
    }

    try {
      logger.info('Looking up Odoo user by email', { email: normalizedEmail });

      // Search for user in res.users where login matches the email
      const userIds = await this.executeKw(
        'res.users',
        'search',
        [[['login', '=ilike', normalizedEmail], ['active', '=', true]]]
      );

      if (!userIds || userIds.length === 0) {
        logger.warn('No Odoo user found with email', { email: normalizedEmail });
        // Cache the failure briefly (5 minutes) to avoid hammering Odoo
        this.failedLookups.set(normalizedEmail, true, 300000);
        return null;
      }

      if (userIds.length > 1) {
        logger.warn('Multiple Odoo users found with same email, using first', {
          email: normalizedEmail,
          count: userIds.length
        });
      }

      // Get user details
      const users = await this.executeKw(
        'res.users',
        'read',
        [userIds, ['id', 'login', 'name', 'partner_id', 'email']]
      );

      const user = users[0];
      const userInfo: OdooUserInfo = {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email || user.login,
        partner_id: user.partner_id ? user.partner_id[0] : undefined
      };

      // Cache the result
      this.userCache.set(normalizedEmail, userInfo, 3600000);

      logger.info('Odoo user found', {
        email: normalizedEmail,
        userId: userInfo.id,
        name: userInfo.name
      });

      return userInfo;

    } catch (error) {
      logger.error('Failed to look up Odoo user by email', { email: normalizedEmail, error });
      return null;
    }
  }

  /**
   * Get user info from cache if available
   */
  getCachedUser(email: string): OdooUserInfo | null {
    return this.userCache.get(email.toLowerCase().trim()) || null;
  }

  /**
   * Clear user from cache (useful if user info changes in Odoo)
   */
  clearUserCache(email: string): void {
    this.userCache.delete(email.toLowerCase().trim());
    this.failedLookups.delete(email.toLowerCase().trim());
    logger.debug('User cache cleared', { email });
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.userCache.clear();
    this.failedLookups.clear();
    logger.info('All user mapping caches cleared');
  }

  /**
   * Pre-populate cache with known user mappings
   * Useful for bulk loading during startup
   */
  preloadMappings(mappings: Map<string, OdooUserInfo>): void {
    for (const [email, userInfo] of mappings.entries()) {
      this.userCache.set(email.toLowerCase().trim(), userInfo, 3600000);
    }
    logger.info('Preloaded user mappings', { count: mappings.size });
  }
}
