import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { knowledgeSearchService, SearchQuery } from '../knowledge/search.js';
import { getConnectionPool } from '../config/consolidated-database.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { knowledgeLogger } from '../observability/logger.js';
import { getToolCallTracer, ToolExecutionContext } from '../observability/tool-tracer.js';

/**
 * Knowledge Search Tools for Agent Integration
 * Provides tools for agents to search and interact with the knowledge base
 * Enables RAG (Retrieval Augmented Generation) capabilities for intelligent responses
 */

/**
 * Helper function to wrap knowledge tool execution with comprehensive tracing
 */
async function executeKnowledgeToolWithTracing<T>(
  toolId: string,
  toolName: string,
  context: any,
  input: any,
  executor: () => Promise<T>
): Promise<T> {
  const tracer = getToolCallTracer();

  const toolContext: ToolExecutionContext = {
    toolId,
    toolName,
    userId: (context as any)?.metadata?.userId || 'unknown',
    agentId: (context as any)?.metadata?.agentId || 'unknown',
    sessionId: context.sessionId,
    metadata: {
      tool_type: 'knowledge_search_tool',
      has_user_context: Boolean((context as any)?.metadata?.userId || 'unknown'),
      search_type: input.searchType || 'unknown',
    },
  };

  return await tracer.traceToolExecution(toolContext, input, executor);
}

/**
 * Search knowledge base
 * Performs semantic search across knowledge base documents
 */
export const searchKnowledgeBaseTool = createTool({
  id: 'search-knowledge-base',
  description: 'Search the knowledge base for relevant information using semantic or keyword search. Returns the most relevant document chunks with context.',
  inputSchema: z.object({
    query: z.string().min(1).max(1000).describe('The search query to find relevant information'),
    searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid').describe('Type of search to perform'),
    maxResults: z.number().min(1).max(20).default(5).describe('Maximum number of results to return'),
    minScore: z.number().min(0).max(1).default(0.3).describe('Minimum relevance score for results'),
    categories: z.array(z.string()).optional().describe('Filter by specific document categories'),
    tags: z.array(z.string()).optional().describe('Filter by specific document tags'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      chunk: z.object({
        id: z.string(),
        content: z.string(),
        chunk_index: z.number(),
      }),
      document: z.object({
        id: z.string(),
        title: z.string(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      score: z.number(),
      highlight: z.string().optional(),
    })),
    totalResults: z.number(),
    query: z.string(),
    searchType: z.string(),
    processingTime: z.number(),
  }),
  execute: async ({ context }) => {
    return await executeKnowledgeToolWithTracing(
      'search-knowledge-base',
      'Search Knowledge Base',
      context,
      context,
      async () => {
        const { query, searchType, maxResults, minScore, categories, tags } = context;

        knowledgeLogger.info('Agent searching knowledge base', {
          agent_id: (context as any)?.metadata?.agentId || 'unknown',
          query: query.substring(0, 100),
          search_type: searchType,
          max_results: maxResults,
        });

        const searchQuery: SearchQuery = {
          query,
          searchType,
          filters: {
            maxResults,
            minScore,
            categories,
            tags,
            userId: (context as any)?.metadata?.userId || 'unknown',
          },
          rerankResults: true,
        };

        const searchResults = await knowledgeSearchService.search(searchQuery);

        knowledgeLogger.info('Knowledge base search completed for agent', {
          agent_id: (context as any)?.metadata?.agentId || 'unknown',
          query: query.substring(0, 50),
          results_count: searchResults.totalResults,
          processing_time_ms: searchResults.processingTime,
        });

        return {
          results: searchResults.results.map(result => ({
            chunk: {
              id: result.chunk.id,
              content: result.chunk.content,
              chunk_index: result.chunk.chunk_index,
            },
            document: {
              id: result.document.id,
              title: result.document.title,
              category: result.document.category,
              tags: result.document.tags,
            },
            score: result.score,
            highlight: result.highlight,
          })),
          totalResults: searchResults.totalResults,
          query: searchResults.query,
          searchType: searchResults.searchType,
          processingTime: searchResults.processingTime,
        };
      }
    );
  },
});

/**
 * Get document by ID
 * Retrieves a specific document from the knowledge base
 */
export const getDocumentTool = createTool({
  id: 'get-document',
  description: 'Retrieve a specific document from the knowledge base by its ID. Returns the document metadata and content chunks.',
  inputSchema: z.object({
    documentId: z.string().min(1).describe('The unique ID of the document to retrieve'),
    includeChunks: z.boolean().default(true).describe('Whether to include document chunks in the response'),
    maxChunks: z.number().min(1).max(50).default(10).describe('Maximum number of chunks to return'),
  }),
  outputSchema: z.object({
    document: z.object({
      id: z.string(),
      title: z.string(),
      originalName: z.string(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.string(),
      uploadedAt: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    }),
    chunks: z.array(z.object({
      id: z.string(),
      content: z.string(),
      chunkIndex: z.number(),
      startChar: z.number(),
      endChar: z.number(),
    })).optional(),
    chunksCount: z.number(),
  }),
  execute: async ({ context }) => {
    const { documentId, includeChunks, maxChunks } = context;

    knowledgeLogger.info('Agent retrieving document', {
      agent_id: (context as any)?.metadata?.agentId || 'unknown',
      document_id: documentId,
      include_chunks: includeChunks,
    });

    try {
      const connectionManager = getConnectionPool();

      // Get document using pgvector database
      const documentQuery = `
        SELECT * FROM knowledge_documents
        WHERE id = $1
      `;
      const documentResult = await connectionManager.query(documentQuery, [documentId]);

      if (documentResult.rows.length === 0) {
        throw new Error('Document not found');
      }

      const document = documentResult.rows[0];

      // Check user access
      const userId = (context as any)?.metadata?.userId || 'unknown';
      if (userId && document.upload_user_id !== userId) {
        throw new Error('Access denied to document');
      }

      let chunks: any[] = [];
      let chunksCount = 0;

      if (includeChunks) {
        // Get document chunks using pgvector database
        const chunksQuery = `
          SELECT *
          FROM document_chunks
          WHERE document_id = $1
          ORDER BY chunk_index ASC
          LIMIT $2
        `;
        const chunksResult = await connectionManager.query(chunksQuery, [documentId, maxChunks]);

        // Get total count
        const countQuery = `
          SELECT COUNT(*) as count
          FROM document_chunks
          WHERE document_id = $1
        `;
        const countResult = await connectionManager.query(countQuery, [documentId]);

        chunks = chunksResult.rows;
        chunksCount = parseInt(countResult.rows[0]?.count || '0');
      }

      knowledgeLogger.info('Document retrieved for agent', {
        agent_id: (context as any)?.metadata?.agentId || 'unknown',
        document_id: documentId,
        chunks_returned: chunks.length,
        total_chunks: chunksCount,
      });

      return {
        document: {
          id: document.id,
          title: document.title,
          originalName: document.file_path,
          category: document.category,
          tags: document.tags || [],
          status: document.processing_status,
          uploadedAt: document.created_at,
          metadata: document.metadata || {},
        },
        chunks: includeChunks ? chunks.map(chunk => ({
          id: chunk.id,
          content: chunk.content,
          chunkIndex: chunk.chunk_index,
          startChar: chunk.chunk_metadata?.start_char || 0,
          endChar: chunk.chunk_metadata?.end_char || chunk.content.length,
        })) : undefined,
        chunksCount,
      };

    } catch (error) {
      knowledgeLogger.error('Document retrieval failed for agent', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Document retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

/**
 * Find similar documents
 * Finds documents similar to a given document or query
 */
export const findSimilarDocumentsTool = createTool({
  id: 'find-similar-documents',
  description: 'Find documents similar to a given document or search query. Useful for finding related information or exploring topics.',
  inputSchema: z.object({
    documentId: z.string().optional().describe('ID of the reference document to find similar documents for'),
    query: z.string().optional().describe('Search query to find similar documents for'),
    maxResults: z.number().min(1).max(10).default(5).describe('Maximum number of similar documents to return'),
    minScore: z.number().min(0).max(1).default(0.4).describe('Minimum similarity score for results'),
    categories: z.array(z.string()).optional().describe('Filter by specific document categories'),
  }).refine(data => data.documentId || data.query, {
    message: "Either documentId or query must be provided",
  }),
  outputSchema: z.object({
    similarDocuments: z.array(z.object({
      document: z.object({
        id: z.string(),
        title: z.string(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      score: z.number(),
      reason: z.string(),
    })),
    totalSimilar: z.number(),
    referenceQuery: z.string(),
  }),
  execute: async ({ context }) => {
    const { documentId, query, maxResults, minScore, categories } = context;

    knowledgeLogger.info('Agent finding similar documents', {
      agent_id: (context as any)?.metadata?.agentId || 'unknown',
      document_id: documentId,
      query: query?.substring(0, 50),
      max_results: maxResults,
    });

    try {
      let searchQuery = query;

      // If documentId is provided, get the document to create a search query
      if (documentId && !query) {
        const connectionManager = getConnectionPool();

        const referenceDocQuery = `
          SELECT title, category, upload_user_id
          FROM knowledge_documents
          WHERE id = $1
        `;
        const referenceDocResult = await connectionManager.query(referenceDocQuery, [documentId]);

        if (referenceDocResult.rows.length === 0) {
          throw new Error('Reference document not found');
        }

        const referenceDoc = referenceDocResult.rows[0];

        // Check user access
        const userId = (context as any)?.metadata?.userId || 'unknown';
        if (userId && referenceDoc.upload_user_id !== userId) {
          throw new Error('Access denied to reference document');
        }

        searchQuery = `${referenceDoc.title} ${referenceDoc.category || ''}`.trim();
      }

      if (!searchQuery) {
        throw new Error('No search query available');
      }

      // Perform semantic search to find similar documents
      const searchResults = await knowledgeSearchService.search({
        query: searchQuery,
        searchType: 'semantic',
        filters: {
          maxResults: maxResults + (documentId ? 1 : 0), // Get one extra if we need to exclude reference doc
          minScore,
          categories,
          userId: (context as any)?.metadata?.userId || 'unknown',
        },
        rerankResults: true,
      });

      // Filter out the reference document if provided
      const similarDocuments = searchResults.results
        .filter(result => !documentId || result.document.id !== documentId)
        .slice(0, maxResults)
        .map(result => ({
          document: {
            id: result.document.id,
            title: result.document.title,
            category: result.document.category,
            tags: result.document.tags || [],
          },
          score: result.score,
          reason: `Semantic similarity score: ${(result.score * 100).toFixed(1)}%`,
        }));

      knowledgeLogger.info('Similar documents found for agent', {
        agent_id: (context as any)?.metadata?.agentId || 'unknown',
        reference_document_id: documentId,
        similar_count: similarDocuments.length,
      });

      return {
        similarDocuments,
        totalSimilar: similarDocuments.length,
        referenceQuery: searchQuery,
      };

    } catch (error) {
      knowledgeLogger.error('Similar documents search failed for agent', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Similar documents search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

/**
 * Get knowledge base statistics
 * Provides statistics about the knowledge base
 */
export const getKnowledgeStatsTool = createTool({
  id: 'get-knowledge-stats',
  description: 'Get statistics about the knowledge base including document counts, categories, and recent activity.',
  inputSchema: z.object({
    includeCategories: z.boolean().default(true).describe('Whether to include category breakdown'),
    includeRecentActivity: z.boolean().default(true).describe('Whether to include recent activity'),
  }),
  outputSchema: z.object({
    totalDocuments: z.number(),
    totalChunks: z.number(),
    completedDocuments: z.number(),
    processingDocuments: z.number(),
    failedDocuments: z.number(),
    categories: z.array(z.object({
      category: z.string(),
      count: z.number(),
    })).optional(),
    recentActivity: z.object({
      documentsUploadedToday: z.number(),
      documentsUploadedThisWeek: z.number(),
      documentsUploadedThisMonth: z.number(),
    }).optional(),
  }),
  execute: async ({ context }) => {
    const { includeCategories, includeRecentActivity } = context;

    knowledgeLogger.info('Agent getting knowledge base statistics', {
      agent_id: (context as any)?.metadata?.agentId || 'unknown',
      include_categories: includeCategories,
      include_recent_activity: includeRecentActivity,
    });

    try {
      const connectionManager = getConnectionPool();

      // Get document counts by status using pgvector database
      const statusCountsQuery = `
        SELECT
          processing_status,
          COUNT(*) as count
        FROM knowledge_documents
        GROUP BY processing_status
      `;
      const statusCountsResult = await connectionManager.query(statusCountsQuery);

      const statusCounts = { completed: 0, processing: 0, failed: 0, total: 0 };
      statusCountsResult.rows.forEach(row => {
        const count = parseInt(row.count);
        statusCounts.total += count;
        if (row.processing_status === 'completed') statusCounts.completed = count;
        else if (row.processing_status === 'processing') statusCounts.processing = count;
        else if (row.processing_status === 'failed') statusCounts.failed = count;
      });

      // Get total chunks count
      const chunksCountQuery = `SELECT COUNT(*) as count FROM document_chunks`;
      const chunksCountResult = await connectionManager.query(chunksCountQuery);
      const totalChunks = parseInt(chunksCountResult.rows[0]?.count || '0');

      let categories;
      if (includeCategories) {
        const categoriesQuery = `
          SELECT category, COUNT(*) as count
          FROM knowledge_documents
          WHERE processing_status = 'completed' AND category IS NOT NULL
          GROUP BY category
          ORDER BY count DESC
        `;
        const categoriesResult = await connectionManager.query(categoriesQuery);

        categories = categoriesResult.rows.map(row => ({
          category: row.category,
          count: parseInt(row.count),
        }));
      }

      let recentActivity;
      if (includeRecentActivity) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        const activityQuery = `
          SELECT
            COUNT(CASE WHEN created_at >= $1 THEN 1 END) as today_count,
            COUNT(CASE WHEN created_at >= $2 THEN 1 END) as week_count,
            COUNT(CASE WHEN created_at >= $3 THEN 1 END) as month_count
          FROM knowledge_documents
        `;

        const activityResult = await connectionManager.query(activityQuery, [
          today.toISOString(),
          weekAgo.toISOString(),
          monthAgo.toISOString(),
        ]);

        const activityData = activityResult.rows[0];

        recentActivity = {
          documentsUploadedToday: parseInt(activityData?.today_count || '0'),
          documentsUploadedThisWeek: parseInt(activityData?.week_count || '0'),
          documentsUploadedThisMonth: parseInt(activityData?.month_count || '0'),
        };
      }

      knowledgeLogger.info('Knowledge base statistics retrieved for agent', {
        agent_id: (context as any)?.metadata?.agentId || 'unknown',
        total_documents: statusCounts.total,
        completed_documents: statusCounts.completed,
      });

      return {
        totalDocuments: statusCounts.total,
        totalChunks: totalChunks,
        completedDocuments: statusCounts.completed,
        processingDocuments: statusCounts.processing,
        failedDocuments: statusCounts.failed,
        categories,
        recentActivity,
      };

    } catch (error) {
      knowledgeLogger.error('Knowledge base statistics failed for agent', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Knowledge base statistics failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Export all knowledge search tools
export const knowledgeSearchTools = [
  searchKnowledgeBaseTool,
  getDocumentTool,
  findSimilarDocumentsTool,
  getKnowledgeStatsTool,
];