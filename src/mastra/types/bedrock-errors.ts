/**
 * Bedrock Error Types
 *
 * Error handling types for the Bedrock LLM service.
 */

export interface BedrockServiceError extends Error {
  /** Error category */
  category: 'aws_error' | 'validation_error' | 'circuit_breaker' | 'timeout' | 'monitoring_error';

  /** Error code for programmatic handling */
  code: string;

  /** User-friendly error message */
  message: string;

  /** Technical details for debugging */
  details?: Record<string, any>;

  /** Original error from AWS SDK or other source */
  originalError?: Error;

  /** Request context that caused the error */
  context?: {
    operation: string;
    modelId?: string;
    requestId?: string;
    traceId?: string;
  };

  /** Whether this error is retryable */
  retryable: boolean;

  /** Retry delay suggestion (ms) */
  retryDelayMs?: number;
}

export type BedrockErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'REQUEST_TIMEOUT'
  | 'INVALID_CREDENTIALS'
  | 'REGION_NOT_SUPPORTED'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'CONTENT_FILTERED'
  | 'EMBEDDING_DIMENSION_MISMATCH'
  | 'MONITORING_FAILURE'
  | 'CONFIGURATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Error factory functions for consistent error creation
 */
export class BedrockErrorFactory {
  static createValidationError(message: string, details?: Record<string, any>): BedrockServiceError {
    return {
      name: 'BedrockServiceError',
      category: 'validation_error',
      code: 'INVALID_REQUEST',
      message,
      details,
      retryable: false,
    } as BedrockServiceError;
  }

  static createAwsError(
    originalError: Error,
    operation: string,
    modelId?: string,
    retryable = true
  ): BedrockServiceError {
    return {
      name: 'BedrockServiceError',
      category: 'aws_error',
      code: 'NETWORK_ERROR',
      message: `AWS Bedrock operation failed: ${originalError.message}`,
      originalError,
      context: { operation, modelId },
      retryable,
    } as BedrockServiceError;
  }

  static createCircuitBreakerError(operation: string): BedrockServiceError {
    return {
      name: 'BedrockServiceError',
      category: 'circuit_breaker',
      code: 'CIRCUIT_BREAKER_OPEN',
      message: `Circuit breaker is open for operation: ${operation}`,
      context: { operation },
      retryable: true,
      retryDelayMs: 60000, // 1 minute
    } as BedrockServiceError;
  }

  static createTimeoutError(operation: string, timeoutMs: number): BedrockServiceError {
    return {
      name: 'BedrockServiceError',
      category: 'timeout',
      code: 'REQUEST_TIMEOUT',
      message: `Operation ${operation} timed out after ${timeoutMs}ms`,
      context: { operation },
      retryable: true,
      retryDelayMs: 1000,
    } as BedrockServiceError;
  }

  static createRateLimitError(operation: string, retryAfterMs = 5000): BedrockServiceError {
    return {
      name: 'BedrockServiceError',
      category: 'aws_error',
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded for operation: ${operation}`,
      context: { operation },
      retryable: true,
      retryDelayMs: retryAfterMs,
    } as BedrockServiceError;
  }
}

/**
 * Utility functions for convenience
 */
export function createBedrockError(
  message: string,
  code: BedrockErrorCode,
  category: BedrockServiceError['category'],
  retryable: boolean,
  details?: Record<string, any>,
  originalError?: Error
): BedrockServiceError {
  return {
    name: 'BedrockServiceError',
    category,
    code,
    message,
    retryable,
    details,
    originalError,
  } as BedrockServiceError;
}

export function getErrorSeverity(error: BedrockServiceError): 'low' | 'medium' | 'high' {
  if (error.category === 'circuit_breaker' || error.code === 'RATE_LIMIT_EXCEEDED') {
    return 'high';
  }
  if (error.category === 'validation_error' || error.category === 'monitoring_error') {
    return 'low';
  }
  return 'medium';
}