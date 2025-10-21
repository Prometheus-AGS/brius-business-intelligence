import { Request, Response } from 'express';
import { z } from 'zod';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';
import { getAllAvailableTools, getToolCounts } from '../../agents/shared-tools.js';
import { checkDatabaseHealth } from '../../config/consolidated-database.js';

/**
 * Playground API Endpoints for Tool Testing
 * Provides REST API endpoints for discovering, inspecting, and executing tools
 * Focuses on Mastra tools integration with MCP tools appearing through the shared tools system
 */

// Validation schemas
const ExecuteToolSchema = z.object({
  toolId: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  metadata: z.object({
    sessionId: z.string().optional(),
    source: z.enum(['playground', 'agent', 'api']).default('playground'),
  }).optional().default(() => ({ source: 'playground' as const })),
});

const ToolFilterSchema = z.object({
  namespace: z.string().optional(),
  category: z.string().optional(),
  serverId: z.string().optional(),
  isAvailable: z.boolean().optional(),
  searchQuery: z.string().optional(),
});

/**
 * Enhanced tool information for playground display
 */
interface PlaygroundToolInfo {
  id: string;
  displayName: string;
  description: string;
  namespace: string;
  category: string;
  source: 'mastra' | 'mcp' | 'bedrock';
  metadata: {
    isAvailable: boolean;
    executionCount: number;
  };
  inputSchema?: any;
  outputSchema?: any;
}

/**
 * Get tools for playground display
 */
function getPlaygroundTools(filters: any = {}): PlaygroundToolInfo[] {
  const playgroundTools: PlaygroundToolInfo[] = [];

  try {
    // Get all available tools from the shared tools system
    const allTools = getAllAvailableTools();
    
    for (const tool of allTools) {
      // Determine tool source and category
      let source: 'mastra' | 'mcp' | 'bedrock' = 'mastra';
      let namespace = 'mastra';
      let category = 'general';
      
      if (tool.id.startsWith('mcp-')) {
        source = 'mcp';
        namespace = 'mcp';
        category = 'mcp-tool';
      } else if (tool.id.includes('bedrock') || tool.id.includes('claude') || tool.id.includes('titan')) {
        source = 'bedrock';
        namespace = 'bedrock';
        category = 'bedrock-tool';
      }

      const playgroundTool: PlaygroundToolInfo = {
        id: tool.id,
        displayName: tool.id,
        description: tool.description || 'No description available',
        namespace,
        category,
        source,
        metadata: {
          isAvailable: true,
          executionCount: 0,
        },
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      };

      // Apply filters
      if (filters.namespace && playgroundTool.namespace !== filters.namespace) {
        continue;
      }
      
      if (filters.category && playgroundTool.category !== filters.category) {
        continue;
      }
      
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        if (!playgroundTool.displayName.toLowerCase().includes(query) &&
            !playgroundTool.description.toLowerCase().includes(query)) {
          continue;
        }
      }

      playgroundTools.push(playgroundTool);
    }

    return playgroundTools;

  } catch (error) {
    apiLogger.error('Failed to get playground tools', {
      error: error instanceof Error ? error.message : String(error),
      filters,
    });
    return [];
  }
}

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

    // Get tools
    const tools = getPlaygroundTools(filters);
    const toolCounts = getToolCounts();

    // Get namespaces
    const namespaces = Array.from(new Set(tools.map(t => t.namespace))).map(ns => ({
      id: ns,
      displayName: ns,
      description: `${ns} tools`,
      toolCount: tools.filter(t => t.namespace === ns).length,
    }));

    const response = {
      success: true,
      data: {
        tools,
        total_tools: tools.length,
        stats: {
          total: tools.length,
          by_source: {
            mcp: tools.filter(t => t.source === 'mcp').length,
            bedrock: tools.filter(t => t.source === 'bedrock').length,
            mastra: tools.filter(t => t.source === 'mastra').length,
          },
          tool_counts: toolCounts,
        },
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

    // Find tool in playground tools
    const allTools = getPlaygroundTools();
    const tool = allTools.find(t => t.id === toolId);

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

    const response = {
      success: true,
      data: {
        tool,
        execution_history: [], // No history tracking for now
        examples: [],
      },
      message: 'Tool retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool retrieved successfully', {
      user_id: req.user?.userId,
      tool_id: toolId,
      tool_source: tool.source,
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

    apiLogger.info('Executing tool from playground', {
      user_id: req.user?.userId,
      tool_id: toolId,
      arguments: validationResult.data.arguments,
      trace_id: tracer.getTraceId(),
    });

    // Find and execute the tool
    const allTools = getAllAvailableTools();
    const tool = allTools.find(t => t.id === toolId);
    
    if (!tool || !tool.execute) {
      throw new Error(`Tool not found or not executable: ${toolId}`);
    }

    const startTime = Date.now();
    
    // Execute the tool - use type assertion to bypass complex context requirements for playground
    const toolResult = await (tool.execute as any)(validationResult.data.arguments);
    
    const executionTime = Date.now() - startTime;

    const result = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      success: true,
      result: toolResult,
      executionTime,
      timestamp: new Date().toISOString(),
      toolId,
      metadata: {
        serverId: 'mastra',
        toolName: toolId,
        argumentsCount: Object.keys(validationResult.data.arguments).length,
        source: validationResult.data.metadata?.source || 'playground',
        userId: req.user?.userId,
      },
    };

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
      execution_time_ms: executionTime,
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

    const allTools = getPlaygroundTools();
    const toolCounts = getToolCounts();

    // Check database health
    const dbHealth = await checkDatabaseHealth();

    const response = {
      success: true,
      data: {
        overview: {
          total_tools: allTools.length,
          mcp_tools: allTools.filter(t => t.source === 'mcp').length,
          bedrock_tools: allTools.filter(t => t.source === 'bedrock').length,
          mastra_tools: allTools.filter(t => t.source === 'mastra').length,
          available_tools: allTools.filter(t => t.metadata.isAvailable).length,
        },
        tool_counts: toolCounts,
        database: {
          healthy: dbHealth.healthy,
          pgvector_version: dbHealth.pgvectorVersion,
          connection_details: dbHealth.connectionDetails,
        },
        by_namespace: allTools.reduce((acc, tool) => {
          acc[tool.namespace] = (acc[tool.namespace] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        by_category: allTools.reduce((acc, tool) => {
          acc[tool.category] = (acc[tool.category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      message: 'Playground statistics retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Playground statistics retrieved', {
      user_id: req.user?.userId,
      total_tools: allTools.length,
      database_healthy: dbHealth.healthy,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get playground statistics', error instanceof Error ? error : new Error(String(error)));
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

    // Force refresh of shared tools cache
    const { forceRefreshTools } = await import('../../agents/shared-tools.js');
    forceRefreshTools();

    const allTools = getPlaygroundTools();
    const toolCounts = getToolCounts();

    const response = {
      success: true,
      data: {
        refreshed_at: new Date().toISOString(),
        total_tools: allTools.length,
        mcp_tools: allTools.filter(t => t.source === 'mcp').length,
        bedrock_tools: allTools.filter(t => t.source === 'bedrock').length,
        mastra_tools: allTools.filter(t => t.source === 'mastra').length,
        tool_counts: toolCounts,
      },
      message: 'Tool registry refreshed successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool registry refreshed successfully', {
      user_id: req.user?.userId,
      total_tools: allTools.length,
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

    const tools = getPlaygroundTools({ searchQuery: query });

    const response = {
      success: true,
      data: {
        query,
        tools,
        results_count: tools.length,
        by_source: {
          mcp: tools.filter(t => t.source === 'mcp').length,
          bedrock: tools.filter(t => t.source === 'bedrock').length,
          mastra: tools.filter(t => t.source === 'mastra').length,
        },
      },
      message: `Found ${tools.length} tools matching "${query}"`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool search completed', {
      user_id: req.user?.userId,
      query: query.substring(0, 100),
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