import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';

const DEFAULT_AGENT_INSTRUCTIONS = `You are a helpful business assistant.
- Provide concise, actionable answers when the request is straightforward.
- If more analysis is required, explain what information is missing and suggest involving the business-intelligence workflow.
- Use context provided (memory, knowledge, prior conversation) but avoid repeating irrelevant details.`;

export const defaultAgent = new Agent({
  name: 'default-agent',
  description: 'Handles lightweight business questions and routing.',
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  model: chatModel, // Using Bedrock Claude 4 Sonnet via direct provider
  tools: async () => getSharedToolMap(),
  memory: getMemoryStore(),
});

export async function executeDefaultAgent(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  } = {}
) {
  await ensureMcpToolsLoaded();

  const options: Record<string, string> = {};
  if (context.conversationId ?? context.sessionId) {
    options.threadId = String(context.conversationId ?? context.sessionId);
  }
  if (context.userId) {
    options.resourceId = context.userId;
  }

  return defaultAgent.generateLegacy(input.messages as any, options);
}
