/**
 * Bedrock LLM Service Implementation
 *
 * Centralized service for Claude 4 Sonnet and Titan v2 Embeddings
 * with circuit breaker protection, monitoring, and error handling.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type {
  BedrockLLMServiceConfig,
  ClaudeTextGenerationRequest,
  ClaudeTextGenerationResponse,
  TitanEmbeddingRequest,
  TitanEmbeddingResponse,
  TitanBatchEmbeddingRequest,
  ClaudeStreamResponse,
  BedrockServiceError,
} from '../types/bedrock.js';

import { createBedrockError, getErrorSeverity } from '../types/bedrock-errors.js';
import { CircuitBreaker, getCircuitBreakerRegistry } from './circuit-breaker.js';
import { getBedrockConfig } from '../config/bedrock-model.js';
import { withErrorHandling } from '../observability/error-handling.js';

/**
 * Main Bedrock LLM Service implementation
 */
export class BedrockLLMService {
  private client: BedrockRuntimeClient;
  private claudeCircuitBreaker: CircuitBreaker;
  private titanCircuitBreaker: CircuitBreaker;
  private config: BedrockLLMServiceConfig;

  constructor(config?: Partial<BedrockLLMServiceConfig>) {
    this.config = config ? { ...getBedrockConfig().getConfig(), ...config } : getBedrockConfig().getConfig();

    // Initialize AWS Bedrock client
    this.client = new BedrockRuntimeClient({
      region: this.config.region,
      credentials: this.config.credentials,
      maxAttempts: this.config.retryConfig?.maxAttempts || 3,
    });

    // Initialize circuit breakers
    const registry = getCircuitBreakerRegistry();
    this.claudeCircuitBreaker = registry.getBreaker('claude', this.config.circuitBreaker);
    this.titanCircuitBreaker = registry.getBreaker('titan', this.config.circuitBreaker);
  }

  /**
   * Generate text using Claude 4 Sonnet
   */
  async generateText(request: ClaudeTextGenerationRequest): Promise<ClaudeTextGenerationResponse> {
    return await withErrorHandling(
      async () => {
        // Validate request
        await this.validateClaudeRequest(request);

        // Execute with circuit breaker protection
        return await this.claudeCircuitBreaker.execute(
          async () => {
            const startTime = Date.now();

            try {
              // Prepare Bedrock request payload
              const payload = {
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: request.maxTokens || this.config.claude.defaultMaxTokens,
                temperature: request.temperature ?? this.config.claude.defaultTemperature,
                messages: request.messages,
                system: request.system,
                stop_sequences: request.stopSequences,
                top_p: request.topP,
                top_k: request.topK,
              };

              // Remove undefined values
              const cleanPayload = Object.fromEntries(
                Object.entries(payload).filter(([_, value]) => value !== undefined)
              );

              const command = new InvokeModelCommand({
                modelId: request.modelId || this.config.claude.modelId,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(cleanPayload),
              });

              const response = await this.client.send(command);
              const responseBody = JSON.parse(new TextDecoder().decode(response.body));

              if (responseBody.error) {
                throw this.handleBedrockError(responseBody.error, 'claude_text_generation');
              }

              const endTime = Date.now();
              const latency = endTime - startTime;

              return {
                id: responseBody.id || `claude-${Date.now()}`,
                model: request.modelId || this.config.claude.modelId,
                content: responseBody.content,
                role: responseBody.role || 'assistant',
                stopReason: responseBody.stop_reason,
                usage: {
                  inputTokens: responseBody.usage?.input_tokens || 0,
                  outputTokens: responseBody.usage?.output_tokens || 0,
                  totalTokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0),
                },
                latencyMs: latency,
                timestamp: new Date().toISOString(),
              };
            } catch (error) {
              throw this.handleAwsError(error as Error, 'claude_text_generation');
            }
          },
          {
            operation: 'claude_text_generation',
            modelId: request.modelId || this.config.claude.modelId,
          }
        );
      },
      {
        component: 'bedrock_llm_service',
        operation: 'generateText',
        metadata: { modelId: request.modelId, messageCount: request.messages.length },
      },
      'high'
    );
  }

  /**
   * Generate text using Claude 4 Sonnet with streaming
   */
  async *generateTextStream(request: ClaudeTextGenerationRequest): AsyncGenerator<ClaudeStreamResponse, void, unknown> {
    // Validate request
    await this.validateClaudeRequest(request);

    // Execute with circuit breaker protection
    const generator = this.claudeCircuitBreaker.execute(
      async () => {
        try {
          // Prepare Bedrock request payload
          const payload = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: request.maxTokens || this.config.claude.defaultMaxTokens,
            temperature: request.temperature ?? this.config.claude.defaultTemperature,
            messages: request.messages,
            system: request.system,
            stop_sequences: request.stopSequences,
            top_p: request.topP,
            top_k: request.topK,
          };

          // Remove undefined values
          const cleanPayload = Object.fromEntries(
            Object.entries(payload).filter(([_, value]) => value !== undefined)
          );

          const command = new InvokeModelWithResponseStreamCommand({
            modelId: request.modelId || this.config.claude.modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(cleanPayload),
          });

          const response = await this.client.send(command);

          if (!response.body) {
            throw createBedrockError(
              'No response body received from Bedrock',
              'INVALID_RESPONSE',
              'aws_error',
              false
            );
          }

          return response.body;
        } catch (error) {
          throw this.handleAwsError(error as Error, 'claude_text_generation_stream');
        }
      },
      {
        operation: 'claude_text_generation_stream',
        modelId: request.modelId || this.config.claude.modelId,
      }
    );

    const streamResponse = await generator;

    for await (const chunk of streamResponse) {
      if (chunk.chunk?.bytes) {
        try {
          const chunkData = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));

          if (chunkData.error) {
            throw this.handleBedrockError(chunkData.error, 'claude_text_generation_stream');
          }

          const streamEvent: ClaudeStreamResponse = {
            type: chunkData.type,
            delta: chunkData.delta,
            message: chunkData.message,
            usage: chunkData.usage,
            timestamp: new Date().toISOString(),
          };

          yield streamEvent;
        } catch (parseError) {
          throw createBedrockError(
            'Failed to parse streaming response chunk',
            'INVALID_RESPONSE',
            'aws_error',
            false,
            undefined,
            parseError as Error
          );
        }
      }
    }
  }

  /**
   * Generate embeddings using Titan v2
   */
  async generateEmbedding(request: TitanEmbeddingRequest): Promise<TitanEmbeddingResponse> {
    return await withErrorHandling(
      async () => {
        // Validate request
        await this.validateTitanRequest(request);

        // Execute with circuit breaker protection
        return await this.titanCircuitBreaker.execute(
          async () => {
            const startTime = Date.now();

            try {
              const payload = {
                inputText: request.text,
                dimensions: request.dimensions || this.config.titan.dimensions,
                normalize: request.normalize ?? this.config.titan.normalize,
              };

              const command = new InvokeModelCommand({
                modelId: request.modelId || this.config.titan.modelId,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(payload),
              });

              const response = await this.client.send(command);
              const responseBody = JSON.parse(new TextDecoder().decode(response.body));

              if (responseBody.error) {
                throw this.handleBedrockError(responseBody.error, 'titan_embedding');
              }

              const endTime = Date.now();
              const latency = endTime - startTime;

              return {
                embedding: responseBody.embedding,
                inputTokenCount: responseBody.inputTokenCount || this.estimateTokenCount(request.text),
                latencyMs: latency,
                timestamp: new Date().toISOString(),
              };
            } catch (error) {
              throw this.handleAwsError(error as Error, 'titan_embedding');
            }
          },
          {
            operation: 'titan_embedding',
            modelId: request.modelId || this.config.titan.modelId,
          }
        );
      },
      {
        component: 'bedrock_llm_service',
        operation: 'generateEmbedding',
        metadata: { modelId: request.modelId, textLength: request.text.length },
      },
      'medium'
    );
  }

  /**
   * Generate multiple embeddings in batch
   */
  async generateEmbeddingBatch(request: TitanBatchEmbeddingRequest): Promise<TitanEmbeddingResponse[]> {
    return await withErrorHandling(
      async () => {
        const results: TitanEmbeddingResponse[] = [];
        const batchSize = request.batchSize || 10;

        // Process in batches to avoid overwhelming the service
        for (let i = 0; i < request.texts.length; i += batchSize) {
          const batch = request.texts.slice(i, i + batchSize);
          const batchPromises = batch.map(async (text) => {
            const embeddingRequest: TitanEmbeddingRequest = {
              text,
              modelId: request.modelId,
              dimensions: request.dimensions,
              normalize: request.normalize,
            };
            return await this.generateEmbedding(embeddingRequest);
          });

          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);

          // Add delay between batches to respect rate limits
          if (i + batchSize < request.texts.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        return results;
      },
      {
        component: 'bedrock_llm_service',
        operation: 'generateEmbeddingBatch',
        metadata: { textCount: request.texts.length, batchSize: request.batchSize },
      },
      'medium'
    );
  }

  /**
   * Validate Claude text generation request
   */
  private async validateClaudeRequest(request: ClaudeTextGenerationRequest): Promise<void> {
    if (!request.messages || request.messages.length === 0) {
      throw createBedrockError(
        'Messages array is required and cannot be empty',
        'INVALID_REQUEST',
        'validation_error',
        false
      );
    }

    const maxTokens = request.maxTokens || this.config.claude.defaultMaxTokens;
    if (maxTokens < 1 || maxTokens > 8000) {
      throw createBedrockError(
        'Max tokens must be between 1 and 8000',
        'TOKEN_LIMIT_EXCEEDED',
        'validation_error',
        false
      );
    }

    const temperature = request.temperature ?? this.config.claude.defaultTemperature;
    if (temperature < 0 || temperature > 1) {
      throw createBedrockError(
        'Temperature must be between 0.0 and 1.0',
        'INVALID_REQUEST',
        'validation_error',
        false
      );
    }
  }

  /**
   * Validate Titan embedding request
   */
  private async validateTitanRequest(request: TitanEmbeddingRequest): Promise<void> {
    if (!request.text || request.text.trim().length === 0) {
      throw createBedrockError(
        'Text is required and cannot be empty',
        'INVALID_REQUEST',
        'validation_error',
        false
      );
    }

    const dimensions = request.dimensions || this.config.titan.dimensions;
    if (![256, 512, 1024].includes(dimensions)) {
      throw createBedrockError(
        'Titan dimensions must be 256, 512, or 1024',
        'EMBEDDING_DIMENSION_MISMATCH',
        'validation_error',
        false
      );
    }

    // Check text length (Titan has a limit of ~8000 tokens)
    const estimatedTokens = this.estimateTokenCount(request.text);
    if (estimatedTokens > 8000) {
      throw createBedrockError(
        `Text is too long (estimated ${estimatedTokens} tokens, max 8000)`,
        'TOKEN_LIMIT_EXCEEDED',
        'validation_error',
        false
      );
    }
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Handle AWS SDK errors and convert to BedrockServiceError
   */
  private handleAwsError(error: Error, operation: string): BedrockServiceError {
    const errorMessage = error.message || 'Unknown AWS error';

    // Map AWS error codes to Bedrock error codes
    if (errorMessage.includes('ValidationException')) {
      return createBedrockError(
        errorMessage,
        'INVALID_REQUEST',
        'validation_error',
        false,
        { operation },
        error
      );
    }

    if (errorMessage.includes('ThrottlingException')) {
      return createBedrockError(
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        'aws_error',
        true,
        { operation },
        error
      );
    }

    if (errorMessage.includes('AccessDeniedException')) {
      return createBedrockError(
        'Invalid AWS credentials or insufficient permissions',
        'INVALID_CREDENTIALS',
        'aws_error',
        false,
        { operation },
        error
      );
    }

    if (errorMessage.includes('ResourceNotFoundException')) {
      return createBedrockError(
        'Model not found or not available in this region',
        'MODEL_NOT_FOUND',
        'aws_error',
        false,
        { operation },
        error
      );
    }

    if (errorMessage.includes('NetworkingError') || errorMessage.includes('TimeoutError')) {
      return createBedrockError(
        'Network error or timeout',
        'NETWORK_ERROR',
        'timeout',
        true,
        { operation },
        error
      );
    }

    // Default unknown error
    return createBedrockError(
      `Unexpected AWS error: ${errorMessage}`,
      'UNKNOWN_ERROR',
      'aws_error',
      true,
      { operation },
      error
    );
  }

  /**
   * Handle Bedrock API errors from response body
   */
  private handleBedrockError(errorResponse: any, operation: string): BedrockServiceError {
    const errorCode = errorResponse.code || errorResponse.type || 'UNKNOWN_ERROR';
    const errorMessage = errorResponse.message || 'Unknown Bedrock error';

    if (errorCode.includes('content_filter')) {
      return createBedrockError(
        'Content was filtered by Bedrock safety filters',
        'CONTENT_FILTERED',
        'aws_error',
        false,
        { operation }
      );
    }

    if (errorCode.includes('overloaded')) {
      return createBedrockError(
        'Bedrock service is overloaded',
        'RATE_LIMIT_EXCEEDED',
        'aws_error',
        true,
        { operation }
      );
    }

    // Default Bedrock error
    return createBedrockError(
      `Bedrock API error: ${errorMessage}`,
      'UNKNOWN_ERROR',
      'aws_error',
      true,
      { operation }
    );
  }

  /**
   * Get service health information
   */
  getHealthInfo(): {
    healthy: boolean;
    claude: ReturnType<CircuitBreaker['getHealthInfo']>;
    titan: ReturnType<CircuitBreaker['getHealthInfo']>;
    config: {
      region: string;
      claudeModel: string;
      titanModel: string;
    };
  } {
    const claudeHealth = this.claudeCircuitBreaker.getHealthInfo();
    const titanHealth = this.titanCircuitBreaker.getHealthInfo();

    return {
      healthy: claudeHealth.healthy && titanHealth.healthy,
      claude: claudeHealth,
      titan: titanHealth,
      config: {
        region: this.config.region,
        claudeModel: this.config.claude.modelId,
        titanModel: this.config.titan.modelId,
      },
    };
  }

  /**
   * Reset circuit breakers (for testing or manual recovery)
   */
  resetCircuitBreakers(): void {
    this.claudeCircuitBreaker.reset();
    this.titanCircuitBreaker.reset();
  }

  /**
   * Update configuration at runtime
   */
  async updateConfig(updates: Partial<BedrockLLMServiceConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };

    // Recreate client if credentials or region changed
    if (updates.credentials || updates.region) {
      this.client = new BedrockRuntimeClient({
        region: this.config.region,
        credentials: this.config.credentials,
        maxAttempts: this.config.retryConfig?.maxAttempts || 3,
      });
    }
  }
}

// Singleton instance
let bedrockLLMService: BedrockLLMService;

/**
 * Get singleton Bedrock LLM service instance
 */
export function getBedrockLLMService(): BedrockLLMService {
  if (!bedrockLLMService) {
    bedrockLLMService = new BedrockLLMService();
  }
  return bedrockLLMService;
}

/**
 * Initialize Bedrock LLM service with custom configuration
 */
export function initializeBedrockLLMService(config?: Partial<BedrockLLMServiceConfig>): BedrockLLMService {
  bedrockLLMService = new BedrockLLMService(config);
  return bedrockLLMService;
}