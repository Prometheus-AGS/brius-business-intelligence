import { Request, Response } from 'express';
import { z } from 'zod';
import { documentProcessingQueue, ProcessingJob } from '../../knowledge/processing-queue.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Document Processing Status and Queue Management API
 * Provides endpoints for monitoring async document processing jobs
 * Enables users to track processing status and manage their processing queue
 */

// Validation schemas
const GetJobsQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
  sortBy: z.enum(['created_at', 'priority', 'status']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

const JobActionSchema = z.object({
  action: z.enum(['cancel', 'retry', 'delete']),
  reason: z.string().max(255).optional(),
});

/**
 * Get processing queue status
 * GET /api/knowledge/processing/status
 */
export async function getProcessingStatus(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/processing/status', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Getting processing queue status', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get overall queue statistics
    const queueStats = documentProcessingQueue.getQueueStats();

    // Get user-specific job counts if authenticated
    let userStats;
    if (req.user?.userId) {
      const userJobs = documentProcessingQueue.getUserJobs(req.user.userId);
      userStats = {
        totalJobs: userJobs.length,
        pendingJobs: userJobs.filter(job => job.status === 'pending').length,
        processingJobs: userJobs.filter(job => job.status === 'processing').length,
        completedJobs: userJobs.filter(job => job.status === 'completed').length,
        failedJobs: userJobs.filter(job => job.status === 'failed').length,
      };
    }

    const response = {
      success: true,
      data: {
        queue_stats: queueStats,
        user_stats: userStats,
        system_status: {
          queue_active: true, // This would check if the queue is running
          max_concurrent_jobs: 3, // This would come from queue configuration
          current_load: queueStats.processingJobs,
        },
      },
      message: 'Processing queue status retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Processing queue status retrieved', {
      user_id: req.user?.userId,
      total_jobs: queueStats.totalJobs,
      pending_jobs: queueStats.pendingJobs,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get processing status', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve processing status',
        type: 'internal_server_error',
        code: 'processing_status_error',
      },
    });
  }
}

/**
 * Get user's processing jobs
 * GET /api/knowledge/processing/jobs
 */
export async function getUserJobs(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/processing/jobs', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    if (!req.user?.userId) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
          code: 'user_not_authenticated',
        },
      });
      tracer.fail(new Error('User not authenticated'), 401);
      return;
    }

    // Validate query parameters
    const validationResult = GetJobsQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid query parameters',
          type: 'validation_error',
          code: 'invalid_query_params',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { status, page, limit, sortBy, sortOrder } = validationResult.data;

    apiLogger.info('Getting user processing jobs', {
      user_id: req.user.userId,
      status,
      page,
      limit,
      trace_id: tracer.getTraceId(),
    });

    // Get user's jobs
    let userJobs = documentProcessingQueue.getUserJobs(req.user.userId);

    // Apply status filter
    if (status) {
      userJobs = userJobs.filter(job => job.status === status);
    }

    // Apply sorting
    userJobs.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'created_at':
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        case 'priority':
          const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        default:
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    const totalJobs = userJobs.length;
    const totalPages = Math.ceil(totalJobs / limit);
    const offset = (page - 1) * limit;
    const paginatedJobs = userJobs.slice(offset, offset + limit);

    const response = {
      success: true,
      data: {
        jobs: paginatedJobs.map(job => ({
          id: job.id,
          document_id: job.documentId,
          priority: job.priority,
          status: job.status,
          retry_count: job.retryCount,
          max_retries: job.maxRetries,
          created_at: job.createdAt.toISOString(),
          started_at: job.startedAt?.toISOString(),
          completed_at: job.completedAt?.toISOString(),
          progress: job.progress,
          last_error: job.lastError,
          // Don't expose full request data for security
          metadata: {
            user_id: job.metadata.userId,
            original_name: job.metadata.requestData?.file?.originalName,
            file_size: job.metadata.requestData?.file?.size,
            mime_type: job.metadata.requestData?.file?.mimeType,
          },
        })),
        pagination: {
          page,
          limit,
          total_items: totalJobs,
          total_pages: totalPages,
          has_next_page: page < totalPages,
          has_previous_page: page > 1,
        },
        filters: {
          status,
        },
        sorting: {
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      },
      message: `Retrieved ${paginatedJobs.length} processing jobs`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('User processing jobs retrieved', {
      user_id: req.user.userId,
      jobs_count: paginatedJobs.length,
      total_jobs: totalJobs,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get user jobs', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve processing jobs',
        type: 'internal_server_error',
        code: 'jobs_retrieval_error',
      },
    });
  }
}

/**
 * Get specific job status
 * GET /api/knowledge/processing/jobs/:jobId
 */
export async function getJobStatus(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/processing/jobs/${req.params.jobId}`, 'GET', {
    userId: req.user?.userId,
    jobId: req.params.jobId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const jobId = req.params.jobId;
    if (!jobId) {
      res.status(400).json({
        error: {
          message: 'Job ID is required',
          type: 'validation_error',
          code: 'missing_job_id',
        },
      });
      tracer.fail(new Error('Missing job ID'), 400);
      return;
    }

    apiLogger.info('Getting job status', {
      user_id: req.user?.userId,
      job_id: jobId,
      trace_id: tracer.getTraceId(),
    });

    const job = documentProcessingQueue.getJobStatus(jobId);
    if (!job) {
      res.status(404).json({
        error: {
          message: 'Job not found',
          type: 'not_found_error',
          code: 'job_not_found',
        },
      });
      tracer.fail(new Error('Job not found'), 404);
      return;
    }

    // Check user access
    if (req.user?.userId && job.metadata.userId !== req.user.userId) {
      res.status(403).json({
        error: {
          message: 'Access denied',
          type: 'authorization_error',
          code: 'job_access_denied',
        },
      });
      tracer.fail(new Error('Access denied'), 403);
      return;
    }

    const response = {
      success: true,
      data: {
        id: job.id,
        document_id: job.documentId,
        priority: job.priority,
        status: job.status,
        retry_count: job.retryCount,
        max_retries: job.maxRetries,
        created_at: job.createdAt.toISOString(),
        started_at: job.startedAt?.toISOString(),
        completed_at: job.completedAt?.toISOString(),
        progress: job.progress,
        last_error: job.lastError,
        processing_time_ms: job.startedAt && job.completedAt
          ? job.completedAt.getTime() - job.startedAt.getTime()
          : undefined,
        metadata: {
          user_id: job.metadata.userId,
          original_name: job.metadata.requestData?.file?.originalName,
          file_size: job.metadata.requestData?.file?.size,
          mime_type: job.metadata.requestData?.file?.mimeType,
        },
      },
      message: 'Job status retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Job status retrieved', {
      user_id: req.user?.userId,
      job_id: jobId,
      job_status: job.status,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get job status', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve job status',
        type: 'internal_server_error',
        code: 'job_status_error',
      },
    });
  }
}

/**
 * Perform action on job (cancel, retry, delete)
 * POST /api/knowledge/processing/jobs/:jobId/actions
 */
export async function performJobAction(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/processing/jobs/${req.params.jobId}/actions`, 'POST', {
    userId: req.user?.userId,
    jobId: req.params.jobId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    if (!req.user?.userId) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
          code: 'user_not_authenticated',
        },
      });
      tracer.fail(new Error('User not authenticated'), 401);
      return;
    }

    const jobId = req.params.jobId;
    if (!jobId) {
      res.status(400).json({
        error: {
          message: 'Job ID is required',
          type: 'validation_error',
          code: 'missing_job_id',
        },
      });
      tracer.fail(new Error('Missing job ID'), 400);
      return;
    }

    // Validate request body
    const validationResult = JobActionSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid job action request',
          type: 'validation_error',
          code: 'invalid_action_data',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { action, reason } = validationResult.data;

    apiLogger.info('Performing job action', {
      user_id: req.user.userId,
      job_id: jobId,
      action,
      reason,
      trace_id: tracer.getTraceId(),
    });

    // Get job and check access
    const job = documentProcessingQueue.getJobStatus(jobId);
    if (!job) {
      res.status(404).json({
        error: {
          message: 'Job not found',
          type: 'not_found_error',
          code: 'job_not_found',
        },
      });
      tracer.fail(new Error('Job not found'), 404);
      return;
    }

    if (job.metadata.userId !== req.user.userId) {
      res.status(403).json({
        error: {
          message: 'Access denied',
          type: 'authorization_error',
          code: 'job_access_denied',
        },
      });
      tracer.fail(new Error('Access denied'), 403);
      return;
    }

    let result: any;

    switch (action) {
      case 'cancel':
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          res.status(400).json({
            error: {
              message: `Cannot cancel job with status: ${job.status}`,
              type: 'invalid_operation',
              code: 'job_not_cancellable',
            },
          });
          tracer.fail(new Error('Job not cancellable'), 400);
          return;
        }

        result = await documentProcessingQueue.cancelJob(jobId);
        if (!result) {
          res.status(400).json({
            error: {
              message: 'Failed to cancel job',
              type: 'operation_failed',
              code: 'job_cancel_failed',
            },
          });
          tracer.fail(new Error('Job cancel failed'), 400);
          return;
        }
        break;

      case 'retry':
        if (job.status !== 'failed') {
          res.status(400).json({
            error: {
              message: `Cannot retry job with status: ${job.status}`,
              type: 'invalid_operation',
              code: 'job_not_retryable',
            },
          });
          tracer.fail(new Error('Job not retryable'), 400);
          return;
        }

        // Reset job for retry (this would need to be implemented in the queue)
        // For now, return not implemented
        res.status(501).json({
          error: {
            message: 'Job retry not implemented yet',
            type: 'not_implemented',
            code: 'retry_not_implemented',
          },
        });
        tracer.fail(new Error('Retry not implemented'), 501);
        return;

      case 'delete':
        if (job.status === 'processing') {
          res.status(400).json({
            error: {
              message: 'Cannot delete job that is currently processing',
              type: 'invalid_operation',
              code: 'job_not_deletable',
            },
          });
          tracer.fail(new Error('Job not deletable'), 400);
          return;
        }

        // Delete job (this would need to be implemented in the queue)
        res.status(501).json({
          error: {
            message: 'Job deletion not implemented yet',
            type: 'not_implemented',
            code: 'delete_not_implemented',
          },
        });
        tracer.fail(new Error('Delete not implemented'), 501);
        return;

      default:
        res.status(400).json({
          error: {
            message: `Unknown action: ${action}`,
            type: 'invalid_operation',
            code: 'unknown_action',
          },
        });
        tracer.fail(new Error('Unknown action'), 400);
        return;
    }

    const response = {
      success: true,
      data: {
        job_id: jobId,
        action,
        result,
        performed_at: new Date().toISOString(),
        reason,
      },
      message: `Job ${action} completed successfully`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Job action completed', {
      user_id: req.user.userId,
      job_id: jobId,
      action,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to perform job action', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to perform job action',
        type: 'internal_server_error',
        code: 'job_action_error',
      },
    });
  }
}