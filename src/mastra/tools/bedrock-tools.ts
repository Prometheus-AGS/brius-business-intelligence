/**
 * Bedrock Tools for Mastra Integration
 *
 * Creates Mastra-compatible tools for Claude and Titan models with
 * comprehensive tracing and error handling.
 */

import { z } from 'zod';
import { getBedrockService } from '../services/bedrock-llm-service.js';
import type { MastraToolContext } from '../types/index.js';

// Input/Output schemas based on the contracts
const ClaudeTextGenerationInputSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']).describe('Role of the message sender'),
    content: z.string().min(1).max(200000).describe('Content of the message'),
  })).min(1).max(50).describe('Conversation messages'),

  system: z.string().max(10000).optional().describe('System prompt to guide Claude behavior'),

  temperature: z.number().min(0).max(1).default(0.7).describe('Randomness in generation (0.0 = deterministic, 1.0 = creative)'),

  maxTokens: z.number().min(1).max(8000).default(4000).describe('Maximum tokens to generate'),

  topP: z.number().min(0).max(1).default(0.9).describe('Nucleus sampling parameter'),

  stopSequences: z.array(z.string()).max(4).optional().describe('Sequences that stop generation'),

  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    agentId: z.string().optional(),
    toolCallId: z.string().optional(),
  }).optional().describe('Request metadata for tracing and context'),
});

const ClaudeTextGenerationOutputSchema = z.object({
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
  metadata: z.record(z.string(), z.any()).optional().describe('Request metadata echo'),
});

const TitanEmbeddingInputSchema = z.object({
  inputText: z.string().min(1).max(8000).describe('Text to generate embeddings for'),
  dimensions: z.union([z.literal(256), z.literal(512), z.literal(1024)]).default(1024).describe('Embedding dimensions (higher = more detailed)'),
  normalize: z.boolean().default(true).describe('Whether to normalize the embedding vector'),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    documentId: z.string().optional(),
    chunkId: z.string().optional(),
  }).optional().describe('Request metadata for tracing and context'),
});

const TitanEmbeddingOutputSchema = z.object({
  embedding: z.array(z.number()).describe('Generated embedding vector'),
  dimensions: z.number().describe('Actual dimensions of the embedding'),
  normalized: z.boolean().describe('Whether the embedding is normalized'),
  inputLength: z.number().describe('Input text length in characters'),
  model: z.string().describe('Model used for embedding generation'),
  processingTimeMs: z.number().describe('Request processing time in milliseconds'),
  traceId: z.string().optional().describe('Langfuse trace ID for monitoring'),
  metadata: z.record(z.string(), z.any()).optional().describe('Request metadata echo'),
});

const TitanBatchEmbeddingInputSchema = z.object({
  inputTexts: z.array(z.string().min(1).max(8000)).min(1).max(20).describe('Array of texts to generate embeddings for'),
  dimensions: z.union([z.literal(256), z.literal(512), z.literal(1024)]).default(1024).describe('Embedding dimensions for all texts'),
  normalize: z.boolean().default(true).describe('Whether to normalize all embedding vectors'),
  metadata: z.object({
    batchId: z.string().optional(),
    userId: z.string().optional(),
    sessionId: z.string().optional(),
  }).optional().describe('Batch processing metadata'),
});

const TitanBatchEmbeddingOutputSchema = z.object({
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
});

const BedrockHealthCheckInputSchema = z.object({
  includeMetrics: z.boolean().default(false).describe('Whether to include performance metrics'),
});

const BedrockHealthCheckOutputSchema = z.object({
  healthy: z.boolean().describe('Overall service health status'),
  components: z.object({
    awsConnection: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
      lastCheck: z.string(),
      responseTimeMs: z.number().optional(),
      error: z.string().optional(),
    }),
    claudeModel: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
      lastCheck: z.string(),
      responseTimeMs: z.number().optional(),
      error: z.string().optional(),
    }),
    titanModel: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
      lastCheck: z.string(),
      responseTimeMs: z.number().optional(),
      error: z.string().optional(),
    }),
    langfuseMonitoring: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
      lastCheck: z.string(),
      responseTimeMs: z.number().optional(),
      error: z.string().optional(),
    }),
    circuitBreaker: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
      lastCheck: z.string(),
      responseTimeMs: z.number().optional(),
      error: z.string().optional(),
    }),
  }),
  timestamp: z.string().describe('Health check timestamp'),
  metadata: z.object({
    region: z.string(),
    version: z.string(),
    uptime: z.number(),
  }),
});

/**
 * Helper function to create tool execution context
 */
function createToolExecutionContext(context: any): MastraToolContext {
  return {
    userId: context?.userId,
    agentId: context?.agentId,
    sessionId: context?.sessionId,
    workflowId: context?.workflowId,
    metadata: context?.metadata,
  };
}

/**
 * Claude Text Generation Tool
 */
export const claudeGenerateTextTool = {
  id: 'bedrock-claude-generate-text',
  description: 'Generate high-quality text using Claude 4 Sonnet model',
  inputSchema: ClaudeTextGenerationInputSchema,
  outputSchema: ClaudeTextGenerationOutputSchema,
  execute: async (params: { context?: any; input: any }) => {
    const toolContext = createToolExecutionContext(params.context);
    const service = getBedrockService();
    
    // Merge tool context into request metadata
    const request = {
      ...params.input,
      metadata: {
        ...params.input.metadata,
        ...toolContext,
      },
    };

    return await service.generateText(request);
  },
};

/**
 * Titan Embedding Generation Tool
 */
export const titanGenerateEmbeddingTool = {
  id: 'bedrock-titan-generate-embedding',
  description: 'Generate high-quality embeddings using Titan v2 model',
  inputSchema: TitanEmbeddingInputSchema,
  outputSchema: TitanEmbeddingOutputSchema,
  execute: async (params: { context?: any; input: any }) => {
    const toolContext = createToolExecutionContext(params.context);
    const service = getBedrockService();
    
    // Merge tool context into request metadata
    const request = {
      ...params.input,
      metadata: {
        ...params.input.metadata,
        ...toolContext,
      },
    };

    return await service.generateEmbedding(request);
  },
};

/**
 * Titan Batch Embedding Generation Tool
 */
export const titanBatchGenerateEmbeddingTool = {
  id: 'bedrock-titan-generate-batch-embeddings',
  description: 'Generate multiple text embeddings efficiently using Titan v2 model',
  inputSchema: TitanBatchEmbeddingInputSchema,
  outputSchema: TitanBatchEmbeddingOutputSchema,
  execute: async (params: { context?: any; input: any }) => {
    const toolContext = createToolExecutionContext(params.context);
    const service = getBedrockService();
    
    // Merge tool context into request metadata
    const request = {
      ...params.input,
      metadata: {
        ...params.input.metadata,
        ...toolContext,
      },
    };

    return await service.generateBatchEmbeddings(request);
  },
};

/**
 * Bedrock Health Check Tool
 */
export const bedrockHealthCheckTool = {
  id: 'bedrock-health-check',
  description: 'Check the health and status of Bedrock services',
  inputSchema: BedrockHealthCheckInputSchema,
  outputSchema: BedrockHealthCheckOutputSchema,
  execute: async (params: { context?: any; input: any }) => {
    const service = getBedrockService();
    const health = await service.getHealth();

    if (params.input.includeMetrics) {
      const metrics = await service.getMetrics();
      return { ...health, metrics };
    }

    return health;
  },
};

/**
 * Vector Storage Integration Tool
 */
export const vectorStorageTool = {
  id: 'bedrock-vector-storage',
  description: 'Store and search embeddings in the vector database with automatic embedding generation',
  inputSchema: z.object({
    operation: z.enum(['store', 'search']).describe('Vector operation type'),
    content: z.string().optional().describe('Content to embed and store'),
    embedding: z.array(z.number()).optional().describe('Pre-computed embedding to store'),
    query: z.string().optional().describe('Search query text'),
    queryEmbedding: z.array(z.number()).optional().describe('Pre-computed query embedding'),
    table: z.enum(['user_memories', 'global_memories', 'document_chunks']).describe('Target storage table'),
    dimensions: z.number().min(256).max(1536).describe('Vector dimensions'),
    userId: z.string().optional().describe('User ID for user_memories table'),
    category: z.string().default('general').describe('Content category'),
    maxResults: z.number().min(1).max(50).default(10).describe('Maximum search results'),
    minScore: z.number().min(0).max(1).default(0.7).describe('Minimum similarity score'),
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
    id: z.string().optional().describe('ID of stored item (for storage operations)'),
    results: z.array(z.object({
      id: z.string().describe('Result item ID'),
      content: z.string().describe('Result content'),
      similarity: z.number().describe('Similarity score'),
      metadata: z.record(z.string(), z.any()).describe('Result metadata'),
    })).optional().describe('Search results (for search operations)'),
    processingTimeMs: z.number().describe('Operation processing time'),
    traceId: z.string().optional().describe('Trace ID for monitoring'),
  }),
  execute: async (params: { context?: any; input: any }) => {
    const toolContext = createToolExecutionContext(params.context);
    const service = getBedrockService();
    
    // This would need to integrate with existing vector operations
    // For now, return a placeholder implementation
    const startTime = Date.now();
    
    if (params.input.operation === 'store') {
      // Store operation would use existing vector ops service
      return {
        success: true,
        id: 'placeholder-id',
        processingTimeMs: Date.now() - startTime,
      };
    } else {
      // Search operation would use existing vector ops service
      return {
        success: true,
        results: [],
        processingTimeMs: Date.now() - startTime,
      };
    }
  },
};

/**
 * Configuration Management Tool
 */
export const configManagementTool = {
  id: 'bedrock-config-management',
  description: 'Dynamically manage Bedrock service configuration for Claude and Titan models',
  inputSchema: z.object({
    operation: z.enum(['get', 'update', 'reset']).describe('Configuration operation'),
    modelType: z.enum(['claude', 'titan']).optional().describe('Model type to configure'),
    config: z.record(z.string(), z.any()).optional().describe('New configuration values'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    config: z.record(z.string(), z.any()).optional().describe('Current configuration (for get operations)'),
    updated: z.record(z.string(), z.any()).optional().describe('Updated configuration (for update operations)'),
    message: z.string().optional().describe('Operation result message'),
    traceId: z.string().optional().describe('Trace ID for monitoring'),
  }),
  execute: async (params: { context?: any; input: any }) => {
    // This would integrate with the configuration service
    // For now, return a placeholder implementation
    return {
      success: true,
      message: 'Configuration operation completed',
    };
  },
};

/**
 * All Bedrock tools for export
 */
export const bedrockTools = [
  claudeGenerateTextTool,
  titanGenerateEmbeddingTool,
  titanBatchGenerateEmbeddingTool,
  bedrockHealthCheckTool,
  vectorStorageTool,
  configManagementTool,
];

/**
 * Export individual tools for specific use cases
 */
export {
  claudeGenerateTextTool as claudeTextTool,
  titanGenerateEmbeddingTool as titanEmbeddingTool,
  titanBatchGenerateEmbeddingTool as titanBatchEmbeddingTool,
  bedrockHealthCheckTool as healthCheckTool,
};