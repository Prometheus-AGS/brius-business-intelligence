import { z } from 'zod';

// Knowledge Document Types
export const KnowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1),
  content: z.string(),
  file_type: z.string(),
  file_size: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  uploaded_by: z.string().optional(),
  processing_status: z.enum(['pending', 'processing', 'completed', 'failed']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  chunks_count: z.number().int().nonnegative().optional(),
});

export const DocumentSummarySchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  file_type: z.string(),
  file_size: z.number().int().positive(),
  processing_status: z.enum(['pending', 'processing', 'completed', 'failed']),
  uploaded_by: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
});

export const DocumentUploadRequestSchema = z.object({
  file: z.any(), // File object
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const DocumentUploadResponseSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  file_size: z.number().int().positive(),
  processing_status: z.enum(['pending', 'processing', 'completed', 'failed']),
  message: z.string().optional(),
});

// Document Chunk Types
export const DocumentChunkSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  chunk_index: z.number().int().nonnegative(),
  content: z.string().min(1),
  embedding: z.array(z.number()).length(1024).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
});

// Knowledge Search Types
export const KnowledgeSearchRequestSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(50).default(5),
  filters: z
    .object({
      category: z.string().optional(),
      access_level: z.string().optional(),
      uploaded_by: z.string().optional(),
    })
    .optional(),
  hybrid: z.boolean().default(true),
  similarity_threshold: z.number().min(0).max(1).default(0.7),
});

export const KnowledgeSearchResultSchema = z.object({
  chunk_id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_filename: z.string().optional(),
  content: z.string(),
  similarity_score: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()),
  chunk_index: z.number().int().nonnegative().optional(),
});

export const KnowledgeSearchResponseSchema = z.object({
  results: z.array(KnowledgeSearchResultSchema),
  query: z.string(),
  total_results: z.number().int().nonnegative(),
  search_time_ms: z.number().int().nonnegative().optional(),
});

// Embedding Types
export const EmbedRequestSchema = z.object({
  text: z.union([z.string(), z.array(z.string())]),
  normalize: z.boolean().default(true),
});

export const EmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  model: z.enum(['amazon.titan-embed-text-v2']),
});

// Document List Types
export const DocumentListRequestSchema = z.object({
  category: z.string().optional(),
  uploaded_by: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});

export const DocumentListResponseSchema = z.object({
  documents: z.array(DocumentSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

// Knowledge Statistics Types
export const KnowledgeStatsSchema = z.object({
  total_documents: z.number().int().nonnegative(),
  total_chunks: z.number().int().nonnegative(),
  storage_size_mb: z.number().nonnegative(),
  documents_by_type: z.record(z.string(), z.number().int().nonnegative()).optional(),
  processing_status_counts: z
    .object({
      pending: z.number().int().nonnegative().optional(),
      processing: z.number().int().nonnegative().optional(),
      completed: z.number().int().nonnegative().optional(),
      failed: z.number().int().nonnegative().optional(),
    })
    .optional(),
  avg_search_time_ms: z.number().nonnegative().optional(),
  total_searches_24h: z.number().int().nonnegative().optional(),
});

// TypeScript types inferred from schemas
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type DocumentUploadRequest = z.infer<typeof DocumentUploadRequestSchema>;
export type DocumentUploadResponse = z.infer<typeof DocumentUploadResponseSchema>;

export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequestSchema>;
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;

export type EmbedRequest = z.infer<typeof EmbedRequestSchema>;
export type EmbedResponse = z.infer<typeof EmbedResponseSchema>;

export type DocumentListRequest = z.infer<typeof DocumentListRequestSchema>;
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export type KnowledgeStats = z.infer<typeof KnowledgeStatsSchema>;