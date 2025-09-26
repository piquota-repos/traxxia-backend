const os = require('os');
const process = require('process');
const { logger } = require('../middleware/errorHandler');

class MonitoringService {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        slowRequests: 0 // Requests > 1000ms
      },
      database: {
        connections: 0,
        queries: 0,
        slowQueries: 0, // Queries > 100ms
        errors: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        operations: 0
      },
      errors: {
        total: 0,
        byType: {},
        byEndpoint: {}
      },
      performance: {
        memoryUsage: [],
        cpuUsage: [],
        responseTimeHistory: []
      }
    };
    
    this.responseTimes = [];
    this.startTime = Date.now();
    this.slowQueryThreshold = 100; // ms
    this.slowRequestThreshold = 1000; // ms
    
    // Start periodic system monitoring
    this.startSystemMonitoring();
    
    console.log('📊 Monitoring service initialized');
  }

  // Start periodic system monitoring
  startSystemMonitoring() {
    setInterval(() => {
      this.recordSystemMetrics();
    }, 30000); // Every 30 seconds
  }

  // Record system metrics periodically
  recordSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Store memory usage (keep last 100 records)
    this.metrics.performance.memoryUsage.push({
      timestamp: new Date().toISOString(),
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) // MB
    });

    if (this.metrics.performance.memoryUsage.length > 100) {
      this.metrics.performance.memoryUsage = this.metrics.performance.memoryUsage.slice(-100);
    }

    // Store CPU usage
    this.metrics.performance.cpuUsage.push({
      timestamp: new Date().toISOString(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });

    if (this.metrics.performance.cpuUsage.length > 100) {
      this.metrics.performance.cpuUsage = this.metrics.performance.cpuUsage.slice(-100);
    }
  }

  // Record request metrics with enhanced tracking
  recordRequest(duration, statusCode, endpoint = 'unknown', method = 'unknown') {
    this.metrics.requests.total++;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // Track slow requests
    if (duration > this.slowRequestThreshold) {
      this.metrics.requests.slowRequests++;
      logger.warn('Slow request detected', {
        endpoint,
        method,
        duration: `${duration}ms`,
        statusCode
      });
    }

    this.responseTimes.push({
      duration,
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      statusCode
    });
    
    // Keep only last 1000 response times for average calculation
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    // Update average response time
    const totalTime = this.responseTimes.reduce((sum, req) => sum + req.duration, 0);
    this.metrics.requests.averageResponseTime = totalTime / this.responseTimes.length;

    // Store response time history (keep last 100 records)
    this.metrics.performance.responseTimeHistory.push({
      timestamp: new Date().toISOString(),
      duration,
      endpoint,
      statusCode
    });

    if (this.metrics.performance.responseTimeHistory.length > 100) {
      this.metrics.performance.responseTimeHistory = this.metrics.performance.responseTimeHistory.slice(-100);
    }
  }

  // Record database metrics with query tracking
  recordDatabaseQuery(duration, operation = 'unknown', collection = 'unknown') {
    this.metrics.database.queries++;
    
    if (duration > this.slowQueryThreshold) {
      this.metrics.database.slowQueries++;
      logger.warn('Slow database query detected', {
        operation,
        collection,
        duration: `${duration}ms`
      });
    }
  }

  // Record database errors
  recordDatabaseError(error, operation = 'unknown') {
    this.metrics.database.errors++;
    logger.error('Database error recorded', {
      operation,
      error: error.message
    });
  }

  // Record cache metrics with operation tracking
  recordCacheHit(operation = 'get') {
    this.metrics.cache.hits++;
    this.metrics.cache.operations++;
    this.updateCacheHitRate();
  }

  recordCacheMiss(operation = 'get') {
    this.metrics.cache.misses++;
    this.metrics.cache.operations++;
    this.updateCacheHitRate();
  }

  updateCacheHitRate() {
    const total = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = total > 0 ? (this.metrics.cache.hits / total) * 100 : 0;
  }

  // Record error metrics with detailed tracking
  recordError(errorType, endpoint = 'unknown', statusCode = 500) {
    this.metrics.errors.total++;
    
    // Track by error type
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;
    
    // Track by endpoint
    this.metrics.errors.byEndpoint[endpoint] = (this.metrics.errors.byEndpoint[endpoint] || 0) + 1;

    logger.error('Error recorded in monitoring', {
      errorType,
      endpoint,
      statusCode,
      totalErrors: this.metrics.errors.total
    });
  }

  // Get comprehensive system metrics
  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      uptime: process.uptime(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        systemTotal: Math.round(os.totalmem() / 1024 / 1024), // MB
        systemFree: Math.round(os.freemem() / 1024 / 1024), // MB
        memoryUsagePercent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        loadAverage: os.loadavg(),
        cores: os.cpus().length
      },
      platform: {
        type: os.type(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version
      }
    };
  }

  // Get comprehensive metrics with trends
  getAllMetrics() {
    const systemMetrics = this.getSystemMetrics();
    
    return {
      application: {
        ...this.metrics,
        trends: {
          requestTrend: this.calculateRequestTrend(),
          errorTrend: this.calculateErrorTrend(),
          performanceTrend: this.calculatePerformanceTrend()
        }
      },
      system: systemMetrics,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0'
    };
  }

  // Calculate request trend (last 10 minutes)
  calculateRequestTrend() {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentRequests = this.responseTimes.filter(req => 
      new Date(req.timestamp) > tenMinutesAgo
    );

    return {
      count: recentRequests.length,
      averageResponseTime: recentRequests.length > 0 ? 
        recentRequests.reduce((sum, req) => sum + req.duration, 0) / recentRequests.length : 0,
      slowRequestsCount: recentRequests.filter(req => req.duration > this.slowRequestThreshold).length
    };
  }

  // Calculate error trend
  calculateErrorTrend() {
    const totalRequests = this.metrics.requests.total;
    const errorRate = totalRequests > 0 ? (this.metrics.requests.failed / totalRequests) * 100 : 0;
    
    return {
      errorRate: errorRate.toFixed(2) + '%',
      totalErrors: this.metrics.errors.total,
      topErrorTypes: this.getTopErrorTypes(5)
    };
  }

  // Calculate performance trend
  calculatePerformanceTrend() {
    const recentMemory = this.metrics.performance.memoryUsage.slice(-10);
    const avgMemoryUsage = recentMemory.length > 0 ? 
      recentMemory.reduce((sum, mem) => sum + mem.heapUsed, 0) / recentMemory.length : 0;

    return {
      averageMemoryUsage: avgMemoryUsage.toFixed(2) + ' MB',
      cacheHitRate: this.metrics.cache.hitRate.toFixed(2) + '%',
      slowQueriesCount: this.metrics.database.slowQueries
    };
  }

  // Get top error types
  getTopErrorTypes(limit = 5) {
    return Object.entries(this.metrics.errors.byType)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([type, count]) => ({ type, count }));
  }

  // Enhanced health check with detailed status
  getHealthStatus() {
    const metrics = this.getAllMetrics();
    const memoryUsagePercent = parseFloat(metrics.system.memory.memoryUsagePercent);
    const errorRate = this.metrics.requests.total > 0 ? 
      (this.metrics.requests.failed / this.metrics.requests.total) * 100 : 0;

    const checks = {
      memory: {
        status: memoryUsagePercent < 80 ? 'healthy' : memoryUsagePercent < 90 ? 'warning' : 'critical',
        usage: `${memoryUsagePercent}%`,
        details: `${metrics.system.memory.heapUsed}MB / ${metrics.system.memory.heapTotal}MB`
      },
      errorRate: {
        status: errorRate < 1 ? 'healthy' : errorRate < 5 ? 'warning' : 'critical',
        rate: `${errorRate.toFixed(2)}%`,
        details: `${this.metrics.requests.failed} errors out of ${this.metrics.requests.total} requests`
      },
      responseTime: {
        status: this.metrics.requests.averageResponseTime < 500 ? 'healthy' : 
                this.metrics.requests.averageResponseTime < 1000 ? 'warning' : 'critical',
        average: `${this.metrics.requests.averageResponseTime.toFixed(2)}ms`,
        details: `${this.metrics.requests.slowRequests} slow requests detected`
      },
      database: {
        status: this.metrics.database.slowQueries < 10 ? 'healthy' : 
                this.metrics.database.slowQueries < 50 ? 'warning' : 'critical',
        slowQueries: this.metrics.database.slowQueries,
        details: `${this.metrics.database.queries} total queries, ${this.metrics.database.errors} errors`
      },
      cache: {
        status: this.metrics.cache.hitRate > 70 ? 'healthy' : 
                this.metrics.cache.hitRate > 50 ? 'warning' : 'critical',
        hitRate: `${this.metrics.cache.hitRate.toFixed(2)}%`,
        details: `${this.metrics.cache.hits} hits, ${this.metrics.cache.misses} misses`
      }
    };

    // Determine overall status
    const checkStatuses = Object.values(checks).map(check => check.status);
    let overallStatus = 'healthy';
    
    if (checkStatuses.includes('critical')) {
      overallStatus = 'critical';
    } else if (checkStatuses.includes('warning')) {
      overallStatus = 'warning';
    }

    return {
      status: overallStatus,
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  // Reset metrics (useful for testing or periodic resets)
  resetMetrics() {
    console.log('🔄 Resetting monitoring metrics');
    this.metrics = {
      requests: { total: 0, successful: 0, failed: 0, averageResponseTime: 0, slowRequests: 0 },
      database: { connections: 0, queries: 0, slowQueries: 0, errors: 0 },
      cache: { hits: 0, misses: 0, hitRate: 0, operations: 0 },
      errors: { total: 0, byType: {}, byEndpoint: {} },
      performance: { memoryUsage: [], cpuUsage: [], responseTimeHistory: [] }
    };
    this.responseTimes = [];
  }

  // Middleware to automatically track requests
  trackRequests() {
    return (req, res, next) => {
      const startTime = process.hrtime.bigint();
      
      res.on('finish', () => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        
        this.recordRequest(duration, res.statusCode, req.route?.path || req.path, req.method);
      });
      
      next();
    };
  }

  // Generate comprehensive performance report
  generateReport() {
    const metrics = this.getAllMetrics();
    const healthStatus = this.getHealthStatus();
    
    const report = {
      summary: {
        status: healthStatus.status,
        totalRequests: metrics.application.requests.total,
        successRate: metrics.application.requests.total > 0 ? 
          ((metrics.application.requests.successful / metrics.application.requests.total) * 100).toFixed(2) + '%' : '0%',
        averageResponseTime: metrics.application.requests.averageResponseTime.toFixed(2) + 'ms',
        cacheHitRate: metrics.application.cache.hitRate.toFixed(2) + '%',
        uptime: Math.floor(metrics.uptime / 1000 / 60) + ' minutes',
        memoryUsage: metrics.system.memory.memoryUsagePercent + '%'
      },
      trends: metrics.application.trends,
      healthChecks: healthStatus.checks,
      topErrors: this.getTopErrorTypes(10),
      recommendations: this.generateRecommendations(metrics),
      timestamp: new Date().toISOString()
    };

    return report;
  }

  // Generate performance recommendations based on metrics
  generateRecommendations(metrics) {
    const recommendations = [];

    if (metrics.application.requests.averageResponseTime > 1000) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Average response time is high. Consider optimizing slow endpoints or adding caching.',
        metric: `${metrics.application.requests.averageResponseTime.toFixed(2)}ms average response time`
      });
    }

    if (metrics.application.cache.hitRate < 50) {
      recommendations.push({
        type: 'caching',
        priority: 'medium',
        message: 'Cache hit rate is low. Review caching strategy and identify frequently accessed data.',
        metric: `${metrics.application.cache.hitRate.toFixed(2)}% hit rate`
      });
    }

    if (metrics.application.database.slowQueries > 10) {
      recommendations.push({
        type: 'database',
        priority: 'high',
        message: 'Multiple slow database queries detected. Optimize queries and add proper indexes.',
        metric: `${metrics.application.database.slowQueries} slow queries`
      });
    }

    const errorRate = metrics.application.requests.total > 0 ? 
      (metrics.application.requests.failed / metrics.application.requests.total) * 100 : 0;
    
    if (errorRate > 5) {
      recommendations.push({
        type: 'reliability',
        priority: 'critical',
        message: 'High error rate detected. Review error handling and investigate root causes.',
        metric: `${errorRate.toFixed(2)}% error rate`
      });
    }

    const memoryUsage = parseFloat(metrics.system.memory.memoryUsagePercent);
    if (memoryUsage > 80) {
      recommendations.push({
        type: 'memory',
        priority: memoryUsage > 90 ? 'critical' : 'high',
        message: 'High memory usage detected. Consider memory optimization and garbage collection tuning.',
        metric: `${memoryUsage}% memory usage`
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: 'general',
        priority: 'info',
        message: 'System is performing well. Continue monitoring for any changes.',
        metric: 'All metrics within acceptable ranges'
      });
    }

    return recommendations;
  }
}

module.exports = new MonitoringService();
