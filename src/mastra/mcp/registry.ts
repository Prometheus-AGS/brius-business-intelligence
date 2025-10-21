
import { EventEmitter } from 'events';
import { z } from 'zod';
import { readFile, access } from 'fs/promises';
import { resolve } from 'path';
import { mcpConfigLoader, ResolvedMCPConfig, ResolvedMCPServerConfig } from './config-loader.js';
import { mastraMCPClientManager, type MastraMCPConnection } from './mastra-client.js';
import { mcpToolMapper, MappedTool, ToolNamespace } from './tool-mapper.js';
import { mcpMonitoringSystem, MCPMonitoringMetrics, MCPHealthCheck } from './monitoring.js';
import { mcpLogger } from '../observability/logger.js';
import { createTrace, createSpan, endSpan } from '../observability/langfuse.js';

/**
 * MCP Tool Registry
 * Central orchestration system for all MCP infrastructure components
 * Now uses the official @mastra/mcp package for server connections
 * Manages both hardcoded Supabase server and dynamic servers from mcp.json
 * Provides unified tool catalog and execution engine for the Mastra ecosystem
 */

// Core interfaces for the registry
export interface ToolExecutionRequest {
  toolId: string;
  arguments: Record<string, unknown>;
  metadata?: {
    sessionId?: string;
    userId?: string;
    source?: 'playground' | 'agent' | 'api';
    traceId?: string;
    spanId?: string;
  };
}

export interface ToolExecutionResponse {
  id: string;
  toolId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
  timestamp: string;
  metadata: {
    serverId: string;
    toolName: string;
    argumentsCount: number;
    source?: string;
    sessionId?: string;
    userId?: string;
    traceId?: string;
    spanId?: string;
  };
}

export interface PlaygroundTool {
  id: string;
  displayName: string;
  description: string;
  namespace: string;
  category: string;
  serverId: string;
  inputSchema: z.ZodSchema;
  metadata: {
    isAvailable: boolean;
    executionCount: number;
    successRate: number;
    averageExecutionTime: number;
    lastExecuted?: Date;
    tags?: string[];
  };
}

export interface RegistryStats {
  servers: {
    total: number;
    connected: number;
    healthy: number;
    degraded: number;
    unavailable: number;
  };
  tools: {
    total: number;
    available: number;
    categories: Record<string, number>;
    namespaces: Record<string, number>;
  };
  executions: {
    total: number;
    successful: number;
    failed: number;
    averageExecutionTime: number;
    executionsPerHour: number;
  };
  uptime: {
    startedAt: Date;
    uptimeSeconds: number;
  };
}

export interface ToolSearchFilters {
  namespace?: string;
  category?: string;
  serverId?: string;
  available?: boolean;
  query?: string;
  tags?: string[];
}

export interface MCPRegistryOptions {
  enableSupabaseServer?: boolean;
  configPath?: string;
  autoStart?: boolean;
  enableMonitoring?: boolean;
  supabaseConfig?: {
    projectRef: string;
    mcpUrl: string;
    features: string;
    readOnly: boolean;
    accessToken?: string;
  };
}

// Schema for mcp.json format (different from MCPConfigLoader format)
const MCPJsonServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  timeout: z.number().min(1000).optional().default(30000),
  restart: z.boolean().optional().default(true),
  maxRestarts: z.number().min(0).optional().default(5),
  restartDelay: z.number().min(100).optional().default(1000),
  categories: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const MCPJsonConfigSchema = z.object({
  mcpServers: z.record(z.string(), MCPJsonServerConfigSchema),
});

type MCPJsonServerConfig = z.infer<typeof MCPJsonServerConfigSchema>;
type MCPJsonConfig = z.infer<typeof MCPJsonConfigSchema>;

const DEFAULT_REGISTRY_OPTIONS: Required<MCPRegistryOptions> = {
  enableSupabaseServer: true,
  configPath: process.env.MCP_CONFIG_PATH || './mcp.json',
  autoStart: true,
  enableMonitoring: true,
  supabaseConfig: {
    projectRef: process.env.SUPABASE_PROJECT_REF || '',
    mcpUrl: process.env.SUPABASE_MCP_URL || '',
    features: process.env.SUPABASE_MCP_FEATURES || 'functions,database',
    readOnly: process.env.SUPABASE_MCP_READ_ONLY === 'true',
    accessToken: process.env.SUPABASE_ACCESS_TOKEN || '',
  },
};

/**
 * MCP Tool Registry - Central orchestration class
 */
export class MCPToolRegistry extends EventEmitter {
  private options: Required<MCPRegistryOptions>;
  private isInitialized = false;
  private isShuttingDown = false;
  private startedAt: Date;
  private toolExecutions = new Map<string, ToolExecutionResponse>();
  private executionHistory: ToolExecutionResponse[] = [];
  private supabaseServerId = 'supabase-mcp';

  constructor(options: MCPRegistryOptions = {}) {
    super();
    this.options = { ...DEFAULT_REGISTRY_OPTIONS, ...options };
    this.startedAt = new Date();

    // Setup event listeners
    this.setupEventListeners();

    mcpLogger.info('MCP Tool Registry initialized', {
      enable_supabase: this.options.enableSupabaseServer,
      config_path: this.options.configPath,
      auto_start: this.options.autoStart,
      enable_monitoring: this.options.enableMonitoring,
    });
  }

  /**
   * Initialize the MCP registry and all components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      mcpLogger.warn('MCP Tool Registry already initialized');
      return;
    }

    mcpLogger.info('Initializing MCP Tool Registry with Mastra MCP Client');

    try {
      // Step 1: Initialize hardcoded Supabase server if enabled
      if (this.options.enableSupabaseServer && this.options.supabaseConfig.projectRef) {
        await this.initializeSupabaseServer();
      }

      // Step 2: Load and initialize dynamic servers from configuration
      await this.initializeDynamicServers();

      // Step 3: Start monitoring system if enabled
      if (this.options.enableMonitoring) {
        mcpMonitoringSystem.start();
      }

      // Step 4: Discover and map all tools
      await this.discoverAllTools();

      this.isInitialized = true;

      mcpLogger.info('MCP Tool Registry initialization completed', {
        servers_count: mastraMCPClientManager.getAllConnections().length,
        tools_count: mcpToolMapper.getAllMappedTools().length,
        monitoring_enabled: this.options.enableMonitoring,
      });

      this.emit('registry:initialized', {
        servers: mastraMCPClientManager.getAllConnections().length,
        tools: mcpToolMapper.getAllMappedTools().length,
      });

    } catch (error) {
      mcpLogger.error('Failed to initialize MCP Tool Registry', {
        error: error instanceof Error ? error.message : String(error),
      });

      this.emit('registry:initialization:failed', error);
      throw error;
    }
  }

  /**
   * Get all available tools with optional filtering
   */
  async getAllTools(filters?: ToolSearchFilters): Promise<PlaygroundTool[]> {
    this.ensureInitialized();

    let tools = mcpToolMapper.getAllMappedTools();

    mcpLogger.info('🔥 MCP REGISTRY getAllTools() - INITIAL MAPPED TOOLS', {
      mapped_tools_count: tools.length,
      mapped_tool_ids: tools.map(t => t.id),
      mapped_tools_sample: tools.slice(0, 3).map(t => ({
        id: t.id,
        serverId: t.serverId,
        namespace: t.namespace
      }))
    });

    // Apply filters
    if (filters) {
      mcpLogger.info('🔥 APPLYING FILTERS TO MAPPED TOOLS', {
        filters: filters,
        tools_before_filtering: tools.length
      });

      if (filters.namespace) {
        tools = tools.filter(tool => tool.namespace === filters.namespace);
        mcpLogger.info('🔥 AFTER NAMESPACE FILTER', { tools_count: tools.length });
      }
      if (filters.category) {
        tools = tools.filter(tool => tool.metadata.category === filters.category);
        mcpLogger.info('🔥 AFTER CATEGORY FILTER', { tools_count: tools.length });
      }
      if (filters.serverId) {
        tools = tools.filter(tool => tool.serverId === filters.serverId);
        mcpLogger.info('🔥 AFTER SERVER_ID FILTER', { tools_count: tools.length });
      }
      if (filters.available !== undefined) {
        const connectedServers = new Set(
          mastraMCPClientManager.getConnectedServers().map(conn => conn.serverId)
        );
        mcpLogger.info('🔥 AVAILABILITY FILTER CHECK', {
          filter_available: filters.available,
          connected_servers: Array.from(connectedServers),
          tools_server_ids: tools.map(t => t.serverId)
        });
        tools = tools.filter(tool =>
          filters.available ? connectedServers.has(tool.serverId) : !connectedServers.has(tool.serverId)
        );
        mcpLogger.info('🔥 AFTER AVAILABILITY FILTER', {
          tools_count: tools.length,
          remaining_tool_ids: tools.map(t => t.id)
        });
      }
      if (filters.query) {
        const query = filters.query.toLowerCase();
        tools = tools.filter(tool =>
          tool.name.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query) ||
          tool.metadata.tags?.some(tag => tag.toLowerCase().includes(query))
        );
      }
      if (filters.tags && filters.tags.length > 0) {
        tools = tools.filter(tool =>
          filters.tags!.some(filterTag =>
            tool.metadata.tags?.includes(filterTag)
          )
        );
      }
    }

    // Convert to playground format
    return tools.map(tool => this.convertToPlaygroundTool(tool));
  }

  /**
   * Get specific tool by ID
   */
  async getTool(toolId: string): Promise<PlaygroundTool | null> {
    this.ensureInitialized();

    const mappedTool = mcpToolMapper.getMappedTool(toolId);
    if (!mappedTool) {
      return null;
    }

    return this.convertToPlaygroundTool(mappedTool);
  }

  /**
   * Execute a tool and return the response
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
    this.ensureInitialized();

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Create tracing span
    const trace = request.metadata?.traceId ? null : createTrace('mcp_tool_execution', {
      userId: request.metadata?.userId,
      sessionId: request.metadata?.sessionId,
      metadata: {
        toolId: request.toolId,
        source: request.metadata?.source || 'unknown',
      },
    });

    const span = trace ? createSpan(trace, `execute_tool_${request.toolId}`, {
      metadata: {
        toolId: request.toolId,
        argumentsCount: Object.keys(request.arguments).length,
      },
    }) : null;

    mcpLogger.info('Executing MCP tool', {
      execution_id: executionId,
      tool_id: request.toolId,
      arguments_count: Object.keys(request.arguments).length,
      source: request.metadata?.source,
      user_id: request.metadata?.userId,
      session_id: request.metadata?.sessionId,
      trace_id: trace?.id || request.metadata?.traceId,
      span_id: span?.id,
    });

    try {
      // Get tool information
      const mappedTool = mcpToolMapper.getMappedTool(request.toolId);
      if (!mappedTool) {
        throw new Error(`Tool not found: ${request.toolId}`);
      }

      // Check if server is connected
      const connection = mastraMCPClientManager.getConnection(mappedTool.serverId);
      if (!connection || connection.status !== 'connected') {
        throw new Error(`Server not connected: ${mappedTool.serverId}`);
      }

      // Validate arguments against tool schema
      try {
        mappedTool.inputSchema.parse(request.arguments);
      } catch (validationError) {
        throw new Error(`Invalid arguments: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
      }

      // Execute the tool via Mastra MCP client
      const mcpResult = await mastraMCPClientManager.executeTool(
        mappedTool.serverId,
        mappedTool.originalTool.name,
        request.arguments as Record<string, any>
      );

      const executionTime = Date.now() - startTime;

      // Create execution response
      const response: ToolExecutionResponse = {
        id: executionId,
        toolId: request.toolId,
        success: true,
        result: mcpResult,
        executionTime,
        timestamp: new Date().toISOString(),
        metadata: {
          serverId: mappedTool.serverId,
          toolName: mappedTool.originalTool.name,
          argumentsCount: Object.keys(request.arguments).length,
          source: request.metadata?.source,
          sessionId: request.metadata?.sessionId,
          userId: request.metadata?.userId,
          traceId: trace?.id || request.metadata?.traceId,
          spanId: span?.id,
        },
      };

      // Store execution
      this.toolExecutions.set(executionId, response);
      this.executionHistory.push(response);

      // Keep only last 1000 executions in memory
      if (this.executionHistory.length > 1000) {
        this.executionHistory = this.executionHistory.slice(-1000);
      }

      // Update tool usage statistics
      mcpToolMapper.updateToolUsage(request.toolId, executionTime);

      // Track in monitoring system
      if (this.options.enableMonitoring) {
        mcpMonitoringSystem.trackToolExecution(response);
      }

      // Complete tracing
      if (span) {
        endSpan(span, {
          output: response.result,
          metadata: {
            executionTime,
            toolId: request.toolId,
            serverId: mappedTool.serverId,
          },
          level: 'DEFAULT',
          statusMessage: 'Tool executed successfully',
        });
      }

      mcpLogger.info('MCP tool executed successfully', {
        execution_id: executionId,
        tool_id: request.toolId,
        success: response.success,
        execution_time_ms: executionTime,
        trace_id: trace?.id || request.metadata?.traceId,
      });

      this.emit('tool:executed', response);

      return response;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const response: ToolExecutionResponse = {
        id: executionId,
        toolId: request.toolId,
        success: false,
        error: errorMessage,
        executionTime,
        timestamp: new Date().toISOString(),
        metadata: {
          serverId: 'unknown',
          toolName: 'unknown',
          argumentsCount: Object.keys(request.arguments).length,
          source: request.metadata?.source,
          sessionId: request.metadata?.sessionId,
          userId: request.metadata?.userId,
          traceId: trace?.id || request.metadata?.traceId,
          spanId: span?.id,
        },
      };

      // Store failed execution
      this.toolExecutions.set(executionId, response);
      this.executionHistory.push(response);

      // Track error in monitoring system
      if (this.options.enableMonitoring) {
        mcpMonitoringSystem.trackError(error instanceof Error ? error : new Error(errorMessage), {
          execution_id: executionId,
          tool_id: request.toolId,
          source: request.metadata?.source,
        });
        mcpMonitoringSystem.trackToolExecution(response);
      }

      // Complete tracing with error
      if (span) {
        endSpan(span, {
          output: null,
          metadata: {
            executionTime,
            error: errorMessage,
            toolId: request.toolId,
          },
          level: 'ERROR',
          statusMessage: `Tool execution failed: ${errorMessage}`,
        });
      }

      mcpLogger.error('MCP tool execution failed', {
        execution_id: executionId,
        tool_id: request.toolId,
        execution_time_ms: executionTime,
        error: errorMessage,
        trace_id: trace?.id || request.metadata?.traceId,
      });

      this.emit('tool:execution:failed', response);

      throw error;
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    this.ensureInitialized();

    const connections = mastraMCPClientManager.getAllConnections();
    const tools = mcpToolMapper.getAllMappedTools();
    const healthChecks = this.options.enableMonitoring ? mcpMonitoringSystem.getHealthStatus() : [];

    const connectedCount = connections.filter(c => c.status === 'connected').length;
    const healthyCount = healthChecks.filter(h => h.status === 'healthy').length;
    const degradedCount = healthChecks.filter(h => h.status === 'degraded').length;

    const successfulExecutions = this.executionHistory.filter(e => e.success).length;
    const totalExecutions = this.executionHistory.length;
    const avgExecutionTime = totalExecutions > 0 
      ? this.executionHistory.reduce((sum, e) => sum + e.executionTime, 0) / totalExecutions 
      : 0;

    const uptimeSeconds = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
    const executionsPerHour = totalExecutions > 0 && uptimeSeconds > 0 
      ? (totalExecutions / uptimeSeconds) * 3600 
      : 0;

    return {
      servers: {
        total: connections.length,
        connected: connectedCount,
        healthy: healthyCount,
        degraded: degradedCount,
        unavailable: connections.length - connectedCount,
      },
      tools: {
        total: tools.length,
        available: tools.filter(t => {
          const conn = mastraMCPClientManager.getConnection(t.serverId);
          return conn?.status === 'connected';
        }).length,
        categories: tools.reduce((acc, tool) => {
          const category = tool.metadata.category || 'uncategorized';
          acc[category] = (acc[category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        namespaces: tools.reduce((acc, tool) => {
          acc[tool.namespace] = (acc[tool.namespace] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      executions: {
        total: totalExecutions,
        successful: successfulExecutions,
        failed: totalExecutions - successfulExecutions,
        averageExecutionTime: avgExecutionTime,
        executionsPerHour,
      },
      uptime: {
        startedAt: this.startedAt,
        uptimeSeconds,
      },
    };
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit = 100): ToolExecutionResponse[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get monitoring metrics
   */
  getMonitoringMetrics(): MCPMonitoringMetrics | null {
    if (!this.options.enableMonitoring) {
      return null;
    }
    return mcpMonitoringSystem.getMetrics();
  }

  /**
   * Get health status
   */
  getHealthStatus(): MCPHealthCheck[] {
    if (!this.options.enableMonitoring) {
      return [];
    }
    return mcpMonitoringSystem.getHealthStatus();
  }

  /**
   * Refresh tools for a specific server
   */
  async refreshServerTools(serverId: string): Promise<MappedTool[]> {
    this.ensureInitialized();

    mcpLogger.info('Refreshing tools for MCP server', { server_id: serverId });

    try {
      // Reconnect to the server to refresh tools
      await mastraMCPClientManager.connectToServer(serverId, this.options.configPath);
      
      // Get the connection and its tools
      const connection = mastraMCPClientManager.getConnection(serverId);
      if (!connection) {
        throw new Error(`Server connection not found: ${serverId}`);
      }

      // Re-map tools from the refreshed connection
      const mappedTools: MappedTool[] = [];
      for (const tool of connection.tools) {
        try {
          const mappedTool = await mcpToolMapper.mapTool(tool, serverId);
          mappedTools.push(mappedTool);
        } catch (error) {
          mcpLogger.warn('Failed to map tool during refresh', {
            server_id: serverId,
            tool_name: tool.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      mcpLogger.info('Server tools refreshed successfully', {
        server_id: serverId,
        tools_count: mappedTools.length,
      });

      return mappedTools;

    } catch (error) {
      mcpLogger.error('Failed to refresh server tools', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    mcpLogger.info('Shutting down MCP Tool Registry');

    try {
      // Stop monitoring system
      if (this.options.enableMonitoring) {
        mcpMonitoringSystem.stop();
      }

      // Shutdown MCP client manager
      await mastraMCPClientManager.shutdown();

      mcpLogger.info('MCP Tool Registry shutdown complete');

    } catch (error) {
      mcpLogger.error('Error during MCP Tool Registry shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Initialize hardcoded Supabase MCP server
   */
  private async initializeSupabaseServer(): Promise<void> {
    // Construct the Supabase MCP URL dynamically from environment variables
    const projectRef = this.options.supabaseConfig.projectRef;
    const features = this.options.supabaseConfig.features;
    const accessToken = this.options.supabaseConfig.accessToken;
    const supabaseUrl = `https://mcp.supabase.com/mcp?project_ref=${projectRef}&features=${encodeURIComponent(features)}`;

    mcpLogger.info('Initializing hardcoded Supabase MCP server', {
      project_ref: projectRef,
      mcp_url: supabaseUrl,
      features: features,
      read_only: this.options.supabaseConfig.readOnly,
      has_access_token: Boolean(accessToken),
    });

    // Validate required authentication
    if (!accessToken) {
      throw new Error('SUPABASE_ACCESS_TOKEN is required for Supabase MCP server authentication. Please set this environment variable with your Supabase Personal Access Token.');
    }

    try {
      // Create hardcoded configuration for remote Supabase MCP server
      const supabaseConfig: ResolvedMCPServerConfig = {
        id: this.supabaseServerId,
        name: 'Supabase MCP Server',
        command: 'remote-http', // Special marker for remote HTTP streaming servers
        args: [supabaseUrl],
        env: {},
        resolvedCommand: 'remote-http',
        resolvedCwd: process.cwd(),
        resolvedEnv: {
          SUPABASE_PROJECT_REF: projectRef,
          SUPABASE_MCP_URL: supabaseUrl,
          SUPABASE_MCP_FEATURES: features,
          SUPABASE_MCP_READ_ONLY: this.options.supabaseConfig.readOnly.toString(),
          SUPABASE_ACCESS_TOKEN: accessToken,
        },
        timeout: 30000,
        restart: false, // Remote servers don't need restart management
        maxRestarts: 0,
        restartDelay: 1000,
        enabled: true,
        categories: ['database', 'supabase', 'remote'],
        description: 'Hardcoded Supabase MCP server for database operations via remote HTTP streaming',
        version: '1.0.0',
        metadata: {
          hardcoded: true,
          priority: 100,
          serverType: 'remote-http',
          url: supabaseUrl,
        },
      };

      // Register the hardcoded server configuration with the config loader
      await mcpConfigLoader.registerHardcodedServer(this.supabaseServerId, supabaseConfig);

      // Connect to the remote Supabase server using Mastra MCP client
      mcpLogger.info('Connecting to remote Supabase MCP server', {
        server_id: this.supabaseServerId,
        url: supabaseUrl,
      });

      await mastraMCPClientManager.connectToServer(this.supabaseServerId);

      mcpLogger.info('Supabase MCP server initialized successfully', {
        server_id: this.supabaseServerId,
        server_type: 'remote-http',
        url: supabaseUrl,
      });

    } catch (error) {
      mcpLogger.error('Failed to initialize Supabase MCP server', {
        error: error instanceof Error ? error.message : String(error),
        server_id: this.supabaseServerId,
      });

      // Don't throw error for Supabase server failure - continue with other servers
      mcpLogger.warn('Continuing initialization without Supabase server');
    }
  }

  /**
   * Initialize dynamic servers from configuration files
   */
  private async initializeDynamicServers(): Promise<void> {
    mcpLogger.info('Initializing dynamic MCP servers from configuration');

    try {
      // Load mcp.json configuration if it exists
      const mcpJsonConfig = await this.loadMcpJsonConfig(this.options.configPath);
      
      if (!mcpJsonConfig) {
        mcpLogger.info('No mcp.json configuration found, skipping dynamic servers');
        return;
      }

      // Convert mcp.json format to resolved config format
      const resolvedConfigs: ResolvedMCPServerConfig[] = [];
      
      for (const [serverId, serverConfig] of Object.entries(mcpJsonConfig.mcpServers)) {
        if (!serverConfig.enabled) {
          mcpLogger.info('Skipping disabled server', { server_id: serverId });
          continue;
        }

        const resolvedConfig = this.convertMcpJsonToResolvedConfig(serverId, serverConfig);
        resolvedConfigs.push(resolvedConfig);
      }

      mcpLogger.info('Processed dynamic server configurations', {
        total_servers: Object.keys(mcpJsonConfig.mcpServers).length,
        enabled_servers: resolvedConfigs.length,
      });

      // Connect to all enabled servers
      const connectionPromises = resolvedConfigs.map(async (config) => {
        try {
          mcpLogger.info('Connecting to dynamic MCP server', {
            server_id: config.id,
            command: config.command,
            args: config.args,
          });

          // Register the server configuration
          await mcpConfigLoader.registerHardcodedServer(config.id, config);
          
          // Connect using Mastra MCP client
          await mastraMCPClientManager.connectToServer(config.id);

          mcpLogger.info('Dynamic MCP server connected successfully', {
            server_id: config.id,
          });

        } catch (error) {
          mcpLogger.error('Failed to connect to dynamic MCP server', {
            server_id: config.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      await Promise.all(connectionPromises);

      mcpLogger.info('Dynamic MCP servers initialization completed');

    } catch (error) {
      mcpLogger.error('Failed to initialize dynamic MCP servers', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - continue with just hardcoded servers
    }
  }

  /**
   * Load mcp.json configuration file
   */
  private async loadMcpJsonConfig(configPath: string): Promise<MCPJsonConfig | null> {
    try {
      await access(configPath);
      const content = await readFile(configPath, 'utf-8');
      const rawData = JSON.parse(content);
      
      const validationResult = MCPJsonConfigSchema.safeParse(rawData);
      if (!validationResult.success) {
        mcpLogger.error('Invalid mcp.json configuration', {
          config_path: configPath,
          errors: validationResult.error.issues,
        });
        return null;
      }

      return validationResult.data;

    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        mcpLogger.info('mcp.json configuration file not found', { config_path: configPath });
        return null;
      }
      
      mcpLogger.error('Failed to load mcp.json configuration', {
        config_path: configPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Convert mcp.json server config to resolved config format
   */
  private convertMcpJsonToResolvedConfig(
    serverId: string, 
    serverConfig: MCPJsonServerConfig
  ): ResolvedMCPServerConfig {
    // Resolve environment variables in the configuration
    const resolvedEnv = this.resolveEnvironmentVariables(serverConfig.env || {});
    const resolvedCommand = this.substituteEnvironmentVariables(serverConfig.command, resolvedEnv);

    return {
      id: serverId,
      name: serverConfig.description || serverId,
      command: serverConfig.command,
      args: serverConfig.args || [],
      env: serverConfig.env || {},
      resolvedCommand,
      resolvedCwd: process.cwd(),
      resolvedEnv: {
        ...resolvedEnv,
        MCP_SERVER_ID: serverId,
      },
      timeout: serverConfig.timeout || 30000,
      restart: serverConfig.restart !== false,
      maxRestarts: serverConfig.maxRestarts || 5,
      restartDelay: serverConfig.restartDelay || 1000,
      enabled: serverConfig.enabled !== false,
      categories: serverConfig.categories || [],
      description: serverConfig.description,
      metadata: {
        ...serverConfig.metadata,
        fromMcpJson: true,
      },
    };
  }

  /**
   * Resolve environment variables in configuration values
   */
  private resolveEnvironmentVariables(
    obj: Record<string, string>
  ): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = this.substituteEnvironmentVariables(value, process.env);
    }

    return resolved;
  }

  /**
   * Substitute environment variables in a string value
   */
  private substituteEnvironmentVariables(
    value: string,
    env: Record<string, string | undefined>
  ): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = env[varName];
      if (envValue === undefined) {
        mcpLogger.warn('Environment variable not found', {
          variable: varName,
          match,
        });
        return match; // Return original if not found
      }
      return envValue;
    });
  }

  /**
   * Discover and map all tools from connected servers
   */
  private async discoverAllTools(): Promise<void> {
    mcpLogger.info('Discovering tools from all connected MCP servers');

    const connections = mastraMCPClientManager.getConnectedServers();

    for (const connection of connections) {
      try {
        mcpLogger.info('Discovering and storing tools for server', {
          server_id: connection.serverId,
          tools_count: connection.tools.length,
        });

        // Use the tool mapper's proper discoverToolsFromServer method which handles storage
        const mappedTools = await mcpToolMapper.discoverToolsFromServer(connection.serverId);

        mcpLogger.info('Tools discovered and stored for server', {
          server_id: connection.serverId,
          mapped_tools_count: mappedTools.length,
          mapped_tool_ids: mappedTools.map(t => t.id),
        });

      } catch (error) {
        mcpLogger.error('Failed to discover tools for server', {
          server_id: connection.serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const finalMappedTools = mcpToolMapper.getAllMappedTools();
    mcpLogger.info('🔥 Tool discovery completed - FINAL CHECK', {
      total_mapped_tools: finalMappedTools.length,
      final_tool_ids: finalMappedTools.map(t => t.id),
      final_tools_sample: finalMappedTools.slice(0, 5).map(t => ({
        id: t.id,
        serverId: t.serverId,
        namespace: t.namespace
      }))
    });
  }

  /**
   * Setup event listeners for MCP components
   */
  private setupEventListeners(): void {
    // Currently no specific event listeners needed
    // The Mastra MCP client handles its own events internally
    mcpLogger.debug('MCP Tool Registry event listeners setup completed');
  }

  /**
   * Convert mapped tool to playground tool format
   */
  private convertToPlaygroundTool(mappedTool: MappedTool): PlaygroundTool {
    const connection = mastraMCPClientManager.getConnection(mappedTool.serverId);
    const isAvailable = connection?.status === 'connected';

    return {
      id: mappedTool.id,
      displayName: mappedTool.name,
      description: mappedTool.description,
      namespace: mappedTool.namespace,
      category: mappedTool.metadata.category || 'general',
      serverId: mappedTool.serverId,
      inputSchema: mappedTool.inputSchema,
      metadata: {
        isAvailable,
        executionCount: mappedTool.metadata.usage_count || 0,
        successRate: 0, // Calculate from execution history if needed
        averageExecutionTime: mappedTool.metadata.avg_execution_time || 0,
        lastExecuted: undefined, // Would need to track this separately
        tags: mappedTool.metadata.tags || [],
      },
    };
  }

  /**
   * Ensure registry is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('MCP Tool Registry not initialized. Call initialize() first.');
    }
  }
}

// Export singleton instance
export const mcpToolRegistry = new MCPToolRegistry();

// NOTE: Auto-initialization is disabled to prevent conflicts with startup sequence
// The registry should be initialized manually via the startup sequence in src/mastra/index.ts