import { z } from 'zod';

/**
 * Core context types for Business Intelligence Context Enhancement
 */

// ============================================================================
// Base Types and Enums
// ============================================================================

export type ContextStatus = 'active' | 'paused' | 'completed' | 'failed' | 'degraded';
export type SessionStatus = 'initiated' | 'active' | 'waiting' | 'processing' | 'completed' | 'failed';
export type DomainType = 'clinical' | 'financial' | 'operational' | 'customer-service';
export type PatternType = 'planner-executor' | 'reactive' | 'streaming' | 'hybrid';
export type MemoryScope = 'user' | 'global';
export type ContentType = 'conversation' | 'knowledge' | 'preference';

// ============================================================================
// Permission and Access Control Types
// ============================================================================

export interface DomainPermissions {
  read: boolean;
  query: boolean;
  export: boolean;
  departments?: string[];
}

export interface PermissionMatrix {
  clinical: DomainPermissions;
  financial: DomainPermissions;
  operational: DomainPermissions;
  'customer-service': DomainPermissions;
}

export interface UserPreferences {
  defaultVisualization?: 'chart' | 'table' | 'graph';
  timezone?: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
}

// ============================================================================
// User Context Types
// ============================================================================

export interface UserContext {
  userId: string;
  sessionId: string;
  roleId: string;
  departmentScope: string[];
  permissions: PermissionMatrix;
  preferences?: UserPreferences;
  lastActivity: Date;
  tokenExpiry: Date;
  isAnonymous: boolean;
  status: ContextStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnonymousContext extends Omit<UserContext, 'userId' | 'departmentScope' | 'tokenExpiry'> {
  userId: 'anonymous';
  departmentScope: [];
  tokenExpiry: Date; // Still needed for session management
  permissions: PermissionMatrix; // Limited permissions for anonymous users
}

// ============================================================================
// Session Management Types
// ============================================================================

export interface AnalysisSession {
  sessionId: string;
  userId: string;
  startTime: Date;
  lastQueryTime?: Date;
  queryHistory: QueryHistoryEntry[];
  contextState: Record<string, any>;
  domainAccess: DomainType[];
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryHistoryEntry {
  id: string;
  query: string;
  timestamp: Date;
  domains: DomainType[];
  results?: any;
  duration?: number;
  success: boolean;
  error?: string;
}

export interface SessionCreateRequest {
  sessionType?: 'interactive' | 'automated' | 'batch';
  preferences?: UserPreferences;
}

export interface SessionResponse {
  sessionId: string;
  status: SessionStatus;
  expiresAt: Date;
  context: UserContext;
}

// ============================================================================
// Context State Management Types
// ============================================================================

export interface ContextState {
  stateId: string;
  sessionId: string;
  stateData: Record<string, any>;
  historyStack: ContextStateSnapshot[];
  reconstructionData?: ContextRecoveryData;
  lastUpdate: Date;
  isCorrupted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextStateSnapshot {
  timestamp: Date;
  data: Record<string, any>;
  contextValid: boolean;
  checksum?: string;
}

export interface ContextRecoveryData {
  attemptCount: number;
  lastAttempt: Date;
  recoveryMethod: 'session_history' | 'jwt_refresh' | 'fallback';
  recoverableElements: string[];
  missingElements: string[];
}

// ============================================================================
// Domain Dataset Types
// ============================================================================

export interface DomainDataset {
  datasetId: string;
  domainType: DomainType;
  tableName: string;
  schema: DatasetSchema;
  relationships: DatasetRelationship[];
  accessLevel: 'public' | 'restricted' | 'admin';
  dataQuality?: DataQualityMetrics;
  lastAnalyzed?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatasetSchema {
  fields: FieldDefinition[];
  primaryKey?: string;
  indexes: string[];
}

export interface FieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  nullable: boolean;
  description?: string;
}

export interface DatasetRelationship {
  sourceField: string;
  targetDataset: string;
  targetField: string;
  relationshipType: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface DataQualityMetrics {
  completeness: number; // 0-1
  consistency: number; // 0-1
  accuracy: number; // 0-1
  timeliness: number; // 0-1
  validity: number; // 0-1
}

// ============================================================================
// Agent Architecture Pattern Types
// ============================================================================

export interface AgentArchitecturePattern {
  patternId: string;
  patternType: PatternType;
  queryComplexity: QueryComplexityMetrics;
  performanceMetrics: PatternPerformanceMetrics;
  usageCount: number;
  successRate: number;
  lastEvaluated?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryComplexityMetrics {
  domainCount: number;
  joinComplexity: number;
  aggregationComplexity: number;
  filterComplexity: number;
  totalScore: number;
}

export interface PatternPerformanceMetrics {
  averageResponseTime: number;
  accuracy: number;
  resourceUsage: ResourceUsageMetrics;
  errorRate: number;
}

export interface ResourceUsageMetrics {
  cpuUsage: number;
  memoryUsage: number;
  networkLatency: number;
  databaseConnections: number;
}

// ============================================================================
// Agent Architecture Pattern Types
// ============================================================================

export interface AgentArchitecturePattern {
  patternId: string;
  patternType: PatternType;
  name: string;
  description: string;
  queryComplexity: QueryComplexityMetrics;
  performanceMetrics: PatternPerformanceMetrics;
  usageCount: number;
  successRate: number;
  lastEvaluated: Date;
  configuration: PatternConfiguration;
  isActive: boolean;
  metadata: Record<string, any>;
}

export interface PatternConfiguration {
  maxConcurrency: number;
  timeoutMs: number;
  retryAttempts: number;
  cachingEnabled: boolean;
  streamingThreshold: number;
  complexityThreshold: number;
  resourceLimits: ResourceUsageMetrics;
}

export interface PatternEvaluationResult {
  patternId: string;
  score: number;
  confidence: number;
  recommendation: string;
  benchmarkResults: BenchmarkResult[];
  alternatives: AlternativePattern[];
  timestamp: Date;
}

export interface BenchmarkResult {
  benchmarkId: string;
  queryType: string;
  executionTime: number;
  accuracy: number;
  resourceUsage: ResourceUsageMetrics;
  errorCount: number;
  timestamp: Date;
}

export interface AlternativePattern {
  patternType: PatternType;
  score: number;
  reason: string;
  tradeoffs: string[];
}

export interface ArchitectureRecommendation {
  recommendedPattern: PatternType;
  confidence: number;
  reasoning: string;
  queryCharacteristics: QueryCharacteristics;
  performancePrediction: PatternPerformanceMetrics;
  implementationSuggestions: string[];
}

export interface QueryCharacteristics {
  complexity: number;
  domainCount: number;
  dataVolume: 'small' | 'medium' | 'large';
  realTimeRequirement: boolean;
  interactivityLevel: 'low' | 'medium' | 'high';
  accuracyRequirement: 'standard' | 'high' | 'critical';
}

// ============================================================================
// Memory Management Types
// ============================================================================

export interface MemoryEntry {
  memoryId: string;
  scope: MemoryScope;
  userId?: string; // null for global scope
  contentType: ContentType;
  content: Record<string, any>;
  embeddings?: number[]; // pgvector embeddings
  createdAt: Date;
  lastAccessed: Date;
}

export interface MemorySearchQuery {
  query: string;
  scope: MemoryScope;
  userId?: string;
  contentType?: ContentType;
  limit?: number;
  threshold?: number;
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  total: number;
  searchTime: number;
}

// ============================================================================
// Validation Schemas (Zod)
// ============================================================================

export const DomainPermissionsSchema = z.object({
  read: z.boolean(),
  query: z.boolean(),
  export: z.boolean(),
  departments: z.array(z.string()).optional(),
});

export const PermissionMatrixSchema = z.object({
  clinical: DomainPermissionsSchema,
  financial: DomainPermissionsSchema,
  operational: DomainPermissionsSchema,
  'customer-service': DomainPermissionsSchema,
});

export const UserPreferencesSchema = z.object({
  defaultVisualization: z.enum(['chart', 'table', 'graph']).optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),
});

export const UserContextSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  roleId: z.string(),
  departmentScope: z.array(z.string()),
  permissions: PermissionMatrixSchema,
  preferences: UserPreferencesSchema.optional(),
  lastActivity: z.date(),
  tokenExpiry: z.date(),
  isAnonymous: z.boolean(),
  status: z.enum(['active', 'paused', 'completed', 'failed', 'degraded']),
});

export const SessionCreateRequestSchema = z.object({
  sessionType: z.enum(['interactive', 'automated', 'batch']).optional(),
  preferences: UserPreferencesSchema.optional(),
});

export const QueryHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  query: z.string(),
  timestamp: z.date(),
  domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])),
  results: z.any().optional(),
  duration: z.number().optional(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const MemorySearchQuerySchema = z.object({
  query: z.string(),
  scope: z.enum(['user', 'global']),
  userId: z.string().uuid().optional(),
  contentType: z.enum(['conversation', 'knowledge', 'preference']).optional(),
  limit: z.number().min(1).max(100).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
});

// Agent Architecture Pattern Validation Schemas
export const ResourceUsageMetricsSchema = z.object({
  cpuUsage: z.number().min(0).max(100),
  memoryUsage: z.number().min(0),
  networkLatency: z.number().min(0),
  databaseConnections: z.number().min(0),
});

export const PatternConfigurationSchema = z.object({
  maxConcurrency: z.number().min(1).max(100),
  timeoutMs: z.number().min(1000).max(300000), // 1s to 5min
  retryAttempts: z.number().min(0).max(5),
  cachingEnabled: z.boolean(),
  streamingThreshold: z.number().min(0).max(1),
  complexityThreshold: z.number().min(0).max(100),
  resourceLimits: ResourceUsageMetricsSchema,
});

export const QueryComplexityMetricsSchema = z.object({
  domainCount: z.number().min(1).max(4),
  joinComplexity: z.number().min(0).max(10),
  aggregationComplexity: z.number().min(0).max(10),
  filterComplexity: z.number().min(0).max(10),
  totalScore: z.number().min(0).max(100),
});

export const PatternPerformanceMetricsSchema = z.object({
  averageResponseTime: z.number().min(0),
  accuracy: z.number().min(0).max(1),
  resourceUsage: ResourceUsageMetricsSchema,
  errorRate: z.number().min(0).max(1),
});

export const AgentArchitecturePatternSchema = z.object({
  patternId: z.string().uuid(),
  patternType: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  queryComplexity: QueryComplexityMetricsSchema,
  performanceMetrics: PatternPerformanceMetricsSchema,
  usageCount: z.number().min(0),
  successRate: z.number().min(0).max(1),
  lastEvaluated: z.date(),
  configuration: PatternConfigurationSchema,
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.any()),
});

export const QueryCharacteristicsSchema = z.object({
  complexity: z.number().min(0).max(100),
  domainCount: z.number().min(1).max(4),
  dataVolume: z.enum(['small', 'medium', 'large']),
  realTimeRequirement: z.boolean(),
  interactivityLevel: z.enum(['low', 'medium', 'high']),
  accuracyRequirement: z.enum(['standard', 'high', 'critical']),
});

export const BenchmarkResultSchema = z.object({
  benchmarkId: z.string().uuid(),
  queryType: z.string(),
  executionTime: z.number().min(0),
  accuracy: z.number().min(0).max(1),
  resourceUsage: ResourceUsageMetricsSchema,
  errorCount: z.number().min(0),
  timestamp: z.date(),
});

export const AlternativePatternSchema = z.object({
  patternType: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']),
  score: z.number().min(0).max(100),
  reason: z.string(),
  tradeoffs: z.array(z.string()),
});

export const PatternEvaluationResultSchema = z.object({
  patternId: z.string().uuid(),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  recommendation: z.string(),
  benchmarkResults: z.array(BenchmarkResultSchema),
  alternatives: z.array(AlternativePatternSchema),
  timestamp: z.date(),
});

export const ArchitectureRecommendationSchema = z.object({
  recommendedPattern: z.enum(['planner-executor', 'reactive', 'streaming', 'hybrid']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  queryCharacteristics: QueryCharacteristicsSchema,
  performancePrediction: PatternPerformanceMetricsSchema,
  implementationSuggestions: z.array(z.string()),
});

// ============================================================================
// Utility Types
// ============================================================================

export interface ContextUpdate {
  preferences?: UserPreferences;
  lastActivity?: Date;
  queryHistory?: QueryHistoryEntry[];
  contextState?: Record<string, any>;
}

export interface RecoveryResult {
  status: 'success' | 'partial' | 'failed';
  recoveredElements: string[];
  missingElements: string[];
  message: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
}

// ============================================================================
// Constants
// ============================================================================

export const ANONYMOUS_USER_ID = 'anonymous';
export const DEFAULT_SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 hours
export const DEFAULT_REFRESH_THRESHOLD = 15 * 60 * 1000; // 15 minutes
export const MAX_HISTORY_ENTRIES = 100;
export const MAX_RECOVERY_ATTEMPTS = 3;

export const DEFAULT_ANONYMOUS_PERMISSIONS: PermissionMatrix = {
  clinical: { read: false, query: false, export: false },
  financial: { read: false, query: false, export: false },
  operational: { read: true, query: false, export: false },
  'customer-service': { read: true, query: false, export: false },
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultVisualization: 'chart',
  timezone: 'UTC',
  language: 'en-US',
  theme: 'light',
};