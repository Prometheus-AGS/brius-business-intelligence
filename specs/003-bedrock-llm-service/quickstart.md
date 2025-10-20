# Quickstart: Centralized Bedrock LLM Service Implementation

**Date**: 2025-01-20
**Phase**: 1 - Implementation Guide
**Spec**: [003-bedrock-llm-service](./spec.md)
**Research**: [research.md](./research.md)
**Data Model**: [data-model.md](./data-model.md)
**Contracts**: [contracts/](./contracts/)

## Implementation Overview

This guide provides step-by-step instructions for implementing the centralized Bedrock LLM service following Mastra best practices and integrating with the existing consolidated database architecture.

## Prerequisites

### Required Environment Variables

Add these to your `.env` file:

```bash
# AWS Bedrock Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

# Langfuse Monitoring (if using external Langfuse)
LANGFUSE_PUBLIC_KEY=pk_your_public_key_here
LANGFUSE_SECRET_KEY=sk_your_secret_key_here
LANGFUSE_BASEURL=https://cloud.langfuse.com

# Bedrock Service Configuration
BEDROCK_DEFAULT_TEMPERATURE=0.7
BEDROCK_DEFAULT_MAX_TOKENS=4000
BEDROCK_TITAN_DIMENSIONS=1024
BEDROCK_CIRCUIT_BREAKER_THRESHOLD=5
```

### Install Dependencies

```bash
pnpm add @aws-sdk/client-bedrock-runtime
pnpm add @langfuse/otel
pnpm add exponential-backoff
```

## Implementation Steps

### Step 1: Create Type Definitions

Create `src/mastra/types/bedrock.ts`:

```typescript
// Export all Bedrock-related types
export * from './bedrock-config.js';
export * from './bedrock-requests.js';
export * from './bedrock-responses.js';
export * from './bedrock-errors.js';
export * from './bedrock-health.js';
```

Create the individual type files based on the [data-model.md](./data-model.md) specifications:

- `src/mastra/types/bedrock-config.ts` - Service configuration types
- `src/mastra/types/bedrock-requests.ts` - Request types for Claude and Titan
- `src/mastra/types/bedrock-responses.ts` - Response types
- `src/mastra/types/bedrock-errors.ts` - Error handling types
- `src/mastra/types/bedrock-health.ts` - Health check and metrics types

Update `src/mastra/types/index.ts`:

```typescript
// Add to existing exports
export * from './bedrock.js';
```

### Step 2: Update Vector Operations for Configurable Dimensions

Modify `src/mastra/database/vector-ops.ts` to support Titan v2's 1024 dimensions:

```typescript
// Update the dimension validation in existing methods
export class VectorOperationsService {
  private validateEmbedding(embedding: number[], expectedDimensions?: number): void {
    const dimensions = expectedDimensions || 1536; // Default to OpenAI compatibility
    if (embedding.length !== dimensions) {
      throw new Error(`Embedding must be ${dimensions} dimensions for compatibility`);
    }
  }

  // Add new method for flexible dimension storage
  async storeEmbeddingWithDimensions(
    embedding: number[],
    content: string,
    table: 'user_memories' | 'global_memories' | 'document_chunks',
    metadata: Record<string, any> = {},
    dimensions?: number
  ): Promise<string> {
    // Implementation that doesn't validate dimensions if not specified
    // This allows both 1536 (OpenAI) and 1024 (Titan v2) embeddings
  }
}
```

### Step 3: Create Bedrock Configuration Service

Create `src/mastra/config/bedrock-model.ts`:

```typescript
import type { BedrockLLMServiceConfig } from '../types/index.js';
import { DEFAULT_BEDROCK_CONFIG } from '../types/bedrock-config.js';

/**
 * Bedrock Model Configuration Service
 * Manages centralized configuration for Claude and Titan models
 */
export class BedrockModelConfig {
  private config: BedrockLLMServiceConfig;

  constructor(config?: Partial<BedrockLLMServiceConfig>) {
    this.config = {
      ...DEFAULT_BEDROCK_CONFIG,
      ...config,
      region: process.env.AWS_REGION || DEFAULT_BEDROCK_CONFIG.region,
      monitoring: {
        ...DEFAULT_BEDROCK_CONFIG.monitoring,
        langfuse: process.env.LANGFUSE_PUBLIC_KEY ? {
          publicKey: process.env.LANGFUSE_PUBLIC_KEY,
          secretKey: process.env.LANGFUSE_SECRET_KEY!,
          baseUrl: process.env.LANGFUSE_BASEURL || 'http://localhost:3000',
        } : undefined,
      },
    };
  }

  getConfig(): BedrockLLMServiceConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<BedrockLLMServiceConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getClaudeConfig() {
    return this.config.claude;
  }

  getTitanConfig() {
    return this.config.titan;
  }
}

let bedrockConfig: BedrockModelConfig;

export function getBedrockConfig(): BedrockModelConfig {
  if (!bedrockConfig) {
    bedrockConfig = new BedrockModelConfig();
  }
  return bedrockConfig;
}
```

### Step 4: Create Circuit Breaker Implementation

Create `src/mastra/services/circuit-breaker.ts`:

```typescript
import type { CircuitBreakerConfig } from '../types/index.js';
import { withErrorHandling } from '../observability/error-handling.js';

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime?: Date;
  private nextAttemptTime?: Date;

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    if (this.state === 'open') {
      if (this.nextAttemptTime && new Date() > this.nextAttemptTime) {
        this.state = 'half-open';
      } else {
        throw new Error(`Circuit breaker open for ${operationName}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
    this.nextAttemptTime = undefined;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeoutMs);
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
  }
}
```

### Step 5: Create Bedrock LLM Service

Create `src/mastra/services/bedrock-llm-service.ts`:

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  BedrockLLMServiceConfig,
  ClaudeTextGenerationRequest,
  ClaudeTextGenerationResponse,
  TitanEmbeddingRequest,
  TitanEmbeddingResponse,
  BedrockServiceHealth,
} from '../types/index.js';
import { getBedrockConfig } from '../config/bedrock-model.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { withErrorHandling } from '../observability/error-handling.js';
import { trace } from '@opentelemetry/api';

export class BedrockLLMService {
  private client: BedrockRuntimeClient;
  private config: BedrockLLMServiceConfig;
  private circuitBreaker: CircuitBreaker;
  private tracer = trace.getTracer('bedrock-llm-service');

  constructor(config?: Partial<BedrockLLMServiceConfig>) {
    this.config = getBedrockConfig().getConfig();
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.client = new BedrockRuntimeClient({
      region: this.config.region,
      credentials: this.config.credentials,
    });

    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker);
  }

  async generateText(request: ClaudeTextGenerationRequest): Promise<ClaudeTextGenerationResponse> {
    return await this.tracer.startActiveSpan('bedrock.claude.generateText', async (span) => {
      try {
        span.setAttributes({
          'bedrock.model': this.config.claude.modelId,
          'bedrock.temperature': request.temperature || this.config.claude.defaultTemperature,
          'bedrock.maxTokens': request.maxTokens || this.config.claude.defaultMaxTokens,
        });

        const result = await this.circuitBreaker.execute(async () => {
          const payload = {
            anthropic_version: 'bedrock-2023-05-31',
            messages: request.messages,
            system: request.system,
            max_tokens: request.maxTokens || this.config.claude.defaultMaxTokens,
            temperature: request.temperature || this.config.claude.defaultTemperature,
            top_p: request.topP || this.config.claude.defaultTopP,
            stop_sequences: request.stopSequences,
          };

          const command = new InvokeModelCommand({
            modelId: this.config.claude.modelId,
            body: JSON.stringify(payload),
            contentType: 'application/json',
            accept: 'application/json',
          });

          const startTime = Date.now();
          const response = await this.client.send(command);
          const processingTime = Date.now() - startTime;

          const responseBody = JSON.parse(new TextDecoder().decode(response.body));

          return {
            content: responseBody.content[0]?.text || '',
            usage: {
              inputTokens: responseBody.usage?.input_tokens || 0,
              outputTokens: responseBody.usage?.output_tokens || 0,
              totalTokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0),
            },
            model: this.config.claude.modelId,
            stopReason: responseBody.stop_reason || 'end_turn',
            processingTimeMs: processingTime,
            traceId: span.spanContext().traceId,
            metadata: request.metadata,
          } as ClaudeTextGenerationResponse;
        }, 'claude-text-generation');

        span.setStatus({ code: 'ok' });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 'error', message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async generateEmbedding(request: TitanEmbeddingRequest): Promise<TitanEmbeddingResponse> {
    return await this.tracer.startActiveSpan('bedrock.titan.generateEmbedding', async (span) => {
      try {
        span.setAttributes({
          'bedrock.model': this.config.titan.modelId,
          'bedrock.dimensions': request.dimensions || this.config.titan.dimensions,
          'bedrock.normalize': request.normalize ?? this.config.titan.normalize,
        });

        const result = await this.circuitBreaker.execute(async () => {
          const payload = {
            inputText: request.inputText,
            dimensions: request.dimensions || this.config.titan.dimensions,
            normalize: request.normalize ?? this.config.titan.normalize,
          };

          const command = new InvokeModelCommand({
            modelId: this.config.titan.modelId,
            body: JSON.stringify(payload),
            contentType: 'application/json',
            accept: 'application/json',
          });

          const startTime = Date.now();
          const response = await this.client.send(command);
          const processingTime = Date.now() - startTime;

          const responseBody = JSON.parse(new TextDecoder().decode(response.body));

          return {
            embedding: responseBody.embedding,
            dimensions: responseBody.embedding.length,
            normalized: request.normalize ?? this.config.titan.normalize,
            inputLength: request.inputText.length,
            model: this.config.titan.modelId,
            processingTimeMs: processingTime,
            traceId: span.spanContext().traceId,
            metadata: request.metadata,
          } as TitanEmbeddingResponse;
        }, 'titan-embedding-generation');

        span.setStatus({ code: 'ok' });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 'error', message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async getHealth(): Promise<BedrockServiceHealth> {
    // Implementation for health checks
    // Test connectivity to AWS Bedrock and model availability
  }

  async shutdown(): Promise<void> {
    // Graceful shutdown implementation
  }
}

// Singleton instance
let bedrockService: BedrockLLMService;

export function getBedrockService(): BedrockLLMService {
  if (!bedrockService) {
    bedrockService = new BedrockLLMService();
  }
  return bedrockService;
}
```

### Step 6: Create Mastra Tools

Create `src/mastra/tools/bedrock-tools.ts`:

```typescript
import { createTool } from '@mastra/core/tools';
import {
  ClaudeTextGenerationToolSchema,
  TitanEmbeddingToolSchema,
  BedrockHealthCheckToolSchema,
} from '../../specs/003-bedrock-llm-service/contracts/tool-schemas.js';
import { getBedrockService } from '../services/bedrock-llm-service.js';
import { getToolCallTracer } from '../observability/tool-tracer.js';

/**
 * Claude Text Generation Tool
 */
export const claudeGenerateTextTool = createTool({
  id: ClaudeTextGenerationToolSchema.id,
  description: 'Generate high-quality text using Claude 4 Sonnet model',
  inputSchema: ClaudeTextGenerationToolSchema.inputSchema,
  outputSchema: ClaudeTextGenerationToolSchema.outputSchema,
  execute: async ({ context, input }) => {
    const tracer = getToolCallTracer();
    return await tracer.traceToolExecution(
      {
        toolId: ClaudeTextGenerationToolSchema.id,
        toolName: 'Claude Text Generation',
        userId: context.userId,
        agentId: context.agentId,
        sessionId: context.sessionId,
        metadata: { tool_type: 'bedrock_claude' },
      },
      input,
      async () => {
        const service = getBedrockService();
        return await service.generateText(input);
      }
    );
  },
});

/**
 * Titan Embedding Generation Tool
 */
export const titanGenerateEmbeddingTool = createTool({
  id: TitanEmbeddingToolSchema.id,
  description: 'Generate high-quality embeddings using Titan v2 model',
  inputSchema: TitanEmbeddingToolSchema.inputSchema,
  outputSchema: TitanEmbeddingToolSchema.outputSchema,
  execute: async ({ context, input }) => {
    const tracer = getToolCallTracer();
    return await tracer.traceToolExecution(
      {
        toolId: TitanEmbeddingToolSchema.id,
        toolName: 'Titan Embedding Generation',
        userId: context.userId,
        agentId: context.agentId,
        sessionId: context.sessionId,
        metadata: { tool_type: 'bedrock_titan' },
      },
      input,
      async () => {
        const service = getBedrockService();
        return await service.generateEmbedding(input);
      }
    );
  },
});

/**
 * Bedrock Health Check Tool
 */
export const bedrockHealthCheckTool = createTool({
  id: BedrockHealthCheckToolSchema.id,
  description: 'Check the health and status of Bedrock services',
  inputSchema: BedrockHealthCheckToolSchema.inputSchema,
  outputSchema: BedrockHealthCheckToolSchema.outputSchema,
  execute: async ({ context, input }) => {
    const service = getBedrockService();
    const health = await service.getHealth();

    if (input.includeMetrics) {
      const metrics = await service.getMetrics();
      return { ...health, metrics };
    }

    return health;
  },
});

/**
 * All Bedrock tools for export
 */
export const bedrockTools = [
  claudeGenerateTextTool,
  titanGenerateEmbeddingTool,
  bedrockHealthCheckTool,
];
```

### Step 7: Update Mastra Registration

Update `src/mastra/index.ts` to register the new service and tools:

```typescript
import { Mastra } from '@mastra/core';
import { getPostgresStore, getVectorStore, getMemoryStore } from './config/consolidated-database.js';

// Import new Bedrock tools
import { bedrockTools } from './tools/bedrock-tools.js';

// Import existing tools and agents
import { businessIntelligenceAgent } from './agents/business-intelligence.js';
import { knowledgeSearchTools } from './tools/knowledge-search.js';
import { memoryTools } from './tools/memory-tools.js';

export const mastra = new Mastra({
  storage: getPostgresStore(),
  vectors: {
    primary: getVectorStore(),
  },
  agents: {
    businessIntelligenceAgent,
  },
  tools: {
    // Combine all tools
    ...Object.fromEntries(knowledgeSearchTools.map(tool => [tool.id, tool])),
    ...Object.fromEntries(memoryTools.map(tool => [tool.id, tool])),
    ...Object.fromEntries(bedrockTools.map(tool => [tool.id, tool])),
  },
  logger: createLogger({
    name: 'Brius Business Intelligence',
    level: 'info',
  }),
});
```

### Step 8: Update Business Intelligence Agent

Update `src/mastra/agents/business-intelligence.ts` to use the new Bedrock capabilities:

```typescript
import { Agent } from '@mastra/core';
import { getMemoryStore } from '../config/consolidated-database.js';
import { claudeGenerateTextTool, titanGenerateEmbeddingTool } from '../tools/bedrock-tools.js';

export const businessIntelligenceAgent = new Agent({
  name: 'Business Intelligence Agent',
  instructions: `You are an expert business intelligence analyst powered by Claude 4 Sonnet.

  You have access to:
  - Advanced text generation capabilities via Claude 4 Sonnet
  - High-quality embedding generation via Titan v2
  - Comprehensive knowledge base search
  - Semantic memory for context retention

  Use these capabilities to provide insightful business analysis, data interpretation,
  and strategic recommendations. Always cite your sources and explain your reasoning.`,

  model: {
    provider: 'openai',
    name: 'gpt-4o-mini',
    toolChoice: 'auto',
  },

  memory: getMemoryStore(),

  tools: {
    claudeGenerateText: claudeGenerateTextTool,
    titanGenerateEmbedding: titanGenerateEmbeddingTool,
    // ... existing tools
  },
});
```

## Testing Implementation

### Step 9: Create Integration Tests

Create `tests/bedrock-service.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBedrockService } from '../src/mastra/services/bedrock-llm-service.js';

describe('Bedrock LLM Service Integration', () => {
  let service: ReturnType<typeof getBedrockService>;

  beforeAll(async () => {
    service = getBedrockService();
  });

  afterAll(async () => {
    await service.shutdown();
  });

  it('should generate text with Claude 4 Sonnet', async () => {
    const response = await service.generateText({
      messages: [
        { role: 'user', content: 'Write a brief haiku about artificial intelligence.' }
      ],
    });

    expect(response.content).toBeTruthy();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.model).toBe('anthropic.claude-sonnet-4-20250514-v1:0');
  });

  it('should generate embeddings with Titan v2', async () => {
    const response = await service.generateEmbedding({
      inputText: 'This is a test sentence for embedding generation.',
    });

    expect(response.embedding).toHaveLength(1024);
    expect(response.dimensions).toBe(1024);
    expect(response.normalized).toBe(true);
  });

  it('should report healthy status', async () => {
    const health = await service.getHealth();
    expect(health.healthy).toBe(true);
    expect(health.components.claudeModel.status).toBe('healthy');
    expect(health.components.titanModel.status).toBe('healthy');
  });
});
```

### Step 10: Create Unit Tests

Create `tests/bedrock-tools.unit.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { claudeGenerateTextTool } from '../src/mastra/tools/bedrock-tools.js';

// Mock the service
vi.mock('../src/mastra/services/bedrock-llm-service.js', () => ({
  getBedrockService: () => ({
    generateText: vi.fn().mockResolvedValue({
      content: 'Mocked response',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      stopReason: 'end_turn',
      processingTimeMs: 100,
    }),
  }),
}));

describe('Bedrock Tools', () => {
  it('should execute Claude text generation tool', async () => {
    const result = await claudeGenerateTextTool.execute({
      context: { userId: 'test-user', agentId: 'test-agent' },
      input: {
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(result.content).toBe('Mocked response');
    expect(result.usage.totalTokens).toBe(30);
  });
});
```

### Step 11: Update Package Scripts

Update `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "vitest run tests/**/*.integration.*",
    "test:unit": "vitest run tests/**/*.unit.*",
    "test:watch": "vitest",
    "build": "tsc",
    "dev": "tsx src/mastra/index.ts",
    "start": "node dist/src/mastra/index.js"
  }
}
```

## Validation Checklist

Before completing the implementation, ensure:

- [ ] All types are exported from `src/mastra/types/index.ts`
- [ ] Vector operations support configurable dimensions (1024 for Titan v2)
- [ ] Circuit breaker is implemented with exponential backoff
- [ ] Langfuse tracing is integrated with existing instrumentation
- [ ] Service is registered in `src/mastra/index.ts`
- [ ] Tools are registered and available to agents
- [ ] Business intelligence agent has access to Bedrock capabilities
- [ ] Integration tests pass with real AWS credentials
- [ ] Unit tests pass with mocked dependencies
- [ ] Health checks validate all components
- [ ] Error handling follows existing patterns
- [ ] Configuration is loaded from environment variables
- [ ] All secrets are properly managed

## Production Deployment

### Environment Setup

Ensure production environment has:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<production-key>
AWS_SECRET_ACCESS_KEY=<production-secret>

# Langfuse Production
LANGFUSE_PUBLIC_KEY=<production-public-key>
LANGFUSE_SECRET_KEY=<production-secret-key>
LANGFUSE_BASEURL=https://your-langfuse-instance.com

# Bedrock Production Tuning
BEDROCK_CIRCUIT_BREAKER_THRESHOLD=3
BEDROCK_DEFAULT_TEMPERATURE=0.5
BEDROCK_TITAN_DIMENSIONS=1024
```

### Monitoring Setup

The service automatically integrates with:
- Existing Langfuse tracing infrastructure
- OpenTelemetry spans for operation monitoring
- Error tracking through existing error handling patterns
- Health checks for service status monitoring

### Scaling Considerations

- Circuit breaker prevents cascade failures during AWS rate limiting
- Connection pooling manages AWS SDK client instances efficiently
- Embedding operations can be batched for improved throughput
- Service supports horizontal scaling with shared configuration

## Next Steps

After implementation:

1. **Performance Testing**: Run load tests to validate performance characteristics
2. **Security Review**: Ensure AWS credentials and API keys are properly secured
3. **Documentation**: Update agent instructions to leverage new capabilities
4. **Monitoring Setup**: Configure alerts for service health and performance
5. **User Training**: Train users on new AI capabilities available through agents

## Support and Troubleshooting

### Common Issues

1. **AWS Permission Errors**: Ensure IAM user has `bedrock:InvokeModel` permission
2. **Rate Limiting**: Circuit breaker will handle this automatically
3. **Vector Dimension Mismatch**: Update vector operations to support 1024 dimensions
4. **Langfuse Connection Issues**: Check LANGFUSE_BASEURL and credentials
5. **Memory Usage**: Monitor service memory consumption under load

### Debug Configuration

For debugging, set these environment variables:

```bash
DEBUG=bedrock:*
LOG_LEVEL=debug
LANGFUSE_DEBUG=true
```

This will enable detailed logging for troubleshooting service issues.