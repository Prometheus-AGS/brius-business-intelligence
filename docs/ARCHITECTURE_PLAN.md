# Mastra BI Revamp Plan

This plan enumerates the concrete steps required to realign the Brius Business Intelligence Mastra application with the latest architectural requirements and repository standards. Each task references the core expectations shared by the maintainers, including Bedrock-only model usage, MCP-based tooling, pgvector storage, and the Mastra Hono server.

---

## 1. Centralised Model Configuration
- Create a single Bedrock model configuration module (e.g. `src/mastra/config/bedrock-model.ts`) that exposes:
  - Claude 3.5 Sonnet (via `@ai-sdk/amazon-bedrock`) for text agents.
  - Titan V2 embeddings for vector generation.
- Agents, workflows, and any future utilities must import from this module; remove all OpenAI references and inline model strings.
- Configure provider credentials through `.env` variables (e.g. `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_CLAUDE_MODEL_ID`, `BEDROCK_TITAN_MODEL_ID`).

## 2. Agent Updates
- Update `business-intelligence-agent` and `default-agent` to consume the shared Bedrock model configuration.
- Ensure the agents expose a consistent options interface (thread/resource identifiers) without relying on deprecated enhanced classes.
- Remove all direct Langfuse/tracer logic from agent code. Observability will be handled centrally through Mastra’s configuration.

## 3. Workflow Alignment & Prompt Pipelines
- Refactor `intent-classifier`, `orchestrator`, and `planning` workflows to use the latest Mastra workflow APIs without custom base classes.
- Introduce two orchestration workflows that manage end-to-end prompt processing:
### 3.1 `default-orchestration` workflow
1. **Semantic Recall Step**  
   - Input: `{ prompt, user_id?, conversation_id? }`.  
   - Retrieves user- and global-level memories by querying `PgVector` (index `memory_vectors`, 1536 dims, cosine metric).  
   - Produces `memory_context` array with metadata `{ scope: 'user' | 'global', similarity, content, tags }`.
   - Conversation history comes from Mastra’s built-in `Memory` instance assigned to the agent; we only need to provide thread/resource IDs in agent calls.
  2. **Knowledge Retrieval Step**  
     - Calls MCP knowledge tool (`knowledge.search`) if available; otherwise performs local query against `knowledge_vectors`.  
     - Outputs `knowledge_context` with document snippets + metadata `{ sourceId, tags, relevance }`.
  3. **Context Management Step**  
     - Consolidates user/global memory and knowledge results.  
     - Applies dedupe + trimming (e.g., drop entries with similarity < 0.55, limit combined context to ~2k tokens).  
     - Returns curated `context_bundle`.
  4. **Agent Execution Step**  
     - Invokes `defaultAgent.generateLegacy` using the shared Bedrock model.  
     - Passes `context_bundle` in `context` messages (system primer + appended context).  
     - Outputs `agent_response` and optional `trace_id`.
  5. **Memory Write-back (optional)**  
     - Writes new insights back to user/global memory via MCP memory tool if flagged by agent.

### 3.2 `business-intelligence-orchestration` workflow
  - Reuses steps 1–3 from the default workflow (implemented as shared helper steps/modules).  
  - Adds:
    4. **Planning Workflow Step**: invokes `planningWorkflow` with `{ query, knowledge_context, memory_context }`.  
       - Expects `plan` (array of `PlanningStep`) + `confidence_score`.  
    5. **BI Agent Execution Step**: calls `businessIntelligenceAgent.generateLegacy`, providing the plan + context.  
    6. **Summary & Write-back Step**: stores final insights in both user and global memory (if high confidence) and tags knowledge sources used.
   - Conversation history again flows automatically via Mastra `Memory`; workflows only focus on long-term recall and knowledge snippets.

- Normalise workflow helper functions so they:
  - Invoke workflows via `createRunAsync().start({ inputData })`.
  - Check `WorkflowResult.status`, throwing when not `"success"`.
  - Return typed outputs consistent with `IntentClassificationOutput`, `OrchestratorOutput`, `PlanningOutput`, and new orchestration outputs (define TypeScript interfaces in `src/mastra/types/workflows.ts`).
- Ensure all workflows call agents using the shared Bedrock models (no inline model IDs).

## 4. Observability & Storage Configuration
- Configure observability in `src/mastra/index.ts` using Mastra’s built-in `DefaultExporter`. Langfuse support can be reintroduced later via proper exporter registration once the repository provides credentials.
- Use `PostgresStore` and `PgVector` from `@mastra/pg` for conversation storage and semantic recall. Verify the connection string aligns with the environment variable conventions defined in docs.
- Update `healthInfo` to surface the new architecture metadata (agent/workflow counts, feature flags) and make sure downstream consumers (server + docs) can rely on it.
- Create helper in `src/mastra/config/vector-store.ts` that initialises:
  ```ts
  export const vectorStore = new PgVector({
    connectionString: env.PGVECTOR_DATABASE_URL,
  });

  export async function ensureIndexes() {
    await vectorStore.createIndex({
      indexName: 'memory_vectors',
      dimension: 1536,
      metric: 'cosine',
      indexConfig: { type: 'ivfflat', ivf: { lists: 200 } },
    });

    await vectorStore.createIndex({
      indexName: 'knowledge_vectors',
      dimension: 1536,
      metric: 'cosine',
      indexConfig: { type: 'hnsw', hnsw: { m: 16, efConstruction: 64 } },
    });
  }
  ```
- Store embeddings generated by Titan V2 in these indexes with metadata (`scope`, `tags`, `sourceId`, `createdAt`).

## 5. MCP-Only Tooling
- Remove bespoke internal tools; the only tools exposed to agents should be MCP-wrapped tools.
- Build a module (e.g. `src/mastra/tools/mcp-tools.ts`) that:
  - Reads configured MCP servers from environment variables (path derived from `mcp.json` + env overrides).
  - Instantiates Mastra tool wrappers for each MCP tool using `@mastra/core/tools`.
  - Exposes helper functions:
    ```ts
    export async function loadMcpTools(): Promise<void>; // call on startup
    export function getMcpToolMap(): Record<string, Tool>;
    export function getToolsByTag(tag: 'memory' | 'knowledge' | 'ops'): Tool[];
    ```
  - Supports environment variable `MCP_SERVERS` formatted as `alias::url,alias2::url2`.
- Update agents, workflows, and prompt pipelines to rely exclusively on MCP-derived tools (e.g., memory store/search, knowledge search).
- Document expected MCP tool IDs (e.g., `memory.store`, `memory.search`, `knowledge.search`). If a required MCP capability is not available, define a temporary workflow step (not a tool) until the MCP counterpart exists.

## 6. Server Migration to Mastra Hono
- Replace the Express server in `src/server.ts` with Mastra’s native server configuration:
  - Configure routes via `server: { apiRoutes: [registerApiRoute(...)] }`.
  - Keep existing health endpoints but rewrite them in the Hono-style handlers.
  - Remove Express-specific typings (`req.user` augmentation) and rely on new middleware patterns if auth is required.

## 7. Knowledge & Memory Services
- Remove Supabase client usage. Replace vector and document operations with:
  - `PgVector` for embedding storage/search (see section 4 for indexes).
  - Drizzle ORM or direct SQL via `@mastra/pg` for document metadata if required.
- Ensure the new orchestration workflows perform memory + knowledge retrieval steps:
  - Semantic recall: query user/global memories through `PgVector.query()`.
  - Conversation history + working memory: handled automatically through a shared Mastra `Memory` instance attached to each agent (use `threadId` for conversations and `resourceId` for user-level threads).
  - Knowledge base: use `knowledge_vectors` index and attach metadata `{ sourceId, tags, lastUpdated }`. Summaries should be generated via helper (`summariseKnowledgeChunks()`) before being appended to context.
- Audit `src/mastra/api/knowledge` & `src/mastra/memory` modules, ensuring they:
  - Leverage the central embedding/model helpers (Titan V2).
  - Interact with pgvector using `upsert()`/`query()` patterns.
  - Respect the MCP-only tooling model when exposing functionality (e.g., MCP knowledge tools).

## 8. TypeScript Hygiene & Build
- Satisfy `tsconfig` by:
  - Updating any lingering `any` types (particularly in new tool wrappers and request handlers).
  - Removing stale imports (Langfuse wrappers, Express middleware).
  - Ensuring `pnpm exec tsc --noEmit` passes once refactors are complete.
- Re-run `mastra build` (expecting network failures until registry access is restored, but the step should progress past transpilation).
- Add Vitest smoke tests:
  ```ts
  it('runs default orchestration', async () => {
    const run = await defaultOrchestration.createRunAsync();
    const result = await run.start({ inputData: { prompt: 'Summarise Q3 pipelines', user_id: 'user-123' } });
    expect(result.status).toBe('success');
    expect(result.result.agent_response).toBeDefined();
  });
  ```
- Test vector operations by mocking Titan embeddings and ensuring `vectorStore.query` returns matches with metadata.

## 9. Documentation & Validation
- Update repo docs as needed (e.g. README, existing `docs/` specs) to reflect Bedrock-only usage and MCP tooling.
- Document environment variables required for Bedrock, MCP server configuration, and pgvector connectivity.
- Document existing routes to port to Hono (see section 6) and results of smoke testing.
- Once code changes are finalised, summarise testing steps (TypeScript compile, Vitest workflow tests, manual agent invocations).

---

## Execution Checklist

1. **Housekeeping**
   - Remove duplicate imports and unused helpers (e.g., `defaultOrchestrationWorkflow` re-import in `index.ts`).
   - Expose `ensureMcpToolsLoaded`/`getSharedToolMap` via `mastra/index.ts` for MCP server usage.

2. **Shared Tool Bootstrap**
   - Replace legacy `sharedTools` references in MCP server/tools with dynamic `getSharedToolMap()`.

3. **Workflow Wiring**
   - Finalise `default-orchestration` & `business-intelligence-orchestration` workflows, ensuring classification output uses `IntentClassificationOutputSchema`.
   - Remove old `orchestrator` workflow references (files, imports, exports).

4. **Planning Workflow Cleanup**
   - Ensure planning workflow uses `PlanAnalysisSchema` properly and imports `z`.

5. **Mastra Memory Integration**
   - Ensure both agents attach to shared `conversationMemory`; avoid duplicate initialisation.

6. **Server Migration**
   - Replace Express server with Mastra Hono routes using `registerApiRoute`.

7. **API Layer Alignment**
   - Update OpenAI-compatible API handlers to call new workflows/agents and Bedrock model IDs; remove Supabase/OpenAI remnants.

8. **Knowledge & Memory Modules**
   - Strip Supabase client usage; ensure pgvector helpers supply context for workflows.

9. **MCP Protocol & Tools**
   - Complete dynamic tool registration/execution with `ensureMcpToolsLoaded/getSharedToolMap`.

10. **Docs & README Sync**
    - Remove Supabase/OpenAI references, document new env vars.

11. **TypeScript & Tests**
    - Run `pnpm exec tsc --noEmit`, add Vitest smoke tests for orchestration workflows.

12. **Final Build**
    - Run `pnpm build`, fix issues, repeat until clean.

---

Following this plan sequentially will deliver a clean, Bedrock-driven Mastra architecture with MCP-based tooling, pgvector storage, and the framework’s native server entrypoint. Each step should be merged only after TypeScript passes to prevent regression drift.
