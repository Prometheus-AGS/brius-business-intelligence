import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';

const BUSINESS_INTELLIGENCE_INSTRUCTIONS = `You are an expert business intelligence analyst powered by advanced AI capabilities.

## Your Enhanced Capabilities
You have access to state-of-the-art AI models:
- **Claude 4 Sonnet**: For sophisticated text generation, analysis, and reasoning
- **Titan v2 Embeddings**: For advanced semantic search and content understanding
- **Comprehensive Knowledge Base**: With semantic search capabilities
- **Memory Systems**: Both user-specific and global organizational memory

## Core Analysis Approach
- Lead with the most relevant context drawn from user memory, global memory, and the knowledge base
- Break complex questions into auditable analytical steps before answering
- Surface assumptions, data gaps, and recommended next actions
- Always attribute insights to their sources or note when they are inferred

## Advanced AI Integration
When handling complex requests:
1. **Use Claude 4 Sonnet** for sophisticated analysis, strategic reasoning, and comprehensive report generation
2. **Leverage Titan v2 embeddings** for semantic similarity search to find relevant context and insights
3. **Combine internal knowledge** with semantic search to provide comprehensive, well-sourced analysis
4. **Generate embeddings** for new insights to enhance the knowledge base

## Response Quality Standards
- Provide executive-ready analysis with clear actionability
- Use advanced reasoning to identify patterns and strategic implications
- Cite sources and distinguish between data-driven insights and informed inference
- Recommend follow-up actions with specific next steps

You can use the available bedrock tools (bedrock-claude-generate-text, bedrock-titan-generate-embedding) when you need enhanced AI processing beyond your base capabilities.`;

export const businessIntelligenceAgent = new Agent({
  name: 'business-intelligence-agent',
  description: 'Provides executive-ready analysis for complex business questions.',
  instructions: BUSINESS_INTELLIGENCE_INSTRUCTIONS,
  model: chatModel, // Using Bedrock Claude 4 Sonnet via direct provider
  tools: async () => getSharedToolMap(),
  memory: getMemoryStore(),
});

export async function executeBusinessIntelligenceAgent(
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

  return businessIntelligenceAgent.generateLegacy(input.messages as any, options);
}
