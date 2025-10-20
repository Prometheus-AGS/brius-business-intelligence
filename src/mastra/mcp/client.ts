import { EventEmitter } from 'events';
import { mcpConfigLoader, ResolvedMCPServerConfig } from './config-loader.js';
import { mcpProcessManager, ProcessInfo } from './process-manager.js';
import { mcpLogger } from '../observability/logger.js';

/**
 * MCP Client
 * Manages connections to MCP servers and handles protocol communication
 * Provides high-level interface for tool discovery, execution, and server management
 */

export interface MCPConnection {
  serverId: string;
  config: ResolvedMCPServerConfig;
  processInfo: ProcessInfo;
  status: ConnectionStatus;
  connectedAt?: Date;
  lastActivity?: Date;
  tools: MCPTool[];
  resources: MCPResource[];
  connectionAttempts: number;
  lastError?: string;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'timeout';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: unknown;
  namespace?: string;
  serverId: string;
  metadata?: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  serverId: string;
  metadata?: Record<string, unknown>;
}

export interface MCPToolCall {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  serverId: string;
  timestamp: Date;
}

export interface MCPToolResult {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
  serverId: string;
  metadata?: Record<string, unknown>;
}

export interface MCPClientOptions {
  connectionTimeout?: number;
  requestTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  enableAutoReconnect?: boolean;
  heartbeatInterval?: number;
  bufferSize?: number;
}

const DEFAULT_CLIENT_OPTIONS: Required<MCPClientOptions> = {
  connectionTimeout: 10000,  // 10 seconds
  requestTimeout: 30000,     // 30 seconds
  maxRetries: 3,
  retryDelay: 2000,          // 2 seconds
  enableAutoReconnect: true,
  heartbeatInterval: 30000,  // 30 seconds
  bufferSize: 1024 * 1024,   // 1MB
};

export interface MCPClientEvents {
  'connection:established': (serverId: string, connection: MCPConnection) => void;
  'connection:lost': (serverId: string, connection: MCPConnection) => void;
  'connection:failed': (serverId: string, error: Error) => void;
  'tools:discovered': (serverId: string, tools: MCPTool[]) => void;
  'resources:discovered': (serverId: string, resources: MCPResource[]) => void;
  'tool:executed': (toolCall: MCPToolCall, result: MCPToolResult) => void;
  'error': (serverId: string, error: Error) => void;
}

/**
 * MCP Client class
 */
export class MCPClient extends EventEmitter {
  private connections = new Map<string, MCPConnection>();
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private options: Required<MCPClientOptions>;
  private isShuttingDown = false;

  constructor(options: MCPClientOptions = {}) {
    super();
    this.options = { ...DEFAULT_CLIENT_OPTIONS, ...options };

    // Listen to process manager events
    mcpProcessManager.on('process:started', (serverId) => {
      this.handleProcessStarted(serverId);
    });

    mcpProcessManager.on('process:stopped', (serverId) => {
      this.handleProcessStopped(serverId);
    });

    mcpProcessManager.on('process:failed', (serverId) => {
      this.handleProcessFailed(serverId);
    });
  }

  /**
   * Initialize connection to MCP server
   */
  async connectToServer(serverId: string, configPath?: string): Promise<MCPConnection> {
    mcpLogger.info('Initializing MCP server connection', {
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
      // Ensure process is running
      let processInfo = mcpProcessManager.getProcessInfo(serverId);
      if (!processInfo || processInfo.status !== 'running') {
        mcpLogger.info('Starting MCP server process', { server_id: serverId });
        processInfo = await mcpProcessManager.startServer(serverId, configPath);
      }

      // Create connection object
      const connection: MCPConnection = {
        serverId,
        config,
        processInfo,
        status: 'connecting',
        tools: [],
        resources: [],
        connectionAttempts: existingConnection?.connectionAttempts || 0,
      };

      this.connections.set(serverId, connection);

      // Establish connection
      await this.establishConnection(connection);

      // Discover tools and resources
      await this.discoverCapabilities(connection);

      // Start heartbeat monitoring
      this.startHeartbeat(serverId);

      this.emit('connection:established', serverId, connection);

      mcpLogger.info('MCP server connection established', {
        server_id: serverId,
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

      this.emit('connection:failed', serverId, error instanceof Error ? error : new Error(String(error)));

      // Schedule reconnection if enabled
      if (this.options.enableAutoReconnect && connection) {
        this.scheduleReconnection(serverId);
      }

      throw error;
    }
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
      // Stop heartbeat monitoring
      this.stopHeartbeat(serverId);

      // Clear any reconnection timers
      const reconnectTimer = this.reconnectTimers.get(serverId);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        this.reconnectTimers.delete(serverId);
      }

      // Close connection
      await this.closeConnection(connection);

      connection.status = 'disconnected';
      this.emit('connection:lost', serverId, connection);

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
   * Execute tool on MCP server
   */
  async executeTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<MCPToolResult> {
    const startTime = Date.now();
    const toolCallId = `${serverId}_${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const toolCall: MCPToolCall = {
      id: toolCallId,
      tool: toolName,
      arguments: args,
      serverId,
      timestamp: new Date(),
    };

    mcpLogger.info('Executing MCP tool', {
      server_id: serverId,
      tool_name: toolName,
      call_id: toolCallId,
      arguments: args,
    });

    try {
      const connection = this.connections.get(serverId);
      if (!connection) {
        throw new Error(`No connection to MCP server: ${serverId}`);
      }

      if (connection.status !== 'connected') {
        throw new Error(`MCP server not connected: ${serverId} (status: ${connection.status})`);
      }

      // Check if tool exists
      const tool = connection.tools.find(t => t.name === toolName);
      if (!tool) {
        throw new Error(`Tool not found on MCP server: ${toolName} (server: ${serverId})`);
      }

      // Validate arguments against tool schema
      if (tool.inputSchema) {
        try {
          this.validateToolArguments(args, tool.inputSchema);
        } catch (validationError) {
          throw new Error(`Tool argument validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
        }
      }

      // Execute tool (this would be actual MCP protocol communication)
      const result = await this.executeToolCall(connection, toolCall);

      const executionTime = Date.now() - startTime;
      const toolResult: MCPToolResult = {
        id: toolCallId,
        success: true,
        result,
        executionTime,
        serverId,
        metadata: {
          tool_name: toolName,
          arguments_count: Object.keys(args).length,
        },
      };

      // Update connection activity
      connection.lastActivity = new Date();

      this.emit('tool:executed', toolCall, toolResult);

      mcpLogger.info('MCP tool executed successfully', {
        server_id: serverId,
        tool_name: toolName,
        call_id: toolCallId,
        execution_time_ms: executionTime,
      });

      return toolResult;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const toolResult: MCPToolResult = {
        id: toolCallId,
        success: false,
        error: errorMessage,
        executionTime,
        serverId,
        metadata: {
          tool_name: toolName,
          arguments_count: Object.keys(args).length,
        },
      };

      this.emit('tool:executed', toolCall, toolResult);

      mcpLogger.error('MCP tool execution failed', {
        server_id: serverId,
        tool_name: toolName,
        call_id: toolCallId,
        execution_time_ms: executionTime,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Get connection information
   */
  getConnection(serverId: string): MCPConnection | null {
    return this.connections.get(serverId) || null;
  }

  /**
   * Get all connections
   */
  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connected servers
   */
  getConnectedServers(): MCPConnection[] {
    return this.getAllConnections().filter(conn => conn.status === 'connected');
  }

  /**
   * Get all available tools across all connected servers
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const connection of this.getConnectedServers()) {
      tools.push(...connection.tools);
    }
    return tools;
  }

  /**
   * Get tools by namespace
   */
  getToolsByNamespace(namespace: string): MCPTool[] {
    return this.getAllTools().filter(tool => tool.namespace === namespace);
  }

  /**
   * Find tool by name (optionally scoped to server)
   */
  findTool(toolName: string, serverId?: string): MCPTool | null {
    const tools = serverId
      ? this.getConnection(serverId)?.tools || []
      : this.getAllTools();

    return tools.find(tool => tool.name === toolName) || null;
  }

  /**
   * Connect to all enabled servers
   */
  async connectToAllServers(configPath?: string): Promise<MCPConnection[]> {
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
    const successful = results.filter(Boolean) as MCPConnection[];

    mcpLogger.info('Bulk server connection completed', {
      total_servers: enabledServers.length,
      successful_connections: successful.length,
      failed_connections: enabledServers.length - successful.length,
    });

    return successful;
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
   * Shutdown MCP client
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    mcpLogger.info('Shutting down MCP Client');

    // Clear all timers
    this.heartbeatTimers.forEach(timer => {
      clearInterval(timer);
    });
    this.reconnectTimers.forEach(timer => {
      clearTimeout(timer);
    });
    this.heartbeatTimers.clear();
    this.reconnectTimers.clear();

    // Disconnect from all servers
    await this.disconnectFromAllServers();

    mcpLogger.info('MCP Client shutdown complete');
  }

  /**
   * Establish connection to MCP server (protocol-specific implementation)
   */
  private async establishConnection(connection: MCPConnection): Promise<void> {
    mcpLogger.debug('Establishing MCP connection', { server_id: connection.serverId });

    // Wait for process to be ready
    let attempts = 0;
    const maxAttempts = Math.ceil(this.options.connectionTimeout / 1000);

    while (attempts < maxAttempts) {
      const processInfo = mcpProcessManager.getProcessInfo(connection.serverId);
      if (processInfo && processInfo.status === 'running' && processInfo.healthStatus === 'healthy') {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error(`Connection timeout: MCP server not ready (${connection.serverId})`);
    }

    // TODO: Implement actual MCP protocol handshake
    // This would involve:
    // 1. Opening stdio pipes to the process
    // 2. Sending initialization message
    // 3. Handling protocol negotiation
    // 4. Setting up message handling

    connection.status = 'connected';
    connection.connectedAt = new Date();
    connection.lastActivity = new Date();

    mcpLogger.debug('MCP connection established', { server_id: connection.serverId });
  }

  /**
   * Close connection to MCP server
   */
  private async closeConnection(connection: MCPConnection): Promise<void> {
    mcpLogger.debug('Closing MCP connection', { server_id: connection.serverId });

    // TODO: Implement actual connection cleanup
    // This would involve:
    // 1. Sending shutdown message
    // 2. Closing stdio pipes
    // 3. Waiting for graceful shutdown

    mcpLogger.debug('MCP connection closed', { server_id: connection.serverId });
  }

  /**
   * Discover tools and resources from MCP server
   */
  private async discoverCapabilities(connection: MCPConnection): Promise<void> {
    mcpLogger.debug('Discovering MCP server capabilities', { server_id: connection.serverId });

    // TODO: Implement actual capability discovery
    // This would involve:
    // 1. Sending tools/list request
    // 2. Sending resources/list request
    // 3. Parsing responses and populating connection.tools and connection.resources

    // Mock implementation for now
    connection.tools = [
      {
        name: `${connection.serverId}_example_tool`,
        description: `Example tool from ${connection.serverId}`,
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          },
          required: ['input']
        },
        namespace: connection.serverId,
        serverId: connection.serverId,
      }
    ];

    connection.resources = [];

    this.emit('tools:discovered', connection.serverId, connection.tools);
    this.emit('resources:discovered', connection.serverId, connection.resources);

    mcpLogger.info('MCP server capabilities discovered', {
      server_id: connection.serverId,
      tools_count: connection.tools.length,
      resources_count: connection.resources.length,
    });
  }

  /**
   * Execute tool call (protocol-specific implementation)
   */
  private async executeToolCall(connection: MCPConnection, toolCall: MCPToolCall): Promise<any> {
    mcpLogger.debug('Executing tool call via MCP protocol', {
      server_id: connection.serverId,
      tool_name: toolCall.tool,
      call_id: toolCall.id,
    });

    // TODO: Implement actual tool execution
    // This would involve:
    // 1. Sending tools/call request with tool name and arguments
    // 2. Handling the response
    // 3. Processing any errors

    // Mock implementation for now
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate execution time

    return {
      message: `Tool ${toolCall.tool} executed successfully`,
      arguments: toolCall.arguments,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate tool arguments against schema
   */
  private validateToolArguments(args: Record<string, any>, schema: any): void {
    // TODO: Implement JSON schema validation
    // For now, just basic type checking
    if (typeof args !== 'object' || args === null) {
      throw new Error('Tool arguments must be an object');
    }
  }

  /**
   * Start heartbeat monitoring for connection
   */
  private startHeartbeat(serverId: string): void {
    if (this.heartbeatTimers.has(serverId)) {
      clearInterval(this.heartbeatTimers.get(serverId)!);
    }

    const timer = setInterval(() => {
      this.performHeartbeat(serverId);
    }, this.options.heartbeatInterval);

    this.heartbeatTimers.set(serverId, timer);
  }

  /**
   * Stop heartbeat monitoring for connection
   */
  private stopHeartbeat(serverId: string): void {
    const timer = this.heartbeatTimers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(serverId);
    }
  }

  /**
   * Perform heartbeat check
   */
  private async performHeartbeat(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection || connection.status !== 'connected') {
      return;
    }

    try {
      // TODO: Implement actual heartbeat/ping
      // For now, just check if process is still running
      const processInfo = mcpProcessManager.getProcessInfo(serverId);
      if (!processInfo || processInfo.status !== 'running') {
        throw new Error('MCP server process is not running');
      }

      connection.lastActivity = new Date();

    } catch (error) {
      mcpLogger.warn('Heartbeat failed for MCP server', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
      });

      connection.status = 'failed';
      connection.lastError = error instanceof Error ? error.message : String(error);

      this.emit('connection:lost', serverId, connection);

      // Schedule reconnection if enabled
      if (this.options.enableAutoReconnect) {
        this.scheduleReconnection(serverId);
      }
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(serverId: string): void {
    // Clear existing reconnection timer
    const existingTimer = this.reconnectTimers.get(serverId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(serverId);

      try {
        await this.connectToServer(serverId);
      } catch (error) {
        mcpLogger.error('Scheduled reconnection failed', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.options.retryDelay);

    this.reconnectTimers.set(serverId, timer);

    mcpLogger.info('Scheduled MCP server reconnection', {
      server_id: serverId,
      delay_ms: this.options.retryDelay,
    });
  }

  /**
   * Handle process manager events
   */
  private handleProcessStarted(serverId: string): void {
    const connection = this.connections.get(serverId);
    if (connection && connection.status === 'failed') {
      // Try to reconnect
      this.connectToServer(serverId).catch(error => {
        mcpLogger.error('Failed to reconnect after process restart', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private handleProcessStopped(serverId: string): void {
    const connection = this.connections.get(serverId);
    if (connection && connection.status === 'connected') {
      connection.status = 'disconnected';
      this.emit('connection:lost', serverId, connection);
    }
  }

  private handleProcessFailed(serverId: string): void {
    const connection = this.connections.get(serverId);
    if (connection) {
      connection.status = 'failed';
      this.emit('connection:lost', serverId, connection);

      // Schedule reconnection if enabled
      if (this.options.enableAutoReconnect) {
        this.scheduleReconnection(serverId);
      }
    }
  }
}

// Export singleton instance
export const mcpClient = new MCPClient();