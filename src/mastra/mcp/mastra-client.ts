import { MCPClient, type MastraMCPServerDefinition, type LogMessage } from '@mastra/mcp';
import { mcpLogger } from '../observability/logger.js';
import { mcpConfigLoader, type ResolvedMCPServerConfig } from './config-loader.js';

/**
 * Mastra MCP Client Integration
 * Uses the official @mastra/mcp package for MCP server connections
 * Supports both stdio (local) and HTTP streaming (remote) servers
 */

export interface MastraMCPConnection {
  serverId: string;
  client: MCPClient;
  config: ResolvedMCPServerConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'failed';
  connectedAt?: Date;
  lastActivity?: Date;
  tools: any[];
  resources: any[];
  connectionAttempts: number;
  lastError?: string;
}

export class MastraMCPClientManager {
  private connections = new Map<string, MastraMCPConnection>();
  private isShuttingDown = false;

  constructor() {
    mcpLogger.info('Initializing Mastra MCP Client Manager');
  }

  /**
   * Connect to MCP server using official Mastra MCP client
   */
  async connectToServer(serverId: string, configPath?: string): Promise<MastraMCPConnection> {
    mcpLogger.info('Connecting to MCP server with Mastra client', {
      server_id: serverId,
      config_path: configPath,
    });

    // Get server configuration
    const config = await mcpConfigLoader.getServerConfig(serverId, configPath);
    if (!config) {
      throw new Error(`MCP server configuration not found: ${serverId}`);
    }

    if (!config.enabled) {
      throw new Error(`MCP server is disabled: ${serverId}`);
    }

    // Check if already connected
    const existingConnection = this.connections.get(serverId);
    if (existingConnection && existingConnection.status === 'connected') {
      mcpLogger.info('MCP server already connected', { server_id: serverId });
      return existingConnection;
    }

    try {
      // Create Mastra MCP server definition
      const serverDefinition = this.createServerDefinition(config);
      
      // Create Mastra MCP client
      const client = new MCPClient({
        servers: {
          [serverId]: serverDefinition,
        },
        timeout: config.timeout || 60000,
      });

      // Create connection object
      const connection: MastraMCPConnection = {
        serverId,
        client,
        config,
        status: 'connecting',
        tools: [],
        resources: [],
        connectionAttempts: existingConnection?.connectionAttempts || 0,
      };

      this.connections.set(serverId, connection);

      // Connect to the server (MCPClient handles this internally)
      mcpLogger.info('Establishing connection to MCP server', {
        server_id: serverId,
        server_type: this.getServerType(config),
      });
      
      // Discover tools and resources
      await this.discoverCapabilities(connection);

      connection.status = 'connected';
      connection.connectedAt = new Date();
      connection.lastActivity = new Date();

      mcpLogger.info('MCP server connected successfully', {
        server_id: serverId,
        server_type: this.getServerType(config),
        tools_count: connection.tools.length,
        resources_count: connection.resources.length,
      });

      return connection;

    } catch (error) {
      const connection = this.connections.get(serverId);
      if (connection) {
        connection.status = 'failed';
        connection.lastError = error instanceof Error ? error.message : String(error);
        connection.connectionAttempts++;
      }

      mcpLogger.error('Failed to connect to MCP server', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
        attempts: connection?.connectionAttempts || 0,
      });

      throw error;
    }
  }

  /**
   * Create Mastra MCP server definition from resolved config
   */
  private createServerDefinition(config: ResolvedMCPServerConfig): MastraMCPServerDefinition {
    const isRemoteServer = config.command === 'remote-http' || config.metadata?.serverType === 'remote-http';
    
    if (isRemoteServer) {
      // HTTP server configuration
      const url = config.args[0] || config.metadata?.url;
      if (!url || typeof url !== 'string') {
        throw new Error(`Remote HTTP server URL not found for ${config.id}`);
      }

      mcpLogger.info('Creating HTTP server definition', {
        server_id: config.id,
        url: url,
      });

      // Build headers for HTTP requests
      const headers: Record<string, string> = {
        'User-Agent': 'Mastra-MCP-Client/1.0.0',
      };

      // Add authentication for Supabase servers
      if (config.resolvedEnv?.SUPABASE_ACCESS_TOKEN) {
        headers['Authorization'] = `Bearer ${config.resolvedEnv.SUPABASE_ACCESS_TOKEN}`;
        mcpLogger.info('Added Supabase authentication to HTTP headers', {
          server_id: config.id,
          has_token: Boolean(config.resolvedEnv.SUPABASE_ACCESS_TOKEN),
        });
      }

      return {
        url: new URL(url),
        timeout: config.timeout,
        enableServerLogs: true,
        // Add any additional HTTP-specific options here
        requestInit: {
          headers,
        },
      };
    } else {
      // Stdio server configuration
      mcpLogger.info('Creating stdio server definition', {
        server_id: config.id,
        command: config.resolvedCommand,
        args: config.args,
      });

      return {
        command: config.resolvedCommand,
        args: config.args || [],
        env: config.resolvedEnv,
        timeout: config.timeout,
        enableServerLogs: true,
        logger: (logMessage: LogMessage) => {
          mcpLogger.info('MCP Server Log', {
            server_id: config.id,
            level: logMessage.level,
            message: logMessage.message,
            timestamp: logMessage.timestamp,
          });
        },
      };
    }
  }

  /**
   * Discover tools and resources from connected server
   */
  private async discoverCapabilities(connection: MastraMCPConnection): Promise<void> {
    mcpLogger.info('Discovering MCP server capabilities', { 
      server_id: connection.serverId 
    });

    try {
      // Get tools from the connected server using the official API
      const tools = await connection.client.getTools();
      connection.tools = Object.entries(tools).map(([name, tool]) => ({
        name: name.replace(`${connection.serverId}_`, ''), // Remove server prefix
        originalName: name,
        tool,
        serverId: connection.serverId,
      }));

      // Get resources from the connected server
      const resourcesResponse = await connection.client.resources.list();
      connection.resources = resourcesResponse[connection.serverId] || [];

      mcpLogger.info('MCP server capabilities discovered', {
        server_id: connection.serverId,
        tools_count: connection.tools.length,
        resources_count: connection.resources.length,
        tool_names: connection.tools.map(t => t.name),
      });

    } catch (error) {
      mcpLogger.error('Failed to discover MCP server capabilities', {
        server_id: connection.serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Don't throw - allow connection to succeed even if discovery fails
      connection.tools = [];
      connection.resources = [];
    }
  }

  /**
   * Execute tool on MCP server
   */
  async executeTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`No connection to MCP server: ${serverId}`);
    }

    if (connection.status !== 'connected') {
      throw new Error(`MCP server not connected: ${serverId} (status: ${connection.status})`);
    }

    mcpLogger.info('Executing MCP tool', {
      server_id: serverId,
      tool_name: toolName,
      arguments: args,
    });

    try {
      // Get all tools and find the one we want to execute
      const tools = await connection.client.getTools();
      const namespacedToolName = `${serverId}_${toolName}`;
      const tool = tools[namespacedToolName];
      
      if (!tool) {
        throw new Error(`Tool not found: ${toolName} (looked for ${namespacedToolName})`);
      }

      // Execute the tool directly
      const result = await tool.execute(args);

      connection.lastActivity = new Date();

      mcpLogger.info('MCP tool executed successfully', {
        server_id: serverId,
        tool_name: toolName,
      });

      return result;

    } catch (error) {
      mcpLogger.error('MCP tool execution failed', {
        server_id: serverId,
        tool_name: toolName,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Get connection information
   */
  getConnection(serverId: string): MastraMCPConnection | null {
    return this.connections.get(serverId) || null;
  }

  /**
   * Get all connections
   */
  getAllConnections(): MastraMCPConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connected servers
   */
  getConnectedServers(): MastraMCPConnection[] {
    return this.getAllConnections().filter(conn => conn.status === 'connected');
  }

  /**
   * Get all available tools across all connected servers
   */
  getAllTools(): any[] {
    const tools: any[] = [];
    for (const connection of this.getConnectedServers()) {
      tools.push(...connection.tools);
    }
    return tools;
  }

  /**
   * Find tool by name (optionally scoped to server)
   */
  findTool(toolName: string, serverId?: string): any | null {
    const tools = serverId
      ? this.getConnection(serverId)?.tools || []
      : this.getAllTools();

    return tools.find(tool => tool.name === toolName) || null;
  }

  /**
   * Connect to all enabled servers
   */
  async connectToAllServers(configPath?: string): Promise<MastraMCPConnection[]> {
    mcpLogger.info('Connecting to all enabled MCP servers', { config_path: configPath });

    const enabledServers = await mcpConfigLoader.listEnabledServers(configPath);
    const connectPromises = enabledServers.map(server =>
      this.connectToServer(server.id, configPath).catch(error => {
        mcpLogger.error('Failed to connect to server during bulk connect', {
          server_id: server.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
    );

    const results = await Promise.all(connectPromises);
    const successful = results.filter(Boolean) as MastraMCPConnection[];

    mcpLogger.info('Bulk server connection completed', {
      total_servers: enabledServers.length,
      successful_connections: successful.length,
      failed_connections: enabledServers.length - successful.length,
    });

    return successful;
  }

  /**
   * Disconnect from MCP server
   */
  async disconnectFromServer(serverId: string): Promise<void> {
    mcpLogger.info('Disconnecting from MCP server', { server_id: serverId });

    const connection = this.connections.get(serverId);
    if (!connection) {
      mcpLogger.warn('MCP server connection not found', { server_id: serverId });
      return;
    }

    if (connection.status === 'disconnected') {
      mcpLogger.info('MCP server already disconnected', { server_id: serverId });
      return;
    }

    try {
      await connection.client.disconnect();
      connection.status = 'disconnected';

      mcpLogger.info('Disconnected from MCP server', { server_id: serverId });

    } catch (error) {
      connection.status = 'failed';
      connection.lastError = error instanceof Error ? error.message : String(error);

      mcpLogger.error('Failed to disconnect from MCP server', {
        server_id: serverId,
        error: connection.lastError,
      });

      throw error;
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectFromAllServers(): Promise<void> {
    mcpLogger.info('Disconnecting from all MCP servers', {
      connection_count: this.connections.size,
    });

    const disconnectPromises = Array.from(this.connections.keys()).map(serverId =>
      this.disconnectFromServer(serverId).catch(error => {
        mcpLogger.error('Failed to disconnect from server during bulk disconnect', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );

    await Promise.all(disconnectPromises);

    mcpLogger.info('Disconnected from all MCP servers');
  }

  /**
   * Shutdown MCP client manager
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    mcpLogger.info('Shutting down Mastra MCP Client Manager');

    // Disconnect from all servers
    await this.disconnectFromAllServers();

    mcpLogger.info('Mastra MCP Client Manager shutdown complete');
  }

  /**
   * Get server type for logging
   */
  private getServerType(config: ResolvedMCPServerConfig): string {
    const isRemoteServer = config.command === 'remote-http' || config.metadata?.serverType === 'remote-http';
    return isRemoteServer ? 'remote-http' : 'local-stdio';
  }
}

// Export singleton instance
export const mastraMCPClientManager = new MastraMCPClientManager();