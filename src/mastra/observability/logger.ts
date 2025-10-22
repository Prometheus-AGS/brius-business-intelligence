import { env, isDevelopment } from '../config/environment.js';
import { RequestContext, AuthContext } from '../types/index.js';

/**
 * Structured Logging Infrastructure
 * Provides centralized logging with different levels, context, and correlation IDs
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  module?: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  data?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Logger class with structured output and context management
 */
class Logger {
  private service: string;
  private module?: string;
  private context?: Partial<RequestContext>;

  constructor(service: string, module?: string) {
    this.service = service;
    this.module = module;
  }

  /**
   * Sets request context for correlation
   */
  setContext(context: Partial<RequestContext>): void {
    this.context = context;
  }

  /**
   * Clears request context
   */
  clearContext(): void {
    this.context = undefined;
  }

  /**
   * Creates a child logger with additional module context
   */
  child(module: string): Logger {
    const childLogger = new Logger(this.service, module);
    childLogger.setContext(this.context || {});
    return childLogger;
  }

  /**
   * Logs a debug message
   */
  debug(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Logs an info message
   */
  info(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: Error | Record<string, any>): void {
    let errorData: Record<string, any> | undefined;
    let errorInfo: LogEntry['error'] | undefined;

    if (error instanceof Error) {
      errorInfo = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
    } else if (error) {
      errorData = error;
    }

    this.log(LogLevel.ERROR, message, errorData, errorInfo);
  }

  /**
   * Logs a fatal error message
   */
  fatal(message: string, error?: Error): void {
    let errorInfo: LogEntry['error'] | undefined;

    if (error instanceof Error) {
      errorInfo = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
    }

    this.log(LogLevel.FATAL, message, undefined, errorInfo);
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, any>,
    error?: LogEntry['error']
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      module: this.module,
      requestId: this.context?.request_id,
      userId: this.context?.auth?.user_id,
      sessionId: this.context?.session_id,
      traceId: data?.traceId,
      data,
      error,
    };

    // Remove undefined fields for cleaner output
    const cleanEntry = Object.fromEntries(
      Object.entries(entry).filter(([_, value]) => value !== undefined)
    ) as LogEntry;

    // Output based on environment
    if (isDevelopment()) {
      this.outputDevelopment(level, cleanEntry);
    } else {
      this.outputProduction(cleanEntry);
    }
  }

  /**
   * Development-friendly console output
   */
  private outputDevelopment(level: LogLevel, entry: LogEntry): void {
    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.FATAL]: '\x1b[35m', // Magenta
    };
    const reset = '\x1b[0m';

    const timestamp = entry.timestamp.split('T')[1].slice(0, -1); // Time only
    const context = entry.requestId ? ` [${entry.requestId.slice(-6)}]` : '';
    const module = entry.module ? ` ${entry.module}:` : '';

    const prefix = `${timestamp}${context} ${colors[level]}${level}${reset}${module}`;
    const message = `${prefix} ${entry.message}`;

    console.log(message);

    if (entry.data) {
      console.log('  Data:', entry.data);
    }

    if (entry.error) {
      console.error('  Error:', entry.error);
    }
  }

  /**
   * Production JSON output
   */
  private outputProduction(entry: LogEntry): void {
    console.log(JSON.stringify(entry));
  }
}

/**
 * Performance monitoring utilities
 */
export class PerformanceTracker {
  private startTime: number;
  private logger: Logger;
  private operation: string;

  constructor(logger: Logger, operation: string) {
    this.startTime = Date.now();
    this.logger = logger;
    this.operation = operation;
    this.logger.debug(`Starting ${operation}`);
  }

  /**
   * Ends performance tracking and logs the duration
   */
  end(data?: Record<string, any>): number {
    const duration = Date.now() - this.startTime;
    this.logger.info(`Completed ${this.operation}`, {
      duration_ms: duration,
      ...data,
    });
    return duration;
  }

  /**
   * Ends with error
   */
  endWithError(error: Error, data?: Record<string, any>): number {
    const duration = Date.now() - this.startTime;
    this.logger.error(`Failed ${this.operation}`, {
      duration_ms: duration,
      error,
      ...data,
    });
    return duration;
  }

  /**
   * Gets current duration without ending
   */
  getCurrentDuration(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Error handling utilities
 */
export class ErrorHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Handles and logs an error, returning a safe error response
   */
  handleError(error: unknown, context?: string): {
    message: string;
    code?: string;
    details?: Record<string, any>;
  } {
    if (error instanceof Error) {
      this.logger.error(`Error in ${context || 'operation'}`, error);

      return {
        message: isDevelopment() ? error.message : 'An error occurred',
        code: (error as any).code,
        details: isDevelopment() ? { stack: error.stack } : undefined,
      };
    }

    this.logger.error(`Unknown error in ${context || 'operation'}`, {
      error: String(error),
    });

    return {
      message: 'An unexpected error occurred',
    };
  }

  /**
   * Wraps an async function with error handling
   */
  wrapAsync<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    context: string
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        this.logger.error(`Error in ${context}`, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    };
  }
}

/**
 * Express middleware for request logging
 */
export function requestLoggingMiddleware(logger: Logger) {
  return (req: any, res: any, next: any) => {
    const startTime = Date.now();

    // Set logger context
    if (req.requestContext) {
      logger.setContext(req.requestContext);
    }

    // Log request start
    logger.info('Request started', {
      method: req.method,
      url: req.originalUrl || req.url,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    // Capture response
    const originalSend = res.send;
    res.send = function(body: any) {
      const duration = Date.now() - startTime;

      logger.info('Request completed', {
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        duration_ms: duration,
        responseSize: body ? JSON.stringify(body).length : 0,
      });

      logger.clearContext();
      return originalSend.call(this, body);
    };

    next();
  };
}

/**
 * Express error handling middleware
 */
export function errorHandlingMiddleware(logger: Logger) {
  return (error: any, req: any, res: any, next: any) => {
    const errorHandler = new ErrorHandler(logger);
    const safeError = errorHandler.handleError(error, 'Express middleware');

    // Set appropriate status code
    let statusCode = 500;
    if (error.statusCode) {
      statusCode = error.statusCode;
    } else if (error.name === 'ValidationError') {
      statusCode = 400;
    } else if (error.name === 'UnauthorizedError') {
      statusCode = 401;
    }

    res.status(statusCode).json({
      error: safeError,
    });
  };
}

// Global logger instances
export const rootLogger = new Logger('mastra-bi');
export const agentLogger = rootLogger.child('agents');
export const workflowLogger = rootLogger.child('workflows');
export const memoryLogger = rootLogger.child('memory');
export const knowledgeLogger = rootLogger.child('knowledge');
export const mcpLogger = rootLogger.child('mcp');
export const apiLogger = rootLogger.child('api');

// Global error handler
export const globalErrorHandler = new ErrorHandler(rootLogger);

/**
 * Helper to track performance of async operations
 */
export async function trackPerformance<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  const tracker = new PerformanceTracker(logger, operation);

  try {
    const result = await fn();
    tracker.end(context);
    return result;
  } catch (error) {
    tracker.endWithError(error instanceof Error ? error : new Error(String(error)), context);
    throw error;
  }
}