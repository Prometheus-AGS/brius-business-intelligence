# Database Migration System

This document describes the automated database migration system that ensures all migrations are executed during system startup.

## Overview

The migration system automatically runs all SQL migration files in the `/migrations` directory when the system starts up. This ensures that the database schema is always up-to-date and consistent across all environments.

## Key Features

- **Automatic Execution**: Migrations run automatically during system startup
- **Idempotent**: Safe to run multiple times - already executed migrations are skipped
- **Tracking**: Migration status is tracked in the `migration_status` table
- **Error Handling**: Failed migrations stop the startup process for safety
- **Monitoring**: API endpoints provide migration status and health information
- **Retry Logic**: Built-in retry mechanism for transient failures

## Migration Files

Migration files are located in the `/migrations` directory and follow this naming convention:

```
001-setup-pgvector.sql
002-create-functions.sql
003-migrate-data.sql
004-mime-types.sql
005-create-processing-jobs.sql
006-create-exec-sql-function.sql
```

### Naming Convention

- **Prefix**: 3-digit number (001, 002, etc.) for ordering
- **Description**: Kebab-case description of the migration
- **Extension**: `.sql` file extension

## Migration Execution Order

Migrations are executed in alphabetical order by filename. The numeric prefix ensures proper sequencing.

## Migration Status Tracking

The system tracks migration status in the `migration_status` table:

```sql
CREATE TABLE migration_status (
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
```

### Migration Statuses

- **pending**: Migration has not been executed
- **running**: Migration is currently being executed
- **completed**: Migration executed successfully
- **failed**: Migration failed with an error

## Startup Integration

The migration system is integrated into the startup process as a critical phase:

```typescript
{
  name: 'database_migrations',
  description: 'Run database migrations',
  required: true,
  timeout: 120000,
  retries: 2,
  execute: async () => {
    const migrationResult = await runStartupMigrations();
    if (!migrationResult.success) {
      throw new Error(`Database migrations failed: ${migrationResult.failedMigrations} failed migrations`);
    }
  }
}
```

### Startup Sequence

1. **Environment**: Load environment configuration
2. **Database Health**: Check database connectivity
3. **Database Migrations**: ← **Run all pending migrations**
4. **Vector Store**: Initialize vector store and indexes
5. **Memory Store**: Initialize memory store
6. **MCP Tools**: Load MCP tools
7. **Agents & Workflows**: Register agents and workflows
8. **API Routes**: Initialize API routes
9. **Mastra Instance**: Create Mastra instance
10. **Background Services**: Start background services

## API Endpoints

The system provides several API endpoints for monitoring migration status:

### GET `/database/migrations/status`

Returns the status of all migrations:

```json
{
  "success": true,
  "data": {
    "total_migrations": 6,
    "completed": 6,
    "failed": 0,
    "running": 0,
    "pending": 0,
    "migrations": [
      {
        "name": "001-setup-pgvector",
        "status": "completed",
        "started_at": "2025-01-21T10:00:00Z",
        "completed_at": "2025-01-21T10:00:05Z",
        "error_message": null,
        "duration_ms": 5000
      }
    ]
  }
}
```

### GET `/database/migrations/health`

Returns migration health status:

```json
{
  "success": true,
  "data": {
    "healthy": true,
    "status": "ok",
    "total_migrations": 6,
    "completed": 6,
    "failed": 0,
    "running": 0,
    "stuck": 0,
    "issues": []
  }
}
```

### POST `/database/migrations/run`

Manually trigger migration execution (for development/admin use):

```json
{
  "success": true,
  "message": "Migrations completed successfully",
  "data": {
    "total_migrations": 6,
    "executed": 0,
    "skipped": 6,
    "failed": 0,
    "duration_ms": 1500,
    "results": [...]
  }
}
```

### POST `/database/migrations/reset`

Reset migration status (development only):

```json
{
  "migration_name": "001-setup-pgvector"  // Optional: reset specific migration
}
```

## Creating New Migrations

### 1. Create Migration File

Create a new SQL file in the `/migrations` directory:

```bash
# Example: Adding a new table
touch migrations/007-create-analytics-table.sql
```

### 2. Write Migration SQL

```sql
-- migrations/007-create-analytics-table.sql

-- Create analytics table for tracking user interactions
CREATE TABLE IF NOT EXISTS user_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for performance
  INDEX idx_user_analytics_user_id ON user_analytics(user_id),
  INDEX idx_user_analytics_event_type ON user_analytics(event_type),
  INDEX idx_user_analytics_created_at ON user_analytics(created_at DESC)
);

-- Add helpful comment
COMMENT ON TABLE user_analytics IS 'Tracks user interactions and events for analytics';
```

### 3. Test Migration

The migration will be automatically executed on the next system startup. For testing:

1. **Development**: Restart the development server (`pnpm dev`)
2. **Manual Testing**: Use the `/database/migrations/run` API endpoint
3. **Status Check**: Use the `/database/migrations/status` API endpoint

## Best Practices

### Migration Design

1. **Idempotent**: Use `IF NOT EXISTS`, `IF EXISTS`, etc.
2. **Backward Compatible**: Avoid breaking changes when possible
3. **Atomic**: Each migration should be a complete, atomic operation
4. **Documented**: Include comments explaining the purpose

### Error Handling

1. **Validation**: Test migrations thoroughly before deployment
2. **Rollback Plan**: Have a rollback strategy for complex migrations
3. **Monitoring**: Monitor migration status during deployments

### Performance

1. **Indexes**: Create indexes concurrently when possible
2. **Batching**: For large data migrations, consider batching
3. **Timing**: Run heavy migrations during low-traffic periods

## Troubleshooting

### Common Issues

#### Migration Stuck in "running" Status

```bash
# Check for long-running queries
SELECT * FROM pg_stat_activity WHERE state = 'active';

# Reset migration status (development only)
curl -X POST http://localhost:3000/database/migrations/reset \
  -H "Content-Type: application/json" \
  -d '{"migration_name": "problematic-migration"}'
```

#### Migration Failed

1. Check the error message in the migration status
2. Review the migration SQL for syntax errors
3. Ensure database permissions are correct
4. Check for conflicting schema changes

#### Startup Fails Due to Migration

1. Check the startup logs for migration errors
2. Fix the problematic migration file
3. Restart the system

### Monitoring

Use the health endpoint to monitor migration status:

```bash
# Check migration health
curl http://localhost:3000/database/migrations/health

# Check detailed status
curl http://localhost:3000/database/migrations/status
```

## Security Considerations

1. **Production Safety**: Migration reset is disabled in production
2. **Permissions**: Ensure database user has necessary permissions
3. **Validation**: Validate migration files before deployment
4. **Backup**: Always backup database before major migrations

## Integration with CI/CD

The migration system integrates seamlessly with CI/CD pipelines:

1. **Automated Testing**: Migrations run automatically in test environments
2. **Deployment**: No manual intervention required during deployment
3. **Rollback**: System startup fails if migrations fail, preventing bad deployments
4. **Monitoring**: Use health endpoints for deployment verification

## Example Migration Workflow

```bash
# 1. Create new migration
echo "-- Add new feature table
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);" > migrations/008-create-feature-flags.sql

# 2. Test locally
pnpm dev  # Migrations run automatically

# 3. Check status
curl http://localhost:3000/database/migrations/status

# 4. Deploy (migrations run automatically on startup)
git add migrations/008-create-feature-flags.sql
git commit -m "feat: add feature flags table"
git push origin main
```

This automated migration system ensures database consistency and eliminates manual migration steps during deployments.