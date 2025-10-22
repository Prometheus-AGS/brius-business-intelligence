import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';

const DEFAULT_AGENT_INSTRUCTIONS = `You are a helpful and efficient business assistant specialized in handling straightforward queries and tasks.

## Your Role & Specialization
You handle **simple, direct business questions** that don't require complex analysis or multi-step workflows:
- General information and clarifications
- Basic business concepts and definitions
- Simple calculations and conversions
- Quick lookups and direct data requests
- Procedural guidance and how-to questions
- Status updates and simple reporting

## Core Capabilities
- **Quick Response**: Provide immediate, concise answers for straightforward questions
- **Tool Access**: Use available tools for simple data retrieval and basic operations
- **Context Awareness**: Leverage memory and knowledge base for personalized responses
- **Clear Communication**: Deliver information in easily digestible formats
- **Smart Escalation**: Recognize when queries need specialized analysis

## When to Escalate vs. Handle Directly

### ✅ Handle Directly (Your Expertise):
- "What is our customer retention rate?"
- "How do I access the sales dashboard?"
- "What are the office hours for our clinic?"
- "Can you explain what ROI means?"
- "Show me the latest monthly revenue figure"
- "How do I reset my password?"
- "What's the status of project X?"

### 🔄 Suggest Escalation (Complex Analysis Needed):
- Trend analysis across multiple time periods
- Root cause analysis or diagnostic questions
- Predictive forecasting or modeling
- Strategic recommendations involving multiple variables
- Comparative analysis across market segments
- Multi-factor correlation studies
- Executive decision support requiring deep insights

## Response Standards
- **Concise**: Keep responses focused and actionable
- **Accurate**: Use available data and tools when possible
- **Helpful**: Provide next steps or related resources when appropriate
- **Honest**: Clearly state limitations and suggest alternatives when needed

## Escalation Protocol
When you encounter complex analytical requests:
1. Acknowledge the complexity of the request
2. Explain why deeper analysis would be valuable
3. Suggest: "This question would benefit from our advanced business intelligence capabilities. Would you like me to route this to our specialized analysis system?"
4. Offer to help with any simpler aspects of the question in the meantime

You're designed to be fast, efficient, and helpful for everyday business needs while ensuring complex analytical work gets the specialized attention it deserves.`;

export const defaultAgent = new Agent({
  name: 'default-agent',
  description: 'Efficient assistant for straightforward business questions, simple data requests, and general support with smart escalation capabilities.',
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

  // Extract user query for logging and validation
  const userQuery = input.messages[input.messages.length - 1]?.content || '';

  console.log('🔧 Default Agent executing simple query:', {
    query: userQuery.substring(0, 100) + (userQuery.length > 100 ? '...' : ''),
    userId: context.userId,
    sessionId: context.sessionId,
  });

  const options: Record<string, string> = {};
  if (context.conversationId ?? context.sessionId) {
    options.threadId = String(context.conversationId ?? context.sessionId);
  }
  if (context.userId) {
    options.resourceId = context.userId;
  }

  try {
    const startTime = Date.now();
    const result = await defaultAgent.generateLegacy(input.messages as any, options);
    const executionTime = Date.now() - startTime;

    console.log('✅ Default Agent completed:', {
      executionTime: `${executionTime}ms`,
      responseLength: (result.text || (result as any).content || '').length,
    });

    // Add metadata to response for better tracking
    if (typeof result === 'object' && result !== null) {
      (result as any).metadata = {
        agent: 'default-agent',
        execution_time_ms: executionTime,
        query_type: 'simple',
        ...(result as any).metadata,
      };
    }

    return result;

  } catch (error) {
    console.error('❌ Default Agent execution failed:', error);

    // Return a helpful error response
    return {
      text: 'I apologize, but I encountered an issue processing your request. Please try rephrasing your question or contact support if the problem persists.',
      content: 'Error in default agent execution',
      metadata: {
        agent: 'default-agent',
        error: true,
        query_type: 'simple',
      },
    };
  }
}

// Streaming version of the default agent
export async function executeDefaultAgentStream(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  } = {}
) {
  await ensureMcpToolsLoaded();

  const userQuery = input.messages[input.messages.length - 1]?.content || '';

  console.log('🔧 Default Agent streaming simple query:', {
    query: userQuery.substring(0, 100) + (userQuery.length > 100 ? '...' : ''),
    userId: context.userId,
    sessionId: context.sessionId,
  });

  const options: Record<string, string> = {};
  if (context.conversationId ?? context.sessionId) {
    options.threadId = String(context.conversationId ?? context.sessionId);
  }
  if (context.userId) {
    options.resourceId = context.userId;
  }

  try {
    const stream = await defaultAgent.stream(input.messages as any, options);

    console.log('✅ Default Agent streaming started:', {
      query: `${userQuery.substring(0, 50)}...`,
    });

    return stream;

  } catch (error) {
    console.error('❌ Default Agent streaming failed:', error);
    throw error;
  }
}
