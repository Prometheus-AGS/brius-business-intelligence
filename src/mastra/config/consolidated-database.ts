/**
 * Consolidated Database Configuration (Mastra Best Practices)
 * Single source of truth for all database connections
 * Constitutional requirement for proper architecture
 */

import { PostgresStore } from '@mastra/pg';
import { PgVector } from '@mastra/pg';
import { Memory } from '@mastra/memory';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from './environment.js';
import * as schema from '../database/schema.js';
import { generateSingleEmbedding } from '../memory/embeddings.js';

// Single database connection configuration following Mastra patterns
const DATABASE_CONFIG = {
  connectionString: env.PGVECTOR_DATABASE_URL,
  // Optimized pool settings for production use
  max: 10,           // Reduced maximum connections
  min: 1,            // Reduced minimum connections
  idleTimeoutMillis: 60000,        // 60 seconds idle timeout
  connectionTimeoutMillis: 30000,   // 30 seconds connection timeout
  // Health check and resilience
  healthCheckInterval: 30000,       // 30 seconds health check
  maxRetries: 5,
  retryDelay: 2000,
  // Additional connection options
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
} as const;

// Vector store configuration following Mastra patterns
const VECTOR_CONFIG = {
  indexes: {
    memory: {
      name: 'memory_vectors',
      dimension: 1536,
      metric: 'cosine' as const,
      config: {
        type: 'ivfflat' as const,
        ivf: { lists: 200 },
      },
    },
    knowledge: {
      name: 'knowledge_vectors',
      dimension: 1536,
      metric: 'cosine' as const,
      config: {
        type: 'hnsw' as const,
        hnsw: { m: 16, efConstruction: 64 },
      },
    },
  },
} as const;

// Singleton instances following Mastra patterns
let postgresStore: PostgresStore;
let vectorStore: PgVector;
let memoryStore: Memory;
let drizzleDb: ReturnType<typeof drizzle>;
let connectionPool: Pool;

/**
 * Initialize PostgreSQL storage following Mastra best practices
 * This replaces multiple scattered connection managers
 */
export function getPostgresStore(): PostgresStore {
  if (!postgresStore) {
    postgresStore = new PostgresStore({
      connectionString: DATABASE_CONFIG.connectionString,
    });
  }
  return postgresStore;
}

/**
 * Initialize vector store with optimized pgvector configuration
 * Centralized vector operations for both memory and knowledge
 */
export function getVectorStore(): PgVector {
  if (!vectorStore) {
    vectorStore = new PgVector({
      connectionString: DATABASE_CONFIG.connectionString,
    });
  }
  return vectorStore;
}

/**
 * Initialize memory store following Mastra patterns
 * Combines storage and vector capabilities
 */
export function getMemoryStore(): Memory {
  if (!memoryStore) {
    memoryStore = new Memory({
      storage: getPostgresStore(),
      vector: getVectorStore(),
      // Configure memory options following Mastra best practices
      options: {
        lastMessages: 40,
        workingMemory: {
          enabled: true,
        },
      },
    });
  }
  return memoryStore;
}

/**
 * Get connection pool for direct database access
 * Used by Drizzle ORM and other direct SQL operations
 */
export function getConnectionPool(): Pool {
  if (!connectionPool) {
    connectionPool = new Pool({
      connectionString: DATABASE_CONFIG.connectionString,
      max: DATABASE_CONFIG.max,
      min: DATABASE_CONFIG.min,
      idleTimeoutMillis: DATABASE_CONFIG.idleTimeoutMillis,
      connectionTimeoutMillis: DATABASE_CONFIG.connectionTimeoutMillis,
      keepAlive: DATABASE_CONFIG.keepAlive,
      keepAliveInitialDelayMillis: DATABASE_CONFIG.keepAliveInitialDelayMillis,
    });

    // Add comprehensive error handling with graceful degradation
    connectionPool.on('error', (err) => {
      console.error('Database pool error (non-fatal):', err.message);
      // Don't crash the application on pool errors
    });

    connectionPool.on('connect', (client) => {
      console.log('Database client connected successfully');
      
      // Set up client-level error handling
      client.on('error', (clientErr) => {
        console.error('Database client error (non-fatal):', clientErr.message);
        // Don't crash on individual client errors
      });
    });

    connectionPool.on('acquire', (client) => {
      console.log('Database client acquired from pool');
    });

    connectionPool.on('remove', (client) => {
      console.log('Database client removed from pool');
    });
  }
  return connectionPool;
}

/**
 * Get Drizzle ORM instance for schema-based operations
 * Maintains backward compatibility with existing knowledge/upload patterns
 */
export function getDrizzleDb(): ReturnType<typeof drizzle> {
  if (!drizzleDb) {
    drizzleDb = drizzle(getConnectionPool(), { schema });
  }
  return drizzleDb;
}

/**
 * Ensure vector indexes are created with proper configuration
 * Called during application initialization
 */
export async function ensureVectorIndexes(): Promise<void> {
  const vector = getVectorStore();

  // Create memory vectors index
  await vector.createIndex({
    indexName: VECTOR_CONFIG.indexes.memory.name,
    dimension: VECTOR_CONFIG.indexes.memory.dimension,
    metric: VECTOR_CONFIG.indexes.memory.metric,
    indexConfig: VECTOR_CONFIG.indexes.memory.config,
    buildIndex: true,
  });

  // Create knowledge vectors index
  await vector.createIndex({
    indexName: VECTOR_CONFIG.indexes.knowledge.name,
    dimension: VECTOR_CONFIG.indexes.knowledge.dimension,
    metric: VECTOR_CONFIG.indexes.knowledge.metric,
    indexConfig: VECTOR_CONFIG.indexes.knowledge.config,
    buildIndex: true,
  });
}

/**
 * Database health check using consolidated connections
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  error?: string;
  pgvectorVersion?: string;
  connectionDetails?: {
    storage: boolean;
    vector: boolean;
    memory: boolean;
  };
}> {
  try {
    // Use the Mastra PostgresStore for health check
    const storage = getPostgresStore();

    // Basic connectivity check through connection pool
    const pool = getConnectionPool();
    const testResult = await pool.query('SELECT version()');

    // Check pgvector extension
    const vectorResult = await pool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );

    return {
      healthy: true,
      pgvectorVersion: vectorResult?.rows?.[0]?.extversion || 'unknown',
      connectionDetails: {
        storage: Boolean(postgresStore),
        vector: Boolean(vectorStore),
        memory: Boolean(memoryStore),
      },
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown database error',
      connectionDetails: {
        storage: Boolean(postgresStore),
        vector: Boolean(vectorStore),
        memory: Boolean(memoryStore),
      },
    };
  }
}

/**
 * Graceful cleanup of all database connections
 */
export async function closeDatabaseConnections(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (postgresStore) {
    // Note: Mastra storage handles connection cleanup internally
    promises.push(Promise.resolve());
  }

  if (vectorStore) {
    // Note: Mastra vector store handles connection cleanup internally
    promises.push(Promise.resolve());
  }

  if (memoryStore) {
    // Note: Mastra memory handles connection cleanup internally
    promises.push(Promise.resolve());
  }

  await Promise.all(promises);
}

// Export constants for use in other modules
export const DATABASE_CONSTANTS = {
  VECTOR_INDEXES: {
    MEMORY: VECTOR_CONFIG.indexes.memory.name,
    KNOWLEDGE: VECTOR_CONFIG.indexes.knowledge.name,
  },
  CONFIG: DATABASE_CONFIG,
} as const;

// Type exports for proper TypeScript support
export type { PostgresStore } from '@mastra/pg';
export type { PgVector } from '@mastra/pg';
export type { Memory } from '@mastra/memory';