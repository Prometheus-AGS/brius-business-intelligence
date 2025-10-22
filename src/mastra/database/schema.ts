/**
 * Drizzle ORM Schema for pgvector 17 Database
 * Constitutional requirement for database architecture compliance
 */

import { pgTable, uuid, text, integer, timestamp, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Custom vector type definition for pgvector
// Note: This will need to be properly typed when drizzle-orm adds official pgvector support
const vector = (name: string, _config: { dimensions: number }) => {
  return text(name); // Temporary text representation
};

// Enums for type safety
export const processingStatusEnum = pgEnum('processing_status', ['pending', 'processing', 'completed', 'failed']);
export const accessLevelEnum = pgEnum('access_level', ['public', 'restricted', 'admin']);
export const migrationStatusEnum = pgEnum('migration_status', ['pending', 'running', 'completed', 'failed']);
export const chunkStrategyEnum = pgEnum('chunk_strategy', ['paragraph', 'sentence', 'fixed', 'semantic', 'hybrid']);

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
  // HNSW index will be created via SQL migration
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
  accessLevel: accessLevelEnum('access_level').default('public'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  // HNSW index will be created via SQL migration
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
  processingStatus: processingStatusEnum('processing_status').default('pending'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
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
  // HNSW index will be created via SQL migration
  documentIdIdx: index('document_chunks_document_id_idx').on(table.documentId),
  uniqueChunkIdx: index('document_chunks_unique_idx').on(table.documentId, table.chunkIndex),
}));

// Knowledge base settings table (singleton configuration)
export const knowledgeSettings = pgTable('knowledge_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  chunkStrategy: chunkStrategyEnum('chunk_strategy').notNull().default('semantic'),
  chunkSize: integer('chunk_size').notNull().default(1200),
  overlap: integer('overlap').notNull().default(200),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const processingPriorityEnum = pgEnum('processing_priority', ['low', 'normal', 'high', 'critical']);
export const processingJobStatusEnum = pgEnum('processing_job_status', ['pending', 'processing', 'completed', 'failed', 'cancelled']);

export const knowledgeProcessingJobs = pgTable('knowledge_processing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  priority: processingPriorityEnum('priority').notNull().default('normal'),
  status: processingJobStatusEnum('status').notNull().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastError: text('last_error'),
  metadata: jsonb('metadata').notNull().default({}),
}, (table) => ({
  documentIdx: index('knowledge_processing_jobs_document_idx').on(table.documentId),
  statusIdx: index('knowledge_processing_jobs_status_idx').on(table.status),
  priorityIdx: index('knowledge_processing_jobs_priority_idx').on(table.priority),
}));

// Migration status table
export const migrationStatus = pgTable('migration_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  migrationName: text('migration_name').notNull().unique(),
  migrationType: text('migration_type').notNull(),
  status: migrationStatusEnum('status').default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata').default({}),
});

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

export const knowledgeSettingsRelations = relations(knowledgeSettings, () => ({}));

export const processingJobsRelations = relations(knowledgeProcessingJobs, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [knowledgeProcessingJobs.documentId],
    references: [knowledgeDocuments.id],
  }),
}));

// Type exports for use in other modules
export type UserMemory = typeof userMemories.$inferSelect;
export type NewUserMemory = typeof userMemories.$inferInsert;

export type GlobalMemory = typeof globalMemories.$inferSelect;
export type NewGlobalMemory = typeof globalMemories.$inferInsert;

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type NewKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;

export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

export type KnowledgeSettings = typeof knowledgeSettings.$inferSelect;
export type NewKnowledgeSettings = typeof knowledgeSettings.$inferInsert;

export type KnowledgeProcessingJob = typeof knowledgeProcessingJobs.$inferSelect;
export type NewKnowledgeProcessingJob = typeof knowledgeProcessingJobs.$inferInsert;

export type MigrationStatus = typeof migrationStatus.$inferSelect;
export type NewMigrationStatus = typeof migrationStatus.$inferInsert;
