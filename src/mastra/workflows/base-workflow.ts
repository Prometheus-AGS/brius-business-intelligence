/**
 * Base Workflow with Performance Tracking and Checkpoints
 * Constitutional requirement: Complete observability for all workflow executions with step-by-step tracking
 */

import { createWorkflow, WorkflowDefinition } from '@mastra/core/workflows';
import { getComprehensiveTracer, ComprehensiveExecutionContext } from '../observability/comprehensive-tracer.js';
import { getWorkflowExecutionTracer, WorkflowExecutionContext, WorkflowStepContext } from '../observability/workflow-tracer.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { rootLogger } from '../observability/logger.js';
import {
  TraceContext,
  WorkflowExecutionMetadata,
  WorkflowStepMetadata,
  PerformanceMetrics,
  createTraceContext,
  createPerformanceMetrics,
} from '../types/observability.js';
import { randomUUID } from 'crypto';

/**
 * Workflow checkpoint data
 */
export interface WorkflowCheckpoint {
  checkpointId: string;
  stepId: string;
  stepName: string;
  stepIndex: number;
  timestamp: Date;
  state: any;
  metadata: Record<string, any>;
  performance: PerformanceMetrics;
}

/**
 * Workflow execution statistics
 */
export interface WorkflowExecutionStats {
  totalSteps: number;
  completedSteps: number;
  skippedSteps: number;
  failedSteps: number;
  parallelSteps: number;
  conditionalBranches: string[];
  totalDuration: number;
  avgStepDuration: number;
  checkpoints: WorkflowCheckpoint[];
  performanceScore: number;
}

/**
 * Enhanced workflow context with comprehensive tracking
 */
export interface EnhancedWorkflowContext {
  userId?: string;
  sessionId?: string;
  workflowId?: string;
  executionId?: string;
  parentWorkflowId?: string;
  organizationId?: string;
  projectId?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  tags?: string[];
  userProfile?: {
    id: string;
    name?: string;
    role?: string;
    permissions?: string[];
  };
  businessContext?: {
    department?: string;
    purpose?: string;
    expectedOutcome?: string;
    deadline?: Date;
  };
  technicalContext?: {
    environment?: 'development' | 'staging' | 'production';
    version?: string;
    features?: string[];
    constraints?: Record<string, any>;
  };
  metadata?: Record<string, any>;
}

/**
 * Workflow performance tracking configuration
 */
export interface WorkflowTrackingConfig {
  enabled: boolean;
  trackSteps: boolean;
  trackCheckpoints: boolean;
  trackPerformance: boolean;
  trackConditionals: boolean;
  trackParallelExecution: boolean;
  captureStepIO: boolean;
  maxStepInputSize: number;
  maxStepOutputSize: number;
  checkpointInterval: number; // Steps between automatic checkpoints
  performanceThresholds: {
    stepWarningMs: number;
    stepErrorMs: number;
    workflowWarningMs: number;
    workflowErrorMs: number;
  };
  retentionDays: number;
}

/**
 * Default workflow tracking configuration
 */
const defaultWorkflowTrackingConfig: WorkflowTrackingConfig = {
  enabled: true,
  trackSteps: true,
  trackCheckpoints: true,
  trackPerformance: true,
  trackConditionals: true,
  trackParallelExecution: true,
  captureStepIO: true,
  maxStepInputSize: 30000, // 30KB
  maxStepOutputSize: 150000, // 150KB
  checkpointInterval: 5, // Checkpoint every 5 steps
  performanceThresholds: {
    stepWarningMs: 5000, // 5 seconds
    stepErrorMs: 30000, // 30 seconds
    workflowWarningMs: 60000, // 1 minute
    workflowErrorMs: 300000, // 5 minutes
  },
  retentionDays: 30,
};

/**
 * Base Workflow Class with Comprehensive Performance Tracking
 * Constitutional requirement for complete workflow observability
 */
export abstract class BaseWorkflow<TInput = any, TOutput = any> {
  protected comprehensiveTracer = getComprehensiveTracer();
  protected workflowTracer = getWorkflowExecutionTracer();
  protected trackingConfig: WorkflowTrackingConfig;
  protected workflowId: string;
  protected workflowName: string;
  protected workflowVersion: string;
  protected checkpoints: Map<string, WorkflowCheckpoint> = new Map();
  protected executionStats: WorkflowExecutionStats;

  constructor(
    workflowName: string,
    workflowVersion: string = '1.0.0',
    trackingConfig: Partial<WorkflowTrackingConfig> = {}
  ) {
    this.workflowId = randomUUID();
    this.workflowName = workflowName;
    this.workflowVersion = workflowVersion;
    this.trackingConfig = { ...defaultWorkflowTrackingConfig, ...trackingConfig };

    this.initializeExecutionStats();

    rootLogger.info('Base workflow initialized with comprehensive tracking', {
      workflow_id: this.workflowId,
      workflow_name: this.workflowName,
      workflow_version: this.workflowVersion,
      tracking_enabled: this.trackingConfig.enabled,
    });
  }

  /**
   * Initialize execution statistics
   */
  protected initializeExecutionStats(): void {
    this.executionStats = {
      totalSteps: 0,
      completedSteps: 0,
      skippedSteps: 0,
      failedSteps: 0,
      parallelSteps: 0,
      conditionalBranches: [],
      totalDuration: 0,
      avgStepDuration: 0,
      checkpoints: [],
      performanceScore: 100,
    };
  }

  /**
   * Execute workflow with comprehensive tracking
   */
  protected async executeWithTracking(
    input: TInput,
    context: EnhancedWorkflowContext,
    executor: () => Promise<TOutput>
  ): Promise<TOutput> {
    if (!this.trackingConfig.enabled) {
      return await executor();
    }

    const startTime = Date.now();
    const executionId = randomUUID();
    let traceId: string | null = null;

    try {
      // Initialize execution tracking
      this.initializeExecutionStats();

      // Create comprehensive execution context
      const executionContext: ComprehensiveExecutionContext = {
        component: 'workflow',
        operation: this.workflowName,
        traceContext: createTraceContext({
          traceId: randomUUID(),
          userId: context.userId,
          sessionId: context.sessionId,
          workflowId: this.workflowId,
          requestId: executionId,
          metadata: {
            execution_id: executionId,
            workflow_name: this.workflowName,
            workflow_version: this.workflowVersion,
            ...context.metadata,
          },
        }),
        startTime: new Date(),
        tags: ['workflow-execution', this.workflowName, 'performance-tracked'],
        metadata: {
          user_context: this.createUserContext(context),
          business_context: context.businessContext,
          technical_context: context.technicalContext,
          tracking_config: this.trackingConfig,
        },
      };

      // Start workflow execution trace
      const workflowExecutionContext: WorkflowExecutionContext = {
        workflowId: this.workflowId,
        workflowName: this.workflowName,
        workflowVersion: this.workflowVersion,
        executionId,
        userId: context.userId,
        sessionId: context.sessionId,
        metadata: {
          user_context: this.createUserContext(context),
          business_context: context.businessContext,
          technical_context: context.technicalContext,
          priority: context.priority,
          tags: context.tags,
        },
      };

      traceId = await this.workflowTracer.startWorkflowTrace(workflowExecutionContext, input);

      // Create initial checkpoint
      await this.createCheckpoint('workflow_start', {
        stepId: 'init',
        stepName: 'workflow_initialization',
        stepIndex: 0,
        totalSteps: this.executionStats.totalSteps,
        stepType: 'sequential',
      }, {
        workflow_started: true,
        input_received: true,
        tracking_initialized: true,
      });

      // Execute the workflow
      const result = await executor();

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Update execution statistics
      this.executionStats.totalDuration = duration;
      this.executionStats.avgStepDuration = this.executionStats.completedSteps > 0
        ? duration / this.executionStats.completedSteps
        : 0;
      this.executionStats.performanceScore = this.calculatePerformanceScore();

      // Create final checkpoint
      await this.createCheckpoint('workflow_complete', {
        stepId: 'complete',
        stepName: 'workflow_completion',
        stepIndex: this.executionStats.totalSteps + 1,
        totalSteps: this.executionStats.totalSteps,
        stepType: 'sequential',
      }, {
        workflow_completed: true,
        execution_stats: this.executionStats,
        performance_analysis: this.analyzePerformance(),
      });

      // Complete workflow trace
      await this.workflowTracer.completeWorkflowTrace(traceId, workflowExecutionContext, {
        success: true,
        output: result,
        duration,
        stepsExecuted: this.executionStats.completedSteps,
        stepsSkipped: this.executionStats.skippedSteps,
        stepsFailed: this.executionStats.failedSteps,
        parallelExecutions: this.executionStats.parallelSteps,
        conditionalBranches: this.executionStats.conditionalBranches,
        metadata: {
          execution_id: executionId,
          performance_score: this.executionStats.performanceScore,
          checkpoints_created: this.checkpoints.size,
          execution_stats: this.executionStats,
        },
      });

      // Log performance analysis if enabled
      if (this.trackingConfig.trackPerformance) {
        await this.logPerformanceAnalysis(traceId, workflowExecutionContext, duration);
      }

      rootLogger.info('Workflow execution completed with comprehensive tracking', {
        workflow_id: this.workflowId,
        workflow_name: this.workflowName,
        execution_id: executionId,
        trace_id: traceId,
        user_id: context.userId,
        duration_ms: duration,
        performance_score: this.executionStats.performanceScore,
        checkpoints: this.checkpoints.size,
      });

      return result;

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update failure statistics
      this.executionStats.failedSteps++;
      this.executionStats.totalDuration = duration;
      this.executionStats.performanceScore = 0; // Failed execution gets 0 score

      // Create error checkpoint
      await this.createCheckpoint('workflow_error', {
        stepId: 'error',
        stepName: 'workflow_error',
        stepIndex: this.executionStats.totalSteps + 1,
        totalSteps: this.executionStats.totalSteps,
        stepType: 'sequential',
      }, {
        workflow_failed: true,
        error: {
          type: error instanceof Error ? error.name : 'UnknownError',
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
        execution_stats: this.executionStats,
      });

      // Complete workflow trace with error
      if (traceId) {
        await this.workflowTracer.completeWorkflowTrace(traceId, {
          workflowId: this.workflowId,
          workflowName: this.workflowName,
          workflowVersion: this.workflowVersion,
          executionId,
          userId: context.userId,
          sessionId: context.sessionId,
          metadata: {
            execution_id: executionId,
            error_handled: true,
          },
        }, {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          duration,
          stepsExecuted: this.executionStats.completedSteps,
          stepsSkipped: this.executionStats.skippedSteps,
          stepsFailed: this.executionStats.failedSteps,
          metadata: {
            execution_id: executionId,
            performance_score: 0,
            checkpoints_created: this.checkpoints.size,
            execution_stats: this.executionStats,
          },
        });
      }

      rootLogger.error('Workflow execution failed with full error context', {
        workflow_id: this.workflowId,
        workflow_name: this.workflowName,
        execution_id: executionId,
        trace_id: traceId,
        user_id: context.userId,
        error: errorMessage,
        duration_ms: duration,
        checkpoints: this.checkpoints.size,
      });

      throw error;
    }
  }

  /**
   * Track step execution with performance monitoring
   */
  protected async trackStepExecution<TStepInput, TStepOutput>(
    stepContext: WorkflowStepContext,
    traceId: string | null,
    workflowContext: WorkflowExecutionContext,
    input: TStepInput,
    executor: () => Promise<TStepOutput>
  ): Promise<TStepOutput> {
    if (!this.trackingConfig.enabled || !this.trackingConfig.trackSteps) {
      return await executor();
    }

    const startTime = Date.now();
    let spanId: string | null = null;

    try {
      // Update step statistics
      this.executionStats.totalSteps = Math.max(this.executionStats.totalSteps, stepContext.totalSteps);

      // Start step span
      if (traceId) {
        spanId = await this.workflowTracer.startWorkflowStep(
          traceId,
          workflowContext,
          stepContext,
          this.trackingConfig.captureStepIO ? this.sanitizeStepData(input, 'input') : undefined
        );
      }

      // Create automatic checkpoint if interval reached
      if (this.shouldCreateAutomaticCheckpoint(stepContext.stepIndex)) {
        await this.createCheckpoint(`auto_checkpoint_${stepContext.stepIndex}`, stepContext, {
          automatic_checkpoint: true,
          step_about_to_execute: stepContext.stepName,
          input_preview: this.trackingConfig.captureStepIO ? this.sanitizeStepData(input, 'input') : undefined,
        });
      }

      // Execute the step
      const result = await executor();

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Update completion statistics
      this.executionStats.completedSteps++;

      // Check performance thresholds
      const performanceIssue = this.checkStepPerformanceThresholds(duration);
      if (performanceIssue) {
        await this.logPerformanceIssue(traceId, stepContext, duration, performanceIssue);
      }

      // Complete step span
      if (spanId) {
        await this.workflowTracer.completeWorkflowStep(spanId, stepContext, {
          success: true,
          output: this.trackingConfig.captureStepIO ? this.sanitizeStepData(result, 'output') : undefined,
          duration,
          metadata: {
            performance_category: this.categorizeStepPerformance(duration),
            performance_issue: performanceIssue,
            checkpoint_created: this.shouldCreateAutomaticCheckpoint(stepContext.stepIndex),
          },
        });
      }

      rootLogger.debug('Step execution tracked successfully', {
        workflow_id: this.workflowId,
        step_name: stepContext.stepName,
        step_index: stepContext.stepIndex,
        duration_ms: duration,
        performance_issue: performanceIssue,
      });

      return result;

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Update failure statistics
      this.executionStats.failedSteps++;

      // Complete step span with error
      if (spanId) {
        await this.workflowTracer.completeWorkflowStep(spanId, stepContext, {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          duration,
          metadata: {
            step_failed: true,
            error_type: error instanceof Error ? error.name : 'UnknownError',
          },
        });
      }

      // Create error checkpoint
      await this.createCheckpoint(`step_error_${stepContext.stepIndex}`, stepContext, {
        step_failed: true,
        error: {
          type: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        duration_ms: duration,
      });

      throw error;
    }
  }

  /**
   * Create a workflow checkpoint
   */
  protected async createCheckpoint(
    checkpointId: string,
    stepContext: WorkflowStepContext,
    state: any
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.trackingConfig.enabled || !this.trackingConfig.trackCheckpoints) {
          return;
        }

        const checkpoint: WorkflowCheckpoint = {
          checkpointId,
          stepId: stepContext.stepId,
          stepName: stepContext.stepName,
          stepIndex: stepContext.stepIndex,
          timestamp: new Date(),
          state: this.sanitizeCheckpointState(state),
          metadata: {
            workflow_id: this.workflowId,
            workflow_name: this.workflowName,
            step_type: stepContext.stepType,
            execution_stats: { ...this.executionStats },
            constitutional_compliance: true,
          },
          performance: createPerformanceMetrics(
            Date.now() - (this.checkpoints.size > 0
              ? Array.from(this.checkpoints.values())[this.checkpoints.size - 1].timestamp.getTime()
              : Date.now())
          ),
        };

        this.checkpoints.set(checkpointId, checkpoint);
        this.executionStats.checkpoints.push(checkpoint);

        rootLogger.debug('Workflow checkpoint created', {
          workflow_id: this.workflowId,
          checkpoint_id: checkpointId,
          step_name: stepContext.stepName,
          step_index: stepContext.stepIndex,
          total_checkpoints: this.checkpoints.size,
        });
      },
      {
        component: 'base_workflow',
        operation: 'create_checkpoint',
        metadata: {
          workflow_id: this.workflowId,
          checkpoint_id: checkpointId,
        },
      },
      'low'
    );
  }

  /**
   * Check if an automatic checkpoint should be created
   */
  protected shouldCreateAutomaticCheckpoint(stepIndex: number): boolean {
    return this.trackingConfig.checkpointInterval > 0 &&
           stepIndex % this.trackingConfig.checkpointInterval === 0;
  }

  /**
   * Check step performance thresholds
   */
  protected checkStepPerformanceThresholds(duration: number): string | null {
    if (duration > this.trackingConfig.performanceThresholds.stepErrorMs) {
      return 'error';
    } else if (duration > this.trackingConfig.performanceThresholds.stepWarningMs) {
      return 'warning';
    }
    return null;
  }

  /**
   * Categorize step performance
   */
  protected categorizeStepPerformance(duration: number): string {
    if (duration < 1000) return 'excellent';
    if (duration < 3000) return 'good';
    if (duration < 5000) return 'acceptable';
    if (duration < 10000) return 'slow';
    return 'very_slow';
  }

  /**
   * Calculate overall performance score
   */
  protected calculatePerformanceScore(): number {
    let score = 100;

    // Deduct for failed steps
    const failureRate = this.executionStats.totalSteps > 0
      ? this.executionStats.failedSteps / this.executionStats.totalSteps
      : 0;
    score -= failureRate * 50;

    // Deduct for slow execution
    if (this.executionStats.totalDuration > this.trackingConfig.performanceThresholds.workflowErrorMs) {
      score -= 30;
    } else if (this.executionStats.totalDuration > this.trackingConfig.performanceThresholds.workflowWarningMs) {
      score -= 15;
    }

    // Deduct for slow average step time
    if (this.executionStats.avgStepDuration > this.trackingConfig.performanceThresholds.stepErrorMs) {
      score -= 20;
    } else if (this.executionStats.avgStepDuration > this.trackingConfig.performanceThresholds.stepWarningMs) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  /**
   * Analyze workflow performance
   */
  protected analyzePerformance(): Record<string, any> {
    return {
      overall_score: this.executionStats.performanceScore,
      execution_time_category: this.categorizeExecutionTime(this.executionStats.totalDuration),
      step_efficiency: this.analyzeStepEfficiency(),
      checkpoint_frequency: this.checkpoints.size / Math.max(1, this.executionStats.totalSteps),
      success_rate: this.executionStats.totalSteps > 0
        ? (this.executionStats.completedSteps / this.executionStats.totalSteps) * 100
        : 0,
      recommendations: this.generatePerformanceRecommendations(),
    };
  }

  /**
   * Categorize overall execution time
   */
  protected categorizeExecutionTime(duration: number): string {
    if (duration < 10000) return 'fast';
    if (duration < 60000) return 'moderate';
    if (duration < 300000) return 'slow';
    return 'very_slow';
  }

  /**
   * Analyze step execution efficiency
   */
  protected analyzeStepEfficiency(): Record<string, any> {
    return {
      total_steps: this.executionStats.totalSteps,
      completed_steps: this.executionStats.completedSteps,
      failed_steps: this.executionStats.failedSteps,
      skipped_steps: this.executionStats.skippedSteps,
      average_step_duration: this.executionStats.avgStepDuration,
      step_success_rate: this.executionStats.totalSteps > 0
        ? (this.executionStats.completedSteps / this.executionStats.totalSteps) * 100
        : 0,
    };
  }

  /**
   * Generate performance recommendations
   */
  protected generatePerformanceRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.executionStats.failedSteps > 0) {
      recommendations.push('Investigate step failures and add error handling');
    }

    if (this.executionStats.avgStepDuration > this.trackingConfig.performanceThresholds.stepWarningMs) {
      recommendations.push('Optimize slow-running steps');
    }

    if (this.executionStats.totalDuration > this.trackingConfig.performanceThresholds.workflowWarningMs) {
      recommendations.push('Consider parallel execution for independent steps');
    }

    if (this.checkpoints.size / Math.max(1, this.executionStats.totalSteps) < 0.1) {
      recommendations.push('Add more checkpoints for better recovery');
    }

    if (recommendations.length === 0) {
      recommendations.push('Workflow performance is optimal');
    }

    return recommendations;
  }

  /**
   * Log performance analysis
   */
  protected async logPerformanceAnalysis(
    traceId: string | null,
    context: WorkflowExecutionContext,
    duration: number
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!traceId) return;

        const analysis = this.analyzePerformance();

        await this.workflowTracer.traceConditional(traceId, context, {
          conditionName: 'performance_analysis',
          condition: 'workflow_completed',
          result: true,
          branchTaken: 'performance_logged',
          availableBranches: ['performance_logged', 'performance_skipped'],
          evaluationTime: 0,
        });

        rootLogger.info('Workflow performance analysis logged', {
          workflow_id: this.workflowId,
          trace_id: traceId,
          performance_score: analysis.overall_score,
          execution_time_category: analysis.execution_time_category,
          recommendations: analysis.recommendations,
        });
      },
      {
        component: 'base_workflow',
        operation: 'log_performance_analysis',
        metadata: {
          workflow_id: this.workflowId,
          trace_id: traceId,
        },
      },
      'low'
    );
  }

  /**
   * Log performance issue
   */
  protected async logPerformanceIssue(
    traceId: string | null,
    stepContext: WorkflowStepContext,
    duration: number,
    issueLevel: string
  ): Promise<void> {
    rootLogger.warn('Step performance issue detected', {
      workflow_id: this.workflowId,
      step_name: stepContext.stepName,
      step_index: stepContext.stepIndex,
      duration_ms: duration,
      issue_level: issueLevel,
      threshold_warning: this.trackingConfig.performanceThresholds.stepWarningMs,
      threshold_error: this.trackingConfig.performanceThresholds.stepErrorMs,
    });
  }

  /**
   * Create user context for tracking
   */
  protected createUserContext(context: EnhancedWorkflowContext): Record<string, any> {
    return {
      user_id: context.userId,
      session_id: context.sessionId,
      organization_id: context.organizationId,
      project_id: context.projectId,
      user_profile: context.userProfile ? {
        id: context.userProfile.id,
        name: context.userProfile.name,
        role: context.userProfile.role,
        // Don't log sensitive user data
      } : undefined,
      priority: context.priority,
      tags: context.tags,
    };
  }

  /**
   * Sanitize step data for tracking
   */
  protected sanitizeStepData(data: any, type: 'input' | 'output'): any {
    if (data === null || data === undefined) {
      return data;
    }

    const maxSize = type === 'input'
      ? this.trackingConfig.maxStepInputSize
      : this.trackingConfig.maxStepOutputSize;

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
      return data;
    } catch (error) {
      return {
        _error: 'serialization_failed',
        _type: type,
        _reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sanitize checkpoint state
   */
  protected sanitizeCheckpointState(state: any): any {
    try {
      const stateStr = JSON.stringify(state);
      if (stateStr.length > 50000) { // 50KB limit for checkpoints
        return {
          _truncated: true,
          _original_size: stateStr.length,
          _max_size: 50000,
          summary: typeof state === 'object' && state !== null
            ? `Object with ${Object.keys(state).length} keys`
            : `${typeof state} value`,
        };
      }
      return state;
    } catch (error) {
      return {
        _error: 'checkpoint_serialization_failed',
        _reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get current execution statistics
   */
  getExecutionStats(): WorkflowExecutionStats {
    return { ...this.executionStats };
  }

  /**
   * Get all checkpoints
   */
  getCheckpoints(): WorkflowCheckpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Update tracking configuration
   */
  updateTrackingConfig(newConfig: Partial<WorkflowTrackingConfig>): void {
    this.trackingConfig = { ...this.trackingConfig, ...newConfig };
    rootLogger.info('Workflow tracking configuration updated', {
      workflow_id: this.workflowId,
      workflow_name: this.workflowName,
      new_config: this.trackingConfig,
    });
  }

  /**
   * Get current tracking configuration
   */
  getTrackingConfig(): WorkflowTrackingConfig {
    return { ...this.trackingConfig };
  }

  /**
   * Get workflow metadata
   */
  getWorkflowMetadata(): {
    workflow_id: string;
    workflow_name: string;
    workflow_version: string;
    tracking_enabled: boolean;
    constitutional_compliance: boolean;
  } {
    return {
      workflow_id: this.workflowId,
      workflow_name: this.workflowName,
      workflow_version: this.workflowVersion,
      tracking_enabled: this.trackingConfig.enabled,
      constitutional_compliance: true,
    };
  }

  /**
   * Abstract method that concrete workflows must implement
   */
  abstract execute(input: TInput, context: EnhancedWorkflowContext): Promise<TOutput>;
}

// Constitutional compliance exports
export { BaseWorkflow };
export default BaseWorkflow;