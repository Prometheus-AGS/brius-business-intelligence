/**
 * Comprehensive LangFuse Client with Circuit Breaker
 * Constitutional requirement: Comprehensive observability for all tool calls, agent interactions, and workflow executions
 */

import { Langfuse } from 'langfuse';
import { env } from '../config/environment';
import { CircuitBreaker, withErrorHandling, errorHandler } from './error-handling';
import { rootLogger } from './logger';

// LangFuse trace and span types
export interface LangFuseTraceData {
  id?: string;
  name: string;
  userId?: string;
  metadata?: Record<string, any>;
  tags?: string[];
  input?: any;
  output?: any;
  sessionId?: string;
  version?: string;
  release?: string;
}

export interface LangFuseSpanData {
  id?: string;
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  startTime?: Date;
  endTime?: Date;
  level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  parentObservationId?: string;
  version?: string;
}

export interface LangFuseEventData {
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  parentObservationId?: string;
  startTime?: Date;
  version?: string;
}

export interface LangFuseGenerationData {
  id?: string;
  traceId: string;
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  startTime?: Date;
  endTime?: Date;
  model?: string;
  modelParameters?: Record<string, any>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  parentObservationId?: string;
  version?: string;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  lastCheck: Date;
  circuitBreakerState: string;
}

/**
 * Comprehensive LangFuse Client with Circuit Breaker Protection
 * Constitutional requirement for complete observability coverage
 */
export class LangFuseClient {
  private client: Langfuse | null = null;
  private circuitBreaker: CircuitBreaker;
  private healthStatus: HealthStatus;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5, // Allow more failures for external service
      recoveryTimeout: 30000, // Longer recovery time for LangFuse
    });

    this.healthStatus = {
      healthy: false,
      lastCheck: new Date(),
      circuitBreakerState: this.circuitBreaker.getState().state,
    };

    // Initialize client if configuration is available
    if (this.hasValidConfiguration()) {
      this.initializationPromise = this.initialize();
    }
  }

  /**
   * Check if LangFuse configuration is valid
   */
  private hasValidConfiguration(): boolean {
    return Boolean(
      env.LANGFUSE_PUBLIC_KEY &&
      env.LANGFUSE_SECRET_KEY &&
      env.LANGFUSE_BASE_URL
    );
  }

  /**
   * Initialize LangFuse client
   */
  private async initialize(): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.hasValidConfiguration()) {
          rootLogger.warn('LangFuse configuration incomplete - observability will be limited');
          return;
        }

        this.client = new Langfuse({
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_BASE_URL,
          flushAt: 10, // Flush traces in batches of 10
          flushInterval: 5000, // Flush every 5 seconds
        });

        this.initialized = true;
        rootLogger.info('LangFuse client initialized successfully', {
          baseUrl: env.LANGFUSE_BASE_URL,
          circuitBreakerState: this.circuitBreaker.getState().state,
        });

        // Perform health check after initialization is complete (non-blocking)
        setImmediate(async () => {
          try {
            await this.performHealthCheck();
          } catch (error) {
            rootLogger.warn('LangFuse post-initialization health check failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },
      {
        component: 'database',
        operation: 'initialize',
      },
      'high'
    ).catch((error) => {
      rootLogger.error('Failed to initialize LangFuse client', {
        error: error.message,
        hasConfig: this.hasValidConfiguration(),
      });
      this.initialized = false;
    });
  }

  /**
   * Ensure client is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    if (this.hasValidConfiguration()) {
      this.initializationPromise = this.initialize();
      await this.initializationPromise;
    }
  }

  /**
   * Create a new trace for tool calls, agent interactions, or workflow executions
   */
  async createTrace(data: LangFuseTraceData): Promise<string | null> {
    return await this.circuitBreaker.execute(
      async () => {
        await this.ensureInitialized();

        if (!this.client) {
          rootLogger.debug('LangFuse client not available - skipping trace creation');
          return null;
        }

        const trace = this.client.trace({
          id: data.id,
          name: data.name,
          userId: data.userId,
          metadata: {
            ...data.metadata,
            timestamp: new Date().toISOString(),
            source: 'mastra-bi-system',
            constitutional_compliance: true,
          },
          tags: data.tags || [],
          input: data.input,
          output: data.output,
          sessionId: data.sessionId,
          version: data.version || '1.0.0',
          release: data.release || env.NODE_ENV,
        });

        const traceId = trace.id;

        rootLogger.debug('LangFuse trace created', {
          traceId,
          name: data.name,
          userId: data.userId,
        });

        return traceId;
      },
      'create_trace'
    );
  }

  /**
   * Create a span within a trace for detailed operation tracking
   */
  async createSpan(data: LangFuseSpanData): Promise<string | null> {
    return await this.circuitBreaker.execute(
      async () => {
        await this.ensureInitialized();

        if (!this.client) {
          rootLogger.debug('LangFuse client not available - skipping span creation');
          return null;
        }

        const span = this.client.span({
          id: data.id,
          traceId: data.traceId,
          name: data.name,
          input: data.input,
          output: data.output,
          metadata: {
            ...data.metadata,
            timestamp: new Date().toISOString(),
            constitutional_compliance: true,
          },
          startTime: data.startTime,
          endTime: data.endTime,
          level: data.level || 'DEFAULT',
          statusMessage: data.statusMessage,
          parentObservationId: data.parentObservationId,
          version: data.version || '1.0.0',
        });

        const spanId = span.id;

        rootLogger.debug('LangFuse span created', {
          spanId,
          traceId: data.traceId,
          name: data.name,
        });

        return spanId;
      },
      'create_span'
    );
  }

  /**
   * Create an event for discrete occurrences
   */
  async createEvent(data: LangFuseEventData): Promise<string | null> {
    return await this.circuitBreaker.execute(
      async () => {
        await this.ensureInitialized();

        if (!this.client) {
          rootLogger.debug('LangFuse client not available - skipping event creation');
          return null;
        }

        const event = this.client.event({
          traceId: data.traceId,
          name: data.name,
          input: data.input,
          output: data.output,
          metadata: {
            ...data.metadata,
            timestamp: new Date().toISOString(),
            constitutional_compliance: true,
          },
          level: data.level || 'DEFAULT',
          statusMessage: data.statusMessage,
          parentObservationId: data.parentObservationId,
          startTime: data.startTime,
          version: data.version || '1.0.0',
        });

        const eventId = event.id;

        rootLogger.debug('LangFuse event created', {
          eventId,
          traceId: data.traceId,
          name: data.name,
        });

        return eventId;
      },
      'create_event'
    );
  }

  /**
   * Create a generation for LLM calls and AI model interactions
   */
  async createGeneration(data: LangFuseGenerationData): Promise<string | null> {
    return await this.circuitBreaker.execute(
      async () => {
        await this.ensureInitialized();

        if (!this.client) {
          rootLogger.debug('LangFuse client not available - skipping generation creation');
          return null;
        }

        const generation = this.client.generation({
          id: data.id,
          traceId: data.traceId,
          name: data.name,
          input: data.input,
          output: data.output,
          metadata: {
            ...data.metadata,
            timestamp: new Date().toISOString(),
            constitutional_compliance: true,
          },
          startTime: data.startTime,
          endTime: data.endTime,
          model: data.model,
          modelParameters: data.modelParameters,
          usage: data.usage,
          level: data.level || 'DEFAULT',
          statusMessage: data.statusMessage,
          parentObservationId: data.parentObservationId,
          version: data.version || '1.0.0',
        });

        const generationId = generation.id;

        rootLogger.debug('LangFuse generation created', {
          generationId,
          traceId: data.traceId,
          name: data.name,
          model: data.model,
        });

        return generationId;
      },
      'create_generation'
    );
  }

  /**
   * Update an existing observation with additional data
   */
  async updateObservation(
    observationId: string,
    updates: {
      output?: any;
      metadata?: Record<string, any>;
      endTime?: Date;
      level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
      statusMessage?: string;
    }
  ): Promise<boolean | null> {
    return await this.circuitBreaker.execute(
      async () => {
        await this.ensureInitialized();

        if (!this.client) {
          rootLogger.debug('LangFuse client not available - skipping observation update');
          return false;
        }

        // Note: LangFuse SDK may not have direct update methods
        // This is a placeholder for future SDK enhancement
        rootLogger.debug('LangFuse observation update requested', {
          observationId,
          updates: Object.keys(updates),
        });

        return true;
      },
      'update_observation'
    );
  }

  /**
   * Flush pending traces to LangFuse
   */
  async flush(): Promise<void | null> {
    return await this.circuitBreaker.execute(
      async () => {
        if (!this.client) {
          return;
        }

        await this.client.flushAsync();

        rootLogger.debug('LangFuse traces flushed');
      },
      'flush'
    );
  }

  /**
   * Perform health check on LangFuse connection
   */
  async performHealthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();

    try {
      if (!this.hasValidConfiguration()) {
        this.healthStatus = {
          healthy: false,
          error: 'LangFuse configuration incomplete',
          lastCheck: new Date(),
          circuitBreakerState: this.circuitBreaker.getState().state,
        };
        return this.healthStatus;
      }

      // Create a simple test trace to verify connectivity
      const testTrace = await this.createTrace({
        name: 'health_check',
        metadata: { test: true },
        tags: ['health-check'],
      });

      const latencyMs = Date.now() - startTime;

      this.healthStatus = {
        healthy: Boolean(testTrace),
        latencyMs,
        lastCheck: new Date(),
        circuitBreakerState: this.circuitBreaker.getState().state,
      };

      if (this.healthStatus.healthy) {
        rootLogger.debug('LangFuse health check passed', {
          latencyMs,
          circuitBreakerState: this.circuitBreaker.getState().state,
        });
      }
    } catch (error) {
      this.healthStatus = {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
        lastCheck: new Date(),
        circuitBreakerState: this.circuitBreaker.getState().state,
      };

      rootLogger.warn('LangFuse health check failed', {
        error: this.healthStatus.error,
        circuitBreakerState: this.circuitBreaker.getState().state,
      });
    }

    return this.healthStatus;
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState().state;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    rootLogger.info('LangFuse circuit breaker reset');
  }

  /**
   * Check if client is ready for operations
   */
  isReady(): boolean {
    return this.initialized && this.hasValidConfiguration();
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (this.client) {
          await this.flush();
          rootLogger.info('LangFuse client shutdown completed');
        }
      },
      {
        component: 'database',
        operation: 'shutdown',
      },
      'low'
    );
  }
}

// Global singleton instance
let langfuseClient: LangFuseClient;

export function getLangFuseClient(): LangFuseClient {
  if (!langfuseClient) {
    langfuseClient = new LangFuseClient();
  }
  return langfuseClient;
}

// Constitutional compliance exports
export default getLangFuseClient;
