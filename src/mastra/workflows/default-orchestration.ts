import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  PromptOrchestrationInputSchema,
  DefaultOrchestrationOutputSchema,
  IntentClassificationOutputSchema,
  type PromptOrchestrationInput,
  type DefaultOrchestrationOutput,
  type ContextBundle,
  type MemoryContext,
  type KnowledgeContext,
} from '../types/workflows.js';
import { executeIntentClassifier } from './intent-classifier.js';
import { executeDefaultAgent } from '../agents/default.js';
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
  outputSchema: PromptOrchestrationInputSchema.extend({ classification: IntentClassificationOutputSchema }),
  execute: async ({ inputData }) => ({
    ...inputData,
    classification: await executeIntentClassifier(inputData),
  }),
});

const memoryStep = createStep({
  id: 'fetch-memory',
  inputSchema: classifyStep.outputSchema,
  outputSchema: classifyStep.outputSchema.extend({
    memory_context: DefaultOrchestrationOutputSchema.shape.memory_context,
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
    knowledge_context: DefaultOrchestrationOutputSchema.shape.knowledge_context,
  }),
  execute: async ({ inputData }) => {
    const knowledgeContext = await fetchKnowledgeContext(
      inputData.prompt,
      inputData.user_id,
      'workflow.default-orchestration'
    );

    return {
      ...inputData,
      knowledge_context: knowledgeContext,
    };
  },
});

const compileContextStep = createStep({
  id: 'compile-context',
  inputSchema: knowledgeStep.outputSchema,
  outputSchema: knowledgeStep.outputSchema.extend({
    context_bundle: DefaultOrchestrationOutputSchema.shape.context_bundle,
    memory_context: DefaultOrchestrationOutputSchema.shape.memory_context,
    knowledge_context: DefaultOrchestrationOutputSchema.shape.knowledge_context,
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
    selected_agent: DefaultOrchestrationOutputSchema.shape.selected_agent,
    agent_response: DefaultOrchestrationOutputSchema.shape.agent_response,
    trace_id: DefaultOrchestrationOutputSchema.shape.trace_id,
  }),
  execute: async ({ inputData }) => {
    const messages = buildMessages(
      inputData.prompt,
      inputData.context_bundle as ContextBundle,
      Array.isArray(inputData.context?.messages) ? (inputData.context.messages as Message[]) : undefined,
    );

    const request: ChatCompletionRequest = {
      model: 'default-agent',
      messages,
      stream: false,
    };

    const response = await executeDefaultAgent(request, {
      userId: inputData.user_id,
      conversationId: inputData.conversation_id,
    });

    return {
      ...inputData,
      selected_agent: 'default-agent',
      agent_response: response,
      trace_id: (response as any)?.traceId || undefined,
    };
  },
});

const memoryWriteStep = createStep({
  id: 'memory-writeback',
  inputSchema: executeAgentStep.outputSchema,
  outputSchema: DefaultOrchestrationOutputSchema,
  execute: async ({ inputData }) => {
    const instructions = extractMemoryWriteInstructions(inputData.agent_response);
    const writeResults = await performMemoryWriteback(instructions, {
      userId: inputData.user_id,
      workflowId: 'workflow.default-orchestration',
      contextBundle: inputData.context_bundle as ContextBundle,
    });

    const executionPath = ['fetch-memory', 'fetch-knowledge', 'compile-context', 'execute-agent'];
    if (writeResults.length > 0) {
      executionPath.push('memory-writeback');
    }

    return {
      selected_agent: inputData.selected_agent,
      agent_response: inputData.agent_response,
      classification: inputData.classification,
      memory_context: inputData.memory_context,
      knowledge_context: inputData.knowledge_context,
      context_bundle: inputData.context_bundle,
      execution_path: executionPath,
      performance_metrics: {
        total_time_ms: 0,
      },
      trace_id: inputData.trace_id,
      memory_write_results: writeResults.length ? writeResults : undefined,
    } satisfies DefaultOrchestrationOutput;
  },
});

export const defaultOrchestrationWorkflow = createWorkflow({
  id: 'default-orchestration',
  inputSchema: PromptOrchestrationInputSchema,
  outputSchema: DefaultOrchestrationOutputSchema,
})
  .then(classifyStep)
  .then(memoryStep)
  .then(knowledgeStep)
  .then(compileContextStep)
  .then(executeAgentStep)
  .then(memoryWriteStep)
  .commit();

export async function executeDefaultOrchestration(input: PromptOrchestrationInput): Promise<DefaultOrchestrationOutput> {
  const run = await defaultOrchestrationWorkflow.createRunAsync();
  const result = await run.start({ inputData: input });
  if (result.status !== 'success') {
    const error = (result as { error?: unknown }).error;
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('default-orchestration workflow failed');
  }
  return result.result as DefaultOrchestrationOutput;
}
