/**
 * Memory Storage Implementation using pgvector 17
 * Constitutional requirement: Replaces Supabase with direct pgvector operations
 */

import { getVectorOpsService, VectorSearchResult as VectorOpsResult } from '../database/vector-ops.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { generateSingleEmbedding } from './embeddings.js';

export interface VectorSearchOptions {
  vector: number[];
  tableName: 'user_memories' | 'global_memories' | 'document_chunks';
  topK?: number;
  similarityThreshold?: number;
  filters?: Record<string, any>;
  includeDistance?: boolean;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  distance?: number;
  similarity: number;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface MemoryStoreOptions {
  userId?: string;
  category?: string;
  metadata?: Record<string, any>;
  accessLevel?: 'public' | 'restricted' | 'admin';
}

/**
 * PGVector Storage Manager (Constitutional Compliance)
 */
export class PGVectorStorage {
  private vectorOps = getVectorOpsService();

  /**
   * Store user memory with automatic embedding generation
   */
  async storeUserMemory(
    userId: string,
    content: string,
    options: MemoryStoreOptions = {}
  ): Promise<string> {
    return await withErrorHandling(
      async () => {
        // Generate embedding for content
        const embedding = await generateSingleEmbedding(content);

        // Store using pgvector functions
        return await this.vectorOps.storeUserMemory(
          userId,
          content,
          embedding,
          options.category || 'general',
          options.metadata || {}
        );
      },
      {
        component: 'database',
        operation: 'store_user_memory',
        userId,
        metadata: { contentLength: content.length, category: options.category },
      },
      'medium'
    );
  }

  /**
   * Store global memory with automatic embedding generation
   */
  async storeGlobalMemory(
    content: string,
    options: MemoryStoreOptions = {}
  ): Promise<string> {
    return await withErrorHandling(
      async () => {
        // Generate embedding for content
        const embedding = await generateSingleEmbedding(content);

        // Store using pgvector functions
        return await this.vectorOps.storeGlobalMemory(
          content,
          embedding,
          options.category || 'general',
          options.accessLevel || 'public',
          options.userId,
          options.metadata || {}
        );
      },
      {
        component: 'database',
        operation: 'store_global_memory',
        userId: options.userId,
        metadata: { contentLength: content.length, category: options.category },
      },
      'medium'
    );
  }

  /**
   * Performs vector similarity search using pgvector functions
   */
  async vectorSearch(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    return await withErrorHandling(
      async () => {
        const {
          vector,
          tableName,
          topK = 10,
          similarityThreshold = 0.7,
          filters = {},
        } = options;

        // Validate vector dimensions for pgvector 17
        if (vector.length !== 1536) {
          throw new Error(`Invalid vector dimension: ${vector.length} (expected 1536 for pgvector)`);
        }

        // Use pgvector semantic search function
        const results = await this.vectorOps.semanticSearch(vector, {
          searchTable: tableName,
          userFilter: filters.user_id,
          matchThreshold: similarityThreshold,
          matchCount: topK,
        });

        // Convert to expected format
        return results.map(result => ({
          id: result.id,
          content: result.content,
          similarity: result.similarity,
          metadata: result.metadata,
        }));
      },
      {
        component: 'database',
        operation: 'vector_search',
        metadata: {
          tableName: options.tableName,
          topK: options.topK,
          similarityThreshold: options.similarityThreshold,
        },
      },
      'medium'
    );
  }

  /**
   * Performs hybrid search combining vector similarity and full-text search
   */
  async hybridSearch(options: {
    textQuery: string;
    vectorQuery?: number[];
    tableName: 'user_memories' | 'global_memories' | 'document_chunks';
    topK?: number;
    vectorWeight?: number;
    textWeight?: number;
    filters?: Record<string, any>;
  }): Promise<VectorSearchResult[]> {
    return await withErrorHandling(
      async () => {
        const {
          textQuery,
          vectorQuery,
          tableName,
          topK = 10,
          vectorWeight = 0.7,
          textWeight = 0.3,
        } = options;

        // Generate vector embedding if not provided
        const vector = vectorQuery || await generateSingleEmbedding(textQuery);

        // Only document_chunks supports hybrid search in our postgres functions
        if (tableName !== 'document_chunks') {
          // Fall back to vector search for other tables
          return await this.vectorSearch({
            vector,
            tableName,
            topK,
            similarityThreshold: 0.5,
            filters: options.filters,
          });
        }

        // Use pgvector hybrid search function
        const results = await this.vectorOps.hybridSearch(textQuery, vector, {
          searchTable: 'document_chunks',
          textWeight,
          vectorWeight,
          matchCount: topK,
        });

        // Convert to expected format
        return results.map(result => ({
          id: result.id,
          content: result.content,
          similarity: result.rank, // rank becomes similarity for compatibility
          metadata: result.metadata,
        }));
      },
      {
        component: 'database',
        operation: 'hybrid_search',
        metadata: {
          tableName: options.tableName,
          topK: options.topK,
          vectorWeight: options.vectorWeight,
          textWeight: options.textWeight,
        },
      },
      'medium'
    );
  }

  /**
   * Search user memories by text query
   */
  async searchUserMemories(
    userId: string,
    query: string,
    options: {
      topK?: number;
      similarityThreshold?: number;
      category?: string;
    } = {}
  ): Promise<VectorSearchResult[]> {
    return await withErrorHandling(
      async () => {
        // Generate embedding for query
        const queryVector = await generateSingleEmbedding(query);

        // Search using pgvector functions
        const results = await this.vectorOps.semanticSearch(queryVector, {
          searchTable: 'user_memories',
          userFilter: userId,
          matchThreshold: options.similarityThreshold || 0.7,
          matchCount: options.topK || 10,
        });

        // Filter by category if specified
        const filteredResults = options.category
          ? results.filter(r => r.metadata?.category === options.category)
          : results;

        return filteredResults.map(result => ({
          id: result.id,
          content: result.content,
          similarity: result.similarity,
          metadata: result.metadata,
        }));
      },
      {
        component: 'database',
        operation: 'search_user_memories',
        userId,
        metadata: { query: query.slice(0, 100), ...options },
      },
      'medium'
    );
  }

  /**
   * Search global memories by text query
   */
  async searchGlobalMemories(
    query: string,
    options: {
      topK?: number;
      similarityThreshold?: number;
      accessLevel?: 'public' | 'restricted' | 'admin';
    } = {}
  ): Promise<VectorSearchResult[]> {
    return await withErrorHandling(
      async () => {
        // Generate embedding for query
        const queryVector = await generateSingleEmbedding(query);

        // Search using pgvector functions
        const results = await this.vectorOps.semanticSearch(queryVector, {
          searchTable: 'global_memories',
          matchThreshold: options.similarityThreshold || 0.7,
          matchCount: options.topK || 10,
        });

        // Filter by access level if specified
        const filteredResults = options.accessLevel
          ? results.filter(r => r.metadata?.access_level === options.accessLevel)
          : results;

        return filteredResults.map(result => ({
          id: result.id,
          content: result.content,
          similarity: result.similarity,
          metadata: result.metadata,
        }));
      },
      {
        component: 'database',
        operation: 'search_global_memories',
        metadata: { query: query.slice(0, 100), ...options },
      },
      'medium'
    );
  }

  /**
   * Health check for vector storage system using pgvector functions
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    pgvectorEnabled: boolean;
    functionsAvailable: boolean;
    performanceAcceptable: boolean;
    issues: string[];
  }> {
    return await withErrorHandling(
      async () => {
        const issues: string[] = [];

        // Check pgvector and functions using vector ops service
        const vectorHealth = await this.vectorOps.checkVectorHealth();

        if (!vectorHealth.healthy) {
          issues.push(vectorHealth.error || 'Vector operations not healthy');
        }

        if (!vectorHealth.pgvectorVersion) {
          issues.push('pgvector extension not available');
        }

        if (!vectorHealth.functionsAvailable) {
          issues.push('Required postgres functions not available');
        }

        // Test basic search performance
        let performanceAcceptable = true;
        try {
          const testVector = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
          const startTime = Date.now();

          await this.vectorOps.semanticSearch(testVector, {
            searchTable: 'user_memories',
            matchCount: 1,
          });

          const searchTime = Date.now() - startTime;
          performanceAcceptable = searchTime < 2000;

          if (!performanceAcceptable) {
            issues.push(`Vector search performance is slow: ${searchTime}ms`);
          }
        } catch (error) {
          performanceAcceptable = false;
          issues.push('Vector search performance test failed');
        }

        const healthy = vectorHealth.healthy && performanceAcceptable;

        return {
          healthy,
          pgvectorEnabled: Boolean(vectorHealth.pgvectorVersion),
          functionsAvailable: Boolean(vectorHealth.functionsAvailable),
          performanceAcceptable,
          issues,
        };
      },
      {
        component: 'database',
        operation: 'storage_health_check',
      },
      'low'
    ) || {
      healthy: false,
      pgvectorEnabled: false,
      functionsAvailable: false,
      performanceAcceptable: false,
      issues: ['Health check failed'],
    };
  }
}

// Export singleton instance for constitutional compliance
export const vectorStorage = new PGVectorStorage();

// Export class for custom implementations
export { PGVectorStorage };