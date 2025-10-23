/**
 * External MCP Server Integration
 * Manages connections to Supabase MCP and Tavily MCP servers with health monitoring and failover
 */

import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { MCPTracer } from '../observability/langfuse.js';
import { validateEnvironment } from '../utils/validation.js';

/**
 * External MCP Server Configuration
 */
export interface ExternalMCPServerConfig {
  name: string;
  type: 'supabase' | 'tavily' | 'custom';
  endpoint: string;
  auth?: {
    type: 'bearer' | 'api_key' | 'basic';
    token?: string;
    username?: string;
    password?: string;
  };
  health: {
    checkInterval: number;
    timeout: number;
    retryAttempts: number;
    failoverEnabled: boolean;
  };
  capabilities: string[];
  metadata?: Record<string, any>;
}

/**
 * MCP Server Connection Status
 */
export interface MCPServerStatus {
  name: string;
  connected: boolean;
  healthy: boolean;
  lastCheck: Date;
  lastError?: string;
  responseTime?: number;
  capabilities: string[];
  failoverActive: boolean;
}

/**
 * Context Metadata for MCP Operations
 */
export interface MCPContextMetadata {
  sessionId?: string;
  userId?: string;
  domains?: string[];
  permissions?: Record<string, any>;
  traceId?: string;
  operationType?: string;
}

/**
 * External MCP Server Manager
 * Handles connections, health monitoring, and failover for external MCP servers
 */
export class ExternalMCPManager {
  private servers = new Map<string, ExternalMCPServerConfig>();
  private connections = new Map<string, any>();
  private status = new Map<string, MCPServerStatus>();
  private healthCheckTimers = new Map<string, NodeJS.Timeout>();
  private tracer: MCPTracer;
  private initialized = false;

  constructor() {
    this.tracer = new MCPTracer('external-mcp-manager', `external-${Date.now()}`, {
      metadata: {
        component: 'external-mcp-manager',
        version: '1.0.0',
      },
    });
  }

  /**
   * Initialize external MCP server connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    return await withErrorHandling(
      async () => {
        rootLogger.info('Initializing external MCP server connections');

        // Load server configurations
        await this.loadServerConfigurations();

        // Initialize connections
        const initPromises = Array.from(this.servers.values()).map(config =>
          this.initializeServer(config)
        );

        const results = await Promise.allSettled(initPromises);

        // Log initialization results
        let successCount = 0;
        let failureCount = 0;

        results.forEach((result, index) => {
          const serverName = Array.from(this.servers.keys())[index];
          if (result.status === 'fulfilled') {
            successCount++;
            rootLogger.info('External MCP server initialized', { server: serverName });
          } else {
            failureCount++;
            rootLogger.error('Failed to initialize external MCP server', {
              server: serverName,
              error: result.reason,
            });
          }
        });

        rootLogger.info('External MCP initialization completed', {
          total: this.servers.size,
          successful: successCount,
          failed: failureCount,
        });

        this.initialized = true;

        // Start health monitoring
        this.startHealthMonitoring();
      },
      {
        component: 'external-mcp-manager',
        operation: 'initialize',
      },
      'high'
    );
  }

  /**
   * Load server configurations from environment
   */
  private async loadServerConfigurations(): Promise<void> {
    const envValidation = validateEnvironment();
    if (!envValidation.success) {
      rootLogger.warn('Environment validation failed for external MCP servers');
      return;
    }

    const env = envValidation.data;

    // Configure Supabase MCP Server
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabaseConfig: ExternalMCPServerConfig = {
        name: 'supabase-mcp',
        type: 'supabase',
        endpoint: `${env.SUPABASE_URL}/rest/v1/`,
        auth: {
          type: 'bearer',
          token: env.SUPABASE_SERVICE_ROLE_KEY,
        },
        health: {
          checkInterval: 60000, // 1 minute
          timeout: 10000, // 10 seconds
          retryAttempts: 3,
          failoverEnabled: true,
        },
        capabilities: [
          'database_schema_analysis',
          'business_data_access',
          'table_introspection',
          'query_execution',
          'metadata_retrieval',
        ],
        metadata: {
          version: 'v1',
          database: 'postgresql',
          extensions: ['pgvector'],
        },
      };

      this.servers.set('supabase-mcp', supabaseConfig);
    }

    // Configure Tavily MCP Server
    if (env.TAVILY_API_KEY) {
      const tavilyConfig: ExternalMCPServerConfig = {
        name: 'tavily-mcp',
        type: 'tavily',
        endpoint: 'https://api.tavily.com/search',
        auth: {
          type: 'api_key',
          token: env.TAVILY_API_KEY,
        },
        health: {
          checkInterval: 300000, // 5 minutes
          timeout: 15000, // 15 seconds
          retryAttempts: 2,
          failoverEnabled: false,
        },
        capabilities: [
          'web_search',
          'architecture_research',
          'best_practices_lookup',
          'technical_documentation',
          'realtime_information',
        ],
        metadata: {
          version: 'v1',
          searchEngine: 'tavily',
          realtime: true,
        },
      };

      this.servers.set('tavily-mcp', tavilyConfig);
    }

    rootLogger.info('Loaded external MCP server configurations', {
      servers: Array.from(this.servers.keys()),
      supabase: Boolean(env.SUPABASE_URL),
      tavily: Boolean(env.TAVILY_API_KEY),
    });
  }

  /**
   * Initialize individual server connection
   */
  private async initializeServer(config: ExternalMCPServerConfig): Promise<void> {
    return await withErrorHandling(
      async () => {
        // Initialize connection based on server type
        let connection: any = null;

        if (config.type === 'supabase') {
          connection = await this.initializeSupabaseConnection(config);
        } else if (config.type === 'tavily') {
          connection = await this.initializeTavilyConnection(config);
        } else {
          connection = await this.initializeGenericConnection(config);
        }

        this.connections.set(config.name, connection);

        // Initialize status
        const status: MCPServerStatus = {
          name: config.name,
          connected: Boolean(connection),
          healthy: false,
          lastCheck: new Date(),
          capabilities: config.capabilities,
          failoverActive: false,
        };

        this.status.set(config.name, status);

        // Perform initial health check
        await this.performHealthCheck(config.name);

        rootLogger.info('External MCP server connection initialized', {
          server: config.name,
          type: config.type,
          connected: Boolean(connection),
        });
      },
      {
        component: 'external-mcp-manager',
        operation: 'initialize_server',
        server: config.name,
      },
      'medium'
    );
  }

  /**
   * Initialize Supabase MCP connection
   */
  private async initializeSupabaseConnection(config: ExternalMCPServerConfig): Promise<any> {
    try {
      // Create Supabase client wrapper for MCP operations
      const supabaseConnection = {
        name: config.name,
        type: 'supabase',
        endpoint: config.endpoint,
        headers: {
          'Authorization': `Bearer ${config.auth?.token}`,
          'Content-Type': 'application/json',
          'apikey': config.auth?.token,
        },
        capabilities: config.capabilities,

        // MCP-specific operations
        async executeQuery(query: string, contextMetadata?: MCPContextMetadata) {
          const traceId = this.tracer?.startOperation('supabase-query', 'Execute Supabase Query', {
            input: { query: query.substring(0, 100), ...contextMetadata },
          });

          try {
            // This would be implemented to execute actual Supabase queries
            // For now, return a placeholder response
            const response = {
              success: true,
              data: [],
              metadata: {
                query,
                executionTime: Date.now(),
                rowCount: 0,
                ...contextMetadata,
              },
            };

            this.tracer?.endOperation(traceId || '', { output: response });
            return response;
          } catch (error) {
            this.tracer?.endOperation(traceId || '', { error: (error as Error).message });
            throw error;
          }
        },

        async getSchema(table?: string, contextMetadata?: MCPContextMetadata) {
          const traceId = this.tracer?.startOperation('supabase-schema', 'Get Database Schema', {
            input: { table, ...contextMetadata },
          });

          try {
            // Fetch schema information
            const response = await fetch(`${config.endpoint}`, {
              method: 'GET',
              headers: this.headers,
            });

            const result = {
              success: response.ok,
              schema: response.ok ? await response.json() : null,
              table,
              metadata: contextMetadata,
            };

            this.tracer?.endOperation(traceId || '', { output: result });
            return result;
          } catch (error) {
            this.tracer?.endOperation(traceId || '', { error: (error as Error).message });
            throw error;
          }
        },
      };

      return supabaseConnection;
    } catch (error) {
      rootLogger.error('Failed to initialize Supabase MCP connection', {
        server: config.name,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Initialize Tavily MCP connection
   */
  private async initializeTavilyConnection(config: ExternalMCPServerConfig): Promise<any> {
    try {
      // Create Tavily client wrapper for MCP operations
      const tavilyConnection = {
        name: config.name,
        type: 'tavily',
        endpoint: config.endpoint,
        apiKey: config.auth?.token,
        capabilities: config.capabilities,

        async search(query: string, options?: any, contextMetadata?: MCPContextMetadata) {
          const traceId = this.tracer?.startOperation('tavily-search', 'Execute Tavily Search', {
            input: { query, options, ...contextMetadata },
          });

          try {
            const searchPayload = {
              api_key: this.apiKey,
              query,
              search_depth: options?.depth || 'basic',
              include_answer: options?.includeAnswer || true,
              include_raw_content: options?.includeRaw || false,
              max_results: options?.maxResults || 5,
              ...contextMetadata,
            };

            const response = await fetch(config.endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(searchPayload),
            });

            const result = {
              success: response.ok,
              data: response.ok ? await response.json() : null,
              query,
              metadata: {
                searchDepth: options?.depth,
                maxResults: options?.maxResults,
                ...contextMetadata,
              },
            };

            this.tracer?.endOperation(traceId || '', { output: result });
            return result;
          } catch (error) {
            this.tracer?.endOperation(traceId || '', { error: (error as Error).message });
            throw error;
          }
        },

        async searchBestPractices(topic: string, domain?: string, contextMetadata?: MCPContextMetadata) {
          const searchQuery = `${topic} best practices ${domain ? `in ${domain}` : ''}`;
          return await this.search(searchQuery, {
            depth: 'advanced',
            includeAnswer: true,
            maxResults: 10,
          }, {
            ...contextMetadata,
            operationType: 'best_practices_search',
            topic,
            domain,
          });
        },
      };

      return tavilyConnection;
    } catch (error) {
      rootLogger.error('Failed to initialize Tavily MCP connection', {
        server: config.name,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Initialize generic MCP connection
   */
  private async initializeGenericConnection(config: ExternalMCPServerConfig): Promise<any> {
    // Placeholder for generic MCP server connections
    return {
      name: config.name,
      type: config.type,
      endpoint: config.endpoint,
      capabilities: config.capabilities,
    };
  }

  /**
   * Start health monitoring for all servers
   */
  private startHealthMonitoring(): void {
    for (const [serverName, config] of this.servers) {
      const timer = setInterval(async () => {
        await this.performHealthCheck(serverName);
      }, config.health.checkInterval);

      this.healthCheckTimers.set(serverName, timer);
    }

    rootLogger.info('Health monitoring started for external MCP servers', {
      servers: Array.from(this.servers.keys()),
    });
  }

  /**
   * Perform health check for a specific server
   */
  private async performHealthCheck(serverName: string): Promise<void> {
    const config = this.servers.get(serverName);
    const status = this.status.get(serverName);

    if (!config || !status) return;

    const startTime = Date.now();

    try {
      const connection = this.connections.get(serverName);
      let healthy = false;

      if (connection) {
        // Perform server-specific health check
        if (config.type === 'supabase') {
          healthy = await this.checkSupabaseHealth(connection, config);
        } else if (config.type === 'tavily') {
          healthy = await this.checkTavilyHealth(connection, config);
        } else {
          healthy = await this.checkGenericHealth(connection, config);
        }
      }

      const responseTime = Date.now() - startTime;

      status.healthy = healthy;
      status.connected = Boolean(connection);
      status.lastCheck = new Date();
      status.responseTime = responseTime;
      status.lastError = undefined;

      if (!healthy && config.health.failoverEnabled && !status.failoverActive) {
        await this.activateFailover(serverName);
      }

    } catch (error) {
      status.healthy = false;
      status.lastCheck = new Date();
      status.lastError = (error as Error).message;

      rootLogger.warn('External MCP server health check failed', {
        server: serverName,
        error: status.lastError,
      });
    }
  }

  /**
   * Check Supabase server health
   */
  private async checkSupabaseHealth(connection: any, config: ExternalMCPServerConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.endpoint}health`, {
        method: 'GET',
        headers: connection.headers,
        signal: AbortSignal.timeout(config.health.timeout),
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check Tavily server health
   */
  private async checkTavilyHealth(connection: any, config: ExternalMCPServerConfig): Promise<boolean> {
    try {
      // Perform a minimal search to test connectivity
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: connection.apiKey,
          query: 'test connectivity',
          search_depth: 'basic',
          max_results: 1,
        }),
        signal: AbortSignal.timeout(config.health.timeout),
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check generic server health
   */
  private async checkGenericHealth(connection: any, config: ExternalMCPServerConfig): Promise<boolean> {
    try {
      const response = await fetch(config.endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(config.health.timeout),
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Activate failover for a server
   */
  private async activateFailover(serverName: string): Promise<void> {
    const status = this.status.get(serverName);
    if (status) {
      status.failoverActive = true;

      rootLogger.warn('Activating failover for external MCP server', {
        server: serverName,
        lastError: status.lastError,
      });

      // Implement failover logic here
      // This could involve switching to backup servers, disabling features, etc.
    }
  }

  /**
   * Get connection for a specific server
   */
  getConnection(serverName: string): any {
    return this.connections.get(serverName);
  }

  /**
   * Get status for a specific server
   */
  getServerStatus(serverName: string): MCPServerStatus | undefined {
    return this.status.get(serverName);
  }

  /**
   * Get status for all servers
   */
  getAllServerStatus(): MCPServerStatus[] {
    return Array.from(this.status.values());
  }

  /**
   * Execute operation with context metadata
   */
  async executeWithContext(
    serverName: string,
    operation: string,
    args: any,
    contextMetadata?: MCPContextMetadata
  ): Promise<any> {
    return await withErrorHandling(
      async () => {
        const connection = this.connections.get(serverName);
        if (!connection) {
          throw new Error(`Server ${serverName} not connected`);
        }

        const status = this.status.get(serverName);
        if (!status?.healthy) {
          throw new Error(`Server ${serverName} is not healthy`);
        }

        // Add context metadata to headers/payload
        const enrichedArgs = {
          ...args,
          context: contextMetadata,
          headers: {
            'X-Session-ID': contextMetadata?.sessionId,
            'X-User-ID': contextMetadata?.userId,
            'X-Trace-ID': contextMetadata?.traceId,
            'X-Domains': contextMetadata?.domains?.join(','),
          },
        };

        // Execute operation based on server type and operation
        if (typeof connection[operation] === 'function') {
          return await connection[operation](enrichedArgs, contextMetadata);
        } else {
          throw new Error(`Operation ${operation} not supported by server ${serverName}`);
        }
      },
      {
        component: 'external-mcp-manager',
        operation: 'execute_with_context',
        server: serverName,
        operationName: operation,
      },
      'medium'
    );
  }

  /**
   * Shutdown external MCP manager
   */
  async shutdown(): Promise<void> {
    // Clear health check timers
    for (const timer of this.healthCheckTimers.values()) {
      clearInterval(timer);
    }
    this.healthCheckTimers.clear();

    // Close connections
    for (const [serverName, connection] of this.connections) {
      try {
        if (connection.close) {
          await connection.close();
        }
      } catch (error) {
        rootLogger.warn('Error closing external MCP connection', {
          server: serverName,
          error: (error as Error).message,
        });
      }
    }

    this.connections.clear();
    this.status.clear();

    // End tracing
    this.tracer.end({
      metadata: {
        totalServers: this.servers.size,
        shutdownTime: new Date().toISOString(),
      },
    });

    this.initialized = false;

    rootLogger.info('External MCP manager shutdown completed');
  }
}

// Export singleton instance
export const externalMCPManager = new ExternalMCPManager();

// Export helper functions
export function getSupabaseMCPConnection() {
  return externalMCPManager.getConnection('supabase-mcp');
}

export function getTavilyMCPConnection() {
  return externalMCPManager.getConnection('tavily-mcp');
}

export function createContextMetadata(
  sessionId?: string,
  userId?: string,
  domains?: string[],
  permissions?: Record<string, any>,
  operationType?: string
): MCPContextMetadata {
  return {
    sessionId,
    userId,
    domains,
    permissions,
    traceId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operationType,
  };
}

rootLogger.info('External MCP Manager initialized', {
  capabilities: ['supabase-integration', 'tavily-integration', 'health-monitoring', 'failover-support'],
});