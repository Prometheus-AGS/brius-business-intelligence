import { Response } from 'express';
import { mcpLogger } from '../../observability/logger.js';

/**
 * Server-Sent Events (SSE) Streaming Utilities
 * Provides utilities for streaming OpenAI-compatible responses
 */

export interface SSEStream {
  write(data: any): void;
  end(): void;
  isConnected(): boolean;
}

/**
 * Creates a Server-Sent Events stream for OpenAI-compatible streaming responses
 */
export function createSSEStream(res: Response): SSEStream {
  let isConnected = true;

  // Handle client disconnect
  res.on('close', () => {
    isConnected = false;
    mcpLogger.debug('SSE client disconnected');
  });

  res.on('error', (error) => {
    isConnected = false;
    mcpLogger.error('SSE stream error', error);
  });

  return {
    write(data: any): void {
      if (!isConnected || res.headersSent === false) {
        return;
      }

      try {
        const sseData = `data: ${JSON.stringify(data)}\n\n`;
        res.write(sseData);
      } catch (error) {
        mcpLogger.error('Failed to write SSE data', error instanceof Error ? error : new Error(String(error)));
        isConnected = false;
      }
    },

    end(): void {
      if (!isConnected) {
        return;
      }

      try {
        res.write('data: [DONE]\n\n');
        res.end();
        isConnected = false;
      } catch (error) {
        mcpLogger.error('Failed to end SSE stream', error instanceof Error ? error : new Error(String(error)));
      }
    },

    isConnected(): boolean {
      return isConnected;
    },
  };
}

/**
 * Utility for streaming text content word by word
 */
export async function streamTextContent(
  stream: SSEStream,
  content: string,
  options: {
    requestId: string;
    model: string;
    chunkSize?: number;
    delayMs?: number;
    onChunk?: (chunk: string, index: number) => void;
  }
): Promise<void> {
  const { requestId, model, chunkSize = 50, delayMs = 30, onChunk } = options;

  if (!stream.isConnected()) {
    return;
  }

  const chunks = splitIntoChunks(content, chunkSize);

  for (let i = 0; i < chunks.length; i++) {
    if (!stream.isConnected()) {
      mcpLogger.debug('Stream disconnected during content streaming');
      break;
    }

    const chunk = chunks[i];

    const streamChunk = {
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

    stream.write(streamChunk);

    // Call optional chunk callback
    onChunk?.(chunk, i);

    // Add delay between chunks for realistic streaming experience
    if (i < chunks.length - 1 && delayMs > 0) {
      await delay(delayMs);
    }
  }
}

/**
 * Stream structured data (like analysis results) with formatting
 */
export async function streamStructuredContent(
  stream: SSEStream,
  sections: Array<{
    title: string;
    content: string;
    priority?: 'high' | 'medium' | 'low';
  }>,
  options: {
    requestId: string;
    model: string;
    sectionDelayMs?: number;
    chunkDelayMs?: number;
  }
): Promise<void> {
  const { requestId, model, sectionDelayMs = 100, chunkDelayMs = 20 } = options;

  for (const section of sections) {
    if (!stream.isConnected()) {
      break;
    }

    // Stream section title
    const titleContent = `\n## ${section.title}\n\n`;
    await streamTextContent(stream, titleContent, {
      requestId,
      model,
      chunkSize: titleContent.length, // Send title as one chunk
      delayMs: 0,
    });

    // Add delay before section content
    if (sectionDelayMs > 0) {
      await delay(sectionDelayMs);
    }

    // Stream section content
    await streamTextContent(stream, section.content, {
      requestId,
      model,
      chunkSize: 50,
      delayMs: chunkDelayMs,
    });

    // Add separator between sections
    if (sections.indexOf(section) < sections.length - 1) {
      await streamTextContent(stream, '\n\n---\n\n', {
        requestId,
        model,
        chunkSize: 50,
        delayMs: 0,
      });
    }
  }
}

/**
 * Create a streaming response for business intelligence analysis
 */
export async function streamBusinessAnalysis(
  stream: SSEStream,
  analysis: {
    summary: string;
    findings: string[];
    recommendations: string[];
    confidence: number;
    methodology?: string;
  },
  options: {
    requestId: string;
    model: string;
  }
): Promise<void> {
  const { requestId, model } = options;

  const sections = [
    {
      title: 'Executive Summary',
      content: analysis.summary,
      priority: 'high' as const,
    },
    {
      title: 'Key Findings',
      content: analysis.findings.map((finding, i) => `${i + 1}. ${finding}`).join('\n\n'),
      priority: 'high' as const,
    },
    {
      title: 'Recommendations',
      content: analysis.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join('\n\n'),
      priority: 'medium' as const,
    },
  ];

  // Add methodology if provided
  if (analysis.methodology) {
    sections.push({
      title: 'Methodology',
      content: analysis.methodology,
      priority: 'low' as const,
    });
  }

  // Add confidence score
  sections.push({
    title: 'Analysis Confidence',
    content: `This analysis has a confidence score of ${(analysis.confidence * 100).toFixed(1)}% based on data quality, methodology robustness, and contextual factors.`,
    priority: 'low' as const,
  });

  await streamStructuredContent(stream, sections, {
    requestId,
    model,
    sectionDelayMs: 150,
    chunkDelayMs: 25,
  });
}

/**
 * Handle streaming errors gracefully
 */
export function handleStreamingError(
  stream: SSEStream,
  error: Error,
  options: {
    requestId: string;
    model: string;
    includeErrorDetails?: boolean;
  }
): void {
  const { requestId, model, includeErrorDetails = false } = options;

  if (!stream.isConnected()) {
    return;
  }

  try {
    // Send error message to client
    const errorMessage = includeErrorDetails
      ? `I encountered an error while processing your request: ${error.message}`
      : 'I encountered an error while processing your request. Please try again.';

    const errorChunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: { content: `\n\n❌ ${errorMessage}` },
          finish_reason: 'stop',
        },
      ],
    };

    stream.write(errorChunk);
    stream.end();

  } catch (streamError) {
    mcpLogger.error('Failed to send error through stream', streamError instanceof Error ? streamError : new Error(String(streamError)));
  }
}

/**
 * Utility functions
 */

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a heartbeat mechanism for long-running streams
 */
export function createStreamHeartbeat(
  stream: SSEStream,
  intervalMs: number = 30000
): () => void {
  const interval = setInterval(() => {
    if (!stream.isConnected()) {
      clearInterval(interval);
      return;
    }

    // Send a heartbeat comment (ignored by clients)
    try {
      if (stream.isConnected()) {
        // Comments in SSE are ignored by clients but keep connection alive
        const heartbeat = `: heartbeat ${Date.now()}\n\n`;
        (stream as any).res?.write?.(heartbeat);
      }
    } catch (error) {
      mcpLogger.debug('Heartbeat failed, stopping interval', error);
      clearInterval(interval);
    }
  }, intervalMs);

  // Return cleanup function
  return () => {
    clearInterval(interval);
  };
}

/**
 * Monitor stream health and performance
 */
export class StreamMonitor {
  private startTime: number;
  private chunkCount: number = 0;
  private totalBytes: number = 0;

  constructor(private requestId: string) {
    this.startTime = Date.now();
  }

  recordChunk(data: any): void {
    this.chunkCount++;
    this.totalBytes += JSON.stringify(data).length;
  }

  getMetrics() {
    return {
      request_id: this.requestId,
      duration_ms: Date.now() - this.startTime,
      chunk_count: this.chunkCount,
      total_bytes: this.totalBytes,
      avg_chunk_size: this.chunkCount > 0 ? this.totalBytes / this.chunkCount : 0,
    };
  }

  logFinalMetrics(): void {
    const metrics = this.getMetrics();
    mcpLogger.info('Stream completion metrics', metrics);
  }
}