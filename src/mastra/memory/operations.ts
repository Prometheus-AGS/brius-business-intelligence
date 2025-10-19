import { SupabaseClient } from '@supabase/supabase-js';
import { generateSingleEmbedding, cosineSimilarity } from './embeddings.js';
import { getSupabaseClient } from '../config/database.js';
import { UserMemory, GlobalMemory } from '../types/index.js';
import { memoryLogger } from '../observability/logger.js';

/**
 * User Memory Operations with Semantic Search
 * Implements user-scoped memory storage and retrieval using vector embeddings
 * Provides semantic search capabilities for contextual user information
 */

export interface MemorySearchOptions {
  userId?: string;
  query: string;
  topK?: number;
  similarityThreshold?: number;
  category?: string;
  includeMetadata?: boolean;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
  created_at: string;
  user_id?: string;
}

export interface StoreMemoryOptions {
  userId: string;
  content: string;
  metadata?: Record<string, any>;
  category?: string;
  importance?: 'low' | 'medium' | 'high';
}

export interface GlobalMemoryOptions {
  content: string;
  metadata?: Record<string, any>;
  category?: string;
  importance?: 'low' | 'medium' | 'high';
}

/**
 * User Memory Operations Class
 */
export class UserMemoryOperations {
  private client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseClient()) {
    this.client = client;
  }

  /**
   * Stores user memory with semantic embedding
   */
  async store(options: StoreMemoryOptions): Promise<UserMemory> {
    const { userId, content, metadata = {}, category, importance = 'medium' } = options;

    memoryLogger.info('Storing user memory', {
      user_id: userId,
      content_length: content.length,
      category,
      importance,
    });

    try {
      // Generate embedding for semantic search
      const embedding = await generateSingleEmbedding(content);

      // Prepare memory object
      const memoryData = {
        user_id: userId,
        content,
        embedding: JSON.stringify(embedding), // Store as JSON string for Supabase
        metadata: {
          ...metadata,
          category,
          importance,
          created_by: 'user',
        },
      };

      // Insert into database
      const { data, error } = await this.client
        .from('user_memories')
        .insert([memoryData])
        .select()
        .single();

      if (error) {
        memoryLogger.error('Failed to store user memory', error);
        throw new Error(`Failed to store user memory: ${error.message}`);
      }

      memoryLogger.info('User memory stored successfully', {
        user_id: userId,
        memory_id: data.id,
        content_length: content.length,
      });

      return data as UserMemory;

    } catch (error) {
      memoryLogger.error('User memory storage error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Searches user memories using semantic similarity
   */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const {
      userId,
      query,
      topK = 5,
      similarityThreshold = 0.7,
      category,
      includeMetadata = true,
    } = options;

    memoryLogger.info('Searching user memories', {
      user_id: userId,
      query_length: query.length,
      top_k: topK,
      similarity_threshold: similarityThreshold,
      category,
    });

    try {
      // Generate query embedding
      const queryEmbedding = await generateSingleEmbedding(query);

      // Build query
      let searchQuery = this.client
        .from('user_memories')
        .select('id, content, metadata, created_at, user_id, embedding');

      // Filter by user if specified
      if (userId) {
        searchQuery = searchQuery.eq('user_id', userId);
      }

      // Filter by category if specified
      if (category) {
        searchQuery = searchQuery.contains('metadata', { category });
      }

      // Execute query
      const { data: memories, error } = await searchQuery;

      if (error) {
        memoryLogger.error('Failed to search user memories', error);
        throw new Error(`Failed to search user memories: ${error.message}`);
      }

      if (!memories || memories.length === 0) {
        memoryLogger.info('No user memories found', { user_id: userId, query });
        return [];
      }

      // Calculate similarities and rank results
      const results: MemorySearchResult[] = [];

      for (const memory of memories) {
        try {
          const memoryEmbedding = JSON.parse(memory.embedding);
          const similarity = cosineSimilarity(queryEmbedding, memoryEmbedding);

          if (similarity >= similarityThreshold) {
            results.push({
              id: memory.id,
              content: memory.content,
              similarity,
              metadata: includeMetadata ? memory.metadata : undefined,
              created_at: memory.created_at,
              user_id: memory.user_id,
            });
          }
        } catch (embeddingError) {
          memoryLogger.warn('Failed to parse embedding for memory', {
            memory_id: memory.id,
            error: embeddingError,
          });
        }
      }

      // Sort by similarity and return top K
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, topK);

      memoryLogger.info('User memory search completed', {
        user_id: userId,
        query_length: query.length,
        results_found: topResults.length,
        avg_similarity: topResults.length > 0
          ? topResults.reduce((sum, r) => sum + r.similarity, 0) / topResults.length
          : 0,
      });

      return topResults;

    } catch (error) {
      memoryLogger.error('User memory search error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Retrieves all memories for a user
   */
  async getUserMemories(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      category?: string;
      orderBy?: 'created_at' | 'updated_at';
      ascending?: boolean;
    } = {}
  ): Promise<UserMemory[]> {
    const {
      limit = 50,
      offset = 0,
      category,
      orderBy = 'created_at',
      ascending = false,
    } = options;

    memoryLogger.info('Retrieving user memories', {
      user_id: userId,
      limit,
      offset,
      category,
      order_by: orderBy,
    });

    try {
      let query = this.client
        .from('user_memories')
        .select('*')
        .eq('user_id', userId);

      if (category) {
        query = query.contains('metadata', { category });
      }

      query = query
        .order(orderBy, { ascending })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        memoryLogger.error('Failed to retrieve user memories', error);
        throw new Error(`Failed to retrieve user memories: ${error.message}`);
      }

      memoryLogger.info('User memories retrieved', {
        user_id: userId,
        count: data?.length || 0,
      });

      return data as UserMemory[] || [];

    } catch (error) {
      memoryLogger.error('User memory retrieval error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Updates user memory content and re-generates embedding
   */
  async update(
    memoryId: string,
    userId: string,
    updates: {
      content?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<UserMemory> {
    memoryLogger.info('Updating user memory', {
      memory_id: memoryId,
      user_id: userId,
      has_content_update: Boolean(updates.content),
      has_metadata_update: Boolean(updates.metadata),
    });

    try {
      const updateData: any = {};

      // Update content and regenerate embedding if content changed
      if (updates.content) {
        updateData.content = updates.content;
        updateData.embedding = JSON.stringify(await generateSingleEmbedding(updates.content));
        updateData.updated_at = new Date().toISOString();
      }

      // Update metadata
      if (updates.metadata) {
        updateData.metadata = updates.metadata;
        updateData.updated_at = new Date().toISOString();
      }

      const { data, error } = await this.client
        .from('user_memories')
        .update(updateData)
        .eq('id', memoryId)
        .eq('user_id', userId) // Ensure user can only update their own memories
        .select()
        .single();

      if (error) {
        memoryLogger.error('Failed to update user memory', error);
        throw new Error(`Failed to update user memory: ${error.message}`);
      }

      memoryLogger.info('User memory updated successfully', {
        memory_id: memoryId,
        user_id: userId,
      });

      return data as UserMemory;

    } catch (error) {
      memoryLogger.error('User memory update error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Deletes user memory
   */
  async delete(memoryId: string, userId: string): Promise<void> {
    memoryLogger.info('Deleting user memory', {
      memory_id: memoryId,
      user_id: userId,
    });

    try {
      const { error } = await this.client
        .from('user_memories')
        .delete()
        .eq('id', memoryId)
        .eq('user_id', userId); // Ensure user can only delete their own memories

      if (error) {
        memoryLogger.error('Failed to delete user memory', error);
        throw new Error(`Failed to delete user memory: ${error.message}`);
      }

      memoryLogger.info('User memory deleted successfully', {
        memory_id: memoryId,
        user_id: userId,
      });

    } catch (error) {
      memoryLogger.error('User memory deletion error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Gets memory statistics for a user
   */
  async getMemoryStats(userId: string): Promise<{
    total_memories: number;
    categories: Record<string, number>;
    importance_levels: Record<string, number>;
    date_range: {
      oldest: string | null;
      newest: string | null;
    };
  }> {
    memoryLogger.info('Getting memory statistics', { user_id: userId });

    try {
      const { data, error } = await this.client
        .from('user_memories')
        .select('metadata, created_at')
        .eq('user_id', userId);

      if (error) {
        memoryLogger.error('Failed to get memory statistics', error);
        throw new Error(`Failed to get memory statistics: ${error.message}`);
      }

      const memories = data || [];
      const categories: Record<string, number> = {};
      const importanceLevels: Record<string, number> = {};

      let oldest: string | null = null;
      let newest: string | null = null;

      for (const memory of memories) {
        // Count categories
        const category = memory.metadata?.category || 'uncategorized';
        categories[category] = (categories[category] || 0) + 1;

        // Count importance levels
        const importance = memory.metadata?.importance || 'medium';
        importanceLevels[importance] = (importanceLevels[importance] || 0) + 1;

        // Track date range
        if (!oldest || memory.created_at < oldest) {
          oldest = memory.created_at;
        }
        if (!newest || memory.created_at > newest) {
          newest = memory.created_at;
        }
      }

      const stats = {
        total_memories: memories.length,
        categories,
        importance_levels: importanceLevels,
        date_range: {
          oldest,
          newest,
        },
      };

      memoryLogger.info('Memory statistics retrieved', {
        user_id: userId,
        stats,
      });

      return stats;

    } catch (error) {
      memoryLogger.error('Memory statistics error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

/**
 * Global Memory Operations Class
 */
export class GlobalMemoryOperations {
  private client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseClient()) {
    this.client = client;
  }

  /**
   * Stores global memory with semantic embedding
   */
  async store(options: GlobalMemoryOptions): Promise<GlobalMemory> {
    const { content, metadata = {}, category, importance = 'medium' } = options;

    memoryLogger.info('Storing global memory', {
      content_length: content.length,
      category,
      importance,
    });

    try {
      // Generate embedding for semantic search
      const embedding = await generateSingleEmbedding(content);

      // Prepare memory object
      const memoryData = {
        content,
        embedding: JSON.stringify(embedding),
        metadata: {
          ...metadata,
          category,
          importance,
          created_by: 'system',
        },
        category,
      };

      // Insert into database
      const { data, error } = await this.client
        .from('global_memories')
        .insert([memoryData])
        .select()
        .single();

      if (error) {
        memoryLogger.error('Failed to store global memory', error);
        throw new Error(`Failed to store global memory: ${error.message}`);
      }

      memoryLogger.info('Global memory stored successfully', {
        memory_id: data.id,
        content_length: content.length,
      });

      return data as GlobalMemory;

    } catch (error) {
      memoryLogger.error('Global memory storage error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Searches global memories using semantic similarity
   */
  async search(options: Omit<MemorySearchOptions, 'userId'>): Promise<MemorySearchResult[]> {
    const {
      query,
      topK = 5,
      similarityThreshold = 0.7,
      category,
      includeMetadata = true,
    } = options;

    memoryLogger.info('Searching global memories', {
      query_length: query.length,
      top_k: topK,
      similarity_threshold: similarityThreshold,
      category,
    });

    try {
      // Generate query embedding
      const queryEmbedding = await generateSingleEmbedding(query);

      // Build query
      let searchQuery = this.client
        .from('global_memories')
        .select('id, content, metadata, created_at, category, embedding');

      // Filter by category if specified
      if (category) {
        searchQuery = searchQuery.eq('category', category);
      }

      // Execute query
      const { data: memories, error } = await searchQuery;

      if (error) {
        memoryLogger.error('Failed to search global memories', error);
        throw new Error(`Failed to search global memories: ${error.message}`);
      }

      if (!memories || memories.length === 0) {
        memoryLogger.info('No global memories found', { query });
        return [];
      }

      // Calculate similarities and rank results
      const results: MemorySearchResult[] = [];

      for (const memory of memories) {
        try {
          const memoryEmbedding = JSON.parse(memory.embedding);
          const similarity = cosineSimilarity(queryEmbedding, memoryEmbedding);

          if (similarity >= similarityThreshold) {
            results.push({
              id: memory.id,
              content: memory.content,
              similarity,
              metadata: includeMetadata ? memory.metadata : undefined,
              created_at: memory.created_at,
            });
          }
        } catch (embeddingError) {
          memoryLogger.warn('Failed to parse embedding for global memory', {
            memory_id: memory.id,
            error: embeddingError,
          });
        }
      }

      // Sort by similarity and return top K
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, topK);

      memoryLogger.info('Global memory search completed', {
        query_length: query.length,
        results_found: topResults.length,
        avg_similarity: topResults.length > 0
          ? topResults.reduce((sum, r) => sum + r.similarity, 0) / topResults.length
          : 0,
      });

      return topResults;

    } catch (error) {
      memoryLogger.error('Global memory search error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Retrieves all global memories with pagination
   */
  async getGlobalMemories(
    options: {
      limit?: number;
      offset?: number;
      category?: string;
      orderBy?: 'created_at' | 'updated_at';
      ascending?: boolean;
    } = {}
  ): Promise<GlobalMemory[]> {
    const {
      limit = 50,
      offset = 0,
      category,
      orderBy = 'created_at',
      ascending = false,
    } = options;

    memoryLogger.info('Retrieving global memories', {
      limit,
      offset,
      category,
      order_by: orderBy,
    });

    try {
      let query = this.client
        .from('global_memories')
        .select('*');

      if (category) {
        query = query.eq('category', category);
      }

      query = query
        .order(orderBy, { ascending })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        memoryLogger.error('Failed to retrieve global memories', error);
        throw new Error(`Failed to retrieve global memories: ${error.message}`);
      }

      memoryLogger.info('Global memories retrieved', {
        count: data?.length || 0,
      });

      return data as GlobalMemory[] || [];

    } catch (error) {
      memoryLogger.error('Global memory retrieval error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Updates global memory content and re-generates embedding
   */
  async update(
    memoryId: string,
    updates: {
      content?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<GlobalMemory> {
    memoryLogger.info('Updating global memory', {
      memory_id: memoryId,
      has_content_update: Boolean(updates.content),
      has_metadata_update: Boolean(updates.metadata),
    });

    try {
      const updateData: any = {};

      // Update content and regenerate embedding if content changed
      if (updates.content) {
        updateData.content = updates.content;
        updateData.embedding = JSON.stringify(await generateSingleEmbedding(updates.content));
        updateData.updated_at = new Date().toISOString();
      }

      // Update metadata
      if (updates.metadata) {
        updateData.metadata = updates.metadata;
        updateData.updated_at = new Date().toISOString();
      }

      const { data, error } = await this.client
        .from('global_memories')
        .update(updateData)
        .eq('id', memoryId)
        .select()
        .single();

      if (error) {
        memoryLogger.error('Failed to update global memory', error);
        throw new Error(`Failed to update global memory: ${error.message}`);
      }

      memoryLogger.info('Global memory updated successfully', {
        memory_id: memoryId,
      });

      return data as GlobalMemory;

    } catch (error) {
      memoryLogger.error('Global memory update error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Deletes global memory
   */
  async delete(memoryId: string): Promise<void> {
    memoryLogger.info('Deleting global memory', {
      memory_id: memoryId,
    });

    try {
      const { error } = await this.client
        .from('global_memories')
        .delete()
        .eq('id', memoryId);

      if (error) {
        memoryLogger.error('Failed to delete global memory', error);
        throw new Error(`Failed to delete global memory: ${error.message}`);
      }

      memoryLogger.info('Global memory deleted successfully', {
        memory_id: memoryId,
      });

    } catch (error) {
      memoryLogger.error('Global memory deletion error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Gets global memory statistics
   */
  async getMemoryStats(): Promise<{
    total_memories: number;
    categories: Record<string, number>;
    importance_levels: Record<string, number>;
    date_range: {
      oldest: string | null;
      newest: string | null;
    };
  }> {
    memoryLogger.info('Getting global memory statistics');

    try {
      const { data, error } = await this.client
        .from('global_memories')
        .select('metadata, created_at, category');

      if (error) {
        memoryLogger.error('Failed to get global memory statistics', error);
        throw new Error(`Failed to get global memory statistics: ${error.message}`);
      }

      const memories = data || [];
      const categories: Record<string, number> = {};
      const importanceLevels: Record<string, number> = {};

      let oldest: string | null = null;
      let newest: string | null = null;

      for (const memory of memories) {
        // Count categories
        const category = memory.category || memory.metadata?.category || 'uncategorized';
        categories[category] = (categories[category] || 0) + 1;

        // Count importance levels
        const importance = memory.metadata?.importance || 'medium';
        importanceLevels[importance] = (importanceLevels[importance] || 0) + 1;

        // Track date range
        if (!oldest || memory.created_at < oldest) {
          oldest = memory.created_at;
        }
        if (!newest || memory.created_at > newest) {
          newest = memory.created_at;
        }
      }

      const stats = {
        total_memories: memories.length,
        categories,
        importance_levels: importanceLevels,
        date_range: {
          oldest,
          newest,
        },
      };

      memoryLogger.info('Global memory statistics retrieved', {
        stats,
      });

      return stats;

    } catch (error) {
      memoryLogger.error('Global memory statistics error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

// Export singleton instances
export const userMemoryOps = new UserMemoryOperations();
export const globalMemoryOps = new GlobalMemoryOperations();

// Classes are already exported above in their definitions