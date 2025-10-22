import { registerApiRoute } from '@mastra/core/server';
import { apiLogger } from '../../observability/logger.js';
import {
  performSystemHealthCheck,
  performQuickHealthCheck,
  performPgvectorHealthCheck,
} from '../health/index.js';

/**
 * Health Check API Routes
 * Provides comprehensive system health monitoring endpoints
 * Constitutional requirement: Validate pgvector operations and system health
 */

export function getHealthRoutes() {
  return [
    /**
     * GET /health - Quick health check for load balancers
     * Returns basic health status with minimal latency
     */
    registerApiRoute('/health', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('Quick health check requested');

          const health = await performQuickHealthCheck();

          const statusCode = health.healthy ? 200 : 503;

          return c.json(health, statusCode);

        } catch (error) {
          apiLogger.error('Quick health check failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            healthy: false,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 503);
        }
      },
    }),

    /**
     * GET /health/system - Comprehensive system health check
     * Returns detailed health information for all system components
     */
    registerApiRoute('/health/system', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('System health check requested');

          const health = await performSystemHealthCheck();

          const statusCode = health.healthy ? 200 : 503;

          return c.json(health, statusCode);

        } catch (error) {
          apiLogger.error('System health check failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            healthy: false,
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            components: [],
            summary: {
              total: 0,
              healthy: 0,
              unhealthy: 0,
              warnings: 0,
            },
            pgvector: {
              enabled: false,
              functions_available: false,
              performance_acceptable: false,
            },
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 503);
        }
      },
    }),

    /**
     * GET /health/pgvector - pgvector-specific health check
     * Returns detailed pgvector extension health and performance metrics
     */
    registerApiRoute('/health/pgvector', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('pgvector health check requested');

          const health = await performPgvectorHealthCheck();

          const statusCode = health.healthy ? 200 : 503;

          return c.json(health, statusCode);

        } catch (error) {
          apiLogger.error('pgvector health check failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            healthy: false,
            functions_available: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 503);
        }
      },
    }),

    /**
     * GET /health/ready - Kubernetes readiness probe
     * Returns 200 if system is ready to accept traffic
     */
    registerApiRoute('/health/ready', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('Readiness check requested');

          const health = await performQuickHealthCheck();

          if (health.healthy) {
            return c.json({
              ready: true,
              timestamp: health.timestamp,
            }, 200);
          } else {
            return c.json({
              ready: false,
              timestamp: health.timestamp,
            }, 503);
          }

        } catch (error) {
          apiLogger.error('Readiness check failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            ready: false,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 503);
        }
      },
    }),

    /**
     * GET /health/live - Kubernetes liveness probe
     * Returns 200 if the application is alive (not deadlocked)
     */
    registerApiRoute('/health/live', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('Liveness check requested');

          // Simple liveness check - just verify the process is responsive
          return c.json({
            alive: true,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
          }, 200);

        } catch (error) {
          apiLogger.error('Liveness check failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            alive: false,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 503);
        }
      },
    }),
  ];
}