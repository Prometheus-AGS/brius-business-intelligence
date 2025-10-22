/**
 * Tool Schema Contracts for Mastra Integration
 *
 * These schemas define the Zod validation schemas for all tools that will be
 * created from the Bedrock LLM service for use by Mastra agents.
 */

import { z } from 'zod';

/**
 * Base metadata schema for all tool requests
 */
const BaseMetadataSchema = z.object({
  userId: z.string().optional().describe('User ID for the current session'),
  sessionId: z.string().optional().describe('Session ID for conversation tracking'),
  agentId: z.string().optional().describe('Agent ID making the request'),
  workflowId: z.string().optional().describe('Workflow ID if called from a workflow'),
  traceId: z.string().optional().describe('Trace ID for monitoring correlation'),
}).optional();

/**
 * Claude Text Generation Tool Schema
 */
export const ClaudeTextGenerationToolSchema = {
  id: 'bedrock-claude-generate-text',
  inputSchema: z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']).describe('Role of the message sender'),
      content: z.string().min(1).max(200000).describe('Content of the message'),
    })).min(1).max(50).describe('Conversation messages'),

    system: z.string().max(10000).optional().describe('System prompt to guide Claude behavior'),

    temperature: z.number().min(0).max(1).default(0.7).describe('Randomness in generation (0.0 = deterministic, 1.0 = creative)'),

    maxTokens: z.number().min(1).max(8000).default(4000).describe('Maximum tokens to generate'),

    topP: z.number().min(0).max(1).default(0.9).describe('Nucleus sampling parameter'),

    stopSequences: z.array(z.string()).max(4).optional().describe('Sequences that stop generation'),

    stream: z.boolean().default(false).describe('Whether to stream the response'),

    metadata: BaseMetadataSchema.describe('Request metadata for tracing and context'),
  }),

  outputSchema: z.object({
    content: z.string().describe('Generated text content'),

    usage: z.object({
      inputTokens: z.number().describe('Number of input tokens processed'),
      outputTokens: z.number().describe('Number of output tokens generated'),
      totalTokens: z.number().describe('Total tokens used'),
    }).describe('Token usage statistics'),

    model: z.string().describe('Model used for generation'),

    stopReason: z.enum(['end_turn', 'max_tokens', 'stop_sequence']).describe('Why generation stopped'),

    processingTimeMs: z.number().describe('Request processing time in milliseconds'),

    traceId: z.string().optional().describe('Langfuse trace ID for monitoring'),

    metadata: z.record(z.any()).optional().describe('Request metadata echo'),
  }),
} as const;

/**
 * Claude Streaming Text Generation Tool Schema
 */
export const ClaudeStreamingToolSchema = {
  id: 'bedrock-claude-generate-text-stream',
  inputSchema: ClaudeTextGenerationToolSchema.inputSchema.extend({
    stream: z.literal(true).describe('Must be true for streaming'),
  }),

  outputSchema: z.object({
    stream: z.any().describe('AsyncIterable stream of response chunks'),
    traceId: z.string().optional().describe('Trace ID for the streaming operation'),
  }),
} as const;

/**
 * Titan Embedding Generation Tool Schema
 */
export const TitanEmbeddingToolSchema = {
  id: 'bedrock-titan-generate-embedding',
  inputSchema: z.object({
    inputText: z.string().min(1).max(8000).describe('Text to generate embeddings for'),

    dimensions: z.enum([256, 512, 1024]).default(1024).describe('Embedding dimensions (higher = more detailed)'),

    normalize: z.boolean().default(true).describe('Whether to normalize the embedding vector'),

    metadata: BaseMetadataSchema.extend({
      documentId: z.string().optional().describe('Document ID if embedding document content'),
      chunkId: z.string().optional().describe('Chunk ID if embedding document chunk'),
    }).describe('Request metadata for tracing and context'),
  }),

  outputSchema: z.object({
    embedding: z.array(z.number()).describe('Generated embedding vector'),

    dimensions: z.number().describe('Actual dimensions of the embedding'),

    normalized: z.boolean().describe('Whether the embedding is normalized'),

    inputLength: z.number().describe('Input text length in characters'),

    model: z.string().describe('Model used for embedding generation'),

    processingTimeMs: z.number().describe('Request processing time in milliseconds'),

    traceId: z.string().optional().describe('Langfuse trace ID for monitoring'),

    metadata: z.record(z.any()).optional().describe('Request metadata echo'),
  }),
} as const;

/**
 * Titan Batch Embedding Tool Schema
 */
export const TitanBatchEmbeddingToolSchema = {
  id: 'bedrock-titan-generate-batch-embeddings',
  inputSchema: z.object({
    inputTexts: z.array(z.string().min(1).max(8000)).min(1).max(20).describe('Array of texts to generate embeddings for'),

    dimensions: z.enum([256, 512, 1024]).default(1024).describe('Embedding dimensions for all texts'),

    normalize: z.boolean().default(true).describe('Whether to normalize all embedding vectors'),

    metadata: BaseMetadataSchema.extend({
      batchId: z.string().optional().describe('Batch processing identifier'),
    }).describe('Batch processing metadata'),
  }),

  outputSchema: z.object({
    embeddings: z.array(z.array(z.number())).describe('Array of generated embedding vectors'),

    stats: z.object({
      totalInputs: z.number().describe('Total number of input texts'),
      successfulEmbeddings: z.number().describe('Number of successful embeddings'),
      failedEmbeddings: z.number().describe('Number of failed embeddings'),
      totalProcessingTimeMs: z.number().describe('Total processing time'),
      averageProcessingTimeMs: z.number().describe('Average processing time per embedding'),
    }).describe('Batch processing statistics'),

    failures: z.array(z.object({
      index: z.number().describe('Index of the failed input'),
      inputText: z.string().describe('Text that failed to embed'),
      error: z.string().describe('Error message'),
    })).optional().describe('Details of any failed embeddings'),

    traceId: z.string().optional().describe('Langfuse trace ID for monitoring'),
  }),
} as const;

/**
 * Service Health Check Tool Schema
 */
export const BedrockHealthCheckToolSchema = {
  id: 'bedrock-health-check',
  inputSchema: z.object({
    includeMetrics: z.boolean().default(false).describe('Whether to include performance metrics'),
    metadata: BaseMetadataSchema.describe('Request metadata'),
  }),

  outputSchema: z.object({
    healthy: z.boolean().describe('Overall service health status'),

    components: z.object({
      awsConnection: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']).describe('Component status'),
        lastCheck: z.string().describe('Last successful check timestamp'),
        responseTimeMs: z.number().optional().describe('Response time for last check'),
        error: z.string().optional().describe('Error message if unhealthy'),
        details: z.record(z.any()).optional().describe('Additional component details'),
      }).describe('AWS connection health'),

      claudeModel: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
        lastCheck: z.string(),
        responseTimeMs: z.number().optional(),
        error: z.string().optional(),
        details: z.record(z.any()).optional(),
      }).describe('Claude 4 Sonnet model health'),

      titanModel: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
        lastCheck: z.string(),
        responseTimeMs: z.number().optional(),
        error: z.string().optional(),
        details: z.record(z.any()).optional(),
      }).describe('Titan v2 embeddings model health'),

      langfuseMonitoring: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
        lastCheck: z.string(),
        responseTimeMs: z.number().optional(),
        error: z.string().optional(),
        details: z.record(z.any()).optional(),
      }).describe('Langfuse monitoring health'),

      circuitBreaker: z.object({
        status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
        lastCheck: z.string(),
        responseTimeMs: z.number().optional(),
        error: z.string().optional(),
        details: z.record(z.any()).optional(),
      }).describe('Circuit breaker health'),
    }).describe('Individual component health statuses'),

    timestamp: z.string().describe('Health check timestamp'),

    metadata: z.object({
      region: z.string().describe('AWS region'),
      version: z.string().describe('Service version'),
      uptime: z.number().describe('Service uptime in seconds'),
    }).describe('Service metadata'),

    metrics: z.object({
      requests: z.object({
        total: z.number(),
        successful: z.number(),
        failed: z.number(),
        averageLatency: z.number(),
        p95Latency: z.number(),
        p99Latency: z.number(),
      }),
      claude: z.object({
        totalRequests: z.number(),
        totalTokensGenerated: z.number(),
        averageTokensPerRequest: z.number(),
        costEstimate: z.number(),
      }),
      titan: z.object({
        totalRequests: z.number(),
        totalEmbeddings: z.number(),
        averageProcessingTime: z.number(),
        costEstimate: z.number(),
      }),
      circuitBreaker: z.object({
        state: z.enum(['closed', 'open', 'half-open']),
        failureCount: z.number(),
        successCount: z.number(),
        lastStateChange: z.string(),
      }),
    }).optional().describe('Performance metrics (if requested)'),
  }),
} as const;

/**
 * Vector Storage Integration Tool Schema
 */
export const VectorStorageToolSchema = {
  id: 'bedrock-vector-storage',
  inputSchema: z.object({
    operation: z.enum(['store', 'search']).describe('Vector operation type'),

    // For storage operations
    content: z.string().optional().describe('Content to embed and store'),
    embedding: z.array(z.number()).optional().describe('Pre-computed embedding to store'),

    // For search operations
    query: z.string().optional().describe('Search query text'),
    queryEmbedding: z.array(z.number()).optional().describe('Pre-computed query embedding'),

    // Common parameters
    table: z.enum(['user_memories', 'global_memories', 'document_chunks']).describe('Target storage table'),
    dimensions: z.number().min(256).max(1536).describe('Vector dimensions'),

    // Storage-specific parameters
    userId: z.string().optional().describe('User ID for user_memories table'),
    category: z.string().default('general').describe('Content category'),

    // Search-specific parameters
    maxResults: z.number().min(1).max(50).default(10).describe('Maximum search results'),
    minScore: z.number().min(0).max(1).default(0.7).describe('Minimum similarity score'),

    metadata: BaseMetadataSchema.describe('Operation metadata'),
  }).refine(
    (data) => {
      if (data.operation === 'store') {
        return data.content || data.embedding;
      }
      if (data.operation === 'search') {
        return data.query || data.queryEmbedding;
      }
      return false;
    },
    {
      message: "Store operations require 'content' or 'embedding', search operations require 'query' or 'queryEmbedding'",
    }
  ),

  outputSchema: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),

    // For storage operations
    id: z.string().optional().describe('ID of stored item (for storage operations)'),

    // For search operations
    results: z.array(z.object({
      id: z.string().describe('Result item ID'),
      content: z.string().describe('Result content'),
      similarity: z.number().describe('Similarity score'),
      metadata: z.record(z.any()).describe('Result metadata'),
    })).optional().describe('Search results (for search operations)'),

    processingTimeMs: z.number().describe('Operation processing time'),
    traceId: z.string().optional().describe('Trace ID for monitoring'),
  }),
} as const;

/**
 * Configuration Management Tool Schema
 */
export const ConfigManagementToolSchema = {
  id: 'bedrock-config-management',
  inputSchema: z.object({
    operation: z.enum(['get', 'update', 'reset']).describe('Configuration operation'),

    modelType: z.enum(['claude', 'titan']).optional().describe('Model type to configure'),

    // For update operations
    config: z.record(z.any()).optional().describe('New configuration values'),

    metadata: BaseMetadataSchema.describe('Request metadata'),
  }),

  outputSchema: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),

    config: z.record(z.any()).optional().describe('Current configuration (for get operations)'),

    updated: z.record(z.any()).optional().describe('Updated configuration (for update operations)'),

    message: z.string().optional().describe('Operation result message'),

    traceId: z.string().optional().describe('Trace ID for monitoring'),
  }),
} as const;

/**
 * All tool schemas for export
 */
export const ALL_TOOL_SCHEMAS = [
  ClaudeTextGenerationToolSchema,
  ClaudeStreamingToolSchema,
  TitanEmbeddingToolSchema,
  TitanBatchEmbeddingToolSchema,
  BedrockHealthCheckToolSchema,
  VectorStorageToolSchema,
  ConfigManagementToolSchema,
] as const;

/**
 * Tool schema validation helpers
 */
export const ToolValidation = {
  /**
   * Validate input against a tool schema
   */
  validateInput: <T>(schema: { inputSchema: z.ZodSchema<T> }, input: unknown): T => {
    return schema.inputSchema.parse(input);
  },

  /**
   * Validate output against a tool schema
   */
  validateOutput: <T>(schema: { outputSchema: z.ZodSchema<T> }, output: unknown): T => {
    return schema.outputSchema.parse(output);
  },

  /**
   * Check if input is valid for a tool schema
   */
  isValidInput: <T>(schema: { inputSchema: z.ZodSchema<T> }, input: unknown): input is T => {
    return schema.inputSchema.safeParse(input).success;
  },

  /**
   * Check if output is valid for a tool schema
   */
  isValidOutput: <T>(schema: { outputSchema: z.ZodSchema<T> }, output: unknown): output is T => {
    return schema.outputSchema.safeParse(output).success;
  },
} as const;

/**
 * Tool metadata for Mastra registration
 */
export const ToolMetadata = {
  [ClaudeTextGenerationToolSchema.id]: {
    name: 'Generate Text with Claude 4 Sonnet',
    description: 'Generate high-quality text using Claude 4 Sonnet model with customizable parameters',
    category: 'text-generation',
    tags: ['claude', 'text', 'ai', 'generation'],
    version: '1.0.0',
  },
  [ClaudeStreamingToolSchema.id]: {
    name: 'Stream Text with Claude 4 Sonnet',
    description: 'Generate streaming text responses using Claude 4 Sonnet for real-time applications',
    category: 'text-generation',
    tags: ['claude', 'text', 'ai', 'streaming'],
    version: '1.0.0',
  },
  [TitanEmbeddingToolSchema.id]: {
    name: 'Generate Embeddings with Titan v2',
    description: 'Generate high-quality text embeddings using Amazon Titan v2 model',
    category: 'embeddings',
    tags: ['titan', 'embeddings', 'vector', 'search'],
    version: '1.0.0',
  },
  [TitanBatchEmbeddingToolSchema.id]: {
    name: 'Batch Generate Embeddings with Titan v2',
    description: 'Generate multiple text embeddings efficiently using Amazon Titan v2 model',
    category: 'embeddings',
    tags: ['titan', 'embeddings', 'vector', 'batch'],
    version: '1.0.0',
  },
  [BedrockHealthCheckToolSchema.id]: {
    name: 'Check Bedrock Service Health',
    description: 'Monitor the health and performance of the Bedrock LLM service',
    category: 'monitoring',
    tags: ['health', 'monitoring', 'diagnostics'],
    version: '1.0.0',
  },
  [VectorStorageToolSchema.id]: {
    name: 'Vector Storage Operations',
    description: 'Store and search embeddings in the vector database with automatic embedding generation',
    category: 'storage',
    tags: ['vector', 'storage', 'search', 'embeddings'],
    version: '1.0.0',
  },
  [ConfigManagementToolSchema.id]: {
    name: 'Manage Bedrock Configuration',
    description: 'Dynamically manage Bedrock service configuration for Claude and Titan models',
    category: 'configuration',
    tags: ['config', 'management', 'models'],
    version: '1.0.0',
  },
} as const;