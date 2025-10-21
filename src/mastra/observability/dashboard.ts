/**
 * Observability Dashboard Integration
 * Constitutional requirement: Comprehensive dashboard for system health, performance, and compliance monitoring
 */

import { getLangFuseClient } from './langfuse-client.js';
import { getToolCallTracer } from './tool-tracer.js';
import { getAgentInteractionTracer } from './agent-tracer.js';
import { getWorkflowExecutionTracer } from './workflow-tracer.js';
import { getVectorStore, getConnectionPool } from '../config/consolidated-database.js';
import { getVectorOpsService } from '../database/vector-ops.js';
import { performSystemHealthCheck, performPgvectorHealthCheck } from '../api/health/index.js';
import { withErrorHandling } from './error-handling.js';
import { rootLogger } from './logger.js';

// Dashboard metrics interfaces
export interface SystemMetrics {
  health: {
    overall: boolean;
    database: boolean;
    pgvector: boolean;
    langfuse: boolean;
    vector_storage: boolean;
  };
  performance: {
    database_latency_ms: number;
    vector_search_latency_ms: number;
    langfuse_latency_ms?: number;
    memory_usage_mb: number;
    cpu_usage_percent?: number;
  };
  usage: {
    total_traces: number;
    traces_last_24h: number;
    total_tool_calls: number;
    tool_calls_last_24h: number;
    total_agent_executions: number;
    agent_executions_last_24h: number;
    total_workflow_executions: number;
    workflow_executions_last_24h: number;
  };
  errors: {
    error_rate_24h: number;
    critical_errors_24h: number;
    database_errors_24h: number;
    trace_failures_24h: number;
  };
}

export interface ConstitutionalComplianceStatus {
  pgvector_database: {
    compliant: boolean;
    version: string;
    functions_available: boolean;
    performance_acceptable: boolean;
    issues: string[];
  };
  comprehensive_observability: {
    compliant: boolean;
    langfuse_enabled: boolean;
    tool_tracing_enabled: boolean;
    agent_tracing_enabled: boolean;
    workflow_tracing_enabled: boolean;
    issues: string[];
  };
  data_compliance: {
    compliant: boolean;
    vector_operations_working: boolean;
    embedding_service_healthy: boolean;
    issues: string[];
  };
}

export interface DashboardData {
  timestamp: string;
  system_metrics: SystemMetrics;
  constitutional_compliance: ConstitutionalComplianceStatus;
  recent_activity: {
    recent_traces: Array<{
      id: string;
      name: string;
      timestamp: string;
      status: 'success' | 'error';
      duration_ms: number;
      type: 'tool' | 'agent' | 'workflow';
    }>;
    error_summary: Array<{
      error_type: string;
      count: number;
      last_occurrence: string;
    }>;
  };
  alerts: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: string;
    component: string;
    resolved: boolean;
  }>;
}

/**
 * Observability Dashboard Service
 * Constitutional requirement for comprehensive system monitoring
 */
export class ObservabilityDashboard {
  private langfuseClient = getLangFuseClient();
  private toolTracer = getToolCallTracer();
  private agentTracer = getAgentInteractionTracer();
  private workflowTracer = getWorkflowExecutionTracer();

  constructor() {
    rootLogger.debug('Observability Dashboard initialized');
  }

  /**
   * Get comprehensive dashboard data
   */
  async getDashboardData(): Promise<DashboardData> {
    return await withErrorHandling(
      async () => {
        const [systemMetrics, complianceStatus, recentActivity, alerts] = await Promise.all([
          this.getSystemMetrics(),
          this.getConstitutionalComplianceStatus(),
          this.getRecentActivity(),
          this.getActiveAlerts(),
        ]);

        return {
          timestamp: new Date().toISOString(),
          system_metrics: systemMetrics,
          constitutional_compliance: complianceStatus,
          recent_activity: recentActivity,
          alerts,
        };
      },
      {
        component: 'tool',
        operation: 'get_dashboard_data',
      },
      'high'
    );
  }

  /**
   * Get system health and performance metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    return await withErrorHandling(
      async () => {
        // Get system health status
        const healthCheck = await performSystemHealthCheck();

        // Get database performance
        const connectionManager = getConnectionPool();
        const dbLatencyStart = Date.now();
        await connectionManager.query('SELECT 1');
        const dbLatency = Date.now() - dbLatencyStart;

        // Get vector search performance
        const vectorOps = getVectorOpsService();
        const vectorLatencyStart = Date.now();
        const testVector = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
        await vectorOps.semanticSearch(testVector, {
          searchTable: 'user_memories',
          matchCount: 1,
          matchThreshold: 0.1,
        });
        const vectorLatency = Date.now() - vectorLatencyStart;

        // Get LangFuse latency if available
        let langfuseLatency: number | undefined;
        if (this.langfuseClient.isReady()) {
          const langfuseLatencyStart = Date.now();
          await this.langfuseClient.performHealthCheck();
          langfuseLatency = Date.now() - langfuseLatencyStart;
        }

        // Get memory usage
        const memoryUsage = process.memoryUsage();
        const memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

        // Get usage statistics (would need to track these in the database)
        const usageStats = await this.getUsageStatistics();

        // Get error statistics
        const errorStats = await this.getErrorStatistics();

        return {
          health: {
            overall: healthCheck.healthy,
            database: healthCheck.components.find(c => c.component === 'database_connection')?.healthy || false,
            pgvector: healthCheck.components.find(c => c.component === 'pgvector_extension')?.healthy || false,
            langfuse: this.langfuseClient.isReady(),
            vector_storage: healthCheck.components.find(c => c.component === 'vector_storage')?.healthy || false,
          },
          performance: {
            database_latency_ms: dbLatency,
            vector_search_latency_ms: vectorLatency,
            langfuse_latency_ms: langfuseLatency,
            memory_usage_mb: memoryUsageMB,
          },
          usage: usageStats,
          errors: errorStats,
        };
      },
      {
        component: 'tool',
        operation: 'get_system_metrics',
      },
      'high'
    );
  }

  /**
   * Get constitutional compliance status
   */
  async getConstitutionalComplianceStatus(): Promise<ConstitutionalComplianceStatus> {
    return await withErrorHandling(
      async () => {
        // Check pgvector compliance
        const pgvectorHealth = await performPgvectorHealthCheck();
        const pgvectorCompliant = pgvectorHealth.healthy && pgvectorHealth.functions_available;

        // Check observability compliance
        const observabilityCompliant =
          this.langfuseClient.isReady() &&
          this.toolTracer.isEnabled() &&
          this.agentTracer.isEnabled() &&
          this.workflowTracer.isEnabled();

        // Check data compliance
        const systemHealth = await performSystemHealthCheck();
        const vectorStorageHealthy = systemHealth.components.find(c => c.component === 'vector_storage')?.healthy || false;
        const embeddingHealthy = systemHealth.components.find(c => c.component === 'embedding_service')?.healthy || false;
        const dataCompliant = vectorStorageHealthy && embeddingHealthy;

        return {
          pgvector_database: {
            compliant: pgvectorCompliant,
            version: pgvectorHealth.pgvector_version || 'unknown',
            functions_available: pgvectorHealth.functions_available,
            performance_acceptable: (pgvectorHealth.performance_test_ms || 0) < 2000,
            issues: pgvectorCompliant ? [] : ['pgvector extension not fully functional'],
          },
          comprehensive_observability: {
            compliant: observabilityCompliant,
            langfuse_enabled: this.langfuseClient.isReady(),
            tool_tracing_enabled: this.toolTracer.isEnabled(),
            agent_tracing_enabled: this.agentTracer.isEnabled(),
            workflow_tracing_enabled: this.workflowTracer.isEnabled(),
            issues: observabilityCompliant ? [] : ['one or more tracing components not enabled'],
          },
          data_compliance: {
            compliant: dataCompliant,
            vector_operations_working: vectorStorageHealthy,
            embedding_service_healthy: embeddingHealthy,
            issues: dataCompliant ? [] : ['vector operations or embedding service not working'],
          },
        };
      },
      {
        component: 'tool',
        operation: 'get_constitutional_compliance',
      },
      'high'
    );
  }

  /**
   * Get recent system activity
   */
  async getRecentActivity(): Promise<DashboardData['recent_activity']> {
    return await withErrorHandling(
      async () => {
        // This would need to be implemented with actual trace storage
        // For now, return mock data structure
        return {
          recent_traces: [],
          error_summary: [],
        };
      },
      {
        component: 'tool',
        operation: 'get_recent_activity',
      },
      'medium'
    );
  }

  /**
   * Get active system alerts
   */
  async getActiveAlerts(): Promise<DashboardData['alerts']> {
    return await withErrorHandling(
      async () => {
        const alerts: DashboardData['alerts'] = [];

        // Check for critical health issues
        const healthCheck = await performSystemHealthCheck();

        if (!healthCheck.healthy) {
          alerts.push({
            id: 'system_health_critical',
            severity: 'critical',
            message: 'System health check failed - multiple components unhealthy',
            timestamp: new Date().toISOString(),
            component: 'system',
            resolved: false,
          });
        }

        // Check for database issues
        const dbComponent = healthCheck.components.find(c => c.component === 'database_connection');
        if (!dbComponent?.healthy) {
          alerts.push({
            id: 'database_connection_failed',
            severity: 'critical',
            message: 'Database connection failed',
            timestamp: new Date().toISOString(),
            component: 'database',
            resolved: false,
          });
        }

        // Check for pgvector issues
        const pgvectorComponent = healthCheck.components.find(c => c.component === 'pgvector_extension');
        if (!pgvectorComponent?.healthy) {
          alerts.push({
            id: 'pgvector_extension_failed',
            severity: 'high',
            message: 'pgvector extension not working properly',
            timestamp: new Date().toISOString(),
            component: 'pgvector',
            resolved: false,
          });
        }

        // Check for LangFuse issues
        if (!this.langfuseClient.isReady()) {
          alerts.push({
            id: 'langfuse_not_ready',
            severity: 'medium',
            message: 'LangFuse observability not available',
            timestamp: new Date().toISOString(),
            component: 'observability',
            resolved: false,
          });
        }

        // Check for performance issues
        const vectorStorageComponent = healthCheck.components.find(c => c.component === 'vector_performance');
        if (vectorStorageComponent && !vectorStorageComponent.healthy) {
          alerts.push({
            id: 'vector_performance_degraded',
            severity: 'medium',
            message: 'Vector search performance is degraded',
            timestamp: new Date().toISOString(),
            component: 'performance',
            resolved: false,
          });
        }

        return alerts;
      },
      {
        component: 'tool',
        operation: 'get_active_alerts',
      },
      'medium'
    );
  }

  /**
   * Get usage statistics (placeholder - would need actual tracking)
   */
  private async getUsageStatistics(): Promise<SystemMetrics['usage']> {
    // This would need to be implemented with actual usage tracking
    // For now, return placeholder data
    return {
      total_traces: 0,
      traces_last_24h: 0,
      total_tool_calls: 0,
      tool_calls_last_24h: 0,
      total_agent_executions: 0,
      agent_executions_last_24h: 0,
      total_workflow_executions: 0,
      workflow_executions_last_24h: 0,
    };
  }

  /**
   * Get error statistics (placeholder - would need actual error tracking)
   */
  private async getErrorStatistics(): Promise<SystemMetrics['errors']> {
    // This would need to be implemented with actual error tracking
    // For now, return placeholder data
    return {
      error_rate_24h: 0,
      critical_errors_24h: 0,
      database_errors_24h: 0,
      trace_failures_24h: 0,
    };
  }

  /**
   * Export dashboard data for external monitoring systems
   */
  async exportMetrics(format: 'json' | 'prometheus' = 'json'): Promise<string> {
    return await withErrorHandling(
      async () => {
        const dashboardData = await this.getDashboardData();

        if (format === 'prometheus') {
          return this.formatPrometheusMetrics(dashboardData);
        }

        return JSON.stringify(dashboardData, null, 2);
      },
      {
        component: 'tool',
        operation: 'export_metrics',
        metadata: { format },
      },
      'medium'
    );
  }

  /**
   * Format metrics for Prometheus
   */
  private formatPrometheusMetrics(data: DashboardData): string {
    const lines: string[] = [];

    // System health metrics
    lines.push(`# HELP system_health Overall system health status`);
    lines.push(`# TYPE system_health gauge`);
    lines.push(`system_health{component="overall"} ${data.system_metrics.health.overall ? 1 : 0}`);
    lines.push(`system_health{component="database"} ${data.system_metrics.health.database ? 1 : 0}`);
    lines.push(`system_health{component="pgvector"} ${data.system_metrics.health.pgvector ? 1 : 0}`);
    lines.push(`system_health{component="langfuse"} ${data.system_metrics.health.langfuse ? 1 : 0}`);

    // Performance metrics
    lines.push(`# HELP database_latency_milliseconds Database query latency`);
    lines.push(`# TYPE database_latency_milliseconds gauge`);
    lines.push(`database_latency_milliseconds ${data.system_metrics.performance.database_latency_ms}`);

    lines.push(`# HELP vector_search_latency_milliseconds Vector search latency`);
    lines.push(`# TYPE vector_search_latency_milliseconds gauge`);
    lines.push(`vector_search_latency_milliseconds ${data.system_metrics.performance.vector_search_latency_ms}`);

    lines.push(`# HELP memory_usage_megabytes Memory usage in MB`);
    lines.push(`# TYPE memory_usage_megabytes gauge`);
    lines.push(`memory_usage_megabytes ${data.system_metrics.performance.memory_usage_mb}`);

    // Constitutional compliance
    lines.push(`# HELP constitutional_compliance Constitutional compliance status`);
    lines.push(`# TYPE constitutional_compliance gauge`);
    lines.push(`constitutional_compliance{component="pgvector_database"} ${data.constitutional_compliance.pgvector_database.compliant ? 1 : 0}`);
    lines.push(`constitutional_compliance{component="observability"} ${data.constitutional_compliance.comprehensive_observability.compliant ? 1 : 0}`);
    lines.push(`constitutional_compliance{component="data_compliance"} ${data.constitutional_compliance.data_compliance.compliant ? 1 : 0}`);

    // Alerts
    lines.push(`# HELP active_alerts_total Number of active alerts by severity`);
    lines.push(`# TYPE active_alerts_total gauge`);
    const alertCounts = { low: 0, medium: 0, high: 0, critical: 0 };
    data.alerts.filter(a => !a.resolved).forEach(alert => {
      alertCounts[alert.severity]++;
    });
    Object.entries(alertCounts).forEach(([severity, count]) => {
      lines.push(`active_alerts_total{severity="${severity}"} ${count}`);
    });

    return lines.join('\n') + '\n';
  }

  /**
   * Get dashboard health summary
   */
  async getHealthSummary(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    score: number;
    issues: string[];
    timestamp: string;
  }> {
    return await withErrorHandling(
      async () => {
        const complianceStatus = await this.getConstitutionalComplianceStatus();
        const systemMetrics = await this.getSystemMetrics();
        const alerts = await this.getActiveAlerts();

        // Calculate health score
        let score = 100;
        const issues: string[] = [];

        // Deduct for health issues
        if (!systemMetrics.health.overall) {
          score -= 50;
          issues.push('System health check failed');
        }
        if (!systemMetrics.health.database) {
          score -= 30;
          issues.push('Database connection issues');
        }
        if (!systemMetrics.health.pgvector) {
          score -= 20;
          issues.push('pgvector extension issues');
        }
        if (!systemMetrics.health.langfuse) {
          score -= 10;
          issues.push('LangFuse observability unavailable');
        }

        // Deduct for compliance issues
        if (!complianceStatus.pgvector_database.compliant) {
          score -= 25;
          issues.push('pgvector database not compliant');
        }
        if (!complianceStatus.comprehensive_observability.compliant) {
          score -= 15;
          issues.push('Observability not fully compliant');
        }
        if (!complianceStatus.data_compliance.compliant) {
          score -= 20;
          issues.push('Data operations not compliant');
        }

        // Deduct for critical alerts
        const criticalAlerts = alerts.filter(a => a.severity === 'critical' && !a.resolved);
        score -= criticalAlerts.length * 20;

        const highAlerts = alerts.filter(a => a.severity === 'high' && !a.resolved);
        score -= highAlerts.length * 10;

        // Determine status
        let status: 'healthy' | 'degraded' | 'unhealthy';
        if (score >= 90) {
          status = 'healthy';
        } else if (score >= 70) {
          status = 'degraded';
        } else {
          status = 'unhealthy';
        }

        return {
          status,
          score: Math.max(0, score),
          issues,
          timestamp: new Date().toISOString(),
        };
      },
      {
        component: 'tool',
        operation: 'get_health_summary',
      },
      'high'
    );
  }
}

// Global singleton instance
let globalDashboard: ObservabilityDashboard;

export function getObservabilityDashboard(): ObservabilityDashboard {
  if (!globalDashboard) {
    globalDashboard = new ObservabilityDashboard();
  }
  return globalDashboard;
}

// Constitutional compliance exports
export default getObservabilityDashboard;