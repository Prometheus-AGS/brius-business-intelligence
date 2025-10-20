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
        serverName: this.options.name,
        version: this.options.version,
        transport: this.options.transport,
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
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const traceId = this.tracer?.startTrace('list-tools', { request });

      try {
        rootLogger.debug('MCP list tools request received');

        const tools = [];

        // Add agent execution tools
        for (const [agentId, agent] of Object.entries(agents)) {
          tools.push({
            name: `execute-agent-${agentId}`,
            description: `Execute ${agentId} with business intelligence capabilities`,
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The query or request to process',
                },
                context: {
                  type: 'object',
                  description: 'Additional context for the agent execution',
                  properties: {
                    userId: { type: 'string', description: 'User identifier' },
                    sessionId: { type: 'string', description: 'Session identifier' },
                    metadata: { type: 'object', description: 'Additional metadata' },
                  },
                },
                options: {
                  type: 'object',
                  description: 'Execution options',
                  properties: {
                    maxSteps: { type: 'number', description: 'Maximum execution steps' },
                    timeout: { type: 'number', description: 'Timeout in milliseconds' },
                    streaming: { type: 'boolean', description: 'Enable streaming response' },
                  },
                },
              },
              required: ['prompt'],
            },
          });
        }

        // Add workflow execution tools
        for (const [workflowId, workflow] of Object.entries(workflows)) {
          tools.push({
            name: `execute-workflow-${workflowId}`,
            description: `Execute ${workflowId} workflow for structured business processes`,
            inputSchema: {
              type: 'object',
              properties: {
                input: {
                  type: 'object',
                  description: 'Input data for the workflow',
                },
                context: {
                  type: 'object',
                  description: 'Execution context',
                  properties: {
                    userId: { type: 'string', description: 'User identifier' },
                    traceId: { type: 'string', description: 'Trace identifier' },
                  },
                },
                options: {
                  type: 'object',
                  description: 'Workflow execution options',
                  properties: {
                    timeout: { type: 'number', description: 'Timeout in milliseconds' },
                    resumable: { type: 'boolean', description: 'Enable resumable execution' },
                  },
                },
              },
              required: ['input'],
            },
          });
        }

        // Add shared tools as MCP tools
        await ensureMcpToolsLoaded();
        const sharedTools = Object.values(getSharedToolMap());
        for (const tool of sharedTools) {
          const metadata = this.getToolMetadata(tool);
          tools.push({
            name: `tool-${tool.id}`,
            description: tool.description || `Execute ${tool.id} tool`,
            inputSchema: tool.inputSchema ? this.convertZodSchemaToJsonSchema(tool.inputSchema) : {
              type: 'object',
              properties: {},
            },
          });
        }

        rootLogger.info('MCP tools list generated', {
          tools_count: tools.length,
          agents_count: Object.keys(agents).length,
          workflows_count: Object.keys(workflows).length,
          shared_tools_count: sharedTools.length,
        });

        this.tracer?.completeTrace(traceId, { toolsCount: tools.length });

        return { tools };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP list tools error', { error: errorMessage });
        this.tracer?.failTrace(traceId, error instanceof Error ? error : new Error(errorMessage));
        throw error;
      }
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const traceId = this.tracer?.startTrace('call-tool', { toolName: name, arguments: args });

      try {
        rootLogger.info('MCP tool call request', {
          tool_name: name,
          has_arguments: Boolean(args),
          arguments_keys: args ? Object.keys(args) : [],
        });

        // Handle agent execution tools
        if (name.startsWith('execute-agent-')) {
          const agentId = name.replace('execute-agent-', '');
          const agent = agents[agentId];

          if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
          }

          const { prompt, context = {}, options = {} } = args || {};
          if (!prompt) {
            throw new Error('Prompt is required for agent execution');
          }

          rootLogger.info('Executing agent via MCP', {
            agent_id: agentId,
            prompt_length: prompt.length,
            context_keys: Object.keys(context),
          });

          // Execute agent using the configured execution function
          let result;
          if (agentId === 'business-intelligence-agent') {
            const { executeBusinessIntelligenceAgent } = await import('../agents/business-intelligence.js');
            result = await executeBusinessIntelligenceAgent({
              query: prompt,
              user_id: context.userId || 'mcp-client',
              context: context.metadata || {},
            }, {
              traceId: context.sessionId,
              userId: context.userId,
              maxSteps: options.maxSteps,
              timeout: options.timeout,
            });
          } else if (agentId === 'default-agent') {
            const { executeDefaultAgent } = await import('../agents/default.js');
            result = await executeDefaultAgent({
              query: prompt,
              user_id: context.userId || 'mcp-client',
              context: context.metadata || {},
            }, {
              traceId: context.sessionId,
              userId: context.userId,
            });
          } else {
            throw new Error(`Agent execution not implemented for ${agentId}`);
          }

          this.tracer?.completeTrace(traceId, { agentId, resultLength: JSON.stringify(result).length });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Handle workflow execution tools
        if (name.startsWith('execute-workflow-')) {
          const workflowId = name.replace('execute-workflow-', '');
          const workflow = workflows[workflowId];

          if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
          }

          const { input, context = {}, options = {} } = args || {};
          if (!input) {
            throw new Error('Input is required for workflow execution');
          }

          rootLogger.info('Executing workflow via MCP', {
            workflow_id: workflowId,
            input_keys: Object.keys(input),
            context_keys: Object.keys(context),
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
            result = await executePlanning(input, {
              traceId: context.traceId,
              userId: context.userId,
            });
          } else {
            // Generic workflow execution
            result = await workflow.execute(input);
          }

          this.tracer?.completeTrace(traceId, { workflowId, resultLength: JSON.stringify(result).length });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Handle shared tool execution
        if (name.startsWith('tool-')) {
          await ensureMcpToolsLoaded();
          const toolsMap = getSharedToolMap();
          const toolId = name.replace('tool-', '');
          const tool = toolsMap[toolId];

          if (!tool) {
            throw new Error(`Tool ${toolId} not found`);
          }

          rootLogger.info('Executing shared tool via MCP', {
            tool_id: toolId,
            has_arguments: Boolean(args),
          });

          // Execute tool with proper context
          const context = {
            userId: args?.context?.userId || 'mcp-client',
            sessionId: args?.context?.sessionId || `mcp-${Date.now()}`,
          };

          const result = await tool.execute({
            context,
            input: args || {},
          });

          this.tracer?.completeTrace(traceId, { toolId, resultLength: JSON.stringify(result).length });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        throw new Error(`Unknown tool: ${name}`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP tool call error', {
          tool_name: name,
          error: errorMessage,
          arguments: args,
        });
        this.tracer?.failTrace(traceId, error instanceof Error ? error : new Error(errorMessage));
        throw error;
      }
    });
  }

  /**
   * Setup resources protocol handlers
   */
  private setupResourcesHandlers(): void {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      const traceId = this.tracer?.startTrace('list-resources', { request });

      try {
        rootLogger.debug('MCP list resources request received');

        const resources = [];

        // Add agent resources
        for (const [agentId, agent] of Object.entries(agents)) {
          resources.push({
            uri: `mastra://agents/${agentId}`,
            name: `Agent: ${agentId}`,
            description: `Business intelligence agent for ${agentId} operations`,
            mimeType: 'application/json',
          });

          resources.push({
            uri: `mastra://agents/${agentId}/config`,
            name: `Agent Config: ${agentId}`,
            description: `Configuration and capabilities of ${agentId} agent`,
            mimeType: 'application/json',
          });
        }

        // Add workflow resources
        for (const [workflowId, workflow] of Object.entries(workflows)) {
          resources.push({
            uri: `mastra://workflows/${workflowId}`,
            name: `Workflow: ${workflowId}`,
            description: `Business process workflow for ${workflowId}`,
            mimeType: 'application/json',
          });

          resources.push({
            uri: `mastra://workflows/${workflowId}/schema`,
            name: `Workflow Schema: ${workflowId}`,
            description: `Input/output schema for ${workflowId} workflow`,
            mimeType: 'application/json',
          });
        }

        // Add system resources
        resources.push({
          uri: 'mastra://system/health',
          name: 'System Health',
          description: 'Current system health and status information',
          mimeType: 'application/json',
        });

        resources.push({
          uri: 'mastra://system/capabilities',
          name: 'System Capabilities',
          description: 'Available system capabilities and features',
          mimeType: 'application/json',
        });

        resources.push({
          uri: 'mastra://tools/catalog',
          name: 'Tools Catalog',
          description: 'Complete catalog of available tools and their capabilities',
          mimeType: 'application/json',
        });

        // Add knowledge base resources
        resources.push({
          uri: 'mastra://knowledge/status',
          name: 'Knowledge Base Status',
          description: 'Current status and statistics of the knowledge base',
          mimeType: 'application/json',
        });

        rootLogger.info('MCP resources list generated', {
          resources_count: resources.length,
          agents_count: Object.keys(agents).length,
          workflows_count: Object.keys(workflows).length,
        });

        this.tracer?.completeTrace(traceId, { resourcesCount: resources.length });

        return { resources };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP list resources error', { error: errorMessage });
        this.tracer?.failTrace(traceId, error instanceof Error ? error : new Error(errorMessage));
        throw error;
      }
    });

    // Read resource handler
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const traceId = this.tracer?.startTrace('read-resource', { uri });

      try {
        rootLogger.info('MCP read resource request', { uri });

        if (uri.startsWith('mastra://agents/')) {
          return await this.handleAgentResource(uri);
        }

        if (uri.startsWith('mastra://workflows/')) {
          return await this.handleWorkflowResource(uri);
        }

        if (uri.startsWith('mastra://system/')) {
          return await this.handleSystemResource(uri);
        }

        if (uri.startsWith('mastra://tools/')) {
          return await this.handleToolsResource(uri);
        }

        if (uri.startsWith('mastra://knowledge/')) {
          return await this.handleKnowledgeResource(uri);
        }

        throw new Error(`Unknown resource URI: ${uri}`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP read resource error', { uri, error: errorMessage });
        this.tracer?.failTrace(traceId, error instanceof Error ? error : new Error(errorMessage));
        throw error;
      }
    });
  }

  /**
   * Setup prompts protocol handlers
   */
  private setupPromptsHandlers(): void {
    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      const traceId = this.tracer?.startTrace('list-prompts', { request });

      try {
        rootLogger.debug('MCP list prompts request received');

        const prompts = [
          {
            name: 'business-analysis',
            description: 'Perform comprehensive business analysis with data insights',
            arguments: [
              {
                name: 'query',
                description: 'The business question or analysis request',
                required: true,
              },
              {
                name: 'context',
                description: 'Additional business context or constraints',
                required: false,
              },
            ],
          },
          {
            name: 'data-validation',
            description: 'Validate data quality and identify potential issues',
            arguments: [
              {
                name: 'data',
                description: 'Data to validate (JSON format)',
                required: true,
              },
              {
                name: 'rules',
                description: 'Specific validation rules to apply',
                required: false,
              },
            ],
          },
          {
            name: 'knowledge-search',
            description: 'Search business knowledge base for relevant information',
            arguments: [
              {
                name: 'query',
                description: 'Search query for knowledge base',
                required: true,
              },
              {
                name: 'category',
                description: 'Optional category filter',
                required: false,
              },
            ],
          },
        ];

        this.tracer?.completeTrace(traceId, { promptsCount: prompts.length });

        return { prompts };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP list prompts error', { error: errorMessage });
        this.tracer?.failTrace(traceId, error instanceof Error ? error : new Error(errorMessage));
        throw error;
      }
    });

    // Get prompt handler
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const traceId = this.tracer?.startTrace('get-prompt', { promptName: name, arguments: args });

      try {
        rootLogger.info('MCP get prompt request', { prompt_name: name, arguments: args });

        let messages;

        switch (name) {
          case 'business-analysis':
            const query = args?.query;
            const context = args?.context || {};
            messages = [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Please perform a comprehensive business analysis for the following query:

Query: ${query}

${Object.keys(context).length > 0 ? `Additional Context:
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
            break;

          case 'data-validation':
            const data = args?.data;
            const rules = args?.rules || [];
            messages = [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Please validate the following data and identify any quality issues:

Data: ${JSON.stringify(data, null, 2)}

${rules.length > 0 ? `Validation Rules:
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
            break;

          case 'knowledge-search':
            const searchQuery = args?.query;
            const category = args?.category;
            messages = [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Please search the knowledge base for information about:

Query: ${searchQuery}

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
            break;

          default:
            throw new Error(`Unknown prompt: ${name}`);
        }

        this.tracer?.completeTrace(traceId, { promptName: name, messagesCount: messages.length });

        return { messages };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP get prompt error', { prompt_name: name, error: errorMessage });
        this.tracer?.failTrace(traceId, error instanceof Error ? error : new Error(errorMessage));
        throw error;
      }
    });
  }

  /**
   * Setup logging handlers
   */
  private setupLoggingHandlers(): void {
    this.server.onNotification('notifications/message', async (params) => {
      rootLogger.info('MCP client message', {
        level: params.level,
        message: params.data,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Handle agent resource requests
   */
  private async handleAgentResource(uri: string) {
    const parts = uri.replace('mastra://agents/', '').split('/');
    const agentId = parts[0];
    const subResource = parts[1];

    const agent = agents[agentId];
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (subResource === 'config') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              id: agentId,
              name: agent.name,
              instructions: agent.instructions,
              model: agent.model ? {
                provider: agent.model.provider,
                modelId: agent.model.modelId,
              } : null,
              tools: agent.tools?.map(tool => ({
                id: tool.id,
                name: tool.name,
                description: tool.description,
              })) || [],
              capabilities: {
                memory: Boolean(agent.memory),
                tools: Boolean(agent.tools?.length),
                streaming: true,
              },
            }, null, 2),
          },
        ],
      };
    } else {
      return {
        contents: [
          {
            uri,
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
                memory: Boolean(agent.memory),
                tools: Boolean(agent.tools?.length),
                streaming: true,
              },
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * Handle workflow resource requests
   */
  private async handleWorkflowResource(uri: string) {
    const parts = uri.replace('mastra://workflows/', '').split('/');
    const workflowId = parts[0];
    const subResource = parts[1];

    const workflow = workflows[workflowId];
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (subResource === 'schema') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              id: workflowId,
              inputSchema: workflow.triggerSchema ? this.convertZodSchemaToJsonSchema(workflow.triggerSchema) : null,
              steps: workflow.steps?.map((step, index) => ({
                id: step.id,
                description: step.description,
                stepNumber: index + 1,
              })) || [],
            }, null, 2),
          },
        ],
      };
    } else {
      return {
        contents: [
          {
            uri,
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
    }
  }

  /**
   * Handle system resource requests
   */
  private async handleSystemResource(uri: string) {
    const resource = uri.replace('mastra://system/', '');

    switch (resource) {
      case 'health':
        const { healthInfo } = await import('../index.js');
        return {
          contents: [
            {
              uri,
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

      case 'capabilities':
        await ensureMcpToolsLoaded();
        return {
          contents: [
            {
              uri,
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

      default:
        throw new Error(`Unknown system resource: ${resource}`);
    }
  }

  /**
   * Handle tools resource requests
   */
  private async handleToolsResource(uri: string) {
    const resource = uri.replace('mastra://tools/', '');

    switch (resource) {
      case 'catalog':
        await ensureMcpToolsLoaded();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({
                tools: Object.values(getSharedToolMap()).map(tool => ({
                  id: tool.id,
                  name: tool.name,
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

      default:
        throw new Error(`Unknown tools resource: ${resource}`);
    }
  }

  /**
   * Handle knowledge resource requests
   */
  private async handleKnowledgeResource(uri: string) {
    const resource = uri.replace('mastra://knowledge/', '');

    switch (resource) {
      case 'status':
        return {
          contents: [
            {
              uri,
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

      default:
        throw new Error(`Unknown knowledge resource: ${resource}`);
    }
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
      if (zodSchema._def.typeName === 'ZodObject') {
        const shape = zodSchema._def.shape();
        const properties: any = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
          const fieldSchema = value as z.ZodSchema;
          properties[key] = this.convertZodFieldToJsonSchema(fieldSchema);

          if (!fieldSchema.isOptional()) {
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
    const def = zodField._def;

    switch (def.typeName) {
      case 'ZodString':
        return { type: 'string', description: def.description };
      case 'ZodNumber':
        return { type: 'number', description: def.description };
      case 'ZodBoolean':
        return { type: 'boolean', description: def.description };
      case 'ZodArray':
        return {
          type: 'array',
          items: this.convertZodFieldToJsonSchema(def.type),
          description: def.description,
        };
      case 'ZodObject':
        return this.convertZodSchemaToJsonSchema(zodField);
      case 'ZodEnum':
        return {
          type: 'string',
          enum: def.values,
          description: def.description,
        };
      case 'ZodOptional':
        return this.convertZodFieldToJsonSchema(def.innerType);
      case 'ZodDefault':
        const schema = this.convertZodFieldToJsonSchema(def.innerType);
        schema.default = def.defaultValue();
        return schema;
      default:
        return { type: 'string', description: def.description };
    }
  }

  /**
   * Start the MCP server with specified transport
   */
  async start(): Promise<void> {
    try {
      if (this.options.transport === 'stdio' || !this.options.transport) {
        this.transport = new StdioServerTransport();
        rootLogger.info('Starting MCP server with stdio transport');
      } else if (this.options.transport === 'sse') {
        if (!this.options.port) {
          throw new Error('Port is required for SSE transport');
        }
        this.transport = new SSEServerTransport('/sse', this.server);
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
        await this.transport.close();
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
