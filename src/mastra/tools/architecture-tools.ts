/**
 * Architecture Evaluation Tools for Business Intelligence
 * Provides comprehensive tools for evaluating and optimizing agent architecture patterns
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  AgentArchitecturePattern,
  PatternEvaluationResult,
  BenchmarkResult,
  ArchitectureRecommendation,
  QueryCharacteristics,
  PatternType,
  AgentArchitecturePatternSchema,
  QueryCharacteristicsSchema,
  PatternEvaluationResultSchema,
  ArchitectureRecommendationSchema,
  UserContext,
  AnonymousContext,
} from '../types/context.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Architecture Pattern Discovery and Registration Tools
// ============================================================================

/**
 * Register Agent Architecture Pattern
 */
export const registerArchitecturePattern = new Tool({
  id: 'register-architecture-pattern',
  description: 'Register a new agent architecture pattern for evaluation and benchmarking',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    pattern: AgentArchitecturePatternSchema.omit({ patternId: true, lastEvaluated: true }),
  }),
  execute: async ({ sessionId, pattern }, context) => {
    try {
      rootLogger.info('Registering architecture pattern', {
        sessionId,
        patternType: pattern.patternType,
        name: pattern.name,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Create complete pattern with generated ID and timestamp
      const completePattern: AgentArchitecturePattern = {
        ...pattern,
        patternId: `arch_${pattern.patternType}_${Date.now()}`,
        lastEvaluated: new Date(),
      };

      // Store pattern in session memory for persistence
      const patternContent = JSON.stringify(completePattern);
      await biContextStore.storeContextMemory(sessionId, patternContent, {
        userId: userContext.userId,
        category: 'architecture-pattern',
        domains: [],
        scope: 'session',
        metadata: {
          patternId: completePattern.patternId,
          patternType: pattern.patternType,
          isActive: pattern.isActive,
        },
      });

      // Trace the pattern registration
      await biContextTracer.traceMemoryOperation(sessionId, 'pattern_registration', {
        patternId: completePattern.patternId,
        patternType: pattern.patternType,
        operation: 'register',
        configuration: pattern.configuration,
      });

      return {
        success: true,
        sessionId,
        patternId: completePattern.patternId,
        pattern: completePattern,
        message: `Architecture pattern "${pattern.name}" registered successfully`,
      };

    } catch (error) {
      rootLogger.error('Failed to register architecture pattern', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to register architecture pattern',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * List Available Architecture Patterns
 */
export const listArchitecturePatterns = new Tool({
  id: 'list-architecture-patterns',
  description: 'List all available architecture patterns with filtering and sorting options',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    patternType: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).optional().describe('Filter by pattern type'),
    isActive: z.boolean().optional().describe('Filter by active status'),
    sortBy: z.enum(['name', 'successRate', 'usageCount', 'lastEvaluated']).default('successRate'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().min(1).max(50).default(20),
  }),
  execute: async ({ sessionId, patternType, isActive, sortBy, sortOrder, limit }, context) => {
    try {
      rootLogger.info('Listing architecture patterns', {
        sessionId,
        filters: { patternType, isActive },
        sortBy,
        sortOrder,
        limit,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Search for architecture patterns in memory
      const searchResults = await biContextStore.searchContextMemories(
        sessionId,
        'architecture pattern',
        {
          userId: userContext.userId,
          category: 'architecture-pattern',
          topK: limit * 2, // Get more to allow filtering
          similarityThreshold: 0.1, // Low threshold for broad search
        }
      );

      // Parse and filter patterns
      const patterns: AgentArchitecturePattern[] = [];
      for (const result of searchResults) {
        try {
          const pattern = JSON.parse(result.content) as AgentArchitecturePattern;

          // Apply filters
          if (patternType && pattern.patternType !== patternType) continue;
          if (isActive !== undefined && pattern.isActive !== isActive) continue;

          patterns.push(pattern);
        } catch (parseError) {
          rootLogger.warn('Failed to parse architecture pattern', {
            resultId: result.id,
            error: (parseError as Error).message,
          });
        }
      }

      // Sort patterns
      const sortedPatterns = patterns.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'successRate':
            comparison = a.successRate - b.successRate;
            break;
          case 'usageCount':
            comparison = a.usageCount - b.usageCount;
            break;
          case 'lastEvaluated':
            comparison = a.lastEvaluated.getTime() - b.lastEvaluated.getTime();
            break;
        }

        return sortOrder === 'desc' ? -comparison : comparison;
      }).slice(0, limit);

      // Generate pattern summary
      const summary = {
        totalPatterns: sortedPatterns.length,
        patternTypes: [...new Set(sortedPatterns.map(p => p.patternType))],
        activePatterns: sortedPatterns.filter(p => p.isActive).length,
        averageSuccessRate: sortedPatterns.length > 0
          ? sortedPatterns.reduce((sum, p) => sum + p.successRate, 0) / sortedPatterns.length
          : 0,
      };

      // Trace the pattern listing operation
      await biContextTracer.traceMemoryOperation(sessionId, 'pattern_listing', {
        totalFound: sortedPatterns.length,
        filters: { patternType, isActive },
        sortBy,
        summary,
      });

      return {
        success: true,
        sessionId,
        patterns: sortedPatterns,
        summary,
        filters: { patternType, isActive, sortBy, sortOrder, limit },
      };

    } catch (error) {
      rootLogger.error('Failed to list architecture patterns', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to list architecture patterns',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Query Analysis and Complexity Assessment Tools
// ============================================================================

/**
 * Analyze Query Complexity
 */
export const analyzeQueryComplexity = new Tool({
  id: 'analyze-query-complexity',
  description: 'Analyze query complexity and characteristics to determine optimal architecture pattern',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    query: z.string().describe('Query to analyze'),
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).describe('Domains involved in query'),
    expectedDataVolume: z.enum(['small', 'medium', 'large']).optional().describe('Expected data volume'),
    realTimeRequirement: z.boolean().default(false).describe('Whether query requires real-time results'),
    accuracyRequirement: z.enum(['standard', 'high', 'critical']).default('standard').describe('Required accuracy level'),
  }),
  execute: async ({ sessionId, query, domains, expectedDataVolume, realTimeRequirement, accuracyRequirement }, context) => {
    try {
      rootLogger.info('Analyzing query complexity', {
        sessionId,
        queryLength: query.length,
        domains,
        realTimeRequirement,
        accuracyRequirement,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Analyze query structure and complexity
      const complexity = await analyzeQueryStructure(query, domains);

      // Determine data volume if not provided
      const dataVolume = expectedDataVolume || estimateDataVolume(query, domains);

      // Determine interactivity level based on query characteristics
      const interactivityLevel = determineInteractivityLevel(query, realTimeRequirement);

      // Create query characteristics
      const queryCharacteristics: QueryCharacteristics = {
        complexity: complexity.totalScore,
        domainCount: domains.length,
        dataVolume,
        realTimeRequirement,
        interactivityLevel,
        accuracyRequirement,
      };

      // Store analysis results for future reference
      const analysisResult = {
        sessionId,
        query: query.substring(0, 200), // Store truncated query for privacy
        queryCharacteristics,
        complexityBreakdown: complexity,
        timestamp: new Date().toISOString(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(analysisResult), {
        userId: userContext.userId,
        category: 'query-analysis',
        domains,
        scope: 'session',
        metadata: {
          complexity: complexity.totalScore,
          domainCount: domains.length,
          dataVolume,
          analysisType: 'complexity',
        },
      });

      // Trace the complexity analysis
      await biContextTracer.traceQueryExecution(sessionId, {
        query: query.substring(0, 100),
        domains,
        executionTime: 0, // Analysis time
        resultCount: 0,
        fromCache: false,
        permissionChecks: domains.map(domain => ({
          domain,
          action: 'query',
          allowed: hasPermission(userContext, domain, 'query'),
        })),
      });

      return {
        success: true,
        sessionId,
        queryCharacteristics,
        complexityBreakdown: complexity,
        recommendations: generateComplexityRecommendations(queryCharacteristics, complexity),
        suggestedPatterns: suggestOptimalPatterns(queryCharacteristics),
      };

    } catch (error) {
      rootLogger.error('Failed to analyze query complexity', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to analyze query complexity',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Pattern Benchmarking and Performance Tools
// ============================================================================

/**
 * Execute Pattern Benchmark
 */
export const executePatternBenchmark = new Tool({
  id: 'execute-pattern-benchmark',
  description: 'Execute benchmark tests against specific architecture patterns to measure performance',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    patternId: z.string().describe('Architecture pattern ID to benchmark'),
    benchmarkQueries: z.array(z.object({
      query: z.string(),
      expectedResults: z.number().optional(),
      domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])),
    })).describe('Benchmark queries to execute'),
    iterations: z.number().min(1).max(10).default(3).describe('Number of benchmark iterations'),
    recordMetrics: z.boolean().default(true).describe('Whether to record detailed performance metrics'),
  }),
  execute: async ({ sessionId, patternId, benchmarkQueries, iterations, recordMetrics }, context) => {
    try {
      rootLogger.info('Executing pattern benchmark', {
        sessionId,
        patternId,
        queryCount: benchmarkQueries.length,
        iterations,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve the pattern to benchmark
      const patternResults = await biContextStore.searchContextMemories(sessionId, patternId, {
        userId: userContext.userId,
        category: 'architecture-pattern',
        topK: 1,
        similarityThreshold: 0.8,
      });

      if (patternResults.length === 0) {
        return {
          success: false,
          error: 'Architecture pattern not found',
          patternId,
          sessionId,
        };
      }

      const pattern = JSON.parse(patternResults[0].content) as AgentArchitecturePattern;
      const benchmarkResults: BenchmarkResult[] = [];

      // Execute benchmarks for each query
      for (const benchmarkQuery of benchmarkQueries) {
        // Check domain permissions
        for (const domain of benchmarkQuery.domains) {
          if (!hasPermission(userContext, domain, 'query')) {
            rootLogger.warn('Skipping benchmark query due to insufficient permissions', {
              domain,
              sessionId,
            });
            continue;
          }
        }

        // Execute benchmark iterations
        const iterationResults: BenchmarkResult[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();

          try {
            // Simulate pattern execution (in real implementation, this would execute the actual pattern)
            const mockResult = await simulatePatternExecution(
              pattern,
              benchmarkQuery.query,
              benchmarkQuery.domains
            );

            const executionTime = Date.now() - startTime;

            const benchmarkResult: BenchmarkResult = {
              benchmarkId: `bench_${patternId}_${i}_${Date.now()}`,
              queryType: inferQueryType(benchmarkQuery.query),
              executionTime,
              accuracy: mockResult.accuracy,
              resourceUsage: mockResult.resourceUsage,
              errorCount: mockResult.errorCount,
              timestamp: new Date(),
            };

            iterationResults.push(benchmarkResult);

          } catch (error) {
            const benchmarkResult: BenchmarkResult = {
              benchmarkId: `bench_${patternId}_${i}_${Date.now()}`,
              queryType: inferQueryType(benchmarkQuery.query),
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

            iterationResults.push(benchmarkResult);
          }
        }

        // Calculate average results for this query
        if (iterationResults.length > 0) {
          const avgResult: BenchmarkResult = {
            benchmarkId: `bench_${patternId}_avg_${Date.now()}`,
            queryType: iterationResults[0].queryType,
            executionTime: iterationResults.reduce((sum, r) => sum + r.executionTime, 0) / iterationResults.length,
            accuracy: iterationResults.reduce((sum, r) => sum + r.accuracy, 0) / iterationResults.length,
            resourceUsage: {
              cpuUsage: iterationResults.reduce((sum, r) => sum + r.resourceUsage.cpuUsage, 0) / iterationResults.length,
              memoryUsage: iterationResults.reduce((sum, r) => sum + r.resourceUsage.memoryUsage, 0) / iterationResults.length,
              networkLatency: iterationResults.reduce((sum, r) => sum + r.resourceUsage.networkLatency, 0) / iterationResults.length,
              databaseConnections: iterationResults.reduce((sum, r) => sum + r.resourceUsage.databaseConnections, 0) / iterationResults.length,
            },
            errorCount: iterationResults.reduce((sum, r) => sum + r.errorCount, 0),
            timestamp: new Date(),
          };

          benchmarkResults.push(avgResult);
        }
      }

      // Store benchmark results
      if (recordMetrics) {
        const benchmarkSummary = {
          patternId,
          benchmarkResults,
          totalQueries: benchmarkQueries.length,
          iterations,
          overallPerformance: calculateOverallPerformance(benchmarkResults),
          timestamp: new Date().toISOString(),
        };

        await biContextStore.storeContextMemory(sessionId, JSON.stringify(benchmarkSummary), {
          userId: userContext.userId,
          category: 'benchmark-results',
          domains: [],
          scope: 'session',
          metadata: {
            patternId,
            patternType: pattern.patternType,
            benchmarkCount: benchmarkResults.length,
            overallScore: benchmarkSummary.overallPerformance.score,
          },
        });
      }

      // Update pattern performance metrics
      const updatedPattern = {
        ...pattern,
        performanceMetrics: updatePatternMetrics(pattern.performanceMetrics, benchmarkResults),
        usageCount: pattern.usageCount + benchmarkQueries.length,
        lastEvaluated: new Date(),
      };

      // Store updated pattern
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(updatedPattern), {
        userId: userContext.userId,
        category: 'architecture-pattern',
        domains: [],
        scope: 'session',
        metadata: {
          patternId,
          patternType: pattern.patternType,
          isActive: pattern.isActive,
          operation: 'update',
        },
      });

      // Trace benchmark execution
      await biContextTracer.traceMemoryOperation(sessionId, 'pattern_benchmark', {
        patternId,
        patternType: pattern.patternType,
        queryCount: benchmarkQueries.length,
        iterations,
        averageExecutionTime: benchmarkResults.reduce((sum, r) => sum + r.executionTime, 0) / benchmarkResults.length,
        overallAccuracy: benchmarkResults.reduce((sum, r) => sum + r.accuracy, 0) / benchmarkResults.length,
      });

      return {
        success: true,
        sessionId,
        patternId,
        benchmarkResults,
        summary: {
          totalQueries: benchmarkQueries.length,
          iterations,
          averageExecutionTime: benchmarkResults.reduce((sum, r) => sum + r.executionTime, 0) / benchmarkResults.length,
          averageAccuracy: benchmarkResults.reduce((sum, r) => sum + r.accuracy, 0) / benchmarkResults.length,
          totalErrors: benchmarkResults.reduce((sum, r) => sum + r.errorCount, 0),
        },
        updatedPattern,
      };

    } catch (error) {
      rootLogger.error('Failed to execute pattern benchmark', {
        sessionId,
        patternId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to execute pattern benchmark',
        details: (error as Error).message,
        sessionId,
        patternId,
      };
    }
  },
});

// ============================================================================
// Pattern Recommendation and Optimization Tools
// ============================================================================

/**
 * Get Architecture Recommendation
 */
export const getArchitectureRecommendation = new Tool({
  id: 'get-architecture-recommendation',
  description: 'Get architecture pattern recommendations based on query characteristics and performance data',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    queryCharacteristics: QueryCharacteristicsSchema.describe('Query characteristics to analyze'),
    includeAlternatives: z.boolean().default(true).describe('Include alternative pattern suggestions'),
    weightPreferences: z.object({
      performance: z.number().min(0).max(1).default(0.4).describe('Weight for performance metrics'),
      accuracy: z.number().min(0).max(1).default(0.3).describe('Weight for accuracy metrics'),
      resourceUsage: z.number().min(0).max(1).default(0.2).describe('Weight for resource efficiency'),
      reliability: z.number().min(0).max(1).default(0.1).describe('Weight for reliability metrics'),
    }).optional().describe('Weights for different recommendation criteria'),
  }),
  execute: async ({ sessionId, queryCharacteristics, includeAlternatives, weightPreferences }, context) => {
    try {
      rootLogger.info('Generating architecture recommendation', {
        sessionId,
        queryCharacteristics,
        includeAlternatives,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const weights = weightPreferences || {
        performance: 0.4,
        accuracy: 0.3,
        resourceUsage: 0.2,
        reliability: 0.1,
      };

      // Get all available patterns
      const patternResults = await biContextStore.searchContextMemories(sessionId, 'architecture pattern', {
        userId: userContext.userId,
        category: 'architecture-pattern',
        topK: 20,
        similarityThreshold: 0.1,
      });

      const patterns: AgentArchitecturePattern[] = [];
      for (const result of patternResults) {
        try {
          const pattern = JSON.parse(result.content) as AgentArchitecturePattern;
          if (pattern.isActive) {
            patterns.push(pattern);
          }
        } catch (parseError) {
          continue;
        }
      }

      if (patterns.length === 0) {
        return {
          success: false,
          error: 'No active architecture patterns found',
          sessionId,
        };
      }

      // Score each pattern based on query characteristics
      const patternScores = patterns.map(pattern => {
        const score = calculatePatternScore(pattern, queryCharacteristics, weights);
        return {
          pattern,
          score,
          reasoning: generatePatternReasoning(pattern, queryCharacteristics, score),
        };
      });

      // Sort by score and get the best recommendation
      patternScores.sort((a, b) => b.score - a.score);
      const bestPattern = patternScores[0];

      // Predict performance for the recommended pattern
      const performancePrediction = predictPatternPerformance(bestPattern.pattern, queryCharacteristics);

      // Generate implementation suggestions
      const implementationSuggestions = generateImplementationSuggestions(
        bestPattern.pattern,
        queryCharacteristics
      );

      // Create the recommendation
      const recommendation: ArchitectureRecommendation = {
        recommendedPattern: bestPattern.pattern.patternType,
        confidence: Math.min(bestPattern.score / 100, 1.0),
        reasoning: bestPattern.reasoning,
        queryCharacteristics,
        performancePrediction,
        implementationSuggestions,
      };

      // Include alternatives if requested
      let alternatives = undefined;
      if (includeAlternatives && patternScores.length > 1) {
        alternatives = patternScores.slice(1, 4).map(scored => ({
          patternType: scored.pattern.patternType,
          score: scored.score,
          reason: scored.reasoning,
          tradeoffs: generateTradeoffAnalysis(bestPattern.pattern, scored.pattern),
        }));
      }

      // Store recommendation for future reference
      const recommendationRecord = {
        recommendation,
        alternatives,
        queryCharacteristics,
        timestamp: new Date().toISOString(),
        weights,
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(recommendationRecord), {
        userId: userContext.userId,
        category: 'architecture-recommendation',
        domains: [],
        scope: 'session',
        metadata: {
          recommendedPattern: recommendation.recommendedPattern,
          confidence: recommendation.confidence,
          complexity: queryCharacteristics.complexity,
        },
      });

      // Trace the recommendation generation
      await biContextTracer.traceMemoryOperation(sessionId, 'architecture_recommendation', {
        recommendedPattern: recommendation.recommendedPattern,
        confidence: recommendation.confidence,
        alternativeCount: alternatives?.length || 0,
        patternsEvaluated: patterns.length,
        queryComplexity: queryCharacteristics.complexity,
      });

      return {
        success: true,
        sessionId,
        recommendation,
        alternatives,
        evaluationSummary: {
          patternsEvaluated: patterns.length,
          bestScore: bestPattern.score,
          confidence: recommendation.confidence,
          weights,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to generate architecture recommendation', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to generate architecture recommendation',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

async function analyzeQueryStructure(query: string, domains: string[]) {
  const queryLower = query.toLowerCase();

  // Analyze join complexity
  const joinKeywords = ['join', 'inner join', 'left join', 'right join', 'full join'];
  const joinComplexity = joinKeywords.reduce((count, keyword) => {
    const matches = queryLower.split(keyword).length - 1;
    return count + matches;
  }, 0);

  // Analyze aggregation complexity
  const aggregationKeywords = ['group by', 'having', 'count', 'sum', 'avg', 'max', 'min'];
  const aggregationComplexity = aggregationKeywords.reduce((count, keyword) => {
    const matches = queryLower.split(keyword).length - 1;
    return count + matches;
  }, 0);

  // Analyze filter complexity
  const filterKeywords = ['where', 'and', 'or', 'in', 'exists', 'not'];
  const filterComplexity = filterKeywords.reduce((count, keyword) => {
    const matches = queryLower.split(keyword).length - 1;
    return count + matches;
  }, 0);

  // Calculate total score
  const domainCount = domains.length;
  const totalScore = Math.min(
    (domainCount * 10) + (joinComplexity * 5) + (aggregationComplexity * 3) + (filterComplexity * 2),
    100
  );

  return {
    domainCount,
    joinComplexity: Math.min(joinComplexity, 10),
    aggregationComplexity: Math.min(aggregationComplexity, 10),
    filterComplexity: Math.min(filterComplexity, 10),
    totalScore,
  };
}

function estimateDataVolume(query: string, domains: string[]): 'small' | 'medium' | 'large' {
  const queryLower = query.toLowerCase();

  // Look for indicators of large data operations
  if (queryLower.includes('count(*)') || queryLower.includes('sum(') ||
      queryLower.includes('group by') || domains.length > 2) {
    return 'large';
  }

  // Look for indicators of medium data operations
  if (queryLower.includes('join') || queryLower.includes('where') || domains.length > 1) {
    return 'medium';
  }

  return 'small';
}

function determineInteractivityLevel(query: string, realTimeRequirement: boolean): 'low' | 'medium' | 'high' {
  if (realTimeRequirement) return 'high';

  const queryLower = query.toLowerCase();

  // High interactivity indicators
  if (queryLower.includes('limit') && !queryLower.includes('group by')) {
    return 'high';
  }

  // Medium interactivity indicators
  if (queryLower.includes('order by') || queryLower.includes('where')) {
    return 'medium';
  }

  return 'low';
}

function generateComplexityRecommendations(characteristics: QueryCharacteristics, complexity: any): string[] {
  const recommendations: string[] = [];

  if (characteristics.complexity > 70) {
    recommendations.push('Consider breaking down complex query into simpler sub-queries');
    recommendations.push('Use planner-executor pattern for better control over execution flow');
  }

  if (characteristics.domainCount > 2) {
    recommendations.push('Multi-domain query detected - consider data federation optimization');
    recommendations.push('Ensure proper indexing across all involved domains');
  }

  if (characteristics.dataVolume === 'large') {
    recommendations.push('Large data volume - consider streaming pattern for incremental results');
    recommendations.push('Implement pagination for better user experience');
  }

  if (characteristics.realTimeRequirement) {
    recommendations.push('Real-time requirement - use reactive pattern with event-driven updates');
    recommendations.push('Consider caching strategies for frequently accessed data');
  }

  return recommendations;
}

function suggestOptimalPatterns(characteristics: QueryCharacteristics): PatternType[] {
  const suggestions: PatternType[] = [];

  // High complexity + multi-domain = planner-executor
  if (characteristics.complexity > 60 && characteristics.domainCount > 1) {
    suggestions.push('planner-executor');
  }

  // Real-time + high interactivity = reactive
  if (characteristics.realTimeRequirement && characteristics.interactivityLevel === 'high') {
    suggestions.push('reactive');
  }

  // Large data volume = streaming
  if (characteristics.dataVolume === 'large') {
    suggestions.push('streaming');
  }

  // Always suggest hybrid as a versatile option
  suggestions.push('hybrid');

  return [...new Set(suggestions)]; // Remove duplicates
}

async function simulatePatternExecution(pattern: AgentArchitecturePattern, query: string, domains: string[]) {
  // Simulate execution based on pattern type and configuration
  const baseExecutionTime = 1000 + (query.length * 2) + (domains.length * 500);
  const patternMultiplier = getPatternMultiplier(pattern.patternType);

  // Add some randomness to simulate real-world variability
  const executionTime = baseExecutionTime * patternMultiplier * (0.8 + Math.random() * 0.4);

  return {
    accuracy: Math.max(0.7, pattern.performanceMetrics.accuracy * (0.9 + Math.random() * 0.2)),
    resourceUsage: {
      cpuUsage: Math.min(100, 20 + Math.random() * 40),
      memoryUsage: Math.random() * 500,
      networkLatency: Math.random() * 100,
      databaseConnections: domains.length + Math.floor(Math.random() * 3),
    },
    errorCount: Math.random() < 0.1 ? 1 : 0, // 10% chance of error
  };
}

function getPatternMultiplier(patternType: PatternType): number {
  switch (patternType) {
    case 'planner-executor': return 1.2; // Slower but more thorough
    case 'reactive': return 0.8; // Faster response
    case 'streaming': return 1.5; // Slower initial response but better for large data
    case 'hybrid': return 1.0; // Balanced
    default: return 1.0;
  }
}

function inferQueryType(query: string): string {
  const queryLower = query.toLowerCase();

  if (queryLower.includes('select count') || queryLower.includes('sum(') || queryLower.includes('avg(')) {
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

function calculateOverallPerformance(results: BenchmarkResult[]) {
  if (results.length === 0) {
    return { score: 0, grade: 'F' };
  }

  const avgExecutionTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
  const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / results.length;
  const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);

  // Score based on execution time (lower is better), accuracy (higher is better), and errors (lower is better)
  const timeScore = Math.max(0, 100 - (avgExecutionTime / 100)); // Assume 10s is baseline
  const accuracyScore = avgAccuracy * 100;
  const errorScore = Math.max(0, 100 - (totalErrors * 20));

  const overallScore = (timeScore * 0.4) + (accuracyScore * 0.4) + (errorScore * 0.2);

  let grade = 'F';
  if (overallScore >= 90) grade = 'A';
  else if (overallScore >= 80) grade = 'B';
  else if (overallScore >= 70) grade = 'C';
  else if (overallScore >= 60) grade = 'D';

  return { score: overallScore, grade };
}

function updatePatternMetrics(currentMetrics: any, benchmarkResults: BenchmarkResult[]) {
  if (benchmarkResults.length === 0) return currentMetrics;

  const avgExecutionTime = benchmarkResults.reduce((sum, r) => sum + r.executionTime, 0) / benchmarkResults.length;
  const avgAccuracy = benchmarkResults.reduce((sum, r) => sum + r.accuracy, 0) / benchmarkResults.length;
  const totalErrors = benchmarkResults.reduce((sum, r) => sum + r.errorCount, 0);
  const errorRate = totalErrors / benchmarkResults.length;

  // Blend with existing metrics (weighted average)
  const weight = 0.3; // 30% influence from new benchmarks

  return {
    averageResponseTime: (currentMetrics.averageResponseTime * (1 - weight)) + (avgExecutionTime * weight),
    accuracy: (currentMetrics.accuracy * (1 - weight)) + (avgAccuracy * weight),
    resourceUsage: currentMetrics.resourceUsage, // Keep existing for now
    errorRate: (currentMetrics.errorRate * (1 - weight)) + (errorRate * weight),
  };
}

function calculatePatternScore(
  pattern: AgentArchitecturePattern,
  queryCharacteristics: QueryCharacteristics,
  weights: any
): number {
  // Base score from pattern performance metrics
  const performanceScore = (
    (100 - Math.min(pattern.performanceMetrics.averageResponseTime / 100, 100)) * weights.performance +
    (pattern.performanceMetrics.accuracy * 100) * weights.accuracy +
    (100 - (pattern.performanceMetrics.resourceUsage.cpuUsage || 50)) * weights.resourceUsage +
    ((1 - pattern.performanceMetrics.errorRate) * 100) * weights.reliability
  );

  // Adjust score based on query characteristics compatibility
  let compatibilityBonus = 0;

  // Pattern-specific bonuses
  switch (pattern.patternType) {
    case 'planner-executor':
      if (queryCharacteristics.complexity > 60) compatibilityBonus += 15;
      if (queryCharacteristics.accuracyRequirement === 'critical') compatibilityBonus += 10;
      break;
    case 'reactive':
      if (queryCharacteristics.realTimeRequirement) compatibilityBonus += 20;
      if (queryCharacteristics.interactivityLevel === 'high') compatibilityBonus += 10;
      break;
    case 'streaming':
      if (queryCharacteristics.dataVolume === 'large') compatibilityBonus += 15;
      if (queryCharacteristics.domainCount > 2) compatibilityBonus += 10;
      break;
    case 'hybrid':
      compatibilityBonus += 5; // Always gets a small bonus for versatility
      break;
  }

  // Success rate bonus
  const successBonus = pattern.successRate * 10;

  return Math.min(performanceScore + compatibilityBonus + successBonus, 100);
}

function generatePatternReasoning(
  pattern: AgentArchitecturePattern,
  queryCharacteristics: QueryCharacteristics,
  score: number
): string {
  const reasons: string[] = [];

  reasons.push(`Pattern "${pattern.name}" scored ${score.toFixed(1)}/100 for this query`);

  if (pattern.performanceMetrics.accuracy > 0.9) {
    reasons.push('High accuracy rating from previous benchmarks');
  }

  if (pattern.performanceMetrics.averageResponseTime < 5000) {
    reasons.push('Fast average response time');
  }

  if (pattern.successRate > 0.95) {
    reasons.push('Excellent success rate in production');
  }

  // Pattern-specific reasoning
  switch (pattern.patternType) {
    case 'planner-executor':
      if (queryCharacteristics.complexity > 60) {
        reasons.push('Well-suited for complex multi-step analysis');
      }
      break;
    case 'reactive':
      if (queryCharacteristics.realTimeRequirement) {
        reasons.push('Optimized for real-time query requirements');
      }
      break;
    case 'streaming':
      if (queryCharacteristics.dataVolume === 'large') {
        reasons.push('Efficient handling of large data volumes');
      }
      break;
    case 'hybrid':
      reasons.push('Versatile pattern that adapts to query characteristics');
      break;
  }

  return reasons.join('. ');
}

function predictPatternPerformance(
  pattern: AgentArchitecturePattern,
  queryCharacteristics: QueryCharacteristics
) {
  // Base prediction on historical performance with adjustments for query characteristics
  const baseMetrics = pattern.performanceMetrics;

  // Adjust based on query complexity
  const complexityMultiplier = 1 + (queryCharacteristics.complexity / 200); // 0% complexity = 1x, 100% = 1.5x
  const domainMultiplier = 1 + (queryCharacteristics.domainCount - 1) * 0.2; // Each additional domain adds 20%

  let dataVolumeMultiplier = 1;
  switch (queryCharacteristics.dataVolume) {
    case 'small': dataVolumeMultiplier = 0.8; break;
    case 'medium': dataVolumeMultiplier = 1.0; break;
    case 'large': dataVolumeMultiplier = 1.5; break;
  }

  return {
    averageResponseTime: baseMetrics.averageResponseTime * complexityMultiplier * domainMultiplier * dataVolumeMultiplier,
    accuracy: Math.max(0.1, baseMetrics.accuracy * (queryCharacteristics.accuracyRequirement === 'critical' ? 0.95 : 1.0)),
    resourceUsage: {
      cpuUsage: Math.min(100, baseMetrics.resourceUsage.cpuUsage * complexityMultiplier),
      memoryUsage: baseMetrics.resourceUsage.memoryUsage * dataVolumeMultiplier,
      networkLatency: baseMetrics.resourceUsage.networkLatency * domainMultiplier,
      databaseConnections: Math.ceil(baseMetrics.resourceUsage.databaseConnections * domainMultiplier),
    },
    errorRate: Math.min(1.0, baseMetrics.errorRate * (queryCharacteristics.complexity / 50)),
  };
}

function generateImplementationSuggestions(
  pattern: AgentArchitecturePattern,
  queryCharacteristics: QueryCharacteristics
): string[] {
  const suggestions: string[] = [];

  // General suggestions based on pattern type
  switch (pattern.patternType) {
    case 'planner-executor':
      suggestions.push('Implement clear planning phase with explicit execution steps');
      suggestions.push('Use structured reasoning for complex decision-making');
      if (queryCharacteristics.domainCount > 1) {
        suggestions.push('Plan cross-domain data retrieval and integration strategy');
      }
      break;

    case 'reactive':
      suggestions.push('Set up event listeners for real-time data updates');
      suggestions.push('Implement efficient state management for reactive updates');
      if (queryCharacteristics.realTimeRequirement) {
        suggestions.push('Configure low-latency data connections');
      }
      break;

    case 'streaming':
      suggestions.push('Implement chunked data processing for large datasets');
      suggestions.push('Set up progress tracking and partial result delivery');
      if (queryCharacteristics.dataVolume === 'large') {
        suggestions.push('Configure appropriate batch sizes and memory management');
      }
      break;

    case 'hybrid':
      suggestions.push('Implement pattern selection logic based on query analysis');
      suggestions.push('Set up monitoring to track which patterns are most effective');
      suggestions.push('Configure fallback mechanisms between different execution modes');
      break;
  }

  // Query-specific suggestions
  if (queryCharacteristics.accuracyRequirement === 'critical') {
    suggestions.push('Implement multiple validation steps and consistency checks');
    suggestions.push('Add comprehensive error handling and retry mechanisms');
  }

  if (queryCharacteristics.interactivityLevel === 'high') {
    suggestions.push('Optimize for fast initial response with progressive enhancement');
    suggestions.push('Implement client-side caching for frequently accessed data');
  }

  // Configuration-specific suggestions
  if (pattern.configuration.timeoutMs > 60000) {
    suggestions.push('Consider implementing progress notifications for long-running queries');
  }

  if (pattern.configuration.cachingEnabled) {
    suggestions.push('Implement cache invalidation strategy for data consistency');
  }

  return suggestions;
}

function generateTradeoffAnalysis(bestPattern: AgentArchitecturePattern, alternativePattern: AgentArchitecturePattern): string[] {
  const tradeoffs: string[] = [];

  // Performance tradeoffs
  const responseTimeDiff = alternativePattern.performanceMetrics.averageResponseTime - bestPattern.performanceMetrics.averageResponseTime;
  if (responseTimeDiff > 1000) {
    tradeoffs.push(`Slower response time by ${(responseTimeDiff / 1000).toFixed(1)} seconds`);
  } else if (responseTimeDiff < -1000) {
    tradeoffs.push(`Faster response time by ${(-responseTimeDiff / 1000).toFixed(1)} seconds`);
  }

  // Accuracy tradeoffs
  const accuracyDiff = alternativePattern.performanceMetrics.accuracy - bestPattern.performanceMetrics.accuracy;
  if (accuracyDiff > 0.1) {
    tradeoffs.push(`Higher accuracy by ${(accuracyDiff * 100).toFixed(1)}%`);
  } else if (accuracyDiff < -0.1) {
    tradeoffs.push(`Lower accuracy by ${(-accuracyDiff * 100).toFixed(1)}%`);
  }

  // Resource usage tradeoffs
  const cpuDiff = alternativePattern.performanceMetrics.resourceUsage.cpuUsage - bestPattern.performanceMetrics.resourceUsage.cpuUsage;
  if (cpuDiff > 10) {
    tradeoffs.push(`Higher CPU usage (+${cpuDiff.toFixed(1)}%)`);
  } else if (cpuDiff < -10) {
    tradeoffs.push(`Lower CPU usage (${cpuDiff.toFixed(1)}%)`);
  }

  // Pattern-specific tradeoffs
  if (bestPattern.patternType !== alternativePattern.patternType) {
    switch (alternativePattern.patternType) {
      case 'planner-executor':
        tradeoffs.push('More structured but potentially slower execution');
        break;
      case 'reactive':
        tradeoffs.push('Better real-time capabilities but more complex state management');
        break;
      case 'streaming':
        tradeoffs.push('Better for large data but higher initial latency');
        break;
      case 'hybrid':
        tradeoffs.push('More flexible but requires additional configuration');
        break;
    }
  }

  return tradeoffs.length > 0 ? tradeoffs : ['Similar performance characteristics'];
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const architectureTools = [
  registerArchitecturePattern,
  listArchitecturePatterns,
  analyzeQueryComplexity,
  executePatternBenchmark,
  getArchitectureRecommendation,
];

// Export tool metadata for registration
export const architectureToolsMetadata = {
  category: 'architecture-evaluation',
  description: 'Agent architecture pattern evaluation and optimization tools',
  totalTools: architectureTools.length,
  capabilities: [
    'pattern_registration',
    'pattern_discovery',
    'query_complexity_analysis',
    'performance_benchmarking',
    'architecture_recommendation',
    'pattern_optimization',
    'performance_prediction',
    'implementation_guidance',
  ],
};

rootLogger.info('Architecture evaluation tools initialized', {
  totalTools: architectureTools.length,
  capabilities: architectureToolsMetadata.capabilities,
});