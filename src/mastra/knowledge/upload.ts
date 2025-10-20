import { z } from 'zod';
import { getDrizzleDb } from '../config/consolidated-database.js';
import { knowledgeDocuments } from '../database/schema.js';
import { documentProcessingQueue } from './processing-queue.js';
import { knowledgeLogger } from '../observability/logger.js';
import { randomUUID } from 'node:crypto';

export const UploadRequestSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  encoding: z.enum(['plain', 'base64']).default('plain'),
  originalName: z.string().optional(),
  mimeType: z.string().optional(),
  chunkStrategy: z.enum(['paragraph', 'sentence', 'fixed', 'semantic', 'hybrid']).optional(),
  chunkSize: z.number().int().min(50).max(8000).optional(),
  overlap: z.number().int().min(0).max(1000).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  userId: z.string().optional(),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export interface UploadResponse {
  documentId: string;
  jobId: string;
  status: 'processing';
}

export function decodeContent(content: string, encoding: 'plain' | 'base64'): string {
  if (encoding === 'plain') {
    return content;
  }

  const buffer = Buffer.from(content, 'base64');
  return buffer.toString('utf-8');
}

export async function enqueueDocumentUpload(payload: UploadRequest): Promise<UploadResponse> {
  const validation = UploadRequestSchema.safeParse(payload);
  if (!validation.success) {
    throw new Error(`Invalid upload payload: ${validation.error.message}`);
  }

  const data = validation.data;
  const decodedContent = decodeContent(data.content, data.encoding);
  const now = new Date();

  const db = getDrizzleDb();

  const documentId = randomUUID();

  await db.transaction(async tx => {
    await tx.insert(knowledgeDocuments).values({
      id: documentId,
      title: data.title,
      content: decodedContent,
      filePath: data.originalName,
      fileType: data.mimeType,
      fileSize: Buffer.byteLength(decodedContent, 'utf-8'),
      category: data.category,
      tags: data.tags ?? [],
      uploadUserId: data.userId,
      processingStatus: 'pending',
      metadata: {
        ...(data.metadata ?? {}),
        upload_encoding: data.encoding,
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  const job = await documentProcessingQueue.enqueue({
    documentId,
    priority: 'normal',
    metadata: {
      chunkStrategy: data.chunkStrategy,
      chunkSize: data.chunkSize,
      overlap: data.overlap,
    },
  });

  knowledgeLogger.info('Document upload enqueued for processing', {
    document_id: documentId,
    job_id: job.id,
  });

  return {
    documentId,
    jobId: job.id,
    status: 'processing',
  };
}
