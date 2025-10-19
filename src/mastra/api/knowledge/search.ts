import { Request, Response } from 'express';
import { z } from 'zod';
import { knowledgeSearchService, SearchQuery } from '../../knowledge/search.js';
import { supabase } from '../../config/database.js';
import { apiLogger } from '../../observability/logger.js';
import { APITracer } from '../../observability/tracing.js';

/**
 * Knowledge Base Search API Endpoints
 * Provides REST API endpoints for semantic search, filtering, and content discovery
 * Supports hybrid search combining semantic similarity and keyword matching
 */

// Validation schemas
const SearchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  filters: z.object({
    documentIds: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    dateRange: z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    }).optional(),
    minScore: z.number().min(0).max(1).optional(),
    maxResults: z.number().min(1).max(100).default(20).optional(),
  }).optional(),
  searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid'),
  rerankResults: z.boolean().default(true),
});

const SimilarDocumentsSchema = z.object({
  documentId: z.string().min(1),
  maxResults: z.number().min(1).max(50).default(10).optional(),
  minScore: z.number().min(0).max(1).default(0.3).optional(),
});

const RecommendationsSchema = z.object({
  basedOn: z.enum(['recent_searches', 'viewed_documents', 'user_preferences']).default('recent_searches'),
  maxResults: z.number().min(1).max(20).default(10).optional(),
  categories: z.array(z.string()).optional(),
});

/**
 * Search knowledge base
 * POST /api/knowledge/search
 */
export async function searchKnowledgeBase(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/search', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Validate request body
    const validationResult = SearchRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid search request',
          type: 'validation_error',
          code: 'invalid_search_parameters',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const searchRequest = validationResult.data;

    apiLogger.info('Performing knowledge base search', {
      user_id: req.user?.userId,
      query: searchRequest.query.substring(0, 100),
      search_type: searchRequest.searchType,
      max_results: searchRequest.filters?.maxResults,
      trace_id: tracer.getTraceId(),
    });

    // Prepare search query
    const searchQuery: SearchQuery = {
      ...searchRequest,
      filters: {
        ...searchRequest.filters,
        userId: req.user?.userId, // Add user context for filtering
        dateRange: searchRequest.filters?.dateRange ? {
          start: new Date(searchRequest.filters.dateRange.start),
          end: new Date(searchRequest.filters.dateRange.end),
        } : undefined,
      },
    };

    // Perform search
    const searchResults = await knowledgeSearchService.search(searchQuery);

    const response = {
      success: true,
      data: searchResults,
      message: `Found ${searchResults.totalResults} results for "${searchRequest.query}"`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Knowledge base search completed', {
      user_id: req.user?.userId,
      query: searchRequest.query.substring(0, 50),
      results_count: searchResults.totalResults,
      processing_time_ms: searchResults.processingTime,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    apiLogger.error('Knowledge base search failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Search operation failed',
        type: 'search_error',
        code: 'knowledge_search_failed',
        details: {
          error_message: errorMessage,
        },
      },
    });
  }
}

/**
 * Get similar documents
 * POST /api/knowledge/search/similar
 */
export async function getSimilarDocuments(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/search/similar', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Validate request body
    const validationResult = SimilarDocumentsSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid similar documents request',
          type: 'validation_error',
          code: 'invalid_similarity_parameters',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { documentId, maxResults, minScore } = validationResult.data;

    apiLogger.info('Finding similar documents', {
      user_id: req.user?.userId,
      document_id: documentId,
      max_results: maxResults,
      min_score: minScore,
      trace_id: tracer.getTraceId(),
    });

    // Get the source document
    const { data: sourceDocument, error: docError } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !sourceDocument) {
      res.status(404).json({
        error: {
          message: 'Source document not found',
          type: 'not_found_error',
          code: 'document_not_found',
        },
      });
      tracer.fail(new Error('Document not found'), 404);
      return;
    }

    // Check user access
    if (req.user?.userId && sourceDocument.user_id !== req.user.userId) {
      res.status(403).json({
        error: {
          message: 'Access denied to source document',
          type: 'authorization_error',
          code: 'document_access_denied',
        },
      });
      tracer.fail(new Error('Access denied'), 403);
      return;
    }

    // Use document title and description as search query for similarity
    const searchQuery = `${sourceDocument.title} ${sourceDocument.description || ''}`.trim();

    // Perform semantic search to find similar documents
    const searchResults = await knowledgeSearchService.search({
      query: searchQuery,
      searchType: 'semantic',
      filters: {
        documentIds: [], // Exclude source document by filtering later
        userId: req.user?.userId,
        minScore: minScore,
        maxResults: maxResults + 1, // Get one extra to remove source document
      },
      rerankResults: true,
    });

    // Filter out the source document from results
    const similarDocuments = searchResults.results
      .filter(result => result.document.id !== documentId)
      .slice(0, maxResults);

    const response = {
      success: true,
      data: {
        source_document: {
          id: sourceDocument.id,
          title: sourceDocument.title,
          category: sourceDocument.category,
          tags: sourceDocument.tags,
        },
        similar_documents: similarDocuments,
        total_similar: similarDocuments.length,
        search_metadata: {
          search_query: searchQuery,
          min_score: minScore,
          processing_time_ms: searchResults.processingTime,
        },
      },
      message: `Found ${similarDocuments.length} similar documents`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Similar documents found', {
      user_id: req.user?.userId,
      source_document_id: documentId,
      similar_count: similarDocuments.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Similar documents search failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Similar documents search failed',
        type: 'search_error',
        code: 'similar_documents_failed',
      },
    });
  }
}

/**
 * Get search suggestions/autocomplete
 * GET /api/knowledge/search/suggestions
 */
export async function getSearchSuggestions(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/search/suggestions', 'GET', {
    userId: req.user?.userId,
    query: req.query,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.length < 2) {
      res.status(400).json({
        error: {
          message: 'Query must be at least 2 characters long',
          type: 'validation_error',
          code: 'query_too_short',
        },
      });
      tracer.fail(new Error('Query too short'), 400);
      return;
    }

    apiLogger.info('Getting search suggestions', {
      user_id: req.user?.userId,
      query: query.substring(0, 50),
      limit,
      trace_id: tracer.getTraceId(),
    });

    // Get suggestions from document titles and content
    const { data: titleSuggestions, error: titleError } = await supabase
      .from('knowledge_documents')
      .select('title, category')
      .ilike('title', `%${query}%`)
      .eq('status', 'completed')
      .limit(limit);

    // Get suggestions from document categories
    const { data: categorySuggestions, error: categoryError } = await supabase
      .from('knowledge_documents')
      .select('category')
      .ilike('category', `%${query}%`)
      .eq('status', 'completed')
      .not('category', 'is', null)
      .limit(5);

    // Get suggestions from common search terms (if we had a search history table)
    // For now, we'll use a basic approach with document content

    const suggestions = [
      // Title-based suggestions
      ...(titleSuggestions || []).map(doc => ({
        type: 'document_title',
        text: doc.title,
        category: doc.category,
        score: 1.0,
      })),
      // Category-based suggestions
      ...(categorySuggestions || []).map(doc => ({
        type: 'category',
        text: doc.category,
        score: 0.8,
      })),
    ];

    // Remove duplicates and sort by score
    const uniqueSuggestions = suggestions
      .filter((suggestion, index, self) =>
        index === self.findIndex(s => s.text === suggestion.text && s.type === suggestion.type)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const response = {
      success: true,
      data: {
        query,
        suggestions: uniqueSuggestions,
        total_suggestions: uniqueSuggestions.length,
      },
      message: `Found ${uniqueSuggestions.length} suggestions for "${query}"`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Search suggestions retrieved', {
      user_id: req.user?.userId,
      query: query.substring(0, 50),
      suggestions_count: uniqueSuggestions.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Search suggestions failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to get search suggestions',
        type: 'search_error',
        code: 'suggestions_failed',
      },
    });
  }
}

/**
 * Get content recommendations
 * POST /api/knowledge/search/recommendations
 */
export async function getContentRecommendations(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/search/recommendations', 'POST', {
    userId: req.user?.userId,
    body: req.body,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    // Validate request body
    const validationResult = RecommendationsSchema.safeParse(req.body);
    if (!validationResult.success) {
      tracer.recordValidation(false, validationResult.error.issues.map(i => i.message));
      res.status(400).json({
        error: {
          message: 'Invalid recommendations request',
          type: 'validation_error',
          code: 'invalid_recommendation_parameters',
          details: validationResult.error.issues,
        },
      });
      tracer.fail(new Error('Validation failed'), 400);
      return;
    }

    tracer.recordValidation(true);

    const { basedOn, maxResults, categories } = validationResult.data;

    apiLogger.info('Getting content recommendations', {
      user_id: req.user?.userId,
      based_on: basedOn,
      max_results: maxResults,
      categories,
      trace_id: tracer.getTraceId(),
    });

    let recommendations: any[] = [];

    switch (basedOn) {
      case 'recent_searches':
        // For now, recommend popular/recent documents
        recommendations = await this.getPopularDocuments(maxResults, categories, req.user?.userId);
        break;

      case 'viewed_documents':
        // Recommend similar documents to recently viewed ones
        recommendations = await this.getSimilarToRecentlyViewed(maxResults, categories, req.user?.userId);
        break;

      case 'user_preferences':
        // Recommend based on user's document categories and tags
        recommendations = await this.getPersonalizedRecommendations(maxResults, categories, req.user?.userId);
        break;

      default:
        recommendations = await this.getPopularDocuments(maxResults, categories, req.user?.userId);
    }

    const response = {
      success: true,
      data: {
        recommendations,
        total_recommendations: recommendations.length,
        based_on: basedOn,
        generated_at: new Date().toISOString(),
      },
      message: `Generated ${recommendations.length} content recommendations`,
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Content recommendations generated', {
      user_id: req.user?.userId,
      based_on: basedOn,
      recommendations_count: recommendations.length,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Content recommendations failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to generate content recommendations',
        type: 'recommendation_error',
        code: 'recommendations_failed',
      },
    });
  }
}

/**
 * Get search statistics
 * GET /api/knowledge/search/stats
 */
export async function getSearchStats(req: Request, res: Response): Promise<void> {
  const tracer = new APITracer('/api/knowledge/search/stats', 'GET', {
    userId: req.user?.userId,
  });

  try {
    tracer.recordAuth(Boolean(req.user), req.user?.userId);

    apiLogger.info('Getting search statistics', {
      user_id: req.user?.userId,
      trace_id: tracer.getTraceId(),
    });

    // Get search statistics from the service
    const stats = await knowledgeSearchService.getSearchStats();

    // Get additional database statistics
    const { data: totalDocs } = await supabase
      .from('knowledge_documents')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed');

    const { data: totalChunks } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });

    const { data: recentDocs } = await supabase
      .from('knowledge_documents')
      .select('uploaded_at')
      .eq('status', 'completed')
      .gte('uploaded_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('uploaded_at', { ascending: false });

    const response = {
      success: true,
      data: {
        ...stats,
        recent_uploads: recentDocs?.length || 0,
        database_stats: {
          total_documents: totalDocs?.length || 0,
          total_chunks: totalChunks?.length || 0,
        },
      },
      message: 'Search statistics retrieved successfully',
    };

    tracer.complete(response);
    res.json(response);

    apiLogger.info('Search statistics retrieved', {
      user_id: req.user?.userId,
      total_documents: stats.totalDocuments,
      total_searches: stats.searchesPerformed,
      trace_id: tracer.getTraceId(),
    });

  } catch (error) {
    apiLogger.error('Search statistics failed', error instanceof Error ? error : new Error(String(error)));
    tracer.fail(error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Failed to retrieve search statistics',
        type: 'stats_error',
        code: 'search_stats_failed',
      },
    });
  }
}

/**
 * Helper: Get popular documents
 */
async function getPopularDocuments(limit: number, categories?: string[], userId?: string): Promise<any[]> {
  let query = supabase
    .from('knowledge_documents')
    .select('id, title, category, tags, uploaded_at, metadata')
    .eq('status', 'completed')
    .order('uploaded_at', { ascending: false });

  if (categories?.length) {
    query = query.in('category', categories);
  }

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.limit(limit);

  if (error) {
    throw new Error(`Failed to get popular documents: ${error.message}`);
  }

  return (data || []).map(doc => ({
    document_id: doc.id,
    title: doc.title,
    category: doc.category,
    tags: doc.tags,
    uploaded_at: doc.uploaded_at,
    recommendation_score: 0.8,
    reason: 'Recent upload',
  }));
}

/**
 * Helper: Get similar documents to recently viewed
 */
async function getSimilarToRecentlyViewed(limit: number, categories?: string[], userId?: string): Promise<any[]> {
  // This would typically use a user activity table
  // For now, return recent documents as a fallback
  return await getPopularDocuments(limit, categories, userId);
}

/**
 * Helper: Get personalized recommendations
 */
async function getPersonalizedRecommendations(limit: number, categories?: string[], userId?: string): Promise<any[]> {
  // This would analyze user's document preferences and search history
  // For now, return category-based recommendations
  return await getPopularDocuments(limit, categories, userId);
}