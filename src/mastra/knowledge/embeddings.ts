import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { knowledgeLogger } from '../observability/logger.js';

/**
 * Knowledge Base Embeddings Service
 * Provides embedding generation using AWS Bedrock Titan v2
 * Optimized for knowledge base semantic search and retrieval
 */

export interface EmbeddingRequest {
  text: string;
  inputType?: 'search_document' | 'search_query' | 'classification' | 'clustering';
  truncate?: 'none' | 'start' | 'end';
  metadata?: {
    documentId?: string;
    chunkId?: string;
    category?: string;
    [key: string]: any;
  };
}

export interface EmbeddingResponse {
  embedding: number[];
  inputTokens: number;
  model: string;
  dimensions: number;
  processingTime: number;
  metadata?: Record<string, any>;
}

export interface BatchEmbeddingRequest {
  texts: Array<{
    text: string;
    id?: string;
    metadata?: Record<string, any>;
  }>;
  inputType?: EmbeddingRequest['inputType'];
  truncate?: EmbeddingRequest['truncate'];
  batchSize?: number;
  concurrency?: number;
}

export interface BatchEmbeddingResponse {
  embeddings: Array<{
    id?: string;
    embedding: number[];
    inputTokens: number;
    metadata?: Record<string, any>;
  }>;
  totalProcessingTime: number;
  totalTokens: number;
  averageProcessingTime: number;
  batchesProcessed: number;
  model: string;
  dimensions: number;
}

export interface EmbeddingStats {
  totalEmbeddings: number;
  totalTokens: number;
  averageProcessingTime: number;
  modelUsage: Record<string, number>;
  errorRate: number;
  dailyUsage: Array<{
    date: string;
    embeddings: number;
    tokens: number;
  }>;
}

// Validation schemas
const EmbeddingRequestSchema = z.object({
  text: z.string().min(1).max(25000), // Titan v2 limit
  inputType: z.enum(['search_document', 'search_query', 'classification', 'clustering']).default('search_document'),
  truncate: z.enum(['none', 'start', 'end']).default('end'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const BatchEmbeddingRequestSchema = z.object({
  texts: z.array(z.object({
    text: z.string().min(1).max(25000),
    id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(100), // Reasonable batch size limit
  inputType: z.enum(['search_document', 'search_query', 'classification', 'clustering']).default('search_document'),
  truncate: z.enum(['none', 'start', 'end']).default('end'),
  batchSize: z.number().min(1).max(20).default(10),
  concurrency: z.number().min(1).max(5).default(3),
});

/**
 * AWS Bedrock Titan v2 Embeddings Service
 */
export class KnowledgeEmbeddingsService {
  private bedrockClient: BedrockRuntimeClient;
  private modelId = 'amazon.titan-embed-text-v2:0';
  private maxRetries = 3;
  private retryDelay = 1000; // milliseconds
  private requestHistory: Array<{
    timestamp: Date;
    tokens: number;
    processingTime: number;
    success: boolean;
  }> = [];

  constructor() {
    // Initialize Bedrock client with region from environment
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      knowledgeLogger.warn('AWS credentials not found in environment variables');
    }
  }

  /**
   * Generate embedding for single text
   */
  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startTime = Date.now();

    knowledgeLogger.debug('Generating embedding', {
      text_length: request.text.length,
      input_type: request.inputType,
      model: this.modelId,
    });

    // Validate request
    const validation = EmbeddingRequestSchema.safeParse(request);
    if (!validation.success) {
      throw new Error(`Invalid embedding request: ${validation.error.message}`);
    }

    const validRequest = validation.data;

    try {
      // Prepare request payload for Titan v2
      const requestBody = {
        inputText: validRequest.text,
        dimensions: 1024, // Titan v2 supports up to 1024 dimensions
        normalize: true,
      };

      // Create the invoke model command
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      // Execute with retries
      const response = await this.executeWithRetry(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const processingTime = Date.now() - startTime;

      // Extract embedding from response
      const embedding = responseBody.embedding;
      const inputTokens = responseBody.inputTextTokenCount || this.estimateTokenCount(validRequest.text);

      // Record request for stats
      this.recordRequest(inputTokens, processingTime, true);

      const result: EmbeddingResponse = {
        embedding,
        inputTokens,
        model: this.modelId,
        dimensions: embedding.length,
        processingTime,
        metadata: validRequest.metadata,
      };

      knowledgeLogger.debug('Embedding generated successfully', {
        input_tokens: inputTokens,
        dimensions: embedding.length,
        processing_time_ms: processingTime,
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.recordRequest(0, processingTime, false);

      knowledgeLogger.error('Failed to generate embedding', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async generateBatchEmbeddings(request: BatchEmbeddingRequest): Promise<BatchEmbeddingResponse> {
    const startTime = Date.now();

    knowledgeLogger.info('Starting batch embedding generation', {
      texts_count: request.texts.length,
      batch_size: request.batchSize,
      concurrency: request.concurrency,
      model: this.modelId,
    });

    // Validate request
    const validation = BatchEmbeddingRequestSchema.safeParse(request);
    if (!validation.success) {
      throw new Error(`Invalid batch embedding request: ${validation.error.message}`);
    }

    const validRequest = validation.data;

    // Split texts into batches
    const batches: Array<typeof validRequest.texts> = [];
    for (let i = 0; i < validRequest.texts.length; i += validRequest.batchSize) {
      batches.push(validRequest.texts.slice(i, i + validRequest.batchSize));
    }

    // Process batches with controlled concurrency
    const allEmbeddings: BatchEmbeddingResponse['embeddings'] = [];
    let totalTokens = 0;
    let batchesProcessed = 0;

    const processBatch = async (batch: typeof validRequest.texts): Promise<void> => {
      const batchPromises = batch.map(async (item) => {
        const embeddingRequest: EmbeddingRequest = {
          text: item.text,
          inputType: validRequest.inputType,
          truncate: validRequest.truncate,
          metadata: item.metadata,
        };

        const result = await this.generateEmbedding(embeddingRequest);

        return {
          id: item.id,
          embedding: result.embedding,
          inputTokens: result.inputTokens,
          metadata: item.metadata,
        };
      });

      const batchResults = await Promise.all(batchPromises);
      allEmbeddings.push(...batchResults);
      totalTokens += batchResults.reduce((sum, result) => sum + result.inputTokens, 0);
      batchesProcessed++;

      knowledgeLogger.debug('Batch processed', {
        batch_number: batchesProcessed,
        batch_size: batch.length,
        total_processed: allEmbeddings.length,
      });
    };

    // Process batches with concurrency control
    const batchPromises: Promise<void>[] = [];
    const semaphore = new Array(validRequest.concurrency).fill(0);

    for (const batch of batches) {
      const processWithSemaphore = async () => {
        await processBatch(batch);
      };

      if (batchPromises.length < validRequest.concurrency) {
        batchPromises.push(processWithSemaphore());
      } else {
        await Promise.race(batchPromises);
        const finishedIndex = batchPromises.findIndex(async (p) => {
          try { await p; return true; } catch { return true; }
        });
        batchPromises[finishedIndex] = processWithSemaphore();
      }
    }

    // Wait for all remaining batches
    await Promise.all(batchPromises);

    const totalProcessingTime = Date.now() - startTime;
    const averageProcessingTime = totalProcessingTime / allEmbeddings.length;

    const result: BatchEmbeddingResponse = {
      embeddings: allEmbeddings,
      totalProcessingTime,
      totalTokens,
      averageProcessingTime,
      batchesProcessed,
      model: this.modelId,
      dimensions: allEmbeddings[0]?.embedding.length || 1024,
    };

    knowledgeLogger.info('Batch embedding generation completed', {
      total_embeddings: allEmbeddings.length,
      total_tokens: totalTokens,
      total_processing_time_ms: totalProcessingTime,
      average_processing_time_ms: averageProcessingTime.toFixed(2),
      batches_processed: batchesProcessed,
    });

    return result;
  }

  /**
   * Generate embedding optimized for search queries
   */
  async generateQueryEmbedding(query: string, metadata?: Record<string, any>): Promise<EmbeddingResponse> {
    return await this.generateEmbedding({
      text: query,
      inputType: 'search_query',
      truncate: 'end',
      metadata,
    });
  }

  /**
   * Generate embedding optimized for document chunks
   */
  async generateDocumentEmbedding(text: string, metadata?: Record<string, any>): Promise<EmbeddingResponse> {
    return await this.generateEmbedding({
      text,
      inputType: 'search_document',
      truncate: 'end',
      metadata,
    });
  }

  /**
   * Get similarity score between two embeddings
   */
  calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    return Math.max(-1, Math.min(1, similarity)); // Clamp to [-1, 1]
  }

  /**
   * Get service statistics
   */
  getStats(): EmbeddingStats {
    const totalRequests = this.requestHistory.length;
    const successfulRequests = this.requestHistory.filter(r => r.success);

    const totalEmbeddings = successfulRequests.length;
    const totalTokens = successfulRequests.reduce((sum, req) => sum + req.tokens, 0);
    const averageProcessingTime = totalEmbeddings > 0
      ? successfulRequests.reduce((sum, req) => sum + req.processingTime, 0) / totalEmbeddings
      : 0;

    const errorRate = totalRequests > 0 ? (totalRequests - totalEmbeddings) / totalRequests : 0;

    // Calculate daily usage for the last 7 days
    const dailyUsage = this.calculateDailyUsage();

    return {
      totalEmbeddings,
      totalTokens,
      averageProcessingTime,
      modelUsage: { [this.modelId]: totalEmbeddings },
      errorRate,
      dailyUsage,
    };
  }

  /**
   * Execute Bedrock command with retry logic
   */
  private async executeWithRetry(command: InvokeModelCommand, attempt = 1): Promise<any> {
    try {
      return await this.bedrockClient.send(command);
    } catch (error) {
      if (attempt >= this.maxRetries) {
        throw error;
      }

      // Check if error is retryable
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = errorMessage.includes('ThrottlingException') ||
                         errorMessage.includes('ServiceUnavailableException') ||
                         errorMessage.includes('InternalServerError');

      if (!isRetryable) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = this.retryDelay * Math.pow(2, attempt - 1);

      knowledgeLogger.warn('Retrying Bedrock request', {
        attempt,
        max_retries: this.maxRetries,
        delay_ms: delay,
        error: errorMessage,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
      return this.executeWithRetry(command, attempt + 1);
    }
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation for English text: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Record request for statistics
   */
  private recordRequest(tokens: number, processingTime: number, success: boolean): void {
    this.requestHistory.push({
      timestamp: new Date(),
      tokens,
      processingTime,
      success,
    });

    // Keep only last 1000 requests for memory efficiency
    if (this.requestHistory.length > 1000) {
      this.requestHistory = this.requestHistory.slice(-1000);
    }
  }

  /**
   * Calculate daily usage statistics
   */
  private calculateDailyUsage(): Array<{ date: string; embeddings: number; tokens: number }> {
    const dailyMap = new Map<string, { embeddings: number; tokens: number }>();

    // Get last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      dailyMap.set(dateKey, { embeddings: 0, tokens: 0 });
    }

    // Aggregate requests by date
    for (const request of this.requestHistory) {
      if (!request.success) continue;

      const dateKey = request.timestamp.toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey);

      if (existing) {
        existing.embeddings++;
        existing.tokens += request.tokens;
      }
    }

    return Array.from(dailyMap.entries()).map(([date, stats]) => ({
      date,
      ...stats,
    }));
  }
}

// Export main embedding function
export async function generateKnowledgeEmbeddings(text: string, inputType: EmbeddingRequest['inputType'] = 'search_document'): Promise<number[]> {
  const service = new KnowledgeEmbeddingsService();
  const result = await service.generateEmbedding({ text, inputType });
  return result.embedding;
}

// Export singleton instance
export const knowledgeEmbeddingsService = new KnowledgeEmbeddingsService();