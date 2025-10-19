import { Tool } from '@mastra/core';
import { z } from 'zod';
import { userMemoryOps, globalMemoryOps } from '../memory/operations.js';
import { memoryLogger } from '../observability/logger.js';
import { getToolCallTracer, ToolExecutionContext } from '../observability/tool-tracer.js';

/**
 * Memory Tools for Agent Integration
 * Provides tools for agents to store, search, and manage user and global memories
 * Enables intelligent agents to maintain context and organizational knowledge
 */

/**
 * Helper function to wrap tool execution with comprehensive tracing
 */
async function executeWithTracing<T>(
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
    userId: context.user?.userId,
    agentId: context.agent?.id,
    sessionId: context.session?.id,
    metadata: {
      tool_type: 'memory_tool',
      has_user_context: Boolean(context.user?.userId),
      agent_type: context.agent?.type,
    },
  };

  return await tracer.traceToolExecution(toolContext, input, executor);
}

// Input schemas for memory tools
const StoreUserMemorySchema = z.object({
  content: z.string().min(1).max(10000).describe('Content to store in user memory'),
  category: z.string().optional().describe('Category for organizing the memory (e.g., "preferences", "context", "business")'),
  importance: z.enum(['low', 'medium', 'high']).default('medium').describe('Importance level of this memory'),
  metadata: z.record(z.any()).optional().describe('Additional metadata to store with the memory'),
});

const SearchUserMemorySchema = z.object({
  query: z.string().min(1).describe('Search query to find relevant user memories'),
  topK: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to return'),
  similarityThreshold: z.number().min(0).max(1).default(0.7).describe('Minimum similarity score (0-1) for results'),
  category: z.string().optional().describe('Filter results by category'),
});

const SearchGlobalMemorySchema = z.object({
  query: z.string().min(1).describe('Search query to find relevant organizational memories'),
  topK: z.number().int().min(1).max(20).default(5).describe('Maximum number of results to return'),
  similarityThreshold: z.number().min(0).max(1).default(0.7).describe('Minimum similarity score (0-1) for results'),
  category: z.string().optional().describe('Filter results by category'),
});

const StoreGlobalMemorySchema = z.object({
  content: z.string().min(1).max(10000).describe('Content to store in global organizational memory'),
  category: z.string().optional().describe('Category for organizing the memory (e.g., "business", "policies", "procedures")'),
  importance: z.enum(['low', 'medium', 'high']).default('medium').describe('Importance level of this memory'),
  metadata: z.record(z.any()).optional().describe('Additional metadata to store with the memory'),
});

const GetUserMemoryStatsSchema = z.object({
  includeDetails: z.boolean().default(false).describe('Include detailed breakdown by categories and importance levels'),
});

/**
 * Store content in user-scoped memory for personalized context
 */
export const storeUserMemoryTool = new Tool({
  id: 'store-user-memory',
  description: 'Store content in user-scoped memory for personalized context and preferences. Use this to remember user-specific information, preferences, or context that should persist across conversations.',
  inputSchema: StoreUserMemorySchema,
  outputSchema: z.object({
    success: z.boolean(),
    memory_id: z.string(),
    content_length: z.number(),
    category: z.string().optional(),
    importance: z.string(),
    message: z.string(),
  }),
  execute: async ({ context, input }) => {
    return await executeWithTracing(
      'store-user-memory',
      'Store User Memory',
      context,
      input,
      async () => {
        const { content, category, importance, metadata } = input;

        // Get user ID from context
        const userId = context.user?.userId;
        if (!userId) {
          throw new Error('User authentication required to store user memory');
        }

        memoryLogger.info('Agent storing user memory', {
          user_id: userId,
          content_length: content.length,
          category,
          importance,
          agent_id: context.agent?.id,
        });

        const memory = await userMemoryOps.store({
          userId,
          content,
          category,
          importance,
          metadata: {
            ...metadata,
            stored_by_agent: context.agent?.id || 'unknown',
            stored_at: new Date().toISOString(),
          },
        });

        return {
          success: true,
          memory_id: memory.id,
          content_length: content.length,
          category: category || 'general',
          importance,
          message: `Successfully stored user memory with ID ${memory.id}`,
        };
      }
    );
  },
});

/**
 * Search user-scoped memory for relevant context
 */
export const searchUserMemoryTool = new Tool({
  id: 'search-user-memory',
  description: 'Search user-scoped memory to find relevant context, preferences, or previous conversations. Use this to personalize responses based on user history.',
  inputSchema: SearchUserMemorySchema,
  outputSchema: z.object({
    success: z.boolean(),
    results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity: z.number(),
      category: z.string().optional(),
      created_at: z.string(),
      metadata: z.record(z.any()).optional(),
    })),
    total_found: z.number(),
    avg_similarity: z.number(),
    message: z.string(),
  }),
  execute: async ({ context, input }) => {
    return await executeWithTracing(
      'search-user-memory',
      'Search User Memory',
      context,
      input,
      async () => {
        const { query, topK, similarityThreshold, category } = input;

        // Get user ID from context
        const userId = context.user?.userId;
        if (!userId) {
          throw new Error('User authentication required to search user memory');
        }

        memoryLogger.info('Agent searching user memory', {
          user_id: userId,
          query_length: query.length,
          top_k: topK,
          similarity_threshold: similarityThreshold,
          category,
          agent_id: context.agent?.id,
        });

        const results = await userMemoryOps.search({
          userId,
          query,
          topK,
          similarityThreshold,
          category,
          includeMetadata: true,
        });

        const avgSimilarity = results.length > 0
          ? results.reduce((sum, r) => sum + r.similarity, 0) / results.length
          : 0;

        return {
          success: true,
          results: results.map(r => ({
            id: r.id,
            content: r.content,
            similarity: r.similarity,
            category: r.metadata?.category,
            created_at: r.created_at,
            metadata: r.metadata,
          })),
          total_found: results.length,
          avg_similarity: Math.round(avgSimilarity * 100) / 100,
          message: `Found ${results.length} relevant user memories with average similarity ${Math.round(avgSimilarity * 100)}%`,
        };
      }
    );
  },
});

/**
 * Search global organizational memory for business context
 */
export const searchGlobalMemoryTool = new Tool({
  id: 'search-global-memory',
  description: 'Search organizational/global memory to find relevant business context, policies, procedures, or organizational knowledge. Use this for information that applies to all users.',
  inputSchema: SearchGlobalMemorySchema,
  outputSchema: z.object({
    success: z.boolean(),
    results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity: z.number(),
      category: z.string().optional(),
      created_at: z.string(),
      metadata: z.record(z.any()).optional(),
    })),
    total_found: z.number(),
    avg_similarity: z.number(),
    message: z.string(),
  }),
  execute: async ({ context, input }) => {
    const { query, topK, similarityThreshold, category } = input;

    // Authentication required but no user-specific filtering
    const userId = context.user?.userId;
    if (!userId) {
      throw new Error('Authentication required to search global memory');
    }

    memoryLogger.info('Agent searching global memory', {
      user_id: userId,
      query_length: query.length,
      top_k: topK,
      similarity_threshold: similarityThreshold,
      category,
      agent_id: context.agent?.id,
    });

    try {
      const results = await globalMemoryOps.search({
        query,
        topK,
        similarityThreshold,
        category,
        includeMetadata: true,
      });

      const avgSimilarity = results.length > 0
        ? results.reduce((sum, r) => sum + r.similarity, 0) / results.length
        : 0;

      return {
        success: true,
        results: results.map(r => ({
          id: r.id,
          content: r.content,
          similarity: r.similarity,
          category: r.metadata?.category,
          created_at: r.created_at,
          metadata: r.metadata,
        })),
        total_found: results.length,
        avg_similarity: Math.round(avgSimilarity * 100) / 100,
        message: `Found ${results.length} relevant organizational memories with average similarity ${Math.round(avgSimilarity * 100)}%`,
      };

    } catch (error) {
      memoryLogger.error('Agent failed to search global memory', {
        user_id: userId,
        error: error instanceof Error ? error.message : String(error),
        agent_id: context.agent?.id,
      });
      throw new Error(`Failed to search global memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Store content in global organizational memory (admin only)
 */
export const storeGlobalMemoryTool = new Tool({
  id: 'store-global-memory',
  description: 'Store content in global organizational memory for business context, policies, or procedures. Requires admin permissions. Use this for information that should be available to all users.',
  inputSchema: StoreGlobalMemorySchema,
  outputSchema: z.object({
    success: z.boolean(),
    memory_id: z.string(),
    content_length: z.number(),
    category: z.string().optional(),
    importance: z.string(),
    message: z.string(),
  }),
  execute: async ({ context, input }) => {
    const { content, category, importance, metadata } = input;

    // Get user context and check permissions
    const userId = context.user?.userId;
    const userRole = context.user?.role;
    const userPermissions = context.user?.permissions || [];

    if (!userId) {
      throw new Error('Authentication required to store global memory');
    }

    // Check admin permissions
    const isAdmin = userRole === 'admin' || userPermissions.includes('global_memory_write');
    if (!isAdmin) {
      throw new Error('Admin permissions required to store global memory');
    }

    memoryLogger.info('Agent storing global memory', {
      user_id: userId,
      content_length: content.length,
      category,
      importance,
      agent_id: context.agent?.id,
    });

    try {
      const memory = await globalMemoryOps.store({
        content,
        category,
        importance,
        metadata: {
          ...metadata,
          stored_by_agent: context.agent?.id || 'unknown',
          stored_by_user: userId,
          stored_by_role: userRole,
          stored_at: new Date().toISOString(),
        },
      });

      return {
        success: true,
        memory_id: memory.id,
        content_length: content.length,
        category: category || 'general',
        importance,
        message: `Successfully stored global memory with ID ${memory.id}`,
      };

    } catch (error) {
      memoryLogger.error('Agent failed to store global memory', {
        user_id: userId,
        error: error instanceof Error ? error.message : String(error),
        agent_id: context.agent?.id,
      });
      throw new Error(`Failed to store global memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Get user memory statistics and insights
 */
export const getUserMemoryStatsTool = new Tool({
  id: 'get-user-memory-stats',
  description: 'Get statistics about user memory usage, including total memories, categories, and date ranges. Useful for understanding user engagement and memory patterns.',
  inputSchema: GetUserMemoryStatsSchema,
  outputSchema: z.object({
    success: z.boolean(),
    total_memories: z.number(),
    categories: z.record(z.number()),
    importance_levels: z.record(z.number()),
    date_range: z.object({
      oldest: z.string().nullable(),
      newest: z.string().nullable(),
    }),
    insights: z.array(z.string()),
    message: z.string(),
  }),
  execute: async ({ context, input }) => {
    const { includeDetails } = input;

    // Get user ID from context
    const userId = context.user?.userId;
    if (!userId) {
      throw new Error('User authentication required to get memory statistics');
    }

    memoryLogger.info('Agent getting user memory statistics', {
      user_id: userId,
      include_details: includeDetails,
      agent_id: context.agent?.id,
    });

    try {
      const stats = await userMemoryOps.getMemoryStats(userId);

      // Generate insights based on the statistics
      const insights: string[] = [];

      if (stats.total_memories === 0) {
        insights.push('No memories stored yet - this is a fresh start!');
      } else {
        insights.push(`User has ${stats.total_memories} stored memories`);

        // Category insights
        const categoryCount = Object.keys(stats.categories).length;
        if (categoryCount > 3) {
          insights.push(`Memories are well-organized across ${categoryCount} categories`);
        } else if (categoryCount === 1) {
          insights.push(`All memories are in the "${Object.keys(stats.categories)[0]}" category`);
        }

        // Importance insights
        const highImportance = stats.importance_levels.high || 0;
        const mediumImportance = stats.importance_levels.medium || 0;
        const lowImportance = stats.importance_levels.low || 0;

        if (highImportance > mediumImportance + lowImportance) {
          insights.push('Most memories are marked as high importance');
        } else if (mediumImportance > highImportance + lowImportance) {
          insights.push('Most memories are of medium importance');
        }

        // Date range insights
        if (stats.date_range.oldest && stats.date_range.newest) {
          const oldestDate = new Date(stats.date_range.oldest);
          const newestDate = new Date(stats.date_range.newest);
          const daysDiff = Math.ceil((newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));

          if (daysDiff < 7) {
            insights.push('All memories are from the past week');
          } else if (daysDiff < 30) {
            insights.push('Memories span across the past month');
          } else {
            insights.push(`Memories span across ${Math.ceil(daysDiff / 30)} months`);
          }
        }
      }

      return {
        success: true,
        total_memories: stats.total_memories,
        categories: includeDetails ? stats.categories : {},
        importance_levels: includeDetails ? stats.importance_levels : {},
        date_range: stats.date_range,
        insights,
        message: `Retrieved memory statistics for user with ${stats.total_memories} total memories`,
      };

    } catch (error) {
      memoryLogger.error('Agent failed to get user memory statistics', {
        user_id: userId,
        error: error instanceof Error ? error.message : String(error),
        agent_id: context.agent?.id,
      });
      throw new Error(`Failed to get user memory statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

/**
 * Combined memory search tool that searches both user and global memories
 */
export const searchAllMemoryTool = new Tool({
  id: 'search-all-memory',
  description: 'Search both user and global memories simultaneously to find the most relevant context from personal preferences and organizational knowledge.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query to find relevant memories'),
    topK: z.number().int().min(1).max(20).default(8).describe('Maximum total results to return (split between user and global)'),
    similarityThreshold: z.number().min(0).max(1).default(0.7).describe('Minimum similarity score (0-1) for results'),
    userWeight: z.number().min(0).max(1).default(0.6).describe('Weight for user memories vs global memories (0.6 = prefer user memories)'),
    category: z.string().optional().describe('Filter results by category'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    user_results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity: z.number(),
      category: z.string().optional(),
      created_at: z.string(),
      source: z.literal('user'),
      metadata: z.record(z.any()).optional(),
    })),
    global_results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity: z.number(),
      category: z.string().optional(),
      created_at: z.string(),
      source: z.literal('global'),
      metadata: z.record(z.any()).optional(),
    })),
    combined_results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity: z.number(),
      category: z.string().optional(),
      created_at: z.string(),
      source: z.enum(['user', 'global']),
      weighted_score: z.number(),
    })),
    total_found: z.number(),
    message: z.string(),
  }),
  execute: async ({ context, input }) => {
    const { query, topK, similarityThreshold, userWeight, category } = input;

    // Get user ID from context
    const userId = context.user?.userId;
    if (!userId) {
      throw new Error('Authentication required to search memories');
    }

    const globalWeight = 1 - userWeight;
    const userTopK = Math.ceil(topK * userWeight);
    const globalTopK = Math.ceil(topK * globalWeight);

    memoryLogger.info('Agent searching all memories', {
      user_id: userId,
      query_length: query.length,
      total_top_k: topK,
      user_top_k: userTopK,
      global_top_k: globalTopK,
      user_weight: userWeight,
      agent_id: context.agent?.id,
    });

    try {
      // Search both user and global memories in parallel
      const [userResults, globalResults] = await Promise.all([
        userMemoryOps.search({
          userId,
          query,
          topK: userTopK,
          similarityThreshold,
          category,
          includeMetadata: true,
        }),
        globalMemoryOps.search({
          query,
          topK: globalTopK,
          similarityThreshold,
          category,
          includeMetadata: true,
        })
      ]);

      // Combine and weight the results
      const combinedResults = [
        ...userResults.map(r => ({
          ...r,
          source: 'user' as const,
          weighted_score: r.similarity * userWeight,
        })),
        ...globalResults.map(r => ({
          ...r,
          source: 'global' as const,
          weighted_score: r.similarity * globalWeight,
        }))
      ];

      // Sort by weighted score and take top K
      combinedResults.sort((a, b) => b.weighted_score - a.weighted_score);
      const topResults = combinedResults.slice(0, topK);

      return {
        success: true,
        user_results: userResults.map(r => ({
          id: r.id,
          content: r.content,
          similarity: r.similarity,
          category: r.metadata?.category,
          created_at: r.created_at,
          source: 'user' as const,
          metadata: r.metadata,
        })),
        global_results: globalResults.map(r => ({
          id: r.id,
          content: r.content,
          similarity: r.similarity,
          category: r.metadata?.category,
          created_at: r.created_at,
          source: 'global' as const,
          metadata: r.metadata,
        })),
        combined_results: topResults.map(r => ({
          id: r.id,
          content: r.content,
          similarity: r.similarity,
          category: r.metadata?.category,
          created_at: r.created_at,
          source: r.source,
          weighted_score: Math.round(r.weighted_score * 100) / 100,
        })),
        total_found: topResults.length,
        message: `Found ${userResults.length} user memories and ${globalResults.length} global memories, combined top ${topResults.length} results`,
      };

    } catch (error) {
      memoryLogger.error('Agent failed to search all memories', {
        user_id: userId,
        error: error instanceof Error ? error.message : String(error),
        agent_id: context.agent?.id,
      });
      throw new Error(`Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});

// Export all memory tools as an array for easy registration
export const memoryTools = [
  storeUserMemoryTool,
  searchUserMemoryTool,
  searchGlobalMemoryTool,
  storeGlobalMemoryTool,
  getUserMemoryStatsTool,
  searchAllMemoryTool,
];

// Individual tools are already exported above in their definitions