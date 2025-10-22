-- ============================================================================
-- Hybrid Search Function for pgvector + Full-Text Search
-- ============================================================================
-- This function combines vector similarity search with PostgreSQL full-text
-- search to provide hybrid ranking based on both semantic and lexical matching
--
-- Uses ts_rank_cd for text relevance and pgvector cosine distance for semantic similarity
-- ============================================================================

-- Ensure required extensions are enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the hybrid_search function
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text TEXT,
  query_embedding vector(1536),
  search_table TEXT DEFAULT 'document_chunks',
  text_weight float DEFAULT 0.3,
  vector_weight float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  rank float,
  metadata JSONB
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  -- Validate search_table parameter
  IF search_table NOT IN ('document_chunks', 'user_memories', 'global_memories') THEN
    RAISE EXCEPTION 'Invalid search_table: %. Must be one of: document_chunks, user_memories, global_memories', search_table;
  END IF;

  -- Validate weights
  IF text_weight < 0 OR text_weight > 1 THEN
    RAISE EXCEPTION 'text_weight must be between 0 and 1, got: %', text_weight;
  END IF;

  IF vector_weight < 0 OR vector_weight > 1 THEN
    RAISE EXCEPTION 'vector_weight must be between 0 and 1, got: %', vector_weight;
  END IF;

  IF ABS((text_weight + vector_weight) - 1.0) > 0.001 THEN
    RAISE EXCEPTION 'text_weight and vector_weight must sum to 1.0, got: % + % = %',
      text_weight, vector_weight, (text_weight + vector_weight);
  END IF;

  -- Validate match_count
  IF match_count <= 0 OR match_count > 1000 THEN
    RAISE EXCEPTION 'match_count must be between 1 and 1000, got: %', match_count;
  END IF;

  -- Validate query_text is not empty
  IF query_text IS NULL OR TRIM(query_text) = '' THEN
    RAISE EXCEPTION 'query_text cannot be null or empty';
  END IF;

  -- Search document_chunks table (primary use case)
  IF search_table = 'document_chunks' THEN
    RETURN QUERY
    WITH text_search AS (
      SELECT
        dc.id,
        ts_rank_cd(to_tsvector('english', dc.content), plainto_tsquery('english', query_text)) as text_rank
      FROM document_chunks dc
      WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', query_text)
    ),
    vector_search AS (
      SELECT
        dc.id,
        1 - (dc.embedding <=> query_embedding) as vector_rank
      FROM document_chunks dc
    )
    SELECT
      v.id,
      dc.content,
      (COALESCE(t.text_rank, 0) * text_weight + v.vector_rank * vector_weight) as rank,
      dc.chunk_metadata as metadata
    FROM vector_search v
    LEFT JOIN text_search t ON v.id = t.id
    JOIN document_chunks dc ON v.id = dc.id
    ORDER BY rank DESC
    LIMIT match_count;

  -- Search user_memories table
  ELSIF search_table = 'user_memories' THEN
    RETURN QUERY
    WITH text_search AS (
      SELECT
        um.id,
        ts_rank_cd(to_tsvector('english', um.content), plainto_tsquery('english', query_text)) as text_rank
      FROM user_memories um
      WHERE to_tsvector('english', um.content) @@ plainto_tsquery('english', query_text)
    ),
    vector_search AS (
      SELECT
        um.id,
        1 - (um.embedding <=> query_embedding) as vector_rank
      FROM user_memories um
    )
    SELECT
      v.id,
      um.content,
      (COALESCE(t.text_rank, 0) * text_weight + v.vector_rank * vector_weight) as rank,
      um.metadata
    FROM vector_search v
    LEFT JOIN text_search t ON v.id = t.id
    JOIN user_memories um ON v.id = um.id
    ORDER BY rank DESC
    LIMIT match_count;

  -- Search global_memories table
  ELSIF search_table = 'global_memories' THEN
    RETURN QUERY
    WITH text_search AS (
      SELECT
        gm.id,
        ts_rank_cd(to_tsvector('english', gm.content), plainto_tsquery('english', query_text)) as text_rank
      FROM global_memories gm
      WHERE to_tsvector('english', gm.content) @@ plainto_tsquery('english', query_text)
    ),
    vector_search AS (
      SELECT
        gm.id,
        1 - (gm.embedding <=> query_embedding) as vector_rank
      FROM global_memories gm
    )
    SELECT
      v.id,
      gm.content,
      (COALESCE(t.text_rank, 0) * text_weight + v.vector_rank * vector_weight) as rank,
      gm.metadata
    FROM vector_search v
    LEFT JOIN text_search t ON v.id = t.id
    JOIN global_memories gm ON v.id = gm.id
    ORDER BY rank DESC
    LIMIT match_count;
  END IF;

END;
$$;

-- Add function comment for documentation
COMMENT ON FUNCTION hybrid_search(TEXT, vector, TEXT, float, float, int) IS
'Performs hybrid search combining full-text search with vector similarity.
Uses PostgreSQL ts_rank_cd for text relevance and pgvector cosine distance for semantic similarity.
Results are ranked by weighted combination of both scores.
Parameters:
- query_text: Text query for full-text search
- query_embedding: 1536-dimensional vector for semantic search
- search_table: Table to search (document_chunks, user_memories, global_memories)
- text_weight: Weight for text relevance score (0-1, default 0.3)
- vector_weight: Weight for vector similarity score (0-1, default 0.7)
- match_count: Maximum results to return (1-1000, default 10)
Note: text_weight + vector_weight must equal 1.0';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION hybrid_search(TEXT, vector, TEXT, float, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION hybrid_search(TEXT, vector, TEXT, float, float, int) TO service_role;

-- ============================================================================
-- Note: Supporting indexes for optimal performance
-- ============================================================================
-- The full-text search indexes required by this function are created
-- in the individual table creation scripts:
--   - user_memories_content_fts_idx (created in 00-create-memory-tables.sql)
--   - global_memories_content_fts_idx (created in 00-create-memory-tables.sql)
--   - document_chunks_content_fts_idx (created in 04-create-document-chunks-table.sql)
--
-- This approach prevents dependency issues during function creation.
-- ============================================================================

-- ============================================================================
-- Example Usage:
-- ============================================================================
/*
-- Hybrid search in document chunks (default)
SELECT * FROM hybrid_search(
  'artificial intelligence machine learning',
  '[0.1, 0.2, 0.3, ...]'::vector(1536),
  'document_chunks',
  0.3,  -- 30% text weight
  0.7,  -- 70% vector weight
  10
);

-- Balanced hybrid search
SELECT * FROM hybrid_search(
  'climate change sustainability',
  '[0.1, 0.2, 0.3, ...]'::vector(1536),
  'document_chunks',
  0.5,  -- 50% text weight
  0.5,  -- 50% vector weight
  15
);

-- Text-heavy hybrid search
SELECT * FROM hybrid_search(
  'database optimization performance',
  '[0.1, 0.2, 0.3, ...]'::vector(1536),
  'user_memories',
  0.8,  -- 80% text weight
  0.2,  -- 20% vector weight
  5
);
*/

-- Verify function was created successfully
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'hybrid_search'
    AND pronargs = 6
  ) THEN
    RAISE NOTICE '✅ hybrid_search function created successfully';
  ELSE
    RAISE WARNING '⚠️ Failed to create hybrid_search function';
  END IF;
END $$;