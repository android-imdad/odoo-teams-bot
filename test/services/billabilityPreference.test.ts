/**
 * Tests for BillabilityPreferenceService
 */

import { BillabilityPreferenceService } from '../../src/services/billabilityPreference';

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

  beforeEach(() => {
    service = new BillabilityPreferenceService();
  });

  describe('setPreference', () => {
    it('should set billable preference for a user', () => {
      service.setPreference('user-1', 'billable');
      expect(service.getPreference('user-1')).toBe('billable');
    });

    it('should set non-billable preference for a user', () => {
      service.setPreference('user-1', 'non-billable');
      expect(service.getPreference('user-1')).toBe('non-billable');
    });

    it('should overwrite existing preference', () => {
      service.setPreference('user-1', 'billable');
      expect(service.getPreference('user-1')).toBe('billable');

      service.setPreference('user-1', 'non-billable');
      expect(service.getPreference('user-1')).toBe('non-billable');
    });

    it('should handle multiple users independently', () => {
      service.setPreference('user-1', 'billable');
      service.setPreference('user-2', 'non-billable');

      expect(service.getPreference('user-1')).toBe('billable');
      expect(service.getPreference('user-2')).toBe('non-billable');
    });
  });

  describe('getPreference', () => {
    it('should return "unset" for unknown user', () => {
      expect(service.getPreference('unknown-user')).toBe('unset');
    });

    it('should return the set preference', () => {
      service.setPreference('user-1', 'billable');
      expect(service.getPreference('user-1')).toBe('billable');
    });
  });

  describe('hasPreference', () => {
    it('should return false for unknown user', () => {
      expect(service.hasPreference('unknown-user')).toBe(false);
    });

    it('should return true after setting preference', () => {
      service.setPreference('user-1', 'billable');
      expect(service.hasPreference('user-1')).toBe(true);
    });

    it('should return false after clearing preference', () => {
      service.setPreference('user-1', 'billable');
      service.clearPreference('user-1');
      expect(service.hasPreference('user-1')).toBe(false);
    });
  });

  describe('clearPreference', () => {
    it('should clear an existing preference', () => {
      service.setPreference('user-1', 'billable');
      service.clearPreference('user-1');
      expect(service.getPreference('user-1')).toBe('unset');
    });

    it('should not throw when clearing non-existent preference', () => {
      expect(() => service.clearPreference('unknown-user')).not.toThrow();
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
    it('should support the full preference lifecycle', () => {
      const userId = 'lifecycle-user';

      // Initially unset
      expect(service.getPreference(userId)).toBe('unset');
      expect(service.hasPreference(userId)).toBe(false);

      // Set to billable
      service.setPreference(userId, 'billable');
      expect(service.getPreference(userId)).toBe('billable');
      expect(service.hasPreference(userId)).toBe(true);

      // Change to non-billable
      service.setPreference(userId, 'non-billable');
      expect(service.getPreference(userId)).toBe('non-billable');

      // Clear
      service.clearPreference(userId);
      expect(service.getPreference(userId)).toBe('unset');
      expect(service.hasPreference(userId)).toBe(false);
    });
  });
});
