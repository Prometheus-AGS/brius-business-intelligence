import { Agent } from '@mastra/core';
import { AgentConfig, Message, ChatCompletionRequest } from '../types/index.js';
import { agentLogger } from '../observability/logger.js';
import { getAgentInteractionTracer, AgentExecutionContext } from '../observability/agent-tracer.js';
import { BaseAgent, EnhancedAgentContext } from './base-agent.js';
import { getToolsByCategory } from './shared-tools.js';

/**
 * Default Agent
 * Handles simple queries, general questions, and quick responses
 * Optimized for speed and efficiency for straightforward requests
 */

const DEFAULT_AGENT_INSTRUCTIONS = `You are a helpful, knowledgeable assistant for business intelligence and general queries.

## Core Capabilities

**General Assistance:**
- Answer straightforward questions clearly and concisely
- Provide definitions, explanations, and basic information
- Help with simple calculations and conversions
- Offer guidance on business intelligence concepts and tools

**Business Context:**
- Basic business metrics and KPI explanations
- Simple data interpretation and insights
- General analytics and reporting guidance
- Technology and tool recommendations

**Communication Style:**
- Clear, direct, and friendly responses
- Use simple language and avoid unnecessary complexity
- Provide specific, actionable answers
- Ask clarifying questions when needed

## Response Guidelines

**For Simple Questions:**
- Give direct answers with brief explanations
- Include relevant context when helpful
- Suggest related topics or follow-up questions

**For Unclear Requests:**
- Ask specific clarifying questions
- Suggest what type of information might be helpful
- Offer to escalate to specialized analysis if needed

**For Complex Queries:**
- Acknowledge the complexity
- Provide what basic information you can
- Suggest using the Business Intelligence Agent for detailed analysis
- Explain why specialized analysis would be beneficial

Remember: You're optimized for quick, helpful responses to everyday questions and simple business intelligence needs.`;

export const defaultAgent = new Agent({
  name: 'default-agent',
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  model: 'gpt-4o-mini',
  tools: getToolsByCategory('memory'), // Give default agent memory tools for user context
  temperature: 0.3, // Slightly higher temperature for more natural conversation
});

/**
 * Enhanced Default Agent with Comprehensive Tracing
 * Constitutional requirement: Complete observability for all agent interactions
 */
export class EnhancedDefaultAgent extends BaseAgent {
  private coreAgent: Agent;

  constructor() {
    super('default-agent', '1.0.0', {
      enabled: true,
      logInputs: true,
      logOutputs: true,
      logErrors: true,
      logPerformance: true,
      logUserAttribution: true,
      logConversationContext: true,
      logBusinessContext: false, // Default agent focuses on simplicity
      maxInputSize: 10000, // Smaller for simple queries
      maxOutputSize: 50000, // Smaller for quick responses
    });

    this.coreAgent = defaultAgent;
  }

  /**
   * Execute agent with comprehensive observability and light context injection
   */
  async execute(
    input: ChatCompletionRequest,
    context: EnhancedAgentContext & {
      userMemories?: any[];
    } = {}
  ): Promise<any> {
    return await this.executeWithLogging(
      input,
      context,
      async () => {
        // Light context injection for fast responses
        const enhancedMessages = injectLightContext(
          input.messages,
          context.userMemories
        );

        const enhancedInput = {
          ...input,
          messages: enhancedMessages,
          temperature: 0.3,
          max_tokens: 1000,
        };

        // Execute agent with enhanced input and full observability
        const response = await this.coreAgent.generate(enhancedInput, {
          userId: context.userId,
        });

        return response;
      }
    );
  }
}

/**
 * Enhanced execute method with comprehensive observability
 */
export async function executeDefaultAgent(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
    userMemories?: any[];
  } = {}
): Promise<any> {
  const tracer = getAgentInteractionTracer();

  const agentContext: AgentExecutionContext = {
    agentId: 'default-agent',
    agentName: 'Default Agent',
    userId: context.userId,
    sessionId: context.sessionId,
    metadata: {
      conversation_id: context.conversationId,
      model: 'gpt-4o-mini',
      temperature: 0.3,
      agent_type: 'default',
      has_user_memories: Boolean(context.userMemories?.length),
      message_count: input.messages.length,
      max_tokens: 1000,
    },
  };

  const inputData = {
    messages: input.messages,
    model: input.model || 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 1000,
    context: {
      userMemories: context.userMemories?.length || 0,
    },
  };

  return await tracer.traceAgentExecution(agentContext, inputData, async () => {
    agentLogger.info('Default Agent starting', {
      user_id: context.userId,
      conversation_id: context.conversationId,
      message_count: input.messages.length,
      has_user_context: Boolean(context.userMemories),
    });

    // Light context injection (user preferences only)
    const enhancedMessages = injectLightContext(input.messages, context.userMemories);

    const enhancedInput = {
      ...input,
      messages: enhancedMessages,
      temperature: 0.3,
      max_tokens: 1000, // Shorter responses for simple queries
    };

    // Execute agent
    const response = await defaultAgent.generate(enhancedInput, {
      userId: context.userId,
    });

    agentLogger.info('Default Agent completed', {
      user_id: context.userId,
      conversation_id: context.conversationId,
      response_length: JSON.stringify(response).length,
    });

    return response;
  });
}

/**
 * Light context injection for simple queries
 * Only includes essential user preferences to keep responses fast
 */
function injectLightContext(
  messages: Message[],
  userMemories?: any[]
): Message[] {
  // For default agent, only inject high-importance user preferences
  const relevantMemories = userMemories?.filter(memory =>
    memory.metadata?.importance === 'high' ||
    memory.metadata?.category === 'preference'
  ).slice(0, 3); // Limit to 3 most relevant

  if (!relevantMemories || relevantMemories.length === 0) {
    return messages;
  }

  const contextParts: string[] = [];
  contextParts.push('## User Preferences');
  relevantMemories.forEach((memory, index) => {
    contextParts.push(`${index + 1}. ${memory.content}`);
  });

  const contextMessage = contextParts.join('\n');
  const existingSystemMessage = messages.find(m => m.role === 'system');

  if (existingSystemMessage) {
    // Append context to existing system message
    const enhancedSystemMessage: Message = {
      ...existingSystemMessage,
      content: `${existingSystemMessage.content}\n\n${contextMessage}`,
    };

    return messages.map(m => m.role === 'system' ? enhancedSystemMessage : m);
  } else {
    // Add new system message with context
    const systemMessage: Message = {
      role: 'system',
      content: `${DEFAULT_AGENT_INSTRUCTIONS}\n\n${contextMessage}`,
    };

    return [systemMessage, ...messages];
  }
}

/**
 * Configuration object for registration with Mastra
 */
export const defaultAgentConfig: AgentConfig = {
  id: 'default-agent',
  name: 'Default Agent',
  description: 'General-purpose assistant for simple queries, basic questions, and quick responses',
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  model: 'gpt-4o-mini',
  temperature: 0.3,
  max_tokens: 1000,
  tools: getToolsByCategory('memory'), // Memory tools for user context
  memory_enabled: true,
  knowledge_enabled: false, // Default agent doesn't use knowledge base for speed
};