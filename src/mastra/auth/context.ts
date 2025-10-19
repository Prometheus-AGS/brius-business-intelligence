import { z } from 'zod';
import { AuthContext, RequestContext } from '../types/index.js';
import { randomUUID } from 'crypto';

/**
 * User Context Management
 * Manages request context, session state, and user preferences
 */

/**
 * Creates a new request context for incoming requests
 */
export function createRequestContext(
  authContext: AuthContext,
  options: {
    userAgent?: string;
    ipAddress?: string;
    sessionId?: string;
    conversationId?: string;
  } = {}
): RequestContext {
  return {
    request_id: randomUUID(),
    user_agent: options.userAgent,
    ip_address: options.ipAddress,
    timestamp: new Date().toISOString(),
    auth: authContext,
    session_id: options.sessionId,
    conversation_id: options.conversationId,
  };
}

/**
 * Session management for conversation continuity
 */
export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private readonly maxSessions = 10000;
  private readonly sessionTtlMs = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Clean up expired sessions every 5 minutes
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
  }

  /**
   * Creates or retrieves a session
   */
  getOrCreateSession(
    sessionId: string,
    userId?: string
  ): SessionData {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        id: sessionId,
        userId,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        preferences: {},
        conversationHistory: [],
        context: {},
      };

      // Prevent memory leaks by limiting sessions
      if (this.sessions.size >= this.maxSessions) {
        this.evictOldestSession();
      }

      this.sessions.set(sessionId, session);
    } else {
      session.lastAccessedAt = Date.now();
    }

    return session;
  }

  /**
   * Updates session data
   */
  updateSession(sessionId: string, updates: Partial<SessionData>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      session.lastAccessedAt = Date.now();
    }
  }

  /**
   * Adds a message to conversation history
   */
  addToConversationHistory(
    sessionId: string,
    message: ConversationMessage
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationHistory.push({
        ...message,
        timestamp: Date.now(),
      });

      // Keep only last 50 messages to prevent memory issues
      if (session.conversationHistory.length > 50) {
        session.conversationHistory = session.conversationHistory.slice(-50);
      }

      session.lastAccessedAt = Date.now();
    }
  }

  /**
   * Sets user preferences
   */
  setPreferences(sessionId: string, preferences: Record<string, any>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.preferences = { ...session.preferences, ...preferences };
      session.lastAccessedAt = Date.now();
    }
  }

  /**
   * Gets user preferences
   */
  getPreferences(sessionId: string): Record<string, any> {
    const session = this.sessions.get(sessionId);
    return session?.preferences || {};
  }

  /**
   * Removes a session
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Gets session statistics
   */
  getStats(): SessionStats {
    const now = Date.now();
    let activeSessions = 0;

    for (const session of this.sessions.values()) {
      if (now - session.lastAccessedAt < this.sessionTtlMs) {
        activeSessions++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      memoryUsageEstimateMB: (this.sessions.size * 0.01), // Rough estimate
    };
  }

  /**
   * Cleans up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccessedAt > this.sessionTtlMs) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  /**
   * Evicts the oldest session to prevent memory leaks
   */
  private evictOldestSession(): void {
    let oldestSessionId: string | null = null;
    let oldestTime = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastAccessedAt < oldestTime) {
        oldestTime = session.lastAccessedAt;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId) {
      this.sessions.delete(oldestSessionId);
    }
  }
}

// Types for session management
interface SessionData {
  id: string;
  userId?: string;
  createdAt: number;
  lastAccessedAt: number;
  preferences: Record<string, any>;
  conversationHistory: ConversationMessage[];
  context: Record<string, any>;
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  memoryUsageEstimateMB: number;
}

// Global session manager instance
export const sessionManager = new SessionManager();

/**
 * Express middleware to attach session context
 */
export function sessionMiddleware() {
  return (req: any, res: any, next: any) => {
    // Get or create session ID
    let sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;

    if (!sessionId) {
      sessionId = randomUUID();
      // Set session cookie
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000, // 30 minutes
      });
    }

    // Get or create session
    const session = sessionManager.getOrCreateSession(
      sessionId,
      req.auth?.user_id
    );

    // Attach session to request
    req.session = session;
    req.sessionId = sessionId;

    next();
  };
}

/**
 * Helper to get user preferences from request
 */
export function getUserPreferences(req: any): Record<string, any> {
  return req.session?.preferences || {};
}

/**
 * Helper to set user preferences in request
 */
export function setUserPreferences(
  req: any,
  preferences: Record<string, any>
): void {
  if (req.sessionId) {
    sessionManager.setPreferences(req.sessionId, preferences);
  }
}

/**
 * Helper to add conversation message
 */
export function addConversationMessage(
  req: any,
  message: ConversationMessage
): void {
  if (req.sessionId) {
    sessionManager.addToConversationHistory(req.sessionId, message);
  }
}