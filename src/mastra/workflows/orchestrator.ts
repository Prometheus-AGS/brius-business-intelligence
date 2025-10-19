import { createStep, createWorkflow } from '@mastra/core/workflows';
import { OrchestratorInputSchema, OrchestratorOutputSchema, OrchestratorInput, OrchestratorOutput } from '../types/index.js';
import { executeIntentClassifier } from './intent-classifier.js';
import { executeBusinessIntelligenceAgent } from '../agents/business-intelligence.js';
import { executeDefaultAgent } from '../agents/default.js';
import { workflowLogger, trackPerformance } from '../observability/logger.js';
import { getWorkflowExecutionTracer, WorkflowExecutionContext, WorkflowStepContext } from '../observability/workflow-tracer.js';

/**
 * Orchestrator Workflow
 * Routes user queries to appropriate agents based on intent classification
 * Provides intelligent routing with fallback mechanisms and performance tracking
 */

const classifyIntentStep = createStep({
  id: 'classify-intent',
  description: 'Classify user intent and determine routing',
  inputSchema: OrchestratorInputSchema,
  execute: async ({ context, input }) => {
    const { prompt, user_id, conversation_id, context: requestContext } = input;

    workflowLogger.info('Starting intent classification for orchestration', {
      user_id,
      conversation_id,
      prompt_length: prompt.length,
    });

    // Execute intent classification workflow with enhanced tracing
    const classificationResult = await executeIntentClassifier({
      prompt,
      context: requestContext,
    }, {
      userId: user_id,
      sessionId: conversation_id,
      metadata: {
        orchestrator_step: 'intent_classification',
      },
    });

    return {
      classification_result: classificationResult,
      routing_decision: classificationResult.routing_decision,
      user_id,
      conversation_id,
      original_prompt: prompt,
    };
  },
});

const routeToAgentStep = createStep({
  id: 'route-to-agent',
  description: 'Route to appropriate agent based on classification',
  execute: async ({ context, input }) => {
    const {
      classification_result,
      routing_decision,
      user_id,
      conversation_id,
      original_prompt,
    } = input;

    const agentName = routing_decision.recommended_agent;

    workflowLogger.info('Routing to agent', {
      agent: agentName,
      confidence: routing_decision.confidence,
      complexity_score: classification_result.classification.complexity_score,
      user_id,
      conversation_id,
    });

    // Prepare agent input
    const agentInput = {
      model: agentName,
      messages: [
        {
          role: 'user' as const,
          content: original_prompt,
        },
      ],
    };

    // Route to appropriate agent
    let agentResponse;
    let executionPath: string[];

    try {
      if (agentName === 'business-intelligence-agent') {
        executionPath = ['intent-classification', 'business-intelligence-agent'];
        agentResponse = await executeBusinessIntelligenceAgent(agentInput, {
          userId: user_id,
          conversationId: conversation_id,
        });
      } else {
        executionPath = ['intent-classification', 'default-agent'];
        agentResponse = await executeDefaultAgent(agentInput, {
          userId: user_id,
          conversationId: conversation_id,
        });
      }

      return {
        intent_classification: classification_result,
        selected_agent: agentName,
        agent_response: agentResponse,
        execution_path: executionPath,
        success: true,
      };

    } catch (error) {
      workflowLogger.error('Agent execution failed, falling back', error instanceof Error ? error : new Error(String(error)));

      // Fallback to default agent if business intelligence agent fails
      if (agentName === 'business-intelligence-agent') {
        try {
          executionPath = ['intent-classification', 'business-intelligence-agent', 'default-agent-fallback'];
          agentResponse = await executeDefaultAgent(agentInput, {
            userId: user_id,
            conversationId: conversation_id,
          });

          return {
            intent_classification: classification_result,
            selected_agent: 'default-agent',
            agent_response: agentResponse,
            execution_path: executionPath,
            success: true,
            fallback_used: true,
            original_error: error instanceof Error ? error.message : String(error),
          };
        } catch (fallbackError) {
          throw new Error(`Both primary and fallback agents failed: ${error}, ${fallbackError}`);
        }
      }

      throw error;
    }
  },
});

const collectMetricsStep = createStep({
  id: 'collect-metrics',
  description: 'Collect performance metrics and prepare response',
  outputSchema: OrchestratorOutputSchema,
  execute: async ({ context, input }) => {
    const {
      intent_classification,
      selected_agent,
      agent_response,
      execution_path,
      success,
      fallback_used,
      original_error,
    } = input;

    const endTime = Date.now();
    const startTime = context.startTime || endTime;

    const metrics = {
      classification_time_ms: context.classificationTime || 0,
      agent_execution_time_ms: context.agentExecutionTime || 0,
      total_time_ms: endTime - startTime,
    };

    workflowLogger.info('Orchestration completed', {
      selected_agent,
      execution_path,
      metrics,
      fallback_used: Boolean(fallback_used),
      success,
    });

    const result: OrchestratorOutput = {
      intent_classification,
      selected_agent,
      agent_response,
      execution_path,
      performance_metrics: metrics,
    };

    // Add error information if fallback was used
    if (fallback_used) {
      (result as any).fallback_info = {
        fallback_used: true,
        original_agent: intent_classification.routing_decision.recommended_agent,
        error: original_error,
      };
    }

    return result;
  },
});

export const orchestratorWorkflow = createWorkflow({
  id: 'orchestrator',
  inputSchema: OrchestratorInputSchema,
  outputSchema: OrchestratorOutputSchema,
  steps: [classifyIntentStep, routeToAgentStep, collectMetricsStep],
})
  .then(classifyIntentStep)
  .then(routeToAgentStep)
  .then(collectMetricsStep)
  .commit();

/**
 * Enhanced orchestrator execution with comprehensive tracing
 */
export async function executeOrchestrator(
  input: OrchestratorInput,
  options: {
    traceId?: string;
    userId?: string;
    sessionId?: string;
  } = {}
): Promise<OrchestratorOutput> {
  const tracer = new WorkflowTracer(
    'orchestrator-workflow',
    `orchestrator-${Date.now()}`,
    {
      userId: options.userId || input.user_id,
      sessionId: options.sessionId,
      input,
      metadata: {
        trace_id: options.traceId,
        prompt_length: input.prompt.length,
      },
    }
  );

  const startTime = Date.now();

  try {
    workflowLogger.info('Orchestrator workflow starting', {
      user_id: input.user_id,
      conversation_id: input.conversation_id,
      prompt_length: input.prompt.length,
      trace_id: tracer.getTraceId(),
    });

    // Execute workflow with performance tracking
    const result = await trackPerformance(
      workflowLogger,
      'orchestrator-execution',
      async () => {
        return await orchestratorWorkflow.execute(input, {
          startTime,
        }) as OrchestratorOutput;
      },
      {
        user_id: input.user_id,
        trace_id: tracer.getTraceId(),
      }
    );

    tracer.end({
      output: result,
      metadata: {
        selected_agent: result.selected_agent,
        execution_path: result.execution_path,
        performance_metrics: result.performance_metrics,
        fallback_used: (result as any).fallback_info?.fallback_used || false,
      },
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    tracer.end({
      error: errorMessage,
      metadata: {
        error_type: error instanceof Error ? error.name : 'UnknownError',
        execution_time_ms: Date.now() - startTime,
      },
    });

    workflowLogger.error('Orchestrator workflow failed', error instanceof Error ? error : new Error(String(error)));

    throw error;
  }
}

/**
 * Health check for orchestrator workflow
 */
export async function checkOrchestratorHealth(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  try {
    const startTime = Date.now();

    const testInput: OrchestratorInput = {
      prompt: 'What is the current time?',
      user_id: 'health-check',
    };

    await executeOrchestrator(testInput);

    const latencyMs = Date.now() - startTime;

    return {
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}