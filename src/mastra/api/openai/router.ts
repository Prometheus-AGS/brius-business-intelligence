import express, { Request, Response, NextFunction } from 'express';
import { handleChatCompletions, healthCheck as chatHealthCheck } from './chat.js';
import {
  handleListModels,
  handleGetModel,
  handleModelCapabilities,
  modelsHealthCheck
} from './models.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * OpenAI-Compatible API Router
 * Provides OpenAI-compatible endpoints for the business intelligence system
 */

export const openAIRouter = express.Router();

// Request logging middleware
openAIRouter.use((req: Request, res: Response, next: NextFunction) => {
  const tracer = new APITracer(req.path, req.method, {
    userId: req.headers.authorization ? 'authenticated-user' : 'anonymous',
    requestId: req.get('x-request-id') || `req-${Date.now()}`,
    headers: req.headers as Record<string, string>,
    query: req.query as Record<string, any>,
    body: req.body,
  });

  // Store tracer in request for access in handlers
  (req as any).tracer = tracer;

  // Override response methods to capture responses
  const originalSend = res.send;
  const originalJson = res.json;

  res.send = function(body: any) {
    tracer.complete(body, res.statusCode);
    return originalSend.call(this, body);
  };

  res.json = function(body: any) {
    tracer.complete(body, res.statusCode);
    return originalJson.call(this, body);
  };

  next();
});

// Error handling middleware for tracing
openAIRouter.use((error: any, req: Request, res: Response, next: NextFunction) => {
  const tracer = (req as any).tracer;
  if (tracer) {
    tracer.fail(error, res.statusCode || 500);
  }

  apiLogger.error('OpenAI API error', error);
  next(error);
});

/**
 * Chat Completions API
 * POST /v1/chat/completions
 */
openAIRouter.post('/v1/chat/completions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    apiLogger.info('Chat completion request received', {
      model: req.body?.model,
      stream: req.body?.stream,
      message_count: req.body?.messages?.length,
    });

    await handleChatCompletions(req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * Models API
 * GET /v1/models - List all available models
 */
openAIRouter.get('/v1/models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    apiLogger.info('Models list requested');
    await handleListModels(req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /v1/models/:model - Get specific model information
 */
openAIRouter.get('/v1/models/:model', async (req: Request, res: Response, next: NextFunction) => {
  try {
    apiLogger.info('Model details requested', { model: req.params.model });
    await handleGetModel(req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /v1/models/:model/capabilities - Get model capabilities
 */
openAIRouter.get('/v1/models/:model/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    apiLogger.info('Model capabilities requested', { model: req.params.model });
    await handleModelCapabilities(req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * Health Check Endpoints
 * GET /health - Overall API health
 */
openAIRouter.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chatHealth = await chatHealthCheck();
    const modelsHealth = await modelsHealthCheck();

    const overall = {
      healthy: chatHealth.healthy && modelsHealth.healthy,
      timestamp: new Date().toISOString(),
      services: {
        chat_completions: chatHealth,
        models: modelsHealth,
      },
      version: '1.0.0',
    };

    const statusCode = overall.healthy ? 200 : 503;
    res.status(statusCode).json(overall);

    apiLogger.info('Health check completed', {
      healthy: overall.healthy,
      chat_healthy: chatHealth.healthy,
      models_healthy: modelsHealth.healthy,
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /health/chat - Chat completions health
 */
openAIRouter.get('/health/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await chatHealthCheck();
    const statusCode = health.healthy ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /health/models - Models API health
 */
openAIRouter.get('/health/models', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await modelsHealthCheck();
    const statusCode = health.healthy ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    next(error);
  }
});

/**
 * Documentation endpoint
 * GET /docs - API documentation
 */
openAIRouter.get('/docs', (req: Request, res: Response) => {
  const documentation = {
    title: 'Brius Business Intelligence API',
    description: 'OpenAI-compatible API for business intelligence queries and analysis',
    version: '1.0.0',
    base_url: `${req.protocol}://${req.get('host')}`,
    endpoints: {
      chat_completions: {
        method: 'POST',
        path: '/v1/chat/completions',
        description: 'Create chat completions with intelligent agent routing',
        parameters: {
          model: 'string (business-intelligence, default-assistant)',
          messages: 'array of message objects',
          stream: 'boolean (optional, default: false)',
          temperature: 'number (optional, 0-2)',
          max_tokens: 'number (optional)',
          user: 'string (optional)',
        },
        example: {
          model: 'business-intelligence',
          messages: [
            { role: 'user', content: 'What was our revenue growth rate last quarter?' }
          ],
          stream: false,
          temperature: 0.1,
        },
      },
      models: {
        method: 'GET',
        path: '/v1/models',
        description: 'List all available models',
      },
      model_details: {
        method: 'GET',
        path: '/v1/models/{model}',
        description: 'Get specific model information',
      },
      model_capabilities: {
        method: 'GET',
        path: '/v1/models/{model}/capabilities',
        description: 'Get model capabilities and features',
      },
    },
    features: {
      intelligent_routing: 'Automatic routing to appropriate specialized agents',
      complexity_analysis: 'Multi-dimensional query complexity scoring',
      streaming_responses: 'Real-time streaming of analysis results',
      business_tools: 'Built-in business calculation and validation tools',
      memory_context: 'Persistent user and organizational memory',
      knowledge_integration: 'Access to business knowledge base',
      comprehensive_tracing: 'Full observability and performance tracking',
    },
    models: {
      'business-intelligence': {
        description: 'Expert analyst for complex business queries',
        use_cases: ['Financial analysis', 'KPI calculations', 'Strategic insights'],
        capabilities: ['Deep reasoning', 'Knowledge integration', 'Multi-step analysis'],
      },
      'default-assistant': {
        description: 'Fast assistant for simple queries',
        use_cases: ['Quick questions', 'Basic calculations', 'General guidance'],
        capabilities: ['Fast responses', 'Simple reasoning', 'Basic tools'],
      },
    },
  };

  res.json(documentation);
});

/**
 * Catch-all for unsupported endpoints
 */
openAIRouter.all('*', (req: Request, res: Response) => {
  apiLogger.warn('Unsupported API endpoint requested', {
    method: req.method,
    path: req.path,
    user_agent: req.get('user-agent'),
  });

  res.status(404).json({
    error: {
      message: `Endpoint ${req.method} ${req.path} not found`,
      type: 'invalid_request_error',
      code: 'endpoint_not_found',
    },
  });
});

/**
 * Error handling middleware
 */
openAIRouter.use((error: any, req: Request, res: Response, next: NextFunction) => {
  apiLogger.error('Unhandled API error', error);

  // Determine error type and status code
  let statusCode = 500;
  let errorType = 'internal_server_error';
  let errorCode = 'internal_error';

  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorType = 'invalid_request_error';
    errorCode = 'validation_error';
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    errorType = 'authentication_error';
    errorCode = 'unauthorized';
  } else if (error.statusCode) {
    statusCode = error.statusCode;
  }

  res.status(statusCode).json({
    error: {
      message: error.message || 'An unexpected error occurred',
      type: errorType,
      code: errorCode,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  });
});

export default openAIRouter;
