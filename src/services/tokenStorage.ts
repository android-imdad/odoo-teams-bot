import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import crypto from 'crypto';
import { logger } from '../config/logger';
import {
  UserAuthSession,
  PendingAuthState,
  TokenStorageConfig
} from '../types/oauth.types';

export class TokenStorageService {
  private db: Database<sqlite3.Database> | null = null;
  private encryptionKey: Buffer;
  private config: TokenStorageConfig;

  constructor(config: TokenStorageConfig) {
    this.config = config;
    // Derive a 32-byte key from the provided encryption key using PBKDF2
    this.encryptionKey = crypto.pbkdf2Sync(
      config.encryptionKey,
      'odoo-bot-salt',
      100000,
      32,
      'sha256'
    );
  }

  /**
   * Initialize the database connection and create tables
   */
  async initialize(): Promise<void> {
    try {
      this.db = await open({
        filename: this.config.dbPath,
        driver: sqlite3.Database
      });

      await this.initializeDatabase();
      logger.info('TokenStorageService initialized', { dbPath: this.config.dbPath });
    } catch (error) {
      logger.error('Failed to initialize TokenStorageService', { error });
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      logger.info('TokenStorageService closed');
    }
  }

  /**
   * Create database tables
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // User authentication sessions table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        teams_user_id TEXT PRIMARY KEY,
        teams_tenant_id TEXT NOT NULL,
        odoo_user_id INTEGER NOT NULL,
        odoo_username TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        scope TEXT NOT NULL,
        token_type TEXT NOT NULL DEFAULT 'Bearer',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Pending OAuth states table (temporary)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_auth_states (
        state TEXT PRIMARY KEY,
        teams_user_id TEXT NOT NULL,
        conversation_reference TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for cleanup of expired states
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_expires_at ON pending_auth_states(expires_at)
    `);

    // Create index for querying sessions expiring soon
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_expires_at_sessions ON user_sessions(expires_at)
    `);

    logger.debug('Database tables initialized');
  }

  /**
   * Save or update a user authentication session
   */
  async saveUserSession(session: UserAuthSession): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const encryptedAccessToken = this.encrypt(session.tokens.accessToken);
      const encryptedRefreshToken = this.encrypt(session.tokens.refreshToken);

      await this.db.run(
        `
        INSERT INTO user_sessions (
          teams_user_id, teams_tenant_id, odoo_user_id, odoo_username,
          access_token, refresh_token, expires_at, scope, token_type, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(teams_user_id) DO UPDATE SET
          teams_tenant_id = excluded.teams_tenant_id,
          odoo_user_id = excluded.odoo_user_id,
          odoo_username = excluded.odoo_username,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at,
          scope = excluded.scope,
          token_type = excluded.token_type,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          session.teamsUserId,
          session.teamsTenantId,
          session.odooUserId,
          session.odooUsername,
          encryptedAccessToken,
          encryptedRefreshToken,
          session.tokens.expiresAt,
          session.tokens.scope,
          session.tokens.tokenType
        ]
      );

      logger.debug('User session saved', { teamsUserId: session.teamsUserId });
    } catch (error) {
      logger.error('Failed to save user session', { teamsUserId: session.teamsUserId, error });
      throw error;
    }
  }

  /**
   * Get a user authentication session by Teams user ID
   */
  async getUserSession(teamsUserId: string): Promise<UserAuthSession | null> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const row = await this.db.get(
        'SELECT * FROM user_sessions WHERE teams_user_id = ?',
        [teamsUserId]
      );

      if (!row) {
        return null;
      }

      return this.mapRowToSession(row);
    } catch (error) {
      logger.error('Failed to get user session', { teamsUserId, error });
      throw error;
    }
  }

  /**
   * Delete a user session (logout)
   */
  async deleteUserSession(teamsUserId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      await this.db.run(
        'DELETE FROM user_sessions WHERE teams_user_id = ?',
        [teamsUserId]
      );

      logger.info('User session deleted', { teamsUserId });
    } catch (error) {
      logger.error('Failed to delete user session', { teamsUserId, error });
      throw error;
    }
  }

  /**
   * Check if a user has an active session
   */
  async hasSession(teamsUserId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const row = await this.db.get(
        'SELECT 1 FROM user_sessions WHERE teams_user_id = ? AND expires_at > ?',
        [teamsUserId, Math.floor(Date.now() / 1000)]
      );

      return !!row;
    } catch (error) {
      logger.error('Failed to check session', { teamsUserId, error });
      return false;
    }
  }

  /**
   * Save a pending OAuth state (for CSRF protection)
   */
  async savePendingState(state: PendingAuthState): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      await this.db.run(
        `
        INSERT INTO pending_auth_states (state, teams_user_id, conversation_reference, expires_at)
        VALUES (?, ?, ?, ?)
        `,
        [state.state, state.teamsUserId, state.conversationReference, state.expiresAt]
      );

      logger.debug('Pending state saved', { state: state.state });
    } catch (error) {
      logger.error('Failed to save pending state', { state: state.state, error });
      throw error;
    }
  }

  /**
   * Get and delete a pending OAuth state (one-time use)
   */
  async getPendingState(state: string): Promise<PendingAuthState | null> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      // Get the state
      const row = await this.db.get(
        'SELECT * FROM pending_auth_states WHERE state = ?',
        [state]
      );

      if (!row) {
        return null;
      }

      // Delete it immediately (one-time use)
      await this.db.run(
        'DELETE FROM pending_auth_states WHERE state = ?',
        [state]
      );

      // Check if expired
      if (row.expires_at < Math.floor(Date.now() / 1000)) {
        logger.warn('Pending state expired', { state });
        return null;
      }

      return {
        state: row.state,
        teamsUserId: row.teams_user_id,
        conversationReference: row.conversation_reference,
        expiresAt: row.expires_at
      };
    } catch (error) {
      logger.error('Failed to get pending state', { state, error });
      throw error;
    }
  }

  /**
   * Get all sessions that will expire within the given time window
   */
  async getExpiringSessions(withinSeconds: number): Promise<UserAuthSession[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const cutoff = Math.floor(Date.now() / 1000) + withinSeconds;

      const rows = await this.db.all(
        'SELECT * FROM user_sessions WHERE expires_at < ?',
        [cutoff]
      );

      return rows.map((row: any) => this.mapRowToSession(row));
    } catch (error) {
      logger.error('Failed to get expiring sessions', { error });
      throw error;
    }
  }

  /**
   * Clean up expired pending states
   */
  async cleanupExpiredStates(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const now = Math.floor(Date.now() / 1000);
      const result = await this.db.run(
        'DELETE FROM pending_auth_states WHERE expires_at < ?',
        [now]
      );

      const deleted = result.changes || 0;
      if (deleted > 0) {
        logger.debug('Cleaned up expired pending states', { count: deleted });
      }

      return deleted;
    } catch (error) {
      logger.error('Failed to cleanup expired states', { error });
      throw error;
    }
  }

  /**
   * Map database row to UserAuthSession
   */
  private mapRowToSession(row: any): UserAuthSession {
    return {
      teamsUserId: row.teams_user_id,
      teamsTenantId: row.teams_tenant_id,
      odooUserId: row.odoo_user_id,
      odooUsername: row.odoo_username,
      tokens: {
        accessToken: this.decrypt(row.access_token),
        refreshToken: this.decrypt(row.refresh_token),
        expiresAt: row.expires_at,
        scope: row.scope,
        tokenType: row.token_type
      },
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Encrypt text using AES-256-GCM
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Store IV + authTag + encrypted data
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt text using AES-256-GCM
   */
  private decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
