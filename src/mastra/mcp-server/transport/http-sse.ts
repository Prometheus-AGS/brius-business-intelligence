import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';
import { rootLogger } from '../../observability/logger.js';
import { MCPTracer } from '../../observability/langfuse.js';

/**
 * HTTP SSE Transport Layer for MCP Server
 * Provides Server-Sent Events transport for Model Context Protocol
 * Enables web-based MCP clients to connect over HTTP
 */

export interface SSETransportOptions {
  path: string;
  messagePath: string;
  cors?: {
    origin?: string | string[] | boolean;
    credentials?: boolean;
    methods?: string[];
    headers?: string[];
  };
  heartbeatInterval?: number;
  maxConnections?: number;
  timeout?: number;
  enableTracing?: boolean;
}

export interface SSEConnection {
  id: string;
  response: ServerResponse;
  request: IncomingMessage;
  clientInfo: {
    userAgent?: string;
    origin?: string;
    ipAddress?: string;
  };
  connectedAt: Date;
  lastActivity: Date;
  messageCount: number;
}

export interface SSEMessage {
  id?: string;
  event?: string;
  data: any;
  retry?: number;
}

/**
 * HTTP Server-Sent Events Transport for MCP
 */
export class HTTPSSETransport extends EventEmitter {
  private connections: Map<string, SSEConnection> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private tracer: MCPTracer | null = null;
  private options: Required<SSETransportOptions>;
  private messageId = 0;

  constructor(options: SSETransportOptions) {
    super();

    this.options = {
      heartbeatInterval: 30000, // 30 seconds
      maxConnections: 100,
      timeout: 300000, // 5 minutes
      enableTracing: true,
      ...options,
      cors: {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept'],
        ...options.cors,
      },
    };

    // Initialize tracing if enabled
    if (this.options.enableTracing) {
      this.tracer = new MCPTracer('mcp-sse-transport', `sse-${Date.now()}`, {
        metadata: {
          transport: 'sse',
          path: this.options.path,
          messagePath: this.options.messagePath,
        },
      });
    }

    // Start heartbeat timer
    this.startHeartbeat();

    rootLogger.info('HTTP SSE Transport initialized', {
      path: this.options.path,
      message_path: this.options.messagePath,
      heartbeat_interval: this.options.heartbeatInterval,
      max_connections: this.options.maxConnections,
      timeout: this.options.timeout,
    });
  }

  /**
   * Handle HTTP request for SSE or messages
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const traceId = this.tracer?.startTrace('handle-request', {
      metadata: {
        method: req.method,
        url: url.pathname,
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin,
      },
    });

    try {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        this.handleCORSPreflight(req, res);
        if (traceId) this.tracer?.completeTrace(traceId, { metadata: { type: 'cors-preflight' } });
        return true;
      }

      // Handle SSE connection
      if (url.pathname === this.options.path && req.method === 'GET') {
        await this.handleSSEConnection(req, res);
        if (traceId) this.tracer?.completeTrace(traceId, { metadata: { type: 'sse-connection' } });
        return true;
      }

      // Handle message posting
      if (url.pathname === this.options.messagePath && req.method === 'POST') {
        await this.handleMessagePost(req, res);
        if (traceId) this.tracer?.completeTrace(traceId, { metadata: { type: 'message-post' } });
        return true;
      }

      // Not handled by this transport
      if (traceId) this.tracer?.completeTrace(traceId, { metadata: { type: 'not-handled' } });
      return false;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('HTTP SSE Transport request error', {
        method: req.method,
        url: url.pathname,
        error: errorMessage,
      });
      if (traceId) this.tracer?.failTrace(traceId, errorMessage);

      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      return true;
    }
  }

  /**
   * Handle CORS preflight requests
   */
  private handleCORSPreflight(req: IncomingMessage, res: ServerResponse): void {
    const headers: Record<string, string> = {};

    // Handle origin
    if (this.options.cors.origin === true) {
      headers['Access-Control-Allow-Origin'] = req.headers.origin || '*';
    } else if (typeof this.options.cors.origin === 'string') {
      headers['Access-Control-Allow-Origin'] = this.options.cors.origin;
    } else if (Array.isArray(this.options.cors.origin)) {
      const origin = req.headers.origin;
      if (origin && this.options.cors.origin.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
      }
    }

    // Handle credentials
    if (this.options.cors.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    // Handle methods
    if (this.options.cors.methods) {
      headers['Access-Control-Allow-Methods'] = this.options.cors.methods.join(', ');
    }

    // Handle headers
    if (this.options.cors.headers) {
      headers['Access-Control-Allow-Headers'] = this.options.cors.headers.join(', ');
    }

    headers['Access-Control-Max-Age'] = '86400'; // 24 hours

    res.writeHead(200, headers);
    res.end();
  }

  /**
   * Handle SSE connection establishment
   */
  private async handleSSEConnection(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Check connection limits
    if (this.connections.size >= this.options.maxConnections) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Maximum connections exceeded' }));
      return;
    }

    const connectionId = `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set SSE headers
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    };

    // Add CORS headers for SSE
    if (this.options.cors.origin === true) {
      headers['Access-Control-Allow-Origin'] = req.headers.origin || '*';
    } else if (typeof this.options.cors.origin === 'string') {
      headers['Access-Control-Allow-Origin'] = this.options.cors.origin;
    }

    if (this.options.cors.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    res.writeHead(200, headers);

    // Create connection object
    const connection: SSEConnection = {
      id: connectionId,
      response: res,
      request: req,
      clientInfo: {
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin,
        ipAddress: req.socket.remoteAddress,
      },
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
    };

    // Store connection
    this.connections.set(connectionId, connection);

    // Send initial connection message
    this.sendToConnection(connectionId, {
      event: 'connected',
      data: {
        connectionId,
        serverTime: new Date().toISOString(),
        capabilities: {
          heartbeat: true,
          maxMessageSize: 1024 * 1024, // 1MB
        },
      },
    });

    // Handle connection close
    req.on('close', () => {
      this.handleConnectionClose(connectionId);
    });

    req.on('error', (error) => {
      rootLogger.error('SSE connection error', {
        connection_id: connectionId,
        error: error.message,
      });
      this.handleConnectionClose(connectionId);
    });

    // Set connection timeout
    const timeout = setTimeout(() => {
      rootLogger.info('SSE connection timeout', { connection_id: connectionId });
      this.closeConnection(connectionId);
    }, this.options.timeout);

    // Clear timeout when connection closes
    req.on('close', () => {
      clearTimeout(timeout);
    });

    rootLogger.info('SSE connection established', {
      connection_id: connectionId,
      client_info: connection.clientInfo,
      total_connections: this.connections.size,
    });

    this.emit('connection', connection);
  }

  /**
   * Handle message posting from clients
   */
  private async handleMessagePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Set CORS headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.options.cors.origin === true) {
        headers['Access-Control-Allow-Origin'] = req.headers.origin || '*';
      } else if (typeof this.options.cors.origin === 'string') {
        headers['Access-Control-Allow-Origin'] = this.options.cors.origin;
      }

      if (this.options.cors.credentials) {
        headers['Access-Control-Allow-Credentials'] = 'true';
      }

      // Read request body
      const body = await this.readRequestBody(req);
      const message = JSON.parse(body);

      // Validate message format
      const messageSchema = z.object({
        connectionId: z.string().optional(),
        type: z.string(),
        data: z.any(),
        id: z.string().optional(),
      });

      const validatedMessage = messageSchema.parse(message);

      rootLogger.info('Received message from client', {
        connection_id: validatedMessage.connectionId,
        message_type: validatedMessage.type,
        has_data: Boolean(validatedMessage.data),
      });

      // Emit message event for MCP server to handle
      this.emit('message', validatedMessage);

      // Send response
      res.writeHead(200, headers);
      res.end(JSON.stringify({
        success: true,
        messageId: validatedMessage.id,
        timestamp: new Date().toISOString(),
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('Message post error', { error: errorMessage });

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid message format' }));
    }
  }

  /**
   * Read request body
   */
  private async readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        // Prevent DoS by limiting body size
        if (body.length > 1024 * 1024) { // 1MB limit
          reject(new Error('Request body too large'));
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Send message to specific connection
   */
  sendToConnection(connectionId: string, message: SSEMessage): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      rootLogger.warn('Attempt to send to non-existent connection', { connection_id: connectionId });
      return false;
    }

    try {
      const messageId = message.id || `msg_${++this.messageId}`;
      const eventData = this.formatSSEMessage({
        ...message,
        id: messageId,
      });

      connection.response.write(eventData);
      connection.lastActivity = new Date();
      connection.messageCount++;

      rootLogger.debug('Message sent to SSE connection', {
        connection_id: connectionId,
        message_id: messageId,
        event: message.event,
        message_count: connection.messageCount,
      });

      return true;
    } catch (error) {
      rootLogger.error('Failed to send message to SSE connection', {
        connection_id: connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.handleConnectionClose(connectionId);
      return false;
    }
  }

  /**
   * Broadcast message to all connections
   */
  broadcast(message: SSEMessage): number {
    let successCount = 0;
    const messageId = message.id || `broadcast_${++this.messageId}`;

    rootLogger.info('Broadcasting message to all SSE connections', {
      message_id: messageId,
      event: message.event,
      connections_count: this.connections.size,
    });

    for (const connectionId of this.connections.keys()) {
      if (this.sendToConnection(connectionId, { ...message, id: messageId })) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * Format message for SSE protocol
   */
  private formatSSEMessage(message: SSEMessage): string {
    let formatted = '';

    if (message.id) {
      formatted += `id: ${message.id}\n`;
    }

    if (message.event) {
      formatted += `event: ${message.event}\n`;
    }

    if (message.retry) {
      formatted += `retry: ${message.retry}\n`;
    }

    // Handle multi-line data
    const dataStr = typeof message.data === 'string'
      ? message.data
      : JSON.stringify(message.data);

    const dataLines = dataStr.split('\n');
    for (const line of dataLines) {
      formatted += `data: ${line}\n`;
    }

    formatted += '\n'; // Double newline indicates end of message

    return formatted;
  }

  /**
   * Handle connection close
   */
  private handleConnectionClose(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      rootLogger.info('SSE connection closed', {
        connection_id: connectionId,
        duration_ms: Date.now() - connection.connectedAt.getTime(),
        message_count: connection.messageCount,
        total_connections: this.connections.size - 1,
      });

      this.connections.delete(connectionId);
      this.emit('disconnection', connection);
    }
  }

  /**
   * Close specific connection
   */
  closeConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    try {
      // Send closing message
      this.sendToConnection(connectionId, {
        event: 'closing',
        data: { reason: 'Server initiated close' },
      });

      // Close the response
      connection.response.end();
      this.handleConnectionClose(connectionId);
      return true;
    } catch (error) {
      rootLogger.error('Error closing SSE connection', {
        connection_id: connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.handleConnectionClose(connectionId);
      return true;
    }
  }

  /**
   * Start heartbeat to keep connections alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connections.size === 0) {
        return;
      }

      const heartbeatMessage: SSEMessage = {
        event: 'heartbeat',
        data: {
          timestamp: new Date().toISOString(),
          connections: this.connections.size,
        },
      };

      let activeConnections = 0;
      for (const connectionId of this.connections.keys()) {
        if (this.sendToConnection(connectionId, heartbeatMessage)) {
          activeConnections++;
        }
      }

      rootLogger.debug('Heartbeat sent to SSE connections', {
        active_connections: activeConnections,
        total_connections: this.connections.size,
      });

    }, this.options.heartbeatInterval);
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const now = new Date();
    const connections = Array.from(this.connections.values());

    return {
      totalConnections: this.connections.size,
      connections: connections.map(conn => ({
        id: conn.id,
        connectedAt: conn.connectedAt,
        lastActivity: conn.lastActivity,
        messageCount: conn.messageCount,
        durationMs: now.getTime() - conn.connectedAt.getTime(),
        clientInfo: conn.clientInfo,
      })),
      stats: {
        averageDuration: connections.length > 0
          ? connections.reduce((sum, conn) => sum + (now.getTime() - conn.connectedAt.getTime()), 0) / connections.length
          : 0,
        totalMessages: connections.reduce((sum, conn) => sum + conn.messageCount, 0),
        oldestConnection: connections.length > 0
          ? Math.min(...connections.map(conn => conn.connectedAt.getTime()))
          : null,
      },
    };
  }

  /**
   * Close all connections and stop transport
   */
  async close(): Promise<void> {
    try {
      rootLogger.info('Closing HTTP SSE Transport', {
        active_connections: this.connections.size,
      });

      // Stop heartbeat
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      // Close all connections
      for (const connectionId of this.connections.keys()) {
        this.closeConnection(connectionId);
      }

      // Complete tracing
      if (this.tracer) {
        this.tracer.end({
          metadata: {
            totalConnections: this.connections.size,
            stats: this.getStats(),
          },
        });
      }

      rootLogger.info('HTTP SSE Transport closed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('Error closing HTTP SSE Transport', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Get active connection IDs
   */
  getConnectionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): SSEConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Check if connection exists
   */
  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }
}

/**
 * Create HTTP SSE Transport instance
 */
export function createHTTPSSETransport(options: SSETransportOptions): HTTPSSETransport {
  return new HTTPSSETransport(options);
}

/**
 * Default SSE transport options for MCP server
 */
export const defaultSSETransportOptions: SSETransportOptions = {
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
  enableTracing: true,
};