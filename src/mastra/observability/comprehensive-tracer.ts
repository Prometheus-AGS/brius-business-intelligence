/**
 * Comprehensive Tool Call Tracing with Request/Response/Error Capture
 * Constitutional requirement: Complete observability for all tool executions
 */

import crypto from 'crypto';
import { getLangFuseClient } from './langfuse-client';
import { getToolCallTracer } from './tool-tracer';
import { getAgentInteractionTracer } from './agent-tracer';
import { getWorkflowExecutionTracer } from './workflow-tracer';
import { withErrorHandling } from './error-handling';
import { rootLogger } from './logger';
import {
  TraceContext,
  TraceEvent,
  TraceEventType,
  TraceLevel,
  ComponentType,
  ToolCallMetadata,
  AgentInteractionMetadata,
  WorkflowExecutionMetadata,
  PerformanceMetrics,
  TraceError,
  ErrorSeverity,
  createTraceContext,
  createPerformanceMetrics,
  createTraceError,
  TraceEventSchema,
} from '../types/observability';

/**
 * Comprehensive execution context interface
 */
export interface ComprehensiveExecutionContext {
  component: ComponentType;
  operation: string;
  traceContext: TraceContext;
  startTime: Date;
  tags?: string[];
  metadata?: Record<string, any>;
  parentTrace?: {
    traceId: string;
    spanId?: string;
  };
}

/**
 * Comprehensive execution result interface
 */
export interface ComprehensiveExecutionResult<T = any> {
  success: boolean;
  output?: T;
  error?: Error;
  duration: number;
  performance: PerformanceMetrics;
  metadata?: Record<string, any>;
  warnings?: string[];
  contextualInfo?: Record<string, any>;
}

/**
 * Comprehensive tracing configuration
 */
export interface ComprehensiveTracingConfig {
  enabled: boolean;
  components: {
    tools: boolean;
    agents: boolean;
    workflows: boolean;
    llm: boolean;
    database: boolean;
    api: boolean;
    memory: boolean;
    system: boolean;
  };
  captureRequests: boolean;
  captureResponses: boolean;
  captureErrors: boolean;
  capturePerformance: boolean;
  maxRequestSize: number;
  maxResponseSize: number;
  sensitiveFields: string[];
  bufferSize: number;
  flushInterval: number;
  compressionEnabled: boolean;
  encryptSensitiveData: boolean;
}

/**
 * Default comprehensive tracing configuration
 */
const defaultComprehensiveTracingConfig: ComprehensiveTracingConfig = {
  enabled: true,
  components: {
    tools: true,
    agents: true,
    workflows: true,
    llm: true,
    database: true,
    api: true,
    memory: true,
    system: true,
  },
  captureRequests: true,
  captureResponses: true,
  captureErrors: true,
  capturePerformance: true,
  maxRequestSize: 25000, // 25KB for comprehensive tracing
  maxResponseSize: 125000, // 125KB for comprehensive tracing
  sensitiveFields: [
    'password', 'secret', 'token', 'key', 'credential', 'api_key',
    'auth', 'authorization', 'bearer', 'session', 'cookie', 'jwt',
    'private_key', 'public_key', 'certificate', 'ssn', 'social_security',
    'credit_card', 'card_number', 'cvv', 'pin', 'account_number'
  ],
  bufferSize: 1000,
  flushInterval: 5000, // 5 seconds
  compressionEnabled: true,
  encryptSensitiveData: true,
};

/**
 * Comprehensive Tracer Service
 * Constitutional requirement for complete system observability
 */
export class ComprehensiveTracer {
  private langfuseClient = getLangFuseClient();
  private toolTracer = getToolCallTracer();
  private agentTracer = getAgentInteractionTracer();
  private workflowTracer = getWorkflowExecutionTracer();
  private config: ComprehensiveTracingConfig;
  private eventBuffer: TraceEvent[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(config: Partial<ComprehensiveTracingConfig> = {}) {
    this.config = { ...defaultComprehensiveTracingConfig, ...config };
    this.initializeBuffering();

    rootLogger.info('Comprehensive tracer initialized for constitutional compliance', {
      enabled: this.config.enabled,
      components: this.config.components,
      buffer_size: this.config.bufferSize,
      flush_interval: this.config.flushInterval,
    });
  }

  /**
   * Initialize event buffering and periodic flushing
   */
  private initializeBuffering(): void {
    if (this.config.enabled && this.config.bufferSize > 0) {
      this.flushTimer = setInterval(() => {
        this.flushEventBuffer();
      }, this.config.flushInterval);

      // Handle process exit gracefully
      process.on('beforeExit', () => {
        this.flushEventBuffer();
        if (this.flushTimer) {
          clearInterval(this.flushTimer);
        }
      });
    }
  }

  /**
   * Trace any component execution with comprehensive observability
   */
  async traceExecution<T>(
    context: ComprehensiveExecutionContext,
    input: any,
    executor: () => Promise<T>
  ): Promise<T> {
    // Map component names for config lookup
    const componentConfigKey = context.component === 'agent' ? 'agents' : 
                              context.component === 'workflow' ? 'workflows' : 
                              context.component === 'tool' ? 'tools' :
                              context.component;
    
    if (!this.config.enabled || !this.config.components[componentConfigKey as keyof typeof this.config.components]) {
      return await executor();
    }

    const startTime = Date.now();
    let traceId: string | null = null;
    let spanId: string | null = null;

    try {
      // Start comprehensive trace
      const traceResult = await this.startComprehensiveTrace(context, input);
      traceId = traceResult.traceId;
      spanId = traceResult.spanId;

      // Execute the operation
      const result = await executor();

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Create comprehensive execution result
      const executionResult: ComprehensiveExecutionResult<T> = {
        success: true,
        output: result,
        duration,
        performance: createPerformanceMetrics(duration, {
          throughput: 1,
          errorRate: 0,
        }),
        metadata: {
          trace_id: traceId,
          span_id: spanId,
          constitutional_compliance: true,
        },
      };

      // Complete the trace
      await this.completeComprehensiveTrace(traceId, spanId, context, executionResult);

      // Log completion event
      await this.logTraceEvent({
        eventType: 'trace_completed',
        level: 'info',
        component: context.component,
        context: context.traceContext,
        message: `${context.component} execution completed successfully`,
        data: {
          operation: context.operation,
          duration,
          success: true,
        },
        performance: executionResult.performance,
      });

      return result;

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const traceError = this.createTraceError(error, context);

      const executionResult: ComprehensiveExecutionResult<T> = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
        performance: createPerformanceMetrics(duration, {
          errorRate: 1,
          throughput: 0,
        }),
        metadata: {
          trace_id: traceId,
          span_id: spanId,
          constitutional_compliance: true,
          error_handled: true,
        },
      };

      // Complete the trace with error
      await this.completeComprehensiveTrace(traceId, spanId, context, executionResult);

      // Log error event
      await this.logTraceEvent({
        eventType: 'error_occurred',
        level: 'error',
        component: context.component,
        context: context.traceContext,
        message: `${context.component} execution failed: ${traceError.message}`,
        data: {
          operation: context.operation,
          duration,
          success: false,
        },
        error: traceError,
        performance: executionResult.performance,
      });

      throw error;
    }
  }

  /**
   * Start a comprehensive trace with full context capture
   */
  private async startComprehensiveTrace(
    context: ComprehensiveExecutionContext,
    input: any
  ): Promise<{ traceId: string | null; spanId: string | null }> {
    return await withErrorHandling(
      async () => {
        let traceId: string | null = null;
        let spanId: string | null = null;

        // Route to appropriate specialized tracer
        switch (context.component) {
          case 'tool':
            if (this.toolTracer.isEnabled()) {
              traceId = await this.toolTracer.startToolTrace({
                toolId: context.traceContext.requestId || 'unknown',
                toolName: context.operation,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                workflowId: context.traceContext.workflowId,
                agentId: context.traceContext.agentId,
                parentTraceId: context.parentTrace?.traceId,
                metadata: {
                  ...context.metadata,
                  comprehensive_tracing: true,
                },
              }, input);
            }
            break;

          case 'agent':
            if (this.agentTracer.isEnabled()) {
              traceId = await this.agentTracer.startAgentTrace({
                agentId: context.traceContext.agentId || 'unknown',
                agentName: context.operation,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                workflowId: context.traceContext.workflowId,
                parentTraceId: context.parentTrace?.traceId,
                metadata: {
                  ...context.metadata,
                  comprehensive_tracing: true,
                },
              }, input);
            }
            break;

          case 'workflow':
            if (this.workflowTracer.isEnabled()) {
              traceId = await this.workflowTracer.startWorkflowTrace({
                workflowId: context.traceContext.workflowId || 'unknown',
                workflowName: context.operation,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                parentTraceId: context.parentTrace?.traceId,
                metadata: {
                  ...context.metadata,
                  comprehensive_tracing: true,
                },
              }, input);
            }
            break;

          default:
            // Create generic trace through LangFuse
            if (this.langfuseClient.isReady()) {
              traceId = await this.langfuseClient.createTrace({
                name: `${context.component}_${context.operation}`,
                input: this.config.captureRequests ? this.sanitizeData(input, 'request') : undefined,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                metadata: {
                  component: context.component,
                  operation: context.operation,
                  trace_context: context.traceContext,
                  parent_trace_id: context.parentTrace?.traceId,
                  parent_span_id: context.parentTrace?.spanId,
                  comprehensive_tracing: true,
                  constitutional_compliance: true,
                  ...context.metadata,
                },
                tags: [
                  context.component,
                  context.operation,
                  'comprehensive-tracing',
                  'constitutional-compliance',
                  ...(context.tags || []),
                ],
              });

              if (traceId) {
                spanId = await this.langfuseClient.createSpan({
                  traceId,
                  name: `${context.component}_execution`,
                  input: this.config.captureRequests ? this.sanitizeData(input, 'request') : undefined,
                  startTime: context.startTime,
                  metadata: {
                    component: context.component,
                    operation: context.operation,
                    comprehensive_tracing: true,
                    constitutional_compliance: true,
                  },
                });
              }
            }
            break;
        }

        // Log trace start event
        await this.logTraceEvent({
          eventType: 'trace_started',
          level: 'info',
          component: context.component,
          context: context.traceContext,
          message: `${context.component} execution started: ${context.operation}`,
          data: {
            trace_id: traceId,
            span_id: spanId,
            operation: context.operation,
            has_parent: Boolean(context.parentTrace),
          },
        });

        return { traceId, spanId };
      },
      {
        component: 'database',
        operation: 'start_trace',
        metadata: {
          target_component: context.component,
          operation: context.operation,
        },
      },
      'medium'
    );
  }

  /**
   * Complete a comprehensive trace with full result capture
   */
  private async completeComprehensiveTrace(
    traceId: string | null,
    spanId: string | null,
    context: ComprehensiveExecutionContext,
    result: ComprehensiveExecutionResult<any>
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!traceId) {
          return;
        }

        const endTime = new Date();
        const sanitizedOutput = this.config.captureResponses && result.success
          ? this.sanitizeData(result.output, 'response')
          : undefined;

        // Route to appropriate specialized tracer for completion
        switch (context.component) {
          case 'tool':
            if (this.toolTracer.isEnabled()) {
              await this.toolTracer.completeToolTrace(traceId, {
                toolId: context.traceContext.requestId || 'unknown',
                toolName: context.operation,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                workflowId: context.traceContext.workflowId,
                agentId: context.traceContext.agentId,
                metadata: context.metadata,
              }, {
                success: result.success,
                output: sanitizedOutput,
                error: result.error,
                duration: result.duration,
                metadata: {
                  ...result.metadata,
                  performance: result.performance,
                },
              });
            }
            break;

          case 'agent':
            if (this.agentTracer.isEnabled()) {
              await this.agentTracer.completeAgentTrace(traceId, {
                agentId: context.traceContext.agentId || 'unknown',
                agentName: context.operation,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                workflowId: context.traceContext.workflowId,
                metadata: context.metadata,
              }, {
                success: result.success,
                output: sanitizedOutput,
                error: result.error,
                duration: result.duration,
                metadata: result.metadata,
              });
            }
            break;

          case 'workflow':
            if (this.workflowTracer.isEnabled()) {
              await this.workflowTracer.completeWorkflowTrace(traceId, {
                workflowId: context.traceContext.workflowId || 'unknown',
                workflowName: context.operation,
                userId: context.traceContext.userId,
                sessionId: context.traceContext.sessionId,
                metadata: context.metadata,
              }, {
                success: result.success,
                output: sanitizedOutput,
                error: result.error,
                duration: result.duration,
                stepsExecuted: 1,
                stepsSkipped: 0,
                stepsFailed: result.success ? 0 : 1,
                metadata: result.metadata,
              });
            }
            break;

          default:
            // Complete generic trace through LangFuse
            if (this.langfuseClient.isReady() && spanId) {
              await this.langfuseClient.updateObservation(spanId, {
                output: sanitizedOutput,
                endTime,
                level: result.success ? 'DEFAULT' : 'ERROR',
                statusMessage: result.error
                  ? result.error.message
                  : 'Execution completed successfully',
                metadata: {
                  success: result.success,
                  duration_ms: result.duration,
                  performance: result.performance,
                  constitutional_compliance: true,
                  ...result.metadata,
                },
              });
            }
            break;
        }

        rootLogger.debug('Comprehensive trace completed', {
          trace_id: traceId,
          span_id: spanId,
          component: context.component,
          operation: context.operation,
          success: result.success,
          duration: result.duration,
        });
      },
      {
        component: 'database',
        operation: 'complete_trace',
        metadata: {
          trace_id: traceId,
          target_component: context.component,
          success: result.success,
        },
      },
      'medium'
    );
  }

  /**
   * Log a trace event with comprehensive metadata
   */
  async logTraceEvent(eventData: Partial<TraceEvent> & {
    eventType: TraceEventType;
    level: TraceLevel;
    component: ComponentType;
    context: TraceContext;
    message: string;
  }): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled) {
          return;
        }

        const event: TraceEvent = {
          eventId: crypto.randomUUID(),
          timestamp: new Date(),
          tags: eventData.tags || [],
          constitutional_compliance: true,
          ...eventData,
        };

        // Validate event data
        const validationResult = TraceEventSchema.safeParse(event);
        if (!validationResult.success) {
          rootLogger.warn('Invalid trace event data', {
            errors: validationResult.error.issues,
            event_type: event.eventType,
          });
          return;
        }

        // Add to buffer or send directly
        if (this.config.bufferSize > 0) {
          this.eventBuffer.push(event);

          // Flush if buffer is full
          if (this.eventBuffer.length >= this.config.bufferSize) {
            await this.flushEventBuffer();
          }
        } else {
          await this.sendTraceEvent(event);
        }
      },
      {
        component: 'database',
        operation: 'log_trace_event',
        metadata: {
          event_type: eventData.eventType,
          component: eventData.component,
        },
      },
      'low'
    );
  }

  /**
   * Flush buffered events to LangFuse
   */
  private async flushEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const eventsToFlush = [...this.eventBuffer];
    this.eventBuffer = [];

    return await withErrorHandling(
      async () => {
        if (!this.langfuseClient.isReady()) {
          rootLogger.warn('Cannot flush events - LangFuse client not ready', {
            events_count: eventsToFlush.length,
          });
          return;
        }

        // Send events in batches
        const batchSize = 10;
        for (let i = 0; i < eventsToFlush.length; i += batchSize) {
          const batch = eventsToFlush.slice(i, i + batchSize);
          await Promise.all(batch.map(event => this.sendTraceEvent(event)));
        }

        rootLogger.debug('Flushed trace events', {
          events_count: eventsToFlush.length,
        });
      },
      {
        component: 'database',
        operation: 'flush_event_buffer',
        metadata: {
          events_count: eventsToFlush.length,
        },
      },
      'low'
    );
  }

  /**
   * Send a single trace event to LangFuse
   */
  private async sendTraceEvent(event: TraceEvent): Promise<void> {
    try {
      await this.langfuseClient.createEvent({
        traceId: event.context.traceId,
        name: event.eventType,
        metadata: {
          event_id: event.eventId,
          component: event.component,
          level: event.level,
          tags: event.tags,
          constitutional_compliance: event.constitutional_compliance,
          trace_context: event.context,
          ...(event.performance && { performance: event.performance }),
          ...(event.error && { error_info: event.error }),
        },
        input: event.data,
        level: event.level.toUpperCase() as any,
        statusMessage: event.message,
        startTime: event.timestamp,
      });
    } catch (error) {
      rootLogger.error('Failed to send trace event', {
        error: error instanceof Error ? error.message : String(error),
        event_id: event.eventId,
        event_type: event.eventType,
      });
    }
  }

  /**
   * Create a standardized trace error
   */
  private createTraceError(error: unknown, context: ComprehensiveExecutionContext): TraceError {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    return createTraceError(
      errorObj.message,
      errorObj.name,
      this.determineErrorSeverity(errorObj, context),
      context.component,
      context.traceContext,
      {
        stack: errorObj.stack,
        cause: errorObj.cause as string,
        recoverable: this.isRecoverableError(errorObj, context),
        metadata: {
          operation: context.operation,
          component: context.component,
          timestamp: new Date().toISOString(),
        },
      }
    );
  }

  /**
   * Determine error severity based on error type and context
   */
  private determineErrorSeverity(error: Error, context: ComprehensiveExecutionContext): ErrorSeverity {
    // Critical errors
    if (error.name === 'SystemError' || error.message.includes('ECONNREFUSED')) {
      return 'critical';
    }

    // High severity for core components
    if (['database', 'api', 'system'].includes(context.component)) {
      return 'high';
    }

    // Medium for tools and agents
    if (['tool', 'agent', 'workflow'].includes(context.component)) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Determine if an error is recoverable
   */
  private isRecoverableError(error: Error, context: ComprehensiveExecutionContext): boolean {
    // Network errors are usually recoverable
    if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
      return true;
    }

    // Validation errors are usually not recoverable
    if (error.name === 'ValidationError' || error.name === 'TypeError') {
      return false;
    }

    // Tool and agent errors are usually recoverable
    if (['tool', 'agent'].includes(context.component)) {
      return true;
    }

    return false;
  }

  /**
   * Sanitize data for tracing (comprehensive version)
   */
  private sanitizeData(data: any, type: 'request' | 'response'): any {
    if (data === null || data === undefined) {
      return data;
    }

    const maxSize = type === 'request' ? this.config.maxRequestSize : this.config.maxResponseSize;
    const captureEnabled = type === 'request' ? this.config.captureRequests : this.config.captureResponses;

    if (!captureEnabled) {
      return { _captured: false, _reason: `${type}_capture_disabled` };
    }

    try {
      // Convert to string for size checking
      const dataStr = JSON.stringify(data);

      // Check size limit
      if (dataStr.length > maxSize) {
        return {
          _truncated: true,
          _original_size: dataStr.length,
          _max_size: maxSize,
          _type: type,
          data: dataStr.substring(0, maxSize) + '...[truncated]',
        };
      }

      // Remove sensitive fields
      if (typeof data === 'object' && data !== null) {
        return this.removeSensitiveFields(data);
      }

      return data;
    } catch (error) {
      return {
        _error: 'serialization_failed',
        _reason: error instanceof Error ? error.message : String(error),
        _type: type,
        _original_type: typeof data,
      };
    }
  }

  /**
   * Remove sensitive fields from data
   */
  private removeSensitiveFields(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeSensitiveFields(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      const isSensitive = this.config.sensitiveFields.some(field =>
        keyLower.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = this.config.encryptSensitiveData
          ? `[ENCRYPTED:${this.encryptValue(String(value))}]`
          : '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.removeSensitiveFields(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Simple encryption for sensitive values (placeholder)
   */
  private encryptValue(value: string): string {
    // In a real implementation, use proper encryption
    // This is a simple base64 encoding for demonstration
    return Buffer.from(value).toString('base64').substring(0, 16) + '...';
  }

  /**
   * Get comprehensive tracing statistics
   */
  async getTracingStats(): Promise<{
    enabled: boolean;
    components_enabled: Record<ComponentType, boolean>;
    buffer_size: number;
    buffered_events: number;
    langfuse_connected: boolean;
    specialized_tracers: {
      tool_tracer: boolean;
      agent_tracer: boolean;
      workflow_tracer: boolean;
    };
  }> {
    return {
      enabled: this.config.enabled,
      components_enabled: {
        tool: this.config.components.tools,
        agent: this.config.components.agents,
        workflow: this.config.components.workflows,
        llm: this.config.components.llm,
        database: this.config.components.database,
        api: this.config.components.api,
        memory: this.config.components.memory,
        system: this.config.components.system,
      },
      buffer_size: this.config.bufferSize,
      buffered_events: this.eventBuffer.length,
      langfuse_connected: this.langfuseClient.isReady(),
      specialized_tracers: {
        tool_tracer: this.toolTracer.isEnabled(),
        agent_tracer: this.agentTracer.isEnabled(),
        workflow_tracer: this.workflowTracer.isEnabled(),
      },
    };
  }

  /**
   * Update tracing configuration
   */
  updateConfig(newConfig: Partial<ComprehensiveTracingConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Restart buffering if configuration changed
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.initializeBuffering();

    rootLogger.info('Comprehensive tracer configuration updated', {
      enabled: this.config.enabled,
      components: this.config.components,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): ComprehensiveTracingConfig {
    return { ...this.config };
  }

  /**
   * Check if comprehensive tracing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.langfuseClient.isReady();
  }

  /**
   * Shutdown the comprehensive tracer gracefully
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Flush any remaining events
    await this.flushEventBuffer();

    rootLogger.info('Comprehensive tracer shut down gracefully');
  }
}

// Global singleton instance
let globalComprehensiveTracer: ComprehensiveTracer;

export function getComprehensiveTracer(): ComprehensiveTracer {
  if (!globalComprehensiveTracer) {
    globalComprehensiveTracer = new ComprehensiveTracer();
  }
  return globalComprehensiveTracer;
}

// Convenience function for tracing any execution
export async function traceExecution<T>(
  component: ComponentType,
  operation: string,
  input: any,
  executor: () => Promise<T>,
  additionalContext?: Partial<ComprehensiveExecutionContext>
): Promise<T> {
  const tracer = getComprehensiveTracer();
  const context: ComprehensiveExecutionContext = {
    component,
    operation,
    traceContext: createTraceContext({
      traceId: crypto.randomUUID(),
      ...additionalContext?.traceContext,
    }),
    startTime: new Date(),
    ...additionalContext,
  };

  return await tracer.traceExecution(context, input, executor);
}

// Constitutional compliance exports
export default getComprehensiveTracer;
