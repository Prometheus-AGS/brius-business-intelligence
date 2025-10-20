import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config();

import { Mastra } from '@mastra/core/mastra';
import { DefaultExporter } from '@mastra/core/ai-tracing';
import { PinoLogger } from '@mastra/loggers';
import { env, getPort } from './config/environment.js';
import {
  getPostgresStore,
  getVectorStore,
  getMemoryStore,
  ensureVectorIndexes
} from './config/consolidated-database.js';
import { businessIntelligenceAgent, executeBusinessIntelligenceAgent } from './agents/business-intelligence.js';
import { defaultAgent, executeDefaultAgent } from './agents/default.js';
import { ensureMcpToolsLoaded, getSharedToolMap, getBedrockTools, getToolCounts } from './agents/shared-tools.js';
import { intentClassifierWorkflow } from './workflows/intent-classifier.js';
import { defaultOrchestrationWorkflow, executeDefaultOrchestration } from './workflows/default-orchestration.js';
import { businessIntelligenceOrchestrationWorkflow, executeBusinessIntelligenceOrchestration } from './workflows/business-intelligence-orchestration.js';
import { planningWorkflow, executePlanning } from './workflows/planning.js';
import { rootLogger } from './observability/logger.js';
import { getKnowledgeRoutes } from './api/routes/knowledge.js';
import { documentProcessingQueue } from './knowledge/processing-queue.js';

// Add global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  if (error.message.includes('Connection terminated unexpectedly')) {
    rootLogger.warn('Database connection error handled gracefully', {
      error: error.message,
      type: 'database_connection'
    });
    return; // Don't crash the application
  }
  
  rootLogger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason && typeof reason === 'object' && 'message' in reason &&
      typeof reason.message === 'string' && reason.message.includes('Connection terminated unexpectedly')) {
    rootLogger.warn('Database connection rejection handled gracefully', {
      reason: reason.message,
      type: 'database_connection'
    });
    return; // Don't crash the application
  }
  
  rootLogger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

// Create observability configuration
const observabilityConfig = env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
  ? {
      configs: {
        langfuse: {
          serviceName: 'brius-business-intelligence',
          exporters: [new DefaultExporter()],
        },
      },
      configSelector: () => 'langfuse',
    }
  : {
      default: { enabled: true },
    };

// Create Mastra instance with proper error handling
export const mastra = new Mastra({
  agents: {
    [businessIntelligenceAgent.name]: businessIntelligenceAgent,
    [defaultAgent.name]: defaultAgent,
  },
  workflows: {
    [intentClassifierWorkflow.id]: intentClassifierWorkflow,
    [defaultOrchestrationWorkflow.id]: defaultOrchestrationWorkflow,
    [businessIntelligenceOrchestrationWorkflow.id]: businessIntelligenceOrchestrationWorkflow,
    [planningWorkflow.id]: planningWorkflow,
  },
  storage: getPostgresStore(),
  vectors: { primary: getVectorStore() },
  logger: new PinoLogger({
    name: 'brius-bi-system',
    level: (process.env.MASTRA_LOG_LEVEL as any) || 'info',
  }),
  telemetry: {
    enabled: false,
  },
  observability: observabilityConfig,
  server: {
    apiRoutes: [
      ...getKnowledgeRoutes(),
    ],
  },
});

// Initialize database and tools with proper error handling
async function initializeServices() {
  try {
    rootLogger.info('Initializing Mastra services');
    
    // Add delay to ensure database is ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Initialize vector indexes with error handling
    try {
      await ensureVectorIndexes();
      rootLogger.info('Vector indexes initialized successfully');
    } catch (error) {
      rootLogger.warn('Vector index initialization failed, continuing without vectors', {
        error: error instanceof Error ? error.message : error
      });
    }

    // Initialize MCP tools with error handling
    try {
      await ensureMcpToolsLoaded();
      rootLogger.info('MCP tools loaded successfully', getToolCounts());
    } catch (error) {
      rootLogger.warn('MCP tools initialization failed, continuing without MCP tools', {
        error: error instanceof Error ? error.message : error
      });
    }

    // Start background services
    try {
      documentProcessingQueue.start();
      rootLogger.info('Document processing queue started');
    } catch (error) {
      rootLogger.warn('Document processing queue failed to start', {
        error: error instanceof Error ? error.message : error
      });
    }

    rootLogger.info('Mastra services initialization completed');
  } catch (error) {
    rootLogger.error('Critical service initialization error', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

// Start initialization
initializeServices().catch((error) => {
  rootLogger.error('Fatal service initialization error:', error);
});

// Configuration and health info
export const config = {
  port: getPort(),
  environment: env.NODE_ENV,
  database: {
    url: env.PGVECTOR_DATABASE_URL,
    type: 'pgvector',
  },
  observability: {
    langfuse: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
  },
};

export const healthInfo = {
  service: 'brius-business-intelligence',
  version: '1.0.0',
  environment: env.NODE_ENV,
  features: {
    agent_count: Object.keys(mastra.getAgents()).length,
    workflow_count: Object.keys(mastra.getWorkflows()).length,
    langfuse_enabled: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
    memory_enabled: true,
    knowledge_base_enabled: true,
    bedrock_llm_enabled: true,
  },
  agents: Object.keys(mastra.getAgents()),
  workflows: Object.keys(mastra.getWorkflows()),
  tools: Object.keys(getSharedToolMap()),
  tool_counts: getToolCounts(),
};

rootLogger.info('Mastra initialized', {
  service: healthInfo.service,
  environment: healthInfo.environment,
  agents: healthInfo.agents,
  workflows: healthInfo.workflows,
  port: config.port,
});

// Legacy exports for backward compatibility
export const agents = {
  [businessIntelligenceAgent.name]: businessIntelligenceAgent,
  [defaultAgent.name]: defaultAgent,
};

export const workflows = {
  [intentClassifierWorkflow.id]: intentClassifierWorkflow,
  [defaultOrchestrationWorkflow.id]: defaultOrchestrationWorkflow,
  [businessIntelligenceOrchestrationWorkflow.id]: businessIntelligenceOrchestrationWorkflow,
  [planningWorkflow.id]: planningWorkflow,
};

// Function exports
export { executeBusinessIntelligenceAgent, executeDefaultAgent };
export { executeDefaultOrchestration, executeBusinessIntelligenceOrchestration, executePlanning };
export { getSharedToolMap, getBedrockTools, getToolCounts };
