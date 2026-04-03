/**
 * Tests for BillabilityPreferenceService (SQLite-backed)
 */

import { BillabilityPreferenceService } from '../../src/services/billabilityPreference';
import fs from 'fs';
import path from 'path';

// Mock logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('BillabilityPreferenceService', () => {
  let service: BillabilityPreferenceService;
  const testDbPath = path.join(__dirname, '..', 'test-billability.db');

  beforeEach(async () => {
    // Clean up any leftover test DB
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    service = new BillabilityPreferenceService(testDbPath);
    await service.initialize();
  });

  afterEach(async () => {
    await service.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('setPreference', () => {
    it('should set billable preference for a user', async () => {
      await service.setPreference('user-1', 'billable');
      expect(await service.getPreference('user-1')).toBe('billable');
    });

    it('should set non-billable preference for a user', async () => {
      await service.setPreference('user-1', 'non-billable');
      expect(await service.getPreference('user-1')).toBe('non-billable');
    });

    it('should overwrite existing preference', async () => {
      await service.setPreference('user-1', 'billable');
      expect(await service.getPreference('user-1')).toBe('billable');

      await service.setPreference('user-1', 'non-billable');
      expect(await service.getPreference('user-1')).toBe('non-billable');
    });

    it('should handle multiple users independently', async () => {
      await service.setPreference('user-1', 'billable');
      await service.setPreference('user-2', 'non-billable');

      expect(await service.getPreference('user-1')).toBe('billable');
      expect(await service.getPreference('user-2')).toBe('non-billable');
    });
  });

  describe('getPreference', () => {
    it('should return "unset" for unknown user', async () => {
      expect(await service.getPreference('unknown-user')).toBe('unset');
    });

    it('should return the set preference', async () => {
      await service.setPreference('user-1', 'billable');
      expect(await service.getPreference('user-1')).toBe('billable');
    });
  });

  describe('hasPreference', () => {
    it('should return false for unknown user', async () => {
      expect(await service.hasPreference('unknown-user')).toBe(false);
    });

    it('should return true after setting preference', async () => {
      await service.setPreference('user-1', 'billable');
      expect(await service.hasPreference('user-1')).toBe(true);
    });

    it('should return false after clearing preference', async () => {
      await service.setPreference('user-1', 'billable');
      await service.clearPreference('user-1');
      expect(await service.hasPreference('user-1')).toBe(false);
    });
  });

  describe('clearPreference', () => {
    it('should clear an existing preference', async () => {
      await service.setPreference('user-1', 'billable');
      await service.clearPreference('user-1');
      expect(await service.getPreference('user-1')).toBe('unset');
    });

    it('should not throw when clearing non-existent preference', async () => {
      await expect(service.clearPreference('unknown-user')).resolves.not.toThrow();
    });
  });

  describe('persistence across restarts', () => {
    it('should persist preferences to disk and reload on new instance', async () => {
      await service.setPreference('user-1', 'billable');
      await service.setPreference('user-2', 'non-billable');
      await service.close();

      // Create a new instance pointing to same DB
      const service2 = new BillabilityPreferenceService(testDbPath);
      await service2.initialize();

      expect(await service2.getPreference('user-1')).toBe('billable');
      expect(await service2.getPreference('user-2')).toBe('non-billable');
      expect(await service2.getPreference('user-3')).toBe('unset');

      await service2.close();
    });

    it('should persist clearPreference across restarts', async () => {
      await service.setPreference('user-1', 'billable');
      await service.clearPreference('user-1');
      await service.close();

      const service2 = new BillabilityPreferenceService(testDbPath);
      await service2.initialize();

      expect(await service2.getPreference('user-1')).toBe('unset');
      await service2.close();
    });
  });

  describe('getLabel (static)', () => {
    it('should return billable label for true', () => {
      expect(BillabilityPreferenceService.getLabel(true)).toBe('💰 Billable');
    });

    it('should return non-billable label for false', () => {
      expect(BillabilityPreferenceService.getLabel(false)).toBe('🏷️ Non-Billable');
    });

    it('should return not set label for undefined', () => {
      expect(BillabilityPreferenceService.getLabel(undefined)).toBe('⚪ Not Set');
    });
  });

  describe('toBillableBoolean (static)', () => {
    it('should return true for "billable"', () => {
      expect(BillabilityPreferenceService.toBillableBoolean('billable')).toBe(true);
    });

    it('should return false for "non-billable"', () => {
      expect(BillabilityPreferenceService.toBillableBoolean('non-billable')).toBe(false);
    });

    it('should return undefined for "unset"', () => {
      expect(BillabilityPreferenceService.toBillableBoolean('unset')).toBeUndefined();
    });
  });

  describe('Integration: preference flow', () => {
    it('should support the full preference lifecycle', async () => {
      const userId = 'lifecycle-user';

      // Initially unset
      expect(await service.getPreference(userId)).toBe('unset');
      expect(await service.hasPreference(userId)).toBe(false);

      // Set to billable
      await service.setPreference(userId, 'billable');
      expect(await service.getPreference(userId)).toBe('billable');
      expect(await service.hasPreference(userId)).toBe(true);

      // Change to non-billable
      await service.setPreference(userId, 'non-billable');
      expect(await service.getPreference(userId)).toBe('non-billable');

      // Clear
      await service.clearPreference(userId);
      expect(await service.getPreference(userId)).toBe('unset');
      expect(await service.hasPreference(userId)).toBe(false);
    });
  });
});
