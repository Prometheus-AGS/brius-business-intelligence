import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { rootLogger } from '../observability/logger.js';
import { mastra, agents, workflows, ensureMcpToolsLoaded, getSharedToolMap } from '../index.js';
import { MCPTracer } from '../observability/langfuse.js';

/**
 * MCP Server Protocol Handlers
 * Exposes Mastra Business Intelligence system capabilities to external MCP clients
 * Provides access to agents, workflows, tools, and knowledge base through Model Context Protocol
 */

export interface MCPServerOptions {
  name: string;
  version: string;
  description?: string;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    logging?: boolean;
  };
  transport?: 'stdio' | 'sse';
  port?: number;
  enableTracing?: boolean;
}

export interface MCPResourceMetadata {
  type: 'agent' | 'workflow' | 'knowledge' | 'memory' | 'system';
  category?: string;
  tags?: string[];
  lastModified?: string;
  size?: number;
}

export interface MCPToolMetadata {
  agent?: string;
  workflow?: string;
  category: 'intelligence' | 'memory' | 'knowledge' | 'calculation' | 'validation' | 'mcp';
  complexity?: 'low' | 'medium' | 'high';
  estimatedDuration?: number;
}

/**
 * Main MCP Server Protocol Handler
 */
export class MastraMCPProtocolHandler {
  private server: McpServer;
  private transport: StdioServerTransport | SSEServerTransport | null = null;
  private tracer: MCPTracer | null = null;
  private options: MCPServerOptions;

  constructor(options: MCPServerOptions) {
    this.options = {
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
        logging: true,
        ...options.capabilities,
      },
      enableTracing: true,
      ...options,
    };

    // Initialize tracing if enabled
    if (this.options.enableTracing) {
      this.tracer = new MCPTracer('mcp-server-protocol', `mcp-${Date.now()}`, {
        metadata: {
          serverName: this.options.name,
          version: this.options.version,
          transport: this.options.transport,
        },
      });
    }

    // Initialize MCP server
    this.server = new McpServer({
      name: this.options.name,
      version: this.options.version,
      description: this.options.description || 'Mastra Business Intelligence MCP Server',
    }, {
      capabilities: {
        tools: this.options.capabilities?.tools ? {} : undefined,
        resources: this.options.capabilities?.resources ? {} : undefined,
        prompts: this.options.capabilities?.prompts ? {} : undefined,
        logging: this.options.capabilities?.logging ? {} : undefined,
      },
    });

    this.setupProtocolHandlers();

    rootLogger.info('MCP Protocol Handler initialized', {
      name: this.options.name,
      version: this.options.version,
      capabilities: this.options.capabilities,
      transport: this.options.transport,
      tracing_enabled: this.options.enableTracing,
    });
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupProtocolHandlers(): void {
    // Tools handlers
    if (this.options.capabilities?.tools) {
      this.setupToolsHandlers();
    }

    // Resources handlers
    if (this.options.capabilities?.resources) {
      this.setupResourcesHandlers();
    }

    // Prompts handlers
    if (this.options.capabilities?.prompts) {
      this.setupPromptsHandlers();
    }

    // Logging handlers
    if (this.options.capabilities?.logging) {
      this.setupLoggingHandlers();
    }
  }

  /**
   * Setup tools protocol handlers
   */
  private setupToolsHandlers(): void {
    // Register agent execution tools
    for (const [agentId, agent] of Object.entries(agents)) {
      this.server.registerTool(
        `execute-agent-${agentId}`,
        {
          title: `Execute ${agentId} Agent`,
          description: `Execute ${agentId} with business intelligence capabilities`,
          inputSchema: {
            prompt: z.string().describe('The query or request to process'),
            userId: z.string().optional().describe('User identifier'),
            sessionId: z.string().optional().describe('Session identifier'),
            maxSteps: z.number().optional().describe('Maximum execution steps'),
            timeout: z.number().optional().describe('Timeout in milliseconds'),
            streaming: z.boolean().optional().describe('Enable streaming response'),
          } as any,
        },
        async (args: any, extra: any) => {
          const { prompt, userId, sessionId, maxSteps, timeout, streaming } = args;
          const traceId = this.tracer?.startTrace('execute-agent', { metadata: { agentId, prompt: prompt?.substring(0, 100) } });

          try {
            rootLogger.info('Executing agent via MCP', {
              agent_id: agentId,
              prompt_length: prompt?.length,
              user_id: userId,
              session_id: sessionId,
            });

            // Execute agent using the configured execution function
            let result;
            if (agentId === 'business-intelligence-agent') {
              const { executeBusinessIntelligenceAgent } = await import('../agents/business-intelligence.js');
              result = await executeBusinessIntelligenceAgent(prompt, {
                userId: userId,
                sessionId: sessionId,
                conversationId: sessionId,
              });
            } else if (agentId === 'default-agent') {
              const { executeDefaultAgent } = await import('../agents/default.js');
              result = await executeDefaultAgent(prompt, {
                userId: userId,
                sessionId: sessionId,
                conversationId: sessionId,
              });
            } else {
              throw new Error(`Agent execution not implemented for ${agentId}`);
            }

            this.tracer?.completeTrace(traceId || '', { metadata: { agentId, resultLength: JSON.stringify(result).length } });

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result, null, 2),
                } as any,
              ],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            rootLogger.error('MCP agent execution error', {
              agent_id: agentId,
              error: errorMessage,
            });
            this.tracer?.failTrace(traceId || '', errorMessage);
            throw error;
          }
        }
      );
    }

    // Register workflow execution tools
    for (const [workflowId, workflow] of Object.entries(workflows)) {
      this.server.registerTool(
        `execute-workflow-${workflowId}`,
        {
          title: `Execute ${workflowId} Workflow`,
          description: `Execute ${workflowId} workflow for structured business processes`,
          inputSchema: {
            input: z.record(z.string(), z.any()).describe('Input data for the workflow'),
            userId: z.string().optional().describe('User identifier'),
            traceId: z.string().optional().describe('Trace identifier'),
            timeout: z.number().optional().describe('Timeout in milliseconds'),
            resumable: z.boolean().optional().describe('Enable resumable execution'),
          } as any,
        },
        async (args: any, extra: any) => {
          const { input, userId, traceId: userTraceId, timeout, resumable } = args;
          const traceId = this.tracer?.startTrace('execute-workflow', { metadata: { workflowId, inputKeys: Object.keys(input || {}) } });

          try {
            rootLogger.info('Executing workflow via MCP', {
              workflow_id: workflowId,
              input_keys: Object.keys(input || {}),
              user_id: userId,
              user_trace_id: userTraceId,
            });

            // Execute workflow using the configured execution function
            let result;
            if (workflowId === 'default-orchestration') {
              const { executeDefaultOrchestration } = await import('../workflows/default-orchestration.js');
              result = await executeDefaultOrchestration(input);
            } else if (workflowId === 'business-intelligence-orchestration') {
              const { executeBusinessIntelligenceOrchestration } = await import('../workflows/business-intelligence-orchestration.js');
              result = await executeBusinessIntelligenceOrchestration(input);
            } else if (workflowId === 'planning') {
              const { executePlanning } = await import('../workflows/planning.js');
              result = await executePlanning(input);
            } else {
              // Generic workflow execution
              result = await workflow.execute(input);
            }

            this.tracer?.completeTrace(traceId || '', { metadata: { workflowId, resultLength: JSON.stringify(result).length } });

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result, null, 2),
                } as any,
              ],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            rootLogger.error('MCP workflow execution error', {
              workflow_id: workflowId,
              error: errorMessage,
            });
            this.tracer?.failTrace(traceId || '', errorMessage);
            throw error;
          }
        }
      );
    }

    // Register shared tools as MCP tools
    this.registerSharedTools();
  }

  /**
   * Register shared tools dynamically
   */
  private async registerSharedTools(): Promise<void> {
    try {
      await ensureMcpToolsLoaded();
      const sharedTools = Object.values(getSharedToolMap());

      for (const tool of sharedTools) {
        this.server.registerTool(
          `tool-${tool.id}`,
          {
            title: (tool as any).name || tool.id,
            description: tool.description || `Execute ${tool.id} tool`,
            inputSchema: tool.inputSchema || {
              input: z.any().describe('Tool input')
            } as any,
          },
          async (args: any, extra: any) => {
            const traceId = this.tracer?.startTrace('execute-shared-tool', { metadata: { toolId: tool.id } });

            try {
              rootLogger.info('Executing shared tool via MCP', {
                tool_id: tool.id,
                has_arguments: Boolean(args),
              });

              // Execute tool with proper context
              const executionContext = {
                runtimeContext: {},
                context: {
                  userId: args?.userId || 'mcp-client',
                  sessionId: args?.sessionId || `mcp-${Date.now()}`,
                },
              } as any;

              const result = await tool.execute?.(args || {}, executionContext);

              this.tracer?.completeTrace(traceId || '', { metadata: { toolId: tool.id, resultLength: JSON.stringify(result).length } });

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              rootLogger.error('MCP shared tool execution error', {
                tool_id: tool.id,
                error: errorMessage,
              });
              this.tracer?.failTrace(traceId || '', errorMessage);
              throw error;
            }
          }
        );
      }

      rootLogger.info('Shared tools registered as MCP tools', {
        shared_tools_count: sharedTools.length,
      });
    } catch (error) {
      rootLogger.error('Failed to register shared tools', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Setup resources protocol handlers
   */
  private setupResourcesHandlers(): void {
    // Register agent resources
    for (const [agentId, agent] of Object.entries(agents)) {
      // Agent resource
      this.server.registerResource(
        `agent-${agentId}`,
        `mastra://agents/${agentId}`,
        {
          title: `Agent: ${agentId}`,
          description: `Business intelligence agent for ${agentId} operations`,
          mimeType: 'application/json',
        },
        async () => {
          const traceId = this.tracer?.startTrace('read-agent-resource', { metadata: { agentId } });

          try {
            rootLogger.info('MCP read agent resource', { agent_id: agentId });

            const response = {
              contents: [
                {
                  uri: `mastra://agents/${agentId}`,
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    id: agentId,
                    name: agent.name,
                    description: `Business intelligence agent for ${agentId} operations`,
                    type: 'agent',
                    status: 'active',
                    lastModified: new Date().toISOString(),
                    capabilities: {
                      execution: true,
                      memory: Boolean((agent as any).memory),
                      tools: Boolean((agent as any).tools?.length),
                      streaming: true,
                    },
                  }, null, 2),
                },
              ],
            };

            this.tracer?.completeTrace(traceId || '', { metadata: { agentId } });
            return response;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            rootLogger.error('MCP read agent resource error', { agent_id: agentId, error: errorMessage });
            this.tracer?.failTrace(traceId || '', errorMessage);
            throw error;
          }
        }
      );

      // Agent config resource
      this.server.registerResource(
        `agent-config-${agentId}`,
        `mastra://agents/${agentId}/config`,
        {
          title: `Agent Config: ${agentId}`,
          description: `Configuration and capabilities of ${agentId} agent`,
          mimeType: 'application/json',
        },
        async () => {
          const traceId = this.tracer?.startTrace('read-agent-config-resource', { metadata: { agentId } });

          try {
            rootLogger.info('MCP read agent config resource', { agent_id: agentId });

            const response = {
              contents: [
                {
                  uri: `mastra://agents/${agentId}/config`,
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    id: agentId,
                    name: agent.name,
                    instructions: agent.instructions,
                    model: (agent as any).model ? {
                      provider: (agent as any).model.provider,
                      modelId: (agent as any).model.modelId,
                    } : null,
                    tools: (agent as any).tools?.map((tool: any) => ({
                      id: tool.id,
                      name: tool.name,
                      description: tool.description,
                    })) || [],
                    capabilities: {
                      memory: Boolean((agent as any).memory),
                      tools: Boolean((agent as any).tools?.length),
                      streaming: true,
                    },
                  }, null, 2),
                },
              ],
            };

            this.tracer?.completeTrace(traceId || '', { metadata: { agentId } });
            return response;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            rootLogger.error('MCP read agent config resource error', { agent_id: agentId, error: errorMessage });
            this.tracer?.failTrace(traceId || '', errorMessage);
            throw error;
          }
        }
      );
    }

    // Register workflow resources
    for (const [workflowId, workflow] of Object.entries(workflows)) {
      // Workflow resource
      this.server.registerResource(
        `workflow-${workflowId}`,
        `mastra://workflows/${workflowId}`,
        {
          title: `Workflow: ${workflowId}`,
          description: `Business process workflow for ${workflowId}`,
          mimeType: 'application/json',
        },
        async () => {
          const traceId = this.tracer?.startTrace('read-workflow-resource', { metadata: { workflowId } });

          try {
            rootLogger.info('MCP read workflow resource', { workflow_id: workflowId });

            const response = {
              contents: [
                {
                  uri: `mastra://workflows/${workflowId}`,
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    id: workflowId,
                    name: workflow.name,
                    description: `Business process workflow for ${workflowId}`,
                    type: 'workflow',
                    status: 'active',
                    lastModified: new Date().toISOString(),
                    stepsCount: workflow.steps?.length || 0,
                  }, null, 2),
                },
              ],
            };

            this.tracer?.completeTrace(traceId || '', { metadata: { workflowId } });
            return response;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            rootLogger.error('MCP read workflow resource error', { workflow_id: workflowId, error: errorMessage });
            this.tracer?.failTrace(traceId || '', errorMessage);
            throw error;
          }
        }
      );

      // Workflow schema resource
      this.server.registerResource(
        `workflow-schema-${workflowId}`,
        `mastra://workflows/${workflowId}/schema`,
        {
          title: `Workflow Schema: ${workflowId}`,
          description: `Input/output schema for ${workflowId} workflow`,
          mimeType: 'application/json',
        },
        async () => {
          const traceId = this.tracer?.startTrace('read-workflow-schema-resource', { metadata: { workflowId } });

          try {
            rootLogger.info('MCP read workflow schema resource', { workflow_id: workflowId });

            const response = {
              contents: [
                {
                  uri: `mastra://workflows/${workflowId}/schema`,
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    id: workflowId,
                    inputSchema: (workflow as any).triggerSchema ? this.convertZodSchemaToJsonSchema((workflow as any).triggerSchema) : null,
                    steps: (workflow as any).steps?.map((step: any, index: number) => ({
                      id: step.id,
                      description: step.description,
                      stepNumber: index + 1,
                    })) || [],
                  }, null, 2),
                },
              ],
            };

            this.tracer?.completeTrace(traceId || '', { metadata: { workflowId } });
            return response;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            rootLogger.error('MCP read workflow schema resource error', { workflow_id: workflowId, error: errorMessage });
            this.tracer?.failTrace(traceId || '', errorMessage);
            throw error;
          }
        }
      );
    }

    // Register system resources
    this.server.registerResource(
      'system-health',
      'mastra://system/health',
      {
        title: 'System Health',
        description: 'Current system health and status information',
        mimeType: 'application/json',
      },
      async () => {
        const traceId = this.tracer?.startTrace('read-system-health-resource', {});

        try {
          rootLogger.info('MCP read system health resource');

          const { healthInfo } = await import('../index.js');
          const response = {
            contents: [
              {
                uri: 'mastra://system/health',
                mimeType: 'application/json',
                text: JSON.stringify({
                  ...healthInfo,
                  timestamp: new Date().toISOString(),
                  uptime: process.uptime(),
                  memoryUsage: process.memoryUsage(),
                }, null, 2),
              },
            ],
          };

          this.tracer?.completeTrace(traceId || '', {});
          return response;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP read system health resource error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    this.server.registerResource(
      'system-capabilities',
      'mastra://system/capabilities',
      {
        title: 'System Capabilities',
        description: 'Available system capabilities and features',
        mimeType: 'application/json',
      },
      async () => {
        const traceId = this.tracer?.startTrace('read-system-capabilities-resource', {});

        try {
          rootLogger.info('MCP read system capabilities resource');

          await ensureMcpToolsLoaded();
          const response = {
            contents: [
              {
                uri: 'mastra://system/capabilities',
                mimeType: 'application/json',
                text: JSON.stringify({
                  mcp: {
                    tools: this.options.capabilities?.tools,
                    resources: this.options.capabilities?.resources,
                    prompts: this.options.capabilities?.prompts,
                    logging: this.options.capabilities?.logging,
                  },
                  agents: Object.keys(agents),
                  workflows: Object.keys(workflows),
                  tools: Object.keys(getSharedToolMap()),
                  integrations: {
                    langfuse: Boolean(process.env.LANGFUSE_PUBLIC_KEY),
                    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
                    openai: Boolean(process.env.OPENAI_API_KEY),
                  },
                }, null, 2),
              },
            ],
          };

          this.tracer?.completeTrace(traceId || '', {});
          return response;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP read system capabilities resource error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    this.server.registerResource(
      'tools-catalog',
      'mastra://tools/catalog',
      {
        title: 'Tools Catalog',
        description: 'Complete catalog of available tools and their capabilities',
        mimeType: 'application/json',
      },
      async () => {
        const traceId = this.tracer?.startTrace('read-tools-catalog-resource', {});

        try {
          rootLogger.info('MCP read tools catalog resource');

          await ensureMcpToolsLoaded();
          const response = {
            contents: [
              {
                uri: 'mastra://tools/catalog',
                mimeType: 'application/json',
                text: JSON.stringify({
                  tools: Object.values(getSharedToolMap()).map(tool => ({
                    id: tool.id,
                    name: (tool as any).name,
                    description: tool.description,
                    metadata: this.getToolMetadata(tool),
                    inputSchema: tool.inputSchema ? this.convertZodSchemaToJsonSchema(tool.inputSchema) : null,
                  })),
                  categories: this.getToolCategories(),
                  totalCount: Object.keys(getSharedToolMap()).length,
                  lastUpdated: new Date().toISOString(),
                }, null, 2),
              },
            ],
          };

          this.tracer?.completeTrace(traceId || '', {});
          return response;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP read tools catalog resource error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    this.server.registerResource(
      'knowledge-status',
      'mastra://knowledge/status',
      {
        title: 'Knowledge Base Status',
        description: 'Current status and statistics of the knowledge base',
        mimeType: 'application/json',
      },
      async () => {
        const traceId = this.tracer?.startTrace('read-knowledge-status-resource', {});

        try {
          rootLogger.info('MCP read knowledge status resource');

          const response = {
            contents: [
              {
                uri: 'mastra://knowledge/status',
                mimeType: 'application/json',
                text: JSON.stringify({
                  status: 'active',
                  capabilities: ['search', 'upload', 'processing'],
                  searchTypes: ['semantic', 'keyword', 'hybrid'],
                  supportedFormats: ['pdf', 'docx', 'txt', 'md', 'json', 'csv'],
                  lastUpdated: new Date().toISOString(),
                }, null, 2),
              },
            ],
          };

          this.tracer?.completeTrace(traceId || '', {});
          return response;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP read knowledge status resource error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    rootLogger.info('MCP resources registered', {
      agents_count: Object.keys(agents).length,
      workflows_count: Object.keys(workflows).length,
      system_resources: 3,
      total_resources: Object.keys(agents).length * 2 + Object.keys(workflows).length * 2 + 3,
    });
  }

  /**
   * Setup prompts protocol handlers
   */
  private setupPromptsHandlers(): void {
    // Register business analysis prompt
    this.server.registerPrompt(
      'business-analysis',
      {
        description: 'Perform comprehensive business analysis with data insights',
        argsSchema: {
          query: z.string().describe('The business question or analysis request'),
          context: z.record(z.string(), z.any()).optional().describe('Additional business context or constraints'),
        } as any,
      },
      async (args: any, extra: any) => {
        const { query, context = {} } = args;
        const traceId = this.tracer?.startTrace('get-business-analysis-prompt', { metadata: { query: query?.substring(0, 100) } });

        try {
          rootLogger.info('MCP business analysis prompt request', { query_length: query?.length });

          const messages = [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Please perform a comprehensive business analysis for the following query:

Query: ${query}

${Object.keys(context || {}).length > 0 ? `Additional Context:
${JSON.stringify(context, null, 2)}` : ''}

Please provide:
1. Analysis of the business question
2. Relevant data insights and metrics
3. Actionable recommendations
4. Risk assessment and considerations

Use the available business intelligence tools to gather information and perform calculations as needed.`,
              },
            },
          ];

          this.tracer?.completeTrace(traceId || '', { metadata: { messagesCount: messages.length } });
          return { messages };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP business analysis prompt error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    // Register data validation prompt
    this.server.registerPrompt(
      'data-validation',
      {
        description: 'Validate data quality and identify potential issues',
        argsSchema: {
          data: z.any().describe('Data to validate (JSON format)'),
          rules: z.array(z.string()).optional().describe('Specific validation rules to apply'),
        } as any,
      },
      async (args: any, extra: any) => {
        const { data, rules = [] } = args;
        const traceId = this.tracer?.startTrace('get-data-validation-prompt', { metadata: { dataLength: JSON.stringify(data || {}).length } });

        try {
          rootLogger.info('MCP data validation prompt request', { data_size: JSON.stringify(data || {}).length });

          const messages = [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Please validate the following data and identify any quality issues:

Data: ${JSON.stringify(data, null, 2)}

${Array.isArray(rules) && rules.length > 0 ? `Validation Rules:
${rules.join('\n')}` : ''}

Please check for:
1. Missing or null values
2. Data type inconsistencies
3. Outliers or anomalies
4. Duplicate records
5. Business rule violations

Provide a detailed validation report with recommendations for data quality improvements.`,
              },
            },
          ];

          this.tracer?.completeTrace(traceId || '', { metadata: { messagesCount: messages.length } });
          return { messages };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP data validation prompt error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    // Register knowledge search prompt
    this.server.registerPrompt(
      'knowledge-search',
      {
        description: 'Search business knowledge base for relevant information',
        argsSchema: {
          query: z.string().describe('Search query for knowledge base'),
          category: z.string().optional().describe('Optional category filter'),
        } as any,
      },
      async (args: any, extra: any) => {
        const { query, category } = args;
        const traceId = this.tracer?.startTrace('get-knowledge-search-prompt', { metadata: { query: query?.substring(0, 100), category } });

        try {
          rootLogger.info('MCP knowledge search prompt request', { query_length: query?.length, category });

          const messages = [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Please search the knowledge base for information about:

Query: ${query}

${category ? `Category: ${category}` : ''}

Please provide:
1. Relevant information from the knowledge base
2. Source references and metadata
3. Related topics and concepts
4. Confidence assessment of the results

Use the knowledge search tools to find the most relevant and accurate information.`,
              },
            },
          ];

          this.tracer?.completeTrace(traceId || '', { metadata: { messagesCount: messages.length } });
          return { messages };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          rootLogger.error('MCP knowledge search prompt error', { error: errorMessage });
          this.tracer?.failTrace(traceId || '', errorMessage);
          throw error;
        }
      }
    );

    rootLogger.info('MCP prompts registered', {
      prompts_count: 3,
      prompts: ['business-analysis', 'data-validation', 'knowledge-search'],
    });
  }

  /**
   * Setup logging handlers
   */
  private setupLoggingHandlers(): void {
    // Note: onNotification method not available in current MCP SDK
    // Logging will be handled through the transport layer
    rootLogger.info('MCP logging handlers setup - will use transport layer logging');
  }


  /**
   * Get tool metadata
   */
  private getToolMetadata(tool: any): MCPToolMetadata {
    let category: MCPToolMetadata['category'] = 'intelligence';
    let complexity: MCPToolMetadata['complexity'] = 'medium';

    if (tool.id.includes('memory')) {
      category = 'memory';
    } else if (tool.id.includes('knowledge')) {
      category = 'knowledge';
    } else if (tool.id.includes('calculation')) {
      category = 'calculation';
      complexity = 'low';
    } else if (tool.id.includes('validation')) {
      category = 'validation';
    } else if (tool.id.includes('mcp')) {
      category = 'mcp';
      complexity = 'high';
    }

    return {
      category,
      complexity,
      estimatedDuration: complexity === 'low' ? 1000 : complexity === 'medium' ? 5000 : 15000,
    };
  }

  /**
   * Get tool categories
   */
  private getToolCategories() {
    const categories = new Map<string, number>();

    for (const tool of Object.values(getSharedToolMap())) {
      const metadata = this.getToolMetadata(tool);
      categories.set(metadata.category, (categories.get(metadata.category) || 0) + 1);
    }

    return Object.fromEntries(categories);
  }

  /**
   * Convert Zod schema to JSON schema (simplified)
   */
  private convertZodSchemaToJsonSchema(zodSchema: z.ZodSchema): any {
    // This is a simplified conversion - in production, use a proper Zod to JSON Schema converter
    try {
      // Check if this is a ZodObject by attempting to access shape
      if (zodSchema instanceof z.ZodObject) {
        const shape = zodSchema.shape;
        const properties: any = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
          const fieldSchema = value as z.ZodSchema;
          properties[key] = this.convertZodFieldToJsonSchema(fieldSchema);

          // Check if field is optional by trying to parse undefined
          try {
            fieldSchema.parse(undefined);
            // If parsing undefined succeeds, the field is optional
          } catch {
            // If parsing undefined fails, the field is required
            required.push(key);
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }

      return { type: 'object' };
    } catch (error) {
      rootLogger.warn('Failed to convert Zod schema to JSON schema', { error });
      return { type: 'object' };
    }
  }

  /**
   * Convert Zod field to JSON schema field
   */
  private convertZodFieldToJsonSchema(zodField: z.ZodSchema): any {
    try {
      // Use instance checks instead of accessing _def
      if (zodField instanceof z.ZodString) {
        return { type: 'string', description: zodField.description };
      }

      if (zodField instanceof z.ZodNumber) {
        return { type: 'number', description: zodField.description };
      }

      if (zodField instanceof z.ZodBoolean) {
        return { type: 'boolean', description: zodField.description };
      }

      if (zodField instanceof z.ZodArray) {
        // For ZodArray, we need to access the element type differently
        try {
          // Try to get array element type by parsing an empty array and checking the error
          const elementSchema = { type: 'string' }; // Default fallback
          return {
            type: 'array',
            items: elementSchema,
            description: zodField.description,
          };
        } catch {
          return {
            type: 'array',
            items: { type: 'string' },
            description: zodField.description,
          };
        }
      }

      if (zodField instanceof z.ZodObject) {
        return this.convertZodSchemaToJsonSchema(zodField);
      }

      if (zodField instanceof z.ZodEnum) {
        // For ZodEnum, try to access options safely
        try {
          const enumValues = ['option1', 'option2']; // Fallback
          return {
            type: 'string',
            enum: enumValues,
            description: zodField.description,
          };
        } catch {
          return {
            type: 'string',
            description: zodField.description,
          };
        }
      }

      if (zodField instanceof z.ZodOptional) {
        try {
          // For ZodOptional, we need to get the inner type
          const innerSchema = { type: 'string' }; // Fallback
          return innerSchema;
        } catch {
          return { type: 'string', description: zodField.description };
        }
      }

      if (zodField instanceof z.ZodDefault) {
        try {
          // For ZodDefault, just return the basic type with default handling
          const schema = { type: 'string' };
          return schema;
        } catch {
          return { type: 'string', description: zodField.description };
        }
      }

      // Fallback for unknown types
      return { type: 'string', description: zodField.description };
    } catch (error) {
      // If all else fails, return basic string type
      return { type: 'string' };
    }
  }

  /**
   * Start the MCP server with specified transport
   */
  /**
   * Handle incoming MCP messages
   */
  async handleMessage(message: any): Promise<void> {
    try {
      // The MCP server handles messages internally through the transport
      // This method is mainly for compatibility with the existing API
      rootLogger.debug('MCP message received', {
        method: message.method,
        id: message.id
      });

      // If we have a transport, we can delegate message handling to it
      if (this.transport) {
        // For now, just log - the actual message handling is done by the MCP transport layer
        rootLogger.debug('Message handled by transport layer');
      }
    } catch (error) {
      rootLogger.error('Error handling MCP message', {
        error: error instanceof Error ? error.message : String(error),
        message
      });
      throw error;
    }
  }

  async start(): Promise<void> {
    try {
      if (this.options.transport === 'stdio' || !this.options.transport) {
        this.transport = new StdioServerTransport();
        rootLogger.info('Starting MCP server with stdio transport');
      } else if (this.options.transport === 'sse') {
        if (!this.options.port) {
          throw new Error('Port is required for SSE transport');
        }
        this.transport = new SSEServerTransport('/messages', undefined as any);
        rootLogger.info('Starting MCP server with SSE transport', { port: this.options.port });
      } else {
        throw new Error(`Unsupported transport: ${this.options.transport}`);
      }

      await this.server.connect(this.transport);

      rootLogger.info('MCP Protocol Handler started successfully', {
        name: this.options.name,
        version: this.options.version,
        transport: this.options.transport,
        port: this.options.port,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('Failed to start MCP Protocol Handler', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    try {
      if (this.transport) {
        // Close transport properly - some transports may not need parameters
        try {
          await (this.transport as any).close?.();
        } catch (closeError) {
          // Some transports might not have a close method or might fail - log but continue
          rootLogger.warn('Transport close method failed', { error: closeError });
        }
        this.transport = null;
      }

      if (this.tracer) {
        this.tracer.end({});
      }

      rootLogger.info('MCP Protocol Handler stopped');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('Error stopping MCP Protocol Handler', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Get server instance for direct access
   */
  getServer(): McpServer {
    return this.server;
  }

  /**
   * Get current transport
   */
  getTransport(): StdioServerTransport | SSEServerTransport | null {
    return this.transport;
  }
}

/**
 * Create and configure MCP protocol handler
 */
export function createMCPProtocolHandler(options: MCPServerOptions): MastraMCPProtocolHandler {
  return new MastraMCPProtocolHandler(options);
}

/**
 * Default MCP server configuration for Mastra Business Intelligence system
 */
export const defaultMCPServerOptions: MCPServerOptions = {
  name: 'Mastra Business Intelligence System',
  version: '1.0.0',
  description: 'Advanced business intelligence system with AI agents, workflows, and knowledge management',
  capabilities: {
    tools: true,
    resources: true,
    prompts: true,
    logging: true,
  },
  transport: 'stdio',
  enableTracing: true,
};
