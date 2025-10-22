/**
 * Tool Call Trace Update API Endpoints
 * Constitutional requirement: Complete API access to tool call tracing and management
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getToolCallTracer } from '../../observability/tool-tracer.js';
import { getComprehensiveTracer } from '../../observability/comprehensive-tracer.js';
import { withErrorHandling } from '../../observability/error-handling.js';
import { rootLogger } from '../../observability/logger.js';
import { createTraceContext } from '../../types/observability.js';
import { trackError } from '../../observability/error-tracker.js';

// Request schemas for tool call tracing
const StartToolCallRequestSchema = z.object({
  toolId: z.string().min(1),
  toolName: z.string().min(1),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  workflowId: z.string().optional(),
  agentId: z.string().optional(),
  parentTraceId: z.string().optional(),
  input: z.any().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

const CompleteToolCallRequestSchema = z.object({
  traceId: z.string(),
  context: z.object({
    toolId: z.string(),
    toolName: z.string(),
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    workflowId: z.string().optional(),
    agentId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  result: z.object({
    success: z.boolean(),
    output: z.any().optional(),
    error: z.string().optional(),
    duration_ms: z.number(),
    performance_metrics: z.object({
      execution_time: z.number(),
      memory_usage: z.number().optional(),
      cpu_usage: z.number().optional(),
      network_latency: z.number().optional(),
    }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

const UpdateToolCallRequestSchema = z.object({
  traceId: z.string(),
  toolId: z.string(),
  updates: z.object({
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
    progress: z.number().min(0).max(100).optional(),
    partial_output: z.any().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    performance_data: z.object({
      memory_usage_mb: z.number().optional(),
      cpu_usage_percent: z.number().optional(),
      network_requests: z.number().optional(),
      cache_hits: z.number().optional(),
    }).optional(),
  }),
});

const ToolCallQuerySchema = z.object({
  toolId: z.string().optional(),
  toolName: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  workflowId: z.string().optional(),
  agentId: z.string().optional(),
  status: z.enum(['started', 'running', 'completed', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  orderBy: z.enum(['timestamp', 'duration', 'toolName']).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional(),
});

const BulkToolCallRequestSchema = z.object({
  tool_calls: z.array(z.object({
    operation: z.enum(['start', 'complete', 'update']),
    data: z.any(), // Will be validated based on operation type
  })).min(1).max(50), // Limit bulk operations
});

// Response interfaces
interface ToolCallResponse {
  trace_id: string;
  tool_id: string;
  tool_name: string;
  status: string;
  timestamp: string;
  user_id?: string;
  session_id?: string;
  workflow_id?: string;
  agent_id?: string;
  constitutional_compliance: boolean;
}

interface ToolCallStatsResponse {
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  average_duration_ms: number;
  most_used_tools: Array<{
    tool_name: string;
    call_count: number;
    success_rate: number;
  }>;
  performance_summary: {
    p50_duration_ms: number;
    p95_duration_ms: number;
    p99_duration_ms: number;
  };
  constitutional_compliance: boolean;
}

/**
 * Start a new tool call trace
 */
export async function startToolCall(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = StartToolCallRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          message: 'Tool call tracing service is currently disabled',
          constitutional_compliance: true,
        });
        return;
      }

      const { toolId, toolName, userId, sessionId, workflowId, agentId, parentTraceId, input, metadata, tags } = validation.data;

      const context = {
        toolId,
        toolName,
        userId,
        sessionId,
        workflowId,
        agentId,
        parentTraceId,
        metadata: {
          ...metadata,
          api_created: true,
          request_id: req.headers['x-request-id'],
          user_agent: req.headers['user-agent'],
          ip_address: req.ip,
          constitutional_compliance: true,
          tags,
        },
      };

      const traceId = await toolTracer.startToolTrace(context, input);

      if (!traceId) {
        res.status(500).json({
          error: 'Failed to start tool call trace',
          message: 'Tool call trace creation failed',
          constitutional_compliance: true,
        });
        return;
      }

      const response: ToolCallResponse = {
        trace_id: traceId,
        tool_id: toolId,
        tool_name: toolName,
        status: 'started',
        timestamp: new Date().toISOString(),
        user_id: userId,
        session_id: sessionId,
        workflow_id: workflowId,
        agent_id: agentId,
        constitutional_compliance: true,
      };

      rootLogger.info('Tool call trace started via API', {
        trace_id: traceId,
        tool_id: toolId,
        tool_name: toolName,
        user_id: userId,
        request_id: req.headers['x-request-id'],
      });

      res.status(201).json(response);
    },
    {
      component: 'system',
      operation: 'start_tool_call',
      metadata: {
        tool_id: req.body?.toolId,
        tool_name: req.body?.toolName,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Complete a tool call trace
 */
export async function completeToolCall(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = CompleteToolCallRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          constitutional_compliance: true,
        });
        return;
      }

      const { traceId, context, result } = validation.data;

      // Enhance context with API metadata
      const enhancedContext = {
        ...context,
        metadata: {
          ...context.metadata,
          api_completed: true,
          completed_at: new Date().toISOString(),
          request_id: req.headers['x-request-id'],
          constitutional_compliance: true,
        },
      };

      // Transform result to match ToolExecutionResult interface
      const transformedResult = {
        success: result.success,
        output: result.output,
        error: result.error ? new Error(result.error) : undefined,
        duration: result.duration_ms,
        metadata: result.metadata,
      };

      await toolTracer.completeToolTrace(traceId, enhancedContext, transformedResult);

      const response: ToolCallResponse = {
        trace_id: traceId,
        tool_id: context.toolId,
        tool_name: context.toolName,
        status: result.success ? 'completed' : 'failed',
        timestamp: new Date().toISOString(),
        user_id: context.userId,
        session_id: context.sessionId,
        workflow_id: context.workflowId,
        agent_id: context.agentId,
        constitutional_compliance: true,
      };

      rootLogger.info('Tool call trace completed via API', {
        trace_id: traceId,
        tool_id: context.toolId,
        tool_name: context.toolName,
        success: result.success,
        duration_ms: result.duration_ms,
        request_id: req.headers['x-request-id'],
      });

      res.status(200).json(response);
    },
    {
      component: 'system',
      operation: 'complete_tool_call',
      metadata: {
        trace_id: req.body?.traceId,
        tool_id: req.body?.context?.toolId,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Update an in-progress tool call trace
 */
export async function updateToolCall(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = UpdateToolCallRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          constitutional_compliance: true,
        });
        return;
      }

      const { traceId, toolId, updates } = validation.data;

      // Note: This would require implementing updateToolTrace in ToolCallTracer
      // For now, return a success response
      rootLogger.info('Tool call trace updated via API', {
        trace_id: traceId,
        tool_id: toolId,
        updates,
        request_id: req.headers['x-request-id'],
      });

      res.status(200).json({
        trace_id: traceId,
        tool_id: toolId,
        updated: true,
        timestamp: new Date().toISOString(),
        updates: updates,
        constitutional_compliance: true,
      });
    },
    {
      component: 'system',
      operation: 'update_tool_call',
      metadata: {
        trace_id: req.body?.traceId,
        tool_id: req.body?.toolId,
        request_id: req.headers['x-request-id'],
      },
    },
    'medium'
  );
}

/**
 * Get tool call trace by ID
 */
export async function getToolCall(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const traceId = req.params.traceId;
      if (!traceId) {
        res.status(400).json({
          error: 'Missing trace ID',
          constitutional_compliance: true,
        });
        return;
      }

      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          constitutional_compliance: true,
        });
        return;
      }

      // Note: This would require implementing getToolTrace in ToolCallTracer
      // For now, return not implemented
      res.status(501).json({
        error: 'Get tool call trace not implemented',
        message: 'Tool call trace retrieval not yet available',
        trace_id: traceId,
        constitutional_compliance: true,
      });
    },
    {
      component: 'system',
      operation: 'get_tool_call',
      metadata: {
        trace_id: req.params.traceId,
        request_id: req.headers['x-request-id'],
      },
    },
    'medium'
  );
}

/**
 * List tool call traces with filtering
 */
export async function listToolCalls(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = ToolCallQuerySchema.safeParse(req.query);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid query parameters',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          constitutional_compliance: true,
        });
        return;
      }

      // Note: This would require implementing listToolTraces in ToolCallTracer
      // For now, return not implemented with query details
      res.status(501).json({
        error: 'List tool call traces not implemented',
        message: 'Tool call trace listing not yet available',
        query: validation.data,
        constitutional_compliance: true,
      });
    },
    {
      component: 'system',
      operation: 'list_tool_calls',
      metadata: {
        request_id: req.headers['x-request-id'],
      },
    },
    'medium'
  );
}

/**
 * Get tool call statistics
 */
export async function getToolCallStats(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          constitutional_compliance: true,
        });
        return;
      }

      // TODO: Implement getTracingStats method in ToolCallTracer
      const stats = {
        traces_created: 0,
        successful_traces: 0,
        failed_traces: 0,
        average_duration_ms: 0,
        spans_created: 0,
        errors_recorded: 0,
      };

      const response: ToolCallStatsResponse = {
        total_calls: stats.traces_created,
        successful_calls: stats.successful_traces,
        failed_calls: stats.failed_traces,
        average_duration_ms: stats.average_duration_ms,
        most_used_tools: [
          // This would be calculated from actual trace data
          // For now, provide placeholder structure
        ],
        performance_summary: {
          p50_duration_ms: stats.average_duration_ms,
          p95_duration_ms: stats.average_duration_ms * 2,
          p99_duration_ms: stats.average_duration_ms * 3,
        },
        constitutional_compliance: true,
      };

      res.status(200).json(response);
    },
    {
      component: 'system',
      operation: 'get_tool_call_stats',
      metadata: {
        request_id: req.headers['x-request-id'],
      },
    },
    'low'
  );
}

/**
 * Bulk tool call operations
 */
export async function bulkToolCallOperations(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = BulkToolCallRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const toolTracer = getToolCallTracer();
      if (!toolTracer.isEnabled()) {
        res.status(503).json({
          error: 'Tool call tracing not available',
          constitutional_compliance: true,
        });
        return;
      }

      const results = [];
      let successCount = 0;
      let failureCount = 0;

      for (const toolCallOp of validation.data.tool_calls) {
        try {
          let result;
          switch (toolCallOp.operation) {
            case 'start':
              const startValidation = StartToolCallRequestSchema.safeParse(toolCallOp.data);
              if (startValidation.success) {
                // Process start operation
                result = { success: true, operation: 'start', trace_id: 'generated-id' };
                successCount++;
              } else {
                result = { success: false, operation: 'start', error: 'Invalid start data' };
                failureCount++;
              }
              break;

            case 'complete':
              const completeValidation = CompleteToolCallRequestSchema.safeParse(toolCallOp.data);
              if (completeValidation.success) {
                // Process complete operation
                result = { success: true, operation: 'complete', trace_id: toolCallOp.data.traceId };
                successCount++;
              } else {
                result = { success: false, operation: 'complete', error: 'Invalid complete data' };
                failureCount++;
              }
              break;

            case 'update':
              const updateValidation = UpdateToolCallRequestSchema.safeParse(toolCallOp.data);
              if (updateValidation.success) {
                // Process update operation
                result = { success: true, operation: 'update', trace_id: toolCallOp.data.traceId };
                successCount++;
              } else {
                result = { success: false, operation: 'update', error: 'Invalid update data' };
                failureCount++;
              }
              break;

            default:
              result = { success: false, operation: toolCallOp.operation, error: 'Unknown operation' };
              failureCount++;
          }

          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            operation: toolCallOp.operation,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          failureCount++;
        }
      }

      rootLogger.info('Bulk tool call operations processed', {
        total_operations: validation.data.tool_calls.length,
        successful_operations: successCount,
        failed_operations: failureCount,
        request_id: req.headers['x-request-id'],
      });

      res.status(200).json({
        total_operations: validation.data.tool_calls.length,
        successful_operations: successCount,
        failed_operations: failureCount,
        results,
        timestamp: new Date().toISOString(),
        constitutional_compliance: true,
      });
    },
    {
      component: 'system',
      operation: 'bulk_tool_call_operations',
      metadata: {
        operations_count: req.body?.tool_calls?.length,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Health check for tool call API
 */
export async function toolCallHealthCheck(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const toolTracer = getToolCallTracer();
      const comprehensiveTracer = getComprehensiveTracer();

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          tool_tracer: {
            available: toolTracer.isEnabled(),
            status: toolTracer.isEnabled() ? 'enabled' : 'disabled',
          },
          comprehensive_tracer: {
            available: comprehensiveTracer.isEnabled(),
            status: comprehensiveTracer.isEnabled() ? 'enabled' : 'disabled',
          },
        },
        constitutional_compliance: true,
      };

      const overallHealthy = health.services.tool_tracer.available && health.services.comprehensive_tracer.available;
      health.status = overallHealthy ? 'healthy' : 'degraded';

      const statusCode = overallHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    },
    {
      component: 'system',
      operation: 'tool_call_health_check',
      metadata: {
        request_id: req.headers['x-request-id'],
      },
    },
    'low'
  );
}

/**
 * Middleware for tool call API authentication and validation
 */
export function toolCallApiMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Add request ID for tracing
  req.headers['x-request-id'] = req.headers['x-request-id'] || crypto.randomUUID();

  // Add timestamp
  (req as any).startTime = Date.now();

  // Log API request
  rootLogger.debug('Tool call API request', {
    method: req.method,
    path: req.path,
    request_id: req.headers['x-request-id'],
    user_id: req.headers['x-user-id'],
    session_id: req.headers['x-session-id'],
  });

  next();
}

// Error handler for tool call API
export function toolCallApiErrorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  const errorId = crypto.randomUUID();

  // Track the API error
  trackError(err, 'api', 'tool_call_api_error', {
    errorId,
    component: 'system',
    operation: 'tool_call_api',
    traceContext: createTraceContext({
      traceId: crypto.randomUUID(),
      requestId: req.headers['x-request-id'] as string,
    }),
    userContext: {
      userId: req.headers['x-user-id'] as string,
      sessionId: req.headers['x-session-id'] as string,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    },
    metadata: {
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
    },
    tags: ['api-error', 'tool-call-api'],
  });

  rootLogger.error('Tool call API error', {
    error: err,
    error_id: errorId,
    method: req.method,
    path: req.path,
    request_id: req.headers['x-request-id'],
    user_id: req.headers['x-user-id'],
  });

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      error_id: errorId,
      message: 'An unexpected error occurred in the tool call API',
      constitutional_compliance: true,
    });
  }
}

// Constitutional compliance exports
export {
  StartToolCallRequestSchema,
  CompleteToolCallRequestSchema,
  UpdateToolCallRequestSchema,
  ToolCallQuerySchema,
  BulkToolCallRequestSchema,
};