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

// Business Intelligence Planner-Executor Pattern Schemas
export const BusinessIntelligencePlannerInputSchema = z.object({
  query: z.string().min(1),
  user_id: z.string().optional(),
  conversation_id: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  knowledge_context: z.array(KnowledgeContextSchema).optional(),
  memory_context: z.array(MemoryContextSchema).optional(),
  available_tools: z.array(z.string()).optional(),
  constraints: z
    .object({
      max_execution_time_ms: z.number().int().positive().optional(),
      max_tool_calls: z.number().int().positive().optional(),
      required_confidence_threshold: z.number().min(0).max(1).optional(),
      preferred_data_sources: z.array(z.string()).optional(),
    })
    .optional(),
});

export const DataRequirementSchema = z.object({
  source: z.string(), // e.g., "supabase-table", "knowledge-base", "external-api"
  type: z.enum(['database_query', 'semantic_search', 'api_call', 'tool_execution']),
  parameters: z.record(z.string(), z.unknown()),
  description: z.string(),
  priority: z.enum(['critical', 'important', 'optional']).default('important'),
  expected_format: z.string().optional(),
});

export const AnalysisStepSchema = z.object({
  step_id: z.string(),
  step_type: z.enum(['data_collection', 'data_processing', 'analysis', 'synthesis', 'validation']),
  description: z.string(),
  tool_calls: z.array(z.object({
    tool_id: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    expected_output_format: z.string().optional(),
  })),
  dependencies: z.array(z.string()).optional(), // step_ids this step depends on
  success_criteria: z.string(),
  fallback_options: z.array(z.string()).optional(),
});

export const BusinessIntelligencePlannerOutputSchema = z.object({
  original_query: z.string(),
  analysis_approach: z.enum(['descriptive', 'diagnostic', 'predictive', 'prescriptive']),
  execution_plan: z.object({
    data_requirements: z.array(DataRequirementSchema),
    analysis_steps: z.array(AnalysisStepSchema),
    estimated_execution_time_ms: z.number().int().positive(),
    confidence_in_plan: z.number().min(0).max(1),
    risk_factors: z.array(z.string()).optional(),
  }),
  context_summary: z.string(),
  expected_deliverables: z.array(z.string()),
  success_metrics: z.array(z.string()),
  planning_metadata: z.object({
    planning_time_ms: z.number().int().nonnegative(),
    tools_considered: z.array(z.string()),
    knowledge_sources_consulted: z.array(z.string()),
    complexity_assessment: z.enum(['low', 'medium', 'high', 'very_high']),
  }),
});

export const BusinessIntelligenceExecutorInputSchema = z.object({
  planner_output: BusinessIntelligencePlannerOutputSchema,
  execution_context: z.object({
    user_id: z.string().optional(),
    conversation_id: z.string().optional(),
    session_id: z.string().optional(),
    execution_start_time: z.string().datetime(),
    timeout_ms: z.number().int().positive().optional(),
  }),
  runtime_adjustments: z
    .object({
      skip_steps: z.array(z.string()).optional(), // step_ids to skip
      additional_constraints: z.record(z.string(), z.unknown()).optional(),
      priority_override: z.enum(['speed', 'accuracy', 'comprehensiveness']).optional(),
    })
    .optional(),
});

export const ExecutionStepResultSchema = z.object({
  step_id: z.string(),
  status: z.enum(['completed', 'failed', 'skipped', 'partial']),
  tool_results: z.array(z.object({
    tool_id: z.string(),
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
    execution_time_ms: z.number().int().nonnegative(),
  })),
  derived_insights: z.array(z.string()).optional(),
  data_quality_score: z.number().min(0).max(1).optional(),
  confidence_in_results: z.number().min(0).max(1).optional(),
  next_step_recommendations: z.array(z.string()).optional(),
});

export const BusinessIntelligenceExecutorOutputSchema = z.object({
  original_query: z.string(),
  execution_summary: z.object({
    total_execution_time_ms: z.number().int().nonnegative(),
    steps_attempted: z.number().int().nonnegative(),
    steps_completed: z.number().int().nonnegative(),
    steps_failed: z.number().int().nonnegative(),
    tools_executed: z.number().int().nonnegative(),
    data_sources_accessed: z.array(z.string()),
  }),
  step_results: z.array(ExecutionStepResultSchema),
  final_analysis: z.object({
    key_findings: z.array(z.string()),
    insights: z.array(z.string()),
    recommendations: z.array(z.string()),
    confidence_score: z.number().min(0).max(1),
    data_quality_assessment: z.string(),
    limitations: z.array(z.string()).optional(),
  }),
  deliverables: z.record(z.string(), z.unknown()), // structured data outputs
  executive_summary: z.string(),
  next_actions: z.array(z.string()).optional(),
  metadata: z.object({
    analysis_approach_used: z.enum(['descriptive', 'diagnostic', 'predictive', 'prescriptive']),
    primary_data_sources: z.array(z.string()),
    tools_effectiveness: z.record(z.string(), z.number().min(0).max(1)).optional(),
    execution_quality_score: z.number().min(0).max(1),
  }),
});

// Orchestrator Agent Schemas
export const OrchestratorInputSchema = z.object({
  query: z.string().min(1),
  user_id: z.string().optional(),
  conversation_id: z.string().optional(),
  session_id: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  routing_hints: z
    .object({
      preferred_agent: z.string().optional(),
      complexity_override: z.enum(['force_simple', 'force_complex']).optional(),
      bypass_classification: z.boolean().default(false),
    })
    .optional(),
});

export const OrchestratorOutputSchema = z.object({
  original_query: z.string(),
  routing_decision: z.object({
    selected_agent: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    classification_details: IntentClassificationOutputSchema,
  }),
  agent_execution_result: z.record(z.string(), z.unknown()),
  orchestration_metadata: z.object({
    total_execution_time_ms: z.number().int().nonnegative(),
    classification_time_ms: z.number().int().nonnegative(),
    agent_execution_time_ms: z.number().int().nonnegative(),
    routing_path: z.array(z.string()),
  }),
  final_response: z.string(),
  follow_up_suggestions: z.array(z.string()).optional(),
});

// TypeScript types for the new schemas
export type BusinessIntelligencePlannerInput = z.infer<typeof BusinessIntelligencePlannerInputSchema>;
export type BusinessIntelligencePlannerOutput = z.infer<typeof BusinessIntelligencePlannerOutputSchema>;
export type DataRequirement = z.infer<typeof DataRequirementSchema>;
export type AnalysisStep = z.infer<typeof AnalysisStepSchema>;

export type BusinessIntelligenceExecutorInput = z.infer<typeof BusinessIntelligenceExecutorInputSchema>;
export type BusinessIntelligenceExecutorOutput = z.infer<typeof BusinessIntelligenceExecutorOutputSchema>;
export type ExecutionStepResult = z.infer<typeof ExecutionStepResultSchema>;

export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>;
