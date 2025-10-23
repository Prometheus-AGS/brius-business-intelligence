/**
 * Adaptive Routing System for Agent Architecture Patterns
 * Implements intelligent pattern selection based on query characteristics and performance data
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  AgentArchitecturePattern,
  QueryCharacteristics,
  ArchitectureRecommendation,
  PatternType,
  UserContext,
  AnonymousContext,
  DomainType,
  QueryCharacteristicsSchema,
  ArchitectureRecommendationSchema,
} from '../types/context.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Adaptive Routing Core Types
// ============================================================================

export interface RoutingDecision {
  selectedPattern: PatternType;
  confidence: number;
  reasoning: string;
  alternativePatterns: Array<{
    pattern: PatternType;
    score: number;
    reason: string;
  }>;
  routingTime: number;
  queryAnalysis: QueryAnalysisResult;
}

export interface QueryAnalysisResult {
  characteristics: QueryCharacteristics;
  complexity: number;
  estimatedExecutionTime: number;
  resourceRequirements: {
    cpu: 'low' | 'medium' | 'high';
    memory: 'low' | 'medium' | 'high';
    network: 'low' | 'medium' | 'high';
  };
  riskFactors: string[];
  optimizationOpportunities: string[];
}

export interface RoutingRule {
  ruleId: string;
  name: string;
  condition: RoutingCondition;
  targetPattern: PatternType;
  priority: number;
  isActive: boolean;
}

export interface RoutingCondition {
  complexityRange?: [number, number];
  domainCountRange?: [number, number];
  dataVolume?: ('small' | 'medium' | 'large')[];
  realTimeRequirement?: boolean;
  accuracyRequirement?: ('standard' | 'high' | 'critical')[];
  interactivityLevel?: ('low' | 'medium' | 'high')[];
}

export interface AdaptiveRoutingConfig {
  enableLearning: boolean;
  fallbackPattern: PatternType;
  confidenceThreshold: number;
  performanceWeights: {
    executionTime: number;
    accuracy: number;
    resourceUsage: number;
    reliability: number;
  };
  routingRules: RoutingRule[];
}

// ============================================================================
// Query Analysis and Pattern Selection Tools
// ============================================================================

/**
 * Analyze Query for Routing
 */
export const analyzeQueryForRouting = new Tool({
  id: 'analyze-query-for-routing',
  description: 'Analyze query characteristics to determine optimal routing strategy',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    query: z.string().describe('Query to analyze for routing'),
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).describe('Domains involved in query'),
    userPreferences: z.object({
      prioritizeSpeed: z.boolean().default(false).describe('Prioritize execution speed over accuracy'),
      prioritizeAccuracy: z.boolean().default(false).describe('Prioritize accuracy over execution speed'),
      allowResourceIntensive: z.boolean().default(true).describe('Allow resource-intensive patterns'),
    }).optional(),
    contextHints: z.object({
      previousQueryPattern: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).optional(),
      sessionQueryCount: z.number().optional(),
      avgSessionComplexity: z.number().optional(),
    }).optional(),
  }),
  execute: async ({ sessionId, query, domains, userPreferences, contextHints }, context) => {
    try {
      const startTime = Date.now();

      rootLogger.info('Analyzing query for adaptive routing', {
        sessionId,
        queryLength: query.length,
        domains,
        hasPreferences: Boolean(userPreferences),
        hasHints: Boolean(contextHints),
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Analyze query structure and characteristics
      const queryAnalysis = await performQueryAnalysis(query, domains, userContext);

      // Apply user preferences to modify analysis
      if (userPreferences) {
        queryAnalysis.characteristics = applyUserPreferences(queryAnalysis.characteristics, userPreferences);
      }

      // Apply context hints to refine analysis
      if (contextHints) {
        queryAnalysis.characteristics = applyContextHints(queryAnalysis.characteristics, contextHints);
      }

      // Store analysis results
      const analysisRecord = {
        sessionId,
        query: query.substring(0, 200), // Truncated for privacy
        queryAnalysis,
        userPreferences,
        contextHints,
        timestamp: new Date().toISOString(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(analysisRecord), {
        userId: userContext.userId,
        category: 'query-routing-analysis',
        domains,
        scope: 'session',
        metadata: {
          complexity: queryAnalysis.complexity,
          domainCount: domains.length,
          dataVolume: queryAnalysis.characteristics.dataVolume,
          estimatedTime: queryAnalysis.estimatedExecutionTime,
        },
      });

      const analysisTime = Date.now() - startTime;

      // Trace query analysis
      await biContextTracer.traceQueryExecution(sessionId, {
        query: query.substring(0, 100),
        domains,
        executionTime: analysisTime,
        resultCount: 1, // Analysis result
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
        queryAnalysis,
        processingTime: analysisTime,
        recommendations: generateRoutingRecommendations(queryAnalysis),
      };

    } catch (error) {
      rootLogger.error('Failed to analyze query for routing', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to analyze query for routing',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Execute Adaptive Pattern Selection
 */
export const executeAdaptivePatternSelection = new Tool({
  id: 'execute-adaptive-pattern-selection',
  description: 'Select optimal architecture pattern using adaptive routing logic',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    queryAnalysis: z.any().describe('Query analysis result from analyze-query-for-routing'),
    routingConfig: z.object({
      enableLearning: z.boolean().default(true).describe('Enable learning from execution results'),
      fallbackPattern: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).default('hybrid'),
      confidenceThreshold: z.number().min(0.5).max(1.0).default(0.7).describe('Minimum confidence for pattern selection'),
      performanceWeights: z.object({
        executionTime: z.number().min(0).max(1).default(0.4),
        accuracy: z.number().min(0).max(1).default(0.3),
        resourceUsage: z.number().min(0).max(1).default(0.2),
        reliability: z.number().min(0).max(1).default(0.1),
      }).optional(),
    }).optional(),
    forcePattern: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).optional().describe('Force specific pattern (for testing)'),
  }),
  execute: async ({ sessionId, queryAnalysis, routingConfig, forcePattern }, context) => {
    try {
      const startTime = Date.now();

      rootLogger.info('Executing adaptive pattern selection', {
        sessionId,
        hasQueryAnalysis: Boolean(queryAnalysis),
        forcePattern,
        learningEnabled: routingConfig?.enableLearning,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const config: AdaptiveRoutingConfig = {
        enableLearning: routingConfig?.enableLearning ?? true,
        fallbackPattern: routingConfig?.fallbackPattern || 'hybrid',
        confidenceThreshold: routingConfig?.confidenceThreshold || 0.7,
        performanceWeights: routingConfig?.performanceWeights || {
          executionTime: 0.4,
          accuracy: 0.3,
          resourceUsage: 0.2,
          reliability: 0.1,
        },
        routingRules: await loadRoutingRules(sessionId, userContext),
      };

      // If pattern is forced, return early
      if (forcePattern) {
        const forcedDecision: RoutingDecision = {
          selectedPattern: forcePattern,
          confidence: 1.0,
          reasoning: `Pattern forced to ${forcePattern} for testing purposes`,
          alternativePatterns: [],
          routingTime: Date.now() - startTime,
          queryAnalysis,
        };

        return {
          success: true,
          sessionId,
          routingDecision: forcedDecision,
          forced: true,
        };
      }

      // Get available patterns
      const availablePatterns = await getAvailablePatterns(sessionId, userContext);
      if (availablePatterns.length === 0) {
        return {
          success: false,
          error: 'No architecture patterns available for routing',
          sessionId,
        };
      }

      // Execute routing logic
      const routingDecision = await executeRoutingLogic(
        queryAnalysis,
        availablePatterns,
        config,
        sessionId,
        userContext
      );

      // Store routing decision for learning
      if (config.enableLearning) {
        await storeRoutingDecision(sessionId, userContext, queryAnalysis, routingDecision);
      }

      const routingTime = Date.now() - startTime;
      routingDecision.routingTime = routingTime;

      // Trace routing decision
      await biContextTracer.traceMemoryOperation(sessionId, 'adaptive_routing', {
        selectedPattern: routingDecision.selectedPattern,
        confidence: routingDecision.confidence,
        alternativeCount: routingDecision.alternativePatterns.length,
        routingTime,
        queryComplexity: queryAnalysis.characteristics.complexity,
      });

      return {
        success: true,
        sessionId,
        routingDecision,
        availablePatterns: availablePatterns.length,
        performanceConfig: config.performanceWeights,
      };

    } catch (error) {
      rootLogger.error('Failed to execute adaptive pattern selection', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to execute adaptive pattern selection',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Update Routing Performance
 */
export const updateRoutingPerformance = new Tool({
  id: 'update-routing-performance',
  description: 'Update routing system with execution results for continuous learning',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    routingDecisionId: z.string().describe('Routing decision ID to update'),
    executionResults: z.object({
      success: z.boolean(),
      executionTime: z.number(),
      accuracy: z.number().min(0).max(1),
      resourceUsage: z.object({
        cpuUsage: z.number(),
        memoryUsage: z.number(),
        networkLatency: z.number(),
        databaseConnections: z.number(),
      }),
      errorCount: z.number().min(0),
      userSatisfaction: z.number().min(1).max(5).optional().describe('User satisfaction rating (1-5)'),
    }).describe('Actual execution results'),
    feedback: z.object({
      wasOptimal: z.boolean().describe('Whether the selected pattern was optimal'),
      suggestedImprovement: z.string().optional().describe('Suggested improvement for future routing'),
      contextFactors: z.array(z.string()).optional().describe('Additional context factors to consider'),
    }).optional(),
  }),
  execute: async ({ sessionId, routingDecisionId, executionResults, feedback }, context) => {
    try {
      rootLogger.info('Updating routing performance with execution results', {
        sessionId,
        routingDecisionId,
        success: executionResults.success,
        executionTime: executionResults.executionTime,
        accuracy: executionResults.accuracy,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve original routing decision
      const routingResults = await biContextStore.searchContextMemories(sessionId, routingDecisionId, {
        userId: userContext.userId,
        category: 'routing-decision',
        topK: 1,
        similarityThreshold: 0.8,
      });

      if (routingResults.length === 0) {
        return {
          success: false,
          error: 'Routing decision not found',
          routingDecisionId,
          sessionId,
        };
      }

      const originalDecision = JSON.parse(routingResults[0].content);

      // Calculate performance difference from prediction
      const performanceDelta = calculatePerformanceDelta(
        originalDecision.queryAnalysis.estimatedExecutionTime,
        executionResults.executionTime,
        originalDecision.queryAnalysis.characteristics.accuracyRequirement,
        executionResults.accuracy
      );

      // Update pattern performance metrics
      const patternUpdates = await updatePatternMetrics(
        sessionId,
        userContext,
        originalDecision.selectedPattern,
        executionResults,
        performanceDelta
      );

      // Learn from routing decision
      const learningInsights = await processRoutingLearning(
        originalDecision,
        executionResults,
        feedback,
        performanceDelta
      );

      // Update routing rules if significant insights were found
      if (learningInsights.significantInsights.length > 0) {
        await updateRoutingRules(sessionId, userContext, learningInsights);
      }

      // Create performance update record
      const updateRecord = {
        routingDecisionId,
        originalDecision,
        executionResults,
        performanceDelta,
        learningInsights,
        feedback,
        timestamp: new Date().toISOString(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(updateRecord), {
        userId: userContext.userId,
        category: 'routing-performance-update',
        domains: [],
        scope: 'session',
        metadata: {
          routingDecisionId,
          selectedPattern: originalDecision.selectedPattern,
          wasOptimal: feedback?.wasOptimal,
          performanceImprovement: performanceDelta.improvement,
          significantLearning: learningInsights.significantInsights.length > 0,
        },
      });

      // Trace performance update
      await biContextTracer.traceMemoryOperation(sessionId, 'routing_performance_update', {
        routingDecisionId,
        selectedPattern: originalDecision.selectedPattern,
        actualVsPredicted: {
          executionTime: performanceDelta.executionTimeDelta,
          accuracy: performanceDelta.accuracyDelta,
        },
        wasOptimal: feedback?.wasOptimal,
        learningApplied: learningInsights.significantInsights.length > 0,
      });

      return {
        success: true,
        sessionId,
        routingDecisionId,
        performanceDelta,
        learningInsights,
        patternUpdates,
        recommendations: generateLearningRecommendations(learningInsights, performanceDelta),
      };

    } catch (error) {
      rootLogger.error('Failed to update routing performance', {
        sessionId,
        routingDecisionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to update routing performance',
        details: (error as Error).message,
        sessionId,
        routingDecisionId,
      };
    }
  },
});

/**
 * Configure Adaptive Routing
 */
export const configureAdaptiveRouting = new Tool({
  id: 'configure-adaptive-routing',
  description: 'Configure adaptive routing system with custom rules and weights',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    routingConfig: z.object({
      enableLearning: z.boolean().default(true),
      fallbackPattern: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']).default('hybrid'),
      confidenceThreshold: z.number().min(0.5).max(1.0).default(0.7),
      performanceWeights: z.object({
        executionTime: z.number().min(0).max(1).default(0.4),
        accuracy: z.number().min(0).max(1).default(0.3),
        resourceUsage: z.number().min(0).max(1).default(0.2),
        reliability: z.number().min(0).max(1).default(0.1),
      }).optional(),
      customRules: z.array(z.object({
        name: z.string(),
        condition: z.any(), // RoutingCondition
        targetPattern: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']),
        priority: z.number().min(1).max(100).default(50),
        isActive: z.boolean().default(true),
      })).optional(),
    }).describe('Routing configuration'),
    resetToDefaults: z.boolean().default(false).describe('Reset to default configuration'),
  }),
  execute: async ({ sessionId, routingConfig, resetToDefaults }, context) => {
    try {
      rootLogger.info('Configuring adaptive routing system', {
        sessionId,
        resetToDefaults,
        hasCustomRules: Boolean(routingConfig.customRules),
        learningEnabled: routingConfig.enableLearning,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      let finalConfig: AdaptiveRoutingConfig;

      if (resetToDefaults) {
        finalConfig = createDefaultRoutingConfig();
      } else {
        finalConfig = {
          enableLearning: routingConfig.enableLearning,
          fallbackPattern: routingConfig.fallbackPattern,
          confidenceThreshold: routingConfig.confidenceThreshold,
          performanceWeights: routingConfig.performanceWeights || {
            executionTime: 0.4,
            accuracy: 0.3,
            resourceUsage: 0.2,
            reliability: 0.1,
          },
          routingRules: await createRoutingRules(routingConfig.customRules),
        };
      }

      // Validate weights sum to 1.0
      const weightSum = Object.values(finalConfig.performanceWeights).reduce((sum, w) => sum + w, 0);
      if (Math.abs(weightSum - 1.0) > 0.01) {
        return {
          success: false,
          error: 'Performance weights must sum to 1.0',
          weightSum,
          sessionId,
        };
      }

      // Store routing configuration
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(finalConfig), {
        userId: userContext.userId,
        category: 'adaptive-routing-config',
        domains: [],
        scope: 'session',
        metadata: {
          configVersion: Date.now(),
          enableLearning: finalConfig.enableLearning,
          fallbackPattern: finalConfig.fallbackPattern,
          customRulesCount: finalConfig.routingRules.length,
        },
      });

      // Trace configuration update
      await biContextTracer.traceMemoryOperation(sessionId, 'routing_configuration', {
        operation: 'configure',
        enableLearning: finalConfig.enableLearning,
        fallbackPattern: finalConfig.fallbackPattern,
        confidenceThreshold: finalConfig.confidenceThreshold,
        customRulesCount: finalConfig.routingRules.length,
      });

      return {
        success: true,
        sessionId,
        routingConfig: finalConfig,
        validation: {
          weightsValid: true,
          rulesValid: finalConfig.routingRules.length >= 0,
          configComplete: true,
        },
        summary: {
          totalRules: finalConfig.routingRules.length,
          activeRules: finalConfig.routingRules.filter(r => r.isActive).length,
          fallbackPattern: finalConfig.fallbackPattern,
          learningEnabled: finalConfig.enableLearning,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to configure adaptive routing', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to configure adaptive routing',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

async function performQueryAnalysis(
  query: string,
  domains: DomainType[],
  userContext: UserContext | AnonymousContext
): Promise<QueryAnalysisResult> {
  const queryLower = query.toLowerCase();

  // Analyze query complexity factors
  const joinComplexity = (queryLower.match(/join/g) || []).length;
  const aggregationComplexity = (queryLower.match(/count|sum|avg|max|min|group by/g) || []).length;
  const filterComplexity = (queryLower.match(/where|and|or|in|exists|not/g) || []).length;

  const complexity = Math.min(
    (domains.length * 10) + (joinComplexity * 5) + (aggregationComplexity * 3) + (filterComplexity * 2),
    100
  );

  // Estimate data volume
  const dataVolume: 'small' | 'medium' | 'large' =
    queryLower.includes('count(*)') || domains.length > 2 ? 'large' :
    queryLower.includes('join') || domains.length > 1 ? 'medium' : 'small';

  // Determine interactivity requirements
  const hasLimit = queryLower.includes('limit');
  const hasOrderBy = queryLower.includes('order by');
  const interactivityLevel: 'low' | 'medium' | 'high' =
    hasLimit && !queryLower.includes('group by') ? 'high' :
    hasOrderBy || queryLower.includes('where') ? 'medium' : 'low';

  // Estimate execution time based on characteristics
  const baseTime = 2000;
  const complexityMultiplier = 1 + (complexity / 100);
  const domainMultiplier = 1 + (domains.length - 1) * 0.3;
  const dataVolumeMultiplier = dataVolume === 'large' ? 2.0 : dataVolume === 'medium' ? 1.5 : 1.0;

  const estimatedExecutionTime = baseTime * complexityMultiplier * domainMultiplier * dataVolumeMultiplier;

  // Determine resource requirements
  const resourceRequirements = {
    cpu: complexity > 70 ? 'high' as const : complexity > 40 ? 'medium' as const : 'low' as const,
    memory: dataVolume === 'large' ? 'high' as const : dataVolume === 'medium' ? 'medium' as const : 'low' as const,
    network: domains.length > 2 ? 'high' as const : domains.length > 1 ? 'medium' as const : 'low' as const,
  };

  // Identify risk factors
  const riskFactors: string[] = [];
  if (complexity > 80) riskFactors.push('Very high query complexity');
  if (domains.length > 3) riskFactors.push('Multi-domain data integration complexity');
  if (dataVolume === 'large') riskFactors.push('Large data volume processing');
  if (joinComplexity > 5) riskFactors.push('Complex join operations');

  // Identify optimization opportunities
  const optimizationOpportunities: string[] = [];
  if (joinComplexity > 3) optimizationOpportunities.push('Consider query optimization for join operations');
  if (aggregationComplexity > 2) optimizationOpportunities.push('Implement aggregation caching');
  if (domains.length > 1) optimizationOpportunities.push('Use data federation for cross-domain efficiency');
  if (hasLimit) optimizationOpportunities.push('Optimize for pagination and incremental loading');

  const characteristics: QueryCharacteristics = {
    complexity,
    domainCount: domains.length,
    dataVolume,
    realTimeRequirement: interactivityLevel === 'high',
    interactivityLevel,
    accuracyRequirement: 'standard', // Default - would be determined from context
  };

  return {
    characteristics,
    complexity,
    estimatedExecutionTime,
    resourceRequirements,
    riskFactors,
    optimizationOpportunities,
  };
}

function applyUserPreferences(characteristics: QueryCharacteristics, preferences: any): QueryCharacteristics {
  const updated = { ...characteristics };

  if (preferences.prioritizeSpeed) {
    // Adjust for speed priority
    if (updated.interactivityLevel !== 'high') {
      updated.interactivityLevel = 'medium';
    }
    updated.realTimeRequirement = true;
  }

  if (preferences.prioritizeAccuracy) {
    // Adjust for accuracy priority
    updated.accuracyRequirement = 'high';
  }

  if (!preferences.allowResourceIntensive) {
    // Reduce complexity estimation for resource-constrained environments
    updated.complexity = Math.min(updated.complexity, 70);
  }

  return updated;
}

function applyContextHints(characteristics: QueryCharacteristics, hints: any): QueryCharacteristics {
  const updated = { ...characteristics };

  if (hints.avgSessionComplexity && hints.avgSessionComplexity > 60) {
    // User tends to run complex queries - adjust complexity expectations
    updated.complexity = Math.min(100, updated.complexity * 1.1);
  }

  if (hints.sessionQueryCount && hints.sessionQueryCount > 10) {
    // High-volume session - prioritize efficiency
    updated.interactivityLevel = 'high';
  }

  if (hints.previousQueryPattern) {
    // Consider pattern consistency for user experience
    if (hints.previousQueryPattern === 'streaming' && updated.dataVolume === 'medium') {
      updated.dataVolume = 'large'; // Bias toward consistent experience
    }
  }

  return updated;
}

async function loadRoutingRules(sessionId: string, userContext: UserContext | AnonymousContext): Promise<RoutingRule[]> {
  try {
    const ruleResults = await biContextStore.searchContextMemories(sessionId, 'routing rules', {
      userId: userContext.userId,
      category: 'routing-rules',
      topK: 20,
      similarityThreshold: 0.5,
    });

    const rules: RoutingRule[] = [];
    for (const result of ruleResults) {
      try {
        const rule = JSON.parse(result.content) as RoutingRule;
        if (rule.isActive) {
          rules.push(rule);
        }
      } catch (parseError) {
        continue;
      }
    }

    // Return default rules if no custom rules found
    return rules.length > 0 ? rules : createDefaultRoutingRules();
  } catch (error) {
    return createDefaultRoutingRules();
  }
}

function createDefaultRoutingRules(): RoutingRule[] {
  return [
    {
      ruleId: 'high_complexity_planner',
      name: 'High Complexity → Planner-Executor',
      condition: {
        complexityRange: [70, 100],
        domainCountRange: [2, 4],
      },
      targetPattern: 'planner-executor',
      priority: 90,
      isActive: true,
    },
    {
      ruleId: 'realtime_reactive',
      name: 'Real-time → Reactive',
      condition: {
        realTimeRequirement: true,
        interactivityLevel: ['high'],
      },
      targetPattern: 'reactive',
      priority: 85,
      isActive: true,
    },
    {
      ruleId: 'large_data_streaming',
      name: 'Large Data → Streaming',
      condition: {
        dataVolume: ['large'],
        complexityRange: [40, 100],
      },
      targetPattern: 'streaming',
      priority: 80,
      isActive: true,
    },
    {
      ruleId: 'balanced_hybrid',
      name: 'Balanced → Hybrid',
      condition: {
        complexityRange: [30, 70],
        domainCountRange: [1, 3],
      },
      targetPattern: 'hybrid',
      priority: 50,
      isActive: true,
    },
  ];
}

async function getAvailablePatterns(sessionId: string, userContext: UserContext | AnonymousContext): Promise<AgentArchitecturePattern[]> {
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

  return patterns;
}

async function executeRoutingLogic(
  queryAnalysis: QueryAnalysisResult,
  availablePatterns: AgentArchitecturePattern[],
  config: AdaptiveRoutingConfig,
  sessionId: string,
  userContext: UserContext | AnonymousContext
): Promise<RoutingDecision> {
  // Apply routing rules first
  const ruleBasedPattern = applyRoutingRules(queryAnalysis.characteristics, config.routingRules);

  // Score all patterns
  const patternScores = availablePatterns.map(pattern => {
    const score = scorePatternForQuery(pattern, queryAnalysis.characteristics, config.performanceWeights);
    return { pattern, score };
  });

  // Sort by score
  patternScores.sort((a, b) => b.score - a.score);

  // Select best pattern, considering rule-based suggestions
  let selectedPattern = patternScores[0]?.pattern;
  let confidence = Math.min(patternScores[0]?.score / 100 || 0, 1.0);

  // If rule-based pattern exists and has good confidence, prefer it
  if (ruleBasedPattern) {
    const rulePattern = patternScores.find(ps => ps.pattern.patternType === ruleBasedPattern);
    if (rulePattern && rulePattern.score >= config.confidenceThreshold * 100) {
      selectedPattern = rulePattern.pattern;
      confidence = Math.max(confidence, 0.8); // Boost confidence for rule-based selection
    }
  }

  // Fallback if confidence is too low
  if (confidence < config.confidenceThreshold) {
    const fallbackPattern = patternScores.find(ps => ps.pattern.patternType === config.fallbackPattern);
    if (fallbackPattern) {
      selectedPattern = fallbackPattern.pattern;
      confidence = config.confidenceThreshold; // Minimum confidence for fallback
    }
  }

  if (!selectedPattern) {
    throw new Error('No suitable pattern found for query');
  }

  const reasoning = generateRoutingReasoning(selectedPattern, queryAnalysis.characteristics, confidence, ruleBasedPattern);

  const alternativePatterns = patternScores
    .filter(ps => ps.pattern.patternId !== selectedPattern!.patternId)
    .slice(0, 3)
    .map(ps => ({
      pattern: ps.pattern.patternType,
      score: ps.score,
      reason: `Score: ${ps.score.toFixed(1)}/100 - ${getPatternStrength(ps.pattern.patternType)}`,
    }));

  const routingDecision: RoutingDecision = {
    selectedPattern: selectedPattern.patternType,
    confidence,
    reasoning,
    alternativePatterns,
    routingTime: 0, // Will be set by caller
    queryAnalysis,
  };

  // Store routing decision for learning
  const decisionRecord = {
    ...routingDecision,
    patternId: selectedPattern.patternId,
    ruleBasedSuggestion: ruleBasedPattern,
    timestamp: new Date().toISOString(),
  };

  await biContextStore.storeContextMemory(sessionId, JSON.stringify(decisionRecord), {
    userId: userContext.userId,
    category: 'routing-decision',
    domains: [],
    scope: 'session',
    metadata: {
      selectedPattern: selectedPattern.patternType,
      confidence,
      complexity: queryAnalysis.characteristics.complexity,
      ruleBasedSelection: Boolean(ruleBasedPattern),
    },
  });

  return routingDecision;
}

function applyRoutingRules(characteristics: QueryCharacteristics, rules: RoutingRule[]): PatternType | undefined {
  // Sort rules by priority
  const sortedRules = rules.filter(r => r.isActive).sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (matchesCondition(characteristics, rule.condition)) {
      return rule.targetPattern;
    }
  }

  return undefined;
}

function matchesCondition(characteristics: QueryCharacteristics, condition: RoutingCondition): boolean {
  if (condition.complexityRange) {
    const [min, max] = condition.complexityRange;
    if (characteristics.complexity < min || characteristics.complexity > max) {
      return false;
    }
  }

  if (condition.domainCountRange) {
    const [min, max] = condition.domainCountRange;
    if (characteristics.domainCount < min || characteristics.domainCount > max) {
      return false;
    }
  }

  if (condition.dataVolume && !condition.dataVolume.includes(characteristics.dataVolume)) {
    return false;
  }

  if (condition.realTimeRequirement !== undefined && condition.realTimeRequirement !== characteristics.realTimeRequirement) {
    return false;
  }

  if (condition.interactivityLevel && !condition.interactivityLevel.includes(characteristics.interactivityLevel)) {
    return false;
  }

  if (condition.accuracyRequirement && !condition.accuracyRequirement.includes(characteristics.accuracyRequirement)) {
    return false;
  }

  return true;
}

function scorePatternForQuery(
  pattern: AgentArchitecturePattern,
  characteristics: QueryCharacteristics,
  weights: any
): number {
  // Base score from historical performance
  const performanceScore = (
    (100 - Math.min(pattern.performanceMetrics.averageResponseTime / 100, 100)) * weights.executionTime +
    (pattern.performanceMetrics.accuracy * 100) * weights.accuracy +
    (100 - (pattern.performanceMetrics.resourceUsage.cpuUsage || 50)) * weights.resourceUsage +
    ((1 - pattern.performanceMetrics.errorRate) * 100) * weights.reliability
  );

  // Pattern-specific adjustments based on query characteristics
  let adaptationBonus = 0;

  switch (pattern.patternType) {
    case 'planner-executor':
      if (characteristics.complexity > 60) adaptationBonus += 15;
      if (characteristics.accuracyRequirement === 'critical') adaptationBonus += 10;
      if (characteristics.domainCount > 2) adaptationBonus += 10;
      break;

    case 'reactive':
      if (characteristics.realTimeRequirement) adaptationBonus += 20;
      if (characteristics.interactivityLevel === 'high') adaptationBonus += 15;
      if (characteristics.complexity < 40) adaptationBonus += 10;
      break;

    case 'streaming':
      if (characteristics.dataVolume === 'large') adaptationBonus += 20;
      if (characteristics.complexity > 50) adaptationBonus += 10;
      if (characteristics.domainCount > 2) adaptationBonus += 10;
      break;

    case 'hybrid':
      adaptationBonus += 8; // Always gets versatility bonus
      if (characteristics.complexity >= 30 && characteristics.complexity <= 70) adaptationBonus += 12;
      break;
  }

  // Success rate bonus
  const reliabilityBonus = pattern.successRate * 15;

  // Usage frequency bonus (popular patterns get small bonus)
  const popularityBonus = Math.min(pattern.usageCount / 100, 5);

  const finalScore = Math.min(performanceScore + adaptationBonus + reliabilityBonus + popularityBonus, 100);

  return Math.max(0, finalScore);
}

function generateRoutingReasoning(
  pattern: AgentArchitecturePattern,
  characteristics: QueryCharacteristics,
  confidence: number,
  ruleBasedPattern?: PatternType
): string {
  const reasons: string[] = [];

  reasons.push(`Selected ${pattern.patternType} pattern with ${(confidence * 100).toFixed(1)}% confidence`);

  if (ruleBasedPattern === pattern.patternType) {
    reasons.push('Selection confirmed by routing rules');
  }

  // Pattern-specific reasoning
  switch (pattern.patternType) {
    case 'planner-executor':
      if (characteristics.complexity > 60) {
        reasons.push('High complexity requires structured planning approach');
      }
      if (characteristics.accuracyRequirement === 'critical') {
        reasons.push('Critical accuracy requirement favors systematic execution');
      }
      break;

    case 'reactive':
      if (characteristics.realTimeRequirement) {
        reasons.push('Real-time requirement optimally served by reactive pattern');
      }
      if (characteristics.interactivityLevel === 'high') {
        reasons.push('High interactivity benefits from event-driven architecture');
      }
      break;

    case 'streaming':
      if (characteristics.dataVolume === 'large') {
        reasons.push('Large data volume efficiently handled by streaming approach');
      }
      if (characteristics.domainCount > 2) {
        reasons.push('Multi-domain integration benefits from streaming coordination');
      }
      break;

    case 'hybrid':
      reasons.push('Hybrid pattern provides adaptive flexibility for query characteristics');
      if (characteristics.complexity >= 30 && characteristics.complexity <= 70) {
        reasons.push('Moderate complexity well-suited for adaptive execution');
      }
      break;
  }

  // Performance insights
  if (pattern.performanceMetrics.accuracy > 0.9) {
    reasons.push('Pattern has demonstrated high accuracy in benchmarks');
  }

  if (pattern.performanceMetrics.averageResponseTime < 5000) {
    reasons.push('Fast response times in historical performance');
  }

  return reasons.join('. ');
}

function getPatternStrength(patternType: PatternType): string {
  switch (patternType) {
    case 'planner-executor':
      return 'Structured reasoning and complex workflow management';
    case 'reactive':
      return 'Real-time responsiveness and event-driven processing';
    case 'streaming':
      return 'Efficient large-scale data processing and memory management';
    case 'hybrid':
      return 'Adaptive execution strategy and versatile pattern selection';
    default:
      return 'General purpose execution';
  }
}

async function storeRoutingDecision(
  sessionId: string,
  userContext: UserContext | AnonymousContext,
  queryAnalysis: QueryAnalysisResult,
  routingDecision: RoutingDecision
) {
  const learningRecord = {
    sessionId,
    queryCharacteristics: queryAnalysis.characteristics,
    routingDecision,
    timestamp: new Date().toISOString(),
    status: 'pending_feedback', // Will be updated when execution completes
  };

  await biContextStore.storeContextMemory(sessionId, JSON.stringify(learningRecord), {
    userId: userContext.userId,
    category: 'routing-learning',
    domains: [],
    scope: 'session',
    metadata: {
      selectedPattern: routingDecision.selectedPattern,
      confidence: routingDecision.confidence,
      complexity: queryAnalysis.characteristics.complexity,
    },
  });
}

function calculatePerformanceDelta(
  predictedTime: number,
  actualTime: number,
  expectedAccuracy: 'standard' | 'high' | 'critical',
  actualAccuracy: number
) {
  const executionTimeDelta = ((actualTime - predictedTime) / predictedTime) * 100;

  // Calculate accuracy delta based on expectations
  let expectedAccuracyValue = 0.85; // standard
  if (expectedAccuracy === 'high') expectedAccuracyValue = 0.92;
  if (expectedAccuracy === 'critical') expectedAccuracyValue = 0.98;

  const accuracyDelta = ((actualAccuracy - expectedAccuracyValue) / expectedAccuracyValue) * 100;

  // Determine overall improvement
  const improvement = executionTimeDelta < -10 && accuracyDelta > -5 ? 'improved' :
                     executionTimeDelta > 20 || accuracyDelta < -10 ? 'degraded' : 'stable';

  return {
    executionTimeDelta,
    accuracyDelta,
    improvement,
    significant: Math.abs(executionTimeDelta) > 15 || Math.abs(accuracyDelta) > 10,
  };
}

async function updatePatternMetrics(
  sessionId: string,
  userContext: UserContext | AnonymousContext,
  patternType: PatternType,
  executionResults: any,
  performanceDelta: any
) {
  // Find the pattern to update
  const patternResults = await biContextStore.searchContextMemories(sessionId, `${patternType} pattern`, {
    userId: userContext.userId,
    category: 'architecture-pattern',
    topK: 5,
    similarityThreshold: 0.6,
  });

  for (const result of patternResults) {
    try {
      const pattern = JSON.parse(result.content) as AgentArchitecturePattern;
      if (pattern.patternType === patternType) {
        // Update metrics with weighted average
        const weight = 0.1; // 10% influence from new result

        const updatedMetrics = {
          ...pattern.performanceMetrics,
          averageResponseTime: (pattern.performanceMetrics.averageResponseTime * (1 - weight)) + (executionResults.executionTime * weight),
          accuracy: (pattern.performanceMetrics.accuracy * (1 - weight)) + (executionResults.accuracy * weight),
          errorRate: (pattern.performanceMetrics.errorRate * (1 - weight)) + ((executionResults.errorCount > 0 ? 1 : 0) * weight),
        };

        const updatedPattern = {
          ...pattern,
          performanceMetrics: updatedMetrics,
          usageCount: pattern.usageCount + 1,
          lastEvaluated: new Date(),
        };

        // Store updated pattern
        await biContextStore.storeContextMemory(sessionId, JSON.stringify(updatedPattern), {
          userId: userContext.userId,
          category: 'architecture-pattern',
          domains: [],
          scope: 'session',
          metadata: {
            patternId: pattern.patternId,
            patternType: pattern.patternType,
            isActive: pattern.isActive,
            operation: 'metrics_update',
          },
        });

        return { updated: true, pattern: updatedPattern };
      }
    } catch (parseError) {
      continue;
    }
  }

  return { updated: false };
}

async function processRoutingLearning(
  originalDecision: any,
  executionResults: any,
  feedback: any,
  performanceDelta: any
) {
  const insights: string[] = [];
  const significantInsights: string[] = [];

  // Analyze prediction accuracy
  if (Math.abs(performanceDelta.executionTimeDelta) > 20) {
    const insight = `Execution time prediction was off by ${performanceDelta.executionTimeDelta.toFixed(1)}%`;
    insights.push(insight);
    if (Math.abs(performanceDelta.executionTimeDelta) > 50) {
      significantInsights.push(insight);
    }
  }

  if (Math.abs(performanceDelta.accuracyDelta) > 10) {
    const insight = `Accuracy prediction was off by ${performanceDelta.accuracyDelta.toFixed(1)}%`;
    insights.push(insight);
    if (Math.abs(performanceDelta.accuracyDelta) > 25) {
      significantInsights.push(insight);
    }
  }

  // Analyze user feedback
  if (feedback) {
    if (!feedback.wasOptimal) {
      significantInsights.push(`User indicated ${originalDecision.selectedPattern} was not optimal for this query`);
    }

    if (feedback.suggestedImprovement) {
      insights.push(`User suggestion: ${feedback.suggestedImprovement}`);
    }
  }

  // Analyze execution success
  if (!executionResults.success) {
    significantInsights.push(`Selected pattern ${originalDecision.selectedPattern} failed to execute successfully`);
  }

  return {
    insights,
    significantInsights,
    learningScore: calculateLearningScore(performanceDelta, feedback, executionResults),
    timestamp: new Date().toISOString(),
  };
}

function calculateLearningScore(performanceDelta: any, feedback: any, executionResults: any): number {
  let score = 50; // Base score

  // Performance delta impact
  if (performanceDelta.improvement === 'improved') score += 20;
  if (performanceDelta.improvement === 'degraded') score -= 20;

  // User feedback impact
  if (feedback?.wasOptimal) score += 15;
  if (feedback?.wasOptimal === false) score -= 15;

  // Execution success impact
  if (executionResults.success) score += 10;
  if (!executionResults.success) score -= 25;

  // Accuracy impact
  if (executionResults.accuracy > 0.9) score += 10;
  if (executionResults.accuracy < 0.7) score -= 15;

  return Math.max(0, Math.min(100, score));
}

async function updateRoutingRules(sessionId: string, userContext: UserContext | AnonymousContext, learningInsights: any) {
  // This would implement rule updates based on learning insights
  // For now, just log the insights for future rule refinement
  rootLogger.info('Routing learning insights captured', {
    sessionId,
    insightCount: learningInsights.insights.length,
    significantInsights: learningInsights.significantInsights.length,
    learningScore: learningInsights.learningScore,
  });

  // In a production system, this would:
  // 1. Analyze patterns in routing failures
  // 2. Generate new routing rules
  // 3. Update existing rule priorities
  // 4. Validate rule changes against historical data
}

function generateRoutingRecommendations(queryAnalysis: QueryAnalysisResult): string[] {
  const recommendations: string[] = [];

  if (queryAnalysis.riskFactors.length > 0) {
    recommendations.push(`Address identified risk factors: ${queryAnalysis.riskFactors.join(', ')}`);
  }

  if (queryAnalysis.optimizationOpportunities.length > 0) {
    recommendations.push(`Consider optimization opportunities: ${queryAnalysis.optimizationOpportunities.join(', ')}`);
  }

  if (queryAnalysis.characteristics.complexity > 80) {
    recommendations.push('Very high complexity - consider breaking into smaller queries');
  }

  if (queryAnalysis.estimatedExecutionTime > 30000) {
    recommendations.push('Long execution time predicted - implement progress tracking');
  }

  return recommendations;
}

function generateLearningRecommendations(learningInsights: any, performanceDelta: any): string[] {
  const recommendations: string[] = [];

  if (learningInsights.significantInsights.length > 0) {
    recommendations.push('Significant learning insights detected - consider updating routing rules');
  }

  if (performanceDelta.improvement === 'degraded') {
    recommendations.push('Performance degradation detected - review pattern selection criteria');
  }

  if (learningInsights.learningScore < 30) {
    recommendations.push('Low learning score - routing decision may need refinement');
  }

  return recommendations;
}

function createDefaultRoutingConfig(): AdaptiveRoutingConfig {
  return {
    enableLearning: true,
    fallbackPattern: 'hybrid',
    confidenceThreshold: 0.7,
    performanceWeights: {
      executionTime: 0.4,
      accuracy: 0.3,
      resourceUsage: 0.2,
      reliability: 0.1,
    },
    routingRules: createDefaultRoutingRules(),
  };
}

async function createRoutingRules(customRules?: any[]): Promise<RoutingRule[]> {
  const rules: RoutingRule[] = createDefaultRoutingRules();

  if (customRules && customRules.length > 0) {
    for (const customRule of customRules) {
      rules.push({
        ruleId: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: customRule.name,
        condition: customRule.condition,
        targetPattern: customRule.targetPattern,
        priority: customRule.priority || 50,
        isActive: customRule.isActive !== false,
      });
    }

    // Sort by priority
    rules.sort((a, b) => b.priority - a.priority);
  }

  return rules;
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const adaptiveRoutingTools = [
  analyzeQueryForRouting,
  executeAdaptivePatternSelection,
  configureAdaptiveRouting,
];

// Export tool metadata for registration
export const adaptiveRoutingToolsMetadata = {
  category: 'adaptive-routing',
  description: 'Adaptive routing system for intelligent architecture pattern selection',
  totalTools: adaptiveRoutingTools.length,
  capabilities: [
    'query_analysis',
    'pattern_selection',
    'adaptive_routing',
    'continuous_learning',
    'performance_optimization',
    'rule_based_routing',
    'feedback_integration',
    'routing_configuration',
  ],
};

rootLogger.info('Adaptive routing tools initialized', {
  totalTools: adaptiveRoutingTools.length,
  capabilities: adaptiveRoutingToolsMetadata.capabilities,
});