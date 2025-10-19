import { createGateway } from 'ai';

// AWS Bedrock configuration
export const bedrockConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  models: {
    // Claude 3.5 Sonnet v2 for text generation via Bedrock
    chat: process.env.BEDROCK_MODEL_ID || 'bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0',
    // Amazon Titan Embed Text v2 for embeddings via Bedrock
    embedding: process.env.BEDROCK_EMBEDDING_MODEL_ID || 'bedrock/amazon.titan-embed-text-v2:0',
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
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL || 'http://localhost:3000',
  enabled: !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY),
};

// Vector database configuration for RAG
export const vectorConfig = {
  dimensions: 1024, // Amazon Titan Embed Text v2 dimensions
  similarity: 'cosine' as const,
  indexType: 'ivfflat' as const,
};