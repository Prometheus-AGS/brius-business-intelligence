# Agents & Workflows Architecture

This guide summarises how agents and workflows should be assembled in the Bedrock + MCP environment.

## Shared Model & Memory

- All agents reference the shared Bedrock Claude Sonnet configuration exported from `src/mastra/config/bedrock-model.ts`.
- Conversation history and working memory are handled by a single Mastra `Memory` instance (initialised in `src/mastra/index.ts`). Agents simply pass `threadId`/`resourceId` so the runtime attaches the correct history.

## Agents

| Agent | Responsibility | Key Details |
|-------|----------------|-------------|
| `default-agent` | Responds to lightweight business queries and funnels complex prompts to BI workflows | Claude Sonnet, MCP tool map, shared `Memory` |
| `business-intelligence-agent` | Produces deep analysis and executive-ready insights | Claude Sonnet, MCP tool map, shared `Memory` |

Agents fetch their tool catalogue heuristically via `ensureMcpToolsLoaded()` / `getSharedToolMap()`; no local tools are defined.

## Workflows

1. **`intent-classification`** – Scores prompt complexity and suggests the target agent.
2. **`default-orchestration`** – Pipeline: classify → fetch user/global memory (`PgVector`) → knowledge search via MCP → trim/deduplicate context → run `defaultAgent`.
3. **`business-intelligence-orchestration`** – Extends default pipeline with the `planning` workflow and executes `businessIntelligenceAgent`.
4. **`planning`** – Generates an ordered list of `PlanningStep` items and confidence score for the BI agent.

Shared helpers in `src/mastra/workflows/context-utils.ts` consolidate memory, knowledge retrieval, and context summarisation so both orchestration workflows remain consistent.

## Memory & Knowledge Strategy

| Scope | Storage | Access Pattern |
|-------|---------|----------------|
| Conversation history | Mastra `Memory` (Postgres) | Automatically included by agents |
| User / Global memory | `PgVector` index `memory_vectors` | `fetchMemoryContext` helper |
| Knowledge base | `PgVector` index `knowledge_vectors` + metadata tables | `fetchKnowledgeContext` helper or MCP knowledge tool |

## MCP Tooling

- Environment variable `MCP_SERVERS` declares available MCP servers (`alias::url`).  
- The bootstrap discovers tools and wraps them with `createTool`; agents/workflows call them via `getSharedToolMap()`.

## Implementation Notes

- Always invoke `ensureMcpToolsLoaded()` before running an agent outside of the Mastra runtime bootstrap.
- Orchestration workflows must handle non-success `WorkflowResult` states and propagate errors.
- Planning and BI workflows should write high-confidence insights back via MCP memory tools to keep global/user memory fresh.
