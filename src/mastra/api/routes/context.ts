import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { apiLogger } from '../../observability/logger.js';
import { biContextStore } from '../../memory/context-store.js';
import { biSessionManager } from '../../memory/session-manager.js';
import { biContextTracer } from '../../observability/context-tracer.js';
import {
  contextTools,
  contextToolsMetadata,
} from '../../tools/context-tools.js';
import {
  UserContext,
  AnonymousContext,
  DomainType,
  PermissionMatrix,
  SessionStatus,
  ContextStatus,
} from '../../types/context.js';
import {
  extractUserContext,
  createAnonymousContext,
  optionalJwtAuth,
  getAuthContext,
  getUserContext,
  hasPermission,
  isDepartmentAuthorized,
} from '../middleware/jwt-context.js';

/**
 * Context Management API Routes
 * Provides comprehensive context and session management endpoints for Business Intelligence
 * Supports both authenticated (JWT) and anonymous access with proper permission scoping
 */

// Validation schemas
const CreateSessionSchema = z.object({
  jwtToken: z.string().optional().describe('JWT token for authenticated access (optional for anonymous)'),
  sessionType: z.enum(['interactive', 'automated', 'batch']).default('interactive'),
  domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).default([]),
  preferences: z.object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),
    defaultVisualization: z.enum(['chart', 'table', 'graph']).optional(),
  }).optional(),
  enableRecovery: z.boolean().default(true),
  customTimeout: z.number().optional(),
});

const GetSessionContextSchema = z.object({
  sessionId: z.string().uuid(),
  includeHistory: z.boolean().default(false),
  includeAnalytics: z.boolean().default(false),
});

const UpdateSessionContextSchema = z.object({
  sessionId: z.string().uuid(),
  stateUpdate: z.record(z.string(), z.any()),
  createSnapshot: z.boolean().default(true),
  updateDomains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).optional(),
});

const CheckDomainPermissionSchema = z.object({
  sessionId: z.string().uuid(),
  domain: z.enum(['clinical', 'financial', 'operational', 'customer-service']),
  action: z.enum(['read', 'query', 'export']),
  department: z.string().optional(),
});

const RecoverSessionSchema = z.object({
  sessionId: z.string().uuid(),
  fallbackToAnonymous: z.boolean().default(true),
  reconstructFromHistory: z.boolean().default(true),
  maxRecoveryAttempts: z.number().default(3),
});

const StoreMemorySchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string(),
  category: z.string().default('bi-context'),
  scope: z.enum(['session', 'user', 'global']).default('session'),
  domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const SearchMemorySchema = z.object({
  sessionId: z.string().uuid(),
  query: z.string(),
  topK: z.number().default(10),
  category: z.string().optional(),
  domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).optional(),
  similarityThreshold: z.number().default(0.7),
});

const GetAnalyticsSchema = z.object({
  sessionId: z.string().uuid().optional(),
  includeGlobalStats: z.boolean().default(false),
  includePerformance: z.boolean().default(true),
});

/**
 * Helper function to extract context from request headers
 */
async function extractContextFromRequest(c: any): Promise<{
  userContext?: UserContext | AnonymousContext;
  sessionId?: string;
}> {
  const authHeader = c.req.header('Authorization');
  const sessionHeader = c.req.header('X-Session-ID');

  let userContext: UserContext | AnonymousContext | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      userContext = extractUserContext(token);
    } catch (error) {
      apiLogger.warn('Invalid JWT token in request', { error: (error as Error).message });
      userContext = createAnonymousContext();
    }
  } else {
    userContext = createAnonymousContext();
  }

  return {
    userContext,
    sessionId: sessionHeader || undefined,
  };
}

export function getContextRoutes() {
  return [
    /**
     * POST /context/sessions - Create new BI analysis session
     * Creates a new business intelligence analysis session with context management
     */
    registerApiRoute('/context/sessions', {
      method: 'POST',
      handler: async c => {
        try {
          apiLogger.info('Create BI session requested');

          const body = await c.req.json();
          const validInput = CreateSessionSchema.parse(body);

          // Use the createBISession tool
          const createBISessionTool = contextTools.find(tool => tool.id === 'create-bi-session');
          if (!createBISessionTool) {
            throw new Error('createBISession tool not found');
          }

          const result = await createBISessionTool.execute(validInput, {});

          if (result.success) {
            apiLogger.info('BI session created successfully', {
              sessionId: result.sessionId,
              userId: result.userId,
              isAnonymous: result.isAnonymous,
            });
            return c.json(result, 201);
          } else {
            apiLogger.error('Failed to create BI session', { error: result.error });
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Create BI session failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to create BI session',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * GET /context/sessions/:sessionId - Get session context information
     * Retrieves current session context and analysis state
     */
    registerApiRoute('/context/sessions/:sessionId', {
      method: 'GET',
      handler: async c => {
        try {
          const sessionId = c.req.param('sessionId');
          const query = c.req.query();

          const validInput = GetSessionContextSchema.parse({
            sessionId,
            includeHistory: query.includeHistory === 'true',
            includeAnalytics: query.includeAnalytics === 'true',
          });

          apiLogger.info('Get session context requested', { sessionId: validInput.sessionId });

          // Use the getSessionContext tool
          const getSessionContextTool = contextTools.find(tool => tool.id === 'get-session-context');
          if (!getSessionContextTool) {
            throw new Error('getSessionContext tool not found');
          }

          const result = await getSessionContextTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 404);
          }

        } catch (error) {
          apiLogger.error('Get session context failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to get session context',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * PUT /context/sessions/:sessionId - Update session context state
     * Updates session context state and creates snapshot
     */
    registerApiRoute('/context/sessions/:sessionId', {
      method: 'PUT',
      handler: async c => {
        try {
          const sessionId = c.req.param('sessionId');
          const body = await c.req.json();

          const validInput = UpdateSessionContextSchema.parse({
            sessionId,
            ...body,
          });

          apiLogger.info('Update session context requested', { sessionId: validInput.sessionId });

          // Use the updateSessionContext tool
          const updateSessionContextTool = contextTools.find(tool => tool.id === 'update-session-context');
          if (!updateSessionContextTool) {
            throw new Error('updateSessionContext tool not found');
          }

          const result = await updateSessionContextTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Update session context failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to update session context',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * POST /context/permissions/check - Check domain access permission
     * Checks if current session has permission for domain operation
     */
    registerApiRoute('/context/permissions/check', {
      method: 'POST',
      handler: async c => {
        try {
          const body = await c.req.json();
          const validInput = CheckDomainPermissionSchema.parse(body);

          apiLogger.info('Check domain permission requested', {
            sessionId: validInput.sessionId,
            domain: validInput.domain,
            action: validInput.action,
          });

          // Use the checkDomainPermission tool
          const checkDomainPermissionTool = contextTools.find(tool => tool.id === 'check-domain-permission');
          if (!checkDomainPermissionTool) {
            throw new Error('checkDomainPermission tool not found');
          }

          const result = await checkDomainPermissionTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Check domain permission failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to check domain permission',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * GET /context/permissions/:sessionId - Get user permissions matrix
     * Gets complete permission matrix for current session
     */
    registerApiRoute('/context/permissions/:sessionId', {
      method: 'GET',
      handler: async c => {
        try {
          const sessionId = c.req.param('sessionId');

          apiLogger.info('Get user permissions requested', { sessionId });

          // Use the getUserPermissions tool
          const getUserPermissionsTool = contextTools.find(tool => tool.id === 'get-user-permissions');
          if (!getUserPermissionsTool) {
            throw new Error('getUserPermissions tool not found');
          }

          const result = await getUserPermissionsTool.execute({ sessionId }, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 404);
          }

        } catch (error) {
          apiLogger.error('Get user permissions failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to get user permissions',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * POST /context/sessions/:sessionId/recover - Recover session context
     * Recovers a corrupted or failed session with context reconstruction
     */
    registerApiRoute('/context/sessions/:sessionId/recover', {
      method: 'POST',
      handler: async c => {
        try {
          const sessionId = c.req.param('sessionId');
          const body = await c.req.json().catch(() => ({}));

          const validInput = RecoverSessionSchema.parse({
            sessionId,
            ...body,
          });

          apiLogger.info('Recover session context requested', { sessionId: validInput.sessionId });

          // Use the recoverSessionContext tool
          const recoverSessionContextTool = contextTools.find(tool => tool.id === 'recover-session-context');
          if (!recoverSessionContextTool) {
            throw new Error('recoverSessionContext tool not found');
          }

          const result = await recoverSessionContextTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Recover session context failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to recover session context',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * GET /context/sessions/:sessionId/health - Validate session health
     * Checks session health and context integrity
     */
    registerApiRoute('/context/sessions/:sessionId/health', {
      method: 'GET',
      handler: async c => {
        try {
          const sessionId = c.req.param('sessionId');

          apiLogger.info('Validate session health requested', { sessionId });

          // Use the validateSessionHealth tool
          const validateSessionHealthTool = contextTools.find(tool => tool.id === 'validate-session-health');
          if (!validateSessionHealthTool) {
            throw new Error('validateSessionHealth tool not found');
          }

          const result = await validateSessionHealthTool.execute({ sessionId }, {});

          if (result.success) {
            const statusCode = result.healthy ? 200 : 503;
            return c.json(result, statusCode);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Validate session health failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to validate session health',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * POST /context/memory/store - Store session memory
     * Stores memory within session context with proper scoping
     */
    registerApiRoute('/context/memory/store', {
      method: 'POST',
      handler: async c => {
        try {
          const body = await c.req.json();
          const validInput = StoreMemorySchema.parse(body);

          apiLogger.info('Store session memory requested', {
            sessionId: validInput.sessionId,
            contentLength: validInput.content.length,
            scope: validInput.scope,
          });

          // Use the storeSessionMemory tool
          const storeSessionMemoryTool = contextTools.find(tool => tool.id === 'store-session-memory');
          if (!storeSessionMemoryTool) {
            throw new Error('storeSessionMemory tool not found');
          }

          const result = await storeSessionMemoryTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 201);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Store session memory failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to store session memory',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * POST /context/memory/search - Search session memory
     * Searches memory within session context with semantic similarity
     */
    registerApiRoute('/context/memory/search', {
      method: 'POST',
      handler: async c => {
        try {
          const body = await c.req.json();
          const validInput = SearchMemorySchema.parse(body);

          apiLogger.info('Search session memory requested', {
            sessionId: validInput.sessionId,
            query: validInput.query,
            topK: validInput.topK,
          });

          // Use the searchSessionMemory tool
          const searchSessionMemoryTool = contextTools.find(tool => tool.id === 'search-session-memory');
          if (!searchSessionMemoryTool) {
            throw new Error('searchSessionMemory tool not found');
          }

          const result = await searchSessionMemoryTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Search session memory failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to search session memory',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * GET /context/analytics - Get session analytics
     * Gets comprehensive analytics for BI sessions
     */
    registerApiRoute('/context/analytics', {
      method: 'GET',
      handler: async c => {
        try {
          const query = c.req.query();
          const validInput = GetAnalyticsSchema.parse({
            sessionId: query.sessionId || undefined,
            includeGlobalStats: query.includeGlobalStats === 'true',
            includePerformance: query.includePerformance !== 'false',
          });

          apiLogger.info('Get session analytics requested', {
            sessionId: validInput.sessionId,
            includeGlobalStats: validInput.includeGlobalStats,
          });

          // Use the getSessionAnalytics tool
          const getSessionAnalyticsTool = contextTools.find(tool => tool.id === 'get-session-analytics');
          if (!getSessionAnalyticsTool) {
            throw new Error('getSessionAnalytics tool not found');
          }

          const result = await getSessionAnalyticsTool.execute(validInput, {});

          if (result.success) {
            return c.json(result, 200);
          } else {
            return c.json(result, 400);
          }

        } catch (error) {
          apiLogger.error('Get session analytics failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            success: false,
            error: 'Failed to get session analytics',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    /**
     * GET /context/info - Get context management information
     * Returns metadata about context management capabilities
     */
    registerApiRoute('/context/info', {
      method: 'GET',
      handler: async c => {
        try {
          apiLogger.info('Context management info requested');

          const info = {
            service: 'brius-context-management',
            version: '1.0.0',
            capabilities: contextToolsMetadata.capabilities,
            totalTools: contextToolsMetadata.totalTools,
            toolsAvailable: contextTools.map(tool => ({
              id: tool.id,
              description: tool.description,
            })),
            supportedDomains: ['clinical', 'financial', 'operational', 'customer-service'],
            supportedSessionTypes: ['interactive', 'automated', 'batch'],
            supportedMemoryScopes: ['session', 'user', 'global'],
            timestamp: new Date().toISOString(),
          };

          return c.json(info, 200);

        } catch (error) {
          apiLogger.error('Get context management info failed', error instanceof Error ? error : new Error(String(error)));

          return c.json({
            error: 'Failed to get context management info',
            details: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),
  ];
}