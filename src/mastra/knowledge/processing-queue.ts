import { EventEmitter } from 'events';
import { z } from 'zod';
import { getDrizzleDb } from '../config/consolidated-database.js';
import {
  knowledgeProcessingJobs,
  knowledgeDocuments,
  documentChunks,
  processingJobStatusEnum,
  processingPriorityEnum,
} from '../database/schema.js';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import type { KnowledgeProcessingJob } from '../database/schema.js';
import { knowledgeLogger } from '../observability/logger.js';
import { processDocument } from './documents.js';
import type { DocumentChunkingStrategy } from './chunking.js';

export interface ProcessingMetadata {
  chunkStrategy?: DocumentChunkingStrategy;
  chunkSize?: number;
  overlap?: number;
  source?: string;
  [key: string]: unknown;
}

export interface ProcessingJobPayload {
  documentId: string;
  priority?: typeof processingPriorityEnum.enumValues[number];
  maxRetries?: number;
  metadata?: ProcessingMetadata;
}

export interface ProcessingJobUpdate {
  jobId: string;
  status: typeof processingJobStatusEnum.enumValues[number];
  error?: string;
}

const ProcessingJobSchema = z.object({
  documentId: z.string().uuid(),
  priority: z.enum(processingPriorityEnum.enumValues).default('normal'),
  maxRetries: z.number().int().min(0).max(10).default(3),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class DocumentProcessingQueue extends EventEmitter {
  private isRunning = false;
  private activeJobs = new Set<string>();
  private maxConcurrentJobs: number;
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor({ maxConcurrentJobs = 2, pollIntervalMs = 2000 } = {}) {
    super();
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.schedulePoll();
    knowledgeLogger.info('Knowledge processing queue started', {
      max_concurrent_jobs: this.maxConcurrentJobs,
      poll_interval_ms: this.pollIntervalMs,
    });
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    knowledgeLogger.info('Knowledge processing queue stopped');
  }

  async enqueue(payload: ProcessingJobPayload): Promise<KnowledgeProcessingJob> {
    const validation = ProcessingJobSchema.safeParse(payload);
    if (!validation.success) {
      throw new Error(`Invalid processing job: ${validation.error.message}`);
    }

    const data = validation.data;
    const db = getDrizzleDb();

    const [job] = await db
      .insert(knowledgeProcessingJobs)
      .values({
        documentId: data.documentId,
        priority: data.priority,
        status: 'pending',
        retryCount: 0,
        maxRetries: data.maxRetries,
        metadata: data.metadata ?? {},
      })
      .returning();

    if (!job) {
      throw new Error('Failed to create knowledge processing job');
    }

    this.emit('job:queued', job);
    this.schedulePoll(100); // kick the queue
    return job;
  }

  private schedulePoll(delay = this.pollIntervalMs): void {
    if (!this.isRunning) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      if (this.activeJobs.size >= this.maxConcurrentJobs) {
        this.schedulePoll();
        return;
      }

      const db = getDrizzleDb();

      const pendingJobs = await db
        .select()
        .from(knowledgeProcessingJobs)
        .where(eq(knowledgeProcessingJobs.status, 'pending'))
        .orderBy(desc(knowledgeProcessingJobs.priority), asc(knowledgeProcessingJobs.createdAt))
        .limit(this.maxConcurrentJobs - this.activeJobs.size);

      for (const job of pendingJobs) {
        this.processJob(job).catch(error => {
          knowledgeLogger.error('Processing job failed unexpectedly', error instanceof Error ? error : new Error(String(error)));
        });
      }
    } catch (error) {
      knowledgeLogger.error('Processing queue poll failed', error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.schedulePoll();
    }
  }

  private async processJob(job: KnowledgeProcessingJob): Promise<void> {
    if (this.activeJobs.has(job.id)) return;

    const db = getDrizzleDb();

    this.activeJobs.add(job.id);

    try {
      await db
        .update(knowledgeProcessingJobs)
        .set({
          status: 'processing',
          startedAt: new Date(),
        })
        .where(eq(knowledgeProcessingJobs.id, job.id));

      const [document] = await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, job.documentId))
        .limit(1);

      if (!document) {
        throw new Error(`Document ${job.documentId} not found for processing job ${job.id}`);
      }

      await db
        .update(knowledgeDocuments)
        .set({
          processingStatus: 'processing',
          updatedAt: new Date(),
        })
        .where(eq(knowledgeDocuments.id, document.id));

      // Remove existing chunks if reprocessing
      await db.delete(documentChunks).where(eq(documentChunks.documentId, document.id));

      const metadata: ProcessingMetadata = (job.metadata ?? {}) as ProcessingMetadata;

      await processDocument(document, {
        chunkStrategy: metadata.chunkStrategy,
        chunkSize: metadata.chunkSize,
        overlap: metadata.overlap,
        metadata,
      }, db);

      await db
        .update(knowledgeProcessingJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          metadata,
        })
        .where(eq(knowledgeProcessingJobs.id, job.id));

      this.emit('job:completed', job.id);
      knowledgeLogger.info('Knowledge processing job completed', { job_id: job.id, document_id: job.documentId });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      knowledgeLogger.error('Knowledge processing job failed', err);

      await this.retryOrFailJob(job.id, err.message);
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async retryOrFailJob(jobId: string, errorMessage: string): Promise<void> {
    const db = getDrizzleDb();

    const [job] = await db
      .select()
      .from(knowledgeProcessingJobs)
      .where(eq(knowledgeProcessingJobs.id, jobId))
      .limit(1);

    if (!job) return;

    if (job.retryCount + 1 > job.maxRetries) {
      await db
        .update(knowledgeProcessingJobs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          lastError: errorMessage,
        })
        .where(eq(knowledgeProcessingJobs.id, jobId));

      await db
        .update(knowledgeDocuments)
        .set({
          processingStatus: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(knowledgeDocuments.id, job.documentId));

      this.emit('job:failed', { jobId, error: errorMessage });
      return;
    }

    await db
      .update(knowledgeProcessingJobs)
      .set({
        status: 'pending',
        retryCount: job.retryCount + 1,
        lastError: errorMessage,
      })
      .where(eq(knowledgeProcessingJobs.id, jobId));

    this.emit('job:retry', { jobId, retryCount: job.retryCount + 1 });
  }

  async getJob(jobId: string): Promise<KnowledgeProcessingJob | null> {
    const db = getDrizzleDb();
    const [job] = await db
      .select()
      .from(knowledgeProcessingJobs)
      .where(eq(knowledgeProcessingJobs.id, jobId))
      .limit(1);
    return job ?? null;
  }

  async listJobs(options: { userId?: string; status?: typeof processingJobStatusEnum.enumValues[number] } = {}) {
    const db = getDrizzleDb();

    const conditions = [] as ReturnType<typeof and>[];

    if (options.status) {
      conditions.push(eq(knowledgeProcessingJobs.status, options.status));
    }

    if (options.userId) {
      conditions.push(eq(knowledgeDocuments.uploadUserId, options.userId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const jobs = await db
      .select({
        id: knowledgeProcessingJobs.id,
        documentId: knowledgeProcessingJobs.documentId,
        status: knowledgeProcessingJobs.status,
        priority: knowledgeProcessingJobs.priority,
        retryCount: knowledgeProcessingJobs.retryCount,
        maxRetries: knowledgeProcessingJobs.maxRetries,
        createdAt: knowledgeProcessingJobs.createdAt,
        startedAt: knowledgeProcessingJobs.startedAt,
        completedAt: knowledgeProcessingJobs.completedAt,
        lastError: knowledgeProcessingJobs.lastError,
        metadata: knowledgeProcessingJobs.metadata,
      })
      .from(knowledgeProcessingJobs)
      .leftJoin(
        knowledgeDocuments,
        eq(knowledgeProcessingJobs.documentId, knowledgeDocuments.id)
      )
      .where(whereClause)
      .orderBy(desc(knowledgeProcessingJobs.createdAt));

    return jobs;
  }
}

export const documentProcessingQueue = new DocumentProcessingQueue();
