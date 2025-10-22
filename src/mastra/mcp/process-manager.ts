import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { mcpConfigLoader, ResolvedMCPServerConfig } from './config-loader.js';
import { mcpLogger } from '../observability/logger.js';

/**
 * MCP Process Manager
 * Manages the lifecycle of MCP server processes including spawn, monitor, restart, and termination
 * Provides health monitoring, restart policies, and process event handling
 */

export interface ProcessInfo {
  serverId: string;
  config: ResolvedMCPServerConfig;
  process: ChildProcess;
  pid?: number;
  status: ProcessStatus;
  startedAt: Date;
  lastRestartAt?: Date;
  restartCount: number;
  healthStatus: HealthStatus;
  lastHealthCheck?: Date;
  errorCount: number;
  lastError?: string;
}

export type ProcessStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'restarting';

export type HealthStatus =
  | 'healthy'
  | 'unhealthy'
  | 'unknown'
  | 'checking';

export interface ProcessManagerEvents {
  'process:started': (serverId: string, processInfo: ProcessInfo) => void;
  'process:stopped': (serverId: string, processInfo: ProcessInfo) => void;
  'process:failed': (serverId: string, processInfo: ProcessInfo, error: Error) => void;
  'process:restarted': (serverId: string, processInfo: ProcessInfo) => void;
  'health:changed': (serverId: string, status: HealthStatus, processInfo: ProcessInfo) => void;
  'restart:limit:reached': (serverId: string, processInfo: ProcessInfo) => void;
}

export interface ProcessManagerOptions {
  healthCheckInterval?: number;
  healthCheckTimeout?: number;
  processTimeout?: number;
  enableAutoRestart?: boolean;
  maxRestartAttempts?: number;
  restartDelay?: number;
  killTimeout?: number;
}

const DEFAULT_PROCESS_MANAGER_OPTIONS: Required<ProcessManagerOptions> = {
  healthCheckInterval: 30000, // 30 seconds
  healthCheckTimeout: 5000,   // 5 seconds
  processTimeout: 30000,      // 30 seconds for process to start
  enableAutoRestart: true,
  maxRestartAttempts: 5,
  restartDelay: 2000,         // 2 seconds
  killTimeout: 10000,         // 10 seconds
};

/**
 * MCP Process Manager class
 */
export class MCPProcessManager extends EventEmitter {
  private processes = new Map<string, ProcessInfo>();
  private healthCheckTimers = new Map<string, NodeJS.Timeout>();
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private options: Required<ProcessManagerOptions>;
  private isShuttingDown = false;

  constructor(options: ProcessManagerOptions = {}) {
    super();
    this.options = { ...DEFAULT_PROCESS_MANAGER_OPTIONS, ...options };

    // Handle process manager shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  /**
   * Start MCP server process
   */
  async startServer(serverId: string, configPath?: string): Promise<ProcessInfo> {
    mcpLogger.info('Starting MCP server process', {
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

    // Check if already running
    if (this.processes.has(serverId)) {
      const existing = this.processes.get(serverId)!;
      if (existing.status === 'running' || existing.status === 'starting') {
        mcpLogger.warn('MCP server already running', { server_id: serverId });
        return existing;
      }
    }

    try {
      const processInfo = await this.spawnProcess(serverId, config);
      this.processes.set(serverId, processInfo);

      // Start health monitoring
      this.startHealthMonitoring(serverId);

      this.emit('process:started', serverId, processInfo);

      mcpLogger.info('MCP server process started successfully', {
        server_id: serverId,
        pid: processInfo.pid,
        command: config.resolvedCommand,
      });

      return processInfo;

    } catch (error) {
      mcpLogger.error('Failed to start MCP server process', {
        server_id: serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop MCP server process
   */
  async stopServer(serverId: string, force = false): Promise<void> {
    mcpLogger.info('Stopping MCP server process', {
      server_id: serverId,
      force,
    });

    const processInfo = this.processes.get(serverId);
    if (!processInfo) {
      mcpLogger.warn('MCP server process not found', { server_id: serverId });
      return;
    }

    if (processInfo.status === 'stopped' || processInfo.status === 'stopping') {
      mcpLogger.info('MCP server already stopped or stopping', { server_id: serverId });
      return;
    }

    // Update status
    processInfo.status = 'stopping';

    // Stop health monitoring
    this.stopHealthMonitoring(serverId);

    try {
      await this.terminateProcess(processInfo, force);

      processInfo.status = 'stopped';
      this.emit('process:stopped', serverId, processInfo);

      mcpLogger.info('MCP server process stopped successfully', {
        server_id: serverId,
        pid: processInfo.pid,
      });

    } catch (error) {
      processInfo.status = 'failed';
      processInfo.lastError = error instanceof Error ? error.message : String(error);

      mcpLogger.error('Failed to stop MCP server process', {
        server_id: serverId,
        error: processInfo.lastError,
      });

      this.emit('process:failed', serverId, processInfo, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Restart MCP server process
   */
  async restartServer(serverId: string): Promise<ProcessInfo> {
    mcpLogger.info('Restarting MCP server process', { server_id: serverId });

    const processInfo = this.processes.get(serverId);
    if (!processInfo) {
      throw new Error(`MCP server process not found: ${serverId}`);
    }

    // Check restart limits
    if (processInfo.restartCount >= this.options.maxRestartAttempts) {
      const error = new Error(`Maximum restart attempts reached for MCP server: ${serverId}`);
      this.emit('restart:limit:reached', serverId, processInfo);
      throw error;
    }

    processInfo.status = 'restarting';
    processInfo.restartCount++;
    processInfo.lastRestartAt = new Date();

    try {
      // Stop current process
      await this.stopServer(serverId, true);

      // Wait restart delay
      if (this.options.restartDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.options.restartDelay));
      }

      // Start new process
      const newProcessInfo = await this.startServer(serverId);

      // Copy restart metadata
      newProcessInfo.restartCount = processInfo.restartCount;
      newProcessInfo.lastRestartAt = processInfo.lastRestartAt;

      this.emit('process:restarted', serverId, newProcessInfo);

      mcpLogger.info('MCP server process restarted successfully', {
        server_id: serverId,
        restart_count: newProcessInfo.restartCount,
      });

      return newProcessInfo;

    } catch (error) {
      processInfo.status = 'failed';
      processInfo.lastError = error instanceof Error ? error.message : String(error);

      mcpLogger.error('Failed to restart MCP server process', {
        server_id: serverId,
        restart_count: processInfo.restartCount,
        error: processInfo.lastError,
      });

      this.emit('process:failed', serverId, processInfo, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get process information
   */
  getProcessInfo(serverId: string): ProcessInfo | null {
    return this.processes.get(serverId) || null;
  }

  /**
   * Get all managed processes
   */
  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get processes by status
   */
  getProcessesByStatus(status: ProcessStatus): ProcessInfo[] {
    return this.getAllProcesses().filter(p => p.status === status);
  }

  /**
   * Check if server is running
   */
  isServerRunning(serverId: string): boolean {
    const processInfo = this.processes.get(serverId);
    return processInfo ? processInfo.status === 'running' : false;
  }

  /**
   * Start all enabled servers from configuration
   */
  async startAllServers(configPath?: string): Promise<ProcessInfo[]> {
    mcpLogger.info('Starting all enabled MCP servers', { config_path: configPath });

    const enabledServers = await mcpConfigLoader.listEnabledServers(configPath);
    const startPromises = enabledServers.map(server =>
      this.startServer(server.id, configPath).catch(error => {
        mcpLogger.error('Failed to start server during bulk start', {
          server_id: server.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
    );

    const results = await Promise.all(startPromises);
    const successful = results.filter(Boolean) as ProcessInfo[];

    mcpLogger.info('Bulk server start completed', {
      total_servers: enabledServers.length,
      successful_starts: successful.length,
      failed_starts: enabledServers.length - successful.length,
    });

    return successful;
  }

  /**
   * Stop all managed processes
   */
  async stopAllServers(force = false): Promise<void> {
    mcpLogger.info('Stopping all MCP server processes', {
      force,
      process_count: this.processes.size,
    });

    const stopPromises = Array.from(this.processes.keys()).map(serverId =>
      this.stopServer(serverId, force).catch(error => {
        mcpLogger.error('Failed to stop server during bulk stop', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );

    await Promise.all(stopPromises);

    mcpLogger.info('All MCP server processes stopped');
  }

  /**
   * Shutdown process manager
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    mcpLogger.info('Shutting down MCP Process Manager');

    // Clear all timers
    this.healthCheckTimers.forEach(timer => {
      clearInterval(timer);
    });
    this.restartTimers.forEach(timer => {
      clearTimeout(timer);
    });
    this.healthCheckTimers.clear();
    this.restartTimers.clear();

    // Stop all processes
    await this.stopAllServers(true);

    mcpLogger.info('MCP Process Manager shutdown complete');
  }

  /**
   * Spawn MCP server process
   */
  private async spawnProcess(serverId: string, config: ResolvedMCPServerConfig): Promise<ProcessInfo> {
    return new Promise((resolve, reject) => {
      const processInfo: ProcessInfo = {
        serverId,
        config,
        process: null as any, // Will be set below
        status: 'starting',
        startedAt: new Date(),
        restartCount: 0,
        healthStatus: 'unknown',
        errorCount: 0,
      };

      try {
        // Spawn the process
        const childProcess = spawn(config.resolvedCommand, config.args || [], {
          cwd: config.resolvedCwd,
          env: { ...process.env, ...config.resolvedEnv },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false,
        });

        processInfo.process = childProcess;
        processInfo.pid = childProcess.pid;

        // Set up process event handlers
        childProcess.on('spawn', () => {
          processInfo.status = 'running';
          processInfo.healthStatus = 'healthy';

          mcpLogger.info('MCP server process spawned', {
            server_id: serverId,
            pid: processInfo.pid,
          });

          resolve(processInfo);
        });

        childProcess.on('error', (error) => {
          processInfo.status = 'failed';
          processInfo.healthStatus = 'unhealthy';
          processInfo.errorCount++;
          processInfo.lastError = error.message;

          mcpLogger.error('MCP server process error', {
            server_id: serverId,
            pid: processInfo.pid,
            error: error.message,
          });

          this.emit('process:failed', serverId, processInfo, error);

          // Auto-restart if enabled and within limits
          if (this.options.enableAutoRestart && processInfo.restartCount < this.options.maxRestartAttempts) {
            this.scheduleRestart(serverId);
          }

          reject(error);
        });

        childProcess.on('exit', (code, signal) => {
          processInfo.status = code === 0 ? 'stopped' : 'failed';
          processInfo.healthStatus = 'unhealthy';

          mcpLogger.info('MCP server process exited', {
            server_id: serverId,
            pid: processInfo.pid,
            exit_code: code,
            signal,
          });

          if (code !== 0 && !this.isShuttingDown) {
            processInfo.errorCount++;
            processInfo.lastError = `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;

            // Auto-restart if enabled and within limits
            if (this.options.enableAutoRestart && processInfo.restartCount < this.options.maxRestartAttempts) {
              this.scheduleRestart(serverId);
            }
          }
        });

        // Handle stdout/stderr
        childProcess.stdout?.on('data', (data) => {
          mcpLogger.debug('MCP server stdout', {
            server_id: serverId,
            data: data.toString().trim(),
          });
        });

        childProcess.stderr?.on('data', (data) => {
          const errorData = data.toString().trim();
          processInfo.errorCount++;
          processInfo.lastError = errorData;

          mcpLogger.warn('MCP server stderr', {
            server_id: serverId,
            data: errorData,
          });
        });

        // Timeout check
        const startTimeout = setTimeout(() => {
          if (processInfo.status === 'starting') {
            const error = new Error(`MCP server startup timeout: ${serverId}`);
            childProcess.kill('SIGTERM');
            reject(error);
          }
        }, this.options.processTimeout);

        // Clear timeout on successful start
        childProcess.on('spawn', () => clearTimeout(startTimeout));

      } catch (error) {
        processInfo.status = 'failed';
        processInfo.lastError = error instanceof Error ? error.message : String(error);
        reject(error);
      }
    });
  }

  /**
   * Terminate process gracefully or forcefully
   */
  private async terminateProcess(processInfo: ProcessInfo, force = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const { process: childProcess, serverId } = processInfo;

      if (!childProcess || !childProcess.pid) {
        resolve();
        return;
      }

      const killTimeout = setTimeout(() => {
        if (childProcess.killed) {
          resolve();
          return;
        }

        mcpLogger.warn('Force killing MCP server process', {
          server_id: serverId,
          pid: childProcess.pid,
        });

        try {
          childProcess.kill('SIGKILL');
        } catch (error) {
          mcpLogger.error('Failed to force kill process', {
            server_id: serverId,
            pid: childProcess.pid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, this.options.killTimeout);

      childProcess.on('exit', () => {
        clearTimeout(killTimeout);
        resolve();
      });

      childProcess.on('error', (error) => {
        clearTimeout(killTimeout);
        reject(error);
      });

      // Send termination signal
      try {
        childProcess.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch (error) {
        clearTimeout(killTimeout);
        reject(error);
      }
    });
  }

  /**
   * Start health monitoring for a process
   */
  private startHealthMonitoring(serverId: string): void {
    if (this.healthCheckTimers.has(serverId)) {
      clearInterval(this.healthCheckTimers.get(serverId)!);
    }

    const timer = setInterval(() => {
      this.performHealthCheck(serverId);
    }, this.options.healthCheckInterval);

    this.healthCheckTimers.set(serverId, timer);
  }

  /**
   * Stop health monitoring for a process
   */
  private stopHealthMonitoring(serverId: string): void {
    const timer = this.healthCheckTimers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(serverId);
    }
  }

  /**
   * Perform health check on a process
   */
  private async performHealthCheck(serverId: string): Promise<void> {
    const processInfo = this.processes.get(serverId);
    if (!processInfo || processInfo.status !== 'running') {
      return;
    }

    const previousStatus = processInfo.healthStatus;
    processInfo.healthStatus = 'checking';
    processInfo.lastHealthCheck = new Date();

    try {
      // Basic process health check (process is still running)
      const isAlive = processInfo.process && !processInfo.process.killed && processInfo.process.pid;

      if (isAlive) {
        processInfo.healthStatus = 'healthy';
      } else {
        processInfo.healthStatus = 'unhealthy';
        processInfo.status = 'failed';
        processInfo.lastError = 'Process is no longer running';
      }

      // Emit health change event if status changed
      if (previousStatus !== processInfo.healthStatus) {
        this.emit('health:changed', serverId, processInfo.healthStatus, processInfo);

        mcpLogger.info('MCP server health status changed', {
          server_id: serverId,
          previous_status: previousStatus,
          current_status: processInfo.healthStatus,
        });
      }

    } catch (error) {
      processInfo.healthStatus = 'unhealthy';
      processInfo.lastError = error instanceof Error ? error.message : String(error);

      if (previousStatus !== 'unhealthy') {
        this.emit('health:changed', serverId, processInfo.healthStatus, processInfo);
      }

      mcpLogger.error('Health check failed for MCP server', {
        server_id: serverId,
        error: processInfo.lastError,
      });
    }
  }

  /**
   * Schedule a restart for later execution
   */
  private scheduleRestart(serverId: string): void {
    // Clear existing restart timer
    const existingTimer = this.restartTimers.get(serverId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.restartTimers.delete(serverId);

      try {
        await this.restartServer(serverId);
      } catch (error) {
        mcpLogger.error('Scheduled restart failed', {
          server_id: serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.options.restartDelay);

    this.restartTimers.set(serverId, timer);

    mcpLogger.info('Scheduled MCP server restart', {
      server_id: serverId,
      delay_ms: this.options.restartDelay,
    });
  }
}

// Export singleton instance
export const mcpProcessManager = new MCPProcessManager();