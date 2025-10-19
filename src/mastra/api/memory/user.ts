import { Request, Response } from 'express';
import { z } from 'zod';
import { userMemoryOps } from '../../memory/operations.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * User Memory REST API Endpoints
 * Provides CRUD operations for user-scoped memory with semantic search
 * Includes authentication validation and comprehensive error handling
 */

// Request validation schemas
const StoreMemorySchema = z.object({
  content: z.string().min(1).max(10000),
  metadata: z.record(z.any()).optional(),
  category: z.string().optional(),
  importance: z.enum(['low', 'medium', 'high']).default('medium'),
});

const SearchMemorySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(50).default(5),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
  category: z.string().optional(),
  includeMetadata: z.boolean().default(true),
});

const UpdateMemorySchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  metadata: z.record(z.any()).optional(),
});

const GetMemoriesSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  category: z.string().optional(),
  orderBy: z.enum(['created_at', 'updated_at']).default('created_at'),
  ascending: z.boolean().default(false),
});

/**
 * Store new user memory
 * POST /api/memory/user
 */
export async function storeUserMemory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/user', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to store user memory',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Validate request body
    const validationResult = StoreMemorySchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid request body',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { content, metadata, category, importance } = validationResult.data;

    apiLogger.info('Storing user memory', {
      user_id: req.user.userId,
      content_length: content.length,
      category,
      importance,
      trace_id: tracer.getTraceId(),
    });

    // Store memory
    const memory = await userMemoryOps.store({
      userId: req.user.userId,
      content,
      metadata,
      category,
      importance,
    });

    // Remove embedding from response (too large)
    const { embedding, ...responseMemory } = memory as any;

    tracer.complete(responseMemory);

    res.status(201).json({
      success: true,
      data: responseMemory,
      message: 'Memory stored successfully',
    });

    apiLogger.info('User memory stored successfully', {
      user_id: req.user.userId,
      memory_id: memory.id,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to store user memory', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to store memory',
        type: 'internal_server_error',
        code: 'storage_error',
      },
    });
  }
}

/**
 * Search user memories
 * POST /api/memory/user/search
 */
export async function searchUserMemories(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/user/search', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to search user memories',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Validate request body
    const validationResult = SearchMemorySchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid search parameters',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const searchParams = validationResult.data;

    apiLogger.info('Searching user memories', {
      user_id: req.user.userId,
      query_length: searchParams.query.length,
      top_k: searchParams.topK,
      similarity_threshold: searchParams.similarityThreshold,
      trace_id: tracer.getTraceId(),
    });

    // Search memories
    const results = await userMemoryOps.search({
      userId: req.user.userId,
      ...searchParams,
    });

    const response = {
      success: true,
      data: {
        results,
        total_found: results.length,
        search_params: searchParams,
      },
      message: `Found ${results.length} relevant memories`,
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('User memory search completed', {
      user_id: req.user.userId,
      results_found: results.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to search user memories', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to search memories',
        type: 'internal_server_error',
        code: 'search_error',
      },
    });
  }
}

/**
 * Get user memories with pagination
 * GET /api/memory/user
 */
export async function getUserMemories(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/user', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access user memories',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Validate query parameters
    const validationResult = GetMemoriesSchema.safeParse(req.query);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid query parameters',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const queryParams = validationResult.data;

    apiLogger.info('Retrieving user memories', {
      user_id: req.user.userId,
      limit: queryParams.limit,
      offset: queryParams.offset,
      category: queryParams.category,
      trace_id: tracer.getTraceId(),
    });

    // Get memories
    const memories = await userMemoryOps.getUserMemories(req.user.userId, queryParams);

    // Remove embeddings from response
    const responseMemories = memories.map(({ embedding, ...memory }: any) => memory);

    const response = {
      success: true,
      data: {
        memories: responseMemories,
        count: memories.length,
        pagination: {
          limit: queryParams.limit,
          offset: queryParams.offset,
          has_more: memories.length === queryParams.limit,
        },
      },
      message: `Retrieved ${memories.length} memories`,
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('User memories retrieved', {
      user_id: req.user.userId,
      count: memories.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to retrieve user memories', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve memories',
        type: 'internal_server_error',
        code: 'retrieval_error',
      },
    });
  }
}

/**
 * Update user memory
 * PUT /api/memory/user/:id
 */
export async function updateUserMemory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/memory/user/${req.params.id}`, 'PUT', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to update memory',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const memoryId = req.params.id;
    if (!memoryId) {
      res.status(400).json({
        error: {
          message: 'Memory ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing memory ID'), 400);
      return;
    }

    // Validate request body
    const validationResult = UpdateMemorySchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid update parameters',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const updates = validationResult.data;

    apiLogger.info('Updating user memory', {
      user_id: req.user.userId,
      memory_id: memoryId,
      has_content_update: Boolean(updates.content),
      has_metadata_update: Boolean(updates.metadata),
      trace_id: tracer.getTraceId(),
    });

    // Update memory
    const updatedMemory = await userMemoryOps.update(memoryId, req.user.userId, updates);

    // Remove embedding from response
    const { embedding, ...responseMemory } = updatedMemory as any;

    const response = {
      success: true,
      data: responseMemory,
      message: 'Memory updated successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('User memory updated successfully', {
      user_id: req.user.userId,
      memory_id: memoryId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to update user memory', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to update memory',
        type: 'internal_server_error',
        code: 'update_error',
      },
    });
  }
}

/**
 * Delete user memory
 * DELETE /api/memory/user/:id
 */
export async function deleteUserMemory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/memory/user/${req.params.id}`, 'DELETE', {
    userId: req.user?.userId,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to delete memory',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const memoryId = req.params.id;
    if (!memoryId) {
      res.status(400).json({
        error: {
          message: 'Memory ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing memory ID'), 400);
      return;
    }

    apiLogger.info('Deleting user memory', {
      user_id: req.user.userId,
      memory_id: memoryId,
      trace_id: tracer.getTraceId(),
    });

    // Delete memory
    await userMemoryOps.delete(memoryId, req.user.userId);

    const response = {
      success: true,
      message: 'Memory deleted successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('User memory deleted successfully', {
      user_id: req.user.userId,
      memory_id: memoryId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to delete user memory', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to delete memory',
        type: 'internal_server_error',
        code: 'deletion_error',
      },
    });
  }
}

/**
 * Get user memory statistics
 * GET /api/memory/user/stats
 */
export async function getUserMemoryStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/user/stats', 'GET', {
    userId: req.user?.userId,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access memory statistics',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    apiLogger.info('Getting user memory statistics', {
      user_id: req.user.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get statistics
    const stats = await userMemoryOps.getMemoryStats(req.user.userId);

    const response = {
      success: true,
      data: stats,
      message: 'Statistics retrieved successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('User memory statistics retrieved', {
      user_id: req.user.userId,
      total_memories: stats.total_memories,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get user memory statistics', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve statistics',
        type: 'internal_server_error',
        code: 'stats_error',
      },
    });
  }
}

/**
 * Health check for user memory API
 */
export async function userMemoryHealthCheck(req: Request, res: Response): Promise<void> {
  try {
    // Simple health check without creating actual data
    const healthStatus = {
      healthy: true,
      timestamp: new Date().toISOString(),
      operations: {
        store: 'available',
        search: 'available',
        retrieve: 'available',
        update: 'available',
        delete: 'available',
        stats: 'available',
      },
    };

    res.json(healthStatus);

  } catch (error) {
    apiLogger.error('User memory health check failed', error instanceof Error ? error : new Error(String(error)));

    res.status(503).json({
      healthy: false,
      timestamp: new Date().toISOString(),
      error: 'Service unavailable',
    });
  }
}