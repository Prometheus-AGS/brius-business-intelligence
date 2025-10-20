import { Request, Response } from 'express';
import { z } from 'zod';
import { globalMemoryOps } from '../../memory/operations.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Global Memory REST API Endpoints
 * Provides CRUD operations for organization-wide memory with semantic search
 * Includes role-based access control and comprehensive error handling
 */

// Request validation schemas
const StoreGlobalMemorySchema = z.object({
  content: z.string().min(1).max(10000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  category: z.string().optional(),
  importance: z.enum(['low', 'medium', 'high']).default('medium'),
});

const SearchGlobalMemorySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(50).default(5),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
  category: z.string().optional(),
  includeMetadata: z.boolean().default(true),
});

const UpdateGlobalMemorySchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const GetGlobalMemoriesSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  category: z.string().optional(),
  orderBy: z.enum(['created_at', 'updated_at']).default('created_at'),
  ascending: z.boolean().default(false),
});

/**
 * Store new global memory
 * POST /api/memory/global
 * Requires admin role for write access
 */
export async function storeGlobalMemory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/global', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to store global memory',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Check admin permissions for global memory write operations
    const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('global_memory_write');
    if (!isAdmin) {
      res.status(403).json({
        error: {
          message: 'Admin role required to store global memory',
          type: 'authorization_error',
          code: 'forbidden',
        },
      });
      tracer.fail(new Error('Insufficient permissions'), 403);
      return;
    }

    // Validate request body
    const validationResult = StoreGlobalMemorySchema.safeParse(req.body);
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

    apiLogger.info('Storing global memory', {
      user_id: req.user.userId,
      content_length: content.length,
      category,
      importance,
      trace_id: tracer.getTraceId(),
    });

    // Store global memory with creator attribution
    const memory = await globalMemoryOps.store({
      content,
      metadata: {
        ...metadata,
        created_by_user: req.user.userId,
        created_by_role: req.user.role,
      },
      category,
      importance,
    });

    // Remove embedding from response (too large)
    const { embedding, ...responseMemory } = memory as any;

    tracer.complete(responseMemory);

    res.status(201).json({
      success: true,
      data: responseMemory,
      message: 'Global memory stored successfully',
    });

    apiLogger.info('Global memory stored successfully', {
      user_id: req.user.userId,
      memory_id: memory.id,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to store global memory', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to store global memory',
        type: 'internal_server_error',
        code: 'storage_error',
      },
    });
  }
}

/**
 * Search global memories
 * POST /api/memory/global/search
 */
export async function searchGlobalMemories(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/global/search', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    // Global memory search is available to all authenticated users
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to search global memories',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Validate request body
    const validationResult = SearchGlobalMemorySchema.safeParse(req.body);
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

    apiLogger.info('Searching global memories', {
      user_id: req.user.userId,
      query_length: searchParams.query.length,
      top_k: searchParams.topK,
      similarity_threshold: searchParams.similarityThreshold,
      trace_id: tracer.getTraceId(),
    });

    // Search global memories (no user filtering)
    const results = await globalMemoryOps.search(searchParams);

    const response = {
      success: true,
      data: {
        results,
        total_found: results.length,
        search_params: searchParams,
      },
      message: `Found ${results.length} relevant global memories`,
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Global memory search completed', {
      user_id: req.user.userId,
      results_found: results.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to search global memories', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to search global memories',
        type: 'internal_server_error',
        code: 'search_error',
      },
    });
  }
}

/**
 * Get global memories with pagination
 * GET /api/memory/global
 */
export async function getGlobalMemories(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/global', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    // Global memory access is available to all authenticated users
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access global memories',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Validate query parameters
    const validationResult = GetGlobalMemoriesSchema.safeParse(req.query);
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

    apiLogger.info('Retrieving global memories', {
      user_id: req.user.userId,
      limit: queryParams.limit,
      offset: queryParams.offset,
      category: queryParams.category,
      trace_id: tracer.getTraceId(),
    });

    // Get global memories (implement in GlobalMemoryOperations)
    const memories = await globalMemoryOps.getGlobalMemories(queryParams);

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
      message: `Retrieved ${memories.length} global memories`,
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Global memories retrieved', {
      user_id: req.user.userId,
      count: memories.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to retrieve global memories', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve global memories',
        type: 'internal_server_error',
        code: 'retrieval_error',
      },
    });
  }
}

/**
 * Update global memory
 * PUT /api/memory/global/:id
 * Requires admin role for write access
 */
export async function updateGlobalMemory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/memory/global/${req.params.id}`, 'PUT', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to update global memory',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Check admin permissions for global memory write operations
    const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('global_memory_write');
    if (!isAdmin) {
      res.status(403).json({
        error: {
          message: 'Admin role required to update global memory',
          type: 'authorization_error',
          code: 'forbidden',
        },
      });
      tracer.fail(new Error('Insufficient permissions'), 403);
      return;
    }

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
    const validationResult = UpdateGlobalMemorySchema.safeParse(req.body);
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

    apiLogger.info('Updating global memory', {
      user_id: req.user.userId,
      memory_id: memoryId,
      has_content_update: Boolean(updates.content),
      has_metadata_update: Boolean(updates.metadata),
      trace_id: tracer.getTraceId(),
    });

    // Update global memory with editor attribution
    const updatedMemory = await globalMemoryOps.update(memoryId, {
      ...updates,
      metadata: updates.metadata ? {
        ...updates.metadata,
        updated_by_user: req.user.userId,
        updated_by_role: req.user.role,
        updated_at: new Date().toISOString(),
      } : undefined,
    });

    // Remove embedding from response
    const { embedding, ...responseMemory } = updatedMemory as any;

    const response = {
      success: true,
      data: responseMemory,
      message: 'Global memory updated successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Global memory updated successfully', {
      user_id: req.user.userId,
      memory_id: memoryId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to update global memory', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to update global memory',
        type: 'internal_server_error',
        code: 'update_error',
      },
    });
  }
}

/**
 * Delete global memory
 * DELETE /api/memory/global/:id
 * Requires admin role for write access
 */
export async function deleteGlobalMemory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/memory/global/${req.params.id}`, 'DELETE', {
    userId: req.user?.userId,
  });

  try {
    // Validate authentication
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to delete global memory',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Check admin permissions for global memory write operations
    const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('global_memory_write');
    if (!isAdmin) {
      res.status(403).json({
        error: {
          message: 'Admin role required to delete global memory',
          type: 'authorization_error',
          code: 'forbidden',
        },
      });
      tracer.fail(new Error('Insufficient permissions'), 403);
      return;
    }

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

    apiLogger.info('Deleting global memory', {
      user_id: req.user.userId,
      memory_id: memoryId,
      trace_id: tracer.getTraceId(),
    });

    // Delete global memory
    await globalMemoryOps.delete(memoryId);

    const response = {
      success: true,
      message: 'Global memory deleted successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Global memory deleted successfully', {
      user_id: req.user.userId,
      memory_id: memoryId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to delete global memory', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to delete global memory',
        type: 'internal_server_error',
        code: 'deletion_error',
      },
    });
  }
}

/**
 * Get global memory statistics
 * GET /api/memory/global/stats
 */
export async function getGlobalMemoryStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/global/stats', 'GET', {
    userId: req.user?.userId,
  });

  try {
    // Global memory stats are available to all authenticated users
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access global memory statistics',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    apiLogger.info('Getting global memory statistics', {
      user_id: req.user.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get global memory statistics
    const stats = await globalMemoryOps.getMemoryStats();

    const response = {
      success: true,
      data: stats,
      message: 'Global memory statistics retrieved successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Global memory statistics retrieved', {
      user_id: req.user.userId,
      total_memories: stats.total_memories,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get global memory statistics', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve global memory statistics',
        type: 'internal_server_error',
        code: 'stats_error',
      },
    });
  }
}

/**
 * Health check for global memory API
 */
export async function globalMemoryHealthCheck(req: Request, res: Response): Promise<void> {
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
    apiLogger.error('Global memory health check failed', error instanceof Error ? error : new Error(String(error)));

    res.status(503).json({
      healthy: false,
      timestamp: new Date().toISOString(),
      error: 'Service unavailable',
    });
  }
}