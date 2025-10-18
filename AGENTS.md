# Repository Guidelines

## Project Structure & Module Organization
Source lives under `src/mastra`. `index.ts` registers agents, workflows, storage, and logging. Place new agents in `src/mastra/agents`, tools in `src/mastra/tools`, and workflow pipelines in `src/mastra/workflows`; mirror the existing weather example for naming and export patterns. Keep shared types or helpers near their usage, and document external APIs inside the referencing module.

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
