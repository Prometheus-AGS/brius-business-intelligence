-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create user_memories table
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT user_memories_embedding_not_null CHECK (embedding IS NOT NULL)
);

-- Create HNSW index for fast vector similarity search
CREATE INDEX CONCURRENTLY user_memories_embedding_hnsw_idx
ON user_memories
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Create additional indexes
CREATE INDEX user_memories_user_id_idx ON user_memories (user_id);
CREATE INDEX user_memories_category_idx ON user_memories (category);
CREATE INDEX user_memories_created_at_idx ON user_memories (created_at DESC);

-- Create global_memories table
CREATE TABLE global_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  category TEXT DEFAULT 'general',
  access_level TEXT DEFAULT 'public',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT global_memories_embedding_not_null CHECK (embedding IS NOT NULL),
  CONSTRAINT global_memories_access_level_check CHECK (access_level IN ('public', 'restricted', 'admin'))
);

-- Create HNSW index for global memory search
CREATE INDEX CONCURRENTLY global_memories_embedding_hnsw_idx
ON global_memories
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Create knowledge_documents and document_chunks tables
CREATE TABLE knowledge_documents (
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT knowledge_documents_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  chunk_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT document_chunks_embedding_not_null CHECK (embedding IS NOT NULL),
  CONSTRAINT document_chunks_chunk_index_positive CHECK (chunk_index >= 0),
  UNIQUE (document_id, chunk_index)
);

-- Create HNSW index for semantic search on document chunks
CREATE INDEX CONCURRENTLY document_chunks_embedding_hnsw_idx
ON document_chunks
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Migration status tracking
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