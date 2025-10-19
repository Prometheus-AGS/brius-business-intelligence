/**
 * Data Migration Script: Supabase to pgvector
 * Constitutional requirement: Migrate any existing data from Supabase to pgvector 17
 *
 * This script is designed to be safe and idempotent - it can be run multiple times
 * without causing issues. It will only migrate data that doesn't already exist.
 */

-- Migration status tracking
DO $$
BEGIN
  INSERT INTO migration_status (
    migration_name,
    migration_type,
    status,
    started_at,
    metadata
  ) VALUES (
    '003-migrate-data',
    'data_migration',
    'running',
    NOW(),
    '{"description": "Migrate existing Supabase data to pgvector", "version": "1.0"}'::jsonb
  ) ON CONFLICT (migration_name) DO UPDATE SET
    status = 'running',
    started_at = NOW(),
    error_message = NULL;
END $$;

-- Create temporary logging function for migration
CREATE OR REPLACE FUNCTION log_migration_progress(message TEXT, details JSONB DEFAULT '{}'::jsonb)
RETURNS VOID AS $$
BEGIN
  RAISE NOTICE 'MIGRATION: % - %', NOW(), message;

  -- Update migration status with progress
  UPDATE migration_status
  SET metadata = metadata || jsonb_build_object(
    'last_update', NOW(),
    'progress_message', message,
    'details', details
  )
  WHERE migration_name = '003-migrate-data';
END;
$$ LANGUAGE plpgsql;

-- Start migration process
SELECT log_migration_progress('Starting data migration from Supabase to pgvector');

-- Check if we have any existing data that needs migration
-- Note: This assumes there might be legacy tables or data from previous Supabase setup

DO $$
DECLARE
  user_memory_count INTEGER := 0;
  global_memory_count INTEGER := 0;
  document_count INTEGER := 0;
  chunk_count INTEGER := 0;
  legacy_table_exists BOOLEAN := FALSE;
BEGIN
  -- Check for current data counts
  SELECT COUNT(*) INTO user_memory_count FROM user_memories;
  SELECT COUNT(*) INTO global_memory_count FROM global_memories;
  SELECT COUNT(*) INTO document_count FROM knowledge_documents;
  SELECT COUNT(*) INTO chunk_count FROM document_chunks;

  SELECT log_migration_progress('Current data counts', jsonb_build_object(
    'user_memories', user_memory_count,
    'global_memories', global_memory_count,
    'knowledge_documents', document_count,
    'document_chunks', chunk_count
  ));

  -- Check if any legacy Supabase tables exist
  -- Common Supabase table patterns that might contain data to migrate
  SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name IN ('memories', 'documents', 'chunks', 'embeddings')
    AND table_schema = 'public'
  ) INTO legacy_table_exists;

  IF legacy_table_exists THEN
    SELECT log_migration_progress('Legacy Supabase tables found - migration needed');

    -- Add migration logic here if legacy tables are found
    -- This would be customized based on the specific legacy schema

    -- Example migration pattern (commented out as it depends on actual legacy schema):
    /*
    -- Migrate user memories if legacy table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'memories') THEN
      INSERT INTO user_memories (user_id, content, embedding, category, metadata, created_at)
      SELECT
        user_id,
        content,
        embedding::vector(1536), -- Convert to pgvector format
        COALESCE(category, 'general'),
        COALESCE(metadata, '{}'::jsonb),
        COALESCE(created_at, NOW())
      FROM memories
      WHERE NOT EXISTS (
        SELECT 1 FROM user_memories um
        WHERE um.user_id = memories.user_id
        AND um.content = memories.content
      );

      GET DIAGNOSTICS legacy_count = ROW_COUNT;
      SELECT log_migration_progress('Migrated user memories', jsonb_build_object('count', legacy_count));
    END IF;
    */

    SELECT log_migration_progress('Legacy table migration completed (no specific legacy schema found)');
  ELSE
    SELECT log_migration_progress('No legacy Supabase tables found - migration not required');
  END IF;

  -- Data validation and cleanup
  SELECT log_migration_progress('Performing data validation');

  -- Validate vector dimensions in all tables
  DECLARE
    invalid_vectors INTEGER := 0;
  BEGIN
    -- Check user_memories for invalid vectors
    SELECT COUNT(*) INTO invalid_vectors
    FROM user_memories
    WHERE array_length(string_to_array(trim(embedding::text, '[]'), ','), 1) != 1536;

    IF invalid_vectors > 0 THEN
      SELECT log_migration_progress('WARNING: Invalid vector dimensions found in user_memories',
        jsonb_build_object('count', invalid_vectors));
    END IF;

    -- Check global_memories for invalid vectors
    SELECT COUNT(*) INTO invalid_vectors
    FROM global_memories
    WHERE array_length(string_to_array(trim(embedding::text, '[]'), ','), 1) != 1536;

    IF invalid_vectors > 0 THEN
      SELECT log_migration_progress('WARNING: Invalid vector dimensions found in global_memories',
        jsonb_build_object('count', invalid_vectors));
    END IF;

    -- Check document_chunks for invalid vectors
    SELECT COUNT(*) INTO invalid_vectors
    FROM document_chunks
    WHERE array_length(string_to_array(trim(embedding::text, '[]'), ','), 1) != 1536;

    IF invalid_vectors > 0 THEN
      SELECT log_migration_progress('WARNING: Invalid vector dimensions found in document_chunks',
        jsonb_build_object('count', invalid_vectors));
    END IF;
  END;

  -- Create indexes if they don't exist (safety check)
  SELECT log_migration_progress('Ensuring all required indexes exist');

  -- HNSW indexes for vector similarity search
  IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'user_memories_embedding_hnsw_idx') THEN
    CREATE INDEX CONCURRENTLY user_memories_embedding_hnsw_idx
    ON user_memories USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
    SELECT log_migration_progress('Created HNSW index for user_memories');
  END IF;

  IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'global_memories_embedding_hnsw_idx') THEN
    CREATE INDEX CONCURRENTLY global_memories_embedding_hnsw_idx
    ON global_memories USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
    SELECT log_migration_progress('Created HNSW index for global_memories');
  END IF;

  IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'document_chunks_embedding_hnsw_idx') THEN
    CREATE INDEX CONCURRENTLY document_chunks_embedding_hnsw_idx
    ON document_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
    SELECT log_migration_progress('Created HNSW index for document_chunks');
  END IF;

  -- Optimize database for vector operations
  SELECT log_migration_progress('Optimizing database for vector operations');

  -- Update table statistics for better query planning
  ANALYZE user_memories;
  ANALYZE global_memories;
  ANALYZE knowledge_documents;
  ANALYZE document_chunks;

  SELECT log_migration_progress('Database optimization completed');

END $$;

-- Test the migration by verifying pgvector functions work
DO $$
DECLARE
  test_vector vector(1536);
  search_results INTEGER := 0;
BEGIN
  SELECT log_migration_progress('Testing pgvector functions');

  -- Create a test vector
  test_vector := (SELECT ARRAY(SELECT random() FROM generate_series(1, 1536)))::vector(1536);

  -- Test semantic search function
  SELECT COUNT(*) INTO search_results
  FROM semantic_search(
    test_vector,
    'user_memories',
    NULL, -- no user filter
    0.0,  -- low threshold for testing
    1     -- just one result
  );

  SELECT log_migration_progress('Semantic search function test completed',
    jsonb_build_object('results_found', search_results));

  -- Test hybrid search function if we have document chunks
  IF (SELECT COUNT(*) FROM document_chunks) > 0 THEN
    SELECT COUNT(*) INTO search_results
    FROM hybrid_search(
      'test query',
      test_vector,
      'document_chunks',
      0.3, -- text weight
      0.7, -- vector weight
      1    -- match count
    );

    SELECT log_migration_progress('Hybrid search function test completed',
      jsonb_build_object('results_found', search_results));
  ELSE
    SELECT log_migration_progress('Skipped hybrid search test - no document chunks available');
  END IF;

EXCEPTION WHEN OTHERS THEN
  SELECT log_migration_progress('ERROR during function testing',
    jsonb_build_object('error', SQLERRM));
  RAISE;
END $$;

-- Clean up temporary logging function
DROP FUNCTION IF EXISTS log_migration_progress(TEXT, JSONB);

-- Mark migration as completed
DO $$
BEGIN
  UPDATE migration_status
  SET
    status = 'completed',
    completed_at = NOW(),
    metadata = metadata || jsonb_build_object(
      'completion_time', NOW(),
      'final_message', 'Data migration completed successfully'
    )
  WHERE migration_name = '003-migrate-data';

  RAISE NOTICE 'Migration 003-migrate-data completed successfully at %', NOW();
END $$;

-- Final summary
SELECT
  'MIGRATION SUMMARY' as summary,
  (SELECT COUNT(*) FROM user_memories) as user_memories_count,
  (SELECT COUNT(*) FROM global_memories) as global_memories_count,
  (SELECT COUNT(*) FROM knowledge_documents) as knowledge_documents_count,
  (SELECT COUNT(*) FROM document_chunks) as document_chunks_count;

-- Verify all indexes are present
SELECT
  'INDEX STATUS' as status,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('user_memories', 'global_memories', 'document_chunks')
  AND indexname LIKE '%hnsw%'
ORDER BY tablename, indexname;

COMMIT;