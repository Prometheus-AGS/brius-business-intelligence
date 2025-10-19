# Research: Mastra Business Intelligence System

**Date**: October 18, 2025
**Feature**: Mastra Business Intelligence System
**Branch**: 001-mastra-bi-system

## Overview

This document consolidates research findings and technical decisions for implementing the comprehensive Mastra Business Intelligence system. All technical unknowns from the planning phase have been resolved through analysis of the existing specification and Mastra framework patterns.

## Technology Stack Decisions

### Core Framework and Runtime

**Decision**: TypeScript 5.3+ with Node.js 20+ using Mastra framework
**Rationale**:
- Existing project already uses Mastra framework with TypeScript
- Node.js 20+ provides native support for modern JavaScript features and improved performance
- TypeScript ensures type safety for complex integration scenarios
- Mastra framework provides built-in agent, workflow, and tool management capabilities

**Alternatives considered**:
- Python with LangChain (rejected: would require complete rewrite of existing codebase)
- Pure JavaScript (rejected: lacks type safety needed for complex integrations)

### MCP Integration Architecture

**Decision**: Dual MCP role - both client and server using @modelcontextprotocol/sdk
**Rationale**:
- Client role enables integration with external systems (Supabase, GitHub, filesystem)
- Server role exposes internal capabilities to external MCP clients
- HTTP SSE transport for MCP server provides better scalability than stdio
- Tool namespacing prevents conflicts between different MCP server sources

**Alternatives considered**:
- MCP client only (rejected: wouldn't expose capabilities to external systems)
- stdio transport (rejected: harder to scale and monitor)
- Custom protocol (rejected: MCP is emerging standard)

### Memory and Knowledge Base Storage

**Decision**: Supabase PostgreSQL with pgvector extension for vector storage
**Rationale**:
- pgvector provides native vector similarity search in PostgreSQL
- Supabase offers managed PostgreSQL with built-in vector support
- RLS (Row Level Security) provides user isolation for memory data
- Existing authentication integration with Supabase JWT tokens
- Hybrid search capability (vector + full-text search)

**Alternatives considered**:
- Pinecone (rejected: additional service dependency and cost)
- Weaviate (rejected: requires separate deployment and management)
- ChromaDB (rejected: less mature PostgreSQL integration)

### Embedding Generation

**Decision**: AWS Bedrock Titan Text Embeddings v2
**Rationale**:
- Higher dimensional embeddings (1024) provide better semantic representation
- AWS managed service reduces operational overhead
- Cost-effective for expected query volume
- Good performance for business document embedding

**Alternatives considered**:
- OpenAI embeddings (rejected: higher cost, rate limiting concerns)
- Local embedding models (rejected: computational overhead, model management)
- Cohere embeddings (rejected: less integration ecosystem)

### API Design and Compatibility

**Decision**: Multiple API interfaces - OpenAI-compatible, REST, MCP, AG-UI
**Rationale**:
- OpenAI compatibility enables integration with existing AI tools and clients
- REST APIs provide standard web service interfaces
- MCP interfaces enable tool ecosystem integration
- AG-UI compatibility supports interactive conversation interfaces

**Alternatives considered**:
- GraphQL only (rejected: doesn't provide OpenAI compatibility)
- REST only (rejected: missing MCP and AI-specific interfaces)
- gRPC (rejected: adds complexity without clear benefit)

### Authentication and Authorization

**Decision**: JWT-based authentication with Supabase tokens, optional authentication support
**Rationale**:
- Supabase JWT provides user identification and claims
- RLS policies automatically enforce user data isolation
- Optional authentication allows anonymous usage for demos
- Standard JWT format enables integration with existing auth systems

**Alternatives considered**:
- Session-based authentication (rejected: less suitable for API clients)
- API keys only (rejected: doesn't provide user identity)
- OAuth2 direct (rejected: adds complexity, Supabase handles OAuth)

### Observability and Monitoring

**Decision**: LangFuse for AI-specific observability, structured logging for general monitoring
**Rationale**:
- LangFuse specializes in LLM application observability
- Per-user tracking enables usage analytics and debugging
- Structured logging provides operational visibility
- Graceful degradation if observability services are unavailable

**Alternatives considered**:
- Custom observability (rejected: significant development overhead)
- Generic APM tools (rejected: lack AI/LLM specific features)
- Multiple observability tools (rejected: increased complexity)

## Integration Patterns

### MCP Client Integration Pattern

**Decision**: Dynamic MCP server spawning based on mcp.json configuration
**Rationale**:
- Configurable external system integration without code changes
- Process isolation prevents external tool failures from affecting core system
- Standard mcp.json format enables tool ecosystem adoption
- Environment variable substitution supports different deployment environments

### Agent Orchestration Pattern

**Decision**: Intent classification with complexity scoring for agent routing
**Rationale**:
- Multi-dimensional scoring (keywords, entities, aggregation, temporal, output) provides nuanced routing
- Business Intelligence agents handle complex analytical queries with planning workflows
- Default agents handle simple queries directly for better performance
- Knowledge-first planning ensures context-aware analysis

### Memory Architecture Pattern

**Decision**: Dual memory system - user-scoped and global shared memory
**Rationale**:
- User memory provides personalization and conversation continuity
- Global memory enables organizational knowledge sharing
- Both use same vector search technology for consistency
- Automatic injection into agent context reduces user cognitive load

## Performance and Scalability Considerations

### Concurrent User Support

**Decision**: Stateless design with connection pooling and caching
**Rationale**:
- Stateless agents and workflows enable horizontal scaling
- Connection pooling to Supabase reduces connection overhead
- Memory and knowledge base caching improves response times
- Load balancer can distribute requests across multiple instances

### Document Processing Pipeline

**Decision**: Asynchronous document processing with chunking strategies
**Rationale**:
- Large documents processed in background to avoid blocking user interface
- Multiple chunking strategies (sentence, paragraph, semantic) optimize for different content types
- Vector embeddings generated incrementally to spread computational load
- Status tracking enables progress monitoring

### Vector Search Optimization

**Decision**: pgvector with IVFFLAT indexes and configurable list parameters
**Rationale**:
- IVFFLAT indexes provide good balance of accuracy and performance
- Configurable list parameters allow tuning for dataset size
- Approximate nearest neighbor search provides sub-second response times
- Hybrid search combines vector similarity with keyword matching

## Security and Privacy

### Data Isolation Strategy

**Decision**: RLS policies with JWT-based user identification
**Rationale**:
- Database-level enforcement of user data isolation
- Supabase RLS automatically applies user context to queries
- No application-level access control bugs can bypass data isolation
- Audit trail of data access through database logs

### Input Validation and Sanitization

**Decision**: Zod schemas for all API inputs with SQL injection prevention
**Rationale**:
- Type-safe input validation prevents malformed data from entering system
- Parameterized queries prevent SQL injection attacks
- Schema validation provides clear error messages for debugging
- Consistent validation across all API endpoints

## Development and Testing Strategy

### Testing Approach

**Decision**: Vitest for unit tests, separate integration test suite for MCP communication
**Rationale**:
- Vitest provides fast test execution and good TypeScript integration
- MCP integration tests verify external system communication
- Mock external services for reliable test execution
- Contract tests ensure API compatibility

### Development Workflow

**Decision**: Feature-based development with playground testing
**Rationale**:
- Playground interface enables interactive testing of all tools and agents
- Feature branches isolate development work
- Automated tool registration reduces manual configuration
- Local development environment mirrors production architecture

## Deployment and Operations

### Containerization Strategy

**Decision**: Docker containerization with environment-based configuration
**Rationale**:
- Container deployment provides consistent runtime environment
- Environment variables configure different deployment stages
- Health checks enable automated failure detection and recovery
- Horizontal scaling through container orchestration

### Configuration Management

**Decision**: Environment variables with mcp.json for external tool configuration
**Rationale**:
- Environment variables provide secure configuration for secrets
- mcp.json enables tool configuration without code deployment
- Configuration validation prevents startup with invalid settings
- Default values provide good development experience

## Risk Mitigation

### External Service Dependencies

**Decision**: Circuit breaker pattern with graceful degradation
**Rationale**:
- Circuit breakers prevent cascade failures from external services
- Graceful degradation maintains core functionality when external tools fail
- Retry logic with exponential backoff handles temporary failures
- Health checks monitor external service availability

### Data Consistency and Backup

**Decision**: Database-level consistency with automated backups
**Rationale**:
- PostgreSQL ACID properties ensure data consistency
- Supabase automated backups provide disaster recovery
- Vector embeddings can be regenerated from source documents
- Critical configuration stored in version control

## Conclusion

All technical decisions are based on the comprehensive specification and align with Mastra framework conventions. The chosen architecture provides scalability, maintainability, and extensibility while meeting all functional requirements. Implementation can proceed to Phase 1 with confidence in the technical foundation.