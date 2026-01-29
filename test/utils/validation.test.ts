/**
 * Tests for validation utilities
 */

import { Validator } from '../../src/utils/validation';
import { TimesheetCardData } from '../../src/types/bot.types';

describe('Validator', () => {
  describe('validateTimesheetData', () => {
    const validData: TimesheetCardData = {
      project_id: 123,
      project_name: 'Test Project',
      hours: 4.5,
      date: '2024-01-15',
      description: 'Test description'
    };

    it('should validate correct timesheet data', () => {
      const result = Validator.validateTimesheetData(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid project_id', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        project_id: undefined as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid project ID');
    });

    it('should reject non-number project_id', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        project_id: '123' as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid project ID');
    });

    it('should reject invalid project_name', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        project_name: '' as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid project name');
    });

    it('should reject non-string project_name', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        project_name: 123 as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid project name');
    });

    it('should reject zero hours', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        hours: 0
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid hours (must be greater than 0)');
    });

    it('should reject negative hours', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        hours: -2
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid hours (must be greater than 0)');
    });

    it('should reject non-number hours', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        hours: '4.5' as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid hours (must be greater than 0)');
    });

    it('should reject invalid date format', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        date: '01/15/2024'
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid date format (expected YYYY-MM-DD)');
    });

    it('should reject invalid date', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        date: '2024-13-01'
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid date format (expected YYYY-MM-DD)');
    });

    it('should reject empty description', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        description: '' as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid description');
    });

    it('should reject non-string description', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        description: 123 as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid description');
    });

    it('should return multiple errors for multiple invalid fields', () => {
      const result = Validator.validateTimesheetData({
        project_id: undefined as any,
        project_name: 123 as any,
        hours: -1,
        date: 'invalid',
        description: '' as any
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should accept valid leap year date', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        date: '2024-02-29'
      });
      expect(result.valid).toBe(true);
    });

    it('should accept edge case of 1 hour', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        hours: 1
      });
      expect(result.valid).toBe(true);
    });

    it('should accept decimal hours', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        hours: 2.25
      });
      expect(result.valid).toBe(true);
    });

    it('should accept large project_id', () => {
      const result = Validator.validateTimesheetData({
        ...validData,
        project_id: 999999
      });
      expect(result.valid).toBe(true);
    });
  });
});
