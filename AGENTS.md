# Repository Guidelines

## Project Structure & Module Organization
Source lives in `src/mastra`, organized by feature. Register agents, workflows, storage, and logging in `src/mastra/index.ts`. Place new agents in `src/mastra/agents`, tools in `src/mastra/tools`, workflows in `src/mastra/workflows`, and shared types in `src/mastra/types` (always re-export from `src/mastra/types/index.ts`). Keep architecture notes in `docs/`; integration fixtures sit under `examples/`; shared tests belong in `tests/` alongside feature-specific checks.

## Build, Test, and Development Commands
- `pnpm install` – install dependencies; never use npm or yarn.
- `pnpm dev` – start the Mastra dev server with hot reload.
- `pnpm build` – compile the Mastra bundle for production.
- `pnpm start` – run the compiled build locally.
- `pnpm test` – placeholder test script; replace with Vitest/Jest before enabling CI.

## Coding Style & Naming Conventions
The codebase is TypeScript with ECMAScript modules, 2-space indentation, and named exports. File names, agent IDs, tool IDs, and workflow step IDs stay kebab-case (e.g., `weather-agent.ts`, `get-weather`). Use async/await, wrap prompts in template literals, and model inputs/outputs with Zod schemas. Avoid duplicating logic—extend existing modules or shared types instead of cloning them.

## Testing Guidelines
Adopt Vitest or Jest for unit and integration coverage. Collocate tests as `<module>.test.ts`. Stub external HTTP traffic (e.g., Open-Meteo) so suites run offline. Ensure new features include at least one automated check, and document manual validation in PRs when applicable.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat: add tide forecast tool`, `fix: handle missing lat/lng`). Each PR should include a concise summary, linked Linear/Jira issue, screenshots or transcripts for UX changes, and test evidence (`pnpm test` output or rationale when skipped). Keep PRs focused on a single feature or fix to simplify review.

## Architecture & Agent Registration
We operate on feature-based clean architecture. Workflows orchestrate behavior; agents inject reasoning inside pipeline steps. Always register new agents and workflows in `src/mastra/index.ts` so the Mastra playground can discover them. Maintain a single canonical implementation per feature—never introduce "enhanced" duplicates.

## Security & Configuration Tips
Store secrets in `.env` files (never commit them). Default storage uses in-memory LibSQL; switch to `file:../mastra.db` or a LibSQL cloud URL for persistence and document the change. Validate code against the context7 MCP server and Mastra MCP docs server before merging.
