import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  PromptOrchestrationInputSchema,
  IntentClassificationOutputSchema,
  type PromptOrchestrationInput,
  type IntentClassificationOutput,
} from '../types/workflows.js';

const classifyStep = createStep({
  id: 'classify-intent',
  inputSchema: PromptOrchestrationInputSchema,
  outputSchema: IntentClassificationOutputSchema,
  execute: async ({ inputData }) => {
    const factors = analyseFactors(inputData.prompt, inputData.context ?? {});
    const complexityScore = calculateComplexityScore(factors);

    const classification = buildClassification(inputData.prompt, complexityScore, factors);

    return {
      classification,
      complexity_analysis: {
        total_score: complexityScore,
        factors,
        threshold_met: complexityScore >= 5,
      },
      routing_decision: {
        recommended_agent: classification.recommended_agent,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
      },
    } satisfies IntentClassificationOutput;
  },
});

export const intentClassifierWorkflow = createWorkflow({
  id: 'intent-classification',
  inputSchema: PromptOrchestrationInputSchema,
  outputSchema: IntentClassificationOutputSchema,
})
  .then(classifyStep)
  .commit();

export async function executeIntentClassifier(input: PromptOrchestrationInput): Promise<IntentClassificationOutput> {
  const run = await intentClassifierWorkflow.createRunAsync();
  const result = await run.start({ inputData: input });

  if (result.status !== 'success') {
    const error = (result as { error?: unknown }).error;
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('intent-classification workflow failed');
  }

  return result.result as IntentClassificationOutput;
}

function analyseFactors(prompt: string, context: Record<string, any>) {
  const text = prompt.toLowerCase();

  const keywordScore = countMatches(text, [
    'analyze',
    'analysis',
    'trend',
    'forecast',
    'regression',
    'kpi',
    'roi',
    'margin',
    'cohort',
  ]);

  const entityScore = countMatches(text, [
    'customer',
    'segment',
    'region',
    'channel',
    'product',
    'campaign',
    'table',
    'dataset',
  ]);

  const timeScore = countMatches(text, [
    'monthly',
    'quarterly',
    'yearly',
    'trend',
    'historical',
    'projection',
  ]);

  const outputScore = countMatches(text, [
    'scenario',
    'plan',
    'strategy',
    'dashboard',
    'recommendation',
  ]);

  const contextDepth = contextDepthScore(context);

  return {
    keywords: keywordScore,
    entities: entityScore,
    temporal: timeScore,
    output_complexity: outputScore,
    context_depth: contextDepth,
  } as Record<string, number>;
}

function calculateComplexityScore(factors: Record<string, number>) {
  const weights: Record<string, number> = {
    keywords: 0.3,
    entities: 0.2,
    temporal: 0.15,
    output_complexity: 0.25,
    context_depth: 0.1,
  };

  return Object.entries(factors).reduce((total, [key, value]) => {
    return total + (weights[key] ?? 0) * Math.min(10, value);
  }, 0);
}

function buildClassification(prompt: string, score: number, factors: Record<string, number>) {
  const recommendedAgent = score >= 5 ? 'business-intelligence-agent' : 'default-agent';
  const intent = score >= 5 ? 'analytical' : 'simple';
  const confidence = Math.min(1, Math.max(0.25, score / 10));
  const highlights = Object.entries(factors)
    .filter(([, value]) => value >= 6)
    .map(([name]) => name.replace('_', ' '));

  const reasoning = highlights.length
    ? `High complexity detected in ${highlights.join(', ')}. Routing to ${recommendedAgent}.`
    : `Query appears ${intent}; routing to ${recommendedAgent}.`;

  return {
    intent,
    confidence,
    complexity_score: score,
    reasoning,
    recommended_agent: recommendedAgent,
    factors,
  };
}

function countMatches(text: string, keywords: string[]) {
  return keywords.reduce((total, keyword) => {
    return text.includes(keyword) ? total + 1 : total;
  }, 0);
}

function contextDepthScore(context: Record<string, any>) {
  let score = 0;
  if (Array.isArray(context.previous_queries) && context.previous_queries.length > 0) {
    score += 3;
  }
  if (context.data_requirements) {
    score += 2;
  }
  if (context.constraints) {
    score += 2;
  }
  return score;
}
