# Data Model: Centralized Bedrock LLM Service

**Date**: 2025-01-20
**Phase**: 1 - Design & Data Models
**Spec**: [003-bedrock-llm-service](./spec.md)
**Research**: [research.md](./research.md)

## Core Service Types

### BedrockLLMService Configuration

```typescript
export interface BedrockLLMServiceConfig {
  /** AWS region for Bedrock service */
  region: string;

  /** Claude 4 Sonnet model configuration */
  claude: ClaudeConfig;

  /** Titan v2 embeddings model configuration */
  titan: TitanConfig;

  /** Circuit breaker configuration for resilience */
  circuitBreaker: CircuitBreakerConfig;

  /** Langfuse monitoring configuration */
  monitoring: MonitoringConfig;

  /** AWS credentials (optional - will use default provider chain) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface ClaudeConfig {
  /** Model ID for Claude 4 Sonnet */
  modelId: 'anthropic.claude-sonnet-4-20250514-v1:0';

  /** Default temperature (0.0 - 1.0) */
  defaultTemperature: number;

  /** Default maximum output tokens */
  defaultMaxTokens: number;

  /** Default top-p value for nucleus sampling */
  defaultTopP: number;

  /** Default system prompt (optional) */
  defaultSystemPrompt?: string;

  /** Request timeout in milliseconds */
  timeoutMs: number;
}

export interface TitanConfig {
  /** Model ID for Titan v2 embeddings */
  modelId: 'amazon.titan-embed-text-v2:0';

  /** Output dimensions (256, 512, or 1024) */
  dimensions: 256 | 512 | 1024;

  /** Whether to normalize output vectors */
  normalize: boolean;

  /** Request timeout in milliseconds */
  timeoutMs: number;

  /** Maximum input text length */
  maxInputLength: number;
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Time to wait before attempting recovery (ms) */
  recoveryTimeoutMs: number;

  /** Maximum retry attempts for exponential backoff */
  maxRetries: number;

  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;

  /** Maximum delay cap for exponential backoff (ms) */
  maxDelayMs: number;
}

export interface MonitoringConfig {
  /** Enable Langfuse tracing */
  enabled: boolean;

  /** Langfuse project configuration */
  langfuse?: {
    publicKey: string;
    secretKey: string;
    baseUrl: string;
    environment?: string;
  };

  /** Sampling rate for traces (0.0 - 1.0) */
  samplingRate: number;

  /** Log level for service operations */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

## Request/Response Types

### Claude 4 Sonnet Types

```typescript
export interface ClaudeTextGenerationRequest {
  /** Input messages for the conversation */
  messages: ClaudeMessage[];

  /** System prompt to guide behavior (optional) */
  system?: string;

  /** Temperature for randomness (0.0 - 1.0) */
  temperature?: number;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Top-p for nucleus sampling */
  topP?: number;

  /** Stop sequences to halt generation */
  stopSequences?: string[];

  /** Whether to stream the response */
  stream?: boolean;

  /** Request metadata for tracing */
  metadata?: {
    userId?: string;
    sessionId?: string;
    agentId?: string;
    toolCallId?: string;
  };
}

export interface ClaudeMessage {
  /** Role of the message sender */
  role: 'user' | 'assistant';

  /** Content of the message */
  content: string | ClaudeContentBlock[];
}

export interface ClaudeContentBlock {
  /** Type of content block */
  type: 'text' | 'image';

  /** Text content (for text blocks) */
  text?: string;

  /** Image source (for image blocks) */
  source?: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface ClaudeTextGenerationResponse {
  /** Generated text content */
  content: string;

  /** Token usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Model used for generation */
  model: string;

  /** Stop reason for generation */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence';

  /** Request processing time (ms) */
  processingTimeMs: number;

  /** Langfuse trace ID for monitoring */
  traceId?: string;

  /** Request metadata echo */
  metadata?: Record<string, any>;
}

export interface ClaudeStreamResponse {
  /** Whether this is a streaming chunk */
  isStreaming: true;

  /** Delta content for this chunk */
  delta: string;

  /** Whether this is the final chunk */
  isComplete: boolean;

  /** Usage stats (only in final chunk) */
  usage?: ClaudeTextGenerationResponse['usage'];

  /** Stop reason (only in final chunk) */
  stopReason?: ClaudeTextGenerationResponse['stopReason'];
}
```

### Titan v2 Embeddings Types

```typescript
export interface TitanEmbeddingRequest {
  /** Input text to embed */
  inputText: string;

  /** Override dimensions (256, 512, or 1024) */
  dimensions?: 256 | 512 | 1024;

  /** Override normalization setting */
  normalize?: boolean;

  /** Request metadata for tracing */
  metadata?: {
    userId?: string;
    sessionId?: string;
    documentId?: string;
    chunkId?: string;
  };
}

export interface TitanEmbeddingResponse {
  /** Generated embedding vector */
  embedding: number[];

  /** Actual dimensions of the embedding */
  dimensions: number;

  /** Whether the embedding is normalized */
  normalized: boolean;

  /** Input text length in characters */
  inputLength: number;

  /** Model used for embedding */
  model: string;

  /** Request processing time (ms) */
  processingTimeMs: number;

  /** Langfuse trace ID for monitoring */
  traceId?: string;

  /** Request metadata echo */
  metadata?: Record<string, any>;
}

export interface TitanBatchEmbeddingRequest {
  /** Array of input texts to embed */
  inputTexts: string[];

  /** Override dimensions for all embeddings */
  dimensions?: 256 | 512 | 1024;

  /** Override normalization for all embeddings */
  normalize?: boolean;

  /** Batch processing metadata */
  metadata?: {
    batchId?: string;
    userId?: string;
    sessionId?: string;
  };
}

export interface TitanBatchEmbeddingResponse {
  /** Array of generated embeddings */
  embeddings: number[][];

  /** Processing statistics */
  stats: {
    totalInputs: number;
    successfulEmbeddings: number;
    failedEmbeddings: number;
    totalProcessingTimeMs: number;
    averageProcessingTimeMs: number;
  };

  /** Any failed inputs with error details */
  failures?: Array<{
    index: number;
    inputText: string;
    error: string;
  }>;

  /** Langfuse trace ID for monitoring */
  traceId?: string;
}
```

## Service Health and Monitoring Types

```typescript
export interface BedrockServiceHealth {
  /** Overall service health status */
  healthy: boolean;

  /** Individual component health */
  components: {
    awsConnection: ComponentHealth;
    claudeModel: ComponentHealth;
    titanModel: ComponentHealth;
    langfuseMonitoring: ComponentHealth;
    circuitBreaker: ComponentHealth;
  };

  /** Health check timestamp */
  timestamp: string;

  /** Additional service metadata */
  metadata: {
    region: string;
    version: string;
    uptime: number;
  };
}

export interface ComponentHealth {
  /** Component health status */
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

  /** Last successful check timestamp */
  lastCheck: string;

  /** Response time for last check (ms) */
  responseTimeMs?: number;

  /** Error message if unhealthy */
  error?: string;

  /** Additional component details */
  details?: Record<string, any>;
}

export interface ServiceMetrics {
  /** Request statistics */
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
  };

  /** Claude-specific metrics */
  claude: {
    totalRequests: number;
    totalTokensGenerated: number;
    averageTokensPerRequest: number;
    costEstimate: number;
  };

  /** Titan-specific metrics */
  titan: {
    totalRequests: number;
    totalEmbeddings: number;
    averageProcessingTime: number;
    costEstimate: number;
  };

  /** Circuit breaker metrics */
  circuitBreaker: {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    successCount: number;
    lastStateChange: string;
  };

  /** Time period for these metrics */
  period: {
    start: string;
    end: string;
    durationMs: number;
  };
}
```

## Error Types

```typescript
export interface BedrockServiceError extends Error {
  /** Error category */
  category: 'aws_error' | 'validation_error' | 'circuit_breaker' | 'timeout' | 'monitoring_error';

  /** Error code for programmatic handling */
  code: string;

  /** User-friendly error message */
  message: string;

  /** Technical details for debugging */
  details?: Record<string, any>;

  /** Original error from AWS SDK or other source */
  originalError?: Error;

  /** Request context that caused the error */
  context?: {
    operation: string;
    modelId?: string;
    requestId?: string;
    traceId?: string;
  };

  /** Whether this error is retryable */
  retryable: boolean;

  /** Retry delay suggestion (ms) */
  retryDelayMs?: number;
}

export type BedrockErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_CREDENTIALS'
  | 'REGION_NOT_SUPPORTED'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'CONTENT_FILTERED'
  | 'EMBEDDING_DIMENSION_MISMATCH'
  | 'MONITORING_FAILURE'
  | 'CONFIGURATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';
```

## Integration Types

```typescript
export interface MastraToolContext {
  /** User ID for the current session */
  userId?: string;

  /** Agent ID calling the tool */
  agentId?: string;

  /** Session ID for conversation tracking */
  sessionId?: string;

  /** Workflow ID if called from a workflow */
  workflowId?: string;

  /** Additional context metadata */
  metadata?: Record<string, any>;
}

export interface BedrockTool {
  /** Tool identifier */
  id: string;

  /** Tool description for agents */
  description: string;

  /** Zod input schema */
  inputSchema: z.ZodSchema;

  /** Zod output schema */
  outputSchema: z.ZodSchema;

  /** Tool execution function */
  execute: (params: {
    context: MastraToolContext;
    input: any;
  }) => Promise<any>;
}

export interface VectorOperationRequest {
  /** Operation type */
  operation: 'store' | 'search';

  /** Vector data for storage operations */
  vector?: number[];

  /** Search query for search operations */
  query?: string;

  /** Vector dimensions (must match service config) */
  dimensions: number;

  /** Storage table target */
  table: 'user_memories' | 'global_memories' | 'document_chunks';

  /** Additional metadata */
  metadata?: Record<string, any>;
}
```

## Configuration Defaults

```typescript
export const DEFAULT_BEDROCK_CONFIG: BedrockLLMServiceConfig = {
  region: 'us-east-1',
  claude: {
    modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4000,
    defaultTopP: 0.9,
    timeoutMs: 30000,
  },
  titan: {
    modelId: 'amazon.titan-embed-text-v2:0',
    dimensions: 1024,
    normalize: true,
    timeoutMs: 10000,
    maxInputLength: 8000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    recoveryTimeoutMs: 60000,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  monitoring: {
    enabled: true,
    samplingRate: 1.0,
    logLevel: 'info',
  },
};
```

## Type Export Strategy

All types will be exported from `src/mastra/types/bedrock.ts` and re-exported through `src/mastra/types/index.ts` following the established pattern:

```typescript
// src/mastra/types/bedrock.ts
export * from './bedrock-config';
export * from './bedrock-requests';
export * from './bedrock-responses';
export * from './bedrock-errors';
export * from './bedrock-health';

// src/mastra/types/index.ts
export * from './bedrock';
```

This ensures consistent type management and prevents duplication across the codebase while maintaining the architectural requirement for centralized type definitions.