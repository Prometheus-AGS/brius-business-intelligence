import { createStep, createWorkflow } from '@mastra/core/workflows';
import { PlanningInputSchema, PlanningOutputSchema, PlanningInput, PlanningOutput, PlanningStep } from '../types/index.js';
import { workflowLogger, trackPerformance } from '../observability/logger.js';
import { WorkflowTracer } from '../observability/langfuse.js';
import { BaseWorkflow, EnhancedWorkflowContext } from './base-workflow.js';
import { searchKnowledgeBase } from '../knowledge/search.js';

/**
 * Planning Workflow
 * Knowledge-first planning workflow for complex business intelligence queries
 * Breaks down complex queries into executable steps with proper context
 */

const gatherKnowledgeStep = createStep({
  id: 'gather-knowledge',
  description: 'Search knowledge base for relevant context and information',
  execute: async ({ context, input }) => {
    const { query, user_id, knowledge_context, constraints } = input;

    workflowLogger.info('Gathering knowledge for planning', {
      user_id,
      query_length: query.length,
      has_initial_context: Boolean(knowledge_context),
    });

    try {
      // Search knowledge base for relevant context
      const searchResults = await searchKnowledgeBase({
        query: query,
        searchType: 'hybrid',
        filters: {
          maxResults: 5,
          minScore: 0.3,
          userId: user_id,
        },
        rerankResults: true,
      });

      // Extract knowledge sources from search results
      const knowledgeSources = searchResults.results.map(result => ({
        id: result.document.id,
        title: result.document.title,
        content: result.chunk.content,
        relevance_score: result.score,
        category: result.document.category,
        tags: result.document.tags,
        highlight: result.highlight,
      }));

      workflowLogger.info('Knowledge search completed for planning', {
        user_id,
        results_found: knowledgeSources.length,
        search_time_ms: searchResults.processingTime,
        avg_relevance: knowledgeSources.reduce((sum, k) => sum + k.relevance_score, 0) / knowledgeSources.length,
      });

      // If no relevant knowledge found, provide basic business context
      if (knowledgeSources.length === 0) {
        workflowLogger.warn('No relevant knowledge found, using fallback context', { user_id });

        const fallbackContext = [{
          id: 'fallback-business-context',
          title: 'General Business Analysis Context',
          content: 'Standard business intelligence analysis approach focusing on data-driven insights, metric interpretation, and actionable recommendations.',
          relevance_score: 0.5,
          category: 'general',
          tags: ['business-intelligence', 'analysis'],
        }];

        return {
          knowledge_sources: fallbackContext.map(k => k.id),
          knowledge_context: fallbackContext,
          search_performed: true,
          fallback_used: true,
        };
      }

      return {
        knowledge_sources: knowledgeSources.map(k => k.id),
        knowledge_context: knowledgeSources,
        search_performed: true,
        search_metadata: {
          total_results: searchResults.totalResults,
          processing_time: searchResults.processingTime,
          search_type: searchResults.searchType,
        },
      };

    } catch (error) {
      workflowLogger.error('Knowledge search failed during planning', error instanceof Error ? error : new Error(String(error)));

      // Fallback to basic context if search fails
      const fallbackContext = [{
        id: 'error-fallback-context',
        title: 'Basic Business Analysis Framework',
        content: 'Using standard business intelligence methodologies for analysis when knowledge base is unavailable.',
        relevance_score: 0.4,
        category: 'fallback',
        tags: ['business-intelligence'],
      }];

      return {
        knowledge_sources: fallbackContext.map(k => k.id),
        knowledge_context: fallbackContext,
        search_performed: false,
        error: error instanceof Error ? error.message : String(error),
        fallback_used: true,
      };
    }
  },
});

const generatePlanStep = createStep({
  id: 'generate-plan',
  description: 'Generate step-by-step execution plan based on knowledge and query',
  execute: async ({ context, input }) => {
    const { query, knowledge_context, constraints } = input;

    workflowLogger.info('Generating execution plan', {
      knowledge_sources: knowledge_context?.length || 0,
      has_constraints: Boolean(constraints),
    });

    // Analyze query complexity and requirements
    const analysisResult = analyzeQueryRequirements(query, knowledge_context);

    // Generate execution steps
    const plan = generateExecutionPlan(analysisResult, constraints);

    return {
      query_analysis: analysisResult,
      execution_plan: plan,
      estimated_complexity: analysisResult.complexity_score,
    };
  },
});

const validatePlanStep = createStep({
  id: 'validate-plan',
  description: 'Validate and optimize the execution plan',
  outputSchema: PlanningOutputSchema,
  execute: async ({ context, input }) => {
    const { query, knowledge_context, execution_plan, query_analysis } = input;

    workflowLogger.info('Validating execution plan', {
      plan_steps: execution_plan.length,
      complexity_score: query_analysis.complexity_score,
    });

    // Validate plan feasibility
    const validation = validateExecutionPlan(execution_plan, query_analysis);

    // Optimize if needed
    const optimizedPlan = validation.needs_optimization
      ? optimizePlan(execution_plan, validation.issues)
      : execution_plan;

    const result: PlanningOutput = {
      query,
      plan: optimizedPlan,
      knowledge_sources: knowledge_context?.map((k: any) => k.id) || [],
      confidence_score: calculateConfidenceScore(optimizedPlan, knowledge_context),
    };

    return result;
  },
});

export const planningWorkflow = createWorkflow({
  id: 'planning',
  inputSchema: PlanningInputSchema,
  outputSchema: PlanningOutputSchema,
  steps: [gatherKnowledgeStep, generatePlanStep, validatePlanStep],
})
  .then(gatherKnowledgeStep)
  .then(generatePlanStep)
  .then(validatePlanStep)
  .commit();

/**
 * Enhanced Planning Workflow with Comprehensive Performance Tracking
 * Constitutional requirement: Complete observability for all workflow executions
 */
export class EnhancedPlanningWorkflow extends BaseWorkflow<PlanningInput, PlanningOutput> {
  private coreWorkflow = planningWorkflow;

  constructor() {
    super('planning-workflow', '1.0.0', {
      enabled: true,
      trackSteps: true,
      trackCheckpoints: true,
      trackPerformance: true,
      trackConditionals: true,
      trackParallelExecution: true,
      captureStepIO: true,
      maxStepInputSize: 50000, // Larger for complex planning data
      maxStepOutputSize: 300000, // Larger for comprehensive plans
      checkpointInterval: 2, // Checkpoint every 2 steps for planning
      performanceThresholds: {
        stepWarningMs: 10000, // 10 seconds for planning steps
        stepErrorMs: 60000, // 1 minute max per step
        workflowWarningMs: 120000, // 2 minutes total workflow
        workflowErrorMs: 600000, // 10 minutes max total
      },
    });
  }

  /**
   * Execute planning workflow with comprehensive tracking and checkpoints
   */
  async execute(
    input: PlanningInput,
    context: EnhancedWorkflowContext = {}
  ): Promise<PlanningOutput> {
    return await this.executeWithTracking(
      input,
      {
        ...context,
        userId: context.userId || input.user_id,
        businessContext: {
          ...context.businessContext,
          purpose: 'Business Intelligence Planning',
          expectedOutcome: 'Structured execution plan for complex analytical queries',
        },
        technicalContext: {
          ...context.technicalContext,
          environment: process.env.NODE_ENV as any || 'development',
          version: '1.0.0',
          features: ['knowledge-first-planning', 'comprehensive-tracing', 'step-by-step-validation'],
        },
        metadata: {
          ...context.metadata,
          workflow_type: 'planning',
          query_length: input.query.length,
          has_constraints: Boolean(input.constraints),
          knowledge_context_provided: Boolean(input.knowledge_context?.length),
        },
      },
      async () => {
        // Track individual workflow steps with comprehensive tracing
        const traceId = crypto.randomUUID();

        // Step 1: Knowledge Gathering with performance tracking
        const knowledgeResult = await this.trackStepExecution(
          {
            stepId: 'gather-knowledge',
            stepName: 'Gather Knowledge Context',
            stepIndex: 1,
            stepType: 'sequential',
            totalSteps: 3,
          },
          traceId,
          {
            workflowId: this.workflowId,
            workflowName: this.workflowName,
            workflowVersion: this.workflowVersion,
            executionId: crypto.randomUUID(),
            userId: context.userId || input.user_id,
            sessionId: context.sessionId,
            metadata: {
              step_purpose: 'Establish knowledge foundation for planning',
              expected_output: 'Relevant knowledge sources and business context',
            },
          },
          { query: input.query, user_id: input.user_id, knowledge_context: input.knowledge_context },
          async () => await gatherKnowledgeStep.execute({
            context: {},
            input: {
              query: input.query,
              user_id: input.user_id,
              knowledge_context: input.knowledge_context,
              constraints: input.constraints
            }
          })
        );

        // Step 2: Plan Generation with conditional tracking
        const planResult = await this.trackStepExecution(
          {
            stepId: 'generate-plan',
            stepName: 'Generate Execution Plan',
            stepIndex: 2,
            stepType: 'sequential',
            totalSteps: 3,
          },
          traceId,
          {
            workflowId: this.workflowId,
            workflowName: this.workflowName,
            workflowVersion: this.workflowVersion,
            executionId: crypto.randomUUID(),
            userId: context.userId || input.user_id,
            sessionId: context.sessionId,
            metadata: {
              step_purpose: 'Generate detailed execution plan based on knowledge',
              expected_output: 'Step-by-step execution plan with complexity analysis',
            },
          },
          {
            query: input.query,
            knowledge_context: knowledgeResult.knowledge_context,
            constraints: input.constraints
          },
          async () => await generatePlanStep.execute({
            context: {},
            input: {
              query: input.query,
              knowledge_context: knowledgeResult.knowledge_context,
              constraints: input.constraints
            }
          })
        );

        // Step 3: Plan Validation with performance analysis
        const validationResult = await this.trackStepExecution(
          {
            stepId: 'validate-plan',
            stepName: 'Validate and Optimize Plan',
            stepIndex: 3,
            stepType: 'sequential',
            totalSteps: 3,
          },
          traceId,
          {
            workflowId: this.workflowId,
            workflowName: this.workflowName,
            workflowVersion: this.workflowVersion,
            executionId: crypto.randomUUID(),
            userId: context.userId || input.user_id,
            sessionId: context.sessionId,
            metadata: {
              step_purpose: 'Validate plan feasibility and optimize if needed',
              expected_output: 'Validated and optimized execution plan with confidence score',
            },
          },
          {
            query: input.query,
            knowledge_context: knowledgeResult.knowledge_context,
            execution_plan: planResult.execution_plan,
            query_analysis: planResult.query_analysis
          },
          async () => await validatePlanStep.execute({
            context: {},
            input: {
              query: input.query,
              knowledge_context: knowledgeResult.knowledge_context,
              execution_plan: planResult.execution_plan,
              query_analysis: planResult.query_analysis
            }
          })
        );

        return validationResult as PlanningOutput;
      }
    );
  }
}

/**
 * Analyzes query requirements and complexity
 */
function analyzeQueryRequirements(query: string, knowledgeContext?: any[]) {
  const queryLower = query.toLowerCase();

  // Identify data requirements
  const dataRequirements = {
    needs_historical_data: /\b(historical|past|previous|trend|over time)\b/.test(queryLower),
    needs_comparison: /\b(compare|vs|versus|against|difference)\b/.test(queryLower),
    needs_aggregation: /\b(total|sum|average|count|group|segment)\b/.test(queryLower),
    needs_calculation: /\b(calculate|compute|derive|formula|rate|ratio)\b/.test(queryLower),
    needs_visualization: /\b(chart|graph|plot|dashboard|visual)\b/.test(queryLower),
  };

  // Identify business domains
  const businessDomains = {
    financial: /\b(revenue|profit|cost|margin|roi|financial)\b/.test(queryLower),
    customer: /\b(customer|client|user|churn|acquisition|retention)\b/.test(queryLower),
    operational: /\b(operations|efficiency|productivity|performance|process)\b/.test(queryLower),
    marketing: /\b(marketing|campaign|conversion|leads|attribution)\b/.test(queryLower),
    sales: /\b(sales|deals|pipeline|quota|territory)\b/.test(queryLower),
  };

  // Calculate complexity score
  const dataComplexity = Object.values(dataRequirements).filter(Boolean).length;
  const domainComplexity = Object.values(businessDomains).filter(Boolean).length;
  const knowledgeBoost = knowledgeContext ? Math.min(knowledgeContext.length * 0.5, 2) : 0;

  const complexityScore = Math.min(10, dataComplexity * 1.5 + domainComplexity + knowledgeBoost);

  return {
    data_requirements: dataRequirements,
    business_domains: businessDomains,
    complexity_score: complexityScore,
    estimated_steps: Math.max(3, Math.ceil(complexityScore / 2)),
  };
}

/**
 * Generates execution plan based on analysis
 */
function generateExecutionPlan(analysis: any, constraints?: any): PlanningStep[] {
  const plan: PlanningStep[] = [];
  let stepNumber = 1;

  // Step 1: Enhanced knowledge-based context gathering
  const hasKnowledgeContext = constraints?.knowledge_context && constraints.knowledge_context.length > 0;

  if (!hasKnowledgeContext || analysis.complexity_score > 7) {
    plan.push({
      step_number: stepNumber++,
      action: 'Search knowledge base for domain-specific context and methodologies',
      tool: 'search-knowledge-base',
      parameters: {
        query: hasKnowledgeContext
          ? `business analysis methodology for ${Object.keys(analysis.business_domains).filter(d => analysis.business_domains[d]).join(', ')}`
          : 'business metrics definitions and analytical methodologies',
        searchType: 'hybrid',
        maxResults: 5,
        categories: Object.keys(analysis.business_domains).filter(d => analysis.business_domains[d]),
      },
      expected_output: 'Domain-specific knowledge, definitions, methodologies, and best practices',
      reasoning: hasKnowledgeContext
        ? 'Supplement existing knowledge with domain-specific context for comprehensive analysis'
        : 'Establish knowledge foundation for accurate business intelligence analysis',
    });
  }

  // Step 2: Data requirements analysis
  if (analysis.data_requirements.needs_aggregation || analysis.data_requirements.needs_calculation) {
    plan.push({
      step_number: stepNumber++,
      action: 'Identify and validate data requirements',
      tool: 'mcp-tool',
      parameters: {
        operation: 'data-validation',
        requirements: analysis.data_requirements,
      },
      expected_output: 'Validated data sources and calculation methods',
      reasoning: 'Ensure data quality and appropriate analytical methods before proceeding',
    });
  }

  // Step 3: Core analysis
  plan.push({
    step_number: stepNumber++,
    action: 'Perform core business analysis',
    tool: 'mcp-tool',
    parameters: {
      operation: 'business-analysis',
      domains: analysis.business_domains,
      complexity: analysis.complexity_score,
    },
    expected_output: 'Primary analytical results and key findings',
    reasoning: 'Execute the main analytical work based on established context and requirements',
  });

  // Step 4: Comparison or trend analysis (if needed)
  if (analysis.data_requirements.needs_comparison || analysis.data_requirements.needs_historical_data) {
    plan.push({
      step_number: stepNumber++,
      action: 'Perform comparative or trend analysis',
      tool: 'mcp-tool',
      parameters: {
        operation: 'comparative-analysis',
        include_trends: analysis.data_requirements.needs_historical_data,
        include_comparisons: analysis.data_requirements.needs_comparison,
      },
      expected_output: 'Comparative insights and trend analysis results',
      reasoning: 'Provide additional context through comparisons and historical perspective',
    });
  }

  // Step 5: Synthesis and recommendations
  plan.push({
    step_number: stepNumber++,
    action: 'Synthesize findings and generate recommendations',
    tool: 'business-intelligence-agent',
    parameters: {
      operation: 'synthesis',
      findings: 'previous_step_results',
      domains: analysis.business_domains,
    },
    expected_output: 'Comprehensive business insights and actionable recommendations',
    reasoning: 'Transform analytical results into business-relevant insights and recommendations',
  });

  return plan;
}

/**
 * Validates execution plan feasibility
 */
function validateExecutionPlan(plan: PlanningStep[], analysis: any) {
  const issues = [];
  let needsOptimization = false;

  // Check plan completeness
  if (plan.length < 3) {
    issues.push('Plan may be too simple for the query complexity');
    needsOptimization = true;
  }

  if (plan.length > 8) {
    issues.push('Plan may be overly complex');
    needsOptimization = true;
  }

  // Check for missing steps based on requirements
  const hasDataGathering = plan.some(step => step.tool === 'knowledge-search');
  const hasAnalysis = plan.some(step => step.tool.includes('analysis') || step.tool.includes('agent'));

  if (!hasDataGathering && analysis.complexity_score > 5) {
    issues.push('Missing data gathering step for complex query');
    needsOptimization = true;
  }

  if (!hasAnalysis) {
    issues.push('Missing core analysis step');
    needsOptimization = true;
  }

  return {
    is_valid: issues.length === 0,
    needs_optimization: needsOptimization,
    issues,
  };
}

/**
 * Optimizes execution plan based on validation issues
 */
function optimizePlan(plan: PlanningStep[], issues: string[]): PlanningStep[] {
  let optimizedPlan = [...plan];

  // Add missing data gathering if needed
  if (issues.some(issue => issue.includes('data gathering'))) {
    const dataStep: PlanningStep = {
      step_number: 1,
      action: 'Establish comprehensive data context',
      tool: 'knowledge-search',
      parameters: { query: 'comprehensive business context', depth: 'detailed' },
      expected_output: 'Complete contextual foundation for analysis',
      reasoning: 'Added to address complexity requirements identified during validation',
    };

    optimizedPlan = [dataStep, ...optimizedPlan.map(step => ({
      ...step,
      step_number: step.step_number + 1,
    }))];
  }

  // Simplify if too complex
  if (issues.some(issue => issue.includes('overly complex'))) {
    optimizedPlan = optimizedPlan.filter((_, index) => index % 2 === 0 || index === optimizedPlan.length - 1);
    optimizedPlan = optimizedPlan.map((step, index) => ({
      ...step,
      step_number: index + 1,
    }));
  }

  return optimizedPlan;
}

/**
 * Calculates confidence score for the plan
 */
function calculateConfidenceScore(plan: PlanningStep[], knowledgeContext?: any[]): number {
  let baseScore = 0.7; // Base confidence

  // Boost for knowledge context
  if (knowledgeContext && knowledgeContext.length > 0) {
    baseScore += Math.min(knowledgeContext.length * 0.1, 0.2);
  }

  // Boost for comprehensive plan
  if (plan.length >= 4) {
    baseScore += 0.1;
  }

  // Boost for data gathering steps
  const hasDataGathering = plan.some(step => step.tool === 'knowledge-search');
  if (hasDataGathering) {
    baseScore += 0.1;
  }

  return Math.min(1.0, Math.round(baseScore * 10) / 10);
}

/**
 * Enhanced planning execution with tracing
 */
export async function executePlanning(
  input: PlanningInput,
  options: {
    traceId?: string;
    userId?: string;
  } = {}
): Promise<PlanningOutput> {
  const tracer = new WorkflowTracer(
    'planning-workflow',
    `planning-${Date.now()}`,
    {
      userId: options.userId || input.user_id,
      input,
      metadata: {
        trace_id: options.traceId,
        query_length: input.query.length,
      },
    }
  );

  try {
    workflowLogger.info('Planning workflow starting', {
      user_id: input.user_id,
      query_length: input.query.length,
      trace_id: tracer.getTraceId(),
    });

    const result = await trackPerformance(
      workflowLogger,
      'planning-execution',
      async () => {
        return await planningWorkflow.execute(input) as PlanningOutput;
      },
      {
        user_id: input.user_id,
        trace_id: tracer.getTraceId(),
      }
    );

    tracer.end({
      output: result,
      metadata: {
        plan_steps: result.plan.length,
        knowledge_sources: result.knowledge_sources.length,
        confidence_score: result.confidence_score,
      },
    });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    tracer.end({
      error: errorMessage,
      metadata: {
        error_type: error instanceof Error ? error.name : 'UnknownError',
      },
    });

    workflowLogger.error('Planning workflow failed', error instanceof Error ? error : new Error(String(error)));

    throw error;
  }
}