import { z } from 'zod';

// Workflow Types
export const WorkflowTypeSchema = z.enum([
  'default-orchestration',
  'business-intelligence-orchestration',
  'planning',
  'intent-classification',
]);

export const WorkflowStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

// Workflow Step Types
export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tool', 'agent', 'condition', 'parallel', 'sequential']),
  parameters: z.record(z.string(), z.unknown()),
  dependencies: z.array(z.string()).optional(),
  timeout_ms: z.number().int().positive().optional(),
  retry_count: z.number().int().nonnegative().optional(),
});

export const WorkflowStepResultSchema = z.object({
  step_id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  execution_time_ms: z.number().int().nonnegative().optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
});

// Workflow Execution Types
export const WorkflowExecutionSchema = z.object({
  id: z.string().uuid(),
  workflow_type: WorkflowTypeSchema,
  user_id: z.string().optional(),
  input_data: z.record(z.string(), z.unknown()),
  execution_plan: z.array(WorkflowStepSchema).optional(),
  current_step: z.number().int().nonnegative(),
  step_results: z.array(WorkflowStepResultSchema),
  final_result: z.record(z.string(), z.unknown()).optional(),
  status: WorkflowStatusSchema,
  error_details: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});

// Workflow Request Types
export const CreateWorkflowRequestSchema = z.object({
  workflow_type: WorkflowTypeSchema,
  input_data: z.record(z.string(), z.unknown()),
  user_id: z.string().optional(),
  options: z
    .object({
      timeout_ms: z.number().int().positive().optional(),
      retry_policy: z
        .object({
          max_retries: z.number().int().nonnegative().default(3),
          backoff_ms: z.number().int().positive().default(1000),
          backoff_multiplier: z.number().positive().default(2),
        })
        .optional(),
    })
    .optional(),
});

export const UpdateWorkflowRequestSchema = z.object({
  status: WorkflowStatusSchema.optional(),
  current_step: z.number().int().nonnegative().optional(),
  step_results: z.array(WorkflowStepResultSchema).optional(),
  final_result: z.record(z.string(), z.unknown()).optional(),
  error_details: z.record(z.string(), z.unknown()).optional(),
});

// Prompt Orchestration Input
export const PromptOrchestrationInputSchema = z.object({
  prompt: z.string().min(1),
  user_id: z.string().optional(),
  conversation_id: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const IntentClassificationInputSchema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const IntentClassificationOutputSchema = z.object({
  classification: z.record(z.string(), z.unknown()),
  complexity_analysis: z.record(z.string(), z.unknown()),
  routing_decision: z.object({
    recommended_agent: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
});

export const MemoryContextSchema = z.object({
  id: z.string(),
  scope: z.enum(['user', 'global']),
  content: z.string(),
  similarity: z.number().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const KnowledgeContextSchema = z.object({
  id: z.string(),
  sourceId: z.string().optional(),
  title: z.string().optional(),
  content: z.string(),
  relevance: z.number().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ContextBundleSchema = z.object({
  summary: z.string(),
  memory: z.array(MemoryContextSchema),
  knowledge: z.array(KnowledgeContextSchema),
  token_count: z.number().int().nonnegative(),
});

export const MemoryWriteInstructionSchema = z.object({
  scope: z.enum(['user', 'global']).default('user'),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MemoryWriteResultSchema = z.object({
  scope: z.enum(['user', 'global']),
  status: z.enum(['stored', 'skipped', 'failed']),
  memory_id: z.string().optional(),
  reason: z.string().optional(),
});

export const DefaultOrchestrationOutputSchema = z.object({
  selected_agent: z.string(),
  agent_response: z.record(z.string(), z.unknown()),
  classification: IntentClassificationOutputSchema,
  memory_context: z.array(MemoryContextSchema),
  knowledge_context: z.array(KnowledgeContextSchema),
  context_bundle: ContextBundleSchema,
  execution_path: z.array(z.string()),
  performance_metrics: z
    .object({
      memory_time_ms: z.number().int().nonnegative().optional(),
      knowledge_time_ms: z.number().int().nonnegative().optional(),
      total_time_ms: z.number().int().nonnegative(),
    })
    .optional(),
  trace_id: z.string().optional(),
  memory_write_results: z.array(MemoryWriteResultSchema).optional(),
});

export const PlanningInputSchema = z.object({
  query: z.string().min(1),
  user_id: z.string().optional(),
  knowledge_context: z.array(z.any()).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export const PlanningStepSchema = z.object({
  step_number: z.number().int().positive(),
  action: z.string(),
  tool: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  expected_output: z.string(),
  reasoning: z.string(),
});

export const PlanningOutputSchema = z.object({
  query: z.string(),
  plan: z.array(PlanningStepSchema),
  knowledge_sources: z.array(z.string()),
  execution_results: z.array(z.record(z.string(), z.unknown())).optional(),
  final_answer: z.string().optional(),
  confidence_score: z.number().min(0).max(1).optional(),
});

export const BusinessIntelligenceOrchestrationOutputSchema = z.object({
  selected_agent: z.string(),
  agent_response: z.record(z.string(), z.unknown()),
  classification: IntentClassificationOutputSchema,
  plan: z.array(PlanningStepSchema),
  knowledge_context: z.array(KnowledgeContextSchema),
  memory_context: z.array(MemoryContextSchema),
  context_bundle: ContextBundleSchema,
  confidence_score: z.number().min(0).max(1).optional(),
  execution_path: z.array(z.string()),
  performance_metrics: z
    .object({
      planning_time_ms: z.number().int().nonnegative().optional(),
      agent_execution_time_ms: z.number().int().nonnegative().optional(),
      total_time_ms: z.number().int().nonnegative(),
    })
    .optional(),
  trace_id: z.string().optional(),
  memory_write_results: z.array(MemoryWriteResultSchema).optional(),
});

// Workflow Monitoring Types
export const WorkflowMetricsSchema = z.object({
  workflow_id: z.string().uuid(),
  workflow_type: WorkflowTypeSchema,
  execution_time_ms: z.number().int().nonnegative(),
  steps_completed: z.number().int().nonnegative(),
  steps_failed: z.number().int().nonnegative(),
  tools_called: z.number().int().nonnegative(),
  memory_usage_mb: z.number().nonnegative().optional(),
  cost_estimate: z.number().nonnegative().optional(),
});

// TypeScript types inferred from schemas
export type WorkflowType = z.infer<typeof WorkflowTypeSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowStepResult = z.infer<typeof WorkflowStepResultSchema>;

export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;
export type UpdateWorkflowRequest = z.infer<typeof UpdateWorkflowRequestSchema>;

export type PromptOrchestrationInput = z.infer<typeof PromptOrchestrationInputSchema>;
export type DefaultOrchestrationOutput = z.infer<typeof DefaultOrchestrationOutputSchema>;
export type BusinessIntelligenceOrchestrationOutput = z.infer<typeof BusinessIntelligenceOrchestrationOutputSchema>;
export type MemoryContext = z.infer<typeof MemoryContextSchema>;
export type KnowledgeContext = z.infer<typeof KnowledgeContextSchema>;
export type ContextBundle = z.infer<typeof ContextBundleSchema>;
export type MemoryWriteInstruction = z.infer<typeof MemoryWriteInstructionSchema>;
export type MemoryWriteResult = z.infer<typeof MemoryWriteResultSchema>;

export type PlanningInput = z.infer<typeof PlanningInputSchema>;
export type PlanningStep = z.infer<typeof PlanningStepSchema>;
export type PlanningOutput = z.infer<typeof PlanningOutputSchema>;

export type IntentClassificationInput = z.infer<typeof IntentClassificationInputSchema>;
export type IntentClassificationOutput = z.infer<typeof IntentClassificationOutputSchema>;

// Intent Classification intermediate type (workflow-specific)
export interface WorkflowIntentClassification {
  intent: string;
  confidence: number;
  complexity_score: number;
  reasoning: string;
  recommended_agent: string;
  factors: Record<string, any>;
}

export type WorkflowMetrics = z.infer<typeof WorkflowMetricsSchema>;
