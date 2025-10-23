/**
 * Business Intelligence Context Tracer
 * Specialized LangFuse tracing for BI context operations, sessions, and domain access
 */

import { getLangFuseClient } from './langfuse-client.js';
import { WorkflowTracer, AgentTracer, createTrace, createSpan, logEvent, recordScore } from './langfuse.js';
import { memoryLogger } from './logger.js';
import { withErrorHandling } from './error-handling.js';
import {
  UserContext,
  AnonymousContext,
  AnalysisSession,
  ContextState,
  DomainType,
  SessionStatus,
  ContextStatus,
  QueryHistoryEntry,
} from '../types/context.js';

/**
 * Context Operation Types for specialized tracing
 */
export type ContextOperationType =
  | 'session_creation'
  | 'session_recovery'
  | 'context_validation'
  | 'permission_check'
  | 'domain_access'
  | 'query_execution'
  | 'memory_operation'
  | 'visualization_generation'
  | 'context_reconstruction'
  | 'session_cleanup'
  | 'authentication_flow'
  | 'anonymous_fallback';

/**
 * BI Context Trace Metadata
 */
export interface BIContextMetadata {
  sessionId: string;
  userId: string;
  isAnonymous: boolean;
  roleId: string;
  domains?: DomainType[];
  permissions?: Record<string, any>;
  queryCount?: number;
  sessionDuration?: number;
  recoveryAttempt?: number;
  departmentScope?: string[];
  operationType: ContextOperationType;
  contextVersion?: string;
  [key: string]: any;
}

/**
 * Query Execution Trace Data
 */
export interface QueryTraceData {
  query: string;
  domains: DomainType[];
  executionTime: number;
  resultCount: number;
  fromCache?: boolean;
  sqlGenerated?: string;
  tablesAccessed?: string[];
  permissionChecks?: Array<{
    domain: DomainType;
    action: string;
    allowed: boolean;
  }>;
}

/**
 * Session Recovery Trace Data
 */
export interface RecoveryTraceData {
  corruptionDetected: boolean;
  recoveryMethod: 'history_reconstruction' | 'anonymous_fallback' | 'fresh_session';
  stateRecovered: boolean;
  dataLoss?: boolean;
  recoveryTimeMs: number;
  previousAttempts: number;
}

/**
 * Business Intelligence Context Tracer
 * Provides specialized tracing for BI operations with comprehensive context tracking
 */
export class BIContextTracer {
  private langfuseClient = getLangFuseClient();
  private activeTraces = new Map<string, any>();
  private sessionTraces = new Map<string, string>(); // sessionId -> traceId mapping

  // ============================================================================
  // Session Lifecycle Tracing
  // ============================================================================

  /**
   * Start session lifecycle trace
   */
  async startSessionTrace(
    sessionId: string,
    context: UserContext | AnonymousContext,
    operationType: ContextOperationType = 'session_creation'
  ): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        const metadata: BIContextMetadata = {
          sessionId,
          userId: context.userId,
          isAnonymous: context.isAnonymous,
          roleId: context.roleId,
          domains: [],
          permissions: context.permissions,
          departmentScope: context.isAnonymous ? [] : (context as UserContext).departmentScope,
          operationType,
          contextVersion: '1.0.0',
          sessionStartTime: new Date().toISOString(),
        };

        const traceId = await this.langfuseClient.createTrace({
          name: `BI Session: ${operationType}`,
          userId: context.userId,
          sessionId,
          metadata,
          tags: ['bi-context', 'session', operationType, context.isAnonymous ? 'anonymous' : 'authenticated'],
          input: {
            sessionId,
            userId: context.userId,
            roleId: context.roleId,
            isAnonymous: context.isAnonymous,
          },
        });

        if (traceId) {
          this.sessionTraces.set(sessionId, traceId);
          this.activeTraces.set(traceId, {
            type: 'session',
            sessionId,
            startTime: new Date(),
            operationType,
          });

          memoryLogger.debug('Started BI session trace', {
            traceId,
            sessionId,
            operationType,
            isAnonymous: context.isAnonymous,
          });
        }

        return traceId;
      },
      {
        component: 'context-tracer',
        operation: 'start_session_trace',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Track context validation operation
   */
  async traceContextValidation(
    sessionId: string,
    validationResult: {
      valid: boolean;
      issues?: string[];
      recommendations?: string[];
      tokenValid?: boolean;
      permissionsValid?: boolean;
    }
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);
        if (!traceId) return;

        await this.langfuseClient.createEvent({
          traceId,
          name: 'Context Validation',
          input: { sessionId },
          output: validationResult,
          metadata: {
            operationType: 'context_validation',
            validationPassed: validationResult.valid,
            issueCount: validationResult.issues?.length || 0,
          },
          level: validationResult.valid ? 'DEFAULT' : 'WARNING',
          statusMessage: validationResult.valid ? 'Context validation passed' : 'Context validation failed',
        });

        memoryLogger.debug('Traced context validation', {
          sessionId,
          valid: validationResult.valid,
          issues: validationResult.issues?.length || 0,
        });
      },
      {
        component: 'context-tracer',
        operation: 'trace_context_validation',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Track session recovery operation
   */
  async traceSessionRecovery(
    sessionId: string,
    recoveryData: RecoveryTraceData
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);

        // Create new trace if none exists (recovery might be starting fresh)
        const activeTraceId = traceId || await this.langfuseClient.createTrace({
          name: 'BI Session: Recovery',
          sessionId,
          metadata: {
            sessionId,
            operationType: 'session_recovery',
            recoveryTriggered: true,
          },
          tags: ['bi-context', 'session', 'recovery'],
        });

        if (!activeTraceId) return;

        if (!traceId) {
          this.sessionTraces.set(sessionId, activeTraceId);
        }

        await this.langfuseClient.createSpan({
          traceId: activeTraceId,
          name: 'Session Recovery',
          input: {
            sessionId,
            corruptionDetected: recoveryData.corruptionDetected,
            recoveryMethod: recoveryData.recoveryMethod,
            previousAttempts: recoveryData.previousAttempts,
          },
          output: {
            stateRecovered: recoveryData.stateRecovered,
            dataLoss: recoveryData.dataLoss,
            recoveryTimeMs: recoveryData.recoveryTimeMs,
          },
          metadata: {
            operationType: 'session_recovery',
            recoveryMethod: recoveryData.recoveryMethod,
            attemptNumber: recoveryData.previousAttempts + 1,
          },
          level: recoveryData.stateRecovered ? 'DEFAULT' : 'ERROR',
          statusMessage: recoveryData.stateRecovered ?
            `Recovery successful using ${recoveryData.recoveryMethod}` :
            'Recovery failed',
          startTime: new Date(Date.now() - recoveryData.recoveryTimeMs),
          endTime: new Date(),
        });

        memoryLogger.info('Traced session recovery', {
          sessionId,
          recoveryMethod: recoveryData.recoveryMethod,
          success: recoveryData.stateRecovered,
        });
      },
      {
        component: 'context-tracer',
        operation: 'trace_session_recovery',
        sessionId,
      },
      'medium'
    );
  }

  // ============================================================================
  // Query and Domain Access Tracing
  // ============================================================================

  /**
   * Start query execution trace
   */
  async startQueryTrace(
    sessionId: string,
    query: string,
    domains: DomainType[]
  ): Promise<string | null> {
    return await withErrorHandling(
      async () => {
        const sessionTraceId = this.sessionTraces.get(sessionId);
        if (!sessionTraceId) {
          memoryLogger.warn('No session trace found for query tracing', { sessionId });
          return null;
        }

        const querySpanId = await this.langfuseClient.createSpan({
          traceId: sessionTraceId,
          name: 'BI Query Execution',
          input: {
            query: query.length > 1000 ? query.substring(0, 1000) + '...' : query,
            domains,
            queryLength: query.length,
          },
          metadata: {
            operationType: 'query_execution',
            domainCount: domains.length,
            queryHash: this.hashString(query),
          },
          startTime: new Date(),
        });

        if (querySpanId) {
          this.activeTraces.set(querySpanId, {
            type: 'query',
            sessionId,
            startTime: new Date(),
            query,
            domains,
          });
        }

        return querySpanId;
      },
      {
        component: 'context-tracer',
        operation: 'start_query_trace',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Complete query execution trace
   */
  async completeQueryTrace(
    querySpanId: string,
    queryData: QueryTraceData
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceInfo = this.activeTraces.get(querySpanId);
        if (!traceInfo) return;

        await this.langfuseClient.updateObservation(querySpanId, {
          output: {
            executionTime: queryData.executionTime,
            resultCount: queryData.resultCount,
            fromCache: queryData.fromCache,
            tablesAccessed: queryData.tablesAccessed,
            permissionChecks: queryData.permissionChecks,
          },
          metadata: {
            sqlGenerated: queryData.sqlGenerated ? 'yes' : 'no',
            cacheHit: queryData.fromCache,
            performanceCategory: this.categorizePerformance(queryData.executionTime),
          },
          endTime: new Date(),
          level: queryData.executionTime > 30000 ? 'WARNING' : 'DEFAULT',
          statusMessage: queryData.executionTime > 30000 ?
            'Query execution slow' :
            'Query executed successfully',
        });

        // Record performance score
        if (traceInfo.sessionId) {
          const sessionTraceId = this.sessionTraces.get(traceInfo.sessionId);
          if (sessionTraceId) {
            await this.recordQueryPerformanceScore(
              sessionTraceId,
              queryData.executionTime,
              queryData.resultCount
            );
          }
        }

        this.activeTraces.delete(querySpanId);

        memoryLogger.debug('Completed query trace', {
          querySpanId,
          executionTime: queryData.executionTime,
          resultCount: queryData.resultCount,
        });
      },
      {
        component: 'context-tracer',
        operation: 'complete_query_trace',
        querySpanId,
      },
      'low'
    );
  }

  /**
   * Track domain access permission check
   */
  async traceDomainAccess(
    sessionId: string,
    domain: DomainType,
    action: string,
    allowed: boolean,
    reason?: string
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);
        if (!traceId) return;

        await this.langfuseClient.createEvent({
          traceId,
          name: 'Domain Permission Check',
          input: {
            domain,
            action,
            sessionId,
          },
          output: {
            allowed,
            reason,
          },
          metadata: {
            operationType: 'permission_check',
            domain,
            action,
            result: allowed ? 'granted' : 'denied',
          },
          level: allowed ? 'DEFAULT' : 'WARNING',
          statusMessage: allowed ?
            `Access granted to ${domain}:${action}` :
            `Access denied to ${domain}:${action}${reason ? ': ' + reason : ''}`,
        });

        memoryLogger.debug('Traced domain access', {
          sessionId,
          domain,
          action,
          allowed,
        });
      },
      {
        component: 'context-tracer',
        operation: 'trace_domain_access',
        sessionId,
      },
      'low'
    );
  }

  // ============================================================================
  // Memory and State Operations
  // ============================================================================

  /**
   * Track memory operation
   */
  async traceMemoryOperation(
    sessionId: string,
    operation: 'store' | 'search' | 'update' | 'delete',
    data: {
      contentLength?: number;
      searchQuery?: string;
      resultsCount?: number;
      scope: 'user' | 'session' | 'global';
      domains?: DomainType[];
      category?: string;
    }
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);
        if (!traceId) return;

        await this.langfuseClient.createEvent({
          traceId,
          name: `Memory ${operation.toUpperCase()}`,
          input: {
            operation,
            scope: data.scope,
            domains: data.domains,
            category: data.category,
            contentLength: data.contentLength,
            searchQuery: data.searchQuery,
          },
          output: {
            resultsCount: data.resultsCount,
            success: true,
          },
          metadata: {
            operationType: 'memory_operation',
            memoryOperation: operation,
            scope: data.scope,
            domainCount: data.domains?.length || 0,
          },
          level: 'DEFAULT',
        });

        memoryLogger.debug('Traced memory operation', {
          sessionId,
          operation,
          scope: data.scope,
          resultsCount: data.resultsCount,
        });
      },
      {
        component: 'context-tracer',
        operation: 'trace_memory_operation',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Track context state operation
   */
  async traceContextState(
    sessionId: string,
    operation: 'save' | 'load' | 'corrupt' | 'recover',
    contextState?: ContextState
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);
        if (!traceId) return;

        await this.langfuseClient.createEvent({
          traceId,
          name: `Context State ${operation.toUpperCase()}`,
          input: {
            operation,
            sessionId,
            stateId: contextState?.stateId,
          },
          output: {
            success: true,
            isCorrupted: contextState?.isCorrupted,
            historyLength: contextState?.historyStack?.length,
          },
          metadata: {
            operationType: 'context_reconstruction',
            stateOperation: operation,
            hasRecoveryData: Boolean(contextState?.reconstructionData),
          },
          level: contextState?.isCorrupted ? 'ERROR' : 'DEFAULT',
          statusMessage: contextState?.isCorrupted ?
            'Context state is corrupted' :
            `Context state ${operation} successful`,
        });

        memoryLogger.debug('Traced context state operation', {
          sessionId,
          operation,
          isCorrupted: contextState?.isCorrupted,
        });
      },
      {
        component: 'context-tracer',
        operation: 'trace_context_state',
        sessionId,
      },
      'low'
    );
  }

  // ============================================================================
  // Visualization and Component Generation
  // ============================================================================

  /**
   * Track visualization generation
   */
  async traceVisualizationGeneration(
    sessionId: string,
    componentName: string,
    data: {
      visualizationType: string;
      dataRows: number;
      complexity: 'low' | 'medium' | 'high';
      generationTimeMs: number;
      codeLength: number;
      dependencies: string[];
    }
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);
        if (!traceId) return;

        await this.langfuseClient.createSpan({
          traceId,
          name: 'Visualization Generation',
          input: {
            componentName,
            visualizationType: data.visualizationType,
            dataRows: data.dataRows,
            complexity: data.complexity,
          },
          output: {
            codeLength: data.codeLength,
            dependencies: data.dependencies,
            generationTimeMs: data.generationTimeMs,
          },
          metadata: {
            operationType: 'visualization_generation',
            componentComplexity: data.complexity,
            dependencyCount: data.dependencies.length,
            performanceCategory: this.categorizePerformance(data.generationTimeMs),
          },
          startTime: new Date(Date.now() - data.generationTimeMs),
          endTime: new Date(),
          level: data.generationTimeMs > 10000 ? 'WARNING' : 'DEFAULT',
          statusMessage: data.generationTimeMs > 10000 ?
            'Visualization generation slow' :
            'Visualization generated successfully',
        });

        memoryLogger.debug('Traced visualization generation', {
          sessionId,
          componentName,
          generationTimeMs: data.generationTimeMs,
          complexity: data.complexity,
        });
      },
      {
        component: 'context-tracer',
        operation: 'trace_visualization_generation',
        sessionId,
      },
      'low'
    );
  }

  // ============================================================================
  // Session Analytics and Scoring
  // ============================================================================

  /**
   * Record session completion with analytics
   */
  async completeSessionTrace(
    sessionId: string,
    analytics: {
      duration: number;
      queryCount: number;
      domainsAccessed: DomainType[];
      memoryOperations: number;
      recoveryAttempts: number;
      status: SessionStatus;
      userSatisfaction?: number; // 0-1 score
    }
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const traceId = this.sessionTraces.get(sessionId);
        if (!traceId) return;

        await this.langfuseClient.updateObservation(traceId, {
          output: {
            sessionAnalytics: analytics,
            summary: {
              duration: analytics.duration,
              queryCount: analytics.queryCount,
              domainsAccessed: analytics.domainsAccessed,
              recoveryAttempts: analytics.recoveryAttempts,
              status: analytics.status,
            },
          },
          metadata: {
            sessionCompleted: true,
            finalStatus: analytics.status,
            domainCount: analytics.domainsAccessed.length,
            performanceCategory: this.categorizeSessionPerformance(analytics),
          },
          endTime: new Date(),
          level: analytics.status === 'completed' ? 'DEFAULT' : 'WARNING',
          statusMessage: `Session ${analytics.status} after ${Math.round(analytics.duration / 1000)}s`,
        });

        // Record overall session scores
        if (analytics.userSatisfaction !== undefined) {
          await this.recordSessionScore(traceId, 'user_satisfaction', analytics.userSatisfaction);
        }

        await this.recordSessionScore(traceId, 'query_efficiency', this.calculateQueryEfficiency(analytics));
        await this.recordSessionScore(traceId, 'domain_coverage', analytics.domainsAccessed.length / 4); // Max 4 domains

        // Cleanup
        this.sessionTraces.delete(sessionId);
        this.activeTraces.delete(traceId);

        memoryLogger.info('Completed session trace', {
          sessionId,
          duration: analytics.duration,
          queryCount: analytics.queryCount,
          status: analytics.status,
        });
      },
      {
        component: 'context-tracer',
        operation: 'complete_session_trace',
        sessionId,
      },
      'medium'
    );
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get active session traces
   */
  getActiveSessionTraces(): Array<{ sessionId: string; traceId: string; startTime: Date }> {
    return Array.from(this.sessionTraces.entries()).map(([sessionId, traceId]) => {
      const traceInfo = this.activeTraces.get(traceId);
      return {
        sessionId,
        traceId,
        startTime: traceInfo?.startTime || new Date(),
      };
    });
  }

  /**
   * Cleanup orphaned traces
   */
  async cleanupOrphanedTraces(): Promise<number> {
    let cleaned = 0;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [traceId, traceInfo] of this.activeTraces.entries()) {
      if (now - traceInfo.startTime.getTime() > maxAge) {
        this.activeTraces.delete(traceId);

        // Remove from session traces if present
        for (const [sessionId, mappedTraceId] of this.sessionTraces.entries()) {
          if (mappedTraceId === traceId) {
            this.sessionTraces.delete(sessionId);
            break;
          }
        }

        cleaned++;
      }
    }

    if (cleaned > 0) {
      memoryLogger.info('Cleaned up orphaned traces', { count: cleaned });
    }

    return cleaned;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private categorizePerformance(timeMs: number): string {
    if (timeMs < 1000) return 'excellent';
    if (timeMs < 5000) return 'good';
    if (timeMs < 30000) return 'acceptable';
    return 'poor';
  }

  private categorizeSessionPerformance(analytics: {
    duration: number;
    queryCount: number;
    recoveryAttempts: number;
    status: SessionStatus;
  }): string {
    if (analytics.status === 'failed') return 'failed';
    if (analytics.recoveryAttempts > 2) return 'unstable';
    if (analytics.queryCount === 0) return 'inactive';
    if (analytics.duration < 60000) return 'brief';
    if (analytics.duration > 3600000) return 'extended';
    return 'normal';
  }

  private calculateQueryEfficiency(analytics: {
    duration: number;
    queryCount: number;
    recoveryAttempts: number;
  }): number {
    if (analytics.queryCount === 0) return 0;

    const avgQueryTime = analytics.duration / analytics.queryCount;
    const recoveryPenalty = analytics.recoveryAttempts * 0.1;

    let efficiency = Math.max(0, 1 - (avgQueryTime / 30000)); // Normalize against 30s
    efficiency = Math.max(0, efficiency - recoveryPenalty);

    return Math.min(1, efficiency);
  }

  private async recordQueryPerformanceScore(
    traceId: string,
    executionTime: number,
    resultCount: number
  ): Promise<void> {
    try {
      const performanceScore = Math.max(0, 1 - (executionTime / 30000)); // Normalize against 30s
      const resultScore = Math.min(1, resultCount / 1000); // Normalize against 1000 results
      const combinedScore = (performanceScore + resultScore) / 2;

      await recordScore(traceId, 'query_performance', combinedScore, {
        comment: `Query executed in ${executionTime}ms with ${resultCount} results`,
        metadata: {
          executionTime,
          resultCount,
          performanceScore,
          resultScore,
        },
      });
    } catch (error) {
      memoryLogger.warn('Failed to record query performance score', {
        traceId,
        error: (error as Error).message,
      });
    }
  }

  private async recordSessionScore(
    traceId: string,
    name: string,
    value: number,
    comment?: string
  ): Promise<void> {
    try {
      await recordScore(traceId, name, value, {
        comment,
        metadata: {
          scoreType: name,
          recordedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      memoryLogger.warn('Failed to record session score', {
        traceId,
        name,
        error: (error as Error).message,
      });
    }
  }
}

// Export singleton instance
export const biContextTracer = new BIContextTracer();

// Export helper functions for agent and workflow integration
export function createBIWorkflowTracer(
  workflowName: string,
  sessionId: string,
  userId: string,
  options: {
    domains?: DomainType[];
    metadata?: Record<string, any>;
  } = {}
): WorkflowTracer {
  return new WorkflowTracer(
    `BI Workflow: ${workflowName}`,
    crypto.randomUUID(),
    {
      userId,
      sessionId,
      input: {
        domains: options.domains,
        workflowType: 'bi-context',
      },
      metadata: {
        ...options.metadata,
        biContext: true,
        domains: options.domains,
        operationType: 'workflow_execution',
      },
    }
  );
}

export function createBIAgentTracer(
  agentName: string,
  sessionId: string,
  userId: string,
  options: {
    model?: string;
    domains?: DomainType[];
    permissions?: Record<string, any>;
    metadata?: Record<string, any>;
  } = {}
): AgentTracer {
  return new AgentTracer(
    `BI Agent: ${agentName}`,
    {
      model: options.model,
      userId,
      sessionId,
      input: {
        domains: options.domains,
        permissions: options.permissions,
      },
      metadata: {
        ...options.metadata,
        biContext: true,
        domains: options.domains,
        operationType: 'agent_execution',
      },
    }
  );
}

// Export types for external usage
export type {
  ContextOperationType,
  BIContextMetadata,
  QueryTraceData,
  RecoveryTraceData,
};