import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  PlanningInputSchema,
  PlanningOutputSchema,
  PlanningStepSchema,
  type PlanningInput,
  type PlanningOutput,
  type PlanningStep,
} from '../types/workflows.js';

const PlanAnalysisSchema = z.object({
  query: z.string(),
  primaryGoal: z.string(),
  supportingSources: z.array(z.object({
    id: z.string(),
    title: z.string(),
    relevance: z.number(),
  })),
  metrics: z.array(z.string()),
  timeframes: z.array(z.string()),
});

const analyseStep = createStep({
  id: 'analyse-query',
  inputSchema: PlanningInputSchema,
  outputSchema: PlanningInputSchema.extend({
    analysis: PlanAnalysisSchema,
  }),
  execute: async ({ inputData }) => {
    const analysis = buildAnalysis(inputData.query, inputData.knowledge_context ?? []);
    return { ...inputData, analysis };
  },
});

const composePlanStep = createStep({
  id: 'compose-plan',
  inputSchema: analyseStep.outputSchema,
  outputSchema: PlanningOutputSchema,
  execute: async ({ inputData }) => {
    const plan = buildPlan(inputData.analysis, inputData.constraints);
    const knowledgeSources = (inputData.knowledge_context ?? []).map((item: any) => item.id || item.sourceId || 'unknown');

    return {
      query: inputData.query,
      plan,
      knowledge_sources: knowledgeSources,
      confidence_score: estimateConfidence(plan, inputData.analysis),
    } satisfies PlanningOutput;
  },
});

export const planningWorkflow = createWorkflow({
  id: 'planning',
  inputSchema: PlanningInputSchema,
  outputSchema: PlanningOutputSchema,
})
  .then(analyseStep)
  .then(composePlanStep)
  .commit();

export async function executePlanning(input: PlanningInput): Promise<PlanningOutput> {
  const run = await planningWorkflow.createRunAsync();
  const result = await run.start({ inputData: input });

  if (result.status !== 'success') {
    const error = (result as { error?: unknown }).error;
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('planning workflow failed');
  }

  return result.result as PlanningOutput;
}

function buildAnalysis(query: string, knowledgeContext: any[]): PlanAnalysis {
  const primaryGoal = query.trim();
  const supportingSources = knowledgeContext.map(item => ({
    id: item.id ?? item.sourceId ?? 'unknown',
    title: item.title ?? 'Knowledge Source',
    relevance: typeof item.relevance_score === 'number' ? item.relevance_score : 0.5,
  }));

  const metrics = extractMetrics(query);
  const timeframes = extractTimeframes(query);

  return PlanAnalysisSchema.parse({
    query,
    primaryGoal,
    supportingSources,
    metrics,
    timeframes,
  });
}

function buildPlan(analysis: PlanAnalysis, constraints?: Record<string, unknown>): PlanningStep[] {
  const steps: PlanningStep[] = [];

  steps.push(createPlanningStep(1, 'Review context', 'knowledge.review', {
    sources: analysis.supportingSources.map(s => s.id),
  }, 'Context summary prepared'));

  if (analysis.metrics.length > 0) {
    steps.push(createPlanningStep(steps.length + 1, 'Collect metrics', 'data.fetch', {
      metrics: analysis.metrics,
      timeframe: analysis.timeframes[0] ?? 'latest available',
    }, 'Relevant metrics retrieved'));
  }

  steps.push(createPlanningStep(steps.length + 1, 'Analyse findings', 'analysis.run', {
    goal: analysis.primaryGoal,
    metrics: analysis.metrics,
    timeframe: analysis.timeframes,
  }, 'Preliminary insights drafted'));

  steps.push(createPlanningStep(steps.length + 1, 'Prepare recommendations', 'analysis.summarise', {
    goal: analysis.primaryGoal,
    constraints,
  }, 'Recommendations compiled'));

  return steps;
}

function createPlanningStep(number: number, action: string, tool: string, parameters: Record<string, unknown>, expected: string): PlanningStep {
  return PlanningStepSchema.parse({
    step_number: number,
    action,
    tool,
    parameters,
    expected_output: expected,
    reasoning: `Required to progress ${action.toLowerCase()}.`,
  });
}

function estimateConfidence(plan: PlanningStep[], analysis: PlanAnalysis): number {
  const base = plan.length >= 4 ? 0.7 : 0.6;
  const sourceBoost = Math.min(analysis.supportingSources.length * 0.05, 0.2);
  return Math.min(0.9, base + sourceBoost);
}

function extractMetrics(query: string): string[] {
  const metrics: string[] = [];
  const lower = query.toLowerCase();
  if (lower.includes('revenue')) metrics.push('revenue');
  if (lower.includes('margin')) metrics.push('margin');
  if (lower.includes('roi')) metrics.push('roi');
  if (lower.includes('cac')) metrics.push('customer acquisition cost');
  if (lower.includes('retention')) metrics.push('retention rate');
  return metrics;
}

function extractTimeframes(query: string): string[] {
  const timeframes: string[] = [];
  const lower = query.toLowerCase();
  if (lower.includes('q1') || lower.includes('quarter')) timeframes.push('quarterly');
  if (lower.includes('yoy') || lower.includes('year-over-year') || lower.includes('annual')) timeframes.push('year-over-year');
  if (lower.includes('monthly')) timeframes.push('monthly');
  return timeframes;
}

type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>;
