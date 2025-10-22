import { Tool } from '@mastra/core/tools';
import { z } from 'zod';
import { mcpToolRegistry } from '../mcp/registry.js';
import type { ToolExecutionRequest, PlaygroundTool } from '../mcp/registry.js';
import { mcpClient } from '../mcp/client.js';
import { mcpToolMapper } from '../mcp/tool-mapper.js';
import type { MappedTool } from '../mcp/tool-mapper.js';
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
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

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
    // Prevent multiple simultaneous initializations
    if (this.isInitialized) {
      mcpLogger.debug('MCP Tool Registration Manager already initialized');
      return;
    }

    if (this.initializationPromise) {
      mcpLogger.debug('MCP Tool Registration Manager initialization in progress, waiting...');
      return this.initializationPromise;
    }

    this.initializationPromise = this.performInitialization();
    return this.initializationPromise;
  }

  /**
   * Perform the actual initialization
   */
  private async performInitialization(): Promise<void> {
    mcpLogger.info('🔥 STARTING MCP TOOL REGISTRATION MANAGER INITIALIZATION');

    try {
      // Initialize the tool registry first
      mcpLogger.info('🔥 CALLING mcpToolRegistry.initialize()');
      await mcpToolRegistry.initialize();
      mcpLogger.info('🔥 mcpToolRegistry.initialize() COMPLETED');

      // Register all available tools
      mcpLogger.info('🔥 CALLING registerAllTools()');
      await this.registerAllTools();
      mcpLogger.info('🔥 registerAllTools() COMPLETED');

      this.isInitialized = true;
      mcpLogger.info('🔥 MCP TOOL REGISTRATION MANAGER INITIALIZED SUCCESSFULLY', {
        registered_tools: this.registeredTools.size,
        initialization_time: Date.now(),
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      mcpLogger.error('🔥 MCP TOOL REGISTRATION MANAGER INITIALIZATION FAILED', {
        error: errorMessage,
        stack: errorStack,
        registered_tools_before_failure: this.registeredTools.size,
      });

      // Reset initialization state to allow retry
      this.initializationPromise = null;
      
      // Don't throw the error - allow the system to continue with partial functionality
      mcpLogger.warn('🔥 CONTINUING WITH PARTIAL MCP TOOL FUNCTIONALITY', {
        fallback_mode: true,
        registered_tools: this.registeredTools.size,
      });
    }
  }

  /**
   * Register all available MCP tools as Mastra tools
   */
  async registerAllTools(): Promise<MCPToolWrapper[]> {
    mcpLogger.info('🔥 REGISTERING ALL MCP TOOLS - DETAILED DEBUG');

    try {
      mcpLogger.info('🔥 CALLING mcpToolRegistry.getAllTools() with available: true filter');
      const playgroundTools = await mcpToolRegistry.getAllTools({
        available: true,
      });

      mcpLogger.info('🔥 RECEIVED PLAYGROUND TOOLS FROM REGISTRY', {
        tools_count: playgroundTools?.length || 0,
        tools_sample: playgroundTools?.slice(0, 3).map(t => ({
          id: t.id,
          serverId: t.serverId,
          namespace: t.namespace,
          isAvailable: t.metadata?.isAvailable
        })) || []
      });

      if (!playgroundTools || playgroundTools.length === 0) {
        mcpLogger.warn('🔥 NO PLAYGROUND TOOLS AVAILABLE FOR REGISTRATION - trying without availability filter');

        // Try without availability filter to see what tools exist
        const allPlaygroundTools = await mcpToolRegistry.getAllTools();
        mcpLogger.info('🔥 ALL PLAYGROUND TOOLS (without availability filter)', {
          tools_count: allPlaygroundTools?.length || 0,
          tools_sample: allPlaygroundTools?.slice(0, 5).map(t => ({
            id: t.id,
            serverId: t.serverId,
            namespace: t.namespace,
            isAvailable: t.metadata?.isAvailable
          })) || []
        });

        return [];
      }

      const registeredTools: MCPToolWrapper[] = [];

      for (const playgroundTool of playgroundTools) {
        try {
          // Validate playground tool
          if (!this.validatePlaygroundTool(playgroundTool)) {
            mcpLogger.debug('Skipping invalid playground tool', {
              tool_id: (playgroundTool as any)?.id || 'unknown',
            });
            continue;
          }

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
            tool_id: playgroundTool?.id || 'unknown',
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

    } catch (error) {
      mcpLogger.error('Failed to register all MCP tools', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return [];
    }
  }

  /**
   * Validate playground tool structure
   */
  private validatePlaygroundTool(tool: any): tool is PlaygroundTool {
    if (!tool || typeof tool !== 'object') {
      return false;
    }

    const requiredFields = ['id', 'serverId', 'namespace', 'metadata'];
    for (const field of requiredFields) {
      if (!tool[field]) {
        mcpLogger.debug('Playground tool missing required field', {
          tool_id: tool.id || 'unknown',
          missing_field: field,
        });
        return false;
      }
    }

    if (!tool.metadata.isAvailable) {
      mcpLogger.debug('Playground tool not available', {
        tool_id: tool.id,
      });
      return false;
    }

    return true;
  }

  /**
   * Register individual MCP tool as Mastra tool
   */
  async registerTool(toolId: string): Promise<MCPToolWrapper | null> {
    if (!toolId || typeof toolId !== 'string') {
      mcpLogger.error('Invalid tool ID provided for registration', { tool_id: toolId });
      return null;
    }

    mcpLogger.info('Registering MCP tool', { tool_id: toolId });

    // Check if already registered
    if (this.registeredTools.has(toolId)) {
      mcpLogger.debug('Tool already registered', { tool_id: toolId });
      return this.registeredTools.get(toolId)!;
    }

    try {
      // Get playground tool information
      const playgroundTool = await mcpToolRegistry.getTool(toolId);
      if (!playgroundTool) {
        throw new Error(`Playground tool not found: ${toolId}`);
      }

      if (!this.validatePlaygroundTool(playgroundTool)) {
        throw new Error(`Invalid playground tool structure: ${toolId}`);
      }

      if (!playgroundTool.metadata.isAvailable) {
        throw new Error(`Tool is not available: ${toolId}`);
      }

      // Get mapped tool for schema information
      const mappedTool = mcpToolMapper.getMappedTool(toolId);
      if (!mappedTool) {
        throw new Error(`Mapped tool not found: ${toolId}`);
      }

      if (!this.validateMappedTool(mappedTool)) {
        throw new Error(`Invalid mapped tool structure: ${toolId}`);
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
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }

  /**
   * Validate mapped tool structure
   */
  private validateMappedTool(tool: any): tool is MappedTool {
    if (!tool || typeof tool !== 'object') {
      return false;
    }

    if (!tool.inputSchema) {
      mcpLogger.debug('Mapped tool missing input schema', {
        tool_id: tool.id || 'unknown',
      });
      return false;
    }

    return true;
  }

  /**
   * Unregister MCP tool
   */
  unregisterTool(toolId: string): boolean {
    if (!toolId || typeof toolId !== 'string') {
      mcpLogger.error('Invalid tool ID provided for unregistration', { tool_id: toolId });
      return false;
    }

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
    if (!namespace || typeof namespace !== 'string') {
      mcpLogger.warn('Invalid namespace provided', { namespace });
      return [];
    }

    return Array.from(this.registeredTools.values())
      .filter(wrapper => wrapper.namespace === namespace)
      .map(wrapper => wrapper.mastraTool);
  }

  /**
   * Get registered tools by server
   */
  getToolsByServer(serverId: string): Tool[] {
    if (!serverId || typeof serverId !== 'string') {
      mcpLogger.warn('Invalid server ID provided', { server_id: serverId });
      return [];
    }

    return Array.from(this.registeredTools.values())
      .filter(wrapper => wrapper.serverId === serverId)
      .map(wrapper => wrapper.mastraTool);
  }

  /**
   * Get tool wrapper by ID
   */
  getToolWrapper(toolId: string): MCPToolWrapper | null {
    if (!toolId || typeof toolId !== 'string') {
      return null;
    }
    return this.registeredTools.get(toolId) || null;
  }

  /**
   * Refresh tool registrations for a server
   */
  async refreshServerTools(serverId: string): Promise<Tool[]> {
    if (!serverId || typeof serverId !== 'string') {
      mcpLogger.error('Invalid server ID provided for refresh', { server_id: serverId });
      return [];
    }

    mcpLogger.info('Refreshing tool registrations for server', { server_id: serverId });

    try {
      // Unregister existing tools for this server
      const existingWrappers = Array.from(this.registeredTools.values())
        .filter(wrapper => wrapper.serverId === serverId);

      for (const wrapper of existingWrappers) {
        this.unregisterTool(wrapper.id);
      }

      // Get updated tools from registry
      const playgroundTools = await mcpToolRegistry.getAllTools({
        serverId,
        available: true,
      });

      if (!playgroundTools) {
        mcpLogger.warn('No playground tools found for server', { server_id: serverId });
        return [];
      }

      // Register new tools
      const newTools: Tool[] = [];
      for (const playgroundTool of playgroundTools) {
        try {
          if (this.validatePlaygroundTool(playgroundTool) && this.shouldRegisterTool(playgroundTool)) {
            const wrapper = await this.registerTool(playgroundTool.id);
            if (wrapper) {
              newTools.push(wrapper.mastraTool);
            }
          }
        } catch (error) {
          mcpLogger.warn('Failed to refresh tool registration', {
            tool_id: playgroundTool?.id || 'unknown',
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

    } catch (error) {
      mcpLogger.error('Failed to refresh server tools', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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

    const wrappers = Array.from(this.registeredTools.values());
    for (const wrapper of wrappers) {
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
  private createMastraTool(playgroundTool: PlaygroundTool, mappedTool: MappedTool): Tool {
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
        // Validate arguments against schema
        if (mappedTool.inputSchema) {
          try {
            mappedTool.inputSchema.parse(args);
          } catch (validationError) {
            throw new Error(`Invalid arguments: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
          }
        }

        // Update usage count
        const wrapper = this.registeredTools.get(toolId);
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

    // Create the Mastra tool with proper typing
    const toolConfig: any = {
      id: toolId,
      description: this.enhanceToolDescription(playgroundTool),
      execute: executeFn,
    };

    // Only add inputSchema if it exists to avoid type conflicts
    if (mappedTool.inputSchema) {
      toolConfig.inputSchema = mappedTool.inputSchema;
    }

    const tool = new Tool(toolConfig);

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
  private enhanceToolDescription(playgroundTool: PlaygroundTool): string {
    let description = playgroundTool.description || 'No description available';

    // Add context about the tool source
    description += `\n\nSource: MCP Server "${playgroundTool.serverId}"`;
    description += `\nNamespace: ${playgroundTool.namespace}`;

    // Add category information
    if (playgroundTool.category && playgroundTool.category !== 'general') {
      description += `\nCategory: ${playgroundTool.category}`;
    }

    // Add examples if available and enabled (currently not supported by PlaygroundTool interface)
    // TODO: Add examples support when PlaygroundTool interface is updated to include examples
    // if (this.registrationOptions.includeExamples && playgroundTool.examples?.length > 0) {
    //   description += '\n\nExamples:';
    //   for (const example of playgroundTool.examples.slice(0, 2)) { // Limit to 2 examples
    //     description += `\n- ${example.name}: ${example.description}`;
    //   }
    // }

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
  private shouldRegisterTool(playgroundTool: PlaygroundTool): boolean {
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

    try {
      // Listen to MCP client connection events
      mcpClient.on('connection:established', async (serverId: string) => {
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

      mcpClient.on('connection:lost', (serverId: string) => {
        try {
          mcpLogger.info('Unregistering tools for disconnected server', { server_id: serverId });
          
          // Unregister all tools for this server
          const wrappers = Array.from(this.registeredTools.values())
            .filter(wrapper => wrapper.serverId === serverId);
          
          for (const wrapper of wrappers) {
            this.unregisterTool(wrapper.id);
          }
          
          mcpLogger.info('Tools unregistered for disconnected server', {
            server_id: serverId,
            unregistered_count: wrappers.length,
          });
        } catch (error) {
          mcpLogger.error('Failed to unregister tools for disconnected server', {
            server_id: serverId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      mcpClient.on('tools:updated', async (serverId: string) => {
        try {
          mcpLogger.info('Refreshing tools for server with updated tools', { server_id: serverId });
          await this.refreshServerTools(serverId);
        } catch (error) {
          mcpLogger.error('Failed to refresh tools for updated server', {
            server_id: serverId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    } catch (error) {
      mcpLogger.error('Failed to setup auto-registration listeners', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if manager is initialized
   */
  isManagerInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get initialization status
   */
  getInitializationStatus(): {
    initialized: boolean;
    inProgress: boolean;
    registeredToolsCount: number;
  } {
    return {
      initialized: this.isInitialized,
      inProgress: this.initializationPromise !== null && !this.isInitialized,
      registeredToolsCount: this.registeredTools.size,
    };
  }
}

// Global instance
let mcpToolRegistrationManager: MCPToolRegistrationManager | null = null;

/**
 * Initialize MCP tool registration
 */
export async function initializeMCPToolRegistration(options?: ToolRegistrationOptions): Promise<void> {
  if (!mcpToolRegistrationManager) {
    mcpLogger.info('Creating MCP Tool Registration Manager');
    mcpToolRegistrationManager = new MCPToolRegistrationManager(options);
  }

  await mcpToolRegistrationManager.initialize();
}

/**
 * Get MCP tools as Mastra tools
 */
export function getMCPTools(): Tool[] {
  if (!mcpToolRegistrationManager) {
    mcpLogger.warn('🔥 MCP Tool Registration Manager not initialized - returning empty array');
    return [];
  }

  const tools = mcpToolRegistrationManager.getAllRegisteredTools();
  mcpLogger.info('🔥 getMCPTools() called', {
    manager_initialized: !!mcpToolRegistrationManager,
    tools_count: tools.length,
    tool_ids: tools.map(t => t.id),
    tools_sample: tools.slice(0, 3).map(t => ({ id: t.id, description: t.description })),
  });

  return tools;
}

/**
 * Get MCP tool registration manager instance
 */
export function getMCPToolRegistrationManager(): MCPToolRegistrationManager | null {
  return mcpToolRegistrationManager;
}

/**
 * Get MCP tools by namespace
 */
export function getMCPToolsByNamespace(namespace: string): Tool[] {
  if (!mcpToolRegistrationManager) {
    mcpLogger.warn('MCP Tool Registration Manager not initialized');
    return [];
  }

  return mcpToolRegistrationManager.getToolsByNamespace(namespace);
}

/**
 * Get MCP tools by server
 */
export function getMCPToolsByServer(serverId: string): Tool[] {
  if (!mcpToolRegistrationManager) {
    mcpLogger.warn('MCP Tool Registration Manager not initialized');
    return [];
  }

  return mcpToolRegistrationManager.getToolsByServer(serverId);
}

/**
 * Get MCP tool registration statistics
 */
export function getMCPToolRegistrationStats(): {
  totalRegistered: number;
  byNamespace: Record<string, number>;
  byServer: Record<string, number>;
  totalUsage: number;
} | null {
  if (!mcpToolRegistrationManager) {
    return null;
  }

  return mcpToolRegistrationManager.getRegistrationStats();
}
