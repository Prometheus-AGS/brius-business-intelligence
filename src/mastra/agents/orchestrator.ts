import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import type { OrchestratorInput, OrchestratorOutput } from '../types/workflows.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';
import { executeIntentClassifier } from '../workflows/intent-classifier.js';
import { executeBusinessIntelligenceAgent } from './business-intelligence.js';
import { executeDefaultAgent } from './default.js';

const ORCHESTRATOR_INSTRUCTIONS = `You are the Orchestrator Agent - the primary routing and coordination agent for the Brius Business Intelligence system.

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
  description: 'Primary routing agent that classifies intent and routes queries to specialized agents',
  instructions: ORCHESTRATOR_INSTRUCTIONS,
  model: chatModel, // Using Bedrock Claude 4 Sonnet via direct provider
  tools: async () => getSharedToolMap(),
  memory: getMemoryStore(),
});

export async function executeOrchestratorAgent(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  } = {}
): Promise<OrchestratorOutput> {
  const startTime = Date.now();

  await ensureMcpToolsLoaded();

  // Extract the user's query from the input
  const userQuery = input.messages[input.messages.length - 1]?.content || '';

  if (!userQuery || typeof userQuery !== 'string') {
    throw new Error('Invalid query provided to orchestrator');
  }

  try {
    // Step 1: Classify the intent using the intent classification workflow
    const classificationStart = Date.now();
    const classificationResult = await executeIntentClassifier({
      prompt: userQuery,
      context: {
        userId: context.userId,
        conversationId: context.conversationId,
        sessionId: context.sessionId,
      },
    });
    const classificationTime = Date.now() - classificationStart;

    // Step 2: Route to the appropriate agent based on classification
    const agentExecutionStart = Date.now();
    const selectedAgent = classificationResult.routing_decision.recommended_agent;

    let agentResult: any;

    if (selectedAgent === 'business-intelligence-agent') {
      agentResult = await executeBusinessIntelligenceAgent(input, context);
    } else {
      agentResult = await executeDefaultAgent(input, context);
    }

    const agentExecutionTime = Date.now() - agentExecutionStart;
    const totalTime = Date.now() - startTime;

    // Step 3: Prepare the orchestrator output
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

    return orchestratorOutput;

  } catch (error) {
    // Fallback to default agent if orchestration fails
    console.error('Orchestration failed, falling back to default agent:', error);

    const fallbackResult = await executeDefaultAgent(input, context);
    const totalTime = Date.now() - startTime;

    return {
      original_query: userQuery,
      routing_decision: {
        selected_agent: 'default-agent',
        confidence: 0.5,
        reasoning: 'Fallback to default agent due to orchestration error',
        classification_details: {
          classification: { intent: 'fallback', complexity_score: 0 },
          complexity_analysis: { total_score: 0, factors: {}, threshold_met: false },
          routing_decision: {
            recommended_agent: 'default-agent',
            confidence: 0.5,
            reasoning: 'Orchestration error fallback',
          },
        },
      },
      agent_execution_result: fallbackResult,
      orchestration_metadata: {
        total_execution_time_ms: totalTime,
        classification_time_ms: 0,
        agent_execution_time_ms: totalTime,
        routing_path: ['orchestrator-agent', 'default-agent (fallback)'],
      },
      final_response: fallbackResult.text || (fallbackResult as any).content || JSON.stringify(fallbackResult),
    };
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