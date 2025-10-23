# Implementation Plan: Business Intelligence Context Enhancement

**Branch**: `004-specify-scripts-bash` | **Date**: 2025-10-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-specify-scripts-bash/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enhancement of the existing Brius Business Intelligence system to implement proper JWT-based context management, multi-domain data analysis capabilities, and React component generation. The feature focuses on maintaining user identity and permissions throughout complex analysis workflows while providing architectural evaluation capabilities for optimal agent patterns. Core deliverables include context-aware querying across clinical, financial, operational, and customer service domains with exportable TypeScript React visualizations.

## Technical Context

**Language/Version**: TypeScript ES2022, Node.js 20.9.0+
**Primary Dependencies**: Mastra framework (@mastra/core), AWS Bedrock, pgvector 17, React 16.8+, JWT, Zod validation
**Storage**: PostgreSQL with pgvector extensions, Supabase (external data), local pgvector for agent memory/knowledge
**Testing**: Vitest or Jest with async/await patterns, mocked external API calls
**Target Platform**: Linux server environment with Docker containerization
**Project Type**: Enterprise web application with API backend and agent system
**Performance Goals**: 95% of queries <30s, 100+ concurrent users, 99% context passing reliability
**Constraints**: JWT 8-hour sessions, role-based department/region filtering, 95% uptime requirement
**Scale/Scope**: Multi-domain BI system (clinical, financial, operational, customer service), TSX React component generation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. pgvector Database Architecture ✅ COMPLIANT
- **Requirement**: Local database for agent memory/knowledge MUST use pgvector 17
- **Implementation**: Feature will use local pgvector for user-specific and global memory operations, with Supabase MCP server for external business data access only
- **Status**: PASS - Maintains separation between agent storage (local pgvector) and business data (Supabase)

### II. Mastra Framework Compliance ✅ COMPLIANT
- **Requirement**: Follow Mastra best practices, validate against MCP servers, mandatory registration
- **Implementation**: All agents, workflows, and tools will be registered with main Mastra object and visible in playground
- **Status**: PASS - Architecture evaluation will validate against Mastra patterns, all components will be properly registered

### III. Comprehensive Observability with LangFuse ✅ COMPLIANT
- **Requirement**: Tool call tracing to LangFuse with requests, results, and errors
- **Implementation**: All context-related operations, agent interactions, and workflow executions will be traced to LangFuse
- **Status**: PASS - FR-012 explicitly requires comprehensive logging and error tracking

### IV. Model Context Protocol (MCP) Integration ✅ COMPLIANT
- **Requirement**: Supabase MCP server integration with proper configuration
- **Implementation**: Feature specifically requires using brius-supabase MCP server for database analysis and business data access
- **Status**: PASS - MCP integration is core to the feature requirements for database schema validation

### V. Feature-Based Clean Architecture ✅ COMPLIANT
- **Requirement**: Feature-based organization, shared types in src/mastra/types/, no code duplication
- **Implementation**: Context management, visualization generation, and architecture evaluation will be organized as distinct features
- **Status**: PASS - Will follow existing codebase patterns for type organization and feature separation

**Overall Gate Status**: ✅ PASS - All constitutional requirements satisfied

### Post-Design Re-evaluation ✅ CONFIRMED
- **pgvector Architecture**: Data model confirms local pgvector for agent memory, separate from Supabase business data
- **Mastra Compliance**: API contracts and data models align with Mastra patterns, agent context updated successfully
- **Observability**: Comprehensive tracing planned for all context operations and workflow executions
- **MCP Integration**: Contracts specify proper MCP metadata handling and context passing
- **Architecture Organization**: Feature-based structure maintained with proper type exports through index.ts

**Final Gate Status**: ✅ PASS - Design maintains constitutional compliance

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
src/mastra/
├── agents/
│   ├── business-intelligence.ts    # Enhanced with context management
│   ├── orchestrator.ts            # Updated for context passing
│   └── shared-tools.ts            # MCP tool integration
├── workflows/
│   ├── context-validation.ts      # New: Context reconstruction workflow
│   ├── architecture-evaluation.ts # New: Agent pattern benchmarking
│   └── visualization-generation.ts # New: React component generation
├── tools/
│   ├── context-tools.ts           # New: Context management utilities
│   ├── visualization-tools.ts     # New: TSX component generators
│   └── architecture-tools.ts      # New: Pattern evaluation tools
├── types/
│   ├── context.ts                 # New: Context and JWT types
│   ├── visualization.ts           # New: React component types
│   └── index.ts                   # Updated: Export new types
├── api/
│   ├── routes/
│   │   ├── context.ts             # New: Context management endpoints
│   │   └── visualization.ts       # New: Component generation endpoints
│   └── middleware/
│       └── jwt-context.ts         # New: JWT context extraction
├── memory/
│   ├── context-store.ts           # Enhanced: User-scoped memory
│   └── session-manager.ts         # New: Session context management
└── observability/
    └── context-tracer.ts          # New: Context operation tracing

tests/
├── integration/
│   ├── context-workflows.test.ts  # Context passing validation
│   └── agent-patterns.test.ts     # Architecture evaluation tests
└── unit/
    ├── context-tools.test.ts      # Context utility tests
    └── visualization.test.ts      # React generation tests
```

**Structure Decision**: Extending existing Mastra feature-based architecture. Context management is implemented as a cross-cutting concern with dedicated tools and middleware, while visualization generation and architecture evaluation are separate feature modules. All shared types consolidated in `src/mastra/types/` per constitution requirements.

## Complexity Tracking

*No constitutional violations identified - all complexity justified by business intelligence requirements*

## Phase Completion Summary

### Phase 0: Research ✅ COMPLETED
- **Output**: `research.md` with all technical decisions documented
- **Key Decisions**: JWT refresh strategy, React component generation, MCP context passing, agent architecture evaluation, database analysis patterns
- **Status**: All NEEDS CLARIFICATION items resolved

### Phase 1: Design & Contracts ✅ COMPLETED
- **Outputs**:
  - `data-model.md` - Complete entity definitions with relationships and validation rules
  - `contracts/context-api.yaml` - OpenAPI specification for context management endpoints
  - `contracts/visualization-api.yaml` - OpenAPI specification for React component generation
  - `quickstart.md` - Development guide with setup instructions and examples
- **Agent Context**: Updated successfully with new technology stack
- **Status**: Design artifacts ready for implementation

### Next Phase: Implementation Planning
- **Command**: `/speckit.tasks` to generate detailed implementation tasks
- **Prerequisites**: All planning artifacts completed and validated
- **Estimated Effort**: 2-3 weeks for full feature implementation

