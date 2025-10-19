import { z } from 'zod';

// Workflow Types
export const WorkflowTypeSchema = z.enum(['orchestrator', 'planning', 'intent-classification']);

export const WorkflowStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

// Workflow Step Types
export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['tool', 'agent', 'condition', 'parallel', 'sequential']),
  parameters: z.record(z.any()),
  dependencies: z.array(z.string()).optional(),
  timeout_ms: z.number().int().positive().optional(),
  retry_count: z.number().int().nonnegative().optional(),
});

export const WorkflowStepResultSchema = z.object({
  step_id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  input: z.record(z.any()).optional(),
  output: z.record(z.any()).optional(),
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
  input_data: z.record(z.any()),
  execution_plan: z.array(WorkflowStepSchema).optional(),
  current_step: z.number().int().nonnegative(),
  step_results: z.array(WorkflowStepResultSchema),
  final_result: z.record(z.any()).optional(),
  status: WorkflowStatusSchema,
  error_details: z.record(z.any()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});

// Workflow Request Types
export const CreateWorkflowRequestSchema = z.object({
  workflow_type: WorkflowTypeSchema,
  input_data: z.record(z.any()),
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
  final_result: z.record(z.any()).optional(),
  error_details: z.record(z.any()).optional(),
});

// Orchestrator Workflow Types
export const OrchestratorInputSchema = z.object({
  prompt: z.string().min(1),
  user_id: z.string().optional(),
  conversation_id: z.string().optional(),
  context: z.record(z.any()).optional(),
});

export const OrchestratorOutputSchema = z.object({
  intent_classification: z.record(z.any()),
  selected_agent: z.string(),
  agent_response: z.record(z.any()),
  execution_path: z.array(z.string()),
  performance_metrics: z
    .object({
      classification_time_ms: z.number().int().nonnegative(),
      agent_execution_time_ms: z.number().int().nonnegative(),
      total_time_ms: z.number().int().nonnegative(),
    })
    .optional(),
});

// Planning Workflow Types
export const PlanningInputSchema = z.object({
  query: z.string().min(1),
  user_id: z.string().optional(),
  knowledge_context: z.array(z.any()).optional(),
  constraints: z.record(z.any()).optional(),
});

export const PlanningStepSchema = z.object({
  step_number: z.number().int().positive(),
  action: z.string(),
  tool: z.string(),
  parameters: z.record(z.any()),
  expected_output: z.string(),
  reasoning: z.string(),
});

export const PlanningOutputSchema = z.object({
  query: z.string(),
  plan: z.array(PlanningStepSchema),
  knowledge_sources: z.array(z.string()),
  execution_results: z.array(z.record(z.any())).optional(),
  final_answer: z.string().optional(),
  confidence_score: z.number().min(0).max(1).optional(),
});

// Intent Classification Workflow Types
export const IntentClassificationInputSchema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.any()).optional(),
});

export const IntentClassificationOutputSchema = z.object({
  classification: z.record(z.any()),
  complexity_analysis: z.record(z.any()),
  routing_decision: z.object({
    recommended_agent: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
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

export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;

export type PlanningInput = z.infer<typeof PlanningInputSchema>;
export type PlanningStep = z.infer<typeof PlanningStepSchema>;
export type PlanningOutput = z.infer<typeof PlanningOutputSchema>;

export type IntentClassificationInput = z.infer<typeof IntentClassificationInputSchema>;
export type IntentClassificationOutput = z.infer<typeof IntentClassificationOutputSchema>;

// Intent Classification intermediate type
export interface IntentClassification {
  intent: string;
  confidence: number;
  complexity_score: number;
  reasoning: string;
  recommended_agent: string;
  factors: Record<string, any>;
}

export type WorkflowMetrics = z.infer<typeof WorkflowMetricsSchema>;