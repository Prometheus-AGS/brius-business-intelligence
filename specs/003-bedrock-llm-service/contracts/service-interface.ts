/**
 * Service Interface Contract for Centralized Bedrock LLM Service
 *
 * This contract defines the public interface that the BedrockLLMService must implement.
 * It serves as the API contract for all consumers of the service.
 */

import { z } from 'zod';
import type {
  BedrockLLMServiceConfig,
  ClaudeTextGenerationRequest,
  ClaudeTextGenerationResponse,
  ClaudeStreamResponse,
  TitanEmbeddingRequest,
  TitanEmbeddingResponse,
  TitanBatchEmbeddingRequest,
  TitanBatchEmbeddingResponse,
  BedrockServiceHealth,
  ServiceMetrics,
  BedrockServiceError,
} from '../../data-model';

/**
 * Main service interface that all implementations must adhere to
 */
export interface IBedrockLLMService {
  /**
   * Initialize the service with configuration
   * @param config - Service configuration
   * @throws BedrockServiceError if initialization fails
   */
  initialize(config: BedrockLLMServiceConfig): Promise<void>;

  /**
   * Generate text using Claude 4 Sonnet
   * @param request - Text generation request
   * @returns Promise resolving to generated text response
   * @throws BedrockServiceError for API failures or validation errors
   */
  generateText(request: ClaudeTextGenerationRequest): Promise<ClaudeTextGenerationResponse>;

  /**
   * Generate streaming text using Claude 4 Sonnet
   * @param request - Text generation request with stream: true
   * @returns AsyncIterable of streaming response chunks
   * @throws BedrockServiceError for API failures or validation errors
   */
  generateTextStream(request: ClaudeTextGenerationRequest): AsyncIterable<ClaudeStreamResponse>;

  /**
   * Generate embeddings using Titan v2
   * @param request - Embedding generation request
   * @returns Promise resolving to embedding response
   * @throws BedrockServiceError for API failures or validation errors
   */
  generateEmbedding(request: TitanEmbeddingRequest): Promise<TitanEmbeddingResponse>;

  /**
   * Generate multiple embeddings in batch using Titan v2
   * @param request - Batch embedding request
   * @returns Promise resolving to batch embedding response
   * @throws BedrockServiceError for API failures or validation errors
   */
  generateBatchEmbeddings(request: TitanBatchEmbeddingRequest): Promise<TitanBatchEmbeddingResponse>;

  /**
   * Check service health status
   * @returns Promise resolving to health status
   */
  getHealth(): Promise<BedrockServiceHealth>;

  /**
   * Get service performance metrics
   * @param periodMs - Time period for metrics in milliseconds (default: 1 hour)
   * @returns Promise resolving to service metrics
   */
  getMetrics(periodMs?: number): Promise<ServiceMetrics>;

  /**
   * Gracefully shutdown the service
   * @returns Promise that resolves when shutdown is complete
   */
  shutdown(): Promise<void>;
}

/**
 * Factory interface for creating service instances
 */
export interface IBedrockLLMServiceFactory {
  /**
   * Create a new service instance
   * @param config - Service configuration
   * @returns Promise resolving to service instance
   */
  create(config: BedrockLLMServiceConfig): Promise<IBedrockLLMService>;

  /**
   * Get singleton service instance (creates if doesn't exist)
   * @param config - Service configuration
   * @returns Promise resolving to service instance
   */
  getInstance(config?: BedrockLLMServiceConfig): Promise<IBedrockLLMService>;
}

/**
 * Circuit breaker interface for resilience patterns
 */
export interface ICircuitBreaker {
  /**
   * Execute function with circuit breaker protection
   * @param operation - Function to execute
   * @param operationName - Name for monitoring
   * @returns Promise resolving to operation result
   * @throws BedrockServiceError if circuit is open or operation fails repeatedly
   */
  execute<T>(operation: () => Promise<T>, operationName: string): Promise<T>;

  /**
   * Get current circuit breaker state
   * @returns Current state information
   */
  getState(): {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    lastFailureTime?: Date;
    nextAttemptTime?: Date;
  };

  /**
   * Manually reset the circuit breaker
   */
  reset(): void;
}

/**
 * Monitoring interface for observability
 */
export interface IBedrockMonitor {
  /**
   * Start tracing a service operation
   * @param operationName - Name of the operation
   * @param metadata - Additional metadata
   * @returns Trace context for the operation
   */
  startTrace(operationName: string, metadata?: Record<string, any>): Promise<ITraceContext>;

  /**
   * Record service metrics
   * @param metrics - Metrics to record
   */
  recordMetrics(metrics: {
    operation: string;
    latency: number;
    success: boolean;
    tokenUsage?: number;
    cost?: number;
    metadata?: Record<string, any>;
  }): Promise<void>;

  /**
   * Record an error
   * @param error - Error to record
   * @param context - Error context
   */
  recordError(error: BedrockServiceError, context?: Record<string, any>): Promise<void>;
}

/**
 * Trace context interface for operation tracing
 */
export interface ITraceContext {
  /**
   * Add metadata to the current trace
   * @param metadata - Metadata to add
   */
  addMetadata(metadata: Record<string, any>): void;

  /**
   * Record an event in the trace
   * @param event - Event name
   * @param metadata - Event metadata
   */
  addEvent(event: string, metadata?: Record<string, any>): void;

  /**
   * Set trace status
   * @param status - Status information
   */
  setStatus(status: { code: 'ok' | 'error'; message?: string }): void;

  /**
   * End the trace
   * @param result - Operation result
   */
  end(result?: any): Promise<void>;

  /**
   * Get trace ID for correlation
   * @returns Trace ID string
   */
  getTraceId(): string;
}

/**
 * Configuration validator interface
 */
export interface IConfigValidator {
  /**
   * Validate service configuration
   * @param config - Configuration to validate
   * @throws BedrockServiceError if configuration is invalid
   */
  validate(config: BedrockLLMServiceConfig): Promise<void>;

  /**
   * Validate AWS credentials and permissions
   * @param region - AWS region
   * @param credentials - AWS credentials (optional)
   * @throws BedrockServiceError if credentials are invalid
   */
  validateAwsAccess(region: string, credentials?: any): Promise<void>;

  /**
   * Validate model accessibility
   * @param modelId - Model ID to validate
   * @param region - AWS region
   * @throws BedrockServiceError if model is not accessible
   */
  validateModelAccess(modelId: string, region: string): Promise<void>;
}

/**
 * Model configuration interface for dynamic model management
 */
export interface IModelConfig {
  /**
   * Get current model configuration
   * @param modelType - Type of model ('claude' | 'titan')
   * @returns Current configuration
   */
  getConfig(modelType: 'claude' | 'titan'): any;

  /**
   * Update model configuration
   * @param modelType - Type of model
   * @param config - New configuration
   * @throws BedrockServiceError if configuration is invalid
   */
  updateConfig(modelType: 'claude' | 'titan', config: any): Promise<void>;

  /**
   * Reset to default configuration
   * @param modelType - Type of model (optional, resets all if not specified)
   */
  resetToDefaults(modelType?: 'claude' | 'titan'): Promise<void>;
}

/**
 * Integration interfaces for Mastra framework
 */
export interface IMastraIntegration {
  /**
   * Create Mastra tools for the service
   * @returns Array of Mastra tool definitions
   */
  createTools(): Array<{
    id: string;
    description: string;
    inputSchema: z.ZodSchema;
    outputSchema: z.ZodSchema;
    execute: (params: { context: any; input: any }) => Promise<any>;
  }>;

  /**
   * Register service with Mastra instance
   * @param mastra - Mastra instance
   */
  register(mastra: any): Promise<void>;

  /**
   * Get service instance for agent use
   * @returns Service instance
   */
  getServiceInstance(): IBedrockLLMService;
}

/**
 * Type guards for runtime type checking
 */
export const TypeGuards = {
  isClaudeRequest: (obj: any): obj is ClaudeTextGenerationRequest => {
    return typeof obj === 'object' &&
           Array.isArray(obj.messages) &&
           obj.messages.every((msg: any) =>
             typeof msg.role === 'string' &&
             (msg.role === 'user' || msg.role === 'assistant') &&
             typeof msg.content === 'string'
           );
  },

  isTitanRequest: (obj: any): obj is TitanEmbeddingRequest => {
    return typeof obj === 'object' &&
           typeof obj.inputText === 'string' &&
           obj.inputText.length > 0;
  },

  isBedrockError: (obj: any): obj is BedrockServiceError => {
    return obj instanceof Error &&
           typeof obj.category === 'string' &&
           typeof obj.code === 'string' &&
           typeof obj.retryable === 'boolean';
  },
} as const;

/**
 * Constants for service configuration
 */
export const ServiceConstants = {
  /** Supported AWS regions for Bedrock */
  SUPPORTED_REGIONS: [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'ap-northeast-1',
    'ap-southeast-2',
  ] as const,

  /** Model IDs */
  MODEL_IDS: {
    CLAUDE_4_SONNET: 'anthropic.claude-sonnet-4-20250514-v1:0',
    TITAN_V2_EMBEDDINGS: 'amazon.titan-embed-text-v2:0',
  } as const,

  /** Default timeouts */
  TIMEOUTS: {
    CLAUDE_REQUEST: 30000,
    TITAN_REQUEST: 10000,
    HEALTH_CHECK: 5000,
  } as const,

  /** Circuit breaker defaults */
  CIRCUIT_BREAKER: {
    FAILURE_THRESHOLD: 5,
    RECOVERY_TIMEOUT: 60000,
    MAX_RETRIES: 3,
  } as const,

  /** Monitoring defaults */
  MONITORING: {
    DEFAULT_SAMPLING_RATE: 1.0,
    METRICS_RETENTION_HOURS: 24,
  } as const,
} as const;

/**
 * Event types for service events
 */
export type ServiceEvent =
  | { type: 'service_initialized'; config: BedrockLLMServiceConfig }
  | { type: 'text_generated'; request: ClaudeTextGenerationRequest; response: ClaudeTextGenerationResponse }
  | { type: 'embedding_generated'; request: TitanEmbeddingRequest; response: TitanEmbeddingResponse }
  | { type: 'circuit_breaker_opened'; operation: string; failures: number }
  | { type: 'circuit_breaker_closed'; operation: string }
  | { type: 'health_check_failed'; component: string; error: string }
  | { type: 'service_error'; error: BedrockServiceError; context: Record<string, any> }
  | { type: 'service_shutdown'; reason: string };

/**
 * Event listener interface for service events
 */
export interface IServiceEventListener {
  onEvent(event: ServiceEvent): Promise<void>;
}