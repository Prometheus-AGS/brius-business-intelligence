/**
 * Enhanced Agent Interaction Tracing Service
 * Constitutional requirement: Comprehensive agent interaction tracing with full observability
 */

import { getLangFuseClient, LangFuseTraceData, LangFuseSpanData, LangFuseGenerationData } from './langfuse-client.js';
import { withErrorHandling } from './error-handling.js';
import { rootLogger } from './logger.js';
import { randomUUID } from 'crypto';

// Agent execution context
export interface AgentExecutionContext {
  agentId: string;
  agentName: string;
  userId?: string;
  sessionId?: string;
  workflowId?: string;
  parentTraceId?: string;
  parentSpanId?: string;
  metadata?: Record<string, any>;
}

// Agent interaction types
export type AgentInteractionType =
  | 'agent_creation'
  | 'agent_execution'
  | 'memory_access'
  | 'tool_usage'
  | 'llm_generation'
  | 'agent_communication'
  | 'state_change';

// Agent execution result
export interface AgentExecutionResult {
  success: boolean;
  output?: any;
  error?: Error;
  duration: number;
  tokensUsed?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  toolsUsed?: string[];
  memoryAccessed?: boolean;
  metadata?: Record<string, any>;
}

// Agent interaction event
export interface AgentInteractionEvent {
  type: AgentInteractionType;
  timestamp: Date;
  agentId: string;
  data?: any;
  metadata?: Record<string, any>;
}

// Agent tracing configuration
export interface AgentTracingConfig {
  enabled: boolean;
  traceMemoryAccess: boolean;
  traceToolUsage: boolean;
  traceLLMGenerations: boolean;
  traceStateChanges: boolean;
  captureInput: boolean;
  captureOutput: boolean;
  maxInputSize: number;
  maxOutputSize: number;
  sensitiveFields: string[];
}

// Default agent tracing configuration
const defaultAgentTracingConfig: AgentTracingConfig = {
  enabled: true,
  traceMemoryAccess: true,
  traceToolUsage: true,
  traceLLMGenerations: true,
  traceStateChanges: true,
  captureInput: true,
  captureOutput: true,
  maxInputSize: 20000, // 20KB for agent inputs
  maxOutputSize: 100000, // 100KB for agent outputs
  sensitiveFields: ['password', 'secret', 'token', 'key', 'credential', 'api_key'],
};

/**
 * Enhanced Agent Interaction Tracer
 * Constitutional requirement for comprehensive agent observability
 */
export class AgentInteractionTracer {
  private langfuseClient = getLangFuseClient();
  private config: AgentTracingConfig;

  constructor(config: Partial<AgentTracingConfig> = {}) {
    this.config = { ...defaultAgentTracingConfig, ...config };

    rootLogger.debug('Agent interaction tracer initialized', {
      enabled: this.config.enabled,
      trace_memory_access: this.config.traceMemoryAccess,
      trace_tool_usage: this.config.traceToolUsage,
      trace_llm_generations: this.config.traceLLMGenerations,
    });
  }

  /**
   * Start a new agent execution trace
   */
  async startAgentTrace(context: AgentExecutionContext, input: any): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled) {
          return null;
        }

        const traceData: LangFuseTraceData = {
          name: `agent_execution_${context.agentName}`,
          userId: context.userId,
          sessionId: context.sessionId,
          metadata: {
            agent_id: context.agentId,
            agent_name: context.agentName,
            workflow_id: context.workflowId,
            parent_trace_id: context.parentTraceId,
            execution_type: 'agent_execution',
            constitutional_compliance: true,
            ...context.metadata,
          },
          tags: [
            'agent-execution',
            context.agentName,
            ...(context.workflowId ? ['workflow'] : []),
            ...(context.sessionId ? ['session'] : []),
          ],
          input: this.config.captureInput ? this.sanitizeData(input) : undefined,
          version: '1.0.0',
        };

        const traceId = await this.langfuseClient.createTrace(traceData);

        if (traceId) {
          rootLogger.debug('Agent execution trace started', {
            traceId,
            agentName: context.agentName,
            agentId: context.agentId,
            userId: context.userId,
          });
        }

        return traceId;
      },
      {
        component: 'agent',
        operation: 'start_agent_trace',
        metadata: {
          agentName: context.agentName,
          agentId: context.agentId,
        },
      },
      'low'
    );
  }

  /**
   * Create a span for specific agent operations
   */
  async startAgentSpan(
    traceId: string,
    spanName: string,
    context: AgentExecutionContext,
    interactionType: AgentInteractionType,
    input?: any,
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
            agent_id: context.agentId,
            agent_name: context.agentName,
            interaction_type: interactionType,
            span_type: 'agent_operation',
            constitutional_compliance: true,
            ...context.metadata,
          },
          startTime: new Date(),
          parentObservationId: parentSpanId || context.parentSpanId,
          version: '1.0.0',
        };

        const spanId = await this.langfuseClient.createSpan(spanData);

        if (spanId) {
          rootLogger.debug('Agent span started', {
            spanId,
            traceId,
            spanName,
            agentName: context.agentName,
            interactionType,
          });
        }

        return spanId;
      },
      {
        component: 'agent',
        operation: 'start_agent_span',
        metadata: {
          traceId,
          spanName,
          agentName: context.agentName,
          interactionType,
        },
      },
      'low'
    );
  }

  /**
   * Trace LLM generation within agent execution
   */
  async traceLLMGeneration(
    traceId: string,
    context: AgentExecutionContext,
    generationData: {
      input: any;
      output: any;
      model: string;
      tokensUsed?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      latency?: number;
      parentSpanId?: string;
    }
  ): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !this.config.traceLLMGenerations || !traceId) {
          return null;
        }

        const generation: LangFuseGenerationData = {
          traceId,
          name: `llm_generation_${context.agentName}`,
          input: this.config.captureInput ? this.sanitizeData(generationData.input) : undefined,
          output: this.config.captureOutput ? this.sanitizeData(generationData.output) : undefined,
          model: generationData.model,
          usage: generationData.tokensUsed,
          metadata: {
            agent_id: context.agentId,
            agent_name: context.agentName,
            generation_type: 'agent_llm_call',
            latency_ms: generationData.latency,
            constitutional_compliance: true,
            ...context.metadata,
          },
          startTime: new Date(Date.now() - (generationData.latency || 0)),
          endTime: new Date(),
          parentObservationId: generationData.parentSpanId || context.parentSpanId,
          version: '1.0.0',
        };

        const generationId = await this.langfuseClient.createGeneration(generation);

        if (generationId) {
          rootLogger.debug('Agent LLM generation traced', {
            generationId,
            traceId,
            agentName: context.agentName,
            model: generationData.model,
            tokensUsed: generationData.tokensUsed?.totalTokens,
          });
        }

        return generationId;
      },
      {
        component: 'agent',
        operation: 'trace_llm_generation',
        metadata: {
          traceId,
          agentName: context.agentName,
          model: generationData.model,
        },
      },
      'low'
    );
  }

  /**
   * Trace agent memory access
   */
  async traceMemoryAccess(
    traceId: string,
    context: AgentExecutionContext,
    memoryOperation: {
      operation: 'read' | 'write' | 'search' | 'delete';
      memoryType: 'short_term' | 'long_term' | 'episodic' | 'semantic';
      query?: string;
      data?: any;
      results?: any;
      parentSpanId?: string;
    }
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !this.config.traceMemoryAccess || !traceId) {
          return;
        }

        await this.langfuseClient.createEvent({
          traceId,
          name: `memory_${memoryOperation.operation}`,
          metadata: {
            agent_id: context.agentId,
            agent_name: context.agentName,
            memory_operation: memoryOperation.operation,
            memory_type: memoryOperation.memoryType,
            has_query: Boolean(memoryOperation.query),
            has_results: Boolean(memoryOperation.results),
            constitutional_compliance: true,
            ...context.metadata,
          },
          input: this.config.captureInput ? this.sanitizeData({
            operation: memoryOperation.operation,
            memoryType: memoryOperation.memoryType,
            query: memoryOperation.query,
            data: memoryOperation.data,
          }) : undefined,
          output: this.config.captureOutput ? this.sanitizeData(memoryOperation.results) : undefined,
          level: 'DEFAULT',
          statusMessage: `Agent ${memoryOperation.operation} ${memoryOperation.memoryType} memory`,
          parentObservationId: memoryOperation.parentSpanId || context.parentSpanId,
        });

        rootLogger.debug('Agent memory access traced', {
          traceId,
          agentName: context.agentName,
          operation: memoryOperation.operation,
          memoryType: memoryOperation.memoryType,
        });
      },
      {
        component: 'agent',
        operation: 'trace_memory_access',
        metadata: {
          traceId,
          agentName: context.agentName,
          memoryOperation: memoryOperation.operation,
        },
      },
      'low'
    );
  }

  /**
   * Complete an agent execution trace
   */
  async completeAgentTrace(
    traceId: string | null,
    context: AgentExecutionContext,
    result: AgentExecutionResult
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !traceId) {
          return;
        }

        // Create completion event
        await this.langfuseClient.createEvent({
          traceId,
          name: 'agent_execution_completed',
          metadata: {
            agent_id: context.agentId,
            agent_name: context.agentName,
            success: result.success,
            duration_ms: result.duration,
            tokens_used: result.tokensUsed?.totalTokens,
            tools_used_count: result.toolsUsed?.length || 0,
            tools_used: result.toolsUsed || [],
            memory_accessed: result.memoryAccessed,
            has_error: Boolean(result.error),
            constitutional_compliance: true,
            ...result.metadata,
          },
          output: this.config.captureOutput && result.success ? this.sanitizeData(result.output) : undefined,
          level: result.success ? 'DEFAULT' : 'ERROR',
          statusMessage: result.error ? result.error.message : 'Agent execution completed',
        });

        // If there was an error, create detailed error event
        if (result.error) {
          await this.langfuseClient.createEvent({
            traceId,
            name: 'agent_execution_error',
            metadata: {
              agent_id: context.agentId,
              agent_name: context.agentName,
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
            statusMessage: `Agent execution failed: ${result.error.message}`,
          });
        }

        rootLogger.debug('Agent execution trace completed', {
          traceId,
          agentName: context.agentName,
          success: result.success,
          duration: result.duration,
          tokensUsed: result.tokensUsed?.totalTokens,
        });
      },
      {
        component: 'agent',
        operation: 'complete_agent_trace',
        metadata: {
          traceId,
          agentName: context.agentName,
          success: result.success,
        },
      },
      'low'
    );
  }

  /**
   * Trace complete agent execution with automatic timing
   */
  async traceAgentExecution<T>(
    context: AgentExecutionContext,
    input: any,
    executor: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let traceId: string | null = null;
    let result: AgentExecutionResult;

    try {
      // Start trace
      traceId = await this.startAgentTrace(context, input);

      // Execute agent
      const output = await executor();

      // Calculate duration
      const duration = Date.now() - startTime;

      result = {
        success: true,
        output,
        duration,
      };

      // Complete trace
      await this.completeAgentTrace(traceId, context, result);

      return output;

    } catch (error) {
      const duration = Date.now() - startTime;

      result = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
      };

      // Complete trace with error
      await this.completeAgentTrace(traceId, context, result);

      throw error;
    }
  }

  /**
   * Log agent interaction event
   */
  async logAgentInteraction(
    traceId: string,
    context: AgentExecutionContext,
    event: AgentInteractionEvent
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !traceId) {
          return;
        }

        await this.langfuseClient.createEvent({
          traceId,
          name: `agent_${event.type}`,
          metadata: {
            agent_id: context.agentId,
            agent_name: context.agentName,
            interaction_type: event.type,
            timestamp: event.timestamp.toISOString(),
            constitutional_compliance: true,
            ...event.metadata,
          },
          input: this.config.captureInput ? this.sanitizeData(event.data) : undefined,
          level: 'DEFAULT',
          statusMessage: `Agent ${event.type} interaction`,
          startTime: event.timestamp,
        });

        rootLogger.debug('Agent interaction logged', {
          traceId,
          agentName: context.agentName,
          interactionType: event.type,
        });
      },
      {
        component: 'agent',
        operation: 'log_agent_interaction',
        metadata: {
          traceId,
          agentName: context.agentName,
          interactionType: event.type,
        },
      },
      'low'
    );
  }

  /**
   * Create a child tracer for nested agent operations
   */
  createChildTracer(parentContext: AgentExecutionContext): AgentInteractionTracer {
    return new AgentInteractionTracer(this.config);
  }

  /**
   * Sanitize data for tracing (remove sensitive information and limit size)
   */
  private sanitizeData(data: any): any {
    return withErrorHandling(
      () => {
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
      },
      {
        component: 'agent',
        operation: 'sanitize_data',
      },
      'low'
    );
  }

  /**
   * Remove sensitive fields from object
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
  updateConfig(newConfig: Partial<AgentTracingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    rootLogger.debug('Agent tracer configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentTracingConfig {
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
let globalAgentTracer: AgentInteractionTracer;

export function getAgentInteractionTracer(): AgentInteractionTracer {
  if (!globalAgentTracer) {
    globalAgentTracer = new AgentInteractionTracer();
  }
  return globalAgentTracer;
}

// Convenience function for simple agent tracing
export async function traceAgentExecution<T>(
  agentName: string,
  input: any,
  executor: () => Promise<T>,
  context: Partial<AgentExecutionContext> = {}
): Promise<T> {
  const tracer = getAgentInteractionTracer();
  const fullContext: AgentExecutionContext = {
    agentId: randomUUID(),
    agentName,
    ...context,
  };

  return await tracer.traceAgentExecution(fullContext, input, executor);
}

// Constitutional compliance exports
export default getAgentInteractionTracer;