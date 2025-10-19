import { z } from 'zod';
import { getVectorOpsService } from '../database/vector-ops.js';
import { getConnectionManager } from '../database/connection.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { generateSingleEmbedding } from '../memory/embeddings.js';
import { knowledgeLogger } from '../observability/logger.js';

/**
 * Semantic Search Operations
 * Implements hybrid search combining semantic similarity and keyword matching
 * Provides comprehensive search functionality for the knowledge base
 */

export interface SearchQuery {
  query: string;
  filters?: {
    documentIds?: string[];
    categories?: string[];
    tags?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
    userId?: string;
    minScore?: number;
    maxResults?: number;
  };
  searchType?: 'semantic' | 'keyword' | 'hybrid';
  rerankResults?: boolean;
}

export interface SearchResult {
  chunk: {
    id: string;
    content: string;
    chunk_index: number;
    start_char: number;
    end_char: number;
    metadata: Record<string, any>;
  };
  document: {
    id: string;
    title: string;
    original_name: string;
    category?: string;
    tags?: string[];
    uploaded_at: string;
  };
  score: number;
  similarity_score?: number;
  keyword_score?: number;
  rank: number;
  highlight?: string;
  context?: {
    preceding?: string;
    following?: string;
  };
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
  query: string;
  searchType: 'semantic' | 'keyword' | 'hybrid';
  processingTime: number;
  metadata: {
    semanticResults?: number;
    keywordResults?: number;
    hybridScore?: number;
    queryEmbeddingTime?: number;
    searchTime?: number;
    rerankTime?: number;
  };
}

export interface SearchStats {
  totalDocuments: number;
  totalChunks: number;
  searchesPerformed: number;
  averageResponseTime: number;
  popularQueries: Array<{ query: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
}

// Validation schemas
const SearchQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  filters: z.object({
    documentIds: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    dateRange: z.object({
      start: z.date(),
      end: z.date(),
    }).optional(),
    userId: z.string().optional(),
    minScore: z.number().min(0).max(1).optional(),
    maxResults: z.number().min(1).max(100).default(20).optional(),
  }).optional(),
  searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid'),
  rerankResults: z.boolean().default(true),
});

/**
 * Knowledge Base Search Service
 * Constitutional requirement: Uses pgvector functions via direct database operations
 */
export class KnowledgeSearchService {
  private searchHistory: Array<{ query: string; timestamp: Date; responseTime: number }> = [];
  private maxHistorySize = 1000;
  private vectorOps = getVectorOpsService();
  private connectionManager = getConnectionManager();

  /**
   * Perform search across knowledge base
   */
  async search(searchQuery: SearchQuery): Promise<SearchResponse> {
    const startTime = Date.now();

    knowledgeLogger.info('Starting knowledge base search', {
      query: searchQuery.query.substring(0, 100),
      search_type: searchQuery.searchType,
      max_results: searchQuery.filters?.maxResults || 20,
    });

    // Validate search query
    const validation = SearchQuerySchema.safeParse(searchQuery);
    if (!validation.success) {
      throw new Error(`Invalid search query: ${validation.error.message}`);
    }

    const validQuery = validation.data;
    let results: SearchResult[] = [];
    let metadata: SearchResponse['metadata'] = {};

    switch (validQuery.searchType) {
      case 'semantic':
        results = await this.performSemanticSearch(validQuery);
        metadata.semanticResults = results.length;
        break;

      case 'keyword':
        results = await this.performKeywordSearch(validQuery);
        metadata.keywordResults = results.length;
        break;

      case 'hybrid':
        results = await this.performHybridSearch(validQuery);
        metadata.semanticResults = results.filter(r => r.similarity_score !== undefined).length;
        metadata.keywordResults = results.filter(r => r.keyword_score !== undefined).length;
        break;

      default:
        throw new Error(`Unknown search type: ${validQuery.searchType}`);
    }

    // Re-rank results if requested
    if (validQuery.rerankResults && results.length > 1) {
      const rerankStartTime = Date.now();
      results = await this.rerankResults(results, validQuery.query);
      metadata.rerankTime = Date.now() - rerankStartTime;
    }

    // Apply final filtering and ranking
    results = this.applyFinalFiltering(results, validQuery);

    const processingTime = Date.now() - startTime;

    // Record search in history
    this.recordSearch(validQuery.query, processingTime);

    const response: SearchResponse = {
      results,
      totalResults: results.length,
      query: validQuery.query,
      searchType: validQuery.searchType,
      processingTime,
      metadata,
    };

    knowledgeLogger.info('Knowledge base search completed', {
      query: validQuery.query.substring(0, 50),
      search_type: validQuery.searchType,
      results_count: results.length,
      processing_time_ms: processingTime,
    });

    return response;
  }

  /**
   * Perform semantic search using pgvector functions
   */
  private async performSemanticSearch(query: SearchQuery): Promise<SearchResult[]> {
    return await withErrorHandling(
      async () => {
        const embeddingStartTime = Date.now();

        // Generate embedding for query using pgvector-compatible embeddings
        const queryEmbedding = await generateSingleEmbedding(query.query);
        const queryEmbeddingTime = Date.now() - embeddingStartTime;

        const searchStartTime = Date.now();

        // Use pgvector semantic search function
        const searchResults = await this.vectorOps.semanticSearch(queryEmbedding, {
          searchTable: 'document_chunks',
          matchThreshold: query.filters?.minScore || 0.3,
          matchCount: query.filters?.maxResults || 20,
        });

        const searchTime = Date.now() - searchStartTime;

        // Get additional document metadata for results
        const results: SearchResult[] = [];

        for (const [index, result] of searchResults.entries()) {
          // Get document metadata using direct query
          const docQuery = `
            SELECT
              kd.id, kd.title, kd.file_path as original_name, kd.category,
              kd.tags, kd.created_at as uploaded_at,
              dc.chunk_index, dc.chunk_metadata
            FROM knowledge_documents kd
            JOIN document_chunks dc ON kd.id = dc.document_id
            WHERE dc.id = $1
          `;

          const docResult = await this.connectionManager.query(docQuery, [result.id]);
          const docData = docResult.rows[0];

          if (!docData) continue;

          // Apply filters
          if (query.filters?.documentIds?.length && !query.filters.documentIds.includes(docData.id)) {
            continue;
          }

          if (query.filters?.categories?.length && !query.filters.categories.includes(docData.category)) {
            continue;
          }

          if (query.filters?.tags?.length) {
            const docTags = docData.tags || [];
            const hasMatchingTag = query.filters.tags.some(tag => docTags.includes(tag));
            if (!hasMatchingTag) continue;
          }

          if (query.filters?.dateRange) {
            const uploadDate = new Date(docData.uploaded_at);
            if (uploadDate < query.filters.dateRange.start || uploadDate > query.filters.dateRange.end) {
              continue;
            }
          }

          results.push({
            chunk: {
              id: result.id,
              content: result.content,
              chunk_index: docData.chunk_index || 0,
              start_char: docData.chunk_metadata?.start_char || 0,
              end_char: docData.chunk_metadata?.end_char || result.content.length,
              metadata: result.metadata || {},
            },
            document: {
              id: docData.id,
              title: docData.title,
              original_name: docData.original_name || docData.title,
              category: docData.category,
              tags: docData.tags || [],
              uploaded_at: docData.uploaded_at,
            },
            score: result.similarity,
            similarity_score: result.similarity,
            rank: index + 1,
            highlight: this.generateHighlight(result.content, query.query),
          });
        }

        return results;
      },
      {
        component: 'knowledge',
        operation: 'semantic_search',
        metadata: {
          query: query.query.slice(0, 100),
          filters: query.filters,
        },
      },
      'medium'
    );
  }

  /**
   * Perform keyword search using full-text search via direct database queries
   */
  private async performKeywordSearch(query: SearchQuery): Promise<SearchResult[]> {
    return await withErrorHandling(
      async () => {
        const searchStartTime = Date.now();

        // Build full-text search query
        let sqlQuery = `
          SELECT
            dc.id as chunk_id,
            dc.content,
            dc.chunk_index,
            dc.chunk_metadata,
            kd.id as document_id,
            kd.title,
            kd.file_path as original_name,
            kd.category,
            kd.tags,
            kd.created_at as uploaded_at,
            ts_rank_cd(to_tsvector('english', dc.content), plainto_tsquery('english', $1)) as keyword_score
          FROM document_chunks dc
          JOIN knowledge_documents kd ON dc.document_id = kd.id
          WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', $1)
            AND kd.processing_status = 'completed'
        `;

        const queryParams: any[] = [query.query];
        let paramIndex = 2;

        // Apply filters
        if (query.filters?.documentIds?.length) {
          sqlQuery += ` AND kd.id = ANY($${paramIndex})`;
          queryParams.push(query.filters.documentIds);
          paramIndex++;
        }

        if (query.filters?.categories?.length) {
          sqlQuery += ` AND kd.category = ANY($${paramIndex})`;
          queryParams.push(query.filters.categories);
          paramIndex++;
        }

        if (query.filters?.tags?.length) {
          sqlQuery += ` AND kd.tags && $${paramIndex}`;
          queryParams.push(query.filters.tags);
          paramIndex++;
        }

        if (query.filters?.userId) {
          sqlQuery += ` AND kd.upload_user_id = $${paramIndex}`;
          queryParams.push(query.filters.userId);
          paramIndex++;
        }

        if (query.filters?.dateRange) {
          sqlQuery += ` AND kd.created_at >= $${paramIndex} AND kd.created_at <= $${paramIndex + 1}`;
          queryParams.push(query.filters.dateRange.start.toISOString());
          queryParams.push(query.filters.dateRange.end.toISOString());
          paramIndex += 2;
        }

        // Order by keyword score and limit results
        sqlQuery += `
          ORDER BY keyword_score DESC
          LIMIT $${paramIndex}
        `;
        queryParams.push(query.filters?.maxResults || 20);

        const result = await this.connectionManager.query(sqlQuery, queryParams);
        const searchTime = Date.now() - searchStartTime;

        const results: SearchResult[] = result.rows.map((row: any, index: number) => ({
          chunk: {
            id: row.chunk_id,
            content: row.content,
            chunk_index: row.chunk_index || 0,
            start_char: row.chunk_metadata?.start_char || 0,
            end_char: row.chunk_metadata?.end_char || row.content.length,
            metadata: row.chunk_metadata || {},
          },
          document: {
            id: row.document_id,
            title: row.title,
            original_name: row.original_name || row.title,
            category: row.category,
            tags: row.tags || [],
            uploaded_at: row.uploaded_at,
          },
          score: row.keyword_score,
          keyword_score: row.keyword_score,
          rank: index + 1,
          highlight: this.generateHighlight(row.content, query.query),
        }));

        return results;
      },
      {
        component: 'knowledge',
        operation: 'keyword_search',
        metadata: {
          query: query.query.slice(0, 100),
          filters: query.filters,
        },
      },
      'medium'
    );
  }

  /**
   * Perform hybrid search combining semantic and keyword search using pgvector functions
   */
  private async performHybridSearch(query: SearchQuery): Promise<SearchResult[]> {
    return await withErrorHandling(
      async () => {
        knowledgeLogger.debug('Performing hybrid search', {
          query: query.query.substring(0, 50),
        });

        // Generate embedding for hybrid search
        const queryEmbedding = await generateSingleEmbedding(query.query);

        // Use pgvector hybrid search function if available
        try {
          const hybridResults = await this.vectorOps.hybridSearch(
            query.query,
            queryEmbedding,
            {
              searchTable: 'document_chunks',
              textWeight: 0.3,
              vectorWeight: 0.7,
              matchCount: query.filters?.maxResults || 20,
            }
          );

          // Convert hybrid results to SearchResult format
          const results: SearchResult[] = [];

          for (const [index, result] of hybridResults.entries()) {
            // Get document metadata
            const docQuery = `
              SELECT
                kd.id, kd.title, kd.file_path as original_name, kd.category,
                kd.tags, kd.created_at as uploaded_at,
                dc.chunk_index, dc.chunk_metadata
              FROM knowledge_documents kd
              JOIN document_chunks dc ON kd.id = dc.document_id
              WHERE dc.id = $1
            `;

            const docResult = await this.connectionManager.query(docQuery, [result.id]);
            const docData = docResult.rows[0];

            if (!docData) continue;

            // Apply filters
            if (query.filters?.documentIds?.length && !query.filters.documentIds.includes(docData.id)) {
              continue;
            }

            if (query.filters?.categories?.length && !query.filters.categories.includes(docData.category)) {
              continue;
            }

            if (query.filters?.tags?.length) {
              const docTags = docData.tags || [];
              const hasMatchingTag = query.filters.tags.some(tag => docTags.includes(tag));
              if (!hasMatchingTag) continue;
            }

            if (query.filters?.dateRange) {
              const uploadDate = new Date(docData.uploaded_at);
              if (uploadDate < query.filters.dateRange.start || uploadDate > query.filters.dateRange.end) {
                continue;
              }
            }

            results.push({
              chunk: {
                id: result.id,
                content: result.content,
                chunk_index: docData.chunk_index || 0,
                start_char: docData.chunk_metadata?.start_char || 0,
                end_char: docData.chunk_metadata?.end_char || result.content.length,
                metadata: result.metadata || {},
              },
              document: {
                id: docData.id,
                title: docData.title,
                original_name: docData.original_name || docData.title,
                category: docData.category,
                tags: docData.tags || [],
                uploaded_at: docData.uploaded_at,
              },
              score: result.rank,
              similarity_score: result.rank, // hybrid rank becomes similarity score
              rank: index + 1,
              highlight: this.generateHighlight(result.content, query.query),
            });
          }

          return results;
        } catch (error) {
          // Fallback to separate semantic and keyword searches if hybrid function not available
          knowledgeLogger.warn('Hybrid search function not available, falling back to combined search', { error });

          const [semanticResults, keywordResults] = await Promise.all([
            this.performSemanticSearch({ ...query, searchType: 'semantic' }),
            this.performKeywordSearch({ ...query, searchType: 'keyword' }),
          ]);

          // Combine and score results
          const combinedResults = this.combineSearchResults(
            semanticResults,
            keywordResults,
            query.query
          );

          return combinedResults;
        }
      },
      {
        component: 'knowledge',
        operation: 'hybrid_search',
        metadata: {
          query: query.query.slice(0, 100),
          filters: query.filters,
        },
      },
      'medium'
    );
  }

  /**
   * Combine semantic and keyword search results
   */
  private combineSearchResults(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    query: string
  ): SearchResult[] {
    const resultMap = new Map<string, SearchResult>();

    // Add semantic results
    for (const result of semanticResults) {
      resultMap.set(result.chunk.id, {
        ...result,
        score: (result.similarity_score || 0) * 0.6, // Weight semantic score
      });
    }

    // Add or merge keyword results
    for (const result of keywordResults) {
      const existing = resultMap.get(result.chunk.id);
      if (existing) {
        // Combine scores for chunks found in both searches
        existing.score = (existing.score || 0) + (result.keyword_score || 0) * 0.4;
        existing.keyword_score = result.keyword_score;
      } else {
        // Add keyword-only result
        resultMap.set(result.chunk.id, {
          ...result,
          score: (result.keyword_score || 0) * 0.4, // Weight keyword score
        });
      }
    }

    // Convert to array and sort by combined score
    const combinedResults = Array.from(resultMap.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

    return combinedResults;
  }

  /**
   * Re-rank results using advanced scoring
   */
  private async rerankResults(results: SearchResult[], query: string): Promise<SearchResult[]> {
    knowledgeLogger.debug('Re-ranking search results', {
      results_count: results.length,
    });

    // Enhanced scoring factors
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);

    const rerankedResults = results.map(result => {
      let rerankScore = result.score || 0;

      // Boost for exact phrase matches
      if (result.chunk.content.toLowerCase().includes(query.toLowerCase())) {
        rerankScore *= 1.3;
      }

      // Boost for query terms in document title
      const titleLower = result.document.title.toLowerCase();
      const titleMatches = queryTerms.filter(term => titleLower.includes(term)).length;
      if (titleMatches > 0) {
        rerankScore *= 1 + (titleMatches / queryTerms.length) * 0.2;
      }

      // Boost for recent documents
      const uploadDate = new Date(result.document.uploaded_at);
      const daysSinceUpload = (Date.now() - uploadDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpload < 30) {
        rerankScore *= 1.1;
      }

      // Boost for chunks at the beginning of documents
      if (result.chunk.chunk_index < 3) {
        rerankScore *= 1.05;
      }

      return {
        ...result,
        score: rerankScore,
      };
    });

    // Re-sort by new scores
    return rerankedResults
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((result, index) => ({
        ...result,
        rank: index + 1,
      }));
  }

  /**
   * Apply final filtering and result limits
   */
  private applyFinalFiltering(results: SearchResult[], query: SearchQuery): SearchResult[] {
    let filteredResults = results;

    // Apply minimum score filter
    if (query.filters?.minScore) {
      filteredResults = filteredResults.filter(result =>
        (result.score || 0) >= query.filters!.minScore!
      );
    }

    // Apply maximum results limit
    const maxResults = query.filters?.maxResults || 20;
    if (filteredResults.length > maxResults) {
      filteredResults = filteredResults.slice(0, maxResults);
    }

    // Add context for better display
    return filteredResults.map(result => ({
      ...result,
      context: this.generateContext(result),
    }));
  }

  /**
   * Generate highlighted snippet from content
   */
  private generateHighlight(content: string, query: string, maxLength = 200): string {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const contentLower = content.toLowerCase();

    // Find the best position for highlight
    let bestPosition = 0;
    let maxMatches = 0;

    for (let i = 0; i <= content.length - maxLength; i += 50) {
      const snippet = contentLower.slice(i, i + maxLength);
      const matches = queryTerms.filter(term => snippet.includes(term)).length;

      if (matches > maxMatches) {
        maxMatches = matches;
        bestPosition = i;
      }
    }

    // Extract highlight snippet
    let highlight = content.slice(bestPosition, bestPosition + maxLength);

    // Trim to word boundaries
    if (bestPosition > 0) {
      const spaceIndex = highlight.indexOf(' ');
      if (spaceIndex > 0) {
        highlight = '...' + highlight.slice(spaceIndex);
      }
    }

    if (bestPosition + maxLength < content.length) {
      const lastSpaceIndex = highlight.lastIndexOf(' ');
      if (lastSpaceIndex > 0) {
        highlight = highlight.slice(0, lastSpaceIndex) + '...';
      }
    }

    return highlight;
  }

  /**
   * Generate context around the result
   */
  private generateContext(result: SearchResult): { preceding?: string; following?: string } {
    // This would ideally fetch surrounding chunks from the database
    // For now, use metadata if available
    return {
      preceding: result.chunk.metadata.precedingContext,
      following: result.chunk.metadata.followingContext,
    };
  }

  /**
   * Record search in history for analytics
   */
  private recordSearch(query: string, responseTime: number): void {
    this.searchHistory.push({
      query,
      timestamp: new Date(),
      responseTime,
    });

    // Keep history size manageable
    if (this.searchHistory.length > this.maxHistorySize) {
      this.searchHistory = this.searchHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get search statistics using direct database queries
   */
  async getSearchStats(): Promise<SearchStats> {
    return await withErrorHandling(
      async () => {
        // Get document and chunk counts using direct queries
        const docCountQuery = `
          SELECT COUNT(*) as count
          FROM knowledge_documents
          WHERE processing_status = 'completed'
        `;
        const docCountResult = await this.connectionManager.query(docCountQuery);
        const totalDocuments = parseInt(docCountResult.rows[0]?.count || '0');

        const chunkCountQuery = `
          SELECT COUNT(*) as count
          FROM document_chunks
        `;
        const chunkCountResult = await this.connectionManager.query(chunkCountQuery);
        const totalChunks = parseInt(chunkCountResult.rows[0]?.count || '0');

        // Calculate stats from search history
        const totalSearches = this.searchHistory.length;
        const averageResponseTime = totalSearches > 0
          ? this.searchHistory.reduce((sum, search) => sum + search.responseTime, 0) / totalSearches
          : 0;

        // Get popular queries
        const queryCount = new Map<string, number>();
        for (const search of this.searchHistory) {
          const normalized = search.query.toLowerCase().trim();
          queryCount.set(normalized, (queryCount.get(normalized) || 0) + 1);
        }

        const popularQueries = Array.from(queryCount.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([query, count]) => ({ query, count }));

        // Get top categories
        const categoriesQuery = `
          SELECT category, COUNT(*) as count
          FROM knowledge_documents
          WHERE processing_status = 'completed' AND category IS NOT NULL
          GROUP BY category
          ORDER BY count DESC
          LIMIT 10
        `;
        const categoriesResult = await this.connectionManager.query(categoriesQuery);

        const topCategories = categoriesResult.rows.map((row: any) => ({
          category: row.category,
          count: parseInt(row.count),
        }));

        return {
          totalDocuments,
          totalChunks,
          searchesPerformed: totalSearches,
          averageResponseTime,
          popularQueries,
          topCategories,
        };
      },
      {
        component: 'knowledge',
        operation: 'get_search_stats',
      },
      'low'
    );
  }
}

// Export main search function
export async function searchKnowledgeBase(query: SearchQuery): Promise<SearchResponse> {
  const service = new KnowledgeSearchService();
  return await service.search(query);
}

// Export singleton instance
export const knowledgeSearchService = new KnowledgeSearchService();