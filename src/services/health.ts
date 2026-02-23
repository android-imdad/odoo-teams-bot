/**
 * Health check and monitoring service for production observability.
 * Provides endpoints for monitoring, metrics, and diagnostics.
 */

import { OdooService } from './odoo';
import { parserService } from './parser';
import { logger } from '../config/logger';
import { config } from '../config/config';
import { aiResponseCache } from './responseCache';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    duration?: number;
    message?: string;
    details?: any;
  }[];
  metrics: SystemMetrics;
}

export interface SystemMetrics {
  memory: MemoryMetrics;
  cpu: CPUMetrics;
  cache: CacheMetrics;
  api: APIMetrics;
}

export interface MemoryMetrics {
  used: number;
  total: number;
  percentage: number;
  heapUsed: number;
  heapTotal: number;
}

export interface CPUMetrics {
  usage: number;
  loadAverage: number[];
}

export interface CacheMetrics {
  aiCache: {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  projectCache: {
    size: number;
  };
}

export interface APIMetrics {
  odoo: {
    status: 'up' | 'down' | 'unknown';
    lastCheck?: string;
    responseTime?: number;
  };
  gemini: {
    status: 'up' | 'down' | 'unknown';
    lastCheck?: string;
    responseTime?: number;
  };
}

class HealthService {
  private startTime: number;
  private version: string;
  private lastOdooCheck: number = 0;
  private lastGeminiCheck: number = 0;
  private odooStatus: 'up' | 'down' | 'unknown' = 'unknown';
  private geminiStatus: 'up' | 'down' | 'unknown' = 'unknown';
  private checkInterval: number = 60000; // Check every minute
  private odooService: OdooService;

  constructor(odooService: OdooService) {
    this.startTime = Date.now();
    this.version = process.env.npm_package_version || '1.0.0';
    this.odooService = odooService;

    // Start periodic health checks
    this.startPeriodicChecks();

    logger.info('HealthService initialized');
  }

  /**
   * Get memory usage metrics
   */
  private getMemoryMetrics(): MemoryMetrics {
    const usage = process.memoryUsage();

    return {
      used: usage.heapUsed,
      total: usage.heapTotal,
      percentage: (usage.heapUsed / usage.heapTotal) * 100,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal
    };
  }

  /**
   * Get CPU metrics
   */
  private getCPUMetrics(): CPUMetrics {
    void require('os').cpus(); // Available for future use
    const loadAverage = require('os').loadavg();

    // Calculate CPU usage (simplified)
    const usage = process.cpuUsage();

    return {
      usage: (usage.user + usage.system) / 1000000, // Convert to seconds
      loadAverage
    };
  }

  /**
   * Get cache metrics
   */
  private getCacheMetrics(): CacheMetrics {
    const aiStats = aiResponseCache.getStats();

    return {
      aiCache: {
        size: aiStats.size,
        hits: aiStats.hits,
        misses: aiStats.misses,
        hitRate: aiStats.hitRate
      },
      projectCache: {
        size: 0 // Would need to expose this from OdooService
      }
    };
  }

  /**
   * Check Odoo connectivity
   */
  private async checkOdoo(): Promise<{ status: 'up' | 'down'; responseTime?: number; message?: string }> {
    const startTime = Date.now();

    try {
      await this.odooService.getProjects();
      const responseTime = Date.now() - startTime;

      return {
        status: 'up',
        responseTime,
        message: 'Odoo API is responding'
      };
    } catch (error) {
      return {
        status: 'down',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check Gemini connectivity
   */
  private async checkGemini(): Promise<{ status: 'up' | 'down'; responseTime?: number; message?: string }> {
    const startTime = Date.now();

    try {
      // Simple test call to Gemini
      await parserService.parseText('test', []);
      const responseTime = Date.now() - startTime;

      return {
        status: 'up',
        responseTime,
        message: 'Gemini API is responding'
      };
    } catch (error) {
      return {
        status: 'down',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Start periodic health checks for external dependencies
   */
  private startPeriodicChecks(): void {
    setInterval(async () => {
      const now = Date.now();

      // Check Odoo
      if (now - this.lastOdooCheck > this.checkInterval) {
        const odooCheck = await this.checkOdoo();
        this.odooStatus = odooCheck.status;
        this.lastOdooCheck = now;

        if (odooCheck.status === 'down') {
          logger.warn('Odoo health check failed', { message: odooCheck.message });
        }
      }

      // Check Gemini (less frequently due to cost)
      if (now - this.lastGeminiCheck > this.checkInterval * 5) {
        const geminiCheck = await this.checkGemini();
        this.geminiStatus = geminiCheck.status;
        this.lastGeminiCheck = now;

        if (geminiCheck.status === 'down') {
          logger.warn('Gemini health check failed', { message: geminiCheck.message });
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Perform a comprehensive health check
   */
  public async getHealth(): Promise<HealthCheckResult> {
    void Date.now(); // Start time available for logging if needed
    const checks: HealthCheckResult['checks'] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Memory check
    const memory = this.getMemoryMetrics();
    checks.push({
      name: 'memory',
      status: memory.percentage < 90 ? 'pass' : memory.percentage < 95 ? 'warn' : 'fail',
      message: `Memory usage: ${memory.percentage.toFixed(2)}%`,
      details: memory
    });

    // CPU check
    const cpu = this.getCPUMetrics();
    checks.push({
      name: 'cpu',
      status: 'pass',
      message: `Load average: ${cpu.loadAverage.map(l => l.toFixed(2)).join(', ')}`,
      details: cpu
    });

    // Odoo check
    const odooCheck = await this.checkOdoo();
    this.odooStatus = odooCheck.status; // Update odooStatus for other methods
    checks.push({
      name: 'odoo',
      status: odooCheck.status === 'up' ? 'pass' : 'fail',
      duration: odooCheck.responseTime,
      message: odooCheck.message
    });

    // Determine overall status
    const failedChecks = checks.filter(c => c.status === 'fail' && c.name !== 'odoo');
    const warnedChecks = checks.filter(c => c.status === 'warn');

    if (failedChecks.length > 0) {
      overallStatus = 'unhealthy';
    } else if (warnedChecks.length > 0 || odooCheck.status === 'down') {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: this.version,
      environment: config.environment,
      checks,
      metrics: {
        memory,
        cpu: this.getCPUMetrics(),
        cache: this.getCacheMetrics(),
        api: {
          odoo: {
            status: odooCheck.status,
            lastCheck: new Date(this.lastOdooCheck).toISOString(),
            responseTime: odooCheck.responseTime
          },
          gemini: {
            status: this.geminiStatus,
            lastCheck: new Date(this.lastGeminiCheck).toISOString()
          }
        }
      }
    };
  }

  /**
   * Get a simple health status for load balancers
   */
  public getSimpleHealth(): { status: string; timestamp: string } {
    return {
      status: this.odooStatus === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get ready status for Kubernetes probes
   */
  public isReady(): boolean {
    return this.odooStatus === 'up';
  }

  /**
   * Get live status for Kubernetes probes
   */
  public isLive(): boolean {
    return true; // Process is alive if this code runs
  }

  /**
   * Get detailed metrics for monitoring systems
   */
  public async getMetrics(): Promise<{
    uptime: number;
    memory: MemoryMetrics;
    cpu: CPUMetrics;
    cache: CacheMetrics;
    requests: {
      total: number;
      byEndpoint: Record<string, number>;
      errors: number;
      averageResponseTime: number;
    };
  }> {
    const health = await this.getHealth();

    return {
      uptime: Date.now() - this.startTime,
      memory: health.metrics.memory,
      cpu: health.metrics.cpu,
      cache: health.metrics.cache,
      requests: {
        total: 0,
        byEndpoint: {},
        errors: 0,
        averageResponseTime: 0
      }
    };
  }

  /**
   * Get Prometheus-formatted metrics
   */
  public getPrometheusMetrics(): string {
    const memory = this.getMemoryMetrics();
    void this.getCPUMetrics(); // Available for future use
    const cache = this.getCacheMetrics();
    const uptime = Date.now() - this.startTime;

    const metrics: string[] = [];

    // Uptime
    metrics.push(`# HELP app_uptime_seconds Application uptime in seconds`);
    metrics.push(`# TYPE app_uptime_seconds gauge`);
    metrics.push(`app_uptime_seconds ${uptime / 1000}`);

    // Memory
    metrics.push(`# HELP app_memory_bytes Application memory usage`);
    metrics.push(`# TYPE app_memory_bytes gauge`);
    metrics.push(`app_memory_bytes{type="heap_used"} ${memory.heapUsed}`);
    metrics.push(`app_memory_bytes{type="heap_total"} ${memory.heapTotal}`);

    // Cache
    metrics.push(`# HELP app_cache_size Cache size`);
    metrics.push(`# TYPE app_cache_size gauge`);
    metrics.push(`app_cache_size{name="ai"} ${cache.aiCache.size}`);

    metrics.push(`# HELP app_cache_hits_total Total cache hits`);
    metrics.push(`# TYPE app_cache_hits_total counter`);
    metrics.push(`app_cache_hits_total{name="ai"} ${cache.aiCache.hits}`);

    metrics.push(`# HELP app_cache_misses_total Total cache misses`);
    metrics.push(`# TYPE app_cache_misses_total counter`);
    metrics.push(`app_cache_misses_total{name="ai"} ${cache.aiCache.misses}`);

    metrics.push(`# HELP app_cache_hit_rate Cache hit rate`);
    metrics.push(`# TYPE app_cache_hit_rate gauge`);
    metrics.push(`app_cache_hit_rate{name="ai"} ${cache.aiCache.hitRate}`);

    return metrics.join('\n');
  }
}

// Note: HealthService should be instantiated with OdooService and exported from index.ts
export { HealthService };
