/**
 * Bedrock Request Types
 *
 * Request type definitions for Claude and Titan models.
 */

/**
 * Claude 4 Sonnet Request Types
 */
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

  /** Top-k for sampling */
  topK?: number;

  /** Model ID to use for generation */
  modelId?: string;

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

/**
 * Titan v2 Embeddings Request Types
 */
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