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

// ============================================================================
// Business Intelligence Context Enhancement Tables
// ============================================================================

// Enums for BI feature
export const contextStatusEnum = pgEnum('context_status', ['active', 'paused', 'completed', 'failed', 'degraded']);
export const sessionStatusEnum = pgEnum('session_status', ['initiated', 'active', 'waiting', 'processing', 'completed', 'failed']);
export const domainTypeEnum = pgEnum('domain_type', ['clinical', 'financial', 'operational', 'customer-service']);
export const patternTypeEnum = pgEnum('pattern_type', ['planner-executor', 'reactive', 'streaming', 'hybrid']);
export const memoryScopeEnum = pgEnum('memory_scope', ['user', 'global']);
export const contentTypeEnum = pgEnum('content_type', ['conversation', 'knowledge', 'preference']);

/**
 * User Context table for managing authenticated and anonymous user sessions
 */
export const userContexts = pgTable('user_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id').notNull().unique(),
  roleId: text('role_id').notNull(),
  departmentScope: jsonb('department_scope').$type<string[]>().notNull(),
  permissions: jsonb('permissions').notNull(),
  preferences: jsonb('preferences'),
  lastActivity: timestamp('last_activity', { withTimezone: true }).defaultNow().notNull(),
  tokenExpiry: timestamp('token_expiry', { withTimezone: true }).notNull(),
  isAnonymous: integer('is_anonymous').default(0).notNull(), // Using integer for boolean compatibility
  status: contextStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('user_contexts_user_id_idx').on(table.userId),
  sessionIdIdx: index('user_contexts_session_id_idx').on(table.sessionId),
  statusIdx: index('user_contexts_status_idx').on(table.status),
}));

/**
 * Analysis Sessions table for tracking user BI sessions
 */
export const analysisSessions = pgTable('analysis_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().unique(),
  userId: uuid('user_id').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).defaultNow().notNull(),
  lastQueryTime: timestamp('last_query_time', { withTimezone: true }),
  queryHistory: jsonb('query_history').$type<any[]>().default([]),
  contextState: jsonb('context_state').notNull(),
  domainAccess: jsonb('domain_access').$type<string[]>().default([]),
  status: sessionStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('analysis_sessions_user_id_idx').on(table.userId),
  sessionIdIdx: index('analysis_sessions_session_id_idx').on(table.sessionId),
  statusIdx: index('analysis_sessions_status_idx').on(table.status),
}));

/**
 * Domain Datasets table for multi-domain data integration
 */
export const domainDatasets = pgTable('domain_datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  datasetId: uuid('dataset_id').notNull().unique(),
  domainType: domainTypeEnum('domain_type').notNull(),
  tableName: text('table_name').notNull(),
  schema: jsonb('schema').notNull(),
  relationships: jsonb('relationships').$type<any[]>().default([]),
  accessLevel: accessLevelEnum('access_level').notNull().default('public'),
  dataQuality: jsonb('data_quality'),
  lastAnalyzed: timestamp('last_analyzed', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  datasetIdIdx: index('domain_datasets_dataset_id_idx').on(table.datasetId),
  domainTypeIdx: index('domain_datasets_domain_type_idx').on(table.domainType),
  tableNameIdx: index('domain_datasets_table_name_idx').on(table.tableName),
}));

/**
 * Visualization Artifacts table for React component generation
 */
export const visualizationArtifacts = pgTable('visualization_artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: uuid('artifact_id').notNull().unique(),
  sessionId: uuid('session_id').notNull(),
  componentName: text('component_name').notNull(),
  componentCode: text('component_code').notNull(),
  dataBinding: jsonb('data_binding').notNull(),
  styleDefinition: jsonb('style_definition').notNull(),
  dependencies: jsonb('dependencies').$type<string[]>().default([]),
  generationTime: timestamp('generation_time', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  artifactIdIdx: index('visualization_artifacts_artifact_id_idx').on(table.artifactId),
  sessionIdIdx: index('visualization_artifacts_session_id_idx').on(table.sessionId),
  componentNameIdx: index('visualization_artifacts_component_name_idx').on(table.componentName),
}));

/**
 * Agent Architecture Patterns table for pattern evaluation
 */
export const agentArchitecturePatterns = pgTable('agent_architecture_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  patternId: uuid('pattern_id').notNull().unique(),
  patternType: patternTypeEnum('pattern_type').notNull(),
  queryComplexity: jsonb('query_complexity').notNull(),
  performanceMetrics: jsonb('performance_metrics').notNull(),
  usageCount: integer('usage_count').default(0).notNull(),
  successRate: integer('success_rate').default(0).notNull(), // Using integer for decimal * 10000
  lastEvaluated: timestamp('last_evaluated', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  patternIdIdx: index('agent_architecture_patterns_pattern_id_idx').on(table.patternId),
  patternTypeIdx: index('agent_architecture_patterns_pattern_type_idx').on(table.patternType),
  usageCountIdx: index('agent_architecture_patterns_usage_count_idx').on(table.usageCount.desc()),
}));

/**
 * Context State table for session management and recovery
 */
export const contextStates = pgTable('context_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  stateId: uuid('state_id').notNull().unique(),
  sessionId: uuid('session_id').notNull().unique(),
  stateData: jsonb('state_data').notNull(),
  historyStack: jsonb('history_stack').$type<any[]>().default([]),
  reconstructionData: jsonb('reconstruction_data'),
  lastUpdate: timestamp('last_update', { withTimezone: true }).defaultNow().notNull(),
  isCorrupted: integer('is_corrupted').default(0).notNull(), // Using integer for boolean compatibility
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stateIdIdx: index('context_states_state_id_idx').on(table.stateId),
  sessionIdIdx: index('context_states_session_id_idx').on(table.sessionId),
  lastUpdateIdx: index('context_states_last_update_idx').on(table.lastUpdate.desc()),
}));

// BI Feature Relations
export const userContextsRelations = relations(userContexts, ({ many }) => ({
  analysisSessions: many(analysisSessions),
}));

export const analysisSessionsRelations = relations(analysisSessions, ({ one, many }) => ({
  userContext: one(userContexts, {
    fields: [analysisSessions.userId],
    references: [userContexts.userId],
  }),
  visualizationArtifacts: many(visualizationArtifacts),
  contextState: one(contextStates, {
    fields: [analysisSessions.sessionId],
    references: [contextStates.sessionId],
  }),
}));

export const visualizationArtifactsRelations = relations(visualizationArtifacts, ({ one }) => ({
  analysisSession: one(analysisSessions, {
    fields: [visualizationArtifacts.sessionId],
    references: [analysisSessions.sessionId],
  }),
}));

export const contextStatesRelations = relations(contextStates, ({ one }) => ({
  analysisSession: one(analysisSessions, {
    fields: [contextStates.sessionId],
    references: [analysisSessions.sessionId],
  }),
}));

// BI Feature Type exports
export type UserContext = typeof userContexts.$inferSelect;
export type NewUserContext = typeof userContexts.$inferInsert;

export type AnalysisSession = typeof analysisSessions.$inferSelect;
export type NewAnalysisSession = typeof analysisSessions.$inferInsert;

export type DomainDataset = typeof domainDatasets.$inferSelect;
export type NewDomainDataset = typeof domainDatasets.$inferInsert;

export type VisualizationArtifact = typeof visualizationArtifacts.$inferSelect;
export type NewVisualizationArtifact = typeof visualizationArtifacts.$inferInsert;

export type AgentArchitecturePattern = typeof agentArchitecturePatterns.$inferSelect;
export type NewAgentArchitecturePattern = typeof agentArchitecturePatterns.$inferInsert;

export type ContextState = typeof contextStates.$inferSelect;
export type NewContextState = typeof contextStates.$inferInsert;
