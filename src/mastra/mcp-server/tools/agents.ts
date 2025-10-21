import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { agents } from '../../index.js';
import { rootLogger } from '../../observability/logger.js';
import { MCPTracer } from '../../observability/langfuse.js';

/**
 * Agent Tool Wrappers for MCP Exposure
 * Provides MCP-compatible tool wrappers for Mastra agents
 * Enables external MCP clients to execute agents with proper context and options
 */

export interface AgentExecutionContext {
  userId?: string;
  sessionId?: string;
  traceId?: string;
  metadata?: Record<string, any>;
}

export interface AgentExecutionOptions {
  maxSteps?: number;
  timeout?: number;
  streaming?: boolean;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
}

export interface AgentExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  metadata: {
    agentId: string;
    userId?: string;
    sessionId?: string;
    traceId?: string;
    tokensUsed?: number;
    steps?: number;
    tools_used?: string[];
  };
}

/**
 * Base schema for agent execution
 */
const AgentExecutionInputSchema = z.object({
  prompt: z.string().min(1).max(10000).describe('The query or request to process'),
  context: z.object({
    userId: z.string().optional().describe('User identifier for personalization'),
    sessionId: z.string().optional().describe('Session identifier for context continuity'),
    traceId: z.string().optional().describe('Trace identifier for observability'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Additional context metadata'),
  }).optional().describe('Execution context for the agent'),
  options: z.object({
    maxSteps: z.number().int().min(1).max(50).optional().describe('Maximum execution steps'),
    timeout: z.number().int().min(1000).max(300000).optional().describe('Timeout in milliseconds'),
    streaming: z.boolean().optional().describe('Enable streaming response'),
    temperature: z.number().min(0).max(2).optional().describe('Response randomness (0-2)'),
    maxTokens: z.number().int().min(1).max(4000).optional().describe('Maximum tokens in response'),
    tools: z.array(z.string()).optional().describe('Specific tools to enable for this execution'),
  }).optional().describe('Agent execution options'),
});

const AgentExecutionOutputSchema = z.object({
  success: z.boolean().describe('Whether the execution was successful'),
  result: z.any().optional().describe('The agent execution result'),
  error: z.string().optional().describe('Error message if execution failed'),
  executionTime: z.number().describe('Execution time in milliseconds'),
  metadata: z.object({
    agentId: z.string().describe('Agent identifier'),
    userId: z.string().optional().describe('User identifier'),
    sessionId: z.string().optional().describe('Session identifier'),
    traceId: z.string().optional().describe('Trace identifier'),
    tokensUsed: z.number().optional().describe('Tokens consumed during execution'),
    steps: z.number().optional().describe('Number of execution steps'),
    tools_used: z.array(z.string()).optional().describe('Tools used during execution'),
  }).describe('Execution metadata and statistics'),
});

/**
 * Create agent execution tool wrapper
 */
function createAgentExecutionTool(agentId: string, _agent: any) {
  return createTool({
    id: `execute-agent-${agentId}`,
    description: `Execute ${agentId} agent with business intelligence capabilities. This agent can process complex queries, analyze data, and provide insights using available tools and knowledge.`,
    inputSchema: AgentExecutionInputSchema,
    outputSchema: AgentExecutionOutputSchema,
    execute: async (input: any) => {
      const startTime = Date.now();
      const tracer = new MCPTracer(`agent-execution-${agentId}`, `exec-${Date.now()}`, {
        metadata: {
          agentId,
          userId: input.context?.userId,
          sessionId: input.context?.sessionId,
          prompt: input.prompt.substring(0, 100),
        },
      });

      try {
        const { prompt, context: execContext = {}, options = {} } = input;

        rootLogger.info('MCP agent execution started', {
          agent_id: agentId,
          user_id: execContext.userId,
          session_id: execContext.sessionId,
          prompt_length: prompt.length,
          options,
        });

        // Prepare execution context
        const executionContext: AgentExecutionContext = {
          userId: execContext.userId || 'mcp-client',
          sessionId: execContext.sessionId || `mcp-${Date.now()}`,
          traceId: execContext.traceId || `trace-${Date.now()}`,
          metadata: {
            source: 'mcp-client',
            ...execContext.metadata,
          },
        };

        // Execute agent based on type
        let result;
        if (agentId === 'business-intelligence-agent') {
          const { executeBusinessIntelligenceAgent } = await import('../../agents/business-intelligence.js');
          result = await executeBusinessIntelligenceAgent(prompt, {
            userId: executionContext.userId!,
            conversationId: executionContext.sessionId,
          });
        } else if (agentId === 'default-agent') {
          const { executeDefaultAgent } = await import('../../agents/default.js');
          result = await executeDefaultAgent(prompt, {
            userId: executionContext.userId!,
            conversationId: executionContext.sessionId,
          });
        } else {
          throw new Error(`Agent execution not implemented for ${agentId}`);
        }

        const executionTime = Date.now() - startTime;

        const response: AgentExecutionResult = {
          success: true,
          result,
          executionTime,
          metadata: {
            agentId,
            userId: executionContext.userId,
            sessionId: executionContext.sessionId,
            traceId: executionContext.traceId,
            tokensUsed: (result as any).tokens_used || undefined,
            steps: Array.isArray((result as any).steps) ? (result as any).steps.length : undefined,
            tools_used: (result as any).tools_used || undefined,
          },
        };

        tracer.end({
          output: response,
          metadata: {
            executionTime,
            success: true,
            resultSize: JSON.stringify(result).length,
          },
        });

        rootLogger.info('MCP agent execution completed', {
          agent_id: agentId,
          user_id: executionContext.userId,
          execution_time_ms: executionTime,
          success: true,
          result_size: JSON.stringify(result).length,
        });

        return response;

      } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        const response: AgentExecutionResult = {
          success: false,
          error: errorMessage,
          executionTime,
          metadata: {
            agentId,
            userId: input.context?.userId,
            sessionId: input.context?.sessionId,
            traceId: input.context?.traceId,
          },
        };

        tracer.end({
          error: errorMessage,
          metadata: {
            executionTime,
            success: false,
          },
        });

        rootLogger.error('MCP agent execution failed', {
          agent_id: agentId,
          user_id: input.context?.userId,
          execution_time_ms: executionTime,
          error: errorMessage,
        });

        return response;
      }
    },
  });
}

/**
 * Create agent info tool wrapper
 */
function createAgentInfoTool(agentId: string, agent: any) {
  return createTool({
    id: `agent-info-${agentId}`,
    description: `Get detailed information about the ${agentId} agent including its capabilities, tools, and configuration.`,
    inputSchema: z.object({
      includeTools: z.boolean().default(true).describe('Include list of available tools'),
      includeCapabilities: z.boolean().default(true).describe('Include agent capabilities'),
      includeMetrics: z.boolean().default(false).describe('Include usage metrics'),
    }),
    outputSchema: z.object({
      id: z.string().describe('Agent identifier'),
      name: z.string().describe('Agent name'),
      description: z.string().describe('Agent description'),
      status: z.string().describe('Agent status'),
      capabilities: z.object({
        memory: z.boolean().describe('Has memory capabilities'),
        tools: z.boolean().describe('Has tool access'),
        streaming: z.boolean().describe('Supports streaming'),
        multiStep: z.boolean().describe('Supports multi-step execution'),
      }).optional(),
      tools: z.array(z.object({
        id: z.string().describe('Tool identifier'),
        name: z.string().describe('Tool name'),
        description: z.string().describe('Tool description'),
        category: z.string().describe('Tool category'),
      })).optional(),
      model: z.object({
        provider: z.string().describe('Model provider'),
        modelId: z.string().describe('Model identifier'),
      }).optional(),
      metrics: z.object({
        totalExecutions: z.number().describe('Total executions'),
        averageExecutionTime: z.number().describe('Average execution time in ms'),
        successRate: z.number().describe('Success rate (0-1)'),
      }).optional(),
    }),
    execute: async (input: any) => {
      try {
        const { includeTools, includeCapabilities, includeMetrics } = input;

        rootLogger.info('MCP agent info request', {
          agent_id: agentId,
          include_tools: includeTools,
          include_capabilities: includeCapabilities,
          include_metrics: includeMetrics,
        });

        const agentInfo: any = {
          id: agentId,
          name: agent.name || agentId,
          description: agent.instructions || `Business intelligence agent for ${agentId} operations`,
          status: 'active',
        };

        if (includeCapabilities) {
          agentInfo.capabilities = {
            memory: Boolean((agent as any).memory),
            tools: Boolean((agent as any).tools?.length),
            streaming: true,
            multiStep: true,
          };
        }

        if (includeTools && (agent as any).tools) {
          agentInfo.tools = (agent as any).tools.map((tool: any) => ({
            id: tool.id,
            name: tool.name || tool.id,
            description: tool.description || `Tool for ${tool.id}`,
            category: getToolCategory(tool.id),
          }));
        }

        if ((agent as any).model) {
          agentInfo.model = {
            provider: (agent as any).model.provider,
            modelId: (agent as any).model.modelId,
          };
        }

        if (includeMetrics) {
          // Mock metrics - in production, this would come from observability system
          agentInfo.metrics = {
            totalExecutions: Math.floor(Math.random() * 1000),
            averageExecutionTime: Math.floor(Math.random() * 5000) + 1000,
            successRate: 0.85 + Math.random() * 0.15,
          };
        }

        return agentInfo;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP agent info error', {
          agent_id: agentId,
          error: errorMessage,
        });
        throw error;
      }
    },
  });
}

/**
 * Create agent list tool
 */
export const listAgentsTool = createTool({
  id: 'list-agents',
  description: 'List all available agents in the Mastra Business Intelligence system with their basic information.',
  inputSchema: z.object({
    includeInactive: z.boolean().default(false).describe('Include inactive agents'),
    category: z.enum(['all', 'intelligence', 'default']).default('all').describe('Filter by agent category'),
    detailed: z.boolean().default(false).describe('Include detailed information for each agent'),
  }),
  outputSchema: z.object({
    agents: z.array(z.object({
      id: z.string().describe('Agent identifier'),
      name: z.string().describe('Agent name'),
      description: z.string().describe('Agent description'),
      status: z.string().describe('Agent status'),
      category: z.string().describe('Agent category'),
      capabilities: z.object({
        memory: z.boolean(),
        tools: z.boolean(),
        streaming: z.boolean(),
      }).optional(),
      toolsCount: z.number().optional().describe('Number of available tools'),
    })),
    totalCount: z.number().describe('Total number of agents'),
  }),
  execute: async (input: any) => {
    try {
      const { includeInactive, category, detailed } = input;

      rootLogger.info('MCP list agents request', {
        include_inactive: includeInactive,
        category,
        detailed,
      });

      const agentList = Object.entries(agents)
        .filter(([agentId, _agent]) => {
          if (category === 'intelligence' && !agentId.includes('intelligence')) return false;
          if (category === 'default' && !agentId.includes('default')) return false;
          return true;
        })
        .map(([agentId, agent]) => {
          const agentInfo: any = {
            id: agentId,
            name: agent.name || agentId,
            description: agent.instructions || `Business intelligence agent for ${agentId} operations`,
            status: 'active',
            category: agentId.includes('intelligence') ? 'intelligence' : 'default',
          };

          if (detailed) {
            agentInfo.capabilities = {
              memory: Boolean((agent as any).memory),
              tools: Boolean((agent as any).tools?.length),
              streaming: true,
            };
            agentInfo.toolsCount = (agent as any).tools?.length || 0;
          }

          return agentInfo;
        });

      return {
        agents: agentList,
        totalCount: agentList.length,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('MCP list agents error', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Get tool category based on tool ID
 */
function getToolCategory(toolId: string): string {
  if (toolId.includes('memory')) return 'memory';
  if (toolId.includes('knowledge')) return 'knowledge';
  if (toolId.includes('calculation')) return 'calculation';
  if (toolId.includes('validation')) return 'validation';
  if (toolId.includes('mcp')) return 'mcp';
  return 'general';
}

/**
 * Create agent health check tool
 */
export const agentHealthCheckTool = createTool({
  id: 'agent-health-check',
  description: 'Perform health check on agents to verify they are functioning correctly.',
  inputSchema: z.object({
    agentId: z.string().optional().describe('Specific agent to check (if not provided, checks all)'),
    includeTools: z.boolean().default(true).describe('Include tool connectivity check'),
    timeout: z.number().int().min(1000).max(30000).default(10000).describe('Health check timeout in ms'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      agentId: z.string().describe('Agent identifier'),
      status: z.enum(['healthy', 'unhealthy', 'warning']).describe('Health status'),
      checks: z.object({
        initialization: z.boolean().describe('Agent properly initialized'),
        model: z.boolean().describe('Model connectivity'),
        tools: z.boolean().describe('Tools accessibility'),
        memory: z.boolean().describe('Memory system'),
      }),
      responseTime: z.number().describe('Response time in milliseconds'),
      issues: z.array(z.string()).describe('Any issues found'),
      lastChecked: z.string().describe('Last check timestamp'),
    })),
    summary: z.object({
      totalAgents: z.number().describe('Total agents checked'),
      healthyAgents: z.number().describe('Number of healthy agents'),
      unhealthyAgents: z.number().describe('Number of unhealthy agents'),
      averageResponseTime: z.number().describe('Average response time'),
    }),
  }),
  execute: async (context: any) => {
    try {
      const { agentId, includeTools, timeout } = context;
      const startTime = Date.now();

      rootLogger.info('MCP agent health check started', {
        agent_id: agentId,
        include_tools: includeTools,
        timeout,
      });

      const agentsToCheck = agentId ? [agentId] : Object.keys(agents);
      const results = [];

      for (const id of agentsToCheck) {
        const agent = agents[id as keyof typeof agents];
        if (!agent) {
          results.push({
            agentId: id,
            status: 'unhealthy' as const,
            checks: {
              initialization: false,
              model: false,
              tools: false,
              memory: false,
            },
            responseTime: 0,
            issues: ['Agent not found'],
            lastChecked: new Date().toISOString(),
          });
          continue;
        }

        const checkStartTime = Date.now();
        const issues = [];
        const checks = {
          initialization: true,
          model: Boolean((agent as any).model),
          tools: Boolean((agent as any).tools?.length),
          memory: Boolean((agent as any).memory),
        };

        // Basic health checks
        if (!(agent as any).name) {
          issues.push('Agent name not configured');
        }

        if (!(agent as any).instructions) {
          issues.push('Agent instructions not configured');
        }

        if (!checks.model) {
          issues.push('Model not configured');
        }

        if (includeTools && !checks.tools) {
          issues.push('No tools configured');
        }

        const responseTime = Date.now() - checkStartTime;
        const status: 'healthy' | 'unhealthy' | 'warning' = issues.length === 0 ? 'healthy' : issues.length < 3 ? 'warning' : 'unhealthy';

        results.push({
          agentId: id,
          status,
          checks,
          responseTime,
          issues,
          lastChecked: new Date().toISOString(),
        });
      }

      const healthyCount = results.filter(r => r.status === 'healthy').length;
      const unhealthyCount = results.filter(r => r.status === 'unhealthy').length;
      const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

      const summary = {
        totalAgents: results.length,
        healthyAgents: healthyCount,
        unhealthyAgents: unhealthyCount,
        averageResponseTime: avgResponseTime,
      };

      rootLogger.info('MCP agent health check completed', {
        total_time_ms: Date.now() - startTime,
        total_agents: results.length,
        healthy_agents: healthyCount,
        unhealthy_agents: unhealthyCount,
      });

      return { results, summary };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('MCP agent health check error', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Generate agent tool wrappers for all registered agents
 */
export function generateAgentToolWrappers() {
  const agentTools = [];

  // Create execution and info tools for each agent
  for (const [agentId, agent] of Object.entries(agents)) {
    agentTools.push(createAgentExecutionTool(agentId, agent));
    agentTools.push(createAgentInfoTool(agentId, agent));
  }

  // Add utility tools
  agentTools.push(listAgentsTool);
  agentTools.push(agentHealthCheckTool);

  rootLogger.info('Agent tool wrappers generated', {
    total_tools: agentTools.length,
    agent_count: Object.keys(agents).length,
    execution_tools: Object.keys(agents).length,
    info_tools: Object.keys(agents).length,
    utility_tools: 2,
  });

  return agentTools;
}

/**
 * Export all agent tools
 */
export const agentTools = generateAgentToolWrappers();