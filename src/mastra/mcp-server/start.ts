#!/usr/bin/env node

import { program } from 'commander';
import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { z } from 'zod';
import { rootLogger } from '../observability/logger.js';
import {
  createMastraMCPServer,
  MastraMCPServer,
  MastraMCPServerConfig,
  defaultMCPServerConfig
} from './index.js';

/**
 * MCP Server Startup Script
 * Provides command-line interface for starting the Mastra MCP server
 * Supports configuration via CLI arguments, environment variables, and config files
 */

// Load environment variables
config();

// CLI configuration schema
const CLIConfigSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  transport: z.enum(['stdio', 'sse', 'both']).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  host: z.string().optional(),
  enableAgents: z.boolean().optional(),
  enableWorkflows: z.boolean().optional(),
  enableKnowledge: z.boolean().optional(),
  enableMemory: z.boolean().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  environment: z.enum(['development', 'production', 'test']).optional(),
  configFile: z.string().optional(),
  enableTracing: z.boolean().optional(),
  maxConnections: z.number().int().min(1).optional(),
  timeout: z.number().int().min(1000).optional(),
});

type CLIConfig = z.infer<typeof CLIConfigSchema>;

/**
 * Parse and validate CLI arguments
 */
function parseCliArguments(): CLIConfig {
  program
    .name('mastra-mcp-server')
    .description('Mastra Business Intelligence MCP Server')
    .version(process.env.npm_package_version || '1.0.0')
    .option('-n, --name <name>', 'Server name', 'mastra-business-intelligence')
    .option('-v, --version <version>', 'Server version', '1.0.0')
    .option('-t, --transport <type>', 'Transport type (stdio|sse|both)', 'both')
    .option('-p, --port <port>', 'SSE server port', (val) => parseInt(val, 10), 3001)
    .option('-h, --host <host>', 'SSE server host', '0.0.0.0')
    .option('--enable-agents', 'Enable agent tools', true)
    .option('--disable-agents', 'Disable agent tools')
    .option('--enable-workflows', 'Enable workflow tools', true)
    .option('--disable-workflows', 'Disable workflow tools')
    .option('--enable-knowledge', 'Enable knowledge base tools', true)
    .option('--disable-knowledge', 'Disable knowledge base tools')
    .option('--enable-memory', 'Enable memory tools', true)
    .option('--disable-memory', 'Disable memory tools')
    .option('-l, --log-level <level>', 'Log level (debug|info|warn|error)', 'info')
    .option('-e, --environment <env>', 'Environment (development|production|test)', 'development')
    .option('-c, --config-file <file>', 'Configuration file path')
    .option('--enable-tracing', 'Enable observability tracing', true)
    .option('--disable-tracing', 'Disable observability tracing')
    .option('--max-connections <count>', 'Maximum SSE connections', (val) => parseInt(val, 10), 100)
    .option('--timeout <ms>', 'Connection timeout in milliseconds', (val) => parseInt(val, 10), 300000);

  program.parse();
  const options = program.opts();

  // Handle boolean flags
  const config: any = {
    name: options.name,
    version: options.version,
    transport: options.transport,
    port: options.port,
    host: options.host,
    logLevel: options.logLevel,
    environment: options.environment,
    configFile: options.configFile,
    maxConnections: options.maxConnections,
    timeout: options.timeout,
  };

  // Handle enable/disable flags
  config.enableAgents = options.disableAgents ? false : options.enableAgents;
  config.enableWorkflows = options.disableWorkflows ? false : options.enableWorkflows;
  config.enableKnowledge = options.disableKnowledge ? false : options.enableKnowledge;
  config.enableMemory = options.disableMemory ? false : options.enableMemory;
  config.enableTracing = options.disableTracing ? false : options.enableTracing;

  return CLIConfigSchema.parse(config);
}

/**
 * Load configuration from file
 */
function loadConfigFile(filePath: string): Partial<MastraMCPServerConfig> {
  try {
    const absolutePath = resolve(filePath);

    if (!existsSync(absolutePath)) {
      throw new Error(`Configuration file not found: ${absolutePath}`);
    }

    // Dynamic import to handle both CommonJS and ES modules
    const configData = require(absolutePath);

    rootLogger.info('Configuration file loaded', {
      file: absolutePath,
      hasConfig: Boolean(configData),
    });

    return configData.default || configData;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    rootLogger.error('Failed to load configuration file', {
      file: filePath,
      error: errorMessage,
    });
    throw error;
  }
}

/**
 * Build server configuration from CLI, environment, and config file
 */
function buildServerConfig(cliConfig: CLIConfig): MastraMCPServerConfig {
  let baseConfig: Partial<MastraMCPServerConfig> = {};

  // Load config file if specified
  if (cliConfig.configFile) {
    baseConfig = loadConfigFile(cliConfig.configFile);
  }

  // Build final configuration with precedence: CLI > env vars > config file > defaults
  const serverConfig: MastraMCPServerConfig = {
    name: cliConfig.name || process.env.MCP_SERVER_NAME || baseConfig.name || defaultMCPServerConfig.name,
    version: cliConfig.version || process.env.MCP_SERVER_VERSION || baseConfig.version || defaultMCPServerConfig.version,
    description: baseConfig.description || defaultMCPServerConfig.description,

    transport: {
      type: cliConfig.transport || (process.env.MCP_TRANSPORT as any) || baseConfig.transport?.type || defaultMCPServerConfig.transport.type,
      sse: {
        port: cliConfig.port || (process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : undefined) || baseConfig.transport?.sse?.port || defaultMCPServerConfig.transport.sse!.port,
        host: cliConfig.host || process.env.MCP_HOST || baseConfig.transport?.sse?.host || defaultMCPServerConfig.transport.sse!.host,
        path: process.env.MCP_SSE_PATH || baseConfig.transport?.sse?.path || defaultMCPServerConfig.transport.sse!.path,
        messagePath: process.env.MCP_MESSAGE_PATH || baseConfig.transport?.sse?.messagePath || defaultMCPServerConfig.transport.sse!.messagePath,
        cors: baseConfig.transport?.sse?.cors || defaultMCPServerConfig.transport.sse!.cors,
        heartbeatInterval: baseConfig.transport?.sse?.heartbeatInterval || defaultMCPServerConfig.transport.sse!.heartbeatInterval,
        maxConnections: cliConfig.maxConnections || baseConfig.transport?.sse?.maxConnections || defaultMCPServerConfig.transport.sse!.maxConnections,
        timeout: cliConfig.timeout || baseConfig.transport?.sse?.timeout || defaultMCPServerConfig.transport.sse!.timeout,
      },
    },

    tools: {
      enableAgents: cliConfig.enableAgents ?? (process.env.MCP_ENABLE_AGENTS === 'true') ?? baseConfig.tools?.enableAgents ?? defaultMCPServerConfig.tools!.enableAgents,
      enableWorkflows: cliConfig.enableWorkflows ?? (process.env.MCP_ENABLE_WORKFLOWS === 'true') ?? baseConfig.tools?.enableWorkflows ?? defaultMCPServerConfig.tools!.enableWorkflows,
      enableKnowledge: cliConfig.enableKnowledge ?? (process.env.MCP_ENABLE_KNOWLEDGE === 'true') ?? baseConfig.tools?.enableKnowledge ?? defaultMCPServerConfig.tools!.enableKnowledge,
      enableMemory: cliConfig.enableMemory ?? (process.env.MCP_ENABLE_MEMORY === 'true') ?? baseConfig.tools?.enableMemory ?? defaultMCPServerConfig.tools!.enableMemory,
      customTools: baseConfig.tools?.customTools || defaultMCPServerConfig.tools!.customTools,
    },

    options: {
      enableTracing: cliConfig.enableTracing ?? (process.env.MCP_ENABLE_TRACING === 'true') ?? baseConfig.options?.enableTracing ?? defaultMCPServerConfig.options!.enableTracing,
      logLevel: (cliConfig.logLevel as any) || (process.env.MCP_LOG_LEVEL as any) || baseConfig.options?.logLevel || defaultMCPServerConfig.options!.logLevel,
      maxRequestSize: baseConfig.options?.maxRequestSize || defaultMCPServerConfig.options!.maxRequestSize,
      requestTimeout: baseConfig.options?.requestTimeout || defaultMCPServerConfig.options!.requestTimeout,
    },

    environment: (cliConfig.environment as any) || (process.env.NODE_ENV as any) || baseConfig.environment || defaultMCPServerConfig.environment,
  };

  return serverConfig;
}

/**
 * Set up signal handlers for graceful shutdown
 */
function setupSignalHandlers(server: MastraMCPServer): void {
  const shutdown = async (signal: string) => {
    rootLogger.info(`Received ${signal}, shutting down gracefully`, {
      server_name: server.getConfig().name,
      uptime: (await server.getStats()).uptime,
    });

    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('Error during graceful shutdown', { error: errorMessage });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    rootLogger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    rootLogger.error('Unhandled rejection', { reason, promise });
    process.exit(1);
  });
}

/**
 * Set up periodic status logging
 */
function setupStatusLogging(server: MastraMCPServer): void {
  const statusInterval = setInterval(async () => {
    try {
      if (!server.isRunning()) {
        clearInterval(statusInterval);
        return;
      }

      const stats = await server.getStats();
      rootLogger.info('Server status update', {
        status: stats.status,
        uptime_ms: stats.uptime,
        connections: stats.connections.active,
        requests_total: stats.requests.total,
        requests_successful: stats.requests.successful,
        requests_failed: stats.requests.failed,
        avg_response_time: stats.requests.averageResponseTime,
        memory_used_mb: Math.round(stats.memory.used / 1024 / 1024),
      });
    } catch (error) {
      rootLogger.error('Failed to get server stats', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 60000); // Every minute
}

/**
 * Main startup function
 */
async function main(): Promise<void> {
  try {
    rootLogger.info('Starting Mastra MCP Server', {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    });

    // Parse CLI arguments
    const cliConfig = parseCliArguments();

    // Build server configuration
    const serverConfig = buildServerConfig(cliConfig);

    rootLogger.info('Server configuration built', {
      name: serverConfig.name,
      version: serverConfig.version,
      transport: serverConfig.transport.type,
      environment: serverConfig.environment,
      tools: {
        agents: serverConfig.tools?.enableAgents,
        workflows: serverConfig.tools?.enableWorkflows,
        knowledge: serverConfig.tools?.enableKnowledge,
        memory: serverConfig.tools?.enableMemory,
      },
    });

    // Create and start server
    const server = createMastraMCPServer(serverConfig);

    // Set up signal handlers
    setupSignalHandlers(server);

    // Set up event handlers
    server.on('started', (data) => {
      rootLogger.info('MCP Server started successfully', {
        name: data.config.name,
        transport: data.config.transport.type,
        tools_registered: data.stats.tools.registered,
      });

      if (serverConfig.transport.type === 'sse' || serverConfig.transport.type === 'both') {
        rootLogger.info('HTTP endpoints available', {
          health: `http://${serverConfig.transport.sse!.host}:${serverConfig.transport.sse!.port}/health`,
          stats: `http://${serverConfig.transport.sse!.host}:${serverConfig.transport.sse!.port}/stats`,
          info: `http://${serverConfig.transport.sse!.host}:${serverConfig.transport.sse!.port}/info`,
          sse: `http://${serverConfig.transport.sse!.host}:${serverConfig.transport.sse!.port}${serverConfig.transport.sse!.path}`,
        });
      }

      // Set up periodic status logging
      setupStatusLogging(server);
    });

    server.on('error', (error) => {
      rootLogger.error('MCP Server error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    server.on('connection', (connection) => {
      rootLogger.info('New client connection', {
        connection_id: connection.id,
        client_info: connection.clientInfo,
      });
    });

    server.on('disconnection', (connection) => {
      rootLogger.info('Client disconnected', {
        connection_id: connection.id,
        duration_ms: Date.now() - connection.connectedAt.getTime(),
        message_count: connection.messageCount,
      });
    });

    // Start the server
    await server.start();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    rootLogger.error('Failed to start MCP Server', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Handle module being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Startup error:', error);
    process.exit(1);
  });
}

export { main as startMCPServer };