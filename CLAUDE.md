# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL ARCHITECTURAL RULES (NEVER BREAK THESE)

### 1. Feature-Based Clean Architecture
- **MANDATORY**: Use feature-based clean architecture pattern throughout the codebase
- Organize code by business features, not technical layers
- Each feature should be self-contained with its own types, logic, and interfaces

### 2. Shared Types Management (CRITICAL)
- **ALL shared types MUST be placed in `src/mastra/types/*` directory**
- **Export all types through `src/mastra/types/index.ts`**
- Never duplicate type definitions across features
- Use a single source of truth for all shared interfaces and types

### 3. Documentation-Driven Development
- All architectural and development standards decisions are documented in the `docs/` subdirectory
- **ALWAYS refer to `docs/` for the current architectural plan**
- Update documentation when making architectural changes

### 4. Code Validation Requirements (MANDATORY)
- **ALWAYS validate generated code using the context7 MCP server**
- **ALWAYS validate against the Mastra MCP docs server**
- Ensure all code follows Mastra framework best practices
- Use Zod schemas for all input/output validation

### 5. Code Duplication Prevention (CRITICAL)
- **Avoid duplicating any code or types**
- When creating or extending features, use existing classes and implementations
- **NEVER create "enhanced*" versions of classes** (e.g., EnhancedWeatherAgent)
- Maintain **ONE version** of any implementation to avoid confusion

### 6. Agent & Workflow Registration (NEVER BREAK THIS RULE)
- **When generating new agent or workflow code, ALWAYS register them with the main Mastra object**
- **All agents and workflows MUST be visible in the Mastra playground**
- **NEVER, EVER break this rule** - registration is mandatory
- Register in `src/mastra/index.ts`

### 7. Agent & Workflow Design Logic

Follow this hierarchy for designing agents and workflows:

#### Workflows Containing Agents (Preferred Pattern)
- Workflows provide structured, deterministic execution with explicit control flow
- Include agents as steps when you need:
  - Natural language generation from user input
  - Reasoning or decision-making at specific points
  - LLM-powered transformations in a larger pipeline

#### Agents Using Workflows (Also Supported)
- Agents can use workflows as tools for predefined sequences
- Use when agents need to trigger complex multi-step operations

#### Best Practices:
- **Use workflows when** you need:
  - Explicit control over execution order
  - Human-in-the-loop approvals
  - State persistence and resumability
  - Parallel or branching execution paths

- **Use agents when** you need:
  - Autonomous reasoning and decision-making
  - Dynamic tool selection
  - Open-ended problem solving

- **General Pattern**: **Workflows orchestrate the structure, agents provide the intelligence within that structure**

## Package Management (CRITICAL)
**pnpm is the ONLY package manager allowed** - never use npm or yarn. This is a strict requirement for all operations:
- Use `pnpm install` for installing dependencies
- Use `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm start` for all script commands
- Maintain `pnpm-lock.yaml` for version consistency
- All documentation and scripts must reference pnpm commands

## Essential Commands

### Development Workflow
- **Install dependencies**: `pnpm install` (uses pnpm lockfile for version consistency)
- **Development server**: `pnpm dev` (starts Mastra dev server with live reload)
- **Build project**: `pnpm build` (generates production bundle)
- **Start production**: `pnpm start` (executes compiled output)
- **Tests**: `pnpm test` (currently placeholder - needs test runner setup)

### Single Test/Development Operations
- **Run specific test**: Replace placeholder test script first - recommend Vitest or Jest
- **Test individual workflow**: Run Mastra programmatically against fixture inputs
- **Database persistence**: Change LibSQL URL from `:memory:` to `file:../mastra.db` in `src/mastra/index.ts:13`

## Architecture Overview

### Mastra Framework Structure
This is a **Mastra-based business intelligence application** for orchestrating AI agents, tools, and workflows using **feature-based clean architecture**. The core entry point is `src/mastra/index.ts` which registers all components.

**Key architectural components:**
- **Agents**: AI entities with specific instructions, memory, and tool access
- **Tools**: Executable functions with Zod input/output schemas
- **Workflows**: Multi-step processes that chain tools and agents together
- **Storage**: LibSQL for persistence (observability, scores, agent memory)
- **Observability**: AI tracing with DefaultExporter and CloudExporter

### Module Organization (UPDATED)
```
src/mastra/
├── index.ts              # Main Mastra configuration and registration (CRITICAL)
├── agents/               # AI agents with instructions and memory
├── tools/                # Executable tools with Zod schemas
├── workflows/            # Multi-step workflow pipelines
└── types/                # MANDATORY: All shared types go here
    ├── index.ts          # Central type exports (REQUIRED)
    ├── agents.ts         # Agent-related types
    ├── workflows.ts      # Workflow-related types
    └── tools.ts          # Tool-related types

docs/                     # Architectural decisions and standards (REFERENCE)
```

### Code Patterns & Conventions
- **File naming**: kebab-case (`weather-agent.ts`, `weather-tool.ts`)
- **IDs**: hyphenated and descriptive (`get-weather`, `fetch-weather`)
- **Exports**: Named exports preferred over default exports
- **Validation**: Zod schemas for all input/output validation
- **Async patterns**: async/await throughout codebase
- **Instructions**: Keep AI prompts in template literals with consistent indentation
- **TypeScript**: ECMAScript modules, strict mode enabled, ES2022 target

### Example Implementation Pattern
The weather system demonstrates the full architecture:
- `weather-tool.ts`: Fetches current weather via Open-Meteo API
- `weather-agent.ts`: OpenAI GPT-4o-mini agent with memory and tools
- `weather-workflow.ts`: Two-step workflow (fetch weather → plan activities)

### Testing Strategy
- Use Vitest or Jest for unit tests around tools and pure helpers
- Mock external HTTP calls (Open-Meteo, geocoding APIs)
- Test workflows programmatically with fixture inputs and assert structured outputs
- Name test files `<module>.test.ts` beside implementation

### Environment Configuration
- **API Keys**: Store in `.env` files (gitignored)
- **Memory persistence**: Agent memory persists via LibSQL (`file:../mastra.db`)
- **App storage**: Default in-memory (`:memory:`) - change for persistence
- **Node version**: Requires >=20.9.0
- **Package manager**: pnpm (lockfile tracked)

### Repository Guidelines
- Follow conventional commit messages (`feat: add tide forecast tool`)
- Each PR should include test evidence and scenario notes
- Write hyphenated, descriptive IDs for agents, tools, and workflow steps
- Mirror existing weather example for new component patterns
- **Export all shared types from `src/mastra/types/index.ts`**

## Validation Checklist (MANDATORY)

Before committing any code:
- [ ] Types are properly exported from `src/mastra/types/index.ts`
- [ ] No code duplication exists
- [ ] Agents/workflows are registered in `src/mastra/index.ts`
- [ ] Code validated against context7 MCP server
- [ ] Code validated against Mastra MCP docs server
- [ ] Tests are written and passing
- [ ] Documentation is updated if architectural changes were made
- [ ] Zod schemas are used for validation where applicable
- [ ] Feature-based clean architecture pattern is followed
- [ ] pnpm is used for all package management operations
- [ ] pnpm-lock.yaml is maintained and up to date
