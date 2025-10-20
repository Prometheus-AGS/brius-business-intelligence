import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { env } from '../config/environment.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { EmbedRequest, EmbedResponse } from '../types/index.js';

/**
 * AWS Bedrock Titan v2 Embedding Service
 * Constitutional requirement: Generates 1536-dimensional embeddings for pgvector compatibility
 */

let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Initializes AWS Bedrock client for pgvector compatibility
 */
function initializeBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return bedrockClient;
}

/**
 * Generates embeddings for text using AWS Bedrock Titan v2 (pgvector compatible)
 */
export async function generateEmbeddings(
  request: EmbedRequest
): Promise<EmbedResponse> {
  return await withErrorHandling(
    async () => {
      const client = initializeBedrockClient();

      // Convert single string to array for consistent processing
      const texts = Array.isArray(request.text) ? request.text : [request.text];

      if (texts.length === 0) {
        throw new Error('No text provided for embedding generation');
      }

      // Validate text lengths (Titan v2 has limits)
      for (const text of texts) {
        if (text.length > 8000) {
          throw new Error(`Text too long: ${text.length} characters (max 8000)`);
        }
      }

      // Process texts in batches to avoid API limits
      const batchSize = 25; // Titan v2 batch limit
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchEmbeddings = await processBatch(client, batch, request.normalize);
        allEmbeddings.push(...batchEmbeddings);
      }

      return {
        embeddings: allEmbeddings,
        model: env.BEDROCK_TITAN_MODEL_ID as 'amazon.titan-embed-text-v2',
      };
    },
    {
      component: 'embeddings',
      operation: 'generate_embeddings',
      metadata: {
        textCount: Array.isArray(request.text) ? request.text.length : 1,
        normalize: request.normalize,
      },
    },
    'medium'
  );
}

/**
 * Processes a batch of texts for embedding (pgvector compatible - 1536 dimensions)
 */
async function processBatch(
  client: BedrockRuntimeClient,
  texts: string[],
  normalize: boolean = true
): Promise<number[][]> {
  const requestPayload = {
    inputText: texts.length === 1 ? texts[0] : texts,
    dimensions: 1536, // Constitutional requirement: pgvector compatibility
    normalize: normalize,
  };

  const command = new InvokeModelCommand({
    modelId: env.BEDROCK_TITAN_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestPayload),
  });

  try {
    const response = await client.send(command);

    if (!response.body) {
      throw new Error('Empty response from Bedrock');
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Handle different response formats
    if (responseBody.embedding) {
      // Single text response
      const embedding = responseBody.embedding;

      // Validate pgvector compatibility
      if (embedding.length !== 1536) {
        throw new Error(`Invalid embedding dimension: ${embedding.length} (expected 1536 for pgvector)`);
      }

      return [embedding];
    } else if (responseBody.embeddings) {
      // Batch response
      const embeddings = responseBody.embeddings;

      // Validate all embeddings
      for (const embedding of embeddings) {
        if (embedding.length !== 1536) {
          throw new Error(`Invalid embedding dimension: ${embedding.length} (expected 1536 for pgvector)`);
        }
      }

      return embeddings;
    } else {
      throw new Error('Unexpected response format from Bedrock');
    }
  } catch (error) {
    console.error('Bedrock API error:', error);
    throw error;
  }
}

/**
 * Generates embedding for a single text (pgvector compatible)
 */
export async function generateSingleEmbedding(
  text: string,
  normalize: boolean = true
): Promise<number[]> {
  return await withErrorHandling(
    async () => {
      const response = await generateEmbeddings({
        text,
        normalize,
      });

      const embedding = response.embeddings[0];

      // Final validation for pgvector compatibility
      if (embedding.length !== 1536) {
        throw new Error(`Invalid embedding dimension: ${embedding.length} (expected 1536 for pgvector)`);
      }

      return embedding;
    },
    {
      component: 'embeddings',
      operation: 'generate_single_embedding',
      metadata: {
        textLength: text.length,
        normalize,
      },
    },
    'medium'
  );
}

/**
 * Calculates cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Validates that an embedding has the correct dimensions for pgvector
 */
export function validateEmbedding(embedding: number[]): boolean {
  return Array.isArray(embedding) && embedding.length === 1536;
}

/**
 * Normalizes an embedding vector
 */
export function normalizeEmbedding(embedding: number[]): number[] {
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return norm === 0 ? embedding : embedding.map(val => val / norm);
}

/**
 * Chunking helper for long texts
 */
export function chunkText(
  text: string,
  maxChunkSize: number = 6000,
  overlap: number = 200
): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    let chunk = text.slice(start, end);

    // Try to break at sentence boundary
    if (end < text.length) {
      const lastSentence = chunk.lastIndexOf('.');
      const lastNewline = chunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastSentence, lastNewline);

      if (breakPoint > start + maxChunkSize * 0.5) {
        chunk = text.slice(start, breakPoint + 1);
      }
    }

    chunks.push(chunk.trim());

    // Move start position with overlap
    start = Math.max(start + chunk.length - overlap, start + 1);
  }

  return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Health check for embedding service (pgvector compatible)
 */
export async function checkEmbeddingHealth(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  return await withErrorHandling(
    async () => {
      const startTime = Date.now();

      const testEmbedding = await generateSingleEmbedding('Health check test');

      // Validate pgvector compatibility
      if (!validateEmbedding(testEmbedding)) {
        throw new Error('Generated embedding is not pgvector compatible');
      }

      const latencyMs = Date.now() - startTime;

      return {
        healthy: true,
        latencyMs,
      };
    },
    {
      component: 'embeddings',
      operation: 'health_check',
    },
    'low'
  ).catch((error) => ({
    healthy: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }));
}
