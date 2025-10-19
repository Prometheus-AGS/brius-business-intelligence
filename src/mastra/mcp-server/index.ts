import { EventEmitter } from 'events';
import { Server as HttpServer } from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { z } from 'zod';
import { rootLogger } from '../observability/logger.js';
import { MCPTracer } from '../observability/langfuse.js';

// Protocol and Transport imports
import { MastraMCPProtocolHandler, MCPServerOptions } from './protocol.js';
import { HTTPSSETransport, createHTTPSSETransport, defaultSSETransportOptions } from './transport/http-sse.js';

// Tool wrapper imports
import { agentTools } from './tools/agents.js';
import { workflowTools } from './tools/workflows.js';
import { knowledgeBaseMCPTools } from './tools/knowledge.js';
import { memoryMCPTools } from './tools/memory.js';

/**
 * MCP Server Configuration and Initialization
 * Provides centralized configuration and startup for the Mastra MCP server
 * Supports both stdio and HTTP SSE transports for different client types
 */

export interface MastraMCPServerConfig {
  // Server identification
  name: string;
  version: string;
  description?: string;

  // Transport configuration
  transport: {
    type: 'stdio' | 'sse' | 'both';
    sse?: {
      port?: number;
      host?: string;
      path?: string;
      messagePath?: string;
      cors?: {
        origin?: string | string[] | boolean;
        credentials?: boolean;
        methods?: string[];
        headers?: string[];
      };
      heartbeatInterval?: number;
      maxConnections?: number;
      timeout?: number;
    };
  };

  // Tool configuration
  tools?: {
    enableAgents?: boolean;
    enableWorkflows?: boolean;
    enableKnowledge?: boolean;
    enableMemory?: boolean;
    customTools?: any[];
  };

  // Server options
  options?: {
    enableTracing?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    maxRequestSize?: number;
    requestTimeout?: number;
  };

  // Environment-specific settings
  environment?: 'development' | 'production' | 'test';
}

export interface MastraMCPServerStats {
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  uptime: number;
  connections: {
    total: number;
    active: number;
    sse?: {
      connections: number;
      totalMessages: number;
    };
  };
  tools: {
    registered: number;
    byCategory: Record<string, number>;
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
  };
  memory: {
    used: number;
    total: number;
  };
}

/**
 * Main MCP Server class for Mastra Business Intelligence
 */
export class MastraMCPServer extends EventEmitter {
  private config: Required<MastraMCPServerConfig>;
  private protocolHandler: MastraMCPProtocolHandler | null = null;
  private httpServer: HttpServer | null = null;
  private sseTransport: HTTPSSETransport | null = null;
  private tracer: MCPTracer | null = null;
  private startTime: Date | null = null;
  private stats: MastraMCPServerStats;
  private requestCount = 0;
  private responseTimeSum = 0;

  constructor(config: MastraMCPServerConfig) {
    super();

    // Apply defaults to configuration
    this.config = {
      name: config.name,
      version: config.version,
      description: config.description || 'Mastra Business Intelligence MCP Server',
      transport: {
        type: config.transport.type,
        sse: {
          port: 3001,
          host: '0.0.0.0',
          path: '/mcp/sse',
          messagePath: '/mcp/message',
          ...defaultSSETransportOptions,
          ...config.transport.sse,
        },
      },
      tools: {
        enableAgents: true,
        enableWorkflows: true,
        enableKnowledge: true,
        enableMemory: true,
        customTools: [],
        ...config.tools,
      },
      options: {
        enableTracing: true,
        logLevel: 'info',
        maxRequestSize: 1024 * 1024, // 1MB
        requestTimeout: 30000, // 30 seconds
        ...config.options,
      },
      environment: config.environment || 'development',
    };

    // Initialize stats
    this.stats = {
      status: 'stopped',
      uptime: 0,
      connections: {
        total: 0,
        active: 0,
      },
      tools: {
        registered: 0,
        byCategory: {},
      },
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
      },
      memory: {
        used: 0,
        total: 0,
      },
    };

    // Initialize tracing if enabled
    if (this.config.options.enableTracing) {
      this.tracer = new MCPTracer('mastra-mcp-server', `server-${Date.now()}`, {
        serverName: this.config.name,
        version: this.config.version,
        transport: this.config.transport.type,
        environment: this.config.environment,
      });
    }

    rootLogger.info('Mastra MCP Server initialized', {
      name: this.config.name,
      version: this.config.version,
      transport: this.config.transport.type,
      environment: this.config.environment,
    });
  }

  /**
   * Start the MCP server with configured transports
   */
  async start(): Promise<void> {
    if (this.stats.status !== 'stopped') {
      throw new Error(`Cannot start server in ${this.stats.status} state`);
    }

    try {
      this.stats.status = 'starting';
      this.startTime = new Date();

      rootLogger.info('Starting Mastra MCP Server', {
        name: this.config.name,
        transport: this.config.transport.type,
        tools_config: this.config.tools,
      });

      // Collect all tools based on configuration
      const allTools = this.collectTools();

      // Update tool stats
      this.stats.tools.registered = allTools.length;
      this.stats.tools.byCategory = this.categorizeTools(allTools);

      // Initialize protocol handler
      const protocolOptions: MCPServerOptions = {
        name: this.config.name,
        version: this.config.version,
        tools: allTools,
        resources: [], // Could be extended with custom resources
        enableTracing: this.config.options.enableTracing,
      };

      this.protocolHandler = new MastraMCPProtocolHandler(protocolOptions);

      // Start appropriate transports
      if (this.config.transport.type === 'stdio' || this.config.transport.type === 'both') {
        await this.startStdioTransport();
      }

      if (this.config.transport.type === 'sse' || this.config.transport.type === 'both') {
        await this.startSSETransport();
      }

      this.stats.status = 'running';
      this.emit('started', { config: this.config, stats: this.stats });

      rootLogger.info('Mastra MCP Server started successfully', {
        name: this.config.name,
        transport: this.config.transport.type,
        tools_registered: this.stats.tools.registered,
        uptime: this.getUptime(),
      });

    } catch (error) {
      this.stats.status = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.tracer) {
        this.tracer.end({ error: errorMessage });
      }

      rootLogger.error('Failed to start Mastra MCP Server', {
        name: this.config.name,
        error: errorMessage,
      });

      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start stdio transport for command-line MCP clients
   */
  private async startStdioTransport(): Promise<void> {
    if (!this.protocolHandler) {
      throw new Error('Protocol handler not initialized');
    }

    await this.protocolHandler.start('stdio');

    rootLogger.info('Stdio transport started', {
      name: this.config.name,
    });
  }

  /**
   * Start HTTP SSE transport for web-based MCP clients
   */
  private async startSSETransport(): Promise<void> {
    if (!this.protocolHandler) {
      throw new Error('Protocol handler not initialized');
    }

    if (!this.config.transport.sse) {
      throw new Error('SSE transport configuration not provided');
    }

    // Create SSE transport
    this.sseTransport = createHTTPSSETransport({
      path: this.config.transport.sse.path!,
      messagePath: this.config.transport.sse.messagePath!,
      cors: this.config.transport.sse.cors,
      heartbeatInterval: this.config.transport.sse.heartbeatInterval,
      maxConnections: this.config.transport.sse.maxConnections,
      timeout: this.config.transport.sse.timeout,
      enableTracing: this.config.options.enableTracing,
    });

    // Set up SSE event handlers
    this.sseTransport.on('connection', (connection) => {
      this.stats.connections.total++;
      this.stats.connections.active++;
      if (this.stats.connections.sse) {
        this.stats.connections.sse.connections++;
      } else {
        this.stats.connections.sse = { connections: 1, totalMessages: 0 };
      }

      rootLogger.info('New SSE connection', {
        connection_id: connection.id,
        total_connections: this.stats.connections.active,
        client_info: connection.clientInfo,
      });

      this.emit('connection', connection);
    });

    this.sseTransport.on('disconnection', (connection) => {
      this.stats.connections.active--;
      if (this.stats.connections.sse) {
        this.stats.connections.sse.connections--;
      }

      rootLogger.info('SSE connection closed', {
        connection_id: connection.id,
        remaining_connections: this.stats.connections.active,
        message_count: connection.messageCount,
      });

      this.emit('disconnection', connection);
    });

    this.sseTransport.on('message', async (message) => {
      const startTime = Date.now();
      this.requestCount++;
      this.stats.requests.total++;

      if (this.stats.connections.sse) {
        this.stats.connections.sse.totalMessages++;
      }

      try {
        // Process message through protocol handler
        await this.protocolHandler!.handleMessage(message);

        this.stats.requests.successful++;

        const responseTime = Date.now() - startTime;
        this.responseTimeSum += responseTime;
        this.stats.requests.averageResponseTime = this.responseTimeSum / this.requestCount;

        rootLogger.debug('MCP message processed', {
          message_type: message.type,
          response_time_ms: responseTime,
          success: true,
        });

      } catch (error) {
        this.stats.requests.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        rootLogger.error('MCP message processing failed', {
          message_type: message.type,
          error: errorMessage,
        });

        this.emit('messageError', { message, error });
      }
    });

    // Create HTTP server
    this.httpServer = new HttpServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      // Try to handle with SSE transport
      const handled = await this.sseTransport!.handleRequest(req, res, url);

      if (!handled) {
        // Handle other endpoints (health check, stats, etc.)
        await this.handleHttpRequest(req, res, url);
      }
    });

    // Start HTTP server
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(
        this.config.transport.sse.port,
        this.config.transport.sse.host,
        () => {
          rootLogger.info('HTTP SSE transport started', {
            name: this.config.name,
            host: this.config.transport.sse!.host,
            port: this.config.transport.sse!.port,
            path: this.config.transport.sse!.path,
            message_path: this.config.transport.sse!.messagePath,
          });
          resolve();
        }
      );

      this.httpServer!.on('error', reject);
    });

    // Start protocol handler with SSE transport
    await this.protocolHandler.start('sse', this.sseTransport);
  }

  /**
   * Handle HTTP requests not handled by SSE transport
   */
  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    try {
      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          name: this.config.name,
          version: this.config.version,
          uptime: this.getUptime(),
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      // Stats endpoint
      if (url.pathname === '/stats') {
        const stats = await this.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
        return;
      }

      // Server info endpoint
      if (url.pathname === '/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: this.config.name,
          version: this.config.version,
          description: this.config.description,
          transport: this.config.transport.type,
          tools: {
            total: this.stats.tools.registered,
            categories: this.stats.tools.byCategory,
          },
          environment: this.config.environment,
        }));
        return;
      }

      // 404 for unhandled paths
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('HTTP request handling error', {
        path: url.pathname,
        error: errorMessage,
      });

      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (this.stats.status !== 'running') {
      rootLogger.warn('Attempt to stop server that is not running', {
        current_status: this.stats.status,
      });
      return;
    }

    try {
      this.stats.status = 'stopping';

      rootLogger.info('Stopping Mastra MCP Server', {
        name: this.config.name,
        uptime: this.getUptime(),
      });

      // Stop SSE transport
      if (this.sseTransport) {
        await this.sseTransport.close();
        this.sseTransport = null;
      }

      // Stop HTTP server
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
        });
        this.httpServer = null;
      }

      // Stop protocol handler
      if (this.protocolHandler) {
        await this.protocolHandler.stop();
        this.protocolHandler = null;
      }

      // Complete tracing
      if (this.tracer) {
        this.tracer.end({
          uptime: this.getUptime(),
          stats: this.stats,
        });
      }

      this.stats.status = 'stopped';
      this.emit('stopped', { stats: this.stats });

      rootLogger.info('Mastra MCP Server stopped successfully', {
        name: this.config.name,
        final_uptime: this.getUptime(),
        total_requests: this.stats.requests.total,
      });

    } catch (error) {
      this.stats.status = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);

      rootLogger.error('Error stopping Mastra MCP Server', {
        name: this.config.name,
        error: errorMessage,
      });

      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Collect all tools based on configuration
   */
  private collectTools(): any[] {
    const tools: any[] = [];

    if (this.config.tools.enableAgents) {
      tools.push(...agentTools);
      rootLogger.debug('Added agent tools', { count: agentTools.length });
    }

    if (this.config.tools.enableWorkflows) {
      tools.push(...workflowTools);
      rootLogger.debug('Added workflow tools', { count: workflowTools.length });
    }

    if (this.config.tools.enableKnowledge) {
      tools.push(...knowledgeBaseMCPTools);
      rootLogger.debug('Added knowledge base tools', { count: knowledgeBaseMCPTools.length });
    }

    if (this.config.tools.enableMemory) {
      tools.push(...memoryMCPTools);
      rootLogger.debug('Added memory tools', { count: memoryMCPTools.length });
    }

    if (this.config.tools.customTools && this.config.tools.customTools.length > 0) {
      tools.push(...this.config.tools.customTools);
      rootLogger.debug('Added custom tools', { count: this.config.tools.customTools.length });
    }

    rootLogger.info('Tools collected for MCP server', {
      total_tools: tools.length,
      agents_enabled: this.config.tools.enableAgents,
      workflows_enabled: this.config.tools.enableWorkflows,
      knowledge_enabled: this.config.tools.enableKnowledge,
      memory_enabled: this.config.tools.enableMemory,
      custom_tools: this.config.tools.customTools?.length || 0,
    });

    return tools;
  }

  /**
   * Categorize tools for statistics
   */
  private categorizeTools(tools: any[]): Record<string, number> {
    const categories: Record<string, number> = {};

    for (const tool of tools) {
      let category = 'general';

      if (tool.id.includes('agent')) category = 'agents';
      else if (tool.id.includes('workflow')) category = 'workflows';
      else if (tool.id.includes('knowledge')) category = 'knowledge';
      else if (tool.id.includes('memory')) category = 'memory';

      categories[category] = (categories[category] || 0) + 1;
    }

    return categories;
  }

  /**
   * Get server uptime in milliseconds
   */
  private getUptime(): number {
    return this.startTime ? Date.now() - this.startTime.getTime() : 0;
  }

  /**
   * Get comprehensive server statistics
   */
  async getStats(): Promise<MastraMCPServerStats> {
    // Update memory usage
    const memUsage = process.memoryUsage();
    this.stats.memory = {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
    };

    // Update uptime
    this.stats.uptime = this.getUptime();

    // Update SSE connection stats if available
    if (this.sseTransport) {
      const sseStats = this.sseTransport.getStats();
      this.stats.connections.sse = {
        connections: sseStats.totalConnections,
        totalMessages: sseStats.stats.totalMessages,
      };
    }

    return { ...this.stats };
  }

  /**
   * Get server configuration
   */
  getConfig(): Required<MastraMCPServerConfig> {
    return { ...this.config };
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.stats.status === 'running';
  }

  /**
   * Send message to specific SSE connection
   */
  sendToConnection(connectionId: string, message: any): boolean {
    if (!this.sseTransport) {
      return false;
    }

    return this.sseTransport.sendToConnection(connectionId, message);
  }

  /**
   * Broadcast message to all SSE connections
   */
  broadcast(message: any): number {
    if (!this.sseTransport) {
      return 0;
    }

    return this.sseTransport.broadcast(message);
  }
}

/**
 * Create and configure MCP server instance
 */
export function createMastraMCPServer(config: MastraMCPServerConfig): MastraMCPServer {
  return new MastraMCPServer(config);
}

/**
 * Default MCP server configuration
 */
export const defaultMCPServerConfig: MastraMCPServerConfig = {
  name: 'mastra-business-intelligence',
  version: '1.0.0',
  description: 'Mastra Business Intelligence MCP Server providing AI agents, workflows, and tools',
  transport: {
    type: 'both',
    sse: {
      port: 3001,
      host: '0.0.0.0',
      path: '/mcp/sse',
      messagePath: '/mcp/message',
      cors: {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept'],
      },
      heartbeatInterval: 30000,
      maxConnections: 100,
      timeout: 300000,
    },
  },
  tools: {
    enableAgents: true,
    enableWorkflows: true,
    enableKnowledge: true,
    EnableMemory: true,
    customTools: [],
  },
  options: {
    enableTracing: true,
    logLevel: 'info',
    maxRequestSize: 1024 * 1024,
    requestTimeout: 30000,
  },
  environment: 'development',
};

/**
 * Start MCP server with default configuration
 */
export async function startDefaultMCPServer(): Promise<MastraMCPServer> {
  const server = createMastraMCPServer(defaultMCPServerConfig);
  await server.start();
  return server;
}

rootLogger.info('Mastra MCP Server module initialized', {
  defaultConfig: {
    name: defaultMCPServerConfig.name,
    version: defaultMCPServerConfig.version,
    transport: defaultMCPServerConfig.transport.type,
  },
});