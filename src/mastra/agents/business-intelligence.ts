import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import type {
  BusinessIntelligencePlannerInput,
  BusinessIntelligenceExecutorInput,
  BusinessIntelligenceExecutorOutput,
} from '../types/workflows.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap, getAllAvailableTools } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';
import { executeBusinessIntelligencePlanner } from '../workflows/business-intelligence-planner.js';
import { executeBusinessIntelligenceExecutor } from '../workflows/business-intelligence-executor.js';

const BUSINESS_INTELLIGENCE_INSTRUCTIONS = `You are an expert business intelligence analyst using a sophisticated planner-executor architecture.

## Your Advanced Architecture
You operate with a **two-phase planner-executor pattern**:

### Phase 1: Strategic Planning
- Analyze complex business questions using advanced reasoning
- Create comprehensive execution plans with data requirements
- Assess available tools and determine optimal analytical approaches
- Generate step-by-step analysis workflows with dependencies and success criteria

### Phase 2: Precise Execution
- Execute the planned analysis steps with rigorous quality control
- Coordinate multiple data sources and analytical tools
- Generate insights with confidence scoring and quality assessment
- Provide executive-ready deliverables with actionable recommendations

## Your Enhanced Capabilities
- **Claude 4 Sonnet**: For sophisticated planning, analysis, and strategic reasoning
- **Titan v2 Embeddings**: For advanced semantic search and content understanding
- **Comprehensive Knowledge Base**: With semantic search capabilities
- **Memory Systems**: Both user-specific and global organizational memory
- **Advanced Tool Orchestration**: Coordinated execution of multiple specialized tools

## Analysis Excellence Standards
- **Strategic Planning**: Break complex questions into structured, auditable analytical workflows
- **Data-Driven Insights**: Surface assumptions, identify data gaps, validate findings
- **Executive Communication**: Provide clear, actionable analysis with confidence assessments
- **Quality Assurance**: Implement rigorous validation and error handling throughout execution
- **Continuous Learning**: Capture insights to enhance organizational knowledge and memory

## Operational Flow
1. **Plan**: Analyze the query, assess complexity, design comprehensive execution strategy
2. **Execute**: Implement the plan with tool coordination, data collection, and analysis
3. **Synthesize**: Generate insights, validate findings, create executive deliverables
4. **Deliver**: Provide structured, actionable results with clear next steps

You automatically handle the complexity of business intelligence through your sophisticated planner-executor architecture, ensuring both strategic depth and operational precision.`;

export const businessIntelligenceAgent = new Agent({
  name: 'business-intelligence-agent',
  description: 'Provides executive-ready analysis using sophisticated planner-executor architecture.',
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
): Promise<BusinessIntelligenceExecutorOutput> {
  await ensureMcpToolsLoaded();

  // Extract the user's query from the input
  const userQuery = input.messages[input.messages.length - 1]?.content || '';

  if (!userQuery || typeof userQuery !== 'string') {
    throw new Error('Invalid query provided to Business Intelligence Agent');
  }

  try {
    // Phase 1: Planning
    console.log('🧠 Business Intelligence Agent - Phase 1: Strategic Planning');

    // Prepare context for planning
    const availableTools = getAllAvailableTools().map(tool => tool.id);

    // TODO: In a real implementation, you would fetch actual memory and knowledge context
    const memoryContext: any[] = []; // Would be populated from memory store
    const knowledgeContext: any[] = []; // Would be populated from knowledge base

    const plannerInput: BusinessIntelligencePlannerInput = {
      query: userQuery,
      user_id: context.userId,
      conversation_id: context.conversationId,
      context: {
        sessionId: context.sessionId,
        conversationId: context.conversationId,
      },
      knowledge_context: knowledgeContext,
      memory_context: memoryContext,
      available_tools: availableTools,
      constraints: {
        max_execution_time_ms: 300000, // 5 minutes max
        max_tool_calls: 20,
        required_confidence_threshold: 0.7,
      },
    };

    // Execute planning workflow
    const plannerOutput = await executeBusinessIntelligencePlanner(plannerInput);

    console.log('✅ Planning completed:', {
      approach: plannerOutput.analysis_approach,
      data_requirements: plannerOutput.execution_plan.data_requirements.length,
      analysis_steps: plannerOutput.execution_plan.analysis_steps.length,
      confidence: plannerOutput.execution_plan.confidence_in_plan,
    });

    // Phase 2: Execution
    console.log('⚙️ Business Intelligence Agent - Phase 2: Precise Execution');

    const executorInput: BusinessIntelligenceExecutorInput = {
      planner_output: plannerOutput,
      execution_context: {
        user_id: context.userId,
        conversation_id: context.conversationId,
        session_id: context.sessionId,
        execution_start_time: new Date().toISOString(),
        timeout_ms: 300000, // 5 minutes
      },
      runtime_adjustments: {
        priority_override: 'accuracy', // Prioritize accuracy over speed
      },
    };

    // Execute analysis workflow
    const executorOutput = await executeBusinessIntelligenceExecutor(executorInput);

    console.log('✅ Execution completed:', {
      steps_completed: executorOutput.execution_summary.steps_completed,
      steps_attempted: executorOutput.execution_summary.steps_attempted,
      tools_executed: executorOutput.execution_summary.tools_executed,
      confidence_score: executorOutput.final_analysis.confidence_score,
      execution_quality: executorOutput.metadata.execution_quality_score,
    });

    // Store insights in memory for future use
    // TODO: In a real implementation, save key insights to memory store
    console.log('💾 Storing insights in organizational memory...');

    return executorOutput;

  } catch (error) {
    console.error('❌ Business Intelligence Agent execution failed:', error);

    // Fallback to basic agent response if planner-executor fails
    console.log('🔄 Falling back to basic agent response...');

    const options: Record<string, string> = {};
    if (context.conversationId ?? context.sessionId) {
      options.threadId = String(context.conversationId ?? context.sessionId);
    }
    if (context.userId) {
      options.resourceId = context.userId;
    }

    const fallbackResponse = await businessIntelligenceAgent.generateLegacy(input.messages as any, options);

    // Convert fallback response to executor output format
    return {
      original_query: userQuery,
      execution_summary: {
        total_execution_time_ms: 0,
        steps_attempted: 0,
        steps_completed: 0,
        steps_failed: 1,
        tools_executed: 0,
        data_sources_accessed: [],
      },
      step_results: [],
      final_analysis: {
        key_findings: ['Fallback response generated due to planner-executor failure'],
        insights: ['Analysis completed using basic agent capabilities'],
        recommendations: ['Consider simplifying the query or checking system configuration'],
        confidence_score: 0.5,
        data_quality_assessment: 'Unable to assess - fallback mode',
        limitations: ['Planner-executor workflow unavailable'],
      },
      deliverables: {
        fallback_response: fallbackResponse,
      },
      executive_summary: `Fallback Analysis: ${userQuery}\n\nDue to technical limitations, this analysis was completed using basic capabilities. ${fallbackResponse.text || (fallbackResponse as any).content || JSON.stringify(fallbackResponse)}`,
      next_actions: [
        'Verify system configuration and tool availability',
        'Consider re-running the analysis after resolving technical issues',
        'Contact system administrator if problems persist',
      ],
      metadata: {
        analysis_approach_used: 'descriptive',
        primary_data_sources: [],
        execution_quality_score: 0.3,
      },
    };
  }
}

// Legacy wrapper function for backward compatibility
export async function executeBusinessIntelligenceAgentLegacy(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  } = {}
) {
  const result = await executeBusinessIntelligenceAgent(input, context);

  // Return in legacy format
  return {
    text: result.executive_summary,
    content: result.executive_summary,
    metadata: {
      analysis_approach: result.metadata.analysis_approach_used,
      confidence_score: result.final_analysis.confidence_score,
      execution_quality: result.metadata.execution_quality_score,
      key_findings: result.final_analysis.key_findings,
      recommendations: result.final_analysis.recommendations,
    },
  };
}
