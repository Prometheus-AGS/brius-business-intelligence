import type { Tool } from '@mastra/core/tools';
import { initializeMCPToolRegistration, getMCPTools } from '../tools/mcp-registry.js';
import { bedrockTools } from '../tools/bedrock-tools.js';
import { supabaseTools } from '../tools/supabase-tools.js';
import { memoryTools } from '../tools/memory-tools.js';
import { knowledgeSearchTools } from '../tools/knowledge-search.js';
import type { BedrockTool } from '../types/bedrock.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { rootLogger } from '../observability/logger.js';

let cachedToolMap: Record<string, any> | null = null;
let isInitialized = false;

export async function ensureMcpToolsLoaded(): Promise<void> {
  if (isInitialized) return;
  
  try {
    rootLogger.info('🔥 STARTING MCP TOOLS INITIALIZATION');
    
    // Initialize MCP registry first
    rootLogger.info('🔥 INITIALIZING MCP REGISTRY');
    await mcpToolRegistry.initialize();
    rootLogger.info('🔥 MCP REGISTRY INITIALIZED');
    
    // Initialize MCP tool registration manager
    rootLogger.info('🔥 INITIALIZING MCP TOOL REGISTRATION');
    await initializeMCPToolRegistration();
    rootLogger.info('🔥 MCP TOOL REGISTRATION INITIALIZED');
    
    // Refresh tool cache
    refreshToolCache();
    
    isInitialized = true;
    rootLogger.info('🔥 MCP TOOLS INITIALIZATION COMPLETED', {
      total_tools: cachedToolMap ? Object.keys(cachedToolMap).length : 0,
      mcp_tools: getMCPTools().length,
      bedrock_tools: bedrockTools.length,
    });
    
  } catch (error) {
    rootLogger.error('🔥 MCP TOOLS INITIALIZATION FAILED', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Continue with just Bedrock tools if MCP fails
    refreshToolCache();
    isInitialized = true;
  }
}

/**
 * Convert BedrockTool to Mastra Tool format
 */
function convertBedrockToolToMastraTool(bedrockTool: BedrockTool): Tool {
  return {
    id: bedrockTool.id,
    description: bedrockTool.description,
    inputSchema: bedrockTool.inputSchema as any,
    outputSchema: bedrockTool.outputSchema as any,
    execute: bedrockTool.execute as any,
  };
}

/**
 * Convert custom Supabase tool to Mastra Tool format
 */
function convertSupabaseToolToMastraTool(supabaseTool: any): Tool {
  return {
    id: supabaseTool.id,
    description: supabaseTool.description,
    inputSchema: supabaseTool.inputSchema as any,
    execute: supabaseTool.execute as any,
  };
}

function refreshToolCache() {
  try {
    // Get MCP tools from the registration manager
    const mcpTools = getMCPTools();

    // Convert Bedrock tools to Mastra Tool format
    const convertedBedrockTools = bedrockTools.map(convertBedrockToolToMastraTool);

    // Convert custom Supabase tools to Mastra Tool format
    const convertedSupabaseTools = supabaseTools.map(convertSupabaseToolToMastraTool);

    rootLogger.info('🔥 REFRESHING TOOL CACHE', {
      mcp_tools_count: mcpTools.length,
      bedrock_tools_count: bedrockTools.length,
      supabase_tools_count: convertedSupabaseTools.length,
      memory_tools_count: memoryTools.length,
      knowledge_tools_count: knowledgeSearchTools.length,
      mcp_tool_ids: mcpTools.map(t => t.id),
      supabase_tool_ids: convertedSupabaseTools.map(t => t.id),
      memory_tool_ids: memoryTools.map(t => t.id),
      knowledge_tool_ids: knowledgeSearchTools.map(t => t.id),
      mcp_tools_sample: mcpTools.slice(0, 3).map(t => ({ id: t.id, description: t.description })),
    });

    // Combine MCP tools, Bedrock tools, custom Supabase tools, memory tools, and knowledge search tools
    const allTools = [...mcpTools, ...convertedBedrockTools, ...convertedSupabaseTools, ...memoryTools, ...knowledgeSearchTools];

    cachedToolMap = allTools.reduce<Record<string, any>>((acc, tool) => {
      acc[tool.id] = tool;
      return acc;
    }, {});

    rootLogger.info('🔥 TOOL CACHE REFRESHED', {
      total_tools: allTools.length,
      tool_ids: allTools.map(t => t.id),
    });

  } catch (error) {
    rootLogger.error('🔥 TOOL CACHE REFRESH FAILED', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback to Bedrock tools, custom Supabase tools, memory tools, and knowledge search tools
    const convertedBedrockTools = bedrockTools.map(convertBedrockToolToMastraTool);
    const convertedSupabaseTools = supabaseTools.map(convertSupabaseToolToMastraTool);
    const fallbackTools = [...convertedBedrockTools, ...convertedSupabaseTools, ...memoryTools, ...knowledgeSearchTools];

    cachedToolMap = fallbackTools.reduce<Record<string, any>>((acc, tool) => {
      acc[tool.id] = tool;
      return acc;
    }, {});
  }
}

export function getSharedToolMap(): Record<string, any> {
  if (!cachedToolMap) {
    refreshToolCache();
  }
  return cachedToolMap!;
}

/**
 * Get only Bedrock tools (converted to Mastra format)
 */
export function getBedrockTools(): Tool[] {
  return bedrockTools.map(convertBedrockToolToMastraTool);
}

/**
 * Get only custom Supabase tools (converted to Mastra format)
 */
export function getSupabaseTools(): Tool[] {
  return supabaseTools.map(convertSupabaseToolToMastraTool);
}

/**
 * Get tool counts by category
 */
export function getToolCounts(): {
  total: number;
  mcp: number;
  bedrock: number;
  supabase: number;
} {
  try {
    const mcpTools = getMCPTools();

    return {
      total: mcpTools.length + bedrockTools.length + supabaseTools.length,
      mcp: mcpTools.length,
      bedrock: bedrockTools.length,
      supabase: supabaseTools.length,
    };
  } catch (error) {
    rootLogger.warn('🔥 FAILED TO GET TOOL COUNTS', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      total: bedrockTools.length + supabaseTools.length,
      mcp: 0,
      bedrock: bedrockTools.length,
      supabase: supabaseTools.length,
    };
  }
}

/**
 * Get all available tools for agents (includes both MCP and Bedrock tools)
 */
export function getAllAvailableTools(): Tool[] {
  const toolMap = getSharedToolMap();
  return Object.values(toolMap);
}

/**
 * Get MCP tools specifically
 */
export function getMCPToolsForAgents(): Tool[] {
  try {
    return getMCPTools();
  } catch (error) {
    rootLogger.warn('🔥 FAILED TO GET MCP TOOLS FOR AGENTS', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Force refresh of tool cache (useful for testing or when tools are updated)
 */
export function forceRefreshTools(): void {
  rootLogger.info('🔥 FORCING TOOL CACHE REFRESH');
  cachedToolMap = null;
  refreshToolCache();
}
