import { createGateway } from 'ai';
import { env } from './environment.js';

// AWS Bedrock configuration
export const bedrockConfig = {
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  models: {
    // Claude 3.5 Sonnet v2 for text generation via Bedrock
    chat: env.BEDROCK_CLAUDE_MODEL_ID,
    // Amazon Titan Embed Text v2 for embeddings via Bedrock
    embedding: env.BEDROCK_TITAN_MODEL_ID,
  },
};

// Create AI Gateway instance (supports Bedrock routing)
export const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

// Get the chat model using AI Gateway with Bedrock
export const chatModel = gateway(bedrockConfig.models.chat);

// Langfuse configuration for observability
export const langfuseConfig = {
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_BASE_URL,
  enabled: !!(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
};

// Vector database configuration for RAG
export const vectorConfig = {
  dimensions: 1536, // Amazon Titan Embed Text v2 dimensions
  similarity: 'cosine' as const,
  indexType: 'ivfflat' as const,
};
