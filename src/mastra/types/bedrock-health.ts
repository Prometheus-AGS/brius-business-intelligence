/**
 * Bedrock Health Types
 *
 * Health check and metrics types for the Bedrock LLM service.
 */

export interface BedrockServiceHealth {
  /** Overall service health status */
  healthy: boolean;

  /** Individual component health */
  components: {
    awsConnection: ComponentHealth;
    claudeModel: ComponentHealth;
    titanModel: ComponentHealth;
    langfuseMonitoring: ComponentHealth;
    circuitBreaker: ComponentHealth;
  };

  /** Health check timestamp */
  timestamp: string;

  /** Additional service metadata */
  metadata: {
    region: string;
    version: string;
    uptime: number;
  };
}

export interface ComponentHealth {
  /** Component health status */
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

  /** Last successful check timestamp */
  lastCheck: string;

  /** Response time for last check (ms) */
  responseTimeMs?: number;

  /** Error message if unhealthy */
  error?: string;

  /** Additional component details */
  details?: Record<string, any>;
}

export interface ServiceMetrics {
  /** Request statistics */
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
  };

  /** Claude-specific metrics */
  claude: {
    totalRequests: number;
    totalTokensGenerated: number;
    averageTokensPerRequest: number;
    costEstimate: number;
  };

  /** Titan-specific metrics */
  titan: {
    totalRequests: number;
    totalEmbeddings: number;
    averageProcessingTime: number;
    costEstimate: number;
  };

  /** Circuit breaker metrics */
  circuitBreaker: {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    successCount: number;
    lastStateChange: string;
  };

  /** Time period for these metrics */
  period: {
    start: string;
    end: string;
    durationMs: number;
  };
}