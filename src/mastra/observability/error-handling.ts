/**
 * Comprehensive Error Handling and Circuit Breaker Infrastructure
 * Constitutional requirement for robust system operation
 */

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringWindow: number;
}

export interface ErrorContext {
  component: 'agent' | 'workflow' | 'tool' | 'mcp' | 'database';
  operation: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  metadata?: Record<string, any>;
}

export interface SystemError {
  id: string;
  message: string;
  code?: string;
  stack?: string;
  context: ErrorContext;
  timestamp: Date;
  fingerprint: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      recoveryTimeout: config.recoveryTimeout || 30000,
      monitoringWindow: config.monitoringWindow || 60000,
    };
  }

  async execute<T>(operation: () => Promise<T>, operationName: string): Promise<T | null> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailTime >= this.config.recoveryTimeout) {
        this.state = 'half-open';
        this.failures = 0;
      } else {
        console.warn(`Circuit breaker is open for ${operationName} - skipping operation`);
        return null;
      }
    }

    try {
      const result = await operation();

      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailTime = Date.now();

      if (this.failures >= this.config.failureThreshold) {
        this.state = 'open';
        console.error(`Circuit breaker opened for ${operationName} after ${this.failures} failures`);
      }

      throw error;
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime,
    };
  }

  reset() {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailTime = 0;
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorStore: SystemError[] = [];
  private maxStoredErrors = 1000;

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  createError(
    error: Error,
    context: ErrorContext,
    severity: SystemError['severity'] = 'medium'
  ): SystemError {
    const systemError: SystemError = {
      id: this.generateErrorId(),
      message: error.message,
      code: (error as any).code,
      stack: error.stack,
      context,
      timestamp: new Date(),
      fingerprint: this.generateFingerprint(error, context),
      severity,
    };

    this.storeError(systemError);
    return systemError;
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFingerprint(error: Error, context: ErrorContext): string {
    const key = `${context.component}:${context.operation}:${error.name}:${error.message}`;
    return btoa(key).replace(/[^a-zA-Z0-9]/g, '').substr(0, 16);
  }

  private storeError(error: SystemError) {
    this.errorStore.push(error);

    // Keep only the most recent errors
    if (this.errorStore.length > this.maxStoredErrors) {
      this.errorStore = this.errorStore.slice(-this.maxStoredErrors);
    }
  }

  getErrors(filters?: {
    component?: string;
    severity?: string;
    since?: Date;
    limit?: number;
  }): SystemError[] {
    let filtered = this.errorStore;

    if (filters?.component) {
      filtered = filtered.filter(e => e.context.component === filters.component);
    }

    if (filters?.severity) {
      filtered = filtered.filter(e => e.severity === filters.severity);
    }

    if (filters?.since) {
      filtered = filtered.filter(e => e.timestamp >= filters.since!);
    }

    if (filters?.limit) {
      filtered = filtered.slice(-filters.limit);
    }

    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getErrorAnalysis(timeWindow: number = 3600000): {
    totalErrors: number;
    errorsByComponent: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    topFingerprints: Array<{ fingerprint: string; count: number; lastSeen: Date }>;
  } {
    const since = new Date(Date.now() - timeWindow);
    const recentErrors = this.getErrors({ since });

    const errorsByComponent: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};
    const fingerprintCounts: Record<string, { count: number; lastSeen: Date }> = {};

    recentErrors.forEach(error => {
      errorsByComponent[error.context.component] = (errorsByComponent[error.context.component] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;

      if (!fingerprintCounts[error.fingerprint]) {
        fingerprintCounts[error.fingerprint] = { count: 0, lastSeen: error.timestamp };
      }
      fingerprintCounts[error.fingerprint].count++;
      if (error.timestamp > fingerprintCounts[error.fingerprint].lastSeen) {
        fingerprintCounts[error.fingerprint].lastSeen = error.timestamp;
      }
    });

    const topFingerprints = Object.entries(fingerprintCounts)
      .map(([fingerprint, data]) => ({ fingerprint, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalErrors: recentErrors.length,
      errorsByComponent,
      errorsBySeverity,
      topFingerprints,
    };
  }
}

// Global error handler instance
export const errorHandler = ErrorHandler.getInstance();

// Utility function for wrapping operations with error handling
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  severity: SystemError['severity'] = 'medium'
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const systemError = errorHandler.createError(
      error instanceof Error ? error : new Error(String(error)),
      context,
      severity
    );

    console.error('Operation failed:', {
      errorId: systemError.id,
      message: systemError.message,
      context: systemError.context,
    });

    throw error;
  }
}