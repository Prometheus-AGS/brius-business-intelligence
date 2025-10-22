import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  BusinessIntelligenceExecutorInputSchema,
  BusinessIntelligenceExecutorOutputSchema,
  ExecutionStepResultSchema,
  type BusinessIntelligenceExecutorInput,
  type BusinessIntelligenceExecutorOutput,
  type ExecutionStepResult,
  type DataRequirement,
  type AnalysisStep,
} from '../types/workflows.js';
import { getSharedToolMap } from '../agents/shared-tools.js';

// Internal schemas for tracking execution state
const ExecutionStateSchema = z.object({
  current_step_index: z.number().int().nonnegative(),
  completed_steps: z.array(z.string()),
  failed_steps: z.array(z.string()),
  collected_data: z.record(z.string(), z.unknown()),
  derived_insights: z.array(z.string()),
  execution_metadata: z.record(z.string(), z.unknown()),
});

const DataCollectionResultSchema = z.object({
  data_source: z.string(),
  data_collected: z.record(z.string(), z.unknown()),
  quality_score: z.number().min(0).max(1),
  collection_time_ms: z.number().int().nonnegative(),
  errors: z.array(z.string()).optional(),
});

// Step 1: Initialize execution environment
const initializeExecutionStep = createStep({
  id: 'initialize-execution',
  inputSchema: BusinessIntelligenceExecutorInputSchema,
  outputSchema: BusinessIntelligenceExecutorInputSchema.extend({
    execution_state: ExecutionStateSchema,
    available_tools: z.record(z.string(), z.unknown()),
  }),
  execute: async ({ inputData }) => {
    const availableTools = await getSharedToolMap();

    const executionState = {
      current_step_index: 0,
      completed_steps: [],
      failed_steps: [],
      collected_data: {},
      derived_insights: [],
      execution_metadata: {
        started_at: inputData.execution_context.execution_start_time,
        timeout_ms: inputData.execution_context.timeout_ms,
        priority_mode: inputData.runtime_adjustments?.priority_override || 'accuracy',
      },
    };

    return {
      ...inputData,
      execution_state: executionState,
      available_tools: availableTools,
    };
  },
});

// Step 2: Execute data collection requirements
const executeDataCollectionStep = createStep({
  id: 'execute-data-collection',
  inputSchema: initializeExecutionStep.outputSchema,
  outputSchema: initializeExecutionStep.outputSchema.extend({
    data_collection_results: z.array(DataCollectionResultSchema),
  }),
  execute: async ({ inputData }) => {
    const dataRequirements = inputData.planner_output.execution_plan.data_requirements;
    const collectionResults: z.infer<typeof DataCollectionResultSchema>[] = [];

    for (const requirement of dataRequirements) {
      const startTime = Date.now();

      try {
        const result = await executeDataRequirement(
          requirement,
          inputData.available_tools,
          inputData.runtime_adjustments
        );

        collectionResults.push({
          data_source: requirement.source,
          data_collected: result.data,
          quality_score: result.quality_score,
          collection_time_ms: Date.now() - startTime,
          errors: result.errors,
        });

        // Store collected data in execution state
        inputData.execution_state.collected_data[requirement.source] = result.data;

      } catch (error) {
        collectionResults.push({
          data_source: requirement.source,
          data_collected: {},
          quality_score: 0,
          collection_time_ms: Date.now() - startTime,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
    }

    return {
      ...inputData,
      data_collection_results: collectionResults,
    };
  },
});

// Step 3: Execute analysis steps
const executeAnalysisStepsStep = createStep({
  id: 'execute-analysis-steps',
  inputSchema: executeDataCollectionStep.outputSchema,
  outputSchema: executeDataCollectionStep.outputSchema.extend({
    step_execution_results: z.array(ExecutionStepResultSchema),
  }),
  execute: async ({ inputData }) => {
    const analysisSteps = inputData.planner_output.execution_plan.analysis_steps;
    const stepResults: ExecutionStepResult[] = [];

    // Filter out steps that should be skipped
    const stepsToExecute = analysisSteps.filter(step =>
      !inputData.runtime_adjustments?.skip_steps?.includes(step.step_id)
    );

    for (const step of stepsToExecute) {
      const stepResult = await executeAnalysisStep(
        step,
        inputData.execution_state.collected_data,
        inputData.available_tools,
        inputData.runtime_adjustments?.priority_override
      );

      stepResults.push(stepResult);

      // Update execution state
      if (stepResult.status === 'completed') {
        inputData.execution_state.completed_steps.push(step.step_id);

        // Collect derived insights
        if (stepResult.derived_insights) {
          inputData.execution_state.derived_insights.push(...stepResult.derived_insights);
        }
      } else if (stepResult.status === 'failed') {
        inputData.execution_state.failed_steps.push(step.step_id);
      }

      inputData.execution_state.current_step_index++;
    }

    return {
      ...inputData,
      step_execution_results: stepResults,
    };
  },
});

// Step 4: Synthesize final analysis
const synthesizeFinalAnalysisStep = createStep({
  id: 'synthesize-final-analysis',
  inputSchema: executeAnalysisStepsStep.outputSchema,
  outputSchema: BusinessIntelligenceExecutorOutputSchema,
  execute: async ({ inputData }) => {
    const startTime = new Date(inputData.execution_context.execution_start_time).getTime();
    const endTime = Date.now();
    const totalExecutionTime = endTime - startTime;

    // Count execution statistics
    const stepsAttempted = inputData.step_execution_results.length;
    const stepsCompleted = inputData.step_execution_results.filter(r => r.status === 'completed').length;
    const stepsFailed = inputData.step_execution_results.filter(r => r.status === 'failed').length;
    const toolsExecuted = inputData.step_execution_results.reduce((sum, r) => sum + r.tool_results.length, 0);

    // Extract data sources accessed
    const dataSourcesAccessed = [
      ...inputData.data_collection_results?.map(r => r.data_source) || [],
      ...Array.from(new Set(inputData.step_execution_results.flatMap(r =>
        r.tool_results.map(t => t.tool_id)
      ))),
    ];

    // Generate final analysis
    const finalAnalysis = await generateFinalAnalysis(
      inputData.planner_output.original_query,
      inputData.execution_state.derived_insights,
      inputData.step_execution_results,
      inputData.data_collection_results || []
    );

    // Generate deliverables
    const deliverables = await generateDeliverables(
      inputData.planner_output,
      inputData.step_execution_results,
      inputData.execution_state.collected_data
    );

    // Create executive summary
    const executiveSummary = await generateExecutiveSummary(
      inputData.planner_output.original_query,
      finalAnalysis,
      inputData.planner_output.analysis_approach
    );

    // Calculate execution quality score
    const executionQualityScore = calculateExecutionQualityScore(
      stepsCompleted,
      stepsAttempted,
      inputData.data_collection_results || [],
      inputData.step_execution_results
    );

    return {
      original_query: inputData.planner_output.original_query,
      execution_summary: {
        total_execution_time_ms: totalExecutionTime,
        steps_attempted: stepsAttempted,
        steps_completed: stepsCompleted,
        steps_failed: stepsFailed,
        tools_executed: toolsExecuted,
        data_sources_accessed: dataSourcesAccessed,
      },
      step_results: inputData.step_execution_results,
      final_analysis: finalAnalysis,
      deliverables: deliverables,
      executive_summary: executiveSummary,
      next_actions: generateNextActions(finalAnalysis, inputData.planner_output),
      metadata: {
        analysis_approach_used: inputData.planner_output.analysis_approach,
        primary_data_sources: (inputData.data_collection_results || []).map(r => r.data_source),
        tools_effectiveness: calculateToolsEffectiveness(inputData.step_execution_results),
        execution_quality_score: executionQualityScore,
      },
    } satisfies BusinessIntelligenceExecutorOutput;
  },
});

// Main workflow
export const businessIntelligenceExecutorWorkflow = createWorkflow({
  id: 'business-intelligence-executor',
  inputSchema: BusinessIntelligenceExecutorInputSchema,
  outputSchema: BusinessIntelligenceExecutorOutputSchema,
})
  .then(initializeExecutionStep)
  .then(executeDataCollectionStep)
  .then(executeAnalysisStepsStep)
  .then(synthesizeFinalAnalysisStep)
  .commit();

// Execution function
export async function executeBusinessIntelligenceExecutor(
  input: BusinessIntelligenceExecutorInput
): Promise<BusinessIntelligenceExecutorOutput> {
  const run = await businessIntelligenceExecutorWorkflow.createRunAsync();
  const result = await run.start({ inputData: input });

  if (result.status !== 'success') {
    const error = (result as { error?: unknown }).error;
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Business Intelligence executor workflow failed');
  }

  return result.result as BusinessIntelligenceExecutorOutput;
}

// Helper functions
async function executeDataRequirement(
  requirement: DataRequirement,
  availableTools: Record<string, unknown>,
  runtimeAdjustments?: any
): Promise<{ data: Record<string, unknown>; quality_score: number; errors?: string[] }> {
  const errors: string[] = [];
  let data: Record<string, unknown> = {};
  let qualityScore = 0;

  try {
    // Select appropriate tool based on requirement type
    const toolId = selectToolForRequirement(requirement, availableTools);

    if (!toolId) {
      errors.push(`No suitable tool found for requirement type: ${requirement.type}`);
      return { data: {}, quality_score: 0, errors };
    }

    // Execute the tool (this would be the actual tool execution)
    // For now, we'll simulate tool execution
    const toolResult = await simulateToolExecution(toolId, requirement.parameters);

    data = toolResult.data;
    qualityScore = assessDataQuality(data, requirement);

    if (qualityScore < 0.5) {
      errors.push(`Data quality below threshold: ${qualityScore}`);
    }

  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown execution error');
  }

  return { data, quality_score: qualityScore, errors: errors.length > 0 ? errors : undefined };
}

async function executeAnalysisStep(
  step: AnalysisStep,
  collectedData: Record<string, unknown>,
  availableTools: Record<string, unknown>,
  priorityMode?: string
): Promise<ExecutionStepResult> {
  const startTime = Date.now();
  const toolResults: any[] = [];
  const derivedInsights: string[] = [];

  try {
    // Execute each tool call in the step
    for (const toolCall of step.tool_calls) {
      const toolStartTime = Date.now();

      // Prepare input data for the tool
      const toolInput = {
        ...toolCall.parameters,
        available_data: collectedData,
      };

      try {
        // Simulate tool execution (in real implementation, this would call the actual tool)
        const toolResult = await simulateToolExecution(toolCall.tool_id, toolInput);

        toolResults.push({
          tool_id: toolCall.tool_id,
          input: toolInput,
          output: toolResult.data,
          execution_time_ms: Date.now() - toolStartTime,
        });

        // Extract insights from tool results
        if (toolResult.insights) {
          derivedInsights.push(...toolResult.insights);
        }

      } catch (toolError) {
        toolResults.push({
          tool_id: toolCall.tool_id,
          input: toolInput,
          error: toolError instanceof Error ? toolError.message : 'Tool execution failed',
          execution_time_ms: Date.now() - toolStartTime,
        });
      }
    }

    // Determine step status
    const successfulTools = toolResults.filter(r => !r.error).length;
    const totalTools = toolResults.length;

    let status: 'completed' | 'failed' | 'skipped' | 'partial';
    if (successfulTools === totalTools) {
      status = 'completed';
    } else if (successfulTools === 0) {
      status = 'failed';
    } else {
      status = 'partial';
    }

    // Calculate confidence in results
    const confidenceInResults = successfulTools / totalTools;

    // Generate next step recommendations
    const nextStepRecommendations = generateNextStepRecommendations(
      step,
      toolResults,
      derivedInsights
    );

    return {
      step_id: step.step_id,
      status,
      tool_results: toolResults,
      derived_insights: derivedInsights.length > 0 ? derivedInsights : undefined,
      data_quality_score: calculateStepDataQuality(toolResults),
      confidence_in_results: confidenceInResults,
      next_step_recommendations: nextStepRecommendations.length > 0 ? nextStepRecommendations : undefined,
    };

  } catch (error) {
    return {
      step_id: step.step_id,
      status: 'failed',
      tool_results: [{
        tool_id: 'error',
        input: {},
        error: error instanceof Error ? error.message : 'Step execution failed',
        execution_time_ms: Date.now() - startTime,
      }],
      confidence_in_results: 0,
    };
  }
}

function selectToolForRequirement(
  requirement: DataRequirement,
  availableTools: Record<string, unknown>
): string | null {
  const toolNames = Object.keys(availableTools);

  switch (requirement.type) {
    case 'database_query':
      return toolNames.find(tool =>
        tool.includes('supabase') || tool.includes('postgres') || tool.includes('sql')
      ) || null;

    case 'semantic_search':
      return toolNames.find(tool =>
        tool.includes('search') || tool.includes('knowledge') || tool.includes('vector')
      ) || null;

    case 'api_call':
      return toolNames.find(tool =>
        tool.includes('api') || tool.includes('fetch') || tool.includes('http')
      ) || null;

    case 'tool_execution':
      return toolNames.find(tool =>
        tool.includes(requirement.source) || tool.includes('execute')
      ) || null;

    default:
      return toolNames[0] || null;
  }
}

async function simulateToolExecution(
  toolId: string,
  parameters: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; insights?: string[] }> {
  // This is a simulation - in real implementation, this would execute the actual tool
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500)); // Simulate execution time

  const mockData = {
    tool_id: toolId,
    parameters,
    result: `Mock result from ${toolId}`,
    timestamp: new Date().toISOString(),
    success: true,
  };

  const insights = [
    `Tool ${toolId} executed successfully`,
    `Generated result based on provided parameters`,
  ];

  return { data: mockData, insights };
}

function assessDataQuality(
  data: Record<string, unknown>,
  requirement: DataRequirement
): number {
  let qualityScore = 0.5; // Base score

  // Check if data is not empty
  if (Object.keys(data).length > 0) {
    qualityScore += 0.2;
  }

  // Check if required fields are present
  if (data.success === true) {
    qualityScore += 0.2;
  }

  // Check data completeness
  if (data.result && typeof data.result === 'string' && data.result.length > 0) {
    qualityScore += 0.1;
  }

  return Math.min(1.0, qualityScore);
}

function calculateStepDataQuality(toolResults: any[]): number {
  if (toolResults.length === 0) return 0;

  const successfulResults = toolResults.filter(r => !r.error);
  return successfulResults.length / toolResults.length;
}

function generateNextStepRecommendations(
  step: AnalysisStep,
  toolResults: any[],
  derivedInsights: string[]
): string[] {
  const recommendations: string[] = [];

  const failedTools = toolResults.filter(r => r.error);
  if (failedTools.length > 0) {
    recommendations.push(`Retry failed tools: ${failedTools.map(t => t.tool_id).join(', ')}`);
  }

  if (derivedInsights.length > 3) {
    recommendations.push('Consider deeper analysis of generated insights');
  }

  if (step.step_type === 'data_collection') {
    recommendations.push('Proceed with data validation and cleaning');
  } else if (step.step_type === 'analysis') {
    recommendations.push('Generate visualizations for key findings');
  }

  return recommendations;
}

async function generateFinalAnalysis(
  originalQuery: string,
  derivedInsights: string[],
  stepResults: ExecutionStepResult[],
  dataCollectionResults: z.infer<typeof DataCollectionResultSchema>[]
): Promise<{
  key_findings: string[];
  insights: string[];
  recommendations: string[];
  confidence_score: number;
  data_quality_assessment: string;
  limitations?: string[];
}> {
  // Extract key findings from successful steps
  const keyFindings = stepResults
    .filter(r => r.status === 'completed')
    .flatMap(r => r.derived_insights || [])
    .slice(0, 5); // Top 5 findings

  // Use derived insights
  const insights = derivedInsights.slice(0, 5);

  // Generate recommendations based on findings
  const recommendations = [
    'Monitor key metrics identified in the analysis',
    'Implement data quality improvements for better future analysis',
    'Consider additional data sources for more comprehensive insights',
  ];

  // Calculate overall confidence score
  const completedSteps = stepResults.filter(r => r.status === 'completed').length;
  const totalSteps = stepResults.length;
  const baseConfidence = totalSteps > 0 ? completedSteps / totalSteps : 0;

  const dataQualityScore = dataCollectionResults.length > 0
    ? dataCollectionResults.reduce((sum, r) => sum + r.quality_score, 0) / dataCollectionResults.length
    : 0.5;

  const confidenceScore = (baseConfidence + dataQualityScore) / 2;

  // Assess data quality
  const avgDataQuality = dataQualityScore;
  let dataQualityAssessment: string;
  if (avgDataQuality > 0.8) {
    dataQualityAssessment = 'High quality data with strong reliability';
  } else if (avgDataQuality > 0.6) {
    dataQualityAssessment = 'Good quality data with minor limitations';
  } else if (avgDataQuality > 0.4) {
    dataQualityAssessment = 'Moderate quality data with notable limitations';
  } else {
    dataQualityAssessment = 'Lower quality data requiring caution in interpretation';
  }

  // Identify limitations
  const limitations: string[] = [];
  const failedSteps = stepResults.filter(r => r.status === 'failed');
  if (failedSteps.length > 0) {
    limitations.push(`${failedSteps.length} analysis steps failed to complete`);
  }

  const failedDataCollection = dataCollectionResults.filter(r => r.quality_score < 0.5);
  if (failedDataCollection.length > 0) {
    limitations.push(`${failedDataCollection.length} data sources had quality issues`);
  }

  return {
    key_findings: keyFindings.length > 0 ? keyFindings : ['Analysis completed with available data'],
    insights: insights.length > 0 ? insights : ['Insights generated from available information'],
    recommendations,
    confidence_score: confidenceScore,
    data_quality_assessment: dataQualityAssessment,
    limitations: limitations.length > 0 ? limitations : undefined,
  };
}

async function generateDeliverables(
  plannerOutput: any,
  stepResults: ExecutionStepResult[],
  collectedData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return {
    analysis_results: stepResults.map(r => ({
      step_id: r.step_id,
      status: r.status,
      key_outputs: r.tool_results.filter(t => !t.error).map(t => t.output),
    })),
    data_summary: Object.keys(collectedData).map(source => ({
      source,
      record_count: Array.isArray(collectedData[source]) ? collectedData[source].length : 1,
      data_type: typeof collectedData[source],
    })),
    methodology: {
      approach: plannerOutput.analysis_approach,
      steps_executed: stepResults.filter(r => r.status === 'completed').length,
      tools_used: Array.from(new Set(stepResults.flatMap(r => r.tool_results.map(t => t.tool_id)))),
    },
  };
}

async function generateExecutiveSummary(
  originalQuery: string,
  finalAnalysis: any,
  analysisApproach: string
): Promise<string> {
  const summary = [
    `Executive Summary: ${originalQuery}`,
    '',
    `Analysis Approach: ${analysisApproach}`,
    `Confidence Level: ${Math.round(finalAnalysis.confidence_score * 100)}%`,
    '',
    'Key Findings:',
    ...finalAnalysis.key_findings.map((finding: string, index: number) => `${index + 1}. ${finding}`),
    '',
    'Recommendations:',
    ...finalAnalysis.recommendations.map((rec: string, index: number) => `${index + 1}. ${rec}`),
    '',
    `Data Quality: ${finalAnalysis.data_quality_assessment}`,
  ];

  if (finalAnalysis.limitations && finalAnalysis.limitations.length > 0) {
    summary.push('');
    summary.push('Limitations:');
    summary.push(...finalAnalysis.limitations.map((limitation: string) => `• ${limitation}`));
  }

  return summary.join('\n');
}

function generateNextActions(
  finalAnalysis: any,
  plannerOutput: any
): string[] {
  const actions: string[] = [];

  // Standard next actions
  actions.push('Review and validate findings with stakeholders');
  actions.push('Implement recommended actions with appropriate timelines');

  // Conditional next actions based on confidence
  if (finalAnalysis.confidence_score < 0.7) {
    actions.push('Gather additional data to improve analysis confidence');
  }

  // Approach-specific actions
  if (plannerOutput.analysis_approach === 'descriptive') {
    actions.push('Consider diagnostic analysis to understand underlying causes');
  } else if (plannerOutput.analysis_approach === 'diagnostic') {
    actions.push('Develop action plans to address identified root causes');
  } else if (plannerOutput.analysis_approach === 'predictive') {
    actions.push('Monitor predictions against actual outcomes for model refinement');
  }

  actions.push('Schedule follow-up analysis to track progress and changes');

  return actions;
}

function calculateExecutionQualityScore(
  stepsCompleted: number,
  stepsAttempted: number,
  dataCollectionResults: z.infer<typeof DataCollectionResultSchema>[],
  stepResults: ExecutionStepResult[]
): number {
  let qualityScore = 0;

  // Step completion score (40% weight)
  const stepCompletionScore = stepsAttempted > 0 ? stepsCompleted / stepsAttempted : 0;
  qualityScore += stepCompletionScore * 0.4;

  // Data quality score (30% weight)
  const avgDataQuality = dataCollectionResults.length > 0
    ? dataCollectionResults.reduce((sum, r) => sum + r.quality_score, 0) / dataCollectionResults.length
    : 0.5;
  qualityScore += avgDataQuality * 0.3;

  // Tool success score (20% weight)
  const totalToolCalls = stepResults.reduce((sum, r) => sum + r.tool_results.length, 0);
  const successfulToolCalls = stepResults.reduce((sum, r) =>
    sum + r.tool_results.filter(t => !t.error).length, 0
  );
  const toolSuccessScore = totalToolCalls > 0 ? successfulToolCalls / totalToolCalls : 0;
  qualityScore += toolSuccessScore * 0.2;

  // Insight generation score (10% weight)
  const totalInsights = stepResults.reduce((sum, r) => sum + (r.derived_insights?.length || 0), 0);
  const insightScore = Math.min(1, totalInsights / 5); // Normalize to 5 insights
  qualityScore += insightScore * 0.1;

  return Math.min(1, Math.max(0, qualityScore));
}

function calculateToolsEffectiveness(
  stepResults: ExecutionStepResult[]
): Record<string, number> {
  const toolEffectiveness: Record<string, number> = {};

  for (const stepResult of stepResults) {
    for (const toolResult of stepResult.tool_results) {
      if (!toolEffectiveness[toolResult.tool_id]) {
        toolEffectiveness[toolResult.tool_id] = 0;
      }

      // Calculate effectiveness based on success and execution time
      let effectiveness = toolResult.error ? 0 : 0.7;

      // Bonus for fast execution (under 5 seconds)
      if (!toolResult.error && toolResult.execution_time_ms < 5000) {
        effectiveness += 0.2;
      }

      // Bonus for generating insights
      if (stepResult.derived_insights && stepResult.derived_insights.length > 0) {
        effectiveness += 0.1;
      }

      toolEffectiveness[toolResult.tool_id] = Math.max(
        toolEffectiveness[toolResult.tool_id],
        effectiveness
      );
    }
  }

  return toolEffectiveness;
}