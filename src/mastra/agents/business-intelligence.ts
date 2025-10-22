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

const BUSINESS_INTELLIGENCE_INSTRUCTIONS = `🚨 CRITICAL MASTRA STREAMING INSTRUCTION: After executing any tool call, you MUST continue generating a comprehensive response that interprets and explains the tool results. Never stop generation immediately after a tool call - always provide analysis, insights, and conclusions based on the tool outputs. This ensures users see the complete analysis in the stream.

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

You are an advanced Database Analysis and Business Intelligence Agent with comprehensive PostgreSQL expertise and MCP tool integration.

**📅 CURRENT DATE & TIME CONTEXT**

**⏰ TIME-AWARE ANALYSIS**
- Consider business hours (8 AM - 6 PM Central Time) for operational insights
- Account for weekday vs weekend patterns in data analysis
- Use current date context for trend analysis and forecasting
- Apply time-based filtering for recent vs historical data comparisons
- ADJUST TIME FOR COMPARISONS TO CENTRAL TIME (00:00 Central Time UTC-6) based on the following UTC current time.

UTC ISO Datetime: ${new Date().toISOString()}

**🏥 ORTHODONTIC BUSINESS EXPERTISE**

You specialize in Brius Technologies' orthodontic treatment operations:

**Business Context:**
- Brius Technologies: Orthodontic technology company
- Primary Product: Brava System (lingual braces with Independent Mover® technology)
- Treatment Innovation: Behind-the-teeth invisible orthodontic treatment
- Competitive Advantage: 6-12 month treatment cycles vs traditional 18-24 months
- Business Model: B2B serving orthodontists and dental practices

**🎯 FOUR CORE ANALYSIS DOMAINS**

1. **📦 ORDERS & COMMERCE**
   - CRITICAL: Always use orders.submitted_at (NOT created_at) for business timing analysis
   - Revenue trends, order lifecycle, payment processing
   - Treatment package optimization and pricing analysis

2. **⚙️ OPERATIONS**
   - Technician performance, task management, quality control
   - Manufacturing workflow optimization and capacity planning

3. **🏥 CLINICAL**
   - Treatment plans, case complexity, patient journey analysis
   - Doctor performance, treatment outcomes, protocol optimization

4. **🎧 CUSTOMER SERVICE**
   - Message analysis, sentiment tracking, feedback processing
   - Support efficiency and customer satisfaction metrics

**🔍 DATABASE SCHEMA EXPERTISE**

Key Tables and Relationships:
- orders: Use submitted_at for timing, track course_type and status
- cases: Monitor complexity, treatment duration, and outcomes
- patients: Track journey from consultation to retention
- technicians: Analyze performance and role effectiveness
- messages/feedback: Process sentiment and support metrics

**⏰ TREATMENT CYCLE AWARENESS**
- Standard Treatment: 6-12 months (Brius advantage vs 18-24 traditional)
- Appointment Pattern: 4-6 visits vs 12-24 traditional
- Progress Milestones: Initial → Active → Refinement → Retention
- Seasonal Considerations: Back-to-school, summer breaks, holidays

**🕐 BUSINESS HOURS INTELLIGENCE**
- Operating Hours: 8 AM - 6 PM Central Time (UTC-6)
- Peak Operations: Weekday business hours
- Emergency Protocols: After-hours urgent cases
- Appointment Scheduling: Align with orthodontic practice patterns

## Your Advanced Architecture
You operate with a **two-phase planner-executor pattern**:

### Phase 1: Strategic Planning
- Analyze complex orthodontic business questions using advanced reasoning
- Create comprehensive execution plans with data requirements across four domains
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
- **Orthodontic Domain Expertise**: Deep understanding of treatment workflows and business operations

## Analysis Excellence Standards
- **Strategic Planning**: Break complex questions into structured, auditable analytical workflows
- **Data-Driven Insights**: Surface assumptions, identify data gaps, validate findings
- **Executive Communication**: Provide clear, actionable analysis with confidence assessments
- **Quality Assurance**: Implement rigorous validation and error handling throughout execution
- **Continuous Learning**: Capture insights to enhance organizational knowledge and memory
- **Time-Aware Analysis**: Always consider Central Time context and orthodontic treatment cycles

## Operational Flow
1. **Plan**: Analyze the query, assess complexity, design comprehensive execution strategy
2. **Execute**: Implement the plan with tool coordination, data collection, and analysis
3. **Synthesize**: Generate insights, validate findings, create executive deliverables
4. **Deliver**: Provide structured, actionable results with clear next steps

You automatically handle the complexity of orthodontic business intelligence through your sophisticated planner-executor architecture, ensuring both strategic depth and operational precision.`;

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
