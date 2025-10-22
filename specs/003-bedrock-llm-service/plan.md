# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.3+ with ES2022 target (confirmed from existing codebase)
**Primary Dependencies**: Mastra v0.1.x, @aws-sdk/client-bedrock-runtime v3.x, Langfuse v4.x with OpenTelemetry, Zod v3.x
**Storage**: PostgreSQL with pgvector extension via existing consolidated database service
**Testing**: Vitest (established pattern - needs setup for Bedrock service)
**Target Platform**: Node.js 20.9.0+ server-side TypeScript service
**Project Type**: single - feature-based clean architecture following existing patterns
**Performance Goals**: <500ms Claude 4 Sonnet generation, <200ms Titan v2 embeddings (1024 dimensions), concurrent request support
**Constraints**: AWS rate limits with circuit breaker, <100MB additional memory footprint, 1024 vector dimensions for Titan v2
**Scale/Scope**: 2 models (Claude 4 Sonnet, Titan v2), centralized service, 100% operation coverage with Langfuse

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

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
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
src/mastra/
├── types/
│   ├── bedrock.ts              # Bedrock service type definitions
│   ├── bedrock-config.ts       # Configuration interfaces
│   ├── bedrock-requests.ts     # Request type definitions
│   ├── bedrock-responses.ts    # Response type definitions
│   ├── bedrock-errors.ts       # Error handling types
│   └── bedrock-health.ts       # Health check types
├── config/
│   └── bedrock-model.ts        # Bedrock model configuration service
├── services/
│   ├── bedrock-llm-service.ts  # Main Bedrock LLM service implementation
│   └── circuit-breaker.ts      # Circuit breaker for resilience
├── tools/
│   └── bedrock-tools.ts        # Mastra tools for Claude & Titan
└── agents/
    └── business-intelligence.ts # Enhanced with Bedrock capabilities

tests/
├── integration/
│   └── bedrock-service.integration.test.ts
└── unit/
    └── bedrock-tools.unit.test.ts

specs/003-bedrock-llm-service/
├── spec.md                     # Feature specification
├── research.md                 # Phase 0 research findings
├── data-model.md               # Phase 1 data models
├── quickstart.md               # Implementation guide
└── contracts/                  # API contracts and schemas
    ├── service-interface.ts    # Service interface definitions
    ├── tool-schemas.ts         # Zod schemas for Mastra tools
    └── integration-points.ts   # Integration contracts
```

**Structure Decision**: Single project with feature-based clean architecture. The Bedrock LLM service follows the established Mastra pattern with centralized types in `src/mastra/types/`, service implementation in `src/mastra/services/`, and tool definitions in `src/mastra/tools/`. All components integrate with the existing consolidated database architecture and maintain compatibility with current agents and workflows.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

