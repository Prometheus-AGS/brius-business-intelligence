-- ============================================================================
-- Semantic Search Function for pgvector
-- ============================================================================
-- This function performs semantic similarity search across memory tables
-- using pgvector's cosine distance operator (<=>)
--
-- Compatible with tables: user_memories, global_memories, document_chunks
-- ============================================================================

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the semantic_search function
CREATE OR REPLACE FUNCTION semantic_search(
  query_embedding vector(1536),
  search_table TEXT DEFAULT 'user_memories',
  user_filter TEXT DEFAULT NULL,
  match_threshold float DEFAULT 0.8,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity float,
  metadata JSONB
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  -- Validate search_table parameter
  IF search_table NOT IN ('user_memories', 'global_memories', 'document_chunks') THEN
    RAISE EXCEPTION 'Invalid search_table: %. Must be one of: user_memories, global_memories, document_chunks', search_table;
  END IF;

  -- Validate match_threshold
  IF match_threshold < 0 OR match_threshold > 1 THEN
    RAISE EXCEPTION 'match_threshold must be between 0 and 1, got: %', match_threshold;
  END IF;

  -- Validate match_count
  IF match_count <= 0 OR match_count > 1000 THEN
    RAISE EXCEPTION 'match_count must be between 1 and 1000, got: %', match_count;
  END IF;

  -- Search user_memories table
  IF search_table = 'user_memories' AND user_filter IS NOT NULL THEN
    RETURN QUERY
    SELECT
      um.id,
      um.content,
      1 - (um.embedding <=> query_embedding) as similarity,
      um.metadata
    FROM user_memories um
    WHERE um.user_id = user_filter
      AND 1 - (um.embedding <=> query_embedding) > match_threshold
    ORDER BY um.embedding <=> query_embedding
    LIMIT match_count;

  ELSIF search_table = 'user_memories' AND user_filter IS NULL THEN
    -- Search all user memories when no user filter is provided
    RETURN QUERY
    SELECT
      um.id,
      um.content,
      1 - (um.embedding <=> query_embedding) as similarity,
      um.metadata
    FROM user_memories um
    WHERE 1 - (um.embedding <=> query_embedding) > match_threshold
    ORDER BY um.embedding <=> query_embedding
    LIMIT match_count;

  -- Search global_memories table
  ELSIF search_table = 'global_memories' THEN
    RETURN QUERY
    SELECT
      gm.id,
      gm.content,
      1 - (gm.embedding <=> query_embedding) as similarity,
      gm.metadata
    FROM global_memories gm
    WHERE 1 - (gm.embedding <=> query_embedding) > match_threshold
    ORDER BY gm.embedding <=> query_embedding
    LIMIT match_count;

  -- Search document_chunks table
  ELSIF search_table = 'document_chunks' THEN
    RETURN QUERY
    SELECT
      dc.id,
      dc.content,
      1 - (dc.embedding <=> query_embedding) as similarity,
      dc.chunk_metadata as metadata
    FROM document_chunks dc
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
  END IF;

END;
$$;

-- Add function comment for documentation
COMMENT ON FUNCTION semantic_search(vector, TEXT, TEXT, float, int) IS
'Performs semantic similarity search using pgvector cosine distance.
Supports user_memories, global_memories, and document_chunks tables.
Returns results ordered by similarity score (higher = more similar).
Parameters:
- query_embedding: 1536-dimensional vector for search
- search_table: Table to search (user_memories, global_memories, document_chunks)
- user_filter: Optional user_id filter for user_memories table
- match_threshold: Minimum similarity score (0-1, default 0.8)
- match_count: Maximum results to return (1-1000, default 10)';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION semantic_search(vector, TEXT, TEXT, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION semantic_search(vector, TEXT, TEXT, float, int) TO service_role;

-- ============================================================================
-- Example Usage:
-- ============================================================================
/*
-- Search user memories for a specific user
SELECT * FROM semantic_search(
  '[0.1, 0.2, 0.3, ...]'::vector(1536),
  'user_memories',
  'user123',
  0.7,
  5
);

-- Search global memories
SELECT * FROM semantic_search(
  '[0.1, 0.2, 0.3, ...]'::vector(1536),
  'global_memories',
  NULL,
  0.8,
  10
);

-- Search document chunks
SELECT * FROM semantic_search(
  '[0.1, 0.2, 0.3, ...]'::vector(1536),
  'document_chunks',
  NULL,
  0.75,
  20
);
*/

-- Verify function was created successfully
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'semantic_search'
    AND pronargs = 5
  ) THEN
    RAISE NOTICE '✅ semantic_search function created successfully';
  ELSE
    RAISE WARNING '⚠️ Failed to create semantic_search function';
  END IF;
END $$;