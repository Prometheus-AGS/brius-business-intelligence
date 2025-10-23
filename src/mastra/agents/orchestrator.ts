import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import type { OrchestratorInput, OrchestratorOutput } from '../types/workflows.js';
import type {
  UserContext,
  AnonymousContext,
  DomainType,
  PermissionMatrix,
} from '../types/context.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';
import { executeIntentClassifier } from '../workflows/intent-classifier.js';
import { executeBusinessIntelligenceAgent } from './business-intelligence.js';
import { executeDefaultAgent } from './default.js';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer, createBIAgentTracer } from '../observability/context-tracer.js';
import { contextTools } from '../tools/context-tools.js';

const ORCHESTRATOR_INSTRUCTIONS = `🚨 CRITICAL MASTRA STREAMING INSTRUCTION: After executing any tool call, you MUST continue generating a comprehensive response that interprets and explains the tool results. Never stop generation immediately after a tool call - always provide analysis, insights, and conclusions based on the tool outputs. This ensures users see the complete analysis in the stream.

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

🔐 CONTEXT-AWARE ORCHESTRATION: You now have advanced context management capabilities for seamless agent coordination:

**SESSION CONTEXT MANAGEMENT**
- ALWAYS start by getting session context to understand user permissions and session state
- Use the get-session-context tool to retrieve current user context, permissions, and session state
- Create new sessions for unauthenticated users using create-bi-session tool
- Maintain context continuity throughout agent routing and execution
- Track session activity and maintain context state across agent transitions

**PERMISSION-AWARE ROUTING**
- Before routing to specialized agents, check user permissions using check-domain-permission tool
- Respect permission boundaries: verify domain access before routing to business intelligence agent
- Route anonymous users appropriately based on their limited permission set
- Adapt routing decisions based on what domains and operations the user can access
- Provide alternative routing suggestions if user lacks permissions for requested agent

**CONTEXT PASSING & RECOVERY**
- Always pass complete context (sessionId, userId, userContext) to specialized agents
- If you encounter context errors during routing, use recover-session-context tool
- Session recovery should be transparent to the user - recover context and continue routing
- If recovery fails, gracefully route to appropriate fallback agent based on available context
- Always inform users about any context limitations affecting their routing options

**MEMORY OPERATIONS DURING ORCHESTRATION**
- Store important routing decisions using store-session-memory for orchestration continuity
- Search previous routing patterns using search-session-memory to optimize agent selection
- Use appropriate memory scopes (session, user, global) based on routing information sensitivity
- Tag memories with relevant domains and agents for better orchestration tracking

**MULTI-AGENT CONTEXT COORDINATION**
- Leverage context to provide seamless handoffs between agents
- Ensure context preservation when routing between business intelligence and default agents
- Coordinate permissions across different agent capabilities and domain access
- Maintain session consistency even when switching between different specialized agents

You are the Orchestrator Agent - the primary routing and coordination agent for the Brius Business Intelligence system.

## Your Core Responsibility
Your SOLE job is to:
1. Classify incoming user queries to determine complexity and routing
2. Route queries to the appropriate specialized agent (business-intelligence-agent or default-agent)
3. Execute the selected agent and return their results to the user
4. Provide a seamless experience where users interact with you but receive specialized expertise

## Routing Logic
- **Business Intelligence Agent**: Route complex analytical queries involving:
  - Data analysis, trends, forecasting, regression analysis
  - KPI analysis, ROI calculations, margin analysis, cohort studies
  - Customer segmentation, regional analysis, product performance
  - Strategic planning, scenarios, recommendations, dashboards
  - Multi-step analytical workflows requiring database queries

- **Default Agent**: Route simple queries involving:
  - Basic questions, clarifications, general help
  - Simple informational requests
  - Straightforward tasks not requiring deep analysis

## Process Flow
1. Analyze the user's query using the intent classification system
2. Make routing decision based on complexity score and factors
3. Execute the appropriate agent with full context
4. Return the agent's response directly to the user
5. Maintain conversation flow and context for follow-up questions

## Key Principles
- Be transparent about routing decisions when helpful
- Preserve all context when passing queries to specialized agents
- Ensure specialized agents have access to user memory and conversation history
- Handle errors gracefully and provide meaningful fallbacks
- Never duplicate the work of specialized agents - route and coordinate only

You have access to the intent classification workflow and both specialized agents. Your goal is to provide the user with the best possible response by leveraging the right expertise for their specific need.`;

export const orchestratorAgent = new Agent({
  name: 'orchestrator-agent',
  description: 'Primary routing agent that classifies intent and routes queries to specialized agents with context management',
  instructions: ORCHESTRATOR_INSTRUCTIONS,
  model: chatModel, // Using Bedrock Claude 4 Sonnet via direct provider
  tools: async () => {
    // Combine shared tools with context management tools
    const sharedTools = getSharedToolMap();
    const contextToolsMap: any = {};

    // Add context tools to the agent's tool set
    contextTools.forEach(tool => {
      contextToolsMap[tool.id] = tool;
    });

    return {
      ...sharedTools,
      ...contextToolsMap,
    };
  },
  memory: getMemoryStore(), // Re-enable memory with context support
});

export async function executeOrchestratorAgent(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
    userContext?: UserContext | AnonymousContext;
  } = {}
): Promise<OrchestratorOutput> {
  const startTime = Date.now();

  await ensureMcpToolsLoaded();

  // Extract the user's query from the input
  const userQuery = input.messages[input.messages.length - 1]?.content || '';

  if (!userQuery || typeof userQuery !== 'string') {
    throw new Error('Invalid query provided to orchestrator');
  }

  // Setup context-aware tracing
  const agentTracer = createBIAgentTracer(
    'orchestrator',
    context.sessionId || `orchestrator-${Date.now()}`,
    context.userId || 'anonymous',
    {
      model: 'bedrock-claude-4-sonnet',
      metadata: {
        query: userQuery.substring(0, 100),
        hasContext: Boolean(context.userContext || context.sessionId),
      },
    }
  );

  // Context-Enhanced Orchestration Flow - declare variables at function scope
  let sessionId = context.sessionId;
  let userContext = context.userContext;

  try {

    // Initialize or validate session context
    if (!sessionId && !userContext) {
      // Create anonymous session for context-less requests
      const { session, context: newContext } = await biSessionManager.createSession({
        domains: ['operational', 'customer-service'], // Safe defaults for anonymous
        enableRecovery: true,
      });

      sessionId = session.sessionId;
      userContext = newContext;

      console.log('🔧 Orchestrator created anonymous session for context-less request', { sessionId });
    } else if (sessionId && !userContext) {
      // Load context from session ID
      userContext = await biContextStore.getUserContext(sessionId) || undefined;
      if (!userContext) {
        console.warn('⚠️ Orchestrator session context not found, creating anonymous fallback');
        const { session, context: newContext } = await biSessionManager.createSession({
          domains: ['operational'],
          enableRecovery: true,
        });
        sessionId = session.sessionId;
        userContext = newContext;
      }
    }

    // Add query to session history
    if (sessionId && userContext) {
      await biSessionManager.addQueryToSession(sessionId, userQuery, undefined, {
        domains: ['operational'], // Will be refined based on routing decision
        executionTime: 0, // Will be updated after execution
      });

      // Update session context with current query
      await biSessionManager.updateSessionState(sessionId, {
        currentQuery: userQuery,
        queryStartTime: new Date().toISOString(),
        analysisMode: 'orchestration',
      });
    }

    // Enhanced Context Parameter for Agent Routing
    const enhancedContext = {
      userId: userContext?.userId || 'anonymous',
      sessionId: sessionId || `fallback-${Date.now()}`,
      conversationId: context.conversationId,
      userContext, // Pass the full context object
    };

    // Step 1: Classify the intent using the intent classification workflow
    const classificationStart = Date.now();
    const classificationResult = await executeIntentClassifier({
      prompt: userQuery,
      context: {
        userId: enhancedContext.userId,
        conversationId: enhancedContext.conversationId,
        sessionId: enhancedContext.sessionId,
      },
    });
    const classificationTime = Date.now() - classificationStart;

    // Step 2: Context-Aware Agent Routing
    const agentExecutionStart = Date.now();
    const selectedAgent = classificationResult.routing_decision.recommended_agent;

    console.log('🔄 Orchestrator routing decision', {
      selectedAgent,
      sessionId: enhancedContext.sessionId,
      userId: enhancedContext.userId,
      isAnonymous: userContext?.isAnonymous,
      queryLength: userQuery.length,
    });

    let agentResult: any;

    if (selectedAgent === 'business-intelligence-agent') {
      agentResult = await executeBusinessIntelligenceAgent(input, enhancedContext);
    } else {
      agentResult = await executeDefaultAgent(input, enhancedContext);
    }

    const agentExecutionTime = Date.now() - agentExecutionStart;
    const totalTime = Date.now() - startTime;

    // Update session with results
    if (sessionId) {
      await biSessionManager.addQueryToSession(
        sessionId,
        userQuery,
        JSON.stringify(agentResult),
        {
          domains: ['operational'], // Use valid domain type
          executionTime: totalTime,
        }
      );
    }

    // Step 3: Prepare the context-enhanced orchestrator output
    const orchestratorOutput: OrchestratorOutput = {
      original_query: userQuery,
      routing_decision: {
        selected_agent: selectedAgent,
        confidence: classificationResult.routing_decision.confidence,
        reasoning: classificationResult.routing_decision.reasoning,
        classification_details: classificationResult,
      },
      agent_execution_result: agentResult,
      orchestration_metadata: {
        total_execution_time_ms: totalTime,
        classification_time_ms: classificationTime,
        agent_execution_time_ms: agentExecutionTime,
        routing_path: ['orchestrator-agent', selectedAgent],
      },
      final_response: agentResult.text || (agentResult as any).content || JSON.stringify(agentResult),
      follow_up_suggestions: generateFollowUpSuggestions(userQuery, selectedAgent, classificationResult),
    };

    // Complete agent tracing
    agentTracer.end({
      output: orchestratorOutput,
      metadata: {
        contextAware: true,
        sessionId: enhancedContext.sessionId,
        selectedAgent,
        routingConfidence: classificationResult.routing_decision.confidence,
      },
    });

    console.log('✅ Context-aware orchestration completed successfully', {
      sessionId: enhancedContext.sessionId,
      selectedAgent,
      executionTime: totalTime,
      confidence: classificationResult.routing_decision.confidence,
    });

    return orchestratorOutput;

  } catch (error) {
    console.error('❌ Context-aware orchestration failed:', error);

    // Enhanced context-aware fallback
    console.log('🔄 Falling back to default agent with context preservation...');

    try {
      // Attempt context recovery if error is context-related
      if (sessionId && error instanceof Error && error.message.includes('context')) {
        console.log('🔧 Attempting context recovery...');
        const recoveryResult = await biSessionManager.recoverSession(sessionId, {
          fallbackToAnonymous: true,
          reconstructFromHistory: true,
        });

        if (recoveryResult) {
          userContext = recoveryResult.context;
          sessionId = recoveryResult.session.sessionId;
          console.log('✅ Context recovery successful, retrying with recovered context');
        }
      }

      const fallbackResult = await executeDefaultAgent(input, {
        userId: userContext?.userId || context.userId,
        sessionId: sessionId || context.sessionId,
        conversationId: context.conversationId,
      });

      const totalTime = Date.now() - startTime;

      // Complete tracing with fallback info
      agentTracer.end({
        error: (error as Error).message,
        metadata: {
          fallbackUsed: true,
          contextRecoveryAttempted: Boolean(sessionId),
          hasUserContext: Boolean(userContext),
        },
      });

      return {
        original_query: userQuery,
        routing_decision: {
          selected_agent: 'default-agent',
          confidence: 0.5,
          reasoning: 'Fallback to default agent due to orchestration error with context preservation',
          classification_details: {
            classification: { intent: 'fallback', complexity_score: 0 },
            complexity_analysis: { total_score: 0, factors: {}, threshold_met: false },
            routing_decision: {
              recommended_agent: 'default-agent',
              confidence: 0.5,
              reasoning: 'Orchestration error fallback with context recovery attempt',
            },
          },
        },
        agent_execution_result: fallbackResult,
        orchestration_metadata: {
          total_execution_time_ms: totalTime,
          classification_time_ms: 0,
          agent_execution_time_ms: totalTime,
          routing_path: ['orchestrator-agent', 'default-agent (context-aware fallback)'],
        },
        final_response: fallbackResult.text || (fallbackResult as any).content || JSON.stringify(fallbackResult),
        follow_up_suggestions: [
          'System diagnostics completed - fallback mode engaged',
          userContext?.isAnonymous ? 'Consider authentication for enhanced routing capabilities' : 'Full context preserved for next query',
          'Contact support if advanced routing features are needed',
        ],
      };

    } catch (fallbackError) {
      // Complete failure - no context available
      agentTracer.end({
        error: `Both primary and fallback orchestration failed: ${(fallbackError as Error).message}`,
      });

      throw new Error(`Orchestrator Agent completely failed: ${(fallbackError as Error).message}`);
    }
  }
}

function generateFollowUpSuggestions(
  query: string,
  selectedAgent: string,
  classification: any
): string[] {
  const suggestions: string[] = [];

  if (selectedAgent === 'business-intelligence-agent') {
    if (query.toLowerCase().includes('trend')) {
      suggestions.push('Would you like to see predictive forecasting based on these trends?');
    }
    if (query.toLowerCase().includes('performance')) {
      suggestions.push('Should we dive deeper into performance drivers and root causes?');
    }
    if (query.toLowerCase().includes('customer')) {
      suggestions.push('Would you like to analyze customer segmentation or cohort behavior?');
    }
    suggestions.push('Would you like me to create a dashboard or report for this analysis?');
  } else {
    suggestions.push('Do you need more detailed analysis for any aspect of this topic?');
    suggestions.push('Would you like me to help you explore related business questions?');
  }

  return suggestions.slice(0, 3); // Limit to 3 suggestions
}