import { getDrizzleDb } from '../config/consolidated-database.js';
import {
  knowledgeSettings,
  type KnowledgeSettings,
  chunkStrategyEnum,
} from '../database/schema.js';
import { eq } from 'drizzle-orm';

const DEFAULT_SETTINGS: Omit<KnowledgeSettings, 'id' | 'createdAt' | 'updatedAt'> = {
  chunkStrategy: 'semantic',
  chunkSize: 1200,
  overlap: 200,
  metadata: {},
};

const PRIMARY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

export async function getKnowledgeSettings(db = getDrizzleDb()): Promise<KnowledgeSettings> {
  const existing = await db
    .select()
    .from(knowledgeSettings)
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const [inserted] = await db
    .insert(knowledgeSettings)
    .values({
      id: PRIMARY_SETTINGS_ID,
      ...DEFAULT_SETTINGS,
    })
    .returning();

  return inserted;
}

export interface UpdateKnowledgeSettingsInput {
  chunkStrategy?: (typeof chunkStrategyEnum.enumValues)[number];
  chunkSize?: number;
  overlap?: number;
  metadata?: Record<string, unknown>;
}

export async function updateKnowledgeSettings(
  input: UpdateKnowledgeSettingsInput,
  db = getDrizzleDb()
): Promise<KnowledgeSettings> {
  const current = await getKnowledgeSettings(db);

  const updatedValues = {
    chunkStrategy: input.chunkStrategy ?? current.chunkStrategy,
    chunkSize: input.chunkSize ?? current.chunkSize,
    overlap: input.overlap ?? current.overlap,
    metadata: input.metadata ?? current.metadata,
    updatedAt: new Date(),
  } satisfies Partial<KnowledgeSettings>;

  const [updated] = await db
    .update(knowledgeSettings)
    .set(updatedValues)
    .where(eq(knowledgeSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error('Failed to update knowledge settings');
  }

  return updated;
}
