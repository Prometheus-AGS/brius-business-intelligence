/**
 * Performance Benchmarking Infrastructure
 * Provides comprehensive benchmarking capabilities for agent architecture patterns
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  AgentArchitecturePattern,
  BenchmarkResult,
  ResourceUsageMetrics,
  PatternType,
  UserContext,
  AnonymousContext,
  DomainType,
} from '../types/context.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Benchmark Configuration and Setup
// ============================================================================

export interface BenchmarkConfiguration {
  benchmarkId: string;
  name: string;
  description: string;
  iterations: number;
  warmupIterations: number;
  timeout: number;
  parallelExecution: boolean;
  resourceMonitoring: boolean;
  comparePatterns: boolean;
}

export interface BenchmarkSuite {
  suiteId: string;
  name: string;
  description: string;
  benchmarks: BenchmarkConfiguration[];
  patterns: string[]; // Pattern IDs to test
  createdAt: Date;
  lastRun?: Date;
}

export interface BenchmarkExecution {
  executionId: string;
  suiteId: string;
  benchmarkId: string;
  patternId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  results?: BenchmarkResult;
  error?: string;
  metadata: Record<string, any>;
}

export interface PerformanceBaseline {
  baselineId: string;
  patternType: PatternType;
  queryType: string;
  baselineMetrics: {
    executionTime: number;
    accuracy: number;
    resourceUsage: ResourceUsageMetrics;
    errorRate: number;
  };
  confidenceInterval: {
    executionTime: [number, number];
    accuracy: [number, number];
  };
  sampleSize: number;
  createdAt: Date;
}

// ============================================================================
// Benchmark Suite Management Tools
// ============================================================================

/**
 * Create Benchmark Suite
 */
export const createBenchmarkSuite = new Tool({
  id: 'create-benchmark-suite',
  description: 'Create a comprehensive benchmark suite for architecture pattern evaluation',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    suiteName: z.string().min(1).max(100).describe('Name of the benchmark suite'),
    description: z.string().min(1).max(500).describe('Description of the benchmark suite purpose'),
    benchmarkQueries: z.array(z.object({
      queryName: z.string().describe('Name for this benchmark query'),
      query: z.string().describe('SQL query to benchmark'),
      domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])),
      expectedResultCount: z.number().optional().describe('Expected number of results'),
      complexity: z.enum(['low', 'medium', 'high']).describe('Query complexity level'),
    })).min(1).describe('Benchmark queries to include in the suite'),
    patternIds: z.array(z.string()).optional().describe('Specific pattern IDs to test (empty for all active patterns)'),
    configuration: z.object({
      iterations: z.number().min(1).max(10).default(3).describe('Number of iterations per benchmark'),
      warmupIterations: z.number().min(0).max(5).default(1).describe('Warmup iterations before measurement'),
      timeout: z.number().min(5000).max(300000).default(60000).describe('Timeout per benchmark in milliseconds'),
      parallelExecution: z.boolean().default(false).describe('Whether to run benchmarks in parallel'),
      resourceMonitoring: z.boolean().default(true).describe('Enable detailed resource monitoring'),
      comparePatterns: z.boolean().default(true).describe('Generate pattern comparison analysis'),
    }).optional(),
  }),
  execute: async ({ sessionId, suiteName, description, benchmarkQueries, patternIds, configuration }, context) => {
    try {
      rootLogger.info('Creating benchmark suite', {
        sessionId,
        suiteName,
        queriesCount: benchmarkQueries.length,
        patternIds: patternIds?.length || 'all',
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const config = configuration || {
        iterations: 3,
        warmupIterations: 1,
        timeout: 60000,
        parallelExecution: false,
        resourceMonitoring: true,
        comparePatterns: true,
      };

      // Get available patterns if not specified
      let targetPatternIds = patternIds || [];
      if (targetPatternIds.length === 0) {
        const patternResults = await biContextStore.searchContextMemories(sessionId, 'architecture pattern', {
          userId: userContext.userId,
          category: 'architecture-pattern',
          topK: 20,
          similarityThreshold: 0.1,
        });

        for (const result of patternResults) {
          try {
            const pattern = JSON.parse(result.content) as AgentArchitecturePattern;
            if (pattern.isActive) {
              targetPatternIds.push(pattern.patternId);
            }
          } catch (parseError) {
            continue;
          }
        }
      }

      if (targetPatternIds.length === 0) {
        return {
          success: false,
          error: 'No active patterns found for benchmarking',
          sessionId,
        };
      }

      // Create benchmark configurations
      const benchmarkConfigs: BenchmarkConfiguration[] = benchmarkQueries.map((query, index) => ({
        benchmarkId: `bench_${suiteName.replace(/\s+/g, '_')}_${index}_${Date.now()}`,
        name: query.queryName,
        description: `Benchmark for ${query.complexity} complexity query: ${query.queryName}`,
        iterations: config.iterations,
        warmupIterations: config.warmupIterations,
        timeout: config.timeout,
        parallelExecution: config.parallelExecution,
        resourceMonitoring: config.resourceMonitoring,
        comparePatterns: config.comparePatterns,
      }));

      // Create benchmark suite
      const benchmarkSuite: BenchmarkSuite = {
        suiteId: `suite_${suiteName.replace(/\s+/g, '_')}_${Date.now()}`,
        name: suiteName,
        description,
        benchmarks: benchmarkConfigs,
        patterns: targetPatternIds,
        createdAt: new Date(),
      };

      // Store benchmark suite
      const suiteContent = JSON.stringify({
        ...benchmarkSuite,
        queries: benchmarkQueries,
        configuration: config,
      });

      await biContextStore.storeContextMemory(sessionId, suiteContent, {
        userId: userContext.userId,
        category: 'benchmark-suite',
        domains: [...new Set(benchmarkQueries.flatMap(q => q.domains))],
        scope: 'session',
        metadata: {
          suiteId: benchmarkSuite.suiteId,
          benchmarkCount: benchmarkConfigs.length,
          patternCount: targetPatternIds.length,
          totalExecutions: benchmarkConfigs.length * targetPatternIds.length,
        },
      });

      // Trace benchmark suite creation
      await biContextTracer.traceMemoryOperation(sessionId, 'benchmark_suite_creation', {
        suiteId: benchmarkSuite.suiteId,
        benchmarkCount: benchmarkConfigs.length,
        patternCount: targetPatternIds.length,
        configuration: config,
      });

      return {
        success: true,
        sessionId,
        suiteId: benchmarkSuite.suiteId,
        benchmarkSuite,
        summary: {
          benchmarksCreated: benchmarkConfigs.length,
          patternsToTest: targetPatternIds.length,
          totalExecutions: benchmarkConfigs.length * targetPatternIds.length,
          estimatedDuration: calculateEstimatedDuration(benchmarkConfigs, targetPatternIds.length, config),
        },
      };

    } catch (error) {
      rootLogger.error('Failed to create benchmark suite', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to create benchmark suite',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Execute Benchmark Suite
 */
export const executeBenchmarkSuite = new Tool({
  id: 'execute-benchmark-suite',
  description: 'Execute a complete benchmark suite against architecture patterns',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    suiteId: z.string().describe('Benchmark suite ID to execute'),
    executionMode: z.enum(['sequential', 'parallel', 'adaptive']).default('sequential').describe('Execution mode for benchmarks'),
    reportProgress: z.boolean().default(true).describe('Report progress during execution'),
    generateReport: z.boolean().default(true).describe('Generate comprehensive execution report'),
  }),
  execute: async ({ sessionId, suiteId, executionMode, reportProgress, generateReport }, context) => {
    try {
      rootLogger.info('Executing benchmark suite', {
        sessionId,
        suiteId,
        executionMode,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve benchmark suite
      const suiteResults = await biContextStore.searchContextMemories(sessionId, suiteId, {
        userId: userContext.userId,
        category: 'benchmark-suite',
        topK: 1,
        similarityThreshold: 0.8,
      });

      if (suiteResults.length === 0) {
        return {
          success: false,
          error: 'Benchmark suite not found',
          suiteId,
          sessionId,
        };
      }

      const suiteData = JSON.parse(suiteResults[0].content);
      const suite: BenchmarkSuite = suiteData;
      const queries = suiteData.queries;
      const configuration = suiteData.configuration;

      // Retrieve patterns to test
      const patterns: AgentArchitecturePattern[] = [];
      for (const patternId of suite.patterns) {
        const patternResults = await biContextStore.searchContextMemories(sessionId, patternId, {
          userId: userContext.userId,
          category: 'architecture-pattern',
          topK: 1,
          similarityThreshold: 0.8,
        });

        if (patternResults.length > 0) {
          try {
            const pattern = JSON.parse(patternResults[0].content) as AgentArchitecturePattern;
            patterns.push(pattern);
          } catch (parseError) {
            rootLogger.warn('Failed to parse pattern for benchmarking', { patternId });
          }
        }
      }

      if (patterns.length === 0) {
        return {
          success: false,
          error: 'No valid patterns found for benchmarking',
          sessionId,
        };
      }

      const startTime = Date.now();
      const executions: BenchmarkExecution[] = [];
      const results: BenchmarkResult[] = [];

      // Execute benchmarks based on mode
      switch (executionMode) {
        case 'sequential':
          for (const [benchmarkIndex, benchmark] of suite.benchmarks.entries()) {
            const query = queries[benchmarkIndex];

            for (const pattern of patterns) {
              const execution = await executeSingleBenchmark(
                benchmark,
                query,
                pattern,
                sessionId,
                userContext
              );

              executions.push(execution);
              if (execution.results) {
                results.push(execution.results);
              }

              if (reportProgress) {
                const progress = ((executions.length / (suite.benchmarks.length * patterns.length)) * 100).toFixed(1);
                rootLogger.info('Benchmark execution progress', {
                  sessionId,
                  suiteId,
                  progress: `${progress}%`,
                  currentBenchmark: benchmark.name,
                  currentPattern: pattern.patternType,
                });
              }
            }
          }
          break;

        case 'parallel':
          // Execute all benchmarks in parallel (simplified implementation)
          const parallelPromises = [];
          for (const [benchmarkIndex, benchmark] of suite.benchmarks.entries()) {
            const query = queries[benchmarkIndex];
            for (const pattern of patterns) {
              parallelPromises.push(
                executeSingleBenchmark(benchmark, query, pattern, sessionId, userContext)
              );
            }
          }

          const parallelResults = await Promise.allSettled(parallelPromises);
          for (const result of parallelResults) {
            if (result.status === 'fulfilled') {
              executions.push(result.value);
              if (result.value.results) {
                results.push(result.value.results);
              }
            }
          }
          break;

        case 'adaptive':
          // Adaptive execution based on resource usage (simplified)
          const maxConcurrency = 3;
          let activeBenchmarks = 0;
          const pendingBenchmarks = [];

          for (const [benchmarkIndex, benchmark] of suite.benchmarks.entries()) {
            const query = queries[benchmarkIndex];
            for (const pattern of patterns) {
              pendingBenchmarks.push({ benchmark, query, pattern });
            }
          }

          while (pendingBenchmarks.length > 0 || activeBenchmarks > 0) {
            while (activeBenchmarks < maxConcurrency && pendingBenchmarks.length > 0) {
              const { benchmark, query, pattern } = pendingBenchmarks.shift()!;
              activeBenchmarks++;

              executeSingleBenchmark(benchmark, query, pattern, sessionId, userContext)
                .then(execution => {
                  executions.push(execution);
                  if (execution.results) {
                    results.push(execution.results);
                  }
                  activeBenchmarks--;
                })
                .catch(error => {
                  rootLogger.error('Benchmark execution failed', { error: (error as Error).message });
                  activeBenchmarks--;
                });
            }

            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          break;
      }

      const executionTime = Date.now() - startTime;

      // Generate execution summary
      const summary = generateExecutionSummary(executions, results, executionTime);

      // Store execution results
      const executionRecord = {
        suiteId,
        executionMode,
        startTime: new Date(startTime),
        endTime: new Date(),
        executions,
        results,
        summary,
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(executionRecord), {
        userId: userContext.userId,
        category: 'benchmark-execution',
        domains: [],
        scope: 'session',
        metadata: {
          suiteId,
          executionMode,
          totalExecutions: executions.length,
          successfulExecutions: executions.filter(e => e.status === 'completed').length,
          executionTime,
        },
      });

      // Generate comprehensive report if requested
      let report = undefined;
      if (generateReport) {
        report = await generateBenchmarkReport(suite, executions, results, summary);
      }

      // Trace benchmark suite execution
      await biContextTracer.traceMemoryOperation(sessionId, 'benchmark_suite_execution', {
        suiteId,
        executionMode,
        totalExecutions: executions.length,
        successfulExecutions: summary.successfulExecutions,
        averageExecutionTime: summary.averageExecutionTime,
        topPerformingPattern: summary.topPerformingPattern,
      });

      return {
        success: true,
        sessionId,
        suiteId,
        executionSummary: summary,
        report,
        performance: {
          totalExecutions: executions.length,
          successfulExecutions: summary.successfulExecutions,
          failedExecutions: summary.failedExecutions,
          executionTime,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to execute benchmark suite', {
        sessionId,
        suiteId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to execute benchmark suite',
        details: (error as Error).message,
        sessionId,
        suiteId,
      };
    }
  },
});

// ============================================================================
// Performance Baseline Management Tools
// ============================================================================

/**
 * Create Performance Baseline
 */
export const createPerformanceBaseline = new Tool({
  id: 'create-performance-baseline',
  description: 'Create performance baselines for architecture patterns and query types',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    patternType: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).describe('Pattern type for baseline'),
    queryType: z.string().describe('Query type classification (e.g., aggregation, multi-table)'),
    benchmarkResults: z.array(z.any()).describe('Benchmark results to use for baseline calculation'),
    confidenceLevel: z.number().min(0.8).max(0.99).default(0.95).describe('Confidence level for intervals'),
  }),
  execute: async ({ sessionId, patternType, queryType, benchmarkResults, confidenceLevel }, context) => {
    try {
      rootLogger.info('Creating performance baseline', {
        sessionId,
        patternType,
        queryType,
        resultsCount: benchmarkResults.length,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      if (benchmarkResults.length < 3) {
        return {
          success: false,
          error: 'Insufficient benchmark results for baseline creation (minimum 3 required)',
          sessionId,
        };
      }

      // Calculate baseline metrics
      const executionTimes = benchmarkResults.map(r => r.executionTime);
      const accuracies = benchmarkResults.map(r => r.accuracy);
      const errorCounts = benchmarkResults.map(r => r.errorCount);

      const baselineMetrics = {
        executionTime: calculateMean(executionTimes),
        accuracy: calculateMean(accuracies),
        resourceUsage: calculateAverageResourceUsage(benchmarkResults),
        errorRate: calculateMean(errorCounts) / benchmarkResults.length,
      };

      // Calculate confidence intervals
      const confidenceInterval = {
        executionTime: calculateConfidenceInterval(executionTimes, confidenceLevel),
        accuracy: calculateConfidenceInterval(accuracies, confidenceLevel),
      };

      // Create baseline
      const baseline: PerformanceBaseline = {
        baselineId: `baseline_${patternType}_${queryType}_${Date.now()}`,
        patternType,
        queryType,
        baselineMetrics,
        confidenceInterval,
        sampleSize: benchmarkResults.length,
        createdAt: new Date(),
      };

      // Store baseline
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(baseline), {
        userId: userContext.userId,
        category: 'performance-baseline',
        domains: [],
        scope: 'session',
        metadata: {
          baselineId: baseline.baselineId,
          patternType,
          queryType,
          sampleSize: benchmarkResults.length,
        },
      });

      // Trace baseline creation
      await biContextTracer.traceMemoryOperation(sessionId, 'baseline_creation', {
        baselineId: baseline.baselineId,
        patternType,
        queryType,
        sampleSize: benchmarkResults.length,
        baselineMetrics,
      });

      return {
        success: true,
        sessionId,
        baselineId: baseline.baselineId,
        baseline,
        statistics: {
          sampleSize: benchmarkResults.length,
          confidenceLevel,
          executionTimeStats: {
            mean: baselineMetrics.executionTime,
            std: calculateStandardDeviation(executionTimes),
            min: Math.min(...executionTimes),
            max: Math.max(...executionTimes),
          },
          accuracyStats: {
            mean: baselineMetrics.accuracy,
            std: calculateStandardDeviation(accuracies),
            min: Math.min(...accuracies),
            max: Math.max(...accuracies),
          },
        },
      };

    } catch (error) {
      rootLogger.error('Failed to create performance baseline', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to create performance baseline',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Compare Against Baseline
 */
export const compareAgainstBaseline = new Tool({
  id: 'compare-against-baseline',
  description: 'Compare benchmark results against established performance baselines',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    benchmarkResults: z.array(z.any()).describe('Benchmark results to compare'),
    baselineId: z.string().optional().describe('Specific baseline ID to compare against'),
    patternType: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).optional().describe('Pattern type for baseline matching'),
    queryType: z.string().optional().describe('Query type for baseline matching'),
    significanceLevel: z.number().min(0.01).max(0.1).default(0.05).describe('Statistical significance level'),
  }),
  execute: async ({ sessionId, benchmarkResults, baselineId, patternType, queryType, significanceLevel }, context) => {
    try {
      rootLogger.info('Comparing results against baseline', {
        sessionId,
        resultsCount: benchmarkResults.length,
        baselineId,
        patternType,
        queryType,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      let baseline: PerformanceBaseline | undefined;

      // Find baseline
      if (baselineId) {
        const baselineResults = await biContextStore.searchContextMemories(sessionId, baselineId, {
          userId: userContext.userId,
          category: 'performance-baseline',
          topK: 1,
          similarityThreshold: 0.8,
        });

        if (baselineResults.length > 0) {
          baseline = JSON.parse(baselineResults[0].content) as PerformanceBaseline;
        }
      } else if (patternType && queryType) {
        // Search for matching baseline
        const baselineResults = await biContextStore.searchContextMemories(
          sessionId,
          `${patternType} ${queryType} baseline`,
          {
            userId: userContext.userId,
            category: 'performance-baseline',
            topK: 5,
            similarityThreshold: 0.6,
          }
        );

        for (const result of baselineResults) {
          try {
            const candidateBaseline = JSON.parse(result.content) as PerformanceBaseline;
            if (candidateBaseline.patternType === patternType && candidateBaseline.queryType === queryType) {
              baseline = candidateBaseline;
              break;
            }
          } catch (parseError) {
            continue;
          }
        }
      }

      if (!baseline) {
        return {
          success: false,
          error: 'No matching baseline found',
          sessionId,
        };
      }

      // Perform comparison
      const comparison = performBaselineComparison(benchmarkResults, baseline, significanceLevel);

      // Store comparison results
      const comparisonRecord = {
        baselineId: baseline.baselineId,
        benchmarkResults,
        comparison,
        timestamp: new Date().toISOString(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(comparisonRecord), {
        userId: userContext.userId,
        category: 'baseline-comparison',
        domains: [],
        scope: 'session',
        metadata: {
          baselineId: baseline.baselineId,
          patternType: baseline.patternType,
          queryType: baseline.queryType,
          resultsCount: benchmarkResults.length,
          significantChange: comparison.significantChange,
        },
      });

      // Trace comparison
      await biContextTracer.traceMemoryOperation(sessionId, 'baseline_comparison', {
        baselineId: baseline.baselineId,
        resultsCount: benchmarkResults.length,
        significantChange: comparison.significantChange,
        performanceChange: comparison.performanceChange,
      });

      return {
        success: true,
        sessionId,
        baselineId: baseline.baselineId,
        comparison,
        recommendations: generateComparisonRecommendations(comparison),
      };

    } catch (error) {
      rootLogger.error('Failed to compare against baseline', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to compare against baseline',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function calculateEstimatedDuration(
  benchmarks: BenchmarkConfiguration[],
  patternCount: number,
  config: any
): number {
  const avgTimePerBenchmark = 10000; // 10 seconds average
  const totalExecutions = benchmarks.length * patternCount * config.iterations;
  const overhead = totalExecutions * 2000; // 2 seconds overhead per execution

  return (totalExecutions * avgTimePerBenchmark) + overhead;
}

async function executeSingleBenchmark(
  benchmark: BenchmarkConfiguration,
  query: any,
  pattern: AgentArchitecturePattern,
  sessionId: string,
  userContext: UserContext | AnonymousContext
): Promise<BenchmarkExecution> {
  const execution: BenchmarkExecution = {
    executionId: `exec_${benchmark.benchmarkId}_${pattern.patternId}_${Date.now()}`,
    suiteId: '', // Will be set by caller
    benchmarkId: benchmark.benchmarkId,
    patternId: pattern.patternId,
    startTime: new Date(),
    status: 'running',
    metadata: {
      queryName: query.queryName,
      patternType: pattern.patternType,
      domains: query.domains,
    },
  };

  try {
    // Check domain permissions
    for (const domain of query.domains) {
      if (!hasPermission(userContext, domain, 'query')) {
        throw new Error(`Access denied for domain: ${domain}`);
      }
    }

    // Execute warmup iterations
    for (let i = 0; i < benchmark.warmupIterations; i++) {
      await simulatePatternExecution(pattern, query);
    }

    // Execute actual benchmark iterations
    const iterationResults: BenchmarkResult[] = [];
    for (let i = 0; i < benchmark.iterations; i++) {
      const startTime = Date.now();
      const simulationResult = await simulatePatternExecution(pattern, query);
      const executionTime = Date.now() - startTime;

      const iterationResult: BenchmarkResult = {
        benchmarkId: `${benchmark.benchmarkId}_iter_${i}`,
        queryType: inferQueryType(query.query),
        executionTime: executionTime + simulationResult.additionalTime,
        accuracy: simulationResult.accuracy,
        resourceUsage: simulationResult.resourceUsage,
        errorCount: simulationResult.errorCount,
        timestamp: new Date(),
      };

      iterationResults.push(iterationResult);
    }

    // Calculate average results
    const avgResult: BenchmarkResult = {
      benchmarkId: execution.executionId,
      queryType: iterationResults[0].queryType,
      executionTime: iterationResults.reduce((sum, r) => sum + r.executionTime, 0) / iterationResults.length,
      accuracy: iterationResults.reduce((sum, r) => sum + r.accuracy, 0) / iterationResults.length,
      resourceUsage: {
        cpuUsage: iterationResults.reduce((sum, r) => sum + r.resourceUsage.cpuUsage, 0) / iterationResults.length,
        memoryUsage: iterationResults.reduce((sum, r) => sum + r.resourceUsage.memoryUsage, 0) / iterationResults.length,
        networkLatency: iterationResults.reduce((sum, r) => sum + r.resourceUsage.networkLatency, 0) / iterationResults.length,
        databaseConnections: Math.ceil(iterationResults.reduce((sum, r) => sum + r.resourceUsage.databaseConnections, 0) / iterationResults.length),
      },
      errorCount: iterationResults.reduce((sum, r) => sum + r.errorCount, 0),
      timestamp: new Date(),
    };

    execution.endTime = new Date();
    execution.status = 'completed';
    execution.results = avgResult;

  } catch (error) {
    execution.endTime = new Date();
    execution.status = 'failed';
    execution.error = (error as Error).message;
  }

  return execution;
}

async function simulatePatternExecution(pattern: AgentArchitecturePattern, query: any) {
  // Simulate execution based on pattern type and query characteristics
  const baseTime = 1000 + (query.query.length * 2);
  const domainMultiplier = query.domains.length * 0.5;

  let patternMultiplier = 1.0;
  let accuracyMultiplier = 1.0;
  let resourceMultiplier = 1.0;

  switch (pattern.patternType) {
    case 'planner-executor':
      patternMultiplier = 1.3;
      accuracyMultiplier = 1.1;
      resourceMultiplier = 1.2;
      break;
    case 'reactive':
      patternMultiplier = 0.6;
      accuracyMultiplier = 0.95;
      resourceMultiplier = 0.8;
      break;
    case 'streaming':
      patternMultiplier = 1.8;
      accuracyMultiplier = 1.05;
      resourceMultiplier = 0.7;
      break;
    case 'hybrid':
      patternMultiplier = 1.0;
      accuracyMultiplier = 1.0;
      resourceMultiplier = 1.0;
      break;
  }

  const additionalTime = baseTime * domainMultiplier * patternMultiplier;
  const accuracy = Math.min(1.0, pattern.performanceMetrics.accuracy * accuracyMultiplier * (0.9 + Math.random() * 0.2));

  return {
    additionalTime,
    accuracy,
    resourceUsage: {
      cpuUsage: pattern.performanceMetrics.resourceUsage.cpuUsage * resourceMultiplier * (0.8 + Math.random() * 0.4),
      memoryUsage: pattern.performanceMetrics.resourceUsage.memoryUsage * resourceMultiplier * (0.8 + Math.random() * 0.4),
      networkLatency: pattern.performanceMetrics.resourceUsage.networkLatency * (0.8 + Math.random() * 0.4),
      databaseConnections: Math.ceil(pattern.performanceMetrics.resourceUsage.databaseConnections * domainMultiplier),
    },
    errorCount: Math.random() < pattern.performanceMetrics.errorRate ? 1 : 0,
  };
}

function generateExecutionSummary(executions: BenchmarkExecution[], results: BenchmarkResult[], executionTime: number) {
  const successfulExecutions = executions.filter(e => e.status === 'completed').length;
  const failedExecutions = executions.filter(e => e.status === 'failed').length;

  const averageExecutionTime = results.length > 0
    ? results.reduce((sum, r) => sum + r.executionTime, 0) / results.length
    : 0;

  const averageAccuracy = results.length > 0
    ? results.reduce((sum, r) => sum + r.accuracy, 0) / results.length
    : 0;

  // Find top performing pattern
  const patternPerformance: Record<string, number[]> = {};
  for (const execution of executions) {
    if (execution.results) {
      if (!patternPerformance[execution.patternId]) {
        patternPerformance[execution.patternId] = [];
      }
      // Simple score: accuracy * 100 - execution time penalty
      const score = (execution.results.accuracy * 100) - (execution.results.executionTime / 1000);
      patternPerformance[execution.patternId].push(score);
    }
  }

  let topPerformingPattern = 'none';
  let bestScore = -Infinity;

  for (const [patternId, scores] of Object.entries(patternPerformance)) {
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    if (avgScore > bestScore) {
      bestScore = avgScore;
      topPerformingPattern = patternId;
    }
  }

  return {
    totalExecutions: executions.length,
    successfulExecutions,
    failedExecutions,
    executionTime,
    averageExecutionTime,
    averageAccuracy,
    topPerformingPattern,
    patternPerformance,
  };
}

async function generateBenchmarkReport(
  suite: BenchmarkSuite,
  executions: BenchmarkExecution[],
  results: BenchmarkResult[],
  summary: any
) {
  return {
    suiteInfo: {
      name: suite.name,
      description: suite.description,
      benchmarkCount: suite.benchmarks.length,
      patternCount: suite.patterns.length,
    },
    executionSummary: summary,
    detailedResults: {
      byPattern: groupResultsByPattern(executions, results),
      byBenchmark: groupResultsByBenchmark(executions, results),
    },
    recommendations: generateReportRecommendations(summary, results),
    generatedAt: new Date().toISOString(),
  };
}

function groupResultsByPattern(executions: BenchmarkExecution[], results: BenchmarkResult[]) {
  const grouped: Record<string, any> = {};

  for (const execution of executions) {
    if (execution.results) {
      if (!grouped[execution.patternId]) {
        grouped[execution.patternId] = {
          patternId: execution.patternId,
          executions: [],
          averageExecutionTime: 0,
          averageAccuracy: 0,
          totalErrors: 0,
        };
      }

      grouped[execution.patternId].executions.push(execution);
    }
  }

  // Calculate averages
  for (const patternData of Object.values(grouped)) {
    const executions = patternData.executions;
    if (executions.length > 0) {
      patternData.averageExecutionTime = executions.reduce((sum: number, e: any) => sum + e.results.executionTime, 0) / executions.length;
      patternData.averageAccuracy = executions.reduce((sum: number, e: any) => sum + e.results.accuracy, 0) / executions.length;
      patternData.totalErrors = executions.reduce((sum: number, e: any) => sum + e.results.errorCount, 0);
    }
  }

  return grouped;
}

function groupResultsByBenchmark(executions: BenchmarkExecution[], results: BenchmarkResult[]) {
  const grouped: Record<string, any> = {};

  for (const execution of executions) {
    if (execution.results) {
      if (!grouped[execution.benchmarkId]) {
        grouped[execution.benchmarkId] = {
          benchmarkId: execution.benchmarkId,
          executions: [],
          averageExecutionTime: 0,
          averageAccuracy: 0,
          totalErrors: 0,
        };
      }

      grouped[execution.benchmarkId].executions.push(execution);
    }
  }

  // Calculate averages
  for (const benchmarkData of Object.values(grouped)) {
    const executions = benchmarkData.executions;
    if (executions.length > 0) {
      benchmarkData.averageExecutionTime = executions.reduce((sum: number, e: any) => sum + e.results.executionTime, 0) / executions.length;
      benchmarkData.averageAccuracy = executions.reduce((sum: number, e: any) => sum + e.results.accuracy, 0) / executions.length;
      benchmarkData.totalErrors = executions.reduce((sum: number, e: any) => sum + e.results.errorCount, 0);
    }
  }

  return grouped;
}

function generateReportRecommendations(summary: any, results: BenchmarkResult[]): string[] {
  const recommendations: string[] = [];

  if (summary.averageAccuracy < 0.85) {
    recommendations.push('Consider optimizing pattern configurations to improve accuracy');
  }

  if (summary.averageExecutionTime > 10000) {
    recommendations.push('High execution times detected - consider performance optimizations');
  }

  if (summary.failedExecutions > 0) {
    recommendations.push(`${summary.failedExecutions} executions failed - review error handling and timeout settings`);
  }

  if (results.length > 0) {
    const highCpuUsage = results.filter(r => r.resourceUsage.cpuUsage > 80).length;
    if (highCpuUsage > results.length * 0.3) {
      recommendations.push('High CPU usage detected in multiple executions - consider resource optimization');
    }
  }

  return recommendations;
}

function calculateMean(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function calculateStandardDeviation(values: number[]): number {
  const mean = calculateMean(values);
  const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
  const variance = calculateMean(squaredDifferences);
  return Math.sqrt(variance);
}

function calculateConfidenceInterval(values: number[], confidenceLevel: number): [number, number] {
  const mean = calculateMean(values);
  const std = calculateStandardDeviation(values);
  const n = values.length;

  // Use t-distribution for small samples (simplified z-score for large samples)
  const tValue = n > 30 ? 1.96 : 2.262; // Approximate t-values
  const margin = tValue * (std / Math.sqrt(n));

  return [mean - margin, mean + margin];
}

function calculateAverageResourceUsage(results: BenchmarkResult[]): ResourceUsageMetrics {
  return {
    cpuUsage: calculateMean(results.map(r => r.resourceUsage.cpuUsage)),
    memoryUsage: calculateMean(results.map(r => r.resourceUsage.memoryUsage)),
    networkLatency: calculateMean(results.map(r => r.resourceUsage.networkLatency)),
    databaseConnections: Math.ceil(calculateMean(results.map(r => r.resourceUsage.databaseConnections))),
  };
}

function performBaselineComparison(results: BenchmarkResult[], baseline: PerformanceBaseline, significanceLevel: number) {
  const currentMetrics = {
    executionTime: calculateMean(results.map(r => r.executionTime)),
    accuracy: calculateMean(results.map(r => r.accuracy)),
  };

  // Simple statistical comparison (would use proper statistical tests in production)
  const executionTimeChange = ((currentMetrics.executionTime - baseline.baselineMetrics.executionTime) / baseline.baselineMetrics.executionTime) * 100;
  const accuracyChange = ((currentMetrics.accuracy - baseline.baselineMetrics.accuracy) / baseline.baselineMetrics.accuracy) * 100;

  const significantChange = Math.abs(executionTimeChange) > 10 || Math.abs(accuracyChange) > 5; // Simplified thresholds

  let performanceChange: 'improved' | 'degraded' | 'stable' = 'stable';
  if (executionTimeChange < -5 && accuracyChange > -2) {
    performanceChange = 'improved';
  } else if (executionTimeChange > 10 || accuracyChange < -5) {
    performanceChange = 'degraded';
  }

  return {
    baseline: baseline.baselineMetrics,
    current: currentMetrics,
    changes: {
      executionTime: executionTimeChange,
      accuracy: accuracyChange,
    },
    significantChange,
    performanceChange,
    confidenceIntervals: baseline.confidenceInterval,
    withinBaselineRange: {
      executionTime: currentMetrics.executionTime >= baseline.confidenceInterval.executionTime[0] &&
                      currentMetrics.executionTime <= baseline.confidenceInterval.executionTime[1],
      accuracy: currentMetrics.accuracy >= baseline.confidenceInterval.accuracy[0] &&
                currentMetrics.accuracy <= baseline.confidenceInterval.accuracy[1],
    },
  };
}

function generateComparisonRecommendations(comparison: any): string[] {
  const recommendations: string[] = [];

  if (comparison.performanceChange === 'improved') {
    recommendations.push('Performance has improved since baseline - consider updating baseline with new metrics');
  } else if (comparison.performanceChange === 'degraded') {
    recommendations.push('Performance has degraded - investigate potential causes and optimization opportunities');
  }

  if (!comparison.withinBaselineRange.executionTime) {
    recommendations.push('Execution time is outside baseline confidence interval - investigate performance changes');
  }

  if (!comparison.withinBaselineRange.accuracy) {
    recommendations.push('Accuracy is outside baseline confidence interval - review accuracy factors');
  }

  if (comparison.significantChange) {
    recommendations.push('Significant performance change detected - detailed analysis recommended');
  }

  return recommendations;
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
// Export Tools Array
// ============================================================================

export const benchmarkingTools = [
  createBenchmarkSuite,
  executeBenchmarkSuite,
  createPerformanceBaseline,
  compareAgainstBaseline,
];

// Export tool metadata for registration
export const benchmarkingToolsMetadata = {
  category: 'performance-benchmarking',
  description: 'Performance benchmarking infrastructure for architecture patterns',
  totalTools: benchmarkingTools.length,
  capabilities: [
    'benchmark_suite_creation',
    'benchmark_execution',
    'performance_baseline_management',
    'statistical_comparison',
    'performance_regression_detection',
    'comprehensive_reporting',
  ],
};

rootLogger.info('Benchmarking infrastructure initialized', {
  totalTools: benchmarkingTools.length,
  capabilities: benchmarkingToolsMetadata.capabilities,
});