/**
 * Base Agent with Comprehensive Interaction Logging
 * Constitutional requirement: Complete observability for all agent interactions with user attribution
 */

import { Agent } from '@mastra/core/agent';
import { getComprehensiveTracer, ComprehensiveExecutionContext } from '../observability/comprehensive-tracer.js';
import { getAgentInteractionTracer, AgentExecutionContext, AgentInteractionEvent, AgentInteractionType } from '../observability/agent-tracer.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { rootLogger } from '../observability/logger.js';
import {
  TraceContext,
  AgentInteractionMetadata,
  createTraceContext,
  createPerformanceMetrics,
} from '../types/observability.js';
import { randomUUID } from 'crypto';

/**
 * Enhanced agent execution context with user attribution
 */
export interface EnhancedAgentContext {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  workflowId?: string;
  requestId?: string;
  userProfile?: {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    preferences?: Record<string, any>;
  };
  conversationContext?: {
    previousMessages?: Array<{ role: string; content: string; timestamp: Date }>;
    currentTopic?: string;
    intent?: string;
    sentiment?: string;
  };
  businessContext?: {
    organizationId?: string;
    departmentId?: string;
    projectId?: string;
    accessLevel?: string;
  };
  technicalContext?: {
    platform?: string;
    clientVersion?: string;
    apiVersion?: string;
    features?: string[];
  };
  metadata?: Record<string, any>;
}

/**
 * Agent interaction logging configuration
 */
export interface AgentLoggingConfig {
  enabled: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  logErrors: boolean;
  logPerformance: boolean;
  logUserAttribution: boolean;
  logConversationContext: boolean;
  logBusinessContext: boolean;
  maxInputSize: number;
  maxOutputSize: number;
  sensitiveFields: string[];
  retentionDays: number;
}

/**
 * Default agent logging configuration
 */
const defaultAgentLoggingConfig: AgentLoggingConfig = {
  enabled: true,
  logInputs: true,
  logOutputs: true,
  logErrors: true,
  logPerformance: true,
  logUserAttribution: true,
  logConversationContext: true,
  logBusinessContext: true,
  maxInputSize: 20000, // 20KB
  maxOutputSize: 100000, // 100KB
  sensitiveFields: [
    'password', 'secret', 'token', 'key', 'credential', 'api_key',
    'auth', 'authorization', 'ssn', 'social_security', 'credit_card',
    'private_key', 'certificate', 'pin', 'account_number'
  ],
  retentionDays: 90,
};

/**
 * Base Agent Class with Comprehensive Interaction Logging
 * Constitutional requirement for complete agent observability
 */
export abstract class BaseAgent extends Agent {
  protected comprehensiveTracer = getComprehensiveTracer();
  protected agentTracer = getAgentInteractionTracer();
  protected loggingConfig: AgentLoggingConfig;
  protected agentId: string;
  protected agentName: string;
  protected agentVersion: string;

  constructor(
    agentName: string,
    agentVersion: string = '1.0.0',
    loggingConfig: Partial<AgentLoggingConfig> = {}
  ) {
    // Call parent Agent constructor with required config
    super({
      name: agentName,
      instructions: 'Base agent with comprehensive logging capabilities',
      model: {
        id: 'openai/gpt-4',
      },
    });
    this.agentId = randomUUID();
    this.agentName = agentName;
    this.agentVersion = agentVersion;
    this.loggingConfig = { ...defaultAgentLoggingConfig, ...loggingConfig };

    rootLogger.info('Base agent initialized with comprehensive logging', {
      agent_id: this.agentId,
      agent_name: this.agentName,
      agent_version: this.agentVersion,
      logging_enabled: this.loggingConfig.enabled,
    });
  }

  /**
   * Execute agent with comprehensive logging and user attribution
   */
  protected async executeWithLogging<TInput, TOutput>(
    input: TInput,
    context: EnhancedAgentContext,
    executor: () => Promise<TOutput>
  ): Promise<TOutput> {
    if (!this.loggingConfig.enabled) {
      return await executor();
    }

    const startTime = Date.now();
    const interactionId = randomUUID();
    let traceId: string | null = null;

    try {
      // Create comprehensive execution context
      const executionContext: ComprehensiveExecutionContext = {
        component: 'agent',
        operation: this.agentName,
        traceContext: createTraceContext({
          traceId: randomUUID(),
          userId: context.userId,
          sessionId: context.sessionId || context.conversationId,
          workflowId: context.workflowId,
          agentId: this.agentId,
          requestId: context.requestId,
          metadata: {
            interaction_id: interactionId,
            agent_name: this.agentName,
            agent_version: this.agentVersion,
            ...context.metadata,
          },
        }),
        startTime: new Date(),
        tags: ['agent-execution', this.agentName, 'user-attributed'],
        metadata: {
          user_attribution: this.createUserAttribution(context),
          conversation_context: this.loggingConfig.logConversationContext ? context.conversationContext : undefined,
          business_context: this.loggingConfig.logBusinessContext ? context.businessContext : undefined,
          technical_context: context.technicalContext,
        },
      };

      // Start agent interaction trace
      const agentExecutionContext: AgentExecutionContext = {
        agentId: this.agentId,
        agentName: this.agentName,
        userId: context.userId,
        sessionId: context.sessionId || context.conversationId,
        workflowId: context.workflowId,
        metadata: {
          interaction_id: interactionId,
          user_attribution: this.createUserAttribution(context),
          conversation_context: context.conversationContext,
          business_context: context.businessContext,
          technical_context: context.technicalContext,
        },
      };

      traceId = await this.agentTracer.startAgentTrace(agentExecutionContext, input);

      // Log interaction start event
      await this.logAgentInteractionEvent(traceId, agentExecutionContext, {
        type: 'execution' as AgentInteractionType,
        timestamp: new Date(),
        agentId: this.agentId,
        data: {
          input: this.loggingConfig.logInputs ? this.sanitizeData(input, 'input') : undefined,
          user_attribution: this.createUserAttribution(context),
          interaction_start: true,
        },
        metadata: {
          interaction_id: interactionId,
          execution_context: executionContext,
        },
      });

      // Execute the agent
      const result = await executor();

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Complete agent trace
      await this.agentTracer.completeAgentTrace(traceId, agentExecutionContext, {
        success: true,
        output: result,
        duration,
        metadata: {
          interaction_id: interactionId,
          user_attribution: this.createUserAttribution(context),
          performance_acceptable: duration < 30000, // 30 second threshold
        },
      });

      // Log interaction completion event
      await this.logAgentInteractionEvent(traceId, agentExecutionContext, {
        type: 'execution' as AgentInteractionType,
        timestamp: new Date(),
        agentId: this.agentId,
        data: {
          output: this.loggingConfig.logOutputs ? this.sanitizeData(result, 'output') : undefined,
          success: true,
          duration_ms: duration,
          performance_metrics: createPerformanceMetrics(duration),
          interaction_complete: true,
        },
        metadata: {
          interaction_id: interactionId,
          user_attribution: this.createUserAttribution(context),
        },
      });

      // Log performance metrics if enabled
      if (this.loggingConfig.logPerformance) {
        await this.logPerformanceMetrics(traceId, agentExecutionContext, {
          duration,
          success: true,
          input_size: JSON.stringify(input).length,
          output_size: JSON.stringify(result).length,
        });
      }

      rootLogger.info('Agent execution completed successfully with full attribution', {
        agent_id: this.agentId,
        agent_name: this.agentName,
        interaction_id: interactionId,
        trace_id: traceId,
        user_id: context.userId,
        duration_ms: duration,
      });

      return result;

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Complete agent trace with error
      if (traceId) {
        await this.agentTracer.completeAgentTrace(traceId, {
          agentId: this.agentId,
          agentName: this.agentName,
          userId: context.userId,
          sessionId: context.sessionId || context.conversationId,
          workflowId: context.workflowId,
          metadata: {
            interaction_id: interactionId,
            user_attribution: this.createUserAttribution(context),
          },
        }, {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          duration,
          metadata: {
            interaction_id: interactionId,
            user_attribution: this.createUserAttribution(context),
            error_handled: true,
          },
        });

        // Log error event
        await this.logAgentInteractionEvent(traceId, {
          agentId: this.agentId,
          agentName: this.agentName,
          userId: context.userId,
          sessionId: context.sessionId || context.conversationId,
          workflowId: context.workflowId,
          metadata: {
            interaction_id: interactionId,
            user_attribution: this.createUserAttribution(context),
          },
        }, {
          type: 'error_handling' as AgentInteractionType,
          timestamp: new Date(),
          agentId: this.agentId,
          data: {
            error: {
              type: error instanceof Error ? error.name : 'UnknownError',
              message: errorMessage,
              stack: error instanceof Error ? error.stack : undefined,
            },
            duration_ms: duration,
            interaction_failed: true,
          },
          metadata: {
            interaction_id: interactionId,
            user_attribution: this.createUserAttribution(context),
            recoverable: this.isRecoverableError(error),
          },
        });
      }

      rootLogger.error('Agent execution failed with full error context', {
        agent_id: this.agentId,
        agent_name: this.agentName,
        interaction_id: interactionId,
        trace_id: traceId,
        user_id: context.userId,
        error: errorMessage,
        duration_ms: duration,
      });

      throw error;
    }
  }

  /**
   * Log agent interaction event with comprehensive context
   */
  protected async logAgentInteractionEvent(
    traceId: string | null,
    context: AgentExecutionContext,
    event: AgentInteractionEvent
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.loggingConfig.enabled || !traceId) {
          return;
        }

        await this.agentTracer.logAgentInteraction(traceId, context, {
          ...event,
          metadata: {
            ...event.metadata,
            agent_id: this.agentId,
            agent_name: this.agentName,
            agent_version: this.agentVersion,
            constitutional_compliance: true,
            comprehensive_logging: true,
          },
        });
      },
      {
        component: 'agent',
        operation: 'log_interaction_event',
        metadata: {
          agent_id: this.agentId,
          event_type: event.type,
        },
      },
      'low'
    );
  }

  /**
   * Log performance metrics
   */
  protected async logPerformanceMetrics(
    traceId: string | null,
    context: AgentExecutionContext,
    metrics: {
      duration: number;
      success: boolean;
      input_size: number;
      output_size: number;
      memory_usage?: number;
      cpu_usage?: number;
    }
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.loggingConfig.enabled || !this.loggingConfig.logPerformance || !traceId) {
          return;
        }

        await this.logAgentInteractionEvent(traceId, context, {
          type: 'execution' as AgentInteractionType,
          timestamp: new Date(),
          agentId: this.agentId,
          data: {
            performance_metrics: {
              execution_time_ms: metrics.duration,
              success_rate: metrics.success ? 1 : 0,
              input_size_bytes: metrics.input_size,
              output_size_bytes: metrics.output_size,
              memory_usage_mb: metrics.memory_usage,
              cpu_usage_percent: metrics.cpu_usage,
              throughput_per_second: metrics.duration > 0 ? 1000 / metrics.duration : 0,
            },
            performance_analysis: {
              response_time_category: this.categorizeResponseTime(metrics.duration),
              size_efficiency: this.analyzeSizeEfficiency(metrics.input_size, metrics.output_size),
              overall_performance_score: this.calculatePerformanceScore(metrics),
            },
          },
          metadata: {
            performance_logging: true,
            constitutional_compliance: true,
          },
        });
      },
      {
        component: 'agent',
        operation: 'log_performance_metrics',
        metadata: {
          agent_id: this.agentId,
          duration: metrics.duration,
        },
      },
      'low'
    );
  }

  /**
   * Create user attribution metadata
   */
  protected createUserAttribution(context: EnhancedAgentContext): Record<string, any> {
    if (!this.loggingConfig.logUserAttribution) {
      return { user_attribution_disabled: true };
    }

    return {
      user_id: context.userId,
      session_id: context.sessionId,
      conversation_id: context.conversationId,
      request_id: context.requestId,
      user_profile: context.userProfile ? {
        id: context.userProfile.id,
        name: context.userProfile.name,
        role: context.userProfile.role,
        // Don't log email or sensitive user data by default
      } : undefined,
      business_context: this.loggingConfig.logBusinessContext ? {
        organization_id: context.businessContext?.organizationId,
        department_id: context.businessContext?.departmentId,
        project_id: context.businessContext?.projectId,
        access_level: context.businessContext?.accessLevel,
      } : undefined,
      technical_context: {
        platform: context.technicalContext?.platform,
        client_version: context.technicalContext?.clientVersion,
        api_version: context.technicalContext?.apiVersion,
        features: context.technicalContext?.features,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Sanitize data for logging
   */
  protected sanitizeData(data: any, type: 'input' | 'output'): any {
    if (data === null || data === undefined) {
      return data;
    }

    const maxSize = type === 'input' ? this.loggingConfig.maxInputSize : this.loggingConfig.maxOutputSize;
    const shouldLog = type === 'input' ? this.loggingConfig.logInputs : this.loggingConfig.logOutputs;

    if (!shouldLog) {
      return { _logged: false, _reason: `${type}_logging_disabled` };
    }

    try {
      const dataStr = JSON.stringify(data);

      if (dataStr.length > maxSize) {
        return {
          _truncated: true,
          _original_size: dataStr.length,
          _max_size: maxSize,
          _type: type,
          data: dataStr.substring(0, maxSize) + '...[truncated]',
        };
      }

      // Remove sensitive fields
      if (typeof data === 'object' && data !== null) {
        return this.removeSensitiveFields(data);
      }

      return data;
    } catch (error) {
      return {
        _error: 'serialization_failed',
        _reason: error instanceof Error ? error.message : String(error),
        _type: type,
      };
    }
  }

  /**
   * Remove sensitive fields from data
   */
  protected removeSensitiveFields(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeSensitiveFields(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      const isSensitive = this.loggingConfig.sensitiveFields.some(field =>
        keyLower.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.removeSensitiveFields(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Determine if an error is recoverable
   */
  protected isRecoverableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors are usually recoverable
      if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
        return true;
      }

      // Validation errors are usually not recoverable
      if (error.name === 'ValidationError' || error.name === 'TypeError') {
        return false;
      }

      // Rate limiting is recoverable
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        return true;
      }
    }

    return true; // Default to recoverable for agent errors
  }

  /**
   * Categorize response time performance
   */
  protected categorizeResponseTime(duration: number): string {
    if (duration < 1000) return 'excellent';
    if (duration < 3000) return 'good';
    if (duration < 10000) return 'acceptable';
    if (duration < 30000) return 'slow';
    return 'very_slow';
  }

  /**
   * Analyze size efficiency
   */
  protected analyzeSizeEfficiency(inputSize: number, outputSize: number): string {
    const ratio = outputSize / (inputSize || 1);
    if (ratio < 0.5) return 'highly_efficient';
    if (ratio < 1.5) return 'efficient';
    if (ratio < 3) return 'moderate';
    if (ratio < 10) return 'verbose';
    return 'very_verbose';
  }

  /**
   * Calculate overall performance score
   */
  protected calculatePerformanceScore(metrics: {
    duration: number;
    success: boolean;
    input_size: number;
    output_size: number;
  }): number {
    let score = 100;

    // Deduct for slow response times
    if (metrics.duration > 30000) score -= 50;
    else if (metrics.duration > 10000) score -= 30;
    else if (metrics.duration > 3000) score -= 15;
    else if (metrics.duration > 1000) score -= 5;

    // Deduct for failure
    if (!metrics.success) score -= 40;

    // Deduct for inefficient size ratios
    const sizeRatio = metrics.output_size / (metrics.input_size || 1);
    if (sizeRatio > 10) score -= 20;
    else if (sizeRatio > 5) score -= 10;
    else if (sizeRatio > 3) score -= 5;

    return Math.max(0, score);
  }

  /**
   * Update logging configuration
   */
  updateLoggingConfig(newConfig: Partial<AgentLoggingConfig>): void {
    this.loggingConfig = { ...this.loggingConfig, ...newConfig };
    rootLogger.info('Agent logging configuration updated', {
      agent_id: this.agentId,
      agent_name: this.agentName,
      new_config: this.loggingConfig,
    });
  }

  /**
   * Get current logging configuration
   */
  getLoggingConfig(): AgentLoggingConfig {
    return { ...this.loggingConfig };
  }

  /**
   * Get agent metadata
   */
  getAgentMetadata(): {
    agent_id: string;
    agent_name: string;
    agent_version: string;
    logging_enabled: boolean;
    constitutional_compliance: boolean;
  } {
    return {
      agent_id: this.agentId,
      agent_name: this.agentName,
      agent_version: this.agentVersion,
      logging_enabled: this.loggingConfig.enabled,
      constitutional_compliance: true,
    };
  }

  /**
   * Abstract method that concrete agents must implement
   * This satisfies the Mastra Agent interface requirement
   */
  abstract execute(input: any, context?: EnhancedAgentContext): Promise<any>;

  /**
   * Execute agent with enhanced context and comprehensive logging
   */
  async executeWithContext(input: any, context: EnhancedAgentContext): Promise<any> {
    return await this.executeWithLogging(input, context, () => this.execute(input, context));
  }
}

// Constitutional compliance exports
export default BaseAgent;
