import { EventEmitter } from 'events';
import { z } from 'zod';
import { documentUploadProcessor, DocumentUploadRequest, DocumentUploadResponse } from './upload.js';
import { getSupabaseClient } from '../config/database.js';
import { knowledgeLogger } from '../observability/logger.js';

const supabase = getSupabaseClient();

/**
 * Document Processing Queue and Status Tracking
 * Handles async document processing with status tracking, retry logic, and monitoring
 * Provides scalable background processing for knowledge base ingestion
 */

export interface ProcessingJob {
  id: string;
  documentId: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastError?: string;
  progress?: {
    stage: string;
    percentage: number;
    currentStep: string;
    totalSteps: number;
  };
  metadata: {
    userId: string;
    requestData: DocumentUploadRequest;
    processingOptions?: Record<string, any>;
  };
}

export interface ProcessingQueueStats {
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageProcessingTime: number;
  queueThroughput: number; // jobs per hour
  errorRate: number;
  retryRate: number;
}

export interface ProcessingJobUpdate {
  jobId: string;
  status?: ProcessingJob['status'];
  progress?: ProcessingJob['progress'];
  error?: string;
  metadata?: Record<string, any>;
}

// Validation schemas
const ProcessingJobSchema = z.object({
  documentId: z.string().min(1),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  maxRetries: z.number().min(0).max(10).default(3),
  metadata: z.object({
    userId: z.string().min(1),
    requestData: z.any(),
    processingOptions: z.record(z.any()).optional(),
  }),
});

/**
 * Document Processing Queue Manager
 */
export class DocumentProcessingQueue extends EventEmitter {
  private queue: Map<string, ProcessingJob> = new Map();
  private activeJobs: Map<string, ProcessingJob> = new Map();
  private completedJobs: Map<string, ProcessingJob> = new Map();
  private maxConcurrentJobs: number;
  private processingInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(maxConcurrentJobs = 3) {
    super();
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.setupEventHandlers();
  }

  /**
   * Start the processing queue
   */
  start(): void {
    if (this.isProcessing) return;

    knowledgeLogger.info('Starting document processing queue', {
      max_concurrent_jobs: this.maxConcurrentJobs,
    });

    this.isProcessing = true;

    // Start processing loop
    this.processingInterval = setInterval(() => {
      this.processNextJobs();
    }, 5000); // Check every 5 seconds

    // Start stats collection
    this.statsInterval = setInterval(() => {
      this.collectStats();
    }, 60000); // Collect stats every minute

    // Load pending jobs from database
    this.loadPendingJobs();

    this.emit('queue:started');
  }

  /**
   * Stop the processing queue
   */
  stop(): void {
    if (!this.isProcessing) return;

    knowledgeLogger.info('Stopping document processing queue');

    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    this.emit('queue:stopped');
  }

  /**
   * Add a job to the processing queue
   */
  async addJob(jobData: Omit<ProcessingJob, 'id' | 'status' | 'retryCount' | 'createdAt'>): Promise<string> {
    // Validate job data
    const validation = ProcessingJobSchema.safeParse({
      documentId: jobData.documentId,
      priority: jobData.priority,
      maxRetries: jobData.maxRetries,
      metadata: jobData.metadata,
    });

    if (!validation.success) {
      throw new Error(`Invalid job data: ${validation.error.message}`);
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const job: ProcessingJob = {
      id: jobId,
      documentId: jobData.documentId,
      priority: jobData.priority,
      status: 'pending',
      retryCount: 0,
      maxRetries: jobData.maxRetries,
      createdAt: new Date(),
      metadata: jobData.metadata,
    };

    // Add to queue
    this.queue.set(jobId, job);

    // Store in database for persistence
    await this.persistJob(job);

    knowledgeLogger.info('Job added to processing queue', {
      job_id: jobId,
      document_id: job.documentId,
      priority: job.priority,
      user_id: job.metadata.userId,
    });

    this.emit('job:added', job);

    // Trigger immediate processing if queue was idle
    if (this.isProcessing && this.activeJobs.size < this.maxConcurrentJobs) {
      setTimeout(() => this.processNextJobs(), 100);
    }

    return jobId;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): ProcessingJob | null {
    return this.queue.get(jobId) || this.activeJobs.get(jobId) || this.completedJobs.get(jobId) || null;
  }

  /**
   * Get all jobs for a user
   */
  getUserJobs(userId: string): ProcessingJob[] {
    const allJobs = [
      ...Array.from(this.queue.values()),
      ...Array.from(this.activeJobs.values()),
      ...Array.from(this.completedJobs.values()),
    ];

    return allJobs.filter(job => job.metadata.userId === userId);
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.queue.get(jobId);
    if (!job) return false;

    job.status = 'cancelled';
    this.queue.delete(jobId);
    this.completedJobs.set(jobId, job);

    await this.updateJobInDatabase(job);

    knowledgeLogger.info('Job cancelled', {
      job_id: jobId,
      document_id: job.documentId,
    });

    this.emit('job:cancelled', job);
    return true;
  }

  /**
   * Update job progress
   */
  async updateJobProgress(update: ProcessingJobUpdate): Promise<void> {
    const job = this.activeJobs.get(update.jobId) || this.queue.get(update.jobId);
    if (!job) return;

    if (update.status) job.status = update.status;
    if (update.progress) job.progress = update.progress;
    if (update.error) job.lastError = update.error;
    if (update.metadata) {
      job.metadata = { ...job.metadata, ...update.metadata };
    }

    await this.updateJobInDatabase(job);

    this.emit('job:progress', job);
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): ProcessingQueueStats {
    const allJobs = [
      ...Array.from(this.queue.values()),
      ...Array.from(this.activeJobs.values()),
      ...Array.from(this.completedJobs.values()),
    ];

    const completedJobs = allJobs.filter(job => job.status === 'completed');
    const failedJobs = allJobs.filter(job => job.status === 'failed');
    const retriedJobs = allJobs.filter(job => job.retryCount > 0);

    const totalProcessingTime = completedJobs.reduce((sum, job) => {
      if (job.startedAt && job.completedAt) {
        return sum + (job.completedAt.getTime() - job.startedAt.getTime());
      }
      return sum;
    }, 0);

    const averageProcessingTime = completedJobs.length > 0
      ? totalProcessingTime / completedJobs.length
      : 0;

    // Calculate jobs per hour (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCompletedJobs = completedJobs.filter(job =>
      job.completedAt && job.completedAt >= twentyFourHoursAgo
    );
    const queueThroughput = recentCompletedJobs.length;

    return {
      totalJobs: allJobs.length,
      pendingJobs: this.queue.size,
      processingJobs: this.activeJobs.size,
      completedJobs: completedJobs.length,
      failedJobs: failedJobs.length,
      averageProcessingTime,
      queueThroughput,
      errorRate: allJobs.length > 0 ? failedJobs.length / allJobs.length : 0,
      retryRate: allJobs.length > 0 ? retriedJobs.length / allJobs.length : 0,
    };
  }

  /**
   * Process next jobs in queue
   */
  private async processNextJobs(): Promise<void> {
    if (!this.isProcessing || this.activeJobs.size >= this.maxConcurrentJobs) {
      return;
    }

    // Get next job by priority
    const availableSlots = this.maxConcurrentJobs - this.activeJobs.size;
    const nextJobs = this.getNextJobsByPriority(availableSlots);

    for (const job of nextJobs) {
      this.queue.delete(job.id);
      this.activeJobs.set(job.id, job);

      // Start processing job
      this.processJob(job).catch(error => {
        knowledgeLogger.error('Unexpected error in job processing', error);
      });
    }
  }

  /**
   * Get next jobs by priority
   */
  private getNextJobsByPriority(count: number): ProcessingJob[] {
    const pendingJobs = Array.from(this.queue.values())
      .filter(job => job.status === 'pending')
      .sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;

        // If same priority, sort by creation time (FIFO)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    return pendingJobs.slice(0, count);
  }

  /**
   * Process a single job
   */
  private async processJob(job: ProcessingJob): Promise<void> {
    try {
      job.status = 'processing';
      job.startedAt = new Date();

      await this.updateJobProgress({
        jobId: job.id,
        status: 'processing',
        progress: {
          stage: 'starting',
          percentage: 0,
          currentStep: 'Initializing document processing',
          totalSteps: 5,
        },
      });

      knowledgeLogger.info('Starting job processing', {
        job_id: job.id,
        document_id: job.documentId,
        retry_count: job.retryCount,
      });

      // Update progress: validation
      await this.updateJobProgress({
        jobId: job.id,
        progress: {
          stage: 'validation',
          percentage: 20,
          currentStep: 'Validating document and request data',
          totalSteps: 5,
        },
      });

      // Process the document using the upload processor
      const result = await documentUploadProcessor.processUpload(job.metadata.requestData);

      // Update progress: completion
      await this.updateJobProgress({
        jobId: job.id,
        progress: {
          stage: 'completed',
          percentage: 100,
          currentStep: 'Document processing completed successfully',
          totalSteps: 5,
        },
      });

      // Mark job as completed
      job.status = 'completed';
      job.completedAt = new Date();

      this.activeJobs.delete(job.id);
      this.completedJobs.set(job.id, job);

      await this.updateJobInDatabase(job);

      knowledgeLogger.info('Job processing completed', {
        job_id: job.id,
        document_id: job.documentId,
        processing_time_ms: job.completedAt.getTime() - job.startedAt!.getTime(),
      });

      this.emit('job:completed', job, result);

    } catch (error) {
      await this.handleJobError(job, error);
    }
  }

  /**
   * Handle job processing error
   */
  private async handleJobError(job: ProcessingJob, error: any): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    job.lastError = errorMessage;

    knowledgeLogger.error('Job processing failed', error instanceof Error ? error : new Error(String(error)), {
      job_id: job.id,
      document_id: job.documentId,
      retry_count: job.retryCount,
      max_retries: job.maxRetries,
    });

    if (job.retryCount < job.maxRetries) {
      // Retry the job
      job.retryCount++;
      job.status = 'pending';

      this.activeJobs.delete(job.id);
      this.queue.set(job.id, job);

      await this.updateJobProgress({
        jobId: job.id,
        status: 'pending',
        error: `Retry ${job.retryCount}/${job.maxRetries}: ${errorMessage}`,
      });

      this.emit('job:retry', job);

    } else {
      // Mark job as failed
      job.status = 'failed';
      job.completedAt = new Date();

      this.activeJobs.delete(job.id);
      this.completedJobs.set(job.id, job);

      await this.updateJobInDatabase(job);

      this.emit('job:failed', job, error);
    }
  }

  /**
   * Load pending jobs from database
   */
  private async loadPendingJobs(): Promise<void> {
    try {
      const { data: pendingJobs, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .in('status', ['pending', 'processing']);

      if (error) {
        knowledgeLogger.error('Failed to load pending jobs from database', error);
        return;
      }

      for (const jobData of pendingJobs || []) {
        const job: ProcessingJob = {
          id: jobData.id,
          documentId: jobData.document_id,
          priority: jobData.priority,
          status: jobData.status === 'processing' ? 'pending' : jobData.status, // Reset processing jobs to pending
          retryCount: jobData.retry_count,
          maxRetries: jobData.max_retries,
          createdAt: new Date(jobData.created_at),
          startedAt: jobData.started_at ? new Date(jobData.started_at) : undefined,
          lastError: jobData.last_error,
          progress: jobData.progress,
          metadata: jobData.metadata,
        };

        this.queue.set(job.id, job);
      }

      knowledgeLogger.info('Loaded pending jobs from database', {
        jobs_loaded: pendingJobs?.length || 0,
      });

    } catch (error) {
      knowledgeLogger.error('Error loading pending jobs', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Persist job to database
   */
  private async persistJob(job: ProcessingJob): Promise<void> {
    const { error } = await supabase
      .from('processing_jobs')
      .insert({
        id: job.id,
        document_id: job.documentId,
        priority: job.priority,
        status: job.status,
        retry_count: job.retryCount,
        max_retries: job.maxRetries,
        created_at: job.createdAt.toISOString(),
        started_at: job.startedAt?.toISOString(),
        completed_at: job.completedAt?.toISOString(),
        last_error: job.lastError,
        progress: job.progress,
        metadata: job.metadata,
      });

    if (error) {
      knowledgeLogger.error('Failed to persist job to database', error);
    }
  }

  /**
   * Update job in database
   */
  private async updateJobInDatabase(job: ProcessingJob): Promise<void> {
    const { error } = await supabase
      .from('processing_jobs')
      .update({
        status: job.status,
        retry_count: job.retryCount,
        started_at: job.startedAt?.toISOString(),
        completed_at: job.completedAt?.toISOString(),
        last_error: job.lastError,
        progress: job.progress,
        metadata: job.metadata,
      })
      .eq('id', job.id);

    if (error) {
      knowledgeLogger.error('Failed to update job in database', error);
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.on('job:completed', (job: ProcessingJob) => {
      knowledgeLogger.info('Job completed event', {
        job_id: job.id,
        document_id: job.documentId,
      });
    });

    this.on('job:failed', (job: ProcessingJob, error: any) => {
      knowledgeLogger.error('Job failed event', error instanceof Error ? error : new Error(String(error)), {
        job_id: job.id,
        document_id: job.documentId,
      });
    });

    this.on('job:retry', (job: ProcessingJob) => {
      knowledgeLogger.info('Job retry event', {
        job_id: job.id,
        document_id: job.documentId,
        retry_count: job.retryCount,
      });
    });
  }

  /**
   * Collect and log statistics
   */
  private collectStats(): void {
    const stats = this.getQueueStats();

    knowledgeLogger.info('Processing queue statistics', {
      total_jobs: stats.totalJobs,
      pending_jobs: stats.pendingJobs,
      processing_jobs: stats.processingJobs,
      completed_jobs: stats.completedJobs,
      failed_jobs: stats.failedJobs,
      average_processing_time_ms: stats.averageProcessingTime,
      throughput_jobs_per_hour: stats.queueThroughput,
      error_rate: stats.errorRate,
      retry_rate: stats.retryRate,
    });
  }
}

// Export singleton instance
export const documentProcessingQueue = new DocumentProcessingQueue();