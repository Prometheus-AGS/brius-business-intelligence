import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, sql, count } from 'drizzle-orm';
import { getDrizzleDb } from '../config/consolidated-database.js';
import {
  documentChunks,
  knowledgeDocuments,
  type KnowledgeDocument,
  type DocumentChunk,
  processingStatusEnum,
} from '../database/schema.js';
import { DocumentChunkingService, type DocumentChunkingStrategy } from './chunking.js';
import { generateSingleEmbedding } from '../memory/embeddings.js';
import { getKnowledgeSettings } from './settings.js';
import { knowledgeLogger } from '../observability/logger.js';

export interface DocumentFilters {
  page?: number;
  limit?: number;
  category?: string;
  status?: typeof processingStatusEnum.enumValues[number];
  search?: string;
  sortBy?: 'uploaded_at' | 'title' | 'file_size' | 'status';
  sortOrder?: 'asc' | 'desc';
  tags?: string[];
  userId?: string;
}

export interface DocumentListResult {
  documents: KnowledgeDocument[];
  total: number;
  page: number;
  limit: number;
}

const chunkingService = new DocumentChunkingService();

export async function listDocuments(filters: DocumentFilters, db = getDrizzleDb()): Promise<DocumentListResult> {
  const {
    page = 1,
    limit = 20,
    category,
    status,
    search,
    sortBy = 'uploaded_at',
    sortOrder = 'desc',
    tags,
    userId,
  } = filters;

  const offset = (page - 1) * limit;

  const conditions = [] as ReturnType<typeof and>[];

  if (category) {
    conditions.push(eq(knowledgeDocuments.category, category));
  }

  if (status) {
    conditions.push(eq(knowledgeDocuments.processingStatus, status));
  }

  if (userId) {
    conditions.push(eq(knowledgeDocuments.uploadUserId, userId));
  }

  if (search) {
    const like = `%${search}%`;
    conditions.push(
      ilike(knowledgeDocuments.title, like)
    );
  }

  if (tags && tags.length > 0) {
    // For PostgreSQL array columns, we need to check if any of the provided tags exist in the array
    conditions.push(sql`${knowledgeDocuments.tags} && ${tags}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total = await db
    .select({ count: count() })
    .from(knowledgeDocuments)
    .where(whereClause)
    .then(rows => Number(rows[0]?.count ?? 0));

  const sortColumn = (() => {
    switch (sortBy) {
      case 'title':
        return knowledgeDocuments.title;
      case 'file_size':
        return knowledgeDocuments.fileSize;
      case 'status':
        return knowledgeDocuments.processingStatus;
      case 'uploaded_at':
      default:
        return knowledgeDocuments.createdAt;
    }
  })();

  const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const documents = await db
    .select()
    .from(knowledgeDocuments)
    .where(whereClause)
    .orderBy(orderBy)
    .offset(offset)
    .limit(limit);

  return {
    documents,
    total,
    page,
    limit,
  };
}

export async function getDocumentById(documentId: string, db = getDrizzleDb()): Promise<KnowledgeDocument | null> {
  const [document] = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .limit(1);

  return document ?? null;
}

export async function countDocumentChunks(documentId: string, db = getDrizzleDb()): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));

  return Number(result[0]?.count ?? 0);
}

export interface UpdateDocumentInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  tags?: string[];
}

export async function updateDocument(
  documentId: string,
  input: UpdateDocumentInput,
  db = getDrizzleDb()
): Promise<KnowledgeDocument | null> {
  const [updated] = await db
    .update(knowledgeDocuments)
    .set({
      title: input.title,
      category: input.category,
      tags: input.tags,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, documentId))
    .returning();

  return updated ?? null;
}

export async function deleteDocument(documentId: string, db = getDrizzleDb()): Promise<void> {
  await db.transaction(async tx => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
    await tx.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));
  });
}

export interface CreateDocumentInput {
  title: string;
  content: string;
  originalName?: string;
  mimeType?: string;
  fileSize?: number;
  category?: string;
  tags?: string[];
  userId?: string;
  chunkStrategy?: DocumentChunkingStrategy;
  chunkSize?: number;
  overlap?: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentCreationResult {
  document: KnowledgeDocument;
  chunkCount: number;
}

export async function createDocumentWithChunks(
  input: CreateDocumentInput,
  db = getDrizzleDb()
): Promise<DocumentCreationResult> {
  const documentId = randomUUID();

  const documentRecord = {
    id: documentId,
    title: input.title,
    content: input.content,
    filePath: input.originalName,
    fileType: input.mimeType,
    fileSize: input.fileSize,
    category: input.category,
    tags: input.tags ?? [],
    uploadUserId: input.userId,
    processingStatus: 'processing' as const,
    metadata: {
      ...input.metadata,
    },
  } satisfies Partial<KnowledgeDocument>;

  await db.transaction(async tx => {
    await tx.insert(knowledgeDocuments).values(documentRecord);
  });

  const document = await getDocumentById(documentId, db);

  if (!document) {
    throw new Error('Failed to create knowledge document');
  }

  const chunkCount = await processDocument(document, {
    chunkStrategy: input.chunkStrategy,
    chunkSize: input.chunkSize,
    overlap: input.overlap,
    metadata: input.metadata,
  }, db);

  const refreshed = await getDocumentById(documentId, db);

  if (!refreshed) {
    throw new Error('Failed to refresh knowledge document');
  }

  return {
    document: refreshed,
    chunkCount,
  };
}

export async function getDocumentChunks(
  documentId: string,
  page = 1,
  limit = 50,
  db = getDrizzleDb()
): Promise<{ chunks: DocumentChunk[]; total: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;

  const totalResult = await db
    .select({ count: count() })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId));

  const total = Number(totalResult[0]?.count ?? 0);

  const chunks = await db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId))
    .orderBy(asc(documentChunks.chunkIndex))
    .offset(offset)
    .limit(limit);

  return {
    chunks,
    total,
    page,
    limit,
  };
}

export interface ProcessDocumentOptions {
  chunkStrategy?: DocumentChunkingStrategy;
  chunkSize?: number;
  overlap?: number;
  metadata?: Record<string, unknown>;
}

export async function processDocument(
  document: KnowledgeDocument,
  options: ProcessDocumentOptions = {},
  db = getDrizzleDb()
): Promise<number> {
  const settings = await getKnowledgeSettings(db);

  const documentMetadata = (document.metadata ?? {}) as Record<string, unknown>;

  const chunkStrategy = options.chunkStrategy ?? documentMetadata.chunk_strategy as DocumentChunkingStrategy | undefined ?? settings.chunkStrategy;
  const chunkSize = options.chunkSize ?? documentMetadata.chunk_size as number | undefined ?? settings.chunkSize;
  const overlap = options.overlap ?? documentMetadata.overlap as number | undefined ?? settings.overlap;

  knowledgeLogger.info('Processing knowledge document', {
    document_id: document.id,
    strategy: chunkStrategy,
    chunk_size: chunkSize,
    overlap,
  });

  const chunkingResult = await chunkingService.chunkDocument(document.content, {
    strategy: chunkStrategy,
    chunkSize,
    overlap,
    metadata: options.metadata,
  });

  const embeddings = await Promise.all(
    chunkingResult.chunks.map(chunk => generateSingleEmbedding(chunk.content))
  );

  const now = new Date();

  await db.transaction(async tx => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, document.id));

    const chunkRecords = chunkingResult.chunks.map((chunk, index) => ({
      id: randomUUID(),
      documentId: document.id,
      chunkIndex: chunk.index,
      content: chunk.content,
      embedding: JSON.stringify(embeddings[index]),
      chunkMetadata: {
        ...(chunk.metadata || {}),
        chunk_strategy: chunkStrategy,
      },
    }));

    if (chunkRecords.length > 0) {
      await tx.insert(documentChunks).values(chunkRecords);
    }

    await tx.update(knowledgeDocuments).set({
      processingStatus: 'completed',
      processedAt: now,
      updatedAt: now,
      metadata: {
        ...documentMetadata,
        chunk_strategy: chunkStrategy,
        chunk_size: chunkSize,
        overlap,
      },
    }).where(eq(knowledgeDocuments.id, document.id));
  });

  return chunkingResult.chunks.length;
}
