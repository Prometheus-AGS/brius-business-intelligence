import { Agent } from '@mastra/core';
import { AgentConfig, Message, ChatCompletionRequest } from '../types/index.js';
import { agentLogger } from '../observability/logger.js';
import { getAgentInteractionTracer, AgentExecutionContext } from '../observability/agent-tracer.js';
import { BaseAgent, EnhancedAgentContext } from './base-agent.js';
import { sharedTools } from './shared-tools.js';

/**
 * Business Intelligence Agent
 * Specialized for complex analytical queries with knowledge-first planning
 * Handles multi-step business analysis, data interpretation, and insights generation
 */

const BUSINESS_INTELLIGENCE_INSTRUCTIONS = `You are an expert Business Intelligence analyst with deep knowledge of data analysis, business metrics, and strategic insights.

## Core Capabilities

**Analytical Expertise:**
- Financial analysis (revenue, profit, margins, growth rates, ROI, KPIs)
- Customer analysis (segmentation, lifetime value, churn, acquisition costs)
- Market analysis (trends, competitive intelligence, market share)
- Operational metrics (efficiency, productivity, performance indicators)
- Statistical analysis (correlations, distributions, significance testing)

**Planning Approach:**
1. **Knowledge First**: Always search relevant knowledge base for context, definitions, and historical data
2. **Structured Analysis**: Break complex queries into logical analytical steps
3. **Data Requirements**: Identify specific data sources, timeframes, and metrics needed
4. **Methodology**: Choose appropriate analytical methods and calculations
5. **Validation**: Cross-reference findings with business context and domain knowledge

**Communication Style:**
- Provide executive-level insights with supporting details
- Use clear business language avoiding unnecessary jargon
- Include confidence levels and assumptions in your analysis
- Suggest actionable recommendations based on findings
- Reference data sources and methodology for transparency

## Tools Available

You have access to:
- **Knowledge Search**: Find relevant business context, definitions, and historical analyses
- **Memory Search**: Retrieve user preferences, previous analyses, and context
- **MCP Tools**: External data sources and business systems integration
- **Planning Workflow**: For complex multi-step analyses

## Response Format

**For Complex Analyses:**
1. **Context**: Summarize relevant background from knowledge base
2. **Approach**: Outline analytical methodology and steps
3. **Analysis**: Present findings with supporting data and calculations
4. **Insights**: Interpret results in business context
5. **Recommendations**: Suggest specific actions based on findings
6. **Confidence**: Note limitations, assumptions, and confidence levels

**For Clarifications:**
- Ask specific questions to better understand requirements
- Suggest alternative approaches or additional analyses
- Recommend data sources or metrics that might be relevant

Remember: You're not just providing data - you're providing business intelligence that drives decision-making.`;

export const businessIntelligenceAgent = new Agent({
  name: 'business-intelligence-agent',
  instructions: BUSINESS_INTELLIGENCE_INSTRUCTIONS,
  model: 'gpt-4o-mini',
  tools: sharedTools, // Includes memory tools, knowledge search, and business calculations
  temperature: 0.1, // Lower temperature for more consistent analytical responses
});

/**
 * Enhanced Business Intelligence Agent with Comprehensive Tracing
 * Constitutional requirement: Complete observability for all agent interactions
 */
export class EnhancedBusinessIntelligenceAgent extends BaseAgent {
  private coreAgent: Agent;

  constructor() {
    super('business-intelligence-agent', '1.0.0', {
      enabled: true,
      logInputs: true,
      logOutputs: true,
      logErrors: true,
      logPerformance: true,
      logUserAttribution: true,
      logConversationContext: true,
      logBusinessContext: true,
      maxInputSize: 30000, // Larger for business queries
      maxOutputSize: 200000, // Larger for comprehensive reports
    });

    this.coreAgent = businessIntelligenceAgent;
  }

  /**
   * Execute agent with comprehensive observability and context injection
   */
  async execute(
    input: ChatCompletionRequest,
    context: EnhancedAgentContext & {
      userMemories?: any[];
      globalMemories?: any[];
      knowledgeContext?: any[];
    } = {}
  ): Promise<any> {
    return await this.executeWithLogging(
      input,
      context,
      async () => {
        // Inject context into system message
        const enhancedMessages = injectContextIntoMessages(
          input.messages,
          context.userMemories,
          context.globalMemories,
          context.knowledgeContext
        );

        const enhancedInput = {
          ...input,
          messages: enhancedMessages,
          temperature: 0.1,
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
 * Enhanced execute method with comprehensive observability and context injection
 */
export async function executeBusinessIntelligenceAgent(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
    userMemories?: any[];
    globalMemories?: any[];
    knowledgeContext?: any[];
  } = {}
): Promise<any> {
  const tracer = getAgentInteractionTracer();

  const agentContext: AgentExecutionContext = {
    agentId: 'business-intelligence-agent',
    agentName: 'Business Intelligence Agent',
    userId: context.userId,
    sessionId: context.sessionId,
    metadata: {
      conversation_id: context.conversationId,
      model: 'gpt-4o-mini',
      temperature: 0.1,
      agent_type: 'business_intelligence',
      has_user_memories: Boolean(context.userMemories?.length),
      has_global_memories: Boolean(context.globalMemories?.length),
      has_knowledge_context: Boolean(context.knowledgeContext?.length),
      message_count: input.messages.length,
    },
  };

  const inputData = {
    messages: input.messages,
    model: input.model || 'gpt-4o-mini',
    temperature: 0.1,
    context: {
      userMemories: context.userMemories?.length || 0,
      globalMemories: context.globalMemories?.length || 0,
      knowledgeContext: context.knowledgeContext?.length || 0,
    },
  };

  return await tracer.traceAgentExecution(agentContext, inputData, async () => {
    agentLogger.info('Business Intelligence Agent starting', {
      user_id: context.userId,
      conversation_id: context.conversationId,
      message_count: input.messages.length,
      has_context: Boolean(context.userMemories || context.globalMemories || context.knowledgeContext),
    });

    // Inject context into system message
    const enhancedMessages = injectContextIntoMessages(
      input.messages,
      context.userMemories,
      context.globalMemories,
      context.knowledgeContext
    );

    const enhancedInput = {
      ...input,
      messages: enhancedMessages,
      temperature: 0.1,
    };

    // Execute agent with enhanced input
    const response = await businessIntelligenceAgent.generate(enhancedInput, {
      userId: context.userId,
    });

    agentLogger.info('Business Intelligence Agent completed', {
      user_id: context.userId,
      conversation_id: context.conversationId,
      response_length: JSON.stringify(response).length,
    });

    return response;
  });
}

/**
 * Injects context (memories and knowledge) into the conversation
 */
function injectContextIntoMessages(
  messages: Message[],
  userMemories?: any[],
  globalMemories?: any[],
  knowledgeContext?: any[]
): Message[] {
  const contextParts: string[] = [];

  // Add knowledge context
  if (knowledgeContext && knowledgeContext.length > 0) {
    contextParts.push('## Relevant Knowledge Base Context');
    knowledgeContext.forEach((item, index) => {
      contextParts.push(`${index + 1}. ${item.content} (Source: ${item.source || 'Knowledge Base'})`);
    });
    contextParts.push('');
  }

  // Add global organizational memory
  if (globalMemories && globalMemories.length > 0) {
    contextParts.push('## Organizational Context');
    globalMemories.forEach((memory, index) => {
      contextParts.push(`${index + 1}. ${memory.content}`);
    });
    contextParts.push('');
  }

  // Add user personal context
  if (userMemories && userMemories.length > 0) {
    contextParts.push('## User Context & Preferences');
    userMemories.forEach((memory, index) => {
      contextParts.push(`${index + 1}. ${memory.content}`);
    });
    contextParts.push('');
  }

  // If no context, return original messages
  if (contextParts.length === 0) {
    return messages;
  }

  // Create enhanced system message
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
      content: `${BUSINESS_INTELLIGENCE_INSTRUCTIONS}\n\n${contextMessage}`,
    };

    return [systemMessage, ...messages];
  }
}

/**
 * Configuration object for registration with Mastra
 */
export const businessIntelligenceConfig: AgentConfig = {
  id: 'business-intelligence-agent',
  name: 'Business Intelligence Agent',
  description: 'Expert analyst for complex business queries, financial analysis, and strategic insights with knowledge-first planning',
  instructions: BUSINESS_INTELLIGENCE_INSTRUCTIONS,
  model: 'gpt-4o-mini',
  temperature: 0.1,
  max_tokens: 2000,
  tools: sharedTools, // Includes memory tools, knowledge search, and business calculations
  memory_enabled: true,
  knowledge_enabled: true,
};