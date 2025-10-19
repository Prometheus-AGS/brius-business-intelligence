/**
 * Enhanced Tracing Middleware for Tool Calls
 * Constitutional requirement: Comprehensive tool call tracing with request/response/error capture
 */

import { getLangFuseClient, LangFuseTraceData, LangFuseSpanData } from './langfuse-client.js';
import { withErrorHandling } from './error-handling.js';
import { rootLogger } from './logger.js';
import { randomUUID } from 'crypto';

// Tool execution context
export interface ToolExecutionContext {
  toolId: string;
  toolName: string;
  userId?: string;
  agentId?: string;
  workflowId?: string;
  sessionId?: string;
  parentTraceId?: string;
  parentSpanId?: string;
  metadata?: Record<string, unknown>;
}

// Tool execution result
export interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  error?: Error;
  duration: number;
  metadata?: Record<string, unknown>;
}

// Tool tracing configuration
export interface ToolTracingConfig {
  enabled: boolean;
  captureInput: boolean;
  captureOutput: boolean;
  captureErrors: boolean;
  maxInputSize: number;
  maxOutputSize: number;
  sensitiveFields: string[];
}

// Default tracing configuration
const defaultTracingConfig: ToolTracingConfig = {
  enabled: true,
  captureInput: true,
  captureOutput: true,
  captureErrors: true,
  maxInputSize: 10000, // 10KB
  maxOutputSize: 50000, // 50KB
  sensitiveFields: ['password', 'secret', 'token', 'key', 'credential'],
};

/**
 * Enhanced Tool Call Tracer
 * Constitutional requirement for comprehensive tool call observability
 */
export class ToolCallTracer {
  private langfuseClient = getLangFuseClient();
  private config: ToolTracingConfig;

  constructor(config: Partial<ToolTracingConfig> = {}) {
    this.config = { ...defaultTracingConfig, ...config };

    rootLogger.debug('Tool call tracer initialized', {
      enabled: this.config.enabled,
      captureInput: this.config.captureInput,
      captureOutput: this.config.captureOutput,
    });
  }

  /**
   * Create a new trace for tool execution
   */
  async startToolTrace(context: ToolExecutionContext, input: unknown): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled) {
          return null;
        }

        const traceData: LangFuseTraceData = {
          name: `tool_call_${context.toolName}`,
          userId: context.userId,
          sessionId: context.sessionId,
          metadata: {
            tool_id: context.toolId,
            tool_name: context.toolName,
            agent_id: context.agentId,
            workflow_id: context.workflowId,
            parent_trace_id: context.parentTraceId,
            execution_type: 'tool_call',
            constitutional_compliance: true,
            ...context.metadata,
          },
          tags: [
            'tool-call',
            context.toolName,
            ...(context.agentId ? ['agent'] : []),
            ...(context.workflowId ? ['workflow'] : []),
          ],
          input: this.config.captureInput ? this.sanitizeData(input) : undefined,
          version: '1.0.0',
        };

        const traceId = await this.langfuseClient.createTrace(traceData);

        if (traceId) {
          rootLogger.debug('Tool call trace started', {
            traceId,
            toolName: context.toolName,
            toolId: context.toolId,
            userId: context.userId,
          });
        }

        return traceId;
      },
      {
        component: 'tool',
        operation: 'start_tool_trace',
        metadata: {
          toolName: context.toolName,
          toolId: context.toolId,
        },
      },
      'low' // Low priority to avoid impacting tool performance
    );
  }

  /**
   * Create a span for detailed tool operation tracking
   */
  async startToolSpan(
    traceId: string,
    spanName: string,
    context: ToolExecutionContext,
    input?: unknown,
    parentSpanId?: string
  ): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !traceId) {
          return null;
        }

        const spanData: LangFuseSpanData = {
          traceId,
          name: spanName,
          input: this.config.captureInput && input ? this.sanitizeData(input) : undefined,
          metadata: {
            tool_id: context.toolId,
            tool_name: context.toolName,
            span_type: 'tool_operation',
            constitutional_compliance: true,
            ...context.metadata,
          },
          startTime: new Date(),
          parentObservationId: parentSpanId || context.parentSpanId,
          version: '1.0.0',
        };

        const spanId = await this.langfuseClient.createSpan(spanData);

        if (spanId) {
          rootLogger.debug('Tool span started', {
            spanId,
            traceId,
            spanName,
            toolName: context.toolName,
          });
        }

        return spanId;
      },
      {
        component: 'tool',
        operation: 'start_tool_span',
        metadata: {
          traceId,
          spanName,
          toolName: context.toolName,
        },
      },
      'low'
    );
  }

  /**
   * Complete a tool trace with results
   */
  async completeToolTrace(
    traceId: string | null,
    context: ToolExecutionContext,
    result: ToolExecutionResult
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !traceId) {
          return;
        }

        // Create a completion event
        await this.langfuseClient.createEvent({
          traceId,
          name: 'tool_call_completed',
          metadata: {
            tool_id: context.toolId,
            tool_name: context.toolName,
            success: result.success,
            duration_ms: result.duration,
            has_error: Boolean(result.error),
            constitutional_compliance: true,
            ...result.metadata,
          },
          output: this.config.captureOutput && result.success ? this.sanitizeData(result.output) : undefined,
          level: result.success ? 'DEFAULT' : 'ERROR',
          statusMessage: result.error ? result.error.message : 'Tool execution completed',
        });

        // If there was an error and we're capturing errors
        if (result.error && this.config.captureErrors) {
          await this.langfuseClient.createEvent({
            traceId,
            name: 'tool_call_error',
            metadata: {
              tool_id: context.toolId,
              tool_name: context.toolName,
              error_type: result.error.constructor.name,
              error_message: result.error.message,
              duration_ms: result.duration,
              constitutional_compliance: true,
            },
            output: {
              error: {
                name: result.error.name,
                message: result.error.message,
                stack: result.error.stack,
              },
            },
            level: 'ERROR',
            statusMessage: `Tool execution failed: ${result.error.message}`,
          });
        }

        rootLogger.debug('Tool call trace completed', {
          traceId,
          toolName: context.toolName,
          success: result.success,
          duration: result.duration,
        });
      },
      {
        component: 'tool',
        operation: 'complete_tool_trace',
        metadata: {
          traceId,
          toolName: context.toolName,
          success: result.success,
        },
      },
      'low'
    );
  }

  /**
   * Complete a tool span with results
   */
  async completeToolSpan(
    spanId: string | null,
    result: ToolExecutionResult,
    endTime?: Date
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !spanId) {
          return;
        }

        // Note: LangFuse SDK may not have direct span update methods
        // This would be handled through the updateObservation method
        await this.langfuseClient.updateObservation(spanId, {
          output: this.config.captureOutput && result.success ? this.sanitizeData(result.output) : undefined,
          endTime: endTime || new Date(),
          level: result.success ? 'DEFAULT' : 'ERROR',
          statusMessage: result.error ? result.error.message : 'Operation completed',
          metadata: {
            success: result.success,
            duration_ms: result.duration,
            constitutional_compliance: true,
            ...result.metadata,
          },
        });

        rootLogger.debug('Tool span completed', {
          spanId,
          success: result.success,
          duration: result.duration,
        });
      },
      {
        component: 'tool',
        operation: 'complete_tool_span',
        metadata: {
          spanId,
          success: result.success,
        },
      },
      'low'
    );
  }

  /**
   * Trace a complete tool execution with automatic timing
   */
  async traceToolExecution<T>(
    context: ToolExecutionContext,
    input: unknown,
    executor: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let traceId: string | null = null;
    let result: ToolExecutionResult;

    try {
      // Start trace
      traceId = await this.startToolTrace(context, input);

      // Execute tool
      const output = await executor();

      // Calculate duration
      const duration = Date.now() - startTime;

      result = {
        success: true,
        output,
        duration,
      };

      // Complete trace
      await this.completeToolTrace(traceId, context, result);

      return output;

    } catch (error) {
      const duration = Date.now() - startTime;

      result = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
      };

      // Complete trace with error
      await this.completeToolTrace(traceId, context, result);

      throw error;
    }
  }

  /**
   * Create a child tracer for nested operations
   */
  createChildTracer(parentContext: ToolExecutionContext): ToolCallTracer {
    return new ToolCallTracer(this.config);
  }

  /**
   * Sanitize data for tracing (remove sensitive information and limit size)
   */
  private sanitizeData(data: unknown): unknown {
    try {
      if (data === null || data === undefined) {
        return data;
      }

      // Convert to string for size checking
      const dataStr = JSON.stringify(data);
      const maxSize = this.config.maxInputSize;

      // Check size limit
      if (dataStr.length > maxSize) {
        const truncated = dataStr.substring(0, maxSize);
        return {
          _truncated: true,
          _originalSize: dataStr.length,
          _maxSize: maxSize,
          data: truncated + '...',
        };
      }

      // Remove sensitive fields
      if (typeof data === 'object' && data !== null) {
        const sanitized = this.removeSensitiveFields(data);
        return sanitized;
      }

      return data;
    } catch (error) {
      rootLogger.warn('Failed to sanitize data', {
        component: 'tool',
        operation: 'sanitize_data',
        error: error instanceof Error ? error.message : String(error),
      });
      return { _sanitization_error: true };
    }
  }

  /**
   * Remove sensitive fields from object
   */
  private removeSensitiveFields(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeSensitiveFields(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      const isSensitive = this.config.sensitiveFields.some(field =>
        keyLower.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.removeSensitiveFields(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Update tracing configuration
   */
  updateConfig(newConfig: Partial<ToolTracingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    rootLogger.debug('Tool tracer configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ToolTracingConfig {
    return { ...this.config };
  }

  /**
   * Check if tracing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.langfuseClient.isReady();
  }
}

// Global singleton instance
let globalToolTracer: ToolCallTracer;

export function getToolCallTracer(): ToolCallTracer {
  if (!globalToolTracer) {
    globalToolTracer = new ToolCallTracer();
  }
  return globalToolTracer;
}

// Convenience function for simple tool tracing
export async function traceToolCall<T>(
  toolName: string,
  input: unknown,
  executor: () => Promise<T>,
  context: Partial<ToolExecutionContext> = {}
): Promise<T> {
  const tracer = getToolCallTracer();
  const fullContext: ToolExecutionContext = {
    toolId: randomUUID(),
    toolName,
    ...context,
  };

  return await tracer.traceToolExecution(fullContext, input, executor);
}

// Constitutional compliance exports
export default getToolCallTracer;