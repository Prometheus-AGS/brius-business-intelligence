/**
 * Enhanced Workflow Execution Tracing Service
 * Constitutional requirement: Comprehensive workflow execution tracing with step-by-step observability
 */

import { getLangFuseClient, LangFuseTraceData, LangFuseSpanData } from './langfuse-client.js';
import { withErrorHandling } from './error-handling.js';
import { rootLogger } from './logger.js';
import { randomUUID } from 'crypto';

// Workflow execution context
export interface WorkflowExecutionContext {
  workflowId: string;
  workflowName: string;
  workflowVersion?: string;
  userId?: string;
  sessionId?: string;
  parentTraceId?: string;
  parentSpanId?: string;
  executionId?: string;
  metadata?: Record<string, any>;
}

// Workflow step types
export type WorkflowStepType =
  | 'tool_execution'
  | 'agent_execution'
  | 'conditional'
  | 'parallel'
  | 'sequential'
  | 'loop'
  | 'human_input'
  | 'human_approval'
  | 'data_transformation'
  | 'external_api'
  | 'decision_point';

// Workflow step context
export interface WorkflowStepContext {
  stepId: string;
  stepName: string;
  stepType: WorkflowStepType;
  stepIndex: number;
  totalSteps: number;
  parentStepId?: string;
  isParallel?: boolean;
  conditionalBranch?: string;
  loopIteration?: number;
  metadata?: Record<string, any>;
}

// Workflow execution result
export interface WorkflowExecutionResult {
  success: boolean;
  output?: any;
  error?: Error;
  duration: number;
  stepsExecuted: number;
  stepsSkipped: number;
  stepsFailed: number;
  parallelExecutions?: number;
  conditionalBranches?: string[];
  metadata?: Record<string, any>;
}

// Workflow step result
export interface WorkflowStepResult {
  success: boolean;
  output?: any;
  error?: Error;
  duration: number;
  skipped?: boolean;
  retryCount?: number;
  metadata?: Record<string, any>;
}

// Workflow tracing configuration
export interface WorkflowTracingConfig {
  enabled: boolean;
  traceSteps: boolean;
  traceConditionals: boolean;
  traceParallelExecution: boolean;
  traceLoops: boolean;
  traceHumanInput: boolean;
  captureInput: boolean;
  captureOutput: boolean;
  captureStepIO: boolean;
  maxInputSize: number;
  maxOutputSize: number;
  sensitiveFields: string[];
}

// Default workflow tracing configuration
const defaultWorkflowTracingConfig: WorkflowTracingConfig = {
  enabled: true,
  traceSteps: true,
  traceConditionals: true,
  traceParallelExecution: true,
  traceLoops: true,
  traceHumanInput: true,
  captureInput: true,
  captureOutput: true,
  captureStepIO: true,
  maxInputSize: 30000, // 30KB for workflow inputs
  maxOutputSize: 150000, // 150KB for workflow outputs
  sensitiveFields: ['password', 'secret', 'token', 'key', 'credential', 'api_key'],
};

/**
 * Enhanced Workflow Execution Tracer
 * Constitutional requirement for comprehensive workflow observability
 */
export class WorkflowExecutionTracer {
  private langfuseClient = getLangFuseClient();
  private config: WorkflowTracingConfig;

  constructor(config: Partial<WorkflowTracingConfig> = {}) {
    this.config = { ...defaultWorkflowTracingConfig, ...config };

    rootLogger.debug('Workflow execution tracer initialized', {
      enabled: this.config.enabled,
      trace_steps: this.config.traceSteps,
      trace_conditionals: this.config.traceConditionals,
      trace_parallel: this.config.traceParallelExecution,
    });
  }

  /**
   * Start a new workflow execution trace
   */
  async startWorkflowTrace(context: WorkflowExecutionContext, input: any): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled) {
          return null;
        }

        const executionId = context.executionId || randomUUID();

        const traceData: LangFuseTraceData = {
          name: `workflow_execution_${context.workflowName}`,
          userId: context.userId,
          sessionId: context.sessionId,
          metadata: {
            workflow_id: context.workflowId,
            workflow_name: context.workflowName,
            workflow_version: context.workflowVersion || '1.0.0',
            execution_id: executionId,
            parent_trace_id: context.parentTraceId,
            execution_type: 'workflow_execution',
            constitutional_compliance: true,
            ...context.metadata,
          },
          tags: [
            'workflow-execution',
            context.workflowName,
            ...(context.sessionId ? ['session'] : []),
            ...(context.parentTraceId ? ['nested-workflow'] : []),
          ],
          input: this.config.captureInput ? this.sanitizeData(input) : undefined,
          version: context.workflowVersion || '1.0.0',
        };

        const traceId = await this.langfuseClient.createTrace(traceData);

        if (traceId) {
          rootLogger.debug('Workflow execution trace started', {
            traceId,
            workflowName: context.workflowName,
            workflowId: context.workflowId,
            executionId,
            userId: context.userId,
          });
        }

        return traceId;
      },
      {
        component: 'workflow',
        operation: 'start_workflow_trace',
        metadata: {
          workflowName: context.workflowName,
          workflowId: context.workflowId,
        },
      },
      'low'
    );
  }

  /**
   * Start a workflow step span
   */
  async startWorkflowStep(
    traceId: string,
    workflowContext: WorkflowExecutionContext,
    stepContext: WorkflowStepContext,
    input?: any,
    parentSpanId?: string
  ): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !this.config.traceSteps || !traceId) {
          return null;
        }

        const spanData: LangFuseSpanData = {
          traceId,
          name: `step_${stepContext.stepName}`,
          input: this.config.captureStepIO && input ? this.sanitizeData(input) : undefined,
          metadata: {
            workflow_id: workflowContext.workflowId,
            workflow_name: workflowContext.workflowName,
            step_id: stepContext.stepId,
            step_name: stepContext.stepName,
            step_type: stepContext.stepType,
            step_index: stepContext.stepIndex,
            total_steps: stepContext.totalSteps,
            parent_step_id: stepContext.parentStepId,
            is_parallel: stepContext.isParallel,
            conditional_branch: stepContext.conditionalBranch,
            loop_iteration: stepContext.loopIteration,
            span_type: 'workflow_step',
            constitutional_compliance: true,
            ...stepContext.metadata,
          },
          startTime: new Date(),
          parentObservationId: parentSpanId || workflowContext.parentSpanId,
          version: workflowContext.workflowVersion || '1.0.0',
        };

        const spanId = await this.langfuseClient.createSpan(spanData);

        if (spanId) {
          rootLogger.debug('Workflow step started', {
            spanId,
            traceId,
            workflowName: workflowContext.workflowName,
            stepName: stepContext.stepName,
            stepType: stepContext.stepType,
            stepIndex: stepContext.stepIndex,
          });
        }

        return spanId;
      },
      {
        component: 'workflow',
        operation: 'start_workflow_step',
        metadata: {
          traceId,
          workflowName: workflowContext.workflowName,
          stepName: stepContext.stepName,
          stepType: stepContext.stepType,
        },
      },
      'low'
    );
  }

  /**
   * Complete a workflow step span
   */
  async completeWorkflowStep(
    spanId: string | null,
    stepContext: WorkflowStepContext,
    result: WorkflowStepResult,
    endTime?: Date
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !spanId) {
          return;
        }

        await this.langfuseClient.updateObservation(spanId, {
          output: this.config.captureStepIO && result.success ? this.sanitizeData(result.output) : undefined,
          endTime: endTime || new Date(),
          level: result.success ? 'DEFAULT' : result.skipped ? 'WARNING' : 'ERROR',
          statusMessage: result.error
            ? result.error.message
            : result.skipped
              ? 'Step skipped'
              : 'Step completed successfully',
          metadata: {
            step_id: stepContext.stepId,
            step_name: stepContext.stepName,
            success: result.success,
            skipped: result.skipped,
            duration_ms: result.duration,
            retry_count: result.retryCount || 0,
            constitutional_compliance: true,
            ...result.metadata,
          },
        });

        rootLogger.debug('Workflow step completed', {
          spanId,
          stepName: stepContext.stepName,
          success: result.success,
          skipped: result.skipped,
          duration: result.duration,
        });
      },
      {
        component: 'workflow',
        operation: 'complete_workflow_step',
        metadata: {
          spanId,
          stepName: stepContext.stepName,
          success: result.success,
        },
      },
      'low'
    );
  }

  /**
   * Trace conditional execution
   */
  async traceConditional(
    traceId: string,
    workflowContext: WorkflowExecutionContext,
    conditionalData: {
      conditionName: string;
      condition: string;
      result: boolean;
      branchTaken: string;
      availableBranches: string[];
      evaluationTime?: number;
      parentSpanId?: string;
    }
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !this.config.traceConditionals || !traceId) {
          return;
        }

        await this.langfuseClient.createEvent({
          traceId,
          name: `conditional_${conditionalData.conditionName}`,
          metadata: {
            workflow_id: workflowContext.workflowId,
            workflow_name: workflowContext.workflowName,
            condition_name: conditionalData.conditionName,
            condition: conditionalData.condition,
            condition_result: conditionalData.result,
            branch_taken: conditionalData.branchTaken,
            available_branches: conditionalData.availableBranches,
            evaluation_time_ms: conditionalData.evaluationTime,
            constitutional_compliance: true,
          },
          input: this.config.captureStepIO ? {
            condition: conditionalData.condition,
            availableBranches: conditionalData.availableBranches,
          } : undefined,
          output: this.config.captureStepIO ? {
            result: conditionalData.result,
            branchTaken: conditionalData.branchTaken,
          } : undefined,
          level: 'DEFAULT',
          statusMessage: `Condition evaluated: ${conditionalData.branchTaken} branch taken`,
          parentObservationId: conditionalData.parentSpanId || workflowContext.parentSpanId,
        });

        rootLogger.debug('Workflow conditional traced', {
          traceId,
          workflowName: workflowContext.workflowName,
          conditionName: conditionalData.conditionName,
          result: conditionalData.result,
          branchTaken: conditionalData.branchTaken,
        });
      },
      {
        component: 'workflow',
        operation: 'trace_conditional',
        metadata: {
          traceId,
          workflowName: workflowContext.workflowName,
          conditionName: conditionalData.conditionName,
        },
      },
      'low'
    );
  }

  /**
   * Trace parallel execution
   */
  async traceParallelExecution(
    traceId: string,
    workflowContext: WorkflowExecutionContext,
    parallelData: {
      parallelGroupName: string;
      parallelSteps: string[];
      maxConcurrency?: number;
      executionTime?: number;
      results?: Array<{ stepName: string; success: boolean; duration: number }>;
      parentSpanId?: string;
    }
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !this.config.traceParallelExecution || !traceId) {
          return;
        }

        await this.langfuseClient.createEvent({
          traceId,
          name: `parallel_execution_${parallelData.parallelGroupName}`,
          metadata: {
            workflow_id: workflowContext.workflowId,
            workflow_name: workflowContext.workflowName,
            parallel_group_name: parallelData.parallelGroupName,
            parallel_steps_count: parallelData.parallelSteps.length,
            parallel_steps: parallelData.parallelSteps,
            max_concurrency: parallelData.maxConcurrency,
            execution_time_ms: parallelData.executionTime,
            successful_steps: parallelData.results?.filter(r => r.success).length || 0,
            failed_steps: parallelData.results?.filter(r => !r.success).length || 0,
            constitutional_compliance: true,
          },
          input: this.config.captureStepIO ? {
            parallelSteps: parallelData.parallelSteps,
            maxConcurrency: parallelData.maxConcurrency,
          } : undefined,
          output: this.config.captureStepIO ? {
            results: parallelData.results,
            executionTime: parallelData.executionTime,
          } : undefined,
          level: 'DEFAULT',
          statusMessage: `Parallel execution completed: ${parallelData.parallelSteps.length} steps`,
          parentObservationId: parallelData.parentSpanId || workflowContext.parentSpanId,
        });

        rootLogger.debug('Workflow parallel execution traced', {
          traceId,
          workflowName: workflowContext.workflowName,
          parallelGroupName: parallelData.parallelGroupName,
          stepsCount: parallelData.parallelSteps.length,
          executionTime: parallelData.executionTime,
        });
      },
      {
        component: 'workflow',
        operation: 'trace_parallel_execution',
        metadata: {
          traceId,
          workflowName: workflowContext.workflowName,
          parallelGroupName: parallelData.parallelGroupName,
        },
      },
      'low'
    );
  }

  /**
   * Trace loop execution
   */
  async traceLoopExecution(
    traceId: string,
    workflowContext: WorkflowExecutionContext,
    loopData: {
      loopName: string;
      loopType: 'for' | 'while' | 'forEach';
      iterations: number;
      maxIterations?: number;
      condition?: string;
      executionTime?: number;
      parentSpanId?: string;
    }
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !this.config.traceLoops || !traceId) {
          return;
        }

        await this.langfuseClient.createEvent({
          traceId,
          name: `loop_execution_${loopData.loopName}`,
          metadata: {
            workflow_id: workflowContext.workflowId,
            workflow_name: workflowContext.workflowName,
            loop_name: loopData.loopName,
            loop_type: loopData.loopType,
            iterations_completed: loopData.iterations,
            max_iterations: loopData.maxIterations,
            loop_condition: loopData.condition,
            execution_time_ms: loopData.executionTime,
            constitutional_compliance: true,
          },
          input: this.config.captureStepIO ? {
            loopType: loopData.loopType,
            condition: loopData.condition,
            maxIterations: loopData.maxIterations,
          } : undefined,
          output: this.config.captureStepIO ? {
            iterationsCompleted: loopData.iterations,
            executionTime: loopData.executionTime,
          } : undefined,
          level: 'DEFAULT',
          statusMessage: `Loop completed: ${loopData.iterations} iterations`,
          parentObservationId: loopData.parentSpanId || workflowContext.parentSpanId,
        });

        rootLogger.debug('Workflow loop execution traced', {
          traceId,
          workflowName: workflowContext.workflowName,
          loopName: loopData.loopName,
          iterations: loopData.iterations,
          executionTime: loopData.executionTime,
        });
      },
      {
        component: 'workflow',
        operation: 'trace_loop_execution',
        metadata: {
          traceId,
          workflowName: workflowContext.workflowName,
          loopName: loopData.loopName,
        },
      },
      'low'
    );
  }

  /**
   * Complete a workflow execution trace
   */
  async completeWorkflowTrace(
    traceId: string | null,
    context: WorkflowExecutionContext,
    result: WorkflowExecutionResult
  ): Promise<void> {
    return await withErrorHandling(
      async () => {
        if (!this.config.enabled || !traceId) {
          return;
        }

        // Create completion event
        await this.langfuseClient.createEvent({
          traceId,
          name: 'workflow_execution_completed',
          metadata: {
            workflow_id: context.workflowId,
            workflow_name: context.workflowName,
            execution_id: context.executionId,
            success: result.success,
            duration_ms: result.duration,
            steps_executed: result.stepsExecuted,
            steps_skipped: result.stepsSkipped,
            steps_failed: result.stepsFailed,
            parallel_executions: result.parallelExecutions,
            conditional_branches: result.conditionalBranches,
            has_error: Boolean(result.error),
            constitutional_compliance: true,
            ...result.metadata,
          },
          output: this.config.captureOutput && result.success ? this.sanitizeData(result.output) : undefined,
          level: result.success ? 'DEFAULT' : 'ERROR',
          statusMessage: result.error ? result.error.message : 'Workflow execution completed',
        });

        // If there was an error, create detailed error event
        if (result.error) {
          await this.langfuseClient.createEvent({
            traceId,
            name: 'workflow_execution_error',
            metadata: {
              workflow_id: context.workflowId,
              workflow_name: context.workflowName,
              execution_id: context.executionId,
              error_type: result.error.constructor.name,
              error_message: result.error.message,
              duration_ms: result.duration,
              steps_completed: result.stepsExecuted,
              constitutional_compliance: true,
            },
            output: {
              error: {
                name: result.error.name,
                message: result.error.message,
                stack: result.error.stack,
              },
            },
            level: 'ERROR',
            statusMessage: `Workflow execution failed: ${result.error.message}`,
          });
        }

        rootLogger.debug('Workflow execution trace completed', {
          traceId,
          workflowName: context.workflowName,
          success: result.success,
          duration: result.duration,
          stepsExecuted: result.stepsExecuted,
        });
      },
      {
        component: 'workflow',
        operation: 'complete_workflow_trace',
        metadata: {
          traceId,
          workflowName: context.workflowName,
          success: result.success,
        },
      },
      'low'
    );
  }

  /**
   * Trace complete workflow execution with automatic timing
   */
  async traceWorkflowExecution<T>(
    context: WorkflowExecutionContext,
    input: any,
    executor: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let traceId: string | null = null;
    let result: WorkflowExecutionResult;

    try {
      // Start trace
      traceId = await this.startWorkflowTrace(context, input);

      // Execute workflow
      const output = await executor();

      // Calculate duration
      const duration = Date.now() - startTime;

      result = {
        success: true,
        output,
        duration,
        stepsExecuted: 0, // Will be updated by step tracing
        stepsSkipped: 0,
        stepsFailed: 0,
      };

      // Complete trace
      await this.completeWorkflowTrace(traceId, context, result);

      return output;

    } catch (error) {
      const duration = Date.now() - startTime;

      result = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
        stepsExecuted: 0,
        stepsSkipped: 0,
        stepsFailed: 1,
      };

      // Complete trace with error
      await this.completeWorkflowTrace(traceId, context, result);

      throw error;
    }
  }

  /**
   * Create a child tracer for nested workflow operations
   */
  createChildTracer(parentContext: WorkflowExecutionContext): WorkflowExecutionTracer {
    return new WorkflowExecutionTracer(this.config);
  }

  /**
   * Sanitize data for tracing (remove sensitive information and limit size)
   */
  private sanitizeData(data: any): any {
    return withErrorHandling(
      () => {
        if (data === null || data === undefined) {
          return data;
        }

        // Convert to string for size checking
        const dataStr = JSON.stringify(data);
        const maxSize = this.config.maxInputSize;

        // Check size limit
        if (dataStr.length > maxSize) {
          const truncated = dataStr.substring(0, maxSize);
          return {
            _truncated: true,
            _originalSize: dataStr.length,
            _maxSize: maxSize,
            data: truncated + '...',
          };
        }

        // Remove sensitive fields
        if (typeof data === 'object' && data !== null) {
          const sanitized = this.removeSensitiveFields(data);
          return sanitized;
        }

        return data;
      },
      {
        component: 'workflow',
        operation: 'sanitize_data',
      },
      'low'
    );
  }

  /**
   * Remove sensitive fields from object
   */
  private removeSensitiveFields(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeSensitiveFields(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      const isSensitive = this.config.sensitiveFields.some(field =>
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
   * Update tracing configuration
   */
  updateConfig(newConfig: Partial<WorkflowTracingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    rootLogger.debug('Workflow tracer configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): WorkflowTracingConfig {
    return { ...this.config };
  }

  /**
   * Check if tracing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.langfuseClient.isReady();
  }
}

// Global singleton instance
let globalWorkflowTracer: WorkflowExecutionTracer;

export function getWorkflowExecutionTracer(): WorkflowExecutionTracer {
  if (!globalWorkflowTracer) {
    globalWorkflowTracer = new WorkflowExecutionTracer();
  }
  return globalWorkflowTracer;
}

// Convenience function for simple workflow tracing
export async function traceWorkflowExecution<T>(
  workflowName: string,
  input: any,
  executor: () => Promise<T>,
  context: Partial<WorkflowExecutionContext> = {}
): Promise<T> {
  const tracer = getWorkflowExecutionTracer();
  const fullContext: WorkflowExecutionContext = {
    workflowId: randomUUID(),
    workflowName,
    ...context,
  };

  return await tracer.traceWorkflowExecution(fullContext, input, executor);
}

// Constitutional compliance exports
export default getWorkflowExecutionTracer;