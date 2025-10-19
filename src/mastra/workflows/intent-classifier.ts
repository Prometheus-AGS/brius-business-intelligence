import { createStep, createWorkflow } from '@mastra/core/workflows';
import { IntentClassificationInputSchema, IntentClassificationOutputSchema, IntentClassificationInput, IntentClassificationOutput, IntentClassification } from '../types/index.js';
import { workflowLogger } from '../observability/logger.js';
import { getWorkflowExecutionTracer, WorkflowExecutionContext, WorkflowStepContext } from '../observability/workflow-tracer.js';

/**
 * Intent Classification Workflow
 * Analyzes user queries to determine complexity and route to appropriate agents
 * Uses multi-dimensional scoring for intelligent routing decisions
 */

const classifyIntentStep = createStep({
  id: 'classify-intent',
  inputSchema: IntentClassificationInputSchema,
  outputSchema: IntentClassificationOutputSchema,
  execute: async ({ inputData }) => {
    const { prompt, context: queryContext } = inputData;

    workflowLogger.info('Starting intent classification', {
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      hasContext: Boolean(queryContext),
    });

    // Multi-dimensional complexity analysis
    const factors = analyzeComplexityFactors(prompt, queryContext);

    // Calculate overall complexity score (0-10)
    const complexityScore = calculateComplexityScore(factors);

    // Determine intent and recommended agent
    const { intent, confidence, reasoning, recommendedAgent } = classifyIntent(
      prompt,
      complexityScore,
      factors
    );

    const classification: IntentClassification = {
      intent,
      confidence,
      complexity_score: complexityScore,
      reasoning,
      recommended_agent: recommendedAgent,
      factors,
    };

    const result: IntentClassificationOutput = {
      classification,
      complexity_analysis: {
        total_score: complexityScore,
        factors,
        threshold_met: complexityScore >= 5, // Threshold for complex routing
      },
      routing_decision: {
        recommended_agent: recommendedAgent,
        confidence,
        reasoning,
      },
    };

    workflowLogger.info('Intent classification completed', {
      intent,
      complexity_score: complexityScore,
      recommended_agent: recommendedAgent,
      confidence,
    });

    return result;
  },
});

/**
 * Analyzes complexity factors in the user query
 */
function analyzeComplexityFactors(prompt: string, context?: Record<string, any>) {
  const factors = {
    keywords: analyzeKeywords(prompt),
    entities: analyzeEntities(prompt),
    aggregation: analyzeAggregationNeeds(prompt),
    temporal: analyzeTemporalComplexity(prompt),
    output_complexity: analyzeOutputComplexity(prompt),
  };

  // Boost scores if context suggests complexity
  if (context?.previous_queries || context?.data_requirements) {
    factors.keywords = Math.min(10, factors.keywords + 1);
    factors.entities = Math.min(10, factors.entities + 1);
  }

  return factors;
}

/**
 * Analyzes business and analytical keywords
 */
function analyzeKeywords(prompt: string): number {
  const businessKeywords = [
    // Analysis keywords
    'analyze', 'analysis', 'trend', 'trends', 'pattern', 'patterns',
    'compare', 'comparison', 'versus', 'vs', 'correlate', 'correlation',
    'forecast', 'predict', 'projection', 'model', 'regression',

    // Business metrics
    'revenue', 'profit', 'loss', 'margin', 'growth', 'performance',
    'kpi', 'metric', 'metrics', 'roi', 'conversion', 'churn',
    'customer', 'segment', 'market', 'competitive', 'benchmark',

    // Temporal analysis
    'quarter', 'monthly', 'yearly', 'seasonal', 'historical',
    'year-over-year', 'yoy', 'month-over-month', 'mom',

    // Statistical terms
    'average', 'mean', 'median', 'percentile', 'distribution',
    'variance', 'standard deviation', 'confidence interval',
  ];

  const complexAnalyticalKeywords = [
    // Advanced analytics
    'cohort', 'funnel', 'attribution', 'lift', 'significance',
    'regression', 'clustering', 'segmentation', 'optimization',
    'machine learning', 'ai', 'algorithm', 'model',

    // Business intelligence
    'dashboard', 'scorecard', 'balanced scorecard', 'executive summary',
    'drill-down', 'slice', 'dice', 'pivot', 'olap',
  ];

  const lowerPrompt = prompt.toLowerCase();
  let score = 0;

  // Basic business keywords (1 point each, max 5)
  for (const keyword of businessKeywords) {
    if (lowerPrompt.includes(keyword)) {
      score += 1;
    }
  }

  // Complex analytical keywords (2 points each, max 6)
  for (const keyword of complexAnalyticalKeywords) {
    if (lowerPrompt.includes(keyword)) {
      score += 2;
    }
  }

  return Math.min(10, score);
}

/**
 * Analyzes entity complexity (data sources, dimensions)
 */
function analyzeEntities(prompt: string): number {
  const entityPatterns = [
    // Data entities
    /\b(table|database|dataset|data source|collection)\b/gi,
    /\b(customer|user|client|account|lead|prospect)\b/gi,
    /\b(product|service|item|sku|catalog)\b/gi,
    /\b(order|transaction|purchase|sale|invoice)\b/gi,
    /\b(campaign|marketing|advertising|promotion)\b/gi,

    // Time dimensions
    /\b(date|time|timestamp|period|duration)\b/gi,
    /\b(daily|weekly|monthly|quarterly|yearly)\b/gi,

    // Geographic dimensions
    /\b(region|country|state|city|location|geography)\b/gi,

    // Business dimensions
    /\b(department|division|team|branch|channel)\b/gi,
  ];

  let entityCount = 0;
  for (const pattern of entityPatterns) {
    const matches = prompt.match(pattern);
    if (matches) {
      entityCount += matches.length;
    }
  }

  // Multiple entity references suggest complex queries
  if (entityCount >= 5) return 10;
  if (entityCount >= 3) return 7;
  if (entityCount >= 2) return 4;
  if (entityCount >= 1) return 2;
  return 0;
}

/**
 * Analyzes aggregation and calculation needs
 */
function analyzeAggregationNeeds(prompt: string): number {
  const aggregationKeywords = [
    // Basic aggregations
    'sum', 'total', 'count', 'average', 'mean', 'median', 'max', 'min',

    // Advanced aggregations
    'group by', 'segment', 'bucket', 'bin', 'percentile', 'quartile',
    'rolling', 'moving average', 'cumulative', 'running total',

    // Ratios and rates
    'ratio', 'rate', 'percentage', 'proportion', 'share',
    'growth rate', 'conversion rate', 'churn rate',

    // Complex calculations
    'calculate', 'compute', 'derive', 'formula', 'equation',
  ];

  const lowerPrompt = prompt.toLowerCase();
  let score = 0;

  for (const keyword of aggregationKeywords) {
    if (lowerPrompt.includes(keyword)) {
      score += keyword.includes('group') || keyword.includes('rolling') ||
              keyword.includes('cumulative') ? 3 : 1;
    }
  }

  return Math.min(10, score);
}

/**
 * Analyzes temporal complexity
 */
function analyzeTemporalComplexity(prompt: string): number {
  const temporalPatterns = [
    // Time comparisons (high complexity)
    /\b(year.over.year|yoy|month.over.month|mom|quarter.over.quarter)\b/gi,
    /\b(compare.*\d{4}|versus.*\d{4}|\d{4}.*vs.*\d{4})\b/gi,

    // Time series analysis
    /\b(trend|trending|seasonal|cyclical|periodic)\b/gi,
    /\b(forecast|predict|projection|future)\b/gi,

    // Multiple time periods
    /\b(last.*\d+.*(months?|quarters?|years?))\b/gi,
    /\b(\d+.*(months?|quarters?|years?).*ago)\b/gi,

    // Specific date ranges
    /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2})\b/gi,
  ];

  let score = 0;
  for (const pattern of temporalPatterns) {
    const matches = prompt.match(pattern);
    if (matches) {
      score += matches.length * 2;
    }
  }

  // Simple time references
  const simpleTimeKeywords = ['today', 'yesterday', 'this week', 'last month', 'this year'];
  for (const keyword of simpleTimeKeywords) {
    if (prompt.toLowerCase().includes(keyword)) {
      score += 1;
    }
  }

  return Math.min(10, score);
}

/**
 * Analyzes expected output complexity
 */
function analyzeOutputComplexity(prompt: string): number {
  const outputIndicators = [
    // Complex visualizations
    'chart', 'graph', 'plot', 'visualization', 'dashboard',
    'heatmap', 'scatter plot', 'correlation matrix',

    // Detailed reports
    'report', 'summary', 'breakdown', 'analysis', 'deep dive',
    'executive summary', 'detailed analysis',

    // Multiple outputs
    'both', 'also', 'additionally', 'furthermore', 'as well as',

    // Export requirements
    'export', 'download', 'pdf', 'excel', 'csv',
  ];

  const lowerPrompt = prompt.toLowerCase();
  let score = 0;

  for (const indicator of outputIndicators) {
    if (lowerPrompt.includes(indicator)) {
      score += indicator.includes('executive') || indicator.includes('detailed') ? 3 : 1;
    }
  }

  return Math.min(10, score);
}

/**
 * Calculates overall complexity score from factors
 */
function calculateComplexityScore(factors: Record<string, number>): number {
  // Weighted calculation
  const weights = {
    keywords: 0.25,
    entities: 0.20,
    aggregation: 0.25,
    temporal: 0.20,
    output_complexity: 0.10,
  };

  let weightedScore = 0;
  for (const [factor, score] of Object.entries(factors)) {
    weightedScore += score * (weights[factor as keyof typeof weights] || 0);
  }

  return Math.round(weightedScore * 10) / 10; // Round to 1 decimal
}

/**
 * Classifies intent and determines routing
 */
function classifyIntent(
  prompt: string,
  complexityScore: number,
  factors: Record<string, number>
) {
  // Routing logic based on complexity
  if (complexityScore >= 6) {
    return {
      intent: 'analytical' as const,
      confidence: 0.9,
      reasoning: `High complexity score (${complexityScore}) indicates need for advanced analytical capabilities and planning`,
      recommendedAgent: 'business-intelligence-agent',
    };
  } else if (complexityScore >= 3) {
    return {
      intent: 'complex' as const,
      confidence: 0.8,
      reasoning: `Medium complexity score (${complexityScore}) suggests structured analysis needed`,
      recommendedAgent: 'business-intelligence-agent',
    };
  } else {
    return {
      intent: 'simple' as const,
      confidence: 0.7,
      reasoning: `Low complexity score (${complexityScore}) indicates straightforward query`,
      recommendedAgent: 'default-agent',
    };
  }
}

export const intentClassifierWorkflow = createWorkflow({
  id: 'intent-classifier',
  inputSchema: IntentClassificationInputSchema,
  outputSchema: IntentClassificationOutputSchema,
  steps: [classifyIntentStep],
})
  .then(classifyIntentStep)
  .commit();

/**
 * Enhanced execute function with comprehensive workflow tracing
 */
export async function executeIntentClassifier(
  input: IntentClassificationInput,
  context: {
    userId?: string;
    sessionId?: string;
    agentId?: string;
    metadata?: Record<string, any>;
  } = {}
): Promise<IntentClassificationOutput> {
  const tracer = getWorkflowExecutionTracer();

  const workflowContext: WorkflowExecutionContext = {
    workflowId: 'intent-classifier',
    workflowName: 'Intent Classification Workflow',
    workflowVersion: '1.0.0',
    userId: context.userId,
    sessionId: context.sessionId,
    executionId: `intent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    metadata: {
      workflow_type: 'intent_classification',
      prompt_length: input.prompt.length,
      has_context: Boolean(input.context),
      ...context.metadata,
    },
  };

  const inputData = {
    prompt: input.prompt,
    context: input.context,
    execution_context: {
      userId: context.userId,
      sessionId: context.sessionId,
      agentId: context.agentId,
    },
  };

  return await tracer.traceWorkflowExecution(workflowContext, inputData, async () => {
    workflowLogger.info('Intent Classification Workflow starting', {
      user_id: context.userId,
      session_id: context.sessionId,
      prompt_length: input.prompt.length,
      has_context: Boolean(input.context),
    });

    // Execute the workflow with step tracing
    const traceId = await tracer.startWorkflowTrace(workflowContext, inputData);

    if (traceId) {
      // Start the classify intent step span
      const stepContext: WorkflowStepContext = {
        stepId: 'classify-intent',
        stepName: 'Classify Intent',
        stepType: 'data_transformation',
        stepIndex: 0,
        totalSteps: 1,
      };

      const stepSpanId = await tracer.startWorkflowStep(
        traceId,
        workflowContext,
        stepContext,
        inputData
      );

      try {
        // Execute the actual workflow
        const result = await intentClassifierWorkflow.execute(input);

        // Complete the step span
        await tracer.completeWorkflowStep(stepSpanId, stepContext, {
          success: true,
          output: result,
          duration: 0, // Would need to track this manually
        });

        workflowLogger.info('Intent Classification Workflow completed', {
          user_id: context.userId,
          session_id: context.sessionId,
          intent: result.classification.intent,
          complexity_score: result.classification.complexity_score,
          recommended_agent: result.classification.recommended_agent,
        });

        return result;

      } catch (error) {
        // Complete the step span with error
        await tracer.completeWorkflowStep(stepSpanId, stepContext, {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          duration: 0,
        });

        throw error;
      }
    } else {
      // Fallback execution without tracing
      const result = await intentClassifierWorkflow.execute(input);

      workflowLogger.info('Intent Classification Workflow completed (no tracing)', {
        user_id: context.userId,
        session_id: context.sessionId,
        intent: result.classification.intent,
        complexity_score: result.classification.complexity_score,
        recommended_agent: result.classification.recommended_agent,
      });

      return result;
    }
  });
}