import { Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseClient } from '../../config/database.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

const supabase = getSupabaseClient();

/**
 * Document Management API Endpoints
 * Provides CRUD operations for knowledge base documents
 * Includes metadata management, batch operations, and document lifecycle
 */

// Validation schemas
const GetDocumentsQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
  category: z.string().optional(),
  status: z.enum(['processing', 'completed', 'failed']).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.enum(['uploaded_at', 'title', 'size', 'status']).optional().default('uploaded_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  tags: z.string().optional(), // Comma-separated tags
  userId: z.string().optional(),
});

const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

const BatchOperationSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(50),
  operation: z.enum(['delete', 'update_category', 'update_tags', 'reprocess']),
  operationData: z.record(z.any()).optional(),
});

/**
 * Get all documents with filtering and pagination
 * GET /api/knowledge/documents
 */
export async function getDocuments(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/documents', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Validate query parameters
    const validationResult = GetDocumentsQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid query parameters',
          type: 'validation_error',
          code: 'invalid_query_params',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { page, limit, category, status, search, sortBy, sortOrder, tags, userId } = validationResult.data;

    apiLogger.info('Getting documents with filters', {
      user_id: req.user?.userId,
      page,
      limit,
      category,
      status,
      search: search?.substring(0, 50),
      sort_by: sortBy,
      sort_order: sortOrder,
      trace_id: tracer.getTraceId(),
    });

    // Build query
    let query = supabase
      .from('knowledge_documents')
      .select(`
        id,
        title,
        original_name,
        mime_type,
        file_size,
        status,
        category,
        description,
        tags,
        user_id,
        uploaded_at,
        processed_at,
        metadata,
        processing_info,
        error_message
      `, { count: 'exact' });

    // Apply filters
    if (category) {
      query = query.eq('category', category);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,original_name.ilike.%${search}%`);
    }

    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      if (tagArray.length > 0) {
        query = query.overlaps('tags', tagArray);
      }
    }

    if (userId || req.user?.userId) {
      query = query.eq('user_id', userId || req.user?.userId);
    }

    // Apply sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy, { ascending });

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: documents, error, count } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Calculate pagination metadata
    const totalPages = Math.ceil((count || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    const response = {
      success: true,
      data: {
        documents: documents || [],
        pagination: {
          page,
          limit,
          total_items: count || 0,
          total_pages: totalPages,
          has_next_page: hasNextPage,
          has_previous_page: hasPreviousPage,
        },
        filters: {
          category,
          status,
          search,
          tags: tags?.split(',').map(t => t.trim()).filter(t => t.length > 0),
        },
        sorting: {
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      },
      message: `Retrieved ${documents?.length || 0} documents`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Documents retrieved successfully', {
      user_id: req.user?.userId,
      documents_count: documents?.length || 0,
      total_items: count || 0,
      page,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get documents', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve documents',
        type: 'internal_server_error',
        code: 'documents_retrieval_error',
      },
    });
  }
}

/**
 * Get document by ID
 * GET /api/knowledge/documents/:id
 */
export async function getDocumentById(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/documents/${req.params.id}`, 'GET', {
    userId: req.user?.userId,
    documentId: req.params.id,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const documentId = req.params.id;
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

    apiLogger.info('Getting document by ID', {
      user_id: req.user?.userId,
      document_id: documentId,
      trace_id: tracer.getTraceId(),
    });

    // Get document with chunks count
    const { data: document, error } = await supabase
      .from('knowledge_documents')
      .select(`
        *,
        chunks:document_chunks(count)
      `)
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

    // Check user access
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
        ...document,
        chunks_count: document.chunks?.[0]?.count || 0,
      },
      message: 'Document retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Document retrieved successfully', {
      user_id: req.user?.userId,
      document_id: documentId,
      status: document.status,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get document', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve document',
        type: 'internal_server_error',
        code: 'document_retrieval_error',
      },
    });
  }
}

/**
 * Update document metadata
 * PATCH /api/knowledge/documents/:id
 */
export async function updateDocument(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/documents/${req.params.id}`, 'PATCH', {
    userId: req.user?.userId,
    documentId: req.params.id,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const documentId = req.params.id;
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

    // Validate request body
    const validationResult = UpdateDocumentSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid update data',
          type: 'validation_error',
          code: 'invalid_update_data',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const updateData = validationResult.data;

    apiLogger.info('Updating document', {
      user_id: req.user?.userId,
      document_id: documentId,
      update_fields: Object.keys(updateData),
      trace_id: tracer.getTraceId(),
    });

    // Check if document exists and user has access
    const { data: existingDocument, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select('user_id')
      .eq('id', documentId)
      .single();

    if (fetchError || !existingDocument) {
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

    // Check user access
    if (req.user?.userId && existingDocument.user_id !== req.user.userId) {
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

    // Update the document
    const { data: updatedDocument, error: updateError } = await supabase
      .from('knowledge_documents')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`);
    }

    const response = {
      success: true,
      data: updatedDocument,
      message: 'Document updated successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Document updated successfully', {
      user_id: req.user?.userId,
      document_id: documentId,
      updated_fields: Object.keys(updateData),
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to update document', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to update document',
        type: 'internal_server_error',
        code: 'document_update_error',
      },
    });
  }
}

/**
 * Delete document
 * DELETE /api/knowledge/documents/:id
 */
export async function deleteDocument(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/documents/${req.params.id}`, 'DELETE', {
    userId: req.user?.userId,
    documentId: req.params.id,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const documentId = req.params.id;
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

    const force = req.query.force === 'true';

    apiLogger.info('Deleting document', {
      user_id: req.user?.userId,
      document_id: documentId,
      force,
      trace_id: tracer.getTraceId(),
    });

    // Check if document exists and user has access
    const { data: existingDocument, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select('user_id, title')
      .eq('id', documentId)
      .single();

    if (fetchError || !existingDocument) {
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

    // Check user access
    if (req.user?.userId && existingDocument.user_id !== req.user.userId) {
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

    // Delete document chunks first (cascade delete)
    const { error: chunksDeleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (chunksDeleteError && !force) {
      throw new Error(`Failed to delete document chunks: ${chunksDeleteError.message}`);
    }

    // Delete the document
    const { error: deleteError } = await supabase
      .from('knowledge_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      throw new Error(`Failed to delete document: ${deleteError.message}`);
    }

    const response = {
      success: true,
      data: {
        document_id: documentId,
        title: existingDocument.title,
        deleted_at: new Date().toISOString(),
      },
      message: 'Document deleted successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Document deleted successfully', {
      user_id: req.user?.userId,
      document_id: documentId,
      title: existingDocument.title,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to delete document', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to delete document',
        type: 'internal_server_error',
        code: 'document_deletion_error',
      },
    });
  }
}

/**
 * Get document chunks
 * GET /api/knowledge/documents/:id/chunks
 */
export async function getDocumentChunks(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer(`/api/knowledge/documents/${req.params.id}/chunks`, 'GET', {
    userId: req.user?.userId,
    documentId: req.params.id,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const documentId = req.params.id;
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

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    apiLogger.info('Getting document chunks', {
      user_id: req.user?.userId,
      document_id: documentId,
      page,
      limit,
      trace_id: tracer.getTraceId(),
    });

    // Check if document exists and user has access
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .select('user_id, title')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
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

    // Check user access
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

    // Get chunks with pagination
    const offset = (page - 1) * limit;
    const { data: chunks, error: chunksError, count } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact' })
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true })
      .range(offset, offset + limit - 1);

    if (chunksError) {
      throw new Error(`Failed to retrieve chunks: ${chunksError.message}`);
    }

    const totalPages = Math.ceil((count || 0) / limit);

    const response = {
      success: true,
      data: {
        document: {
          id: documentId,
          title: document.title,
        },
        chunks: chunks || [],
        pagination: {
          page,
          limit,
          total_items: count || 0,
          total_pages: totalPages,
          has_next_page: page < totalPages,
          has_previous_page: page > 1,
        },
      },
      message: `Retrieved ${chunks?.length || 0} chunks`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Document chunks retrieved', {
      user_id: req.user?.userId,
      document_id: documentId,
      chunks_count: chunks?.length || 0,
      total_chunks: count || 0,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Failed to get document chunks', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve document chunks',
        type: 'internal_server_error',
        code: 'chunks_retrieval_error',
      },
    });
  }
}

/**
 * Batch operations on documents
 * POST /api/knowledge/documents/batch
 */
export async function batchOperations(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/documents/batch', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Validate request body
    const validationResult = BatchOperationSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid batch operation request',
          type: 'validation_error',
          code: 'invalid_batch_operation',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { documentIds, operation, operationData } = validationResult.data;

    apiLogger.info('Performing batch operation', {
      user_id: req.user?.userId,
      operation,
      document_count: documentIds.length,
      trace_id: tracer.getTraceId(),
    });

    // Check user access to all documents
    const { data: accessCheck, error: accessError } = await supabase
      .from('knowledge_documents')
      .select('id, user_id, title')
      .in('id', documentIds);

    if (accessError) {
      throw new Error(`Failed to check document access: ${accessError.message}`);
    }

    // Filter documents user has access to
    const accessibleDocuments = (accessCheck || []).filter(doc =>
      !req.user?.userId || doc.user_id === req.user.userId
    );

    if (accessibleDocuments.length !== documentIds.length) {
      res.status(403).json({
        error: {
          message: 'Access denied to some documents',
          type: 'authorization_error',
          code: 'batch_access_denied',
          details: {
            requested: documentIds.length,
            accessible: accessibleDocuments.length,
          },
        },
      });
      tracer.fail(new Error('Batch access denied'), 403);
      return;
    }

    const accessibleIds = accessibleDocuments.map(doc => doc.id);
    const results: any[] = [];
    const errors: any[] = [];

    // Perform batch operation
    switch (operation) {
      case 'delete':
        for (const docId of accessibleIds) {
          try {
            // Delete chunks first
            await supabase.from('document_chunks').delete().eq('document_id', docId);
            // Delete document
            await supabase.from('knowledge_documents').delete().eq('id', docId);
            results.push({ document_id: docId, status: 'deleted' });
          } catch (error) {
            errors.push({
              document_id: docId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        break;

      case 'update_category':
        if (!operationData?.category) {
          throw new Error('Category is required for update_category operation');
        }

        const { error: categoryUpdateError } = await supabase
          .from('knowledge_documents')
          .update({ category: operationData.category })
          .in('id', accessibleIds);

        if (categoryUpdateError) {
          throw new Error(`Batch category update failed: ${categoryUpdateError.message}`);
        }

        results.push(...accessibleIds.map(id => ({
          document_id: id,
          status: 'category_updated',
          new_category: operationData.category,
        })));
        break;

      case 'update_tags':
        if (!operationData?.tags || !Array.isArray(operationData.tags)) {
          throw new Error('Tags array is required for update_tags operation');
        }

        const { error: tagsUpdateError } = await supabase
          .from('knowledge_documents')
          .update({ tags: operationData.tags })
          .in('id', accessibleIds);

        if (tagsUpdateError) {
          throw new Error(`Batch tags update failed: ${tagsUpdateError.message}`);
        }

        results.push(...accessibleIds.map(id => ({
          document_id: id,
          status: 'tags_updated',
          new_tags: operationData.tags,
        })));
        break;

      case 'reprocess':
        // This would trigger reprocessing of documents
        // For now, just mark status as pending reprocessing
        const { error: reprocessError } = await supabase
          .from('knowledge_documents')
          .update({
            status: 'processing',
            processed_at: null,
            error_message: null,
          })
          .in('id', accessibleIds);

        if (reprocessError) {
          throw new Error(`Batch reprocess failed: ${reprocessError.message}`);
        }

        results.push(...accessibleIds.map(id => ({
          document_id: id,
          status: 'reprocessing_queued',
        })));
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const response = {
      success: true,
      data: {
        operation,
        total_requested: documentIds.length,
        successful_operations: results,
        failed_operations: errors,
        success_count: results.length,
        error_count: errors.length,
      },
      message: `Batch ${operation} completed: ${results.length} successful, ${errors.length} failed`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Batch operation completed', {
      user_id: req.user?.userId,
      operation,
      total_requested: documentIds.length,
      success_count: results.length,
      error_count: errors.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Batch operation failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Batch operation failed',
        type: 'internal_server_error',
        code: 'batch_operation_error',
      },
    });
  }
}