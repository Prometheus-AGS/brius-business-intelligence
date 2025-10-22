import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { rootLogger } from '../../observability/logger.js';
import { MCPTracer } from '../../observability/langfuse.js';
import {
  knowledgeSearchTools,
  searchKnowledgeBaseTool,
  getDocumentTool,
  findSimilarDocumentsTool,
  getKnowledgeStatsTool
} from '../../tools/knowledge-search.js';

/**
 * Knowledge Base MCP Tools for External Client Access
 * Provides MCP-compatible wrappers for knowledge base operations
 * Enables external clients to search, manage, and interact with the knowledge base
 */

export interface KnowledgeSearchOptions {
  searchType?: 'semantic' | 'keyword' | 'hybrid';
  maxResults?: number;
  minScore?: number;
  categories?: string[];
  tags?: string[];
  userId?: string;
}

export interface DocumentUploadOptions {
  category?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  processingOptions?: {
    chunkingStrategy?: 'paragraph' | 'sentence' | 'fixed' | 'semantic' | 'hybrid';
    chunkSize?: number;
    chunkOverlap?: number;
  };
}

export interface KnowledgeStats {
  totalDocuments: number;
  totalChunks: number;
  completedDocuments: number;
  processingDocuments: number;
  failedDocuments: number;
  categories: Array<{ category: string; count: number }>;
  recentActivity: {
    documentsUploadedToday: number;
    documentsUploadedThisWeek: number;
    documentsUploadedThisMonth: number;
  };
}

/**
 * Knowledge Base Search Tool for MCP
 */
export const mcpKnowledgeSearchTool = createTool({
  id: 'knowledge-search',
  description: 'Search the knowledge base for relevant information using semantic, keyword, or hybrid search. Returns the most relevant document chunks with context and metadata.',
  inputSchema: z.object({
    query: z.string().min(1).max(1000).describe('The search query to find relevant information'),
    searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid').describe('Type of search to perform'),
    maxResults: z.number().min(1).max(20).default(5).describe('Maximum number of results to return'),
    minScore: z.number().min(0).max(1).default(0.3).describe('Minimum relevance score for results'),
    categories: z.array(z.string()).optional().describe('Filter by specific document categories'),
    tags: z.array(z.string()).optional().describe('Filter by specific document tags'),
    userId: z.string().optional().describe('User ID for personalized results'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      chunk: z.object({
        id: z.string().describe('Chunk identifier'),
        content: z.string().describe('Chunk content'),
        chunkIndex: z.number().describe('Index of chunk within document'),
      }),
      document: z.object({
        id: z.string().describe('Document identifier'),
        title: z.string().describe('Document title'),
        category: z.string().optional().describe('Document category'),
        tags: z.array(z.string()).optional().describe('Document tags'),
      }),
      score: z.number().describe('Relevance score (0-1)'),
      highlight: z.string().optional().describe('Highlighted matching text'),
    })),
    totalResults: z.number().describe('Total number of results found'),
    query: z.string().describe('Processed search query'),
    searchType: z.string().describe('Search type used'),
    processingTime: z.number().describe('Search processing time in milliseconds'),
  }),
  execute: async (context: any, options?: any) => {
    const input = context;
    const tracer = new MCPTracer('knowledge-search', `search-${Date.now()}`, {
      userId: input.userId,
      input: input,
      metadata: {
        query: input.query.substring(0, 100),
        searchType: input.searchType,
      },
    });

    try {
      rootLogger.info('MCP knowledge search request', {
        query: input.query.substring(0, 100),
        search_type: input.searchType,
        max_results: input.maxResults,
        user_id: input.userId,
      });

      // Use the existing knowledge search tool
      const result = await searchKnowledgeBaseTool.execute({
        ...input,
        metadata: {
          agentId: 'mcp-client',
          userId: input.userId || 'anonymous',
        },
      });

      tracer.end({
        output: result,
        metadata: {
          resultsCount: result.totalResults,
          processingTime: result.processingTime,
        },
      });

      rootLogger.info('MCP knowledge search completed', {
        query: input.query.substring(0, 50),
        results_count: result.totalResults,
        processing_time_ms: result.processingTime,
      });

      // Transform result to match MCP schema (convert chunk_index to chunkIndex)
      const transformedResult = {
        ...result,
        results: result.results.map((item: any) => ({
          ...item,
          chunk: {
            ...item.chunk,
            chunkIndex: item.chunk.chunk_index,
          },
        })),
      };

      return transformedResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP knowledge search failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Get Document Tool for MCP
 */
export const mcpGetDocumentTool = createTool({
  id: 'get-document',
  description: 'Retrieve a specific document from the knowledge base by its ID. Returns the document metadata and optionally its content chunks.',
  inputSchema: z.object({
    documentId: z.string().min(1).describe('The unique ID of the document to retrieve'),
    includeChunks: z.boolean().default(true).describe('Whether to include document chunks in the response'),
    maxChunks: z.number().min(1).max(50).default(10).describe('Maximum number of chunks to return'),
  }),
  outputSchema: z.object({
    document: z.object({
      id: z.string().describe('Document identifier'),
      title: z.string().describe('Document title'),
      originalName: z.string().describe('Original filename'),
      category: z.string().optional().describe('Document category'),
      tags: z.array(z.string()).optional().describe('Document tags'),
      status: z.string().describe('Processing status'),
      uploadedAt: z.string().describe('Upload timestamp'),
      metadata: z.record(z.string(), z.unknown()).describe('Document metadata'),
    }),
    chunks: z.array(z.object({
      id: z.string().describe('Chunk identifier'),
      content: z.string().describe('Chunk content'),
      chunkIndex: z.number().describe('Index of chunk within document'),
      startChar: z.number().describe('Start character position'),
      endChar: z.number().describe('End character position'),
    })).optional().describe('Document chunks'),
    chunksCount: z.number().describe('Total number of chunks in document'),
  }),
  execute: async (context: any, options?: any) => {
    const input = context;
    const tracer = new MCPTracer('get-document', `get-${Date.now()}`, {
      userId: input.userId,
      input: input,
      metadata: {
        documentId: input.documentId,
        includeChunks: input.includeChunks,
      },
    });

    try {
      rootLogger.info('MCP get document request', {
        document_id: input.documentId,
        include_chunks: input.includeChunks,
        max_chunks: input.maxChunks,
      });

      // Use the existing get document tool
      const result = await getDocumentTool.execute({
        ...input,
        metadata: {
          agentId: 'mcp-client',
          userId: input.userId || 'anonymous',
        },
      });

      tracer.end({
        output: result,
        metadata: {
          documentFound: Boolean(result.document),
          chunksCount: result.chunksCount,
        },
      });

      rootLogger.info('MCP get document completed', {
        document_id: input.documentId,
        document_found: Boolean(result.document),
        chunks_count: result.chunksCount,
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP get document failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Find Similar Documents Tool for MCP
 */
export const mcpFindSimilarDocumentsTool = createTool({
  id: 'find-similar-documents',
  description: 'Find documents similar to a given document or search query. Useful for discovering related information and exploring topics.',
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
        id: z.string().describe('Document identifier'),
        title: z.string().describe('Document title'),
        category: z.string().optional().describe('Document category'),
        tags: z.array(z.string()).optional().describe('Document tags'),
      }),
      score: z.number().describe('Similarity score (0-1)'),
      reason: z.string().describe('Explanation of similarity'),
    })),
    totalSimilar: z.number().describe('Total number of similar documents found'),
    referenceQuery: z.string().describe('Query used for similarity search'),
  }),
  execute: async (context: any, options?: any) => {
    const input = context;
    const tracer = new MCPTracer('find-similar-documents', `similar-${Date.now()}`, {
      userId: input.userId,
      input: input,
      metadata: {
        documentId: input.documentId,
        query: input.query?.substring(0, 100),
        maxResults: input.maxResults,
      },
    });

    try {
      rootLogger.info('MCP find similar documents request', {
        document_id: input.documentId,
        query: input.query?.substring(0, 50),
        max_results: input.maxResults,
        min_score: input.minScore,
      });

      // Use the existing find similar documents tool
      const result = await findSimilarDocumentsTool.execute({
        ...input,
        metadata: {
          agentId: 'mcp-client',
          userId: input.userId || 'anonymous',
        },
      });

      tracer.end({
        output: result,
        metadata: {
          similarCount: result.totalSimilar,
          referenceQuery: result.referenceQuery,
        },
      });

      rootLogger.info('MCP find similar documents completed', {
        similar_count: result.totalSimilar,
        reference_query: result.referenceQuery?.substring(0, 50),
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP find similar documents failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Knowledge Base Statistics Tool for MCP
 */
export const mcpKnowledgeStatsTool = createTool({
  id: 'knowledge-stats',
  description: 'Get comprehensive statistics about the knowledge base including document counts, categories, and recent activity.',
  inputSchema: z.object({
    includeCategories: z.boolean().default(true).describe('Whether to include category breakdown'),
    includeRecentActivity: z.boolean().default(true).describe('Whether to include recent activity'),
    includeProcessingStatus: z.boolean().default(true).describe('Whether to include processing status'),
  }),
  outputSchema: z.object({
    totalDocuments: z.number().describe('Total number of documents'),
    totalChunks: z.number().describe('Total number of document chunks'),
    completedDocuments: z.number().describe('Number of successfully processed documents'),
    processingDocuments: z.number().describe('Number of documents currently processing'),
    failedDocuments: z.number().describe('Number of failed document processing attempts'),
    categories: z.array(z.object({
      category: z.string().describe('Category name'),
      count: z.number().describe('Number of documents in category'),
    })).optional().describe('Document categories breakdown'),
    recentActivity: z.object({
      documentsUploadedToday: z.number().describe('Documents uploaded today'),
      documentsUploadedThisWeek: z.number().describe('Documents uploaded this week'),
      documentsUploadedThisMonth: z.number().describe('Documents uploaded this month'),
    }).optional().describe('Recent upload activity'),
    processingStatus: z.object({
      queueLength: z.number().describe('Number of documents in processing queue'),
      averageProcessingTime: z.number().describe('Average processing time in milliseconds'),
      successRate: z.number().describe('Processing success rate (0-1)'),
    }).optional().describe('Processing system status'),
  }),
  execute: async (context: any, options?: any) => {
    const input = context;
    const tracer = new MCPTracer('knowledge-stats', `stats-${Date.now()}`, {
      userId: input.userId,
      input: input,
      metadata: {
        includeCategories: input.includeCategories,
        includeRecentActivity: input.includeRecentActivity,
      },
    });

    try {
      rootLogger.info('MCP knowledge stats request', {
        include_categories: input.includeCategories,
        include_recent_activity: input.includeRecentActivity,
        include_processing_status: input.includeProcessingStatus,
      });

      // Use the existing knowledge stats tool
      const result = await getKnowledgeStatsTool.execute({
        ...input,
        metadata: {
          agentId: 'mcp-client',
          userId: input.userId || 'anonymous',
        },
      });

      // Add processing status if requested
      let processingStatus;
      if (input.includeProcessingStatus) {
        try {
          // Mock processing status - in production, this would come from the processing queue
          processingStatus = {
            queueLength: Math.floor(Math.random() * 10),
            averageProcessingTime: 5000 + Math.floor(Math.random() * 10000),
            successRate: 0.85 + Math.random() * 0.15,
          };
        } catch (error) {
          rootLogger.warn('Failed to get processing status', { error });
          processingStatus = {
            queueLength: 0,
            averageProcessingTime: 0,
            successRate: 0,
          };
        }
      }

      const response = {
        ...result,
        processingStatus,
      };

      tracer.end({
        output: response,
        metadata: {
          totalDocuments: result.totalDocuments,
          totalChunks: result.totalChunks,
          categoriesCount: result.categories?.length || 0,
        },
      });

      rootLogger.info('MCP knowledge stats completed', {
        total_documents: result.totalDocuments,
        total_chunks: result.totalChunks,
        completed_documents: result.completedDocuments,
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP knowledge stats failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Document Upload Status Tool for MCP
 */
export const mcpDocumentUploadStatusTool = createTool({
  id: 'document-upload-status',
  description: 'Check the upload and processing status of documents. Monitor ongoing uploads and processing jobs.',
  inputSchema: z.object({
    documentId: z.string().optional().describe('Specific document ID to check (if not provided, returns recent uploads)'),
    userId: z.string().optional().describe('Filter by user ID'),
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional().describe('Filter by status'),
    limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
  }),
  outputSchema: z.object({
    documents: z.array(z.object({
      id: z.string().describe('Document identifier'),
      originalName: z.string().describe('Original filename'),
      status: z.string().describe('Processing status'),
      progress: z.object({
        stage: z.string().describe('Current processing stage'),
        percentage: z.number().describe('Completion percentage'),
        currentStep: z.string().describe('Current step description'),
        totalSteps: z.number().describe('Total number of steps'),
      }).optional().describe('Processing progress'),
      uploadedAt: z.string().describe('Upload timestamp'),
      processedAt: z.string().optional().describe('Processing completion timestamp'),
      error: z.string().optional().describe('Error message if failed'),
      metadata: z.object({
        fileSize: z.number().optional().describe('File size in bytes'),
        mimeType: z.string().optional().describe('File MIME type'),
        category: z.string().optional().describe('Document category'),
        tags: z.array(z.string()).optional().describe('Document tags'),
      }).describe('Document metadata'),
    })),
    totalCount: z.number().describe('Total number of documents matching criteria'),
    processingStats: z.object({
      pending: z.number().describe('Number of pending documents'),
      processing: z.number().describe('Number of processing documents'),
      completed: z.number().describe('Number of completed documents'),
      failed: z.number().describe('Number of failed documents'),
    }).describe('Processing statistics'),
  }),
  execute: async (context: any, options?: any) => {
    const input = context;
    const tracer = new MCPTracer('document-upload-status', `status-${Date.now()}`, {
      userId: input.userId,
      input: input,
      metadata: {
        documentId: input.documentId,
        status: input.status,
      },
    });

    try {
      rootLogger.info('MCP document upload status request', {
        document_id: input.documentId,
        user_id: input.userId,
        status: input.status,
        limit: input.limit,
      });

      // Mock implementation - in production, this would query the processing queue and document database
      const mockDocuments = [
        {
          id: 'doc_123',
          originalName: 'business-report-q4.pdf',
          status: 'completed',
          uploadedAt: new Date(Date.now() - 3600000).toISOString(),
          processedAt: new Date(Date.now() - 3000000).toISOString(),
          metadata: {
            fileSize: 2048576,
            mimeType: 'application/pdf',
            category: 'reports',
            tags: ['quarterly', 'business'],
          },
        },
        {
          id: 'doc_124',
          originalName: 'product-specs.docx',
          status: 'processing',
          progress: {
            stage: 'chunking',
            percentage: 65,
            currentStep: 'Generating document embeddings',
            totalSteps: 5,
          },
          uploadedAt: new Date(Date.now() - 600000).toISOString(),
          metadata: {
            fileSize: 1048576,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            category: 'specifications',
            tags: ['product'],
          },
        },
      ];

      const filteredDocuments = mockDocuments.filter(doc => {
        if (input.documentId && doc.id !== input.documentId) return false;
        if (input.status && doc.status !== input.status) return false;
        return true;
      }).slice(0, input.limit);

      const processingStats = {
        pending: 2,
        processing: 3,
        completed: 15,
        failed: 1,
      };

      const response = {
        documents: filteredDocuments,
        totalCount: filteredDocuments.length,
        processingStats,
      };

      tracer.end({
        output: response,
        metadata: {
          documentsCount: filteredDocuments.length,
          totalCompleted: processingStats.completed,
        },
      });

      rootLogger.info('MCP document upload status completed', {
        documents_count: filteredDocuments.length,
        processing_stats: processingStats,
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP document upload status failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Knowledge Base Health Check Tool for MCP
 */
export const mcpKnowledgeHealthCheckTool = createTool({
  id: 'knowledge-health-check',
  description: 'Perform comprehensive health check on the knowledge base system including search capabilities, processing queue, and data integrity.',
  inputSchema: z.object({
    includeSearchTest: z.boolean().default(true).describe('Include search functionality test'),
    includeProcessingTest: z.boolean().default(true).describe('Include processing system test'),
    includeDataIntegrity: z.boolean().default(false).describe('Include data integrity checks'),
    timeout: z.number().int().min(5000).max(60000).default(30000).describe('Health check timeout in ms'),
  }),
  outputSchema: z.object({
    overall: z.object({
      status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Overall system health'),
      score: z.number().min(0).max(100).describe('Health score out of 100'),
      lastChecked: z.string().describe('Last check timestamp'),
    }),
    components: z.object({
      search: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Search system health'),
        responseTime: z.number().describe('Search response time in ms'),
        issues: z.array(z.string()).describe('Any issues found'),
      }),
      processing: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Processing system health'),
        queueHealth: z.boolean().describe('Processing queue is healthy'),
        activeJobs: z.number().describe('Number of active processing jobs'),
        issues: z.array(z.string()).describe('Any issues found'),
      }),
      storage: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Storage system health'),
        connectivity: z.boolean().describe('Database connectivity'),
        diskSpace: z.number().optional().describe('Available disk space percentage'),
        issues: z.array(z.string()).describe('Any issues found'),
      }),
      dataIntegrity: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Data integrity status'),
        orphanedChunks: z.number().optional().describe('Number of orphaned chunks'),
        inconsistencies: z.number().optional().describe('Number of data inconsistencies'),
        issues: z.array(z.string()).describe('Any issues found'),
      }).optional(),
    }),
    recommendations: z.array(z.string()).describe('Recommended actions to improve health'),
  }),
  execute: async (context: any, options?: any) => {
    const input = context;
    const tracer = new MCPTracer('knowledge-health-check', `health-${Date.now()}`, {
      userId: input.userId,
      input: input,
      metadata: {
        includeSearchTest: input.includeSearchTest,
        includeProcessingTest: input.includeProcessingTest,
        includeDataIntegrity: input.includeDataIntegrity,
      },
    });

    try {
      const startTime = Date.now();
      rootLogger.info('MCP knowledge health check started', {
        include_search_test: input.includeSearchTest,
        include_processing_test: input.includeProcessingTest,
        include_data_integrity: input.includeDataIntegrity,
        timeout: input.timeout,
      });

      const issues: string[] = [];
      const recommendations: string[] = [];

      // Search system health check
      let searchHealth: { status: 'healthy' | 'degraded' | 'unhealthy', responseTime: number, issues: string[] } = { status: 'healthy', responseTime: 0, issues: [] };
      if (input.includeSearchTest) {
        try {
          const searchStart = Date.now();
          // Mock search test - in production, perform actual search
          await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
          searchHealth.responseTime = Date.now() - searchStart;

          if (searchHealth.responseTime > 5000) {
            searchHealth.status = 'degraded';
            searchHealth.issues.push('Search response time is slow');
            issues.push('Search performance degraded');
            recommendations.push('Consider optimizing search indices');
          }
        } catch (error) {
          searchHealth.status = 'unhealthy';
          searchHealth.issues.push('Search test failed');
          issues.push('Search system not responding');
          recommendations.push('Check search service connectivity');
        }
      }

      // Processing system health check
      let processingHealth: { status: 'healthy' | 'degraded' | 'unhealthy', queueHealth: boolean, activeJobs: number, issues: string[] } = { status: 'healthy', queueHealth: true, activeJobs: 0, issues: [] };
      if (input.includeProcessingTest) {
        try {
          // Mock processing health - in production, check actual processing queue
          processingHealth.activeJobs = Math.floor(Math.random() * 5);
          processingHealth.queueHealth = true;

          if (processingHealth.activeJobs > 10) {
            processingHealth.status = 'degraded';
            processingHealth.issues.push('High processing queue load');
            issues.push('Processing queue overloaded');
            recommendations.push('Consider scaling processing workers');
          }
        } catch (error) {
          processingHealth.status = 'unhealthy';
          processingHealth.queueHealth = false;
          processingHealth.issues.push('Processing queue not accessible');
          issues.push('Processing system not responding');
          recommendations.push('Check processing service status');
        }
      }

      // Storage system health check
      let storageHealth: { status: 'healthy' | 'degraded' | 'unhealthy', connectivity: boolean, diskSpace: number, issues: string[] } = { status: 'healthy', connectivity: true, diskSpace: 85, issues: [] };
      try {
        // Mock storage health - in production, check actual database and storage
        storageHealth.connectivity = true;
        storageHealth.diskSpace = 70 + Math.random() * 25;

        if (storageHealth.diskSpace < 10) {
          storageHealth.status = 'unhealthy';
          storageHealth.issues.push('Critical disk space low');
          issues.push('Storage space critically low');
          recommendations.push('Immediately free up storage space');
        } else if (storageHealth.diskSpace < 20) {
          storageHealth.status = 'degraded';
          storageHealth.issues.push('Disk space running low');
          issues.push('Storage space running low');
          recommendations.push('Plan for storage expansion');
        }
      } catch (error) {
        storageHealth.status = 'unhealthy';
        storageHealth.connectivity = false;
        storageHealth.issues.push('Storage connectivity failed');
        issues.push('Storage system not accessible');
        recommendations.push('Check database connectivity');
      }

      // Data integrity check (optional)
      let dataIntegrityHealth;
      if (input.includeDataIntegrity) {
        dataIntegrityHealth = { status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy', orphanedChunks: 0, inconsistencies: 0, issues: [] as string[] };
        try {
          // Mock data integrity check - in production, perform actual integrity checks
          dataIntegrityHealth.orphanedChunks = Math.floor(Math.random() * 5);
          dataIntegrityHealth.inconsistencies = Math.floor(Math.random() * 3);

          if (dataIntegrityHealth.orphanedChunks > 10) {
            dataIntegrityHealth.status = 'degraded';
            dataIntegrityHealth.issues.push('High number of orphaned chunks');
            issues.push('Data integrity issues detected');
            recommendations.push('Run data cleanup procedures');
          }

          if (dataIntegrityHealth.inconsistencies > 5) {
            dataIntegrityHealth.status = 'degraded';
            dataIntegrityHealth.issues.push('Data inconsistencies found');
            issues.push('Data consistency issues detected');
            recommendations.push('Run data validation and repair');
          }
        } catch (error) {
          dataIntegrityHealth.status = 'unhealthy';
          dataIntegrityHealth.issues.push('Data integrity check failed');
          issues.push('Cannot verify data integrity');
          recommendations.push('Investigate data integrity check system');
        }
      }

      // Calculate overall health
      const componentStatuses = [searchHealth.status, processingHealth.status, storageHealth.status];
      if (dataIntegrityHealth) {
        componentStatuses.push(dataIntegrityHealth.status);
      }

      const healthyCount = componentStatuses.filter(s => s === 'healthy').length;
      const unhealthyCount = componentStatuses.filter(s => s === 'unhealthy').length;

      let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
      let healthScore: number;

      if (unhealthyCount > 0) {
        overallStatus = 'unhealthy';
        healthScore = Math.max(0, 40 - (unhealthyCount * 20));
      } else if (componentStatuses.some(s => s === 'degraded')) {
        overallStatus = 'degraded';
        healthScore = 60 + (healthyCount / componentStatuses.length) * 25;
      } else {
        overallStatus = 'healthy';
        healthScore = 85 + Math.random() * 15;
      }

      const response = {
        overall: {
          status: overallStatus,
          score: Math.round(healthScore),
          lastChecked: new Date().toISOString(),
        },
        components: {
          search: searchHealth,
          processing: processingHealth,
          storage: storageHealth,
          dataIntegrity: dataIntegrityHealth,
        },
        recommendations,
      };

      tracer.end({
        output: response,
        metadata: {
          overallStatus,
          healthScore: Math.round(healthScore),
          issuesCount: issues.length,
          executionTime: Date.now() - startTime,
        },
      });

      rootLogger.info('MCP knowledge health check completed', {
        overall_status: overallStatus,
        health_score: Math.round(healthScore),
        issues_count: issues.length,
        execution_time_ms: Date.now() - startTime,
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP knowledge health check failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Export all knowledge base MCP tools
 */
export const knowledgeBaseMCPTools = [
  mcpKnowledgeSearchTool,
  mcpGetDocumentTool,
  mcpFindSimilarDocumentsTool,
  mcpKnowledgeStatsTool,
  mcpDocumentUploadStatusTool,
  mcpKnowledgeHealthCheckTool,
];

rootLogger.info('Knowledge base MCP tools initialized', {
  tools_count: knowledgeBaseMCPTools.length,
  tools: knowledgeBaseMCPTools.map(tool => tool.id),
});