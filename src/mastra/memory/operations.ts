import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { memoryLogger } from '../observability/logger.js';
import { vectorStorage } from './storage.js';
import { generateSingleEmbedding } from './embeddings.js';
import { getDrizzleDb, getVectorStore, getConnectionPool } from '../config/consolidated-database.js';
import {
  userMemories,
  globalMemories,
  type UserMemory as UserMemoryRow,
  type GlobalMemory as GlobalMemoryRow,
} from '../database/schema.js';

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
  similarity_score: number;
  metadata?: Record<string, any>;
  created_at?: string;
  user_id?: string;
  category?: string | null;
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
  createdBy?: string;
  importance?: 'low' | 'medium' | 'high';
}

type StatisticSummary = {
  total_memories: number;
  categories: Record<string, number>;
  importance_levels: Record<string, number>;
  date_range: {
    oldest: string | null;
    newest: string | null;
  };
};

const connectionPool = getConnectionPool();

function mapUserMemory(row: UserMemoryRow) {
  return {
    id: row.id,
    user_id: row.userId,
    content: row.content,
    category: row.category,
    metadata: row.metadata ?? {},
    created_at: row.createdAt?.toISOString?.() ?? (row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString()),
    updated_at: row.updatedAt?.toISOString?.() ?? (row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()),
  };
}

function mapGlobalMemory(row: GlobalMemoryRow) {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    access_level: row.accessLevel,
    metadata: row.metadata ?? {},
    created_at: row.createdAt?.toISOString?.() ?? (row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString()),
    updated_at: row.updatedAt?.toISOString?.() ?? (row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()),
  };
}

export class UserMemoryOperations {
  private get db() {
    return getDrizzleDb();
  }

  /**
   * Stores user memory and its embedding using pgvector helpers.
   */
  async store(options: StoreMemoryOptions) {
    const { userId, content, metadata = {}, category, importance = 'medium' } = options;

    memoryLogger.info('Storing user memory', {
      user_id: userId,
      content_length: content.length,
      category,
      importance,
    });

    const normalizedMetadata = {
      ...metadata,
      importance,
      stored_at: new Date().toISOString(),
    };

    const memoryId = await vectorStorage.storeUserMemory(userId, content, {
      category,
      metadata: normalizedMetadata,
    });

    const [created] = await this.db
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, memoryId))
      .limit(1);

    if (!created) {
      throw new Error('Failed to retrieve stored user memory');
    }

    return mapUserMemory(created);
  }

  /**
   * Searches user memories using pgvector semantic search.
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

    const results = await vectorStorage.searchUserMemories(userId ?? '', query, {
      topK,
      similarityThreshold,
      category,
    });

    if (results.length === 0) {
      return [];
    }

    const ids = results.map(result => result.id);
    const rows = await this.db
      .select()
      .from(userMemories)
      .where(inArray(userMemories.id, ids));

    const rowMap = new Map(rows.map(row => [row.id, row]));

    return results.map(result => {
      const row = rowMap.get(result.id);
      return {
        id: result.id,
        content: row?.content ?? result.content,
        similarity_score: result.similarity,
        metadata: includeMetadata ? { ...(row?.metadata ?? {}), ...(result.metadata ?? {}) } : undefined,
        created_at: row ? mapUserMemory(row).created_at : undefined,
        user_id: row?.userId ?? userId,
        category: row?.category,
      };
    });
  }

  /**
   * Returns a paginated collection of user memories.
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
  ) {
    const {
      limit = 50,
      offset = 0,
      category,
      orderBy = 'created_at',
      ascending = false,
    } = options;

    const orderColumn = orderBy === 'created_at' ? userMemories.createdAt : userMemories.updatedAt;

    // Build where conditions
    const conditions = [eq(userMemories.userId, userId)];
    if (category) {
      conditions.push(eq(userMemories.category, category));
    }

    const query = this.db
      .select()
      .from(userMemories)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .offset(offset)
      .limit(limit)
      .orderBy(ascending ? asc(orderColumn) : desc(orderColumn));

    const rows = await query;
    return rows.map(mapUserMemory);
  }

  /**
   * Updates user memory content/metadata and regenerates embeddings when needed.
   */
  async update(
    memoryId: string,
    userId: string,
    updates: {
      content?: string;
      metadata?: Record<string, any>;
    }
  ) {
    const existingRows = await this.db
      .select()
      .from(userMemories)
      .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, userId)))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new Error('User memory not found or access denied');
    }

    const updatedMetadata = updates.metadata
      ? { ...(existing.metadata ?? {}), ...updates.metadata }
      : existing.metadata;

    const contentToUse = updates.content ?? existing.content;
    const embedding = await generateSingleEmbedding(contentToUse);
    const embeddingString = `[${embedding.join(',')}]`;

    await connectionPool.query(
      `
        UPDATE user_memories
        SET content = $1,
            embedding = $2::vector,
            metadata = $3::jsonb,
            updated_at = NOW()
        WHERE id = $4 AND user_id = $5
      `,
      [contentToUse, embeddingString, JSON.stringify(updatedMetadata ?? {}), memoryId, userId]
    );

    const [updated] = await this.db
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, memoryId))
      .limit(1);

    if (!updated) {
      throw new Error('Failed to retrieve updated memory');
    }

    return mapUserMemory(updated);
  }

  /**
   * Deletes user memory entry.
   */
  async delete(memoryId: string, userId: string): Promise<void> {
    await connectionPool.query(
      `
        DELETE FROM user_memories
        WHERE id = $1 AND user_id = $2
      `,
      [memoryId, userId]
    );
  }

  /**
   * Aggregates statistics for user memories.
   */
  async getMemoryStats(userId: string): Promise<StatisticSummary> {
    const rows = await this.db
      .select({
        id: userMemories.id,
        metadata: userMemories.metadata,
        createdAt: userMemories.createdAt,
        category: userMemories.category,
      })
      .from(userMemories)
      .where(eq(userMemories.userId, userId));

    const categories: Record<string, number> = {};
    const importanceLevels: Record<string, number> = {};
    let oldest: string | null = null;
    let newest: string | null = null;

    for (const row of rows) {
      const category = row.category ?? 'general';
      categories[category] = (categories[category] ?? 0) + 1;

      const importance = ((row.metadata as Record<string, any>)?.importance as string) ?? 'medium';
      importanceLevels[importance] = (importanceLevels[importance] ?? 0) + 1;

      const createdAt = row.createdAt?.toISOString?.() ?? (row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString());
      if (!oldest || createdAt < oldest) oldest = createdAt;
      if (!newest || createdAt > newest) newest = createdAt;
    }

    return {
      total_memories: rows.length,
      categories,
      importance_levels: importanceLevels,
      date_range: {
        oldest,
        newest,
      },
    };
  }
}

export class GlobalMemoryOperations {
  private get db() {
    return getDrizzleDb();
  }

  async store(options: GlobalMemoryOptions) {
    const { content, metadata = {}, category, createdBy, importance = 'medium' } = options;

    const normalizedMetadata = {
      ...metadata,
      importance,
      created_by: createdBy,
      stored_at: new Date().toISOString(),
    };

    const memoryId = await vectorStorage.storeGlobalMemory(content, {
      category,
      metadata: normalizedMetadata,
      accessLevel: metadata.access_level ?? 'public',
      userId: createdBy,
    });

    const [created] = await this.db
      .select()
      .from(globalMemories)
      .where(eq(globalMemories.id, memoryId))
      .limit(1);

    if (!created) {
      throw new Error('Failed to retrieve stored global memory');
    }

    return mapGlobalMemory(created);
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const {
      query,
      topK = 5,
      similarityThreshold = 0.7,
      category,
      includeMetadata = true,
    } = options;

    const results = await vectorStorage.searchGlobalMemories(query, {
      topK,
      similarityThreshold,
      accessLevel: 'public',
    });

    if (results.length === 0) {
      return [];
    }

    const ids = results.map(result => result.id);
    const rows = await this.db
      .select()
      .from(globalMemories)
      .where(inArray(globalMemories.id, ids));

    const rowMap = new Map(rows.map(row => [row.id, row]));

    return results.map(result => {
      const row = rowMap.get(result.id);
      return {
        id: result.id,
        content: row?.content ?? result.content,
        similarity_score: result.similarity,
        metadata: includeMetadata ? { ...(row?.metadata ?? {}), ...(result.metadata ?? {}) } : undefined,
        created_at: row ? mapGlobalMemory(row).created_at : undefined,
        category: row?.category,
      };
    });
  }

  async getGlobalMemories(
    options: {
      limit?: number;
      offset?: number;
      category?: string;
      orderBy?: 'created_at' | 'updated_at';
      ascending?: boolean;
      accessLevel?: 'public' | 'restricted' | 'admin';
    } = {}
  ) {
    const {
      limit = 50,
      offset = 0,
      category,
      orderBy = 'created_at',
      ascending = false,
      accessLevel,
    } = options;

    const orderColumn = orderBy === 'created_at' ? globalMemories.createdAt : globalMemories.updatedAt;

    const conditions = [];
    if (category) {
      conditions.push(eq(globalMemories.category, category));
    }
    if (accessLevel) {
      conditions.push(
        accessLevel === 'public'
          ? eq(globalMemories.accessLevel, 'public')
          : eq(globalMemories.accessLevel, accessLevel)
      );
    }

    const query = this.db
      .select()
      .from(globalMemories)
      .where(conditions.length === 0 ? undefined : (conditions.length === 1 ? conditions[0] : and(...conditions)))
      .offset(offset)
      .limit(limit)
      .orderBy(ascending ? asc(orderColumn) : desc(orderColumn));

    const rows = await query;
    return rows.map(mapGlobalMemory);
  }

  async update(
    memoryId: string,
    updates: {
      content?: string;
      metadata?: Record<string, any>;
      category?: string;
      accessLevel?: 'public' | 'restricted' | 'admin';
    }
  ) {
    const existingRows = await this.db
      .select()
      .from(globalMemories)
      .where(eq(globalMemories.id, memoryId))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new Error('Global memory not found');
    }

    const contentToUse = updates.content ?? existing.content;
    const metadataToUse = updates.metadata ? { ...(existing.metadata ?? {}), ...updates.metadata } : existing.metadata;
    const categoryToUse = updates.category ?? existing.category;
    const accessLevelToUse = updates.accessLevel ?? existing.accessLevel;

    const embedding = await generateSingleEmbedding(contentToUse);
    const embeddingString = `[${embedding.join(',')}]`;

    await connectionPool.query(
      `
        UPDATE global_memories
        SET content = $1,
            embedding = $2::vector,
            metadata = $3::jsonb,
            category = $4,
            access_level = $5,
            updated_at = NOW()
        WHERE id = $6
      `,
      [
        contentToUse,
        embeddingString,
        JSON.stringify(metadataToUse ?? {}),
        categoryToUse,
        accessLevelToUse,
        memoryId,
      ]
    );

    const [updated] = await this.db
      .select()
      .from(globalMemories)
      .where(eq(globalMemories.id, memoryId))
      .limit(1);

    if (!updated) {
      throw new Error('Failed to retrieve updated global memory');
    }

    return mapGlobalMemory(updated);
  }

  async delete(memoryId: string): Promise<void> {
    await connectionPool.query(
      `DELETE FROM global_memories WHERE id = $1`,
      [memoryId]
    );
  }

  async getMemoryStats(): Promise<StatisticSummary> {
    const rows = await this.db
      .select({
        id: globalMemories.id,
        metadata: globalMemories.metadata,
        createdAt: globalMemories.createdAt,
        category: globalMemories.category,
      })
      .from(globalMemories);

    const categories: Record<string, number> = {};
    const importanceLevels: Record<string, number> = {};
    let oldest: string | null = null;
    let newest: string | null = null;

    for (const row of rows) {
      const category = row.category ?? 'general';
      categories[category] = (categories[category] ?? 0) + 1;

      const importance = ((row.metadata as Record<string, any>)?.importance as string) ?? 'medium';
      importanceLevels[importance] = (importanceLevels[importance] ?? 0) + 1;

      const createdAt = row.createdAt?.toISOString?.() ?? (row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString());
      if (!oldest || createdAt < oldest) oldest = createdAt;
      if (!newest || createdAt > newest) newest = createdAt;
    }

    return {
      total_memories: rows.length,
      categories,
      importance_levels: importanceLevels,
      date_range: {
        oldest,
        newest,
      },
    };
  }
}

export const userMemoryOps = new UserMemoryOperations();
export const globalMemoryOps = new GlobalMemoryOperations();
