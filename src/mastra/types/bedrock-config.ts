/**
 * Bedrock Configuration Types
 *
 * Configuration interfaces for the centralized Bedrock LLM service.
 * These types define the service configuration structure.
 */

export interface BedrockLLMServiceConfig {
  /** AWS region for Bedrock service */
  region: string;

  /** Claude 4 Sonnet model configuration */
  claude: ClaudeConfig;

  /** Titan v2 embeddings model configuration */
  titan: TitanConfig;

  /** Circuit breaker configuration for resilience */
  circuitBreaker: CircuitBreakerConfig;

  /** Langfuse monitoring configuration */
  monitoring: MonitoringConfig;

  /** AWS credentials (optional - will use default provider chain) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface ClaudeConfig {
  /** Model ID for Claude 4 Sonnet */
  modelId: 'anthropic.claude-sonnet-4-20250514-v1:0';

  /** Default temperature (0.0 - 1.0) */
  defaultTemperature: number;

  /** Default maximum output tokens */
  defaultMaxTokens: number;

  /** Default top-p value for nucleus sampling */
  defaultTopP: number;

  /** Default system prompt (optional) */
  defaultSystemPrompt?: string;

  /** Request timeout in milliseconds */
  timeoutMs: number;
}

export interface TitanConfig {
  /** Model ID for Titan v2 embeddings */
  modelId: 'amazon.titan-embed-text-v2:0';

  /** Output dimensions (256, 512, or 1024) */
  dimensions: 256 | 512 | 1024;

  /** Whether to normalize output vectors */
  normalize: boolean;

  /** Request timeout in milliseconds */
  timeoutMs: number;

  /** Maximum input text length */
  maxInputLength: number;
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Time to wait before attempting recovery (ms) */
  recoveryTimeoutMs: number;

  /** Maximum retry attempts for exponential backoff */
  maxRetries: number;

  /** Base delay for exponential backoff (ms) */
  baseDelayMs: number;

  /** Maximum delay cap for exponential backoff (ms) */
  maxDelayMs: number;
}

export interface MonitoringConfig {
  /** Enable Langfuse tracing */
  enabled: boolean;

  /** Langfuse project configuration */
  langfuse?: {
    publicKey: string;
    secretKey: string;
    baseUrl: string;
    environment?: string;
  };

  /** Sampling rate for traces (0.0 - 1.0) */
  samplingRate: number;

  /** Log level for service operations */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Mastra Tool Integration Types
 */
export interface MastraToolContext {
  /** User ID for the current session */
  userId?: string;

  /** Agent ID calling the tool */
  agentId?: string;

  /** Session ID for conversation tracking */
  sessionId?: string;

  /** Workflow ID if called from a workflow */
  workflowId?: string;

  /** Additional context metadata */
  metadata?: Record<string, any>;
}

export interface BedrockTool {
  /** Tool identifier */
  id: string;

  /** Tool description for agents */
  description: string;

  /** Zod input schema */
  inputSchema: any; // z.ZodSchema

  /** Zod output schema */
  outputSchema: any; // z.ZodSchema

  /** Tool execution function */
  execute: (params: {
    context: MastraToolContext;
    input: any;
  }) => Promise<any>;
}

/**
 * Default configuration values
 */
export const DEFAULT_BEDROCK_CONFIG: BedrockLLMServiceConfig = {
  region: 'us-east-1',
  claude: {
    modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4000,
    defaultTopP: 0.9,
    timeoutMs: 30000,
  },
  titan: {
    modelId: 'amazon.titan-embed-text-v2:0',
    dimensions: 1024,
    normalize: true,
    timeoutMs: 10000,
    maxInputLength: 8000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    recoveryTimeoutMs: 60000,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  monitoring: {
    enabled: true,
    samplingRate: 1.0,
    logLevel: 'info',
  },
};