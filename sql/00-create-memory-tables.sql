-- ============================================================================
-- Memory Tables Creation for pgvector Knowledge Base
-- ============================================================================
-- This script creates the user_memories and global_memories tables that are
-- required by the semantic_search() and hybrid_search() functions.
--
-- These tables store user-specific and global memory embeddings for AI agents.
-- ============================================================================

-- Ensure required extensions are enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Create User Memories Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Constraints
  CONSTRAINT user_memories_embedding_not_null CHECK (embedding IS NOT NULL),
  CONSTRAINT user_memories_content_not_empty CHECK (TRIM(content) != ''),
  CONSTRAINT user_memories_user_id_not_empty CHECK (TRIM(user_id) != '')
);

-- ============================================================================
-- Create Global Memories Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS global_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  category TEXT DEFAULT 'general',
  access_level TEXT DEFAULT 'public',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Constraints
  CONSTRAINT global_memories_embedding_not_null CHECK (embedding IS NOT NULL),
  CONSTRAINT global_memories_content_not_empty CHECK (TRIM(content) != ''),
  CONSTRAINT global_memories_access_level_check
    CHECK (access_level IN ('public', 'restricted', 'admin'))
);

-- ============================================================================
-- Create Indexes for User Memories
-- ============================================================================

-- Standard B-tree indexes
CREATE INDEX IF NOT EXISTS user_memories_user_id_idx
  ON user_memories(user_id);

CREATE INDEX IF NOT EXISTS user_memories_category_idx
  ON user_memories(category);

CREATE INDEX IF NOT EXISTS user_memories_created_at_idx
  ON user_memories(created_at DESC);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS user_memories_metadata_gin_idx
  ON user_memories USING gin(metadata);

-- Full-text search index for content
CREATE INDEX IF NOT EXISTS user_memories_content_fts_idx
  ON user_memories
  USING gin(to_tsvector('english', content));

-- HNSW index for vector similarity search (pgvector)
-- Note: This may take time on large datasets
CREATE INDEX IF NOT EXISTS user_memories_embedding_hnsw_idx
  ON user_memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Create Indexes for Global Memories
-- ============================================================================

-- Standard B-tree indexes
CREATE INDEX IF NOT EXISTS global_memories_category_idx
  ON global_memories(category);

CREATE INDEX IF NOT EXISTS global_memories_access_level_idx
  ON global_memories(access_level);

CREATE INDEX IF NOT EXISTS global_memories_created_by_idx
  ON global_memories(created_by);

CREATE INDEX IF NOT EXISTS global_memories_created_at_idx
  ON global_memories(created_at DESC);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS global_memories_metadata_gin_idx
  ON global_memories USING gin(metadata);

-- Full-text search index for content
CREATE INDEX IF NOT EXISTS global_memories_content_fts_idx
  ON global_memories
  USING gin(to_tsvector('english', content));

-- HNSW index for vector similarity search (pgvector)
-- Note: This may take time on large datasets
CREATE INDEX IF NOT EXISTS global_memories_embedding_hnsw_idx
  ON global_memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Create Triggers for Updated Timestamps
-- ============================================================================

-- Function to update the updated_at timestamp (reuse if exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for both tables
DROP TRIGGER IF EXISTS update_user_memories_updated_at ON user_memories;
CREATE TRIGGER update_user_memories_updated_at
    BEFORE UPDATE ON user_memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_global_memories_updated_at ON global_memories;
CREATE TRIGGER update_global_memories_updated_at
    BEFORE UPDATE ON global_memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Create Helper Functions
-- ============================================================================

-- Function to get user memory statistics
CREATE OR REPLACE FUNCTION get_user_memory_stats(target_user_id TEXT)
RETURNS TABLE (
  total_memories INTEGER,
  categories JSONB,
  date_range JSONB,
  avg_content_length NUMERIC
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as memory_count,
      AVG(LENGTH(content)) as avg_length,
      MIN(created_at) as oldest,
      MAX(created_at) as newest
    FROM user_memories
    WHERE user_id = target_user_id
  ),
  category_counts AS (
    SELECT jsonb_object_agg(category, count) as cat_json
    FROM (
      SELECT category, COUNT(*) as count
      FROM user_memories
      WHERE user_id = target_user_id
      GROUP BY category
    ) cc
  )
  SELECT
    s.memory_count::INTEGER,
    cc.cat_json,
    jsonb_build_object(
      'oldest', s.oldest,
      'newest', s.newest
    ),
    ROUND(s.avg_length, 2)
  FROM stats s
  CROSS JOIN category_counts cc;
END;
$$;

-- Function to get global memory statistics
CREATE OR REPLACE FUNCTION get_global_memory_stats()
RETURNS TABLE (
  total_memories INTEGER,
  access_level_counts JSONB,
  category_counts JSONB,
  avg_content_length NUMERIC
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as memory_count,
      AVG(LENGTH(content)) as avg_length
    FROM global_memories
  ),
  access_counts AS (
    SELECT jsonb_object_agg(access_level, count) as access_json
    FROM (
      SELECT access_level, COUNT(*) as count
      FROM global_memories
      GROUP BY access_level
    ) ac
  ),
  category_counts AS (
    SELECT jsonb_object_agg(category, count) as cat_json
    FROM (
      SELECT category, COUNT(*) as count
      FROM global_memories
      GROUP BY category
    ) cc
  )
  SELECT
    s.memory_count::INTEGER,
    ac.access_json,
    cc.cat_json,
    ROUND(s.avg_length, 2)
  FROM stats s
  CROSS JOIN access_counts ac
  CROSS JOIN category_counts cc;
END;
$$;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON user_memories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON global_memories TO authenticated;

-- Grant function permissions
GRANT EXECUTE ON FUNCTION get_user_memory_stats(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_global_memory_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO authenticated;

-- Service role permissions (for admin operations)
GRANT ALL ON user_memories TO service_role;
GRANT ALL ON global_memories TO service_role;

-- ============================================================================
-- Table Comments for Documentation
-- ============================================================================

COMMENT ON TABLE user_memories IS
'Stores user-specific memory embeddings for AI agents and applications.
Each row represents a piece of content associated with a specific user,
with vector embeddings for semantic similarity search.';

COMMENT ON TABLE global_memories IS
'Stores global/shared memory embeddings accessible across users.
Includes access level controls (public, restricted, admin) for content sharing.';

COMMENT ON COLUMN user_memories.embedding IS
'1536-dimensional vector embedding for semantic similarity search using pgvector.
Generated from content using embedding models (OpenAI, Bedrock Titan, etc.)';

COMMENT ON COLUMN global_memories.embedding IS
'1536-dimensional vector embedding for semantic similarity search using pgvector.
Generated from content using embedding models (OpenAI, Bedrock Titan, etc.)';

COMMENT ON COLUMN user_memories.metadata IS
'JSON metadata including importance level, source, tags, and other contextual information.';

COMMENT ON COLUMN global_memories.metadata IS
'JSON metadata including importance level, source, tags, creation context, and other information.';

-- ============================================================================
-- Verification and Success Message
-- ============================================================================

DO $$
DECLARE
  user_table_exists BOOLEAN;
  global_table_exists BOOLEAN;
  user_vector_index_exists BOOLEAN;
  global_vector_index_exists BOOLEAN;
  user_fts_index_exists BOOLEAN;
  global_fts_index_exists BOOLEAN;
BEGIN
  -- Check if tables were created
  SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'user_memories' AND table_schema = 'public'
  ) INTO user_table_exists;

  SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'global_memories' AND table_schema = 'public'
  ) INTO global_table_exists;

  -- Check if key indexes exist
  SELECT EXISTS (
    SELECT FROM pg_indexes
    WHERE indexname = 'user_memories_embedding_hnsw_idx'
  ) INTO user_vector_index_exists;

  SELECT EXISTS (
    SELECT FROM pg_indexes
    WHERE indexname = 'global_memories_embedding_hnsw_idx'
  ) INTO global_vector_index_exists;

  SELECT EXISTS (
    SELECT FROM pg_indexes
    WHERE indexname = 'user_memories_content_fts_idx'
  ) INTO user_fts_index_exists;

  SELECT EXISTS (
    SELECT FROM pg_indexes
    WHERE indexname = 'global_memories_content_fts_idx'
  ) INTO global_fts_index_exists;

  -- Report results
  IF user_table_exists THEN
    RAISE NOTICE '✅ user_memories table created successfully';
  ELSE
    RAISE WARNING '⚠️ Failed to create user_memories table';
  END IF;

  IF global_table_exists THEN
    RAISE NOTICE '✅ global_memories table created successfully';
  ELSE
    RAISE WARNING '⚠️ Failed to create global_memories table';
  END IF;

  IF user_vector_index_exists THEN
    RAISE NOTICE '✅ User memories vector index (HNSW) created successfully';
  ELSE
    RAISE NOTICE 'ℹ️ User memories vector index creation may still be in progress';
  END IF;

  IF global_vector_index_exists THEN
    RAISE NOTICE '✅ Global memories vector index (HNSW) created successfully';
  ELSE
    RAISE NOTICE 'ℹ️ Global memories vector index creation may still be in progress';
  END IF;

  IF user_fts_index_exists THEN
    RAISE NOTICE '✅ User memories full-text search index created successfully';
  ELSE
    RAISE WARNING '⚠️ User memories full-text search index not found';
  END IF;

  IF global_fts_index_exists THEN
    RAISE NOTICE '✅ Global memories full-text search index created successfully';
  ELSE
    RAISE WARNING '⚠️ Global memories full-text search index not found';
  END IF;

  -- Final summary
  IF user_table_exists AND global_table_exists THEN
    RAISE NOTICE '';
    RAISE NOTICE '🎉 MEMORY TABLES SCHEMA READY!';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  ✓ user_memories - User-specific memory storage';
    RAISE NOTICE '  ✓ global_memories - Shared memory storage';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Create semantic_search() and hybrid_search() functions';
    RAISE NOTICE '  2. Create document_chunks table';
    RAISE NOTICE '  3. Test vector search operations';
    RAISE NOTICE '';
  END IF;
END $$;