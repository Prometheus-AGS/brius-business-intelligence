import { z } from 'zod';

// Common API Response Types
export const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

// Health Check Types
export const HealthCheckResponseSchema = z.object({
  status: z.enum(['healthy', 'unhealthy', 'degraded']),
  timestamp: z.string().datetime(),
  version: z.string(),
  services: z.object({
    database: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      latency_ms: z.number().nonnegative().optional(),
      error: z.string().optional(),
    }),
    mcp_client: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      connected_servers: z.number().int().nonnegative(),
      error: z.string().optional(),
    }),
    embeddings: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      provider: z.string(),
      error: z.string().optional(),
    }),
    observability: z.object({
      status: z.enum(['healthy', 'unhealthy']),
      provider: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
  uptime_ms: z.number().int().nonnegative(),
});

// OpenAI API Compatibility Types
export const OpenAIModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number().int().nonnegative(),
  owned_by: z.string(),
});

export const OpenAIModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(OpenAIModelSchema),
});

export const OpenAIEmbeddingRequestSchema = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string(),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().optional(),
  user: z.string().optional(),
});

export const OpenAIEmbeddingSchema = z.object({
  object: z.literal('embedding'),
  embedding: z.array(z.number()),
  index: z.number().int().nonnegative(),
});

export const OpenAIEmbeddingUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export const OpenAIEmbeddingResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(OpenAIEmbeddingSchema),
  model: z.string(),
  usage: OpenAIEmbeddingUsageSchema,
});

// Pagination Types
export const PaginationRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
  cursor: z.string().optional(),
});

export const PaginationResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  has_more: z.boolean(),
  next_cursor: z.string().optional(),
});

// Authentication Types
export const JWTPayloadSchema = z.object({
  sub: z.string(), // user ID
  aud: z.string(), // audience (Supabase project ID)
  exp: z.number().int().positive(), // expiration timestamp
  iat: z.number().int().positive(), // issued at timestamp
  email: z.string().email().optional(),
  role: z.string().optional(),
  app_metadata: z.record(z.string(), z.unknown()).optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AuthContextSchema = z.object({
  user_id: z.string(),
  email: z.string().email().optional(),
  role: z.string().optional(),
  is_authenticated: z.boolean(),
  jwt_payload: JWTPayloadSchema.optional(),
});

// Request Context Types
export const RequestContextSchema = z.object({
  request_id: z.string().uuid(),
  user_agent: z.string().optional(),
  ip_address: z.string().optional(),
  timestamp: z.string().datetime(),
  auth: AuthContextSchema.optional(),
  session_id: z.string().optional(),
  conversation_id: z.string().optional(),
});

// API Rate Limiting Types
export const RateLimitInfoSchema = z.object({
  limit: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  reset: z.number().int().positive(), // Unix timestamp
  retry_after: z.number().int().nonnegative().optional(),
});

// Streaming Response Types
export const StreamingEventSchema = z.object({
  event: z.string(),
  data: z.string(),
  id: z.string().optional(),
  retry: z.number().int().positive().optional(),
});

// Webhook Types
export const WebhookEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime(),
  source: z.string(),
});

export const WebhookRequestSchema = z.object({
  events: z.array(WebhookEventSchema),
  signature: z.string(),
  timestamp: z.string().datetime(),
});

// TypeScript types inferred from schemas
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

export type OpenAIModel = z.infer<typeof OpenAIModelSchema>;
export type OpenAIModelsResponse = z.infer<typeof OpenAIModelsResponseSchema>;
export type OpenAIEmbeddingRequest = z.infer<typeof OpenAIEmbeddingRequestSchema>;
export type OpenAIEmbedding = z.infer<typeof OpenAIEmbeddingSchema>;
export type OpenAIEmbeddingUsage = z.infer<typeof OpenAIEmbeddingUsageSchema>;
export type OpenAIEmbeddingResponse = z.infer<typeof OpenAIEmbeddingResponseSchema>;

export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;

export type JWTPayload = z.infer<typeof JWTPayloadSchema>;
export type AuthContext = z.infer<typeof AuthContextSchema>;
export type RequestContext = z.infer<typeof RequestContextSchema>;

export type RateLimitInfo = z.infer<typeof RateLimitInfoSchema>;
export type StreamingEvent = z.infer<typeof StreamingEventSchema>;

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type WebhookRequest = z.infer<typeof WebhookRequestSchema>;