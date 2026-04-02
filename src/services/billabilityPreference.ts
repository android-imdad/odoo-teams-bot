import { logger } from '../config/logger';

export type BillabilityPreference = 'billable' | 'non-billable' | 'unset';

interface PreferenceEntry {
  preference: BillabilityPreference;
  updatedAt: number;
}

/**
 * BillabilityPreferenceService - Stores per-user default billability preference.
 *
 * Users can set a default billability preference once, and all subsequent
 * timesheets will use that setting unless explicitly overridden in the prompt.
 *
 * Storage: In-memory Map (matches existing caching pattern in the codebase).
 * Preferences persist for the lifetime of the bot process.
 */
export class BillabilityPreferenceService {
  private preferences: Map<string, PreferenceEntry> = new Map();

  /**
   * Set the default billability preference for a user
   */
  setPreference(userId: string, preference: BillabilityPreference): void {
    this.preferences.set(userId, {
      preference,
      updatedAt: Date.now()
    });
    logger.info('Billability preference updated', { userId, preference });
  }

  /**
   * Get the default billability preference for a user
   * Returns 'unset' if no preference has been configured
   */
  getPreference(userId: string): BillabilityPreference {
    const entry = this.preferences.get(userId);
    return entry?.preference || 'unset';
  }

  /**
   * Check if a user has set a billability preference
   */
  hasPreference(userId: string): boolean {
    return this.preferences.has(userId);
  }

  /**
   * Clear a user's billability preference
   */
  clearPreference(userId: string): void {
    this.preferences.delete(userId);
    logger.info('Billability preference cleared', { userId });
  }

  /**
   * Get human-readable label for a billability value
   */
  static getLabel(billable: boolean | undefined): string {
    if (billable === true) return '💰 Billable';
    if (billable === false) return '🏷️ Non-Billable';
    return '⚪ Not Set';
  }

  /**
   * Convert preference to boolean (for Odoo field)
   * Returns undefined if preference is 'unset'
   */
  static toBillableBoolean(preference: BillabilityPreference): boolean | undefined {
    if (preference === 'billable') return true;
    if (preference === 'non-billable') return false;
    return undefined;
  }
}
