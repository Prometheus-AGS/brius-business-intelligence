import { Request, Response } from 'express';
import { z } from 'zod';
import { mcpToolRegistry, ToolExecutionRequest } from '../../mcp/registry.js';
import { mcpToolMapper } from '../../mcp/tool-mapper.js';
import { mcpClient } from '../../mcp/client.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Playground API Endpoints for Tool Testing
 * Provides REST API endpoints for discovering, inspecting, and executing MCP tools
 * Enables interactive testing and exploration of available tools
 */

// Validation schemas
const ExecuteToolSchema = z.object({
  toolId: z.string().min(1),
  arguments: z.record(z.any()),
  metadata: z.object({
    sessionId: z.string().optional(),
    source: z.enum(['playground', 'agent', 'api']).default('playground'),
  }).optional().default({}),
});

const ToolFilterSchema = z.object({
  namespace: z.string().optional(),
  category: z.string().optional(),
  serverId: z.string().optional(),
  isAvailable: z.boolean().optional(),
  health: z.enum(['healthy', 'degraded', 'unavailable']).optional(),
  tags: z.array(z.string()).optional(),
  searchQuery: z.string().optional(),
});

/**
 * Get all available tools
 * GET /api/playground/tools
 */
export async function getAllTools(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/tools', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Parse query filters
    const filterValidation = ToolFilterSchema.safeParse(req.query);
    if (!filterValidation.success) {
      tracer.recordValidation(false, filterValidation.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid filter parameters',
          type: 'validation_error',
          code: 'invalid_query',
          details: filterValidation.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const filters = filterValidation.data;

    apiLogger.info('Getting all playground tools', {
      user_id: req.user?.userId,
      filters,
      trace_id: tracer.getTraceId(),
    });

    // Get filtered tools
    const tools = mcpToolRegistry.getAllTools(filters);

    // Get additional metadata
    const stats = mcpToolRegistry.getStats();
    const namespaces = mcpToolRegistry.getNamespaces();

    const response = {
      success: true,
      data: {
        tools,
        total_tools: tools.length,
        stats,
        namespaces,
        filters_applied: filters,
      },
      message: `Retrieved ${tools.length} tools`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tools retrieved successfully', {
      user_id: req.user?.userId,
      tools_count: tools.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get tools', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve tools',
        type: 'internal_server_error',
        code: 'tools_retrieval_error',
      },
    });
  }
}

/**
 * Get tool by ID
 * GET /api/playground/tools/:id
 */
export async function getToolById(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/tools/${req.params.id}`, 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const toolId = req.params.id;
    if (!toolId) {
      res.status(400).json({
        error: {
          message: 'Tool ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing tool ID'), 400);
      return;
    }

    apiLogger.info('Getting tool by ID', {
      user_id: req.user?.userId,
      tool_id: toolId,
      trace_id: tracer.getTraceId(),
    });

    const tool = mcpToolRegistry.getTool(toolId);
    if (!tool) {
      res.status(404).json({
        error: {
          message: 'Tool not found',
          type: 'not_found_error',
          code: 'tool_not_found',
        },
      });
      tracer.fail(new Error('Tool not found'), 404);
      return;
    }

    // Get execution history
    const executionHistory = mcpToolRegistry.getExecutionHistory(toolId, 10);

    // Get tool examples
    const examples = mcpToolRegistry.getToolExamples(toolId);

    const response = {
      success: true,
      data: {
        tool,
        execution_history: executionHistory,
        examples,
      },
      message: 'Tool retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool retrieved successfully', {
      user_id: req.user?.userId,
      tool_id: toolId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get tool', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve tool',
        type: 'internal_server_error',
        code: 'tool_retrieval_error',
      },
    });
  }
}

/**
 * Execute tool
 * POST /api/playground/tools/:id/execute
 */
export async function executeTool(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/tools/${req.params.id}/execute`, 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const toolId = req.params.id;
    if (!toolId) {
      res.status(400).json({
        error: {
          message: 'Tool ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing tool ID'), 400);
      return;
    }

    // Validate request body
    const validationResult = ExecuteToolSchema.safeParse({
      toolId,
      ...req.body,
    });

    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid execution request',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const executionRequest: ToolExecutionRequest = {
      ...validationResult.data,
      metadata: {
        ...validationResult.data.metadata,
        userId: req.user?.userId,
      },
    };

    apiLogger.info('Executing tool from playground', {
      user_id: req.user?.userId,
      tool_id: toolId,
      arguments: executionRequest.arguments,
      trace_id: tracer.getTraceId(),
    });

    // Execute the tool
    const result = await mcpToolRegistry.executeTool(executionRequest);

    const response = {
      success: true,
      data: result,
      message: 'Tool executed successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool executed successfully from playground', {
      user_id: req.user?.userId,
      tool_id: toolId,
      execution_id: result.id,
      success: result.success,
      execution_time_ms: result.executionTime,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    apiLogger.error('Failed to execute tool', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Tool execution failed',
        type: 'execution_error',
        code: 'tool_execution_failed',
        details: {
          error_message: errorMessage,
        },
      },
    });
  }
}

/**
 * Get tool execution history
 * GET /api/playground/tools/:id/history
 */
export async function getToolHistory(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/tools/${req.params.id}/history`, 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const toolId = req.params.id;
    if (!toolId) {
      res.status(400).json({
        error: {
          message: 'Tool ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing tool ID'), 400);
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    apiLogger.info('Getting tool execution history', {
      user_id: req.user?.userId,
      tool_id: toolId,
      limit,
      trace_id: tracer.getTraceId(),
    });

    // Check if tool exists
    const tool = mcpToolRegistry.getTool(toolId);
    if (!tool) {
      res.status(404).json({
        error: {
          message: 'Tool not found',
          type: 'not_found_error',
          code: 'tool_not_found',
        },
      });
      tracer.fail(new Error('Tool not found'), 404);
      return;
    }

    const history = mcpToolRegistry.getExecutionHistory(toolId, limit);

    const response = {
      success: true,
      data: {
        tool_id: toolId,
        tool_name: tool.displayName,
        history,
        total_executions: tool.metadata.executionCount,
        success_rate: tool.metadata.successRate,
        average_execution_time: tool.metadata.averageExecutionTime,
      },
      message: `Retrieved ${history.length} execution records`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool execution history retrieved', {
      user_id: req.user?.userId,
      tool_id: toolId,
      history_count: history.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get tool history', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve tool history',
        type: 'internal_server_error',
        code: 'history_retrieval_error',
      },
    });
  }
}

/**
 * Get tools by namespace
 * GET /api/playground/namespaces/:namespace/tools
 */
export async function getToolsByNamespace(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/namespaces/${req.params.namespace}/tools`, 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const namespace = req.params.namespace;
    if (!namespace) {
      res.status(400).json({
        error: {
          message: 'Namespace is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing namespace'), 400);
      return;
    }

    apiLogger.info('Getting tools by namespace', {
      user_id: req.user?.userId,
      namespace,
      trace_id: tracer.getTraceId(),
    });

    const tools = mcpToolRegistry.getToolsByNamespace(namespace);
    const namespaceInfo = mcpToolRegistry.getNamespaces().find(ns => ns.id === namespace);

    const response = {
      success: true,
      data: {
        namespace: namespaceInfo,
        tools,
        tools_count: tools.length,
      },
      message: `Retrieved ${tools.length} tools from namespace ${namespace}`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tools by namespace retrieved', {
      user_id: req.user?.userId,
      namespace,
      tools_count: tools.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get tools by namespace', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve tools by namespace',
        type: 'internal_server_error',
        code: 'namespace_tools_error',
      },
    });
  }
}

/**
 * Search tools
 * GET /api/playground/tools/search
 */
export async function searchTools(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/tools/search', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const query = req.query.q as string;
    if (!query || query.trim().length === 0) {
      res.status(400).json({
        error: {
          message: 'Search query is required',
          type: 'validation_error',
          code: 'missing_query',
        },
      });
      tracer.fail(new Error('Missing search query'), 400);
      return;
    }

    apiLogger.info('Searching tools', {
      user_id: req.user?.userId,
      query: query.substring(0, 100),
      trace_id: tracer.getTraceId(),
    });

    const tools = mcpToolRegistry.searchTools(query);

    const response = {
      success: true,
      data: {
        query,
        tools,
        results_count: tools.length,
      },
      message: `Found ${tools.length} tools matching "${query}"`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool search completed', {
      user_id: req.user?.userId,
      query: query.substring(0, 50),
      results_count: tools.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to search tools', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to search tools',
        type: 'internal_server_error',
        code: 'search_error',
      },
    });
  }
}

/**
 * Get playground statistics
 * GET /api/playground/stats
 */
export async function getPlaygroundStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/stats', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Getting playground statistics', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get registry stats
    const registryStats = mcpToolRegistry.getStats();

    // Get connection stats
    const connections = mcpClient.getAllConnections();
    const connectedServers = mcpClient.getConnectedServers();

    // Get tool mapper stats
    const allMappedTools = mcpToolMapper.getAllMappedTools();
    const namespaces = mcpToolMapper.getAllNamespaces();

    const response = {
      success: true,
      data: {
        registry: registryStats,
        connections: {
          total_connections: connections.length,
          connected_servers: connectedServers.length,
          connection_details: connections.map(conn => ({
            server_id: conn.serverId,
            status: conn.status,
            tools_count: conn.tools.length,
            last_activity: conn.lastActivity,
          })),
        },
        tools: {
          total_mapped: allMappedTools.length,
          namespaces_count: namespaces.length,
          by_category: allMappedTools.reduce((acc, tool) => {
            const category = tool.metadata.category || 'general';
            acc[category] = (acc[category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        },
      },
      message: 'Playground statistics retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Playground statistics retrieved', {
      user_id: req.user?.userId,
      total_tools: registryStats.totalTools,
      connected_servers: connectedServers.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get playground stats', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve playground statistics',
        type: 'internal_server_error',
        code: 'stats_error',
      },
    });
  }
}

/**
 * Refresh tool registry
 * POST /api/playground/refresh
 */
export async function refreshToolRegistry(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/refresh', 'POST', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Refreshing tool registry', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    // Refresh the registry
    await mcpToolRegistry.refresh();

    // Get updated stats
    const stats = mcpToolRegistry.getStats();

    const response = {
      success: true,
      data: {
        refreshed_at: new Date().toISOString(),
        stats,
      },
      message: 'Tool registry refreshed successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool registry refreshed successfully', {
      user_id: req.user?.userId,
      total_tools: stats.totalTools,
      available_tools: stats.availableTools,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to refresh tool registry', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to refresh tool registry',
        type: 'internal_server_error',
        code: 'refresh_error',
      },
    });
  }
}