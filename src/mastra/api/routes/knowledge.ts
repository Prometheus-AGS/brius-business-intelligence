import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { getKnowledgeSettings, updateKnowledgeSettings } from '../../knowledge/settings.js';
import {
  listDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getDocumentChunks,
  createDocumentWithChunks,
  countDocumentChunks,
} from '../../knowledge/documents.js';
import { enqueueDocumentUpload } from '../../knowledge/upload.js';
import { documentProcessingQueue } from '../../knowledge/processing-queue.js';
import { knowledgeLogger } from '../../observability/logger.js';
import { KnowledgeSearchService } from '../../knowledge/search.js';
import { UploadRequestSchema, decodeContent } from '../../knowledge/upload.js';

const searchService = new KnowledgeSearchService();

const updateSettingsSchema = z.object({
  chunkStrategy: z.enum(['paragraph', 'sentence', 'fixed', 'semantic', 'hybrid']).optional(),
  chunkSize: z.number().int().min(50).max(8000).optional(),
  overlap: z.number().int().min(0).max(1000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const batchOperationSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1),
  operation: z.enum(['delete', 'update_category', 'update_tags', 'reprocess']),
  operationData: z.record(z.string(), z.unknown()).optional(),
});

const searchRequestSchema = z.object({
  query: z.string().min(1),
  filters: z
    .object({
      documentIds: z.array(z.string().uuid()).optional(),
      categories: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      minScore: z.number().min(0).max(1).optional(),
      maxResults: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
  searchType: z.enum(['semantic', 'keyword', 'hybrid']).optional(),
  rerankResults: z.boolean().optional(),
});

function parsePageLimit(c: any) {
  const page = Number(c.req.query('page') ?? '1');
  const limit = Number(c.req.query('limit') ?? '20');
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20,
  };
}

export function getKnowledgeRoutes() {
  return [
    registerApiRoute('/knowledge/settings', {
      method: 'GET',
      handler: async c => {
        const settings = await getKnowledgeSettings();
        return c.json({ data: settings });
      },
    }),
    registerApiRoute('/knowledge/settings', {
      method: 'PATCH',
      handler: async c => {
        const body = await c.req.json();
        const validation = updateSettingsSchema.safeParse(body);
        if (!validation.success) {
          return c.json({
            error: {
              message: 'Invalid settings update payload',
              details: validation.error.format(),
            },
          }, 400);
        }

        const updated = await updateKnowledgeSettings(validation.data);
        return c.json({ data: updated });
      },
    }),
    registerApiRoute('/knowledge/documents', {
      method: 'GET',
      handler: async c => {
        const { page, limit } = parsePageLimit(c);
        const filters = {
          page,
          limit,
          category: c.req.query('category') ?? undefined,
          status: c.req.query('status') as any,
          search: c.req.query('search') ?? undefined,
          sortBy: (c.req.query('sortBy') as any) ?? undefined,
          sortOrder: (c.req.query('sortOrder') as any) ?? undefined,
          tags: c.req.query('tags')?.split(',').map((tag: string) => tag.trim()).filter(Boolean),
          userId: (c.req as any).user?.userId,
        };

        const result = await listDocuments(filters);
        return c.json({ data: result });
      },
    }),
    registerApiRoute('/knowledge/documents/upload', {
      method: 'POST',
      handler: async c => {
        const body = await c.req.json();
        const payload = {
          ...body,
          userId: (c.req as any).user?.userId,
        };
        const response = await enqueueDocumentUpload(payload as any);
        return c.json({ data: response }, 202);
      },
    }),
    registerApiRoute('/knowledge/documents/sync', {
      method: 'POST',
      handler: async c => {
        const body = await c.req.json();
        const validation = UploadRequestSchema.extend({ encoding: z.enum(['plain', 'base64']).default('plain') }).safeParse(body);
        if (!validation.success) {
          return c.json({ error: { message: 'Invalid upload payload', details: validation.error.format() } }, 400);
        }

        const data = validation.data;
        const decodedContent = decodeContent(data.content, data.encoding);

        const result = await createDocumentWithChunks({
          title: data.title,
          content: decodedContent,
          originalName: data.originalName,
          mimeType: data.mimeType,
          category: data.category,
          tags: data.tags,
          metadata: data.metadata,
          chunkStrategy: data.chunkStrategy,
          chunkSize: data.chunkSize,
          overlap: data.overlap,
          userId: (c.req as any).user?.userId,
          fileSize: Buffer.byteLength(decodedContent, 'utf-8'),
        });
        return c.json({ data: result }, 201);
      },
    }),
    registerApiRoute('/knowledge/documents/:id', {
      method: 'GET',
      handler: async c => {
        const documentId = c.req.param('id');
        const document = await getDocumentById(documentId);
        if (!document) {
          return c.json({ error: { message: 'Document not found' } }, 404);
        }

        const chunkCount = await countDocumentChunks(documentId);

        return c.json({
          data: {
            document,
            chunkCount,
          },
        });
      },
    }),
    registerApiRoute('/knowledge/documents/:id/reprocess', {
      method: 'POST',
      handler: async c => {
        const documentId = c.req.param('id');
        const document = await getDocumentById(documentId);
        if (!document) {
          return c.json({ error: { message: 'Document not found' } }, 404);
        }

        await documentProcessingQueue.enqueue({ documentId });
        return c.json({ data: { status: 'queued', documentId } });
      },
    }),
    registerApiRoute('/knowledge/documents/:id', {
      method: 'PATCH',
      handler: async c => {
        const documentId = c.req.param('id');
        const body = await c.req.json();
        const validation = updateDocumentSchema.safeParse(body);
        if (!validation.success) {
          return c.json({ error: { message: 'Invalid update payload', details: validation.error.format() } }, 400);
        }

        const updated = await updateDocument(documentId, validation.data);
        if (!updated) {
          return c.json({ error: { message: 'Document not found' } }, 404);
        }

        return c.json({ data: updated });
      },
    }),
    registerApiRoute('/knowledge/documents/:id', {
      method: 'DELETE',
      handler: async c => {
        const documentId = c.req.param('id');
        const document = await getDocumentById(documentId);
        if (!document) {
          return c.json({ error: { message: 'Document not found' } }, 404);
        }

        await deleteDocument(documentId);
        knowledgeLogger.info('Knowledge document deleted', { document_id: documentId });
        return c.json({ data: { documentId } });
      },
    }),
    registerApiRoute('/knowledge/documents/:id/chunks', {
      method: 'GET',
      handler: async c => {
        const documentId = c.req.param('id');
        const { page, limit } = parsePageLimit(c);
        const result = await getDocumentChunks(documentId, page, limit);
        return c.json({ data: result });
      },
    }),
    registerApiRoute('/knowledge/documents/batch', {
      method: 'POST',
      handler: async c => {
        const body = await c.req.json();
        const validation = batchOperationSchema.safeParse(body);
        if (!validation.success) {
          return c.json({ error: { message: 'Invalid batch operation', details: validation.error.format() } }, 400);
        }

        const { documentIds, operation, operationData } = validation.data;
        const results: Array<{ documentId: string; status: string; error?: string }> = [];

        for (const documentId of documentIds) {
          try {
            const document = await getDocumentById(documentId);
            if (!document) {
              results.push({ documentId, status: 'failed', error: 'Document not found' });
              continue;
            }

            switch (operation) {
              case 'delete':
                await deleteDocument(documentId);
                results.push({ documentId, status: 'deleted' });
                break;
              case 'update_category':
                if (!operationData || typeof operationData.category !== 'string') {
                  throw new Error('category is required for update_category');
                }
                await updateDocument(documentId, { category: operationData.category });
                results.push({ documentId, status: 'category_updated' });
                break;
              case 'update_tags':
                if (!operationData || !Array.isArray(operationData.tags)) {
                  throw new Error('tags array is required for update_tags');
                }
                await updateDocument(documentId, { tags: operationData.tags });
                results.push({ documentId, status: 'tags_updated' });
                break;
              case 'reprocess':
                await documentProcessingQueue.enqueue({
                  documentId,
                  metadata: {
                    chunkStrategy: operationData?.chunkStrategy,
                    chunkSize: operationData?.chunkSize,
                    overlap: operationData?.overlap,
                  },
                });
                results.push({ documentId, status: 'reprocess_enqueued' });
                break;
            }
          } catch (error) {
            results.push({
              documentId,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        return c.json({ data: { results } });
      },
    }),
    registerApiRoute('/knowledge/processing/jobs', {
      method: 'GET',
      handler: async c => {
        const status = c.req.query('status') as any;
        const jobs = await documentProcessingQueue.listJobs({
          status,
          userId: (c.req as any).user?.userId,
        });
        return c.json({ data: jobs });
      },
    }),
    registerApiRoute('/knowledge/processing/jobs/:id', {
      method: 'GET',
      handler: async c => {
        const jobId = c.req.param('id');
        const job = await documentProcessingQueue.getJob(jobId);
        if (!job) {
          return c.json({ error: { message: 'Job not found' } }, 404);
        }
        return c.json({ data: job });
      },
    }),
    registerApiRoute('/knowledge/search', {
      method: 'POST',
      handler: async c => {
        const body = await c.req.json();
        const validation = searchRequestSchema.safeParse(body);
        if (!validation.success) {
          return c.json({ error: { message: 'Invalid search payload', details: validation.error.format() } }, 400);
        }
        const result = await searchService.search(validation.data);
        return c.json({ data: result });
      },
    }),
    registerApiRoute('/knowledge/search/similar', {
      method: 'POST',
      handler: async c => {
        const schema = z.object({ documentId: z.string().uuid(), limit: z.number().int().min(1).max(20).default(5) });
        const body = await c.req.json();
        const validation = schema.safeParse(body);
        if (!validation.success) {
          return c.json({ error: { message: 'Invalid payload', details: validation.error.format() } }, 400);
        }
        const result = await searchService.findSimilarDocuments(validation.data.documentId, validation.data.limit);
        return c.json({ data: result });
      },
    }),
    registerApiRoute('/knowledge/search/suggestions', {
      method: 'GET',
      handler: async c => {
        const prefix = c.req.query('q') ?? '';
        const suggestions = await searchService.getSuggestions(prefix);
        return c.json({ data: suggestions });
      },
    }),
    registerApiRoute('/knowledge/search/recommendations', {
      method: 'POST',
      handler: async c => {
        const schema = z.object({ tags: z.array(z.string()).optional(), limit: z.number().int().min(1).max(10).default(5) });
        const body = await c.req.json();
        const validation = schema.safeParse(body);
        if (!validation.success) {
          return c.json({ error: { message: 'Invalid payload', details: validation.error.format() } }, 400);
        }
        const recommendations = await searchService.getRecommendations(validation.data.tags ?? [], validation.data.limit);
        return c.json({ data: recommendations });
      },
    }),
    registerApiRoute('/knowledge/search/stats', {
      method: 'GET',
      handler: async c => {
        const stats = await searchService.getStats();
        return c.json({ data: stats });
      },
    }),
  ];
}
