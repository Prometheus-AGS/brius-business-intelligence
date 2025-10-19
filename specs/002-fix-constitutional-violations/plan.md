# Implementation Plan: Constitutional Compliance Fixes

**Branch**: `002-fix-constitutional-violations` | **Date**: 2025-01-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-fix-constitutional-violations/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implementation of critical constitutional compliance fixes for the Mastra Business Intelligence System, addressing four key violations: migration from Supabase database to pgvector 17 with postgres functions, comprehensive LangFuse observability integration, Supabase MCP server configuration, and validation against latest Mastra APIs. This ensures architectural integrity and constitutional adherence before any further development.

## Technical Context

**Language/Version**: TypeScript 5.3+ with Node.js 20+ (existing Mastra framework requirements)
**Primary Dependencies**: pg npm module, drizzle-orm/drizzle-kit, pgvector, LangFuse SDK, @modelcontextprotocol/sdk, existing Mastra framework
**Storage**: pgvector 17 database with postgres functions (constitutional requirement - replaces Supabase)
**Testing**: Vitest for unit tests, integration tests for database migration and MCP server functionality
**Target Platform**: Node.js server environment with Docker containerization
**Project Type**: Single project with feature-based architecture under src/mastra/
**Performance Goals**: Database migration with no performance degradation, comprehensive tracing with <10ms overhead
**Constraints**: Zero downtime migration, maintain API compatibility, constitutional compliance mandatory
**Scale/Scope**: Migration affects all vector operations, observability covers 100% of system interactions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. pgvector Database Architecture (NON-NEGOTIABLE)**: This plan specifically addresses the constitutional violation by migrating from Supabase to pgvector 17 with postgres functions via pg npm module or drizzle/drizzlekit.

✅ **II. Mastra Framework Compliance**: Plan includes validation against latest Mastra APIs using mastra mcp server and context7 mcp server to ensure constitutional compliance.

✅ **III. Comprehensive Observability with LangFuse**: Plan mandates implementation of comprehensive tool call tracing including requests, results, and errors as constitutionally required.

✅ **IV. Model Context Protocol (MCP) Integration**: Plan includes proper Supabase MCP server configuration using built-in capabilities as mandated by constitution.

✅ **V. Feature-Based Clean Architecture**: Plan maintains existing feature-based organization under src/mastra/ with proper type management and no code duplication.

**Gate Status**: ✅ PASS - All constitutional principles are directly addressed by this compliance fix plan.

## Project Structure

### Documentation (this feature)

```
specs/002-fix-constitutional-violations/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

Constitutional compliance fixes will modify existing Mastra structure:

```
src/mastra/
├── config/
│   ├── database.ts         # Modified: Replace Supabase with pgvector 17
│   ├── mcp-client.ts       # Modified: Add Supabase MCP server config
│   └── environment.ts      # Modified: Add pgvector connection vars
├── database/               # NEW: pgvector 17 implementation
│   ├── connection.ts       # NEW: Direct pgvector connection via pg
│   ├── functions/          # NEW: Postgres functions directory
│   │   ├── vector-ops.sql  # NEW: Vector operation functions
│   │   └── migrations.sql  # NEW: Migration from Supabase
│   └── schema.ts           # Modified: Drizzle schema for pgvector
├── memory/
│   ├── storage.ts          # Modified: Replace Supabase with pgvector calls
│   └── embeddings.ts       # Modified: Use pgvector functions
├── knowledge/
│   └── search.ts           # Modified: Replace Supabase with pgvector calls
├── observability/
│   ├── langfuse.ts         # Modified: Comprehensive tool call tracing
│   ├── tracer.ts           # NEW: Enhanced tracing middleware
│   └── logger.ts           # Modified: Enhanced error capture
├── mcp/
│   └── config-loader.ts    # Modified: Add Supabase MCP server
└── types/
    ├── database.ts         # Modified: pgvector-specific types
    └── observability.ts    # NEW: Comprehensive tracing types

tests/
├── integration/
│   ├── database-migration.test.ts  # NEW: Migration testing
│   ├── langfuse-tracing.test.ts    # NEW: Observability testing
│   └── mcp-server.test.ts          # NEW: MCP server testing
└── unit/
    ├── pgvector.test.ts            # NEW: Database function tests
    └── postgres-functions.test.ts   # NEW: SQL function tests

migrations/                         # NEW: Database migration scripts
├── 001-setup-pgvector.sql         # NEW: Initial pgvector setup
├── 002-migrate-from-supabase.sql  # NEW: Data migration script
└── 003-create-functions.sql       # NEW: Postgres function creation

docker/                            # Modified: Update for pgvector
└── postgres.Dockerfile            # Modified: pgvector 17 container
```

**Structure Decision**: Using existing single project Mastra structure with targeted modifications for constitutional compliance. All changes maintain feature-based organization while replacing non-compliant components (Supabase database) with constitutional requirements (pgvector 17 + postgres functions).

## Complexity Tracking

*No constitutional violations - this plan addresses existing violations to achieve compliance.*

