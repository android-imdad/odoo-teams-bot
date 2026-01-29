/**
 * Tests for formatting utilities
 */

import { Formatter } from '../../src/utils/formatting';

describe('Formatter', () => {
  describe('formatHours', () => {
    it('should format single hour correctly', () => {
      expect(Formatter.formatHours(1)).toBe('1.00 hour');
    });

    it('should format multiple hours correctly', () => {
      expect(Formatter.formatHours(4)).toBe('4.00 hours');
    });

    it('should format decimal hours', () => {
      expect(Formatter.formatHours(4.5)).toBe('4.50 hours');
    });

    it('should format hours with 2 decimal places', () => {
      expect(Formatter.formatHours(2.25)).toBe('2.25 hours');
    });

    it('should format small decimal values', () => {
      expect(Formatter.formatHours(0.5)).toBe('0.50 hours');
    });

    it('should format large hour values', () => {
      expect(Formatter.formatHours(24)).toBe('24.00 hours');
    });

    it('should handle very precise decimals', () => {
      expect(Formatter.formatHours(3.333)).toBe('3.33 hours');
    });
  });

  describe('formatDate', () => {
    it('should format valid date string', () => {
      const result = Formatter.formatDate('2024-01-15');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should return original string for invalid date', () => {
      const result = Formatter.formatDate('invalid-date');
      expect(result).toBe('invalid-date');
    });

    it('should return original string for malformed date', () => {
      const result = Formatter.formatDate('2024-13-45');
      expect(result).toBe('2024-13-45');
    });

    it('should handle leap year dates', () => {
      const result = Formatter.formatDate('2024-02-29');
      expect(result).toBeTruthy();
    });

    it('should accept custom format string', () => {
      const result = Formatter.formatDate('2024-01-15', 'yyyy-MM-dd');
      expect(result).toBe('2024-01-15');
    });

    it('should handle empty string', () => {
      const result = Formatter.formatDate('');
      expect(result).toBe('');
    });
  });

  describe('truncate', () => {
    it('should return text as-is when under max length', () => {
      const text = 'Short text';
      expect(Formatter.truncate(text, 100)).toBe('Short text');
    });

    it('should return text as-is when exactly at max length', () => {
      const text = 'a'.repeat(100);
      expect(Formatter.truncate(text, 100).length).toBe(100);
    });

    it('should truncate and add ellipsis when over max length', () => {
      const text = 'This is a very long text that should be truncated';
      const result = Formatter.truncate(text, 20);
      expect(result).toBe('This is a very lo...');
      expect(result.length).toBe(20);
    });

    it('should use default max length of 100', () => {
      const text = 'a'.repeat(150);
      const result = Formatter.truncate(text);
      expect(result.length).toBe(100);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should handle empty string', () => {
      expect(Formatter.truncate('', 50)).toBe('');
    });

    it('should handle very short max length', () => {
      const text = 'Hello world';
      const result = Formatter.truncate(text, 5);
      expect(result).toBe('He...');
    });

    it('should not add ellipsis if text fits exactly', () => {
      const text = 'Fit';
      const result = Formatter.truncate(text, 3);
      expect(result).toBe('Fit');
    });

    it('should handle unicode characters', () => {
      const text = 'Hello 世界 🌍';
      const result = Formatter.truncate(text, 10);
      expect(result.length).toBe(10);
      expect(result.endsWith('...')).toBe(true);
    });
  });
});
