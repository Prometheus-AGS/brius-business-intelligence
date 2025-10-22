/**
 * Bedrock Model Configuration Service
 *
 * Manages centralized configuration for Claude and Titan models with
 * environment variable loading and runtime updates.
 */

import type { BedrockLLMServiceConfig } from '../types/index.js';
import { DEFAULT_BEDROCK_CONFIG } from '../types/bedrock-config.js';

/**
 * Bedrock Model Configuration Service
 * Manages centralized configuration for Claude and Titan models
 */
export class BedrockModelConfig {
  private config: BedrockLLMServiceConfig;

  constructor(config?: Partial<BedrockLLMServiceConfig>) {
    this.config = this.loadConfiguration(config);
  }

  /**
   * Load configuration from environment variables and provided config
   */
  private loadConfiguration(config?: Partial<BedrockLLMServiceConfig>): BedrockLLMServiceConfig {
    const envConfig: Partial<BedrockLLMServiceConfig> = {
      region: process.env.AWS_REGION || DEFAULT_BEDROCK_CONFIG.region,
      claude: {
        ...DEFAULT_BEDROCK_CONFIG.claude,
        defaultTemperature: process.env.BEDROCK_DEFAULT_TEMPERATURE 
          ? parseFloat(process.env.BEDROCK_DEFAULT_TEMPERATURE) 
          : DEFAULT_BEDROCK_CONFIG.claude.defaultTemperature,
        defaultMaxTokens: process.env.BEDROCK_DEFAULT_MAX_TOKENS 
          ? parseInt(process.env.BEDROCK_DEFAULT_MAX_TOKENS, 10) 
          : DEFAULT_BEDROCK_CONFIG.claude.defaultMaxTokens,
      },
      titan: {
        ...DEFAULT_BEDROCK_CONFIG.titan,
        dimensions: process.env.BEDROCK_TITAN_DIMENSIONS
          ? (parseInt(process.env.BEDROCK_TITAN_DIMENSIONS, 10) as 256 | 512 | 1024 | 1536)
          : DEFAULT_BEDROCK_CONFIG.titan.dimensions,
      },
      circuitBreaker: {
        ...DEFAULT_BEDROCK_CONFIG.circuitBreaker,
        failureThreshold: process.env.BEDROCK_CIRCUIT_BREAKER_THRESHOLD 
          ? parseInt(process.env.BEDROCK_CIRCUIT_BREAKER_THRESHOLD, 10) 
          : DEFAULT_BEDROCK_CONFIG.circuitBreaker.failureThreshold,
      },
      monitoring: {
        ...DEFAULT_BEDROCK_CONFIG.monitoring,
        enabled: process.env.LANGFUSE_PUBLIC_KEY ? true : DEFAULT_BEDROCK_CONFIG.monitoring.enabled,
        langfuse: process.env.LANGFUSE_PUBLIC_KEY ? {
          publicKey: process.env.LANGFUSE_PUBLIC_KEY,
          secretKey: process.env.LANGFUSE_SECRET_KEY!,
          baseUrl: process.env.LANGFUSE_BASEURL || 'http://localhost:3000',
        } : undefined,
      },
    };

    // Add AWS credentials if provided in environment
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      envConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }

    return {
      ...DEFAULT_BEDROCK_CONFIG,
      ...envConfig,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): BedrockLLMServiceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<BedrockLLMServiceConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get Claude-specific configuration
   */
  getClaudeConfig() {
    return { ...this.config.claude };
  }

  /**
   * Get Titan-specific configuration
   */
  getTitanConfig() {
    return { ...this.config.titan };
  }

  /**
   * Get circuit breaker configuration
   */
  getCircuitBreakerConfig() {
    return { ...this.config.circuitBreaker };
  }

  /**
   * Get monitoring configuration
   */
  getMonitoringConfig() {
    return { ...this.config.monitoring };
  }

  /**
   * Validate configuration
   */
  async validateConfiguration(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Validate AWS region
    const supportedRegions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-northeast-1', 'ap-southeast-2'];
    if (!supportedRegions.includes(this.config.region)) {
      errors.push(`Unsupported AWS region: ${this.config.region}`);
    }

    // Validate Claude configuration
    if (this.config.claude.defaultTemperature < 0 || this.config.claude.defaultTemperature > 1) {
      errors.push('Claude temperature must be between 0 and 1');
    }

    if (this.config.claude.defaultMaxTokens < 1 || this.config.claude.defaultMaxTokens > 8000) {
      errors.push('Claude max tokens must be between 1 and 8000');
    }

    // Validate Titan configuration
    const validDimensions = [256, 512, 1024, 1536];
    if (!validDimensions.includes(this.config.titan.dimensions)) {
      errors.push('Titan dimensions must be 256, 512, 1024, or 1536');
    }

    // Validate circuit breaker configuration
    if (this.config.circuitBreaker.failureThreshold < 1) {
      errors.push('Circuit breaker failure threshold must be at least 1');
    }

    if (this.config.circuitBreaker.recoveryTimeoutMs < 1000) {
      errors.push('Circuit breaker recovery timeout must be at least 1000ms');
    }

    // Validate monitoring configuration
    if (this.config.monitoring.samplingRate < 0 || this.config.monitoring.samplingRate > 1) {
      errors.push('Monitoring sampling rate must be between 0 and 1');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_BEDROCK_CONFIG };
  }
}

// Singleton instance
let bedrockConfig: BedrockModelConfig;

/**
 * Get singleton Bedrock configuration instance
 */
export function getBedrockConfig(): BedrockModelConfig {
  if (!bedrockConfig) {
    bedrockConfig = new BedrockModelConfig();
  }
  return bedrockConfig;
}

/**
 * Initialize Bedrock configuration with custom config
 */
export function initializeBedrockConfig(config?: Partial<BedrockLLMServiceConfig>): BedrockModelConfig {
  bedrockConfig = new BedrockModelConfig(config);
  return bedrockConfig;
}