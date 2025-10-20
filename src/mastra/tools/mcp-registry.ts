import { Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { mcpToolRegistry, ToolExecutionRequest } from '../mcp/registry.js';
import { mcpClient } from '../mcp/client.js';
import { mcpToolMapper } from '../mcp/tool-mapper.js';
import { mcpLogger } from '../observability/logger.js';

/**
 * MCP Tool Registration Integration
 * Bridges MCP tools with Mastra's tool system by dynamically registering MCP tools as Mastra tools
 * Provides seamless integration between external MCP servers and Mastra agents
 */

export interface MCPToolWrapper {
  id: string;
  mastraTool: Tool;
  originalToolId: string;
  serverId: string;
  namespace: string;
  metadata: {
    registeredAt: Date;
    lastUsed?: Date;
    usageCount: number;
  };
}

export interface ToolRegistrationOptions {
  enableAutoRegistration?: boolean;
  namespaceFilter?: string[];
  categoryFilter?: string[];
  serverFilter?: string[];
  priorityThreshold?: number;
  includeExamples?: boolean;
  enableCaching?: boolean;
}

const DEFAULT_REGISTRATION_OPTIONS: Required<ToolRegistrationOptions> = {
  enableAutoRegistration: true,
  namespaceFilter: [],
  categoryFilter: [],
  serverFilter: [],
  priorityThreshold: 0,
  includeExamples: true,
  enableCaching: true,
};

/**
 * MCP Tool Registration Manager
 */
export class MCPToolRegistrationManager {
  private registeredTools = new Map<string, MCPToolWrapper>();
  private registrationOptions: Required<ToolRegistrationOptions>;

  constructor(options: ToolRegistrationOptions = {}) {
    this.registrationOptions = { ...DEFAULT_REGISTRATION_OPTIONS, ...options };

    // Listen to registry events for auto-registration
    if (this.registrationOptions.enableAutoRegistration) {
      this.setupAutoRegistration();
    }
  }

  /**
   * Initialize tool registration
   */
  async initialize(): Promise<void> {
    mcpLogger.info('Initializing MCP tool registration');

    try {
      // Initialize the tool registry first
      await mcpToolRegistry.initialize();

      // Register all available tools
      await this.registerAllTools();

      mcpLogger.info('MCP tool registration initialized', {
        registered_tools: this.registeredTools.size,
      });

    } catch (error) {
      mcpLogger.error('Failed to initialize MCP tool registration', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Register all available MCP tools as Mastra tools
   */
  async registerAllTools(): Promise<MCPToolWrapper[]> {
    mcpLogger.info('Registering all MCP tools');

    const playgroundTools = mcpToolRegistry.getAllTools({
      isAvailable: true,
    });

    const registeredTools: MCPToolWrapper[] = [];

    for (const playgroundTool of playgroundTools) {
      try {
        // Check if tool meets registration criteria
        if (!this.shouldRegisterTool(playgroundTool)) {
          mcpLogger.debug('Skipping tool registration due to filters', {
            tool_id: playgroundTool.id,
            namespace: playgroundTool.namespace,
            category: playgroundTool.category,
            server_id: playgroundTool.serverId,
          });
          continue;
        }

        const wrapper = await this.registerTool(playgroundTool.id);
        if (wrapper) {
          registeredTools.push(wrapper);
        }

      } catch (error) {
        mcpLogger.warn('Failed to register MCP tool', {
          tool_id: playgroundTool.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    mcpLogger.info('MCP tool registration completed', {
      attempted: playgroundTools.length,
      successful: registeredTools.length,
      failed: playgroundTools.length - registeredTools.length,
    });

    return registeredTools;
  }

  /**
   * Register individual MCP tool as Mastra tool
   */
  async registerTool(toolId: string): Promise<MCPToolWrapper | null> {
    mcpLogger.info('Registering MCP tool', { tool_id: toolId });

    // Check if already registered
    if (this.registeredTools.has(toolId)) {
      mcpLogger.debug('Tool already registered', { tool_id: toolId });
      return this.registeredTools.get(toolId)!;
    }

    try {
      // Get playground tool information
      const playgroundTool = mcpToolRegistry.getTool(toolId);
      if (!playgroundTool) {
        throw new Error(`Playground tool not found: ${toolId}`);
      }

      if (!playgroundTool.metadata.isAvailable) {
        throw new Error(`Tool is not available: ${toolId}`);
      }

      // Get mapped tool for schema information
      const mappedTool = mcpToolMapper.getMappedTool(toolId);
      if (!mappedTool) {
        throw new Error(`Mapped tool not found: ${toolId}`);
      }

      // Create Mastra tool
      const mastraTool = this.createMastraTool(playgroundTool, mappedTool);

      // Create wrapper
      const wrapper: MCPToolWrapper = {
        id: toolId,
        mastraTool,
        originalToolId: playgroundTool.id,
        serverId: playgroundTool.serverId,
        namespace: playgroundTool.namespace,
        metadata: {
          registeredAt: new Date(),
          usageCount: 0,
        },
      };

      this.registeredTools.set(toolId, wrapper);

      mcpLogger.info('MCP tool registered successfully', {
        tool_id: toolId,
        mastra_tool_id: mastraTool.id,
        server_id: playgroundTool.serverId,
        namespace: playgroundTool.namespace,
      });

      return wrapper;

    } catch (error) {
      mcpLogger.error('Failed to register MCP tool', {
        tool_id: toolId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Unregister MCP tool
   */
  unregisterTool(toolId: string): boolean {
    const wrapper = this.registeredTools.get(toolId);
    if (!wrapper) {
      mcpLogger.warn('Tool not registered', { tool_id: toolId });
      return false;
    }

    this.registeredTools.delete(toolId);

    mcpLogger.info('MCP tool unregistered', {
      tool_id: toolId,
      usage_count: wrapper.metadata.usageCount,
    });

    return true;
  }

  /**
   * Get all registered Mastra tools
   */
  getAllRegisteredTools(): Tool[] {
    return Array.from(this.registeredTools.values()).map(wrapper => wrapper.mastraTool);
  }

  /**
   * Get registered tools by namespace
   */
  getToolsByNamespace(namespace: string): Tool[] {
    return Array.from(this.registeredTools.values())
      .filter(wrapper => wrapper.namespace === namespace)
      .map(wrapper => wrapper.mastraTool);
  }

  /**
   * Get registered tools by server
   */
  getToolsByServer(serverId: string): Tool[] {
    return Array.from(this.registeredTools.values())
      .filter(wrapper => wrapper.serverId === serverId)
      .map(wrapper => wrapper.mastraTool);
  }

  /**
   * Get tool wrapper by ID
   */
  getToolWrapper(toolId: string): MCPToolWrapper | null {
    return this.registeredTools.get(toolId) || null;
  }

  /**
   * Refresh tool registrations for a server
   */
  async refreshServerTools(serverId: string): Promise<Tool[]> {
    mcpLogger.info('Refreshing tool registrations for server', { server_id: serverId });

    // Unregister existing tools for this server
    const existingWrappers = Array.from(this.registeredTools.values())
      .filter(wrapper => wrapper.serverId === serverId);

    for (const wrapper of existingWrappers) {
      this.unregisterTool(wrapper.id);
    }

    // Get updated tools from registry
    const playgroundTools = mcpToolRegistry.getAllTools({
      serverId,
      isAvailable: true,
    });

    // Register new tools
    const newTools: Tool[] = [];
    for (const playgroundTool of playgroundTools) {
      try {
        if (this.shouldRegisterTool(playgroundTool)) {
          const wrapper = await this.registerTool(playgroundTool.id);
          if (wrapper) {
            newTools.push(wrapper.mastraTool);
          }
        }
      } catch (error) {
        mcpLogger.warn('Failed to refresh tool registration', {
          tool_id: playgroundTool.id,
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    mcpLogger.info('Server tool registrations refreshed', {
      server_id: serverId,
      new_tools: newTools.length,
    });

    return newTools;
  }

  /**
   * Get registration statistics
   */
  getRegistrationStats(): {
    totalRegistered: number;
    byNamespace: Record<string, number>;
    byServer: Record<string, number>;
    totalUsage: number;
  } {
    const stats = {
      totalRegistered: this.registeredTools.size,
      byNamespace: {} as Record<string, number>,
      byServer: {} as Record<string, number>,
      totalUsage: 0,
    };

    for (const wrapper of this.registeredTools.values()) {
      // Count by namespace
      stats.byNamespace[wrapper.namespace] = (stats.byNamespace[wrapper.namespace] || 0) + 1;

      // Count by server
      stats.byServer[wrapper.serverId] = (stats.byServer[wrapper.serverId] || 0) + 1;

      // Sum usage
      stats.totalUsage += wrapper.metadata.usageCount;
    }

    return stats;
  }

  /**
   * Create Mastra tool from playground tool
   */
  private createMastraTool(playgroundTool: any, mappedTool: any): Tool {
    const toolId = `mcp-${playgroundTool.id}`;

    // Create execution function that uses MCP registry
    const executeFn = async (args: Record<string, any>, context?: any) => {
      const startTime = Date.now();

      mcpLogger.info('Executing MCP tool via Mastra', {
        tool_id: toolId,
        original_tool_id: playgroundTool.id,
        server_id: playgroundTool.serverId,
        user_id: context?.userId,
      });

      try {
        // Update usage count
        const wrapper = this.registeredTools.get(playgroundTool.id);
        if (wrapper) {
          wrapper.metadata.usageCount++;
          wrapper.metadata.lastUsed = new Date();
        }

        // Execute via registry
        const request: ToolExecutionRequest = {
          toolId: playgroundTool.id,
          arguments: args,
          metadata: {
            sessionId: context?.sessionId,
            userId: context?.userId,
            source: 'agent',
          },
        };

        const response = await mcpToolRegistry.executeTool(request);

        if (!response.success) {
          throw new Error(response.error || 'Tool execution failed');
        }

        const executionTime = Date.now() - startTime;

        mcpLogger.info('MCP tool execution completed via Mastra', {
          tool_id: toolId,
          original_tool_id: playgroundTool.id,
          success: true,
          execution_time_ms: executionTime,
        });

        return response.result;

      } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        mcpLogger.error('MCP tool execution failed via Mastra', {
          tool_id: toolId,
          original_tool_id: playgroundTool.id,
          execution_time_ms: executionTime,
          error: errorMessage,
        });

        throw error;
      }
    };

    // Create the Mastra tool
    const tool = new Tool({
      id: toolId,
      description: this.enhanceToolDescription(playgroundTool),
      inputSchema: mappedTool.inputSchema,
      execute: executeFn,
    });

    mcpLogger.debug('Created Mastra tool from MCP tool', {
      mastra_tool_id: toolId,
      original_tool_id: playgroundTool.id,
      server_id: playgroundTool.serverId,
      namespace: playgroundTool.namespace,
    });

    return tool;
  }

  /**
   * Enhance tool description for Mastra agents
   */
  private enhanceToolDescription(playgroundTool: any): string {
    let description = playgroundTool.description;

    // Add context about the tool source
    description += `\n\nSource: MCP Server "${playgroundTool.serverId}"`;
    description += `\nNamespace: ${playgroundTool.namespace}`;

    // Add category information
    if (playgroundTool.category && playgroundTool.category !== 'general') {
      description += `\nCategory: ${playgroundTool.category}`;
    }

    // Add examples if available and enabled
    if (this.registrationOptions.includeExamples && playgroundTool.examples?.length > 0) {
      description += '\n\nExamples:';
      for (const example of playgroundTool.examples.slice(0, 2)) { // Limit to 2 examples
        description += `\n- ${example.name}: ${example.description}`;
      }
    }

    // Add usage statistics if available
    if (playgroundTool.metadata.executionCount > 0) {
      description += `\n\nUsage Stats: ${playgroundTool.metadata.executionCount} executions, `;
      description += `${(playgroundTool.metadata.successRate * 100).toFixed(1)}% success rate`;
    }

    return description;
  }

  /**
   * Check if tool should be registered based on filters
   */
  private shouldRegisterTool(playgroundTool: any): boolean {
    // Check namespace filter
    if (this.registrationOptions.namespaceFilter.length > 0) {
      if (!this.registrationOptions.namespaceFilter.includes(playgroundTool.namespace)) {
        return false;
      }
    }

    // Check category filter
    if (this.registrationOptions.categoryFilter.length > 0) {
      if (!this.registrationOptions.categoryFilter.includes(playgroundTool.category)) {
        return false;
      }
    }

    // Check server filter
    if (this.registrationOptions.serverFilter.length > 0) {
      if (!this.registrationOptions.serverFilter.includes(playgroundTool.serverId)) {
        return false;
      }
    }

    // Check priority threshold
    const mappedTool = mcpToolMapper.getMappedTool(playgroundTool.id);
    if (mappedTool && mappedTool.priority < this.registrationOptions.priorityThreshold) {
      return false;
    }

    return true;
  }

  /**
   * Setup auto-registration listeners
   */
  private setupAutoRegistration(): void {
    mcpLogger.info('Setting up auto-registration for MCP tools');

    // Listen to MCP client connection events
    mcpClient.on('connection:established', async (serverId) => {
      try {
        mcpLogger.info('Auto-registering tools for newly connected server', { server_id: serverId });
        await this.refreshServerTools(serverId);
      } catch (error) {
        mcpLogger.error('Failed to auto-register tools for server', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    mcpClient.on('connection:lost', (serverId) => {
      mcpLogger.info('Unregistering tools for disconnected server', { server_id: serverId });

      // Unregister tools for disconnected server
      const serverWrappers = Array.from(this.registeredTools.values())
        .filter(wrapper => wrapper.serverId === serverId);

      for (const wrapper of serverWrappers) {
        this.unregisterTool(wrapper.id);
      }
    });

    // Listen to tool discovery events
    mcpClient.on('tools:discovered', async (serverId, tools) => {
      try {
        mcpLogger.info('Auto-registering newly discovered tools', {
          server_id: serverId,
          tools_count: tools.length,
        });
        await this.refreshServerTools(serverId);
      } catch (error) {
        mcpLogger.error('Failed to auto-register newly discovered tools', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Shutdown tool registration
   */
  async shutdown(): Promise<void> {
    mcpLogger.info('Shutting down MCP tool registration');

    // Clear all registrations
    this.registeredTools.clear();

    mcpLogger.info('MCP tool registration shutdown complete');
  }
}

// Export singleton instance
export const mcpToolRegistrationManager = new MCPToolRegistrationManager();

/**
 * Get all registered MCP tools for use in Mastra agents
 */
export function getMCPTools(): Tool[] {
  return mcpToolRegistrationManager.getAllRegisteredTools();
}

/**
 * Get MCP tools by namespace
 */
export function getMCPToolsByNamespace(namespace: string): Tool[] {
  return mcpToolRegistrationManager.getToolsByNamespace(namespace);
}

/**
 * Get MCP tools by server
 */
export function getMCPToolsByServer(serverId: string): Tool[] {
  return mcpToolRegistrationManager.getToolsByServer(serverId);
}

/**
 * Initialize MCP tool registration (call this during application startup)
 */
export async function initializeMCPToolRegistration(): Promise<void> {
  await mcpToolRegistrationManager.initialize();
}