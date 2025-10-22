/**
 * Bedrock Response Types
 *
 * Response type definitions for Claude and Titan models.
 */

/**
 * Claude 4 Sonnet Response Types
 */
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

  /** Response latency in milliseconds */
  latencyMs?: number;

  /** Langfuse trace ID for monitoring */
  traceId?: string;

  /** Request metadata echo */
  metadata?: Record<string, any>;
}

export interface ClaudeStreamResponse {
  /** Whether this is a streaming chunk */
  isStreaming: true;

  /** Type of the streaming event */
  type?: string;

  /** Delta content for this chunk */
  delta?: any;

  /** Message content for this chunk */
  message?: any;

  /** Whether this is the final chunk */
  isComplete: boolean;

  /** Usage stats (only in final chunk) */
  usage?: ClaudeTextGenerationResponse['usage'];

  /** Stop reason (only in final chunk) */
  stopReason?: ClaudeTextGenerationResponse['stopReason'];

  /** Timestamp of this chunk */
  timestamp?: string;
}

/**
 * Titan v2 Embeddings Response Types
 */
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

  /** Response latency in milliseconds */
  latencyMs?: number;

  /** Input token count */
  inputTokenCount?: number;

  /** Langfuse trace ID for monitoring */
  traceId?: string;

  /** Request metadata echo */
  metadata?: Record<string, any>;
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