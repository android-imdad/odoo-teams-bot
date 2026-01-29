/**
 * Tests for rate limiting middleware
 */

import {
  RateLimiter,
  createRateLimiter,
  RateLimitPresets,
  createAIRateLimiter,
  createOdooRateLimiter,
  apiRateLimiter
} from '../../src/middleware/rateLimit';
import { Request, Response } from 'restify';

// Mock Restify Request
const createMockRequest = (options: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
} = {}): Partial<Request> => ({
  path: () => options.path || '/api/test',
  method: options.method || 'GET',
  headers: options.headers || {},
  connection: { remoteAddress: '127.0.0.1' } as any
});

// Mock Restify Response
interface MockResponse extends Partial<Response> {
  _headers: Record<string, string>;
  _statusCode: number;
  _body: any;
  header(key: string, value: string): void;
  getHeader(key: string): string | undefined;
  send(code: number, body?: any): void;
  get statusCode(): number;
  get body(): any;
}

const createMockResponse = (): MockResponse => {
  const mock: MockResponse = {
    _headers: {},
    _statusCode: 200,
    _body: null,
    header: function(key: string, value: string) { this._headers[key] = value; },
    getHeader: function(key: string) { return this._headers[key]; },
    send: function(code: number, body?: any) { this._statusCode = code; this._body = body; },
    get statusCode() { return this._statusCode; },
    get body() { return this._body; }
  };
  return mock;
};

describe('RateLimiter', () => {
  describe('middleware', () => {
    it('should allow first request', () => {
      const limiter = new RateLimiter({ requests: 5, windowMs: 60000 });
      const middleware = limiter.middleware();
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.getHeader('X-RateLimit-Limit')).toBe('5');
      expect(res.getHeader('X-RateLimit-Remaining')).toBe('4');
    });

    it('should allow requests within limit', () => {
      const limiter = new RateLimiter({ requests: 3, windowMs: 60000 });
      const middleware = limiter.middleware();
      const next = jest.fn();

      for (let i = 0; i < 3; i++) {
        const req = createMockRequest() as Request;
        const res = createMockResponse() as Response;
        middleware(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(3);
    });

    it('should block requests exceeding limit', () => {
      const customErrorHandler = jest.fn((_req: Request, res: Response) => {
        const mockRes = res as MockResponse;
        mockRes._statusCode = 429;
        mockRes._body = { error: 'Too many requests' };
      });
      const limiter = new RateLimiter({
        requests: 2,
        windowMs: 60000,
        errorHandler: customErrorHandler
      });
      const middleware = limiter.middleware();
      const next = jest.fn();

      // First two requests should pass
      const req1 = createMockRequest() as Request;
      const res1 = createMockResponse() as Response;
      middleware(req1, res1, next);
      expect(next).toHaveBeenCalledTimes(1);

      const req2 = createMockRequest() as Request;
      const res2 = createMockResponse() as Response;
      middleware(req2, res2, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Third request should be blocked
      const req3 = createMockRequest() as Request;
      const res3 = createMockResponse() as Response;
      middleware(req3, res3, next);

      expect(next).toHaveBeenCalledTimes(2); // Not called for third request
      expect(customErrorHandler).toHaveBeenCalledTimes(1);
      const mockRes3 = res3 as MockResponse;
      expect(mockRes3.statusCode).toBe(429);
    });

    it('should set rate limit headers', () => {
      const limiter = new RateLimiter({ requests: 10, windowMs: 60000 });
      const middleware = limiter.middleware();
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.getHeader('X-RateLimit-Limit')).toBe('10');
      expect(res.getHeader('X-RateLimit-Remaining')).toBe('9');
      expect(res.getHeader('X-RateLimit-Reset')).toBeDefined();
    });

    it('should attach rate limit info to request', () => {
      const limiter = new RateLimiter({ requests: 5, windowMs: 60000 });
      const middleware = limiter.middleware();
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.rateLimit).toBeDefined();
      expect(req.rateLimit?.limit).toBe(5);
      expect(req.rateLimit?.remaining).toBe(4);
      expect(req.rateLimit?.reset).toBeInstanceOf(Date);
    });

    it('should skip rate limiting when skip function returns true', () => {
      const skipFn = jest.fn().mockReturnValue(true);
      const limiter = new RateLimiter({
        requests: 1,
        windowMs: 60000,
        skip: skipFn
      });
      const middleware = limiter.middleware();
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = jest.fn();

      // Make multiple requests - all should be allowed
      for (let i = 0; i < 5; i++) {
        middleware(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
      expect(skipFn).toHaveBeenCalledTimes(5);
    });

    it('should use custom key generator', () => {
      const keyGenerator = jest.fn().mockReturnValue('custom-key');
      const limiter = new RateLimiter({
        requests: 2,
        windowMs: 60000,
        keyGenerator
      });
      const middleware = limiter.middleware();
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(keyGenerator).toHaveBeenCalledWith(req);
    });

    it('should use custom error handler', () => {
      const customErrorHandler = jest.fn((_req: Request, res: Response) => {
        const mockRes = res as MockResponse;
        mockRes._statusCode = 429;
        mockRes._body = { error: 'Custom rate limit exceeded' };
      });
      const limiter = new RateLimiter({
        requests: 1,
        windowMs: 60000,
        errorHandler: customErrorHandler
      });
      const middleware = limiter.middleware();
      const next = jest.fn();

      // First request
      const req1 = createMockRequest() as Request;
      const res1 = createMockResponse() as Response;
      middleware(req1, res1, next);

      // Second request (should be blocked)
      const req2 = createMockRequest() as Request;
      const res2 = createMockResponse() as Response;
      middleware(req2, res2, next);

      expect(customErrorHandler).toHaveBeenCalledWith(req2, res2);
      const mockRes2 = res2 as MockResponse;
      expect(mockRes2.statusCode).toBe(429);
    });

    it('should reset rate limit after window expires', async () => {
      const customErrorHandler = jest.fn((_req: Request, res: Response) => {
        const mockRes = res as MockResponse;
        mockRes._statusCode = 429;
        mockRes._body = { error: 'Too many requests' };
      });
      const limiter = new RateLimiter({
        requests: 2,
        windowMs: 100,
        errorHandler: customErrorHandler
      });
      const middleware = limiter.middleware();
      const next = jest.fn();

      // Use all requests
      const req1 = createMockRequest() as Request;
      const res1 = createMockResponse() as Response;
      middleware(req1, res1, next);

      const req2 = createMockRequest() as Request;
      const res2 = createMockResponse() as Response;
      middleware(req2, res2, next);

      // Third request should be blocked
      const req3 = createMockRequest() as Request;
      const res3 = createMockResponse() as Response;
      middleware(req3, res3, next);

      const mockRes3 = res3 as MockResponse;
      expect(mockRes3.statusCode).toBe(429);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be allowed again
      const req4 = createMockRequest() as Request;
      const res4 = createMockResponse() as Response;
      middleware(req4, res4, next);

      expect(next).toHaveBeenCalledTimes(3); // Called for req1, req2, and req4
    });
  });

  describe('reset', () => {
    it('should reset rate limit for a key', () => {
      const limiter = new RateLimiter({ requests: 2, windowMs: 60000 });
      const middleware = limiter.middleware();
      const next = jest.fn();

      // Use both requests
      const req1 = createMockRequest() as Request;
      const res1 = createMockResponse() as Response;
      middleware(req1, res1, next);

      const req2 = createMockRequest() as Request;
      const res2 = createMockResponse() as Response;
      middleware(req2, res2, next);

      // Reset
      limiter.reset('127.0.0.1');

      // Should be allowed again
      const req3 = createMockRequest() as Request;
      const res3 = createMockResponse() as Response;
      middleware(req3, res3, next);

      expect(next).toHaveBeenCalledTimes(3);
    });
  });

  describe('getInfo', () => {
    it('should return info for non-existent key', () => {
      const limiter = new RateLimiter({ requests: 5, windowMs: 60000 });
      const info = limiter.getInfo('nonexistent');

      expect(info).toEqual({
        limit: 5,
        remaining: 5,
        reset: expect.any(Date)
      });
    });

    it('should return info for existing key', () => {
      const limiter = new RateLimiter({ requests: 5, windowMs: 60000 });
      const middleware = limiter.middleware();
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;
      const next = jest.fn();

      middleware(req, res, next);

      const info = limiter.getInfo('127.0.0.1');

      expect(info).toEqual({
        limit: 5,
        remaining: 4,
        reset: expect.any(Date)
      });
    });
  });
});

describe('createRateLimiter', () => {
  it('should create a rate limiter middleware', () => {
    const middleware = createRateLimiter({ requests: 5, windowMs: 60000 });
    expect(typeof middleware).toBe('function');
  });
});

describe('createAIRateLimiter', () => {
  it('should create AI rate limiter with preset', () => {
    const limiter = createAIRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
  });
});

describe('createOdooRateLimiter', () => {
  it('should create Odoo rate limiter with preset', () => {
    const limiter = createOdooRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
  });
});

describe('apiRateLimiter', () => {
  it('should be a preconfigured middleware function', () => {
    expect(typeof apiRateLimiter).toBe('function');
  });
});

describe('RateLimitPresets', () => {
  it('should have AI_OPERATIONS preset', () => {
    expect(RateLimitPresets.AI_OPERATIONS).toEqual({
      requests: 30,
      windowMs: 60000,
      skip: expect.any(Function)
    });
  });

  it('should have API_CALLS preset', () => {
    expect(RateLimitPresets.API_CALLS).toEqual({
      requests: 100,
      windowMs: 60000,
      skip: expect.any(Function)
    });
  });

  it('should have BOT_MESSAGES preset', () => {
    expect(RateLimitPresets.BOT_MESSAGES).toEqual({
      requests: 20,
      windowMs: 60000,
      skip: expect.any(Function)
    });
  });

  it('should have ODOO_OPERATIONS preset', () => {
    expect(RateLimitPresets.ODOO_OPERATIONS).toEqual({
      requests: 50,
      windowMs: 60000,
      skip: expect.any(Function)
    });
  });

  it('should skip health check endpoint', () => {
    const req = createMockRequest({ path: '/health' }) as Request;
    expect(RateLimitPresets.AI_OPERATIONS.skip(req)).toBe(true);
  });

  it('should not skip other endpoints', () => {
    const req = createMockRequest({ path: '/api/messages' }) as Request;
    expect(RateLimitPresets.AI_OPERATIONS.skip(req)).toBe(false);
  });
});
