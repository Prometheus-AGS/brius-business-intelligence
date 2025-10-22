/**
 * Database Migration Runner
 * Ensures all migrations are executed during system startup
 * Constitutional requirement: Run all migrations on system initialization
 */

import { Pool } from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getConnectionPool } from './consolidated-database.js';
import { rootLogger } from '../observability/logger.js';

export interface MigrationFile {
  id: string;
  name: string;
  path: string;
  content: string;
  order: number;
}

export interface MigrationResult {
  id: string;
  name: string;
  success: boolean;
  duration: number;
  error?: string;
  skipped?: boolean;
}

export interface MigrationRunResult {
  success: boolean;
  totalMigrations: number;
  executedMigrations: number;
  skippedMigrations: number;
  failedMigrations: number;
  results: MigrationResult[];
  totalDuration: number;
}

export class MigrationRunner {
  private pool: Pool;
  private migrationsPath: string;

  constructor(migrationsPath: string = 'migrations') {
    this.pool = getConnectionPool();
    this.migrationsPath = migrationsPath;
  }

  /**
   * Initialize migration tracking table
   */
  private async ensureMigrationTable(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migration_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        migration_name TEXT NOT NULL UNIQUE,
        migration_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        error_message TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        CONSTRAINT migration_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'))
      );

      CREATE INDEX IF NOT EXISTS idx_migration_status_name ON migration_status(migration_name);
      CREATE INDEX IF NOT EXISTS idx_migration_status_status ON migration_status(migration_status);
    `;

    await this.pool.query(createTableSQL);
    rootLogger.info('Migration tracking table ensured');
  }

  /**
   * Load all migration files from the migrations directory
   */
  private async loadMigrationFiles(): Promise<MigrationFile[]> {
    try {
      const files = await readdir(this.migrationsPath);
      const sqlFiles = files
        .filter(file => file.endsWith('.sql'))
        .sort(); // Natural sort order by filename

      const migrations: MigrationFile[] = [];

      for (let i = 0; i < sqlFiles.length; i++) {
        const filename = sqlFiles[i];
        const filePath = join(this.migrationsPath, filename);
        const content = await readFile(filePath, 'utf-8');
        
        // Extract migration ID from filename (e.g., "001-setup-pgvector.sql" -> "001")
        const idMatch = filename.match(/^(\d+)/);
        const id = idMatch ? idMatch[1] : String(i + 1).padStart(3, '0');
        
        migrations.push({
          id,
          name: filename.replace('.sql', ''),
          path: filePath,
          content,
          order: i + 1,
        });
      }

      rootLogger.info(`Loaded ${migrations.length} migration files`, {
        migrations: migrations.map(m => ({ id: m.id, name: m.name }))
      });

      return migrations;
    } catch (error) {
      rootLogger.error('Failed to load migration files', { error: error instanceof Error ? error.message : error });
      throw new Error(`Failed to load migration files: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Check if a migration has already been executed
   */
  private async isMigrationExecuted(migrationName: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'SELECT status FROM migration_status WHERE migration_name = $1',
        [migrationName]
      );
      
      return result.rows.length > 0 && result.rows[0].status === 'completed';
    } catch (error) {
      // If the table doesn't exist yet, no migrations have been executed
      return false;
    }
  }

  /**
   * Record migration start
   */
  private async recordMigrationStart(migrationName: string): Promise<void> {
    await this.pool.query(`
      INSERT INTO migration_status (migration_name, migration_type, status, started_at, metadata)
      VALUES ($1, 'schema_migration', 'running', NOW(), $2)
      ON CONFLICT (migration_name) 
      DO UPDATE SET 
        status = 'running',
        started_at = NOW(),
        error_message = NULL
    `, [migrationName, JSON.stringify({ auto_executed: true, runner_version: '1.0' })]);
  }

  /**
   * Record migration completion
   */
  private async recordMigrationCompletion(migrationName: string, success: boolean, error?: string): Promise<void> {
    if (success) {
      await this.pool.query(`
        UPDATE migration_status 
        SET status = 'completed', completed_at = NOW(), error_message = NULL
        WHERE migration_name = $1
      `, [migrationName]);
    } else {
      await this.pool.query(`
        UPDATE migration_status 
        SET status = 'failed', completed_at = NOW(), error_message = $2
        WHERE migration_name = $1
      `, [migrationName, error || 'Unknown error']);
    }
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(migration: MigrationFile): Promise<MigrationResult> {
    const startTime = Date.now();
    
    try {
      // Check if already executed
      const alreadyExecuted = await this.isMigrationExecuted(migration.name);
      if (alreadyExecuted) {
        rootLogger.info(`Migration already executed: ${migration.name}`);
        return {
          id: migration.id,
          name: migration.name,
          success: true,
          duration: Date.now() - startTime,
          skipped: true,
        };
      }

      rootLogger.info(`Executing migration: ${migration.name}`);

      // Record migration start
      await this.recordMigrationStart(migration.name);

      // Execute the migration SQL
      await this.pool.query(migration.content);

      // Record successful completion
      await this.recordMigrationCompletion(migration.name, true);

      const duration = Date.now() - startTime;
      rootLogger.info(`Migration completed successfully: ${migration.name}`, { duration_ms: duration });

      return {
        id: migration.id,
        name: migration.name,
        success: true,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      rootLogger.error(`Migration failed: ${migration.name}`, { 
        error: errorMessage, 
        duration_ms: duration 
      });

      // Record failure
      await this.recordMigrationCompletion(migration.name, false, errorMessage);

      return {
        id: migration.id,
        name: migration.name,
        success: false,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Run all pending migrations
   */
  public async runMigrations(): Promise<MigrationRunResult> {
    const overallStartTime = Date.now();
    
    try {
      rootLogger.info('Starting database migration process');

      // Ensure migration tracking table exists
      await this.ensureMigrationTable();

      // Load all migration files
      const migrations = await this.loadMigrationFiles();
      
      if (migrations.length === 0) {
        rootLogger.warn('No migration files found');
        return {
          success: true,
          totalMigrations: 0,
          executedMigrations: 0,
          skippedMigrations: 0,
          failedMigrations: 0,
          results: [],
          totalDuration: Date.now() - overallStartTime,
        };
      }

      // Execute migrations in order
      const results: MigrationResult[] = [];
      let executedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const migration of migrations) {
        const result = await this.executeMigration(migration);
        results.push(result);

        if (result.success) {
          if (result.skipped) {
            skippedCount++;
          } else {
            executedCount++;
          }
        } else {
          failedCount++;
          // Stop on first failure for safety
          rootLogger.error('Migration failed, stopping execution', { 
            failed_migration: migration.name,
            error: result.error 
          });
          break;
        }
      }

      const totalDuration = Date.now() - overallStartTime;
      const success = failedCount === 0;

      const summary = {
        success,
        totalMigrations: migrations.length,
        executedMigrations: executedCount,
        skippedMigrations: skippedCount,
        failedMigrations: failedCount,
        results,
        totalDuration,
      };

      if (success) {
        rootLogger.info('Database migration process completed successfully', {
          total_migrations: migrations.length,
          executed: executedCount,
          skipped: skippedCount,
          total_duration_ms: totalDuration,
        });
      } else {
        rootLogger.error('Database migration process failed', {
          total_migrations: migrations.length,
          executed: executedCount,
          skipped: skippedCount,
          failed: failedCount,
          total_duration_ms: totalDuration,
        });
      }

      return summary;
    } catch (error) {
      const totalDuration = Date.now() - overallStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      rootLogger.error('Migration process failed with unexpected error', { 
        error: errorMessage,
        total_duration_ms: totalDuration 
      });

      return {
        success: false,
        totalMigrations: 0,
        executedMigrations: 0,
        skippedMigrations: 0,
        failedMigrations: 1,
        results: [{
          id: 'system',
          name: 'migration_process',
          success: false,
          duration: totalDuration,
          error: errorMessage,
        }],
        totalDuration,
      };
    }
  }

  /**
   * Get migration status for all migrations
   */
  public async getMigrationStatus(): Promise<Array<{
    migration_name: string;
    status: string;
    started_at?: Date;
    completed_at?: Date;
    error_message?: string;
  }>> {
    try {
      const result = await this.pool.query(`
        SELECT migration_name, status, started_at, completed_at, error_message
        FROM migration_status
        ORDER BY migration_name
      `);
      
      return result.rows;
    } catch (error) {
      rootLogger.error('Failed to get migration status', { error: error instanceof Error ? error.message : error });
      return [];
    }
  }

  /**
   * Reset migration status (for development/testing)
   */
  public async resetMigrationStatus(migrationName?: string): Promise<void> {
    try {
      if (migrationName) {
        await this.pool.query('DELETE FROM migration_status WHERE migration_name = $1', [migrationName]);
        rootLogger.info(`Reset migration status for: ${migrationName}`);
      } else {
        await this.pool.query('DELETE FROM migration_status');
        rootLogger.info('Reset all migration status');
      }
    } catch (error) {
      rootLogger.error('Failed to reset migration status', { error: error instanceof Error ? error.message : error });
      throw error;
    }
  }
}

// Singleton instance
let migrationRunner: MigrationRunner | null = null;

export function getMigrationRunner(): MigrationRunner {
  if (!migrationRunner) {
    migrationRunner = new MigrationRunner();
  }
  return migrationRunner;
}

// Convenience function for startup
export async function runStartupMigrations(): Promise<MigrationRunResult> {
  const runner = getMigrationRunner();
  return await runner.runMigrations();
}