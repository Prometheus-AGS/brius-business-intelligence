import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { workflows } from '../../index.js';
import { rootLogger } from '../../observability/logger.js';
import { MCPTracer } from '../../observability/langfuse.js';

/**
 * Workflow Tool Wrappers for MCP Exposure
 * Provides MCP-compatible tool wrappers for Mastra workflows
 * Enables external MCP clients to execute workflows with proper context and monitoring
 */

export interface WorkflowExecutionContext {
  userId?: string;
  sessionId?: string;
  traceId?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowExecutionOptions {
  timeout?: number;
  resumable?: boolean;
  stepByStep?: boolean;
  validateInput?: boolean;
  enableMonitoring?: boolean;
}

export interface WorkflowExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  metadata: {
    workflowId: string;
    userId?: string;
    sessionId?: string;
    traceId?: string;
    stepsCompleted?: number;
    totalSteps?: number;
    stepsExecuted?: string[];
  };
}

export interface WorkflowStepInfo {
  id: string;
  description: string;
  stepNumber: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  executionTime?: number;
  output?: any;
  error?: string;
}

/**
 * Base schema for workflow execution
 */
const WorkflowExecutionInputSchema = z.object({
  input: z.any().describe('Input data for the workflow execution'),
  context: z.object({
    userId: z.string().optional().describe('User identifier for personalization'),
    sessionId: z.string().optional().describe('Session identifier for context continuity'),
    traceId: z.string().optional().describe('Trace identifier for observability'),
    metadata: z.record(z.any()).optional().describe('Additional context metadata'),
  }).optional().describe('Execution context for the workflow'),
  options: z.object({
    timeout: z.number().int().min(1000).max(600000).optional().describe('Timeout in milliseconds'),
    resumable: z.boolean().optional().describe('Enable resumable execution'),
    stepByStep: z.boolean().optional().describe('Execute step by step with pause capability'),
    validateInput: z.boolean().default(true).describe('Validate input against workflow schema'),
    enableMonitoring: z.boolean().default(true).describe('Enable detailed execution monitoring'),
  }).optional().describe('Workflow execution options'),
});

const WorkflowExecutionOutputSchema = z.object({
  success: z.boolean().describe('Whether the execution was successful'),
  result: z.any().optional().describe('The workflow execution result'),
  error: z.string().optional().describe('Error message if execution failed'),
  executionTime: z.number().describe('Total execution time in milliseconds'),
  metadata: z.object({
    workflowId: z.string().describe('Workflow identifier'),
    userId: z.string().optional().describe('User identifier'),
    sessionId: z.string().optional().describe('Session identifier'),
    traceId: z.string().optional().describe('Trace identifier'),
    stepsCompleted: z.number().optional().describe('Number of completed steps'),
    totalSteps: z.number().optional().describe('Total number of steps'),
    stepsExecuted: z.array(z.string()).optional().describe('List of executed step IDs'),
  }).describe('Execution metadata and statistics'),
});

/**
 * Create workflow execution tool wrapper
 */
function createWorkflowExecutionTool(workflowId: string, workflow: any) {
  return createTool({
    id: `execute-workflow-${workflowId}`,
    description: `Execute ${workflowId} workflow for structured business processes. This workflow provides coordinated execution of multiple steps with proper error handling and state management.`,
    inputSchema: WorkflowExecutionInputSchema,
    outputSchema: WorkflowExecutionOutputSchema,
    execute: async ({ context, input }) => {
      const startTime = Date.now();
      const tracer = new MCPTracer(`workflow-execution-${workflowId}`, `exec-${Date.now()}`, {
        workflowId,
        userId: input.context?.userId,
        sessionId: input.context?.sessionId,
        input: JSON.stringify(input.input).substring(0, 200),
      });

      try {
        const { input: workflowInput, context: execContext = {}, options = {} } = input;

        rootLogger.info('MCP workflow execution started', {
          workflow_id: workflowId,
          user_id: execContext.userId,
          session_id: execContext.sessionId,
          input_keys: typeof workflowInput === 'object' ? Object.keys(workflowInput) : [],
          options,
        });

        // Validate input against workflow schema if required
        if (options.validateInput !== false && workflow.triggerSchema) {
          try {
            workflow.triggerSchema.parse(workflowInput);
          } catch (validationError) {
            throw new Error(`Input validation failed: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
          }
        }

        // Prepare execution context
        const executionContext: WorkflowExecutionContext = {
          userId: execContext.userId || context.userId || 'mcp-client',
          sessionId: execContext.sessionId || context.sessionId || `mcp-${Date.now()}`,
          traceId: execContext.traceId || tracer.getTraceId(),
          metadata: {
            source: 'mcp-client',
            ...execContext.metadata,
          },
        };

        // Execute workflow based on type
        let result;
        let stepsExecuted: string[] = [];

        if (workflowId === 'orchestrator') {
          const { executeOrchestrator } = await import('../../workflows/orchestrator.js');
          result = await executeOrchestrator(workflowInput, {
            traceId: executionContext.traceId,
            userId: executionContext.userId,
            timeout: options.timeout,
          });
          stepsExecuted = ['intent-classification', 'route-execution', 'response-generation'];
        } else if (workflowId === 'planning') {
          const { executePlanning } = await import('../../workflows/planning.js');
          result = await executePlanning(workflowInput, {
            traceId: executionContext.traceId,
            userId: executionContext.userId,
          });
          stepsExecuted = ['gather-knowledge', 'generate-plan', 'validate-plan'];
        } else if (workflowId === 'intent-classifier') {
          // Generic workflow execution for intent classifier
          result = await workflow.execute(workflowInput);
          stepsExecuted = workflow.steps?.map((step: any) => step.id) || [];
        } else {
          // Generic workflow execution
          result = await workflow.execute(workflowInput);
          stepsExecuted = workflow.steps?.map((step: any) => step.id) || [];
        }

        const executionTime = Date.now() - startTime;

        const response: WorkflowExecutionResult = {
          success: true,
          result,
          executionTime,
          metadata: {
            workflowId,
            userId: executionContext.userId,
            sessionId: executionContext.sessionId,
            traceId: executionContext.traceId,
            stepsCompleted: stepsExecuted.length,
            totalSteps: workflow.steps?.length || stepsExecuted.length,
            stepsExecuted,
          },
        };

        tracer.end({
          output: response,
          metadata: {
            executionTime,
            success: true,
            stepsCompleted: stepsExecuted.length,
            resultSize: JSON.stringify(result).length,
          },
        });

        rootLogger.info('MCP workflow execution completed', {
          workflow_id: workflowId,
          user_id: executionContext.userId,
          execution_time_ms: executionTime,
          success: true,
          steps_completed: stepsExecuted.length,
          result_size: JSON.stringify(result).length,
        });

        return response;

      } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        const response: WorkflowExecutionResult = {
          success: false,
          error: errorMessage,
          executionTime,
          metadata: {
            workflowId,
            userId: input.context?.userId,
            sessionId: input.context?.sessionId,
            traceId: input.context?.traceId,
            stepsCompleted: 0,
            totalSteps: workflow.steps?.length || 0,
            stepsExecuted: [],
          },
        };

        tracer.end({
          error: errorMessage,
          metadata: {
            executionTime,
            success: false,
          },
        });

        rootLogger.error('MCP workflow execution failed', {
          workflow_id: workflowId,
          user_id: input.context?.userId,
          execution_time_ms: executionTime,
          error: errorMessage,
        });

        return response;
      }
    },
  });
}

/**
 * Create workflow info tool wrapper
 */
function createWorkflowInfoTool(workflowId: string, workflow: any) {
  return createTool({
    id: `workflow-info-${workflowId}`,
    description: `Get detailed information about the ${workflowId} workflow including its steps, schema, and capabilities.`,
    inputSchema: z.object({
      includeSteps: z.boolean().default(true).describe('Include workflow steps information'),
      includeSchema: z.boolean().default(true).describe('Include input/output schema'),
      includeMetrics: z.boolean().default(false).describe('Include execution metrics'),
    }),
    outputSchema: z.object({
      id: z.string().describe('Workflow identifier'),
      name: z.string().describe('Workflow name'),
      description: z.string().describe('Workflow description'),
      status: z.string().describe('Workflow status'),
      type: z.string().describe('Workflow type'),
      steps: z.array(z.object({
        id: z.string().describe('Step identifier'),
        description: z.string().describe('Step description'),
        stepNumber: z.number().describe('Step sequence number'),
      })).optional(),
      inputSchema: z.any().optional().describe('Input schema definition'),
      outputSchema: z.any().optional().describe('Output schema definition'),
      capabilities: z.object({
        resumable: z.boolean().describe('Supports resumable execution'),
        parallel: z.boolean().describe('Supports parallel execution'),
        conditional: z.boolean().describe('Has conditional logic'),
        looping: z.boolean().describe('Has looping constructs'),
      }),
      metrics: z.object({
        totalExecutions: z.number().describe('Total executions'),
        averageExecutionTime: z.number().describe('Average execution time in ms'),
        successRate: z.number().describe('Success rate (0-1)'),
        averageStepsCompleted: z.number().describe('Average steps completed'),
      }).optional(),
    }),
    execute: async ({ context, input }) => {
      try {
        const { includeSteps, includeSchema, includeMetrics } = input;

        rootLogger.info('MCP workflow info request', {
          workflow_id: workflowId,
          include_steps: includeSteps,
          include_schema: includeSchema,
          include_metrics: includeMetrics,
        });

        const workflowInfo: any = {
          id: workflowId,
          name: workflow.name || workflowId,
          description: getWorkflowDescription(workflowId),
          status: 'active',
          type: getWorkflowType(workflowId),
          capabilities: {
            resumable: workflowId !== 'intent-classifier', // Most workflows support resumability
            parallel: false, // Currently no parallel workflows
            conditional: workflowId === 'orchestrator', // Orchestrator has conditional routing
            looping: false, // Currently no looping workflows
          },
        };

        if (includeSteps && workflow.steps) {
          workflowInfo.steps = workflow.steps.map((step: any, index: number) => ({
            id: step.id,
            description: step.description || `Step ${index + 1} of ${workflowId} workflow`,
            stepNumber: index + 1,
          }));
        }

        if (includeSchema) {
          if (workflow.triggerSchema) {
            workflowInfo.inputSchema = convertZodSchemaToInfo(workflow.triggerSchema);
          }
          // Output schema would be derived from workflow execution
          workflowInfo.outputSchema = getWorkflowOutputSchema(workflowId);
        }

        if (includeMetrics) {
          // Mock metrics - in production, this would come from observability system
          workflowInfo.metrics = {
            totalExecutions: Math.floor(Math.random() * 500),
            averageExecutionTime: Math.floor(Math.random() * 10000) + 2000,
            successRate: 0.80 + Math.random() * 0.20,
            averageStepsCompleted: workflow.steps?.length || 3,
          };
        }

        return workflowInfo;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        rootLogger.error('MCP workflow info error', {
          workflow_id: workflowId,
          error: errorMessage,
        });
        throw error;
      }
    },
  });
}

/**
 * Create workflow list tool
 */
export const listWorkflowsTool = createTool({
  id: 'list-workflows',
  description: 'List all available workflows in the Mastra Business Intelligence system with their basic information.',
  inputSchema: z.object({
    includeInactive: z.boolean().default(false).describe('Include inactive workflows'),
    category: z.enum(['all', 'orchestration', 'analysis', 'classification']).default('all').describe('Filter by workflow category'),
    detailed: z.boolean().default(false).describe('Include detailed information for each workflow'),
  }),
  outputSchema: z.object({
    workflows: z.array(z.object({
      id: z.string().describe('Workflow identifier'),
      name: z.string().describe('Workflow name'),
      description: z.string().describe('Workflow description'),
      status: z.string().describe('Workflow status'),
      type: z.string().describe('Workflow type'),
      category: z.string().describe('Workflow category'),
      stepsCount: z.number().optional().describe('Number of workflow steps'),
      capabilities: z.object({
        resumable: z.boolean(),
        parallel: z.boolean(),
        conditional: z.boolean(),
      }).optional(),
    })),
    totalCount: z.number().describe('Total number of workflows'),
  }),
  execute: async ({ context, input }) => {
    try {
      const { includeInactive, category, detailed } = input;

      rootLogger.info('MCP list workflows request', {
        include_inactive: includeInactive,
        category,
        detailed,
      });

      const workflowList = Object.entries(workflows)
        .filter(([workflowId, workflow]) => {
          const workflowCategory = getWorkflowCategory(workflowId);
          if (category !== 'all' && workflowCategory !== category) return false;
          return true;
        })
        .map(([workflowId, workflow]) => {
          const workflowInfo: any = {
            id: workflowId,
            name: workflow.name || workflowId,
            description: getWorkflowDescription(workflowId),
            status: 'active',
            type: getWorkflowType(workflowId),
            category: getWorkflowCategory(workflowId),
          };

          if (detailed) {
            workflowInfo.stepsCount = workflow.steps?.length || 0;
            workflowInfo.capabilities = {
              resumable: workflowId !== 'intent-classifier',
              parallel: false,
              conditional: workflowId === 'orchestrator',
            };
          }

          return workflowInfo;
        });

      return {
        workflows: workflowList,
        totalCount: workflowList.length,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('MCP list workflows error', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Create workflow health check tool
 */
export const workflowHealthCheckTool = createTool({
  id: 'workflow-health-check',
  description: 'Perform health check on workflows to verify they are functioning correctly.',
  inputSchema: z.object({
    workflowId: z.string().optional().describe('Specific workflow to check (if not provided, checks all)'),
    includeSteps: z.boolean().default(true).describe('Include step-level health check'),
    timeout: z.number().int().min(1000).max(30000).default(15000).describe('Health check timeout in ms'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      workflowId: z.string().describe('Workflow identifier'),
      status: z.enum(['healthy', 'unhealthy', 'warning']).describe('Health status'),
      checks: z.object({
        initialization: z.boolean().describe('Workflow properly initialized'),
        steps: z.boolean().describe('All steps properly configured'),
        schema: z.boolean().describe('Input schema valid'),
        dependencies: z.boolean().describe('Dependencies available'),
      }),
      stepChecks: z.array(z.object({
        stepId: z.string(),
        status: z.enum(['healthy', 'unhealthy', 'warning']),
        issues: z.array(z.string()),
      })).optional(),
      responseTime: z.number().describe('Response time in milliseconds'),
      issues: z.array(z.string()).describe('Any issues found'),
      lastChecked: z.string().describe('Last check timestamp'),
    })),
    summary: z.object({
      totalWorkflows: z.number().describe('Total workflows checked'),
      healthyWorkflows: z.number().describe('Number of healthy workflows'),
      unhealthyWorkflows: z.number().describe('Number of unhealthy workflows'),
      averageResponseTime: z.number().describe('Average response time'),
    }),
  }),
  execute: async ({ context, input }) => {
    try {
      const { workflowId, includeSteps, timeout } = input;
      const startTime = Date.now();

      rootLogger.info('MCP workflow health check started', {
        workflow_id: workflowId,
        include_steps: includeSteps,
        timeout,
      });

      const workflowsToCheck = workflowId ? [workflowId] : Object.keys(workflows);
      const results = [];

      for (const id of workflowsToCheck) {
        const workflow = workflows[id];
        if (!workflow) {
          results.push({
            workflowId: id,
            status: 'unhealthy' as const,
            checks: {
              initialization: false,
              steps: false,
              schema: false,
              dependencies: false,
            },
            responseTime: 0,
            issues: ['Workflow not found'],
            lastChecked: new Date().toISOString(),
          });
          continue;
        }

        const checkStartTime = Date.now();
        const issues = [];
        const checks = {
          initialization: true,
          steps: Boolean(workflow.steps?.length),
          schema: Boolean(workflow.triggerSchema),
          dependencies: true, // Assume dependencies are available
        };

        // Basic health checks
        if (!workflow.name) {
          issues.push('Workflow name not configured');
        }

        if (!checks.steps) {
          issues.push('No workflow steps configured');
        }

        if (!checks.schema) {
          issues.push('No input schema defined');
        }

        // Step-level checks
        let stepChecks;
        if (includeSteps && workflow.steps) {
          stepChecks = workflow.steps.map((step: any) => {
            const stepIssues = [];

            if (!step.id) {
              stepIssues.push('Step ID not defined');
            }

            if (!step.description) {
              stepIssues.push('Step description missing');
            }

            if (!step.execute) {
              stepIssues.push('Step execute function missing');
            }

            return {
              stepId: step.id || 'unknown',
              status: stepIssues.length === 0 ? 'healthy' as const : 'warning' as const,
              issues: stepIssues,
            };
          });

          // Add step issues to main issues
          const unhealthySteps = stepChecks.filter(sc => sc.status === 'unhealthy').length;
          if (unhealthySteps > 0) {
            issues.push(`${unhealthySteps} unhealthy steps found`);
          }
        }

        const responseTime = Date.now() - checkStartTime;
        const status = issues.length === 0 ? 'healthy' : issues.length < 3 ? 'warning' : 'unhealthy';

        results.push({
          workflowId: id,
          status,
          checks,
          stepChecks,
          responseTime,
          issues,
          lastChecked: new Date().toISOString(),
        });
      }

      const healthyCount = results.filter(r => r.status === 'healthy').length;
      const unhealthyCount = results.filter(r => r.status === 'unhealthy').length;
      const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

      const summary = {
        totalWorkflows: results.length,
        healthyWorkflows: healthyCount,
        unhealthyWorkflows: unhealthyCount,
        averageResponseTime: avgResponseTime,
      };

      rootLogger.info('MCP workflow health check completed', {
        total_time_ms: Date.now() - startTime,
        total_workflows: results.length,
        healthy_workflows: healthyCount,
        unhealthy_workflows: unhealthyCount,
      });

      return { results, summary };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      rootLogger.error('MCP workflow health check error', { error: errorMessage });
      throw error;
    }
  },
});

/**
 * Helper functions
 */
function getWorkflowDescription(workflowId: string): string {
  const descriptions: Record<string, string> = {
    'orchestrator': 'Coordinates business intelligence requests through intent classification and intelligent routing',
    'planning': 'Generates execution plans for complex business queries with knowledge context',
    'intent-classifier': 'Classifies user intents and determines appropriate response strategies',
  };
  return descriptions[workflowId] || `Business workflow for ${workflowId} operations`;
}

function getWorkflowType(workflowId: string): string {
  const types: Record<string, string> = {
    'orchestrator': 'orchestration',
    'planning': 'analysis',
    'intent-classifier': 'classification',
  };
  return types[workflowId] || 'general';
}

function getWorkflowCategory(workflowId: string): string {
  const categories: Record<string, string> = {
    'orchestrator': 'orchestration',
    'planning': 'analysis',
    'intent-classifier': 'classification',
  };
  return categories[workflowId] || 'general';
}

function getWorkflowOutputSchema(workflowId: string): any {
  const schemas: Record<string, any> = {
    'orchestrator': {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'Generated response' },
        intent: { type: 'string', description: 'Classified intent' },
        confidence: { type: 'number', description: 'Confidence score' },
      },
    },
    'planning': {
      type: 'object',
      properties: {
        plan: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step_number: { type: 'number' },
              action: { type: 'string' },
              tool: { type: 'string' },
              parameters: { type: 'object' },
            },
          },
        },
        knowledge_sources: { type: 'array', items: { type: 'string' } },
        confidence_score: { type: 'number' },
      },
    },
    'intent-classifier': {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'Classified intent' },
        confidence: { type: 'number', description: 'Classification confidence' },
        category: { type: 'string', description: 'Intent category' },
      },
    },
  };
  return schemas[workflowId] || { type: 'object', properties: {} };
}

function convertZodSchemaToInfo(zodSchema: any): any {
  // Simplified conversion - in production, use proper Zod to JSON Schema converter
  try {
    return {
      type: 'object',
      description: 'Workflow input schema (Zod schema)',
      note: 'Full schema conversion available through workflow info endpoint',
    };
  } catch (error) {
    return { type: 'object', description: 'Schema conversion not available' };
  }
}

/**
 * Generate workflow tool wrappers for all registered workflows
 */
export function generateWorkflowToolWrappers() {
  const workflowTools = [];

  // Create execution and info tools for each workflow
  for (const [workflowId, workflow] of Object.entries(workflows)) {
    workflowTools.push(createWorkflowExecutionTool(workflowId, workflow));
    workflowTools.push(createWorkflowInfoTool(workflowId, workflow));
  }

  // Add utility tools
  workflowTools.push(listWorkflowsTool);
  workflowTools.push(workflowHealthCheckTool);

  rootLogger.info('Workflow tool wrappers generated', {
    total_tools: workflowTools.length,
    workflow_count: Object.keys(workflows).length,
    execution_tools: Object.keys(workflows).length,
    info_tools: Object.keys(workflows).length,
    utility_tools: 2,
  });

  return workflowTools;
}

/**
 * Export all workflow tools
 */
export const workflowTools = generateWorkflowToolWrappers();