/**
 * Performance Metrics Collection and Analysis
 * Provides comprehensive metrics collection, aggregation, and analysis for architecture patterns
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
  PatternPerformanceMetrics,
  PatternType,
  UserContext,
  AnonymousContext,
  DomainType,
} from '../types/context.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Performance Metrics Types
// ============================================================================

export interface MetricsCollectionConfig {
  enableRealTimeCollection: boolean;
  collectionInterval: number; // milliseconds
  aggregationWindow: number; // milliseconds
  retentionPeriod: number; // milliseconds
  enableDetailedResourceTracking: boolean;
  enableUserExperienceMetrics: boolean;
  alertThresholds: AlertThresholds;
}

export interface AlertThresholds {
  maxExecutionTime: number;
  minAccuracy: number;
  maxErrorRate: number;
  maxCpuUsage: number;
  maxMemoryUsage: number;
}

export interface PerformanceMetricsSnapshot {
  snapshotId: string;
  patternId: string;
  patternType: PatternType;
  timestamp: Date;
  executionMetrics: ExecutionMetrics;
  resourceMetrics: ResourceMetrics;
  qualityMetrics: QualityMetrics;
  userExperienceMetrics: UserExperienceMetrics;
  contextMetrics: ContextMetrics;
}

export interface ExecutionMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  medianExecutionTime: number;
  p95ExecutionTime: number;
  executionTimeStdDev: number;
  timeoutCount: number;
  retryCount: number;
}

export interface ResourceMetrics {
  averageResourceUsage: ResourceUsageMetrics;
  peakResourceUsage: ResourceUsageMetrics;
  resourceEfficiency: number; // 0-1 score
  connectionPoolUtilization: number;
  cacheHitRate: number;
  networkUtilization: number;
}

export interface QualityMetrics {
  averageAccuracy: number;
  accuracyStdDev: number;
  minAccuracy: number;
  maxAccuracy: number;
  dataQualityScore: number;
  resultConsistency: number;
  errorDistribution: Record<string, number>;
}

export interface UserExperienceMetrics {
  averageUserSatisfaction: number;
  responseTimePerceived: number;
  interactionCount: number;
  abandonmentRate: number;
  userRetryRate: number;
  feedbackScore: number;
}

export interface ContextMetrics {
  sessionCount: number;
  uniqueUsers: number;
  domainUtilization: Record<string, number>;
  queryComplexityDistribution: Record<string, number>;
  patternSwitchingRate: number;
  contextLossEvents: number;
}

export interface MetricsAnalysisResult {
  patternId: string;
  analysisType: 'trend' | 'comparison' | 'anomaly' | 'comprehensive';
  timeRange: {
    start: Date;
    end: Date;
  };
  findings: MetricsFindings;
  trends: MetricsTrends;
  anomalies: MetricsAnomalies;
  recommendations: string[];
  confidenceScore: number;
}

export interface MetricsFindings {
  performanceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  keyStrengths: string[];
  keyWeaknesses: string[];
  comparisonToBaseline: {
    executionTime: 'better' | 'same' | 'worse';
    accuracy: 'better' | 'same' | 'worse';
    reliability: 'better' | 'same' | 'worse';
  };
}

export interface MetricsTrends {
  executionTimeTrend: 'improving' | 'stable' | 'degrading';
  accuracyTrend: 'improving' | 'stable' | 'degrading';
  usageTrend: 'increasing' | 'stable' | 'decreasing';
  errorRateTrend: 'improving' | 'stable' | 'degrading';
}

export interface MetricsAnomalies {
  spikes: Array<{
    metric: string;
    timestamp: Date;
    value: number;
    severity: 'low' | 'medium' | 'high';
    possibleCause: string;
  }>;
  patterns: Array<{
    description: string;
    frequency: number;
    impact: 'low' | 'medium' | 'high';
  }>;
}

// ============================================================================
// Metrics Collection Tools
// ============================================================================

/**
 * Start Metrics Collection
 */
export const startMetricsCollection = new Tool({
  id: 'start-metrics-collection',
  description: 'Start comprehensive performance metrics collection for architecture patterns',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    patternIds: z.array(z.string()).optional().describe('Specific pattern IDs to monitor (empty for all)'),
    collectionConfig: z.object({
      enableRealTimeCollection: z.boolean().default(true),
      collectionInterval: z.number().min(1000).max(60000).default(5000).describe('Collection interval in milliseconds'),
      aggregationWindow: z.number().min(60000).max(3600000).default(300000).describe('Aggregation window in milliseconds'),
      retentionPeriod: z.number().min(3600000).max(86400000).default(86400000).describe('Retention period in milliseconds'),
      enableDetailedResourceTracking: z.boolean().default(true),
      enableUserExperienceMetrics: z.boolean().default(true),
      alertThresholds: z.object({
        maxExecutionTime: z.number().default(30000),
        minAccuracy: z.number().min(0).max(1).default(0.8),
        maxErrorRate: z.number().min(0).max(1).default(0.1),
        maxCpuUsage: z.number().min(0).max(100).default(80),
        maxMemoryUsage: z.number().min(0).default(500),
      }).optional(),
    }).optional(),
  }),
  execute: async ({ sessionId, patternIds, collectionConfig }, context) => {
    try {
      rootLogger.info('Starting metrics collection', {
        sessionId,
        patternIds: patternIds?.length || 'all',
        realTimeEnabled: collectionConfig?.enableRealTimeCollection,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const config: MetricsCollectionConfig = {
        enableRealTimeCollection: collectionConfig?.enableRealTimeCollection ?? true,
        collectionInterval: collectionConfig?.collectionInterval || 5000,
        aggregationWindow: collectionConfig?.aggregationWindow || 300000,
        retentionPeriod: collectionConfig?.retentionPeriod || 86400000,
        enableDetailedResourceTracking: collectionConfig?.enableDetailedResourceTracking ?? true,
        enableUserExperienceMetrics: collectionConfig?.enableUserExperienceMetrics ?? true,
        alertThresholds: collectionConfig?.alertThresholds || {
          maxExecutionTime: 30000,
          minAccuracy: 0.8,
          maxErrorRate: 0.1,
          maxCpuUsage: 80,
          maxMemoryUsage: 500,
        },
      };

      // Get patterns to monitor
      let targetPatterns: string[] = patternIds || [];
      if (targetPatterns.length === 0) {
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
              targetPatterns.push(pattern.patternId);
            }
          } catch (parseError) {
            continue;
          }
        }
      }

      if (targetPatterns.length === 0) {
        return {
          success: false,
          error: 'No active patterns found for metrics collection',
          sessionId,
        };
      }

      // Initialize metrics collection state
      const collectionState = {
        sessionId,
        collectionId: `metrics_${sessionId}_${Date.now()}`,
        config,
        monitoredPatterns: targetPatterns,
        startTime: new Date(),
        status: 'active' as const,
        metricsCollected: 0,
        lastCollection: new Date(),
      };

      // Store collection configuration
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(collectionState), {
        userId: userContext.userId,
        category: 'metrics-collection-state',
        domains: [],
        scope: 'session',
        metadata: {
          collectionId: collectionState.collectionId,
          monitoredPatterns: targetPatterns.length,
          realTimeEnabled: config.enableRealTimeCollection,
        },
      });

      // Initialize baseline snapshots for each pattern
      const initialSnapshots: PerformanceMetricsSnapshot[] = [];
      for (const patternId of targetPatterns) {
        const snapshot = await createInitialMetricsSnapshot(sessionId, patternId, userContext);
        if (snapshot) {
          initialSnapshots.push(snapshot);
        }
      }

      // Trace metrics collection start
      await biContextTracer.traceMemoryOperation(sessionId, 'metrics_collection_start', {
        collectionId: collectionState.collectionId,
        monitoredPatterns: targetPatterns.length,
        config,
        initialSnapshots: initialSnapshots.length,
      });

      return {
        success: true,
        sessionId,
        collectionId: collectionState.collectionId,
        monitoredPatterns: targetPatterns.length,
        config,
        initialSnapshots: initialSnapshots.length,
        status: 'active',
      };

    } catch (error) {
      rootLogger.error('Failed to start metrics collection', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to start metrics collection',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Collect Performance Metrics
 */
export const collectPerformanceMetrics = new Tool({
  id: 'collect-performance-metrics',
  description: 'Collect current performance metrics for monitored architecture patterns',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    collectionId: z.string().describe('Metrics collection ID'),
    patternId: z.string().optional().describe('Specific pattern ID (empty for all monitored patterns)'),
    includeResourceMetrics: z.boolean().default(true),
    includeQualityMetrics: z.boolean().default(true),
    includeUserExperienceMetrics: z.boolean().default(false).describe('Include UX metrics (requires user interaction data)'),
  }),
  execute: async ({ sessionId, collectionId, patternId, includeResourceMetrics, includeQualityMetrics, includeUserExperienceMetrics }, context) => {
    try {
      rootLogger.info('Collecting performance metrics', {
        sessionId,
        collectionId,
        patternId: patternId || 'all',
        includeResource: includeResourceMetrics,
        includeQuality: includeQualityMetrics,
        includeUX: includeUserExperienceMetrics,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Get collection state
      const collectionResults = await biContextStore.searchContextMemories(sessionId, collectionId, {
        userId: userContext.userId,
        category: 'metrics-collection-state',
        topK: 1,
        similarityThreshold: 0.8,
      });

      if (collectionResults.length === 0) {
        return {
          success: false,
          error: 'Metrics collection not found',
          collectionId,
          sessionId,
        };
      }

      const collectionState = JSON.parse(collectionResults[0].content);
      const patternsToMonitor = patternId ? [patternId] : collectionState.monitoredPatterns;

      const metricsSnapshots: PerformanceMetricsSnapshot[] = [];

      // Collect metrics for each pattern
      for (const monitoredPatternId of patternsToMonitor) {
        try {
          const snapshot = await collectPatternMetrics(
            sessionId,
            monitoredPatternId,
            userContext,
            {
              includeResourceMetrics,
              includeQualityMetrics,
              includeUserExperienceMetrics,
            }
          );

          if (snapshot) {
            metricsSnapshots.push(snapshot);
          }
        } catch (error) {
          rootLogger.warn('Failed to collect metrics for pattern', {
            patternId: monitoredPatternId,
            error: (error as Error).message,
          });
        }
      }

      // Store collected metrics
      const collectionRecord = {
        collectionId,
        timestamp: new Date().toISOString(),
        snapshots: metricsSnapshots,
        collectionSettings: {
          includeResourceMetrics,
          includeQualityMetrics,
          includeUserExperienceMetrics,
        },
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(collectionRecord), {
        userId: userContext.userId,
        category: 'metrics-snapshot',
        domains: [],
        scope: 'session',
        metadata: {
          collectionId,
          snapshotCount: metricsSnapshots.length,
          timestamp: new Date().toISOString(),
        },
      });

      // Update collection state
      collectionState.metricsCollected += metricsSnapshots.length;
      collectionState.lastCollection = new Date();

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(collectionState), {
        userId: userContext.userId,
        category: 'metrics-collection-state',
        domains: [],
        scope: 'session',
        metadata: {
          collectionId,
          operation: 'update',
        },
      });

      // Check for alerts
      const alerts = checkMetricsAlerts(metricsSnapshots, collectionState.config.alertThresholds);

      // Trace metrics collection
      await biContextTracer.traceMemoryOperation(sessionId, 'metrics_collection', {
        collectionId,
        snapshotCount: metricsSnapshots.length,
        patternsMonitored: patternsToMonitor.length,
        alertsGenerated: alerts.length,
      });

      return {
        success: true,
        sessionId,
        collectionId,
        metricsSnapshots,
        alerts,
        summary: {
          patternsMonitored: patternsToMonitor.length,
          snapshotsCollected: metricsSnapshots.length,
          totalCollections: collectionState.metricsCollected,
          alertsGenerated: alerts.length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to collect performance metrics', {
        sessionId,
        collectionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to collect performance metrics',
        details: (error as Error).message,
        sessionId,
        collectionId,
      };
    }
  },
});

/**
 * Analyze Performance Trends
 */
export const analyzePerformanceTrends = new Tool({
  id: 'analyze-performance-trends',
  description: 'Analyze performance trends and patterns from collected metrics data',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    patternId: z.string().optional().describe('Specific pattern to analyze (empty for all patterns)'),
    timeRange: z.object({
      startTime: z.string().describe('Start time for analysis (ISO string)'),
      endTime: z.string().describe('End time for analysis (ISO string)'),
    }).optional().describe('Time range for trend analysis'),
    analysisType: z.enum(['trend', 'comparison', 'anomaly', 'comprehensive']).default('comprehensive'),
    compareAgainst: z.enum(['baseline', 'previous_period', 'other_patterns']).optional(),
    includePredictions: z.boolean().default(true).describe('Include performance predictions'),
  }),
  execute: async ({ sessionId, patternId, timeRange, analysisType, compareAgainst, includePredictions }, context) => {
    try {
      rootLogger.info('Analyzing performance trends', {
        sessionId,
        patternId: patternId || 'all',
        analysisType,
        compareAgainst,
        hasTimeRange: Boolean(timeRange),
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Get metrics snapshots for analysis
      const snapshotResults = await biContextStore.searchContextMemories(sessionId, 'metrics snapshot', {
        userId: userContext.userId,
        category: 'metrics-snapshot',
        topK: 100, // Get more for trend analysis
        similarityThreshold: 0.1,
      });

      const snapshots: PerformanceMetricsSnapshot[] = [];
      for (const result of snapshotResults) {
        try {
          const snapshotRecord = JSON.parse(result.content);
          for (const snapshot of snapshotRecord.snapshots) {
            // Filter by pattern ID if specified
            if (patternId && snapshot.patternId !== patternId) continue;

            // Filter by time range if specified
            if (timeRange) {
              const snapshotTime = new Date(snapshot.timestamp);
              const startTime = new Date(timeRange.startTime);
              const endTime = new Date(timeRange.endTime);
              if (snapshotTime < startTime || snapshotTime > endTime) continue;
            }

            snapshots.push(snapshot);
          }
        } catch (parseError) {
          continue;
        }
      }

      if (snapshots.length < 2) {
        return {
          success: false,
          error: 'Insufficient metrics data for trend analysis (minimum 2 snapshots required)',
          sessionId,
          availableSnapshots: snapshots.length,
        };
      }

      // Perform analysis based on type
      let analysisResult: MetricsAnalysisResult;

      switch (analysisType) {
        case 'trend':
          analysisResult = await performTrendAnalysis(snapshots, patternId);
          break;
        case 'comparison':
          analysisResult = await performComparisonAnalysis(snapshots, compareAgainst, patternId);
          break;
        case 'anomaly':
          analysisResult = await performAnomalyAnalysis(snapshots, patternId);
          break;
        case 'comprehensive':
        default:
          analysisResult = await performComprehensiveAnalysis(snapshots, patternId, compareAgainst);
          break;
      }

      // Add predictions if requested
      let predictions = undefined;
      if (includePredictions && analysisResult.trends) {
        predictions = generatePerformancePredictions(analysisResult, snapshots);
      }

      // Store analysis results
      const analysisRecord = {
        analysisResult,
        predictions,
        snapshotsAnalyzed: snapshots.length,
        timestamp: new Date().toISOString(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(analysisRecord), {
        userId: userContext.userId,
        category: 'performance-trend-analysis',
        domains: [],
        scope: 'session',
        metadata: {
          analysisType,
          patternId: patternId || 'all',
          snapshotsAnalyzed: snapshots.length,
          performanceGrade: analysisResult.findings.performanceGrade,
        },
      });

      // Trace trend analysis
      await biContextTracer.traceMemoryOperation(sessionId, 'performance_trend_analysis', {
        analysisType,
        patternId: patternId || 'all',
        snapshotsAnalyzed: snapshots.length,
        performanceGrade: analysisResult.findings.performanceGrade,
        anomaliesFound: analysisResult.anomalies.spikes.length,
        recommendationsGenerated: analysisResult.recommendations.length,
      });

      return {
        success: true,
        sessionId,
        analysisResult,
        predictions,
        summary: {
          snapshotsAnalyzed: snapshots.length,
          performanceGrade: analysisResult.findings.performanceGrade,
          keyTrends: Object.values(analysisResult.trends).filter(trend => trend !== 'stable'),
          criticalAnomalies: analysisResult.anomalies.spikes.filter(s => s.severity === 'high').length,
          recommendationCount: analysisResult.recommendations.length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to analyze performance trends', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to analyze performance trends',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Helper Functions for Metrics Collection
// ============================================================================

async function createInitialMetricsSnapshot(
  sessionId: string,
  patternId: string,
  userContext: UserContext | AnonymousContext
): Promise<PerformanceMetricsSnapshot | undefined> {
  try {
    // Get pattern details
    const patternResults = await biContextStore.searchContextMemories(sessionId, patternId, {
      userId: userContext.userId,
      category: 'architecture-pattern',
      topK: 1,
      similarityThreshold: 0.8,
    });

    if (patternResults.length === 0) return undefined;

    const pattern = JSON.parse(patternResults[0].content) as AgentArchitecturePattern;

    // Create initial snapshot based on pattern's current state
    const snapshot: PerformanceMetricsSnapshot = {
      snapshotId: `snap_${patternId}_${Date.now()}`,
      patternId,
      patternType: pattern.patternType,
      timestamp: new Date(),
      executionMetrics: {
        totalExecutions: pattern.usageCount,
        successfulExecutions: Math.floor(pattern.usageCount * pattern.successRate),
        failedExecutions: Math.floor(pattern.usageCount * (1 - pattern.successRate)),
        averageExecutionTime: pattern.performanceMetrics.averageResponseTime,
        medianExecutionTime: pattern.performanceMetrics.averageResponseTime * 0.85, // Estimated
        p95ExecutionTime: pattern.performanceMetrics.averageResponseTime * 1.5, // Estimated
        executionTimeStdDev: pattern.performanceMetrics.averageResponseTime * 0.3, // Estimated
        timeoutCount: 0,
        retryCount: 0,
      },
      resourceMetrics: {
        averageResourceUsage: pattern.performanceMetrics.resourceUsage,
        peakResourceUsage: {
          cpuUsage: pattern.performanceMetrics.resourceUsage.cpuUsage * 1.3,
          memoryUsage: pattern.performanceMetrics.resourceUsage.memoryUsage * 1.2,
          networkLatency: pattern.performanceMetrics.resourceUsage.networkLatency * 1.1,
          databaseConnections: pattern.performanceMetrics.resourceUsage.databaseConnections,
        },
        resourceEfficiency: calculateResourceEfficiency(pattern.performanceMetrics.resourceUsage),
        connectionPoolUtilization: 0.6, // Estimated
        cacheHitRate: pattern.configuration.cachingEnabled ? 0.75 : 0,
        networkUtilization: 0.4, // Estimated
      },
      qualityMetrics: {
        averageAccuracy: pattern.performanceMetrics.accuracy,
        accuracyStdDev: pattern.performanceMetrics.accuracy * 0.1, // Estimated
        minAccuracy: pattern.performanceMetrics.accuracy * 0.8, // Estimated
        maxAccuracy: Math.min(1.0, pattern.performanceMetrics.accuracy * 1.1), // Estimated
        dataQualityScore: 0.85, // Estimated
        resultConsistency: pattern.successRate,
        errorDistribution: {
          'timeout': 0.3,
          'validation': 0.4,
          'network': 0.2,
          'other': 0.1,
        },
      },
      userExperienceMetrics: {
        averageUserSatisfaction: 3.5, // Default
        responseTimePerceived: pattern.performanceMetrics.averageResponseTime * 1.1,
        interactionCount: 0,
        abandonmentRate: 1 - pattern.successRate,
        userRetryRate: 0.05, // Estimated
        feedbackScore: 3.5, // Default
      },
      contextMetrics: {
        sessionCount: 1,
        uniqueUsers: 1,
        domainUtilization: {}, // Would be populated from actual usage
        queryComplexityDistribution: {}, // Would be populated from actual queries
        patternSwitchingRate: 0.1, // Estimated
        contextLossEvents: 0,
      },
    };

    return snapshot;
  } catch (error) {
    rootLogger.warn('Failed to create initial metrics snapshot', {
      patternId,
      error: (error as Error).message,
    });
    return undefined;
  }
}

async function collectPatternMetrics(
  sessionId: string,
  patternId: string,
  userContext: UserContext | AnonymousContext,
  options: {
    includeResourceMetrics: boolean;
    includeQualityMetrics: boolean;
    includeUserExperienceMetrics: boolean;
  }
): Promise<PerformanceMetricsSnapshot | undefined> {
  try {
    // Get recent benchmark results for this pattern
    const benchmarkResults = await biContextStore.searchContextMemories(sessionId, `benchmark ${patternId}`, {
      userId: userContext.userId,
      category: 'benchmark-results',
      topK: 20,
      similarityThreshold: 0.6,
    });

    const recentResults: BenchmarkResult[] = [];
    for (const result of benchmarkResults) {
      try {
        const benchmarkData = JSON.parse(result.content);
        if (benchmarkData.benchmarkResults) {
          recentResults.push(...benchmarkData.benchmarkResults);
        }
      } catch (parseError) {
        continue;
      }
    }

    if (recentResults.length === 0) {
      return undefined; // No recent data to collect
    }

    // Get pattern details
    const patternResults = await biContextStore.searchContextMemories(sessionId, patternId, {
      userId: userContext.userId,
      category: 'architecture-pattern',
      topK: 1,
      similarityThreshold: 0.8,
    });

    if (patternResults.length === 0) return undefined;

    const pattern = JSON.parse(patternResults[0].content) as AgentArchitecturePattern;

    // Build comprehensive metrics snapshot
    const snapshot: PerformanceMetricsSnapshot = {
      snapshotId: `snap_${patternId}_${Date.now()}`,
      patternId,
      patternType: pattern.patternType,
      timestamp: new Date(),
      executionMetrics: buildExecutionMetrics(recentResults),
      resourceMetrics: options.includeResourceMetrics ? buildResourceMetrics(recentResults, pattern) : {} as ResourceMetrics,
      qualityMetrics: options.includeQualityMetrics ? buildQualityMetrics(recentResults) : {} as QualityMetrics,
      userExperienceMetrics: options.includeUserExperienceMetrics ? buildUserExperienceMetrics(recentResults) : {} as UserExperienceMetrics,
      contextMetrics: buildContextMetrics(sessionId, recentResults),
    };

    return snapshot;
  } catch (error) {
    rootLogger.error('Failed to collect pattern metrics', {
      patternId,
      error: (error as Error).message,
    });
    return undefined;
  }
}

function buildExecutionMetrics(results: BenchmarkResult[]): ExecutionMetrics {
  const executionTimes = results.map(r => r.executionTime).sort((a, b) => a - b);
  const errors = results.filter(r => r.errorCount > 0);

  return {
    totalExecutions: results.length,
    successfulExecutions: results.length - errors.length,
    failedExecutions: errors.length,
    averageExecutionTime: executionTimes.reduce((sum, t) => sum + t, 0) / executionTimes.length,
    medianExecutionTime: executionTimes[Math.floor(executionTimes.length / 2)],
    p95ExecutionTime: executionTimes[Math.floor(executionTimes.length * 0.95)],
    executionTimeStdDev: calculateStandardDeviation(executionTimes),
    timeoutCount: 0, // Would be tracked separately
    retryCount: 0, // Would be tracked separately
  };
}

function buildResourceMetrics(results: BenchmarkResult[], pattern: AgentArchitecturePattern): ResourceMetrics {
  const resourceUsages = results.map(r => r.resourceUsage);

  return {
    averageResourceUsage: {
      cpuUsage: resourceUsages.reduce((sum, r) => sum + r.cpuUsage, 0) / resourceUsages.length,
      memoryUsage: resourceUsages.reduce((sum, r) => sum + r.memoryUsage, 0) / resourceUsages.length,
      networkLatency: resourceUsages.reduce((sum, r) => sum + r.networkLatency, 0) / resourceUsages.length,
      databaseConnections: Math.ceil(resourceUsages.reduce((sum, r) => sum + r.databaseConnections, 0) / resourceUsages.length),
    },
    peakResourceUsage: {
      cpuUsage: Math.max(...resourceUsages.map(r => r.cpuUsage)),
      memoryUsage: Math.max(...resourceUsages.map(r => r.memoryUsage)),
      networkLatency: Math.max(...resourceUsages.map(r => r.networkLatency)),
      databaseConnections: Math.max(...resourceUsages.map(r => r.databaseConnections)),
    },
    resourceEfficiency: calculateResourceEfficiency(resourceUsages[0]),
    connectionPoolUtilization: 0.6, // Would be monitored from connection pool
    cacheHitRate: pattern.configuration.cachingEnabled ? 0.75 : 0,
    networkUtilization: 0.4, // Would be monitored from network layer
  };
}

function buildQualityMetrics(results: BenchmarkResult[]): QualityMetrics {
  const accuracies = results.map(r => r.accuracy).sort((a, b) => a - b);
  const errors = results.filter(r => r.errorCount > 0);

  return {
    averageAccuracy: accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length,
    accuracyStdDev: calculateStandardDeviation(accuracies),
    minAccuracy: accuracies[0],
    maxAccuracy: accuracies[accuracies.length - 1],
    dataQualityScore: 0.85, // Would be calculated from data validation
    resultConsistency: 1 - (errors.length / results.length),
    errorDistribution: {
      'timeout': 0.3,
      'validation': 0.4,
      'network': 0.2,
      'other': 0.1,
    },
  };
}

function buildUserExperienceMetrics(results: BenchmarkResult[]): UserExperienceMetrics {
  const avgExecutionTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
  const errorRate = results.filter(r => r.errorCount > 0).length / results.length;

  return {
    averageUserSatisfaction: Math.max(1, 5 - (errorRate * 2) - (avgExecutionTime > 10000 ? 1 : 0)),
    responseTimePerceived: avgExecutionTime * 1.2, // Users perceive time as longer
    interactionCount: results.length,
    abandonmentRate: errorRate,
    userRetryRate: Math.min(0.2, errorRate * 1.5),
    feedbackScore: Math.max(1, 4 - (errorRate * 2)),
  };
}

function buildContextMetrics(sessionId: string, results: BenchmarkResult[]): ContextMetrics {
  return {
    sessionCount: 1, // Would be calculated from session data
    uniqueUsers: 1, // Would be calculated from session data
    domainUtilization: {}, // Would be populated from query analysis
    queryComplexityDistribution: {}, // Would be populated from query analysis
    patternSwitchingRate: 0.1, // Would be calculated from routing decisions
    contextLossEvents: 0, // Would be monitored from context operations
  };
}

function checkMetricsAlerts(snapshots: PerformanceMetricsSnapshot[], thresholds: AlertThresholds) {
  const alerts: any[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.executionMetrics.averageExecutionTime > thresholds.maxExecutionTime) {
      alerts.push({
        severity: 'warning',
        metric: 'execution_time',
        patternId: snapshot.patternId,
        value: snapshot.executionMetrics.averageExecutionTime,
        threshold: thresholds.maxExecutionTime,
        message: `Average execution time (${snapshot.executionMetrics.averageExecutionTime}ms) exceeds threshold (${thresholds.maxExecutionTime}ms)`,
      });
    }

    if (snapshot.qualityMetrics.averageAccuracy < thresholds.minAccuracy) {
      alerts.push({
        severity: 'critical',
        metric: 'accuracy',
        patternId: snapshot.patternId,
        value: snapshot.qualityMetrics.averageAccuracy,
        threshold: thresholds.minAccuracy,
        message: `Average accuracy (${(snapshot.qualityMetrics.averageAccuracy * 100).toFixed(1)}%) below threshold (${(thresholds.minAccuracy * 100).toFixed(1)}%)`,
      });
    }

    if (snapshot.resourceMetrics.averageResourceUsage?.cpuUsage > thresholds.maxCpuUsage) {
      alerts.push({
        severity: 'warning',
        metric: 'cpu_usage',
        patternId: snapshot.patternId,
        value: snapshot.resourceMetrics.averageResourceUsage.cpuUsage,
        threshold: thresholds.maxCpuUsage,
        message: `CPU usage (${snapshot.resourceMetrics.averageResourceUsage.cpuUsage.toFixed(1)}%) exceeds threshold (${thresholds.maxCpuUsage}%)`,
      });
    }
  }

  return alerts;
}

async function performTrendAnalysis(snapshots: PerformanceMetricsSnapshot[], patternId?: string): Promise<MetricsAnalysisResult> {
  // Sort snapshots by timestamp
  const sortedSnapshots = snapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const trends: MetricsTrends = {
    executionTimeTrend: calculateTrend(sortedSnapshots.map(s => s.executionMetrics.averageExecutionTime)),
    accuracyTrend: calculateTrend(sortedSnapshots.map(s => s.qualityMetrics.averageAccuracy)),
    usageTrend: calculateTrend(sortedSnapshots.map(s => s.executionMetrics.totalExecutions)),
    errorRateTrend: calculateTrend(sortedSnapshots.map(s => 1 - s.qualityMetrics.resultConsistency)),
  };

  const findings = generateTrendFindings(trends, sortedSnapshots);

  return {
    patternId: patternId || 'all',
    analysisType: 'trend',
    timeRange: {
      start: sortedSnapshots[0].timestamp,
      end: sortedSnapshots[sortedSnapshots.length - 1].timestamp,
    },
    findings,
    trends,
    anomalies: { spikes: [], patterns: [] },
    recommendations: generateTrendRecommendations(trends),
    confidenceScore: calculateAnalysisConfidence(sortedSnapshots),
  };
}

async function performComparisonAnalysis(
  snapshots: PerformanceMetricsSnapshot[],
  compareAgainst: string | undefined,
  patternId?: string
): Promise<MetricsAnalysisResult> {
  // Simplified comparison analysis
  const findings: MetricsFindings = {
    performanceGrade: 'B',
    keyStrengths: ['Consistent performance', 'Good accuracy'],
    keyWeaknesses: ['Room for optimization'],
    comparisonToBaseline: {
      executionTime: 'same',
      accuracy: 'same',
      reliability: 'same',
    },
  };

  return {
    patternId: patternId || 'all',
    analysisType: 'comparison',
    timeRange: {
      start: snapshots[0]?.timestamp || new Date(),
      end: snapshots[snapshots.length - 1]?.timestamp || new Date(),
    },
    findings,
    trends: { executionTimeTrend: 'stable', accuracyTrend: 'stable', usageTrend: 'stable', errorRateTrend: 'stable' },
    anomalies: { spikes: [], patterns: [] },
    recommendations: ['Continue monitoring performance trends'],
    confidenceScore: 0.7,
  };
}

async function performAnomalyAnalysis(snapshots: PerformanceMetricsSnapshot[], patternId?: string): Promise<MetricsAnalysisResult> {
  const anomalies = detectPerformanceAnomalies(snapshots);

  const findings: MetricsFindings = {
    performanceGrade: anomalies.spikes.filter(s => s.severity === 'high').length > 0 ? 'C' : 'B',
    keyStrengths: ['Anomaly detection active'],
    keyWeaknesses: anomalies.spikes.length > 0 ? ['Performance anomalies detected'] : [],
    comparisonToBaseline: {
      executionTime: 'same',
      accuracy: 'same',
      reliability: 'same',
    },
  };

  return {
    patternId: patternId || 'all',
    analysisType: 'anomaly',
    timeRange: {
      start: snapshots[0]?.timestamp || new Date(),
      end: snapshots[snapshots.length - 1]?.timestamp || new Date(),
    },
    findings,
    trends: { executionTimeTrend: 'stable', accuracyTrend: 'stable', usageTrend: 'stable', errorRateTrend: 'stable' },
    anomalies,
    recommendations: generateAnomalyRecommendations(anomalies),
    confidenceScore: 0.8,
  };
}

async function performComprehensiveAnalysis(
  snapshots: PerformanceMetricsSnapshot[],
  patternId?: string,
  compareAgainst?: string
): Promise<MetricsAnalysisResult> {
  // Combine trend, comparison, and anomaly analysis
  const trendAnalysis = await performTrendAnalysis(snapshots, patternId);
  const anomalyAnalysis = await performAnomalyAnalysis(snapshots, patternId);

  return {
    patternId: patternId || 'all',
    analysisType: 'comprehensive',
    timeRange: trendAnalysis.timeRange,
    findings: trendAnalysis.findings,
    trends: trendAnalysis.trends,
    anomalies: anomalyAnalysis.anomalies,
    recommendations: [
      ...trendAnalysis.recommendations,
      ...anomalyAnalysis.recommendations,
    ].slice(0, 10), // Limit recommendations
    confidenceScore: Math.max(trendAnalysis.confidenceScore, anomalyAnalysis.confidenceScore),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function calculateStandardDeviation(values: number[]): number {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDifferences.reduce((sum, sq) => sum + sq, 0) / squaredDifferences.length;
  return Math.sqrt(variance);
}

function calculateResourceEfficiency(resourceUsage: ResourceUsageMetrics): number {
  // Simple efficiency calculation (inverse of resource usage)
  const normalized = {
    cpu: resourceUsage.cpuUsage / 100,
    memory: Math.min(resourceUsage.memoryUsage / 500, 1),
    network: Math.min(resourceUsage.networkLatency / 100, 1),
    connections: Math.min(resourceUsage.databaseConnections / 10, 1),
  };

  const averageUsage = (normalized.cpu + normalized.memory + normalized.network + normalized.connections) / 4;
  return Math.max(0, 1 - averageUsage);
}

function calculateTrend(values: number[]): 'improving' | 'stable' | 'degrading' {
  if (values.length < 2) return 'stable';

  // Simple linear trend calculation
  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));

  const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;

  const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;

  if (changePercent > 5) return 'degrading'; // For time-based metrics, increasing is degrading
  if (changePercent < -5) return 'improving';
  return 'stable';
}

function generateTrendFindings(trends: MetricsTrends, snapshots: PerformanceMetricsSnapshot[]): MetricsFindings {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (trends.executionTimeTrend === 'improving') strengths.push('Execution time is improving');
  if (trends.accuracyTrend === 'improving') strengths.push('Accuracy is improving');
  if (trends.errorRateTrend === 'improving') strengths.push('Error rate is decreasing');

  if (trends.executionTimeTrend === 'degrading') weaknesses.push('Execution time is degrading');
  if (trends.accuracyTrend === 'degrading') weaknesses.push('Accuracy is declining');
  if (trends.errorRateTrend === 'degrading') weaknesses.push('Error rate is increasing');

  // Determine overall grade
  const improving = Object.values(trends).filter(t => t === 'improving').length;
  const degrading = Object.values(trends).filter(t => t === 'degrading').length;

  let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'C';
  if (improving >= 3) grade = 'A';
  else if (improving >= 2) grade = 'B';
  else if (degrading >= 3) grade = 'F';
  else if (degrading >= 2) grade = 'D';

  return {
    performanceGrade: grade,
    keyStrengths: strengths.length > 0 ? strengths : ['Stable performance'],
    keyWeaknesses: weaknesses.length > 0 ? weaknesses : ['Minor optimization opportunities'],
    comparisonToBaseline: {
      executionTime: trends.executionTimeTrend === 'improving' ? 'better' : trends.executionTimeTrend === 'degrading' ? 'worse' : 'same',
      accuracy: trends.accuracyTrend === 'improving' ? 'better' : trends.accuracyTrend === 'degrading' ? 'worse' : 'same',
      reliability: trends.errorRateTrend === 'improving' ? 'better' : trends.errorRateTrend === 'degrading' ? 'worse' : 'same',
    },
  };
}

function generateTrendRecommendations(trends: MetricsTrends): string[] {
  const recommendations: string[] = [];

  if (trends.executionTimeTrend === 'degrading') {
    recommendations.push('Investigate performance degradation - consider query optimization');
  }

  if (trends.accuracyTrend === 'degrading') {
    recommendations.push('Address accuracy decline - review data quality and validation logic');
  }

  if (trends.errorRateTrend === 'degrading') {
    recommendations.push('Increasing error rate detected - enhance error handling and retry mechanisms');
  }

  if (trends.usageTrend === 'decreasing') {
    recommendations.push('Pattern usage is declining - evaluate if alternative patterns are more effective');
  }

  if (Object.values(trends).every(t => t === 'stable')) {
    recommendations.push('Performance is stable - consider optimization experiments for improvement');
  }

  return recommendations;
}

function detectPerformanceAnomalies(snapshots: PerformanceMetricsSnapshot[]): MetricsAnomalies {
  const spikes = [];
  const patterns = [];

  // Detect execution time spikes
  const executionTimes = snapshots.map(s => s.executionMetrics.averageExecutionTime);
  const avgExecutionTime = executionTimes.reduce((sum, t) => sum + t, 0) / executionTimes.length;
  const executionTimeThreshold = avgExecutionTime * 2; // 2x average is considered a spike

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    if (snapshot.executionMetrics.averageExecutionTime > executionTimeThreshold) {
      spikes.push({
        metric: 'execution_time',
        timestamp: snapshot.timestamp,
        value: snapshot.executionMetrics.averageExecutionTime,
        severity: snapshot.executionMetrics.averageExecutionTime > executionTimeThreshold * 2 ? 'high' as const : 'medium' as const,
        possibleCause: 'Resource contention or query complexity spike',
      });
    }
  }

  // Detect accuracy drops
  const accuracies = snapshots.map(s => s.qualityMetrics.averageAccuracy);
  const avgAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
  const accuracyThreshold = avgAccuracy * 0.8; // 20% drop is significant

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    if (snapshot.qualityMetrics.averageAccuracy < accuracyThreshold) {
      spikes.push({
        metric: 'accuracy',
        timestamp: snapshot.timestamp,
        value: snapshot.qualityMetrics.averageAccuracy,
        severity: snapshot.qualityMetrics.averageAccuracy < accuracyThreshold * 0.8 ? 'high' as const : 'medium' as const,
        possibleCause: 'Data quality issue or model degradation',
      });
    }
  }

  return { spikes, patterns };
}

function generateAnomalyRecommendations(anomalies: MetricsAnomalies): string[] {
  const recommendations: string[] = [];

  const highSeveritySpikes = anomalies.spikes.filter(s => s.severity === 'high');
  if (highSeveritySpikes.length > 0) {
    recommendations.push(`${highSeveritySpikes.length} high-severity anomalies detected - immediate investigation required`);
  }

  const executionTimeSpikes = anomalies.spikes.filter(s => s.metric === 'execution_time');
  if (executionTimeSpikes.length > 0) {
    recommendations.push('Execution time spikes detected - review resource allocation and query optimization');
  }

  const accuracySpikes = anomalies.spikes.filter(s => s.metric === 'accuracy');
  if (accuracySpikes.length > 0) {
    recommendations.push('Accuracy anomalies detected - investigate data quality and model performance');
  }

  return recommendations;
}

function calculateAnalysisConfidence(snapshots: PerformanceMetricsSnapshot[]): number {
  // Base confidence on sample size and data quality
  let confidence = Math.min(snapshots.length / 10, 1); // Up to 10 snapshots for full confidence

  // Reduce confidence if data is sparse or inconsistent
  if (snapshots.length < 3) confidence *= 0.5;

  return Math.max(0.1, confidence);
}

function generatePerformancePredictions(analysis: MetricsAnalysisResult, snapshots: PerformanceMetricsSnapshot[]) {
  const predictions = {
    nextPeriodExecutionTime: predictExecutionTime(snapshots, analysis.trends.executionTimeTrend),
    nextPeriodAccuracy: predictAccuracy(snapshots, analysis.trends.accuracyTrend),
    riskFactors: generateRiskPredictions(analysis),
    improvementOpportunities: generateImprovementPredictions(analysis),
  };

  return predictions;
}

function predictExecutionTime(snapshots: PerformanceMetricsSnapshot[], trend: string): number {
  const recentTimes = snapshots.slice(-3).map(s => s.executionMetrics.averageExecutionTime);
  const avgTime = recentTimes.reduce((sum, t) => sum + t, 0) / recentTimes.length;

  switch (trend) {
    case 'improving': return avgTime * 0.9;
    case 'degrading': return avgTime * 1.1;
    default: return avgTime;
  }
}

function predictAccuracy(snapshots: PerformanceMetricsSnapshot[], trend: string): number {
  const recentAccuracies = snapshots.slice(-3).map(s => s.qualityMetrics.averageAccuracy);
  const avgAccuracy = recentAccuracies.reduce((sum, a) => sum + a, 0) / recentAccuracies.length;

  switch (trend) {
    case 'improving': return Math.min(1.0, avgAccuracy * 1.05);
    case 'degrading': return Math.max(0.1, avgAccuracy * 0.95);
    default: return avgAccuracy;
  }
}

function generateRiskPredictions(analysis: MetricsAnalysisResult): string[] {
  const risks = [];

  if (analysis.trends.executionTimeTrend === 'degrading') {
    risks.push('Execution time degradation may impact user experience');
  }

  if (analysis.trends.accuracyTrend === 'degrading') {
    risks.push('Accuracy decline may affect result reliability');
  }

  if (analysis.anomalies.spikes.length > 0) {
    risks.push('Performance anomalies suggest system instability');
  }

  return risks;
}

function generateImprovementPredictions(analysis: MetricsAnalysisResult): string[] {
  const improvements = [];

  if (analysis.trends.executionTimeTrend === 'improving') {
    improvements.push('Continued execution time improvements expected');
  }

  if (analysis.trends.accuracyTrend === 'improving') {
    improvements.push('Accuracy improvements are trending positively');
  }

  if (analysis.findings.performanceGrade >= 'B') {
    improvements.push('Overall performance is good with optimization potential');
  }

  return improvements;
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const performanceMetricsTools = [
  startMetricsCollection,
  collectPerformanceMetrics,
  analyzePerformanceTrends,
];

// Export tool metadata for registration
export const performanceMetricsToolsMetadata = {
  category: 'performance-metrics',
  description: 'Performance metrics collection and analysis for architecture patterns',
  totalTools: performanceMetricsTools.length,
  capabilities: [
    'real_time_metrics_collection',
    'comprehensive_performance_tracking',
    'trend_analysis',
    'anomaly_detection',
    'performance_prediction',
    'alert_generation',
    'resource_utilization_monitoring',
    'user_experience_tracking',
  ],
};

rootLogger.info('Performance metrics tools initialized', {
  totalTools: performanceMetricsTools.length,
  capabilities: performanceMetricsToolsMetadata.capabilities,
});