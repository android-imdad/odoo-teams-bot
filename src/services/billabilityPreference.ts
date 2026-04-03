import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { logger } from '../config/logger';
import path from 'path';
import fs from 'fs';

export type BillabilityPreference = 'billable' | 'non-billable' | 'unset';

/**
 * BillabilityPreferenceService - Stores per-user default billability preference.
 *
 * Uses SQLite for persistence (survives restarts/redeploys) with an in-memory
 * cache for fast reads. The DB file lives in the data/ directory alongside
 * tokens.db.
 */
export class BillabilityPreferenceService {
  private cache: Map<string, BillabilityPreference> = new Map();
  private db: Database<sqlite3.Database> | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'billability.db');
  }

  async initialize(): Promise<void> {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS billability_preferences (
          teams_user_id TEXT PRIMARY KEY,
          preference TEXT NOT NULL CHECK (preference IN ('billable', 'non-billable')),
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Warm the in-memory cache from disk
      const rows = await this.db.all('SELECT teams_user_id, preference FROM billability_preferences');
      for (const row of rows) {
        this.cache.set(row.teams_user_id, row.preference as BillabilityPreference);
      }

      logger.info('BillabilityPreferenceService initialized', {
        dbPath: this.dbPath,
        loadedPreferences: rows.length
      });
    } catch (error) {
      logger.error('Failed to initialize BillabilityPreferenceService', { error });
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async setPreference(userId: string, preference: BillabilityPreference): Promise<void> {
    this.cache.set(userId, preference);

    if (this.db) {
      await this.db.run(
        `INSERT INTO billability_preferences (teams_user_id, preference, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(teams_user_id) DO UPDATE SET preference = excluded.preference, updated_at = CURRENT_TIMESTAMP`,
        [userId, preference]
      );
    }

    logger.info('Billability preference updated', { userId, preference });
  }

  async getPreference(userId: string): Promise<BillabilityPreference> {
    return this.cache.get(userId) || 'unset';
  }

  async hasPreference(userId: string): Promise<boolean> {
    return this.cache.has(userId);
  }

  async clearPreference(userId: string): Promise<void> {
    this.cache.delete(userId);

    if (this.db) {
      await this.db.run('DELETE FROM billability_preferences WHERE teams_user_id = ?', [userId]);
    }

    logger.info('Billability preference cleared', { userId });
  }

  static getLabel(billable: boolean | undefined): string {
    if (billable === true) return '💰 Billable';
    if (billable === false) return '🏷️ Non-Billable';
    return '⚪ Not Set';
  }

  static toBillableBoolean(preference: BillabilityPreference): boolean | undefined {
    if (preference === 'billable') return true;
    if (preference === 'non-billable') return false;
    return undefined;
  }
}
