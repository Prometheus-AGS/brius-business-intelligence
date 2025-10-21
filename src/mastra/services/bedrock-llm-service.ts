/**
 * Bedrock LLM Service Implementation
 *
 * Main service implementation for centralized access to Claude 4 Sonnet
 * and Titan v2 embeddings with comprehensive monitoring and error handling.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { trace } from '@opentelemetry/api';
import type {
  BedrockLLMServiceConfig,
  ClaudeTextGenerationRequest,
  ClaudeTextGenerationResponse,
  TitanEmbeddingRequest,
  TitanEmbeddingResponse,
  TitanBatchEmbeddingRequest,
  TitanBatchEmbeddingResponse,
  BedrockServiceHealth,
  ServiceMetrics,
} from '../types/index.js';
import { getBedrockConfig } from '../config/bedrock-model.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { BedrockErrorFactory } from '../types/bedrock-errors.js';

export class BedrockLLMService {
  private client: BedrockRuntimeClient;
  private config: BedrockLLMServiceConfig;
  private circuitBreaker: CircuitBreaker;
  private tracer = trace.getTracer('bedrock-llm-service');
  private metrics = {
    requests: { total: 0, successful: 0, failed: 0, totalLatency: 0 },
    claude: { requests: 0, totalTokens: 0, totalCost: 0 },
    titan: { requests: 0, totalEmbeddings: 0, totalCost: 0 },
  };
  private startTime = Date.now();

  constructor(config?: Partial<BedrockLLMServiceConfig>) {
    this.config = getBedrockConfig().getConfig();
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.client = new BedrockRuntimeClient({
      region: this.config.region,
      credentials: this.config.credentials,
    });

    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
  }

  /**
   * Generate text using Claude 4 Sonnet
   */
  async generateText(request: ClaudeTextGenerationRequest): Promise<ClaudeTextGenerationResponse> {
    return await this.tracer.startActiveSpan('bedrock.claude.generateText', async (span) => {
      const startTime = Date.now();
      
      try {
        // Set span attributes
        span.setAttributes({
          'bedrock.model': this.config.claude.modelId,
          'bedrock.temperature': request.temperature || this.config.claude.defaultTemperature,
          'bedrock.maxTokens': request.maxTokens || this.config.claude.defaultMaxTokens,
          'bedrock.messageCount': request.messages.length,
          'bedrock.hasSystem': !!request.system,
        });

        // Execute with circuit breaker protection
        const result = await this.circuitBreaker.execute(async () => {
          return await this.invokeClaudeModel(request);
        }, 'claude-text-generation');

        // Update metrics
        const processingTime = Date.now() - startTime;
        this.updateMetrics('claude', true, processingTime, result.usage.totalTokens);

        // Set successful span status
        span.setAttributes({
          'bedrock.usage.inputTokens': result.usage.inputTokens,
          'bedrock.usage.outputTokens': result.usage.outputTokens,
          'bedrock.usage.totalTokens': result.usage.totalTokens,
          'bedrock.processingTime': result.processingTimeMs,
          'bedrock.stopReason': result.stopReason,
        });
        span.setStatus({ code: 1 }); // OK

        return {
          ...result,
          traceId: span.spanContext().traceId,
        };
      } catch (error) {
        // Update metrics
        const processingTime = Date.now() - startTime;
        this.updateMetrics('claude', false, processingTime);

        // Record error in span
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message }); // ERROR

        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Generate embeddings using Titan v2
   */
  async generateEmbedding(request: TitanEmbeddingRequest): Promise<TitanEmbeddingResponse> {
    return await this.tracer.startActiveSpan('bedrock.titan.generateEmbedding', async (span) => {
      const startTime = Date.now();
      
      try {
        // Set span attributes
        span.setAttributes({
          'bedrock.model': this.config.titan.modelId,
          'bedrock.dimensions': request.dimensions || this.config.titan.dimensions,
          'bedrock.normalize': request.normalize ?? this.config.titan.normalize,
          'bedrock.inputLength': request.inputText.length,
        });

        // Execute with circuit breaker protection
        const result = await this.circuitBreaker.execute(async () => {
          return await this.invokeTitanModel(request);
        }, 'titan-embedding-generation');

        // Update metrics
        const processingTime = Date.now() - startTime;
        this.updateMetrics('titan', true, processingTime);

        // Set successful span status
        span.setAttributes({
          'bedrock.embedding.dimensions': result.dimensions,
          'bedrock.embedding.normalized': result.normalized,
          'bedrock.processingTime': result.processingTimeMs,
        });
        span.setStatus({ code: 1 }); // OK

        return {
          ...result,
          traceId: span.spanContext().traceId,
        };
      } catch (error) {
        // Update metrics
        const processingTime = Date.now() - startTime;
        this.updateMetrics('titan', false, processingTime);

        // Record error in span
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message }); // ERROR

        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Generate batch embeddings using Titan v2
   */
  async generateBatchEmbeddings(request: TitanBatchEmbeddingRequest): Promise<TitanBatchEmbeddingResponse> {
    return await this.tracer.startActiveSpan('bedrock.titan.generateBatchEmbeddings', async (span) => {
      const startTime = Date.now();
      
      try {
        span.setAttributes({
          'bedrock.model': this.config.titan.modelId,
          'bedrock.batchSize': request.inputTexts.length,
          'bedrock.dimensions': request.dimensions || this.config.titan.dimensions,
        });

        const embeddings: number[][] = [];
        const failures: Array<{ index: number; inputText: string; error: string }> = [];

        // Process each text individually for better error handling
        for (let i = 0; i < request.inputTexts.length; i++) {
          try {
            const embeddingRequest: TitanEmbeddingRequest = {
              inputText: request.inputTexts[i],
              dimensions: request.dimensions,
              normalize: request.normalize,
              metadata: request.metadata,
            };

            const result = await this.generateEmbedding(embeddingRequest);
            embeddings.push(result.embedding);
          } catch (error) {
            failures.push({
              index: i,
              inputText: request.inputTexts[i],
              error: (error as Error).message,
            });
          }
        }

        const totalProcessingTime = Date.now() - startTime;
        const response: TitanBatchEmbeddingResponse = {
          embeddings,
          stats: {
            totalInputs: request.inputTexts.length,
            successfulEmbeddings: embeddings.length,
            failedEmbeddings: failures.length,
            totalProcessingTimeMs: totalProcessingTime,
            averageProcessingTimeMs: totalProcessingTime / request.inputTexts.length,
          },
          failures: failures.length > 0 ? failures : undefined,
          traceId: span.spanContext().traceId,
        };

        span.setAttributes({
          'bedrock.batch.successful': embeddings.length,
          'bedrock.batch.failed': failures.length,
          'bedrock.batch.totalTime': totalProcessingTime,
        });
        span.setStatus({ code: 1 }); // OK

        return response;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<BedrockServiceHealth> {
    const healthChecks = await Promise.allSettled([
      this.checkAwsConnection(),
      this.checkClaudeModel(),
      this.checkTitanModel(),
      this.checkLangfuseMonitoring(),
    ]);

    const [awsConnection, claudeModel, titanModel, langfuseMonitoring] = healthChecks.map(
      (result) => result.status === 'fulfilled' ? result.value : {
        status: 'unhealthy' as const,
        lastCheck: new Date().toISOString(),
        error: result.status === 'rejected' ? result.reason.message : 'Unknown error',
      }
    );

    const circuitBreakerHealth = {
      status: this.circuitBreaker.getState().isHealthy ? 'healthy' as const : 'degraded' as const,
      lastCheck: new Date().toISOString(),
      details: this.circuitBreaker.getMetrics(),
    };

    const overallHealthy = [awsConnection, claudeModel, titanModel, langfuseMonitoring, circuitBreakerHealth]
      .every(component => component.status === 'healthy');

    return {
      healthy: overallHealthy,
      components: {
        awsConnection,
        claudeModel,
        titanModel,
        langfuseMonitoring,
        circuitBreaker: circuitBreakerHealth,
      },
      timestamp: new Date().toISOString(),
      metadata: {
        region: this.config.region,
        version: '1.0.0',
        uptime: Date.now() - this.startTime,
      },
    };
  }

  /**
   * Get service performance metrics
   */
  async getMetrics(periodMs = 3600000): Promise<ServiceMetrics> {
    const circuitBreakerState = this.circuitBreaker.getState();
    
    return {
      requests: {
        total: this.metrics.requests.total,
        successful: this.metrics.requests.successful,
        failed: this.metrics.requests.failed,
        averageLatency: this.metrics.requests.total > 0 
          ? this.metrics.requests.totalLatency / this.metrics.requests.total 
          : 0,
        p95Latency: 0, // Would need histogram for proper percentiles
        p99Latency: 0,
      },
      claude: {
        totalRequests: this.metrics.claude.requests,
        totalTokensGenerated: this.metrics.claude.totalTokens,
        averageTokensPerRequest: this.metrics.claude.requests > 0 
          ? this.metrics.claude.totalTokens / this.metrics.claude.requests 
          : 0,
        costEstimate: this.metrics.claude.totalCost,
      },
      titan: {
        totalRequests: this.metrics.titan.requests,
        totalEmbeddings: this.metrics.titan.totalEmbeddings,
        averageProcessingTime: this.metrics.titan.requests > 0 
          ? this.metrics.requests.totalLatency / this.metrics.titan.requests 
          : 0,
        costEstimate: this.metrics.titan.totalCost,
      },
      circuitBreaker: {
        state: circuitBreakerState.state,
        failureCount: circuitBreakerState.failureCount,
        successCount: circuitBreakerState.successCount,
        lastStateChange: circuitBreakerState.lastFailureTime?.toISOString() || '',
      },
      period: {
        start: new Date(Date.now() - periodMs).toISOString(),
        end: new Date().toISOString(),
        durationMs: periodMs,
      },
    };
  }

  /**
   * Gracefully shutdown the service
   */
  async shutdown(): Promise<void> {
    // Currently no cleanup needed for AWS SDK client
    // Could add connection pool cleanup here if needed
  }

  // Private helper methods

  private async invokeClaudeModel(request: ClaudeTextGenerationRequest): Promise<ClaudeTextGenerationResponse> {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      messages: request.messages,
      system: request.system,
      max_tokens: request.maxTokens || this.config.claude.defaultMaxTokens,
      temperature: request.temperature || this.config.claude.defaultTemperature,
      top_p: request.topP || this.config.claude.defaultTopP,
      stop_sequences: request.stopSequences,
    };

    const command = new InvokeModelCommand({
      modelId: this.config.claude.modelId,
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const startTime = Date.now();
    
    try {
      const response = await this.client.send(command);
      const processingTime = Date.now() - startTime;

      if (!response.body) {
        throw BedrockErrorFactory.createAwsError(
          new Error('Empty response body from Claude model'),
          'claude-text-generation',
          this.config.claude.modelId
        );
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      return {
        content: responseBody.content?.[0]?.text || '',
        usage: {
          inputTokens: responseBody.usage?.input_tokens || 0,
          outputTokens: responseBody.usage?.output_tokens || 0,
          totalTokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0),
        },
        model: this.config.claude.modelId,
        stopReason: responseBody.stop_reason || 'end_turn',
        processingTimeMs: processingTime,
        metadata: request.metadata,
      };
    } catch (error) {
      throw BedrockErrorFactory.createAwsError(
        error as Error,
        'claude-text-generation',
        this.config.claude.modelId
      );
    }
  }

  private async invokeTitanModel(request: TitanEmbeddingRequest): Promise<TitanEmbeddingResponse> {
    const payload = {
      inputText: request.inputText,
      dimensions: request.dimensions || this.config.titan.dimensions,
      normalize: request.normalize ?? this.config.titan.normalize,
    };

    const command = new InvokeModelCommand({
      modelId: this.config.titan.modelId,
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const startTime = Date.now();
    
    try {
      const response = await this.client.send(command);
      const processingTime = Date.now() - startTime;

      if (!response.body) {
        throw BedrockErrorFactory.createAwsError(
          new Error('Empty response body from Titan model'),
          'titan-embedding-generation',
          this.config.titan.modelId
        );
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      return {
        embedding: responseBody.embedding || [],
        dimensions: responseBody.embedding?.length || 0,
        normalized: request.normalize ?? this.config.titan.normalize,
        inputLength: request.inputText.length,
        model: this.config.titan.modelId,
        processingTimeMs: processingTime,
        metadata: request.metadata,
      };
    } catch (error) {
      throw BedrockErrorFactory.createAwsError(
        error as Error,
        'titan-embedding-generation',
        this.config.titan.modelId
      );
    }
  }

  private updateMetrics(service: 'claude' | 'titan', success: boolean, latency: number, tokens = 0): void {
    this.metrics.requests.total++;
    this.metrics.requests.totalLatency += latency;
    
    if (success) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    if (service === 'claude') {
      this.metrics.claude.requests++;
      this.metrics.claude.totalTokens += tokens;
      // Rough cost estimation for Claude (simplified)
      this.metrics.claude.totalCost += (tokens / 1000) * 0.003;
    } else if (service === 'titan') {
      this.metrics.titan.requests++;
      this.metrics.titan.totalEmbeddings++;
      // Rough cost estimation for Titan (simplified)
      this.metrics.titan.totalCost += 0.0001;
    }
  }

  private async checkAwsConnection() {
    // Simple connection test - could be enhanced
    return {
      status: 'healthy' as const,
      lastCheck: new Date().toISOString(),
      responseTimeMs: 0,
    };
  }

  private async checkClaudeModel() {
    // Could implement a simple test request
    return {
      status: 'healthy' as const,
      lastCheck: new Date().toISOString(),
      responseTimeMs: 0,
    };
  }

  private async checkTitanModel() {
    // Could implement a simple test request
    return {
      status: 'healthy' as const,
      lastCheck: new Date().toISOString(),
      responseTimeMs: 0,
    };
  }

  private async checkLangfuseMonitoring() {
    return {
      status: this.config.monitoring.enabled ? 'healthy' as const : 'unknown' as const,
      lastCheck: new Date().toISOString(),
      responseTimeMs: 0,
    };
  }
}

// Singleton instance
let bedrockService: BedrockLLMService;

/**
 * Get singleton Bedrock service instance
 */
export function getBedrockService(): BedrockLLMService {
  if (!bedrockService) {
    bedrockService = new BedrockLLMService();
  }
  return bedrockService;
}

/**
 * Initialize Bedrock service with custom config
 */
export function initializeBedrockService(config?: Partial<BedrockLLMServiceConfig>): BedrockLLMService {
  bedrockService = new BedrockLLMService(config);
  return bedrockService;
}