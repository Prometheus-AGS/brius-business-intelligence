import { Request, Response, NextFunction } from 'express';
import { userMemoryOps } from '../memory/operations.js';
import { createMemoryMiddleware, extractMemoryContext } from '../memory/middleware.js';
import { authLogger } from '../observability/logger.js';
import { AuthContext } from '../types/index.js';

/**
 * Enhanced Authentication Middleware with Memory Integration
 * Combines user authentication, authorization, and memory context injection
 * Provides seamless integration between auth and memory systems
 */

export interface EnhancedAuthContext extends AuthContext {
  memoryEnabled: boolean;
  memoryCategories: string[];
  contextInjected: boolean;
  permissions: string[];
}

export interface MemoryAuthOptions {
  requireAuth?: boolean;
  requireMemoryAccess?: boolean;
  allowedRoles?: string[];
  requiredPermissions?: string[];
  memoryCategories?: string[];
  enableContextInjection?: boolean;
  maxUserMemories?: number;
  maxGlobalMemories?: number;
  similarityThreshold?: number;
}

const DEFAULT_MEMORY_AUTH_OPTIONS: Required<MemoryAuthOptions> = {
  requireAuth: true,
  requireMemoryAccess: false,
  allowedRoles: [],
  requiredPermissions: [],
  memoryCategories: [],
  enableContextInjection: true,
  maxUserMemories: 5,
  maxGlobalMemories: 3,
  similarityThreshold: 0.7,
};

/**
 * Enhanced authentication middleware factory with memory integration
 */
export function createMemoryAuthMiddleware(
  options: MemoryAuthOptions = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const config = { ...DEFAULT_MEMORY_AUTH_OPTIONS, ...options };

  // Create memory middleware with the specified configuration
  const memoryMiddleware = createMemoryMiddleware({
    maxUserMemories: config.maxUserMemories,
    maxGlobalMemories: config.maxGlobalMemories,
    similarityThreshold: config.similarityThreshold,
    categories: config.memoryCategories,
    enableContextSummary: true,
    requireAuth: config.requireAuth,
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      authLogger.info('Memory auth middleware starting', {
        path: req.path,
        method: req.method,
        require_auth: config.requireAuth,
        require_memory_access: config.requireMemoryAccess,
        enable_context_injection: config.enableContextInjection,
      });

      // Step 1: Basic authentication check
      if (config.requireAuth && !req.user?.userId) {
        authLogger.warn('Authentication required but not provided', {
          path: req.path,
          method: req.method,
        });

        res.status(401).json({
          error: {
            message: 'Authentication required',
            type: 'authentication_error',
            code: 'unauthorized',
          },
        });
        return;
      }

      // Step 2: Role-based authorization
      if (config.allowedRoles.length > 0 && req.user?.role) {
        if (!config.allowedRoles.includes(req.user.role)) {
          authLogger.warn('User role not authorized', {
            user_id: req.user.userId,
            user_role: req.user.role,
            allowed_roles: config.allowedRoles,
            path: req.path,
          });

          res.status(403).json({
            error: {
              message: 'Insufficient role permissions',
              type: 'authorization_error',
              code: 'forbidden',
            },
          });
          return;
        }
      }

      // Step 3: Permission-based authorization
      if (config.requiredPermissions.length > 0) {
        const userPermissions = req.user?.permissions || [];
        const hasRequiredPermissions = config.requiredPermissions.every(permission =>
          userPermissions.includes(permission)
        );

        if (!hasRequiredPermissions) {
          authLogger.warn('User lacks required permissions', {
            user_id: req.user?.userId,
            user_permissions: userPermissions,
            required_permissions: config.requiredPermissions,
            path: req.path,
          });

          res.status(403).json({
            error: {
              message: 'Insufficient permissions',
              type: 'authorization_error',
              code: 'forbidden',
              details: {
                required_permissions: config.requiredPermissions,
                user_permissions: userPermissions,
              },
            },
          });
          return;
        }
      }

      // Step 4: Memory access validation
      if (config.requireMemoryAccess && req.user?.userId) {
        try {
          // Test memory access by attempting to get user memory stats
          await userMemoryOps.getMemoryStats(req.user.userId);
          authLogger.debug('Memory access validated', {
            user_id: req.user.userId,
          });
        } catch (memoryError) {
          authLogger.error('Memory access validation failed', {
            user_id: req.user.userId,
            error: memoryError instanceof Error ? memoryError.message : String(memoryError),
          });

          res.status(503).json({
            error: {
              message: 'Memory system unavailable',
              type: 'service_unavailable_error',
              code: 'memory_unavailable',
            },
          });
          return;
        }
      }

      // Step 5: Enhance auth context with memory information
      if (req.user) {
        const enhancedAuthContext: EnhancedAuthContext = {
          ...req.user,
          memoryEnabled: config.enableContextInjection,
          memoryCategories: config.memoryCategories,
          contextInjected: false,
          permissions: req.user.permissions || [],
        };

        (req as any).user = enhancedAuthContext;
      }

      // Step 6: Apply memory context injection if enabled
      if (config.enableContextInjection && req.user?.userId) {
        authLogger.debug('Applying memory context injection', {
          user_id: req.user.userId,
          path: req.path,
        });

        // Use the memory middleware to inject context
        await new Promise<void>((resolve, reject) => {
          memoryMiddleware(req, res, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });

        // Mark context as injected
        if (req.user) {
          (req.user as EnhancedAuthContext).contextInjected = true;
        }

        authLogger.info('Memory context injection completed', {
          user_id: req.user.userId,
          has_memory_context: Boolean(extractMemoryContext(req)),
          path: req.path,
        });
      }

      // Step 7: Log successful authentication and authorization
      authLogger.info('Memory auth middleware completed successfully', {
        user_id: req.user?.userId,
        user_role: req.user?.role,
        memory_enabled: config.enableContextInjection,
        context_injected: req.user ? (req.user as EnhancedAuthContext).contextInjected : false,
        path: req.path,
        method: req.method,
      });

      next();

    } catch (error) {
      authLogger.error('Memory auth middleware failed', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
        user_id: req.user?.userId,
      });

      res.status(500).json({
        error: {
          message: 'Authentication middleware error',
          type: 'internal_server_error',
          code: 'auth_middleware_error',
        },
      });
    }
  };
}

/**
 * Specialized middleware for different use cases
 */

/**
 * Business Intelligence specific auth middleware
 * Includes business context categories and comprehensive memory access
 */
export const businessIntelligenceAuth = createMemoryAuthMiddleware({
  requireAuth: true,
  requireMemoryAccess: true,
  allowedRoles: ['user', 'analyst', 'admin'],
  memoryCategories: ['business', 'metrics', 'preferences', 'analysis'],
  enableContextInjection: true,
  maxUserMemories: 8,
  maxGlobalMemories: 5,
  similarityThreshold: 0.6,
});

/**
 * Admin-only auth middleware with full memory access
 */
export const adminAuth = createMemoryAuthMiddleware({
  requireAuth: true,
  requireMemoryAccess: true,
  allowedRoles: ['admin'],
  requiredPermissions: ['admin_access'],
  enableContextInjection: true,
  maxUserMemories: 10,
  maxGlobalMemories: 10,
  similarityThreshold: 0.5,
});

/**
 * Memory management auth middleware
 * For memory-related API endpoints
 */
export const memoryManagementAuth = createMemoryAuthMiddleware({
  requireAuth: true,
  requireMemoryAccess: true,
  enableContextInjection: false, // Don't inject context when managing memory
});

/**
 * Read-only auth middleware
 * For endpoints that only need to read memory context
 */
export const readOnlyMemoryAuth = createMemoryAuthMiddleware({
  requireAuth: true,
  requireMemoryAccess: false,
  enableContextInjection: true,
  maxUserMemories: 3,
  maxGlobalMemories: 2,
  similarityThreshold: 0.75,
});

/**
 * Optional auth middleware
 * Injects memory context if user is authenticated, but doesn't require it
 */
export const optionalMemoryAuth = createMemoryAuthMiddleware({
  requireAuth: false,
  requireMemoryAccess: false,
  enableContextInjection: true,
  maxUserMemories: 3,
  maxGlobalMemories: 2,
  similarityThreshold: 0.8,
});

/**
 * Helper function to check if user has specific memory permissions
 */
export function hasMemoryPermission(req: Request, permission: string): boolean {
  const user = req.user as EnhancedAuthContext;
  if (!user) return false;

  // Admin always has all permissions
  if (user.role === 'admin') return true;

  // Check specific permissions
  return user.permissions.includes(permission);
}

/**
 * Helper function to check if memory context is available
 */
export function hasMemoryContext(req: Request): boolean {
  const memoryContext = extractMemoryContext(req);
  return memoryContext ? memoryContext.totalContextItems > 0 : false;
}

/**
 * Helper function to get user's memory access level
 */
export function getMemoryAccessLevel(req: Request): 'none' | 'read' | 'write' | 'admin' {
  const user = req.user as EnhancedAuthContext;
  if (!user) return 'none';

  if (user.role === 'admin' || user.permissions.includes('global_memory_write')) {
    return 'admin';
  }

  if (user.permissions.includes('user_memory_write')) {
    return 'write';
  }

  if (user.userId) {
    return 'read';
  }

  return 'none';
}

/**
 * Middleware to enhance request context with memory access information
 */
export function enhanceRequestContext(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    const accessLevel = getMemoryAccessLevel(req);
    const hasContext = hasMemoryContext(req);

    (req as any).memoryAccess = {
      level: accessLevel,
      hasContext,
      canWrite: accessLevel === 'write' || accessLevel === 'admin',
      canWriteGlobal: accessLevel === 'admin',
      contextInjected: hasContext,
    };

    authLogger.debug('Request context enhanced', {
      user_id: req.user.userId,
      memory_access_level: accessLevel,
      has_memory_context: hasContext,
      path: req.path,
    });
  }

  next();
}

/**
 * Express middleware chain for complete memory-aware authentication
 */
export const fullMemoryAuthChain = [
  businessIntelligenceAuth,
  enhanceRequestContext,
];

export default createMemoryAuthMiddleware;