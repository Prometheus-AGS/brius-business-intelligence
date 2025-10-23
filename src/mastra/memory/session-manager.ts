/**
 * Business Intelligence Session Manager
 * Handles session lifecycle, recovery, and state management
 */

import { memoryLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { biContextStore } from './context-store.js';
import { tokenRefreshService } from '../api/middleware/jwt-context.js';
import {
  UserContext,
  AnonymousContext,
  AnalysisSession,
  ContextState,
  SessionStatus,
  ContextStatus,
  DomainType,
  ANONYMOUS_USER_ID,
  DEFAULT_SESSION_TIMEOUT,
  DEFAULT_REFRESH_THRESHOLD,
} from '../types/context.js';
import { SessionError, ContextError, JWTError, ErrorHandler } from '../utils/errors.js';

/**
 * Session Creation Options
 */
export interface SessionCreationOptions {
  userContext?: UserContext | AnonymousContext;
  initialState?: any;
  domains?: DomainType[];
  enableRecovery?: boolean;
  customTimeout?: number;
}

/**
 * Session Recovery Options
 */
export interface SessionRecoveryOptions {
  fallbackToAnonymous?: boolean;
  reconstructFromHistory?: boolean;
  maxRecoveryAttempts?: number;
}

/**
 * Session Analytics Data
 */
export interface SessionAnalytics {
  sessionId: string;
  userId: string;
  duration: number;
  queryCount: number;
  domainsAccessed: DomainType[];
  lastActivity: Date;
  isAnonymous: boolean;
  status: SessionStatus;
  recoveryAttempts?: number;
}

/**
 * Session Health Status
 */
export interface SessionHealth {
  sessionId: string;
  healthy: boolean;
  contextValid: boolean;
  tokenValid: boolean;
  lastActivity: Date;
  issues: string[];
  recommendations: string[];
}

/**
 * Business Intelligence Session Manager
 * Manages session lifecycle, state, and recovery
 */
export class BISessionManager {
  private activeSessions = new Map<string, {
    session: AnalysisSession;
    context: UserContext | AnonymousContext;
    lastHealthCheck: Date;
    recoveryAttempts: number;
  }>();

  private sessionTimers = new Map<string, NodeJS.Timeout>();
  private readonly maxRecoveryAttempts = 3;
  private readonly healthCheckInterval = 300000; // 5 minutes
  private healthCheckTimer?: NodeJS.Timeout;

  constructor() {
    // Start periodic health checks
    this.startHealthChecks();
  }

  // ============================================================================
  // Session Creation and Initialization
  // ============================================================================

  /**
   * Create new analysis session
   */
  async createSession(options: SessionCreationOptions = {}): Promise<{
    session: AnalysisSession;
    context: UserContext | AnonymousContext;
  }> {
    return await withErrorHandling(
      async () => {
        const sessionId = crypto.randomUUID();

        // Use provided context or create anonymous context
        let userContext = options.userContext;
        if (!userContext) {
          userContext = await this.createAnonymousContext(sessionId, options.customTimeout);
        }

        // Create analysis session
        const session: AnalysisSession = {
          sessionId,
          userId: userContext.userId,
          startTime: new Date(),
          queryHistory: [],
          contextState: options.initialState || {
            initialized: true,
            domains: options.domains || [],
            preferences: userContext.preferences,
          },
          domainAccess: options.domains || [],
          status: 'initiated',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Store context and session
        await biContextStore.storeUserContext(userContext);
        await biContextStore.storeAnalysisSession(session);

        // Create initial context state if recovery is enabled
        if (options.enableRecovery !== false) {
          const contextState: ContextState = {
            stateId: crypto.randomUUID(),
            sessionId,
            stateData: session.contextState,
            historyStack: [{
              timestamp: new Date().toISOString(),
              state: session.contextState,
              contextValid: true,
            }],
            lastUpdate: new Date(),
            isCorrupted: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await biContextStore.storeContextState(contextState);
        }

        // Add to active sessions
        this.activeSessions.set(sessionId, {
          session,
          context: userContext,
          lastHealthCheck: new Date(),
          recoveryAttempts: 0,
        });

        // Setup session timeout
        this.setupSessionTimeout(sessionId, userContext);

        // Schedule token refresh for authenticated sessions
        if (!userContext.isAnonymous) {
          tokenRefreshService.scheduleRefresh(sessionId, userContext as UserContext);
        }

        memoryLogger.info('Created new session', {
          sessionId,
          userId: userContext.userId,
          isAnonymous: userContext.isAnonymous,
          enableRecovery: options.enableRecovery !== false,
        });

        return { session, context: userContext };
      },
      {
        component: 'session-manager',
        operation: 'create_session',
        metadata: options,
      },
      'medium'
    );
  }

  /**
   * Initialize existing session from storage
   */
  async initializeSession(sessionId: string, recoveryOptions: SessionRecoveryOptions = {}): Promise<{
    session: AnalysisSession;
    context: UserContext | AnonymousContext;
  } | null> {
    return await withErrorHandling(
      async () => {
        // Load session and context from storage
        const [session, context] = await Promise.all([
          biContextStore.getAnalysisSession(sessionId),
          biContextStore.getUserContext(sessionId),
        ]);

        if (!session || !context) {
          if (recoveryOptions.fallbackToAnonymous) {
            memoryLogger.warn('Session not found, creating anonymous fallback', { sessionId });
            return await this.createSession({
              userContext: await this.createAnonymousContext(sessionId),
            });
          }
          return null;
        }

        // Check if session needs recovery
        let needsRecovery = false;
        if (context.status !== 'active' || session.status === 'failed') {
          needsRecovery = true;
        }

        // Attempt recovery if needed and enabled
        if (needsRecovery && recoveryOptions.reconstructFromHistory !== false) {
          const recovered = await this.recoverSession(sessionId, recoveryOptions);
          if (recovered) {
            return recovered;
          }
        }

        // Add to active sessions
        this.activeSessions.set(sessionId, {
          session,
          context,
          lastHealthCheck: new Date(),
          recoveryAttempts: 0,
        });

        // Setup session management
        this.setupSessionTimeout(sessionId, context);
        if (!context.isAnonymous) {
          tokenRefreshService.scheduleRefresh(sessionId, context as UserContext);
        }

        memoryLogger.info('Initialized existing session', {
          sessionId,
          userId: context.userId,
          status: session.status,
          needsRecovery,
        });

        return { session, context };
      },
      {
        component: 'session-manager',
        operation: 'initialize_session',
        sessionId,
        metadata: recoveryOptions,
      },
      'medium'
    );
  }

  // ============================================================================
  // Session State Management
  // ============================================================================

  /**
   * Update session state
   */
  async updateSessionState(
    sessionId: string,
    stateUpdate: Partial<AnalysisSession['contextState']>,
    createSnapshot: boolean = true
  ): Promise<void> {
    await withErrorHandling(
      async () => {
        const activeSession = this.activeSessions.get(sessionId);
        if (!activeSession) {
          throw new SessionError(`Active session ${sessionId} not found`);
        }

        // Update session state
        const updatedSession = {
          ...activeSession.session,
          contextState: {
            ...activeSession.session.contextState,
            ...stateUpdate,
          },
          status: 'active' as SessionStatus,
          updatedAt: new Date(),
        };

        // Store updated session
        await biContextStore.storeAnalysisSession(updatedSession);

        // Create state snapshot if requested
        if (createSnapshot) {
          const contextState: ContextState = {
            stateId: crypto.randomUUID(),
            sessionId,
            stateData: updatedSession.contextState,
            historyStack: [], // Will be populated by the trigger
            lastUpdate: new Date(),
            isCorrupted: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await biContextStore.storeContextState(contextState);
        }

        // Update in-memory session
        activeSession.session = updatedSession;

        memoryLogger.debug('Updated session state', {
          sessionId,
          stateKeys: Object.keys(stateUpdate),
          createSnapshot,
        });
      },
      {
        component: 'session-manager',
        operation: 'update_session_state',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Add query to session history
   */
  async addQueryToSession(
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
        // Update database
        await biContextStore.addQueryToHistory(sessionId, query, response, metadata);

        // Update active session if present
        const activeSession = this.activeSessions.get(sessionId);
        if (activeSession) {
          activeSession.session.lastQueryTime = new Date();
          if (metadata?.domains) {
            // Add new domains to domain access
            const newDomains = metadata.domains.filter(
              domain => !activeSession.session.domainAccess.includes(domain)
            );
            activeSession.session.domainAccess.push(...newDomains);
          }
        }

        // Update context activity
        await biContextStore.updateContextActivity(sessionId);

        memoryLogger.debug('Added query to session history', {
          sessionId,
          queryLength: query.length,
          responseLength: response?.length,
          metadata,
        });
      },
      {
        component: 'session-manager',
        operation: 'add_query_to_session',
        sessionId,
        metadata,
      },
      'low'
    );
  }

  // ============================================================================
  // Session Recovery
  // ============================================================================

  /**
   * Recover corrupted or failed session
   */
  async recoverSession(
    sessionId: string,
    options: SessionRecoveryOptions = {}
  ): Promise<{
    session: AnalysisSession;
    context: UserContext | AnonymousContext;
  } | null> {
    return await withErrorHandling(
      async () => {
        const activeSession = this.activeSessions.get(sessionId);
        const maxAttempts = options.maxRecoveryAttempts || this.maxRecoveryAttempts;

        // Check recovery attempt limit
        if (activeSession && activeSession.recoveryAttempts >= maxAttempts) {
          memoryLogger.warn('Max recovery attempts reached', {
            sessionId,
            attempts: activeSession.recoveryAttempts,
          });
          return null;
        }

        // Mark context as corrupted to trigger recovery
        await biContextStore.markContextCorrupted(sessionId);

        // Get recovery data
        const recoveryData = await biContextStore.getContextRecoveryData(sessionId);
        if (!recoveryData) {
          memoryLogger.error('No recovery data available', { sessionId });
          return null;
        }

        // Attempt to reconstruct session from last valid state
        let recoveredContext: UserContext | AnonymousContext | null = null;
        let recoveredSession: AnalysisSession | null = null;

        if (recoveryData.lastValidState && options.reconstructFromHistory !== false) {
          try {
            // Create new context from recovery data
            const sessionData = await biContextStore.getUserContext(sessionId);
            if (sessionData) {
              recoveredContext = {
                ...sessionData,
                status: 'active' as ContextStatus,
                lastActivity: new Date(),
                updatedAt: new Date(),
              };

              // Reconstruct session
              recoveredSession = {
                sessionId,
                userId: recoveredContext.userId,
                startTime: new Date(Date.now() - 3600000), // Assume 1 hour ago
                contextState: recoveryData.lastValidState,
                domainAccess: recoveryData.lastValidState.domains || [],
                queryHistory: [], // Will be populated from database
                status: 'active' as SessionStatus,
                createdAt: new Date(),
                updatedAt: new Date(),
              };

              // Store recovered state
              await biContextStore.storeUserContext(recoveredContext);
              await biContextStore.storeAnalysisSession(recoveredSession);

              memoryLogger.info('Session recovered from history', {
                sessionId,
                recoveryAttempt: (activeSession?.recoveryAttempts || 0) + 1,
              });
            }
          } catch (error) {
            memoryLogger.error('Session recovery failed', {
              sessionId,
              error: (error as Error).message,
            });
          }
        }

        // Fallback to anonymous session if recovery failed
        if (!recoveredContext && options.fallbackToAnonymous) {
          const { session, context } = await this.createSession({
            userContext: await this.createAnonymousContext(sessionId),
          });
          recoveredSession = session;
          recoveredContext = context;

          memoryLogger.info('Session recovered with anonymous fallback', { sessionId });
        }

        if (recoveredContext && recoveredSession) {
          // Update recovery attempts
          const attempts = (activeSession?.recoveryAttempts || 0) + 1;
          this.activeSessions.set(sessionId, {
            session: recoveredSession,
            context: recoveredContext,
            lastHealthCheck: new Date(),
            recoveryAttempts: attempts,
          });

          return { session: recoveredSession, context: recoveredContext };
        }

        return null;
      },
      {
        component: 'session-manager',
        operation: 'recover_session',
        sessionId,
        metadata: options,
      },
      'high'
    );
  }

  // ============================================================================
  // Session Lifecycle Management
  // ============================================================================

  /**
   * Terminate session
   */
  async terminateSession(sessionId: string, reason: string = 'manual'): Promise<void> {
    await withErrorHandling(
      async () => {
        // Remove from active sessions
        const activeSession = this.activeSessions.get(sessionId);
        if (activeSession) {
          this.activeSessions.delete(sessionId);

          // Clear timers
          const timer = this.sessionTimers.get(sessionId);
          if (timer) {
            clearTimeout(timer);
            this.sessionTimers.delete(sessionId);
          }

          // Clear token refresh
          tokenRefreshService.clearRefresh(sessionId);

          // Update session status in database
          const updatedSession = {
            ...activeSession.session,
            status: 'completed' as SessionStatus,
            updatedAt: new Date(),
          };

          await biContextStore.storeAnalysisSession(updatedSession);

          // Update context status
          const updatedContext = {
            ...activeSession.context,
            status: 'completed' as ContextStatus,
            updatedAt: new Date(),
          };

          await biContextStore.storeUserContext(updatedContext);

          memoryLogger.info('Session terminated', {
            sessionId,
            reason,
            duration: Date.now() - activeSession.session.startTime.getTime(),
          });
        }
      },
      {
        component: 'session-manager',
        operation: 'terminate_session',
        sessionId,
        metadata: { reason },
      },
      'medium'
    );
  }

  /**
   * Get session analytics
   */
  async getSessionAnalytics(sessionId: string): Promise<SessionAnalytics | null> {
    return await withErrorHandling(
      async () => {
        const activeSession = this.activeSessions.get(sessionId);
        if (!activeSession) {
          // Try to load from database
          const [session, context] = await Promise.all([
            biContextStore.getAnalysisSession(sessionId),
            biContextStore.getUserContext(sessionId),
          ]);

          if (!session || !context) {
            return null;
          }

          return {
            sessionId,
            userId: context.userId,
            duration: Date.now() - session.startTime.getTime(),
            queryCount: session.queryHistory.length,
            domainsAccessed: session.domainAccess,
            lastActivity: context.lastActivity,
            isAnonymous: context.isAnonymous,
            status: session.status,
          };
        }

        return {
          sessionId,
          userId: activeSession.context.userId,
          duration: Date.now() - activeSession.session.startTime.getTime(),
          queryCount: activeSession.session.queryHistory.length,
          domainsAccessed: activeSession.session.domainAccess,
          lastActivity: activeSession.context.lastActivity,
          isAnonymous: activeSession.context.isAnonymous,
          status: activeSession.session.status,
          recoveryAttempts: activeSession.recoveryAttempts,
        };
      },
      {
        component: 'session-manager',
        operation: 'get_session_analytics',
        sessionId,
      },
      'low'
    );
  }

  /**
   * Check session health
   */
  async checkSessionHealth(sessionId: string): Promise<SessionHealth> {
    return await withErrorHandling(
      async () => {
        const issues: string[] = [];
        const recommendations: string[] = [];

        const activeSession = this.activeSessions.get(sessionId);
        if (!activeSession) {
          return {
            sessionId,
            healthy: false,
            contextValid: false,
            tokenValid: false,
            lastActivity: new Date(0),
            issues: ['Session not found in active sessions'],
            recommendations: ['Initialize session or create new session'],
          };
        }

        const { session, context } = activeSession;

        // Check context validity
        const contextValid = context.status === 'active' && !this.isContextExpired(context);
        if (!contextValid) {
          issues.push('Context is expired or inactive');
          recommendations.push('Refresh token or recreate session');
        }

        // Check token validity for authenticated sessions
        let tokenValid = true;
        if (!context.isAnonymous) {
          const timeUntilExpiry = context.tokenExpiry.getTime() - Date.now();
          if (timeUntilExpiry < DEFAULT_REFRESH_THRESHOLD) {
            tokenValid = false;
            issues.push('Token is expired or near expiry');
            recommendations.push('Refresh JWT token');
          }
        }

        // Check session activity
        const lastActivity = context.lastActivity;
        const timeSinceActivity = Date.now() - lastActivity.getTime();
        if (timeSinceActivity > 3600000) { // 1 hour
          issues.push('Session has been inactive for over 1 hour');
          recommendations.push('Consider session cleanup or user re-engagement');
        }

        // Check for context corruption
        const contextState = await biContextStore.getContextState(sessionId);
        if (contextState?.isCorrupted) {
          issues.push('Context state is marked as corrupted');
          recommendations.push('Attempt session recovery');
        }

        const healthy = contextValid && tokenValid && issues.length === 0;

        return {
          sessionId,
          healthy,
          contextValid,
          tokenValid,
          lastActivity,
          issues,
          recommendations,
        };
      },
      {
        component: 'session-manager',
        operation: 'check_session_health',
        sessionId,
      },
      'low'
    ) || {
      sessionId,
      healthy: false,
      contextValid: false,
      tokenValid: false,
      lastActivity: new Date(0),
      issues: ['Health check failed'],
      recommendations: ['Check session manager status'],
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get session count by status
   */
  getSessionStats(): {
    active: number;
    total: number;
    authenticated: number;
    anonymous: number;
  } {
    const sessions = Array.from(this.activeSessions.values());
    return {
      active: sessions.filter(s => s.session.status === 'active').length,
      total: sessions.length,
      authenticated: sessions.filter(s => !s.context.isAnonymous).length,
      anonymous: sessions.filter(s => s.context.isAnonymous).length,
    };
  }

  /**
   * Cleanup expired sessions
   */
  async performMaintenanceCleanup(): Promise<{
    cleaned: number;
    recovered: number;
    errors: string[];
  }> {
    return await withErrorHandling(
      async () => {
        let cleaned = 0;
        let recovered = 0;
        const errors: string[] = [];

        // Check all active sessions
        for (const [sessionId, activeSession] of this.activeSessions.entries()) {
          try {
            if (this.isContextExpired(activeSession.context)) {
              await this.terminateSession(sessionId, 'expired');
              cleaned++;
            } else {
              // Attempt health check and recovery if needed
              const health = await this.checkSessionHealth(sessionId);
              if (!health.healthy && health.issues.some(issue => issue.includes('corrupted'))) {
                const recovery = await this.recoverSession(sessionId, {
                  fallbackToAnonymous: true,
                  reconstructFromHistory: true,
                });
                if (recovery) {
                  recovered++;
                }
              }
            }
          } catch (error) {
            errors.push(`Session ${sessionId}: ${(error as Error).message}`);
          }
        }

        // Cleanup database sessions
        const dbCleanup = await biContextStore.cleanupExpiredSessions();
        cleaned += dbCleanup.cleaned;
        errors.push(...dbCleanup.errors);

        memoryLogger.info('Maintenance cleanup completed', {
          cleaned,
          recovered,
          errorCount: errors.length,
        });

        return { cleaned, recovered, errors };
      },
      {
        component: 'session-manager',
        operation: 'maintenance_cleanup',
      },
      'low'
    ) || { cleaned: 0, recovered: 0, errors: ['Maintenance cleanup failed'] };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async createAnonymousContext(sessionId: string, customTimeout?: number): Promise<AnonymousContext> {
    const timeout = customTimeout || DEFAULT_SESSION_TIMEOUT;
    const tokenExpiry = new Date(Date.now() + timeout);

    return {
      userId: ANONYMOUS_USER_ID,
      sessionId,
      roleId: 'anonymous',
      departmentScope: [],
      permissions: {
        clinical: { read: true, query: false, export: false },
        financial: { read: true, query: false, export: false },
        operational: { read: true, query: true, export: false },
        'customer-service': { read: true, query: true, export: false },
      },
      preferences: {
        theme: 'light',
        language: 'en',
        timezone: 'UTC',
        notifications: false,
      },
      lastActivity: new Date(),
      tokenExpiry,
      isAnonymous: true,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private setupSessionTimeout(sessionId: string, context: UserContext | AnonymousContext): void {
    const timeUntilExpiry = context.tokenExpiry.getTime() - Date.now();

    if (timeUntilExpiry > 0) {
      const timer = setTimeout(async () => {
        await this.terminateSession(sessionId, 'timeout');
      }, timeUntilExpiry);

      this.sessionTimers.set(sessionId, timer);
    }
  }

  private isContextExpired(context: UserContext | AnonymousContext): boolean {
    return new Date() > context.tokenExpiry;
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performMaintenanceCleanup();
      } catch (error) {
        memoryLogger.error('Health check maintenance failed', {
          error: (error as Error).message,
        });
      }
    }, this.healthCheckInterval);
  }

  /**
   * Shutdown session manager
   */
  async shutdown(): Promise<void> {
    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Clear all session timers
    for (const timer of this.sessionTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionTimers.clear();

    // Clear all token refresh timers
    tokenRefreshService.clearAllRefresh();

    // Terminate all active sessions
    const sessionIds = Array.from(this.activeSessions.keys());
    await Promise.all(
      sessionIds.map(sessionId => this.terminateSession(sessionId, 'shutdown'))
    );

    memoryLogger.info('Session manager shutdown completed', {
      terminatedSessions: sessionIds.length,
    });
  }
}

// Export singleton instance
export const biSessionManager = new BISessionManager();

// Export helper functions
export function createSessionOptions(overrides: Partial<SessionCreationOptions> = {}): SessionCreationOptions {
  return {
    enableRecovery: true,
    domains: [],
    ...overrides,
  };
}

export function createRecoveryOptions(overrides: Partial<SessionRecoveryOptions> = {}): SessionRecoveryOptions {
  return {
    fallbackToAnonymous: true,
    reconstructFromHistory: true,
    maxRecoveryAttempts: 3,
    ...overrides,
  };
}