import express from 'express';
import cors from 'cors';
import { config, healthInfo } from './mastra/index.js';
import openAIRouter from './mastra/api/openai/router.js';
import { rootLogger, requestLoggingMiddleware, errorHandlingMiddleware } from './mastra/observability/logger.js';
import { traceManager } from './mastra/observability/tracing.js';

/**
 * Express Server for Business Intelligence API
 * Provides OpenAI-compatible endpoints with intelligent agent routing
 */

const app = express();
const port = config.port || 3000;

// Middleware setup
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLoggingMiddleware(rootLogger));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Brius Business Intelligence API',
    version: healthInfo.version,
    description: 'OpenAI-compatible API for intelligent business queries',
    documentation: '/api/openai/docs',
    health: '/api/openai/health',
    endpoints: {
      chat_completions: '/api/openai/v1/chat/completions',
      models: '/api/openai/v1/models',
      health: '/api/openai/health',
      docs: '/api/openai/docs',
    },
    features: healthInfo.features,
    agents: healthInfo.agents,
    workflows: healthInfo.workflows,
    tools: healthInfo.tools,
  });
});

// System health endpoint
app.get('/health', (req, res) => {
  const stats = traceManager.getStatistics();

  res.json({
    ...healthInfo,
    timestamp: new Date().toISOString(),
    uptime_seconds: process.uptime(),
    memory_usage: process.memoryUsage(),
    tracing_stats: stats,
  });
});

// System metrics endpoint
app.get('/metrics', (req, res) => {
  const stats = traceManager.getStatistics();
  const recentTraces = traceManager.getRecentTraces(5);

  res.json({
    service: healthInfo.service,
    version: healthInfo.version,
    timestamp: new Date().toISOString(),
    system: {
      uptime_seconds: process.uptime(),
      memory_usage: process.memoryUsage(),
      node_version: process.version,
      platform: process.platform,
    },
    tracing: {
      statistics: stats,
      recent_traces: recentTraces.map(trace => ({
        trace_id: trace.context.traceId,
        operation: trace.context.operationName,
        type: trace.context.operationType,
        status: trace.status,
        duration_ms: trace.duration,
        user_id: trace.context.userId,
      })),
    },
    features: healthInfo.features,
    registered_components: {
      agents: healthInfo.agents,
      workflows: healthInfo.workflows,
      tools: healthInfo.tools,
    },
  });
});

// OpenAI-compatible API routes
app.use('/api/openai', openAIRouter);

// 404 handler
app.use((req, res) => {
  rootLogger.warn('Route not found', {
    method: req.method,
    path: req.path,
    user_agent: req.get('user-agent'),
  });

  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      type: 'not_found',
      code: 'route_not_found',
      available_routes: [
        'GET /',
        'GET /health',
        'GET /metrics',
        'POST /api/openai/v1/chat/completions',
        'GET /api/openai/v1/models',
        'GET /api/openai/health',
        'GET /api/openai/docs',
      ],
    },
  });
});

// Error handling
app.use(errorHandlingMiddleware(rootLogger));

// Graceful shutdown handling
process.on('SIGTERM', () => {
  rootLogger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  rootLogger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled error logging
process.on('unhandledRejection', (reason, promise) => {
  rootLogger.error('Unhandled Promise Rejection', {
    reason: String(reason),
    promise: String(promise),
  });
});

process.on('uncaughtException', (error) => {
  rootLogger.fatal('Uncaught Exception', error);
  process.exit(1);
});

// Start server
const server = app.listen(port, () => {
  rootLogger.info('Business Intelligence API Server started', {
    port,
    environment: config.environment,
    pid: process.pid,
    node_version: process.version,
    features: Object.keys(healthInfo.features).filter(key => healthInfo.features[key as keyof typeof healthInfo.features]),
    endpoints: {
      root: `http://localhost:${port}/`,
      health: `http://localhost:${port}/health`,
      openai_chat: `http://localhost:${port}/api/openai/v1/chat/completions`,
      openai_models: `http://localhost:${port}/api/openai/v1/models`,
      documentation: `http://localhost:${port}/api/openai/docs`,
    },
  });

  console.log(`
🚀 Brius Business Intelligence API Server

📍 Server running on: http://localhost:${port}
🏥 Health check: http://localhost:${port}/health
📊 Metrics: http://localhost:${port}/metrics
📚 API Documentation: http://localhost:${port}/api/openai/docs

🤖 Available Agents: ${healthInfo.agents.join(', ')}
⚙️  Available Workflows: ${healthInfo.workflows.join(', ')}
🛠️  Shared Tools: ${healthInfo.tools.join(', ')}

🔗 OpenAI-Compatible Endpoints:
   • Chat Completions: POST /api/openai/v1/chat/completions
   • Models: GET /api/openai/v1/models
   • Health: GET /api/openai/health

💡 Example usage:
   curl -X POST http://localhost:${port}/api/openai/v1/chat/completions \\
     -H "Content-Type: application/json" \\
     -d '{"model":"business-intelligence","messages":[{"role":"user","content":"What is our customer acquisition cost?"}]}'

✨ Ready to serve intelligent business queries!
  `);
});

// Export for testing
export { app, server };

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    rootLogger.error(`Port ${port} is already in use`);
    process.exit(1);
  } else {
    rootLogger.error('Server error', error);
    process.exit(1);
  }
});