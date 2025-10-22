import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { apiLogger } from '../../observability/logger.js';
import { getAllAvailableTools, getToolCounts } from '../../agents/shared-tools.js';
import { checkDatabaseHealth } from '../../config/consolidated-database.js';

/**
 * Playground API Routes for Tool Testing
 * Provides REST API endpoints for discovering, inspecting, and executing tools
 * Focuses on Mastra tools integration with MCP tools appearing through the shared tools system
 */

// Validation schemas
const ExecuteToolSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
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
  source: 'mastra' | 'mcp' | 'bedrock' | 'supabase';
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
      let source: 'mastra' | 'mcp' | 'bedrock' | 'supabase' = 'mastra';
      let namespace = 'mastra';
      let category = 'general';

      if (tool.id.startsWith('mcp-')) {
        source = 'mcp';
        namespace = 'mcp';
        category = 'mcp-tool';
      } else if (tool.id.includes('bedrock') || tool.id.includes('claude') || tool.id.includes('titan')) {
        source = 'bedrock';
        namespace = 'bedrock';
        category = 'ai-tool';
      } else if (tool.id.startsWith('supabase-')) {
        source = 'supabase';
        namespace = 'supabase';
        category = 'database-tool';
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

export function getPlaygroundRoutes() {
  return [
    // Get all available tools
    registerApiRoute('/playground/tools', {
      method: 'GET',
      handler: async c => {
        try {
          // Parse query filters
          const filterValidation = ToolFilterSchema.safeParse({
            namespace: c.req.query('namespace'),
            category: c.req.query('category'),
            serverId: c.req.query('serverId'),
            isAvailable: c.req.query('isAvailable') === 'true' ? true : c.req.query('isAvailable') === 'false' ? false : undefined,
            searchQuery: c.req.query('searchQuery'),
          });

          if (!filterValidation.success) {
            return c.json({
              error: {
                message: 'Invalid filter parameters',
                type: 'validation_error',
                code: 'invalid_query',
                details: filterValidation.error.issues,
              },
            }, 400);
          }

          const filters = filterValidation.data;

          apiLogger.info('Getting all playground tools', {
            filters,
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
                  supabase: tools.filter(t => t.source === 'supabase').length,
                },
                tool_counts: toolCounts,
              },
              namespaces,
              filters_applied: filters,
            },
            message: `Retrieved ${tools.length} tools`,
          };

          return c.json(response);

        } catch (error) {
          apiLogger.error('Failed to get tools', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            error: {
              message: 'Failed to retrieve tools',
              type: 'internal_server_error',
              code: 'tools_retrieval_error',
            },
          }, 500);
        }
      },
    }),

    // Get tool by ID
    registerApiRoute('/playground/tools/:id', {
      method: 'GET',
      handler: async c => {
        try {
          const toolId = c.req.param('id');
          if (!toolId) {
            return c.json({
              error: {
                message: 'Tool ID is required',
                type: 'validation_error',
                code: 'missing_parameter',
              },
            }, 400);
          }

          apiLogger.info('Getting tool by ID', {
            tool_id: toolId,
          });

          // Find tool in playground tools
          const allTools = getPlaygroundTools();
          const tool = allTools.find(t => t.id === toolId);

          if (!tool) {
            return c.json({
              error: {
                message: 'Tool not found',
                type: 'not_found_error',
                code: 'tool_not_found',
              },
            }, 404);
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

          return c.json(response);

        } catch (error) {
          apiLogger.error('Failed to get tool', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            error: {
              message: 'Failed to retrieve tool',
              type: 'internal_server_error',
              code: 'tool_retrieval_error',
            },
          }, 500);
        }
      },
    }),

    // Execute tool
    registerApiRoute('/playground/tools/:id/execute', {
      method: 'POST',
      handler: async c => {
        try {
          const toolId = c.req.param('id');
          if (!toolId) {
            return c.json({
              error: {
                message: 'Tool ID is required',
                type: 'validation_error',
                code: 'missing_parameter',
              },
            }, 400);
          }

          const body = await c.req.json();

          // Validate request body
          const validationResult = ExecuteToolSchema.safeParse(body);

          if (!validationResult.success) {
            return c.json({
              error: {
                message: 'Invalid execution request',
                type: 'validation_error',
                code: 'invalid_input',
                details: validationResult.error.issues,
              },
            }, 400);
          }

          apiLogger.info('Executing tool from playground', {
            tool_id: toolId,
            arguments: validationResult.data.arguments,
          });

          // Find and execute the tool
          const allTools = getAllAvailableTools();
          const tool = allTools.find(t => t.id === toolId);

          if (!tool || !tool.execute) {
            return c.json({
              error: {
                message: `Tool not found or not executable: ${toolId}`,
                type: 'not_found_error',
                code: 'tool_not_executable',
              },
            }, 404);
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
            },
          };

          const response = {
            success: true,
            data: result,
            message: 'Tool executed successfully',
          };

          return c.json(response);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          apiLogger.error('Failed to execute tool', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            error: {
              message: 'Tool execution failed',
              type: 'execution_error',
              code: 'tool_execution_failed',
              details: {
                error_message: errorMessage,
              },
            },
          }, 500);
        }
      },
    }),

    // Get playground statistics
    registerApiRoute('/playground/stats', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('Getting playground statistics');

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
                supabase_tools: allTools.filter(t => t.source === 'supabase').length,
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

          return c.json(response);

        } catch (error) {
          apiLogger.error('Failed to get playground statistics', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            error: {
              message: 'Failed to retrieve playground statistics',
              type: 'internal_server_error',
              code: 'stats_error',
            },
          }, 500);
        }
      },
    }),

    // Search tools
    registerApiRoute('/playground/tools/search', {
      method: 'GET',
      handler: async c => {
        try {
          const query = c.req.query('q') as string;
          if (!query || query.trim().length === 0) {
            return c.json({
              error: {
                message: 'Search query is required',
                type: 'validation_error',
                code: 'missing_query',
              },
            }, 400);
          }

          apiLogger.info('Searching tools', {
            query: query.substring(0, 100),
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
                supabase: tools.filter(t => t.source === 'supabase').length,
              },
            },
            message: `Found ${tools.length} tools matching "${query}"`,
          };

          return c.json(response);

        } catch (error) {
          apiLogger.error('Failed to search tools', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            error: {
              message: 'Failed to search tools',
              type: 'internal_server_error',
              code: 'search_error',
            },
          }, 500);
        }
      },
    }),

    // Serve playground static files
    registerApiRoute('/playground', {
      method: 'GET',
      handler: async c => {
        try {
          // Fix path resolution - check if we're already in .mastra/output
          const cwd = process.cwd();
          const isInMastraOutput = cwd.endsWith('.mastra/output');
          const indexPath = isInMastraOutput
            ? join(cwd, 'playground/index.html')
            : join(cwd, '.mastra/output/playground/index.html');
            
          apiLogger.info('Attempting to serve playground index', {
            indexPath,
            exists: existsSync(indexPath),
            cwd,
            isInMastraOutput,
          });
          
          if (existsSync(indexPath)) {
            const content = readFileSync(indexPath, 'utf-8');
            return c.html(content);
          }
          return c.text(`Playground not found at ${indexPath}`, 404);
        } catch (error) {
          apiLogger.error('Failed to serve playground index', error instanceof Error ? error : new Error(String(error)));
          return c.text('Internal server error', 500);
        }
      },
    }),

    // Also serve at root for convenience
    registerApiRoute('/', {
      method: 'GET',
      handler: async c => {
        try {
          // Fix path resolution - check if we're already in .mastra/output
          const cwd = process.cwd();
          const isInMastraOutput = cwd.endsWith('.mastra/output');
          const indexPath = isInMastraOutput
            ? join(cwd, 'playground/index.html')
            : join(cwd, '.mastra/output/playground/index.html');
            
          if (existsSync(indexPath)) {
            const content = readFileSync(indexPath, 'utf-8');
            return c.html(content);
          }
          return c.text(`Playground not found at ${indexPath}`, 404);
        } catch (error) {
          apiLogger.error('Failed to serve playground index', error instanceof Error ? error : new Error(String(error)));
          return c.text('Internal server error', 500);
        }
      },
    }),

    // Serve playground assets
    registerApiRoute('/assets/*', {
      method: 'GET',
      handler: async c => {
        try {
          const assetPath = c.req.path.replace('/assets/', '');
          const cwd = process.cwd();
          const isInMastraOutput = cwd.endsWith('.mastra/output');
          const fullPath = isInMastraOutput
            ? join(cwd, 'playground/assets', assetPath)
            : join(cwd, '.mastra/output/playground/assets', assetPath);
          
          if (!existsSync(fullPath)) {
            return c.text('Asset not found', 404);
          }

          const content = readFileSync(fullPath);
          const ext = extname(fullPath).toLowerCase();
          
          // Set appropriate content type
          let contentType = 'application/octet-stream';
          switch (ext) {
            case '.js':
              contentType = 'application/javascript';
              break;
            case '.css':
              contentType = 'text/css';
              break;
            case '.png':
              contentType = 'image/png';
              break;
            case '.jpg':
            case '.jpeg':
              contentType = 'image/jpeg';
              break;
            case '.svg':
              contentType = 'image/svg+xml';
              break;
            case '.ico':
              contentType = 'image/x-icon';
              break;
          }

          return new Response(content, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000',
            },
          });
        } catch (error) {
          apiLogger.error('Failed to serve asset', error instanceof Error ? error : new Error(String(error)));
          return c.text('Internal server error', 500);
        }
      },
    }),

    // Serve other static files (favicon, etc.)
    registerApiRoute('/favicon.ico', {
      method: 'GET',
      handler: async c => {
        try {
          const cwd = process.cwd();
          const isInMastraOutput = cwd.endsWith('.mastra/output');
          const faviconPath = isInMastraOutput
            ? join(cwd, 'playground/favicon.ico')
            : join(cwd, '.mastra/output/playground/favicon.ico');
          if (existsSync(faviconPath)) {
            const content = readFileSync(faviconPath);
            return new Response(content, {
              headers: {
                'Content-Type': 'image/x-icon',
                'Cache-Control': 'public, max-age=31536000',
              },
            });
          }
          return c.text('Favicon not found', 404);
        } catch (error) {
          return c.text('Internal server error', 500);
        }
      },
    }),

    registerApiRoute('/mastra.svg', {
      method: 'GET',
      handler: async c => {
        try {
          const cwd = process.cwd();
          const isInMastraOutput = cwd.endsWith('.mastra/output');
          const svgPath = isInMastraOutput
            ? join(cwd, 'playground/mastra.svg')
            : join(cwd, '.mastra/output/playground/mastra.svg');
          if (existsSync(svgPath)) {
            const content = readFileSync(svgPath, 'utf-8');
            return new Response(content, {
              headers: {
                'Content-Type': 'image/svg+xml',
                'Cache-Control': 'public, max-age=31536000',
              },
            });
          }
          return c.text('SVG not found', 404);
        } catch (error) {
          return c.text('Internal server error', 500);
        }
      },
    }),
  ];
}