import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { userMemoryOps, globalMemoryOps } from '../memory/operations.js';

const StoreUserMemoryInput = z.object({
  userId: z.string(),
  content: z.string().min(1),
  category: z.string().optional(),
  importance: z.enum(['low', 'medium', 'high']).default('medium'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const storeUserMemoryTool = createTool({
  id: 'store-memory',
  description: 'Store content in user-scoped memory for personalised context.',
  inputSchema: StoreUserMemoryInput,
  outputSchema: z.object({
    memory_id: z.string(),
    content: z.string(),
    category: z.string().optional(),
    importance: z.string(),
  }),
  execute: async ({ context }) => {
    const memory = await userMemoryOps.store({
      userId: context.userId,
      content: context.content,
      category: context.category,
      importance: context.importance,
      metadata: context.metadata,
    });

    return {
      memory_id: memory.id,
      content: memory.content,
      category: memory.category ?? undefined,
      importance: memory.metadata?.importance ?? 'medium',
    };
  },
});

const SearchUserMemoryInput = z.object({
  userId: z.string(),
  query: z.string(),
  topK: z.number().int().min(1).max(20).default(5),
  similarityThreshold: z.number().min(0).max(1).default(0.6),
  category: z.string().optional(),
});

export const searchUserMemoryTool = createTool({
  id: 'search-user-memory',
  description: 'Search user memory for relevant context.',
  inputSchema: SearchUserMemoryInput,
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity_score: z.number(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      created_at: z.string().optional(),
    })),
  }),
  execute: async ({ context }) => {
    const results = await userMemoryOps.search({
      userId: context.userId,
      query: context.query,
      topK: context.topK,
      similarityThreshold: context.similarityThreshold,
      category: context.category,
      includeMetadata: true,
    });

    return {
      results: results.map(result => ({
        id: result.id,
        content: result.content,
        similarity_score: result.similarity_score,
        metadata: result.metadata,
        created_at: result.created_at,
      })),
    };
  },
});

const SearchGlobalMemoryInput = z.object({
  query: z.string(),
  topK: z.number().int().min(1).max(20).default(5),
  similarityThreshold: z.number().min(0).max(1).default(0.6),
  category: z.string().optional(),
});

export const searchGlobalMemoryTool = createTool({
  id: 'search-global-memory',
  description: 'Search organisational memory for shared knowledge.',
  inputSchema: SearchGlobalMemoryInput,
  outputSchema: z.object({
    results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity_score: z.number(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      created_at: z.string().optional(),
    })),
  }),
  execute: async ({ context }) => {
    const results = await globalMemoryOps.search({
      query: context.query,
      topK: context.topK,
      similarityThreshold: context.similarityThreshold,
      category: context.category,
      includeMetadata: true,
    });

    return {
      results: results.map(result => ({
        id: result.id,
        content: result.content,
        similarity_score: result.similarity_score,
        metadata: result.metadata,
        created_at: result.created_at,
      })),
    };
  },
});

export const searchAllMemoryTool = createTool({
  id: 'search-all-memory',
  description: 'Search user and global memory together.',
  inputSchema: SearchUserMemoryInput.extend({
    scope: z.enum(['user', 'global', 'both']).default('both'),
  }),
  outputSchema: z.object({
    user_results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity_score: z.number(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })),
    global_results: z.array(z.object({
      id: z.string(),
      content: z.string(),
      similarity_score: z.number(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })),
  }),
  execute: async ({ context }) => {
    const userResults = context.scope !== 'global'
      ? await userMemoryOps.search({
          userId: context.userId,
          query: context.query,
          topK: context.topK,
          similarityThreshold: context.similarityThreshold,
          category: context.category,
          includeMetadata: true,
        })
      : [];

    const globalResults = context.scope !== 'user'
      ? await globalMemoryOps.search({
          query: context.query,
          topK: context.topK,
          similarityThreshold: context.similarityThreshold,
          category: context.category,
          includeMetadata: true,
        })
      : [];

    return {
      user_results: userResults.map(result => ({
        id: result.id,
        content: result.content,
        similarity_score: result.similarity_score,
        metadata: result.metadata,
      })),
      global_results: globalResults.map(result => ({
        id: result.id,
        content: result.content,
        similarity_score: result.similarity_score,
        metadata: result.metadata,
      })),
    };
  },
});

const StoreGlobalMemoryInput = z.object({
  content: z.string().min(1),
  category: z.string().optional(),
  importance: z.enum(['low', 'medium', 'high']).default('medium'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdBy: z.string().optional(),
});

export const storeGlobalMemoryTool = createTool({
  id: 'store-global-memory',
  description: 'Store content in shared organisational memory.',
  inputSchema: StoreGlobalMemoryInput,
  outputSchema: z.object({
    memory_id: z.string(),
    content: z.string(),
    category: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const memory = await globalMemoryOps.store({
      content: context.content,
      category: context.category,
      metadata: context.metadata,
      createdBy: context.createdBy,
      importance: context.importance,
    });

    return {
      memory_id: memory.id,
      content: memory.content,
      category: memory.category ?? undefined,
    };
  },
});

export const deleteMemoryTool = createTool({
  id: 'delete-memory',
  description: 'Delete a memory entry by identifier.',
  inputSchema: z.object({
    id: z.string(),
    userId: z.string().optional(),
    scope: z.enum(['user', 'global']).default('user'),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ context }) => {
    if (context.scope === 'global') {
      await globalMemoryOps.delete(context.id);
    } else if (context.userId) {
      await userMemoryOps.delete(context.id, context.userId);
    } else {
      throw new Error('userId is required when deleting user memory');
    }

    return { success: true };
  },
});

export const updateMemoryTool = createTool({
  id: 'update-memory',
  description: 'Update the content or metadata of a memory entry.',
  inputSchema: z.object({
    id: z.string(),
    scope: z.enum(['user', 'global']).default('user'),
    userId: z.string().optional(),
    content: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ context }) => {
    if (context.scope === 'global') {
      await globalMemoryOps.update(context.id, {
        content: context.content,
        metadata: context.metadata,
      });
    } else if (context.userId) {
      await userMemoryOps.update(context.id, context.userId, {
        content: context.content,
        metadata: context.metadata,
      });
    } else {
      throw new Error('userId is required when updating user memory');
    }

    return { success: true };
  },
});

export const memoryStatsTool = createTool({
  id: 'memory-stats',
  description: 'Return high-level statistics for user and global memory.',
  inputSchema: z.object({ userId: z.string().optional() }).optional(),
  outputSchema: z.object({
    user: z.object({
      total_memories: z.number(),
      categories: z.record(z.string(), z.number()),
      importance_levels: z.record(z.string(), z.number()),
    }).optional(),
    global: z.object({
      total_memories: z.number(),
      categories: z.record(z.string(), z.number()),
      importance_levels: z.record(z.string(), z.number()),
    }),
  }),
  execute: async ({ context }) => {
    const globalStats = await globalMemoryOps.getMemoryStats();
    const userStats = context?.userId ? await userMemoryOps.getMemoryStats(context.userId) : undefined;

    return {
      user: userStats,
      global: globalStats,
    };
  },
});

export const memoryTools = [
  storeUserMemoryTool,
  searchUserMemoryTool,
  searchGlobalMemoryTool,
  searchAllMemoryTool,
  storeGlobalMemoryTool,
  updateMemoryTool,
  deleteMemoryTool,
  memoryStatsTool,
];
