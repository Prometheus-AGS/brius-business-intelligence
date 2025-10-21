import { Request, Response } from 'express';
import { z } from 'zod';
import { mcpClient } from '../../mcp/client.js';
import { mcpProcessManager } from '../../mcp/process-manager.js';
import { mcpConfigLoader } from '../../mcp/config-loader.js';
import { getMCPToolRegistrationManager } from '../../tools/mcp-registry.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Registry Management API Endpoints
 * Provides administrative control over MCP servers, connections, and tool registration
 * Enables playground users to manage the MCP ecosystem
 */

// Validation schemas
const ConnectServerSchema = z.object({
  serverId: z.string().min(1),
  configPath: z.string().optional(),
});

const ServerActionSchema = z.object({
  serverId: z.string().min(1),
  action: z.enum(['start', 'stop', 'restart', 'connect', 'disconnect']),
  force: z.boolean().default(false),
});

/**
 * Get all server connections
 * GET /api/playground/registry/connections
 */
export async function getAllConnections(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/registry/connections', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Getting all MCP server connections', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get connections from MCP client
    const connections = mcpClient.getAllConnections();

    // Get process information for each connection
    const connectionDetails = connections.map(conn => {
      const processInfo = mcpProcessManager.getProcessInfo(conn.serverId);
      return {
        ...conn,
        process_info: processInfo ? {
          pid: processInfo.pid,
          status: processInfo.status,
          started_at: processInfo.startedAt,
          restart_count: processInfo.restartCount,
          health_status: processInfo.healthStatus,
          last_error: processInfo.lastError,
        } : null,
      };
    });

    const response = {
      success: true,
      data: {
        connections: connectionDetails,
        total_connections: connections.length,
        connected_count: connections.filter(conn => conn.status === 'connected').length,
        failed_count: connections.filter(conn => conn.status === 'failed').length,
      },
      message: `Retrieved ${connections.length} server connections`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Server connections retrieved', {
      user_id: req.user?.userId,
      connections_count: connections.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get server connections', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve server connections',
        type: 'internal_server_error',
        code: 'connections_error',
      },
    });
  }
}

/**
 * Get connection by server ID
 * GET /api/playground/registry/connections/:serverId
 */
export async function getConnectionById(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/registry/connections/${req.params.serverId}`, 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const serverId = req.params.serverId;
    if (!serverId) {
      res.status(400).json({
        error: {
          message: 'Server ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing server ID'), 400);
      return;
    }

    apiLogger.info('Getting connection by server ID', {
      user_id: req.user?.userId,
      server_id: serverId,
      trace_id: tracer.getTraceId(),
    });

    const connection = mcpClient.getConnection(serverId);
    if (!connection) {
      res.status(404).json({
        error: {
          message: 'Connection not found',
          type: 'not_found_error',
          code: 'connection_not_found',
        },
      });
      tracer.fail(new Error('Connection not found'), 404);
      return;
    }

    // Get process information
    const processInfo = mcpProcessManager.getProcessInfo(serverId);

    // Get server configuration
    const serverConfig = await mcpConfigLoader.getServerConfig(serverId);

    const response = {
      success: true,
      data: {
        connection,
        process_info: processInfo,
        server_config: serverConfig,
      },
      message: 'Connection details retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Connection details retrieved', {
      user_id: req.user?.userId,
      server_id: serverId,
      status: connection.status,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get connection details', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve connection details',
        type: 'internal_server_error',
        code: 'connection_details_error',
      },
    });
  }
}

/**
 * Connect to MCP server
 * POST /api/playground/registry/connections
 */
export async function connectToServer(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/registry/connections', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Validate request body
    const validationResult = ConnectServerSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid connection request',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { serverId, configPath } = validationResult.data;

    apiLogger.info('Connecting to MCP server', {
      user_id: req.user?.userId,
      server_id: serverId,
      config_path: configPath,
      trace_id: tracer.getTraceId(),
    });

    // Connect to server
    const connection = await mcpClient.connectToServer(serverId, configPath);

    const response = {
      success: true,
      data: {
        connection,
        connected_at: new Date().toISOString(),
      },
      message: `Successfully connected to server: ${serverId}`,
    };

    tracer.complete(response);
    res.status(201).json(response);

    apiLogger.info('Successfully connected to MCP server', {
      user_id: req.user?.userId,
      server_id: serverId,
      connection_status: connection.status,
      tools_count: connection.tools.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    apiLogger.error('Failed to connect to MCP server', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to connect to server',
        type: 'connection_error',
        code: 'server_connection_failed',
        details: {
          error_message: errorMessage,
        },
      },
    });
  }
}

/**
 * Disconnect from MCP server
 * DELETE /api/playground/registry/connections/:serverId
 */
export async function disconnectFromServer(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/registry/connections/${req.params.serverId}`, 'DELETE', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const serverId = req.params.serverId;
    if (!serverId) {
      res.status(400).json({
        error: {
          message: 'Server ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing server ID'), 400);
      return;
    }

    const force = req.query.force === 'true';

    apiLogger.info('Disconnecting from MCP server', {
      user_id: req.user?.userId,
      server_id: serverId,
      force,
      trace_id: tracer.getTraceId(),
    });

    // Check if connection exists
    const connection = mcpClient.getConnection(serverId);
    if (!connection) {
      res.status(404).json({
        error: {
          message: 'Connection not found',
          type: 'not_found_error',
          code: 'connection_not_found',
        },
      });
      tracer.fail(new Error('Connection not found'), 404);
      return;
    }

    // Disconnect from server
    await mcpClient.disconnectFromServer(serverId);

    // Optionally stop the process
    if (force) {
      try {
        await mcpProcessManager.stopServer(serverId, true);
      } catch (processError) {
        apiLogger.warn('Failed to stop server process during disconnect', {
          server_id: serverId,
          error: processError instanceof Error ? processError.message : String(processError),
        });
      }
    }

    const response = {
      success: true,
      data: {
        server_id: serverId,
        disconnected_at: new Date().toISOString(),
        force_stopped: force,
      },
      message: `Successfully disconnected from server: ${serverId}`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Successfully disconnected from MCP server', {
      user_id: req.user?.userId,
      server_id: serverId,
      force,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to disconnect from MCP server', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to disconnect from server',
        type: 'disconnection_error',
        code: 'server_disconnection_failed',
      },
    });
  }
}

/**
 * Perform server action (start, stop, restart, connect, disconnect)
 * POST /api/playground/registry/servers/:serverId/actions
 */
export async function performServerAction(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/registry/servers/${req.params.serverId}/actions`, 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const serverId = req.params.serverId;
    if (!serverId) {
      res.status(400).json({
        error: {
          message: 'Server ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing server ID'), 400);
      return;
    }

    // Validate request body
    const validationResult = ServerActionSchema.safeParse({
      serverId,
      ...req.body,
    });

    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid server action request',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { action, force } = validationResult.data;

    apiLogger.info('Performing server action', {
      user_id: req.user?.userId,
      server_id: serverId,
      action,
      force,
      trace_id: tracer.getTraceId(),
    });

    let result: any;

    switch (action) {
      case 'start':
        result = await mcpProcessManager.startServer(serverId);
        break;

      case 'stop':
        await mcpProcessManager.stopServer(serverId, force);
        result = { server_id: serverId, action: 'stopped' };
        break;

      case 'restart':
        result = await mcpProcessManager.restartServer(serverId);
        break;

      case 'connect':
        result = await mcpClient.connectToServer(serverId);
        break;

      case 'disconnect':
        await mcpClient.disconnectFromServer(serverId);
        result = { server_id: serverId, action: 'disconnected' };
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const response = {
      success: true,
      data: {
        server_id: serverId,
        action,
        result,
        performed_at: new Date().toISOString(),
      },
      message: `Successfully performed ${action} on server: ${serverId}`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Server action completed successfully', {
      user_id: req.user?.userId,
      server_id: serverId,
      action,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    apiLogger.error('Failed to perform server action', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: `Failed to perform ${req.body.action || 'unknown'} action`,
        type: 'action_error',
        code: 'server_action_failed',
        details: {
          error_message: errorMessage,
        },
      },
    });
  }
}

/**
 * Get available server configurations
 * GET /api/playground/registry/servers
 */
export async function getAvailableServers(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/registry/servers', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const configPath = req.query.configPath as string;

    apiLogger.info('Getting available MCP servers', {
      user_id: req.user?.userId,
      config_path: configPath,
      trace_id: tracer.getTraceId(),
    });

    // Get enabled servers from configuration
    const enabledServers = await mcpConfigLoader.listEnabledServers(configPath);

    // Get process status for each server
    const serverDetails = enabledServers.map(server => {
      const processInfo = mcpProcessManager.getProcessInfo(server.id);
      const connection = mcpClient.getConnection(server.id);

      return {
        ...server,
        process_status: processInfo?.status || 'not_started',
        connection_status: connection?.status || 'disconnected',
        health_status: processInfo?.healthStatus || 'unknown',
        tools_count: connection?.tools.length || 0,
        last_activity: connection?.lastActivity,
      };
    });

    const response = {
      success: true,
      data: {
        servers: serverDetails,
        total_servers: enabledServers.length,
        running_servers: serverDetails.filter(s => s.process_status === 'running').length,
        connected_servers: serverDetails.filter(s => s.connection_status === 'connected').length,
      },
      message: `Retrieved ${enabledServers.length} available servers`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Available servers retrieved', {
      user_id: req.user?.userId,
      servers_count: enabledServers.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get available servers', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve available servers',
        type: 'internal_server_error',
        code: 'servers_retrieval_error',
      },
    });
  }
}

/**
 * Validate MCP configuration
 * POST /api/playground/registry/validate-config
 */
export async function validateConfig(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/registry/validate-config', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const configPath = req.body.configPath as string;

    apiLogger.info('Validating MCP configuration', {
      user_id: req.user?.userId,
      config_path: configPath,
      trace_id: tracer.getTraceId(),
    });

    // Validate configuration
    const validation = await mcpConfigLoader.validateConfig(configPath);

    const response = {
      success: true,
      data: {
        validation,
        config_path: configPath,
        validated_at: new Date().toISOString(),
      },
      message: validation.valid
        ? 'Configuration is valid'
        : `Configuration has ${validation.errors.length} errors`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Configuration validation completed', {
      user_id: req.user?.userId,
      config_path: configPath,
      is_valid: validation.valid,
      errors_count: validation.errors.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to validate configuration', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to validate configuration',
        type: 'validation_error',
        code: 'config_validation_failed',
      },
    });
  }
}

/**
 * Get tool registration statistics
 * GET /api/playground/registry/tool-registration/stats
 */
export async function getToolRegistrationStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/playground/registry/tool-registration/stats', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Getting tool registration statistics', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get registration statistics
    const manager = getMCPToolRegistrationManager();
    if (!manager) {
      res.status(500).json({
        error: {
          message: 'MCP Tool Registration Manager not initialized',
          type: 'internal_server_error',
          code: 'registration_manager_not_initialized',
        },
      });
      tracer.fail(new Error('Registration manager not initialized'), 500);
      return;
    }

    const registrationStats = manager.getRegistrationStats();

    // Get all registered tools
    const registeredTools = manager.getAllRegisteredTools();

    const response = {
      success: true,
      data: {
        registration_stats: registrationStats,
        registered_tools_count: registeredTools.length,
        tool_breakdown: {
          by_namespace: registrationStats.byNamespace,
          by_server: registrationStats.byServer,
        },
        total_usage: registrationStats.totalUsage,
      },
      message: 'Tool registration statistics retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Tool registration statistics retrieved', {
      user_id: req.user?.userId,
      total_registered: registrationStats.totalRegistered,
      total_usage: registrationStats.totalUsage,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get tool registration stats', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve tool registration statistics',
        type: 'internal_server_error',
        code: 'registration_stats_error',
      },
    });
  }
}

/**
 * Refresh tool registrations for a server
 * POST /api/playground/registry/servers/:serverId/refresh-tools
 */
export async function refreshServerTools(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/playground/registry/servers/${req.params.serverId}/refresh-tools`, 'POST', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const serverId = req.params.serverId;
    if (!serverId) {
      res.status(400).json({
        error: {
          message: 'Server ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing server ID'), 400);
      return;
    }

    apiLogger.info('Refreshing tools for server', {
      user_id: req.user?.userId,
      server_id: serverId,
      trace_id: tracer.getTraceId(),
    });

    // Refresh tool registrations for the server
    const manager = getMCPToolRegistrationManager();
    if (!manager) {
      res.status(500).json({
        error: {
          message: 'MCP Tool Registration Manager not initialized',
          type: 'internal_server_error',
          code: 'registration_manager_not_initialized',
        },
      });
      tracer.fail(new Error('Registration manager not initialized'), 500);
      return;
    }

    const refreshedTools = await manager.refreshServerTools(serverId);

    const response = {
      success: true,
      data: {
        server_id: serverId,
        refreshed_tools: refreshedTools.map((tool: any) => ({
          id: tool.id,
          description: tool.description,
        })),
        tools_count: refreshedTools.length,
        refreshed_at: new Date().toISOString(),
      },
      message: `Successfully refreshed ${refreshedTools.length} tools for server: ${serverId}`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Server tools refreshed successfully', {
      user_id: req.user?.userId,
      server_id: serverId,
      tools_count: refreshedTools.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to refresh server tools', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to refresh server tools',
        type: 'refresh_error',
        code: 'server_tools_refresh_failed',
      },
    });
  }
}
