import type { Tool } from '@mastra/core/tools';
import { initializeMCPToolRegistration, getMCPTools } from '../tools/mcp-registry.js';
import { bedrockTools } from '../tools/bedrock-tools.js';
import type { BedrockTool } from '../types/bedrock.js';

let cachedToolMap: Record<string, Tool> | null = null;

export async function ensureMcpToolsLoaded(): Promise<void> {
  if (cachedToolMap) return;
  await initializeMCPToolRegistration();
  refreshToolCache();
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

function refreshToolCache() {
  const mcpTools = getMCPTools();

  // Convert Bedrock tools to Mastra Tool format
  const convertedBedrockTools = bedrockTools.map(convertBedrockToolToMastraTool);

  // Combine MCP tools and converted Bedrock tools
  const allTools = [...mcpTools, ...convertedBedrockTools];

  cachedToolMap = allTools.reduce<Record<string, Tool>>((acc, tool) => {
    acc[tool.id] = tool;
    return acc;
  }, {});
}

export function getSharedToolMap(): Record<string, Tool> {
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
 * Get tool counts by category
 */
export function getToolCounts(): {
  total: number;
  mcp: number;
  bedrock: number;
} {
  const mcpTools = getMCPTools();

  return {
    total: mcpTools.length + bedrockTools.length,
    mcp: mcpTools.length,
    bedrock: bedrockTools.length,
  };
}
