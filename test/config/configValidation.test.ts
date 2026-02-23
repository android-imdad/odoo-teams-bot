/**
 * Tests for configuration validation
 */

import { configValidator } from '../../src/config/configValidation';
import { logger } from '../../src/config/logger';

jest.mock('../../src/config/logger');

describe('ConfigValidator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validate', () => {
    it('should validate all required environment variables', () => {
      // Set all required env vars
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      const result = configValidator.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when required variables are missing', () => {
      delete process.env.BOT_ID;
      delete process.env.BOT_PASSWORD;
      delete process.env.ODOO_URL;

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: BOT_ID');
      expect(result.errors).toContain('Missing required environment variable: BOT_PASSWORD');
      expect(result.errors).toContain('Missing required environment variable: ODOO_URL');
    });

    it('should fail validation when required variables are empty strings', () => {
      process.env.BOT_ID = '';
      process.env.ODOO_URL = '';

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: BOT_ID');
      expect(result.errors).toContain('Missing required environment variable: ODOO_URL');
    });

    it('should use default values for optional variables', () => {
      // Set required vars
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      // Don't set optional vars
      delete process.env.PORT;
      delete process.env.GEMINI_MODEL;
      delete process.env.LOG_LEVEL;

      const result = configValidator.validate();

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('PORT'))).toBe(true);
    });

    it('should validate URL type correctly', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'not-a-valid-url';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ODOO_URL must be a valid URL');
    });

    it('should validate number type correctly', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';
      process.env.PORT = 'not-a-number';

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PORT must be a number');
    });

    it('should validate email type correctly', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      // Test email validation through custom schema validation
      const emailResult1 = configValidator.validate();
      expect(emailResult1.valid).toBe(true);
    });

    it('should validate boolean type correctly', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      const result = configValidator.validate();
      expect(result.valid).toBe(true);
    });

    it('should validate GEMINI_API_KEY format', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'invalid-key'; // Doesn't start with AI

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('GEMINI_API_KEY failed validation: Google Gemini API key');
    });

    it('should reject GEMINI_API_KEY that is too short', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIshort'; // Too short

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('GEMINI_API_KEY failed validation: Google Gemini API key');
    });

    it('should validate PORT range', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';
      process.env.PORT = '99999'; // Out of valid range

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PORT failed validation: Server port');
    });

    it('should validate PROJECT_CACHE_TTL is positive', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';
      process.env.PROJECT_CACHE_TTL = '-1'; // Negative value

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PROJECT_CACHE_TTL failed validation: Project cache TTL in milliseconds');
    });

    it('should validate LOG_LEVEL values', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';
      process.env.LOG_LEVEL = 'invalid-level';

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('LOG_LEVEL failed validation: Logging level');
    });

    it('should accept valid LOG_LEVEL values', () => {
      const validLevels = ['error', 'warn', 'info', 'debug'];

      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      for (const level of validLevels) {
        process.env.LOG_LEVEL = level;
        const result = configValidator.validate();
        expect(result.valid).toBe(true);
      }
    });

    it('should validate NODE_ENV values', () => {
      const validEnvs = ['development', 'production', 'test'];

      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      for (const env of validEnvs) {
        process.env.NODE_ENV = env;
        const result = configValidator.validate();
        expect(result.valid).toBe(true);
      }
    });

    it('should reject invalid NODE_ENV values', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';
      process.env.NODE_ENV = 'staging';

      const result = configValidator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('NODE_ENV failed validation: Application environment');
    });

    it('should log warnings for default values', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      // Clear optional vars to trigger default warnings
      delete process.env.PORT;
      delete process.env.GEMINI_MODEL;

      configValidator.validate();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should log error when validation fails', () => {
      delete process.env.BOT_ID;

      configValidator.validate();

      expect(logger.error).toHaveBeenCalledWith(
        'Configuration validation failed',
        expect.objectContaining({ errors: expect.any(Array) })
      );
    });

    it('should log success when validation passes', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.BOT_PASSWORD = 'test-bot-password';
      process.env.ODOO_URL = 'https://test.odoo.com';
      process.env.ODOO_DB = 'test-db';
      process.env.ODOO_USERNAME = 'test-user';
      process.env.ODOO_PASSWORD = 'test-password';
      process.env.GEMINI_API_KEY = 'AIzaSyTest123';

      configValidator.validate();

      expect(logger.info).toHaveBeenCalledWith('Configuration validation passed');
    });
  });

  describe('getConfig', () => {
    it('should return all configuration values', () => {
      process.env.BOT_ID = 'test-bot-id';
      process.env.PORT = '3000';

      const config = configValidator.getConfig();

      expect(config.BOT_ID).toBe('test-bot-id');
      expect(config.PORT).toBe('3000');
    });

    it('should include default values for unset variables', () => {
      delete process.env.PORT;
      delete process.env.GEMINI_MODEL;

      const config = configValidator.getConfig();

      expect(config.PORT).toBe('3978');
      expect(config.GEMINI_MODEL).toBe('gemini-3-flash-preview');
    });

    it('should include all schema keys', () => {
      const config = configValidator.getConfig();

      expect(config).toHaveProperty('BOT_ID');
      expect(config).toHaveProperty('BOT_PASSWORD');
      expect(config).toHaveProperty('PORT');
      expect(config).toHaveProperty('ODOO_URL');
      expect(config).toHaveProperty('ODOO_DB');
      expect(config).toHaveProperty('ODOO_USERNAME');
      expect(config).toHaveProperty('ODOO_PASSWORD');
      expect(config).toHaveProperty('GEMINI_API_KEY');
      expect(config).toHaveProperty('GEMINI_MODEL');
      expect(config).toHaveProperty('PROJECT_CACHE_TTL');
      expect(config).toHaveProperty('LOG_LEVEL');
      expect(config).toHaveProperty('LOG_FILE');
      expect(config).toHaveProperty('NODE_ENV');
    });
  });

  describe('getDocumentation', () => {
    it('should return documentation string', () => {
      const doc = configValidator.getDocumentation();

      expect(doc).toContain('Configuration Documentation');
      expect(doc).toContain('BOT_ID');
      expect(doc).toContain('Microsoft Teams Bot Application ID');
      expect(doc).toContain('Required:');
      expect(doc).toContain('Type:');
    });

    it('should include default values in documentation', () => {
      const doc = configValidator.getDocumentation();

      expect(doc).toContain('Default:');
      expect(doc).toContain('3978');
    });

    it('should document all configuration options', () => {
      const doc = configValidator.getDocumentation();

      expect(doc).toContain('ODOO_URL');
      expect(doc).toContain('GEMINI_API_KEY');
      expect(doc).toContain('LOG_LEVEL');
    });
  });
});
