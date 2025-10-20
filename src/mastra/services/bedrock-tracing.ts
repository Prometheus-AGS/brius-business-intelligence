/**
 * Bedrock OpenTelemetry Tracing Service
 *
 * Provides comprehensive tracing for Bedrock LLM operations with Langfuse integration,
 * custom spans, and performance monitoring.
 */

import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type {
  ClaudeTextGenerationRequest,
  ClaudeTextGenerationResponse,
  TitanEmbeddingRequest,
  TitanEmbeddingResponse,
  BedrockServiceError,
} from '../types/bedrock.js';
import { getBedrockConfig } from '../config/bedrock-model.js';
import { withErrorHandling } from '../observability/error-handling.js';

const BEDROCK_TRACER_NAME = 'bedrock-llm-service';
const BEDROCK_TRACER_VERSION = '1.0.0';

/**
 * Bedrock tracing attributes following OpenTelemetry semantic conventions
 */
export interface BedrockTraceAttributes {
  // Model information
  'bedrock.model.id': string;
  'bedrock.model.provider': 'claude' | 'titan';
  'bedrock.model.version': string;

  // Request details
  'bedrock.request.operation': string;
  'bedrock.request.id'?: string;
  'bedrock.request.user_id'?: string;

  // Claude-specific attributes
  'bedrock.claude.max_tokens'?: number;
  'bedrock.claude.temperature'?: number;
  'bedrock.claude.message_count'?: number;

  // Titan-specific attributes
  'bedrock.titan.dimensions'?: number;
  'bedrock.titan.normalize'?: boolean;
  'bedrock.titan.text_length'?: number;
  'bedrock.titan.batch_size'?: number;

  // Response details
  'bedrock.response.input_tokens'?: number;
  'bedrock.response.output_tokens'?: number;
  'bedrock.response.total_tokens'?: number;
  'bedrock.response.stop_reason'?: string;
  'bedrock.response.latency_ms'?: number;

  // Error information
  'bedrock.error.code'?: string;
  'bedrock.error.category'?: string;
  'bedrock.error.retryable'?: boolean;

  // Circuit breaker status
  'bedrock.circuit_breaker.state'?: string;
  'bedrock.circuit_breaker.failure_count'?: number;
}

/**
 * Bedrock Tracing Service
 */
export class BedrockTracingService {
  private tracer = trace.getTracer(BEDROCK_TRACER_NAME, BEDROCK_TRACER_VERSION);
  private config = getBedrockConfig();

  /**
   * Trace Claude text generation operation
   */
  async traceClaudeTextGeneration<T>(
    request: ClaudeTextGenerationRequest,
    operation: () => Promise<T>,
    context?: { userId?: string; requestId?: string }
  ): Promise<T> {
    const span = this.tracer.startSpan(
      'bedrock.claude.text_generation',
      {
        kind: SpanKind.CLIENT,
        attributes: this.buildClaudeAttributes(request, context),
      }
    );

    try {
      const result = await operation();

      // Add response attributes if it's a Claude response
      if (this.isClaudeResponse(result)) {
        this.addClaudeResponseAttributes(span, result);
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.handleSpanError(span, error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace Claude streaming text generation operation
   */
  async traceClaudeTextGenerationStream<T>(
    request: ClaudeTextGenerationRequest,
    operation: () => Promise<T>,
    context?: { userId?: string; requestId?: string }
  ): Promise<T> {
    const span = this.tracer.startSpan(
      'bedrock.claude.text_generation_stream',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          ...this.buildClaudeAttributes(request, context),
          'bedrock.stream': true,
        },
      }
    );

    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.handleSpanError(span, error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace Titan embedding generation operation
   */
  async traceTitanEmbedding<T>(
    request: TitanEmbeddingRequest,
    operation: () => Promise<T>,
    context?: { userId?: string; requestId?: string }
  ): Promise<T> {
    const span = this.tracer.startSpan(
      'bedrock.titan.embedding',
      {
        kind: SpanKind.CLIENT,
        attributes: this.buildTitanAttributes(request, context),
      }
    );

    try {
      const result = await operation();

      // Add response attributes if it's a Titan response
      if (this.isTitanResponse(result)) {
        this.addTitanResponseAttributes(span, result);
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.handleSpanError(span, error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace Titan batch embedding operation
   */
  async traceTitanBatchEmbedding<T>(
    texts: string[],
    batchSize: number,
    operation: () => Promise<T>,
    context?: { userId?: string; requestId?: string }
  ): Promise<T> {
    const span = this.tracer.startSpan(
      'bedrock.titan.embedding_batch',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'bedrock.model.provider': 'titan',
          'bedrock.request.operation': 'embedding_batch',
          'bedrock.titan.batch_size': batchSize,
          'bedrock.titan.text_count': texts.length,
          'bedrock.titan.total_text_length': texts.reduce((sum, text) => sum + text.length, 0),
          'bedrock.request.user_id': context?.userId,
          'bedrock.request.id': context?.requestId,
        },
      }
    );

    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.handleSpanError(span, error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace circuit breaker operations
   */
  async traceCircuitBreakerOperation<T>(
    operation: string,
    state: string,
    failureCount: number,
    operation_fn: () => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(
      'bedrock.circuit_breaker',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'bedrock.circuit_breaker.state': state,
          'bedrock.circuit_breaker.failure_count': failureCount,
          'bedrock.request.operation': operation,
        },
      }
    );

    try {
      const result = await operation_fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.handleSpanError(span, error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Build Claude-specific attributes
   */
  private buildClaudeAttributes(
    request: ClaudeTextGenerationRequest,
    context?: { userId?: string; requestId?: string }
  ): Partial<BedrockTraceAttributes> {
    const claudeConfig = this.config.getClaudeConfig();

    return {
      'bedrock.model.id': request.modelId || claudeConfig.modelId,
      'bedrock.model.provider': 'claude',
      'bedrock.model.version': '4-sonnet',
      'bedrock.request.operation': 'text_generation',
      'bedrock.request.user_id': context?.userId,
      'bedrock.request.id': context?.requestId,
      'bedrock.claude.max_tokens': request.maxTokens || claudeConfig.defaultMaxTokens,
      'bedrock.claude.temperature': request.temperature ?? claudeConfig.defaultTemperature,
      'bedrock.claude.message_count': request.messages?.length || 0,
    };
  }

  /**
   * Build Titan-specific attributes
   */
  private buildTitanAttributes(
    request: TitanEmbeddingRequest,
    context?: { userId?: string; requestId?: string }
  ): Partial<BedrockTraceAttributes> {
    const titanConfig = this.config.getTitanConfig();

    return {
      'bedrock.model.id': request.modelId || titanConfig.modelId,
      'bedrock.model.provider': 'titan',
      'bedrock.model.version': 'v2',
      'bedrock.request.operation': 'embedding',
      'bedrock.request.user_id': context?.userId,
      'bedrock.request.id': context?.requestId,
      'bedrock.titan.dimensions': request.dimensions || titanConfig.dimensions,
      'bedrock.titan.normalize': request.normalize ?? titanConfig.normalize,
      'bedrock.titan.text_length': request.text?.length || 0,
    };
  }

  /**
   * Add Claude response attributes to span
   */
  private addClaudeResponseAttributes(span: any, response: ClaudeTextGenerationResponse): void {
    span.setAttributes({
      'bedrock.response.input_tokens': response.usage?.inputTokens || 0,
      'bedrock.response.output_tokens': response.usage?.outputTokens || 0,
      'bedrock.response.total_tokens': response.usage?.totalTokens || 0,
      'bedrock.response.stop_reason': response.stopReason || '',
      'bedrock.response.latency_ms': response.latencyMs || 0,
    });
  }

  /**
   * Add Titan response attributes to span
   */
  private addTitanResponseAttributes(span: any, response: TitanEmbeddingResponse): void {
    span.setAttributes({
      'bedrock.response.input_tokens': response.inputTokenCount || 0,
      'bedrock.response.latency_ms': response.latencyMs || 0,
      'bedrock.titan.embedding_dimensions': response.embedding?.length || 0,
    });
  }

  /**
   * Handle span errors
   */
  private handleSpanError(span: any, error: Error): void {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });

    const errorAttributes: Record<string, any> = {
      'error.type': error.name,
      'error.message': error.message,
    };

    // Add Bedrock-specific error attributes
    if (error.name === 'BedrockServiceError') {
      const bedrockError = error as BedrockServiceError;
      errorAttributes['bedrock.error.code'] = bedrockError.code;
      errorAttributes['bedrock.error.category'] = bedrockError.category;
      errorAttributes['bedrock.error.retryable'] = bedrockError.retryable;
    }

    span.setAttributes(errorAttributes);
    span.recordException(error);
  }

  /**
   * Type guard for Claude response
   */
  private isClaudeResponse(result: any): result is ClaudeTextGenerationResponse {
    return (
      result &&
      typeof result === 'object' &&
      'content' in result &&
      'usage' in result
    );
  }

  /**
   * Type guard for Titan response
   */
  private isTitanResponse(result: any): result is TitanEmbeddingResponse {
    return (
      result &&
      typeof result === 'object' &&
      'embedding' in result &&
      Array.isArray(result.embedding)
    );
  }

  /**
   * Create a custom span for manual tracing
   */
  createCustomSpan(
    name: string,
    attributes?: Partial<BedrockTraceAttributes>,
    spanKind?: SpanKind
  ) {
    return this.tracer.startSpan(name, {
      kind: spanKind || SpanKind.INTERNAL,
      attributes: attributes as Record<string, any>,
    });
  }

  /**
   * Get current active span context
   */
  getCurrentSpanContext() {
    return trace.getActiveSpan()?.spanContext();
  }

  /**
   * Run operation within a specific context
   */
  async withContext<T>(spanContext: any, operation: () => Promise<T>): Promise<T> {
    return context.with(trace.setSpanContext(context.active(), spanContext), operation);
  }

  /**
   * Check if tracing is enabled
   */
  isTracingEnabled(): boolean {
    return this.config.getMonitoringConfig().enabled;
  }

  /**
   * Get tracing configuration
   */
  getTracingConfig(): {
    enabled: boolean;
    tracerName: string;
    tracerVersion: string;
    langfuseEnabled: boolean;
  } {
    const monitoringConfig = this.config.getMonitoringConfig();

    return {
      enabled: monitoringConfig.enabled,
      tracerName: BEDROCK_TRACER_NAME,
      tracerVersion: BEDROCK_TRACER_VERSION,
      langfuseEnabled: Boolean(monitoringConfig.langfuse),
    };
  }
}

// Singleton instance
let bedrockTracingService: BedrockTracingService;

/**
 * Get singleton Bedrock tracing service
 */
export function getBedrockTracingService(): BedrockTracingService {
  if (!bedrockTracingService) {
    bedrockTracingService = new BedrockTracingService();
  }
  return bedrockTracingService;
}

/**
 * Initialize Bedrock tracing service
 */
export function initializeBedrockTracing(): BedrockTracingService {
  bedrockTracingService = new BedrockTracingService();
  return bedrockTracingService;
}

/**
 * Decorator function for automatic tracing of Bedrock operations
 */
export function traceBedrock(operationType: 'claude' | 'titan', operationName: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const tracingService = getBedrockTracingService();

      if (!tracingService.isTracingEnabled()) {
        return method.apply(this, args);
      }

      const spanName = `bedrock.${operationType}.${operationName}`;
      const span = tracingService.createCustomSpan(spanName, {
        'bedrock.model.provider': operationType,
        'bedrock.request.operation': operationName,
      });

      try {
        const result = await method.apply(this, args);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    };

    return descriptor;
  };
}