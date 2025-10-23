import jwt from 'jsonwebtoken';
import type { Context, Next } from 'hono';
import {
  UserContext,
  AnonymousContext,
  PermissionMatrix,
  UserPreferences,
  DEFAULT_ANONYMOUS_PERMISSIONS,
  DEFAULT_USER_PREFERENCES,
  ANONYMOUS_USER_ID,
  DEFAULT_SESSION_TIMEOUT,
  DEFAULT_REFRESH_THRESHOLD,
} from '../../types/context.js';
import { JWTError, SessionError, ErrorHandler } from '../../utils/errors.js';
import { validateEnvironment } from '../../utils/validation.js';
import { RuntimeContext } from '@mastra/core/runtime-context';

/**
 * JWT Context Middleware for Business Intelligence Context Enhancement
 * Supports both authenticated users and anonymous access using SUPABASE_ANON_KEY
 * Uses Mastra/Hono patterns (NOT Express)
 */

interface JWTPayload {
  sub: string; // userId
  role: string;
  departments?: string[];
  permissions?: PermissionMatrix;
  iat: number;
  exp: number;
  // Additional custom claims
  [key: string]: any;
}

interface AuthContext {
  userId: string;
  role: string;
  permissions: PermissionMatrix;
  sessionId: string;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  userContext: UserContext | AnonymousContext;
}

/**
 * JWT Authentication Middleware (Mastra/Hono compatible)
 */
export function jwtAuth() {
  return async (c: Context, next: Next) => {
    try {
      const authHeader = c.req.header('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

      if (!token) {
        return c.json({ error: 'Authentication required' }, 401);
      }

      const userContext = extractUserContext(token);
      const authContext = createAuthContext(userContext, true, false);

      // Set context in Hono
      c.set('auth', authContext);
      c.set('userContext', userContext);
      c.set('sessionId', userContext.sessionId);
      c.set('userId', userContext.userId);

      await next();
    } catch (error) {
      const errorResponse = ErrorHandler.handleApiError(error);
      return c.json({
        error: errorResponse.error,
        message: errorResponse.message,
        code: errorResponse.code,
      }, errorResponse.statusCode);
    }
  };
}

/**
 * Optional JWT Authentication (allows anonymous access with SUPABASE_ANON_KEY fallback)
 */
export function optionalJwtAuth() {
  return async (c: Context, next: Next) => {
    try {
      const authHeader = c.req.header('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

      let userContext: UserContext | AnonymousContext;
      let isAuthenticated: boolean;
      let isAnonymous: boolean;

      if (token) {
        try {
          userContext = extractUserContext(token);
          isAuthenticated = true;
          isAnonymous = false;
        } catch (error) {
          // Invalid token - fallback to anonymous
          userContext = createAnonymousContext();
          isAuthenticated = false;
          isAnonymous = true;
        }
      } else {
        // No token - use anonymous context
        userContext = createAnonymousContext();
        isAuthenticated = false;
        isAnonymous = true;
      }

      const authContext = createAuthContext(userContext, isAuthenticated, isAnonymous);

      // Set context in Hono
      c.set('auth', authContext);
      c.set('userContext', userContext);
      c.set('sessionId', userContext.sessionId);
      c.set('userId', userContext.userId);
      c.set('isAuthenticated', isAuthenticated);
      c.set('isAnonymous', isAnonymous);

      await next();
    } catch (error) {
      // For optional auth, we continue with anonymous on error
      const anonymousContext = createAnonymousContext();
      const authContext = createAuthContext(anonymousContext, false, true);

      c.set('auth', authContext);
      c.set('userContext', anonymousContext);
      c.set('sessionId', anonymousContext.sessionId);
      c.set('userId', anonymousContext.userId);
      c.set('isAuthenticated', false);
      c.set('isAnonymous', true);

      await next();
    }
  };
}

/**
 * Extract user context from JWT token
 */
export function extractUserContext(token: string): UserContext {
  const envValidation = validateEnvironment();
  if (!envValidation.success) {
    throw new JWTError('Invalid environment configuration');
  }

  const jwtSecret = envValidation.data.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

    // Validate token expiry
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) {
      throw new JWTError('Token has expired', { tokenExpiry: decoded.exp, currentTime: now });
    }

    // Extract user information from JWT claims
    const userId = decoded.sub;
    const roleId = decoded.role || 'user';
    const departmentScope = decoded.departments || [];
    const permissions = decoded.permissions || getDefaultPermissions(roleId);

    return {
      userId,
      sessionId: generateSessionId(),
      roleId,
      departmentScope,
      permissions,
      preferences: decoded.preferences || DEFAULT_USER_PREFERENCES,
      lastActivity: new Date(),
      tokenExpiry: new Date(decoded.exp * 1000),
      isAnonymous: false,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new JWTError(`Invalid JWT token: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create anonymous context using SUPABASE_ANON_KEY
 */
export function createAnonymousContext(): AnonymousContext {
  const envValidation = validateEnvironment();
  if (!envValidation.success) {
    throw new SessionError('Invalid environment configuration for anonymous access');
  }

  const supabaseAnonKey = envValidation.data.SUPABASE_ANON_KEY;
  if (!supabaseAnonKey) {
    throw new SessionError('SUPABASE_ANON_KEY not configured for anonymous access');
  }

  // Create session expiry based on default timeout
  const sessionTimeout = envValidation.data.CONTEXT_SESSION_TIMEOUT || DEFAULT_SESSION_TIMEOUT;
  const tokenExpiry = new Date(Date.now() + sessionTimeout);

  return {
    userId: ANONYMOUS_USER_ID,
    sessionId: generateSessionId(),
    roleId: 'anonymous',
    departmentScope: [],
    permissions: DEFAULT_ANONYMOUS_PERMISSIONS,
    preferences: DEFAULT_USER_PREFERENCES,
    lastActivity: new Date(),
    tokenExpiry,
    isAnonymous: true,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Get default permissions based on role
 */
function getDefaultPermissions(roleId: string): PermissionMatrix {
  switch (roleId) {
    case 'admin':
      return {
        clinical: { read: true, query: true, export: true },
        financial: { read: true, query: true, export: true },
        operational: { read: true, query: true, export: true },
        'customer-service': { read: true, query: true, export: true },
      };
    case 'analyst':
      return {
        clinical: { read: true, query: true, export: false },
        financial: { read: true, query: true, export: false },
        operational: { read: true, query: true, export: true },
        'customer-service': { read: true, query: true, export: true },
      };
    case 'manager':
      return {
        clinical: { read: true, query: false, export: false },
        financial: { read: true, query: true, export: true },
        operational: { read: true, query: true, export: true },
        'customer-service': { read: true, query: true, export: true },
      };
    default:
      return DEFAULT_ANONYMOUS_PERMISSIONS;
  }
}

/**
 * JWT token refresh functionality
 */
export async function refreshJWTToken(userId: string): Promise<string> {
  const envValidation = validateEnvironment();
  if (!envValidation.success) {
    throw new JWTError('Invalid environment configuration for token refresh');
  }

  const { JWT_SECRET, JWT_EXPIRY } = envValidation.data;

  try {
    // In a real application, you would fetch user data from database
    // For now, we'll create a basic token with the userId
    const payload: Partial<JWTPayload> = {
      sub: userId,
      role: 'analyst', // This should be fetched from user profile
      iat: Math.floor(Date.now() / 1000),
    };

    const newToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    return newToken;
  } catch (error) {
    throw new JWTError(`Failed to refresh token: ${(error as Error).message}`);
  }
}

/**
 * Background token refresh service
 */
export class TokenRefreshService {
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Schedule automatic token refresh for a session
   */
  scheduleRefresh(sessionId: string, context: UserContext): void {
    if (context.isAnonymous) {
      return; // Anonymous sessions don't need token refresh
    }

    // Clear existing timer if any
    this.clearRefresh(sessionId);

    const now = Date.now();
    const expiry = context.tokenExpiry.getTime();
    const refreshThreshold = DEFAULT_REFRESH_THRESHOLD;
    const timeUntilRefresh = expiry - now - refreshThreshold;

    if (timeUntilRefresh > 0) {
      const timer = setTimeout(async () => {
        try {
          await this.performRefresh(sessionId, context.userId);
        } catch (error) {
          console.error(`Failed to refresh token for session ${sessionId}:`, error);
          // Context reconstruction would be triggered by the next request
        }
      }, timeUntilRefresh);

      this.refreshTimers.set(sessionId, timer);
    }
  }

  /**
   * Perform token refresh
   */
  private async performRefresh(sessionId: string, userId: string): Promise<void> {
    try {
      const newToken = await refreshJWTToken(userId);
      // In a full implementation, you would update the user's session store
      console.log(`Token refreshed for session ${sessionId}`);
    } catch (error) {
      throw new JWTError(`Token refresh failed for session ${sessionId}: ${(error as Error).message}`);
    }
  }

  /**
   * Clear refresh timer for a session
   */
  clearRefresh(sessionId: string): void {
    const timer = this.refreshTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(sessionId);
    }
  }

  /**
   * Clear all refresh timers
   */
  clearAllRefresh(): void {
    this.refreshTimers.forEach(timer => clearTimeout(timer));
    this.refreshTimers.clear();
  }
}

// Global instance for token refresh service
export const tokenRefreshService = new TokenRefreshService();

/**
 * Helper function to create auth context object
 */
function createAuthContext(
  userContext: UserContext | AnonymousContext,
  isAuthenticated: boolean,
  isAnonymous: boolean
): AuthContext {
  return {
    userId: userContext.userId,
    role: userContext.roleId,
    permissions: userContext.permissions,
    sessionId: userContext.sessionId,
    isAuthenticated,
    isAnonymous,
    userContext,
  };
}

/**
 * Middleware to require authentication (rejects anonymous users) - Hono version
 */
export function requireAuthentication() {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext;
    const isAuthenticated = c.get('isAuthenticated') as boolean;
    const isAnonymous = c.get('isAnonymous') as boolean;

    if (!isAuthenticated || isAnonymous) {
      return c.json({
        error: 'Authentication required for this operation',
        code: 'AUTH_REQUIRED'
      }, 401);
    }

    await next();
  };
}

/**
 * Middleware to require specific permissions - Hono version
 */
export function requirePermissions(domain: keyof PermissionMatrix, action: string) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext;

    if (!auth || !auth.userContext) {
      return c.json({
        error: 'Context not found',
        code: 'CONTEXT_ERROR'
      }, 400);
    }

    const domainPermissions = auth.permissions[domain] as any;
    if (!domainPermissions || !domainPermissions[action]) {
      return c.json({
        error: `Insufficient permissions for ${domain}:${action}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      }, 403);
    }

    await next();
  };
}

/**
 * Middleware to require specific role - Hono version
 */
export function requireRole(...allowedRoles: string[]) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext;

    if (!auth || !auth.isAuthenticated) {
      return c.json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      }, 401);
    }

    if (!allowedRoles.includes(auth.role)) {
      return c.json({
        error: `Role ${auth.role} not authorized. Required: ${allowedRoles.join(', ')}`,
        code: 'ROLE_NOT_AUTHORIZED'
      }, 403);
    }

    await next();
  };
}

/**
 * Create RuntimeContext for Mastra agents and workflows
 */
export function createRuntimeContext(c: Context): RuntimeContext {
  const auth = c.get('auth') as AuthContext;
  const userContext = c.get('userContext') as UserContext | AnonymousContext;

  return new RuntimeContext({
    userId: auth.userId,
    sessionId: auth.sessionId,
    role: auth.role,
    permissions: auth.permissions,
    isAuthenticated: auth.isAuthenticated,
    isAnonymous: auth.isAnonymous,
    departmentScope: userContext.isAnonymous ? [] : (userContext as UserContext).departmentScope,
    preferences: userContext.preferences,
    requestId: c.get('requestId') || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Utility functions
 */
export function isAuthenticated(context: UserContext | AnonymousContext): context is UserContext {
  return !context.isAnonymous;
}

export function hasPermission(
  context: UserContext | AnonymousContext,
  domain: keyof PermissionMatrix,
  action: string
): boolean {
  const domainPermissions = context.permissions[domain] as any;
  return domainPermissions?.[action] || false;
}

export function isDepartmentAuthorized(
  context: UserContext | AnonymousContext,
  department: string
): boolean {
  if (context.isAnonymous) {
    return false; // Anonymous users have no department access
  }
  return (context as UserContext).departmentScope.includes(department);
}

/**
 * Helper to extract auth context from Hono context
 */
export function getAuthContext(c: Context): AuthContext {
  const auth = c.get('auth') as AuthContext;
  if (!auth) {
    throw new JWTError('Authentication context not found');
  }
  return auth;
}

/**
 * Helper to get user context from Hono context
 */
export function getUserContext(c: Context): UserContext | AnonymousContext {
  const userContext = c.get('userContext') as UserContext | AnonymousContext;
  if (!userContext) {
    throw new SessionError('User context not found');
  }
  return userContext;
}