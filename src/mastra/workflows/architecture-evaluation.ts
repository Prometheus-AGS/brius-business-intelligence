/**
 * Architecture Evaluation Workflow
 * Orchestrates comprehensive agent architecture pattern evaluation and optimization
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer, createBIWorkflowTracer } from '../observability/context-tracer.js';
import {
  AgentArchitecturePattern,
  PatternEvaluationResult,
  ArchitectureRecommendation,
  QueryCharacteristics,
  BenchmarkResult,
  PatternType,
  QueryCharacteristicsSchema,
  UserContext,
  AnonymousContext,
} from '../types/context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// Input schema for the workflow
const ArchitectureEvaluationInput = z.object({
  sessionId: z.string().uuid().describe('Session identifier for context'),
  evaluationType: z.enum(['comprehensive', 'quick', 'benchmark', 'recommendation']).default('comprehensive'),
  queryCharacteristics: QueryCharacteristicsSchema.optional().describe('Query to analyze (required for recommendation)'),
  benchmarkQueries: z.array(z.object({
    query: z.string(),
    expectedResults: z.number().optional(),
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])),
  })).optional().describe('Benchmark queries for performance testing'),
  includeBestPractices: z.boolean().default(true).describe('Include best practices research from Tavily'),
  generateReport: z.boolean().default(true).describe('Generate comprehensive evaluation report'),
  userId: z.string().optional().describe('User ID for tracing'),
});

// Output schema
const ArchitectureEvaluationOutput = z.object({
  sessionId: z.string(),
  evaluationType: z.string(),
  evaluationResult: z.object({
    patternsEvaluated: z.number(),
    benchmarksExecuted: z.number(),
    recommendation: z.any().optional(),
    bestPractices: z.array(z.string()).optional(),
    performanceSummary: z.object({
      averageScore: z.number(),
      topPerformingPattern: z.string(),
      recommendations: z.array(z.string()),
    }),
  }),
  performance: z.object({
    evaluationTime: z.number(),
    totalSteps: z.number(),
    completedSteps: z.number(),
  }),
  metadata: z.object({
    timestamp: z.string(),
    workflowId: z.string(),
    userId: z.string().optional(),
  }),
});

/**
 * Step 1: Pattern Discovery and Registration
 */
const patternDiscoveryStep = createStep({
  id: 'pattern-discovery',
  description: 'Discover and register available architecture patterns',
  inputSchema: ArchitectureEvaluationInput,
  outputSchema: z.object({
    sessionId: z.string(),
    discoveredPatterns: z.array(z.any()),
    registeredPatterns: z.number(),
    defaultPatterns: z.array(z.any()),
  }),
  execute: async ({ sessionId, evaluationType, userId }) => {
    return await withErrorHandling(
      async () => {
        rootLogger.info('Starting pattern discovery', { sessionId, evaluationType });

        const userContext = await biContextStore.getUserContext(sessionId);
        if (!userContext) {
          throw new Error('Session context not found');
        }

        // Search for existing patterns
        const existingPatterns = await biContextStore.searchContextMemories(sessionId, 'architecture pattern', {
          userId: userContext.userId,
          category: 'architecture-pattern',
          topK: 50,
          similarityThreshold: 0.1,
        });

        const patterns: AgentArchitecturePattern[] = [];
        for (const result of existingPatterns) {
          try {
            const pattern = JSON.parse(result.content) as AgentArchitecturePattern;
            patterns.push(pattern);
          } catch (parseError) {
            rootLogger.warn('Failed to parse existing pattern', { resultId: result.id });
          }
        }

        // Register default patterns if none exist
        let defaultPatterns: AgentArchitecturePattern[] = [];
        if (patterns.length === 0) {
          defaultPatterns = await registerDefaultPatterns(sessionId, userContext);
          patterns.push(...defaultPatterns);
        }

        rootLogger.info('Pattern discovery completed', {
          sessionId,
          existingPatterns: existingPatterns.length,
          defaultPatternsRegistered: defaultPatterns.length,
          totalPatterns: patterns.length,
        });

        return {
          sessionId,
          discoveredPatterns: patterns,
          registeredPatterns: patterns.length,
          defaultPatterns,
        };
      },
      {
        component: 'architecture-evaluation-workflow',
        operation: 'pattern_discovery',
        sessionId,
      },
      'medium'
    );
  },
});

/**
 * Step 2: Performance Benchmarking
 */
const performanceBenchmarkingStep = createStep({
  id: 'performance-benchmarking',
  description: 'Execute performance benchmarks against discovered patterns',
  inputSchema: z.object({
    sessionId: z.string(),
    discoveredPatterns: z.array(z.any()),
    benchmarkQueries: z.array(z.object({
      query: z.string(),
      expectedResults: z.number().optional(),
      domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])),
    })).optional(),
    evaluationType: z.enum(['comprehensive', 'quick', 'benchmark', 'recommendation']),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    benchmarkResults: z.array(z.any()),
    performanceSummary: z.object({
      totalBenchmarks: z.number(),
      averageExecutionTime: z.number(),
      topPerformingPattern: z.string(),
      performanceScores: z.record(z.string(), z.number()),
    }),
  }),
  execute: async ({ sessionId, discoveredPatterns, benchmarkQueries, evaluationType }) => {
    return await withErrorHandling(
      async () => {
        rootLogger.info('Starting performance benchmarking', {
          sessionId,
          patternsToTest: discoveredPatterns.length,
          benchmarkQueries: benchmarkQueries?.length || 0,
          evaluationType,
        });

        const userContext = await biContextStore.getUserContext(sessionId);
        if (!userContext) {
          throw new Error('Session context not found');
        }

        // Use provided benchmark queries or generate default ones
        const testQueries = benchmarkQueries && benchmarkQueries.length > 0
          ? benchmarkQueries
          : generateDefaultBenchmarkQueries(evaluationType);

        const allBenchmarkResults: BenchmarkResult[] = [];
        const performanceScores: Record<string, number> = {};

        // Execute benchmarks for each pattern
        for (const pattern of discoveredPatterns) {
          try {
            const patternResults = await executeBenchmarksForPattern(
              pattern,
              testQueries,
              sessionId,
              userContext
            );

            allBenchmarkResults.push(...patternResults);

            // Calculate performance score for this pattern
            const patternScore = calculatePatternPerformanceScore(patternResults);
            performanceScores[pattern.patternId] = patternScore;

            rootLogger.info('Pattern benchmarking completed', {
              sessionId,
              patternId: pattern.patternId,
              patternType: pattern.patternType,
              benchmarkCount: patternResults.length,
              performanceScore: patternScore,
            });

          } catch (error) {
            rootLogger.error('Pattern benchmarking failed', {
              sessionId,
              patternId: pattern.patternId,
              error: (error as Error).message,
            });

            // Record failed benchmark
            performanceScores[pattern.patternId] = 0;
          }
        }

        // Calculate overall performance summary
        const averageExecutionTime = allBenchmarkResults.length > 0
          ? allBenchmarkResults.reduce((sum, r) => sum + r.executionTime, 0) / allBenchmarkResults.length
          : 0;

        const topPerformingPattern = Object.entries(performanceScores)
          .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)[0]?.[0] || 'none';

        const performanceSummary = {
          totalBenchmarks: allBenchmarkResults.length,
          averageExecutionTime,
          topPerformingPattern,
          performanceScores,
        };

        // Store benchmark summary
        await biContextStore.storeContextMemory(sessionId, JSON.stringify({
          benchmarkResults: allBenchmarkResults,
          performanceSummary,
          timestamp: new Date().toISOString(),
        }), {
          userId: userContext.userId,
          category: 'benchmark-summary',
          domains: [],
          scope: 'session',
          metadata: {
            evaluationType,
            patternsEvaluated: discoveredPatterns.length,
            benchmarksExecuted: allBenchmarkResults.length,
          },
        });

        rootLogger.info('Performance benchmarking completed', {
          sessionId,
          totalBenchmarks: allBenchmarkResults.length,
          topPerformingPattern,
          averageScore: Object.values(performanceScores).reduce((sum, s) => sum + s, 0) / Object.values(performanceScores).length,
        });

        return {
          sessionId,
          benchmarkResults: allBenchmarkResults,
          performanceSummary,
        };
      },
      {
        component: 'architecture-evaluation-workflow',
        operation: 'performance_benchmarking',
        sessionId,
      },
      'high'
    );
  },
});

/**
 * Step 3: Best Practices Research
 */
const bestPracticesResearchStep = createStep({
  id: 'best-practices-research',
  description: 'Research architecture best practices using Tavily MCP server',
  inputSchema: z.object({
    sessionId: z.string(),
    performanceSummary: z.object({
      topPerformingPattern: z.string(),
      performanceScores: z.record(z.string(), z.number()),
    }),
    includeBestPractices: z.boolean(),
    queryCharacteristics: QueryCharacteristicsSchema.optional(),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    bestPractices: z.array(z.string()),
    researchSummary: z.object({
      topicsResearched: z.array(z.string()),
      practicesFound: z.number(),
      relevanceScore: z.number(),
    }),
  }),
  execute: async ({ sessionId, performanceSummary, includeBestPractices, queryCharacteristics }) => {
    return await withErrorHandling(
      async () => {
        if (!includeBestPractices) {
          rootLogger.info('Skipping best practices research', { sessionId });
          return {
            sessionId,
            bestPractices: [],
            researchSummary: {
              topicsResearched: [],
              practicesFound: 0,
              relevanceScore: 0,
            },
          };
        }

        rootLogger.info('Starting best practices research', {
          sessionId,
          topPerformingPattern: performanceSummary.topPerformingPattern,
        });

        const userContext = await biContextStore.getUserContext(sessionId);
        if (!userContext) {
          throw new Error('Session context not found');
        }

        // Research topics based on patterns and query characteristics
        const researchTopics = generateResearchTopics(performanceSummary, queryCharacteristics);
        const bestPractices: string[] = [];

        // Note: In a real implementation, this would use the Tavily MCP server
        // For now, we'll simulate the research with knowledge-based recommendations
        for (const topic of researchTopics) {
          const practices = await simulateBestPracticesResearch(topic);
          bestPractices.push(...practices);
        }

        // Remove duplicates and rank by relevance
        const uniquePractices = [...new Set(bestPractices)];
        const rankedPractices = rankBestPractices(uniquePractices, queryCharacteristics);

        const researchSummary = {
          topicsResearched: researchTopics,
          practicesFound: rankedPractices.length,
          relevanceScore: calculateRelevanceScore(rankedPractices, queryCharacteristics),
        };

        // Store research results
        await biContextStore.storeContextMemory(sessionId, JSON.stringify({
          bestPractices: rankedPractices,
          researchSummary,
          timestamp: new Date().toISOString(),
        }), {
          userId: userContext.userId,
          category: 'best-practices-research',
          domains: [],
          scope: 'session',
          metadata: {
            topicsCount: researchTopics.length,
            practicesFound: rankedPractices.length,
            relevanceScore: researchSummary.relevanceScore,
          },
        });

        rootLogger.info('Best practices research completed', {
          sessionId,
          topicsResearched: researchTopics.length,
          practicesFound: rankedPractices.length,
        });

        return {
          sessionId,
          bestPractices: rankedPractices,
          researchSummary,
        };
      },
      {
        component: 'architecture-evaluation-workflow',
        operation: 'best_practices_research',
        sessionId,
      },
      'low'
    );
  },
});

/**
 * Step 4: Architecture Recommendation Generation
 */
const recommendationGenerationStep = createStep({
  id: 'recommendation-generation',
  description: 'Generate comprehensive architecture recommendations',
  inputSchema: z.object({
    sessionId: z.string(),
    discoveredPatterns: z.array(z.any()),
    benchmarkResults: z.array(z.any()),
    performanceSummary: z.object({
      topPerformingPattern: z.string(),
      performanceScores: z.record(z.string(), z.number()),
    }),
    bestPractices: z.array(z.string()),
    queryCharacteristics: QueryCharacteristicsSchema.optional(),
    evaluationType: z.enum(['comprehensive', 'quick', 'benchmark', 'recommendation']),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    recommendation: z.any().optional(),
    evaluationSummary: z.object({
      patternsEvaluated: z.number(),
      recommendationConfidence: z.number(),
      keyInsights: z.array(z.string()),
    }),
  }),
  execute: async ({
    sessionId,
    discoveredPatterns,
    benchmarkResults,
    performanceSummary,
    bestPractices,
    queryCharacteristics,
    evaluationType
  }) => {
    return await withErrorHandling(
      async () => {
        rootLogger.info('Generating architecture recommendation', {
          sessionId,
          evaluationType,
          patternsEvaluated: discoveredPatterns.length,
          hasBenchmarks: benchmarkResults.length > 0,
          hasQueryCharacteristics: Boolean(queryCharacteristics),
        });

        const userContext = await biContextStore.getUserContext(sessionId);
        if (!userContext) {
          throw new Error('Session context not found');
        }

        let recommendation: ArchitectureRecommendation | undefined;

        // Generate recommendation if we have query characteristics
        if (queryCharacteristics) {
          recommendation = await generateArchitectureRecommendation(
            discoveredPatterns,
            queryCharacteristics,
            performanceSummary,
            bestPractices
          );
        }

        // Generate key insights from the evaluation
        const keyInsights = generateKeyInsights(
          discoveredPatterns,
          benchmarkResults,
          performanceSummary,
          bestPractices,
          recommendation
        );

        const evaluationSummary = {
          patternsEvaluated: discoveredPatterns.length,
          recommendationConfidence: recommendation?.confidence || 0,
          keyInsights,
        };

        // Store final recommendation
        const finalResult = {
          recommendation,
          evaluationSummary,
          performanceSummary,
          bestPractices,
          timestamp: new Date().toISOString(),
        };

        await biContextStore.storeContextMemory(sessionId, JSON.stringify(finalResult), {
          userId: userContext.userId,
          category: 'architecture-evaluation-result',
          domains: [],
          scope: 'session',
          metadata: {
            evaluationType,
            recommendedPattern: recommendation?.recommendedPattern,
            confidence: recommendation?.confidence,
            patternsEvaluated: discoveredPatterns.length,
          },
        });

        rootLogger.info('Architecture recommendation generated', {
          sessionId,
          recommendedPattern: recommendation?.recommendedPattern,
          confidence: recommendation?.confidence,
          keyInsights: keyInsights.length,
        });

        return {
          sessionId,
          recommendation,
          evaluationSummary,
        };
      },
      {
        component: 'architecture-evaluation-workflow',
        operation: 'recommendation_generation',
        sessionId,
      },
      'medium'
    );
  },
});

/**
 * Architecture Evaluation Workflow
 */
export const architectureEvaluationWorkflow = createWorkflow({
  id: 'architecture-evaluation',
  description: 'Comprehensive agent architecture pattern evaluation and optimization workflow',
  inputSchema: ArchitectureEvaluationInput,
  steps: [
    patternDiscoveryStep,
    performanceBenchmarkingStep,
    bestPracticesResearchStep,
    recommendationGenerationStep,
  ],
});

/**
 * Execute Architecture Evaluation Workflow
 */
export async function executeArchitectureEvaluation(input: {
  sessionId: string;
  evaluationType?: 'comprehensive' | 'quick' | 'benchmark' | 'recommendation';
  queryCharacteristics?: QueryCharacteristics;
  benchmarkQueries?: Array<{
    query: string;
    expectedResults?: number;
    domains: Array<'clinical' | 'financial' | 'operational' | 'customer-service'>;
  }>;
  includeBestPractices?: boolean;
  generateReport?: boolean;
  userId?: string;
}): Promise<any> {
  const workflowTracer = createBIWorkflowTracer(
    'architecture-evaluation',
    input.sessionId,
    input.userId || 'system',
    {
      domains: [],
      metadata: {
        evaluationType: input.evaluationType || 'comprehensive',
        hasQueryCharacteristics: Boolean(input.queryCharacteristics),
        benchmarkQueries: input.benchmarkQueries?.length || 0,
      },
    }
  );

  try {
    rootLogger.info('Starting architecture evaluation workflow', {
      sessionId: input.sessionId,
      evaluationType: input.evaluationType,
    });

    const startTime = Date.now();

    // Execute workflow steps
    const result = await architectureEvaluationWorkflow.execute({
      inputData: {
        sessionId: input.sessionId,
        evaluationType: input.evaluationType || 'comprehensive',
        queryCharacteristics: input.queryCharacteristics,
        benchmarkQueries: input.benchmarkQueries,
        includeBestPractices: input.includeBestPractices ?? true,
        generateReport: input.generateReport ?? true,
        userId: input.userId,
      },
      state: {},
      setState: () => {},
      getStepResult: () => ({}),
      runId: `arch-eval-${Date.now()}`,
    });

    const totalTime = Date.now() - startTime;

    // Complete workflow tracing
    workflowTracer.end({
      output: result,
      metadata: {
        totalTime,
        patternsEvaluated: result.evaluationResult?.patternsEvaluated || 0,
        benchmarksExecuted: result.evaluationResult?.benchmarksExecuted || 0,
        recommendationGenerated: Boolean(result.evaluationResult?.recommendation),
      },
    });

    rootLogger.info('Architecture evaluation workflow completed', {
      sessionId: input.sessionId,
      totalTime,
      patternsEvaluated: result.evaluationResult?.patternsEvaluated || 0,
      recommendationGenerated: Boolean(result.evaluationResult?.recommendation),
    });

    return result;

  } catch (error) {
    const errorMessage = (error as Error).message;

    workflowTracer.end({
      error: errorMessage,
      metadata: {
        failed: true,
        sessionId: input.sessionId,
      },
    });

    rootLogger.error('Architecture evaluation workflow failed', {
      sessionId: input.sessionId,
      error: errorMessage,
      stack: (error as Error).stack,
    });

    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function registerDefaultPatterns(
  sessionId: string,
  userContext: UserContext | AnonymousContext
): Promise<AgentArchitecturePattern[]> {
  const defaultPatterns: Omit<AgentArchitecturePattern, 'patternId' | 'lastEvaluated'>[] = [
    {
      patternType: 'planner-executor',
      name: 'Planner-Executor',
      description: 'Structured planning followed by systematic execution - ideal for complex multi-step analysis',
      queryComplexity: {
        domainCount: 2,
        joinComplexity: 5,
        aggregationComplexity: 5,
        filterComplexity: 5,
        totalScore: 60,
      },
      performanceMetrics: {
        averageResponseTime: 8000,
        accuracy: 0.92,
        resourceUsage: {
          cpuUsage: 35,
          memoryUsage: 150,
          networkLatency: 50,
          databaseConnections: 3,
        },
        errorRate: 0.05,
      },
      usageCount: 0,
      successRate: 0.95,
      configuration: {
        maxConcurrency: 5,
        timeoutMs: 60000,
        retryAttempts: 3,
        cachingEnabled: true,
        streamingThreshold: 0.7,
        complexityThreshold: 50,
        resourceLimits: {
          cpuUsage: 80,
          memoryUsage: 500,
          networkLatency: 200,
          databaseConnections: 10,
        },
      },
      isActive: true,
      metadata: {
        category: 'default',
        optimizedFor: ['complex-analysis', 'multi-domain'],
      },
    },
    {
      patternType: 'reactive',
      name: 'Reactive',
      description: 'Event-driven reactive pattern - optimal for real-time updates and interactive queries',
      queryComplexity: {
        domainCount: 1,
        joinComplexity: 2,
        aggregationComplexity: 2,
        filterComplexity: 3,
        totalScore: 25,
      },
      performanceMetrics: {
        averageResponseTime: 2000,
        accuracy: 0.88,
        resourceUsage: {
          cpuUsage: 25,
          memoryUsage: 100,
          networkLatency: 30,
          databaseConnections: 2,
        },
        errorRate: 0.08,
      },
      usageCount: 0,
      successRate: 0.92,
      configuration: {
        maxConcurrency: 10,
        timeoutMs: 30000,
        retryAttempts: 2,
        cachingEnabled: true,
        streamingThreshold: 0.3,
        complexityThreshold: 30,
        resourceLimits: {
          cpuUsage: 60,
          memoryUsage: 300,
          networkLatency: 100,
          databaseConnections: 5,
        },
      },
      isActive: true,
      metadata: {
        category: 'default',
        optimizedFor: ['real-time', 'interactive'],
      },
    },
    {
      patternType: 'streaming',
      name: 'Streaming',
      description: 'Streaming pattern for large datasets - provides progressive results and efficient memory usage',
      queryComplexity: {
        domainCount: 3,
        joinComplexity: 8,
        aggregationComplexity: 7,
        filterComplexity: 6,
        totalScore: 85,
      },
      performanceMetrics: {
        averageResponseTime: 12000,
        accuracy: 0.90,
        resourceUsage: {
          cpuUsage: 40,
          memoryUsage: 80,
          networkLatency: 70,
          databaseConnections: 4,
        },
        errorRate: 0.06,
      },
      usageCount: 0,
      successRate: 0.89,
      configuration: {
        maxConcurrency: 3,
        timeoutMs: 120000,
        retryAttempts: 2,
        cachingEnabled: false,
        streamingThreshold: 0.1,
        complexityThreshold: 70,
        resourceLimits: {
          cpuUsage: 70,
          memoryUsage: 200,
          networkLatency: 300,
          databaseConnections: 8,
        },
      },
      isActive: true,
      metadata: {
        category: 'default',
        optimizedFor: ['large-datasets', 'memory-efficient'],
      },
    },
    {
      patternType: 'hybrid',
      name: 'Hybrid Adaptive',
      description: 'Adaptive hybrid pattern that selects optimal execution strategy based on query characteristics',
      queryComplexity: {
        domainCount: 2,
        joinComplexity: 4,
        aggregationComplexity: 4,
        filterComplexity: 4,
        totalScore: 50,
      },
      performanceMetrics: {
        averageResponseTime: 6000,
        accuracy: 0.90,
        resourceUsage: {
          cpuUsage: 30,
          memoryUsage: 120,
          networkLatency: 45,
          databaseConnections: 3,
        },
        errorRate: 0.07,
      },
      usageCount: 0,
      successRate: 0.91,
      configuration: {
        maxConcurrency: 8,
        timeoutMs: 90000,
        retryAttempts: 3,
        cachingEnabled: true,
        streamingThreshold: 0.5,
        complexityThreshold: 40,
        resourceLimits: {
          cpuUsage: 75,
          memoryUsage: 400,
          networkLatency: 150,
          databaseConnections: 7,
        },
      },
      isActive: true,
      metadata: {
        category: 'default',
        optimizedFor: ['adaptive', 'versatile'],
      },
    },
  ];

  const registeredPatterns: AgentArchitecturePattern[] = [];

  for (const patternTemplate of defaultPatterns) {
    const pattern: AgentArchitecturePattern = {
      ...patternTemplate,
      patternId: `default_${patternTemplate.patternType}_${Date.now()}`,
      lastEvaluated: new Date(),
    };

    // Store pattern in context memory
    await biContextStore.storeContextMemory(sessionId, JSON.stringify(pattern), {
      userId: userContext.userId,
      category: 'architecture-pattern',
      domains: [],
      scope: 'session',
      metadata: {
        patternId: pattern.patternId,
        patternType: pattern.patternType,
        isActive: pattern.isActive,
        category: 'default',
      },
    });

    registeredPatterns.push(pattern);
  }

  return registeredPatterns;
}

function generateDefaultBenchmarkQueries(evaluationType: string) {
  const queries = [
    {
      query: 'SELECT COUNT(*) FROM orders WHERE status = \'completed\'',
      domains: ['operational' as const],
      expectedResults: 1000,
    },
    {
      query: 'SELECT AVG(treatment_duration) FROM cases JOIN patients ON cases.patient_id = patients.id',
      domains: ['clinical' as const],
      expectedResults: 500,
    },
    {
      query: 'SELECT SUM(amount) FROM payments WHERE payment_date >= NOW() - INTERVAL \'30 days\'',
      domains: ['financial' as const],
      expectedResults: 100,
    },
  ];

  // Return subset based on evaluation type
  switch (evaluationType) {
    case 'quick':
      return queries.slice(0, 1);
    case 'comprehensive':
      return queries;
    case 'benchmark':
      return queries.concat([
        {
          query: 'SELECT c.complexity_score, p.treatment_type, f.total_cost FROM cases c JOIN patients p ON c.patient_id = p.id JOIN financial_records f ON p.id = f.patient_id',
          domains: ['clinical' as const, 'financial' as const],
          expectedResults: 2000,
        },
      ]);
    default:
      return queries.slice(0, 2);
  }
}

async function executeBenchmarksForPattern(
  pattern: AgentArchitecturePattern,
  benchmarkQueries: any[],
  sessionId: string,
  userContext: UserContext | AnonymousContext
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const query of benchmarkQueries) {
    const startTime = Date.now();

    try {
      // Simulate pattern execution based on its characteristics
      const simulatedResult = await simulatePatternBenchmark(pattern, query);
      const executionTime = Date.now() - startTime;

      const benchmarkResult: BenchmarkResult = {
        benchmarkId: `bench_${pattern.patternId}_${Date.now()}`,
        queryType: inferQueryType(query.query),
        executionTime: executionTime + simulatedResult.additionalTime,
        accuracy: simulatedResult.accuracy,
        resourceUsage: simulatedResult.resourceUsage,
        errorCount: simulatedResult.errorCount,
        timestamp: new Date(),
      };

      results.push(benchmarkResult);

    } catch (error) {
      const benchmarkResult: BenchmarkResult = {
        benchmarkId: `bench_${pattern.patternId}_${Date.now()}`,
        queryType: inferQueryType(query.query),
        executionTime: Date.now() - startTime,
        accuracy: 0,
        resourceUsage: {
          cpuUsage: 0,
          memoryUsage: 0,
          networkLatency: 0,
          databaseConnections: 0,
        },
        errorCount: 1,
        timestamp: new Date(),
      };

      results.push(benchmarkResult);
    }
  }

  return results;
}

async function simulatePatternBenchmark(pattern: AgentArchitecturePattern, query: any) {
  // Simulate execution based on pattern type and configuration
  const baseTime = 1000;
  const queryComplexityMultiplier = query.domains.length * 0.5;

  let patternMultiplier = 1.0;
  let accuracyMultiplier = 1.0;
  let resourceMultiplier = 1.0;

  switch (pattern.patternType) {
    case 'planner-executor':
      patternMultiplier = 1.3; // Slower but more accurate
      accuracyMultiplier = 1.1;
      resourceMultiplier = 1.2;
      break;
    case 'reactive':
      patternMultiplier = 0.6; // Faster
      accuracyMultiplier = 0.95;
      resourceMultiplier = 0.8;
      break;
    case 'streaming':
      patternMultiplier = 1.8; // Slower initial response
      accuracyMultiplier = 1.05;
      resourceMultiplier = 0.7; // More memory efficient
      break;
    case 'hybrid':
      patternMultiplier = 1.0; // Balanced
      accuracyMultiplier = 1.0;
      resourceMultiplier = 1.0;
      break;
  }

  const additionalTime = baseTime * queryComplexityMultiplier * patternMultiplier;
  const accuracy = Math.min(1.0, pattern.performanceMetrics.accuracy * accuracyMultiplier * (0.9 + Math.random() * 0.2));

  return {
    additionalTime,
    accuracy,
    resourceUsage: {
      cpuUsage: pattern.performanceMetrics.resourceUsage.cpuUsage * resourceMultiplier * (0.8 + Math.random() * 0.4),
      memoryUsage: pattern.performanceMetrics.resourceUsage.memoryUsage * resourceMultiplier * (0.8 + Math.random() * 0.4),
      networkLatency: pattern.performanceMetrics.resourceUsage.networkLatency * (0.8 + Math.random() * 0.4),
      databaseConnections: Math.ceil(pattern.performanceMetrics.resourceUsage.databaseConnections * queryComplexityMultiplier),
    },
    errorCount: Math.random() < pattern.performanceMetrics.errorRate ? 1 : 0,
  };
}

function calculatePatternPerformanceScore(benchmarkResults: BenchmarkResult[]): number {
  if (benchmarkResults.length === 0) return 0;

  const avgExecutionTime = benchmarkResults.reduce((sum, r) => sum + r.executionTime, 0) / benchmarkResults.length;
  const avgAccuracy = benchmarkResults.reduce((sum, r) => sum + r.accuracy, 0) / benchmarkResults.length;
  const totalErrors = benchmarkResults.reduce((sum, r) => sum + r.errorCount, 0);

  // Score components (0-100 scale)
  const timeScore = Math.max(0, 100 - (avgExecutionTime / 100)); // 10s = 0 points
  const accuracyScore = avgAccuracy * 100;
  const errorScore = Math.max(0, 100 - (totalErrors * 20));

  // Weighted average
  return (timeScore * 0.4) + (accuracyScore * 0.4) + (errorScore * 0.2);
}

function generateResearchTopics(performanceSummary: any, queryCharacteristics?: QueryCharacteristics): string[] {
  const topics = [
    'agent architecture patterns',
    'performance optimization techniques',
    'query execution strategies',
  ];

  if (queryCharacteristics) {
    if (queryCharacteristics.realTimeRequirement) {
      topics.push('real-time data processing');
    }
    if (queryCharacteristics.dataVolume === 'large') {
      topics.push('large scale data processing');
    }
    if (queryCharacteristics.domainCount > 2) {
      topics.push('multi-domain data integration');
    }
  }

  return topics;
}

async function simulateBestPracticesResearch(topic: string): Promise<string[]> {
  // Simulate research results based on topic
  const practicesByTopic: Record<string, string[]> = {
    'agent architecture patterns': [
      'Use planner-executor pattern for complex multi-step workflows',
      'Implement reactive patterns for real-time data updates',
      'Consider streaming patterns for large dataset processing',
      'Use hybrid patterns for adaptive query routing',
    ],
    'performance optimization techniques': [
      'Implement query result caching for frequently accessed data',
      'Use connection pooling for database operations',
      'Optimize memory usage with streaming processing',
      'Implement parallel processing for independent operations',
    ],
    'query execution strategies': [
      'Break complex queries into smaller, optimized sub-queries',
      'Use query planning for optimal execution order',
      'Implement query result pagination for large datasets',
      'Use prepared statements for repeated query patterns',
    ],
    'real-time data processing': [
      'Implement event-driven architecture for real-time updates',
      'Use message queues for asynchronous processing',
      'Consider in-memory data stores for low-latency access',
      'Implement change data capture for real-time synchronization',
    ],
    'large scale data processing': [
      'Use streaming processing frameworks for large datasets',
      'Implement data partitioning for parallel processing',
      'Consider distributed computing for massive scale',
      'Use incremental processing to reduce computation overhead',
    ],
    'multi-domain data integration': [
      'Implement data federation for cross-domain queries',
      'Use semantic mapping for field-level integration',
      'Consider data virtualization for unified access',
      'Implement proper data governance and access control',
    ],
  };

  return practicesByTopic[topic] || ['General best practices for agent architecture'];
}

function rankBestPractices(practices: string[], queryCharacteristics?: QueryCharacteristics): string[] {
  // Simple ranking based on query characteristics
  if (!queryCharacteristics) return practices;

  const scoredPractices = practices.map(practice => {
    let score = 1;

    if (queryCharacteristics.realTimeRequirement && practice.includes('real-time')) {
      score += 2;
    }
    if (queryCharacteristics.dataVolume === 'large' && practice.includes('large')) {
      score += 2;
    }
    if (queryCharacteristics.domainCount > 2 && practice.includes('multi-domain')) {
      score += 2;
    }
    if (queryCharacteristics.complexity > 70 && practice.includes('complex')) {
      score += 2;
    }

    return { practice, score };
  });

  return scoredPractices
    .sort((a, b) => b.score - a.score)
    .map(item => item.practice);
}

function calculateRelevanceScore(practices: string[], queryCharacteristics?: QueryCharacteristics): number {
  if (!queryCharacteristics || practices.length === 0) return 0.5;

  let relevantPractices = 0;

  for (const practice of practices) {
    if (
      (queryCharacteristics.realTimeRequirement && practice.includes('real-time')) ||
      (queryCharacteristics.dataVolume === 'large' && practice.includes('large')) ||
      (queryCharacteristics.domainCount > 2 && practice.includes('multi-domain')) ||
      (queryCharacteristics.complexity > 70 && practice.includes('complex'))
    ) {
      relevantPractices++;
    }
  }

  return relevantPractices / practices.length;
}

async function generateArchitectureRecommendation(
  patterns: AgentArchitecturePattern[],
  queryCharacteristics: QueryCharacteristics,
  performanceSummary: any,
  bestPractices: string[]
): Promise<ArchitectureRecommendation> {
  // Find the best performing pattern that matches query characteristics
  const scoredPatterns = patterns.map(pattern => {
    let score = performanceSummary.performanceScores[pattern.patternId] || 0;

    // Adjust score based on query characteristics compatibility
    switch (pattern.patternType) {
      case 'planner-executor':
        if (queryCharacteristics.complexity > 60) score += 15;
        if (queryCharacteristics.accuracyRequirement === 'critical') score += 10;
        break;
      case 'reactive':
        if (queryCharacteristics.realTimeRequirement) score += 20;
        if (queryCharacteristics.interactivityLevel === 'high') score += 10;
        break;
      case 'streaming':
        if (queryCharacteristics.dataVolume === 'large') score += 15;
        break;
      case 'hybrid':
        score += 5; // Always gets versatility bonus
        break;
    }

    return { pattern, score };
  });

  scoredPatterns.sort((a, b) => b.score - a.score);
  const bestPattern = scoredPatterns[0]?.pattern;

  if (!bestPattern) {
    throw new Error('No suitable pattern found');
  }

  // Generate reasoning
  const reasoning = `Recommended ${bestPattern.patternType} pattern based on query complexity (${queryCharacteristics.complexity}/100), ` +
    `${queryCharacteristics.domainCount} domains, ${queryCharacteristics.dataVolume} data volume, and ` +
    `${queryCharacteristics.accuracyRequirement} accuracy requirement. Performance score: ${scoredPatterns[0].score.toFixed(1)}/100.`;

  // Predict performance
  const performancePrediction = {
    averageResponseTime: bestPattern.performanceMetrics.averageResponseTime * (1 + queryCharacteristics.complexity / 200),
    accuracy: bestPattern.performanceMetrics.accuracy * (queryCharacteristics.accuracyRequirement === 'critical' ? 0.95 : 1.0),
    resourceUsage: bestPattern.performanceMetrics.resourceUsage,
    errorRate: bestPattern.performanceMetrics.errorRate,
  };

  // Generate implementation suggestions from best practices
  const implementationSuggestions = bestPractices
    .filter(practice => practice.toLowerCase().includes(bestPattern.patternType) ||
                       practice.toLowerCase().includes('general'))
    .slice(0, 5);

  return {
    recommendedPattern: bestPattern.patternType,
    confidence: Math.min(scoredPatterns[0].score / 100, 1.0),
    reasoning,
    queryCharacteristics,
    performancePrediction,
    implementationSuggestions,
  };
}

function generateKeyInsights(
  patterns: AgentArchitecturePattern[],
  benchmarkResults: BenchmarkResult[],
  performanceSummary: any,
  bestPractices: string[],
  recommendation?: ArchitectureRecommendation
): string[] {
  const insights: string[] = [];

  // Pattern performance insights
  if (patterns.length > 0) {
    insights.push(`Evaluated ${patterns.length} architecture patterns with ${benchmarkResults.length} total benchmarks`);

    const avgScore = Object.values(performanceSummary.performanceScores as Record<string, number>)
      .reduce((sum, score) => sum + score, 0) / Object.values(performanceSummary.performanceScores).length;
    insights.push(`Average pattern performance score: ${avgScore.toFixed(1)}/100`);
  }

  // Top performing pattern insight
  if (performanceSummary.topPerformingPattern && performanceSummary.topPerformingPattern !== 'none') {
    const topPattern = patterns.find(p => p.patternId === performanceSummary.topPerformingPattern);
    if (topPattern) {
      insights.push(`${topPattern.patternType} pattern showed the best overall performance`);
    }
  }

  // Recommendation insight
  if (recommendation) {
    insights.push(`Recommended ${recommendation.recommendedPattern} pattern with ${(recommendation.confidence * 100).toFixed(1)}% confidence`);
  }

  // Best practices insight
  if (bestPractices.length > 0) {
    insights.push(`Found ${bestPractices.length} relevant best practices for optimization`);
  }

  // Performance characteristics insight
  if (benchmarkResults.length > 0) {
    const avgExecutionTime = benchmarkResults.reduce((sum, r) => sum + r.executionTime, 0) / benchmarkResults.length;
    const avgAccuracy = benchmarkResults.reduce((sum, r) => sum + r.accuracy, 0) / benchmarkResults.length;
    insights.push(`Average execution time: ${(avgExecutionTime / 1000).toFixed(2)}s, accuracy: ${(avgAccuracy * 100).toFixed(1)}%`);
  }

  return insights;
}

function inferQueryType(query: string): string {
  const queryLower = query.toLowerCase();

  if (queryLower.includes('count(') || queryLower.includes('sum(') || queryLower.includes('avg(')) {
    return 'aggregation';
  }
  if (queryLower.includes('join')) {
    return 'multi-table';
  }
  if (queryLower.includes('group by')) {
    return 'grouped';
  }
  if (queryLower.includes('order by')) {
    return 'sorted';
  }

  return 'basic-select';
}

// ============================================================================
// Export workflow metadata for registration
// ============================================================================

export const architectureEvaluationWorkflowMetadata = {
  category: 'architecture-evaluation',
  description: 'Architecture evaluation and optimization workflows',
  workflows: ['architecture-evaluation'],
  capabilities: [
    'pattern_discovery',
    'performance_benchmarking',
    'best_practices_research',
    'architecture_recommendation',
    'pattern_optimization',
    'comprehensive_evaluation',
  ],
};

rootLogger.info('Architecture evaluation workflow initialized', {
  workflow: 'architecture-evaluation',
  capabilities: architectureEvaluationWorkflowMetadata.capabilities,
});