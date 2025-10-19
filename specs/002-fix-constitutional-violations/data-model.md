# Data Model: Constitutional Compliance Fixes

**Date**: 2025-01-18
**Feature**: Constitutional Compliance Fixes for Mastra Business Intelligence System

## Overview

This document defines the data models and schemas required for constitutional compliance fixes, focusing on pgvector 17 database migration, enhanced observability structures, and MCP integration patterns.

## Database Schema: pgvector 17 Migration

### Core Vector Tables

#### user_memories
```sql
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Create HNSW index for fast vector similarity search
  CONSTRAINT user_memories_embedding_not_null CHECK (embedding IS NOT NULL)
);

-- HNSW index for production performance
CREATE INDEX CONCURRENTLY user_memories_embedding_hnsw_idx
ON user_memories
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Additional indexes for filtering
CREATE INDEX user_memories_user_id_idx ON user_memories (user_id);
CREATE INDEX user_memories_category_idx ON user_memories (category);
CREATE INDEX user_memories_created_at_idx ON user_memories (created_at DESC);
```

#### global_memories
```sql
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

-- HNSW index for global memory search
CREATE INDEX CONCURRENTLY global_memories_embedding_hnsw_idx
ON global_memories
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Filtering indexes
CREATE INDEX global_memories_category_idx ON global_memories (category);
CREATE INDEX global_memories_access_level_idx ON global_memories (access_level);
```

#### knowledge_documents
```sql
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

-- Indexes for document management
CREATE INDEX knowledge_documents_category_idx ON knowledge_documents (category);
CREATE INDEX knowledge_documents_tags_idx ON knowledge_documents USING GIN (tags);
CREATE INDEX knowledge_documents_status_idx ON knowledge_documents (processing_status);
CREATE INDEX knowledge_documents_created_at_idx ON knowledge_documents (created_at DESC);
```

#### document_chunks
```sql
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

-- HNSW index for semantic search on document chunks
CREATE INDEX CONCURRENTLY document_chunks_embedding_hnsw_idx
ON document_chunks
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- Foreign key index
CREATE INDEX document_chunks_document_id_idx ON document_chunks (document_id);
```

### PostgreSQL Functions for Vector Operations

#### semantic_search Function
```sql
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
```

#### hybrid_search Function
```sql
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
```

## Drizzle ORM Schema Definitions

### TypeScript Schema
```typescript
// src/mastra/database/schema.ts
import { pgTable, uuid, text, integer, timestamp, jsonb, vector, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// User memories table
export const userMemories = pgTable('user_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  category: text('category').default('general'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  embeddingHnswIdx: index('user_memories_embedding_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_l2_ops')),
  userIdIdx: index('user_memories_user_id_idx').on(table.userId),
  categoryIdx: index('user_memories_category_idx').on(table.category),
  createdAtIdx: index('user_memories_created_at_idx').on(table.createdAt.desc()),
}));

// Global memories table
export const globalMemories = pgTable('global_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  category: text('category').default('general'),
  accessLevel: text('access_level').default('public'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  embeddingHnswIdx: index('global_memories_embedding_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_l2_ops')),
  categoryIdx: index('global_memories_category_idx').on(table.category),
  accessLevelIdx: index('global_memories_access_level_idx').on(table.accessLevel),
}));

// Knowledge documents table
export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  filePath: text('file_path'),
  fileType: text('file_type'),
  fileSize: integer('file_size'),
  category: text('category').default('general'),
  tags: text('tags').array().default([]),
  uploadUserId: text('upload_user_id'),
  processingStatus: text('processing_status').default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  categoryIdx: index('knowledge_documents_category_idx').on(table.category),
  tagsIdx: index('knowledge_documents_tags_idx').using('gin', table.tags),
  statusIdx: index('knowledge_documents_status_idx').on(table.processingStatus),
  createdAtIdx: index('knowledge_documents_created_at_idx').on(table.createdAt.desc()),
}));

// Document chunks table
export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  chunkMetadata: jsonb('chunk_metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  embeddingHnswIdx: index('document_chunks_embedding_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_l2_ops')),
  documentIdIdx: index('document_chunks_document_id_idx').on(table.documentId),
  uniqueChunkIdx: index('document_chunks_unique_idx').on(table.documentId, table.chunkIndex),
}));

// Relations
export const documentsRelations = relations(knowledgeDocuments, ({ many }) => ({
  chunks: many(documentChunks),
}));

export const chunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [documentChunks.documentId],
    references: [knowledgeDocuments.id],
  }),
}));
```

## Observability Data Models

### LangFuse Trace Structure
```typescript
// src/mastra/types/observability.ts
export interface ComprehensiveTraceMetadata {
  // Core identification
  traceId: string;
  userId?: string;
  sessionId?: string;
  conversationId?: string;

  // Component context
  component: 'agent' | 'workflow' | 'tool' | 'mcp';
  operation: string;

  // Performance metrics
  performance: {
    startTime: number;
    endTime?: number;
    duration?: number;
    checkpoints: Array<{
      name: string;
      timestamp: number;
      data?: any;
    }>;
  };

  // Error tracking
  error?: {
    fingerprint: string;
    category: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    stack?: string;
    context: Record<string, any>;
  };

  // Tool call specifics
  toolCall?: {
    toolName: string;
    serverName?: string;
    input: any;
    output?: any;
    latency: number;
  };
}

export interface WorkflowStepMetadata {
  stepId: string;
  stepName: string;
  dependencies: string[];
  timeout?: number;
  performance: {
    duration: number;
    bottlenecks: Array<{
      phase: string;
      duration: number;
    }>;
  };
}
```

## MCP Integration Models

### MCP Server Configuration
```typescript
// src/mastra/types/mcp.ts
export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  features?: string[];
  readOnly: boolean;
}

export interface SupabaseMCPConfig extends MCPServerConfig {
  projectRef: string;
  accessToken: string;
  features: Array<'database' | 'docs' | 'edge-functions' | 'branching' | 'storage'>;
}

export interface MCPToolCall {
  toolName: string;
  serverName: string;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  metadata: {
    latency: number;
    timestamp: string;
    userId?: string;
  };
}
```

## API Validation Models

### Mastra Framework Validation
```typescript
// src/mastra/types/validation.ts
export interface APIValidationResult {
  component: 'agent' | 'workflow' | 'tool' | 'registration';
  componentName: string;
  isValid: boolean;
  issues: Array<{
    type: 'deprecation' | 'breaking_change' | 'missing_property' | 'type_mismatch';
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion?: string;
  }>;
  validatedAgainst: {
    server: 'mastra' | 'context7';
    version: string;
    timestamp: string;
  };
}

export interface FrameworkCompliance {
  registrationStatus: {
    agents: Array<{ name: string; registered: boolean; visible: boolean }>;
    workflows: Array<{ name: string; registered: boolean; visible: boolean }>;
    tools: Array<{ name: string; registered: boolean; available: boolean }>;
  };
  typeCompliance: {
    sharedTypesLocation: string;
    duplicatedTypes: string[];
    missingExports: string[];
  };
  architectureCompliance: {
    featureBasedOrganization: boolean;
    codeduplicationViolations: string[];
  };
}
```

## Database Migration Models

### Migration Status Tracking
```sql
CREATE TABLE migration_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL UNIQUE,
  migration_type TEXT NOT NULL, -- 'schema', 'data', 'function'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT migration_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);
```

### Data Migration Tracking
```typescript
export interface MigrationOperation {
  id: string;
  name: string;
  type: 'schema' | 'data' | 'function' | 'index';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  metadata: {
    recordsProcessed?: number;
    estimatedTotal?: number;
    progressPercentage?: number;
    performance?: {
      recordsPerSecond?: number;
      averageLatency?: number;
    };
  };
}
```

## Entity Relationships

### Core Data Flow
```
User Input
    ↓
Intent Classification
    ↓
Agent Selection (Business Intelligence | Default)
    ↓
Memory Context Injection (User + Global)
    ↓
Knowledge Base Search (Documents + Chunks)
    ↓
Tool Execution (MCP Tools)
    ↓
Response Generation
    ↓
Observability Tracking (LangFuse)
```

### Database Relationships
```
user_memories ← (user_id) → User Context
global_memories ← (access_level) → System Context
knowledge_documents → document_chunks (1:many)
document_chunks ← (embedding) → Vector Search
```

### Observability Flow
```
Tool Call → ToolCallTracer → LangFuse Span
Agent Execution → EnhancedAgentTracer → LangFuse Trace
Workflow Step → EnhancedWorkflowTracer → LangFuse Generation
Error → ErrorTrackingService → LangFuse Event
```

This data model ensures constitutional compliance while maintaining performance, type safety, and comprehensive observability throughout the system.