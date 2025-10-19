import { z } from 'zod';
import { mcpToolMapper, MappedTool, ToolNamespace } from './tool-mapper.js';
import { mcpClient } from './client.js';
import { mcpLogger } from '../observability/logger.js';

/**
 * MCP Tool Registry
 * Provides playground integration for MCP tools with discovery, testing, and execution capabilities
 * Serves as the bridge between MCP tools and the Mastra playground interface
 */

export interface PlaygroundTool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  namespace: string;
  serverId: string;
  inputSchema: any; // JSON Schema for playground UI
  outputSchema?: any;
  examples: ToolExample[];
  metadata: {
    discoveredAt: string;
    lastExecuted?: string;
    executionCount: number;
    averageExecutionTime: number;
    successRate: number;
    tags: string[];
    isAvailable: boolean;
    health: 'healthy' | 'degraded' | 'unavailable';
  };
}

export interface ToolExample {
  name: string;
  description: string;
  input: Record<string, any>;
  expectedOutput?: any;
  metadata?: {
    difficulty: 'basic' | 'intermediate' | 'advanced';
    useCase: string;
  };
}

export interface ToolExecutionRequest {
  toolId: string;
  arguments: Record<string, any>;
  metadata?: {
    sessionId?: string;
    userId?: string;
    source: 'playground' | 'agent' | 'api';
  };
}

export interface ToolExecutionResponse {
  id: string;
  toolId: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: string;
  metadata: {
    serverId: string;
    namespace: string;
    inputValidation: boolean;
    cacheHit?: boolean;
  };
}

export interface RegistryStats {
  totalTools: number;
  availableTools: number;
  connectedServers: number;
  totalNamespaces: number;
  executionStats: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
  };
  healthStats: {
    healthy: number;
    degraded: number;
    unavailable: number;
  };
}

export interface RegistryFilter {
  namespace?: string;
  category?: string;
  serverId?: string;
  isAvailable?: boolean;
  health?: 'healthy' | 'degraded' | 'unavailable';
  tags?: string[];
  searchQuery?: string;
}

/**
 * MCP Tool Registry class
 */
export class MCPToolRegistry {
  private playgroundTools = new Map<string, PlaygroundTool>();
  private executionHistory = new Map<string, ToolExecutionResponse[]>();
  private executionCache = new Map<string, ToolExecutionResponse>();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Listen to tool mapper events
    this.setupEventListeners();

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Initialize registry with current tools
   */
  async initialize(): Promise<void> {
    mcpLogger.info('Initializing MCP Tool Registry');

    try {
      // Discover all tools from connected servers
      await mcpToolMapper.discoverAllTools();

      // Convert to playground format
      const mappedTools = mcpToolMapper.getAllMappedTools();
      for (const tool of mappedTools) {
        const playgroundTool = this.convertToPlaygroundTool(tool);
        this.playgroundTools.set(tool.id, playgroundTool);
      }

      mcpLogger.info('MCP Tool Registry initialized', {
        tools_count: this.playgroundTools.size,
        namespaces_count: mcpToolMapper.getAllNamespaces().length,
      });

    } catch (error) {
      mcpLogger.error('Failed to initialize MCP Tool Registry', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all playground tools
   */
  getAllTools(filter?: RegistryFilter): PlaygroundTool[] {
    let tools = Array.from(this.playgroundTools.values());

    if (filter) {
      tools = this.applyFilter(tools, filter);
    }

    return tools.sort((a, b) => {
      // Sort by availability first, then by name
      if (a.metadata.isAvailable !== b.metadata.isAvailable) {
        return a.metadata.isAvailable ? -1 : 1;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }

  /**
   * Get tool by ID
   */
  getTool(toolId: string): PlaygroundTool | null {
    return this.playgroundTools.get(toolId) || null;
  }

  /**
   * Get tools by namespace
   */
  getToolsByNamespace(namespace: string): PlaygroundTool[] {
    return this.getAllTools({ namespace });
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): PlaygroundTool[] {
    return this.getAllTools({ category });
  }

  /**
   * Search tools
   */
  searchTools(query: string): PlaygroundTool[] {
    return this.getAllTools({ searchQuery: query });
  }

  /**
   * Get available namespaces with tool counts
   */
  getNamespaces(): Array<ToolNamespace & { toolCount: number; availableToolCount: number }> {
    const namespaces = mcpToolMapper.getAllNamespaces();

    return namespaces.map(namespace => {
      const tools = this.getToolsByNamespace(namespace.id);
      const availableTools = tools.filter(tool => tool.metadata.isAvailable);

      return {
        ...namespace,
        toolCount: tools.length,
        availableToolCount: availableTools.length,
      };
    });
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const tools = this.getAllTools();
    const availableTools = tools.filter(tool => tool.metadata.isAvailable);
    const connectedServers = mcpClient.getConnectedServers().length;
    const namespaces = this.getNamespaces();

    // Calculate execution stats
    let totalExecutions = 0;
    let successfulExecutions = 0;
    let failedExecutions = 0;
    let totalExecutionTime = 0;

    for (const tool of tools) {
      totalExecutions += tool.metadata.executionCount;
      const successCount = Math.round(tool.metadata.executionCount * tool.metadata.successRate);
      successfulExecutions += successCount;
      failedExecutions += tool.metadata.executionCount - successCount;
      totalExecutionTime += tool.metadata.averageExecutionTime * tool.metadata.executionCount;
    }

    // Calculate health stats
    const healthStats = {
      healthy: tools.filter(tool => tool.metadata.health === 'healthy').length,
      degraded: tools.filter(tool => tool.metadata.health === 'degraded').length,
      unavailable: tools.filter(tool => tool.metadata.health === 'unavailable').length,
    };

    return {
      totalTools: tools.length,
      availableTools: availableTools.length,
      connectedServers,
      totalNamespaces: namespaces.length,
      executionStats: {
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        averageExecutionTime: totalExecutions > 0 ? totalExecutionTime / totalExecutions : 0,
      },
      healthStats,
    };
  }

  /**
   * Execute tool from playground
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
    const startTime = Date.now();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    mcpLogger.info('Executing tool from playground', {
      execution_id: executionId,
      tool_id: request.toolId,
      source: request.metadata?.source || 'playground',
      user_id: request.metadata?.userId,
    });

    try {
      // Get playground tool
      const playgroundTool = this.getTool(request.toolId);
      if (!playgroundTool) {
        throw new Error(`Tool not found in registry: ${request.toolId}`);
      }

      if (!playgroundTool.metadata.isAvailable) {
        throw new Error(`Tool is currently unavailable: ${request.toolId}`);
      }

      // Get mapped tool for validation
      const mappedTool = mcpToolMapper.getMappedTool(request.toolId);
      if (!mappedTool) {
        throw new Error(`Tool mapping not found: ${request.toolId}`);
      }

      // Validate input arguments
      let inputValidation = false;
      try {
        mappedTool.inputSchema.parse(request.arguments);
        inputValidation = true;
      } catch (validationError) {
        throw new Error(`Input validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
      }

      // Check execution cache
      const cacheKey = this.generateCacheKey(request.toolId, request.arguments);
      const cachedResult = this.executionCache.get(cacheKey);
      if (cachedResult && this.isCacheValid(cachedResult)) {
        mcpLogger.debug('Returning cached execution result', {
          execution_id: executionId,
          tool_id: request.toolId,
          cache_key: cacheKey,
        });

        return {
          ...cachedResult,
          id: executionId,
          timestamp: new Date().toISOString(),
          metadata: {
            ...cachedResult.metadata,
            cacheHit: true,
          },
        };
      }

      // Execute tool via MCP client
      const mcpResult = await mcpClient.executeTool(
        playgroundTool.serverId,
        playgroundTool.name,
        request.arguments
      );

      const executionTime = Date.now() - startTime;
      const response: ToolExecutionResponse = {
        id: executionId,
        toolId: request.toolId,
        success: mcpResult.success,
        result: mcpResult.result,
        error: mcpResult.error,
        executionTime,
        timestamp: new Date().toISOString(),
        metadata: {
          serverId: playgroundTool.serverId,
          namespace: playgroundTool.namespace,
          inputValidation,
          cacheHit: false,
        },
      };

      // Update tool statistics
      this.updateToolStats(request.toolId, response);

      // Cache successful results
      if (response.success && this.shouldCacheResult(request.toolId)) {
        this.executionCache.set(cacheKey, response);
      }

      // Store execution history
      this.addToExecutionHistory(request.toolId, response);

      mcpLogger.info('Tool execution completed', {
        execution_id: executionId,
        tool_id: request.toolId,
        success: response.success,
        execution_time_ms: executionTime,
      });

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
          serverId: this.getTool(request.toolId)?.serverId || 'unknown',
          namespace: this.getTool(request.toolId)?.namespace || 'unknown',
          inputValidation: false,
        },
      };

      // Update tool statistics
      this.updateToolStats(request.toolId, response);

      // Store execution history
      this.addToExecutionHistory(request.toolId, response);

      mcpLogger.error('Tool execution failed', {
        execution_id: executionId,
        tool_id: request.toolId,
        execution_time_ms: executionTime,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Get execution history for a tool
   */
  getExecutionHistory(toolId: string, limit = 50): ToolExecutionResponse[] {
    const history = this.executionHistory.get(toolId) || [];
    return history
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Get tool examples
   */
  getToolExamples(toolId: string): ToolExample[] {
    const tool = this.getTool(toolId);
    return tool?.examples || [];
  }

  /**
   * Refresh registry from tool mapper
   */
  async refresh(): Promise<void> {
    mcpLogger.info('Refreshing MCP Tool Registry');

    // Clear existing tools
    this.playgroundTools.clear();

    // Rediscover tools
    await this.initialize();

    mcpLogger.info('MCP Tool Registry refreshed', {
      tools_count: this.playgroundTools.size,
    });
  }

  /**
   * Convert mapped tool to playground format
   */
  private convertToPlaygroundTool(mappedTool: MappedTool): PlaygroundTool {
    // Generate examples based on tool schema
    const examples = this.generateToolExamples(mappedTool);

    // Convert Zod schema to JSON Schema for playground UI
    const inputSchema = this.zodToJsonSchema(mappedTool.inputSchema);

    // Determine health status
    const connection = mcpClient.getConnection(mappedTool.serverId);
    const health = this.determineToolHealth(mappedTool, connection);

    return {
      id: mappedTool.id,
      name: mappedTool.name,
      displayName: this.formatDisplayName(mappedTool.name),
      description: mappedTool.description,
      category: mappedTool.metadata.category || 'general',
      namespace: mappedTool.namespace,
      serverId: mappedTool.serverId,
      inputSchema,
      examples,
      metadata: {
        discoveredAt: mappedTool.metadata.discoveredAt.toISOString(),
        lastExecuted: undefined,
        executionCount: mappedTool.metadata.usage_count || 0,
        averageExecutionTime: mappedTool.metadata.avg_execution_time || 0,
        successRate: 1.0, // Start with 100% success rate
        tags: mappedTool.metadata.tags || [],
        isAvailable: health !== 'unavailable',
        health,
      },
    };
  }

  /**
   * Apply filter to tools list
   */
  private applyFilter(tools: PlaygroundTool[], filter: RegistryFilter): PlaygroundTool[] {
    return tools.filter(tool => {
      if (filter.namespace && tool.namespace !== filter.namespace) {
        return false;
      }

      if (filter.category && tool.category !== filter.category) {
        return false;
      }

      if (filter.serverId && tool.serverId !== filter.serverId) {
        return false;
      }

      if (filter.isAvailable !== undefined && tool.metadata.isAvailable !== filter.isAvailable) {
        return false;
      }

      if (filter.health && tool.metadata.health !== filter.health) {
        return false;
      }

      if (filter.tags && filter.tags.length > 0) {
        const hasAnyTag = filter.tags.some(tag => tool.metadata.tags.includes(tag));
        if (!hasAnyTag) {
          return false;
        }
      }

      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const searchable = `${tool.displayName} ${tool.description} ${tool.metadata.tags.join(' ')}`.toLowerCase();
        if (!searchable.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Generate tool examples
   */
  private generateToolExamples(mappedTool: MappedTool): ToolExample[] {
    const examples: ToolExample[] = [];
    const schema = mappedTool.originalTool.inputSchema;

    if (!schema || !schema.properties) {
      return [{
        name: 'Basic Example',
        description: `Basic usage of ${mappedTool.name}`,
        input: {},
        metadata: {
          difficulty: 'basic',
          useCase: 'general',
        },
      }];
    }

    try {
      // Generate basic example
      const basicInput: Record<string, any> = {};
      for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
        basicInput[key] = this.generateExampleValue(prop, 'basic');
      }

      examples.push({
        name: 'Basic Example',
        description: `Basic usage of ${mappedTool.name}`,
        input: basicInput,
        metadata: {
          difficulty: 'basic',
          useCase: 'general',
        },
      });

      // Generate advanced example if tool has multiple parameters
      const paramCount = Object.keys(schema.properties).length;
      if (paramCount > 2) {
        const advancedInput: Record<string, any> = {};
        for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
          advancedInput[key] = this.generateExampleValue(prop, 'advanced');
        }

        examples.push({
          name: 'Advanced Example',
          description: `Advanced usage with all parameters`,
          input: advancedInput,
          metadata: {
            difficulty: 'advanced',
            useCase: 'comprehensive',
          },
        });
      }

    } catch (error) {
      mcpLogger.warn('Failed to generate tool examples', {
        tool_id: mappedTool.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return examples;
  }

  /**
   * Generate example value for schema property
   */
  private generateExampleValue(prop: any, complexity: 'basic' | 'advanced'): any {
    if (!prop || typeof prop !== 'object') {
      return 'example';
    }

    switch (prop.type) {
      case 'string':
        if (prop.enum) {
          return prop.enum[0];
        }
        return complexity === 'basic' ? 'example' : `example_${complexity}`;

      case 'number':
      case 'integer':
        return complexity === 'basic' ? 1 : 42;

      case 'boolean':
        return complexity === 'basic' ? true : false;

      case 'array':
        const itemExample = prop.items ? this.generateExampleValue(prop.items, complexity) : 'item';
        return complexity === 'basic' ? [itemExample] : [itemExample, itemExample];

      case 'object':
        return { key: 'value' };

      default:
        return 'example';
    }
  }

  /**
   * Convert Zod schema to JSON Schema
   */
  private zodToJsonSchema(zodSchema: z.ZodSchema): any {
    // This is a simplified conversion
    // In a real implementation, you might use a library like zod-to-json-schema
    try {
      // For now, return a basic object schema
      return {
        type: 'object',
        properties: {},
        additionalProperties: true,
      };
    } catch (error) {
      return {
        type: 'object',
        additionalProperties: true,
      };
    }
  }

  /**
   * Determine tool health status
   */
  private determineToolHealth(
    mappedTool: MappedTool,
    connection: any
  ): 'healthy' | 'degraded' | 'unavailable' {
    if (!connection || connection.status !== 'connected') {
      return 'unavailable';
    }

    // Check process health
    const processInfo = connection.processInfo;
    if (!processInfo || processInfo.status !== 'running') {
      return 'unavailable';
    }

    if (processInfo.healthStatus === 'unhealthy') {
      return 'degraded';
    }

    // Check tool-specific metrics
    if (mappedTool.metadata.usage_count && mappedTool.metadata.usage_count > 0) {
      // If we have usage data, check success rate and performance
      const avgTime = mappedTool.metadata.avg_execution_time || 0;
      if (avgTime > 30000) { // > 30 seconds average
        return 'degraded';
      }
    }

    return 'healthy';
  }

  /**
   * Format display name
   */
  private formatDisplayName(name: string): string {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Update tool statistics
   */
  private updateToolStats(toolId: string, response: ToolExecutionResponse): void {
    const tool = this.getTool(toolId);
    if (!tool) return;

    const currentCount = tool.metadata.executionCount;
    const currentAvgTime = tool.metadata.averageExecutionTime;
    const currentSuccessRate = tool.metadata.successRate;

    // Update execution count
    tool.metadata.executionCount = currentCount + 1;

    // Update average execution time
    tool.metadata.averageExecutionTime = (currentAvgTime * currentCount + response.executionTime) / (currentCount + 1);

    // Update success rate
    const successCount = Math.round(currentCount * currentSuccessRate);
    const newSuccessCount = successCount + (response.success ? 1 : 0);
    tool.metadata.successRate = newSuccessCount / (currentCount + 1);

    // Update last executed
    tool.metadata.lastExecuted = response.timestamp;

    // Update mapped tool stats
    mcpToolMapper.updateToolUsage(toolId, response.executionTime);
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(toolId: string, args: Record<string, any>): string {
    const argsString = JSON.stringify(args, Object.keys(args).sort());
    return `${toolId}:${Buffer.from(argsString).toString('base64')}`;
  }

  /**
   * Check if cached result is still valid
   */
  private isCacheValid(cachedResult: ToolExecutionResponse): boolean {
    // Cache for 5 minutes
    const cacheTimeout = 5 * 60 * 1000;
    const age = Date.now() - new Date(cachedResult.timestamp).getTime();
    return age < cacheTimeout;
  }

  /**
   * Check if result should be cached
   */
  private shouldCacheResult(toolId: string): boolean {
    // Only cache successful results for certain tool types
    const tool = this.getTool(toolId);
    if (!tool) return false;

    // Cache read-only operations
    const readOnlyCategories = ['search', 'analysis', 'utility'];
    return readOnlyCategories.includes(tool.category);
  }

  /**
   * Add execution to history
   */
  private addToExecutionHistory(toolId: string, response: ToolExecutionResponse): void {
    if (!this.executionHistory.has(toolId)) {
      this.executionHistory.set(toolId, []);
    }

    const history = this.executionHistory.get(toolId)!;
    history.push(response);

    // Keep only last 100 executions
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen to connection events from MCP client
    mcpClient.on('connection:established', async (serverId) => {
      mcpLogger.info('Refreshing tools after connection established', { server_id: serverId });
      try {
        await mcpToolMapper.refreshServerTools(serverId);
        await this.refresh();
      } catch (error) {
        mcpLogger.error('Failed to refresh tools after connection', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    mcpClient.on('connection:lost', (serverId) => {
      mcpLogger.info('Updating tool availability after connection lost', { server_id: serverId });
      this.updateServerToolAvailability(serverId, false);
    });
  }

  /**
   * Update tool availability for a server
   */
  private updateServerToolAvailability(serverId: string, isAvailable: boolean): void {
    for (const [toolId, tool] of this.playgroundTools.entries()) {
      if (tool.serverId === serverId) {
        tool.metadata.isAvailable = isAvailable;
        tool.metadata.health = isAvailable ? 'healthy' : 'unavailable';

        mcpLogger.debug('Updated tool availability', {
          tool_id: toolId,
          server_id: serverId,
          is_available: isAvailable,
        });
      }
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Check every minute
  }

  /**
   * Perform health check on all tools
   */
  private performHealthCheck(): void {
    mcpLogger.debug('Performing tool registry health check');

    for (const [toolId, tool] of this.playgroundTools.entries()) {
      const connection = mcpClient.getConnection(tool.serverId);
      const mappedTool = mcpToolMapper.getMappedTool(toolId);

      if (mappedTool) {
        const newHealth = this.determineToolHealth(mappedTool, connection);
        if (tool.metadata.health !== newHealth) {
          tool.metadata.health = newHealth;
          tool.metadata.isAvailable = newHealth !== 'unavailable';

          mcpLogger.info('Tool health status changed', {
            tool_id: toolId,
            previous_health: tool.metadata.health,
            current_health: newHealth,
          });
        }
      }
    }
  }

  /**
   * Shutdown registry
   */
  async shutdown(): Promise<void> {
    mcpLogger.info('Shutting down MCP Tool Registry');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Clear caches
    this.executionCache.clear();
    this.executionHistory.clear();

    mcpLogger.info('MCP Tool Registry shutdown complete');
  }
}

// Export singleton instance
export const mcpToolRegistry = new MCPToolRegistry();