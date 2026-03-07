// Mock logger before importing config
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('Config Validation - Auth Modes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules cache to re-import config
    jest.resetModules();
    process.env = { ...originalEnv };

    // Set required base environment variables
    process.env.ODOO_URL = 'https://test.odoo.com';
    process.env.ODOO_DB = 'test_db';
    process.env.GEMINI_API_KEY = 'test_key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Admin Proxy Mode', () => {
    it('should validate successfully with admin_proxy mode and credentials', () => {
      process.env.AUTH_MODE = 'admin_proxy';
      process.env.ODOO_USERNAME = 'admin@company.com';
      process.env.ODOO_PASSWORD = 'admin_pass';

      expect(() => {
        require('../../src/config/config');
      }).not.toThrow();
    });

    it('should throw error when admin_proxy mode lacks username', () => {
      process.env.AUTH_MODE = 'admin_proxy';
      process.env.ODOO_USERNAME = '';
      process.env.ODOO_PASSWORD = 'admin_pass';

      expect(() => {
        require('../../src/config/config');
      }).toThrow('Admin proxy mode');
    });

    it('should throw error when admin_proxy mode lacks password', () => {
      process.env.AUTH_MODE = 'admin_proxy';
      process.env.ODOO_USERNAME = 'admin@company.com';
      process.env.ODOO_PASSWORD = '';

      expect(() => {
        require('../../src/config/config');
      }).toThrow('Admin proxy mode');
    });

    it('should accept admin_proxy in production environment', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'admin_proxy';
      process.env.ODOO_USERNAME = 'admin@company.com';
      process.env.ODOO_PASSWORD = 'admin_pass';

      expect(() => {
        require('../../src/config/config');
      }).not.toThrow();
    });
  });

  describe('Service Account Mode', () => {
    it('should allow service_account in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.AUTH_MODE = 'service_account';

      expect(() => {
        require('../../src/config/config');
      }).not.toThrow();
    });

    it('should throw error for service_account in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'service_account';

      expect(() => {
        require('../../src/config/config');
      }).toThrow('Service account mode');
    });
  });

  describe('Invalid Auth Mode', () => {
    it('should throw error for invalid auth mode', () => {
      process.env.AUTH_MODE = 'invalid_mode';

      expect(() => {
        require('../../src/config/config');
      }).toThrow('Invalid AUTH_MODE');
    });

    it('should accept all valid auth modes', () => {
      const validModes = ['service_account', 'api_key', 'oauth', 'admin_proxy'];

      validModes.forEach(mode => {
        jest.resetModules();
        process.env = { ...originalEnv };
        process.env.ODOO_URL = 'https://test.odoo.com';
        process.env.ODOO_DB = 'test_db';
        process.env.GEMINI_API_KEY = 'test_key';
        process.env.AUTH_MODE = mode;

        if (mode === 'admin_proxy') {
          process.env.ODOO_USERNAME = 'admin@company.com';
          process.env.ODOO_PASSWORD = 'admin_pass';
        }

        expect(() => {
          require('../../src/config/config');
        }).not.toThrow();
      });
    });
  });
});
