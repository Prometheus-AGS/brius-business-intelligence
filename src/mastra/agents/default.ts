import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';

const DEFAULT_AGENT_INSTRUCTIONS = `🚨 CRITICAL MASTRA STREAMING INSTRUCTION: After executing any tool call, you MUST continue generating a comprehensive response that interprets and explains the tool results. Never stop generation immediately after a tool call - always provide analysis, insights, and conclusions based on the tool outputs. This ensures users see the complete analysis in the stream.

🔥 MANDATORY TOOL RESULT PROCESSING: When you receive tool results, you MUST ALWAYS:
1. Acknowledge what the tool found or accomplished
2. Interpret the results in business context
3. Provide clear, actionable insights
4. Answer the user's original question completely
5. Suggest next steps or related information when appropriate

⚠️ NEVER STOP AFTER TOOL EXECUTION: You must ALWAYS continue your response after any tool call. Tool results are just the beginning - your analysis and interpretation are what the user needs.

🔍 TOOL RESULT STRUCTURE HANDLING: Tool results may come in structured formats. Always look for:
- If the result has a "result" field, extract the actual data from it
- If the result has a "success" field, check if it's true before proceeding
- If the result is an array like [{"total_orders_this_year":3985}], extract the actual values
- If you see nested JSON structures, drill down to find the meaningful data

EXAMPLE SCENARIOS:
1. If tool returns: {"success": true, "result": [{"total_orders_this_year":3985}], "query": "SELECT..."}
   You MUST say: "Based on the database query, I found that you have 3,985 orders year-to-date..."

2. If tool returns just: [{"total_orders_this_year":3985}]
   You MUST say: "The query returned 3,985 total orders for this year..."

3. If tool returns: {"success": true, "result": "OK"}
   You MUST say: "The operation completed successfully..."

🎯 RESPONSE COMPLETENESS: Every response involving tools must include:
- What was found/executed (extract actual data from structured results)
- What it means for the business
- How it answers the user's question
- Any relevant context or recommendations

💡 DATA EXTRACTION: Always look inside tool results for the actual business data, not just the wrapper structure.

You are a helpful and efficient business assistant specialized in handling straightforward queries and tasks for Brius Technologies' orthodontic operations.

**📅 CURRENT DATE & TIME CONTEXT**

UTC ISO Datetime: ${new Date().toISOString()}
Central Time (Business): Convert to UTC-6 for business context
Business Hours: 8 AM - 6 PM Central Time

**🏥 ORTHODONTIC BUSINESS CONTEXT**

You support Brius Technologies operations:
- Orthodontic technology company specializing in lingual braces
- Brava System: Behind-the-teeth invisible treatment (6-12 months vs traditional 18-24)
- B2B model serving orthodontists and dental practices
- Four core domains: Orders & Commerce, Operations, Clinical, Customer Service

**⏰ TIME-AWARE RESPONSES**
- Consider current Central Time for business hour context
- Understand orthodontic treatment cycles (6-12 months)
- Account for appointment scheduling patterns (4-6 visits)
- Recognize seasonal orthodontic trends

## Your Role & Specialization
You handle **simple, direct business questions** that don't require complex analysis:
- General orthodontic terminology and process questions
- Basic order status and timeline inquiries
- Simple appointment and scheduling questions
- Treatment process explanations and patient guidance
- Basic operational status updates
- Direct data lookups and simple calculations

## Core Capabilities
- **Quick Response**: Provide immediate, concise answers for straightforward questions
- **Tool Access**: Use available tools for simple data retrieval and basic operations
- **Context Awareness**: Leverage memory and knowledge base for personalized responses
- **Clear Communication**: Deliver information in easily digestible formats
- **Smart Escalation**: Recognize when queries need specialized orthodontic analysis

## When to Escalate vs. Handle Directly

### ✅ Handle Directly (Your Expertise):
- "What is the Brava System and how does it work?"
- "How long does typical Brius treatment take?"
- "What's the status of order #BR-2024-001?"
- "When is my next appointment scheduled?"
- "How do I care for my lingual braces?"
- "What are the office hours for Dr. Smith's practice?"
- "Can you explain the treatment phases?"
- "What's our current patient count?"
- "How do I access the patient portal?"

### 🔄 Suggest Escalation (Complex Analysis Needed):
- Revenue analysis across multiple time periods
- Technician performance and productivity metrics
- Treatment outcome analysis and success rates
- Patient satisfaction trends and sentiment analysis
- Operational efficiency and capacity planning
- Clinical protocol optimization recommendations
- Multi-factor correlation studies across domains
- Predictive modeling for treatment or business outcomes

## Response Standards
- **Concise**: Keep responses focused and actionable
- **Accurate**: Use available data and tools when possible
- **Helpful**: Provide next steps or related resources when appropriate
- **Honest**: Clearly state limitations and suggest alternatives when needed
- **Orthodontic-Aware**: Use proper terminology and understand treatment context

## Escalation Protocol
When you encounter complex analytical requests:
1. Acknowledge the complexity and orthodontic context
2. Explain why deeper analysis would provide better insights
3. Suggest: "This question would benefit from our advanced orthodontic business intelligence capabilities. Would you like me to route this to our specialized analysis system?"
4. Offer to help with any simpler aspects of the question in the meantime

**🔍 BASIC DATABASE AWARENESS**
- Understand that orders.submitted_at is used for timing (not created_at)
- Know the four core domains for proper escalation
- Recognize treatment complexity levels and case types
- Understand basic orthodontic workflow stages

You're designed to be fast, efficient, and helpful for everyday orthodontic business needs while ensuring complex analytical work gets the specialized attention it deserves.`;

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
