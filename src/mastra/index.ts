
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { env, getPort } from './config/environment.js';
import { initializeDatabase } from './config/database.js';
import { getConnectionManager } from './database/connection.js';
import { vectorStorage } from './memory/storage.js';
import { initializeLangFuse } from './observability/langfuse.js';
import { getLangFuseClient } from './observability/langfuse-client.js';
import { getToolCallTracer } from './observability/tool-tracer.js';
import { getAgentInteractionTracer } from './observability/agent-tracer.js';
import { getWorkflowExecutionTracer } from './observability/workflow-tracer.js';
import { getObservabilityDashboard } from './observability/dashboard.js';
import { rootLogger } from './observability/logger.js';

// Import agents
import { businessIntelligenceAgent, EnhancedBusinessIntelligenceAgent } from './agents/business-intelligence.js';
import { defaultAgent, EnhancedDefaultAgent } from './agents/default.js';
import { sharedTools } from './agents/shared-tools.js';

// Import workflows
import { intentClassifierWorkflow } from './workflows/intent-classifier.js';
import { orchestratorWorkflow } from './workflows/orchestrator.js';
import { planningWorkflow, EnhancedPlanningWorkflow } from './workflows/planning.js';

// Initialize core services (Constitutional requirement: pgvector database)
initializeDatabase();
initializeLangFuse();

// Initialize comprehensive observability system (Constitutional requirement)
const langfuseClient = getLangFuseClient();
const toolTracer = getToolCallTracer();
const agentTracer = getAgentInteractionTracer();
const workflowTracer = getWorkflowExecutionTracer();
const observabilityDashboard = getObservabilityDashboard();

// Initialize pgvector connection for constitutional compliance
const connectionManager = getConnectionManager();

// Initialize enhanced agents and workflows for comprehensive tracing (Constitutional requirement)
const enhancedBusinessIntelligenceAgent = new EnhancedBusinessIntelligenceAgent();
const enhancedDefaultAgent = new EnhancedDefaultAgent();
const enhancedPlanningWorkflow = new EnhancedPlanningWorkflow();

// Agents are already configured with their tools in their respective files

// Registered agents and workflows (using enhanced instances for comprehensive tracing)
const registeredAgents = {
  'business-intelligence-agent': enhancedBusinessIntelligenceAgent, // Enhanced with comprehensive tracing
  'default-agent': enhancedDefaultAgent, // Enhanced with comprehensive tracing
};

const registeredWorkflows = {
  'intent-classifier': intentClassifierWorkflow,
  'orchestrator': orchestratorWorkflow,
  'planning': enhancedPlanningWorkflow, // Enhanced with comprehensive tracing
};

// Main Mastra configuration (Constitutional requirement: pgvector database)
export const mastra = new Mastra({
  workflows: registeredWorkflows,
  agents: registeredAgents,
  storage: new PostgresStore({
    connectionString: env.PGVECTOR_DATABASE_URL, // Constitutional compliance: Use pgvector instead of Supabase
  }),
  logger: new PinoLogger({
    name: 'Mastra-BI-System',
    level: (process.env.MASTRA_LOG_LEVEL as any) || 'info',
  }),
  telemetry: {
    enabled: false, // Deprecated
  },
  observability: {
    default: { enabled: true },
  },
});

// Export configuration for other modules (Constitutional compliance: pgvector database)
export const config = {
  port: getPort(),
  environment: env.NODE_ENV,
  database: {
    url: env.PGVECTOR_DATABASE_URL, // Constitutional compliance: Use pgvector instead of Supabase
    type: 'pgvector',
    version: '17',
  },
  observability: {
    langfuse_enabled: Boolean(env.LANGFUSE_PUBLIC_KEY),
  },
  mcp: {
    server_port: parseInt(env.MCP_SERVER_PORT, 10),
    config_path: env.MCP_CONFIG_PATH,
  },
  storage: {
    vector_storage: 'pgvector', // Constitutional compliance marker
    embedding_dimensions: 1536,
  },
};

// Health check endpoint data (Constitutional compliance: pgvector database)
export const healthInfo = {
  service: 'mastra-bi-system',
  version: '1.0.0',
  environment: env.NODE_ENV,
  features: {
    agents: Object.keys(registeredAgents).length,
    workflows: Object.keys(registeredWorkflows).length,
    shared_tools: sharedTools.length,
    mcp_client: true,
    mcp_server: true,
    memory_system: true,
    knowledge_base: true,
    observability: Boolean(env.LANGFUSE_PUBLIC_KEY),
    comprehensive_tracing: true,
    tool_tracing: toolTracer.isEnabled(),
    agent_tracing: agentTracer.isEnabled(),
    workflow_tracing: workflowTracer.isEnabled(),
    observability_dashboard: true,
    openai_api: true,
    intelligent_routing: true,
    complexity_analysis: true,
    pgvector_database: true, // Constitutional compliance marker
    vector_search: true,
    hybrid_search: true,
  },
  agents: Object.keys(registeredAgents),
  workflows: Object.keys(registeredWorkflows),
  tools: sharedTools.map(tool => tool.id),
  database: {
    type: 'pgvector',
    version: 17,
    embedding_dimensions: 1536,
  },
};

rootLogger.info('Mastra BI System initialized', {
  version: healthInfo.version,
  environment: env.NODE_ENV,
  port: getPort(),
  features: healthInfo.features,
  registered_agents: Object.keys(registeredAgents),
  registered_workflows: Object.keys(registeredWorkflows),
  shared_tools: sharedTools.length,
});

// Export agents and workflows for direct access
export { registeredAgents as agents, registeredWorkflows as workflows, sharedTools };

// Export individual components for specific imports
export {
  businessIntelligenceAgent,
  enhancedBusinessIntelligenceAgent, // Enhanced version for constitutional compliance
  defaultAgent,
  enhancedDefaultAgent, // Enhanced version for constitutional compliance
  intentClassifierWorkflow,
  orchestratorWorkflow,
  planningWorkflow,
  enhancedPlanningWorkflow, // Enhanced version for constitutional compliance
};

// Export execution functions for programmatic access
export { executeBusinessIntelligenceAgent } from './agents/business-intelligence.js';
export { executeDefaultAgent } from './agents/default.js';
export { executeOrchestrator } from './workflows/orchestrator.js';
export { executePlanning } from './workflows/planning.js';
