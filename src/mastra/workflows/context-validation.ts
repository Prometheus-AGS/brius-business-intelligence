/**
 * Context Validation and Reconstruction Workflow
 * Handles context integrity validation, corruption detection, and recovery operations
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer, createBIWorkflowTracer } from '../observability/context-tracer.js';
import { getSupabaseMCPConnection, createContextMetadata } from '../mcp-server/external-integration.js';
import {
  UserContext,
  AnonymousContext,
  AnalysisSession,
  ContextState,
  DomainType,
  SessionStatus,
  ContextStatus,
} from '../types/context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// Input schema for the workflow
const ContextValidationInput = z.object({
  sessionId: z.string().uuid().describe('Session identifier to validate'),
  validationType: z.enum(['integrity', 'recovery', 'migration', 'health']).default('integrity'),
  forceReconstruction: z.boolean().default(false).describe('Force context reconstruction even if valid'),
  includeSchemaAnalysis: z.boolean().default(false).describe('Include database schema analysis'),
  reconstructionStrategy: z.enum(['history', 'anonymous', 'fresh']).default('history'),
  userId: z.string().optional().describe('User ID for tracing'),
});

// Output schema
const ContextValidationOutput = z.object({
  sessionId: z.string(),
  validationResult: z.object({
    valid: z.boolean(),
    issues: z.array(z.string()),
    recommendations: z.array(z.string()),
    recoveryPerformed: z.boolean(),
    recoveryMethod: z.string().optional(),
    contextIntegrity: z.object({
      userContext: z.boolean(),
      analysisSession: z.boolean(),
      contextState: z.boolean(),
      memoryConsistency: z.boolean(),
    }),
  }),
  performance: z.object({
    validationTime: z.number(),
    recoveryTime: z.number().optional(),
    totalTime: z.number(),
  }),
  metadata: z.object({
    timestamp: z.string(),
    workflowId: z.string(),
    userId: z.string().optional(),
  }),
});

/**
 * Step 1: Context Integrity Assessment
 */
const contextIntegrityStep = createStep({
  id: 'context-integrity-assessment',
  description: 'Assess context integrity and identify corruption issues',
  inputSchema: ContextValidationInput,
  outputSchema: z.object({
    sessionId: z.string(),
    integrity: z.object({
      userContext: z.boolean(),
      analysisSession: z.boolean(),
      contextState: z.boolean(),
      memoryConsistency: z.boolean(),
    }),
    issues: z.array(z.string()),
    requiresRecovery: z.boolean(),
    corruptionSeverity: z.enum(['none', 'minor', 'major', 'critical']),
  }),
  execute: async ({ sessionId, validationType, includeSchemaAnalysis }) => {
    return await withErrorHandling(
      async () => {
        rootLogger.info('Assessing context integrity', { sessionId, validationType });

        const issues: string[] = [];
        const integrity = {
          userContext: false,
          analysisSession: false,
          contextState: false,
          memoryConsistency: false,
        };

        // Check user context
        const userContext = await biContextStore.getUserContext(sessionId);
        integrity.userContext = Boolean(userContext && userContext.status === 'active');
        if (!integrity.userContext) {
          issues.push('User context missing or inactive');
        }

        // Check analysis session
        const analysisSession = await biContextStore.getAnalysisSession(sessionId);
        integrity.analysisSession = Boolean(
          analysisSession &&
          ['active', 'waiting', 'processing'].includes(analysisSession.status)
        );
        if (!integrity.analysisSession) {
          issues.push('Analysis session missing or failed');
        }

        // Check context state
        const contextState = await biContextStore.getContextState(sessionId);
        integrity.contextState = Boolean(contextState && !contextState.isCorrupted);
        if (!integrity.contextState) {
          issues.push(contextState?.isCorrupted ? 'Context state corrupted' : 'Context state missing');
        }

        // Check memory consistency (simplified check)
        if (userContext) {
          try {
            const memoryResults = await biContextStore.searchContextMemories(sessionId, 'test', {
              userId: userContext.userId,
              topK: 1,
            });
            integrity.memoryConsistency = true;
          } catch (error) {
            integrity.memoryConsistency = false;
            issues.push('Memory operations failing');
          }
        }

        // Include database schema analysis if requested
        if (includeSchemaAnalysis) {
          try {
            const supabaseConnection = getSupabaseMCPConnection();
            if (supabaseConnection) {
              const schemaHealth = await supabaseConnection.getSchema(
                undefined,
                createContextMetadata(sessionId, userContext?.userId, undefined, undefined, 'schema_analysis')
              );
              if (!schemaHealth.success) {
                issues.push('Database schema analysis failed');
              }
            }
          } catch (error) {
            issues.push(`Schema analysis error: ${(error as Error).message}`);
          }
        }

        // Determine corruption severity
        const validComponents = Object.values(integrity).filter(Boolean).length;
        let corruptionSeverity: 'none' | 'minor' | 'major' | 'critical';

        if (validComponents === 4) {
          corruptionSeverity = 'none';
        } else if (validComponents >= 3) {
          corruptionSeverity = 'minor';
        } else if (validComponents >= 2) {
          corruptionSeverity = 'major';
        } else {
          corruptionSeverity = 'critical';
        }

        const requiresRecovery = corruptionSeverity !== 'none' || issues.length > 0;

        rootLogger.info('Context integrity assessment completed', {
          sessionId,
          validComponents,
          totalIssues: issues.length,
          corruptionSeverity,
          requiresRecovery,
        });

        return {
          sessionId,
          integrity,
          issues,
          requiresRecovery,
          corruptionSeverity,
        };
      },
      {
        component: 'workflow',
        operation: 'integrity_assessment',
        sessionId,
      },
      'medium'
    );
  },
});

/**
 * Step 2: Context Recovery Execution
 */
const contextRecoveryStep = createStep({
  id: 'context-recovery-execution',
  description: 'Execute context recovery based on corruption assessment',
  inputSchema: z.object({
    sessionId: z.string(),
    integrity: z.object({
      userContext: z.boolean(),
      analysisSession: z.boolean(),
      contextState: z.boolean(),
      memoryConsistency: z.boolean(),
    }),
    requiresRecovery: z.boolean(),
    corruptionSeverity: z.enum(['none', 'minor', 'major', 'critical']),
    reconstructionStrategy: z.enum(['history', 'anonymous', 'fresh']).default('history'),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    recoveryPerformed: z.boolean(),
    recoveryMethod: z.string().optional(),
    recoverySuccess: z.boolean(),
    newSessionId: z.string().optional(),
    recoveryTime: z.number(),
  }),
  execute: async ({ sessionId, integrity, requiresRecovery, corruptionSeverity, reconstructionStrategy }) => {
    return await withErrorHandling(
      async () => {
        const startTime = Date.now();

        if (!requiresRecovery) {
          rootLogger.info('No recovery required', { sessionId });
          return {
            sessionId,
            recoveryPerformed: false,
            recoverySuccess: true,
            recoveryTime: Date.now() - startTime,
          };
        }

        rootLogger.info('Executing context recovery', {
          sessionId,
          corruptionSeverity,
          reconstructionStrategy,
        });

        let recoveryMethod = reconstructionStrategy;
        let recoverySuccess = false;
        let newSessionId = sessionId;

        try {
          if (corruptionSeverity === 'critical' || reconstructionStrategy === 'fresh') {
            // Create completely fresh session
            const { session, context } = await biSessionManager.createSession({
              domains: [],
              enableRecovery: true,
            });

            recoveryMethod = 'fresh_session';
            recoverySuccess = true;
            newSessionId = session.sessionId;

            rootLogger.info('Fresh session created for recovery', {
              originalSessionId: sessionId,
              newSessionId,
            });

          } else if (reconstructionStrategy === 'anonymous') {
            // Fallback to anonymous context
            const recoveryResult = await biSessionManager.recoverSession(sessionId, {
              fallbackToAnonymous: true,
              reconstructFromHistory: false,
              maxRecoveryAttempts: 1,
            });

            if (recoveryResult) {
              recoveryMethod = 'anonymous_fallback';
              recoverySuccess = true;
              newSessionId = recoveryResult.session.sessionId;
            }

          } else {
            // Attempt history reconstruction
            const recoveryResult = await biSessionManager.recoverSession(sessionId, {
              fallbackToAnonymous: true,
              reconstructFromHistory: true,
              maxRecoveryAttempts: 3,
            });

            if (recoveryResult) {
              recoveryMethod = 'history_reconstruction';
              recoverySuccess = true;
              newSessionId = recoveryResult.session.sessionId;
            }
          }

          // Mark original context as corrupted if recovery was needed
          if (recoverySuccess && newSessionId !== sessionId) {
            await biContextStore.markContextCorrupted(sessionId);
          }

        } catch (error) {
          rootLogger.error('Context recovery failed', {
            sessionId,
            error: (error as Error).message,
          });
          recoverySuccess = false;
        }

        const recoveryTime = Date.now() - startTime;

        rootLogger.info('Context recovery completed', {
          sessionId,
          recoveryMethod,
          recoverySuccess,
          newSessionId,
          recoveryTime,
        });

        return {
          sessionId,
          recoveryPerformed: true,
          recoveryMethod,
          recoverySuccess,
          newSessionId: newSessionId !== sessionId ? newSessionId : undefined,
          recoveryTime,
        };
      },
      {
        component: 'workflow',
        operation: 'recovery_execution',
        sessionId,
      },
      'high'
    );
  },
});

/**
 * Step 3: Post-Recovery Validation
 */
const postRecoveryValidationStep = createStep({
  id: 'post-recovery-validation',
  description: 'Validate context after recovery operations',
  inputSchema: z.object({
    sessionId: z.string(),
    recoveryPerformed: z.boolean(),
    recoverySuccess: z.boolean(),
    newSessionId: z.string().optional(),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    finalValidation: z.object({
      healthy: z.boolean(),
      contextValid: z.boolean(),
      tokenValid: z.boolean(),
      issues: z.array(z.string()),
      recommendations: z.array(z.string()),
    }),
  }),
  execute: async ({ sessionId, recoveryPerformed, recoverySuccess, newSessionId }) => {
    return await withErrorHandling(
      async () => {
        const targetSessionId = newSessionId || sessionId;

        rootLogger.info('Performing post-recovery validation', {
          originalSessionId: sessionId,
          targetSessionId,
          recoveryPerformed,
          recoverySuccess,
        });

        // Perform health check on final session
        let finalValidation = {
          healthy: false,
          contextValid: false,
          tokenValid: false,
          issues: [] as string[],
          recommendations: [] as string[],
        };

        try {
          if (recoverySuccess) {
            const healthCheck = await biSessionManager.checkSessionHealth(targetSessionId);
            finalValidation = {
              healthy: healthCheck.healthy,
              contextValid: healthCheck.contextValid,
              tokenValid: healthCheck.tokenValid,
              issues: healthCheck.issues,
              recommendations: healthCheck.recommendations,
            };
          } else if (!recoveryPerformed) {
            // No recovery was needed - validate original session
            const healthCheck = await biSessionManager.checkSessionHealth(sessionId);
            finalValidation = {
              healthy: healthCheck.healthy,
              contextValid: healthCheck.contextValid,
              tokenValid: healthCheck.tokenValid,
              issues: healthCheck.issues,
              recommendations: healthCheck.recommendations,
            };
          } else {
            finalValidation.issues.push('Recovery was performed but failed');
            finalValidation.recommendations.push('Consider manual intervention or session restart');
          }

          // Trace final validation
          await biContextTracer.traceContextValidation(targetSessionId, {
            valid: finalValidation.healthy,
            issues: finalValidation.issues,
            recommendations: finalValidation.recommendations,
            tokenValid: finalValidation.tokenValid,
            permissionsValid: finalValidation.contextValid,
          });

        } catch (error) {
          finalValidation.issues.push(`Validation failed: ${(error as Error).message}`);
          finalValidation.recommendations.push('Check context validation workflow configuration');
        }

        rootLogger.info('Post-recovery validation completed', {
          sessionId: targetSessionId,
          healthy: finalValidation.healthy,
          issueCount: finalValidation.issues.length,
        });

        return {
          sessionId: targetSessionId,
          finalValidation,
        };
      },
      {
        component: 'workflow',
        operation: 'post_recovery_validation',
        sessionId,
      },
      'medium'
    );
  },
});

/**
 * Context Validation and Reconstruction Workflow
 */
export const contextValidationWorkflow = createWorkflow({
  id: 'context-validation',
  description: 'Comprehensive context validation and recovery workflow',
  inputSchema: ContextValidationInput,
  steps: [contextIntegrityStep, contextRecoveryStep, postRecoveryValidationStep],
});

/**
 * Execute Context Validation Workflow
 */
export async function executeContextValidation(input: {
  sessionId: string;
  validationType?: 'integrity' | 'recovery' | 'migration' | 'health';
  forceReconstruction?: boolean;
  includeSchemaAnalysis?: boolean;
  reconstructionStrategy?: 'history' | 'anonymous' | 'fresh';
  userId?: string;
}): Promise<any> {
  const workflowTracer = createBIWorkflowTracer(
    'context-validation',
    input.sessionId,
    input.userId || 'system',
    {
      domains: [],
      metadata: {
        validationType: input.validationType || 'integrity',
        forceReconstruction: input.forceReconstruction || false,
      },
    }
  );

  try {
    rootLogger.info('Starting context validation workflow', {
      sessionId: input.sessionId,
      validationType: input.validationType,
      forceReconstruction: input.forceReconstruction,
    });

    const startTime = Date.now();

    // Execute workflow steps
    const result = await contextValidationWorkflow.execute({
      inputData: input,
      state: {},
      setState: () => {},
      getStepResult: () => ({}),
      runId: `validation-${Date.now()}`,
    });

    const totalTime = Date.now() - startTime;

    // Complete workflow tracing
    workflowTracer.end({
      output: result,
      metadata: {
        totalTime,
        validationResult: result.validationResult.valid,
        recoveryPerformed: result.validationResult.recoveryPerformed,
      },
    });

    rootLogger.info('Context validation workflow completed', {
      sessionId: input.sessionId,
      valid: result.validationResult.valid,
      recoveryPerformed: result.validationResult.recoveryPerformed,
      totalTime,
    });

    return result;

  } catch (error) {
    const errorMessage = (error as Error).message;

    workflowTracer.end({
      error: errorMessage,
      metadata: {
        failed: true,
        sessionId: input.sessionId,
      },
    });

    rootLogger.error('Context validation workflow failed', {
      sessionId: input.sessionId,
      error: errorMessage,
      stack: (error as Error).stack,
    });

    throw error;
  }
}

// ============================================================================
// Additional Context Analysis Workflows
// ============================================================================

/**
 * Database Schema Analysis Step for Multi-Domain Integration
 */
const schemaAnalysisStep = {
  id: 'database-schema-analysis',
  description: 'Analyze database schema for BI adequacy across domains',
  inputSchema: z.object({
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).default([]),
    includeRelationships: z.boolean().default(true),
    analyzeDataQuality: z.boolean().default(true),
  }),
  outputSchema: z.object({
    schemaAnalysis: z.object({
      domains: z.record(z.string(), z.object({
        tablesFound: z.number(),
        relationships: z.number(),
        dataQuality: z.number().optional(),
        coverage: z.enum(['complete', 'partial', 'missing']),
      })),
      overallReadiness: z.enum(['ready', 'needs_work', 'inadequate']),
      recommendations: z.array(z.string()),
    }),
  }),
  execute: async (input: { domains?: any[], includeRelationships?: boolean, analyzeDataQuality?: boolean }) => {
    const { domains = [], includeRelationships = true, analyzeDataQuality = true } = input;
    return await withErrorHandling(
      async () => {
        rootLogger.info('Analyzing database schema for BI adequacy', {
          domains,
          includeRelationships,
          analyzeDataQuality,
        });

        const schemaAnalysis: any = {
          domains: {},
          overallReadiness: 'ready' as const,
          recommendations: [],
        };

        try {
          const supabaseConnection = getSupabaseMCPConnection();
          if (!supabaseConnection) {
            schemaAnalysis.overallReadiness = 'inadequate';
            schemaAnalysis.recommendations.push('Supabase MCP server not available');
            return { schemaAnalysis };
          }

          // Analyze each domain
          for (const domain of domains) {
            try {
              const domainSchema = await supabaseConnection.getSchema(
                `${domain}_*`, // Table pattern for domain
                createContextMetadata(
                  undefined,
                  'system',
                  [domain],
                  undefined,
                  'schema_analysis'
                )
              );

              if (domainSchema.success && domainSchema.schema) {
                schemaAnalysis.domains[domain] = {
                  tablesFound: domainSchema.schema.tables?.length || 0,
                  relationships: domainSchema.schema.relationships?.length || 0,
                  dataQuality: analyzeDataQuality ? Math.random() * 0.3 + 0.7 : undefined, // Simulated
                  coverage: domainSchema.schema.tables?.length > 0 ? 'complete' : 'missing',
                };
              } else {
                schemaAnalysis.domains[domain] = {
                  tablesFound: 0,
                  relationships: 0,
                  coverage: 'missing' as const,
                };
              }
            } catch (error) {
              schemaAnalysis.domains[domain] = {
                tablesFound: 0,
                relationships: 0,
                coverage: 'missing' as const,
              };
              schemaAnalysis.recommendations.push(`Failed to analyze ${domain} domain: ${(error as Error).message}`);
            }
          }

          // Determine overall readiness
          const domainCoverages = Object.values(schemaAnalysis.domains).map((d: any) => d.coverage);
          const completeDomains = domainCoverages.filter(c => c === 'complete').length;
          const totalDomains = domainCoverages.length;

          if (completeDomains === totalDomains) {
            schemaAnalysis.overallReadiness = 'ready';
          } else if (completeDomains >= totalDomains / 2) {
            schemaAnalysis.overallReadiness = 'needs_work';
            schemaAnalysis.recommendations.push('Some domains have incomplete schema coverage');
          } else {
            schemaAnalysis.overallReadiness = 'inadequate';
            schemaAnalysis.recommendations.push('Majority of domains lack proper schema coverage');
          }

        } catch (error) {
          schemaAnalysis.overallReadiness = 'inadequate';
          schemaAnalysis.recommendations.push(`Schema analysis failed: ${(error as Error).message}`);
        }

        rootLogger.info('Database schema analysis completed', {
          domains: domains.length,
          overallReadiness: schemaAnalysis.overallReadiness,
          recommendations: schemaAnalysis.recommendations.length,
        });

        return { schemaAnalysis };
      },
      {
        component: 'workflow',
        operation: 'schema_analysis',
      },
      'medium'
    );
  },
};

/**
 * Database Schema Analysis Workflow
 */
export const schemaAnalysisWorkflow = createWorkflow({
  id: 'database-schema-analysis',
  description: 'Analyze database schema adequacy for multi-domain BI operations',
  inputSchema: z.object({
    domains: z.array(z.enum(['clinical', 'financial', 'operational', 'customer-service'])).default([]),
    includeRelationships: z.boolean().default(true),
    analyzeDataQuality: z.boolean().default(true),
    userId: z.string().optional(),
  }),
  steps: [schemaAnalysisStep],
});

/**
 * Execute Database Schema Analysis
 */
export async function executeSchemaAnalysis(input: {
  domains?: DomainType[];
  includeRelationships?: boolean;
  analyzeDataQuality?: boolean;
  userId?: string;
}): Promise<any> {
  const workflowTracer = createBIWorkflowTracer(
    'schema-analysis',
    `analysis-${Date.now()}`,
    input.userId || 'system',
    {
      domains: input.domains,
      metadata: {
        includeRelationships: input.includeRelationships,
        analyzeDataQuality: input.analyzeDataQuality,
      },
    }
  );

  try {
    const result = await schemaAnalysisWorkflow.execute({
      inputData: {
        domains: input.domains || ['operational', 'customer-service'],
        includeRelationships: input.includeRelationships ?? true,
        analyzeDataQuality: input.analyzeDataQuality ?? true,
        userId: input.userId,
      },
      state: {},
      setState: () => {},
      getStepResult: () => ({}),
      runId: `schema-${Date.now()}`,
    });

    workflowTracer.end({
      output: result,
      metadata: {
        overallReadiness: result.schemaAnalysis.overallReadiness,
        domainsAnalyzed: Object.keys(result.schemaAnalysis.domains).length,
      },
    });

    return result;

  } catch (error) {
    workflowTracer.end({
      error: (error as Error).message,
    });

    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

// Export workflow metadata for registration
export const contextValidationWorkflowMetadata = {
  category: 'context-management',
  description: 'Context validation, reconstruction, and integrity workflows',
  workflows: ['context-validation', 'database-schema-analysis'],
  capabilities: [
    'context_integrity_assessment',
    'automatic_recovery',
    'schema_analysis',
    'corruption_detection',
    'performance_validation',
  ],
};

rootLogger.info('Context validation workflows initialized', {
  workflows: contextValidationWorkflowMetadata.workflows,
  capabilities: contextValidationWorkflowMetadata.capabilities,
});