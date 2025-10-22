/**
 * Migration Status API Routes
 * Provides endpoints for monitoring database migration status
 */

import { registerApiRoute } from '@mastra/core/server';
import { getMigrationRunner } from '../../config/migration-runner.js';
import { rootLogger } from '../../observability/logger.js';

/**
 * Get migration status for all migrations
 */
export function getMigrationRoutes() {
  return [
    registerApiRoute('/database/migrations/status', {
      method: 'GET',
      handler: async (c: any) => {
        try {
          const runner = getMigrationRunner();
          const status = await runner.getMigrationStatus();
          
          const summary = {
            total_migrations: status.length,
            completed: status.filter(m => m.status === 'completed').length,
            failed: status.filter(m => m.status === 'failed').length,
            running: status.filter(m => m.status === 'running').length,
            pending: status.filter(m => m.status === 'pending').length,
            migrations: status.map(migration => ({
              name: migration.migration_name,
              status: migration.status,
              started_at: migration.started_at,
              completed_at: migration.completed_at,
              error_message: migration.error_message,
              duration_ms: migration.started_at && migration.completed_at
                ? new Date(migration.completed_at).getTime() - new Date(migration.started_at).getTime()
                : null,
            })),
          };

          return c.json({
            success: true,
            data: summary,
          });
        } catch (error) {
          rootLogger.error('Failed to get migration status', { error: error instanceof Error ? error.message : error });
          return c.json({
            success: false,
            error: 'Failed to retrieve migration status',
            message: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    registerApiRoute('/database/migrations/run', {
      method: 'POST',
      handler: async (c: any) => {
        try {
          const runner = getMigrationRunner();
          const result = await runner.runMigrations();
          
          if (result.success) {
            return c.json({
              success: true,
              message: 'Migrations completed successfully',
              data: {
                total_migrations: result.totalMigrations,
                executed: result.executedMigrations,
                skipped: result.skippedMigrations,
                failed: result.failedMigrations,
                duration_ms: result.totalDuration,
                results: result.results,
              },
            });
          } else {
            return c.json({
              success: false,
              message: 'Migration process failed',
              data: {
                total_migrations: result.totalMigrations,
                executed: result.executedMigrations,
                skipped: result.skippedMigrations,
                failed: result.failedMigrations,
                duration_ms: result.totalDuration,
                results: result.results,
              },
            }, 500);
          }
        } catch (error) {
          rootLogger.error('Failed to run migrations', { error: error instanceof Error ? error.message : error });
          return c.json({
            success: false,
            error: 'Failed to run migrations',
            message: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    registerApiRoute('/database/migrations/reset', {
      method: 'POST',
      handler: async (c: any) => {
        try {
          // Only allow in development environment
          if (process.env.NODE_ENV === 'production') {
            return c.json({
              success: false,
              error: 'Migration reset not allowed in production',
            }, 403);
          }

          const body = await c.req.json();
          const migration_name = body?.migration_name;
          const runner = getMigrationRunner();
          
          await runner.resetMigrationStatus(migration_name);
          
          return c.json({
            success: true,
            message: migration_name 
              ? `Reset migration status for: ${migration_name}`
              : 'Reset all migration status',
          });
        } catch (error) {
          rootLogger.error('Failed to reset migration status', { error: error instanceof Error ? error.message : error });
          return c.json({
            success: false,
            error: 'Failed to reset migration status',
            message: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),

    registerApiRoute('/database/migrations/health', {
      method: 'GET',
      handler: async (c: any) => {
        try {
          const runner = getMigrationRunner();
          const status = await runner.getMigrationStatus();
          
          const failedMigrations = status.filter(m => m.status === 'failed');
          const runningMigrations = status.filter(m => m.status === 'running');
          const completedMigrations = status.filter(m => m.status === 'completed');
          
          // Check for stuck migrations (running for more than 10 minutes)
          const stuckMigrations = runningMigrations.filter(m => {
            if (!m.started_at) return false;
            const startTime = new Date(m.started_at).getTime();
            const now = Date.now();
            return (now - startTime) > 10 * 60 * 1000; // 10 minutes
          });

          const healthy = failedMigrations.length === 0 && stuckMigrations.length === 0;
          
          const healthData = {
            healthy,
            status: healthy ? 'ok' : 'degraded',
            total_migrations: status.length,
            completed: completedMigrations.length,
            failed: failedMigrations.length,
            running: runningMigrations.length,
            stuck: stuckMigrations.length,
            issues: [
              ...failedMigrations.map(m => ({
                type: 'failed_migration',
                migration: m.migration_name,
                error: m.error_message,
              })),
              ...stuckMigrations.map(m => ({
                type: 'stuck_migration',
                migration: m.migration_name,
                started_at: m.started_at,
              })),
            ],
          };

          return c.json({
            success: true,
            data: healthData,
          });
        } catch (error) {
          rootLogger.error('Failed to get migration health', { error: error instanceof Error ? error.message : error });
          return c.json({
            success: false,
            healthy: false,
            status: 'error',
            error: 'Failed to check migration health',
            message: error instanceof Error ? error.message : 'Unknown error',
          }, 500);
        }
      },
    }),
  ];
}