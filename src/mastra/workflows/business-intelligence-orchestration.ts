import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  PromptOrchestrationInputSchema,
  BusinessIntelligenceOrchestrationOutputSchema,
  IntentClassificationOutputSchema,
  type PromptOrchestrationInput,
  type BusinessIntelligenceOrchestrationOutput,
  type ContextBundle,
  type MemoryContext,
  type KnowledgeContext,
  type PlanningStep,
  type MemoryWriteInstruction,
} from '../types/workflows.js';
import { executeIntentClassifier } from './intent-classifier.js';
import { executePlanning } from './planning.js';
import { executeBusinessIntelligenceAgent } from '../agents/business-intelligence.js';
import type { ChatCompletionRequest, Message } from '../types/index.js';
import {
  fetchMemoryContext,
  fetchKnowledgeContext,
  trimMemoryContext,
  trimKnowledgeContext,
  buildContextBundle,
  buildMessages,
  extractMemoryWriteInstructions,
  performMemoryWriteback,
} from './context-utils.js';

const classifyStep = createStep({
  id: 'classify-intent',
  inputSchema: PromptOrchestrationInputSchema,
  outputSchema: PromptOrchestrationInputSchema.extend({
    classification: IntentClassificationOutputSchema,
  }),
  execute: async ({ inputData }) => ({
    ...inputData,
    classification: await executeIntentClassifier(inputData),
  }),
});

const memoryStep = createStep({
  id: 'fetch-memory',
  inputSchema: classifyStep.outputSchema,
  outputSchema: classifyStep.outputSchema.extend({
    memory_context: BusinessIntelligenceOrchestrationOutputSchema.shape.memory_context,
  }),
  execute: async ({ inputData }) => ({
    ...inputData,
    memory_context: await fetchMemoryContext(inputData.prompt, inputData.user_id),
  }),
});

const knowledgeStep = createStep({
  id: 'fetch-knowledge',
  inputSchema: memoryStep.outputSchema,
  outputSchema: memoryStep.outputSchema.extend({
    knowledge_context: BusinessIntelligenceOrchestrationOutputSchema.shape.knowledge_context,
  }),
  execute: async ({ inputData }) => {
    const knowledgeContext = await fetchKnowledgeContext(
      inputData.prompt,
      inputData.user_id,
      'workflow.business-intelligence-orchestration'
    );

    return {
      ...inputData,
      knowledge_context: knowledgeContext,
    };
  },
});

const planningStep = createStep({
  id: 'planning',
  inputSchema: knowledgeStep.outputSchema,
  outputSchema: knowledgeStep.outputSchema.extend({ plan: BusinessIntelligenceOrchestrationOutputSchema.shape.plan, confidence_score: BusinessIntelligenceOrchestrationOutputSchema.shape.confidence_score }),
  execute: async ({ inputData }) => {
    const planResult = await executePlanning({
      query: inputData.prompt,
      user_id: inputData.user_id,
      knowledge_context: inputData.knowledge_context,
    });

    return {
      ...inputData,
      plan: planResult.plan,
      confidence_score: planResult.confidence_score,
    };
  },
});

const compileContextStep = createStep({
  id: 'compile-context',
  inputSchema: planningStep.outputSchema,
  outputSchema: planningStep.outputSchema.extend({
    context_bundle: BusinessIntelligenceOrchestrationOutputSchema.shape.context_bundle,
    memory_context: BusinessIntelligenceOrchestrationOutputSchema.shape.memory_context,
    knowledge_context: BusinessIntelligenceOrchestrationOutputSchema.shape.knowledge_context,
  }),
  execute: async ({ inputData }) => {
    const trimmedMemory = trimMemoryContext(inputData.memory_context as MemoryContext[]);
    const trimmedKnowledge = trimKnowledgeContext(inputData.knowledge_context as KnowledgeContext[]);
    const contextBundle = buildContextBundle(trimmedMemory, trimmedKnowledge);

    return {
      ...inputData,
      context_bundle: contextBundle,
      memory_context: contextBundle.memory,
      knowledge_context: contextBundle.knowledge,
    };
  },
});

const executeAgentStep = createStep({
  id: 'execute-agent',
  inputSchema: compileContextStep.outputSchema,
  outputSchema: compileContextStep.outputSchema.extend({
    selected_agent: BusinessIntelligenceOrchestrationOutputSchema.shape.selected_agent,
    agent_response: BusinessIntelligenceOrchestrationOutputSchema.shape.agent_response,
    trace_id: BusinessIntelligenceOrchestrationOutputSchema.shape.trace_id,
  }),
  execute: async ({ inputData }) => {
    const planMessages = buildMessages(
      inputData.prompt,
      inputData.context_bundle as ContextBundle,
      Array.isArray(inputData.context?.messages) ? (inputData.context.messages as Message[]) : undefined,
    );

    planMessages.push({
      role: 'system',
      content: formatPlanForSystemPrompt(inputData.plan),
    });

    const request: ChatCompletionRequest = {
      model: 'business-intelligence-agent',
      messages: planMessages,
      stream: false,
    };

    const response = await executeBusinessIntelligenceAgent(request, {
      userId: inputData.user_id,
      conversationId: inputData.conversation_id,
    });

    return {
      ...inputData,
      selected_agent: 'business-intelligence-agent',
      agent_response: response,
      trace_id: (response as any)?.traceId || undefined,
    };
  },
});

const memoryWriteStep = createStep({
  id: 'summary-writeback',
  inputSchema: executeAgentStep.outputSchema,
  outputSchema: BusinessIntelligenceOrchestrationOutputSchema,
  execute: async ({ inputData }) => {
    const instructions = enrichMemoryInstructions(
      extractMemoryWriteInstructions(inputData.agent_response),
      {
        userId: inputData.user_id,
        plan: inputData.plan as PlanningStep[],
        confidence: inputData.confidence_score,
        summary: extractAgentSummary(inputData.agent_response),
        knowledgeContext: inputData.knowledge_context as KnowledgeContext[],
      }
    );

    const writeResults = await performMemoryWriteback(instructions, {
      userId: inputData.user_id,
      workflowId: 'workflow.business-intelligence-orchestration',
      contextBundle: inputData.context_bundle as ContextBundle,
      defaultScope: 'global',
    });

    const executionPath = ['fetch-memory', 'fetch-knowledge', 'planning', 'compile-context', 'execute-agent'];
    if (writeResults.length > 0) {
      executionPath.push('summary-writeback');
    }

    return {
      selected_agent: inputData.selected_agent,
      agent_response: inputData.agent_response,
      classification: inputData.classification,
      plan: inputData.plan,
      knowledge_context: inputData.knowledge_context,
      memory_context: inputData.memory_context,
      context_bundle: inputData.context_bundle,
      confidence_score: inputData.confidence_score,
      execution_path: executionPath,
      performance_metrics: {
        total_time_ms: 0,
      },
      trace_id: inputData.trace_id,
      memory_write_results: writeResults.length ? writeResults : undefined,
    } satisfies BusinessIntelligenceOrchestrationOutput;
  },
});

export const businessIntelligenceOrchestrationWorkflow = createWorkflow({
  id: 'business-intelligence-orchestration',
  inputSchema: PromptOrchestrationInputSchema,
  outputSchema: BusinessIntelligenceOrchestrationOutputSchema,
})
  .then(classifyStep)
  .then(memoryStep)
  .then(knowledgeStep)
  .then(planningStep)
  .then(compileContextStep)
  .then(executeAgentStep)
  .then(memoryWriteStep)
  .commit();

export async function executeBusinessIntelligenceOrchestration(input: PromptOrchestrationInput): Promise<BusinessIntelligenceOrchestrationOutput> {
  const run = await businessIntelligenceOrchestrationWorkflow.createRunAsync();
  const result = await run.start({ inputData: input });
  if (result.status !== 'success') {
    const error = (result as { error?: unknown }).error;
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('business-intelligence-orchestration workflow failed');
  }
  return result.result as BusinessIntelligenceOrchestrationOutput;
}

function formatPlanForSystemPrompt(plan: BusinessIntelligenceOrchestrationOutput['plan']): string {
  const lines = plan.map(step => `${step.step_number}. [${step.tool}] ${step.action} → ${step.expected_output}`);
  return `Execution plan:\n${lines.join('\n')}`;
}

function extractAgentSummary(agentResponse: any): string | null {
  if (!agentResponse) return null;
  if (typeof agentResponse.text === 'string' && agentResponse.text.trim().length > 0) {
    return agentResponse.text.trim();
  }

  if (typeof agentResponse.result === 'string' && agentResponse.result.trim().length > 0) {
    return agentResponse.result.trim();
  }

  if (Array.isArray(agentResponse.messages)) {
    const combined = agentResponse.messages
      .map((msg: any) => (typeof msg.content === 'string' ? msg.content.trim() : ''))
      .filter(Boolean)
      .join('\n');
    if (combined) return combined;
  }

  return null;
}

function enrichMemoryInstructions(
  existingInstructions: MemoryWriteInstruction[],
  options: {
    userId?: string;
    plan?: PlanningStep[];
    confidence?: number | null;
    summary?: string | null;
    knowledgeContext: KnowledgeContext[];
  }
): MemoryWriteInstruction[] {
  const instructions: MemoryWriteInstruction[] = [...existingInstructions];

  const highConfidence = (options.confidence ?? 0) >= 0.7;
  const summary = options.summary?.trim();

  if (highConfidence && summary) {
    const knowledgeSources = options.knowledgeContext
      .map(snippet => snippet.sourceId)
      .filter(Boolean);

    instructions.push({
      scope: 'global',
      content: summary,
      tags: ['business-intelligence', 'summary'],
      metadata: {
        confidence: options.confidence,
        plan: options.plan,
        knowledge_sources: knowledgeSources,
      },
    });

    if (options.userId) {
      instructions.push({
        scope: 'user',
        content: summary,
        tags: ['business-intelligence', 'summary'],
        metadata: {
          confidence: options.confidence,
          knowledge_sources: knowledgeSources,
        },
      });
    }
  }

  return instructions;
}
