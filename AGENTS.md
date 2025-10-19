# Repository Guidelines

## Architecture & Design Principles

### Feature-Based Clean Architecture
This project follows a **feature-based clean architecture pattern** built on the Mastra framework. Organize code by business features, not technical layers. Each feature should be self-contained with its own types, logic, and interfaces.

### Shared Types Management (CRITICAL)
- **ALL shared types MUST be placed in `src/mastra/types/*` directory**
- **Export all types through `src/mastra/types/index.ts`**
- Never duplicate type definitions across features
- Use a single source of truth for all shared interfaces and types

### Documentation-Driven Development
- All architectural and development standards decisions are documented in the `docs/` subdirectory
- **Always refer to `docs/` for the current architectural plan**
- Update documentation when making architectural changes

## Project Structure & Module Organization
Source lives under `src/mastra`. `index.ts` registers agents, workflows, storage, and logging. Place new agents in `src/mastra/agents`, tools in `src/mastra/tools`, and workflow pipelines in `src/mastra/workflows`; mirror the existing weather example for naming and export patterns.

**Directory Structure:**
```
src/mastra/
├── index.ts              # Main Mastra configuration and registration (CRITICAL)
├── agents/               # AI agents with instructions and memory
├── tools/                # Executable tools with Zod schemas
├── workflows/            # Multi-step workflow pipelines
└── types/
    ├── index.ts          # Central type exports (REQUIRED)
    ├── agents.ts         # Agent-related types
    ├── workflows.ts      # Workflow-related types
    └── tools.ts          # Tool-related types

docs/                     # Architectural decisions and standards
```

## Code Validation Requirements (MANDATORY)
- **ALWAYS validate generated code using the context7 MCP server**
- **ALWAYS validate against the Mastra MCP docs server**
- Ensure all code follows Mastra framework best practices
- Use Zod schemas for all input/output validation

## Code Duplication Prevention (CRITICAL)
- **Avoid duplicating any code or types**
- When creating or extending features, use existing classes and implementations
- **NEVER create "enhanced*" versions of classes** (e.g., EnhancedWeatherAgent)
- Maintain **ONE version** of any implementation to avoid confusion

## Agent & Workflow Registration (NEVER BREAK THIS RULE)
- **When generating new agent or workflow code, ALWAYS register them with the main Mastra object**
- **All agents and workflows MUST be visible in the Mastra playground**
- **NEVER, EVER break this rule** - registration is mandatory
- Register in `src/mastra/index.ts`

## Agent & Workflow Design Logic

Follow this hierarchy for designing agents and workflows:

### Workflows Containing Agents (Preferred Pattern)
Workflows provide structured, deterministic execution with explicit control flow. Include agents as steps when you need:
- Natural language generation from user input
- Reasoning or decision-making at specific points
- LLM-powered transformations in a larger pipeline

```javascript
const step1 = createStep({
  id: "step-1",
  execute: async ({ inputData }) => {
    const { text } = await testAgent.generate([
      { role: "user", content: `Process: ${inputData.input}` }
    ]);
    return { output: text };
  }
});

export const workflow = createWorkflow({...})
  .then(step1)
  .commit();
```

### Agents Using Workflows (Also Supported)
Agents can use workflows as tools when they need to trigger predefined sequences of steps or access complex multi-step operations:

```javascript
export const soccerAgent = new Agent({
  name: "soccer-agent",
  model: openai("gpt-4o"),
  workflows: { soccerWorkflow }  // Agent can call this workflow
});
```

### Best Practices:
1. **Use workflows when** you need:
   - Explicit control over execution order
   - Human-in-the-loop approvals
   - State persistence and resumability
   - Parallel or branching execution paths

2. **Use agents when** you need:
   - Autonomous reasoning and decision-making
   - Dynamic tool selection
   - Open-ended problem solving

3. **Combine them** by:
   - Giving agents clear boundaries and singular focus
   - Using structured outputs for reliable operations between agents and workflows
   - Making communication between components explicit

**General Pattern**: **Workflows orchestrate the structure, agents provide the intelligence within that structure**.

## Package Management (CRITICAL)
**pnpm is the ONLY package manager allowed** - never use npm or yarn. This is a strict requirement for all operations:
- Use `pnpm install` for installing dependencies
- Use `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm start` for all script commands
- Maintain `pnpm-lock.yaml` for version consistency
- All documentation and scripts must reference pnpm commands

## Build, Test, and Development Commands
Install dependencies with `pnpm install` (lockfile tracks versions). Run `pnpm dev` to start the Mastra development server with live reload. Use `pnpm build` to generate the production bundle, and `pnpm start` to execute the compiled output. `pnpm test` currently fails intentionally—replace the placeholder script with your preferred test runner before enabling CI checks.

## Coding Style & Naming Conventions
Codebase uses TypeScript with ECMAScript modules. Favor named exports and 2-space indentation. Follow the existing kebab-case file names (`weather-agent.ts`, `weather-tool.ts`). Agent IDs, tool IDs, and workflow step IDs should stay hyphenated and descriptive (e.g., `get-weather`). Prefer async/await, zod schemas for validation, and keep instructions or prompts inside template literals with consistent indentation.

## Testing Guidelines
Adopt Vitest or Jest for unit coverage around tools and pure helpers. Mock external HTTP calls (Open-Meteo, geocoding) when exercising steps. For workflow or agent integration checks, run Mastra programmatically against fixture inputs and assert structured outputs. Name test files `<module>.test.ts` beside the implementation, and ensure new features ship with at least one automated check.

## Commit & Pull Request Guidelines
Write conventional commit messages such as `feat: add tide forecast tool` to clarify history. Each pull request should include a concise summary, test evidence (`pnpm test`, manual scenario notes), and links to related Linear/Jira issues. Add screenshots or terminal captures when behavior changes, and request review once lint/tests pass locally.

## Environment & Configuration Tips
Default storage uses in-memory LibSQL; switch to `file:../mastra.db` or LibSQL cloud URLs for persistence. Keep API keys and non-public endpoints in `.env` files and document required variables in the PR description.

## Validation Checklist

Before committing any code:
- [ ] Types are properly exported from `src/mastra/types/index.ts`
- [ ] No code duplication exists
- [ ] Agents/workflows are registered in `src/mastra/index.ts`
- [ ] Code validated against context7 MCP server
- [ ] Code validated against Mastra MCP docs server
- [ ] Tests are written and passing
- [ ] Documentation is updated if architectural changes were made
- [ ] Zod schemas are used for validation where applicable
- [ ] pnpm is used for all package management operations
- [ ] pnpm-lock.yaml is maintained and up to date
