/**
 * Business Intelligence Context Store
 * Extends existing memory system with BI-specific context management
 */

import { and, eq, desc, gte, lte } from 'drizzle-orm';
import { getDrizzleDb, getConnectionPool } from '../config/consolidated-database.js';
import { userMemoryOps, globalMemoryOps, type MemorySearchOptions, type MemorySearchResult } from './operations.js';
import { vectorStorage } from './storage.js';
import { generateSingleEmbedding } from './embeddings.js';
import { memoryLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';
import {
  UserContext,
  AnonymousContext,
  AnalysisSession,
  ContextState,
  DomainDataset,
  VisualizationArtifact,
  AgentArchitecturePattern,
  ContextStatus,
  SessionStatus,
  DomainType,
  PermissionMatrix,
  ANONYMOUS_USER_ID,
  DEFAULT_SESSION_TIMEOUT,
} from '../types/context.js';
import { JWTError, SessionError, ContextError, ErrorHandler } from '../utils/errors.js';

// Import schema tables (these will be created by the migration)
import {
  userContexts,
  analysisSessions,
  domainDatasets,
  visualizationArtifacts,
  agentArchitecturePatterns,
  contextStates,
  userMemories,
  globalMemories,
} from '../database/schema.js';

/**
 * Context Store Options
 */
export interface ContextStoreOptions {
  sessionTimeout?: number;
  maxQueryHistory?: number;
  enableContextRecovery?: boolean;
  memoryScope?: 'user' | 'session' | 'global';
}

/**
 * Context Query Options
 */
export interface ContextQueryOptions extends MemorySearchOptions {
  sessionId?: string;
  domains?: DomainType[];
  timeRange?: {
    start: Date;
    end: Date;
  };
  includeRelated?: boolean;
}

/**
 * Session Query History Entry
 */
export interface QueryHistoryEntry {
  timestamp: string;
  query: string;
  response?: string;
  domains: DomainType[];
  executionTime?: number;
  resultCount?: number;
  contextValid: boolean;
}

/**
 * Context Recovery Data
 */
export interface ContextRecoveryData {
  stateData: any;
  historyCount: number;
  lastValidState?: any;
  corruptionTimestamp?: Date;
}

/**
 * Business Intelligence Context Store
 * Manages user contexts, sessions, and BI-specific state
 */
export class BIContextStore {
  private db = getDrizzleDb();
  private connectionPool = getConnectionPool();
  private options: ContextStoreOptions;

  constructor(options: ContextStoreOptions = {}) {
    this.options = {
      sessionTimeout: DEFAULT_SESSION_TIMEOUT,
      maxQueryHistory: 100,
      enableContextRecovery: true,
      memoryScope: 'session',
      ...options,
    };
  }

  // ============================================================================
  // User Context Management
  // ============================================================================

  /**
   * Store or update user context
   */
  async storeUserContext(context: UserContext | AnonymousContext): Promise<string> {
    return await withErrorHandling(
      async () => {
        memoryLogger.info('Storing user context', {
          userId: context.userId,
          sessionId: context.sessionId,
          isAnonymous: context.isAnonymous,
          roleId: context.roleId,
        });

        // Use raw SQL for upsert to handle complex JSONB operations
        const result = await this.connectionPool.query(
          `
          INSERT INTO user_contexts (
            user_id, session_id, role_id, department_scope, permissions,
            preferences, token_expiry, is_anonymous, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, NOW(), NOW())
          ON CONFLICT (session_id) DO UPDATE SET
            role_id = EXCLUDED.role_id,
            department_scope = EXCLUDED.department_scope,
            permissions = EXCLUDED.permissions,
            preferences = EXCLUDED.preferences,
            token_expiry = EXCLUDED.token_expiry,
            status = EXCLUDED.status,
            last_activity = NOW(),
            updated_at = NOW()
          RETURNING id
          `,
          [
            context.userId,
            context.sessionId,
            context.roleId,
            JSON.stringify(context.isAnonymous ? [] : (context as UserContext).departmentScope),
            JSON.stringify(context.permissions),
            JSON.stringify(context.preferences),
            context.tokenExpiry,
            context.isAnonymous ? 1 : 0,
            context.status,
          ]
        );

        return result.rows[0]?.id || context.sessionId;
      },
      {
        component: 'context-store',
        operation: 'store_user_context',
        userId: context.userId,
        sessionId: context.sessionId,
      },
      'medium'
    );
  }

  /**
   * Retrieve user context by session ID
   */
  async getUserContext(sessionId: string): Promise<UserContext | AnonymousContext | null> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `
          SELECT * FROM user_contexts
          WHERE session_id = $1 AND status = 'active'
          ORDER BY last_activity DESC
          LIMIT 1
          `,
          [sessionId]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        const isAnonymous = row.is_anonymous === 1;

        const baseContext = {
          userId: row.user_id,
          sessionId: row.session_id,
          roleId: row.role_id,
          permissions: row.permissions as PermissionMatrix,
          preferences: row.preferences,
          lastActivity: new Date(row.last_activity),
          tokenExpiry: new Date(row.token_expiry),
          isAnonymous,
          status: row.status as ContextStatus,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        };

        if (isAnonymous) {
          return {
            ...baseContext,
            departmentScope: [],
          } as AnonymousContext;
        } else {
          return {
            ...baseContext,
            departmentScope: row.department_scope || [],
          } as UserContext;
        }
      },
      {
        component: 'context-store',
        operation: 'get_user_context',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Update user context activity timestamp
   */
  async updateContextActivity(sessionId: string): Promise<void> {
    await withErrorHandling(
      async () => {
        await this.connectionPool.query(
          `UPDATE user_contexts SET last_activity = NOW(), updated_at = NOW() WHERE session_id = $1`,
          [sessionId]
        );
      },
      {
        component: 'context-store',
        operation: 'update_context_activity',
        sessionId,
      },
      'low'
    );
  }

  // ============================================================================
  // Analysis Session Management
  // ============================================================================

  /**
   * Create or update analysis session
   */
  async storeAnalysisSession(session: AnalysisSession): Promise<string> {
    return await withErrorHandling(
      async () => {
        memoryLogger.info('Storing analysis session', {
          sessionId: session.sessionId,
          userId: session.userId,
          status: session.status,
          queryHistoryLength: session.queryHistory.length,
        });

        const result = await this.connectionPool.query(
          `
          INSERT INTO analysis_sessions (
            session_id, user_id, start_time, last_query_time, query_history,
            context_state, domain_access, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, NOW(), NOW())
          ON CONFLICT (session_id) DO UPDATE SET
            last_query_time = EXCLUDED.last_query_time,
            query_history = EXCLUDED.query_history,
            context_state = EXCLUDED.context_state,
            domain_access = EXCLUDED.domain_access,
            status = EXCLUDED.status,
            updated_at = NOW()
          RETURNING id
          `,
          [
            session.sessionId,
            session.userId,
            session.startTime,
            session.lastQueryTime,
            JSON.stringify(session.queryHistory),
            JSON.stringify(session.contextState),
            JSON.stringify(session.domainAccess),
            session.status,
          ]
        );

        return result.rows[0]?.id || session.sessionId;
      },
      {
        component: 'context-store',
        operation: 'store_analysis_session',
        sessionId: session.sessionId,
        userId: session.userId,
      },
      'medium'
    );
  }

  /**
   * Retrieve analysis session
   */
  async getAnalysisSession(sessionId: string): Promise<AnalysisSession | null> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `SELECT * FROM analysis_sessions WHERE session_id = $1 LIMIT 1`,
          [sessionId]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        return {
          sessionId: row.session_id,
          userId: row.user_id,
          startTime: new Date(row.start_time),
          lastQueryTime: row.last_query_time ? new Date(row.last_query_time) : undefined,
          queryHistory: row.query_history || [],
          contextState: row.context_state,
          domainAccess: row.domain_access || [],
          status: row.status as SessionStatus,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        };
      },
      {
        component: 'context-store',
        operation: 'get_analysis_session',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Add query to session history
   */
  async addQueryToHistory(
    sessionId: string,
    query: string,
    response?: string,
    metadata?: {
      domains?: DomainType[];
      executionTime?: number;
      resultCount?: number;
    }
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const historyEntry: QueryHistoryEntry = {
          timestamp: new Date().toISOString(),
          query,
          response,
          domains: metadata?.domains || [],
          executionTime: metadata?.executionTime,
          resultCount: metadata?.resultCount,
          contextValid: true, // Default to true, corruption detection will update this
        };

        // The trigger function maintain_query_history() will handle size limits
        await this.connectionPool.query(
          `
          UPDATE analysis_sessions
          SET
            query_history = query_history || $2::jsonb,
            last_query_time = NOW(),
            updated_at = NOW()
          WHERE session_id = $1
          `,
          [sessionId, JSON.stringify(historyEntry)]
        );
      },
      {
        component: 'context-store',
        operation: 'add_query_to_history',
        sessionId,
        metadata,
      },
      'low'
    );
  }

  // ============================================================================
  // Context State Management
  // ============================================================================

  /**
   * Store context state snapshot
   */
  async storeContextState(contextState: ContextState): Promise<string> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `
          INSERT INTO context_states (
            state_id, session_id, state_data, history_stack,
            reconstruction_data, is_corrupted, created_at, updated_at
          ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, NOW(), NOW())
          ON CONFLICT (session_id) DO UPDATE SET
            state_data = EXCLUDED.state_data,
            history_stack = EXCLUDED.history_stack,
            reconstruction_data = EXCLUDED.reconstruction_data,
            is_corrupted = EXCLUDED.is_corrupted,
            last_update = NOW(),
            updated_at = NOW()
          RETURNING id
          `,
          [
            contextState.stateId,
            contextState.sessionId,
            JSON.stringify(contextState.stateData),
            JSON.stringify(contextState.historyStack),
            JSON.stringify(contextState.reconstructionData || {}),
            contextState.isCorrupted ? 1 : 0,
          ]
        );

        return result.rows[0]?.id || contextState.stateId;
      },
      {
        component: 'context-store',
        operation: 'store_context_state',
        stateId: contextState.stateId,
        sessionId: contextState.sessionId,
      },
      'medium'
    );
  }

  /**
   * Get context state for session
   */
  async getContextState(sessionId: string): Promise<ContextState | null> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `SELECT * FROM context_states WHERE session_id = $1 ORDER BY last_update DESC LIMIT 1`,
          [sessionId]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        return {
          stateId: row.state_id,
          sessionId: row.session_id,
          stateData: row.state_data,
          historyStack: row.history_stack || [],
          reconstructionData: row.reconstruction_data,
          lastUpdate: new Date(row.last_update),
          isCorrupted: row.is_corrupted === 1,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        };
      },
      {
        component: 'context-store',
        operation: 'get_context_state',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Mark context as corrupted and trigger recovery
   */
  async markContextCorrupted(sessionId: string): Promise<boolean> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `SELECT mark_context_corrupted($1) as success`,
          [sessionId]
        );
        return result.rows[0]?.success || false;
      },
      {
        component: 'context-store',
        operation: 'mark_context_corrupted',
        sessionId,
      },
      'high'
    );
  }

  /**
   * Get context recovery data
   */
  async getContextRecoveryData(sessionId: string): Promise<ContextRecoveryData | null> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `SELECT * FROM get_context_recovery_data($1)`,
          [sessionId]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        return {
          stateData: row.state_data,
          historyCount: row.history_count,
          lastValidState: row.last_valid_state,
          corruptionTimestamp: row.corruption_timestamp ? new Date(row.corruption_timestamp) : undefined,
        };
      },
      {
        component: 'context-store',
        operation: 'get_context_recovery_data',
        sessionId,
      },
      'medium'
    );
  }

  // ============================================================================
  // Memory Operations with Context
  // ============================================================================

  /**
   * Store memory with session context
   */
  async storeContextMemory(
    sessionId: string,
    content: string,
    options: {
      userId?: string;
      category?: string;
      domains?: DomainType[];
      scope?: 'session' | 'user' | 'global';
      metadata?: Record<string, any>;
    } = {}
  ): Promise<string> {
    return await withErrorHandling(
      async () => {
        const { userId, category = 'bi-context', domains = [], scope = 'session', metadata = {} } = options;

        const contextMetadata = {
          ...metadata,
          sessionId,
          domains,
          scope,
          contextType: 'bi-session',
          storedAt: new Date().toISOString(),
        };

        if (scope === 'global') {
          return await globalMemoryOps.store({
            content,
            category,
            metadata: contextMetadata,
            createdBy: userId,
          });
        } else {
          const targetUserId = userId || ANONYMOUS_USER_ID;
          return await userMemoryOps.store({
            userId: targetUserId,
            content,
            category,
            metadata: contextMetadata,
          });
        }
      },
      {
        component: 'context-store',
        operation: 'store_context_memory',
        sessionId,
        userId: options.userId,
        scope: options.scope,
      },
      'medium'
    );
  }

  /**
   * Search memories with context filtering
   */
  async searchContextMemories(
    sessionId: string,
    query: string,
    options: ContextQueryOptions = {}
  ): Promise<MemorySearchResult[]> {
    return await withErrorHandling(
      async () => {
        const {
          userId,
          topK = 10,
          similarityThreshold = 0.7,
          category,
          domains,
          timeRange,
          includeRelated = false,
        } = options;

        // Search user memories first
        let userResults: MemorySearchResult[] = [];
        if (userId && userId !== ANONYMOUS_USER_ID) {
          userResults = await userMemoryOps.search({
            userId,
            query,
            topK: Math.ceil(topK / 2),
            similarityThreshold,
            category,
          });
        }

        // Search global memories
        const globalResults = await globalMemoryOps.search({
          query,
          topK: Math.ceil(topK / 2),
          similarityThreshold,
          category,
        });

        // Combine and filter results
        let allResults = [...userResults, ...globalResults];

        // Filter by session context if available
        if (sessionId) {
          allResults = allResults.filter(result => {
            const resultSessionId = result.metadata?.sessionId;
            return !resultSessionId || resultSessionId === sessionId;
          });
        }

        // Filter by domains if specified
        if (domains && domains.length > 0) {
          allResults = allResults.filter(result => {
            const resultDomains = result.metadata?.domains || [];
            return domains.some(domain => resultDomains.includes(domain));
          });
        }

        // Filter by time range if specified
        if (timeRange) {
          allResults = allResults.filter(result => {
            if (!result.created_at) return true;
            const createdAt = new Date(result.created_at);
            return createdAt >= timeRange.start && createdAt <= timeRange.end;
          });
        }

        // Sort by similarity and return top results
        return allResults
          .sort((a, b) => b.similarity_score - a.similarity_score)
          .slice(0, topK);
      },
      {
        component: 'context-store',
        operation: 'search_context_memories',
        sessionId,
        userId: options.userId,
        metadata: options,
      },
      'medium'
    );
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Get active sessions statistics
   */
  async getActiveSessionStats(): Promise<{
    totalActiveSessions: number;
    authenticatedSessions: number;
    anonymousSessions: number;
    averageSessionDuration: string;
    domainsAccessed: DomainType[];
  }> {
    return await withErrorHandling(
      async () => {
        const result = await this.connectionPool.query(
          `SELECT * FROM get_active_session_stats()`
        );

        const stats = result.rows[0] || {
          total_active_sessions: 0,
          authenticated_sessions: 0,
          anonymous_sessions: 0,
          average_session_duration: '0 seconds',
          domains_accessed: [],
        };

        return {
          totalActiveSessions: stats.total_active_sessions,
          authenticatedSessions: stats.authenticated_sessions,
          anonymousSessions: stats.anonymous_sessions,
          averageSessionDuration: stats.average_session_duration?.toString() || '0 seconds',
          domainsAccessed: Array.from(
            new Set(
              (stats.domains_accessed || []).flatMap((scope: any) =>
                Array.isArray(scope) ? scope : []
              )
            )
          ),
        };
      },
      {
        component: 'context-store',
        operation: 'get_active_session_stats',
      },
      'low'
    );
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<{ cleaned: number; errors: string[] }> {
    return await withErrorHandling(
      async () => {
        const errors: string[] = [];
        let cleaned = 0;

        try {
          // Mark expired contexts as inactive
          const contextResult = await this.connectionPool.query(
            `
            UPDATE user_contexts
            SET status = 'failed', updated_at = NOW()
            WHERE token_expiry < NOW() AND status = 'active'
            RETURNING id
            `
          );
          cleaned += contextResult.rowCount || 0;

          // Mark expired sessions as failed
          const sessionResult = await this.connectionPool.query(
            `
            UPDATE analysis_sessions
            SET status = 'failed', updated_at = NOW()
            WHERE session_id IN (
              SELECT session_id FROM user_contexts
              WHERE token_expiry < NOW()
            ) AND status IN ('active', 'processing')
            `
          );

          memoryLogger.info('Cleaned up expired sessions', {
            expiredContexts: contextResult.rowCount,
            expiredSessions: sessionResult.rowCount,
          });
        } catch (error) {
          errors.push(`Session cleanup failed: ${(error as Error).message}`);
        }

        return { cleaned, errors };
      },
      {
        component: 'context-store',
        operation: 'cleanup_expired_sessions',
      },
      'low'
    );
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Context store health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    tables: Record<string, boolean>;
    functions: Record<string, boolean>;
    vectorOps: boolean;
    issues: string[];
  }> {
    return await withErrorHandling(
      async () => {
        const issues: string[] = [];
        const tables: Record<string, boolean> = {};
        const functions: Record<string, boolean> = {};

        // Check required tables exist
        const requiredTables = [
          'user_contexts',
          'analysis_sessions',
          'domain_datasets',
          'visualization_artifacts',
          'agent_architecture_patterns',
          'context_states',
        ];

        for (const tableName of requiredTables) {
          try {
            const result = await this.connectionPool.query(
              `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
              [tableName]
            );
            tables[tableName] = result.rows.length > 0;
            if (!tables[tableName]) {
              issues.push(`Table ${tableName} not found`);
            }
          } catch (error) {
            tables[tableName] = false;
            issues.push(`Failed to check table ${tableName}: ${(error as Error).message}`);
          }
        }

        // Check required functions exist
        const requiredFunctions = [
          'mark_context_corrupted',
          'get_context_recovery_data',
          'get_active_session_stats',
        ];

        for (const functionName of requiredFunctions) {
          try {
            const result = await this.connectionPool.query(
              `SELECT 1 FROM information_schema.routines WHERE routine_name = $1`,
              [functionName]
            );
            functions[functionName] = result.rows.length > 0;
            if (!functions[functionName]) {
              issues.push(`Function ${functionName} not found`);
            }
          } catch (error) {
            functions[functionName] = false;
            issues.push(`Failed to check function ${functionName}: ${(error as Error).message}`);
          }
        }

        // Check vector operations
        let vectorOps = false;
        try {
          const vectorHealth = await vectorStorage.healthCheck();
          vectorOps = vectorHealth.healthy;
          if (!vectorOps) {
            issues.push(...vectorHealth.issues);
          }
        } catch (error) {
          issues.push(`Vector operations check failed: ${(error as Error).message}`);
        }

        const healthy = Object.values(tables).every(Boolean) &&
                        Object.values(functions).every(Boolean) &&
                        vectorOps;

        return {
          healthy,
          tables,
          functions,
          vectorOps,
          issues,
        };
      },
      {
        component: 'context-store',
        operation: 'health_check',
      },
      'low'
    ) || {
      healthy: false,
      tables: {},
      functions: {},
      vectorOps: false,
      issues: ['Health check failed'],
    };
  }
}

// Export singleton instance for application use
export const biContextStore = new BIContextStore();

// Export helper functions
export function createContextStoreOptions(overrides: Partial<ContextStoreOptions> = {}): ContextStoreOptions {
  return {
    sessionTimeout: DEFAULT_SESSION_TIMEOUT,
    maxQueryHistory: 100,
    enableContextRecovery: true,
    memoryScope: 'session',
    ...overrides,
  };
}

export function isContextExpired(context: UserContext | AnonymousContext): boolean {
  return new Date() > context.tokenExpiry;
}

export function calculateSessionDuration(context: UserContext | AnonymousContext): number {
  return Date.now() - context.createdAt.getTime();
}