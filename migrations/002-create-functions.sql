-- Semantic search function
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

-- Hybrid search function
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
  END IF;
END;
$$;