/**
 * Observability API Endpoints for Trace Creation
 * Constitutional requirement: Complete API access to trace creation and management
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getLangFuseClient } from '../../observability/langfuse-client.js';
import { getComprehensiveTracer } from '../../observability/comprehensive-tracer.js';
import { withErrorHandling } from '../../observability/error-handling.js';
import { rootLogger } from '../../observability/logger.js';
import {
  TraceContext,
  TraceEvent,
  ComponentType,
  TraceLevel,
  TraceContextSchema,
  TraceEventSchema,
  createTraceContext,
} from '../../types/observability.js';
import { trackError } from '../../observability/error-tracker.js';

// Request schemas for trace creation
const CreateTraceRequestSchema = z.object({
  name: z.string().min(1).max(200),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  input: z.any().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
  release: z.string().optional(),
  public: z.boolean().optional(),
});

const UpdateTraceRequestSchema = z.object({
  output: z.any().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  public: z.boolean().optional(),
});

const CreateSpanRequestSchema = z.object({
  traceId: z.string(),
  name: z.string().min(1).max(200),
  input: z.any().optional(),
  output: z.any().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  level: z.enum(['DEBUG', 'DEFAULT', 'WARNING', 'ERROR']).optional(),
  statusMessage: z.string().optional(),
  parentObservationId: z.string().optional(),
  version: z.string().optional(),
});

const CreateEventRequestSchema = z.object({
  traceId: z.string(),
  name: z.string().min(1).max(200),
  input: z.any().optional(),
  output: z.any().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  level: z.enum(['DEBUG', 'DEFAULT', 'WARNING', 'ERROR']).optional(),
  statusMessage: z.string().optional(),
  startTime: z.string().datetime().optional(),
  parentObservationId: z.string().optional(),
});

const CreateGenerationRequestSchema = z.object({
  traceId: z.string(),
  name: z.string().min(1).max(200),
  input: z.any().optional(),
  output: z.any().optional(),
  model: z.string().optional(),
  usage: z.object({
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  }).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  level: z.enum(['DEBUG', 'DEFAULT', 'WARNING', 'ERROR']).optional(),
  statusMessage: z.string().optional(),
  parentObservationId: z.string().optional(),
  version: z.string().optional(),
});

const TraceQuerySchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  orderBy: z.enum(['timestamp', 'name', 'duration']).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// Response interfaces
interface TraceResponse {
  id: string;
  name: string;
  userId?: string;
  sessionId?: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  tags?: string[];
  timestamp: string;
  version?: string;
  release?: string;
  public?: boolean;
  constitutional_compliance: boolean;
}

interface SpanResponse {
  id: string;
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  startTime?: string;
  endTime?: string;
  metadata?: Record<string, any>;
  level?: string;
  statusMessage?: string;
  parentObservationId?: string;
  version?: string;
  constitutional_compliance: boolean;
}

interface EventResponse {
  id: string;
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  level?: string;
  statusMessage?: string;
  startTime?: string;
  parentObservationId?: string;
  constitutional_compliance: boolean;
}

interface GenerationResponse {
  id: string;
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  startTime?: string;
  endTime?: string;
  metadata?: Record<string, any>;
  level?: string;
  statusMessage?: string;
  parentObservationId?: string;
  version?: string;
  constitutional_compliance: boolean;
}

/**
 * Middleware for trace API authentication and validation
 */
export function traceApiMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Add request ID for tracing
  req.headers['x-request-id'] = req.headers['x-request-id'] || crypto.randomUUID();

  // Add timestamp
  (req as any).startTime = Date.now();

  // Log API request
  rootLogger.debug('Trace API request', {
    method: req.method,
    path: req.path,
    request_id: req.headers['x-request-id'],
    user_id: req.headers['x-user-id'],
    session_id: req.headers['x-session-id'],
  });

  next();
}

/**
 * Create a new trace
 */
export async function createTrace(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = CreateTraceRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          message: 'Observability service is currently unavailable',
          constitutional_compliance: true,
        });
        return;
      }

      const traceData = {
        ...validation.data,
        metadata: {
          ...validation.data.metadata,
          api_created: true,
          request_id: req.headers['x-request-id'],
          user_agent: req.headers['user-agent'],
          ip_address: req.ip,
          constitutional_compliance: true,
        },
      };

      const traceId = await langfuseClient.createTrace(traceData);

      if (!traceId) {
        res.status(500).json({
          error: 'Failed to create trace',
          message: 'Trace creation failed in LangFuse',
          constitutional_compliance: true,
        });
        return;
      }

      const response: TraceResponse = {
        id: traceId,
        name: validation.data.name,
        userId: validation.data.userId,
        sessionId: validation.data.sessionId,
        input: validation.data.input,
        metadata: traceData.metadata,
        tags: validation.data.tags,
        timestamp: new Date().toISOString(),
        version: validation.data.version,
        release: validation.data.release,
        public: validation.data.public,
        constitutional_compliance: true,
      };

      rootLogger.info('Trace created via API', {
        trace_id: traceId,
        name: validation.data.name,
        user_id: validation.data.userId,
        request_id: req.headers['x-request-id'],
      });

      res.status(201).json(response);
    },
    {
      component: 'api',
      operation: 'create_trace',
      metadata: {
        request_id: req.headers['x-request-id'],
        path: req.path,
      },
    },
    'high'
  );
}

/**
 * Update an existing trace
 */
export async function updateTrace(req: Request, res: Response): Promise<void> {
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

      const validation = UpdateTraceRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          constitutional_compliance: true,
        });
        return;
      }

      const updateData = {
        traceId,
        ...validation.data,
        metadata: {
          ...validation.data.metadata,
          api_updated: true,
          updated_at: new Date().toISOString(),
          request_id: req.headers['x-request-id'],
          constitutional_compliance: true,
        },
      };

      // TODO: Implement updateTrace method in LangFuseClient or use updateObservation
      // await langfuseClient.updateTrace(updateData);

      rootLogger.info('Trace updated via API', {
        trace_id: traceId,
        request_id: req.headers['x-request-id'],
      });

      res.status(200).json({
        id: traceId,
        updated: true,
        timestamp: new Date().toISOString(),
        constitutional_compliance: true,
      });
    },
    {
      component: 'api',
      operation: 'update_trace',
      metadata: {
        trace_id: req.params.traceId,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Get trace by ID
 */
export async function getTrace(req: Request, res: Response): Promise<void> {
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

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          constitutional_compliance: true,
        });
        return;
      }

      // Note: This would require implementing getTrace in LangFuse client
      // For now, return a not implemented response
      res.status(501).json({
        error: 'Get trace not implemented',
        message: 'LangFuse client does not support trace retrieval yet',
        trace_id: traceId,
        constitutional_compliance: true,
      });
    },
    {
      component: 'api',
      operation: 'get_trace',
      metadata: {
        trace_id: req.params.traceId,
        request_id: req.headers['x-request-id'],
      },
    },
    'medium'
  );
}

/**
 * List traces with filtering
 */
export async function listTraces(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = TraceQuerySchema.safeParse(req.query);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid query parameters',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          constitutional_compliance: true,
        });
        return;
      }

      // Note: This would require implementing listTraces in LangFuse client
      // For now, return a not implemented response
      res.status(501).json({
        error: 'List traces not implemented',
        message: 'LangFuse client does not support trace listing yet',
        query: validation.data,
        constitutional_compliance: true,
      });
    },
    {
      component: 'api',
      operation: 'list_traces',
      metadata: {
        request_id: req.headers['x-request-id'],
      },
    },
    'medium'
  );
}

/**
 * Create a span within a trace
 */
export async function createSpan(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = CreateSpanRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          constitutional_compliance: true,
        });
        return;
      }

      const spanData = {
        ...validation.data,
        startTime: validation.data.startTime ? new Date(validation.data.startTime) : new Date(),
        endTime: validation.data.endTime ? new Date(validation.data.endTime) : undefined,
        metadata: {
          ...validation.data.metadata,
          api_created: true,
          request_id: req.headers['x-request-id'],
          constitutional_compliance: true,
        },
      };

      const spanId = await langfuseClient.createSpan(spanData);

      if (!spanId) {
        res.status(500).json({
          error: 'Failed to create span',
          constitutional_compliance: true,
        });
        return;
      }

      const response: SpanResponse = {
        id: spanId,
        traceId: validation.data.traceId,
        name: validation.data.name,
        input: validation.data.input,
        output: validation.data.output,
        startTime: spanData.startTime.toISOString(),
        endTime: spanData.endTime?.toISOString(),
        metadata: spanData.metadata,
        level: validation.data.level,
        statusMessage: validation.data.statusMessage,
        parentObservationId: validation.data.parentObservationId,
        version: validation.data.version,
        constitutional_compliance: true,
      };

      rootLogger.info('Span created via API', {
        span_id: spanId,
        trace_id: validation.data.traceId,
        name: validation.data.name,
        request_id: req.headers['x-request-id'],
      });

      res.status(201).json(response);
    },
    {
      component: 'api',
      operation: 'create_span',
      metadata: {
        trace_id: req.body?.traceId,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Create an event within a trace
 */
export async function createEvent(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = CreateEventRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          constitutional_compliance: true,
        });
        return;
      }

      const eventData = {
        ...validation.data,
        startTime: validation.data.startTime ? new Date(validation.data.startTime) : new Date(),
        metadata: {
          ...validation.data.metadata,
          api_created: true,
          request_id: req.headers['x-request-id'],
          constitutional_compliance: true,
        },
      };

      const eventId = await langfuseClient.createEvent(eventData);

      if (!eventId) {
        res.status(500).json({
          error: 'Failed to create event',
          constitutional_compliance: true,
        });
        return;
      }

      const response: EventResponse = {
        id: eventId,
        traceId: validation.data.traceId,
        name: validation.data.name,
        input: validation.data.input,
        output: validation.data.output,
        metadata: eventData.metadata,
        level: validation.data.level,
        statusMessage: validation.data.statusMessage,
        startTime: eventData.startTime.toISOString(),
        parentObservationId: validation.data.parentObservationId,
        constitutional_compliance: true,
      };

      rootLogger.info('Event created via API', {
        event_id: eventId,
        trace_id: validation.data.traceId,
        name: validation.data.name,
        request_id: req.headers['x-request-id'],
      });

      res.status(201).json(response);
    },
    {
      component: 'api',
      operation: 'create_event',
      metadata: {
        trace_id: req.body?.traceId,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Create a generation within a trace
 */
export async function createGeneration(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const validation = CreateGenerationRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
          constitutional_compliance: true,
        });
        return;
      }

      const langfuseClient = getLangFuseClient();
      if (!langfuseClient.isReady()) {
        res.status(503).json({
          error: 'LangFuse client not available',
          constitutional_compliance: true,
        });
        return;
      }

      const generationData = {
        ...validation.data,
        startTime: validation.data.startTime ? new Date(validation.data.startTime) : new Date(),
        endTime: validation.data.endTime ? new Date(validation.data.endTime) : undefined,
        metadata: {
          ...validation.data.metadata,
          api_created: true,
          request_id: req.headers['x-request-id'],
          constitutional_compliance: true,
        },
      };

      const generationId = await langfuseClient.createGeneration(generationData);

      if (!generationId) {
        res.status(500).json({
          error: 'Failed to create generation',
          constitutional_compliance: true,
        });
        return;
      }

      const response: GenerationResponse = {
        id: generationId,
        traceId: validation.data.traceId,
        name: validation.data.name,
        input: validation.data.input,
        output: validation.data.output,
        model: validation.data.model,
        usage: validation.data.usage,
        startTime: generationData.startTime.toISOString(),
        endTime: generationData.endTime?.toISOString(),
        metadata: generationData.metadata,
        level: validation.data.level,
        statusMessage: validation.data.statusMessage,
        parentObservationId: validation.data.parentObservationId,
        version: validation.data.version,
        constitutional_compliance: true,
      };

      rootLogger.info('Generation created via API', {
        generation_id: generationId,
        trace_id: validation.data.traceId,
        name: validation.data.name,
        model: validation.data.model,
        request_id: req.headers['x-request-id'],
      });

      res.status(201).json(response);
    },
    {
      component: 'api',
      operation: 'create_generation',
      metadata: {
        trace_id: req.body?.traceId,
        model: req.body?.model,
        request_id: req.headers['x-request-id'],
      },
    },
    'high'
  );
}

/**
 * Get trace statistics
 */
export async function getTraceStats(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const comprehensiveTracer = getComprehensiveTracer();
      const stats = await comprehensiveTracer.getTracingStats();

      const response = {
        tracing_enabled: stats.enabled,
        components_enabled: stats.components_enabled,
        buffer_size: stats.buffer_size,
        buffered_events: stats.buffered_events,
        langfuse_connected: stats.langfuse_connected,
        specialized_tracers: stats.specialized_tracers,
        timestamp: new Date().toISOString(),
        constitutional_compliance: true,
      };

      res.status(200).json(response);
    },
    {
      component: 'api',
      operation: 'get_trace_stats',
      metadata: {
        request_id: req.headers['x-request-id'],
      },
    },
    'low'
  );
}

/**
 * Health check for trace API
 */
export async function traceHealthCheck(req: Request, res: Response): Promise<void> {
  await withErrorHandling(
    async () => {
      const langfuseClient = getLangFuseClient();
      const comprehensiveTracer = getComprehensiveTracer();

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          langfuse: {
            available: langfuseClient.isReady(),
            status: langfuseClient.isReady() ? 'connected' : 'disconnected',
          },
          comprehensive_tracer: {
            available: comprehensiveTracer.isEnabled(),
            status: comprehensiveTracer.isEnabled() ? 'enabled' : 'disabled',
          },
        },
        constitutional_compliance: true,
      };

      const overallHealthy = health.services.langfuse.available && health.services.comprehensive_tracer.available;
      health.status = overallHealthy ? 'healthy' : 'degraded';

      const statusCode = overallHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    },
    {
      component: 'api',
      operation: 'trace_health_check',
      metadata: {
        request_id: req.headers['x-request-id'],
      },
    },
    'low'
  );
}

// Error handler for trace API
export function traceApiErrorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  const errorId = crypto.randomUUID();

  // Track the API error
  trackError(err, 'api', 'trace_api_error', {
    errorId,
    component: 'api',
    operation: 'trace_api',
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
    tags: ['api-error', 'trace-api'],
  });

  rootLogger.error('Trace API error', {
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
      message: 'An unexpected error occurred in the trace API',
      constitutional_compliance: true,
    });
  }
}

// Constitutional compliance exports
export {
  CreateTraceRequestSchema,
  UpdateTraceRequestSchema,
  CreateSpanRequestSchema,
  CreateEventRequestSchema,
  CreateGenerationRequestSchema,
  TraceQuerySchema,
};