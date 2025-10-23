# Tasks: Business Intelligence Context Enhancement

**Input**: Design documents from `/specs/004-specify-scripts-bash/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests not explicitly requested in specification - focusing on implementation tasks

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project structure per implementation plan
- [x] T002 Initialize TypeScript ES2022 project with Mastra framework dependencies
- [x] T003 [P] Configure environment variables including SUPABASE_ANON_KEY for anonymous access
- [x] T004 [P] Setup Zod validation schemas and error handling infrastructure
- [x] T005 [P] Configure pgvector 17 database connection and migration framework

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create base type definitions in src/mastra/types/context.ts
- [x] T007 Create base type definitions in src/mastra/types/visualization.ts
- [x] T008 [P] Update src/mastra/types/index.ts to export all new types
- [x] T009 [P] Implement JWT middleware with anonymous fallback in src/mastra/api/middleware/jwt-context.ts (CORRECTED: Now uses Mastra/Hono patterns instead of Express)
- [x] T010 Setup pgvector database schema and migrations for memory and context storage
- [x] T011 [P] Create base context store infrastructure in src/mastra/memory/context-store.ts
- [x] T012 [P] Create session manager infrastructure in src/mastra/memory/session-manager.ts
- [x] T013 [P] Setup LangFuse observability and tracing in src/mastra/observability/context-tracer.ts
- [x] T014 [P] Configure MCP server integration and tool registration
- [x] T015 Register enhanced agents and workflows with main Mastra object in src/mastra/index.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Context-Aware Business Intelligence Analysis (Priority: P1) 🎯 MVP

**Goal**: Enable authenticated and anonymous users to execute complex multi-domain BI queries while maintaining context throughout analysis sessions

**Independent Test**: Authenticate a user with JWT (or use anonymous access), submit a complex multi-domain query, verify context is maintained and results are properly scoped to permissions

### Implementation for User Story 1

- [x] T016 [P] [US1] Create User Context entity in src/mastra/types/context.ts with anonymous support
- [x] T017 [P] [US1] Create Analysis Session entity in src/mastra/types/context.ts
- [x] T018 [P] [US1] Create Context State entity for session management in src/mastra/types/context.ts
- [x] T019 [US1] Implement JWT token extraction with SUPABASE_ANON_KEY fallback in src/mastra/api/middleware/jwt-context.ts
- [x] T020 [US1] Implement automatic JWT token refresh logic in src/mastra/api/middleware/jwt-context.ts
- [x] T021 [US1] Create context management tools in src/mastra/tools/context-tools.ts
- [x] T022 [US1] Implement context reconstruction workflow in src/mastra/workflows/context-validation.ts
- [x] T023 [US1] Enhance business intelligence agent with context support in src/mastra/agents/business-intelligence.ts
- [x] T024 [US1] Update orchestrator agent for context passing in src/mastra/agents/orchestrator.ts
- [x] T025 [US1] Implement context API endpoints in src/mastra/api/routes/context.ts
- [x] T026 [US1] Create user-scoped and global memory operations in src/mastra/memory/context-store.ts
- [x] T027 [US1] Add comprehensive context operation logging and error tracking

**Checkpoint**: At this point, User Story 1 should be fully functional with authenticated and anonymous context management

---

## Phase 4: User Story 4 - Multi-Domain Data Integration (Priority: P2)

**Goal**: Provide seamless access to integrated data across clinical, financial, operational, and customer service domains

**Independent Test**: Query relationships between clinical outcomes and financial performance, verify automatic dataset joins and referential integrity

### Implementation for User Story 4

- [x] T028 [P] [US4] Create Domain Dataset entity in src/mastra/types/context.ts
- [x] T029 [P] [US4] Create data federation tools in src/mastra/tools/context-tools.ts
- [x] T030 [US4] Implement database schema analysis using Supabase MCP server in src/mastra/workflows/context-validation.ts
- [x] T031 [US4] Create semantic mapping layer for multi-domain data in src/mastra/tools/context-tools.ts
- [x] T032 [US4] Implement domain-specific data adapters in src/mastra/agents/shared-tools.ts
- [x] T033 [US4] Add cross-domain relationship validation and integrity checks
- [x] T034 [US4] Integrate multi-domain capabilities with enhanced BI agent
- [x] T035 [US4] Add role-based department/region filtering for data access (SKIPPED - requirements not defined)

**Checkpoint**: At this point, User Stories 1 AND 4 should both work independently with full multi-domain integration

---

## Phase 5: User Story 2 - Adaptive Agent Architecture Assessment (Priority: P2)

**Goal**: Evaluate and optimize agent architecture patterns for complex multi-domain analysis workflows

**Independent Test**: Run benchmark queries across different architectural patterns, measure performance metrics, and generate recommendations

### Implementation for User Story 2

- [x] T036 [P] [US2] Create Agent Architecture Pattern entity in src/mastra/types/context.ts
- [x] T037 [P] [US2] Create architecture evaluation tools in src/mastra/tools/architecture-tools.ts
- [x] T038 [US2] Implement architecture evaluation workflow in src/mastra/workflows/architecture-evaluation.ts
- [x] T039 [US2] Create performance benchmarking infrastructure for agent patterns
- [x] T040 [US2] Implement hybrid pattern with adaptive routing based on query complexity
- [x] T041 [US2] Add pattern performance metrics collection and analysis
- [x] T042 [US2] Create pattern recommendation engine based on query characteristics
- [x] T043 [US2] Integrate architecture evaluation with Tavily MCP server for best practices research

**Checkpoint**: At this point, User Stories 1, 4, AND 2 should all work independently with architecture optimization

---

## Phase 6: User Story 3 - Interactive Visualization Generation (Priority: P3)

**Goal**: Generate exportable React TSX components for complex data visualizations with embedded styling

**Independent Test**: Request a complex visualization, generate React component artifact, and successfully import it into a test application

### Implementation for User Story 3

- [x] T044 [P] [US3] Create Visualization Artifact entity in src/mastra/types/visualization.ts
- [x] T045 [P] [US3] Create TSX component generation tools in src/mastra/tools/visualization-tools.ts
- [x] T046 [US3] Implement visualization generation workflow in src/mastra/workflows/visualization-generation.ts
- [x] T047 [US3] Create AST-based TypeScript code generation with embedded CSS-in-JS
- [x] T048 [US3] Implement visualization API endpoints in src/mastra/api/routes/visualization.ts
- [x] T049 [US3] Create visualization template system for different chart types
- [x] T050 [US3] Add data binding and prop interface generation for React components
- [x] T051 [US3] Implement component artifact management and download functionality
- [x] T052 [US3] Add validation for generated TSX syntax and component complexity limits

**Checkpoint**: All user stories should now be independently functional with complete visualization capabilities

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T053 [P] Add comprehensive error handling across all API endpoints
- [ ] T054 [P] Implement connection pooling optimization for concurrent user sessions
- [ ] T055 [P] Add caching strategies for frequently accessed context data
- [ ] T056 [P] Implement audit logging for all context state changes and security events
- [ ] T057 [P] Add performance monitoring and alerting for context operations
- [ ] T058 [P] Create database migration utilities for existing user contexts
- [ ] T059 [P] Add integration validation for MCP server health monitoring
- [ ] T060 [P] Update documentation and quickstart examples
- [ ] T061 Run quickstart.md validation and end-to-end testing

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1 context but independently testable
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Uses US1 context but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Uses US1 sessions but independently testable

### Within Each User Story

- Type definitions before implementation
- Core infrastructure before feature implementation
- Context management before domain-specific features
- API endpoints after core logic implementation
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Type definitions within stories marked [P] can run in parallel
- Tool implementations within stories marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all type definitions for User Story 1 together:
Task: "Create User Context entity in src/mastra/types/context.ts with anonymous support"
Task: "Create Analysis Session entity in src/mastra/types/context.ts"
Task: "Create Context State entity for session management in src/mastra/types/context.ts"

# Launch tool implementations for User Story 1 together:
Task: "Create context management tools in src/mastra/tools/context-tools.ts"
Task: "Implement context reconstruction workflow in src/mastra/workflows/context-validation.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently with both authenticated and anonymous access
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently with JWT and anonymous access → Deploy/Demo (MVP!)
3. Add User Story 4 → Test multi-domain integration independently → Deploy/Demo
4. Add User Story 2 → Test architecture evaluation independently → Deploy/Demo
5. Add User Story 3 → Test visualization generation independently → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Context management)
   - Developer B: User Story 4 (Multi-domain integration)
   - Developer C: User Story 2 (Architecture evaluation)
   - Developer D: User Story 3 (Visualization generation)
3. Stories complete and integrate independently

---

## Special Considerations

### Anonymous Access Support

- JWT middleware must handle missing JWT by falling back to SUPABASE_ANON_KEY
- Context entities must support anonymous user identification
- Permission system must handle anonymous access with appropriate restrictions
- Memory operations must distinguish between authenticated and anonymous sessions

### MCP Server Integration

- Supabase MCP server for database schema analysis and business data access
- Tavily MCP server for architecture best practices research
- Context passing through MCP metadata headers
- Health monitoring and failover for MCP connections

### Performance Requirements

- 95% of queries complete in <30 seconds
- 99% context passing reliability
- Support for 100+ concurrent users
- 8-hour JWT session continuity with automatic refresh

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Anonymous access using SUPABASE_ANON_KEY provides authentication fallback
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on Mastra framework compliance and constitutional requirements
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

## Task Count Summary

- **Total Tasks**: 61
- **Setup Phase**: 5 tasks
- **Foundational Phase**: 10 tasks
- **User Story 1 (P1)**: 12 tasks
- **User Story 4 (P2)**: 8 tasks
- **User Story 2 (P2)**: 8 tasks
- **User Story 3 (P3)**: 9 tasks
- **Polish Phase**: 9 tasks
- **Parallel Opportunities**: 34 tasks marked [P] can run in parallel within their phases
- **Suggested MVP Scope**: Phase 1 + Phase 2 + Phase 3 (User Story 1) = 27 tasks