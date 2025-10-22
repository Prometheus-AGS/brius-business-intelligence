# Implementation Tasks: Centralized Bedrock LLM Service

**Branch**: `003-bedrock-llm-service` | **Date**: 2025-01-20 | **Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md) | **Quickstart**: [quickstart.md](./quickstart.md)

## Task Organization by User Story Priority

Tasks are organized by the 5 user stories from the specification, prioritized P1 (highest) to P3 (lowest). Each task includes acceptance criteria, validation steps, and considers Mastra's separate compilation phases.

---

## P1 User Story 1: Centralized LLM Access Service

**Story**: *As a business intelligence analyst, I want access to Claude 4 Sonnet and Titan v2 embeddings through a centralized service so I can generate high-quality insights and semantic searches.*

### Task 1.1: Create Core Type Definitions
**Priority**: P1 | **Estimated Effort**: 2 hours | **Dependencies**: None

**Implementation Steps**:
1. Create `src/mastra/types/bedrock-config.ts` with configuration interfaces
2. Create `src/mastra/types/bedrock-requests.ts` with request type definitions
3. Create `src/mastra/types/bedrock-responses.ts` with response type definitions
4. Create `src/mastra/types/bedrock-errors.ts` with error handling types
5. Create `src/mastra/types/bedrock-health.ts` with health check types
6. Create `src/mastra/types/bedrock.ts` as central export file
7. Update `src/mastra/types/index.ts` to export all Bedrock types

**Acceptance Criteria**:
- [ ] All type definitions match the data model specification
- [ ] Types are properly exported through the central type system
- [ ] No duplicate type definitions exist
- [ ] TypeScript compilation passes without errors

**Validation Steps**:
```bash
# Validate TypeScript compilation
pnpm build

# Check for type export accessibility
node -e "const types = require('./src/mastra/types'); console.log('Bedrock types loaded:', Object.keys(types).filter(k => k.includes('Bedrock')).length > 0);"
```

**Code Cleanup**:
- Remove any existing AWS or LLM type definitions that duplicate these new ones
- Update imports in any files referencing old AWS type patterns

---

### Task 1.2: Create Bedrock Configuration Service
**Priority**: P1 | **Estimated Effort**: 3 hours | **Dependencies**: Task 1.1

**Implementation Steps**:
1. Create `src/mastra/config/bedrock-model.ts` with BedrockModelConfig class
2. Implement configuration loading from environment variables
3. Add validation for AWS credentials and model accessibility
4. Create singleton pattern for configuration management
5. Add support for dynamic configuration updates

**Acceptance Criteria**:
- [ ] Configuration loads from environment variables
- [ ] AWS credentials are validated on initialization
- [ ] Model accessibility is verified for Claude 4 Sonnet and Titan v2
- [ ] Configuration can be updated at runtime
- [ ] Singleton pattern prevents duplicate configuration instances

**Validation Steps**:
```bash
# Test configuration loading
pnpm dev # Should start without configuration errors

# Validate AWS connectivity (requires valid credentials)
node -e "
const { getBedrockConfig } = require('./dist/src/mastra/config/bedrock-model.js');
getBedrockConfig().validateConfiguration().then(r => console.log('Config valid:', r.valid));
"
```

**Code Cleanup**:
- Remove any existing AWS configuration patterns that don't follow the centralized approach
- Update references to old configuration methods

---

### Task 1.3: Implement Circuit Breaker for Resilience
**Priority**: P1 | **Estimated Effort**: 2 hours | **Dependencies**: Task 1.1

**Implementation Steps**:
1. Create `src/mastra/services/circuit-breaker.ts` with CircuitBreaker class
2. Implement state management (closed, open, half-open)
3. Add failure threshold tracking and recovery timeouts
4. Integrate with error handling patterns
5. Add metrics collection for circuit breaker state changes

**Acceptance Criteria**:
- [ ] Circuit breaker tracks failure counts and implements timeout recovery
- [ ] State transitions work correctly (closed → open → half-open → closed)
- [ ] Failed operations throw appropriate errors
- [ ] Recovery attempts work after timeout period
- [ ] Metrics are collected for monitoring

**Validation Steps**:
```bash
# Test circuit breaker behavior
pnpm test # Run unit tests for circuit breaker logic

# Validate error handling
node -e "
const { CircuitBreaker } = require('./dist/src/mastra/services/circuit-breaker.js');
const cb = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 1000 });
// Test failure scenarios
"
```

**Code Cleanup**:
- Remove any existing retry logic that duplicates circuit breaker functionality
- Update error handling to use centralized circuit breaker

---

### Task 1.4: Create Bedrock LLM Service Implementation
**Priority**: P1 | **Estimated Effort**: 5 hours | **Dependencies**: Tasks 1.1, 1.2, 1.3

**Implementation Steps**:
1. Create `src/mastra/services/bedrock-llm-service.ts` with BedrockLLMService class
2. Implement Claude 4 Sonnet text generation with proper error handling
3. Implement Titan v2 embedding generation with configurable dimensions
4. Integrate circuit breaker for resilience
5. Add comprehensive logging and tracing
6. Implement health check functionality
7. Create singleton pattern for service access

**Acceptance Criteria**:
- [ ] Claude 4 Sonnet generates text with proper token usage tracking
- [ ] Titan v2 generates 1024-dimension embeddings correctly
- [ ] Circuit breaker protects against AWS rate limits
- [ ] All operations are traced with OpenTelemetry
- [ ] Health checks validate AWS connectivity and model availability
- [ ] Service follows singleton pattern

**Validation Steps**:
```bash
# Validate service compilation
pnpm build

# Test service functionality (requires AWS credentials)
pnpm dev # Should initialize service without errors

# Manual API test
node -e "
const { getBedrockService } = require('./dist/src/mastra/services/bedrock-llm-service.js');
const service = getBedrockService();
service.generateText({messages: [{role: 'user', content: 'Hello'}]}).then(r => console.log('Text generated:', r.content.length > 0));
service.generateEmbedding({inputText: 'test'}).then(r => console.log('Embedding dimensions:', r.dimensions));
"
```

**Code Cleanup**:
- Remove any existing LLM service implementations that duplicate this functionality
- Update agent configurations to use the centralized service
- Delete obsolete AWS SDK usage patterns

---

### Task 1.5: Update Vector Operations for Configurable Dimensions
**Priority**: P1 | **Estimated Effort**: 2 hours | **Dependencies**: Task 1.1

**Implementation Steps**:
1. Modify `src/mastra/database/vector-ops.ts` to support configurable dimensions
2. Add validation for both 1536 (OpenAI) and 1024 (Titan v2) dimensions
3. Create migration strategy for existing embeddings
4. Update semantic search to handle mixed dimension vectors
5. Add dimension metadata to stored embeddings

**Acceptance Criteria**:
- [ ] Vector operations accept both 1536 and 1024 dimension embeddings
- [ ] Existing 1536-dimension embeddings continue to work
- [ ] New 1024-dimension embeddings are properly stored
- [ ] Semantic search works with mixed dimensions
- [ ] Database schema supports dimension metadata

**Validation Steps**:
```bash
# Test vector operations
pnpm build && pnpm dev

# Validate dimension handling
node -e "
const { getVectorOpsService } = require('./dist/src/mastra/database/vector-ops.js');
const service = getVectorOpsService();
// Test with 1024 dimensions (Titan v2)
const embedding1024 = new Array(1024).fill(0.1);
service.storeEmbeddingWithDimensions(embedding1024, 'test content', 'user_memories', {}, 1024).then(id => console.log('1024D stored:', id));
// Test with 1536 dimensions (OpenAI)
const embedding1536 = new Array(1536).fill(0.1);
service.storeEmbeddingWithDimensions(embedding1536, 'test content', 'user_memories', {}, 1536).then(id => console.log('1536D stored:', id));
"
```

**Code Cleanup**:
- Remove hardcoded dimension validations that only accept 1536 dimensions
- Update existing embedding operations to specify dimensions explicitly

---

## P1 User Story 2: Langfuse Monitoring Integration

**Story**: *As a system administrator, I want comprehensive monitoring of all LLM operations through Langfuse so I can track performance, costs, and quality metrics.*

### Task 2.1: Integrate OpenTelemetry Tracing
**Priority**: P1 | **Estimated Effort**: 3 hours | **Dependencies**: Task 1.4

**Implementation Steps**:
1. Enhance BedrockLLMService with OpenTelemetry span creation
2. Add trace correlation IDs for request tracking
3. Implement span attributes for operation metadata
4. Add error recording and status management
5. Integrate with existing Langfuse instrumentation

**Acceptance Criteria**:
- [ ] All Bedrock operations create proper OpenTelemetry spans
- [ ] Span attributes include model IDs, token usage, and timing
- [ ] Error conditions are properly recorded in traces
- [ ] Trace IDs are returned in responses for correlation
- [ ] Integration works with existing Langfuse setup

**Validation Steps**:
```bash
# Start service with tracing enabled
LANGFUSE_DEBUG=true pnpm dev

# Generate test operations and verify traces
node -e "
const { getBedrockService } = require('./dist/src/mastra/services/bedrock-llm-service.js');
const service = getBedrockService();
service.generateText({messages: [{role: 'user', content: 'test'}]}).then(r => console.log('Trace ID:', r.traceId));
"

# Check Langfuse dashboard for trace appearance
```

**Code Cleanup**:
- Remove any duplicate tracing implementations
- Standardize span naming conventions across all services

---

### Task 2.2: Create Mastra Tools with Tracing
**Priority**: P1 | **Estimated Effort**: 4 hours | **Dependencies**: Tasks 1.4, 2.1

**Implementation Steps**:
1. Create `src/mastra/tools/bedrock-tools.ts` with all Bedrock tools
2. Implement Claude text generation tool with Zod validation
3. Implement Titan embedding tools (single and batch)
4. Add health check and configuration management tools
5. Integrate tool call tracing with existing patterns
6. Add proper error handling and validation

**Acceptance Criteria**:
- [ ] All 7 tools defined in tool-schemas.ts are implemented
- [ ] Tools use proper Zod validation for inputs and outputs
- [ ] Tool executions are traced with metadata
- [ ] Error handling follows established patterns
- [ ] Tools integrate with existing tool call tracer

**Validation Steps**:
```bash
# Validate tool compilation and registration
pnpm build && pnpm dev

# Test tool execution through Mastra
node -e "
const { mastra } = require('./dist/src/mastra/index.js');
const tools = mastra.tools;
console.log('Bedrock tools registered:', Object.keys(tools).filter(k => k.includes('bedrock')).length);
"

# Test tool execution with tracing
node -e "
const { claudeGenerateTextTool } = require('./dist/src/mastra/tools/bedrock-tools.js');
claudeGenerateTextTool.execute({
  context: { userId: 'test', agentId: 'test' },
  input: { messages: [{ role: 'user', content: 'Hello' }] }
}).then(r => console.log('Tool executed, trace:', r.traceId));
"
```

**Code Cleanup**:
- Remove any existing LLM tools that duplicate this functionality
- Update tool registrations to use the new Bedrock tools
- Delete obsolete tool implementations

---

### Task 2.3: Update Business Intelligence Agent
**Priority**: P1 | **Estimated Effort**: 2 hours | **Dependencies**: Task 2.2

**Implementation Steps**:
1. Update `src/mastra/agents/business-intelligence.ts` to use Bedrock tools
2. Enhance agent instructions to leverage Claude and Titan capabilities
3. Configure tool access and memory integration
4. Update agent registration in main Mastra configuration
5. Test agent functionality with new tools

**Acceptance Criteria**:
- [ ] Business intelligence agent has access to all Bedrock tools
- [ ] Agent instructions reflect new capabilities
- [ ] Agent can use Claude for text generation and Titan for embeddings
- [ ] Memory integration works with semantic search
- [ ] Agent is properly registered and visible in playground

**Validation Steps**:
```bash
# Validate agent compilation and registration
pnpm build && pnpm dev

# Test agent functionality
node -e "
const { mastra } = require('./dist/src/mastra/index.js');
const agent = mastra.agents.businessIntelligenceAgent;
console.log('Agent has Bedrock tools:', Object.keys(agent.tools).filter(k => k.includes('bedrock')).length > 0);
"

# Test agent execution through Mastra playground (manual verification)
```

**Code Cleanup**:
- Remove any duplicate agent implementations
- Update agent tool configurations to use centralized tools
- Delete obsolete agent patterns

---

## P2 User Story 3: Error Handling and Recovery

**Story**: *As a developer, I want robust error handling with automatic retry logic so the system gracefully handles API failures and rate limits.*

### Task 3.1: Implement Comprehensive Error Types
**Priority**: P2 | **Estimated Effort**: 2 hours | **Dependencies**: Task 1.1

**Implementation Steps**:
1. Enhance `src/mastra/types/bedrock-errors.ts` with specific error categories
2. Create error factory functions for consistent error creation
3. Add retry logic configuration and backoff strategies
4. Implement error correlation with trace IDs
5. Add error severity classification

**Acceptance Criteria**:
- [ ] Error types cover all possible failure scenarios
- [ ] Errors include proper categorization and retry guidance
- [ ] Error correlation with traces works correctly
- [ ] Error factory functions create consistent error objects
- [ ] Severity classification enables appropriate handling

**Validation Steps**:
```bash
# Test error type compilation
pnpm build

# Validate error handling patterns
node -e "
const { BedrockServiceError } = require('./dist/src/mastra/types/bedrock-errors.js');
const error = new BedrockServiceError('Test error', 'API_ERROR', true);
console.log('Error created:', error.retryable);
"
```

---

### Task 3.2: Integrate with Existing Error Handling
**Priority**: P2 | **Estimated Effort**: 2 hours | **Dependencies**: Tasks 1.4, 3.1

**Implementation Steps**:
1. Update BedrockLLMService to use existing error handling patterns
2. Integrate with `src/mastra/observability/error-handling.ts`
3. Add error recording to existing error tracker
4. Implement proper error propagation to tools and agents
5. Add error context preservation through the call stack

**Acceptance Criteria**:
- [ ] Bedrock service uses existing error handling infrastructure
- [ ] Errors are properly recorded and tracked
- [ ] Error context is preserved through tool and agent calls
- [ ] Error severity is properly classified and handled
- [ ] Integration with existing monitoring works correctly

**Validation Steps**:
```bash
# Test error integration
pnpm build && pnpm dev

# Simulate error conditions and verify handling
node -e "
const { getBedrockService } = require('./dist/src/mastra/services/bedrock-llm-service.js');
// Test with invalid request to trigger error handling
"
```

**Code Cleanup**:
- Remove any custom error handling that duplicates existing patterns
- Standardize error handling across all Bedrock components

---

## P2 User Story 4: Configuration Management

**Story**: *As a system administrator, I want to manage LLM model configurations dynamically so I can optimize performance without service restarts.*

### Task 4.1: Implement Dynamic Configuration Updates
**Priority**: P2 | **Estimated Effort**: 3 hours | **Dependencies**: Task 1.2

**Implementation Steps**:
1. Enhance BedrockModelConfig with runtime configuration updates
2. Add configuration validation before applying changes
3. Implement configuration change notifications
4. Add rollback capability for failed configuration changes
5. Create configuration management tool for Mastra

**Acceptance Criteria**:
- [ ] Configuration can be updated at runtime without restart
- [ ] Configuration changes are validated before application
- [ ] Failed configuration changes can be rolled back
- [ ] Configuration updates trigger appropriate notifications
- [ ] Tool interface allows configuration management through Mastra

**Validation Steps**:
```bash
# Test configuration management
pnpm build && pnpm dev

# Test dynamic configuration updates
node -e "
const { getBedrockConfig } = require('./dist/src/mastra/config/bedrock-model.js');
const config = getBedrockConfig();
config.updateConfig({ claude: { defaultTemperature: 0.8 } });
console.log('Configuration updated');
"
```

---

### Task 4.2: Add Configuration Validation and Security
**Priority**: P2 | **Estimated Effort**: 2 hours | **Dependencies**: Task 4.1

**Implementation Steps**:
1. Implement AWS credential validation
2. Add model accessibility verification
3. Create configuration schema validation with Zod
4. Add secure credential storage patterns
5. Implement configuration audit logging

**Acceptance Criteria**:
- [ ] AWS credentials are validated before use
- [ ] Model accessibility is verified for configuration changes
- [ ] Configuration follows proper schema validation
- [ ] Credentials are stored securely
- [ ] Configuration changes are audited

**Validation Steps**:
```bash
# Test configuration validation
pnpm build && pnpm dev

# Validate security measures
node -e "
const { getBedrockConfig } = require('./dist/src/mastra/config/bedrock-model.js');
// Test with invalid configuration to verify validation
"
```

**Code Cleanup**:
- Remove hardcoded configuration values
- Update configuration loading to use centralized patterns

---

## P3 User Story 5: Database Integration

**Story**: *As a data analyst, I want seamless integration with the existing database so I can store and retrieve embeddings efficiently.*

### Task 5.1: Integrate with Consolidated Database Architecture
**Priority**: P3 | **Estimated Effort**: 3 hours | **Dependencies**: Tasks 1.4, 1.5

**Implementation Steps**:
1. Update Bedrock service to use existing database patterns
2. Integrate with consolidated database configuration
3. Add proper connection pooling and management
4. Implement database health checks
5. Add database operation tracing

**Acceptance Criteria**:
- [ ] Service uses existing consolidated database patterns
- [ ] Connection pooling works correctly
- [ ] Database operations are properly traced
- [ ] Health checks validate database connectivity
- [ ] Integration follows established architecture

**Validation Steps**:
```bash
# Test database integration
pnpm build && pnpm dev

# Validate database connectivity
node -e "
const { getConnectionPool } = require('./dist/src/mastra/config/consolidated-database.js');
const pool = getConnectionPool();
pool.query('SELECT 1').then(r => console.log('Database connected:', r.rows.length > 0));
"
```

---

### Task 5.2: Implement Enhanced Knowledge Search
**Priority**: P3 | **Estimated Effort**: 2 hours | **Dependencies**: Task 5.1

**Implementation Steps**:
1. Update knowledge search to use Titan v2 embeddings
2. Add hybrid search capabilities (semantic + keyword)
3. Implement result ranking and filtering
4. Add search performance monitoring
5. Create knowledge search tools with new capabilities

**Acceptance Criteria**:
- [ ] Knowledge search uses improved Titan v2 embeddings
- [ ] Hybrid search provides better result quality
- [ ] Search performance is properly monitored
- [ ] New search tools are available to agents
- [ ] Search results include proper relevance scoring

**Validation Steps**:
```bash
# Test knowledge search integration
pnpm build && pnpm dev

# Validate search functionality
node -e "
const { knowledgeSearchTool } = require('./dist/src/mastra/tools/knowledge-search.js');
// Test search with new embedding capabilities
"
```

**Code Cleanup**:
- Update existing knowledge search to use new patterns
- Remove duplicate search implementations

---

## Build Validation and Mastra Runtime Tasks

### Task 6.1: Code Cleanup and Pattern Migration
**Priority**: P1 | **Estimated Effort**: 4 hours | **Dependencies**: All implementation tasks

**Implementation Steps**:
1. Identify and catalog all obsolete code patterns
2. Remove duplicate AWS SDK implementations
3. Update all imports to use centralized type system
4. Remove obsolete configuration patterns
5. Update agent and tool registrations
6. Migrate error handling to centralized patterns
7. Remove unused dependencies

**Acceptance Criteria**:
- [ ] No duplicate code patterns exist
- [ ] All imports use centralized type system
- [ ] Obsolete configuration patterns are removed
- [ ] Agent and tool registrations use new patterns
- [ ] Error handling is standardized
- [ ] Unused dependencies are removed

**Code Cleanup Checklist**:
- [ ] Remove old AWS service implementations
- [ ] Update type imports to use `src/mastra/types/index.ts`
- [ ] Remove duplicate error handling patterns
- [ ] Update agent configurations
- [ ] Remove obsolete tool implementations
- [ ] Clean up configuration loading patterns

---

### Task 6.2: Build System Validation
**Priority**: P1 | **Estimated Effort**: 2 hours | **Dependencies**: Task 6.1

**Implementation Steps**:
1. Run complete TypeScript compilation with `pnpm build`
2. Validate all type exports and imports
3. Check for circular dependencies
4. Validate Mastra tool and agent registrations
5. Test service initialization
6. Verify all environment configurations

**Acceptance Criteria**:
- [ ] `pnpm build` completes without errors or warnings
- [ ] TypeScript compilation passes all type checks
- [ ] No circular dependencies exist
- [ ] All registrations are properly configured
- [ ] Service initializes correctly
- [ ] Environment configuration is valid

**Validation Commands**:
```bash
# Complete build validation
pnpm build

# Check for circular dependencies
npx madge --circular --extensions ts src/

# Validate TypeScript types
npx tsc --noEmit

# Check for unused exports
npx ts-unused-exports tsconfig.json
```

---

### Task 6.3: Mastra Runtime Validation
**Priority**: P1 | **Estimated Effort**: 3 hours | **Dependencies**: Task 6.2

**Implementation Steps**:
1. Start Mastra development server with `pnpm dev`
2. Validate all agents and tools are registered
3. Test service initialization and health checks
4. Verify MCP server integrations work
5. Test tool execution through Mastra playground
6. Validate agent functionality and memory access
7. Check monitoring and tracing integration

**Acceptance Criteria**:
- [ ] `pnpm dev` starts without errors
- [ ] All Bedrock tools appear in Mastra playground
- [ ] Business intelligence agent has access to new capabilities
- [ ] Service health checks pass
- [ ] MCP server integrations work correctly
- [ ] Monitoring and tracing function properly
- [ ] Memory operations work with new embeddings

**Runtime Validation Steps**:
```bash
# Start Mastra development server
pnpm dev

# Validate agent and tool registration
curl -X GET http://localhost:4000/playground/registry

# Test health endpoints
curl -X GET http://localhost:4000/health

# Test tool execution (requires playground UI)
# Manual verification through Mastra playground interface
```

---

### Task 6.4: Integration Testing and Documentation
**Priority**: P2 | **Estimated Effort**: 3 hours | **Dependencies**: Task 6.3

**Implementation Steps**:
1. Create comprehensive integration test suite
2. Test all user story acceptance scenarios
3. Validate performance characteristics
4. Update documentation for new capabilities
5. Create troubleshooting guide
6. Document configuration options

**Acceptance Criteria**:
- [ ] Integration tests cover all user stories
- [ ] Performance meets specified requirements
- [ ] Documentation is complete and accurate
- [ ] Troubleshooting guide addresses common issues
- [ ] Configuration documentation is comprehensive

**Integration Test Areas**:
- Claude 4 Sonnet text generation with proper token tracking
- Titan v2 embedding generation with 1024 dimensions
- Vector storage and retrieval with mixed dimensions
- Circuit breaker behavior under failure conditions
- Langfuse tracing and monitoring integration
- Agent and tool functionality through Mastra playground

---

## Final Validation Checklist

**Build Validation**:
- [ ] `pnpm build` completes successfully
- [ ] TypeScript compilation passes without errors
- [ ] No circular dependencies detected
- [ ] All type exports are accessible

**Runtime Validation**:
- [ ] `pnpm dev` starts Mastra server successfully
- [ ] All 7 Bedrock tools are registered and visible
- [ ] Business intelligence agent has access to Bedrock capabilities
- [ ] Service health checks pass
- [ ] AWS Bedrock connectivity works

**Functionality Validation**:
- [ ] Claude 4 Sonnet generates text correctly
- [ ] Titan v2 generates 1024-dimension embeddings
- [ ] Vector operations handle both 1536 and 1024 dimensions
- [ ] Circuit breaker protects against failures
- [ ] Langfuse tracing captures all operations
- [ ] Error handling works correctly

**Integration Validation**:
- [ ] MCP server integrations function properly
- [ ] Database operations use consolidated patterns
- [ ] Memory operations work with semantic search
- [ ] Knowledge search uses improved embeddings
- [ ] Configuration management works dynamically

**Performance Validation**:
- [ ] Claude 4 Sonnet responses under 500ms
- [ ] Titan v2 embeddings under 200ms
- [ ] Memory footprint under 100MB additional
- [ ] Concurrent requests handle properly

---

## Implementation Order

1. **Phase 1** (P1 Critical): Tasks 1.1-1.5, 2.1-2.3 (Core service and monitoring)
2. **Phase 2** (P2 Important): Tasks 3.1-4.2 (Error handling and configuration)
3. **Phase 3** (P3 Enhancement): Tasks 5.1-5.2 (Database integration)
4. **Phase 4** (Validation): Tasks 6.1-6.4 (Cleanup and validation)

Each phase should conclude with build and runtime validation before proceeding to the next phase.