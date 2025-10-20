import { z } from 'zod';

// MCP Protocol Types
export const MCPProtocolVersionSchema = z.literal('2024-11-05');

export const MCPCapabilitiesSchema = z.object({
  roots: z.object({
    listChanged: z.boolean().optional(),
  }).optional(),
  sampling: z.object({}).optional(),
  logging: z.object({}).optional(),
  tools: z.object({
    listChanged: z.boolean().optional(),
  }).optional(),
  prompts: z.object({
    listChanged: z.boolean().optional(),
  }).optional(),
});

export const MCPClientInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
});

export const MCPServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
});

// MCP Tool Types
export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
  category: z.enum(['agent', 'workflow', 'knowledge', 'memory']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MCPToolCallRequestSchema = z.object({
  method: z.literal('tools/call'),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
});

export const MCPToolCallResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string(),
    })
  ),
  isError: z.boolean().optional(),
});

// MCP Prompt Types
export const MCPPromptSchema = z.object({
  name: z.string(),
  description: z.string(),
  arguments: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      required: z.boolean().optional(),
    })
  ).optional(),
});

// MCP Initialize Types
export const MCPInitializeRequestSchema = z.object({
  protocolVersion: MCPProtocolVersionSchema,
  capabilities: MCPCapabilitiesSchema,
  clientInfo: MCPClientInfoSchema,
});

export const MCPInitializeResponseSchema = z.object({
  protocolVersion: MCPProtocolVersionSchema,
  capabilities: MCPCapabilitiesSchema,
  serverInfo: MCPServerInfoSchema,
});

// MCP Registry Types
export const MCPServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  description: z.string().optional(),
});

export const MCPConfigSchema = z.object({
  mcpServers: z.record(z.string(), MCPServerConfigSchema),
});

export const MCPToolRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.string(), z.unknown()),
  output_schema: z.record(z.string(), z.unknown()).optional(),
  category: z.enum(['mcp', 'agent', 'knowledge', 'memory', 'workflow']),
  source: z.string().optional(),
  availability_status: z.enum(['available', 'unavailable', 'error']),
  last_health_check: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// MCP Client Types
export const MCPClientConnectionSchema = z.object({
  server_id: z.string(),
  status: z.enum(['connecting', 'connected', 'disconnected', 'error']),
  tools: z.array(MCPToolSchema),
  prompts: z.array(MCPPromptSchema),
  last_health_check: z.string().datetime().optional(),
  error_message: z.string().optional(),
});

// MCP Tool Execution Types
export const MCPToolExecutionRequestSchema = z.object({
  tool_id: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  user_id: z.string().optional(),
  workflow_id: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
});

export const MCPToolExecutionResponseSchema = z.object({
  result: z.record(z.string(), z.unknown()),
  execution_time_ms: z.number().int().nonnegative(),
  status: z.enum(['success', 'error', 'timeout']),
  error_message: z.string().optional(),
  langfuse_trace_id: z.string().optional(),
});

// MCP Server Management Types
export const MCPServerStatusSchema = z.object({
  server_id: z.string(),
  name: z.string(),
  status: z.enum(['starting', 'running', 'stopping', 'stopped', 'error']),
  pid: z.number().int().positive().optional(),
  tools_count: z.number().int().nonnegative(),
  prompts_count: z.number().int().nonnegative(),
  uptime_ms: z.number().int().nonnegative().optional(),
  last_error: z.string().optional(),
  health_check_url: z.string().url().optional(),
});

// TypeScript types inferred from schemas
export type MCPProtocolVersion = z.infer<typeof MCPProtocolVersionSchema>;
export type MCPCapabilities = z.infer<typeof MCPCapabilitiesSchema>;
export type MCPClientInfo = z.infer<typeof MCPClientInfoSchema>;
export type MCPServerInfo = z.infer<typeof MCPServerInfoSchema>;

export type MCPTool = z.infer<typeof MCPToolSchema>;
export type MCPToolCallRequest = z.infer<typeof MCPToolCallRequestSchema>;
export type MCPToolCallResponse = z.infer<typeof MCPToolCallResponseSchema>;

export type MCPPrompt = z.infer<typeof MCPPromptSchema>;

export type MCPInitializeRequest = z.infer<typeof MCPInitializeRequestSchema>;
export type MCPInitializeResponse = z.infer<typeof MCPInitializeResponseSchema>;

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export type MCPToolRegistryEntry = z.infer<typeof MCPToolRegistryEntrySchema>;

export type MCPClientConnection = z.infer<typeof MCPClientConnectionSchema>;

export type MCPToolExecutionRequest = z.infer<typeof MCPToolExecutionRequestSchema>;
export type MCPToolExecutionResponse = z.infer<typeof MCPToolExecutionResponseSchema>;

export type MCPServerStatus = z.infer<typeof MCPServerStatusSchema>;