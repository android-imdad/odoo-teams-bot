/**
 * Tests for input sanitization utilities
 */

import {
  sanitizeString,
  escapeHTML,
  sanitizeProjectName,
  sanitizeDescription,
  sanitizeNumber,
  sanitizeDate,
  sanitizeUserId,
  sanitizeEmail,
  sanitizeTimesheetInput,
  sanitizeSQL
} from '../../src/utils/sanitization';

describe('sanitizeString', () => {
  it('should remove null bytes', () => {
    const input = 'hello\x00world';
    expect(sanitizeString(input)).toBe('helloworld');
  });

  it('should escape HTML by default', () => {
    const input = '<script>alert("xss")</script>';
    expect(sanitizeString(input)).not.toContain('<script>');
  });

  it('should preserve HTML when allowed', () => {
    const input = '<div>content</div>';
    expect(sanitizeString(input, { allowHTML: true })).toBe('<div>content</div>');
  });

  it('should truncate to max length', () => {
    const input = 'a'.repeat(100);
    expect(sanitizeString(input, { maxLength: 50 }).length).toBe(50);
  });

  it('should handle non-string input', () => {
    expect(sanitizeString(null as any)).toBe('');
    expect(sanitizeString(undefined as any)).toBe('');
    expect(sanitizeString(123 as any)).toBe('');
  });
});

describe('escapeHTML', () => {
  it('should escape HTML entities', () => {
    expect(escapeHTML('<div>')).toBe('&lt;div&gt;');
    expect(escapeHTML('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHTML("'hello'")).toBe('&#x27;hello&#x27;');
    expect(escapeHTML('&')).toBe('&amp;');
  });
});

describe('sanitizeProjectName', () => {
  it('should remove special characters', () => {
    expect(sanitizeProjectName('Project@#$123')).toBe('Project123');
  });

  it('should keep alphanumeric, spaces, hyphens, and underscores', () => {
    expect(sanitizeProjectName('Project-Name_123')).toBe('Project-Name_123');
  });

  it('should enforce max length', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeProjectName(long).length).toBe(255);
  });
});

describe('sanitizeDescription', () => {
  it('should escape HTML', () => {
    const input = '<script>alert("xss")</script>';
    expect(sanitizeDescription(input)).not.toContain('<script>');
  });
});

describe('sanitizeNumber', () => {
  it('should parse valid numbers', () => {
    expect(sanitizeNumber('5.5')).toBe(5.5);
    expect(sanitizeNumber(10)).toBe(10);
  });

  it('should enforce min/max bounds', () => {
    expect(sanitizeNumber(30, 0, 24)).toBe(24);
    expect(sanitizeNumber(-5, 0, 24)).toBe(0);
  });

  it('should return 0 for invalid input', () => {
    expect(sanitizeNumber('invalid')).toBe(0);
    expect(sanitizeNumber(null as any)).toBe(0);
  });
});

describe('sanitizeDate', () => {
  it('should accept valid dates', () => {
    expect(sanitizeDate('2024-01-15')).toBe('2024-01-15');
  });

  it('should reject invalid format', () => {
    expect(sanitizeDate('01/15/2024')).toBeNull();
    expect(sanitizeDate('2024-13-01')).toBeNull();
  });

  it('should reject dates outside reasonable bounds', () => {
    expect(sanitizeDate('2020-12-31')).toBeNull();
    expect(sanitizeDate('2030-01-01')).toBeNull();
  });
});

describe('sanitizeUserId', () => {
  it('should validate GUID format', () => {
    const validGuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(sanitizeUserId(validGuid)).toBe(validGuid);
  });

  it('should reject invalid GUIDs', () => {
    expect(sanitizeUserId('not-a-guid')).toBe('');
  });
});

describe('sanitizeEmail', () => {
  it('should accept valid emails', () => {
    expect(sanitizeEmail('test@example.com')).toBe('test@example.com');
  });

  it('should reject invalid emails', () => {
    expect(sanitizeEmail('not-an-email')).toBe('');
    expect(sanitizeEmail('@example.com')).toBe('');
  });

  it('should convert to lowercase', () => {
    expect(sanitizeEmail('Test@Example.COM')).toBe('test@example.com');
  });
});

describe('sanitizeTimesheetInput', () => {
  it('should sanitize all fields', () => {
    const input = {
      project_id: '123',
      project_name: 'Project<script>',
      hours: '8.5',
      date: '2024-01-15',
      description: '<script>alert("xss")</script> Work done',
      user_id: 'invalid-guid'
    };

    const result = sanitizeTimesheetInput(input);

    expect(result.project_id).toBe(123);
    expect(result.project_name).not.toContain('<script>');
    expect(result.hours).toBe(8.5);
    expect(result.date).toBe('2024-01-15');
    expect(result.description).not.toContain('<script>');
    expect(result.user_id).toBeUndefined();
  });
});

describe('sanitizeSQL', () => {
  it('should remove SQL injection patterns', () => {
    expect(sanitizeSQL("'; DROP TABLE users; --")).not.toContain('DROP');
    expect(sanitizeSQL("1' OR '1'='1")).not.toContain('OR');
    expect(sanitizeSQL("'; SELECT * FROM users; --")).not.toContain('SELECT');
  });
});
