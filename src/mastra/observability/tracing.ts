import { randomUUID } from 'crypto';
import { mcpLogger } from './logger.js';

/**
 * Comprehensive Tracing System
 * Enhanced tracing for all agent interactions, workflows, and API calls
 * Provides detailed observability across the entire business intelligence system
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationType: 'agent' | 'workflow' | 'tool' | 'api' | 'memory' | 'knowledge';
  operationName: string;
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  metadata?: Record<string, any>;
  startTime: number;
  tags?: Record<string, string>;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}

export interface TraceSpan {
  context: TraceContext;
  events: SpanEvent[];
  status: 'running' | 'completed' | 'error';
  endTime?: number;
  duration?: number;
  result?: any;
  error?: Error;
  children: TraceSpan[];
}

/**
 * Central trace manager for the application
 */
class TraceManager {
  private activeTraces = new Map<string, TraceSpan>();
  private completedTraces: TraceSpan[] = [];
  private maxCompletedTraces = 1000;

  /**
   * Starts a new trace
   */
  startTrace(
    operationType: TraceContext['operationType'],
    operationName: string,
    options: {
      userId?: string;
      sessionId?: string;
      conversationId?: string;
      parentSpanId?: string;
      metadata?: Record<string, any>;
      tags?: Record<string, string>;
    } = {}
  ): TraceSpan {
    const traceId = randomUUID();
    const spanId = randomUUID();

    const context: TraceContext = {
      traceId,
      spanId,
      parentSpanId: options.parentSpanId,
      operationType,
      operationName,
      userId: options.userId,
      sessionId: options.sessionId,
      conversationId: options.conversationId,
      metadata: options.metadata,
      startTime: Date.now(),
      tags: options.tags,
    };

    const span: TraceSpan = {
      context,
      events: [],
      status: 'running',
      children: [],
    };

    this.activeTraces.set(traceId, span);

    mcpLogger.info('Trace started', {
      trace_id: traceId,
      span_id: spanId,
      operation_type: operationType,
      operation_name: operationName,
      user_id: options.userId,
      parent_span_id: options.parentSpanId,
    });

    return span;
  }

  /**
   * Starts a child span within an existing trace
   */
  startChildSpan(
    parentTrace: TraceSpan,
    operationType: TraceContext['operationType'],
    operationName: string,
    metadata?: Record<string, any>
  ): TraceSpan {
    const spanId = randomUUID();

    const context: TraceContext = {
      traceId: parentTrace.context.traceId,
      spanId,
      parentSpanId: parentTrace.context.spanId,
      operationType,
      operationName,
      userId: parentTrace.context.userId,
      sessionId: parentTrace.context.sessionId,
      conversationId: parentTrace.context.conversationId,
      metadata,
      startTime: Date.now(),
      tags: parentTrace.context.tags,
    };

    const childSpan: TraceSpan = {
      context,
      events: [],
      status: 'running',
      children: [],
    };

    parentTrace.children.push(childSpan);

    mcpLogger.debug('Child span started', {
      trace_id: context.traceId,
      span_id: spanId,
      parent_span_id: context.parentSpanId,
      operation_type: operationType,
      operation_name: operationName,
    });

    return childSpan;
  }

  /**
   * Adds an event to a span
   */
  addEvent(span: TraceSpan, name: string, attributes?: Record<string, any>): void {
    const event: SpanEvent = {
      name,
      timestamp: Date.now(),
      attributes,
    };

    span.events.push(event);

    mcpLogger.debug('Span event added', {
      trace_id: span.context.traceId,
      span_id: span.context.spanId,
      event_name: name,
      attributes,
    });
  }

  /**
   * Completes a trace successfully
   */
  completeTrace(span: TraceSpan, result?: any): void {
    const endTime = Date.now();
    const duration = endTime - span.context.startTime;

    span.status = 'completed';
    span.endTime = endTime;
    span.duration = duration;
    span.result = result;

    // Remove from active traces
    this.activeTraces.delete(span.context.traceId);

    // Add to completed traces (with size limit)
    this.completedTraces.unshift(span);
    if (this.completedTraces.length > this.maxCompletedTraces) {
      this.completedTraces.pop();
    }

    mcpLogger.info('Trace completed', {
      trace_id: span.context.traceId,
      span_id: span.context.spanId,
      operation_type: span.context.operationType,
      operation_name: span.context.operationName,
      duration_ms: duration,
      child_spans: this.countChildSpans(span),
      events: span.events.length,
    });
  }

  /**
   * Marks a trace as failed
   */
  failTrace(span: TraceSpan, error: Error): void {
    const endTime = Date.now();
    const duration = endTime - span.context.startTime;

    span.status = 'error';
    span.endTime = endTime;
    span.duration = duration;
    span.error = error;

    // Remove from active traces
    this.activeTraces.delete(span.context.traceId);

    // Add to completed traces
    this.completedTraces.unshift(span);
    if (this.completedTraces.length > this.maxCompletedTraces) {
      this.completedTraces.pop();
    }

    mcpLogger.error('Trace failed', {
      trace_id: span.context.traceId,
      span_id: span.context.spanId,
      operation_type: span.context.operationType,
      operation_name: span.context.operationName,
      duration_ms: duration,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }

  /**
   * Gets an active trace by ID
   */
  getActiveTrace(traceId: string): TraceSpan | undefined {
    return this.activeTraces.get(traceId);
  }

  /**
   * Gets trace statistics
   */
  getStatistics() {
    const activeCount = this.activeTraces.size;
    const completedCount = this.completedTraces.length;

    const operationTypes = new Map<string, number>();
    const avgDurations = new Map<string, number>();
    const errorRates = new Map<string, { total: number; errors: number }>();

    // Analyze completed traces
    this.completedTraces.forEach(trace => {
      const opType = trace.context.operationType;

      // Count by operation type
      operationTypes.set(opType, (operationTypes.get(opType) || 0) + 1);

      // Calculate average durations
      if (trace.duration) {
        const current = avgDurations.get(opType) || 0;
        const count = operationTypes.get(opType) || 1;
        avgDurations.set(opType, (current * (count - 1) + trace.duration) / count);
      }

      // Track error rates
      const errorStats = errorRates.get(opType) || { total: 0, errors: 0 };
      errorStats.total++;
      if (trace.status === 'error') {
        errorStats.errors++;
      }
      errorRates.set(opType, errorStats);
    });

    return {
      active_traces: activeCount,
      completed_traces: completedCount,
      operation_types: Object.fromEntries(operationTypes),
      average_durations_ms: Object.fromEntries(avgDurations),
      error_rates: Object.fromEntries(
        Array.from(errorRates.entries()).map(([op, stats]) => [
          op,
          {
            error_rate: stats.total > 0 ? (stats.errors / stats.total) * 100 : 0,
            total_operations: stats.total,
            failed_operations: stats.errors,
          },
        ])
      ),
    };
  }

  /**
   * Gets recent traces for debugging
   */
  getRecentTraces(limit: number = 10): TraceSpan[] {
    return this.completedTraces.slice(0, limit);
  }

  /**
   * Counts child spans recursively
   */
  private countChildSpans(span: TraceSpan): number {
    let count = span.children.length;
    span.children.forEach(child => {
      count += this.countChildSpans(child);
    });
    return count;
  }
}

// Global trace manager instance
export const traceManager = new TraceManager();

/**
 * Agent execution tracer
 */
class AgentTracer {
  private span: TraceSpan;
  private agentName: string;

  constructor(
    agentName: string,
    options: {
      userId?: string;
      sessionId?: string;
      conversationId?: string;
      parentSpanId?: string;
      input?: any;
      metadata?: Record<string, any>;
    } = {}
  ) {
    this.agentName = agentName;

    this.span = traceManager.startTrace('agent', `agent:${agentName}`, {
      userId: options.userId,
      sessionId: options.sessionId,
      conversationId: options.conversationId,
      parentSpanId: options.parentSpanId,
      metadata: {
        agent_name: agentName,
        input_size: options.input ? JSON.stringify(options.input).length : 0,
        ...options.metadata,
      },
      tags: {
        component: 'agent',
        agent: agentName,
      },
    });

    if (options.input) {
      this.addEvent('agent_input_received', {
        input_type: typeof options.input,
        input_size: JSON.stringify(options.input).length,
      });
    }
  }

  /**
   * Adds an event to the agent trace
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    traceManager.addEvent(this.span, name, attributes);
  }

  /**
   * Records tool usage
   */
  recordToolUsage(toolName: string, input: any, output?: any, duration?: number): void {
    this.addEvent('tool_used', {
      tool_name: toolName,
      input_size: JSON.stringify(input).length,
      output_size: output ? JSON.stringify(output).length : 0,
      duration_ms: duration,
    });
  }

  /**
   * Records model interaction
   */
  recordModelInteraction(model: string, prompt: string, response: string, usage?: any): void {
    this.addEvent('model_interaction', {
      model,
      prompt_length: prompt.length,
      response_length: response.length,
      usage,
    });
  }

  /**
   * Completes the agent trace
   */
  complete(output: any, usage?: any): void {
    this.addEvent('agent_completed', {
      output_size: JSON.stringify(output).length,
      usage,
    });

    traceManager.completeTrace(this.span, output);
  }

  /**
   * Fails the agent trace
   */
  fail(error: Error): void {
    this.addEvent('agent_failed', {
      error_name: error.name,
      error_message: error.message,
    });

    traceManager.failTrace(this.span, error);
  }

  /**
   * Gets the trace ID
   */
  getTraceId(): string {
    return this.span.context.traceId;
  }

  /**
   * Gets current span for child operations
   */
  getSpan(): TraceSpan {
    return this.span;
  }
}

/**
 * Workflow execution tracer
 */
class WorkflowExecutionTracer {
  private span: TraceSpan;
  private workflowName: string;
  private stepTraces = new Map<string, TraceSpan>();

  constructor(
    workflowName: string,
    options: {
      userId?: string;
      sessionId?: string;
      conversationId?: string;
      parentSpanId?: string;
      input?: any;
      metadata?: Record<string, any>;
    } = {}
  ) {
    this.workflowName = workflowName;

    this.span = traceManager.startTrace('workflow', `workflow:${workflowName}`, {
      userId: options.userId,
      sessionId: options.sessionId,
      conversationId: options.conversationId,
      parentSpanId: options.parentSpanId,
      metadata: {
        workflow_name: workflowName,
        input_size: options.input ? JSON.stringify(options.input).length : 0,
        ...options.metadata,
      },
      tags: {
        component: 'workflow',
        workflow: workflowName,
      },
    });

    if (options.input) {
      this.addEvent('workflow_started', {
        input_type: typeof options.input,
        input_size: JSON.stringify(options.input).length,
      });
    }
  }

  /**
   * Starts a workflow step trace
   */
  startStep(stepName: string, input?: any): TraceSpan {
    const stepSpan = traceManager.startChildSpan(
      this.span,
      'workflow',
      `step:${stepName}`,
      {
        step_name: stepName,
        input_size: input ? JSON.stringify(input).length : 0,
      }
    );

    this.stepTraces.set(stepName, stepSpan);

    this.addEvent('step_started', {
      step_name: stepName,
      input_size: input ? JSON.stringify(input).length : 0,
    });

    return stepSpan;
  }

  /**
   * Completes a workflow step
   */
  completeStep(stepName: string, output?: any): void {
    const stepSpan = this.stepTraces.get(stepName);
    if (stepSpan) {
      traceManager.addEvent(stepSpan, 'step_completed', {
        output_size: output ? JSON.stringify(output).length : 0,
      });
      traceManager.completeTrace(stepSpan, output);
    }

    this.addEvent('step_completed', {
      step_name: stepName,
      output_size: output ? JSON.stringify(output).length : 0,
    });
  }

  /**
   * Fails a workflow step
   */
  failStep(stepName: string, error: Error): void {
    const stepSpan = this.stepTraces.get(stepName);
    if (stepSpan) {
      traceManager.failTrace(stepSpan, error);
    }

    this.addEvent('step_failed', {
      step_name: stepName,
      error_name: error.name,
      error_message: error.message,
    });
  }

  /**
   * Adds an event to the workflow trace
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    traceManager.addEvent(this.span, name, attributes);
  }

  /**
   * Completes the workflow trace
   */
  complete(output: any): void {
    this.addEvent('workflow_completed', {
      output_size: JSON.stringify(output).length,
      total_steps: this.stepTraces.size,
    });

    traceManager.completeTrace(this.span, output);
  }

  /**
   * Fails the workflow trace
   */
  fail(error: Error): void {
    this.addEvent('workflow_failed', {
      error_name: error.name,
      error_message: error.message,
    });

    traceManager.failTrace(this.span, error);
  }

  /**
   * Gets the trace ID
   */
  getTraceId(): string {
    return this.span.context.traceId;
  }

  /**
   * Gets current span for child operations
   */
  getSpan(): TraceSpan {
    return this.span;
  }
}

/**
 * API request tracer
 */
class APITracer {
  private span: TraceSpan;

  constructor(
    endpoint: string,
    method: string,
    options: {
      userId?: string;
      sessionId?: string;
      requestId?: string;
      headers?: Record<string, string>;
      query?: Record<string, any>;
      body?: any;
    } = {}
  ) {
    this.span = traceManager.startTrace('api', `${method}:${endpoint}`, {
      userId: options.userId,
      sessionId: options.sessionId,
      conversationId: options.requestId,
      metadata: {
        endpoint,
        method,
        headers: options.headers,
        query: options.query,
        body_size: options.body ? JSON.stringify(options.body).length : 0,
      },
      tags: {
        component: 'api',
        endpoint,
        method,
      },
    });

    this.addEvent('request_received', {
      endpoint,
      method,
      user_agent: options.headers?.['user-agent'],
      content_type: options.headers?.['content-type'],
    });
  }

  /**
   * Records authentication step
   */
  recordAuth(success: boolean, userId?: string): void {
    this.addEvent('authentication', {
      success,
      user_id: userId,
    });
  }

  /**
   * Records validation step
   */
  recordValidation(success: boolean, errors?: string[]): void {
    this.addEvent('validation', {
      success,
      error_count: errors?.length || 0,
      errors,
    });
  }

  /**
   * Records response sent
   */
  recordResponse(statusCode: number, responseSize: number): void {
    this.addEvent('response_sent', {
      status_code: statusCode,
      response_size: responseSize,
    });
  }

  /**
   * Adds an event to the API trace
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    traceManager.addEvent(this.span, name, attributes);
  }

  /**
   * Completes the API trace
   */
  complete(response: any, statusCode: number = 200): void {
    this.recordResponse(statusCode, JSON.stringify(response).length);
    traceManager.completeTrace(this.span, response);
  }

  /**
   * Fails the API trace
   */
  fail(error: Error, statusCode: number = 500): void {
    this.addEvent('request_failed', {
      error_name: error.name,
      error_message: error.message,
      status_code: statusCode,
    });

    traceManager.failTrace(this.span, error);
  }

  /**
   * Gets the trace ID
   */
  getTraceId(): string {
    return this.span.context.traceId;
  }
}

/**
 * Utility function to wrap operations with tracing
 */
async function traceOperation<T>(
  operationType: TraceContext['operationType'],
  operationName: string,
  operation: (tracer: TraceSpan) => Promise<T>,
  options: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
    parentSpanId?: string;
    metadata?: Record<string, any>;
  } = {}
): Promise<T> {
  const span = traceManager.startTrace(operationType, operationName, options);

  try {
    const result = await operation(span);
    traceManager.completeTrace(span, result);
    return result;
  } catch (error) {
    traceManager.failTrace(span, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Export tracing utilities for use throughout the application
 */
export {
  traceManager as default,
  AgentTracer,
  WorkflowExecutionTracer,
  APITracer,
  traceOperation,
};
