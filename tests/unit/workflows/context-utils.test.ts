import { describe, it, expect } from 'vitest';
import {
  buildContextBundle,
  extractMemoryWriteInstructions,
  trimKnowledgeContext,
  trimMemoryContext,
} from '../../../src/mastra/workflows/context-utils.js';
import type {
  MemoryContext,
  KnowledgeContext,
  MemoryWriteInstruction,
} from '../../../src/mastra/types/workflows.js';

const sampleMemory = (overrides: Partial<MemoryContext> = {}): MemoryContext => ({
  id: overrides.id ?? `memory-${Math.random().toString(36).slice(2)}`,
  scope: overrides.scope ?? 'user',
  content: overrides.content ?? 'Quarterly revenue grew 12% year-over-year.',
  similarity: overrides.similarity ?? 0.88,
  tags: overrides.tags ?? ['finance'],
  metadata: overrides.metadata ?? { category: 'finance' },
});

const sampleKnowledge = (overrides: Partial<KnowledgeContext> = {}): KnowledgeContext => ({
  id: overrides.id ?? `knowledge-${Math.random().toString(36).slice(2)}`,
  sourceId: overrides.sourceId ?? 'doc-123',
  title: overrides.title ?? 'Q3 Financial Summary',
  content: overrides.content ?? 'Operating margin improved to 24% driven by cost controls.',
  relevance: overrides.relevance ?? 0.82,
  tags: overrides.tags ?? ['analysis'],
  metadata: overrides.metadata ?? { highlight: 'Operating margin improved to 24%' },
});

describe('context-utils', () => {
  it('builds context bundle with summaries and token limits', () => {
    const memory = trimMemoryContext([
      sampleMemory({ similarity: 0.9 }),
      sampleMemory({ similarity: 0.4, id: 'ignored-memory', content: 'Low relevance note.' }),
    ]);
    const knowledge = trimKnowledgeContext([
      sampleKnowledge({ relevance: 0.8 }),
      sampleKnowledge({ relevance: 0.2, id: 'ignored-knowledge' }),
    ]);

    const bundle = buildContextBundle(memory, knowledge);

    expect(bundle.memory).toHaveLength(1);
    expect(bundle.knowledge).toHaveLength(1);
    expect(bundle.summary).toContain('Memory Context');
    expect(bundle.summary).toContain('Knowledge Context');
    expect(bundle.token_count).toBeGreaterThan(0);
  });

  it('extracts and normalises memory write instructions', () => {
    const response = {
      memoryWriteRequests: [
        { content: 'Capture new sales strategy', scope: 'global', tags: ['sales'] },
        { content: 'Capture new sales strategy', scope: 'global' },
      ] as MemoryWriteInstruction[],
      metadata: {
        memory_write_requests: ['Flag customer preference insight'],
      },
      memoryWrite: 'Store follow-up reminder for user',
    };

    const instructions = extractMemoryWriteInstructions(response);

    expect(instructions).toHaveLength(3);
    expect(instructions[0]).toMatchObject({ scope: 'global', tags: ['sales'] });
    expect(instructions.some(instruction => instruction.content.includes('customer preference'))).toBe(true);
    expect(instructions.some(instruction => instruction.scope === 'user')).toBe(true);
  });
});
