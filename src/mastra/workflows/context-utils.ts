import type { Tool } from '@mastra/core/tools';
import { ensureMcpToolsLoaded, getSharedToolMap } from '../agents/shared-tools.js';
import { userMemoryOps, globalMemoryOps } from '../memory/operations.js';
import { knowledgeSearchService } from '../knowledge/search.js';
import { workflowLogger } from '../observability/logger.js';
import type { Message } from '../types/index.js';
import {
  ContextBundleSchema,
  KnowledgeContextSchema,
  MemoryContextSchema,
  MemoryWriteInstructionSchema,
  MemoryWriteResultSchema,
  type ContextBundle,
  type KnowledgeContext,
  type MemoryContext,
  type MemoryWriteInstruction,
  type MemoryWriteResult,
} from '../types/workflows.js';

const MEMORY_SIMILARITY_THRESHOLD = 0.55;
const KNOWLEDGE_RELEVANCE_THRESHOLD = 0.4;
const MAX_CONTEXT_ITEMS = 6;
const CONTEXT_TOKEN_LIMIT = 2000;
const AVG_CHARS_PER_TOKEN = 4;

const KNOWLEDGE_TOOL_IDS = ['knowledge.search', 'knowledge-search', 'knowledge:search'];
const USER_MEMORY_TOOL_IDS = ['memory.store', 'store-memory', 'memory:store'];
const GLOBAL_MEMORY_TOOL_IDS = ['memory.store-global', 'store-global-memory', 'memory:store-global'];

export interface KnowledgeContextOptions {
  userId?: string;
  workflowId?: string;
}

export interface MemoryWritebackOptions {
  userId?: string;
  workflowId?: string;
  defaultScope?: 'user' | 'global';
  contextBundle?: ContextBundle;
}

export async function fetchMemoryContext(prompt: string, userId?: string): Promise<MemoryContext[]> {
  const contexts: MemoryContext[] = [];

  if (userId) {
    const userResults = await userMemoryOps.search({
      userId,
      query: prompt,
      topK: 8,
      similarityThreshold: MEMORY_SIMILARITY_THRESHOLD,
      includeMetadata: true,
    });

    contexts.push(
      ...userResults.map(result =>
        MemoryContextSchema.parse({
          id: String(result.id),
          scope: 'user' as const,
          content: result.content,
          similarity: result.similarity_score,
          tags: extractStringArray(result.metadata?.tags),
          metadata: result.metadata,
        })
      )
    );
  }

  const globalResults = await globalMemoryOps.search({
    query: prompt,
    topK: 8,
    similarityThreshold: MEMORY_SIMILARITY_THRESHOLD,
    includeMetadata: true,
  });

  contexts.push(
    ...globalResults.map(result =>
      MemoryContextSchema.parse({
        id: String(result.id),
        scope: 'global' as const,
        content: result.content,
        similarity: result.similarity_score,
        tags: extractStringArray(result.metadata?.tags),
        metadata: result.metadata,
      })
    )
  );

  return contexts;
}

export async function fetchKnowledgeContext(
  prompt: string,
  userId?: string,
  workflowId: string = 'workflow.default-orchestration'
): Promise<KnowledgeContext[]> {
  const viaMcp = await tryMcpKnowledgeSearch(prompt, userId, workflowId);
  if (viaMcp.length > 0) {
    return viaMcp;
  }

  return await fallbackKnowledgeSearch(prompt, userId);
}

export function trimMemoryContext(memory: MemoryContext[]): MemoryContext[] {
  const filtered = memory.filter(snippet => (snippet.similarity ?? 0) >= MEMORY_SIMILARITY_THRESHOLD);
  const deduped = dedupeBy(filtered, snippet => `${snippet.scope}:${normalizeContentKey(snippet.content)}`);
  return deduped
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, MAX_CONTEXT_ITEMS);
}

export function trimKnowledgeContext(knowledge: KnowledgeContext[]): KnowledgeContext[] {
  const filtered = knowledge.filter(snippet => (snippet.relevance ?? 0) >= KNOWLEDGE_RELEVANCE_THRESHOLD && snippet.content);
  const deduped = dedupeBy(filtered, snippet => snippet.id ?? normalizeContentKey(snippet.content));
  return deduped
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
    .slice(0, MAX_CONTEXT_ITEMS);
}

export function buildContextSummary(memory: MemoryContext[], knowledge: KnowledgeContext[]): string {
  const memoryLines = memory.map(snippet => {
    const score = typeof snippet.similarity === 'number' ? ` (${snippet.similarity.toFixed(2)})` : '';
    return `- ${snippet.scope.toUpperCase()}${score}: ${snippet.content}`;
  });

  const knowledgeLines = knowledge.map(snippet => {
    const score = typeof snippet.relevance === 'number' ? ` (${snippet.relevance.toFixed(2)})` : '';
    const source = snippet.sourceId ? `[${snippet.sourceId}] ` : '';
    return `- ${source}${snippet.content}${score}`;
  });

  return [
    memoryLines.length ? '## Memory Context\n' + memoryLines.join('\n') : '',
    knowledgeLines.length ? '## Knowledge Context\n' + knowledgeLines.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildContextBundle(memory: MemoryContext[], knowledge: KnowledgeContext[]): ContextBundle {
  const { memory: limitedMemory, knowledge: limitedKnowledge, tokenCount } = clampToTokenLimit(memory, knowledge);
  const summary = buildContextSummary(limitedMemory, limitedKnowledge);

  return ContextBundleSchema.parse({
    summary,
    memory: limitedMemory,
    knowledge: limitedKnowledge,
    token_count: tokenCount,
  });
}

export function buildMessages(prompt: string, bundle: ContextBundle, priorMessages?: Message[]): Message[] {
  const messages: Message[] = [];

  if (bundle.summary) {
    messages.push({ role: 'system', content: `Context summary:\n${bundle.summary}` });
  }

  if (priorMessages?.length) {
    messages.push(...priorMessages);
  }

  messages.push({ role: 'user', content: prompt });
  return messages;
}

export function extractMemoryWriteInstructions(agentResponse: any): MemoryWriteInstruction[] {
  if (!agentResponse) return [];

  const candidateSources = [
    agentResponse.memoryWriteRequests,
    agentResponse.memory_write_requests,
    agentResponse.metadata?.memoryWriteRequests,
    agentResponse.metadata?.memory_write_requests,
    agentResponse.object?.memoryWriteRequests,
    agentResponse.object?.memory_write_requests,
  ];

  const collected: MemoryWriteInstruction[] = [];

  for (const source of candidateSources) {
    if (!Array.isArray(source)) continue;
    for (const candidate of source) {
      const parsed = MemoryWriteInstructionSchema.safeParse(candidate);
      if (parsed.success) {
        collected.push(parsed.data);
      } else if (typeof candidate === 'string') {
        const fallback = MemoryWriteInstructionSchema.safeParse({ content: candidate });
        if (fallback.success) {
          collected.push(fallback.data);
        }
      }
    }
  }

  if (typeof agentResponse.memoryWrite === 'string') {
    const parsed = MemoryWriteInstructionSchema.safeParse({ content: agentResponse.memoryWrite });
    if (parsed.success) {
      collected.push(parsed.data);
    }
  }

  const deduped = dedupeBy(collected, instruction => `${instruction.scope ?? 'user'}:${normalizeContentKey(instruction.content)}`);
  return deduped.map(instruction => MemoryWriteInstructionSchema.parse({ ...instruction, content: instruction.content.trim() })).filter(instruction => instruction.content.length > 0);
}

export async function performMemoryWriteback(
  instructions: MemoryWriteInstruction[],
  options: MemoryWritebackOptions = {}
): Promise<MemoryWriteResult[]> {
  if (!instructions.length) return [];

  let sharedTools: Record<string, Tool> | null = null;
  try {
    await ensureMcpToolsLoaded();
    sharedTools = getSharedToolMap();
  } catch (error) {
    workflowLogger.warn('Unable to ensure MCP tools for memory writeback', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const userMemoryTool = sharedTools ? findTool(sharedTools, USER_MEMORY_TOOL_IDS) : undefined;
  const globalMemoryTool = sharedTools ? findTool(sharedTools, GLOBAL_MEMORY_TOOL_IDS) : undefined;

  const results: MemoryWriteResult[] = [];

  for (const instruction of instructions) {
    const normalized = MemoryWriteInstructionSchema.parse(instruction);
    const scope = normalized.scope ?? options.defaultScope ?? (options.userId ? 'user' : 'global');

    if (scope === 'user' && !options.userId) {
      results.push(
        MemoryWriteResultSchema.parse({
          scope: 'user',
          status: 'skipped',
          reason: 'user_id unavailable for user memory write',
        })
      );
      continue;
    }

    const metadata = {
      ...(normalized.metadata ?? {}),
      tags: normalized.tags,
      workflow: options.workflowId,
      context_sources: options.contextBundle?.knowledge
        .map(snippet => snippet.sourceId)
        .filter(Boolean),
    };

    const attemptResult =
      scope === 'user'
        ? await attemptUserMemoryWrite({
            instruction: normalized,
            tool: userMemoryTool,
            userId: options.userId!,
            metadata,
            workflowId: options.workflowId,
          })
        : await attemptGlobalMemoryWrite({
            instruction: normalized,
            tool: globalMemoryTool,
            userId: options.userId,
            metadata,
            workflowId: options.workflowId,
          });

    if (attemptResult.memoryId) {
      results.push(
        MemoryWriteResultSchema.parse({
          scope,
          status: 'stored',
          memory_id: attemptResult.memoryId,
        })
      );
    } else if (attemptResult.reason) {
      results.push(
        MemoryWriteResultSchema.parse({
          scope,
          status: 'failed',
          reason: attemptResult.reason,
        })
      );
    } else {
      results.push(
        MemoryWriteResultSchema.parse({
          scope,
          status: 'failed',
          reason: 'unknown error',
        })
      );
    }
  }

  return results;
}

async function tryMcpKnowledgeSearch(prompt: string, userId: string | undefined, workflowId: string): Promise<KnowledgeContext[]> {
  try {
    await ensureMcpToolsLoaded();
  } catch (error) {
    workflowLogger.warn('Unable to load MCP tools for knowledge search', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const tools = getSharedToolMap();
  const tool = findTool(tools, KNOWLEDGE_TOOL_IDS);
  if (!tool) {
    return [];
  }

  const executeTool = tool.execute as unknown as ((payload: any) => Promise<any>) | undefined;
  if (!executeTool) {
    return [];
  }

  try {
    const payload: any = {
      context: {
        agentId: workflowId,
        userId,
      },
      input: {
        query: prompt,
        searchType: 'hybrid',
        maxResults: 8,
        minScore: KNOWLEDGE_RELEVANCE_THRESHOLD,
        userId,
      },
    };
    const result: any = await executeTool(payload);

    if (!result || !Array.isArray(result.results)) {
      return [];
    }

    return result.results
      .map((item: any, index: number) => {
        const chunk = item.chunk ?? {};
        const document = item.document ?? {};
        const content = chunk.content ?? item.content;
        if (!content) return null;

        return KnowledgeContextSchema.parse({
          id: String(chunk.id ?? item.id ?? `mcp-${index}`),
          sourceId: document.id ?? item.sourceId,
          title: document.title,
          content,
          relevance: typeof item.score === 'number' ? item.score : item.relevance,
          tags: extractStringArray(document.tags),
          metadata: {
            highlight: item.highlight,
            chunk_index: chunk.chunk_index ?? chunk.chunkIndex,
            source: 'mcp',
          },
        });
      })
      .filter((value: KnowledgeContext | null): value is KnowledgeContext => Boolean(value));
  } catch (error) {
    workflowLogger.warn('MCP knowledge search failed, falling back to local search', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fallbackKnowledgeSearch(prompt: string, userId?: string): Promise<KnowledgeContext[]> {
  const searchResults = await knowledgeSearchService.search({
    query: prompt,
    filters: {
      userId,
      maxResults: 8,
      minScore: KNOWLEDGE_RELEVANCE_THRESHOLD,
    },
    searchType: 'hybrid',
    rerankResults: true,
  });

  return searchResults.results
    .map((result, index) => {
      const resultData = result as Record<string, any>;
      const chunk = resultData.chunk ?? null;
      const document = resultData.document ?? {};
      const content = (chunk && chunk.content) ?? resultData.content;
      if (!content) return null;

      return KnowledgeContextSchema.parse({
        id: String((chunk && chunk.id) ?? resultData.id ?? `kb-${index}`),
        sourceId: document.id,
        title: document.title,
        content,
        relevance: typeof result.score === 'number' ? result.score : result.similarity_score,
        tags: extractStringArray(document.tags),
        metadata: {
          highlight: result.highlight,
          chunk_index: chunk?.chunk_index,
          source: 'local',
        },
      });
    })
    .filter((value: KnowledgeContext | null): value is KnowledgeContext => Boolean(value));
}

async function attemptUserMemoryWrite(params: {
  instruction: MemoryWriteInstruction;
  tool?: Tool;
  userId: string;
  metadata: Record<string, any>;
  workflowId?: string;
}): Promise<{ memoryId?: string; reason?: string }> {
  const { instruction, tool, userId, metadata, workflowId } = params;
  const errors: string[] = [];

  const executeTool = tool?.execute as unknown as ((payload: any) => Promise<any>) | undefined;
  if (executeTool) {
    try {
      const payload: any = {
        context: {
          agentId: workflowId ?? 'workflow.memory-writeback',
          userId,
        },
        input: {
          userId,
          content: instruction.content,
          category: typeof metadata.category === 'string' ? metadata.category : undefined,
          importance: normalizeImportance(metadata.importance),
          metadata,
        },
      };
      const result: any = await executeTool(payload);
      const resultData = result as Record<string, any>;
      const memoryId = resultData?.memory_id ?? resultData?.id;
      if (memoryId) {
        return { memoryId: String(memoryId) };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      workflowLogger.warn('MCP user memory write failed', { workflowId, error: reason });
      errors.push(`tool: ${reason}`);
    }
  }

  try {
    const stored = await userMemoryOps.store({
      userId,
      content: instruction.content,
      category: typeof metadata.category === 'string' ? metadata.category : undefined,
      importance: normalizeImportance(metadata.importance),
      metadata,
    });
    return { memoryId: stored.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    workflowLogger.error('Fallback user memory write failed', { workflowId, error: reason });
    errors.push(`store: ${reason}`);
  }

  return { reason: errors.join('; ') || 'unknown error' };
}

async function attemptGlobalMemoryWrite(params: {
  instruction: MemoryWriteInstruction;
  tool?: Tool;
  userId?: string;
  metadata: Record<string, any>;
  workflowId?: string;
}): Promise<{ memoryId?: string; reason?: string }> {
  const { instruction, tool, userId, metadata, workflowId } = params;
  const errors: string[] = [];

  const executeTool = tool?.execute as unknown as ((payload: any) => Promise<any>) | undefined;
  if (executeTool) {
    try {
      const payload: any = {
        context: {
          agentId: workflowId ?? 'workflow.memory-writeback',
          userId,
        },
        input: {
          content: instruction.content,
          category: typeof metadata.category === 'string' ? metadata.category : undefined,
          importance: normalizeImportance(metadata.importance),
          metadata,
          createdBy: userId,
        },
      };
      const result: any = await executeTool(payload);
      const resultData = result as Record<string, any>;
      const memoryId = resultData?.memory_id ?? resultData?.id;
      if (memoryId) {
        return { memoryId: String(memoryId) };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      workflowLogger.warn('MCP global memory write failed', { workflowId, error: reason });
      errors.push(`tool: ${reason}`);
    }
  }

  try {
    const stored = await globalMemoryOps.store({
      content: instruction.content,
      category: typeof metadata.category === 'string' ? metadata.category : undefined,
      createdBy: userId,
      importance: normalizeImportance(metadata.importance),
      metadata,
    });
    return { memoryId: stored.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    workflowLogger.error('Fallback global memory write failed', { workflowId, error: reason });
    errors.push(`store: ${reason}`);
  }

  return { reason: errors.join('; ') || 'unknown error' };
}

function clampToTokenLimit(memory: MemoryContext[], knowledge: KnowledgeContext[]) {
  const limitedMemory: MemoryContext[] = [];
  const limitedKnowledge: KnowledgeContext[] = [];
  let tokenCount = 0;

  for (const snippet of memory) {
    const tokens = approximateTokenCount(snippet.content);
    if (tokenCount + tokens > CONTEXT_TOKEN_LIMIT) break;
    tokenCount += tokens;
    limitedMemory.push(snippet);
  }

  for (const snippet of knowledge) {
    const tokens = approximateTokenCount(snippet.content);
    if (tokenCount + tokens > CONTEXT_TOKEN_LIMIT) break;
    tokenCount += tokens;
    limitedKnowledge.push(snippet);
  }

  return {
    memory: limitedMemory,
    knowledge: limitedKnowledge,
    tokenCount,
  };
}

function dedupeBy<T>(items: T[], keySelector: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = keySelector(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function normalizeContentKey(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .map((item: unknown) => String(item).trim())
    .filter((entry: string) => Boolean(entry));
  return strings.length ? Array.from(new Set(strings)) : undefined;
}

function approximateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / AVG_CHARS_PER_TOKEN));
}

function findTool(tools: Record<string, Tool>, ids: string[]): Tool | undefined {
  for (const id of ids) {
    if (tools[id]) {
      return tools[id];
    }
  }
  return undefined;
}

function normalizeImportance(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'low' || value === 'high' || value === 'medium') {
    return value;
  }
  return 'medium';
}
