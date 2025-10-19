# Tasks: Constitutional Compliance Fixes

**Input**: Design documents from `/specs/002-fix-constitutional-violations/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: No test tasks included - not explicitly requested in feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create migrations directory structure with scripts at migrations/001-setup-pgvector.sql, migrations/002-create-functions.sql
- [x] T002 [P] Install pgvector dependencies (pg, @types/pg, drizzle-orm, drizzle-kit, pgvector, @aws-sdk/client-bedrock-runtime) via pnpm
- [x] T003 [P] Create Docker compose configuration for pgvector 17 database at docker-compose.yml
- [x] T004 [P] Update environment configuration with pgvector connection string and AWS Bedrock settings in src/mastra/config/environment.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Start pgvector 17 Docker container and verify extension availability via docker-compose up
- [x] T006 [P] Create pgvector database connection configuration in src/mastra/config/database.ts
- [x] T007 [P] Install LangFuse SDK and MCP dependencies (langfuse, @modelcontextprotocol/sdk, @supabase/mcp-server-supabase) via pnpm
- [x] T008 [P] Create base MCP client configuration structure in src/mastra/config/mcp-client.ts
- [x] T009 Create comprehensive error handling and circuit breaker infrastructure in src/mastra/observability/error-handling.ts
- [x] T010 Setup base Drizzle ORM schema with pgvector types in src/mastra/database/schema.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Database Architecture Compliance (Priority: P1) 🎯 MVP

**Goal**: Replace Supabase database with pgvector 17 using postgres functions via pg module or drizzle/drizzlekit

**Independent Test**: Verify database connections use pgvector 17, all vector operations use postgres functions, and no Supabase database dependencies exist

### Database Schema and Functions Implementation

- [ ] T011 [P] [US1] Create user_memories table schema with vector embedding column in src/mastra/database/schema.ts
- [ ] T012 [P] [US1] Create global_memories table schema with access control in src/mastra/database/schema.ts
- [ ] T013 [P] [US1] Create knowledge_documents table schema with file metadata in src/mastra/database/schema.ts
- [ ] T014 [P] [US1] Create document_chunks table schema with vector embeddings in src/mastra/database/schema.ts
- [ ] T015 [US1] Execute pgvector setup migration creating tables and HNSW indexes via migrations/001-setup-pgvector.sql
- [ ] T016 [US1] Create semantic_search postgres function for vector similarity operations in migrations/002-create-functions.sql
- [ ] T017 [US1] Create hybrid_search postgres function combining text and vector search in migrations/002-create-functions.sql
- [ ] T018 [US1] Apply postgres functions migration to database via docker exec

### Database Service Layer Implementation

- [ ] T019 [US1] Implement pgvector connection manager with proper connection pooling in src/mastra/database/connection.ts
- [ ] T020 [US1] Create vector operations service calling postgres functions via Drizzle in src/mastra/database/vector-ops.ts
- [ ] T021 [US1] Replace memory storage implementation to use pgvector functions in src/mastra/memory/storage.ts
- [ ] T022 [US1] Replace knowledge search implementation to use pgvector functions in src/mastra/knowledge/search.ts
- [ ] T023 [US1] Update embedding service to work with pgvector storage in src/mastra/memory/embeddings.ts

### Migration and Validation

- [ ] T024 [US1] Create data migration script from existing Supabase data (if any) to pgvector in migrations/003-migrate-data.sql
- [ ] T025 [US1] Update main Mastra configuration to use pgvector database connection in src/mastra/index.ts
- [ ] T026 [US1] Remove all Supabase database dependencies from codebase and update imports
- [ ] T027 [US1] Validate pgvector operations work correctly via health check endpoint

**Checkpoint**: At this point, User Story 1 should be fully functional with pgvector 17 database replacing Supabase

---

## Phase 4: User Story 2 - Comprehensive Observability Integration (Priority: P1)

**Goal**: Implement comprehensive LangFuse tracing for all tool calls, agent interactions, and workflow executions

**Independent Test**: Execute system operations and verify all tool calls, requests, results, and errors are properly traced in LangFuse

### LangFuse Integration Infrastructure

- [x] T028 [P] [US2] Create comprehensive LangFuse client with circuit breaker in src/mastra/observability/langfuse-client.ts
- [x] T029 [P] [US2] Implement enhanced tracing middleware for tool calls in src/mastra/observability/tool-tracer.ts
- [x] T030 [P] [US2] Create agent interaction tracing service in src/mastra/observability/agent-tracer.ts
- [x] T031 [P] [US2] Implement workflow execution tracing in src/mastra/observability/workflow-tracer.ts

### Comprehensive Tracing Implementation

- [x] T032 [US2] Create comprehensive trace metadata types in src/mastra/types/observability.ts
- [x] T033 [US2] Implement tool call tracing with request/response/error capture in src/mastra/observability/comprehensive-tracer.ts
- [x] T034 [US2] Add agent interaction logging with user attribution and context in src/mastra/agents/base-agent.ts
- [x] T035 [US2] Integrate workflow step performance tracking and checkpoints in src/mastra/workflows/base-workflow.ts
- [x] T036 [US2] Implement error tracking service with comprehensive context capture in src/mastra/observability/error-tracker.ts

### LangFuse API Endpoints

- [x] T037 [P] [US2] Create observability API endpoints for trace creation in src/mastra/api/observability/traces.ts
- [ ] T038 [P] [US2] Implement tool call trace update endpoints in src/mastra/api/observability/tool-calls.ts
- [ ] T039 [P] [US2] Create agent interaction recording endpoints in src/mastra/api/observability/agents.ts
- [ ] T040 [P] [US2] Implement workflow step status endpoints in src/mastra/api/observability/workflows.ts
- [ ] T041 [P] [US2] Create error capture and analysis endpoints in src/mastra/api/observability/errors.ts

### Integration and Health Monitoring

- [ ] T042 [US2] Integrate comprehensive tracing into existing agents and workflows
- [ ] T043 [US2] Implement LangFuse circuit breaker health monitoring in src/mastra/observability/health-monitor.ts
- [ ] T044 [US2] Create observability health check endpoint in src/mastra/api/health/observability.ts
- [ ] T045 [US2] Validate comprehensive tracing captures all system interactions correctly

**Checkpoint**: At this point, User Story 2 should provide complete observability coverage with LangFuse tracing

---

## Phase 5: User Story 3 - MCP Server Integration (Priority: P2)

**Goal**: Implement Supabase MCP server integration using built-in capabilities for external protocol communication

**Independent Test**: Configure Supabase MCP server and verify external clients can connect and execute operations through MCP protocol

### MCP Configuration and Client Setup

- [ ] T046 [P] [US3] Create MCP server configuration file at mcp.json with Supabase, Mastra, and Context7 servers
- [ ] T047 [P] [US3] Implement MCP integration client with transport management in src/mastra/mcp/integration/client.ts
- [ ] T048 [P] [US3] Create MCP server configuration types in src/mastra/types/mcp.ts
- [ ] T049 [P] [US3] Implement MCP connection management service in src/mastra/mcp/connection-manager.ts

### MCP API Implementation

- [ ] T050 [P] [US3] Create MCP server listing and management endpoints in src/mastra/api/mcp/servers.ts
- [ ] T051 [P] [US3] Implement MCP server connection endpoints in src/mastra/api/mcp/connections.ts
- [ ] T052 [P] [US3] Create MCP tool listing and execution endpoints in src/mastra/api/mcp/tools.ts
- [ ] T053 [P] [US3] Implement Supabase MCP server setup endpoints in src/mastra/api/mcp/supabase.ts

### MCP Integration Services

- [ ] T054 [US3] Integrate MCP client with comprehensive tracing from User Story 2
- [ ] T055 [US3] Create MCP tool registry service in src/mastra/mcp/tool-registry.ts
- [ ] T056 [US3] Implement Supabase MCP server health monitoring in src/mastra/mcp/health-checker.ts
- [ ] T057 [US3] Add MCP server status to main health check endpoint

### Supabase MCP Server Configuration

- [ ] T058 [US3] Configure Supabase MCP server using NPX-based built-in capabilities
- [ ] T059 [US3] Test external MCP client connections to Supabase server
- [ ] T060 [US3] Validate MCP protocol compliance and error handling
- [ ] T061 [US3] Create MCP server management dashboard endpoints

**Checkpoint**: At this point, User Story 3 should enable external systems to access functionality through Supabase MCP server

---

## Phase 6: User Story 4 - API Validation and Compliance (Priority: P2)

**Goal**: Validate all Mastra framework usage against latest APIs using MCP servers for constitutional compliance

**Independent Test**: Run validation checks against Mastra and Context7 MCP servers confirming all framework usage follows current specifications

### API Validation Framework

- [ ] T062 [P] [US4] Create framework validation service in src/mastra/validation/framework-validator.ts
- [ ] T063 [P] [US4] Implement Mastra API compliance checker using Mastra MCP server in src/mastra/validation/mastra-validator.ts
- [ ] T064 [P] [US4] Create Context7 documentation validation using Context7 MCP server in src/mastra/validation/context7-validator.ts
- [ ] T065 [P] [US4] Define API validation result types in src/mastra/types/validation.ts

### Validation API Endpoints

- [ ] T066 [P] [US4] Create Mastra framework validation endpoints in src/mastra/api/validation/mastra.ts
- [ ] T067 [P] [US4] Implement Context7 compliance validation endpoints in src/mastra/api/validation/context7.ts
- [ ] T068 [P] [US4] Create comprehensive validation report endpoints in src/mastra/api/validation/reports.ts

### Framework Compliance Implementation

- [ ] T069 [US4] Integrate validation checks with existing agent and workflow registration
- [ ] T070 [US4] Create automated validation scripts for development workflow in scripts/validate-compliance.js
- [ ] T071 [US4] Implement continuous validation monitoring in src/mastra/validation/continuous-monitor.ts
- [ ] T072 [US4] Add framework compliance to main health check endpoint

### Validation Integration and Reporting

- [ ] T073 [US4] Connect validation service to MCP clients from User Story 3
- [ ] T074 [US4] Create validation dashboard with compliance metrics
- [ ] T075 [US4] Test complete framework validation against both MCP servers
- [ ] T076 [US4] Validate all existing code meets constitutional compliance requirements

**Checkpoint**: At this point, User Story 4 should ensure complete API validation and constitutional compliance

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, testing, and constitutional compliance verification

- [ ] T077 [P] Create comprehensive constitutional health check endpoint in src/mastra/api/health/constitutional-health.ts
- [ ] T078 [P] Update documentation with constitutional compliance implementation details in docs/
- [ ] T079 Run complete constitutional compliance validation via scripts/validate-compliance.js
- [ ] T080 [P] Performance optimization for pgvector operations and observability overhead
- [ ] T081 Code cleanup and removal of any remaining Supabase database references
- [ ] T082 Run quickstart.md validation to ensure implementation matches documentation
- [ ] T083 Final constitutional compliance verification against all five principles

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User Story 1 (P1): Database compliance - can start after Foundational
  - User Story 2 (P1): Observability - can start after Foundational
  - User Story 3 (P2): MCP Integration - should start after User Story 2 (for tracing integration)
  - User Story 4 (P2): API Validation - should start after User Story 3 (needs MCP clients)
- **Polish (Final Phase)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 3 (P2)**: Benefits from User Story 2 completion for tracing integration (T054)
- **User Story 4 (P2)**: Requires User Story 3 completion for MCP client access (T073)

### Within Each User Story

- Database schema before service implementation
- Core services before API endpoints
- Integration tasks after individual component completion
- Health checks and validation after functional implementation

### Parallel Opportunities

- **Setup Phase**: All tasks marked [P] can run in parallel
- **Foundational Phase**: Tasks T006, T007, T008 can run in parallel after T005
- **User Story 1**: Database schema tasks (T011-T014) can run in parallel
- **User Story 2**: Infrastructure tasks (T028-T031) and API endpoints (T037-T041) can run in parallel
- **User Story 3**: Configuration tasks (T046-T049) and API endpoints (T050-T053) can run in parallel
- **User Story 4**: Validation services (T062-T065) can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all database schema tasks together:
Task: "Create user_memories table schema with vector embedding column in src/mastra/database/schema.ts"
Task: "Create global_memories table schema with access control in src/mastra/database/schema.ts"
Task: "Create knowledge_documents table schema with file metadata in src/mastra/database/schema.ts"
Task: "Create document_chunks table schema with vector embeddings in src/mastra/database/schema.ts"

# Launch all service layer implementations together (after schema):
Task: "Replace memory storage implementation to use pgvector functions in src/mastra/memory/storage.ts"
Task: "Replace knowledge search implementation to use pgvector functions in src/mastra/knowledge/search.ts"
Task: "Update embedding service to work with pgvector storage in src/mastra/memory/embeddings.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 - Both P1 Priority)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Database Architecture Compliance)
4. Complete Phase 4: User Story 2 (Comprehensive Observability)
5. **STOP and VALIDATE**: Test both user stories independently
6. Deploy/demo constitutional compliance foundation

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (Database compliance!)
3. Add User Story 2 → Test independently → Deploy/Demo (Full observability!)
4. Add User Story 3 → Test independently → Deploy/Demo (MCP integration!)
5. Add User Story 4 → Test independently → Deploy/Demo (Complete compliance!)
6. Each story adds constitutional compliance without breaking previous functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Database Architecture)
   - Developer B: User Story 2 (Observability)
3. After User Stories 1 & 2 complete:
   - Developer A: User Story 3 (MCP Integration)
   - Developer B: User Story 4 (API Validation)
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for constitutional compliance traceability
- Each user story addresses a specific constitutional violation
- User Stories 1 & 2 are both P1 priority and can be developed in parallel
- User Stories 3 & 4 are P2 priority with dependencies on earlier stories
- Constitutional compliance validation occurs throughout implementation
- All tasks maintain feature-based clean architecture as required by constitution
- Avoid: breaking existing functionality, creating duplicate code, violating architectural principles

**Total Tasks**: 83 tasks across 4 user stories
**Parallel Opportunities**: 25 tasks can run in parallel within their phases
**MVP Scope**: User Stories 1 & 2 (Database Architecture + Observability) = 45 tasks
**Constitutional Compliance**: All tasks directly address identified constitutional violations