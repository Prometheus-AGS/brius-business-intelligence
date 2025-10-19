<!--
Sync Impact Report:
- Version change: [TEMPLATE] → 1.0.0 (Initial constitution based on docs/README.md)
- Modified principles: All template placeholders replaced with project-specific principles
- Added sections: Architecture Standards, Development Workflow
- Removed sections: None
- Templates requiring updates:
  ✅ Updated constitution.md
  ✅ Validated plan-template.md (Constitution Check section aligns with new principles)
  ✅ Validated spec-template.md (Requirements and success criteria align with architecture standards)
  ✅ Validated tasks-template.md (Testing and implementation phases support constitution requirements)
  ✅ Validated other templates (checklist-template.md, agent-file-template.md compatible)
- Follow-up TODOs: Monitor compliance during actual implementation phases
-->

# Brius Business Intelligence Constitution

## Core Principles

### I. pgvector Database Architecture (NON-NEGOTIABLE)
The local database for the agent itself MUST use pgvector 17, NOT Supabase database. Database operations MUST be handled through postgres functions called by pg npm module or drizzle/drizzlekit. This ensures proper vector storage, semantic search capabilities, and maintains architectural consistency with the business intelligence requirements.

### II. Mastra Framework Compliance
All code MUST follow Mastra framework best practices and be validated against the latest Mastra APIs using available MCP servers (mastra mcp server, context7 mcp server). Agent and workflow registration with the main Mastra object is MANDATORY - all components MUST be visible in the Mastra playground. No exceptions to registration requirements.

### III. Comprehensive Observability with LangFuse
Tool call tracing to LangFuse MUST be implemented comprehensively, including requests, results, and errors. This is NOT optional - proper observability is required for business intelligence operations monitoring, debugging, and performance analysis. All agent interactions and workflow executions MUST be traceable.

### IV. Model Context Protocol (MCP) Integration
Supabase MCP server integration is MANDATORY and MUST be properly configured using the built-in capabilities of new Supabase installations. MCP client and server implementations MUST follow the documented patterns with proper configuration management and error handling.

### V. Feature-Based Clean Architecture
Code organization MUST follow feature-based clean architecture patterns, not technical layers. Each feature MUST be self-contained with its own types, logic, and interfaces. All shared types MUST be placed in `src/mastra/types/*` directory and exported through `src/mastra/types/index.ts`. NO code duplication is permitted.

## Architecture Standards

### Database Requirements
- pgvector 17 with AWS Bedrock Titan v2 embeddings
- Postgres functions for vector operations
- Drizzle/DrizzleKit for database schema management
- User-scoped and global memory management
- Proper indexing for semantic search performance

### API and Integration Standards
- OpenAI-compatible API endpoints for model access
- Comprehensive MCP server configuration
- Real-time data processing capabilities
- RESTful API design with proper error handling
- WebSocket support for real-time updates

### Agent and Workflow Architecture
- Intent classification for intelligent routing
- Knowledge-first planning workflows
- Multi-agent orchestration capabilities
- Memory integration with authentication middleware
- Performance metrics collection and analysis

## Development Workflow

### Code Quality Requirements
- TypeScript strict mode with ES2022 target
- Zod schemas for all input/output validation
- Comprehensive error handling and logging
- async/await patterns throughout codebase
- Named exports preferred over default exports

### Testing and Validation
- All code MUST be validated against Mastra MCP docs server
- Unit tests using Vitest or Jest
- Integration tests for agent workflows
- Mock external API calls in tests
- Test files named `<module>.test.ts`

### Documentation and Standards
- All architectural decisions documented in `docs/` directory
- Conventional commit messages required
- Feature documentation with examples
- API documentation with OpenAPI specifications
- README files for complex features

## Governance

This constitution supersedes all other development practices and standards. All code changes MUST comply with these principles before merging. Amendments require:

1. Documentation of proposed changes with rationale
2. Validation against existing codebase architecture
3. Migration plan for existing code if needed
4. Approval through standard review process

All pull requests MUST verify compliance with constitution principles. Any architectural complexity MUST be justified against business intelligence requirements. The `docs/README.md` serves as the authoritative source for detailed implementation guidance.

**Version**: 1.0.0 | **Ratified**: 2025-01-18 | **Last Amended**: 2025-01-18