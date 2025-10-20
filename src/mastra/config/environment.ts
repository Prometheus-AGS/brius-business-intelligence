import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const envSchema = z.object({
  // Server Configuration
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // pgvector Database Configuration (Constitutional Requirement)
  PGVECTOR_DATABASE_URL: z.string().default('postgresql://postgres:password@localhost:5432/mastra_bi'),

  // Memory Configuration
  MEMORY_USER_TABLE: z.string().default('user_memories'),
  MEMORY_GLOBAL_TABLE: z.string().default('global_memories'),
  MEMORY_CACHE_TTL: z.string().default('3600'),
  MEMORY_MAX_CONTEXT_ITEMS: z.string().default('10'),

  // LangFuse Observability (Constitutional Requirement)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().default('https://cloud.langfuse.com'),
  LANGFUSE_ENABLED: z.string().default('true'),

  // Enhanced Observability Configuration (Constitutional Requirement)
  TOOL_TRACING_ENABLED: z.string().default('true'),
  AGENT_TRACING_ENABLED: z.string().default('true'),
  WORKFLOW_TRACING_ENABLED: z.string().default('true'),
  TRACING_CAPTURE_INPUT: z.string().default('true'),
  TRACING_CAPTURE_OUTPUT: z.string().default('true'),
  TRACING_MAX_INPUT_SIZE: z.string().default('20000'),
  TRACING_MAX_OUTPUT_SIZE: z.string().default('100000'),
  OBSERVABILITY_DASHBOARD_ENABLED: z.string().default('true'),

  // AWS Bedrock Configuration
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default('us-east-1'),
  BEDROCK_CLAUDE_MODEL_ID: z.string().default('anthropic.claude-3-5-sonnet-20240620-v1:0'),
  BEDROCK_TITAN_MODEL_ID: z.string().default('amazon.titan-embed-text-v2'),

  // MCP Server Configuration (Constitutional Requirement)
  MCP_SERVER_PORT: z.string().default('3001'),
  MCP_SERVER_HOST: z.string().default('0.0.0.0'),
  MCP_CONFIG_PATH: z.string().default('./mcp.json'),
  SUPABASE_PROJECT_REF: z.string().optional(),
  SUPABASE_ACCESS_TOKEN: z.string().optional(),

  // Playground Configuration
  PLAYGROUND_ENABLED: z.string().default('true'),
  PLAYGROUND_AUTH_REQUIRED: z.string().default('false'),
});

export type Environment = z.infer<typeof envSchema>;

let env: Environment;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  console.error('Environment validation failed:', error);
  process.exit(1);
}

export { env };

// Helper functions for common conversions
export const getPort = () => parseInt(env.PORT, 10);
export const getMcpServerPort = () => parseInt(env.MCP_SERVER_PORT, 10);
export const getMemoryCacheTtl = () => parseInt(env.MEMORY_CACHE_TTL, 10);
export const getMemoryMaxContextItems = () => parseInt(env.MEMORY_MAX_CONTEXT_ITEMS, 10);
export const isPlaygroundEnabled = () => env.PLAYGROUND_ENABLED.toLowerCase() === 'true';
export const isPlaygroundAuthRequired = () => env.PLAYGROUND_AUTH_REQUIRED.toLowerCase() === 'true';
export const isDevelopment = () => env.NODE_ENV === 'development';
export const isProduction = () => env.NODE_ENV === 'production';
export const isLangFuseEnabled = () => env.LANGFUSE_ENABLED.toLowerCase() === 'true' && Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);

// Enhanced Observability Configuration Helpers (Constitutional Requirement)
export const isToolTracingEnabled = () => env.TOOL_TRACING_ENABLED.toLowerCase() === 'true';
export const isAgentTracingEnabled = () => env.AGENT_TRACING_ENABLED.toLowerCase() === 'true';
export const isWorkflowTracingEnabled = () => env.WORKFLOW_TRACING_ENABLED.toLowerCase() === 'true';
export const isTracingCaptureInputEnabled = () => env.TRACING_CAPTURE_INPUT.toLowerCase() === 'true';
export const isTracingCaptureOutputEnabled = () => env.TRACING_CAPTURE_OUTPUT.toLowerCase() === 'true';
export const getTracingMaxInputSize = () => parseInt(env.TRACING_MAX_INPUT_SIZE, 10);
export const getTracingMaxOutputSize = () => parseInt(env.TRACING_MAX_OUTPUT_SIZE, 10);
export const isObservabilityDashboardEnabled = () => env.OBSERVABILITY_DASHBOARD_ENABLED.toLowerCase() === 'true';
