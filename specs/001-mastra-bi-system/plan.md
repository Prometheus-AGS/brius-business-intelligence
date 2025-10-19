# Implementation Plan: Mastra Business Intelligence System

**Branch**: `001-mastra-bi-system` | **Date**: October 18, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-mastra-bi-system/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implementation of a comprehensive Mastra-based Business Intelligence system that provides intelligent natural language querying, agent orchestration, memory management, external system integration, and knowledge base capabilities. The system acts as both MCP client and server, offering OpenAI-compatible APIs and interactive UI interfaces for business analytics.

## Technical Context

**Language/Version**: TypeScript 5.3+ with Node.js 20+ (based on existing Mastra framework requirements)
**Primary Dependencies**: Mastra framework, @modelcontextprotocol/sdk, @ai-sdk/openai, Supabase client, LangFuse, AWS Bedrock SDK, Express, Zod
**Storage**: Supabase PostgreSQL with pgvector for vector embeddings, LibSQL for local observability data
**Testing**: Vitest for unit tests, integration tests for MCP client/server communication
**Target Platform**: Node.js server environment with Docker containerization support
**Project Type**: Single web application server with multiple API interfaces (OpenAI-compatible, REST, MCP, AG-UI)
**Performance Goals**: <500ms first token, 100 concurrent users, 98% tool integration success rate, <2s knowledge base search
**Constraints**: Memory operations <500ms, 99.9% uptime, document processing <30s for 10MB files, JWT-optional authentication
**Scale/Scope**: Multi-user system with user-isolated memory, global shared knowledge, external tool integration via MCP protocol

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Since no specific constitution is defined for this project, applying general software engineering principles:

✅ **Feature-Based Clean Architecture**: System is organized by business features (agents, memory, knowledge, etc.) rather than technical layers
✅ **Single Source of Truth**: Shared types will be centralized in `src/mastra/types/*` as per CLAUDE.md requirements
✅ **Code Validation**: All code will be validated against Mastra MCP docs and context7 server
✅ **Documentation-Driven**: Implementation follows comprehensive specification in docs/README.md
✅ **Agent/Workflow Registration**: All components will be registered with main Mastra object for playground visibility

## Project Structure

### Documentation (this feature)

```
specs/001-mastra-bi-system/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

Based on existing Mastra structure and feature requirements:

```
src/mastra/
├── index.ts                    # Main Mastra configuration and registration
├── config/                     # Configuration management
│   ├── mcp-client.ts          # MCP client configuration
│   ├── environment.ts         # Environment variable handling
│   └── database.ts            # Supabase and LibSQL setup
├── agents/                     # AI agents with instructions and memory
│   ├── business-intelligence.ts
│   ├── default.ts
│   └── shared-tools.ts
├── workflows/                  # Multi-step workflow pipelines
│   ├── orchestrator.ts        # Intent classification and routing
│   ├── planning.ts            # Knowledge-first planning workflow
│   └── intent-classifier.ts   # Complexity scoring logic
├── tools/                      # Executable tools with Zod schemas
│   ├── knowledge-search.ts    # Knowledge base search tool
│   ├── memory-tools.ts        # User/global memory tools
│   └── mcp-registry.ts        # MCP tool registration
├── memory/                     # Memory management system
│   ├── operations.ts          # Core memory operations
│   ├── embeddings.ts          # Vector embedding generation
│   ├── storage.ts             # Supabase pgvector operations
│   └── middleware.ts          # Memory injection middleware
├── knowledge/                  # Knowledge base and document management
│   ├── upload.ts              # Document upload processing
│   ├── search.ts              # Semantic search operations
│   ├── chunking.ts            # Document chunking strategies
│   └── embeddings.ts          # Document embedding generation
├── mcp/                        # MCP client integration
│   ├── client.ts              # MCP client initialization
│   ├── config-loader.ts       # mcp.json configuration parser
│   ├── process-manager.ts     # MCP server process management
│   ├── tool-mapper.ts         # Tool discovery and mapping
│   └── registry.ts            # Tool registry for playground
├── mcp-server/                 # MCP server implementation
│   ├── index.ts               # MCP server setup
│   ├── protocol.ts            # MCP protocol handlers
│   ├── tools/                 # MCP tool wrappers
│   │   ├── agents.ts          # Agent tool wrappers
│   │   ├── workflows.ts       # Workflow tool wrappers
│   │   ├── knowledge.ts       # Knowledge base tools
│   │   └── memory.ts          # Memory tools
│   └── transport/             # Transport layer
│       └── http-sse.ts        # HTTP SSE transport
├── api/                        # REST API implementations
│   ├── openai/                # OpenAI-compatible API
│   │   ├── chat.ts            # Chat completions
│   │   ├── models.ts          # Models endpoint
│   │   ├── embeddings.ts      # Embeddings with Bedrock
│   │   └── streaming.ts       # Streaming utilities
│   ├── knowledge/             # Knowledge base REST API
│   │   ├── upload.ts          # Document upload endpoints
│   │   ├── search.ts          # Search endpoints
│   │   └── management.ts      # Document management
│   ├── memory/                # Memory management REST API
│   │   ├── user.ts            # User memory endpoints
│   │   ├── global.ts          # Global memory endpoints
│   │   └── stats.ts           # Memory statistics
│   └── playground/            # Playground interface API
│       ├── tools.ts           # Tool listing and testing
│       └── registry.ts        # Registry management
├── ui/                         # AG-UI integration
│   ├── routes.ts              # AG-UI route handlers
│   ├── streaming.ts           # SSE streaming utilities
│   └── conversation.ts        # Conversation state management
├── auth/                       # Authentication and security
│   ├── jwt.ts                 # JWT validation
│   ├── context.ts             # User context management
│   └── middleware.ts          # Auth middleware
├── observability/              # Monitoring and logging
│   ├── langfuse.ts            # LangFuse integration
│   ├── tracer.ts              # Tracing middleware
│   └── logger.ts              # Event logging
└── types/                      # Shared type definitions (MANDATORY)
    ├── index.ts               # Central type exports
    ├── agents.ts              # Agent-related types
    ├── workflows.ts           # Workflow-related types
    ├── memory.ts              # Memory system types
    ├── knowledge.ts           # Knowledge base types
    ├── mcp.ts                 # MCP-related types
    └── api.ts                 # API interface types

tests/
├── unit/                       # Unit tests
│   ├── memory/
│   ├── mcp/
│   ├── workflows/
│   └── agents/
├── integration/                # Integration tests
│   ├── mcp-client.test.ts
│   ├── openai-api.test.ts
│   ├── knowledge-base.test.ts
│   └── memory.test.ts
└── e2e/                        # End-to-end tests
    ├── chat-completion.test.ts
    ├── mcp-tools.test.ts
    └── planning-workflow.test.ts

docs/                           # Additional documentation
migrations/                     # Database migrations
mcp.json                        # MCP server configuration
```

**Structure Decision**: Selected single project structure with feature-based organization under `src/mastra/` to align with existing Mastra framework patterns. The structure separates concerns by business capability (agents, memory, knowledge, etc.) while maintaining clear interfaces between components. MCP client/server capabilities are isolated but integrated with the core system.

## Complexity Tracking

*No constitutional violations identified - all requirements align with clean architecture principles and Mastra framework conventions.*