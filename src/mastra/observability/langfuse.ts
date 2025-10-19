import { Langfuse } from 'langfuse';
import { env, isLangFuseEnabled } from '../config/environment.js';

/**
 * LangFuse Observability Client
 * Provides AI-specific observability and tracing for agents, workflows, and tools
 */

let langfuseClient: Langfuse | null = null;

/**
 * Initializes LangFuse client if credentials are available
 */
export function initializeLangFuse(): Langfuse | null {
  if (!isLangFuseEnabled()) {
    console.log('LangFuse observability disabled - missing credentials');
    return null;
  }

  if (langfuseClient) {
    return langfuseClient;
  }

  try {
    langfuseClient = new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY!,
      secretKey: env.LANGFUSE_SECRET_KEY!,
      baseUrl: env.LANGFUSE_BASE_URL,
    });

    console.log('LangFuse observability initialized');
    return langfuseClient;
  } catch (error) {
    console.error('Failed to initialize LangFuse:', error);
    return null;
  }
}

/**
 * Gets the LangFuse client instance
 */
export function getLangFuseClient(): Langfuse | null {
  return langfuseClient || initializeLangFuse();
}

/**
 * Creates a new trace for a user session or workflow
 */
export function createTrace(
  name: string,
  options: {
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
    tags?: string[];
  } = {}
) {
  const client = getLangFuseClient();
  if (!client) return null;

  return client.trace({
    name,
    userId: options.userId,
    sessionId: options.sessionId,
    metadata: options.metadata,
    tags: options.tags,
  });
}

/**
 * Creates a generation span for LLM calls
 */
export function createGeneration(
  trace: any,
  name: string,
  options: {
    model?: string;
    input?: any;
    metadata?: Record<string, any>;
    startTime?: Date;
  } = {}
) {
  if (!trace) return null;

  return trace.generation({
    name,
    model: options.model,
    input: options.input,
    metadata: options.metadata,
    startTime: options.startTime,
  });
}

/**
 * Creates a span for tool execution or workflow steps
 */
export function createSpan(
  trace: any,
  name: string,
  options: {
    input?: any;
    metadata?: Record<string, any>;
    startTime?: Date;
  } = {}
) {
  if (!trace) return null;

  return trace.span({
    name,
    input: options.input,
    metadata: options.metadata,
    startTime: options.startTime,
  });
}

/**
 * Logs an event within a trace or span
 */
export function logEvent(
  parent: any,
  name: string,
  options: {
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
    input?: any;
    output?: any;
    metadata?: Record<string, any>;
  } = {}
) {
  if (!parent) return;

  parent.event({
    name,
    level: options.level || 'DEFAULT',
    input: options.input,
    output: options.output,
    metadata: options.metadata,
  });
}

/**
 * Ends a span or generation with output and metadata
 */
export function endSpan(
  span: any,
  options: {
    output?: any;
    metadata?: Record<string, any>;
    level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
    statusMessage?: string;
    endTime?: Date;
  } = {}
) {
  if (!span) return;

  span.end({
    output: options.output,
    metadata: options.metadata,
    level: options.level,
    statusMessage: options.statusMessage,
    endTime: options.endTime,
  });
}

/**
 * Records a score for a trace (user feedback, quality metrics)
 */
export function recordScore(
  traceId: string,
  name: string,
  value: number,
  options: {
    comment?: string;
    metadata?: Record<string, any>;
  } = {}
) {
  const client = getLangFuseClient();
  if (!client) return;

  client.score({
    traceId,
    name,
    value,
    comment: options.comment,
    metadata: options.metadata,
  });
}

/**
 * Helper class for workflow tracing
 */
export class WorkflowTracer {
  private trace: any;
  private spans: Map<string, any> = new Map();

  constructor(
    workflowName: string,
    workflowId: string,
    options: {
      userId?: string;
      sessionId?: string;
      input?: any;
      metadata?: Record<string, any>;
    } = {}
  ) {
    this.trace = createTrace(workflowName, {
      userId: options.userId,
      sessionId: options.sessionId,
      metadata: {
        workflowId,
        ...options.metadata,
      },
      tags: ['workflow'],
    });

    if (this.trace && options.input) {
      this.trace.update({ input: options.input });
    }
  }

  /**
   * Starts a new step in the workflow
   */
  startStep(
    stepId: string,
    stepName: string,
    options: {
      input?: any;
      metadata?: Record<string, any>;
    } = {}
  ): any {
    const span = createSpan(this.trace, stepName, {
      input: options.input,
      metadata: {
        stepId,
        ...options.metadata,
      },
      startTime: new Date(),
    });

    if (span) {
      this.spans.set(stepId, span);
    }

    return span;
  }

  /**
   * Ends a workflow step
   */
  endStep(
    stepId: string,
    options: {
      output?: any;
      metadata?: Record<string, any>;
      error?: string;
    } = {}
  ): void {
    const span = this.spans.get(stepId);
    if (span) {
      endSpan(span, {
        output: options.output,
        metadata: options.metadata,
        level: options.error ? 'ERROR' : 'DEFAULT',
        statusMessage: options.error,
        endTime: new Date(),
      });
      this.spans.delete(stepId);
    }
  }

  /**
   * Logs an event in the workflow
   */
  logEvent(
    name: string,
    options: {
      level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
      input?: any;
      output?: any;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    logEvent(this.trace, name, options);
  }

  /**
   * Ends the workflow trace
   */
  end(options: {
    output?: any;
    metadata?: Record<string, any>;
    error?: string;
  } = {}): void {
    if (this.trace) {
      this.trace.update({
        output: options.output,
        metadata: options.metadata,
        level: options.error ? 'ERROR' : 'DEFAULT',
        statusMessage: options.error,
      });
    }

    // End any remaining spans
    for (const [stepId, span] of this.spans.entries()) {
      endSpan(span, {
        level: 'WARNING',
        statusMessage: 'Workflow ended before step completion',
      });
    }
    this.spans.clear();
  }

  /**
   * Gets the trace ID for correlation
   */
  getTraceId(): string | null {
    return this.trace?.id || null;
  }
}

/**
 * Helper for agent tracing
 */
export class AgentTracer {
  private generation: any;
  private trace: any;

  constructor(
    agentName: string,
    options: {
      model?: string;
      userId?: string;
      sessionId?: string;
      input?: any;
      metadata?: Record<string, any>;
    } = {}
  ) {
    this.trace = createTrace(`Agent: ${agentName}`, {
      userId: options.userId,
      sessionId: options.sessionId,
      metadata: options.metadata,
      tags: ['agent', agentName],
    });

    this.generation = createGeneration(this.trace, agentName, {
      model: options.model,
      input: options.input,
      metadata: options.metadata,
      startTime: new Date(),
    });
  }

  /**
   * Updates the generation with partial output (streaming)
   */
  updateGeneration(options: {
    output?: any;
    metadata?: Record<string, any>;
  } = {}): void {
    if (this.generation) {
      this.generation.update({
        output: options.output,
        metadata: options.metadata,
      });
    }
  }

  /**
   * Ends the agent generation
   */
  end(options: {
    output?: any;
    usage?: Record<string, any>;
    metadata?: Record<string, any>;
    error?: string;
  } = {}): void {
    if (this.generation) {
      endSpan(this.generation, {
        output: options.output,
        metadata: {
          usage: options.usage,
          ...options.metadata,
        },
        level: options.error ? 'ERROR' : 'DEFAULT',
        statusMessage: options.error,
        endTime: new Date(),
      });
    }
  }

  /**
   * Gets the trace ID for correlation
   */
  getTraceId(): string | null {
    return this.trace?.id || null;
  }
}

/**
 * Gracefully shuts down LangFuse (flushes pending events)
 */
export async function shutdownLangFuse(): Promise<void> {
  if (langfuseClient) {
    try {
      await langfuseClient.shutdownAsync();
      console.log('LangFuse client shut down gracefully');
    } catch (error) {
      console.error('Error shutting down LangFuse:', error);
    }
  }
}