/**
 * pgvector Connection Manager
 * Constitutional requirement for proper database connection pooling
 */

import { Pool, Client, PoolConfig } from 'pg';
import { env } from '../config/environment.js';
import { CircuitBreaker, errorHandler } from '../observability/error-handling.js';

export interface DatabaseConnectionConfig extends PoolConfig {
  maxRetries?: number;
  retryDelay?: number;
  healthCheckInterval?: number;
}

export class PgVectorConnectionManager {
  private pool: Pool;
  private healthCheckClient: Client;
  private circuitBreaker: CircuitBreaker;
  private healthCheckTimer?: NodeJS.Timeout;
  private isHealthy = false;

  constructor(config?: DatabaseConnectionConfig) {
    const poolConfig: PoolConfig = {
      connectionString: env.PGVECTOR_DATABASE_URL,
      max: config?.max || 20,
      min: config?.min || 2,
      idleTimeoutMillis: config?.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config?.connectionTimeoutMillis || 2000,
      acquireTimeoutMillis: config?.acquireTimeoutMillis || 60000,
      ...config,
    };

    this.pool = new Pool(poolConfig);
    this.healthCheckClient = new Client({
      connectionString: env.PGVECTOR_DATABASE_URL,
    });

    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeout: 10000,
    });

    this.setupEventHandlers();
    this.startHealthCheck(config?.healthCheckInterval || 30000);
  }

  private setupEventHandlers() {
    this.pool.on('error', (err) => {
      const error = errorHandler.createError(err, {
        component: 'database',
        operation: 'pool_error',
      }, 'high');

      console.error('Database pool error:', {
        errorId: error.id,
        message: err.message,
      });

      this.isHealthy = false;
    });

    this.pool.on('connect', () => {
      console.log('New database connection established');
      this.isHealthy = true;
    });

    this.pool.on('remove', () => {
      console.log('Database connection removed from pool');
    });
  }

  private startHealthCheck(interval: number) {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.healthCheckClient.connect();
        const result = await this.healthCheckClient.query('SELECT 1');
        await this.healthCheckClient.end();

        if (result.rows.length > 0) {
          this.isHealthy = true;
          this.circuitBreaker.reset();
        }
      } catch (error) {
        this.isHealthy = false;
        const systemError = errorHandler.createError(
          error instanceof Error ? error : new Error(String(error)),
          {
            component: 'database',
            operation: 'health_check',
          },
          'medium'
        );

        console.warn('Database health check failed:', {
          errorId: systemError.id,
          message: systemError.message,
        });
      }
    }, interval);
  }

  async getConnection() {
    return await this.circuitBreaker.execute(
      async () => {
        if (!this.isHealthy) {
          throw new Error('Database is not healthy');
        }
        return await this.pool.connect();
      },
      'get_connection'
    );
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const result = await this.circuitBreaker.execute(
      async () => {
        if (!this.isHealthy) {
          throw new Error('Database is not healthy');
        }
        return await this.pool.query(text, params);
      },
      'query'
    );

    if (!result) {
      throw new Error('Query failed due to circuit breaker');
    }

    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  }

  async queryWithClient<T = any>(
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    const client = await this.getConnection();
    if (!client) {
      throw new Error('Could not get database connection');
    }

    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  getPoolStatus() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isHealthy: this.isHealthy,
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  async close() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    try {
      await this.healthCheckClient.end();
    } catch (error) {
      console.warn('Error closing health check client:', error);
    }

    await this.pool.end();
    console.log('Database connection manager closed');
  }
}

// Global connection manager instance
let connectionManager: PgVectorConnectionManager;

export function getConnectionManager(): PgVectorConnectionManager {
  if (!connectionManager) {
    connectionManager = new PgVectorConnectionManager();
  }
  return connectionManager;
}

export async function closeConnectionManager() {
  if (connectionManager) {
    await connectionManager.close();
  }
}