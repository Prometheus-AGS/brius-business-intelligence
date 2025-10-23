/**
 * Business Intelligence Context MCP Tools
 * Provides MCP server integration for BI context operations
 */

import { z } from 'zod';
import { rootLogger } from '../../observability/logger.js';
import { withErrorHandling } from '../../observability/error-handling.js';
import { biContextStore } from '../../memory/context-store.js';
import { biSessionManager } from '../../memory/session-manager.js';
import { biContextTracer } from '../../observability/context-tracer.js';
import {
  UserContext,
  AnonymousContext,
  AnalysisSession,
  ContextState,
  DomainType,
  SessionStatus,
  ContextStatus,
  ANONYMOUS_USER_ID,
} from '../../types/context.js';

/**
 * MCP Tool for creating user context sessions
 */
export const createContextSession = {
  id: 'create_context_session',
  name: 'Create Context Session',
  description: 'Create a new business intelligence analysis session with user context',
  inputSchema: z.object({
    userId: z.string().default(ANONYMOUS_USER_ID).describe('User identifier (defaults to anonymous)'),
    roleId: z.string().default('anonymous').describe('User role (admin, analyst, manager, anonymous)'),
    departmentScope: z.array(z.string()).optional().describe('Departments/regions user has access to'),
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).optional().describe('Business domains to access'),
    sessionTimeout: z.number().optional().describe('Session timeout in milliseconds'),
    enableRecovery: z.boolean().default(true).describe('Enable session recovery capabilities'),
    permissions: z.record(z.string(), z.object({
      read: z.boolean(),
      query: z.boolean(),
      export: z.boolean(),
    })).optional().describe('Custom permission matrix'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const {
          userId,
          roleId,
          departmentScope,
          domains,
          sessionTimeout,
          enableRecovery,
          permissions,
        } = args;

        rootLogger.info('Creating BI context session via MCP', {
          userId,
          roleId,
          domains,
          isAnonymous: userId === ANONYMOUS_USER_ID,
        });

        // Create session using session manager
        const { session, context: userContext } = await biSessionManager.createSession({
          domains: domains || [],
          enableRecovery,
          customTimeout: sessionTimeout,
        });

        // Start context tracing
        await biContextTracer.startSessionTrace(
          session.sessionId,
          userContext,
          'session_creation'
        );

        return {
          success: true,
          session: {
            sessionId: session.sessionId,
            userId: session.userId,
            status: session.status,
            startTime: session.startTime,
            domains: session.domainAccess,
          },
          context: {
            userId: userContext.userId,
            roleId: userContext.roleId,
            isAnonymous: userContext.isAnonymous,
            permissions: userContext.permissions,
            tokenExpiry: userContext.tokenExpiry,
            departmentScope: userContext.isAnonymous ? [] : (userContext as UserContext).departmentScope,
          },
          metadata: {
            traceId: context.requestId,
            enableRecovery,
            sessionTimeout,
          },
        };
      },
      {
        component: 'mcp-tools',
        operation: 'create_context_session',
        userId: args.userId,
      },
      'medium'
    );
  },
};

/**
 * MCP Tool for retrieving session context
 */
export const getSessionContext = {
  id: 'get_session_context',
  name: 'Get Session Context',
  description: 'Retrieve current session context and analysis state',
  inputSchema: z.object({
    sessionId: z.string().describe('Session identifier to retrieve'),
    includeAnalytics: z.boolean().default(false).describe('Include session analytics data'),
    includeHistory: z.boolean().default(false).describe('Include query history'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const { sessionId, includeAnalytics, includeHistory } = args;

        rootLogger.info('Retrieving session context via MCP', {
          sessionId,
          includeAnalytics,
          includeHistory,
        });

        // Get session and context
        const [userContext, analysisSession] = await Promise.all([
          biContextStore.getUserContext(sessionId),
          biContextStore.getAnalysisSession(sessionId),
        ]);

        if (!userContext || !analysisSession) {
          return {
            success: false,
            error: 'Session not found',
            sessionId,
          };
        }

        const result: any = {
          success: true,
          sessionId,
          context: {
            userId: userContext.userId,
            roleId: userContext.roleId,
            isAnonymous: userContext.isAnonymous,
            permissions: userContext.permissions,
            lastActivity: userContext.lastActivity,
            status: userContext.status,
            departmentScope: userContext.isAnonymous ? [] : (userContext as UserContext).departmentScope,
          },
          session: {
            status: analysisSession.status,
            startTime: analysisSession.startTime,
            lastQueryTime: analysisSession.lastQueryTime,
            domainsAccessed: analysisSession.domainAccess,
            contextState: analysisSession.contextState,
          },
        };

        // Include analytics if requested
        if (includeAnalytics) {
          const analytics = await biSessionManager.getSessionAnalytics(sessionId);
          if (analytics) {
            result.analytics = analytics;
          }
        }

        // Include history if requested
        if (includeHistory) {
          result.session.queryHistory = analysisSession.queryHistory;
        }

        return result;
      },
      {
        component: 'mcp-tools',
        operation: 'get_session_context',
        sessionId: args.sessionId,
      },
      'low'
    );
  },
};

/**
 * MCP Tool for executing BI queries with context
 */
export const executeContextualQuery = {
  id: 'execute_contextual_query',
  name: 'Execute Contextual Query',
  description: 'Execute business intelligence query with full context management',
  inputSchema: z.object({
    sessionId: z.string().describe('Session identifier for context'),
    query: z.string().describe('Business intelligence query to execute'),
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).optional().describe('Domains to query'),
    includeMetadata: z.boolean().default(true).describe('Include query metadata in response'),
    enableCache: z.boolean().default(true).describe('Enable query result caching'),
    maxResults: z.number().optional().describe('Maximum number of results to return'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const {
          sessionId,
          query,
          domains = ['operational'],
          includeMetadata,
          enableCache,
          maxResults,
        } = args;

        const startTime = Date.now();

        rootLogger.info('Executing contextual query via MCP', {
          sessionId,
          queryLength: query.length,
          domains,
          maxResults,
        });

        // Validate session context
        const userContext = await biContextStore.getUserContext(sessionId);
        if (!userContext) {
          return {
            success: false,
            error: 'Invalid session context',
            sessionId,
          };
        }

        // Start query tracing
        const queryTraceId = await biContextTracer.startQueryTrace(sessionId, query, domains);

        // Check domain permissions
        const permissionChecks = [];
        for (const domain of domains) {
          const allowed = Boolean(userContext.permissions[domain]?.query);
          await biContextTracer.traceDomainAccess(sessionId, domain, 'query', allowed);

          permissionChecks.push({
            domain,
            action: 'query',
            allowed,
          });

          if (!allowed) {
            if (queryTraceId) {
              await biContextTracer.completeQueryTrace(queryTraceId, {
                query,
                domains,
                executionTime: Date.now() - startTime,
                resultCount: 0,
                permissionChecks,
              });
            }

            return {
              success: false,
              error: `Insufficient permissions for domain: ${domain}`,
              sessionId,
              permissionChecks,
            };
          }
        }

        // TODO: In a real implementation, this would execute the actual BI query
        // For now, we'll simulate query execution
        const simulatedResults = {
          data: [
            { id: 1, domain: domains[0], value: Math.random() * 1000, timestamp: new Date() },
            { id: 2, domain: domains[0], value: Math.random() * 1000, timestamp: new Date() },
          ],
          totalCount: 2,
          queryHash: require('crypto').createHash('md5').update(query).digest('hex'),
        };

        const executionTime = Date.now() - startTime;

        // Complete query tracing
        if (queryTraceId) {
          await biContextTracer.completeQueryTrace(queryTraceId, {
            query,
            domains,
            executionTime,
            resultCount: simulatedResults.totalCount,
            fromCache: false,
            permissionChecks,
          });
        }

        // Add query to session history
        await biSessionManager.addQueryToSession(
          sessionId,
          query,
          JSON.stringify(simulatedResults),
          {
            domains,
            executionTime,
            resultCount: simulatedResults.totalCount,
          }
        );

        const result: any = {
          success: true,
          sessionId,
          query: {
            text: query,
            domains,
            executionTime,
            resultCount: simulatedResults.totalCount,
          },
          data: simulatedResults.data.slice(0, maxResults || simulatedResults.data.length),
          permissions: permissionChecks,
        };

        if (includeMetadata) {
          result.metadata = {
            queryHash: simulatedResults.queryHash,
            timestamp: new Date().toISOString(),
            totalAvailable: simulatedResults.totalCount,
            cached: false,
            traceId: queryTraceId,
          };
        }

        return result;
      },
      {
        component: 'mcp-tools',
        operation: 'execute_contextual_query',
        sessionId: args.sessionId,
      },
      'high'
    );
  },
};

/**
 * MCP Tool for managing session recovery
 */
export const recoverSession = {
  id: 'recover_session',
  name: 'Recover Session',
  description: 'Recover a corrupted or failed session with context reconstruction',
  inputSchema: z.object({
    sessionId: z.string().describe('Session identifier to recover'),
    fallbackToAnonymous: z.boolean().default(true).describe('Fallback to anonymous session if recovery fails'),
    reconstructFromHistory: z.boolean().default(true).describe('Attempt reconstruction from query history'),
    maxRecoveryAttempts: z.number().default(3).describe('Maximum recovery attempts'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const {
          sessionId,
          fallbackToAnonymous,
          reconstructFromHistory,
          maxRecoveryAttempts,
        } = args;

        const startTime = Date.now();

        rootLogger.info('Recovering session via MCP', {
          sessionId,
          fallbackToAnonymous,
          reconstructFromHistory,
        });

        // Attempt session recovery
        const recoveryResult = await biSessionManager.recoverSession(sessionId, {
          fallbackToAnonymous,
          reconstructFromHistory,
          maxRecoveryAttempts,
        });

        const recoveryTime = Date.now() - startTime;

        if (recoveryResult) {
          // Trace successful recovery
          await biContextTracer.traceSessionRecovery(sessionId, {
            corruptionDetected: true,
            recoveryMethod: fallbackToAnonymous && recoveryResult.context.isAnonymous
              ? 'anonymous_fallback'
              : 'history_reconstruction',
            stateRecovered: true,
            dataLoss: false,
            recoveryTimeMs: recoveryTime,
            previousAttempts: 0, // This would be tracked in a real implementation
          });

          return {
            success: true,
            sessionId,
            recovered: true,
            method: fallbackToAnonymous && recoveryResult.context.isAnonymous
              ? 'anonymous_fallback'
              : 'history_reconstruction',
            recoveryTime,
            session: {
              sessionId: recoveryResult.session.sessionId,
              userId: recoveryResult.session.userId,
              status: recoveryResult.session.status,
            },
            context: {
              userId: recoveryResult.context.userId,
              isAnonymous: recoveryResult.context.isAnonymous,
              status: recoveryResult.context.status,
            },
          };
        } else {
          // Trace failed recovery
          await biContextTracer.traceSessionRecovery(sessionId, {
            corruptionDetected: true,
            recoveryMethod: 'fresh_session',
            stateRecovered: false,
            dataLoss: true,
            recoveryTimeMs: recoveryTime,
            previousAttempts: maxRecoveryAttempts,
          });

          return {
            success: false,
            sessionId,
            recovered: false,
            error: 'Session recovery failed after maximum attempts',
            recoveryTime,
            maxAttemptsReached: true,
          };
        }
      },
      {
        component: 'mcp-tools',
        operation: 'recover_session',
        sessionId: args.sessionId,
      },
      'high'
    );
  },
};

/**
 * MCP Tool for session memory operations
 */
export const manageSessionMemory = {
  id: 'manage_session_memory',
  name: 'Manage Session Memory',
  description: 'Store and retrieve memory within session context',
  inputSchema: z.object({
    sessionId: z.string().describe('Session identifier'),
    operation: z.enum(['store', 'search', 'list']).describe('Memory operation to perform'),
    content: z.string().optional().describe('Content to store (required for store operation)'),
    query: z.string().optional().describe('Search query (required for search operation)'),
    category: z.string().optional().describe('Memory category filter'),
    scope: z.enum(['session', 'user', 'global']).default('session').describe('Memory scope'),
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).optional().describe('Associated domains'),
    topK: z.number().default(10).describe('Maximum results for search'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const {
          sessionId,
          operation,
          content,
          query,
          category,
          scope,
          domains,
          topK,
        } = args;

        rootLogger.info('Managing session memory via MCP', {
          sessionId,
          operation,
          scope,
          category,
          domains,
        });

        // Validate session
        const userContext = await biContextStore.getUserContext(sessionId);
        if (!userContext) {
          return {
            success: false,
            error: 'Invalid session context',
            sessionId,
          };
        }

        let result: any = {
          success: true,
          sessionId,
          operation,
          scope,
        };

        if (operation === 'store') {
          if (!content) {
            return {
              success: false,
              error: 'Content is required for store operation',
              sessionId,
            };
          }

          const memoryId = await biContextStore.storeContextMemory(sessionId, content, {
            userId: userContext.userId,
            category,
            domains,
            scope,
          });

          // Trace memory operation
          await biContextTracer.traceMemoryOperation(sessionId, 'store', {
            contentLength: content.length,
            scope,
            domains,
            category,
          });

          result.stored = {
            memoryId,
            contentLength: content.length,
            category,
            domains,
          };

        } else if (operation === 'search') {
          if (!query) {
            return {
              success: false,
              error: 'Query is required for search operation',
              sessionId,
            };
          }

          const searchResults = await biContextStore.searchContextMemories(sessionId, query, {
            userId: userContext.userId,
            topK,
            category,
            domains,
          });

          // Trace memory operation
          await biContextTracer.traceMemoryOperation(sessionId, 'search', {
            searchQuery: query,
            resultsCount: searchResults.length,
            scope,
            domains,
            category,
          });

          result.search = {
            query,
            results: searchResults.map(r => ({
              id: r.id,
              content: r.content,
              similarity: r.similarity_score,
              category: r.category,
              createdAt: r.created_at,
            })),
            totalResults: searchResults.length,
          };

        } else if (operation === 'list') {
          // This would list recent memories for the session
          // For now, return empty list as placeholder
          result.list = {
            memories: [],
            totalCount: 0,
            category,
            scope,
          };
        }

        return result;
      },
      {
        component: 'mcp-tools',
        operation: 'manage_session_memory',
        sessionId: args.sessionId,
      },
      'medium'
    );
  },
};

/**
 * MCP Tool for getting session analytics
 */
export const getSessionAnalytics = {
  id: 'get_session_analytics',
  name: 'Get Session Analytics',
  description: 'Retrieve comprehensive analytics for business intelligence sessions',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Specific session ID (optional for global stats)'),
    includeGlobalStats: z.boolean().default(false).describe('Include global session statistics'),
    includePerformance: z.boolean().default(true).describe('Include performance metrics'),
    includeHealth: z.boolean().default(false).describe('Include session health check'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const {
          sessionId,
          includeGlobalStats,
          includePerformance,
          includeHealth,
        } = args;

        rootLogger.info('Getting session analytics via MCP', {
          sessionId,
          includeGlobalStats,
          includePerformance,
          includeHealth,
        });

        const result: any = {
          success: true,
          timestamp: new Date().toISOString(),
        };

        // Get specific session analytics
        if (sessionId) {
          const sessionAnalytics = await biSessionManager.getSessionAnalytics(sessionId);
          if (sessionAnalytics) {
            result.session = sessionAnalytics;

            // Include health check if requested
            if (includeHealth) {
              const healthCheck = await biSessionManager.checkSessionHealth(sessionId);
              result.health = healthCheck;
            }
          } else {
            result.session = {
              error: 'Session not found',
              sessionId,
            };
          }
        }

        // Get global statistics if requested
        if (includeGlobalStats) {
          const [globalStats, sessionStats] = await Promise.all([
            biContextStore.getActiveSessionStats(),
            Promise.resolve(biSessionManager.getSessionStats()),
          ]);

          result.global = {
            active: globalStats,
            manager: sessionStats,
            performance: includePerformance ? {
              averageSessionDuration: globalStats.averageSessionDuration,
              totalSessions: globalStats.totalActiveSessions,
              successRate: sessionStats.active / sessionStats.total,
            } : undefined,
          };
        }

        return result;
      },
      {
        component: 'mcp-tools',
        operation: 'get_session_analytics',
        sessionId: args.sessionId,
      },
      'low'
    );
  },
};

/**
 * MCP Tool for cleaning up expired sessions
 */
export const cleanupSessions = {
  id: 'cleanup_sessions',
  name: 'Cleanup Sessions',
  description: 'Perform maintenance cleanup of expired and orphaned sessions',
  inputSchema: z.object({
    force: z.boolean().default(false).describe('Force cleanup even for active sessions'),
    maxAge: z.number().optional().describe('Maximum age in milliseconds for session cleanup'),
    dryRun: z.boolean().default(false).describe('Perform dry run without actual cleanup'),
  }),
  execute: async (args: any, context: any) => {
    return await withErrorHandling(
      async () => {
        const { force, maxAge, dryRun } = args;

        rootLogger.info('Performing session cleanup via MCP', {
          force,
          maxAge,
          dryRun,
        });

        if (dryRun) {
          // Get statistics without performing cleanup
          const [dbStats, sessionStats, tracerStats] = await Promise.all([
            biContextStore.getActiveSessionStats(),
            Promise.resolve(biSessionManager.getSessionStats()),
            Promise.resolve(biContextTracer.getActiveSessionTraces()),
          ]);

          return {
            success: true,
            dryRun: true,
            wouldCleanup: {
              database: {
                expired: dbStats.totalActiveSessions - dbStats.authenticatedSessions - dbStats.anonymousSessions,
              },
              sessionManager: {
                total: sessionStats.total,
                active: sessionStats.active,
              },
              tracer: {
                activeTraces: tracerStats.length,
              },
            },
            recommendations: [
              'Run with dryRun=false to perform actual cleanup',
              'Consider running cleanup during low-usage periods',
              'Monitor session creation rate to adjust cleanup frequency',
            ],
          };
        }

        // Perform actual cleanup
        const [maintenanceResult, tracerCleanup] = await Promise.all([
          biSessionManager.performMaintenanceCleanup(),
          biContextTracer.cleanupOrphanedTraces(),
        ]);

        return {
          success: true,
          cleanup: {
            sessions: {
              cleaned: maintenanceResult.cleaned,
              recovered: maintenanceResult.recovered,
              errors: maintenanceResult.errors,
            },
            traces: {
              cleaned: tracerCleanup,
            },
          },
          summary: {
            totalCleaned: maintenanceResult.cleaned + tracerCleanup,
            totalRecovered: maintenanceResult.recovered,
            hasErrors: maintenanceResult.errors.length > 0,
          },
          timestamp: new Date().toISOString(),
        };
      },
      {
        component: 'mcp-tools',
        operation: 'cleanup_sessions',
      },
      'medium'
    );
  },
};

// Export all BI context MCP tools
export const biContextMCPTools = [
  createContextSession,
  getSessionContext,
  executeContextualQuery,
  recoverSession,
  manageSessionMemory,
  getSessionAnalytics,
  cleanupSessions,
];

// Tool categories for organization
export const contextToolCategories = {
  session: ['create_context_session', 'get_session_context', 'recover_session'],
  query: ['execute_contextual_query'],
  memory: ['manage_session_memory'],
  analytics: ['get_session_analytics', 'cleanup_sessions'],
};

// Export metadata for MCP server registration
export const biContextMCPToolsMetadata = {
  category: 'bi-context',
  description: 'Business Intelligence context management and session operations',
  totalTools: biContextMCPTools.length,
  capabilities: [
    'session_management',
    'context_recovery',
    'domain_permissions',
    'memory_operations',
    'query_tracing',
    'analytics_reporting',
  ],
  dependencies: [
    'biContextStore',
    'biSessionManager',
    'biContextTracer',
  ],
};

rootLogger.info('BI Context MCP Tools initialized', {
  totalTools: biContextMCPTools.length,
  categories: Object.keys(contextToolCategories),
  capabilities: biContextMCPToolsMetadata.capabilities,
});