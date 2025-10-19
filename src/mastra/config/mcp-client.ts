/**
 * MCP Client Configuration
 * Constitutional requirement for Model Context Protocol integration
 */

import { env } from './environment.js';

export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  features?: string[];
  readOnly: boolean;
}

export interface SupabaseMCPConfig extends MCPServerConfig {
  projectRef: string;
  accessToken: string;
  features: Array<'database' | 'docs' | 'edge-functions' | 'branching' | 'storage'>;
}

/**
 * Base MCP server configurations for constitutional compliance
 */
export const getMCPServerConfigs = (): Record<string, MCPServerConfig> => {
  const configs: Record<string, MCPServerConfig> = {
    // Mastra MCP Server (Constitutional Requirement)
    mastra: {
      name: 'mastra',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@mastra/mcp-server@latest'],
      readOnly: false,
      features: ['validation', 'documentation']
    },

    // Context7 MCP Server (Constitutional Requirement)
    context7: {
      name: 'context7',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@context7/mcp-server@latest'],
      readOnly: true,
      features: ['documentation', 'validation']
    }
  };

  // Add Supabase MCP Server if configured (Constitutional Requirement)
  if (env.SUPABASE_PROJECT_REF && env.SUPABASE_ACCESS_TOKEN) {
    configs.supabase = {
      name: 'supabase',
      type: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@supabase/mcp-server-supabase@latest',
        '--features=database,docs',
        `--project-ref=${env.SUPABASE_PROJECT_REF}`
      ],
      env: {
        SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN
      },
      readOnly: true,
      features: ['database', 'docs']
    };
  }

  return configs;
};

/**
 * Create MCP configuration file content
 */
export const createMCPConfig = () => {
  const serverConfigs = getMCPServerConfigs();

  return {
    mcpServers: Object.fromEntries(
      Object.entries(serverConfigs).map(([name, config]) => [
        name,
        {
          command: config.command,
          args: config.args,
          env: config.env || {}
        }
      ])
    )
  };
};