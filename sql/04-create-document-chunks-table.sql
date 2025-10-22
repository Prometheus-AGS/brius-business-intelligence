-- ============================================================================
-- Document Chunks Table Creation for pgvector Knowledge Base
-- ============================================================================
-- This table stores chunked document content with vector embeddings for
-- semantic search and retrieval. It's part of the knowledge management system.
--
-- Depends on: knowledge_documents table (parent table)
-- Required by: hybrid_search() and semantic_search() functions
-- ============================================================================

-- Ensure required extensions are enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create knowledge_documents table first (parent table)
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT,
  file_type TEXT,
  file_size INTEGER,
  category TEXT DEFAULT 'general',
  tags TEXT[] DEFAULT '{}',
  upload_user_id TEXT,
  processing_status TEXT DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Constraints
  CONSTRAINT knowledge_documents_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Create document_chunks table
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  chunk_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT document_chunks_embedding_not_null CHECK (embedding IS NOT NULL),
  CONSTRAINT document_chunks_chunk_index_positive CHECK (chunk_index >= 0),
  CONSTRAINT document_chunks_content_not_empty CHECK (TRIM(content) != ''),

  -- Unique constraint to prevent duplicate chunks
  UNIQUE (document_id, chunk_index)
);

-- ============================================================================
-- Create Indexes for Optimal Performance
-- ============================================================================

-- Standard B-tree indexes
CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
  ON document_chunks(document_id);

CREATE INDEX IF NOT EXISTS document_chunks_chunk_index_idx
  ON document_chunks(chunk_index);

CREATE INDEX IF NOT EXISTS document_chunks_created_at_idx
  ON document_chunks(created_at DESC);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS document_chunks_metadata_gin_idx
  ON document_chunks USING gin(chunk_metadata);

-- Full-text search index for content
CREATE INDEX IF NOT EXISTS document_chunks_content_fts_idx
  ON document_chunks
  USING gin(to_tsvector('english', content));

-- HNSW index for vector similarity search (pgvector)
-- Note: This may take time on large datasets
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Alternative: IVFFlat index (faster to create, less accurate)
-- Uncomment if HNSW index creation is too slow:
-- CREATE INDEX IF NOT EXISTS document_chunks_embedding_ivfflat_idx
--   ON document_chunks
--   USING ivfflat (embedding vector_cosine_ops)
--   WITH (lists = 100);

-- ============================================================================
-- Create Indexes for Parent Table (knowledge_documents)
-- ============================================================================

-- Indexes for knowledge_documents table
CREATE INDEX IF NOT EXISTS knowledge_documents_category_idx
  ON knowledge_documents(category);

CREATE INDEX IF NOT EXISTS knowledge_documents_processing_status_idx
  ON knowledge_documents(processing_status);

CREATE INDEX IF NOT EXISTS knowledge_documents_created_at_idx
  ON knowledge_documents(created_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_documents_upload_user_id_idx
  ON knowledge_documents(upload_user_id);

-- GIN index for tags array
CREATE INDEX IF NOT EXISTS knowledge_documents_tags_gin_idx
  ON knowledge_documents USING gin(tags);

-- GIN index for metadata
CREATE INDEX IF NOT EXISTS knowledge_documents_metadata_gin_idx
  ON knowledge_documents USING gin(metadata);

-- Full-text search index for document content
CREATE INDEX IF NOT EXISTS knowledge_documents_content_fts_idx
  ON knowledge_documents
  USING gin(to_tsvector('english', title || ' ' || content));

-- ============================================================================
-- Create Trigger for Updated Timestamp
-- ============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for knowledge_documents
DROP TRIGGER IF EXISTS update_knowledge_documents_updated_at ON knowledge_documents;
CREATE TRIGGER update_knowledge_documents_updated_at
    BEFORE UPDATE ON knowledge_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Create Helper Functions
-- ============================================================================

-- Function to get document chunks with their parent document info
CREATE OR REPLACE FUNCTION get_document_chunks_with_document(
  doc_id UUID DEFAULT NULL,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
  chunk_id UUID,
  chunk_content TEXT,
  chunk_index INTEGER,
  chunk_metadata JSONB,
  document_id UUID,
  document_title TEXT,
  document_category TEXT,
  document_file_type TEXT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  IF doc_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      dc.id as chunk_id,
      dc.content as chunk_content,
      dc.chunk_index,
      dc.chunk_metadata,
      kd.id as document_id,
      kd.title as document_title,
      kd.category as document_category,
      kd.file_type as document_file_type
    FROM document_chunks dc
    JOIN knowledge_documents kd ON dc.document_id = kd.id
    WHERE dc.document_id = doc_id
    ORDER BY dc.chunk_index
    LIMIT limit_count;
  ELSE
    RETURN QUERY
    SELECT
      dc.id as chunk_id,
      dc.content as chunk_content,
      dc.chunk_index,
      dc.chunk_metadata,
      kd.id as document_id,
      kd.title as document_title,
      kd.category as document_category,
      kd.file_type as document_file_type
    FROM document_chunks dc
    JOIN knowledge_documents kd ON dc.document_id = kd.id
    ORDER BY kd.created_at DESC, dc.chunk_index
    LIMIT limit_count;
  END IF;
END;
$$;

-- Function to get chunk statistics
CREATE OR REPLACE FUNCTION get_chunk_statistics()
RETURNS TABLE (
  total_documents INTEGER,
  total_chunks INTEGER,
  avg_chunks_per_document NUMERIC,
  avg_chunk_length NUMERIC,
  processing_status_counts JSONB
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(DISTINCT kd.id) as doc_count,
      COUNT(dc.id) as chunk_count,
      AVG(LENGTH(dc.content)) as avg_length
    FROM knowledge_documents kd
    LEFT JOIN document_chunks dc ON kd.id = dc.document_id
  ),
  status_counts AS (
    SELECT jsonb_object_agg(processing_status, count) as status_json
    FROM (
      SELECT processing_status, COUNT(*) as count
      FROM knowledge_documents
      GROUP BY processing_status
    ) sc
  )
  SELECT
    s.doc_count::INTEGER,
    s.chunk_count::INTEGER,
    CASE WHEN s.doc_count > 0 THEN ROUND(s.chunk_count::NUMERIC / s.doc_count, 2) ELSE 0 END,
    ROUND(s.avg_length, 2),
    sc.status_json
  FROM stats s
  CROSS JOIN status_counts sc;
END;
$$;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_chunks TO authenticated;

-- Grant function permissions
GRANT EXECUTE ON FUNCTION get_document_chunks_with_document(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_chunk_statistics() TO authenticated;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO authenticated;

-- Service role permissions (for admin operations)
GRANT ALL ON knowledge_documents TO service_role;
GRANT ALL ON document_chunks TO service_role;

-- Note: No sequences to grant permissions on since we're using gen_random_uuid()
-- which generates UUIDs without requiring sequences

-- ============================================================================
-- Table Comments for Documentation
-- ============================================================================

COMMENT ON TABLE knowledge_documents IS
'Stores document metadata and content for the knowledge management system.
Parent table for document_chunks. Supports various file types and processing status tracking.';

COMMENT ON TABLE document_chunks IS
'Stores chunked document content with vector embeddings for semantic search.
Each chunk represents a segment of a parent document with its own embedding vector.
Used by semantic_search() and hybrid_search() functions.';

COMMENT ON COLUMN document_chunks.embedding IS
'1536-dimensional vector embedding for semantic similarity search using pgvector.
Generated from chunk content using embedding models (OpenAI, Bedrock Titan, etc.)';

COMMENT ON COLUMN document_chunks.chunk_metadata IS
'JSON metadata for the chunk including chunk strategy, token counts, processing info, etc.';

-- ============================================================================
-- Verification and Success Message
-- ============================================================================

DO $$
DECLARE
  doc_table_exists BOOLEAN;
  chunks_table_exists BOOLEAN;
  vector_index_exists BOOLEAN;
  fts_index_exists BOOLEAN;
BEGIN
  -- Check if tables were created
  SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'knowledge_documents' AND table_schema = 'public'
  ) INTO doc_table_exists;

  SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'document_chunks' AND table_schema = 'public'
  ) INTO chunks_table_exists;

  -- Check if key indexes exist
  SELECT EXISTS (
    SELECT FROM pg_indexes
    WHERE indexname = 'document_chunks_embedding_hnsw_idx'
  ) INTO vector_index_exists;

  SELECT EXISTS (
    SELECT FROM pg_indexes
    WHERE indexname = 'document_chunks_content_fts_idx'
  ) INTO fts_index_exists;

  -- Report results
  IF doc_table_exists THEN
    RAISE NOTICE '✅ knowledge_documents table created successfully';
  ELSE
    RAISE WARNING '⚠️ Failed to create knowledge_documents table';
  END IF;

  IF chunks_table_exists THEN
    RAISE NOTICE '✅ document_chunks table created successfully';
  ELSE
    RAISE WARNING '⚠️ Failed to create document_chunks table';
  END IF;

  IF vector_index_exists THEN
    RAISE NOTICE '✅ Vector similarity index (HNSW) created successfully';
  ELSE
    RAISE NOTICE 'ℹ️ Vector index creation may still be in progress (large datasets take time)';
  END IF;

  IF fts_index_exists THEN
    RAISE NOTICE '✅ Full-text search index created successfully';
  ELSE
    RAISE WARNING '⚠️ Full-text search index not found';
  END IF;

  -- Final summary
  IF doc_table_exists AND chunks_table_exists THEN
    RAISE NOTICE '';
    RAISE NOTICE '🎉 DOCUMENT CHUNKS SCHEMA READY!';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run hybrid_search() and semantic_search() functions';
    RAISE NOTICE '  2. Insert document and chunk data using your Mastra application';
    RAISE NOTICE '  3. Test vector search operations';
    RAISE NOTICE '';
  END IF;
END $$;