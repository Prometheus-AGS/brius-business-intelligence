import { EventEmitter } from 'events';
import { mcpClient, MCPConnection } from './client.js';
import { mcpProcessManager, ProcessInfo } from './process-manager.js';
import { mcpToolRegistry, ToolExecutionResponse } from './registry.js';
import { mcpLogger } from '../observability/logger.js';
import { AgentTracer, createTrace, createSpan, endSpan } from '../observability/langfuse.js';

/**
 * MCP Tool Execution Monitoring and Error Handling
 * Provides comprehensive monitoring, error tracking, and observability for MCP tool operations
 * Integrates with LangFuse for distributed tracing and performance analytics
 */

export interface MCPMonitoringMetrics {
  tool_executions: {
    total: number;
    successful: number;
    failed: number;
    avg_execution_time: number;
    executions_per_hour: number;
  };
  server_health: {
    total_servers: number;
    healthy_servers: number;
    degraded_servers: number;
    unavailable_servers: number;
    avg_uptime: number;
  };
  connection_metrics: {
    active_connections: number;
    failed_connections: number;
    reconnection_attempts: number;
    avg_connection_time: number;
  };
  error_metrics: {
    total_errors: number;
    connection_errors: number;
    execution_errors: number;
    configuration_errors: number;
    most_common_errors: Array<{ error: string; count: number }>;
  };
}

export interface MCPAlertRule {
  id: string;
  name: string;
  description: string;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    threshold: number;
    time_window_minutes: number;
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  last_triggered?: Date;
  trigger_count: number;
}

export interface MCPAlert {
  id: string;
  rule_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  triggered_at: Date;
  resolved_at?: Date;
  metadata: Record<string, any>;
}

export interface MCPHealthCheck {
  server_id: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  last_check: Date;
  response_time_ms: number;
  error?: string;
  metrics: {
    cpu_usage?: number;
    memory_usage?: number;
    tool_success_rate: number;
    avg_execution_time: number;
  };
}

/**
 * MCP Monitoring System
 */
export class MCPMonitoringSystem extends EventEmitter {
  private metrics: MCPMonitoringMetrics;
  private alertRules = new Map<string, MCPAlertRule>();
  private activeAlerts = new Map<string, MCPAlert>();
  private executionHistory: ToolExecutionResponse[] = [];
  private errorHistory: Array<{ timestamp: Date; error: Error; context: any }> = [];
  private healthChecks = new Map<string, MCPHealthCheck>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();

    this.metrics = this.initializeMetrics();
    this.setupDefaultAlertRules();
    this.setupEventListeners();
  }

  /**
   * Start monitoring system
   */
  start(): void {
    mcpLogger.info('Starting MCP monitoring system');

    // Start health check monitoring
    this.monitoringInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Every 30 seconds

    // Start metrics collection
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
      this.evaluateAlertRules();
    }, 60000); // Every minute

    mcpLogger.info('MCP monitoring system started');
  }

  /**
   * Stop monitoring system
   */
  stop(): void {
    mcpLogger.info('Stopping MCP monitoring system');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    mcpLogger.info('MCP monitoring system stopped');
  }

  /**
   * Get current metrics
   */
  getMetrics(): MCPMonitoringMetrics {
    return { ...this.metrics };
  }

  /**
   * Get health status for all servers
   */
  getHealthStatus(): MCPHealthCheck[] {
    return Array.from(this.healthChecks.values());
  }

  /**
   * Get health status for specific server
   */
  getServerHealth(serverId: string): MCPHealthCheck | null {
    return this.healthChecks.get(serverId) || null;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): MCPAlert[] {
    return Array.from(this.activeAlerts.values())
      .sort((a, b) => b.triggered_at.getTime() - a.triggered_at.getTime());
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): MCPAlert[] {
    return this.getActiveAlerts().filter(alert => alert.severity === severity);
  }

  /**
   * Get recent execution history
   */
  getExecutionHistory(limit = 100): ToolExecutionResponse[] {
    return this.executionHistory
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get error history
   */
  getErrorHistory(limit = 50): Array<{ timestamp: Date; error: Error; context: any }> {
    return this.errorHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule: MCPAlertRule): void {
    this.alertRules.set(rule.id, rule);
    mcpLogger.info('Alert rule added', {
      rule_id: rule.id,
      name: rule.name,
      severity: rule.severity,
    });
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      mcpLogger.info('Alert rule removed', { rule_id: ruleId });
    }
    return removed;
  }

  /**
   * Get all alert rules
   */
  getAlertRules(): MCPAlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return false;

    alert.resolved_at = new Date();
    this.activeAlerts.delete(alertId);

    mcpLogger.info('Alert resolved', {
      alert_id: alertId,
      rule_id: alert.rule_id,
      severity: alert.severity,
    });

    this.emit('alert:resolved', alert);
    return true;
  }

  /**
   * Track tool execution for monitoring
   */
  trackToolExecution(execution: ToolExecutionResponse): void {
    // Add to execution history
    this.executionHistory.push(execution);

    // Keep only last 1000 executions
    if (this.executionHistory.length > 1000) {
      this.executionHistory = this.executionHistory.slice(-1000);
    }

    // Update metrics
    this.updateExecutionMetrics(execution);

    // Trace to LangFuse
    this.traceExecutionToLangFuse(execution);

    mcpLogger.debug('Tool execution tracked', {
      execution_id: execution.id,
      tool_id: execution.toolId,
      success: execution.success,
      execution_time: execution.executionTime,
    });
  }

  /**
   * Track error for monitoring
   */
  trackError(error: Error, context: any = {}): void {
    const errorRecord = {
      timestamp: new Date(),
      error,
      context,
    };

    // Add to error history
    this.errorHistory.push(errorRecord);

    // Keep only last 500 errors
    if (this.errorHistory.length > 500) {
      this.errorHistory = this.errorHistory.slice(-500);
    }

    // Update error metrics
    this.updateErrorMetrics(error, context);

    // Trace to LangFuse
    this.traceErrorToLangFuse(error, context);

    mcpLogger.error('Error tracked in monitoring', { error: error.message, context });
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): MCPMonitoringMetrics {
    return {
      tool_executions: {
        total: 0,
        successful: 0,
        failed: 0,
        avg_execution_time: 0,
        executions_per_hour: 0,
      },
      server_health: {
        total_servers: 0,
        healthy_servers: 0,
        degraded_servers: 0,
        unavailable_servers: 0,
        avg_uptime: 0,
      },
      connection_metrics: {
        active_connections: 0,
        failed_connections: 0,
        reconnection_attempts: 0,
        avg_connection_time: 0,
      },
      error_metrics: {
        total_errors: 0,
        connection_errors: 0,
        execution_errors: 0,
        configuration_errors: 0,
        most_common_errors: [],
      },
    };
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultAlertRules(): void {
    const defaultRules: MCPAlertRule[] = [
      {
        id: 'high-error-rate',
        name: 'High Error Rate',
        description: 'Tool execution error rate exceeds 20%',
        condition: {
          metric: 'error_rate_percentage',
          operator: 'gt',
          threshold: 20,
          time_window_minutes: 5,
        },
        severity: 'high',
        enabled: true,
        trigger_count: 0,
      },
      {
        id: 'server-unavailable',
        name: 'Server Unavailable',
        description: 'MCP server is unavailable',
        condition: {
          metric: 'available_servers_count',
          operator: 'lt',
          threshold: 1,
          time_window_minutes: 2,
        },
        severity: 'critical',
        enabled: true,
        trigger_count: 0,
      },
      {
        id: 'slow-execution-time',
        name: 'Slow Tool Execution',
        description: 'Average tool execution time exceeds 30 seconds',
        condition: {
          metric: 'avg_execution_time_ms',
          operator: 'gt',
          threshold: 30000,
          time_window_minutes: 10,
        },
        severity: 'medium',
        enabled: true,
        trigger_count: 0,
      },
      {
        id: 'connection-failures',
        name: 'High Connection Failures',
        description: 'Connection failure rate is high',
        condition: {
          metric: 'connection_failure_rate',
          operator: 'gt',
          threshold: 50,
          time_window_minutes: 5,
        },
        severity: 'high',
        enabled: true,
        trigger_count: 0,
      },
    ];

    for (const rule of defaultRules) {
      this.alertRules.set(rule.id, rule);
    }

    mcpLogger.info('Default alert rules configured', {
      rules_count: defaultRules.length,
    });
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen to connection events
    mcpClient.on('connection:established', (serverId, connection) => {
      this.handleConnectionEvent('established', serverId, connection);
    });

    mcpClient.on('connection:lost', (serverId, connection) => {
      this.handleConnectionEvent('lost', serverId, connection);
    });

    mcpClient.on('connection:failed', (serverId, error) => {
      this.trackError(error, { event: 'connection_failed', server_id: serverId });
    });

    // Listen to process events
    mcpProcessManager.on('process:failed', (serverId, processInfo, error) => {
      this.trackError(error, { event: 'process_failed', server_id: serverId });
    });

    mcpLogger.info('Monitoring event listeners configured');
  }

  /**
   * Perform health checks on all servers
   */
  private async performHealthChecks(): Promise<void> {
    const connections = mcpClient.getAllConnections();

    for (const connection of connections) {
      try {
        const healthCheck = await this.performServerHealthCheck(connection);
        this.healthChecks.set(connection.serverId, healthCheck);
      } catch (error) {
        mcpLogger.warn('Health check failed for server', {
          server_id: connection.serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Perform health check on specific server
   */
  private async performServerHealthCheck(connection: MCPConnection): Promise<MCPHealthCheck> {
    const startTime = Date.now();
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let error: string | undefined;

    try {
      // Check connection status
      if (connection.status !== 'connected') {
        status = 'unhealthy';
        error = `Connection status: ${connection.status}`;
      }

      // Check process health
      const processInfo = mcpProcessManager.getProcessInfo(connection.serverId);
      if (!processInfo || processInfo.status !== 'running') {
        status = 'unhealthy';
        error = `Process status: ${processInfo?.status || 'unknown'}`;
      } else if (processInfo.healthStatus === 'unhealthy') {
        status = 'degraded';
        error = 'Process health check failed';
      }

      // Check tool success rate
      const recentExecutions = this.executionHistory
        .filter(exec => exec.metadata.serverId === connection.serverId)
        .slice(-20); // Last 20 executions

      let toolSuccessRate = 1.0;
      if (recentExecutions.length > 0) {
        const successCount = recentExecutions.filter(exec => exec.success).length;
        toolSuccessRate = successCount / recentExecutions.length;

        if (toolSuccessRate < 0.5) {
          status = 'unhealthy';
        } else if (toolSuccessRate < 0.8) {
          status = 'degraded';
        }
      }

      // Calculate average execution time
      const avgExecutionTime = recentExecutions.length > 0
        ? recentExecutions.reduce((sum, exec) => sum + exec.executionTime, 0) / recentExecutions.length
        : 0;

      const responseTime = Date.now() - startTime;

      return {
        server_id: connection.serverId,
        status,
        last_check: new Date(),
        response_time_ms: responseTime,
        error,
        metrics: {
          tool_success_rate: toolSuccessRate,
          avg_execution_time: avgExecutionTime,
        },
      };

    } catch (error) {
      return {
        server_id: connection.serverId,
        status: 'unhealthy',
        last_check: new Date(),
        response_time_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        metrics: {
          tool_success_rate: 0,
          avg_execution_time: 0,
        },
      };
    }
  }

  /**
   * Collect and update metrics
   */
  private collectMetrics(): void {
    // Tool execution metrics
    const totalExecutions = this.executionHistory.length;
    const successfulExecutions = this.executionHistory.filter(exec => exec.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    const avgExecutionTime = totalExecutions > 0
      ? this.executionHistory.reduce((sum, exec) => sum + exec.executionTime, 0) / totalExecutions
      : 0;

    // Calculate executions per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentExecutions = this.executionHistory.filter(
      exec => new Date(exec.timestamp) >= oneHourAgo
    );

    this.metrics.tool_executions = {
      total: totalExecutions,
      successful: successfulExecutions,
      failed: failedExecutions,
      avg_execution_time: avgExecutionTime,
      executions_per_hour: recentExecutions.length,
    };

    // Server health metrics
    const healthChecks = Array.from(this.healthChecks.values());
    this.metrics.server_health = {
      total_servers: healthChecks.length,
      healthy_servers: healthChecks.filter(hc => hc.status === 'healthy').length,
      degraded_servers: healthChecks.filter(hc => hc.status === 'degraded').length,
      unavailable_servers: healthChecks.filter(hc => hc.status === 'unhealthy').length,
      avg_uptime: 0, // TODO: Implement uptime tracking
    };

    // Connection metrics
    const connections = mcpClient.getAllConnections();
    const activeConnections = connections.filter(conn => conn.status === 'connected').length;
    const failedConnections = connections.filter(conn => conn.status === 'failed').length;

    this.metrics.connection_metrics = {
      active_connections: activeConnections,
      failed_connections: failedConnections,
      reconnection_attempts: 0, // TODO: Track reconnection attempts
      avg_connection_time: 0, // TODO: Track connection times
    };

    // Error metrics
    const totalErrors = this.errorHistory.length;
    const connectionErrors = this.errorHistory.filter(
      err => err.context.event?.includes('connection')
    ).length;
    const executionErrors = this.errorHistory.filter(
      err => err.context.event?.includes('execution')
    ).length;

    // Calculate most common errors
    const errorCounts = new Map<string, number>();
    for (const errorRecord of this.errorHistory) {
      const errorMessage = errorRecord.error.message;
      errorCounts.set(errorMessage, (errorCounts.get(errorMessage) || 0) + 1);
    }

    const mostCommonErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));

    this.metrics.error_metrics = {
      total_errors: totalErrors,
      connection_errors: connectionErrors,
      execution_errors: executionErrors,
      configuration_errors: 0, // TODO: Track configuration errors
      most_common_errors: mostCommonErrors,
    };

    mcpLogger.debug('Metrics collected', this.metrics);
  }

  /**
   * Evaluate alert rules
   */
  private evaluateAlertRules(): void {
    for (const rule of Array.from(this.alertRules.values())) {
      if (!rule.enabled) continue;

      try {
        const metricValue = this.getMetricValue(rule.condition.metric);
        const shouldTrigger = this.evaluateCondition(
          metricValue,
          rule.condition.operator,
          rule.condition.threshold
        );

        if (shouldTrigger) {
          this.triggerAlert(rule, metricValue);
        }
      } catch (error) {
        mcpLogger.warn('Failed to evaluate alert rule', {
          rule_id: rule.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get metric value by name
   */
  private getMetricValue(metricName: string): number {
    switch (metricName) {
      case 'error_rate_percentage': {
        const { total, failed } = this.metrics.tool_executions;
        return total > 0 ? (failed / total) * 100 : 0;
      }

      case 'available_servers_count':
        return this.metrics.server_health.healthy_servers;

      case 'avg_execution_time_ms':
        return this.metrics.tool_executions.avg_execution_time;

      case 'connection_failure_rate': {
        const { active_connections, failed_connections } = this.metrics.connection_metrics;
        const totalConns = active_connections + failed_connections;
        return totalConns > 0 ? (failed_connections / totalConns) * 100 : 0;
      }

      default:
        throw new Error(`Unknown metric: ${metricName}`);
    }
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return value === threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  /**
   * Trigger alert
   */
  private triggerAlert(rule: MCPAlertRule, metricValue: number): void {
    const alertId = `${rule.id}_${Date.now()}`;

    const alert: MCPAlert = {
      id: alertId,
      rule_id: rule.id,
      severity: rule.severity,
      title: rule.name,
      description: `${rule.description}. Current value: ${metricValue.toFixed(2)}`,
      triggered_at: new Date(),
      metadata: {
        metric_value: metricValue,
        threshold: rule.condition.threshold,
        operator: rule.condition.operator,
      },
    };

    this.activeAlerts.set(alertId, alert);
    rule.trigger_count++;
    rule.last_triggered = new Date();

    this.emit('alert:triggered', alert);

    mcpLogger.warn('Alert triggered', {
      alert_id: alertId,
      rule_id: rule.id,
      severity: rule.severity,
      metric_value: metricValue,
    });
  }

  /**
   * Handle connection events
   */
  private handleConnectionEvent(event: string, serverId: string, connection: MCPConnection): void {
    mcpLogger.info('Connection event handled', {
      event,
      server_id: serverId,
      connection_status: connection.status,
    });

    // Update metrics based on event
    // This would be called from the existing event handlers
  }

  /**
   * Update execution metrics
   */
  private updateExecutionMetrics(execution: ToolExecutionResponse): void {
    // Metrics are updated in collectMetrics() method
    // This method can be used for real-time metric updates if needed
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(error: Error, context: any): void {
    // Error metrics are updated in collectMetrics() method
    // This method can be used for real-time error classification if needed
  }

  /**
   * Trace execution to LangFuse
   */
  private traceExecutionToLangFuse(execution: ToolExecutionResponse): void {
    try {
      const trace = createTrace('mcp-tool-execution', {
        userId: 'system',
        metadata: {
          tool_id: execution.toolId,
          execution_id: execution.id,
          server_id: execution.metadata.serverId,
          namespace: execution.metadata.namespace,
        },
        tags: ['mcp', 'tool-execution'],
      });

      if (trace) {
        const span = createSpan(trace, execution.toolId, {
          input: { tool_id: execution.toolId },
          metadata: {
            execution_id: execution.id,
            server_id: execution.metadata.serverId,
            namespace: execution.metadata.namespace,
          },
        });

        if (span) {
          endSpan(span, {
            output: execution.success ? execution.result : { error: execution.error },
            metadata: {
              success: execution.success,
              execution_time_ms: execution.executionTime,
            },
            level: execution.success ? 'DEFAULT' : 'ERROR',
            statusMessage: execution.success ? 'Success' : execution.error,
          });
        }
      }

    } catch (error) {
      mcpLogger.warn('Failed to trace execution to LangFuse', {
        execution_id: execution.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Trace error to LangFuse
   */
  private traceErrorToLangFuse(error: Error, context: any): void {
    try {
      const trace = createTrace('mcp-error', {
        userId: 'system',
        metadata: {
          error_type: error.name,
          error_message: error.message,
          context,
        },
        tags: ['mcp', 'error'],
      });

      if (trace) {
        const span = createSpan(trace, 'error-event', {
          input: { context },
          metadata: {
            error_type: error.name,
            error_message: error.message,
          },
        });

        if (span) {
          endSpan(span, {
            output: { error: error.message },
            metadata: {
              error_type: error.name,
              stack_trace: error.stack,
              context,
            },
            level: 'ERROR',
            statusMessage: error.message,
          });
        }
      }

    } catch (traceError) {
      mcpLogger.warn('Failed to trace error to LangFuse', {
        original_error: error.message,
        trace_error: traceError instanceof Error ? traceError.message : String(traceError),
      });
    }
  }
}

// Export singleton instance
export const mcpMonitoringSystem = new MCPMonitoringSystem();
