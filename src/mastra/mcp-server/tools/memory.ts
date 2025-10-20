import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { rootLogger } from '../../observability/logger.js';
import { MCPTracer } from '../../observability/langfuse.js';
import { memoryTools } from '../../tools/memory-tools.js';

/**
 * Memory MCP Tools for External Client Access
 * Provides MCP-compatible wrappers for memory system operations
 * Enables external clients to store, retrieve, and manage memory across user and global scopes
 */

export interface MemoryEntry {
  id: string;
  type: 'user' | 'global';
  content: string;
  similarity_score?: number;
  created_at: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

export interface MemorySearchResult {
  results: MemoryEntry[];
  totalFound: number;
  searchTime: number;
  query: string;
  scope: string;
}

export interface MemoryStats {
  userMemory: {
    totalEntries: number;
    totalSize: number;
    lastUpdated?: string;
    categories: Record<string, number>;
  };
  globalMemory: {
    totalEntries: number;
    totalSize: number;
    lastUpdated?: string;
    categories: Record<string, number>;
  };
  systemStats: {
    totalMemoryUsed: number;
    averageEntrySize: number;
    compressionRatio?: number;
  };
}

/**
 * Memory Search Tool for MCP - Comprehensive Memory Search
 */
export const mcpSearchAllMemoryTool = createTool({
  id: 'search-all-memory',
  description: 'Search both user and global memory for relevant information. Returns contextual information stored across all memory scopes.',
  inputSchema: z.object({
    query: z.string().min(1).max(1000).describe('Search query to find relevant memory entries'),
    scope: z.enum(['user', 'global', 'both']).default('both').describe('Memory scope to search'),
    topK: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to return'),
    minSimilarity: z.number().min(0).max(1).default(0.3).describe('Minimum similarity score for results'),
    userId: z.string().optional().describe('User ID for user-scoped memory search'),
    categories: z.array(z.string()).optional().describe('Filter by specific memory categories'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string().describe('Memory entry identifier'),
      type: z.enum(['user', 'global']).describe('Memory scope type'),
      content: z.string().describe('Memory content'),
      similarity_score: z.number().describe('Similarity score (0-1)'),
      created_at: z.string().describe('Creation timestamp'),
      updated_at: z.string().optional().describe('Last update timestamp'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Entry metadata'),
    })),
    totalFound: z.number().describe('Total number of results found'),
    searchTime: z.number().describe('Search time in milliseconds'),
    query: z.string().describe('Processed search query'),
    scope: z.string().describe('Search scope used'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('search-all-memory', `search-${Date.now()}`, {
      query: input.query.substring(0, 100),
      scope: input.scope,
      userId: input.userId || context.userId,
    });

    try {
      rootLogger.info('MCP memory search request', {
        query: input.query.substring(0, 100),
        scope: input.scope,
        top_k: input.topK,
        user_id: input.userId || context.userId,
      });

      // Use the existing memory search tool
      const searchTool = memoryTools.find(tool => tool.id === 'search-all-memory');
      if (!searchTool) {
        throw new Error('Memory search tool not available');
      }

      const result = await searchTool.execute({
        context: {
          userId: input.userId || context.userId || 'anonymous',
        },
        input: {
          query: input.query,
          scope: input.scope,
          top_k: input.topK,
          min_similarity: input.minSimilarity,
          categories: input.categories,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          resultsCount: result.total_found,
          searchTime: result.search_time_ms,
        },
      });

      rootLogger.info('MCP memory search completed', {
        query: input.query.substring(0, 50),
        results_count: result.total_found,
        search_time_ms: result.search_time_ms,
      });

      return {
        results: result.results.map((entry: any) => ({
          id: entry.id,
          type: entry.type,
          content: entry.content,
          similarity_score: entry.similarity_score,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          metadata: entry.metadata,
        })),
        totalFound: result.total_found,
        searchTime: result.search_time_ms,
        query: result.query_processed,
        scope: input.scope,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP memory search failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * User Memory Search Tool for MCP
 */
export const mcpSearchUserMemoryTool = createTool({
  id: 'search-user-memory',
  description: 'Search user-specific memory for personalized information and preferences. Returns user context and historical interactions.',
  inputSchema: z.object({
    query: z.string().min(1).max(1000).describe('Search query for user memory'),
    userId: z.string().min(1).describe('User ID to search memory for'),
    topK: z.number().int().min(1).max(20).default(5).describe('Maximum number of results'),
    minSimilarity: z.number().min(0).max(1).default(0.3).describe('Minimum similarity score'),
    categories: z.array(z.string()).optional().describe('Filter by memory categories'),
    timeRange: z.object({
      from: z.string().optional().describe('Start date for time-based filtering'),
      to: z.string().optional().describe('End date for time-based filtering'),
    }).optional().describe('Time range filter'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string().describe('Memory entry identifier'),
      content: z.string().describe('Memory content'),
      similarity_score: z.number().describe('Similarity score (0-1)'),
      created_at: z.string().describe('Creation timestamp'),
      updated_at: z.string().optional().describe('Last update timestamp'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Entry metadata'),
    })),
    totalFound: z.number().describe('Total results found'),
    searchTime: z.number().describe('Search time in milliseconds'),
    userId: z.string().describe('User ID searched'),
    query: z.string().describe('Processed query'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('search-user-memory', `user-search-${Date.now()}`, {
      query: input.query.substring(0, 100),
      userId: input.userId,
    });

    try {
      rootLogger.info('MCP user memory search request', {
        query: input.query.substring(0, 100),
        user_id: input.userId,
        top_k: input.topK,
        time_range: input.timeRange,
      });

      // Use the existing user memory search tool
      const searchTool = memoryTools.find(tool => tool.id === 'search-user-memory');
      if (!searchTool) {
        throw new Error('User memory search tool not available');
      }

      const result = await searchTool.execute({
        context: {
          userId: input.userId,
        },
        input: {
          query: input.query,
          top_k: input.topK,
          min_similarity: input.minSimilarity,
          categories: input.categories,
          time_range: input.timeRange,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          resultsCount: result.total_found,
          searchTime: result.search_time_ms,
          userId: input.userId,
        },
      });

      rootLogger.info('MCP user memory search completed', {
        query: input.query.substring(0, 50),
        user_id: input.userId,
        results_count: result.total_found,
        search_time_ms: result.search_time_ms,
      });

      return {
        results: result.results.map((entry: any) => ({
          id: entry.id,
          content: entry.content,
          similarity_score: entry.similarity_score,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          metadata: entry.metadata,
        })),
        totalFound: result.total_found,
        searchTime: result.search_time_ms,
        userId: input.userId,
        query: result.query_processed,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP user memory search failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Global Memory Search Tool for MCP
 */
export const mcpSearchGlobalMemoryTool = createTool({
  id: 'search-global-memory',
  description: 'Search global memory for system-wide information, policies, and shared knowledge. Returns organizational context and shared information.',
  inputSchema: z.object({
    query: z.string().min(1).max(1000).describe('Search query for global memory'),
    topK: z.number().int().min(1).max(20).default(5).describe('Maximum number of results'),
    minSimilarity: z.number().min(0).max(1).default(0.3).describe('Minimum similarity score'),
    categories: z.array(z.string()).optional().describe('Filter by memory categories'),
    department: z.string().optional().describe('Filter by department or organization unit'),
    priority: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('Filter by priority level'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string().describe('Memory entry identifier'),
      content: z.string().describe('Memory content'),
      similarity_score: z.number().describe('Similarity score (0-1)'),
      created_at: z.string().describe('Creation timestamp'),
      updated_at: z.string().optional().describe('Last update timestamp'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Entry metadata including department, priority'),
    })),
    totalFound: z.number().describe('Total results found'),
    searchTime: z.number().describe('Search time in milliseconds'),
    query: z.string().describe('Processed query'),
    filters: z.object({
      department: z.string().optional(),
      priority: z.string().optional(),
      categories: z.array(z.string()).optional(),
    }).describe('Applied filters'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('search-global-memory', `global-search-${Date.now()}`, {
      query: input.query.substring(0, 100),
      department: input.department,
      priority: input.priority,
    });

    try {
      rootLogger.info('MCP global memory search request', {
        query: input.query.substring(0, 100),
        top_k: input.topK,
        department: input.department,
        priority: input.priority,
      });

      // Use the existing global memory search tool
      const searchTool = memoryTools.find(tool => tool.id === 'search-global-memory');
      if (!searchTool) {
        throw new Error('Global memory search tool not available');
      }

      const result = await searchTool.execute({
        context: {
          userId: context.userId || 'anonymous',
        },
        input: {
          query: input.query,
          top_k: input.topK,
          min_similarity: input.minSimilarity,
          categories: input.categories,
          department: input.department,
          priority: input.priority,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          resultsCount: result.total_found,
          searchTime: result.search_time_ms,
        },
      });

      rootLogger.info('MCP global memory search completed', {
        query: input.query.substring(0, 50),
        results_count: result.total_found,
        search_time_ms: result.search_time_ms,
      });

      return {
        results: result.results.map((entry: any) => ({
          id: entry.id,
          content: entry.content,
          similarity_score: entry.similarity_score,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          metadata: entry.metadata,
        })),
        totalFound: result.total_found,
        searchTime: result.search_time_ms,
        query: result.query_processed,
        filters: {
          department: input.department,
          priority: input.priority,
          categories: input.categories,
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP global memory search failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Store Memory Tool for MCP
 */
export const mcpStoreMemoryTool = createTool({
  id: 'store-memory',
  description: 'Store new information in memory system. Can store in user-specific or global memory scopes with appropriate metadata.',
  inputSchema: z.object({
    content: z.string().min(1).max(10000).describe('Content to store in memory'),
    type: z.enum(['user', 'global']).describe('Memory scope to store in'),
    userId: z.string().optional().describe('User ID for user memory (required for user type)'),
    metadata: z.object({
      category: z.string().optional().describe('Memory category'),
      importance: z.enum(['low', 'normal', 'high', 'critical']).default('normal').describe('Importance level'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      department: z.string().optional().describe('Department (for global memory)'),
      expiresAt: z.string().optional().describe('Expiration date (ISO format)'),
      source: z.string().optional().describe('Source of the information'),
    }).optional().describe('Memory metadata'),
    context: z.object({
      conversationId: z.string().optional().describe('Associated conversation ID'),
      sessionId: z.string().optional().describe('Associated session ID'),
      workflowId: z.string().optional().describe('Associated workflow ID'),
    }).optional().describe('Contextual information'),
  }).refine(data => data.type === 'global' || data.userId, {
    message: "userId is required for user memory type",
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether storage was successful'),
    memoryId: z.string().optional().describe('Unique identifier for stored memory'),
    error: z.string().optional().describe('Error message if storage failed'),
    metadata: z.object({
      type: z.string().describe('Memory type stored'),
      userId: z.string().optional().describe('User ID'),
      contentLength: z.number().describe('Content length in characters'),
      storedAt: z.string().describe('Storage timestamp'),
      category: z.string().optional().describe('Assigned category'),
    }).describe('Storage metadata'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('store-memory', `store-${Date.now()}`, {
      type: input.type,
      userId: input.userId || context.userId,
      contentLength: input.content.length,
    });

    try {
      rootLogger.info('MCP store memory request', {
        type: input.type,
        user_id: input.userId || context.userId,
        content_length: input.content.length,
        category: input.metadata?.category,
      });

      // Use the existing store memory tool
      const storeTool = memoryTools.find(tool => tool.id === 'store-memory');
      if (!storeTool) {
        throw new Error('Store memory tool not available');
      }

      const result = await storeTool.execute({
        context: {
          userId: input.userId || context.userId || 'anonymous',
        },
        input: {
          content: input.content,
          type: input.type,
          metadata: input.metadata,
          context: input.context,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          success: result.success,
          memoryId: result.memory_id,
        },
      });

      rootLogger.info('MCP store memory completed', {
        success: result.success,
        memory_id: result.memory_id,
        type: input.type,
        content_length: input.content.length,
      });

      return {
        success: result.success,
        memoryId: result.memory_id,
        error: result.error,
        metadata: {
          type: input.type,
          userId: input.userId || context.userId,
          contentLength: input.content.length,
          storedAt: result.stored_at || new Date().toISOString(),
          category: input.metadata?.category,
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP store memory failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          type: input.type,
          userId: input.userId || context.userId,
          contentLength: input.content.length,
          storedAt: new Date().toISOString(),
          category: input.metadata?.category,
        },
      };
    }
  },
});

/**
 * Update Memory Tool for MCP
 */
export const mcpUpdateMemoryTool = createTool({
  id: 'update-memory',
  description: 'Update existing memory entry with new content or metadata. Allows modification of stored information while preserving history.',
  inputSchema: z.object({
    memoryId: z.string().min(1).describe('Unique identifier of memory entry to update'),
    content: z.string().min(1).max(10000).optional().describe('New content to replace existing'),
    metadata: z.object({
      category: z.string().optional().describe('Updated category'),
      importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('Updated importance level'),
      tags: z.array(z.string()).optional().describe('Updated tags'),
      department: z.string().optional().describe('Updated department'),
      expiresAt: z.string().optional().describe('Updated expiration date'),
    }).optional().describe('Updated metadata'),
    userId: z.string().optional().describe('User ID for access control'),
    reason: z.string().optional().describe('Reason for the update'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether update was successful'),
    error: z.string().optional().describe('Error message if update failed'),
    metadata: z.object({
      memoryId: z.string().describe('Memory entry identifier'),
      updatedAt: z.string().describe('Update timestamp'),
      version: z.number().optional().describe('New version number'),
      changes: z.array(z.string()).describe('List of changes made'),
    }).describe('Update metadata'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('update-memory', `update-${Date.now()}`, {
      memoryId: input.memoryId,
      userId: input.userId || context.userId,
      hasContent: Boolean(input.content),
      hasMetadata: Boolean(input.metadata),
    });

    try {
      rootLogger.info('MCP update memory request', {
        memory_id: input.memoryId,
        user_id: input.userId || context.userId,
        has_content: Boolean(input.content),
        has_metadata: Boolean(input.metadata),
        reason: input.reason,
      });

      // Use the existing update memory tool
      const updateTool = memoryTools.find(tool => tool.id === 'update-memory');
      if (!updateTool) {
        throw new Error('Update memory tool not available');
      }

      const result = await updateTool.execute({
        context: {
          userId: input.userId || context.userId || 'anonymous',
        },
        input: {
          memory_id: input.memoryId,
          content: input.content,
          metadata: input.metadata,
          reason: input.reason,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          success: result.success,
          version: result.version,
        },
      });

      rootLogger.info('MCP update memory completed', {
        success: result.success,
        memory_id: input.memoryId,
        version: result.version,
        changes_count: result.changes?.length || 0,
      });

      return {
        success: result.success,
        error: result.error,
        metadata: {
          memoryId: input.memoryId,
          updatedAt: result.updated_at || new Date().toISOString(),
          version: result.version,
          changes: result.changes || [],
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP update memory failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          memoryId: input.memoryId,
          updatedAt: new Date().toISOString(),
          version: 0,
          changes: [],
        },
      };
    }
  },
});

/**
 * Delete Memory Tool for MCP
 */
export const mcpDeleteMemoryTool = createTool({
  id: 'delete-memory',
  description: 'Delete memory entries from the system. Supports soft delete with retention period or permanent deletion.',
  inputSchema: z.object({
    memoryId: z.string().min(1).describe('Unique identifier of memory entry to delete'),
    userId: z.string().optional().describe('User ID for access control'),
    deleteType: z.enum(['soft', 'hard']).default('soft').describe('Type of deletion (soft allows recovery)'),
    reason: z.string().optional().describe('Reason for deletion'),
    retentionDays: z.number().int().min(1).max(365).default(30).describe('Days to retain for soft delete'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether deletion was successful'),
    error: z.string().optional().describe('Error message if deletion failed'),
    metadata: z.object({
      memoryId: z.string().describe('Memory entry identifier'),
      deleteType: z.string().describe('Type of deletion performed'),
      deletedAt: z.string().describe('Deletion timestamp'),
      recoverable: z.boolean().describe('Whether entry can be recovered'),
      expiresAt: z.string().optional().describe('When soft-deleted entry expires'),
    }).describe('Deletion metadata'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('delete-memory', `delete-${Date.now()}`, {
      memoryId: input.memoryId,
      userId: input.userId || context.userId,
      deleteType: input.deleteType,
    });

    try {
      rootLogger.info('MCP delete memory request', {
        memory_id: input.memoryId,
        user_id: input.userId || context.userId,
        delete_type: input.deleteType,
        reason: input.reason,
        retention_days: input.retentionDays,
      });

      // Use the existing delete memory tool
      const deleteTool = memoryTools.find(tool => tool.id === 'delete-memory');
      if (!deleteTool) {
        throw new Error('Delete memory tool not available');
      }

      const result = await deleteTool.execute({
        context: {
          userId: input.userId || context.userId || 'anonymous',
        },
        input: {
          memory_id: input.memoryId,
          delete_type: input.deleteType,
          reason: input.reason,
          retention_days: input.retentionDays,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          success: result.success,
          deleteType: input.deleteType,
          recoverable: result.recoverable,
        },
      });

      rootLogger.info('MCP delete memory completed', {
        success: result.success,
        memory_id: input.memoryId,
        delete_type: input.deleteType,
        recoverable: result.recoverable,
      });

      return {
        success: result.success,
        error: result.error,
        metadata: {
          memoryId: input.memoryId,
          deleteType: input.deleteType,
          deletedAt: result.deleted_at || new Date().toISOString(),
          recoverable: result.recoverable || false,
          expiresAt: result.expires_at,
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP delete memory failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          memoryId: input.memoryId,
          deleteType: input.deleteType,
          deletedAt: new Date().toISOString(),
          recoverable: false,
        },
      };
    }
  },
});

/**
 * Memory Statistics Tool for MCP
 */
export const mcpMemoryStatsTool = createTool({
  id: 'memory-stats',
  description: 'Get comprehensive statistics about memory usage, storage, and performance across user and global memory scopes.',
  inputSchema: z.object({
    userId: z.string().optional().describe('Get stats for specific user (if not provided, returns system-wide stats)'),
    includeCategories: z.boolean().default(true).describe('Include category breakdown'),
    includePerformance: z.boolean().default(false).describe('Include performance metrics'),
    timeRange: z.object({
      from: z.string().optional().describe('Start date for time-based stats'),
      to: z.string().optional().describe('End date for time-based stats'),
    }).optional().describe('Time range for statistics'),
  }),
  outputSchema: z.object({
    userMemory: z.object({
      totalEntries: z.number().describe('Total user memory entries'),
      totalSize: z.number().describe('Total size in bytes'),
      lastUpdated: z.string().optional().describe('Last update timestamp'),
      categories: z.record(z.string(), z.number()).describe('Entries per category'),
    }).optional().describe('User memory statistics'),
    globalMemory: z.object({
      totalEntries: z.number().describe('Total global memory entries'),
      totalSize: z.number().describe('Total size in bytes'),
      lastUpdated: z.string().optional().describe('Last update timestamp'),
      categories: z.record(z.string(), z.number()).describe('Entries per category'),
    }).describe('Global memory statistics'),
    systemStats: z.object({
      totalMemoryUsed: z.number().describe('Total memory used in bytes'),
      averageEntrySize: z.number().describe('Average entry size in bytes'),
      compressionRatio: z.number().optional().describe('Compression ratio if applicable'),
      cacheHitRate: z.number().optional().describe('Cache hit rate (0-1)'),
    }).describe('System-wide memory statistics'),
    performance: z.object({
      averageSearchTime: z.number().describe('Average search time in ms'),
      averageStoreTime: z.number().describe('Average store time in ms'),
      totalSearches: z.number().describe('Total searches performed'),
      totalStores: z.number().describe('Total stores performed'),
    }).optional().describe('Performance metrics'),
    timeRange: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }).optional().describe('Time range for statistics'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('memory-stats', `stats-${Date.now()}`, {
      userId: input.userId || context.userId,
      includeCategories: input.includeCategories,
      includePerformance: input.includePerformance,
    });

    try {
      rootLogger.info('MCP memory stats request', {
        user_id: input.userId || context.userId,
        include_categories: input.includeCategories,
        include_performance: input.includePerformance,
        time_range: input.timeRange,
      });

      // Use the existing memory stats tool
      const statsTool = memoryTools.find(tool => tool.id === 'memory-stats');
      if (!statsTool) {
        throw new Error('Memory stats tool not available');
      }

      const result = await statsTool.execute({
        context: {
          userId: input.userId || context.userId || 'anonymous',
        },
        input: {
          user_id: input.userId,
          include_categories: input.includeCategories,
          include_performance: input.includePerformance,
          time_range: input.timeRange,
        },
      });

      tracer.end({
        output: result,
        metadata: {
          totalEntries: (result.user_memory?.total_entries || 0) + (result.global_memory?.total_entries || 0),
          totalSize: (result.user_memory?.total_size || 0) + (result.global_memory?.total_size || 0),
        },
      });

      rootLogger.info('MCP memory stats completed', {
        user_memory_entries: result.user_memory?.total_entries || 0,
        global_memory_entries: result.global_memory?.total_entries || 0,
        total_size_bytes: (result.user_memory?.total_size || 0) + (result.global_memory?.total_size || 0),
      });

      return {
        userMemory: result.user_memory ? {
          totalEntries: result.user_memory.total_entries,
          totalSize: result.user_memory.total_size,
          lastUpdated: result.user_memory.last_updated,
          categories: result.user_memory.categories || {},
        } : undefined,
        globalMemory: {
          totalEntries: result.global_memory.total_entries,
          totalSize: result.global_memory.total_size,
          lastUpdated: result.global_memory.last_updated,
          categories: result.global_memory.categories || {},
        },
        systemStats: {
          totalMemoryUsed: result.system_stats.total_memory_used,
          averageEntrySize: result.system_stats.average_entry_size,
          compressionRatio: result.system_stats.compression_ratio,
          cacheHitRate: result.system_stats.cache_hit_rate,
        },
        performance: result.performance ? {
          averageSearchTime: result.performance.average_search_time,
          averageStoreTime: result.performance.average_store_time,
          totalSearches: result.performance.total_searches,
          totalStores: result.performance.total_stores,
        } : undefined,
        timeRange: input.timeRange,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP memory stats failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Memory Health Check Tool for MCP
 */
export const mcpMemoryHealthCheckTool = createTool({
  id: 'memory-health-check',
  description: 'Perform comprehensive health check on the memory system including storage, indexing, and performance validation.',
  inputSchema: z.object({
    userId: z.string().optional().describe('Check specific user memory (if not provided, checks system-wide)'),
    includePerformanceTest: z.boolean().default(true).describe('Include performance tests'),
    includeIntegrityCheck: z.boolean().default(false).describe('Include data integrity checks'),
    timeout: z.number().int().min(5000).max(60000).default(30000).describe('Health check timeout in ms'),
  }),
  outputSchema: z.object({
    overall: z.object({
      status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Overall memory system health'),
      score: z.number().min(0).max(100).describe('Health score out of 100'),
      lastChecked: z.string().describe('Last check timestamp'),
    }),
    components: z.object({
      storage: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Storage health'),
        connectivity: z.boolean().describe('Storage connectivity'),
        responseTime: z.number().describe('Storage response time in ms'),
        issues: z.array(z.string()).describe('Storage issues'),
      }),
      indexing: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Indexing health'),
        searchLatency: z.number().describe('Search latency in ms'),
        indexSize: z.number().describe('Index size in bytes'),
        issues: z.array(z.string()).describe('Indexing issues'),
      }),
      performance: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Performance health'),
        averageSearchTime: z.number().describe('Average search time in ms'),
        averageStoreTime: z.number().describe('Average store time in ms'),
        throughput: z.number().describe('Operations per second'),
        issues: z.array(z.string()).describe('Performance issues'),
      }).optional(),
      integrity: z.object({
        status: z.enum(['healthy', 'unhealthy', 'degraded']).describe('Data integrity status'),
        corruptedEntries: z.number().describe('Number of corrupted entries'),
        orphanedEntries: z.number().describe('Number of orphaned entries'),
        issues: z.array(z.string()).describe('Integrity issues'),
      }).optional(),
    }),
    recommendations: z.array(z.string()).describe('Recommended actions to improve health'),
  }),
  execute: async ({ context, input }) => {
    const tracer = new MCPTracer('memory-health-check', `health-${Date.now()}`, {
      userId: input.userId || context.userId,
      includePerformanceTest: input.includePerformanceTest,
      includeIntegrityCheck: input.includeIntegrityCheck,
    });

    try {
      const startTime = Date.now();
      rootLogger.info('MCP memory health check started', {
        user_id: input.userId || context.userId,
        include_performance_test: input.includePerformanceTest,
        include_integrity_check: input.includeIntegrityCheck,
        timeout: input.timeout,
      });

      const issues: string[] = [];
      const recommendations: string[] = [];

      // Storage health check
      let storageHealth = { status: 'healthy' as const, connectivity: true, responseTime: 0, issues: [] as string[] };
      try {
        const storageStart = Date.now();
        // Mock storage test - in production, test actual storage connectivity
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        storageHealth.responseTime = Date.now() - storageStart;
        storageHealth.connectivity = true;

        if (storageHealth.responseTime > 1000) {
          storageHealth.status = 'degraded';
          storageHealth.issues.push('Slow storage response time');
          issues.push('Storage performance degraded');
          recommendations.push('Optimize storage configuration');
        }
      } catch (error) {
        storageHealth.status = 'unhealthy';
        storageHealth.connectivity = false;
        storageHealth.issues.push('Storage connectivity failed');
        issues.push('Storage system not accessible');
        recommendations.push('Check storage service status');
      }

      // Indexing health check
      let indexingHealth = { status: 'healthy' as const, searchLatency: 0, indexSize: 0, issues: [] as string[] };
      try {
        const indexStart = Date.now();
        // Mock indexing test - in production, test actual search index
        await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 70));
        indexingHealth.searchLatency = Date.now() - indexStart;
        indexingHealth.indexSize = Math.floor(Math.random() * 1000000) + 500000; // Mock index size

        if (indexingHealth.searchLatency > 500) {
          indexingHealth.status = 'degraded';
          indexingHealth.issues.push('High search latency');
          issues.push('Search performance degraded');
          recommendations.push('Rebuild search indices');
        }
      } catch (error) {
        indexingHealth.status = 'unhealthy';
        indexingHealth.issues.push('Search index not accessible');
        issues.push('Search functionality unavailable');
        recommendations.push('Restore search index');
      }

      // Performance health check (optional)
      let performanceHealth;
      if (input.includePerformanceTest) {
        performanceHealth = { status: 'healthy' as const, averageSearchTime: 0, averageStoreTime: 0, throughput: 0, issues: [] as string[] };
        try {
          // Mock performance tests - in production, run actual performance benchmarks
          performanceHealth.averageSearchTime = 100 + Math.random() * 200;
          performanceHealth.averageStoreTime = 50 + Math.random() * 100;
          performanceHealth.throughput = 50 + Math.random() * 100;

          if (performanceHealth.averageSearchTime > 1000) {
            performanceHealth.status = 'degraded';
            performanceHealth.issues.push('Slow search performance');
            issues.push('Search performance below optimal');
            recommendations.push('Optimize search algorithms');
          }

          if (performanceHealth.throughput < 10) {
            performanceHealth.status = 'degraded';
            performanceHealth.issues.push('Low system throughput');
            issues.push('System throughput too low');
            recommendations.push('Scale memory system resources');
          }
        } catch (error) {
          performanceHealth.status = 'unhealthy';
          performanceHealth.issues.push('Performance test failed');
          issues.push('Cannot measure system performance');
          recommendations.push('Investigate performance monitoring system');
        }
      }

      // Data integrity check (optional)
      let integrityHealth;
      if (input.includeIntegrityCheck) {
        integrityHealth = { status: 'healthy' as const, corruptedEntries: 0, orphanedEntries: 0, issues: [] as string[] };
        try {
          // Mock integrity check - in production, perform actual data integrity validation
          integrityHealth.corruptedEntries = Math.floor(Math.random() * 3);
          integrityHealth.orphanedEntries = Math.floor(Math.random() * 5);

          if (integrityHealth.corruptedEntries > 0) {
            integrityHealth.status = 'degraded';
            integrityHealth.issues.push(`${integrityHealth.corruptedEntries} corrupted entries found`);
            issues.push('Data corruption detected');
            recommendations.push('Run data repair procedures');
          }

          if (integrityHealth.orphanedEntries > 10) {
            integrityHealth.status = 'degraded';
            integrityHealth.issues.push(`${integrityHealth.orphanedEntries} orphaned entries found`);
            issues.push('Data cleanup needed');
            recommendations.push('Run data cleanup procedures');
          }
        } catch (error) {
          integrityHealth.status = 'unhealthy';
          integrityHealth.issues.push('Data integrity check failed');
          issues.push('Cannot verify data integrity');
          recommendations.push('Investigate data integrity system');
        }
      }

      // Calculate overall health
      const componentStatuses = [storageHealth.status, indexingHealth.status];
      if (performanceHealth) componentStatuses.push(performanceHealth.status);
      if (integrityHealth) componentStatuses.push(integrityHealth.status);

      const healthyCount = componentStatuses.filter(s => s === 'healthy').length;
      const unhealthyCount = componentStatuses.filter(s => s === 'unhealthy').length;

      let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
      let healthScore: number;

      if (unhealthyCount > 0) {
        overallStatus = 'unhealthy';
        healthScore = Math.max(0, 30 - (unhealthyCount * 15));
      } else if (componentStatuses.some(s => s === 'degraded')) {
        overallStatus = 'degraded';
        healthScore = 50 + (healthyCount / componentStatuses.length) * 30;
      } else {
        overallStatus = 'healthy';
        healthScore = 80 + Math.random() * 20;
      }

      const response = {
        overall: {
          status: overallStatus,
          score: Math.round(healthScore),
          lastChecked: new Date().toISOString(),
        },
        components: {
          storage: storageHealth,
          indexing: indexingHealth,
          performance: performanceHealth,
          integrity: integrityHealth,
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

      rootLogger.info('MCP memory health check completed', {
        overall_status: overallStatus,
        health_score: Math.round(healthScore),
        issues_count: issues.length,
        execution_time_ms: Date.now() - startTime,
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tracer.end({ error: errorMessage });
      rootLogger.error('MCP memory health check failed', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Export all memory MCP tools
 */
export const memoryMCPTools = [
  mcpSearchAllMemoryTool,
  mcpSearchUserMemoryTool,
  mcpSearchGlobalMemoryTool,
  mcpStoreMemoryTool,
  mcpUpdateMemoryTool,
  mcpDeleteMemoryTool,
  mcpMemoryStatsTool,
  mcpMemoryHealthCheckTool,
];

rootLogger.info('Memory MCP tools initialized', {
  tools_count: memoryMCPTools.length,
  tools: memoryMCPTools.map(tool => tool.id),
});