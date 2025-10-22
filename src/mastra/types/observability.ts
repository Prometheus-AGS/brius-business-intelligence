/**
 * Comprehensive Trace Metadata Types
 * Constitutional requirement: Complete observability type definitions for all tracing operations
 */

import { z } from 'zod';

// Base trace context types
export interface TraceContext {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  userId?: string;
  sessionId?: string;
  workflowId?: string;
  agentId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

// Trace execution types
export type TraceLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type TraceStatus = 'started' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ComponentType = 'tool' | 'agent' | 'workflow' | 'llm' | 'database' | 'api' | 'memory' | 'system';

// Tool call tracing types
export interface ToolCallMetadata {
  toolId: string;
  toolName: string;
  toolVersion?: string;
  invocationId: string;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: TraceStatus;
  level: TraceLevel;
  input?: any;
  output?: any;
  error?: TraceError;
  performance: PerformanceMetrics;
  constitutional_compliance: boolean;
}

// Agent interaction tracing types
export interface AgentInteractionMetadata {
  agentId: string;
  agentName: string;
  agentVersion?: string;
  interactionId: string;
  interactionType: AgentInteractionType;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: TraceStatus;
  level: TraceLevel;
  input?: any;
  output?: any;
  error?: TraceError;
  llmCalls: LLMCallMetadata[];
  toolCalls: ToolCallMetadata[];
  memoryAccess: MemoryAccessMetadata[];
  performance: PerformanceMetrics;
  constitutional_compliance: boolean;
}

export type AgentInteractionType =
  | 'creation'
  | 'execution'
  | 'memory_access'
  | 'tool_usage'
  | 'llm_generation'
  | 'communication'
  | 'state_change'
  | 'error_handling';

// Workflow execution tracing types
export interface WorkflowExecutionMetadata {
  workflowId: string;
  workflowName: string;
  workflowVersion?: string;
  executionId: string;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: TraceStatus;
  level: TraceLevel;
  input?: any;
  output?: any;
  error?: TraceError;
  steps: WorkflowStepMetadata[];
  conditionals: ConditionalExecutionMetadata[];
  parallelExecutions: ParallelExecutionMetadata[];
  loops: LoopExecutionMetadata[];
  performance: PerformanceMetrics;
  constitutional_compliance: boolean;
}

export interface WorkflowStepMetadata {
  stepId: string;
  stepName: string;
  stepType: WorkflowStepType;
  stepIndex: number;
  parentStepId?: string;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: TraceStatus;
  level: TraceLevel;
  input?: any;
  output?: any;
  error?: TraceError;
  skipped?: boolean;
  retryCount?: number;
  performance: PerformanceMetrics;
}

export type WorkflowStepType =
  | 'tool_execution'
  | 'agent_execution'
  | 'conditional'
  | 'parallel'
  | 'sequential'
  | 'loop'
  | 'human_input'
  | 'human_approval'
  | 'data_transformation'
  | 'external_api'
  | 'decision_point';

// LLM call tracing types
export interface LLMCallMetadata {
  callId: string;
  modelName: string;
  modelVersion?: string;
  providerId: string;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: TraceStatus;
  level: TraceLevel;
  input?: any;
  output?: any;
  error?: TraceError;
  usage: TokenUsage;
  performance: PerformanceMetrics;
  constitutional_compliance: boolean;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  costCurrency?: string;
}

// Memory access tracing types
export interface MemoryAccessMetadata {
  accessId: string;
  memoryType: MemoryType;
  operation: MemoryOperation;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: TraceStatus;
  level: TraceLevel;
  query?: string;
  input?: any;
  output?: any;
  error?: TraceError;
  resultsCount?: number;
  performance: PerformanceMetrics;
}

export type MemoryType = 'short_term' | 'long_term' | 'episodic' | 'semantic' | 'procedural' | 'working';
export type MemoryOperation = 'read' | 'write' | 'search' | 'update' | 'delete' | 'clear';

// Conditional execution metadata
export interface ConditionalExecutionMetadata {
  conditionalId: string;
  conditionName: string;
  condition: string;
  executionContext: TraceContext;
  evaluationTime: Date;
  duration?: number;
  result: boolean;
  branchTaken: string;
  availableBranches: string[];
  level: TraceLevel;
  error?: TraceError;
}

// Parallel execution metadata
export interface ParallelExecutionMetadata {
  parallelId: string;
  parallelGroupName: string;
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  maxConcurrency?: number;
  parallelSteps: string[];
  results: Array<{
    stepName: string;
    stepId: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
  successfulSteps: number;
  failedSteps: number;
  level: TraceLevel;
}

// Loop execution metadata
export interface LoopExecutionMetadata {
  loopId: string;
  loopName: string;
  loopType: 'for' | 'while' | 'forEach' | 'do-while';
  executionContext: TraceContext;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  condition?: string;
  maxIterations?: number;
  iterationsCompleted: number;
  level: TraceLevel;
  error?: TraceError;
}

// Performance metrics
export interface PerformanceMetrics {
  executionTime: number;
  memoryUsage?: number;
  cpuUsage?: number;
  networkLatency?: number;
  databaseLatency?: number;
  cacheHitRate?: number;
  errorRate?: number;
  throughput?: number;
  concurrency?: number;
}

// Error tracing types
export interface TraceError {
  errorId: string;
  errorType: string;
  errorCode?: string;
  message: string;
  stack?: string;
  cause?: string;
  timestamp: Date;
  severity: ErrorSeverity;
  component: ComponentType;
  context: TraceContext;
  recoverable: boolean;
  resolution?: string;
  metadata?: Record<string, any>;
}

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

// Comprehensive trace event
export interface TraceEvent {
  eventId: string;
  eventType: TraceEventType;
  timestamp: Date;
  level: TraceLevel;
  component: ComponentType;
  context: TraceContext;
  message: string;
  data?: any;
  error?: TraceError;
  performance?: PerformanceMetrics;
  tags: string[];
  constitutional_compliance: boolean;
}

export type TraceEventType =
  | 'trace_started'
  | 'trace_completed'
  | 'span_started'
  | 'span_completed'
  | 'tool_called'
  | 'agent_executed'
  | 'workflow_started'
  | 'workflow_completed'
  | 'step_executed'
  | 'llm_called'
  | 'memory_accessed'
  | 'error_occurred'
  | 'performance_alert'
  | 'health_check'
  | 'configuration_changed';

// Trace aggregation and analysis types
export interface TraceAnalytics {
  timeRange: {
    start: Date;
    end: Date;
  };
  totalTraces: number;
  successfulTraces: number;
  failedTraces: number;
  averageExecutionTime: number;
  p95ExecutionTime: number;
  p99ExecutionTime: number;
  errorRate: number;
  throughput: number;
  componentBreakdown: Record<ComponentType, ComponentAnalytics>;
  topErrors: ErrorSummary[];
  performanceTrends: PerformanceTrend[];
  constitutional_compliance_rate: number;
}

export interface ComponentAnalytics {
  component: ComponentType;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  errorRate: number;
  throughput: number;
  uniqueErrors: number;
  performanceScore: number;
}

export interface ErrorSummary {
  errorType: string;
  errorCode?: string;
  count: number;
  percentage: number;
  lastOccurrence: Date;
  averageResolutionTime?: number;
  severity: ErrorSeverity;
  component: ComponentType;
}

export interface PerformanceTrend {
  timestamp: Date;
  averageExecutionTime: number;
  throughput: number;
  errorRate: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

// Configuration types for tracing
export interface TracingConfiguration {
  enabled: boolean;
  components: Record<ComponentType, ComponentTracingConfig>;
  sampling: SamplingConfiguration;
  retention: RetentionConfiguration;
  privacy: PrivacyConfiguration;
  performance: PerformanceConfiguration;
  alerts: AlertConfiguration[];
}

export interface ComponentTracingConfig {
  enabled: boolean;
  traceInput: boolean;
  traceOutput: boolean;
  traceErrors: boolean;
  tracePerformance: boolean;
  samplingRate: number;
  maxInputSize: number;
  maxOutputSize: number;
  sensitiveFields: string[];
}

export interface SamplingConfiguration {
  strategy: 'always' | 'never' | 'percentage' | 'adaptive' | 'error-based';
  rate: number;
  adaptiveThresholds?: {
    errorRateThreshold: number;
    latencyThreshold: number;
    throughputThreshold: number;
  };
}

export interface RetentionConfiguration {
  defaultRetentionDays: number;
  errorRetentionDays: number;
  performanceRetentionDays: number;
  aggregatedRetentionDays: number;
  compressionEnabled: boolean;
}

export interface PrivacyConfiguration {
  piiDetection: boolean;
  globalSensitiveFields: string[];
  redactionStrategy: 'mask' | 'hash' | 'remove' | 'encrypt';
  encryptionKey?: string;
  auditAccess: boolean;
}

export interface PerformanceConfiguration {
  bufferSize: number;
  flushInterval: number;
  maxConcurrentTraces: number;
  backgroundProcessing: boolean;
  compressionEnabled: boolean;
  batchSize: number;
}

export interface AlertConfiguration {
  alertId: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: AlertCondition[];
  actions: AlertAction[];
  cooldownMinutes: number;
  severity: ErrorSeverity;
}

export interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'contains';
  threshold: number | string;
  windowMinutes: number;
}

export interface AlertAction {
  type: 'email' | 'slack' | 'webhook' | 'log' | 'dashboard';
  config: Record<string, any>;
}

// Zod schemas for validation
export const TraceContextSchema = z.object({
  traceId: z.string(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  workflowId: z.string().optional(),
  agentId: z.string().optional(),
  requestId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PerformanceMetricsSchema = z.object({
  executionTime: z.number(),
  memoryUsage: z.number().optional(),
  cpuUsage: z.number().optional(),
  networkLatency: z.number().optional(),
  databaseLatency: z.number().optional(),
  cacheHitRate: z.number().optional(),
  errorRate: z.number().optional(),
  throughput: z.number().optional(),
  concurrency: z.number().optional(),
});

export const TraceErrorSchema = z.object({
  errorId: z.string(),
  errorType: z.string(),
  errorCode: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  cause: z.string().optional(),
  timestamp: z.date(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  component: z.enum(['tool', 'agent', 'workflow', 'llm', 'database', 'api', 'memory', 'system']),
  context: TraceContextSchema,
  recoverable: z.boolean(),
  resolution: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ToolCallMetadataSchema = z.object({
  toolId: z.string(),
  toolName: z.string(),
  toolVersion: z.string().optional(),
  invocationId: z.string(),
  executionContext: TraceContextSchema,
  startTime: z.date(),
  endTime: z.date().optional(),
  duration: z.number().optional(),
  status: z.enum(['started', 'running', 'completed', 'failed', 'cancelled']),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  input: z.any().optional(),
  output: z.any().optional(),
  error: TraceErrorSchema.optional(),
  performance: PerformanceMetricsSchema,
  constitutional_compliance: z.boolean(),
});

export const AgentInteractionMetadataSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  agentVersion: z.string().optional(),
  interactionId: z.string(),
  interactionType: z.enum(['creation', 'execution', 'memory_access', 'tool_usage', 'llm_generation', 'communication', 'state_change', 'error_handling']),
  executionContext: TraceContextSchema,
  startTime: z.date(),
  endTime: z.date().optional(),
  duration: z.number().optional(),
  status: z.enum(['started', 'running', 'completed', 'failed', 'cancelled']),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  input: z.any().optional(),
  output: z.any().optional(),
  error: TraceErrorSchema.optional(),
  llmCalls: z.array(z.any()),
  toolCalls: z.array(ToolCallMetadataSchema),
  memoryAccess: z.array(z.any()),
  performance: PerformanceMetricsSchema,
  constitutional_compliance: z.boolean(),
});

export const TraceEventSchema = z.object({
  eventId: z.string(),
  eventType: z.enum([
    'trace_started', 'trace_completed', 'span_started', 'span_completed',
    'tool_called', 'agent_executed', 'workflow_started', 'workflow_completed',
    'step_executed', 'llm_called', 'memory_accessed', 'error_occurred',
    'performance_alert', 'health_check', 'configuration_changed'
  ]),
  timestamp: z.date(),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  component: z.enum(['tool', 'agent', 'workflow', 'llm', 'database', 'api', 'memory', 'system']),
  context: TraceContextSchema,
  message: z.string(),
  data: z.any().optional(),
  error: TraceErrorSchema.optional(),
  performance: PerformanceMetricsSchema.optional(),
  tags: z.array(z.string()),
  constitutional_compliance: z.boolean(),
});

// Export utility functions for working with traces
export function createTraceContext(options: Partial<TraceContext>): TraceContext {
  return {
    traceId: options.traceId || crypto.randomUUID(),
    ...options,
  };
}

export function createPerformanceMetrics(executionTime: number, additional?: Partial<PerformanceMetrics>): PerformanceMetrics {
  return {
    executionTime,
    ...additional,
  };
}

export function createTraceError(
  message: string,
  errorType: string,
  severity: ErrorSeverity,
  component: ComponentType,
  context: TraceContext,
  additional?: Partial<TraceError>
): TraceError {
  return {
    errorId: crypto.randomUUID(),
    errorType,
    message,
    timestamp: new Date(),
    severity,
    component,
    context,
    recoverable: additional?.recoverable ?? true,
    ...additional,
  };
}

export function isTraceCompleted(status: TraceStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function calculateSuccessRate(successful: number, total: number): number {
  return total > 0 ? (successful / total) * 100 : 0;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  } else {
    return `${(durationMs / 60000).toFixed(2)}m`;
  }
}

// Constitutional compliance marker types
export interface ConstitutionalComplianceMarker {
  compliant: boolean;
  timestamp: Date;
  version: string;
  checks: ComplianceCheck[];
  summary: string;
}

export interface ComplianceCheck {
  checkId: string;
  checkName: string;
  required: boolean;
  passed: boolean;
  message: string;
  evidence?: any;
}