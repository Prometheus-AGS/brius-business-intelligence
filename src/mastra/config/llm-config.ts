import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { env } from './environment.js';

// AWS Bedrock configuration
export const bedrockConfig = {
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  models: {
    // Claude 4 Sonnet using cross-region inference with us. prefix
    chat: env.BEDROCK_CLAUDE_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    // Amazon Titan Embed Text v2 for embeddings via Bedrock
    embedding: env.BEDROCK_TITAN_MODEL_ID || 'amazon.titan-embed-text-v2:0',
  },
};

// Create Bedrock client with credentials
const bedrockClient = createAmazonBedrock({
  region: bedrockConfig.region,
  accessKeyId: bedrockConfig.accessKeyId,
  secretAccessKey: bedrockConfig.secretAccessKey,
});

// Get the chat model using Bedrock client directly
export const chatModel = bedrockClient('us.anthropic.claude-sonnet-4-20250514-v1:0');

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
