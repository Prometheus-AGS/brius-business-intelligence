import { Request, Response } from 'express';
import { z } from 'zod';
import { userMemoryOps, globalMemoryOps } from '../../memory/operations.js';
import { vectorStorage } from '../../memory/storage.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Memory Statistics API Endpoints
 * Provides comprehensive statistics across user and global memory systems
 * Includes performance metrics, usage analytics, and system health data
 */

// Request validation schemas
const GetStatsSchema = z.object({
  include_user: z.boolean().default(true),
  include_global: z.boolean().default(true),
  include_performance: z.boolean().default(false),
  include_system_health: z.boolean().default(false),
});

const GetUserStatsSchema = z.object({
  user_id: z.string().optional(),
  include_performance: z.boolean().default(false),
});

/**
 * Get comprehensive memory system statistics
 * GET /api/memory/stats
 */
export async function getMemoryStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/stats', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    // Authentication required
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

    // Validate query parameters
    const validationResult = GetStatsSchema.safeParse(req.query);
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

    const {
      include_user,
      include_global,
      include_performance,
      include_system_health,
    } = validationResult.data;

    apiLogger.info('Getting comprehensive memory statistics', {
      user_id: req.user.userId,
      include_user,
      include_global,
      include_performance,
      include_system_health,
      trace_id: tracer.getTraceId(),
    });

    const stats: any = {
      timestamp: new Date().toISOString(),
      user_id: req.user.userId,
    };

    // Collect user memory statistics
    if (include_user) {
      try {
        stats.user_memory = await userMemoryOps.getMemoryStats(req.user.userId);
      } catch (error) {
        apiLogger.warn('Failed to get user memory statistics', {
          user_id: req.user.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.user_memory = {
          error: 'Failed to retrieve user memory statistics',
          total_memories: 0,
          categories: {},
          importance_levels: {},
          date_range: { oldest: null, newest: null },
        };
      }
    }

    // Collect global memory statistics (available to all users)
    if (include_global) {
      try {
        stats.global_memory = await globalMemoryOps.getMemoryStats();
      } catch (error) {
        apiLogger.warn('Failed to get global memory statistics', {
          user_id: req.user.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.global_memory = {
          error: 'Failed to retrieve global memory statistics',
          total_memories: 0,
          categories: {},
          importance_levels: {},
          date_range: { oldest: null, newest: null },
        };
      }
    }

    // Collect performance metrics (if requested)
    if (include_performance) {
      try {
        // TODO: Implement vector performance analysis in VectorOperationsService
        const userMemoryPerf = { avg_search_time_ms: 0, table_size: 0, index_usage: true };
        const globalMemoryPerf = { avg_search_time_ms: 0, table_size: 0, index_usage: true };

        stats.performance = {
          user_memories: userMemoryPerf,
          global_memories: globalMemoryPerf,
          overall: {
            avg_search_time_ms: Math.round(
              (userMemoryPerf.avg_search_time_ms + globalMemoryPerf.avg_search_time_ms) / 2
            ),
            total_table_size: userMemoryPerf.table_size + globalMemoryPerf.table_size,
            indexes_healthy: userMemoryPerf.index_usage && globalMemoryPerf.index_usage,
          },
        };
      } catch (error) {
        apiLogger.warn('Failed to get performance statistics', {
          user_id: req.user.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.performance = {
          error: 'Failed to retrieve performance statistics',
        };
      }
    }

    // Collect system health metrics (if requested)
    if (include_system_health) {
      try {
        stats.system_health = await vectorStorage.healthCheck();
      } catch (error) {
        apiLogger.warn('Failed to get system health statistics', {
          user_id: req.user.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.system_health = {
          healthy: false,
          error: 'Failed to retrieve system health statistics',
        };
      }
    }

    const response = {
      success: true,
      data: stats,
      message: 'Memory statistics retrieved successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Memory statistics retrieved successfully', {
      user_id: req.user.userId,
      includes: { include_user, include_global, include_performance, include_system_health },
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get memory statistics', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve memory statistics',
        type: 'internal_server_error',
        code: 'stats_error',
      },
    });
  }
}

/**
 * Get user-specific memory statistics
 * GET /api/memory/stats/user
 */
export async function getUserMemoryStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/stats/user', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    // Authentication required
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access user memory statistics',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Validate query parameters
    const validationResult = GetUserStatsSchema.safeParse(req.query);
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

    const { user_id, include_performance } = validationResult.data;

    // Allow admins to view other users' stats, otherwise restrict to own stats
    const targetUserId = user_id || req.user.userId;
    const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('view_all_user_stats');

    if (targetUserId !== req.user.userId && !isAdmin) {
      res.status(403).json({
        error: {
          message: 'Admin role required to view other users\' statistics',
          type: 'authorization_error',
          code: 'forbidden',
        },
      });
      tracer.fail(new Error('Insufficient permissions'), 403);
      return;
    }

    apiLogger.info('Getting user memory statistics', {
      requesting_user_id: req.user.userId,
      target_user_id: targetUserId,
      include_performance,
      trace_id: tracer.getTraceId(),
    });

    // Get user memory statistics
    const userStats = await userMemoryOps.getMemoryStats(targetUserId);

    const stats: any = {
      timestamp: new Date().toISOString(),
      user_id: targetUserId,
      ...userStats,
    };

    // Add performance metrics if requested
    if (include_performance) {
      try {
        // TODO: Implement vector performance analysis in VectorOperationsService
        const performanceStats = { avg_search_time_ms: 0, table_size: 0, index_usage: true };
        stats.performance = performanceStats;
      } catch (error) {
        apiLogger.warn('Failed to get user memory performance statistics', {
          user_id: targetUserId,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.performance = {
          error: 'Failed to retrieve performance statistics',
        };
      }
    }

    const response = {
      success: true,
      data: stats,
      message: 'User memory statistics retrieved successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('User memory statistics retrieved successfully', {
      requesting_user_id: req.user.userId,
      target_user_id: targetUserId,
      total_memories: userStats.total_memories,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get user memory statistics', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve user memory statistics',
        type: 'internal_server_error',
        code: 'stats_error',
      },
    });
  }
}

/**
 * Get global memory statistics (read-only for all users)
 * GET /api/memory/stats/global
 */
export async function getGlobalMemoryStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/stats/global', 'GET', {
    userId: req.user?.userId,
  });

  try {
    // Authentication required
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
    const globalStats = await globalMemoryOps.getMemoryStats();

    const stats = {
      timestamp: new Date().toISOString(),
      ...globalStats,
    };

    const response = {
      success: true,
      data: stats,
      message: 'Global memory statistics retrieved successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Global memory statistics retrieved successfully', {
      user_id: req.user.userId,
      total_memories: globalStats.total_memories,
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
 * Get memory system performance metrics (admin only)
 * GET /api/memory/stats/performance
 */
export async function getMemoryPerformanceStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/memory/stats/performance', 'GET', {
    userId: req.user?.userId,
  });

  try {
    // Authentication required
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access performance statistics',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    // Require admin permissions for detailed performance metrics
    const isAdmin = req.user.role === 'admin' || req.user.permissions?.includes('view_performance_stats');
    if (!isAdmin) {
      res.status(403).json({
        error: {
          message: 'Admin role required to access performance statistics',
          type: 'authorization_error',
          code: 'forbidden',
        },
      });
      tracer.fail(new Error('Insufficient permissions'), 403);
      return;
    }

    apiLogger.info('Getting memory performance statistics', {
      user_id: req.user.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get performance statistics for all memory tables
    // TODO: Implement vector performance analysis in VectorOperationsService
    const userMemoryPerf = { avg_search_time_ms: 0, table_size: 0, index_usage: true };
    const globalMemoryPerf = { avg_search_time_ms: 0, table_size: 0, index_usage: true };
    const systemHealth = await vectorStorage.healthCheck();

    const stats = {
      timestamp: new Date().toISOString(),
      user_memories: userMemoryPerf,
      global_memories: globalMemoryPerf,
      system_health: systemHealth,
      overall: {
        avg_search_time_ms: Math.round(
          (userMemoryPerf.avg_search_time_ms + globalMemoryPerf.avg_search_time_ms) / 2
        ),
        total_table_size: userMemoryPerf.table_size + globalMemoryPerf.table_size,
        indexes_healthy: userMemoryPerf.index_usage && globalMemoryPerf.index_usage,
        system_healthy: systemHealth.healthy,
      },
    };

    const response = {
      success: true,
      data: stats,
      message: 'Memory performance statistics retrieved successfully',
    };

    tracer.complete(response);

    res.json(response);

    apiLogger.info('Memory performance statistics retrieved successfully', {
      user_id: req.user.userId,
      system_healthy: systemHealth.healthy,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get memory performance statistics', error instanceof Error ? error : new Error(String(error)));

    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve memory performance statistics',
        type: 'internal_server_error',
        code: 'performance_stats_error',
      },
    });
  }
}

/**
 * Health check for memory statistics API
 */
export async function memoryStatsHealthCheck(req: Request, res: Response): Promise<void> {
  try {
    const healthStatus = {
      healthy: true,
      timestamp: new Date().toISOString(),
      operations: {
        comprehensive_stats: 'available',
        user_stats: 'available',
        global_stats: 'available',
        performance_stats: 'available',
      },
    };

    res.json(healthStatus);

  } catch (error) {
    apiLogger.error('Memory statistics health check failed', error instanceof Error ? error : new Error(String(error)));

    res.status(503).json({
      healthy: false,
      timestamp: new Date().toISOString(),
      error: 'Service unavailable',
    });
  }
}