import { z } from 'zod';

// User Memory Types
export const UserMemorySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  content: z.string().min(1),
  embedding: z.array(z.number()).length(1024).optional(),
  metadata: z.record(z.any()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateUserMemorySchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.any()).optional().default({}),
});

export const UpdateUserMemorySchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

// Global Memory Types
export const GlobalMemorySchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1),
  embedding: z.array(z.number()).length(1024).optional(),
  metadata: z.record(z.any()).default({}),
  category: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateGlobalMemorySchema = z.object({
  content: z.string().min(1),
  category: z.string().optional(),
  metadata: z.record(z.any()).optional().default({}),
});

export const UpdateGlobalMemorySchema = z.object({
  content: z.string().min(1),
  category: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// Memory Search Types
export const MemorySearchRequestSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(20).default(5),
  similarity_threshold: z.number().min(0).max(1).default(0.6),
  category: z.string().optional(),
});

export const MemorySearchResultSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  similarity_score: z.number().min(0).max(1),
  metadata: z.record(z.any()),
  category: z.string().optional(),
  created_at: z.string().datetime(),
});

export const MemorySearchResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  query: z.string(),
  total_results: z.number().int().nonnegative(),
  search_time_ms: z.number().int().nonnegative().optional(),
});

// Memory Statistics Types
export const MemoryStatsSchema = z.object({
  user_memories_count: z.number().int().nonnegative(),
  global_memories_count: z.number().int().nonnegative(),
  user_memory_size_mb: z.number().nonnegative().optional(),
  global_memory_size_mb: z.number().nonnegative().optional(),
  avg_search_time_ms: z.number().nonnegative().optional(),
  total_searches_24h: z.number().int().nonnegative().optional(),
  memory_categories: z.record(z.number().int().nonnegative()).optional(),
  cache_hit_rate: z.number().min(0).max(1).optional(),
});

// TypeScript types inferred from schemas
export type UserMemory = z.infer<typeof UserMemorySchema>;
export type CreateUserMemoryRequest = z.infer<typeof CreateUserMemorySchema>;
export type UpdateUserMemoryRequest = z.infer<typeof UpdateUserMemorySchema>;

export type GlobalMemory = z.infer<typeof GlobalMemorySchema>;
export type CreateGlobalMemoryRequest = z.infer<typeof CreateGlobalMemorySchema>;
export type UpdateGlobalMemoryRequest = z.infer<typeof UpdateGlobalMemorySchema>;

export type MemorySearchRequest = z.infer<typeof MemorySearchRequestSchema>;
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;

export type MemoryStats = z.infer<typeof MemoryStatsSchema>;