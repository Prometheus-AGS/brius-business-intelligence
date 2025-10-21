import { Request, Response, NextFunction } from 'express';
import { userMemoryOps, globalMemoryOps, MemorySearchResult } from './operations.js';
import { memoryLogger } from '../observability/logger.js';
import { AuthContext } from '../types/index.js';

/**
 * Memory Injection Middleware
 * Automatically injects relevant user and global memory context
 * into requests for intelligent agents and workflows
 */

export interface MemoryContext {
  userMemories: MemorySearchResult[];
  globalMemories: MemorySearchResult[];
  totalContextItems: number;
  contextSummary?: string;
}

export interface MemoryMiddlewareOptions {
  maxUserMemories?: number;
  maxGlobalMemories?: number;
  similarityThreshold?: number;
  categories?: string[];
  enableContextSummary?: boolean;
  skipRoutes?: string[];
  requireAuth?: boolean;
}

const DEFAULT_OPTIONS: Required<MemoryMiddlewareOptions> = {
  maxUserMemories: 5,
  maxGlobalMemories: 3,
  similarityThreshold: 0.7,
  categories: [],
  enableContextSummary: true,
  skipRoutes: ['/health', '/metrics', '/docs'],
  requireAuth: false,
};

/**
 * Memory injection middleware factory
 */
export function createMemoryMiddleware(
  options: MemoryMiddlewareOptions = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip memory injection for excluded routes
      if (config.skipRoutes.some(route => req.path.startsWith(route))) {
        return next();
      }

      // Skip if no query content to search against
      const queryContent = extractQueryContent(req);
      if (!queryContent) {
        return next();
      }

      memoryLogger.info('Memory injection started', {
        path: req.path,
        method: req.method,
        query_content_length: queryContent.length,
        user_id: req.user?.userId,
      });

      // Initialize memory context
      const memoryContext: MemoryContext = {
        userMemories: [],
        globalMemories: [],
        totalContextItems: 0,
      };

      // Inject user memories if user is authenticated
      if (req.user?.userId) {
        memoryContext.userMemories = await getUserMemoryContext(
          req.user.userId,
          queryContent,
          config
        );
      } else if (config.requireAuth) {
        memoryLogger.debug('Skipping memory injection - authentication required but not provided');
        return next();
      }

      // Inject global memories (always available)
      memoryContext.globalMemories = await getGlobalMemoryContext(
        queryContent,
        config
      );

      // Calculate total context items
      memoryContext.totalContextItems =
        memoryContext.userMemories.length + memoryContext.globalMemories.length;

      // Generate context summary if enabled
      if (config.enableContextSummary && memoryContext.totalContextItems > 0) {
        memoryContext.contextSummary = generateContextSummary(memoryContext);
      }

      // Attach memory context to request
      (req as any).memoryContext = memoryContext;

      memoryLogger.info('Memory injection completed', {
        path: req.path,
        user_memories: memoryContext.userMemories.length,
        global_memories: memoryContext.globalMemories.length,
        total_context_items: memoryContext.totalContextItems,
        has_summary: Boolean(memoryContext.contextSummary),
      });

      next();

    } catch (error) {
      memoryLogger.error('Memory injection failed', error instanceof Error ? error : new Error(String(error)));

      // Don't fail the request if memory injection fails
      // Just log the error and continue without memory context
      (req as any).memoryContext = {
        userMemories: [],
        globalMemories: [],
        totalContextItems: 0,
      };

      next();
    }
  };
}

/**
 * Extracts query content from request for memory search
 */
function extractQueryContent(req: Request): string | null {
  try {
    // For chat completion requests
    if (req.path.includes('/chat/completions') && req.body?.messages) {
      const messages = req.body.messages;
      const userMessages = messages
        .filter((msg: any) => msg.role === 'user')
        .map((msg: any) => msg.content)
        .join(' ');
      return userMessages || null;
    }

    // For direct agent/workflow requests
    if (req.body?.prompt) {
      return req.body.prompt;
    }

    if (req.body?.query) {
      return req.body.query;
    }

    // For search requests
    if (req.query?.q || req.query?.query) {
      return String(req.query.q || req.query.query);
    }

    return null;

  } catch (error) {
    memoryLogger.debug('Failed to extract query content', {
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Retrieves relevant user memory context
 */
async function getUserMemoryContext(
  userId: string,
  queryContent: string,
  config: Required<MemoryMiddlewareOptions>
): Promise<MemorySearchResult[]> {
  try {
    const searchOptions = {
      userId,
      query: queryContent,
      topK: config.maxUserMemories,
      similarityThreshold: config.similarityThreshold,
      includeMetadata: true,
    };

    // Search across all categories if none specified, otherwise filter
    if (config.categories.length > 0) {
      const categoryResults = await Promise.all(
        config.categories.map(category =>
          userMemoryOps.search({ ...searchOptions, category })
        )
      );

      // Combine and deduplicate results
      const combinedResults = new Map<string, MemorySearchResult>();
      categoryResults.flat().forEach(result => {
        const existing = combinedResults.get(result.id);
        if (!existing || result.similarity_score > existing.similarity_score) {
          combinedResults.set(result.id, result);
        }
      });

      return Array.from(combinedResults.values())
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, config.maxUserMemories);
    }

    return await userMemoryOps.search(searchOptions);

  } catch (error) {
    memoryLogger.error('Failed to retrieve user memory context', {
      user_id: userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Retrieves relevant global memory context
 */
async function getGlobalMemoryContext(
  queryContent: string,
  config: Required<MemoryMiddlewareOptions>
): Promise<MemorySearchResult[]> {
  try {
    const searchOptions = {
      query: queryContent,
      topK: config.maxGlobalMemories,
      similarityThreshold: config.similarityThreshold,
      includeMetadata: true,
    };

    // Search across categories if specified
    if (config.categories.length > 0) {
      const categoryResults = await Promise.all(
        config.categories.map(category =>
          globalMemoryOps.search({ ...searchOptions, category })
        )
      );

      // Combine and deduplicate results
      const combinedResults = new Map<string, MemorySearchResult>();
      categoryResults.flat().forEach(result => {
        const existing = combinedResults.get(result.id);
        if (!existing || result.similarity_score > existing.similarity_score) {
          combinedResults.set(result.id, result);
        }
      });

      return Array.from(combinedResults.values())
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, config.maxGlobalMemories);
    }

    return await globalMemoryOps.search(searchOptions);

  } catch (error) {
    memoryLogger.error('Failed to retrieve global memory context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Generates a summary of memory context for agents
 */
function generateContextSummary(memoryContext: MemoryContext): string {
  const summaryParts: string[] = [];

  if (memoryContext.userMemories.length > 0) {
    summaryParts.push('User Context:');
    memoryContext.userMemories.forEach((memory, index) => {
      const importance = memory.metadata?.importance || 'medium';
      const category = memory.metadata?.category || 'general';
      summaryParts.push(
        `${index + 1}. [${category}/${importance}] ${memory.content.substring(0, 100)}${
          memory.content.length > 100 ? '...' : ''
        }`
      );
    });
  }

  if (memoryContext.globalMemories.length > 0) {
    if (summaryParts.length > 0) summaryParts.push('');
    summaryParts.push('Organizational Context:');
    memoryContext.globalMemories.forEach((memory, index) => {
      const importance = memory.metadata?.importance || 'medium';
      const category = memory.metadata?.category || 'general';
      summaryParts.push(
        `${index + 1}. [${category}/${importance}] ${memory.content.substring(0, 100)}${
          memory.content.length > 100 ? '...' : ''
        }`
      );
    });
  }

  return summaryParts.join('\n');
}

/**
 * Express middleware to extract memory context from request
 */
export function extractMemoryContext(req: Request): MemoryContext | null {
  return (req as any).memoryContext || null;
}

/**
 * Helper to check if request has memory context
 */
export function hasMemoryContext(req: Request): boolean {
  const context = extractMemoryContext(req);
  return context ? context.totalContextItems > 0 : false;
}

/**
 * Specialized middleware for business intelligence agents
 */
export const businessIntelligenceMemoryMiddleware = createMemoryMiddleware({
  maxUserMemories: 8,
  maxGlobalMemories: 5,
  similarityThreshold: 0.6,
  categories: ['business', 'metrics', 'preferences', 'analysis'],
  enableContextSummary: true,
  requireAuth: false,
});

/**
 * Specialized middleware for general queries
 */
export const generalMemoryMiddleware = createMemoryMiddleware({
  maxUserMemories: 3,
  maxGlobalMemories: 2,
  similarityThreshold: 0.75,
  categories: ['preferences', 'general'],
  enableContextSummary: false,
  requireAuth: false,
});

/**
 * Memory context injection for agents
 */
export class MemoryContextInjector {
  /**
   * Injects memory context into agent input
   */
  static injectIntoAgentInput(
    originalInput: any,
    memoryContext: MemoryContext
  ): any {
    if (memoryContext.totalContextItems === 0) {
      return originalInput;
    }

    // For chat completion format
    if (originalInput.messages) {
      const contextMessage = this.buildContextMessage(memoryContext);

      return {
        ...originalInput,
        messages: [contextMessage, ...originalInput.messages],
      };
    }

    // For direct prompt format
    if (originalInput.prompt) {
      const contextPrefix = memoryContext.contextSummary ||
        this.buildContextMessage(memoryContext).content;

      return {
        ...originalInput,
        prompt: `${contextPrefix}\n\nUser Query: ${originalInput.prompt}`,
      };
    }

    return originalInput;
  }

  /**
   * Builds context message for agents
   */
  private static buildContextMessage(memoryContext: MemoryContext): {
    role: 'system';
    content: string;
  } {
    const contextParts: string[] = [];

    contextParts.push('## Relevant Context');

    if (memoryContext.userMemories.length > 0) {
      contextParts.push('### User Context & Preferences');
      memoryContext.userMemories.forEach((memory, index) => {
        contextParts.push(`${index + 1}. ${memory.content}`);
      });
    }

    if (memoryContext.globalMemories.length > 0) {
      contextParts.push('### Organizational Context');
      memoryContext.globalMemories.forEach((memory, index) => {
        contextParts.push(`${index + 1}. ${memory.content}`);
      });
    }

    contextParts.push('\nUse this context to provide more relevant and personalized responses.');

    return {
      role: 'system',
      content: contextParts.join('\n'),
    };
  }
}

/**
 * Async storage for memory context in workflows
 */
export class MemoryAsyncStorage {
  private static storage = new Map<string, MemoryContext>();

  static set(key: string, context: MemoryContext): void {
    this.storage.set(key, context);
  }

  static get(key: string): MemoryContext | null {
    return this.storage.get(key) || null;
  }

  static delete(key: string): boolean {
    return this.storage.delete(key);
  }

  static clear(): void {
    this.storage.clear();
  }
}

export default createMemoryMiddleware;