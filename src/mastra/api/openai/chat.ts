import { Request, Response } from 'express';
import { z } from 'zod';
import { executeOrchestrator } from '../../workflows/orchestrator.js';
import { OrchestratorInput } from '../../types/index.js';
import { mcpLogger } from '../../observability/logger.js';
import { createSSEStream } from './streaming.js';

/**
 * OpenAI-Compatible Chat Completions API
 * Provides OpenAI-compatible endpoint for business intelligence queries
 * Routes through orchestrator for intelligent agent selection
 */

// OpenAI API Schema Definitions
const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  name: z.string().optional(),
});

const ChatCompletionRequestSchema = z.object({
  model: z.string().default('business-intelligence'),
  messages: z.array(MessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().default(false),
  user: z.string().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.number()).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().positive().default(1),
});

type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// OpenAI Response Schemas
interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ChatCompletionStreamChoice {
  index: number;
  delta: {
    role?: 'assistant';
    content?: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

interface ChatCompletionStreamResponse {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionStreamChoice[];
}

/**
 * Main chat completions endpoint handler
 */
export async function handleChatCompletions(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validationResult = ChatCompletionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        error: {
          message: 'Invalid request format',
          type: 'invalid_request_error',
          param: validationResult.error.issues[0]?.path.join('.'),
          code: 'invalid_request',
        },
      });
      return;
    }

    const requestData = validationResult.data;
    const requestId = generateRequestId();

    mcpLogger.info('OpenAI API chat completion request', {
      request_id: requestId,
      model: requestData.model,
      message_count: requestData.messages.length,
      stream: requestData.stream,
      user: requestData.user,
    });

    // Extract user prompt from messages
    const userMessage = requestData.messages
      .filter(msg => msg.role === 'user')
      .pop();

    if (!userMessage) {
      res.status(400).json({
        error: {
          message: 'No user message found in conversation',
          type: 'invalid_request_error',
          code: 'missing_user_message',
        },
      });
      return;
    }

    // Prepare orchestrator input
    const orchestratorInput: OrchestratorInput = {
      prompt: userMessage.content,
      user_id: requestData.user || 'anonymous',
      conversation_id: requestId,
      context: {
        openai_request: true,
        model: requestData.model,
        temperature: requestData.temperature,
        max_tokens: requestData.max_tokens,
        messages: requestData.messages,
      },
    };

    if (requestData.stream) {
      // Handle streaming response
      await handleStreamingResponse(res, orchestratorInput, requestData, requestId);
    } else {
      // Handle non-streaming response
      await handleNonStreamingResponse(res, orchestratorInput, requestData, requestId);
    }

  } catch (error) {
    mcpLogger.error('Chat completion request failed', error instanceof Error ? error : new Error(String(error)));

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: 'Internal server error during chat completion',
          type: 'internal_server_error',
          code: 'internal_error',
        },
      });
    }
  }
}

/**
 * Handle non-streaming chat completion response
 */
async function handleNonStreamingResponse(
  res: Response,
  orchestratorInput: OrchestratorInput,
  requestData: ChatCompletionRequest,
  requestId: string
): Promise<void> {
  try {
    // Execute orchestrator
    const orchestratorResult = await executeOrchestrator(orchestratorInput, {
      traceId: requestId,
      userId: requestData.user,
    });

    // Extract response content from agent response
    const responseContent = extractResponseContent(orchestratorResult.agent_response);

    // Build OpenAI-compatible response
    const response: ChatCompletionResponse = {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestData.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: estimateTokens(orchestratorInput.prompt),
        completion_tokens: estimateTokens(responseContent),
        total_tokens: estimateTokens(orchestratorInput.prompt) + estimateTokens(responseContent),
      },
    };

    mcpLogger.info('Chat completion response generated', {
      request_id: requestId,
      selected_agent: orchestratorResult.selected_agent,
      response_length: responseContent.length,
      execution_path: orchestratorResult.execution_path,
    });

    res.json(response);

  } catch (error) {
    mcpLogger.error('Non-streaming response failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Handle streaming chat completion response
 */
async function handleStreamingResponse(
  res: Response,
  orchestratorInput: OrchestratorInput,
  requestData: ChatCompletionRequest,
  requestId: string
): Promise<void> {
  try {
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Create SSE stream
    const sseStream = createSSEStream(res);

    // Send initial chunk
    const initialChunk: ChatCompletionStreamResponse = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestData.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        },
      ],
    };

    sseStream.write(initialChunk);

    // Execute orchestrator (for now, we'll simulate streaming)
    const orchestratorResult = await executeOrchestrator(orchestratorInput, {
      traceId: requestId,
      userId: requestData.user,
    });

    const responseContent = extractResponseContent(orchestratorResult.agent_response);

    // Stream response in chunks
    await streamResponseContent(sseStream, responseContent, requestId, requestData.model);

    // Send final chunk
    const finalChunk: ChatCompletionStreamResponse = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestData.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    };

    sseStream.write(finalChunk);
    sseStream.end();

    mcpLogger.info('Streaming chat completion completed', {
      request_id: requestId,
      selected_agent: orchestratorResult.selected_agent,
      response_length: responseContent.length,
    });

  } catch (error) {
    mcpLogger.error('Streaming response failed', error instanceof Error ? error : new Error(String(error)));

    if (!res.headersSent) {
      throw error;
    }

    // Send error chunk if streaming already started
    const errorChunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestData.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'content_filter',
        },
      ],
    };

    const sseStream = createSSEStream(res);
    sseStream.write(errorChunk);
    sseStream.end();
  }
}

/**
 * Stream response content in chunks
 */
async function streamResponseContent(
  sseStream: any,
  content: string,
  requestId: string,
  model: string
): Promise<void> {
  const chunkSize = 50; // Characters per chunk
  const delay = 30; // Milliseconds between chunks

  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);

    const streamChunk: ChatCompletionStreamResponse = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: { content: chunk },
          finish_reason: null,
        },
      ],
    };

    sseStream.write(streamChunk);

    // Add small delay to simulate realistic streaming
    if (i + chunkSize < content.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Extract response content from orchestrator result
 */
function extractResponseContent(agentResponse: any): string {
  // Handle different response formats from agents
  if (typeof agentResponse === 'string') {
    return agentResponse;
  }

  if (agentResponse?.text) {
    return agentResponse.text;
  }

  if (agentResponse?.content) {
    return agentResponse.content;
  }

  if (agentResponse?.message?.content) {
    return agentResponse.message.content;
  }

  if (agentResponse?.choices?.[0]?.message?.content) {
    return agentResponse.choices[0].message.content;
  }

  // Fallback: stringify the response
  return JSON.stringify(agentResponse, null, 2);
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `chatcmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Health check for chat completions endpoint
 */
export async function healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  try {
    const startTime = Date.now();

    const testRequest: ChatCompletionRequest = {
      model: 'business-intelligence',
      messages: [
        { role: 'user', content: 'Health check test query' }
      ],
      stream: false,
      max_tokens: 50,
    };

    const orchestratorInput: OrchestratorInput = {
      prompt: 'Health check test query',
      user_id: 'health-check',
      conversation_id: 'health-check',
    };

    await executeOrchestrator(orchestratorInput);

    const latency = Date.now() - startTime;

    return {
      healthy: true,
      latency,
    };

  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get available models for OpenAI compatibility
 */
export function getAvailableModels() {
  return [
    {
      id: 'business-intelligence',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'brius-bi',
      permission: [],
      root: 'business-intelligence',
      parent: null,
    },
    {
      id: 'default-assistant',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'brius-bi',
      permission: [],
      root: 'default-assistant',
      parent: null,
    },
  ];
}