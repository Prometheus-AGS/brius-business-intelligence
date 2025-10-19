/**
 * Conversation Context Management
 * Provides session continuity, conversation state tracking, and context persistence
 * Integrates with memory system for maintaining conversational context across sessions
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { userMemoryOps } from '../memory/operations.js';
import { extractMemoryContext } from '../memory/middleware.js';
import { apiLogger } from '../observability/logger.js';
import { APITracer } from '../observability/tracing.js';

/**
 * Conversation state and context management
 */
export interface ConversationState {
  id: string;
  userId: string;
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  currentTopic?: string;
  context: ConversationContext;
  metadata: Record<string, any>;
}

export interface ConversationContext {
  userPreferences: {
    responseStyle?: 'brief' | 'detailed' | 'technical';
    preferredFormat?: 'text' | 'json' | 'structured';
    analysisDepth?: 'quick' | 'standard' | 'comprehensive';
    notificationPreferences?: Record<string, boolean>;
  };
  currentAnalysis: {
    domain?: string;
    metrics?: string[];
    timeframe?: string;
    dataFilters?: Record<string, any>;
    lastQueries?: string[];
  };
  businessContext: {
    role?: string;
    department?: string;
    keyMetrics?: string[];
    accessLevel?: 'basic' | 'advanced' | 'admin';
  };
  sessionMemory: {
    recentInsights?: string[];
    mentionedEntities?: string[];
    decisions?: string[];
    followUpItems?: string[];
  };
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    agent?: string;
    tools_used?: string[];
    processing_time_ms?: number;
    memory_context_used?: boolean;
    confidence_score?: number;
  };
}

// Validation schemas
const CreateConversationSchema = z.object({
  sessionId: z.string().optional(),
  initialContext: z.object({
    domain: z.string().optional(),
    role: z.string().optional(),
    preferences: z.record(z.any()).optional(),
  }).optional(),
});

const UpdateConversationSchema = z.object({
  topic: z.string().optional(),
  context: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

const AddMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

/**
 * In-memory conversation storage (should be replaced with persistent storage in production)
 */
class ConversationStore {
  private conversations = new Map<string, ConversationState>();
  private userConversations = new Map<string, string[]>();
  private messages = new Map<string, ConversationMessage[]>();

  /**
   * Create a new conversation
   */
  async createConversation(
    userId: string,
    sessionId?: string,
    initialContext?: Partial<ConversationContext>
  ): Promise<ConversationState> {
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const actualSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const conversation: ConversationState = {
      id: conversationId,
      userId,
      sessionId: actualSessionId,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      messageCount: 0,
      context: {
        userPreferences: initialContext?.userPreferences || {},
        currentAnalysis: initialContext?.currentAnalysis || {},
        businessContext: initialContext?.businessContext || {},
        sessionMemory: initialContext?.sessionMemory || {},
      },
      metadata: {
        created_via: 'conversation_api',
        version: '1.0',
      },
    };

    this.conversations.set(conversationId, conversation);

    // Track user conversations
    const userConvs = this.userConversations.get(userId) || [];
    userConvs.push(conversationId);
    this.userConversations.set(userId, userConvs);

    // Initialize empty message history
    this.messages.set(conversationId, []);

    return conversation;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string, userId: string): Promise<ConversationState | null> {
    const conversation = this.conversations.get(conversationId);
    return conversation && conversation.userId === userId ? conversation : null;
  }

  /**
   * Update conversation state
   */
  async updateConversation(
    conversationId: string,
    updates: Partial<ConversationState>
  ): Promise<ConversationState | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;

    const updatedConversation = {
      ...conversation,
      ...updates,
      lastActivityAt: new Date().toISOString(),
    };

    this.conversations.set(conversationId, updatedConversation);
    return updatedConversation;
  }

  /**
   * Add message to conversation
   */
  async addMessage(conversationId: string, message: Omit<ConversationMessage, 'id' | 'conversationId' | 'timestamp'>): Promise<ConversationMessage> {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullMessage: ConversationMessage = {
      id: messageId,
      conversationId,
      timestamp: new Date().toISOString(),
      ...message,
    };

    const messages = this.messages.get(conversationId) || [];
    messages.push(fullMessage);
    this.messages.set(conversationId, messages);

    // Update conversation message count and activity
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.messageCount = messages.length;
      conversation.lastActivityAt = fullMessage.timestamp;
      this.conversations.set(conversationId, conversation);
    }

    return fullMessage;
  }

  /**
   * Get conversation messages
   */
  async getMessages(conversationId: string, limit?: number, offset?: number): Promise<ConversationMessage[]> {
    const messages = this.messages.get(conversationId) || [];
    const start = offset || 0;
    const end = limit ? start + limit : undefined;
    return messages.slice(start, end);
  }

  /**
   * Get user conversations
   */
  async getUserConversations(userId: string, limit?: number): Promise<ConversationState[]> {
    const conversationIds = this.userConversations.get(userId) || [];
    const conversations = conversationIds
      .map(id => this.conversations.get(id))
      .filter(Boolean) as ConversationState[];

    // Sort by last activity (most recent first)
    conversations.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

    return limit ? conversations.slice(0, limit) : conversations;
  }

  /**
   * Delete conversation
   */
  async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.userId !== userId) {
      return false;
    }

    this.conversations.delete(conversationId);
    this.messages.delete(conversationId);

    // Remove from user conversations
    const userConvs = this.userConversations.get(userId) || [];
    const updatedUserConvs = userConvs.filter(id => id !== conversationId);
    this.userConversations.set(userId, updatedUserConvs);

    return true;
  }
}

// Singleton conversation store
export const conversationStore = new ConversationStore();

/**
 * Create new conversation
 * POST /api/conversations
 */
export async function createConversation(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/conversations', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to create conversation',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const validationResult = CreateConversationSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid request body',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { sessionId, initialContext } = validationResult.data;

    apiLogger.info('Creating new conversation', {
      user_id: req.user.userId,
      session_id: sessionId,
      has_initial_context: Boolean(initialContext),
      trace_id: tracer.getTraceId(),
    });

    const conversation = await conversationStore.createConversation(
      req.user.userId,
      sessionId,
      initialContext
    );

    // Store conversation creation in user memory for context
    try {
      await userMemoryOps.store({
        userId: req.user.userId,
        content: `Started new conversation with ID ${conversation.id}${initialContext?.domain ? ` about ${initialContext.domain}` : ''}`,
        category: 'conversation',
        importance: 'low',
        metadata: {
          conversation_id: conversation.id,
          session_id: conversation.sessionId,
          domain: initialContext?.domain,
          created_at: conversation.startedAt,
        },
      });
    } catch (memoryError) {
      apiLogger.warn('Failed to store conversation memory', {
        user_id: req.user.userId,
        conversation_id: conversation.id,
        error: memoryError instanceof Error ? memoryError.message : String(memoryError),
      });
    }

    const response = {
      success: true,
      data: conversation,
      message: 'Conversation created successfully',
    };

    tracer.complete(response);
    res.status(201).json(response);

    apiLogger.info('Conversation created successfully', {
      user_id: req.user.userId,
      conversation_id: conversation.id,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to create conversation', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to create conversation',
        type: 'internal_server_error',
        code: 'creation_error',
      },
    });
  }
}

/**
 * Get conversation details
 * GET /api/conversations/:id
 */
export async function getConversation(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/conversations/${req.params.id}`, 'GET', {
    userId: req.user?.userId,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access conversation',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({
        error: {
          message: 'Conversation ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing conversation ID'), 400);
      return;
    }

    const conversation = await conversationStore.getConversation(conversationId, req.user.userId);
    if (!conversation) {
      res.status(404).json({
        error: {
          message: 'Conversation not found',
          type: 'not_found_error',
          code: 'conversation_not_found',
        },
      });
      tracer.fail(new Error('Conversation not found'), 404);
      return;
    }

    // Get memory context for this conversation
    const memoryContext = extractMemoryContext(req);

    const response = {
      success: true,
      data: {
        ...conversation,
        memory_context: memoryContext,
      },
      message: 'Conversation retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Conversation retrieved successfully', {
      user_id: req.user.userId,
      conversation_id: conversationId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get conversation', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve conversation',
        type: 'internal_server_error',
        code: 'retrieval_error',
      },
    });
  }
}

/**
 * Update conversation context
 * PUT /api/conversations/:id
 */
export async function updateConversation(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/conversations/${req.params.id}`, 'PUT', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to update conversation',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({
        error: {
          message: 'Conversation ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing conversation ID'), 400);
      return;
    }

    const validationResult = UpdateConversationSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid update parameters',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const updates = validationResult.data;

    // Check if conversation exists and belongs to user
    const existingConversation = await conversationStore.getConversation(conversationId, req.user.userId);
    if (!existingConversation) {
      res.status(404).json({
        error: {
          message: 'Conversation not found',
          type: 'not_found_error',
          code: 'conversation_not_found',
        },
      });
      tracer.fail(new Error('Conversation not found'), 404);
      return;
    }

    // Update conversation
    const updatedConversation = await conversationStore.updateConversation(conversationId, {
      currentTopic: updates.topic,
      context: updates.context ? { ...existingConversation.context, ...updates.context } : existingConversation.context,
      metadata: updates.metadata ? { ...existingConversation.metadata, ...updates.metadata } : existingConversation.metadata,
    });

    const response = {
      success: true,
      data: updatedConversation,
      message: 'Conversation updated successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Conversation updated successfully', {
      user_id: req.user.userId,
      conversation_id: conversationId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to update conversation', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to update conversation',
        type: 'internal_server_error',
        code: 'update_error',
      },
    });
  }
}

/**
 * Add message to conversation
 * POST /api/conversations/:id/messages
 */
export async function addMessage(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/conversations/${req.params.id}/messages`, 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to add message',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({
        error: {
          message: 'Conversation ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing conversation ID'), 400);
      return;
    }

    const validationResult = AddMessageSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid message data',
          type: 'validation_error',
          code: 'invalid_input',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const messageData = validationResult.data;

    // Check if conversation exists and belongs to user
    const conversation = await conversationStore.getConversation(conversationId, req.user.userId);
    if (!conversation) {
      res.status(404).json({
        error: {
          message: 'Conversation not found',
          type: 'not_found_error',
          code: 'conversation_not_found',
        },
      });
      tracer.fail(new Error('Conversation not found'), 404);
      return;
    }

    // Add message to conversation
    const message = await conversationStore.addMessage(conversationId, messageData);

    const response = {
      success: true,
      data: message,
      message: 'Message added successfully',
    };

    tracer.complete(response);
    res.status(201).json(response);

    apiLogger.info('Message added to conversation', {
      user_id: req.user.userId,
      conversation_id: conversationId,
      message_id: message.id,
      role: message.role,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to add message', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to add message',
        type: 'internal_server_error',
        code: 'message_error',
      },
    });
  }
}

/**
 * Get conversation messages
 * GET /api/conversations/:id/messages
 */
export async function getMessages(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/conversations/${req.params.id}/messages`, 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access messages',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({
        error: {
          message: 'Conversation ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing conversation ID'), 400);
      return;
    }

    // Check if conversation exists and belongs to user
    const conversation = await conversationStore.getConversation(conversationId, req.user.userId);
    if (!conversation) {
      res.status(404).json({
        error: {
          message: 'Conversation not found',
          type: 'not_found_error',
          code: 'conversation_not_found',
        },
      });
      tracer.fail(new Error('Conversation not found'), 404);
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const messages = await conversationStore.getMessages(conversationId, limit, offset);

    const response = {
      success: true,
      data: {
        messages,
        conversation_id: conversationId,
        total_messages: conversation.messageCount,
        pagination: {
          limit: limit || messages.length,
          offset: offset || 0,
          has_more: limit ? messages.length === limit : false,
        },
      },
      message: `Retrieved ${messages.length} messages`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Messages retrieved successfully', {
      user_id: req.user.userId,
      conversation_id: conversationId,
      messages_count: messages.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get messages', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve messages',
        type: 'internal_server_error',
        code: 'retrieval_error',
      },
    });
  }
}

/**
 * Get user conversations
 * GET /api/conversations
 */
export async function getUserConversations(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/conversations', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to access conversations',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const conversations = await conversationStore.getUserConversations(req.user.userId, limit);

    const response = {
      success: true,
      data: {
        conversations,
        total_found: conversations.length,
        user_id: req.user.userId,
      },
      message: `Retrieved ${conversations.length} conversations`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('User conversations retrieved successfully', {
      user_id: req.user.userId,
      conversations_count: conversations.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get user conversations', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve conversations',
        type: 'internal_server_error',
        code: 'retrieval_error',
      },
    });
  }
}

/**
 * Delete conversation
 * DELETE /api/conversations/:id
 */
export async function deleteConversation(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/conversations/${req.params.id}`, 'DELETE', {
    userId: req.user?.userId,
  });

  try {
    if (!req.user?.userId) {
      tracer.recordAuth(false);
      res.status(401).json({
        error: {
          message: 'Authentication required to delete conversation',
          type: 'authentication_error',
          code: 'unauthorized',
        },
      });
      tracer.fail(new Error('Authentication required'), 401);
      return;
    }

    tracer.recordAuth(true, req.user.userId);

    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({
        error: {
          message: 'Conversation ID is required',
          type: 'validation_error',
          code: 'missing_parameter',
        },
      });
      tracer.fail(new Error('Missing conversation ID'), 400);
      return;
    }

    const deleted = await conversationStore.deleteConversation(conversationId, req.user.userId);
    if (!deleted) {
      res.status(404).json({
        error: {
          message: 'Conversation not found',
          type: 'not_found_error',
          code: 'conversation_not_found',
        },
      });
      tracer.fail(new Error('Conversation not found'), 404);
      return;
    }

    const response = {
      success: true,
      message: 'Conversation deleted successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Conversation deleted successfully', {
      user_id: req.user.userId,
      conversation_id: conversationId,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to delete conversation', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to delete conversation',
        type: 'internal_server_error',
        code: 'deletion_error',
      },
    });
  }
}

/**
 * Helper function to extract conversation context for agents
 */
export function extractConversationContext(conversationId: string): Promise<ConversationState | null> {
  return conversationStore.getConversation(conversationId, ''); // This would need proper user validation in practice
}

/**
 * Helper function to update conversation with analysis results
 */
export async function updateConversationWithAnalysis(
  conversationId: string,
  analysis: {
    domain?: string;
    metrics?: string[];
    insights?: string[];
    decisions?: string[];
  }
): Promise<void> {
  await conversationStore.updateConversation(conversationId, {
    context: {
      userPreferences: {},
      currentAnalysis: {
        domain: analysis.domain,
        metrics: analysis.metrics,
      },
      businessContext: {},
      sessionMemory: {
        recentInsights: analysis.insights,
        decisions: analysis.decisions,
      },
    },
  });
}