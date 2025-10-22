import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config();

import { Mastra } from '@mastra/core/mastra';
import { DefaultExporter } from '@mastra/core/ai-tracing';
import { PinoLogger } from '@mastra/loggers';
import cors from 'cors';
import { env, getPort } from './config/environment.js';
import {
  getPostgresStore,
  getVectorStore,
  getMemoryStore,
  ensureVectorIndexes
} from './config/consolidated-database.js';
import { businessIntelligenceAgent, executeBusinessIntelligenceAgent } from './agents/business-intelligence.js';
import { defaultAgent, executeDefaultAgent } from './agents/default.js';
import { orchestratorAgent, executeOrchestratorAgent } from './agents/orchestrator.js';
import { ensureMcpToolsLoaded, getSharedToolMap, getBedrockTools, getToolCounts, getAllAvailableTools } from './agents/shared-tools.js';
import { intentClassifierWorkflow } from './workflows/intent-classifier.js';
import { defaultOrchestrationWorkflow, executeDefaultOrchestration } from './workflows/default-orchestration.js';
import { businessIntelligenceOrchestrationWorkflow, executeBusinessIntelligenceOrchestration } from './workflows/business-intelligence-orchestration.js';
import { planningWorkflow, executePlanning } from './workflows/planning.js';
import { businessIntelligencePlannerWorkflow, executeBusinessIntelligencePlanner } from './workflows/business-intelligence-planner.js';
import { businessIntelligenceExecutorWorkflow, executeBusinessIntelligenceExecutor } from './workflows/business-intelligence-executor.js';
import { rootLogger } from './observability/logger.js';
import { getKnowledgeRoutes } from './api/routes/knowledge.js';
import { getPlaygroundRoutes } from './api/routes/playground.js';
import { getHealthRoutes } from './api/routes/health.js';
import { documentProcessingQueue } from './knowledge/processing-queue.js';
import { mcpToolRegistry } from './mcp/registry.js';
import { getMCPToolRegistrationManager } from './tools/mcp-registry.js';

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

// Initialize all tools BEFORE creating Mastra instance
async function initializeAllTools() {
  try {
    rootLogger.info('🔥 STARTING TOOL INITIALIZATION BEFORE MASTRA CREATION');

    // Initialize MCP registry first
    rootLogger.info('🔥 INITIALIZING MCP REGISTRY');
    await mcpToolRegistry.initialize();
    rootLogger.info('✅ MCP registry initialized successfully');

    // Initialize MCP tool registration manager
    rootLogger.info('🔥 INITIALIZING MCP TOOL REGISTRATION MANAGER');
    const mcpToolRegistrationManager = getMCPToolRegistrationManager();
    if (mcpToolRegistrationManager) {
      await mcpToolRegistrationManager.initialize();
      rootLogger.info('✅ MCP tool registration manager initialized successfully');
    } else {
      rootLogger.warn('⚠️ MCP tool registration manager not available');
    }

    // Load MCP tools into shared tools system
    rootLogger.info('🔥 LOADING MCP TOOLS INTO SHARED SYSTEM');
    await ensureMcpToolsLoaded();

    const toolCounts = getToolCounts();
    const allTools = getAllAvailableTools();

    rootLogger.info('✅ All tools loaded successfully before Mastra creation', {
      ...toolCounts,
      total_available_tools: allTools.length,
      tool_ids: allTools.map(t => t.id).slice(0, 10), // Log first 10 tool IDs
    });

    return allTools;

  } catch (error) {
    rootLogger.error('❌ Tool initialization failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Continue with fallback tools
    try {
      const toolCounts = getToolCounts();
      const allTools = getAllAvailableTools();
      rootLogger.warn('⚠️ Continuing with fallback tools only', {
        ...toolCounts,
        total_available_tools: allTools.length,
      });
      return allTools;
    } catch (fallbackError) {
      rootLogger.error('❌ Even fallback tools failed', {
        error: fallbackError instanceof Error ? fallbackError.message : fallbackError,
      });
      return [];
    }
  }
}

// Global variable to hold the Mastra instance
let mastraInstance: Mastra | null = null;

// Create Mastra instance with proper agent configuration
async function createMastraInstance() {
  if (mastraInstance) {
    return mastraInstance;
  }

  try {
    // Load all tools BEFORE creating agents
    const allTools = await initializeAllTools();

    rootLogger.info('🔥 CREATING MASTRA INSTANCE WITH AGENT TOOL CONFIGURATION', {
      tool_count: allTools.length,
      tool_ids: allTools.map(t => t.id).slice(0, 10), // Log first 10 tool IDs
    });

    // Note: Tools are configured at the AGENT level, not Mastra level
    // The agents are already configured with their tools in their respective files
    // The shared tool system will provide the aggregated tools to agents when they execute

    mastraInstance = new Mastra({
      agents: {
        [orchestratorAgent.name]: orchestratorAgent,
        [businessIntelligenceAgent.name]: businessIntelligenceAgent,
        [defaultAgent.name]: defaultAgent,
      },
      workflows: {
        [intentClassifierWorkflow.id]: intentClassifierWorkflow,
        [defaultOrchestrationWorkflow.id]: defaultOrchestrationWorkflow,
        [businessIntelligenceOrchestrationWorkflow.id]: businessIntelligenceOrchestrationWorkflow,
        [planningWorkflow.id]: planningWorkflow,
        [businessIntelligencePlannerWorkflow.id]: businessIntelligencePlannerWorkflow,
        [businessIntelligenceExecutorWorkflow.id]: businessIntelligenceExecutorWorkflow,
      },
      // No 'tools' property - tools are configured at agent level
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
        middleware: [
          // Configure CORS to allow ALL origins, methods, and headers
          async (c, next) => {
            // Set CORS headers to allow all origins, methods, and headers
            c.res.headers.set('Access-Control-Allow-Origin', '*');
            c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
            c.res.headers.set('Access-Control-Allow-Headers', '*');
            c.res.headers.set('Access-Control-Expose-Headers', '*');
            c.res.headers.set('Access-Control-Allow-Credentials', 'true');
            c.res.headers.set('Access-Control-Max-Age', '86400');
            
            // Handle preflight OPTIONS requests
            if (c.req.method === 'OPTIONS') {
              return new Response(null, {
                status: 200,
                headers: c.res.headers,
              });
            }
            
            // Continue to next middleware
            await next();
          },
        ],
        apiRoutes: [
          ...getHealthRoutes(),
          ...getKnowledgeRoutes(),
          ...getPlaygroundRoutes(),
        ],
      },
    });

    rootLogger.info('✅ MASTRA INSTANCE CREATED SUCCESSFULLY', {
      agent_count: Object.keys(mastraInstance.getAgents()).length,
      workflow_count: Object.keys(mastraInstance.getWorkflows()).length,
      available_tool_count: allTools.length,
    });

    return mastraInstance;
  } catch (error) {
    rootLogger.error('❌ MASTRA INSTANCE CREATION FAILED', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// Export a promise that resolves to the Mastra instance
export const mastra = await createMastraInstance();

// Initialize remaining services after Mastra is created
async function initializeServices() {
  try {
    rootLogger.info('🔥 INITIALIZING REMAINING MASTRA SERVICES');

    // Add delay to ensure database is ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize vector indexes with error handling
    try {
      await ensureVectorIndexes();
      rootLogger.info('✅ Vector indexes initialized successfully');
    } catch (error) {
      rootLogger.warn('⚠️ Vector index initialization failed, continuing without vectors', {
        error: error instanceof Error ? error.message : error
      });
    }

    // Start background services
    try {
      documentProcessingQueue.start();
      rootLogger.info('✅ Document processing queue started');
    } catch (error) {
      rootLogger.warn('⚠️ Document processing queue failed to start', {
        error: error instanceof Error ? error.message : error
      });
    }

    rootLogger.info('🎉 MASTRA SERVICES INITIALIZATION COMPLETED');
  } catch (error) {
    rootLogger.error('💥 CRITICAL SERVICE INITIALIZATION ERROR', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

// Start initialization
initializeServices().catch((error) => {
  rootLogger.error('💥 FATAL SERVICE INITIALIZATION ERROR:', error);
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
    available_tool_count: getAllAvailableTools().length, // TOTAL AVAILABLE TOOLS
    langfuse_enabled: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
    memory_enabled: true,
    knowledge_base_enabled: true,
    bedrock_llm_enabled: true,
    mcp_enabled: true,
  },
  agents: Object.keys(mastra.getAgents()),
  workflows: Object.keys(mastra.getWorkflows()),
  // Tools are configured at agent level, not Mastra level
  shared_tools: Object.keys(getSharedToolMap()), // TOOLS IN SHARED TOOL MAP
  tool_counts: getToolCounts(),
};

rootLogger.info('🚀 MASTRA INITIALIZED', {
  service: healthInfo.service,
  environment: healthInfo.environment,
  agents: healthInfo.agents,
  workflows: healthInfo.workflows,
  port: config.port,
  tool_counts: healthInfo.tool_counts,
});

// Legacy exports for backward compatibility
export const agents = {
  [orchestratorAgent.name]: orchestratorAgent,
  [businessIntelligenceAgent.name]: businessIntelligenceAgent,
  [defaultAgent.name]: defaultAgent,
};

export const workflows = {
  [intentClassifierWorkflow.id]: intentClassifierWorkflow,
  [defaultOrchestrationWorkflow.id]: defaultOrchestrationWorkflow,
  [businessIntelligenceOrchestrationWorkflow.id]: businessIntelligenceOrchestrationWorkflow,
  [planningWorkflow.id]: planningWorkflow,
  [businessIntelligencePlannerWorkflow.id]: businessIntelligencePlannerWorkflow,
  [businessIntelligenceExecutorWorkflow.id]: businessIntelligenceExecutorWorkflow,
};

// Function exports
export { executeOrchestratorAgent, executeBusinessIntelligenceAgent, executeDefaultAgent };
export { executeDefaultOrchestration, executeBusinessIntelligenceOrchestration, executePlanning };
export { executeBusinessIntelligencePlanner, executeBusinessIntelligenceExecutor };
export { ensureMcpToolsLoaded, getSharedToolMap, getBedrockTools, getToolCounts, getAllAvailableTools };

// MCP exports for external access
export { mcpToolRegistry, getMCPToolRegistrationManager };
