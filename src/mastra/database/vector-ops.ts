/**
 * Vector Operations Service
 * Constitutional requirement for pgvector operations via postgres functions
 * Updated to support configurable dimensions for Bedrock Titan v2 embeddings
 */

import { getConnectionPool } from '../config/consolidated-database.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { getBedrockConfig } from '../config/bedrock-model.js';

export interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, any>;
}

export interface HybridSearchResult {
  id: string;
  content: string;
  rank: number;
  metadata: Record<string, any>;
}

export interface VectorSearchOptions {
  searchTable: 'user_memories' | 'global_memories' | 'document_chunks';
  userFilter?: string;
  matchThreshold?: number;
  matchCount?: number;
  expectedDimensions?: number; // Support configurable dimensions
}

export interface HybridSearchOptions {
  searchTable: 'document_chunks';
  textWeight?: number;
  vectorWeight?: number;
  matchCount?: number;
  expectedDimensions?: number; // Support configurable dimensions
}

export class VectorOperationsService {
  private connectionManager = getConnectionPool();

  /**
   * Get expected dimensions from configuration or options
   */
  private getExpectedDimensions(options?: { expectedDimensions?: number }): number {
    // Priority: 1. Explicit option, 2. Bedrock Titan config, 3. Default OpenAI (1536)
    if (options?.expectedDimensions) {
      return options.expectedDimensions;
    }

    try {
      const bedrockConfig = getBedrockConfig();
      return bedrockConfig.getTitanConfig().dimensions;
    } catch {
      // Fallback to OpenAI default if Bedrock config is not available
      return 1536;
    }
  }

  /**
   * Validate embedding dimensions
   */
  private validateEmbeddingDimensions(embedding: number[], expectedDimensions: number): void {
    if (embedding.length !== expectedDimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${expectedDimensions}, got ${embedding.length}. ` +
        `Supported dimensions: 256, 512, 1024 (Titan v2), 1536 (OpenAI)`
      );
    }

    // Validate that dimensions are supported
    const supportedDimensions = [256, 512, 1024, 1536];
    if (!supportedDimensions.includes(expectedDimensions)) {
      throw new Error(
        `Unsupported embedding dimensions: ${expectedDimensions}. ` +
        `Supported dimensions: ${supportedDimensions.join(', ')}`
      );
    }
  }

  /**
   * Perform semantic search using pgvector functions
   */
  async semanticSearch(
    queryEmbedding: number[],
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    return await withErrorHandling(
      async () => {
        const expectedDimensions = this.getExpectedDimensions(options);
        this.validateEmbeddingDimensions(queryEmbedding, expectedDimensions);

        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const query = `
          SELECT id, content, similarity, metadata
          FROM semantic_search(
            $1::vector,
            $2::text,
            $3::text,
            $4::float,
            $5::int
          )
        `;

        const params = [
          embeddingString,
          options.searchTable,
          options.userFilter || null,
          options.matchThreshold || 0.8,
          options.matchCount || 10,
        ];

        const result = await this.connectionManager.query<{
          id: string;
          content: string;
          similarity: number;
          metadata: Record<string, any>;
        }>(query, params);

        return result.rows;
      },
      {
        component: 'database',
        operation: 'semantic_search',
        metadata: {
          searchTable: options.searchTable,
          userFilter: options.userFilter,
          matchThreshold: options.matchThreshold,
          matchCount: options.matchCount,
          dimensions: this.getExpectedDimensions(options),
        },
      },
      'medium'
    );
  }

  /**
   * Perform hybrid text and vector search using postgres functions
   */
  async hybridSearch(
    queryText: string,
    queryEmbedding: number[],
    options: HybridSearchOptions
  ): Promise<HybridSearchResult[]> {
    return await withErrorHandling(
      async () => {
        const expectedDimensions = this.getExpectedDimensions(options);
        this.validateEmbeddingDimensions(queryEmbedding, expectedDimensions);

        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const query = `
          SELECT id, content, rank, metadata
          FROM hybrid_search(
            $1::text,
            $2::vector,
            $3::text,
            $4::float,
            $5::float,
            $6::int
          )
        `;

        const params = [
          queryText,
          embeddingString,
          options.searchTable,
          options.textWeight || 0.3,
          options.vectorWeight || 0.7,
          options.matchCount || 10,
        ];

        const result = await this.connectionManager.query<{
          id: string;
          content: string;
          rank: number;
          metadata: Record<string, any>;
        }>(query, params);

        return result.rows;
      },
      {
        component: 'database',
        operation: 'hybrid_search',
        metadata: {
          searchTable: options.searchTable,
          textWeight: options.textWeight,
          vectorWeight: options.vectorWeight,
          matchCount: options.matchCount,
          dimensions: this.getExpectedDimensions(options),
        },
      },
      'medium'
    );
  }

  /**
   * Store user memory with vector embedding
   */
  async storeUserMemory(
    userId: string,
    content: string,
    embedding: number[],
    category: string = 'general',
    metadata: Record<string, any> = {},
    expectedDimensions?: number
  ): Promise<string> {
    return await withErrorHandling(
      async () => {
        const dimensions = expectedDimensions || this.getExpectedDimensions();
        this.validateEmbeddingDimensions(embedding, dimensions);

        const embeddingString = `[${embedding.join(',')}]`;

        const query = `
          INSERT INTO user_memories (user_id, content, embedding, category, metadata)
          VALUES ($1, $2, $3::vector, $4, $5)
          RETURNING id
        `;

        const params = [userId, content, embeddingString, category, JSON.stringify(metadata)];
        const result = await this.connectionManager.query<{ id: string }>(query, params);

        if (!result.rows[0]) {
          throw new Error('Failed to store user memory');
        }

        return result.rows[0].id;
      },
      {
        component: 'database',
        operation: 'store_user_memory',
        userId,
        metadata: { category, contentLength: content.length, dimensions: expectedDimensions || this.getExpectedDimensions() },
      },
      'medium'
    );
  }

  /**
   * Store global memory with vector embedding
   */
  async storeGlobalMemory(
    content: string,
    embedding: number[],
    category: string = 'general',
    accessLevel: 'public' | 'restricted' | 'admin' = 'public',
    createdBy?: string,
    metadata: Record<string, any> = {},
    expectedDimensions?: number
  ): Promise<string> {
    return await withErrorHandling(
      async () => {
        const dimensions = expectedDimensions || this.getExpectedDimensions();
        this.validateEmbeddingDimensions(embedding, dimensions);

        const embeddingString = `[${embedding.join(',')}]`;

        const query = `
          INSERT INTO global_memories (content, embedding, category, access_level, created_by, metadata)
          VALUES ($1, $2::vector, $3, $4, $5, $6)
          RETURNING id
        `;

        const params = [content, embeddingString, category, accessLevel, createdBy, JSON.stringify(metadata)];
        const result = await this.connectionManager.query<{ id: string }>(query, params);

        if (!result.rows[0]) {
          throw new Error('Failed to store global memory');
        }

        return result.rows[0].id;
      },
      {
        component: 'database',
        operation: 'store_global_memory',
        metadata: { category, accessLevel, contentLength: content.length, dimensions: expectedDimensions || this.getExpectedDimensions() },
      },
      'medium'
    );
  }

  /**
   * Store document chunk with vector embedding
   */
  async storeDocumentChunk(
    documentId: string,
    chunkIndex: number,
    content: string,
    embedding: number[],
    chunkMetadata: Record<string, any> = {},
    expectedDimensions?: number
  ): Promise<string> {
    return await withErrorHandling(
      async () => {
        const dimensions = expectedDimensions || this.getExpectedDimensions();
        this.validateEmbeddingDimensions(embedding, dimensions);

        const embeddingString = `[${embedding.join(',')}]`;

        const query = `
          INSERT INTO document_chunks (document_id, chunk_index, content, embedding, chunk_metadata)
          VALUES ($1, $2, $3, $4::vector, $5)
          RETURNING id
        `;

        const params = [documentId, chunkIndex, content, embeddingString, JSON.stringify(chunkMetadata)];
        const result = await this.connectionManager.query<{ id: string }>(query, params);

        if (!result.rows[0]) {
          throw new Error('Failed to store document chunk');
        }

        return result.rows[0].id;
      },
      {
        component: 'database',
        operation: 'store_document_chunk',
        metadata: { documentId, chunkIndex, contentLength: content.length, dimensions: expectedDimensions || this.getExpectedDimensions() },
      },
      'medium'
    );
  }

  /**
   * Get current vector configuration information
   */
  getVectorConfig(): {
    currentDimensions: number;
    supportedDimensions: number[];
    embeddingProvider: string;
  } {
    const currentDimensions = this.getExpectedDimensions();
    const isBedrockTitan = currentDimensions !== 1536;

    return {
      currentDimensions,
      supportedDimensions: [256, 512, 1024, 1536],
      embeddingProvider: isBedrockTitan ? 'Bedrock Titan v2' : 'OpenAI (default)',
    };
  }

  /**
   * Check vector operations health
   */
  async checkVectorHealth(): Promise<{
    healthy: boolean;
    pgvectorVersion?: string;
    functionsAvailable?: boolean;
    vectorConfig?: ReturnType<VectorOperationsService['getVectorConfig']>;
    error?: string;
  }> {
    try {
      // Check pgvector extension
      const versionResult = await this.connectionManager.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
      );

      // Check if our functions exist
      const functionsResult = await this.connectionManager.query<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM pg_proc
         WHERE proname IN ('semantic_search', 'hybrid_search')`
      );

      const functionsAvailable = functionsResult.rows[0]?.count === 2;
      const pgvectorVersion = versionResult.rows[0]?.extversion;

      return {
        healthy: Boolean(pgvectorVersion && functionsAvailable),
        pgvectorVersion,
        functionsAvailable,
        vectorConfig: this.getVectorConfig(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        vectorConfig: this.getVectorConfig(),
      };
    }
  }
}

// Global service instance
let vectorOpsService: VectorOperationsService;

export function getVectorOpsService(): VectorOperationsService {
  if (!vectorOpsService) {
    vectorOpsService = new VectorOperationsService();
  }
  return vectorOpsService;
}