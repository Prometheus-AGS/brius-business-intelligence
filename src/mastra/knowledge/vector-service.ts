import type { PgVector } from '@mastra/pg';
import { getConnectionPool } from '../config/consolidated-database.js';
import { knowledgeLogger } from '../observability/logger.js';

/**
 * Extended vector service that wraps PgVector and provides additional semantic search methods
 */
export class ExtendedVectorService {
  constructor(private vectorStore: PgVector) {}

  /**
   * Semantic search using vector similarity
   */
  async semanticSearch(
    embedding: number[],
    options: {
      searchTable: string;
      matchCount: number;
      matchThreshold: number;
    }
  ): Promise<Array<{ id: string; similarity: number; content: string; metadata?: any }>> {
    const pool = getConnectionPool();

    try {
      // Use pgvector's cosine similarity search
      const query = `
        SELECT
          id,
          content,
          1 - (embedding <=> $1::vector) as similarity,
          metadata
        FROM ${options.searchTable}
        WHERE 1 - (embedding <=> $1::vector) > $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `;

      const result = await pool.query(query, [
        JSON.stringify(embedding),
        options.matchThreshold,
        options.matchCount
      ]);

      return result.rows.map(row => ({
        id: row.id,
        similarity: parseFloat(row.similarity),
        content: row.content || '',
        metadata: row.metadata
      }));
    } catch (error) {
      knowledgeLogger.error('Semantic search failed', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Hybrid search combining semantic and keyword search
   */
  async hybridSearch(
    textQuery: string,
    embedding: number[],
    options: {
      searchTable: string;
      textWeight: number;
      vectorWeight: number;
      matchCount: number;
      matchThreshold?: number;
    }
  ): Promise<Array<{ id: string; similarity: number; content: string; metadata?: any; rank: number }>> {
    const pool = getConnectionPool();

    try {
      // Hybrid search combining text search and vector similarity
      const query = `
        WITH semantic_search AS (
          SELECT
            id,
            content,
            metadata,
            1 - (embedding <=> $1::vector) as vector_similarity
          FROM ${options.searchTable}
          WHERE 1 - (embedding <=> $1::vector) > $3
        ),
        text_search AS (
          SELECT
            id,
            content,
            metadata,
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', $2)) as text_similarity
          FROM ${options.searchTable}
          WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $2)
        )
        SELECT
          COALESCE(s.id, t.id) as id,
          COALESCE(s.content, t.content) as content,
          COALESCE(s.metadata, t.metadata) as metadata,
          (
            COALESCE(s.vector_similarity * $4, 0) +
            COALESCE(t.text_similarity * $5, 0)
          ) as combined_similarity
        FROM semantic_search s
        FULL OUTER JOIN text_search t ON s.id = t.id
        ORDER BY combined_similarity DESC
        LIMIT $6
      `;

      const result = await pool.query(query, [
        JSON.stringify(embedding),
        textQuery,
        options.matchThreshold || 0.3,
        options.vectorWeight,
        options.textWeight,
        options.matchCount
      ]);

      return result.rows.map((row, index) => ({
        id: row.id,
        similarity: parseFloat(row.combined_similarity),
        content: row.content || '',
        metadata: row.metadata,
        rank: parseFloat(row.combined_similarity)
      }));
    } catch (error) {
      knowledgeLogger.error('Hybrid search failed', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Pass through method for any existing PgVector methods
   */
  get originalVectorStore(): PgVector {
    return this.vectorStore;
  }
}