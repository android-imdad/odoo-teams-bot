/**
 * Tests for server/index.ts
 */

// Mock dependencies before importing the module
jest.mock('restify', () => {
  const mockServer = {
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    listen: jest.fn((port, callback) => {
      if (callback) callback();
      return mockServer;
    }),
    close: jest.fn((callback) => {
      if (callback) callback();
    }),
    name: 'Odoo Teams Bot',
    version: '1.0.0'
  };

  return {
    createServer: jest.fn(() => mockServer),
    plugins: {
      bodyParser: jest.fn(() => jest.fn())
    }
  };
});

jest.mock('botbuilder', () => ({
  BotFrameworkAdapter: jest.fn().mockImplementation(() => ({
    onTurnError: null,
    process: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/bot', () => ({
  TimesheetBot: jest.fn().mockImplementation(() => ({
    run: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../src/config/config', () => ({
  config: {
    bot: {
      appId: 'test-app-id',
      appPassword: 'test-password',
      port: 3978
    },
    environment: 'test'
  }
}));

jest.mock('../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn()
  }
}));

import restify from 'restify';
import { BotFrameworkAdapter } from 'botbuilder';
import { logger } from '../src/config/logger';
import { config } from '../src/config/config';

describe('Server (index.ts)', () => {
  let mockServer: any;
  let mockAdapter: any;
  let processExitSpy: jest.SpyInstance;
  let processOnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockServer = (restify.createServer as jest.Mock)();

    // Reset modules to reload index.ts
    jest.resetModules();

    // Mock process.exit and process.on
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  describe('Server setup', () => {
    it('should create restify server with correct options', async () => {
      // Import the module to trigger server setup
      await import('../src/index');

      expect(restify.createServer).toHaveBeenCalledWith({
        name: 'Odoo Teams Bot',
        version: '1.0.0'
      });
    });

    it('should use body parser middleware', async () => {
      await import('../src/index');

      expect(mockServer.use).toHaveBeenCalled();
      expect(restify.plugins.bodyParser).toHaveBeenCalled();
    });

    it('should create BotFrameworkAdapter with credentials', async () => {
      await import('../src/index');

      expect(BotFrameworkAdapter).toHaveBeenCalledWith({
        appId: config.bot.appId,
        appPassword: config.bot.appPassword
      });
    });
  });

  describe('Health endpoint', () => {
    it('should register GET /health endpoint', async () => {
      await import('../src/index');

      expect(mockServer.get).toHaveBeenCalledWith('/health', expect.any(Function));
    });

    it('should return healthy status from health endpoint', async () => {
      await import('../src/index');

      const healthHandler = mockServer.get.mock.calls.find(
        (call: any[]) => call[0] === '/health'
      )[1];

      const mockRes = {
        send: jest.fn()
      };
      const mockNext = jest.fn();

      healthHandler({}, mockRes, mockNext);

      expect(mockRes.send).toHaveBeenCalledWith(200, expect.objectContaining({
        status: 'healthy',
        timestamp: expect.any(String)
      }));
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Messages endpoint', () => {
    it('should register POST /api/messages endpoint', async () => {
      await import('../src/index');

      expect(mockServer.post).toHaveBeenCalledWith('/api/messages', expect.any(Function));
    });

    it('should process bot requests', async () => {
      await import('../src/index');

      const messageHandler = mockServer.post.mock.calls.find(
        (call: any[]) => call[0] === '/api/messages'
      )[1];

      const mockReq = {
        method: 'POST',
        url: '/api/messages',
        header: jest.fn((name: string) => {
          if (name === 'content-type') return 'application/json';
          if (name === 'authorization') return 'Bearer token';
          return null;
        }),
        body: { type: 'message', text: 'Hello' }
      };
      const mockRes = {};

      await messageHandler(mockReq, mockRes);

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming bot request',
        expect.objectContaining({
          method: 'POST',
          url: '/api/messages'
        })
      );
    });

    it('should log missing authorization header', async () => {
      await import('../src/index');

      const messageHandler = mockServer.post.mock.calls.find(
        (call: any[]) => call[0] === '/api/messages'
      )[1];

      const mockReq = {
        method: 'POST',
        url: '/api/messages',
        header: jest.fn((name: string) => {
          if (name === 'authorization') return undefined;
          return 'value';
        }),
        body: {}
      };
      const mockRes = {};

      await messageHandler(mockReq, mockRes);

      expect(logger.info).toHaveBeenCalledWith(
        'Incoming bot request',
        expect.objectContaining({
          authHeader: 'missing'
        })
      );
    });
  });

  describe('Server startup', () => {
    it('should start server on configured port', async () => {
      await import('../src/index');

      expect(mockServer.listen).toHaveBeenCalledWith(3978, expect.any(Function));
    });

    it('should log server startup', async () => {
      await import('../src/index');

      // Trigger the listen callback
      const listenCallback = mockServer.listen.mock.calls[0][1];
      listenCallback();

      expect(logger.info).toHaveBeenCalledWith(
        'Bot server started',
        expect.objectContaining({
          port: 3978,
          environment: 'test'
        })
      );
    });
  });

  describe('Graceful shutdown', () => {
    it('should register SIGINT handler', async () => {
      await import('../src/index');

      const sigintCalls = processOnSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'SIGINT'
      );
      expect(sigintCalls.length).toBeGreaterThan(0);
    });

    it('should register SIGTERM handler', async () => {
      await import('../src/index');

      const sigtermCalls = processOnSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'SIGTERM'
      );
      expect(sigtermCalls.length).toBeGreaterThan(0);
    });

    it('should handle SIGINT gracefully', async () => {
      await import('../src/index');

      const sigintHandler = processOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'SIGINT'
      )[1];

      sigintHandler();

      expect(logger.info).toHaveBeenCalledWith('Received SIGINT, shutting down gracefully');
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should handle SIGTERM gracefully', async () => {
      await import('../src/index');

      const sigtermHandler = processOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'SIGTERM'
      )[1];

      sigtermHandler();

      expect(logger.info).toHaveBeenCalledWith('Received SIGTERM, shutting down gracefully');
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should exit process after server close on SIGINT', async () => {
      await import('../src/index');

      const sigintHandler = processOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'SIGINT'
      )[1];

      sigintHandler();

      // Get the close callback and execute it
      const closeCallback = mockServer.close.mock.calls[0][0];
      closeCallback();

      expect(logger.info).toHaveBeenCalledWith('Server closed');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('Error handlers', () => {
    it('should register uncaughtException handler', async () => {
      await import('../src/index');

      const exceptionCalls = processOnSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'uncaughtException'
      );
      expect(exceptionCalls.length).toBeGreaterThan(0);
    });

    it('should register unhandledRejection handler', async () => {
      await import('../src/index');

      const rejectionCalls = processOnSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'unhandledRejection'
      );
      expect(rejectionCalls.length).toBeGreaterThan(0);
    });

    it('should handle uncaught exceptions', async () => {
      await import('../src/index');

      const exceptionHandler = processOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'uncaughtException'
      )[1];

      const error = new Error('Test error');
      exceptionHandler(error);

      expect(logger.error).toHaveBeenCalledWith(
        'Uncaught exception',
        expect.objectContaining({
          error: 'Test error'
        })
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle unhandled rejections', async () => {
      await import('../src/index');

      const rejectionHandler = processOnSpy.mock.calls.find(
        (call: any[]) => call[0] === 'unhandledRejection'
      )[1];

      const reason = 'Test rejection';
      const promise = Promise.resolve();
      rejectionHandler(reason, promise);

      expect(logger.error).toHaveBeenCalledWith(
        'Unhandled rejection',
        expect.objectContaining({ reason })
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Bot adapter error handling', () => {
    it('should set up onTurnError handler', async () => {
      const { BotFrameworkAdapter: MockAdapter } = await import('botbuilder');
      await import('../src/index');

      const adapterInstance = (MockAdapter as jest.Mock).mock.results[0].value;
      expect(adapterInstance.onTurnError).toBeDefined();
    });
  });
});
