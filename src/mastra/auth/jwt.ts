import { z } from 'zod';
import { env } from '../config/environment.js';
import { JWTPayload, AuthContext } from '../types/index.js';

/**
 * JWT Authentication and Validation
 * Validates Supabase JWT tokens and extracts user context
 */

// Simple JWT decode without verification for development
// In production, use proper JWT verification with the secret
function decodeJWT(token: string): JWTPayload | null {
  try {
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, '');

    // Split the JWT into parts
    const parts = cleanToken.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );

    // Validate the payload structure
    const validatedPayload = JWTPayload.parse(payload);

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (validatedPayload.exp < now) {
      return null;
    }

    return validatedPayload;
  } catch (error) {
    console.error('JWT decode error:', error);
    return null;
  }
}

/**
 * Validates JWT token and returns auth context
 */
export function validateJWT(token: string): AuthContext | null {
  if (!token) {
    return null;
  }

  const payload = decodeJWT(token);
  if (!payload) {
    return null;
  }

  return {
    user_id: payload.sub,
    email: payload.email,
    role: payload.role,
    is_authenticated: true,
    jwt_payload: payload,
  };
}

/**
 * Creates anonymous auth context for unauthenticated requests
 */
export function createAnonymousContext(): AuthContext {
  return {
    user_id: 'anonymous',
    is_authenticated: false,
  };
}

/**
 * Express middleware for JWT authentication
 * Supports optional authentication (continues with anonymous context if no token)
 */
export function jwtMiddleware(options: { required?: boolean } = {}) {
  return (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    let authContext: AuthContext | null = null;

    if (authHeader) {
      authContext = validateJWT(authHeader);

      if (!authContext && options.required) {
        return res.status(401).json({
          error: {
            message: 'Invalid or expired JWT token',
            code: 'INVALID_JWT',
          },
        });
      }
    }

    // If no valid auth and required, return 401
    if (!authContext && options.required) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        },
      });
    }

    // Set auth context (authenticated or anonymous)
    req.auth = authContext || createAnonymousContext();
    next();
  };
}

/**
 * Helper to check if user has admin role
 */
export function isAdmin(authContext: AuthContext): boolean {
  return authContext.is_authenticated && authContext.role === 'admin';
}

/**
 * Helper to check if user has service role
 */
export function isServiceRole(authContext: AuthContext): boolean {
  return authContext.is_authenticated && authContext.role === 'service_role';
}

/**
 * Helper to get user ID from auth context
 */
export function getUserId(authContext: AuthContext): string {
  return authContext.user_id;
}

/**
 * Middleware that requires admin role
 */
export function requireAdmin() {
  return (req: any, res: any, next: any) => {
    if (!req.auth || !isAdmin(req.auth)) {
      return res.status(403).json({
        error: {
          message: 'Admin access required',
          code: 'ADMIN_REQUIRED',
        },
      });
    }
    next();
  };
}

/**
 * Middleware that requires authenticated user
 */
export function requireAuth() {
  return jwtMiddleware({ required: true });
}

/**
 * Middleware that supports optional authentication
 */
export function optionalAuth() {
  return jwtMiddleware({ required: false });
}