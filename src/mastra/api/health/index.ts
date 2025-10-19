/**
 * Health Check API Endpoints
 * Constitutional requirement: Validate pgvector operations and system health
 */

import { withErrorHandling } from '../../observability/error-handling.js';
import { vectorStorage } from '../../memory/storage.js';
import { getConnectionManager } from '../../database/connection.js';
import { getVectorOpsService } from '../../database/vector-ops.js';
import { checkEmbeddingHealth } from '../../memory/embeddings.js';
import { knowledgeSearchService } from '../../knowledge/search.js';
import { rootLogger } from '../../observability/logger.js';

interface HealthCheckResult {
  healthy: boolean;
  component: string;
  latencyMs?: number;
  version?: string;
  error?: string;
  details?: Record<string, any>;
}

interface SystemHealthResponse {
  healthy: boolean;
  timestamp: string;
  version: string;
  environment: string;
  components: HealthCheckResult[];
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    warnings: number;
  };
  pgvector: {
    enabled: boolean;
    version?: string;
    functions_available: boolean;
    performance_acceptable: boolean;
  };
}

/**
 * Comprehensive system health check including pgvector validation
 */
export async function performSystemHealthCheck(): Promise<SystemHealthResponse> {
  return await withErrorHandling(
    async () => {
      const startTime = Date.now();
      const components: HealthCheckResult[] = [];

      // 1. Database Connection Health
      const connectionManager = getConnectionManager();
      const dbHealthStart = Date.now();
      try {
        const poolStatus = connectionManager.getPoolStatus();
        const testQuery = await connectionManager.query('SELECT 1 as test');

        components.push({
          healthy: testQuery.rows.length > 0,
          component: 'database_connection',
          latencyMs: Date.now() - dbHealthStart,
          details: {
            pool_total: poolStatus.totalCount,
            pool_idle: poolStatus.idleCount,
            pool_waiting: poolStatus.waitingCount,
            circuit_breaker_state: poolStatus.circuitBreakerState,
          },
        });
      } catch (error) {
        components.push({
          healthy: false,
          component: 'database_connection',
          latencyMs: Date.now() - dbHealthStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 2. pgvector Extension Health
      const pgvectorHealthStart = Date.now();
      try {
        const vectorOps = getVectorOpsService();
        const vectorHealth = await vectorOps.checkVectorHealth();

        components.push({
          healthy: vectorHealth.healthy,
          component: 'pgvector_extension',
          latencyMs: Date.now() - pgvectorHealthStart,
          version: vectorHealth.pgvectorVersion,
          details: {
            functions_available: vectorHealth.functionsAvailable,
          },
          error: vectorHealth.error,
        });
      } catch (error) {
        components.push({
          healthy: false,
          component: 'pgvector_extension',
          latencyMs: Date.now() - pgvectorHealthStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 3. Vector Storage Health
      const storageHealthStart = Date.now();
      try {
        const storageHealth = await vectorStorage.healthCheck();

        components.push({
          healthy: storageHealth.healthy,
          component: 'vector_storage',
          latencyMs: Date.now() - storageHealthStart,
          details: {
            pgvector_enabled: storageHealth.pgvectorEnabled,
            functions_available: storageHealth.functionsAvailable,
            performance_acceptable: storageHealth.performanceAcceptable,
            issues: storageHealth.issues,
          },
        });
      } catch (error) {
        components.push({
          healthy: false,
          component: 'vector_storage',
          latencyMs: Date.now() - storageHealthStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 4. Embedding Service Health
      const embeddingHealthStart = Date.now();
      try {
        const embeddingHealth = await checkEmbeddingHealth();

        components.push({
          healthy: embeddingHealth.healthy,
          component: 'embedding_service',
          latencyMs: embeddingHealth.latencyMs || (Date.now() - embeddingHealthStart),
          details: {
            dimensions: 1536,
            provider: 'aws_bedrock_titan_v2',
          },
          error: embeddingHealth.error,
        });
      } catch (error) {
        components.push({
          healthy: false,
          component: 'embedding_service',
          latencyMs: Date.now() - embeddingHealthStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 5. Knowledge Search Health
      const searchHealthStart = Date.now();
      try {
        const testSearchResults = await knowledgeSearchService.search({
          query: 'health check test',
          searchType: 'semantic',
          filters: { maxResults: 1 },
        });

        components.push({
          healthy: true,
          component: 'knowledge_search',
          latencyMs: Date.now() - searchHealthStart,
          details: {
            search_functional: true,
            processing_time: testSearchResults.processingTime,
          },
        });
      } catch (error) {
        components.push({
          healthy: false,
          component: 'knowledge_search',
          latencyMs: Date.now() - searchHealthStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // 6. Vector Operations Performance Test
      const vectorPerfStart = Date.now();
      try {
        const vectorOps = getVectorOpsService();
        const testVector = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);

        const perfResults = await vectorOps.semanticSearch(testVector, {
          searchTable: 'user_memories',
          matchCount: 1,
          matchThreshold: 0.1,
        });

        const perfLatency = Date.now() - vectorPerfStart;
        const performanceAcceptable = perfLatency < 2000;

        components.push({
          healthy: performanceAcceptable,
          component: 'vector_performance',
          latencyMs: perfLatency,
          details: {
            results_returned: perfResults.length,
            performance_acceptable: performanceAcceptable,
            threshold_ms: 2000,
          },
        });
      } catch (error) {
        components.push({
          healthy: false,
          component: 'vector_performance',
          latencyMs: Date.now() - vectorPerfStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Calculate summary
      const healthy = components.filter(c => c.healthy).length;
      const unhealthy = components.filter(c => !c.healthy).length;
      const warnings = components.filter(c => c.healthy && c.error).length;

      const overallHealthy = unhealthy === 0;

      // Extract pgvector-specific information
      const pgvectorComponent = components.find(c => c.component === 'pgvector_extension');
      const vectorStorageComponent = components.find(c => c.component === 'vector_storage');

      const response: SystemHealthResponse = {
        healthy: overallHealthy,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        components,
        summary: {
          total: components.length,
          healthy,
          unhealthy,
          warnings,
        },
        pgvector: {
          enabled: Boolean(pgvectorComponent?.healthy),
          version: pgvectorComponent?.version,
          functions_available: Boolean(vectorStorageComponent?.details?.functions_available),
          performance_acceptable: Boolean(vectorStorageComponent?.details?.performance_acceptable),
        },
      };

      rootLogger.info('System health check completed', {
        healthy: overallHealthy,
        total_components: components.length,
        healthy_components: healthy,
        unhealthy_components: unhealthy,
        total_latency_ms: Date.now() - startTime,
        pgvector_enabled: response.pgvector.enabled,
      });

      return response;
    },
    {
      component: 'health_check',
      operation: 'system_health_check',
    },
    'low'
  );
}

/**
 * Quick health check for load balancer/monitoring
 */
export async function performQuickHealthCheck(): Promise<{ healthy: boolean; timestamp: string }> {
  try {
    const connectionManager = getConnectionManager();
    await connectionManager.query('SELECT 1');

    return {
      healthy: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      healthy: false,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * pgvector-specific health check
 */
export async function performPgvectorHealthCheck(): Promise<{
  healthy: boolean;
  pgvector_version?: string;
  functions_available: boolean;
  performance_test_ms?: number;
  error?: string;
}> {
  return await withErrorHandling(
    async () => {
      const vectorOps = getVectorOpsService();

      // Check extension and functions
      const vectorHealth = await vectorOps.checkVectorHealth();

      if (!vectorHealth.healthy) {
        return {
          healthy: false,
          functions_available: false,
          error: vectorHealth.error,
        };
      }

      // Performance test
      const perfStart = Date.now();
      const testVector = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);

      await vectorOps.semanticSearch(testVector, {
        searchTable: 'user_memories',
        matchCount: 1,
        matchThreshold: 0.1,
      });

      const performanceMs = Date.now() - perfStart;

      return {
        healthy: true,
        pgvector_version: vectorHealth.pgvectorVersion,
        functions_available: Boolean(vectorHealth.functionsAvailable),
        performance_test_ms: performanceMs,
      };
    },
    {
      component: 'health_check',
      operation: 'pgvector_health_check',
    },
    'low'
  ).catch((error) => ({
    healthy: false,
    functions_available: false,
    error: error instanceof Error ? error.message : String(error),
  }));
}