import { readFile, access } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';
import { z } from 'zod';
import { mcpLogger } from '../observability/logger.js';

/**
 * MCP Configuration Loader
 * Loads and validates MCP server configurations from mcp.json files
 * Supports environment variable substitution and configuration inheritance
 */

// Configuration schemas for validation
const MCPServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  cwd: z.string().optional(),
  timeout: z.number().min(1000).optional().default(30000),
  restart: z.boolean().optional().default(true),
  maxRestarts: z.number().min(0).optional().default(5),
  restartDelay: z.number().min(100).optional().default(1000),
  enabled: z.boolean().optional().default(true),
  categories: z.array(z.string()).optional().default([]),
  description: z.string().optional(),
  version: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const MCPConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  servers: z.record(z.string(), MCPServerConfigSchema),
  global: z.object({
    timeout: z.number().min(1000).optional().default(30000),
    maxConcurrent: z.number().min(1).optional().default(10),
    retryAttempts: z.number().min(0).optional().default(3),
    retryDelay: z.number().min(100).optional().default(1000),
    env: z.record(z.string(), z.string()).optional().default({}),
  }).optional().default({}),
  extends: z.string().optional(),
  includes: z.array(z.string()).optional().default([]),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export interface ResolvedMCPConfig extends Omit<MCPConfig, 'extends' | 'includes'> {
  servers: Record<string, ResolvedMCPServerConfig>;
  metadata: {
    configPath: string;
    loadedAt: string;
    totalServers: number;
    enabledServers: number;
    loadedConfigs: string[];
  };
}

export interface ResolvedMCPServerConfig extends MCPServerConfig {
  id: string;
  resolvedCommand: string;
  resolvedCwd: string;
  resolvedEnv: Record<string, string>;
}

/**
 * MCP Configuration Loader class
 */
export class MCPConfigLoader {
  private configCache = new Map<string, ResolvedMCPConfig>();
  private readonly defaultConfigPaths = [
    './mcp.json',
    './config/mcp.json',
    './.mcp/config.json',
    './mcp.config.json',
  ];

  /**
   * Load MCP configuration from file or default locations
   */
  async loadConfig(configPath?: string): Promise<ResolvedMCPConfig> {
    const resolvedPath = await this.findConfigFile(configPath);

    mcpLogger.info('Loading MCP configuration', {
      config_path: resolvedPath,
      explicit_path: Boolean(configPath),
    });

    // Check cache first
    if (this.configCache.has(resolvedPath)) {
      const cached = this.configCache.get(resolvedPath)!;
      mcpLogger.debug('Using cached MCP configuration', {
        config_path: resolvedPath,
        cache_age_ms: Date.now() - new Date(cached.metadata.loadedAt).getTime(),
      });
      return cached;
    }

    try {
      const config = await this.loadAndProcessConfig(resolvedPath);
      this.configCache.set(resolvedPath, config);

      mcpLogger.info('MCP configuration loaded successfully', {
        config_path: resolvedPath,
        total_servers: config.metadata.totalServers,
        enabled_servers: config.metadata.enabledServers,
        loaded_configs: config.metadata.loadedConfigs,
      });

      return config;

    } catch (error) {
      mcpLogger.error('Failed to load MCP configuration', {
        config_path: resolvedPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find configuration file in default locations
   */
  private async findConfigFile(explicitPath?: string): Promise<string> {
    if (explicitPath) {
      const resolved = isAbsolute(explicitPath) ? explicitPath : resolve(process.cwd(), explicitPath);
      try {
        await access(resolved);
        return resolved;
      } catch {
        throw new Error(`MCP configuration file not found: ${resolved}`);
      }
    }

    // Search default locations
    for (const defaultPath of this.defaultConfigPaths) {
      const resolved = resolve(process.cwd(), defaultPath);
      try {
        await access(resolved);
        return resolved;
      } catch {
        // Continue searching
      }
    }

    throw new Error(`MCP configuration file not found. Searched: ${this.defaultConfigPaths.join(', ')}`);
  }

  /**
   * Load and process configuration with inheritance and includes
   */
  private async loadAndProcessConfig(
    configPath: string,
    loadedConfigs: string[] = []
  ): Promise<ResolvedMCPConfig> {
    // Prevent circular dependencies
    if (loadedConfigs.includes(configPath)) {
      throw new Error(`Circular dependency detected in MCP configuration: ${configPath}`);
    }

    const newLoadedConfigs = [...loadedConfigs, configPath];

    // Load raw configuration
    const rawConfig = await this.loadRawConfig(configPath);
    let processedConfig = { ...rawConfig };

    // Process inheritance (extends)
    if (rawConfig.extends) {
      const parentPath = this.resolveConfigPath(rawConfig.extends, configPath);
      const parentConfig = await this.loadAndProcessConfig(parentPath, newLoadedConfigs);

      // Merge parent configuration
      processedConfig = this.mergeConfigs(parentConfig, processedConfig);
    }

    // Process includes
    for (const includePath of rawConfig.includes || []) {
      const resolvedIncludePath = this.resolveConfigPath(includePath, configPath);
      const includeConfig = await this.loadAndProcessConfig(resolvedIncludePath, newLoadedConfigs);

      // Merge included configuration
      processedConfig = this.mergeConfigs(processedConfig, includeConfig);
    }

    // Resolve and validate final configuration
    return this.resolveConfiguration(processedConfig, configPath, newLoadedConfigs);
  }

  /**
   * Load raw configuration from file
   */
  private async loadRawConfig(configPath: string): Promise<MCPConfig> {
    try {
      const content = await readFile(configPath, 'utf-8');
      const rawData = JSON.parse(content);

      // Validate against schema
      const validationResult = MCPConfigSchema.safeParse(rawData);
      if (!validationResult.success) {
        throw new Error(`Invalid MCP configuration in ${configPath}: ${validationResult.error.message}`);
      }

      return validationResult.data;

    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in MCP configuration file: ${configPath}`);
      }
      throw error;
    }
  }

  /**
   * Resolve configuration path relative to parent config
   */
  private resolveConfigPath(path: string, parentConfigPath: string): string {
    if (isAbsolute(path)) {
      return path;
    }
    return resolve(join(parentConfigPath, '..'), path);
  }

  /**
   * Merge two configurations with proper precedence
   */
  private mergeConfigs(base: MCPConfig, override: MCPConfig): MCPConfig {
    return {
      version: override.version || base.version,
      servers: {
        ...base.servers,
        ...override.servers,
      },
      global: {
        ...base.global,
        ...override.global,
      },
      extends: override.extends,
      includes: [...(base.includes || []), ...(override.includes || [])],
    };
  }

  /**
   * Resolve final configuration with environment variables and validation
   */
  private resolveConfiguration(
    config: MCPConfig,
    configPath: string,
    loadedConfigs: string[]
  ): ResolvedMCPConfig {
    const resolvedServers: Record<string, ResolvedMCPServerConfig> = {};
    let enabledCount = 0;

    for (const [serverId, serverConfig] of Object.entries(config.servers)) {
      if (!serverConfig.enabled) {
        continue;
      }

      const resolvedServer = this.resolveServerConfig(serverId, serverConfig, config.global);
      resolvedServers[serverId] = resolvedServer;
      enabledCount++;
    }

    return {
      version: config.version,
      servers: resolvedServers,
      global: config.global || {},
      metadata: {
        configPath,
        loadedAt: new Date().toISOString(),
        totalServers: Object.keys(config.servers).length,
        enabledServers: enabledCount,
        loadedConfigs,
      },
    };
  }

  /**
   * Resolve individual server configuration
   */
  private resolveServerConfig(
    serverId: string,
    serverConfig: MCPServerConfig,
    globalConfig: MCPConfig['global'] = {}
  ): ResolvedMCPServerConfig {
    // Resolve environment variables
    const resolvedEnv = this.resolveEnvironmentVariables({
      ...globalConfig.env,
      ...serverConfig.env,
      MCP_SERVER_ID: serverId,
    });

    // Resolve command path
    const resolvedCommand = this.resolveEnvironmentVariables({ command: serverConfig.command }, resolvedEnv).command;

    // Resolve working directory
    const resolvedCwd = serverConfig.cwd
      ? resolve(this.resolveEnvironmentVariables({ cwd: serverConfig.cwd }, resolvedEnv).cwd)
      : process.cwd();

    return {
      ...serverConfig,
      id: serverId,
      resolvedCommand,
      resolvedCwd,
      resolvedEnv,
      timeout: serverConfig.timeout || globalConfig.timeout || 30000,
    };
  }

  /**
   * Resolve environment variables in configuration values
   */
  private resolveEnvironmentVariables(
    obj: Record<string, string>,
    additionalEnv: Record<string, string> = {}
  ): Record<string, string> {
    const envContext = { ...process.env, ...additionalEnv };
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = this.substituteEnvironmentVariables(value, envContext);
    }

    return resolved;
  }

  /**
   * Substitute environment variables in a string value
   */
  private substituteEnvironmentVariables(
    value: string,
    env: Record<string, string | undefined>
  ): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = env[varName];
      if (envValue === undefined) {
        mcpLogger.warn('Environment variable not found', {
          variable: varName,
          match,
        });
        return match; // Return original if not found
      }
      return envValue;
    });
  }

  /**
   * Reload configuration (clears cache)
   */
  async reloadConfig(configPath?: string): Promise<ResolvedMCPConfig> {
    const resolvedPath = await this.findConfigFile(configPath);
    this.configCache.delete(resolvedPath);
    return this.loadConfig(configPath);
  }

  /**
   * Clear configuration cache
   */
  clearCache(): void {
    this.configCache.clear();
    mcpLogger.debug('MCP configuration cache cleared');
  }

  /**
   * Get server configuration by ID
   */
  async getServerConfig(serverId: string, configPath?: string): Promise<ResolvedMCPServerConfig | null> {
    const config = await this.loadConfig(configPath);
    return config.servers[serverId] || null;
  }

  /**
   * List all enabled servers
   */
  async listEnabledServers(configPath?: string): Promise<ResolvedMCPServerConfig[]> {
    const config = await this.loadConfig(configPath);
    return Object.values(config.servers);
  }

  /**
   * Validate configuration without loading
   */
  async validateConfig(configPath?: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const resolvedPath = await this.findConfigFile(configPath);
      await this.loadConfig(resolvedPath);

      return { valid: true, errors, warnings };

    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return { valid: false, errors, warnings };
    }
  }
}

// Export singleton instance
export const mcpConfigLoader = new MCPConfigLoader();