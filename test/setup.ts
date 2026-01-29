/**
 * Jest test setup file
 */

// Mock environment variables for tests
process.env = {
  NODE_ENV: 'test',
  BOT_ID: 'test-bot-id',
  BOT_PASSWORD: 'test-bot-password',
  ODOO_URL: 'https://test-odoo.example.com',
  ODOO_DB: 'test-db',
  ODOO_USERNAME: 'test-user',
  ODOO_PASSWORD: 'test-password',
  GEMINI_API_KEY: 'test-api-key',
  GEMINI_MODEL: 'gemini-test',
  PORT: '3978',
  LOG_LEVEL: 'error',
  LOG_FILE: '/tmp/test-bot.log',
};

// Increase timeout for async operations
jest.setTimeout(30000);

// Setup global mocks
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
};
