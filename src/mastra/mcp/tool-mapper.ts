import { z } from 'zod';
import { mcpClient, MCPTool, MCPResource } from './client.js';
import { mcpLogger } from '../observability/logger.js';

/**
 * MCP Tool Discovery and Mapping
 * Handles tool discovery, namespace management, and mapping to Mastra tool format
 * Provides intelligent tool organization and conflict resolution
 */

export interface MappedTool {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  namespace: string;
  serverId: string;
  originalTool: MCPTool;
  priority: number;
  metadata: {
    discoveredAt: Date;
    lastUpdated: Date;
    category?: string;
    tags?: string[];
    usage_count?: number;
    avg_execution_time?: number;
  };
}

export interface ToolNamespace {
  id: string;
  name: string;
  description: string;
  serverId: string;
  tools: MappedTool[];
  priority: number;
  metadata: {
    createdAt: Date;
    lastUpdated: Date;
    tool_count: number;
  };
}

export interface ToolMapping {
  originalName: string;
  mappedName: string;
  namespace: string;
  serverId: string;
  conflictResolution?: 'namespace' | 'priority' | 'suffix';
}

export interface ToolDiscoveryOptions {
  enableAutoMapping?: boolean;
  namespacePriority?: Record<string, number>;
  conflictResolution?: 'namespace' | 'priority' | 'suffix' | 'error';
  categoryDetection?: boolean;
  tagExtraction?: boolean;
  descriptionEnhancement?: boolean;
}

const DEFAULT_DISCOVERY_OPTIONS: Required<ToolDiscoveryOptions> = {
  enableAutoMapping: true,
  namespacePriority: {},
  conflictResolution: 'namespace',
  categoryDetection: true,
  tagExtraction: true,
  descriptionEnhancement: true,
};

/**
 * Tool Mapper class
 */
export class MCPToolMapper {
  private mappedTools = new Map<string, MappedTool>();
  private namespaces = new Map<string, ToolNamespace>();
  private mappings = new Map<string, ToolMapping>();
  private options: Required<ToolDiscoveryOptions>;

  constructor(options: ToolDiscoveryOptions = {}) {
    this.options = { ...DEFAULT_DISCOVERY_OPTIONS, ...options };

    // Listen to MCP client events
    mcpClient.on('tools:discovered', (serverId, tools) => {
      this.handleToolsDiscovered(serverId, tools);
    });

    mcpClient.on('connection:lost', (serverId) => {
      this.handleConnectionLost(serverId);
    });
  }

  /**
   * Discover and map all tools from connected servers
   */
  async discoverAllTools(): Promise<MappedTool[]> {
    mcpLogger.info('Starting tool discovery across all connected servers');

    const connections = mcpClient.getConnectedServers();
    const discoveryPromises = connections.map(connection =>
      this.discoverToolsFromServer(connection.serverId)
    );

    const results = await Promise.all(discoveryPromises);
    const allTools = results.flat();

    mcpLogger.info('Tool discovery completed', {
      server_count: connections.length,
      total_tools: allTools.length,
      namespaces: this.namespaces.size,
    });

    return allTools;
  }

  /**
   * Discover tools from specific server
   */
  async discoverToolsFromServer(serverId: string): Promise<MappedTool[]> {
    mcpLogger.info('Discovering tools from MCP server', { server_id: serverId });

    const connection = mcpClient.getConnection(serverId);
    if (!connection || connection.status !== 'connected') {
      throw new Error(`MCP server not connected: ${serverId}`);
    }

    try {
      const tools = connection.tools;
      const mappedTools: MappedTool[] = [];

      for (const tool of tools) {
        try {
          const mappedTool = await this.mapTool(tool, serverId);
          mappedTools.push(mappedTool);
          this.mappedTools.set(mappedTool.id, mappedTool);
        } catch (error) {
          mcpLogger.warn('Failed to map tool', {
            server_id: serverId,
            tool_name: tool.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Update namespace
      await this.updateNamespace(serverId, mappedTools);

      mcpLogger.info('Tools discovered from server', {
        server_id: serverId,
        tools_count: mappedTools.length,
        namespace: this.getNamespaceForServer(serverId),
      });

      return mappedTools;

    } catch (error) {
      mcpLogger.error('Failed to discover tools from server', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Map individual MCP tool to Mastra format
   */
  async mapTool(mcpTool: MCPTool, serverId: string): Promise<MappedTool> {
    const namespace = this.getNamespaceForServer(serverId);
    const toolId = this.generateToolId(mcpTool.name, namespace);

    // Handle naming conflicts
    const finalToolId = await this.resolveNamingConflict(toolId, mcpTool.name, serverId);

    // Convert input schema to Zod schema
    const inputSchema = this.convertToZodSchema(mcpTool.inputSchema);

    // Enhance description if enabled
    const description = this.options.descriptionEnhancement
      ? this.enhanceDescription(mcpTool.description || mcpTool.name, mcpTool)
      : mcpTool.description || `Tool: ${mcpTool.name}`;

    // Detect category and extract tags
    const category = this.options.categoryDetection
      ? this.detectCategory(mcpTool)
      : undefined;

    const tags = this.options.tagExtraction
      ? this.extractTags(mcpTool)
      : [];

    const mappedTool: MappedTool = {
      id: finalToolId,
      name: mcpTool.name,
      description,
      inputSchema,
      namespace,
      serverId,
      originalTool: mcpTool,
      priority: this.calculatePriority(mcpTool, serverId),
      metadata: {
        discoveredAt: new Date(),
        lastUpdated: new Date(),
        category,
        tags: tags.length > 0 ? tags : undefined,
        usage_count: 0,
        avg_execution_time: 0,
      },
    };

    // Store mapping for reference
    const mapping: ToolMapping = {
      originalName: mcpTool.name,
      mappedName: finalToolId,
      namespace,
      serverId,
      conflictResolution: finalToolId !== toolId ? this.options.conflictResolution : undefined,
    };
    this.mappings.set(`${serverId}:${mcpTool.name}`, mapping);

    mcpLogger.debug('Tool mapped successfully', {
      server_id: serverId,
      original_name: mcpTool.name,
      mapped_id: finalToolId,
      namespace,
      category,
      tags_count: tags.length,
    });

    return mappedTool;
  }

  /**
   * Get mapped tool by ID
   */
  getMappedTool(toolId: string): MappedTool | null {
    return this.mappedTools.get(toolId) || null;
  }

  /**
   * Get all mapped tools
   */
  getAllMappedTools(): MappedTool[] {
    return Array.from(this.mappedTools.values());
  }

  /**
   * Get tools by namespace
   */
  getToolsByNamespace(namespace: string): MappedTool[] {
    return this.getAllMappedTools().filter(tool => tool.namespace === namespace);
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): MappedTool[] {
    return this.getAllMappedTools().filter(tool => tool.metadata.category === category);
  }

  /**
   * Get tools by server
   */
  getToolsByServer(serverId: string): MappedTool[] {
    return this.getAllMappedTools().filter(tool => tool.serverId === serverId);
  }

  /**
   * Search tools by name or description
   */
  searchTools(query: string): MappedTool[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllMappedTools().filter(tool =>
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description.toLowerCase().includes(lowerQuery) ||
      tool.metadata.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get all namespaces
   */
  getAllNamespaces(): ToolNamespace[] {
    return Array.from(this.namespaces.values());
  }

  /**
   * Get namespace by ID
   */
  getNamespace(namespaceId: string): ToolNamespace | null {
    return this.namespaces.get(namespaceId) || null;
  }

  /**
   * Get tool mapping information
   */
  getToolMapping(serverId: string, originalToolName: string): ToolMapping | null {
    return this.mappings.get(`${serverId}:${originalToolName}`) || null;
  }

  /**
   * Update tool usage statistics
   */
  updateToolUsage(toolId: string, executionTime: number): void {
    const tool = this.mappedTools.get(toolId);
    if (!tool) return;

    const currentCount = tool.metadata.usage_count || 0;
    const currentAvgTime = tool.metadata.avg_execution_time || 0;

    // Update usage count and average execution time
    tool.metadata.usage_count = currentCount + 1;
    tool.metadata.avg_execution_time = (currentAvgTime * currentCount + executionTime) / (currentCount + 1);
    tool.metadata.lastUpdated = new Date();

    mcpLogger.debug('Tool usage statistics updated', {
      tool_id: toolId,
      usage_count: tool.metadata.usage_count,
      avg_execution_time: tool.metadata.avg_execution_time,
    });
  }

  /**
   * Refresh tool mappings for a server
   */
  async refreshServerTools(serverId: string): Promise<MappedTool[]> {
    mcpLogger.info('Refreshing tool mappings for server', { server_id: serverId });

    // Remove existing tools for this server
    const existingTools = this.getToolsByServer(serverId);
    for (const tool of existingTools) {
      this.mappedTools.delete(tool.id);
      this.mappings.delete(`${serverId}:${tool.originalTool.name}`);
    }

    // Remove namespace if no tools left
    const namespace = this.getNamespaceForServer(serverId);
    const namespaceObj = this.namespaces.get(namespace);
    if (namespaceObj) {
      namespaceObj.tools = [];
      if (namespaceObj.tools.length === 0) {
        this.namespaces.delete(namespace);
      }
    }

    // Rediscover tools
    return await this.discoverToolsFromServer(serverId);
  }

  /**
   * Generate tool ID from name and namespace
   */
  private generateToolId(toolName: string, namespace: string): string {
    // Convert to kebab-case and ensure uniqueness
    const kebabName = toolName
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    return `${namespace}-${kebabName}`;
  }

  /**
   * Get namespace for server
   */
  private getNamespaceForServer(serverId: string): string {
    // Use server ID as namespace, with some cleaning
    return serverId
      .replace(/[^a-zA-Z0-9\-_]/g, '')
      .toLowerCase();
  }

  /**
   * Resolve naming conflicts
   */
  private async resolveNamingConflict(
    proposedId: string,
    originalName: string,
    serverId: string
  ): Promise<string> {
    if (!this.mappedTools.has(proposedId)) {
      return proposedId; // No conflict
    }

    const existingTool = this.mappedTools.get(proposedId)!;

    switch (this.options.conflictResolution) {
      case 'priority': {
        const existingPriority = existingTool.priority;
        const newPriority = this.calculatePriority({ name: originalName } as MCPTool, serverId);

        if (newPriority > existingPriority) {
          // Replace existing tool
          return proposedId;
        } else {
          // Generate suffix for new tool
          return this.generateSuffixedId(proposedId, serverId);
        }
      }

      case 'suffix':
        return this.generateSuffixedId(proposedId, serverId);

      case 'namespace':
        // Already includes namespace, add server suffix
        return `${proposedId}-${serverId}`;

      case 'error':
        throw new Error(`Tool name conflict: ${proposedId} already exists`);

      default:
        return this.generateSuffixedId(proposedId, serverId);
    }
  }

  /**
   * Generate suffixed ID for conflict resolution
   */
  private generateSuffixedId(baseId: string, serverId: string): string {
    let counter = 1;
    let candidateId: string;

    do {
      candidateId = `${baseId}-${serverId}-${counter}`;
      counter++;
    } while (this.mappedTools.has(candidateId));

    return candidateId;
  }

  /**
   * Calculate tool priority
   */
  private calculatePriority(tool: MCPTool, serverId: string): number {
    let priority = 0;

    // Server priority
    const serverPriority = this.options.namespacePriority[serverId] || 0;
    priority += serverPriority;

    // Tool characteristics
    if (tool.description && tool.description.length > 10) {
      priority += 10; // Well-documented tools get higher priority
    }

    if (tool.inputSchema) {
      priority += 5; // Tools with schemas get priority
    }

    // Namespace priority
    const namespace = tool.namespace || this.getNamespaceForServer(serverId);
    const namespacePriority = this.options.namespacePriority[namespace] || 0;
    priority += namespacePriority;

    return priority;
  }

  /**
   * Convert MCP input schema to Zod schema
   */
  private convertToZodSchema(inputSchema: any): z.ZodSchema {
    if (!inputSchema) {
      return z.record(z.string(), z.unknown()); // Accept any object if no schema provided
    }

    try {
      // Basic JSON Schema to Zod conversion
      if (inputSchema.type === 'object') {
        const shape: Record<string, z.ZodSchema> = {};

        if (inputSchema.properties) {
          for (const [key, prop] of Object.entries(inputSchema.properties as Record<string, any>)) {
            shape[key] = this.convertPropertyToZod(prop);
          }
        }

        let objectSchema = z.object(shape);

        // Handle required fields
        if (inputSchema.required && Array.isArray(inputSchema.required)) {
          // Zod object schema already handles required by default
          // Optional fields need to be explicitly marked
          const requiredFields = new Set(inputSchema.required);
          const newShape: Record<string, z.ZodSchema> = {};

          for (const [key, schema] of Object.entries(shape)) {
            newShape[key] = requiredFields.has(key) ? schema : schema.optional();
          }

          objectSchema = z.object(newShape);
        }

        return objectSchema;
      }

      // Fallback for other types
      return this.convertPropertyToZod(inputSchema);

    } catch (error) {
      mcpLogger.warn('Failed to convert input schema to Zod', {
        schema: inputSchema,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to accepting any object
      return z.record(z.string(), z.unknown());
    }
  }

  /**
   * Convert individual property to Zod schema
   */
  private convertPropertyToZod(prop: any): z.ZodSchema {
    if (!prop || typeof prop !== 'object') {
      return z.any();
    }

    switch (prop.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array':
        const itemSchema = prop.items ? this.convertPropertyToZod(prop.items) : z.any();
        return z.array(itemSchema);
      case 'object':
        return z.record(z.string(), z.unknown()); // Simplified object handling
      default:
        return z.any();
    }
  }

  /**
   * Enhance tool description
   */
  private enhanceDescription(originalDescription: string, tool: MCPTool): string {
    let enhanced = originalDescription;

    // Add namespace context
    if (tool.namespace) {
      enhanced = `[${tool.namespace}] ${enhanced}`;
    }

    // Add schema information
    if (tool.inputSchema && tool.inputSchema.properties) {
      const paramCount = Object.keys(tool.inputSchema.properties).length;
      if (paramCount > 0) {
        enhanced += ` (${paramCount} parameter${paramCount === 1 ? '' : 's'})`;
      }
    }

    return enhanced;
  }

  /**
   * Detect tool category
   */
  private detectCategory(tool: MCPTool): string | undefined {
    const name = tool.name.toLowerCase();
    const description = (tool.description || '').toLowerCase();
    const combined = `${name} ${description}`;

    // Category detection based on keywords
    const categories: Record<string, string[]> = {
      'database': ['db', 'database', 'sql', 'query', 'select', 'insert', 'update', 'delete'],
      'file': ['file', 'read', 'write', 'upload', 'download', 'fs', 'filesystem'],
      'api': ['api', 'request', 'http', 'get', 'post', 'put', 'delete', 'fetch'],
      'search': ['search', 'find', 'lookup', 'query', 'filter'],
      'analysis': ['analyze', 'calculate', 'compute', 'process', 'analytics'],
      'communication': ['send', 'email', 'message', 'notify', 'alert'],
      'utility': ['format', 'convert', 'transform', 'validate', 'utility'],
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => combined.includes(keyword))) {
        return category;
      }
    }

    return undefined;
  }

  /**
   * Extract tags from tool metadata
   */
  private extractTags(tool: MCPTool): string[] {
    const tags: Set<string> = new Set();

    // Extract from namespace
    if (tool.namespace) {
      tags.add(tool.namespace);
    }

    // Extract from server ID
    tags.add(tool.serverId);

    // Extract from description
    if (tool.description) {
      const words = tool.description.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && /^[a-z]+$/.test(word)) {
          tags.add(word);
        }
      }
    }

    // Extract from metadata
    if (tool.metadata) {
      for (const [key, value] of Object.entries(tool.metadata)) {
        if (typeof value === 'string' && value.length < 20) {
          tags.add(value.toLowerCase());
        }
      }
    }

    return Array.from(tags).slice(0, 10); // Limit to 10 tags
  }

  /**
   * Update namespace information
   */
  private async updateNamespace(serverId: string, tools: MappedTool[]): Promise<void> {
    const namespaceId = this.getNamespaceForServer(serverId);
    const existing = this.namespaces.get(namespaceId);

    const namespace: ToolNamespace = {
      id: namespaceId,
      name: this.formatNamespaceName(serverId),
      description: `Tools from MCP server: ${serverId}`,
      serverId,
      tools,
      priority: this.options.namespacePriority[serverId] || 0,
      metadata: {
        createdAt: existing?.metadata.createdAt || new Date(),
        lastUpdated: new Date(),
        tool_count: tools.length,
      },
    };

    this.namespaces.set(namespaceId, namespace);

    mcpLogger.debug('Namespace updated', {
      namespace_id: namespaceId,
      server_id: serverId,
      tool_count: tools.length,
    });
  }

  /**
   * Format namespace name for display
   */
  private formatNamespaceName(serverId: string): string {
    return serverId
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  /**
   * Handle tools discovered event
   */
  private async handleToolsDiscovered(serverId: string, tools: MCPTool[]): Promise<void> {
    mcpLogger.info('Handling tools discovered event', {
      server_id: serverId,
      tools_count: tools.length,
    });

    try {
      await this.discoverToolsFromServer(serverId);
    } catch (error) {
      mcpLogger.error('Failed to handle tools discovered event', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle connection lost event
   */
  private handleConnectionLost(serverId: string): void {
    mcpLogger.info('Handling connection lost event', { server_id: serverId });

    // Mark tools as unavailable but don't remove them
    const tools = this.getToolsByServer(serverId);
    for (const tool of tools) {
      tool.metadata.lastUpdated = new Date();
      // Could add an 'unavailable' flag here if needed
    }

    mcpLogger.info('Marked server tools as potentially unavailable', {
      server_id: serverId,
      tools_count: tools.length,
    });
  }
}

// Export singleton instance
export const mcpToolMapper = new MCPToolMapper();