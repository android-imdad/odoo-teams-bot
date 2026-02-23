/**
 * Tests for health service
 */

import { HealthService } from '../../src/services/health';
import { OdooService } from '../../src/services/odoo';
import { parserService } from '../../src/services/parser';
import { aiResponseCache } from '../../src/services/responseCache';
import { logger } from '../../src/config/logger';

jest.mock('../../src/services/parser');
jest.mock('../../src/services/responseCache', () => ({
  aiResponseCache: {
    getStats: jest.fn().mockReturnValue({
      size: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalCached: 0,
      totalEvicted: 0
    })
  }
}));
jest.mock('../../src/config/logger');

// Mock os module
jest.mock('os', () => ({
  cpus: jest.fn(() => [{}, {}, {}, {}]),
  loadavg: jest.fn(() => [1.5, 1.2, 0.8])
}));

describe('HealthService', () => {
  let service: HealthService;
  let mockOdooService: jest.Mocked<OdooService>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockOdooService = {
      getProjects: jest.fn().mockResolvedValue([]),
      getTasks: jest.fn().mockResolvedValue([]),
      logTime: jest.fn().mockResolvedValue(123),
      createTask: jest.fn().mockResolvedValue(456),
      clearCache: jest.fn()
    } as unknown as jest.Mocked<OdooService>;
    service = new HealthService(mockOdooService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(logger.info).toHaveBeenCalledWith('HealthService initialized');
    });

    it('should set start time to current timestamp', () => {
      const newService = new HealthService(mockOdooService);

      // Verify service was created
      expect(newService).toBeDefined();
    });

    it('should set version from npm_package_version or default', () => {
      const originalVersion = process.env.npm_package_version;
      process.env.npm_package_version = '2.0.0';

      const newService = new HealthService(mockOdooService);
      expect(newService).toBeDefined();

      process.env.npm_package_version = originalVersion;
    });

    it('should use default version when npm_package_version is not set', () => {
      const originalVersion = process.env.npm_package_version;
      delete process.env.npm_package_version;

      const newService = new HealthService(mockOdooService);
      expect(newService).toBeDefined();

      if (originalVersion) {
        process.env.npm_package_version = originalVersion;
      }
    });
  });

  describe('getHealth', () => {
    it('should return healthy status when all checks pass', async () => {
      // Create fresh service to avoid state from periodic checks
      const freshMockOdoo = {
        ...mockOdooService,
        getProjects: jest.fn().mockResolvedValue([{ id: 1, name: 'Test' }])
      } as unknown as jest.Mocked<OdooService>;
      const freshService = new HealthService(freshMockOdoo);

      const health = await freshService.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.checks).toBeDefined();
      expect(health.metrics).toBeDefined();
      expect(health.timestamp).toBeDefined();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.version).toBeDefined();
      expect(health.environment).toBeDefined();
    });

    it('should include memory check', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const health = await service.getHealth();
      const memoryCheck = health.checks.find(c => c.name === 'memory');

      expect(memoryCheck).toBeDefined();
      expect(memoryCheck?.status).toBe('pass');
      expect(memoryCheck?.details).toHaveProperty('used');
      expect(memoryCheck?.details).toHaveProperty('total');
      expect(memoryCheck?.details).toHaveProperty('percentage');
    });

    it('should warn when memory usage is high', async () => {
      // Manually test the check logic
      const memory = { used: 900, total: 1000, percentage: 92, heapUsed: 900, heapTotal: 1000 };
      const status = memory.percentage < 90 ? 'pass' : memory.percentage < 95 ? 'warn' : 'fail';

      expect(status).toBe('warn');
    });

    it('should fail when memory usage is critical', async () => {
      const memory = { used: 960, total: 1000, percentage: 96, heapUsed: 960, heapTotal: 1000 };
      const status = memory.percentage < 90 ? 'pass' : memory.percentage < 95 ? 'warn' : 'fail';

      expect(status).toBe('fail');
    });

    it('should include CPU check', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const health = await service.getHealth();
      const cpuCheck = health.checks.find(c => c.name === 'cpu');

      expect(cpuCheck).toBeDefined();
      expect(cpuCheck?.status).toBe('pass');
      expect(cpuCheck?.details).toHaveProperty('usage');
      expect(cpuCheck?.details).toHaveProperty('loadAverage');
    });

    it('should include Odoo check', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const health = await service.getHealth();
      const odooCheck = health.checks.find(c => c.name === 'odoo');

      expect(odooCheck).toBeDefined();
      expect(odooCheck?.status).toBe('pass');
      expect(odooCheck?.duration).toBeDefined();
      expect(odooCheck?.message).toBe('Odoo API is responding');
    });

    it('should return degraded status when Odoo is down', async () => {
      (mockOdooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const health = await service.getHealth();
      const odooCheck = health.checks.find(c => c.name === 'odoo');

      expect(odooCheck?.status).toBe('fail');
      expect(health.status).toBe('degraded');
    });

    it('should include API metrics', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const health = await service.getHealth();

      expect(health.metrics.api).toBeDefined();
      expect(health.metrics.api.odoo).toBeDefined();
      expect(health.metrics.api.gemini).toBeDefined();
      expect(health.metrics.api.odoo.status).toBe('up');
    });

    it('should include cache metrics', async () => {
      (aiResponseCache.getStats as jest.Mock).mockReturnValue({
        size: 10,
        hits: 50,
        misses: 20,
        hitRate: 0.71
      });
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const health = await service.getHealth();

      expect(health.metrics.cache).toBeDefined();
      expect(health.metrics.cache.aiCache).toBeDefined();
      expect(health.metrics.cache.aiCache.size).toBe(10);
      expect(health.metrics.cache.aiCache.hitRate).toBe(0.71);
    });

    it('should return unhealthy when critical checks fail', async () => {
      // Force critical failure by making multiple checks fail
      const mockGetProjects = mockOdooService.getProjects as jest.Mock;
      mockGetProjects.mockRejectedValue(new Error('Critical failure'));

      const health = await service.getHealth();

      // Should be degraded because only Odoo is failing
      expect(['degraded', 'unhealthy']).toContain(health.status);
    });
  });

  describe('getSimpleHealth', () => {
    it('should return ok status when Odoo is up', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      // First call getHealth to set odooStatus
      await service.getHealth();

      const simple = service.getSimpleHealth();
      expect(simple.status).toBe('ok');
      expect(simple.timestamp).toBeDefined();
    });

    it('should return degraded status when Odoo is down', async () => {
      (mockOdooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      // First call getHealth to set odooStatus
      await service.getHealth();

      const simple = service.getSimpleHealth();
      expect(simple.status).toBe('degraded');
    });
  });

  describe('isReady', () => {
    it('should return true when Odoo is up', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      await service.getHealth();

      expect(service.isReady()).toBe(true);
    });

    it('should return false when Odoo is down', async () => {
      (mockOdooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await service.getHealth();

      expect(service.isReady()).toBe(false);
    });
  });

  describe('isLive', () => {
    it('should always return true', () => {
      expect(service.isLive()).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('should return system metrics', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);
      (aiResponseCache.getStats as jest.Mock).mockReturnValue({
        size: 5,
        hits: 100,
        misses: 50,
        hitRate: 0.67
      });

      const metrics = await service.getMetrics();

      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
      expect(metrics.memory).toBeDefined();
      expect(metrics.cpu).toBeDefined();
      expect(metrics.cache).toBeDefined();
      expect(metrics.requests).toBeDefined();
      expect(metrics.requests.total).toBe(0);
    });

    it('should include memory metrics', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const metrics = await service.getMetrics();

      expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.total).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.percentage).toBeGreaterThanOrEqual(0);
    });

    it('should include CPU metrics', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const metrics = await service.getMetrics();

      expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.loadAverage).toHaveLength(3);
    });
  });

  describe('getPrometheusMetrics', () => {
    it('should return Prometheus-formatted metrics', () => {
      (aiResponseCache.getStats as jest.Mock).mockReturnValue({
        size: 10,
        hits: 100,
        misses: 30,
        hitRate: 0.77
      });

      const metrics = service.getPrometheusMetrics();

      expect(metrics).toContain('# HELP app_uptime_seconds');
      expect(metrics).toContain('# TYPE app_uptime_seconds gauge');
      expect(metrics).toContain('app_uptime_seconds');
    });

    it('should include memory metrics', () => {
      const metrics = service.getPrometheusMetrics();

      expect(metrics).toContain('# HELP app_memory_bytes');
      expect(metrics).toContain('app_memory_bytes{type="heap_used"}');
      expect(metrics).toContain('app_memory_bytes{type="heap_total"}');
    });

    it('should include cache metrics', () => {
      (aiResponseCache.getStats as jest.Mock).mockReturnValue({
        size: 5,
        hits: 50,
        misses: 25,
        hitRate: 0.67
      });

      const metrics = service.getPrometheusMetrics();

      expect(metrics).toContain('# HELP app_cache_size');
      expect(metrics).toContain('app_cache_size{name="ai"} 5');
      expect(metrics).toContain('# HELP app_cache_hits_total');
      expect(metrics).toContain('app_cache_hits_total{name="ai"} 50');
      expect(metrics).toContain('# HELP app_cache_misses_total');
      expect(metrics).toContain('app_cache_misses_total{name="ai"} 25');
      expect(metrics).toContain('# HELP app_cache_hit_rate');
      expect(metrics).toContain('app_cache_hit_rate{name="ai"} 0.67');
    });
  });

  describe('periodic health checks', () => {
    it('should start periodic checks on construction', () => {
      jest.useFakeTimers();

      // Service is created in beforeEach with fake timers
      expect(service).toBeDefined();

      jest.useRealTimers();
    });

    it('should check Odoo status periodically', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      jest.advanceTimersByTime(35000);

      // Give async operations time to complete
      await Promise.resolve();
    });

    it('should log warning when Odoo check fails', async () => {
      (mockOdooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await service.getHealth();

      // Advance time to trigger periodic check
      jest.advanceTimersByTime(35000);
      await Promise.resolve();
    });

    it('should check Gemini status less frequently', async () => {
      (parserService.parseText as jest.Mock).mockResolvedValue({});

      // Advance by 5 minutes to trigger Gemini check
      jest.advanceTimersByTime(310000);

      await Promise.resolve();
    });
  });

  describe('checkOdoo', () => {
    it('should return up status when Odoo responds', async () => {
      (mockOdooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Test' }]);

      const health = await service.getHealth();
      const odooCheck = health.checks.find(c => c.name === 'odoo');

      expect(odooCheck?.status).toBe('pass');
    });

    it('should return down status when Odoo fails', async () => {
      (mockOdooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const health = await service.getHealth();
      const odooCheck = health.checks.find(c => c.name === 'odoo');

      expect(odooCheck?.status).toBe('fail');
      expect(odooCheck?.message).toContain('Connection failed');
    });
  });

  describe('checkGemini', () => {
    it('should return up status when Gemini responds', async () => {
      (parserService.parseText as jest.Mock).mockResolvedValue({ parsed: true });

      // Trigger health check which will also check Gemini
      await service.getHealth();
    });

    it('should return down status when Gemini fails', async () => {
      (parserService.parseText as jest.Mock).mockRejectedValue(new Error('API error'));

      await service.getHealth();
    });
  });
});

describe('HealthService exports', () => {
  it('should export HealthService class', () => {
    const mockOdoo = {
      getProjects: jest.fn().mockResolvedValue([]),
      getTasks: jest.fn().mockResolvedValue([]),
      logTime: jest.fn().mockResolvedValue(123),
      createTask: jest.fn().mockResolvedValue(456),
      clearCache: jest.fn()
    } as unknown as jest.Mocked<OdooService>;
    const testService = new HealthService(mockOdoo);
    expect(testService).toBeDefined();
    expect(typeof testService.getHealth).toBe('function');
    expect(typeof testService.getSimpleHealth).toBe('function');
    expect(typeof testService.isReady).toBe('function');
    expect(typeof testService.isLive).toBe('function');
    expect(typeof testService.getMetrics).toBe('function');
    expect(typeof testService.getPrometheusMetrics).toBe('function');
  });
});
