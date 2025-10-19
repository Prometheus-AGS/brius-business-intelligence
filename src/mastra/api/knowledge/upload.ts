import { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { documentUploadProcessor, DocumentUploadRequest, SupportedFormat } from '../../knowledge/upload.js';
import { supabase } from '../../config/database.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Document Upload API Endpoints
 * Provides REST API endpoints for document upload, processing, and management
 * Supports multi-format document ingestion with validation and status tracking
 */

// Validation schemas
const UploadMetadataSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  source: z.string().max(255).optional(),
});

const ProcessingOptionsSchema = z.object({
  chunkingStrategy: z.enum(['paragraph', 'sentence', 'fixed-size', 'semantic', 'hybrid']).optional(),
  generateEmbeddings: z.boolean().optional(),
  enableSearch: z.boolean().optional(),
  extractMetadata: z.boolean().optional(),
});

const GetDocumentsQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
  category: z.string().optional(),
  status: z.enum(['processing', 'completed', 'failed']).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.enum(['uploaded_at', 'title', 'size', 'status']).optional().default('uploaded_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
    files: 10, // Maximum 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Basic validation - detailed validation happens in the processor
    const allowedMimeTypes = [
      'text/plain',
      'text/markdown',
      'text/x-markdown',
      'application/json',
      'text/csv',
      'application/csv',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

/**
 * Upload single document
 * POST /api/knowledge/upload
 */
export const uploadSingleDocument = [upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  const tracer = new APITracer('/api/knowledge/upload', 'POST', {
    userId: req.user?.userId,
    file: req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    } : undefined,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Check if user is authenticated
    if (!req.user?.userId) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
          code: 'user_not_authenticated',
        },
      });
      tracer.fail(new Error('User not authenticated'), 401);
      return;
    }

    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({
        error: {
          message: 'No file uploaded',
          type: 'validation_error',
          code: 'missing_file',
        },
      });
      tracer.fail(new Error('No file uploaded'), 400);
      return;
    }

    apiLogger.info('Processing document upload', {
      user_id: req.user.userId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      trace_id: tracer.getTraceId(),
    });

    // Parse and validate metadata
    let metadata: any = {};
    if (req.body.metadata) {
      try {
        metadata = typeof req.body.metadata === 'string'
          ? JSON.parse(req.body.metadata)
          : req.body.metadata;
      } catch (error) {
        res.status(400).json({
          error: {
            message: 'Invalid metadata JSON',
            type: 'validation_error',
            code: 'invalid_metadata',
          },
        });
        tracer.fail(new Error('Invalid metadata JSON'), 400);
        return;
      }
    }

    const metadataValidation = UploadMetadataSchema.safeParse(metadata);
    if (!metadataValidation.success) {
      tracer.recordValidation(false, metadataValidation.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid metadata',
          type: 'validation_error',
          code: 'metadata_validation_failed',
          details: metadataValidation.error.issues,
        },
      });
      tracer.fail(new Error('Metadata validation failed'), 400);
      return;
    }

    // Parse and validate processing options
    let processingOptions: any = {};
    if (req.body.processing) {
      try {
        processingOptions = typeof req.body.processing === 'string'
          ? JSON.parse(req.body.processing)
          : req.body.processing;
      } catch (error) {
        res.status(400).json({
          error: {
            message: 'Invalid processing options JSON',
            type: 'validation_error',
            code: 'invalid_processing_options',
          },
        });
        tracer.fail(new Error('Invalid processing options JSON'), 400);
        return;
      }
    }

    const processingValidation = ProcessingOptionsSchema.safeParse(processingOptions);
    if (!processingValidation.success) {
      tracer.recordValidation(false, processingValidation.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid processing options',
          type: 'validation_error',
          code: 'processing_validation_failed',
          details: processingValidation.error.issues,
        },
      });
      tracer.fail(new Error('Processing validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    // Prepare upload request
    const uploadRequest: DocumentUploadRequest = {
      file: {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
      metadata: {
        ...metadataValidation.data,
        userId: req.user.userId,
      },
      processing: processingValidation.data,
    };

    // Process the upload
    const result = await documentUploadProcessor.processUpload(uploadRequest);

    const response = {
      success: true,
      data: result,
      message: 'Document uploaded and processing initiated successfully',
    };

    tracer.complete(response);
    res.status(201).json(response);

    apiLogger.info('Document upload completed', {
      user_id: req.user.userId,
      document_id: result.id,
      status: result.status,
      processing_time: Date.now() - new Date(result.uploadedAt).getTime(),
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    apiLogger.error('Document upload failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Document upload failed',
        type: 'upload_error',
        code: 'document_upload_failed',
        details: {
          error_message: errorMessage,
        },
      },
    });
  }
}];

/**
 * Upload multiple documents
 * POST /api/knowledge/upload/batch
 */
export const uploadMultipleDocuments = [upload.array('files', 10), async (req: Request, res: Response): Promise<void> => {
  const tracer = new APITracer('/api/knowledge/upload/batch', 'POST', {
    userId: req.user?.userId,
    filesCount: Array.isArray(req.files) ? req.files.length : 0,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Check if user is authenticated
    if (!req.user?.userId) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
          code: 'user_not_authenticated',
        },
      });
      tracer.fail(new Error('User not authenticated'), 401);
      return;
    }

    // Check if files were uploaded
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      res.status(400).json({
        error: {
          message: 'No files uploaded',
          type: 'validation_error',
          code: 'missing_files',
        },
      });
      tracer.fail(new Error('No files uploaded'), 400);
      return;
    }

    apiLogger.info('Processing batch document upload', {
      user_id: req.user.userId,
      files_count: files.length,
      total_size: files.reduce((sum, file) => sum + file.size, 0),
      trace_id: tracer.getTraceId(),
    });

    // Parse shared metadata and processing options (same validation as single upload)
    const metadataValidation = UploadMetadataSchema.safeParse(
      req.body.metadata ? JSON.parse(req.body.metadata) : {}
    );
    const processingValidation = ProcessingOptionsSchema.safeParse(
      req.body.processing ? JSON.parse(req.body.processing) : {}
    );

    if (!metadataValidation.success || !processingValidation.success) {
      tracer.recordValidation(false, [
        ...(metadataValidation.error?.issues.map(i => i.message) || []),
        ...(processingValidation.error?.issues.map(i => i.message) || [])
      ]);
      res.status(400).json({
        error: {
          message: 'Invalid request parameters',
          type: 'validation_error',
          code: 'batch_validation_failed',
          details: {
            metadata_errors: metadataValidation.error?.issues,
            processing_errors: processingValidation.error?.issues,
          },
        },
      });
      tracer.fail(new Error('Batch validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    // Process each file
    const results: any[] = [];
    const errors: any[] = [];

    for (const file of files) {
      try {
        const uploadRequest: DocumentUploadRequest = {
          file: {
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
          metadata: {
            ...metadataValidation.data,
            userId: req.user.userId,
          },
          processing: processingValidation.data,
        };

        const result = await documentUploadProcessor.processUpload(uploadRequest);
        results.push(result);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          filename: file.originalname,
          error: errorMessage,
        });
      }
    }

    const response = {
      success: true,
      data: {
        successful_uploads: results,
        failed_uploads: errors,
        total_files: files.length,
        successful_count: results.length,
        failed_count: errors.length,
      },
      message: `Batch upload completed: ${results.length} successful, ${errors.length} failed`,
    };

    tracer.complete(response);
    res.status(201).json(response);

    apiLogger.info('Batch document upload completed', {
      user_id: req.user.userId,
      total_files: files.length,
      successful: results.length,
      failed: errors.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Batch document upload failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Batch document upload failed',
        type: 'upload_error',
        code: 'batch_upload_failed',
      },
    });
  }
}];

/**
 * Get upload status by document ID
 * GET /api/knowledge/upload/:documentId/status
 */
export async function getUploadStatus(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/upload/${req.params.documentId}/status`, 'GET', {
    userId: req.user?.userId,
    documentId: req.params.documentId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const documentId = req.params.documentId;
    if (!documentId) {
      res.status(400).json({
        error: {
          message: 'Document ID is required',
          type: 'validation_error',
          code: 'missing_document_id',
        },
      });
      tracer.fail(new Error('Missing document ID'), 400);
      return;
    }

    apiLogger.info('Getting upload status', {
      user_id: req.user?.userId,
      document_id: documentId,
      trace_id: tracer.getTraceId(),
    });

    // Check in-progress uploads first
    const inProgressStatus = documentUploadProcessor.getUploadStatus(documentId);
    if (inProgressStatus) {
      const response = {
        success: true,
        data: inProgressStatus,
        message: 'Upload status retrieved (in progress)',
      };

      tracer.complete(response);
      res.json(response);
      return;
    }

    // Check completed uploads in database
    const { data: document, error } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (error || !document) {
      res.status(404).json({
        error: {
          message: 'Document not found',
          type: 'not_found_error',
          code: 'document_not_found',
        },
      });
      tracer.fail(new Error('Document not found'), 404);
      return;
    }

    // Check if user has access to this document
    if (req.user?.userId && document.user_id !== req.user.userId) {
      res.status(403).json({
        error: {
          message: 'Access denied',
          type: 'authorization_error',
          code: 'document_access_denied',
        },
      });
      tracer.fail(new Error('Access denied'), 403);
      return;
    }

    const response = {
      success: true,
      data: {
        id: document.id,
        title: document.title,
        originalName: document.original_name,
        size: document.file_size,
        mimeType: document.mime_type,
        status: document.status,
        uploadedAt: document.uploaded_at,
        processedAt: document.processed_at,
        metadata: document.metadata,
        processing: document.processing_info,
        error: document.error_message,
      },
      message: 'Upload status retrieved',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Upload status retrieved', {
      user_id: req.user?.userId,
      document_id: documentId,
      status: document.status,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get upload status', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve upload status',
        type: 'internal_server_error',
        code: 'status_retrieval_error',
      },
    });
  }
}

/**
 * Get all current uploads in progress
 * GET /api/knowledge/upload/current
 */
export async function getCurrentUploads(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/upload/current', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Getting current uploads', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    const currentUploads = documentUploadProcessor.getCurrentUploads();

    // Filter by user if authenticated
    const filteredUploads = req.user?.userId
      ? currentUploads.filter(upload => upload.metadata?.userId === req.user?.userId)
      : currentUploads;

    const response = {
      success: true,
      data: {
        uploads: filteredUploads,
        total_uploads: filteredUploads.length,
      },
      message: `Retrieved ${filteredUploads.length} current uploads`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Current uploads retrieved', {
      user_id: req.user?.userId,
      uploads_count: filteredUploads.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get current uploads', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve current uploads',
        type: 'internal_server_error',
        code: 'current_uploads_error',
      },
    });
  }
}

/**
 * Get supported file formats
 * GET /api/knowledge/upload/formats
 */
export async function getSupportedFormats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/upload/formats', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const formats = documentUploadProcessor.getSupportedFormats();

    const response = {
      success: true,
      data: {
        formats,
        total_formats: formats.length,
      },
      message: `Retrieved ${formats.length} supported formats`,
    };

    tracer.complete(response);
    res.json(response);

  } catch (error) {
    apiLogger.error('Failed to get supported formats', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve supported formats',
        type: 'internal_server_error',
        code: 'formats_retrieval_error',
      },
    });
  }
}