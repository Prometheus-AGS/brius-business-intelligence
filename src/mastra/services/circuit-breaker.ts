/**
 * Circuit Breaker Implementation
 *
 * Implements the circuit breaker pattern for resilient AWS Bedrock operations.
 * Protects against cascading failures and provides automatic recovery.
 */

import type { CircuitBreakerConfig } from '../types/index.js';
import { BedrockErrorFactory } from '../types/bedrock-errors.js';
import { backOff } from 'exponential-backoff';

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: Date;
  private nextAttemptTime?: Date;

  constructor(private config: CircuitBreakerConfig) {}

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    // Check if circuit is open and if we can attempt recovery
    if (this.state === 'open') {
      if (this.nextAttemptTime && new Date() > this.nextAttemptTime) {
        this.state = 'half-open';
        this.successCount = 0; // Reset success count for half-open state
      } else {
        throw BedrockErrorFactory.createCircuitBreakerError(operationName);
      }
    }

    // Execute the operation with exponential backoff
    try {
      const result = await this.executeWithBackoff(operation, operationName);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Execute operation with exponential backoff retry logic
   */
  private async executeWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return await backOff(operation, {
      numOfAttempts: this.config.maxRetries,
      startingDelay: this.config.baseDelayMs,
      maxDelay: this.config.maxDelayMs,
      delayFirstAttempt: false,
      retry: (error: any, attemptNumber: number) => {
        // Don't retry circuit breaker errors
        if (error.code === 'CIRCUIT_BREAKER_OPEN') {
          return false;
        }

        // Don't retry validation errors
        if (error.category === 'validation_error') {
          return false;
        }

        // Retry AWS errors, timeouts, and rate limits
        const retryableCategories = ['aws_error', 'timeout', 'monitoring_error'];
        const retryableCodes = ['RATE_LIMIT_EXCEEDED', 'NETWORK_ERROR', 'REQUEST_TIMEOUT'];
        
        return (
          retryableCategories.includes(error.category) ||
          retryableCodes.includes(error.code) ||
          error.retryable === true
        );
      },
    });
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;

    if (this.state === 'half-open') {
      // If we're in half-open state and we have enough successes, close the circuit
      if (this.successCount >= Math.ceil(this.config.failureThreshold / 2)) {
        this.state = 'closed';
        this.nextAttemptTime = undefined;
        this.lastFailureTime = undefined;
      }
    } else if (this.state === 'open') {
      // This shouldn't happen, but just in case
      this.state = 'closed';
      this.nextAttemptTime = undefined;
      this.lastFailureTime = undefined;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();
    this.successCount = 0; // Reset success count on failure

    if (this.state === 'half-open') {
      // If we fail in half-open state, go back to open immediately
      this.state = 'open';
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeoutMs);
    } else if (this.failureCount >= this.config.failureThreshold) {
      // If we exceed failure threshold, open the circuit
      this.state = 'open';
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeoutMs);
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      isHealthy: this.state === 'closed',
      timeUntilRetry: this.nextAttemptTime
        ? Math.max(0, this.nextAttemptTime.getTime() - Date.now())
        : 0,
    };
  }

  /**
   * Get health information for monitoring
   */
  getHealthInfo() {
    return {
      healthy: this.state === 'closed',
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      timeUntilRetry: this.nextAttemptTime
        ? Math.max(0, this.nextAttemptTime.getTime() - Date.now())
        : 0,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
  }

  /**
   * Force circuit breaker to open state
   * Useful for maintenance or emergency scenarios
   */
  forceOpen(recoveryTimeoutMs?: number): void {
    this.state = 'open';
    this.nextAttemptTime = new Date(
      Date.now() + (recoveryTimeoutMs || this.config.recoveryTimeoutMs)
    );
    this.lastFailureTime = new Date();
  }

  /**
   * Check if circuit breaker allows operations
   */
  isOperationAllowed(): boolean {
    if (this.state === 'closed' || this.state === 'half-open') {
      return true;
    }
    
    if (this.state === 'open' && this.nextAttemptTime) {
      return new Date() > this.nextAttemptTime;
    }
    
    return false;
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics() {
    const now = Date.now();
    const uptimeMs = this.lastFailureTime 
      ? now - this.lastFailureTime.getTime()
      : now;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.config.failureThreshold,
      recoveryTimeoutMs: this.config.recoveryTimeoutMs,
      isHealthy: this.state === 'closed',
      uptimeMs,
      timeUntilRetryMs: this.nextAttemptTime 
        ? Math.max(0, this.nextAttemptTime.getTime() - now)
        : 0,
      lastStateChange: this.lastFailureTime?.toISOString(),
    };
  }
}

/**
 * Circuit breaker registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  getBreaker(name: string, config: CircuitBreakerConfig): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(config));
    }
    return this.breakers.get(name)!;
  }

  reset(name?: string): void {
    if (name) {
      this.breakers.get(name)?.reset();
    } else {
      for (const breaker of this.breakers.values()) {
        breaker.reset();
      }
    }
  }

  getAllBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }
}

// Global registry instance
const globalRegistry = new CircuitBreakerRegistry();

export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  return globalRegistry;
}