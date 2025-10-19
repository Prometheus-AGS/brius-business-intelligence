import { z } from 'zod';

// Agent Message Types
export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export const ToolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string(),
});

// Chat Completion Types
export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(false),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.number()).optional(),
  user: z.string().optional(),
  tools: z.array(z.any()).optional(),
  tool_choice: z.union([z.literal('none'), z.literal('auto'), z.object({})]).optional(),
});

export const ChatCompletionChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  message: MessageSchema,
  finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
});

export const ChatCompletionUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: ChatCompletionUsageSchema.optional(),
  system_fingerprint: z.string().optional(),
});

// Streaming Types
export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      delta: z.object({
        role: MessageRoleSchema.optional(),
        content: z.string().optional(),
        tool_calls: z.array(ToolCallSchema).optional(),
      }),
      finish_reason: z.enum(['stop', 'length', 'function_call', 'tool_calls', 'content_filter']).nullable(),
    })
  ),
  system_fingerprint: z.string().optional(),
});

// Agent Configuration Types
export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  tools: z.array(z.string()).optional(),
  memory_enabled: z.boolean().default(true),
  knowledge_enabled: z.boolean().default(true),
});

// Intent Classification Types
export const IntentClassificationSchema = z.object({
  intent: z.enum(['simple', 'complex', 'analytical']),
  confidence: z.number().min(0).max(1),
  complexity_score: z.number().min(0).max(10),
  reasoning: z.string(),
  recommended_agent: z.string(),
  factors: z.object({
    keywords: z.number().min(0).max(10),
    entities: z.number().min(0).max(10),
    aggregation: z.number().min(0).max(10),
    temporal: z.number().min(0).max(10),
    output_complexity: z.number().min(0).max(10),
  }),
});

// Agent Context Types
export const AgentContextSchema = z.object({
  user_id: z.string().optional(),
  conversation_id: z.string().optional(),
  session_id: z.string().optional(),
  user_memories: z.array(z.any()).optional(),
  global_memories: z.array(z.any()).optional(),
  knowledge_context: z.array(z.any()).optional(),
  preferences: z.record(z.any()).optional(),
});

// TypeScript types inferred from schemas
export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolMessage = z.infer<typeof ToolMessageSchema>;

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;
export type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;
export type AgentContext = z.infer<typeof AgentContextSchema>;