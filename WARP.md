# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Essential Commands

### Package Management
- **Install dependencies**: `pnpm install` (uses pnpm lockfile for version consistency)
- **Development server**: `pnpm dev` (starts Mastra dev server with live reload)
- **Build project**: `pnpm build` (generates production bundle)
- **Start production**: `pnpm start` (executes compiled output)
- **Tests**: `pnpm test` (placeholder - needs test runner setup)

### Development Workflow
- **Database persistence**: Change LibSQL URL from `:memory:` to `file:../mastra.db` in `src/mastra/index.ts` for persistent storage
- **Environment variables**: Store API keys in `.env` files (gitignored)

## Architecture Overview

### Mastra Framework Structure
This is a **Mastra-based business intelligence application** with the core entry point at `src/mastra/index.ts` which registers:
- **Agents**: AI agents with specific instructions and memory
- **Tools**: Executable functions with input/output schemas
- **Workflows**: Multi-step processes that chain tools and agents
- **Storage**: LibSQL for observability and scores
- **Observability**: AI tracing with DefaultExporter and CloudExporter

### Module Organization
```
src/mastra/
├── index.ts          # Main Mastra configuration and registration
├── agents/           # AI agents with instructions and memory
├── tools/            # Executable tools with zod schemas
└── workflows/        # Multi-step workflow pipelines
```

### Code Patterns
- **File naming**: kebab-case (`weather-agent.ts`, `weather-tool.ts`)
- **IDs**: hyphenated and descriptive (`get-weather`, `fetch-weather`)
- **Exports**: Named exports preferred over default
- **Validation**: Zod schemas for input/output validation
- **Async patterns**: async/await throughout
- **Templates**: Instructions in template literals with consistent indentation

### Example Components
The codebase includes a **weather system example** demonstrating the full pattern:
- `weather-agent.ts`: Agent with OpenAI GPT-4o-mini model, memory, and tools
- `weather-tool.ts`: Tool for fetching current weather via Open-Meteo API
- `weather-workflow.ts`: Two-step workflow (fetch weather → plan activities)

### Memory & Storage
- **Agent memory**: Persistent via LibSQL (`file:../mastra.db`)
- **Application storage**: In-memory by default (`:memory:`)
- **External APIs**: Open-Meteo for geocoding and weather data

### TypeScript Configuration
- **Target**: ES2022 with bundler module resolution
- **Strict mode**: Enabled with consistent casing enforcement
- **Module type**: ESModule (`"type": "module"` in package.json)
- **Node version**: Requires >=20.9.0

### Testing Strategy
- Replace placeholder test script with Vitest or Jest
- Mock external HTTP calls (Open-Meteo, geocoding APIs)
- Name test files `<module>.test.ts` alongside implementation
- Test workflows programmatically with fixture inputs