/**
 * Input sanitization utilities to prevent injection attacks and ensure data integrity.
 * Handles XSS, SQL injection, and other common attack vectors.
 */

/**
 * Sanitize a string by removing potentially dangerous characters
 */
export function sanitizeString(input: string, options: {
  maxLength?: number;
  allowHTML?: boolean;
  allowSpecialChars?: boolean;
} = {}): string {
  const {
    maxLength = 10000,
    allowHTML = false,
    allowSpecialChars = true
  } = options;

  if (typeof input !== 'string') {
    return '';
  }

  let sanitized = input.trim();

  // Apply length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove control characters (except newline, tab, carriage return)
  if (!allowSpecialChars) {
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  // Escape HTML entities if not allowing HTML
  if (!allowHTML) {
    sanitized = escapeHTML(sanitized);
  }

  return sanitized;
}

/**
 * Escape HTML entities to prevent XSS attacks
 */
export function escapeHTML(input: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  return input.replace(/[&<>"'/]/g, (char) => htmlEntities[char]);
}

/**
 * Sanitize project name/code to prevent path traversal and injection
 */
export function sanitizeProjectName(input: string): string {
  const sanitized = sanitizeString(input, {
    maxLength: 255,
    allowHTML: false,
    allowSpecialChars: false
  });

  // Remove any characters that aren't alphanumeric, spaces, hyphens, or underscores
  return sanitized.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
}

/**
 * Sanitize description text while preserving formatting
 */
export function sanitizeDescription(input: string): string {
  return sanitizeString(input, {
    maxLength: 10000,
    allowHTML: false,
    allowSpecialChars: true
  });
}

/**
 * Sanitize numeric input to prevent code injection
 */
export function sanitizeNumber(input: any, min: number = 0, max: number = 24): number {
  const num = parseFloat(input);

  if (isNaN(num)) {
    return 0;
  }

  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitize date string (YYYY-MM-DD format)
 */
export function sanitizeDate(input: string): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  // Remove any non-date characters
  const sanitized = input.replace(/[^\d-]/g, '');

  // Validate format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(sanitized)) {
    return null;
  }

  // Validate it's a real date
  const date = new Date(sanitized);
  if (isNaN(date.getTime())) {
    return null;
  }

  // Ensure date is within reasonable bounds (allow dates from 2021-01-01 to 2029-12-31)
  // Using ISO dates to avoid timezone issues
  const minDate = new Date('2021-01-01T00:00:00.000Z');
  const maxDate = new Date('2029-12-31T23:59:59.999Z');

  if (date.getTime() < minDate.getTime() || date.getTime() > maxDate.getTime()) {
    return null;
  }

  return sanitized;
}

/**
 * Sanitize user ID (for Teams AAD Object ID)
 */
export function sanitizeUserId(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove any characters that aren't hex, digits, or hyphens
  const sanitized = input.replace(/[^a-fA-F0-9-]/g, '');

  // Validate GUID format (basic check)
  const guidRegex = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
  if (!guidRegex.test(sanitized)) {
    return '';
  }

  return sanitized;
}

/**
 * Sanitize email address
 */
export function sanitizeEmail(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  const sanitized = input.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(sanitized)) {
    return '';
  }

  return sanitized.substring(0, 254); // RFC 5321 max length
}

/**
 * Deep sanitize an object by sanitizing all string properties
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  options: { maxLength?: number; allowHTML?: boolean } = {}
): T {
  const sanitized = { ...obj };

  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeString(sanitized[key], options) as any;
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key], options);
    }
  }

  return sanitized;
}

/**
 * Validate and sanitize timesheet input data
 */
export function sanitizeTimesheetInput(data: {
  project_id?: any;
  project_name?: string;
  hours?: any;
  date?: string;
  description?: string;
  user_id?: string;
}): {
  project_id?: number;
  project_name?: string;
  hours?: number;
  date?: string;
  description?: string;
  user_id?: string;
} {
  const result: any = {};

  if (data.project_id !== undefined) {
    const pid = parseInt(data.project_id, 10);
    if (!isNaN(pid) && pid > 0) {
      result.project_id = pid;
    }
  }

  if (data.project_name) {
    result.project_name = sanitizeProjectName(data.project_name);
  }

  if (data.hours !== undefined) {
    result.hours = sanitizeNumber(data.hours, 0.25, 24);
  }

  if (data.date) {
    result.date = sanitizeDate(data.date) || undefined;
  }

  if (data.description) {
    result.description = sanitizeDescription(data.description);
  }

  if (data.user_id) {
    result.user_id = sanitizeUserId(data.user_id) || undefined;
  }

  return result;
}

/**
 * Remove SQL injection patterns from strings
 */
export function sanitizeSQL(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  const sqlPatterns = [
    // SQL keywords (with or without word boundaries)
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT|TRUNCATE)\b/gi,
    // SQL operators and delimiters
    /(;|--|\/\*|\*\/|@@|@)/g,
    // OR and AND operators (with word boundaries to avoid partial matches)
    /\s+(OR|AND)\s+/gi,
    // Comment patterns
    /('.*--)/g,
    /(\|.*\|)/g,
    // Common injection patterns
    /('OR')/gi,
    /('AND')/gi,
    /(OR\s*')/gi,
    /(AND\s*')/gi
  ];

  let sanitized = input;
  for (const pattern of sqlPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }

  return sanitized.trim();
}

/**
 * Sanitize log data to prevent log injection attacks
 */
export function sanitizeLogData(data: any): any {
  if (typeof data === 'string') {
    // Remove newlines and other log injection characters
    return data.replace(/[\n\r\t]/g, ' ').trim();
  }

  if (typeof data === 'object' && data !== null) {
    const sanitized: any = {};
    for (const key in data) {
      sanitized[sanitizeString(key, { maxLength: 100, allowHTML: false })] = sanitizeLogData(data[key]);
    }
    return sanitized;
  }

  return data;
}
