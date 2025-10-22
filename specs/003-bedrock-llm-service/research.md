# Research: Centralized Bedrock LLM Service

**Date**: 2025-01-20
**Phase**: 0 - Technical Research
**Spec**: [003-bedrock-llm-service](./spec.md)

## Technical Context Analysis

### Language/Version
**TypeScript 5.3+** with ES2022 target (confirmed from existing codebase `tsconfig.json`)

### Primary Dependencies
**Core Framework**: Mastra v0.1.x (validated via existing `src/mastra/index.ts`)
**AWS SDK**: `@aws-sdk/client-bedrock-runtime` v3.x for model invocation
**Observability**: Langfuse v4.x with OpenTelemetry integration
**Database**: PostgreSQL with pgvector extension (existing consolidated pattern)
**Validation**: Zod v3.x (established pattern throughout codebase)

### Storage
**Database**: PostgreSQL with pgvector extension via existing consolidated database service
**Vector Operations**: Existing `src/mastra/database/vector-ops.ts` provides pgvector functions
**Memory Storage**: Existing `src/mastra/config/consolidated-database.ts` provides memory store access

### Testing
**Test Framework**: Vitest (established pattern - needs setup for Bedrock service)
**Mock Strategy**: Mock AWS SDK calls and Langfuse tracing for unit tests

### Target Platform
**Runtime**: Node.js 20.9.0+ (confirmed from existing environment)
**Deployment**: Server-side TypeScript service integrated with existing Mastra application

### Project Type
**Architecture**: Single project with feature-based clean architecture (following existing patterns)

### Performance Goals
**Response Time**: <500ms for Claude 4 Sonnet text generation (typical Bedrock latency)
**Embedding Time**: <200ms for Titan v2 embeddings (1024 dimensions)
**Throughput**: Support concurrent requests with connection pooling

### Constraints
**AWS Rate Limits**: Implement circuit breaker for Bedrock API rate limiting
**Memory Usage**: <100MB additional footprint for service instances
**Vector Dimensions**: 1024 for Titan v2 (existing code expects 1536 - needs update)

### Scale/Scope
**Model Support**: 2 models (Claude 4 Sonnet, Titan v2 Embeddings)
**Configuration**: Centralized service with per-request parameter overrides
**Monitoring**: 100% operation coverage with Langfuse tracing

## Key Research Findings

### 1. AWS Bedrock Integration Patterns

**Model IDs Validated**:
- Claude 4 Sonnet: `anthropic.claude-sonnet-4-20250514-v1:0`
- Titan v2 Embeddings: `amazon.titan-embed-text-v2:0`

**SDK Pattern**:
```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: 'us-east-1' });
const command = new InvokeModelCommand({
  modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
  body: JSON.stringify({ /* model-specific payload */ }),
  contentType: 'application/json',
  accept: 'application/json'
});
```

### 2. Langfuse Monitoring Integration

**Requirements Validated**:
- Langfuse v4.x requires OpenTelemetry setup with `LangfuseSpanProcessor`
- Existing telemetry infrastructure in `.mastra/output/instrumentation.mjs` supports additional span processors
- Tracing pattern: Wrap all LLM operations with OpenTelemetry spans for automatic Langfuse integration

**Integration Pattern**:
```typescript
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { trace } from '@opentelemetry/api';

// Leverage existing OpenTelemetry setup in .mastra/output/instrumentation.mjs
const tracer = trace.getTracer('bedrock-llm-service');
```

### 3. Vector Dimension Compatibility Issue

**CRITICAL FINDING**: Existing vector operations service expects 1536 dimensions (OpenAI embeddings), but Titan v2 supports 256, 512, or 1024 dimensions.

**Resolution Strategy**:
- Update `src/mastra/database/vector-ops.ts` to support configurable dimensions
- Use 1024 dimensions for Titan v2 (optimal balance of performance and quality)
- Maintain backward compatibility with existing 1536-dimension data

### 4. Mastra Framework Integration

**Validated Patterns**:
- Centralized service registration in `src/mastra/index.ts`
- Tool creation using `createTool` from `@mastra/core/tools`
- Agent integration through existing consolidated database patterns
- Memory operations via existing `getMemoryStore()` function

### 5. Circuit Breaker Requirements

**AWS Bedrock Rate Limits**:
- Text generation: ~20 requests/second (varies by model)
- Embeddings: ~100 requests/second
- Token limits: 200K input tokens for Claude 4 Sonnet

**Implementation Strategy**:
- Exponential backoff with jitter for rate limit errors
- Circuit breaker pattern with health checks
- Connection pooling for optimal resource usage

### 6. Configuration Management

**Environment Variables Required**:
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
LANGFUSE_PUBLIC_KEY=<key>
LANGFUSE_SECRET_KEY=<secret>
LANGFUSE_BASEURL=<url>
```

**Configuration Structure**:
```typescript
interface BedrockConfig {
  region: string;
  claudeConfig: {
    modelId: string;
    defaultTemperature: number;
    defaultMaxTokens: number;
  };
  titanConfig: {
    modelId: string;
    dimensions: 1024;
    normalize: boolean;
  };
  circuitBreaker: {
    failureThreshold: number;
    recoveryTimeout: number;
  };
}
```

## Technology Decisions

### Model Configuration Service
- **Decision**: Centralized `BedrockLLMService` class with singleton pattern
- **Rationale**: Follows existing consolidated database pattern, enables connection reuse

### Error Handling Strategy
- **Decision**: Circuit breaker with exponential backoff
- **Rationale**: AWS Bedrock requires resilient retry logic for production use

### Monitoring Integration
- **Decision**: Leverage existing OpenTelemetry infrastructure with Langfuse spans
- **Rationale**: Minimal changes to existing telemetry setup, comprehensive coverage

### Vector Dimension Update
- **Decision**: Update vector operations to support configurable dimensions
- **Rationale**: Enable Titan v2 1024-dimension embeddings while maintaining compatibility

## Implementation Dependencies

### NPM Packages to Install
```bash
pnpm add @aws-sdk/client-bedrock-runtime
pnpm add @langfuse/otel
pnpm add exponential-backoff
```

### Database Schema Updates
- Update vector operations functions to support dimension parameter
- Maintain backward compatibility with existing 1536-dimension vectors

### Configuration Updates
- Add Bedrock configuration to environment variables
- Extend existing consolidated database config pattern

## Risks and Mitigations

### Risk: Vector Dimension Incompatibility
**Mitigation**: Gradual migration with dimension detection and fallback strategies

### Risk: AWS Rate Limiting
**Mitigation**: Circuit breaker implementation with intelligent retry logic

### Risk: Langfuse Monitoring Overhead
**Mitigation**: Async span processing with configurable sampling rates

### Risk: Model Version Changes
**Mitigation**: Configuration-driven model IDs with health check validation

## Next Steps for Phase 1

1. **Design data models** for Bedrock configurations and response types
2. **Create API contracts** for service interfaces and tool schemas
3. **Update vector operations** to support configurable dimensions
4. **Design circuit breaker** patterns and retry logic
5. **Create quickstart guide** for service integration

## References

- [AWS Bedrock Samples](https://github.com/aws-samples/amazon-bedrock-samples)
- [Langfuse TypeScript SDK](https://langfuse.com/docs/observability/sdk/typescript/setup)
- [Mastra Core Documentation](https://docs.mastra.ai/reference/core/)
- [Existing Consolidated Database Implementation](./src/mastra/config/consolidated-database.ts)