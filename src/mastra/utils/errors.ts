/**
 * Custom error classes for the Business Intelligence Context Enhancement feature
 */

export class ContextError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    code: string = 'CONTEXT_ERROR',
    statusCode: number = 500,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ContextError.prototype);
  }
}

export class JWTError extends ContextError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'JWT_ERROR', 401, context);
    this.name = 'JWTError';
  }
}

export class SessionError extends ContextError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SESSION_ERROR', 400, context);
    this.name = 'SessionError';
  }
}

export class VisualizationError extends ContextError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'VISUALIZATION_ERROR', 422, context);
    this.name = 'VisualizationError';
  }
}

export class DataIntegrationError extends ContextError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'DATA_INTEGRATION_ERROR', 400, context);
    this.name = 'DataIntegrationError';
  }
}

export class ArchitectureEvaluationError extends ContextError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ARCHITECTURE_EVALUATION_ERROR', 500, context);
    this.name = 'ArchitectureEvaluationError';
  }
}

/**
 * Error handler utility functions
 */
export class ErrorHandler {
  /**
   * Handle and format errors for API responses
   */
  static handleApiError(error: unknown): {
    statusCode: number;
    error: string;
    message: string;
    code?: string;
    context?: Record<string, any>;
  } {
    if (error instanceof ContextError) {
      return {
        statusCode: error.statusCode,
        error: error.name,
        message: error.message,
        code: error.code,
        context: error.context,
      };
    }

    if (error instanceof Error) {
      return {
        statusCode: 500,
        error: 'Internal Server Error',
        message: error.message,
      };
    }

    return {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    };
  }

  /**
   * Log error with context
   */
  static logError(error: unknown, context: Record<string, any> = {}): void {
    const errorInfo = this.handleApiError(error);
    console.error('Error occurred:', {
      ...errorInfo,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Create error response for Express middleware
   */
  static createErrorResponse(error: unknown, req?: any, res?: any) {
    const errorInfo = this.handleApiError(error);

    this.logError(error, {
      url: req?.url,
      method: req?.method,
      userId: req?.user?.id,
      sessionId: req?.sessionId,
    });

    if (res) {
      return res.status(errorInfo.statusCode).json({
        error: errorInfo.error,
        message: errorInfo.message,
        code: errorInfo.code,
        ...(process.env.NODE_ENV === 'development' && { context: errorInfo.context }),
      });
    }

    return errorInfo;
  }
}

/**
 * Express error handling middleware
 */
export function errorMiddleware(error: unknown, req: any, res: any, next: any) {
  return ErrorHandler.createErrorResponse(error, req, res);
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export function asyncHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw error;
    }
  };
}

/**
 * Context validation utilities
 */
export class ContextValidator {
  static validateSession(sessionId: string | undefined): string {
    if (!sessionId) {
      throw new SessionError('Session ID is required');
    }
    return sessionId;
  }

  static validateUser(userId: string | undefined): string {
    if (!userId) {
      throw new JWTError('User ID is required');
    }
    return userId;
  }

  static validatePermissions(permissions: any): void {
    if (!permissions || typeof permissions !== 'object') {
      throw new ContextError('Invalid permissions structure');
    }
  }
}