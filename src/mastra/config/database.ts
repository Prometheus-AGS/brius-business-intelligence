/**
 * pgvector Database Configuration (Constitutional Requirement)
 * Replaces Supabase database with direct pgvector 17 connection
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { env } from './environment.js';
import * as schema from '../database/schema.js';

export interface DatabaseConfig {
  db: ReturnType<typeof drizzle>;
  client: Client;
  pool: Pool;
}

let databaseConfig: DatabaseConfig;

export function initializeDatabase(): DatabaseConfig {
  if (!databaseConfig) {
    // Create connection pool for better performance
    const pool = new Pool({
      connectionString: env.PGVECTOR_DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Create single client for direct queries
    const client = new Client({
      connectionString: env.PGVECTOR_DATABASE_URL,
    });

    // Initialize Drizzle ORM with schema
    const db = drizzle(pool, { schema });

    databaseConfig = {
      db,
      client,
      pool,
    };
  }

  return databaseConfig;
}

export function getDatabase() {
  if (!databaseConfig) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return databaseConfig.db;
}

export function getDatabaseClient() {
  if (!databaseConfig) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return databaseConfig.client;
}

export function getDatabasePool() {
  if (!databaseConfig) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return databaseConfig.pool;
}

// Database health check
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  error?: string;
  pgvectorVersion?: string;
}> {
  try {
    const client = getDatabaseClient();
    await client.connect();

    // Check basic connectivity
    const versionResult = await client.query('SELECT version()');

    // Check pgvector extension
    const vectorResult = await client.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );

    await client.end();

    return {
      healthy: true,
      pgvectorVersion: vectorResult.rows[0]?.extversion
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown database error'
    };
  }
}