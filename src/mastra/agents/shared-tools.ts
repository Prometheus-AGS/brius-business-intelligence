import type { Tool } from '@mastra/core/tools';
import { initializeMCPToolRegistration, getMCPTools } from '../tools/mcp-registry.js';
import { bedrockTools } from '../tools/bedrock-tools.js';
import { supabaseTools } from '../tools/supabase-tools.js';
import { memoryTools } from '../tools/memory-tools.js';
import { knowledgeSearchTools } from '../tools/knowledge-search.js';
import { orthodonticIntelligenceTools } from '../tools/orthodontic-intelligence-tools.js';
import { visualizationTools } from '../tools/visualization-tools.js';
import { astCodeGenerationTools } from '../tools/ast-code-generation.js';
import { visualizationTemplateTools } from '../tools/visualization-templates.js';
import { dataBindingGeneratorTools } from '../tools/data-binding-generator.js';
import { artifactManagementTools } from '../tools/artifact-management.js';
import { componentValidationTools } from '../tools/component-validation.js';
import type { BedrockTool } from '../types/bedrock.js';
import { mcpToolRegistry } from '../mcp/registry.js';
import { rootLogger } from '../observability/logger.js';
import {
  UserContext,
  AnonymousContext,
  DomainType,
  DomainDataset,
  DatasetSchema,
  DatasetRelationship,
  DataQualityMetrics,
  PermissionMatrix
} from '../types/context.js';
import { getSupabaseMCPConnection, createContextMetadata } from '../mcp-server/external-integration.js';
import { biContextStore } from '../memory/context-store.js';
import { biContextTracer } from '../observability/context-tracer.js';

let cachedToolMap: Record<string, any> | null = null;
let isInitialized = false;

export async function ensureMcpToolsLoaded(): Promise<void> {
  if (isInitialized) return;
  
  try {
    rootLogger.info('🔥 STARTING MCP TOOLS INITIALIZATION');
    
    // Initialize MCP registry first
    rootLogger.info('🔥 INITIALIZING MCP REGISTRY');
    await mcpToolRegistry.initialize();
    rootLogger.info('🔥 MCP REGISTRY INITIALIZED');
    
    // Initialize MCP tool registration manager
    rootLogger.info('🔥 INITIALIZING MCP TOOL REGISTRATION');
    await initializeMCPToolRegistration();
    rootLogger.info('🔥 MCP TOOL REGISTRATION INITIALIZED');
    
    // Refresh tool cache
    refreshToolCache();
    
    isInitialized = true;
    rootLogger.info('🔥 MCP TOOLS INITIALIZATION COMPLETED', {
      total_tools: cachedToolMap ? Object.keys(cachedToolMap).length : 0,
      mcp_tools: getMCPTools().length,
      bedrock_tools: bedrockTools.length,
    });
    
  } catch (error) {
    rootLogger.error('🔥 MCP TOOLS INITIALIZATION FAILED', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Continue with just Bedrock tools if MCP fails
    refreshToolCache();
    isInitialized = true;
  }
}

/**
 * Convert BedrockTool to Mastra Tool format
 */
function convertBedrockToolToMastraTool(bedrockTool: BedrockTool): Tool {
  return {
    id: bedrockTool.id,
    description: bedrockTool.description,
    inputSchema: bedrockTool.inputSchema as any,
    outputSchema: bedrockTool.outputSchema as any,
    execute: bedrockTool.execute as any,
  };
}

/**
 * Convert custom Supabase tool to Mastra Tool format
 */
function convertSupabaseToolToMastraTool(supabaseTool: any): Tool {
  return {
    id: supabaseTool.id,
    description: supabaseTool.description,
    inputSchema: supabaseTool.inputSchema as any,
    execute: supabaseTool.execute as any,
  };
}

function refreshToolCache() {
  try {
    // Get MCP tools from the registration manager
    const mcpTools = getMCPTools();

    // Convert Bedrock tools to Mastra Tool format
    const convertedBedrockTools = bedrockTools.map(convertBedrockToolToMastraTool);

    // Convert custom Supabase tools to Mastra Tool format
    const convertedSupabaseTools = supabaseTools.map(convertSupabaseToolToMastraTool);

    // Convert orthodontic intelligence tools to Mastra Tool format
    const convertedOrthodonticTools = orthodonticIntelligenceTools.map(convertSupabaseToolToMastraTool);

    rootLogger.info('🔥 REFRESHING TOOL CACHE', {
      mcp_tools_count: mcpTools.length,
      bedrock_tools_count: bedrockTools.length,
      supabase_tools_count: convertedSupabaseTools.length,
      orthodontic_tools_count: convertedOrthodonticTools.length,
      memory_tools_count: memoryTools.length,
      knowledge_tools_count: knowledgeSearchTools.length,
      visualization_tools_count: visualizationTools.length,
      ast_tools_count: astCodeGenerationTools.length,
      template_tools_count: visualizationTemplateTools.length,
      binding_tools_count: dataBindingGeneratorTools.length,
      artifact_tools_count: artifactManagementTools.length,
      validation_tools_count: componentValidationTools.length,
      mcp_tool_ids: mcpTools.map(t => t.id),
      supabase_tool_ids: convertedSupabaseTools.map(t => t.id),
      orthodontic_tool_ids: convertedOrthodonticTools.map(t => t.id),
      memory_tool_ids: memoryTools.map(t => t.id),
      knowledge_tool_ids: knowledgeSearchTools.map(t => t.id),
      visualization_tool_ids: visualizationTools.map(t => t.id),
      mcp_tools_sample: mcpTools.slice(0, 3).map(t => ({ id: t.id, description: t.description })),
    });

    // Combine all tools including orthodontic intelligence tools and visualization tools
    const allTools = [
      ...mcpTools,
      ...convertedBedrockTools,
      ...convertedSupabaseTools,
      ...convertedOrthodonticTools,
      ...memoryTools,
      ...knowledgeSearchTools,
      ...visualizationTools,
      ...astCodeGenerationTools,
      ...visualizationTemplateTools,
      ...dataBindingGeneratorTools,
      ...artifactManagementTools,
      ...componentValidationTools
    ];

    cachedToolMap = allTools.reduce<Record<string, any>>((acc, tool) => {
      acc[tool.id] = tool;
      return acc;
    }, {});

    rootLogger.info('🔥 TOOL CACHE REFRESHED', {
      total_tools: allTools.length,
      tool_ids: allTools.map(t => t.id),
    });

  } catch (error) {
    rootLogger.error('🔥 TOOL CACHE REFRESH FAILED', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback to Bedrock tools, custom Supabase tools, orthodontic tools, memory tools, knowledge search tools, and visualization tools
    const convertedBedrockTools = bedrockTools.map(convertBedrockToolToMastraTool);
    const convertedSupabaseTools = supabaseTools.map(convertSupabaseToolToMastraTool);
    const convertedOrthodonticTools = orthodonticIntelligenceTools.map(convertSupabaseToolToMastraTool);
    const fallbackTools = [
      ...convertedBedrockTools,
      ...convertedSupabaseTools,
      ...convertedOrthodonticTools,
      ...memoryTools,
      ...knowledgeSearchTools,
      ...visualizationTools,
      ...astCodeGenerationTools,
      ...visualizationTemplateTools,
      ...dataBindingGeneratorTools,
      ...artifactManagementTools,
      ...componentValidationTools
    ];

    cachedToolMap = fallbackTools.reduce<Record<string, any>>((acc, tool) => {
      acc[tool.id] = tool;
      return acc;
    }, {});
  }
}

export function getSharedToolMap(): Record<string, any> {
  if (!cachedToolMap) {
    refreshToolCache();
  }
  return cachedToolMap!;
}

/**
 * Get only Bedrock tools (converted to Mastra format)
 */
export function getBedrockTools(): Tool[] {
  return bedrockTools.map(convertBedrockToolToMastraTool);
}

/**
 * Get only custom Supabase tools (converted to Mastra format)
 */
export function getSupabaseTools(): Tool[] {
  return supabaseTools.map(convertSupabaseToolToMastraTool);
}

/**
 * Get tool counts by category
 */
export function getToolCounts(): {
  total: number;
  mcp: number;
  bedrock: number;
  supabase: number;
  orthodontic: number;
  memory: number;
  knowledge: number;
  visualization: number;
  ast: number;
  template: number;
  binding: number;
  artifact: number;
  validation: number;
} {
  try {
    const mcpTools = getMCPTools();

    const visualizationCount = visualizationTools.length + astCodeGenerationTools.length +
                              visualizationTemplateTools.length + dataBindingGeneratorTools.length +
                              artifactManagementTools.length + componentValidationTools.length;

    return {
      total: mcpTools.length + bedrockTools.length + supabaseTools.length + orthodonticIntelligenceTools.length +
             memoryTools.length + knowledgeSearchTools.length + visualizationCount,
      mcp: mcpTools.length,
      bedrock: bedrockTools.length,
      supabase: supabaseTools.length,
      orthodontic: orthodonticIntelligenceTools.length,
      memory: memoryTools.length,
      knowledge: knowledgeSearchTools.length,
      visualization: visualizationTools.length,
      ast: astCodeGenerationTools.length,
      template: visualizationTemplateTools.length,
      binding: dataBindingGeneratorTools.length,
      artifact: artifactManagementTools.length,
      validation: componentValidationTools.length,
    };
  } catch (error) {
    rootLogger.warn('🔥 FAILED TO GET TOOL COUNTS', {
      error: error instanceof Error ? error.message : String(error),
    });

    const visualizationCount = visualizationTools.length + astCodeGenerationTools.length +
                              visualizationTemplateTools.length + dataBindingGeneratorTools.length +
                              artifactManagementTools.length + componentValidationTools.length;

    return {
      total: bedrockTools.length + supabaseTools.length + orthodonticIntelligenceTools.length +
             memoryTools.length + knowledgeSearchTools.length + visualizationCount,
      mcp: 0,
      bedrock: bedrockTools.length,
      supabase: supabaseTools.length,
      orthodontic: orthodonticIntelligenceTools.length,
      memory: memoryTools.length,
      knowledge: knowledgeSearchTools.length,
      visualization: visualizationTools.length,
      ast: astCodeGenerationTools.length,
      template: visualizationTemplateTools.length,
      binding: dataBindingGeneratorTools.length,
      artifact: artifactManagementTools.length,
      validation: componentValidationTools.length,
    };
  }
}

/**
 * Get all available tools for agents (includes both MCP and Bedrock tools)
 */
export function getAllAvailableTools(): Tool[] {
  const toolMap = getSharedToolMap();
  return Object.values(toolMap);
}

/**
 * Get MCP tools specifically
 */
export function getMCPToolsForAgents(): Tool[] {
  try {
    return getMCPTools();
  } catch (error) {
    rootLogger.warn('🔥 FAILED TO GET MCP TOOLS FOR AGENTS', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Force refresh of tool cache (useful for testing or when tools are updated)
 */
export function forceRefreshTools(): void {
  rootLogger.info('🔥 FORCING TOOL CACHE REFRESH');
  cachedToolMap = null;
  refreshToolCache();
}

// ============================================================================
// Domain-Specific Data Adapters
// ============================================================================

/**
 * Interface for domain-specific data operations
 */
interface DomainDataAdapter {
  domainType: DomainType;
  transformData(rawData: any, context: UserContext | AnonymousContext): Promise<any>;
  validateData(data: any, schema?: DatasetSchema): Promise<{ valid: boolean; errors: string[] }>;
  normalizeFieldNames(data: any): any;
  applyAccessFilters(data: any, context: UserContext | AnonymousContext): Promise<any>;
  extractMetrics(data: any): Promise<Record<string, number>>;
  getRecommendedQueries(): string[];
}

/**
 * Clinical Domain Data Adapter
 * Handles medical records, treatment data, patient information, case management
 */
class ClinicalDomainAdapter implements DomainDataAdapter {
  domainType: DomainType = 'clinical';

  async transformData(rawData: any, context: UserContext | AnonymousContext): Promise<any> {
    try {
      rootLogger.info('Transforming clinical data', {
        dataType: Array.isArray(rawData) ? 'array' : typeof rawData,
        recordCount: Array.isArray(rawData) ? rawData.length : 1,
        userId: context.userId,
      });

      // Handle both single records and arrays
      const records = Array.isArray(rawData) ? rawData : [rawData];

      const transformedRecords = records.map(record => ({
        // Standardize patient identifiers
        patientId: record.patient_id || record.patientId || record.id,
        caseId: record.case_id || record.caseId,

        // Normalize treatment information
        treatmentType: this.normalizeTreatmentType(record.treatment_type || record.treatmentType),
        treatmentStatus: this.normalizeTreatmentStatus(record.status || record.treatment_status),
        treatmentPhase: record.treatment_phase || record.phase || 'unknown',

        // Standardize dates
        treatmentStartDate: this.normalizeDate(record.treatment_start_date || record.start_date || record.created_at),
        lastAppointmentDate: this.normalizeDate(record.last_appointment_date || record.last_visit),
        nextAppointmentDate: this.normalizeDate(record.next_appointment_date || record.next_visit),

        // Clinical metrics
        complexityScore: this.calculateComplexityScore(record),
        progressPercentage: this.calculateProgressPercentage(record),
        estimatedCompletionDate: this.estimateCompletionDate(record),

        // Provider information
        providerId: record.provider_id || record.doctor_id || record.practitioner_id,
        providerName: record.provider_name || record.doctor_name,
        clinicId: record.clinic_id || record.practice_id,

        // Treatment specifics for orthodontics
        applianceType: record.appliance_type || 'unknown',
        treatmentDuration: this.calculateTreatmentDuration(record),
        appointmentCount: record.appointment_count || 0,

        // Quality indicators
        patientSatisfaction: record.patient_satisfaction || record.satisfaction_score,
        treatmentCompliance: record.compliance || record.patient_compliance,

        // Preserve original data for auditing
        _originalData: record,
        _transformedAt: new Date().toISOString(),
        _transformedBy: context.userId,
      }));

      return Array.isArray(rawData) ? transformedRecords : transformedRecords[0];

    } catch (error) {
      rootLogger.error('Clinical data transformation failed', {
        error: (error as Error).message,
        userId: context.userId,
      });
      throw error;
    }
  }

  async validateData(data: any, schema?: DatasetSchema): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Required field validation
    if (!data.patientId && !data.caseId) {
      errors.push('Either patientId or caseId is required');
    }

    // Date validation
    if (data.treatmentStartDate && !this.isValidDate(data.treatmentStartDate)) {
      errors.push('Invalid treatment start date format');
    }

    // Numeric validation
    if (data.complexityScore !== undefined && (data.complexityScore < 0 || data.complexityScore > 100)) {
      errors.push('Complexity score must be between 0 and 100');
    }

    return { valid: errors.length === 0, errors };
  }

  normalizeFieldNames(data: any): any {
    const fieldMappings = {
      'patient_id': 'patientId',
      'case_id': 'caseId',
      'treatment_type': 'treatmentType',
      'treatment_status': 'treatmentStatus',
      'provider_id': 'providerId',
      'provider_name': 'providerName',
      'clinic_id': 'clinicId',
    };

    return this.applyFieldMappings(data, fieldMappings);
  }

  async applyAccessFilters(data: any, context: UserContext | AnonymousContext): Promise<any> {
    // Anonymous users get very limited clinical data
    if (context.isAnonymous) {
      return this.getAnonymizedClinicalData(data);
    }

    const userContext = context as UserContext;

    // Filter based on department scope for non-anonymous users
    if (userContext.departmentScope && userContext.departmentScope.length > 0) {
      return this.filterByDepartment(data, userContext.departmentScope);
    }

    return data;
  }

  async extractMetrics(data: any): Promise<Record<string, number>> {
    const records = Array.isArray(data) ? data : [data];

    return {
      totalCases: records.length,
      activeTreatments: records.filter(r => r.treatmentStatus === 'active').length,
      completedTreatments: records.filter(r => r.treatmentStatus === 'completed').length,
      averageComplexity: this.calculateAverage(records, 'complexityScore'),
      averageProgress: this.calculateAverage(records, 'progressPercentage'),
      averageSatisfaction: this.calculateAverage(records, 'patientSatisfaction'),
      onTimeCompletions: records.filter(r => r.treatmentCompliance === 'high').length,
      overdueAppointments: records.filter(r => this.isOverdue(r.nextAppointmentDate)).length,
    };
  }

  getRecommendedQueries(): string[] {
    return [
      'SELECT * FROM clinical_cases WHERE treatment_status = $1',
      'SELECT * FROM clinical_patients WHERE last_appointment_date < $1',
      'SELECT * FROM clinical_treatments WHERE complexity_score > $1',
      'SELECT COUNT(*) FROM clinical_cases GROUP BY treatment_type',
      'SELECT AVG(patient_satisfaction) FROM clinical_cases WHERE treatment_status = \'completed\'',
    ];
  }

  // Helper methods
  private normalizeTreatmentType(type: string): string {
    const normalizedTypes = {
      'lingual': 'lingual_braces',
      'traditional': 'traditional_braces',
      'clear': 'clear_aligners',
      'brava': 'brava_system',
    };
    return normalizedTypes[type?.toLowerCase() as keyof typeof normalizedTypes] || type || 'unknown';
  }

  private normalizeTreatmentStatus(status: string): string {
    const normalizedStatuses = {
      'in_progress': 'active',
      'ongoing': 'active',
      'finished': 'completed',
      'done': 'completed',
    };
    return normalizedStatuses[status?.toLowerCase() as keyof typeof normalizedStatuses] || status || 'unknown';
  }

  private normalizeDate(dateValue: any): string | null {
    if (!dateValue) return null;
    try {
      return new Date(dateValue).toISOString();
    } catch {
      return null;
    }
  }

  private calculateComplexityScore(record: any): number {
    // Simplified complexity calculation - would be more sophisticated in production
    let score = 50; // Base complexity

    if (record.extraction_required) score += 20;
    if (record.surgical_intervention) score += 30;
    if (record.multiple_phases) score += 15;
    if (record.age && record.age > 40) score += 10;

    return Math.min(score, 100);
  }

  private calculateProgressPercentage(record: any): number {
    if (record.progress_percentage) return record.progress_percentage;

    // Estimate based on appointment progress
    const totalExpectedAppointments = record.expected_appointments || 8;
    const completedAppointments = record.completed_appointments || record.appointment_count || 0;

    return Math.min((completedAppointments / totalExpectedAppointments) * 100, 100);
  }

  private calculateTreatmentDuration(record: any): number | null {
    if (!record.treatment_start_date) return null;

    const startDate = new Date(record.treatment_start_date);
    const endDate = record.treatment_end_date ? new Date(record.treatment_end_date) : new Date();

    return Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  private estimateCompletionDate(record: any): string | null {
    if (!record.treatment_start_date) return null;

    const startDate = new Date(record.treatment_start_date);
    const estimatedDurationDays = record.estimated_duration_months ? record.estimated_duration_months * 30 : 240; // Default 8 months

    const completionDate = new Date(startDate.getTime() + estimatedDurationDays * 24 * 60 * 60 * 1000);
    return completionDate.toISOString();
  }

  private getAnonymizedClinicalData(data: any): any {
    const records = Array.isArray(data) ? data : [data];

    return records.map(record => ({
      treatmentType: record.treatmentType,
      treatmentStatus: record.treatmentStatus,
      complexityScore: record.complexityScore,
      progressPercentage: record.progressPercentage,
      // Remove all PII
      patientId: 'ANONYMOUS',
      providerId: 'ANONYMOUS',
      clinicId: 'ANONYMOUS',
    }));
  }

  private filterByDepartment(data: any, departments: string[]): any {
    // Filter clinical data based on department access
    const records = Array.isArray(data) ? data : [data];

    return records.filter(record => {
      // Allow access if user has clinical department access
      return departments.includes('clinical') || departments.includes('medical');
    });
  }

  private applyFieldMappings(data: any, mappings: Record<string, string>): any {
    const mapped = { ...data };

    Object.entries(mappings).forEach(([oldKey, newKey]) => {
      if (mapped[oldKey] !== undefined) {
        mapped[newKey] = mapped[oldKey];
        delete mapped[oldKey];
      }
    });

    return mapped;
  }

  private calculateAverage(records: any[], field: string): number {
    const values = records.map(r => r[field]).filter(v => v !== undefined && v !== null);
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }

  private isValidDate(dateString: string): boolean {
    return !isNaN(Date.parse(dateString));
  }

  private isOverdue(dateString: string | null): boolean {
    if (!dateString) return false;
    return new Date(dateString) < new Date();
  }
}

/**
 * Financial Domain Data Adapter
 * Handles payments, billing, revenue, costs, financial metrics
 */
class FinancialDomainAdapter implements DomainDataAdapter {
  domainType: DomainType = 'financial';

  async transformData(rawData: any, context: UserContext | AnonymousContext): Promise<any> {
    try {
      rootLogger.info('Transforming financial data', {
        dataType: Array.isArray(rawData) ? 'array' : typeof rawData,
        recordCount: Array.isArray(rawData) ? rawData.length : 1,
        userId: context.userId,
      });

      const records = Array.isArray(rawData) ? rawData : [rawData];

      const transformedRecords = records.map(record => ({
        // Standardize financial identifiers
        transactionId: record.transaction_id || record.transactionId || record.id,
        orderId: record.order_id || record.orderId,
        customerId: record.customer_id || record.customerId || record.patient_id,

        // Normalize transaction information
        transactionType: this.normalizeTransactionType(record.transaction_type || record.type),
        paymentMethod: this.normalizePaymentMethod(record.payment_method || record.method),
        transactionStatus: this.normalizeTransactionStatus(record.status || record.transaction_status),

        // Standardize amounts (convert to cents for precision)
        amount: this.normalizeAmount(record.amount || record.total_amount || record.value),
        originalAmount: this.normalizeAmount(record.original_amount || record.gross_amount),
        netAmount: this.normalizeAmount(record.net_amount || record.amount),
        feeAmount: this.normalizeAmount(record.fee_amount || record.processing_fee || 0),
        taxAmount: this.normalizeAmount(record.tax_amount || record.tax || 0),

        // Currency and localization
        currency: record.currency || record.currency_code || 'USD',
        exchangeRate: record.exchange_rate || 1.0,

        // Standardize dates
        transactionDate: this.normalizeDate(record.transaction_date || record.created_at || record.date),
        processedDate: this.normalizeDate(record.processed_date || record.updated_at),
        dueDate: this.normalizeDate(record.due_date),
        paidDate: this.normalizeDate(record.paid_date || record.payment_date),

        // Payment details
        paymentProcessor: record.payment_processor || record.processor || 'internal',
        processorTransactionId: record.processor_transaction_id || record.external_id,

        // Business metrics
        revenueCategory: this.categorizeRevenue(record),
        profitMargin: this.calculateProfitMargin(record),
        customerLifetimeValue: record.customer_ltv || record.lifetime_value,

        // Risk and compliance
        riskScore: this.calculateRiskScore(record),
        complianceFlags: this.identifyComplianceFlags(record),

        // Preserve original data
        _originalData: record,
        _transformedAt: new Date().toISOString(),
        _transformedBy: context.userId,
      }));

      return Array.isArray(rawData) ? transformedRecords : transformedRecords[0];

    } catch (error) {
      rootLogger.error('Financial data transformation failed', {
        error: (error as Error).message,
        userId: context.userId,
      });
      throw error;
    }
  }

  async validateData(data: any, schema?: DatasetSchema): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Required field validation
    if (!data.transactionId && !data.orderId) {
      errors.push('Either transactionId or orderId is required');
    }

    // Amount validation
    if (data.amount !== undefined && (typeof data.amount !== 'number' || data.amount < 0)) {
      errors.push('Amount must be a non-negative number');
    }

    // Currency validation
    if (data.currency && !/^[A-Z]{3}$/.test(data.currency)) {
      errors.push('Currency must be a valid 3-letter ISO code');
    }

    // Date validation
    if (data.transactionDate && !this.isValidDate(data.transactionDate)) {
      errors.push('Invalid transaction date format');
    }

    return { valid: errors.length === 0, errors };
  }

  normalizeFieldNames(data: any): any {
    const fieldMappings = {
      'transaction_id': 'transactionId',
      'order_id': 'orderId',
      'customer_id': 'customerId',
      'payment_method': 'paymentMethod',
      'total_amount': 'amount',
      'currency_code': 'currency',
    };

    return this.applyFieldMappings(data, fieldMappings);
  }

  async applyAccessFilters(data: any, context: UserContext | AnonymousContext): Promise<any> {
    // Anonymous users get aggregated financial data only
    if (context.isAnonymous) {
      return this.getAggregatedFinancialData(data);
    }

    const userContext = context as UserContext;

    // Filter based on department scope and role permissions
    if (userContext.departmentScope && userContext.departmentScope.length > 0) {
      return this.filterByFinancialAccess(data, userContext);
    }

    return data;
  }

  async extractMetrics(data: any): Promise<Record<string, number>> {
    const records = Array.isArray(data) ? data : [data];

    const totalRevenue = records.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalTransactions = records.length;
    const successfulTransactions = records.filter(r => r.transactionStatus === 'completed').length;

    return {
      totalRevenue: totalRevenue / 100, // Convert from cents to dollars
      totalTransactions,
      successfulTransactions,
      failedTransactions: totalTransactions - successfulTransactions,
      averageTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions / 100 : 0,
      totalFees: records.reduce((sum, r) => sum + (r.feeAmount || 0), 0) / 100,
      totalTax: records.reduce((sum, r) => sum + (r.taxAmount || 0), 0) / 100,
      conversionRate: totalTransactions > 0 ? (successfulTransactions / totalTransactions) * 100 : 0,
      averageRiskScore: this.calculateAverage(records, 'riskScore'),
    };
  }

  getRecommendedQueries(): string[] {
    return [
      'SELECT SUM(amount) FROM financial_transactions WHERE transaction_date >= $1',
      'SELECT * FROM financial_transactions WHERE transaction_status = $1',
      'SELECT COUNT(*) FROM financial_transactions GROUP BY payment_method',
      'SELECT AVG(amount) FROM financial_transactions WHERE currency = $1',
      'SELECT * FROM financial_transactions WHERE risk_score > $1',
    ];
  }

  // Helper methods
  private normalizeTransactionType(type: string): string {
    const normalizedTypes = {
      'payment': 'payment',
      'refund': 'refund',
      'adjustment': 'adjustment',
      'fee': 'fee',
      'subscription': 'subscription',
    };
    return normalizedTypes[type?.toLowerCase() as keyof typeof normalizedTypes] || type || 'unknown';
  }

  private normalizePaymentMethod(method: string): string {
    const normalizedMethods = {
      'cc': 'credit_card',
      'credit_card': 'credit_card',
      'debit': 'debit_card',
      'ach': 'bank_transfer',
      'wire': 'wire_transfer',
      'check': 'check',
      'cash': 'cash',
    };
    return normalizedMethods[method?.toLowerCase() as keyof typeof normalizedMethods] || method || 'unknown';
  }

  private normalizeTransactionStatus(status: string): string {
    const normalizedStatuses = {
      'success': 'completed',
      'successful': 'completed',
      'failed': 'failed',
      'declined': 'failed',
      'pending': 'pending',
      'processing': 'processing',
    };
    return normalizedStatuses[status?.toLowerCase() as keyof typeof normalizedStatuses] || status || 'unknown';
  }

  private normalizeAmount(amount: any): number {
    if (typeof amount === 'number') {
      // Assume amounts are in dollars, convert to cents for precision
      return Math.round(amount * 100);
    }
    if (typeof amount === 'string') {
      const parsed = parseFloat(amount.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? 0 : Math.round(parsed * 100);
    }
    return 0;
  }

  private normalizeDate(dateValue: any): string | null {
    if (!dateValue) return null;
    try {
      return new Date(dateValue).toISOString();
    } catch {
      return null;
    }
  }

  private categorizeRevenue(record: any): string {
    // Categorize revenue based on transaction characteristics
    if (record.subscription_id) return 'subscription';
    if (record.one_time_payment) return 'one_time';
    if (record.installment_number) return 'installment';
    return 'other';
  }

  private calculateProfitMargin(record: any): number {
    const revenue = record.amount || 0;
    const costs = record.cost_of_goods || record.cogs || 0;

    if (revenue === 0) return 0;
    return ((revenue - costs) / revenue) * 100;
  }

  private calculateRiskScore(record: any): number {
    let riskScore = 0;

    // High amount transactions are riskier
    if (record.amount > 100000) riskScore += 20; // $1000+ in cents

    // International transactions are riskier
    if (record.currency !== 'USD') riskScore += 10;

    // Multiple failed attempts increase risk
    if (record.retry_count > 2) riskScore += 15;

    // New customers are riskier
    if (record.customer_age_days < 30) riskScore += 10;

    return Math.min(riskScore, 100);
  }

  private identifyComplianceFlags(record: any): string[] {
    const flags: string[] = [];

    if (record.amount > 1000000) flags.push('large_transaction'); // $10,000+ in cents
    if (record.currency !== 'USD') flags.push('foreign_currency');
    if (record.customer_location && record.customer_location !== 'US') flags.push('international');

    return flags;
  }

  private getAggregatedFinancialData(data: any): any {
    const records = Array.isArray(data) ? data : [data];

    // Return only aggregated metrics for anonymous users
    return {
      totalTransactions: records.length,
      totalRevenue: records.reduce((sum, r) => sum + (r.amount || 0), 0) / 100,
      averageTransactionValue: records.length > 0 ?
        records.reduce((sum, r) => sum + (r.amount || 0), 0) / records.length / 100 : 0,
      paymentMethodDistribution: this.getPaymentMethodDistribution(records),
      // Remove all PII and specific transaction details
    };
  }

  private filterByFinancialAccess(data: any, context: UserContext): any {
    const records = Array.isArray(data) ? data : [data];

    // Filter based on financial permissions and department scope
    return records.filter(record => {
      // Allow access if user has financial department access
      if (context.departmentScope.includes('finance') || context.departmentScope.includes('accounting')) {
        return true;
      }

      // Limited access for other departments - only their own transactions
      return record.customerId === context.userId;
    });
  }

  private getPaymentMethodDistribution(records: any[]): Record<string, number> {
    const distribution: Record<string, number> = {};

    records.forEach(record => {
      const method = record.paymentMethod || 'unknown';
      distribution[method] = (distribution[method] || 0) + 1;
    });

    return distribution;
  }

  private applyFieldMappings(data: any, mappings: Record<string, string>): any {
    const mapped = { ...data };

    Object.entries(mappings).forEach(([oldKey, newKey]) => {
      if (mapped[oldKey] !== undefined) {
        mapped[newKey] = mapped[oldKey];
        delete mapped[oldKey];
      }
    });

    return mapped;
  }

  private calculateAverage(records: any[], field: string): number {
    const values = records.map(r => r[field]).filter(v => v !== undefined && v !== null);
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }

  private isValidDate(dateString: string): boolean {
    return !isNaN(Date.parse(dateString));
  }
}

/**
 * Operational Domain Data Adapter
 * Handles processes, capacity, efficiency metrics, resource management
 */
class OperationalDomainAdapter implements DomainDataAdapter {
  domainType: DomainType = 'operational';

  async transformData(rawData: any, context: UserContext | AnonymousContext): Promise<any> {
    try {
      rootLogger.info('Transforming operational data', {
        dataType: Array.isArray(rawData) ? 'array' : typeof rawData,
        recordCount: Array.isArray(rawData) ? rawData.length : 1,
        userId: context.userId,
      });

      const records = Array.isArray(rawData) ? rawData : [rawData];

      const transformedRecords = records.map(record => ({
        // Standardize operational identifiers
        operationId: record.operation_id || record.operationId || record.id,
        processId: record.process_id || record.processId,
        taskId: record.task_id || record.taskId,
        resourceId: record.resource_id || record.resourceId,

        // Process information
        processName: record.process_name || record.processName || record.name,
        processType: this.normalizeProcessType(record.process_type || record.type),
        processStatus: this.normalizeProcessStatus(record.status || record.process_status),
        priority: this.normalizePriority(record.priority || record.urgency),

        // Timing information
        startTime: this.normalizeDate(record.start_time || record.started_at || record.created_at),
        endTime: this.normalizeDate(record.end_time || record.completed_at || record.finished_at),
        estimatedDuration: record.estimated_duration || record.expected_duration,
        actualDuration: this.calculateActualDuration(record),

        // Resource allocation
        assignedTo: record.assigned_to || record.assignee || record.technician_id,
        assignedTeam: record.assigned_team || record.team || record.department,
        resourceUtilization: this.calculateResourceUtilization(record),

        // Performance metrics
        efficiency: this.calculateEfficiency(record),
        qualityScore: record.quality_score || record.quality || this.calculateQualityScore(record),
        throughput: record.throughput || record.items_processed || 1,
        errorRate: this.calculateErrorRate(record),

        // Cost and capacity
        estimatedCost: record.estimated_cost || record.budget,
        actualCost: record.actual_cost || record.cost,
        capacityUtilized: record.capacity_utilized || record.capacity_used,
        bottleneckIndicator: this.identifyBottleneck(record),

        // Workflow context
        workflowStage: record.workflow_stage || record.stage || record.phase,
        previousTask: record.previous_task || record.predecessor,
        nextTask: record.next_task || record.successor,
        blockedBy: record.blocked_by || record.blocking_issue,

        // Preserve original data
        _originalData: record,
        _transformedAt: new Date().toISOString(),
        _transformedBy: context.userId,
      }));

      return Array.isArray(rawData) ? transformedRecords : transformedRecords[0];

    } catch (error) {
      rootLogger.error('Operational data transformation failed', {
        error: (error as Error).message,
        userId: context.userId,
      });
      throw error;
    }
  }

  async validateData(data: any, schema?: DatasetSchema): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Required field validation
    if (!data.operationId && !data.processId && !data.taskId) {
      errors.push('At least one identifier (operationId, processId, or taskId) is required');
    }

    // Duration validation
    if (data.actualDuration !== undefined && data.actualDuration < 0) {
      errors.push('Actual duration cannot be negative');
    }

    // Efficiency validation
    if (data.efficiency !== undefined && (data.efficiency < 0 || data.efficiency > 200)) {
      errors.push('Efficiency must be between 0 and 200 percent');
    }

    // Date validation
    if (data.startTime && !this.isValidDate(data.startTime)) {
      errors.push('Invalid start time format');
    }

    return { valid: errors.length === 0, errors };
  }

  normalizeFieldNames(data: any): any {
    const fieldMappings = {
      'operation_id': 'operationId',
      'process_id': 'processId',
      'task_id': 'taskId',
      'resource_id': 'resourceId',
      'process_name': 'processName',
      'start_time': 'startTime',
      'end_time': 'endTime',
    };

    return this.applyFieldMappings(data, fieldMappings);
  }

  async applyAccessFilters(data: any, context: UserContext | AnonymousContext): Promise<any> {
    // Anonymous users get high-level operational metrics only
    if (context.isAnonymous) {
      return this.getOperationalSummary(data);
    }

    const userContext = context as UserContext;

    // Filter based on department scope and operational permissions
    if (userContext.departmentScope && userContext.departmentScope.length > 0) {
      return this.filterByOperationalAccess(data, userContext);
    }

    return data;
  }

  async extractMetrics(data: any): Promise<Record<string, number>> {
    const records = Array.isArray(data) ? data : [data];

    const completedProcesses = records.filter(r => r.processStatus === 'completed');
    const inProgressProcesses = records.filter(r => r.processStatus === 'in_progress');

    return {
      totalProcesses: records.length,
      completedProcesses: completedProcesses.length,
      inProgressProcesses: inProgressProcesses.length,
      blockedProcesses: records.filter(r => r.blockedBy).length,
      averageEfficiency: this.calculateAverage(records, 'efficiency'),
      averageQuality: this.calculateAverage(records, 'qualityScore'),
      averageDuration: this.calculateAverage(completedProcesses, 'actualDuration'),
      totalThroughput: records.reduce((sum, r) => sum + (r.throughput || 0), 0),
      averageErrorRate: this.calculateAverage(records, 'errorRate'),
      resourceUtilization: this.calculateAverage(records, 'resourceUtilization'),
      onTimeCompletion: this.calculateOnTimeRate(records),
    };
  }

  getRecommendedQueries(): string[] {
    return [
      'SELECT * FROM operational_processes WHERE process_status = $1',
      'SELECT AVG(efficiency) FROM operational_tasks WHERE start_time >= $1',
      'SELECT COUNT(*) FROM operational_processes GROUP BY assigned_team',
      'SELECT * FROM operational_tasks WHERE actual_duration > estimated_duration',
      'SELECT resource_id, AVG(resource_utilization) FROM operational_resources GROUP BY resource_id',
    ];
  }

  // Helper methods
  private normalizeProcessType(type: string): string {
    const normalizedTypes = {
      'manufacturing': 'manufacturing',
      'quality_control': 'quality_control',
      'assembly': 'assembly',
      'packaging': 'packaging',
      'shipping': 'shipping',
      'maintenance': 'maintenance',
    };
    return normalizedTypes[type?.toLowerCase() as keyof typeof normalizedTypes] || type || 'unknown';
  }

  private normalizeProcessStatus(status: string): string {
    const normalizedStatuses = {
      'pending': 'pending',
      'started': 'in_progress',
      'running': 'in_progress',
      'active': 'in_progress',
      'finished': 'completed',
      'done': 'completed',
      'failed': 'failed',
      'error': 'failed',
      'blocked': 'blocked',
      'paused': 'paused',
    };
    return normalizedStatuses[status?.toLowerCase() as keyof typeof normalizedStatuses] || status || 'unknown';
  }

  private normalizePriority(priority: string | number): string {
    if (typeof priority === 'number') {
      if (priority >= 8) return 'critical';
      if (priority >= 6) return 'high';
      if (priority >= 4) return 'medium';
      return 'low';
    }

    const normalizedPriorities = {
      'urgent': 'critical',
      'high': 'high',
      'normal': 'medium',
      'low': 'low',
    };
    return normalizedPriorities[priority?.toLowerCase() as keyof typeof normalizedPriorities] || priority || 'medium';
  }

  private normalizeDate(dateValue: any): string | null {
    if (!dateValue) return null;
    try {
      return new Date(dateValue).toISOString();
    } catch {
      return null;
    }
  }

  private calculateActualDuration(record: any): number | null {
    if (record.actual_duration) return record.actual_duration;

    if (record.start_time && record.end_time) {
      const start = new Date(record.start_time);
      const end = new Date(record.end_time);
      return Math.floor((end.getTime() - start.getTime()) / (1000 * 60)); // Duration in minutes
    }

    return null;
  }

  private calculateResourceUtilization(record: any): number {
    if (record.resource_utilization) return record.resource_utilization;

    // Estimate based on capacity and throughput
    const capacity = record.capacity || record.max_capacity || 100;
    const utilized = record.capacity_utilized || record.throughput || 0;

    return capacity > 0 ? (utilized / capacity) * 100 : 0;
  }

  private calculateEfficiency(record: any): number {
    if (record.efficiency) return record.efficiency;

    // Calculate efficiency as actual vs estimated duration
    const estimated = record.estimated_duration || record.expected_duration;
    const actual = record.actual_duration || this.calculateActualDuration(record);

    if (!estimated || !actual || estimated === 0) return 100;

    // Efficiency = (estimated / actual) * 100
    return Math.min((estimated / actual) * 100, 200); // Cap at 200%
  }

  private calculateQualityScore(record: any): number {
    if (record.quality_score) return record.quality_score;

    // Estimate quality based on error rate and rework requirements
    const errorRate = this.calculateErrorRate(record);
    const reworkRequired = record.rework_required || false;

    let qualityScore = 100 - (errorRate * 10);
    if (reworkRequired) qualityScore -= 20;

    return Math.max(qualityScore, 0);
  }

  private calculateErrorRate(record: any): number {
    if (record.error_rate) return record.error_rate;

    const errors = record.error_count || record.defects || 0;
    const total = record.throughput || record.items_processed || 1;

    return total > 0 ? (errors / total) * 100 : 0;
  }

  private identifyBottleneck(record: any): boolean {
    // Identify potential bottlenecks based on utilization and duration
    const utilization = record.resource_utilization || this.calculateResourceUtilization(record);
    const efficiency = this.calculateEfficiency(record);

    return utilization > 90 && efficiency < 70;
  }

  private getOperationalSummary(data: any): any {
    const records = Array.isArray(data) ? data : [data];

    // Return only high-level operational metrics for anonymous users
    return {
      totalProcesses: records.length,
      averageEfficiency: this.calculateAverage(records, 'efficiency'),
      averageQuality: this.calculateAverage(records, 'qualityScore'),
      processTypeDistribution: this.getProcessTypeDistribution(records),
      // Remove specific operational details and identifiers
    };
  }

  private filterByOperationalAccess(data: any, context: UserContext): any {
    const records = Array.isArray(data) ? data : [data];

    // Filter based on operational permissions and department scope
    return records.filter(record => {
      // Allow access if user has operations department access
      if (context.departmentScope.includes('operations') ||
          context.departmentScope.includes('manufacturing') ||
          context.departmentScope.includes('production')) {
        return true;
      }

      // Limited access for other departments - only processes assigned to them
      return record.assignedTo === context.userId ||
             context.departmentScope.includes(record.assignedTeam);
    });
  }

  private getProcessTypeDistribution(records: any[]): Record<string, number> {
    const distribution: Record<string, number> = {};

    records.forEach(record => {
      const type = record.processType || 'unknown';
      distribution[type] = (distribution[type] || 0) + 1;
    });

    return distribution;
  }

  private calculateOnTimeRate(records: any[]): number {
    const completedRecords = records.filter(r => r.processStatus === 'completed');
    if (completedRecords.length === 0) return 0;

    const onTimeCount = completedRecords.filter(record => {
      const estimated = record.estimatedDuration;
      const actual = record.actualDuration;
      return estimated && actual && actual <= estimated;
    }).length;

    return (onTimeCount / completedRecords.length) * 100;
  }

  private applyFieldMappings(data: any, mappings: Record<string, string>): any {
    const mapped = { ...data };

    Object.entries(mappings).forEach(([oldKey, newKey]) => {
      if (mapped[oldKey] !== undefined) {
        mapped[newKey] = mapped[oldKey];
        delete mapped[oldKey];
      }
    });

    return mapped;
  }

  private calculateAverage(records: any[], field: string): number {
    const values = records.map(r => r[field]).filter(v => v !== undefined && v !== null);
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }

  private isValidDate(dateString: string): boolean {
    return !isNaN(Date.parse(dateString));
  }
}

/**
 * Customer Service Domain Data Adapter
 * Handles support tickets, feedback, satisfaction metrics, communication
 */
class CustomerServiceDomainAdapter implements DomainDataAdapter {
  domainType: DomainType = 'customer-service';

  async transformData(rawData: any, context: UserContext | AnonymousContext): Promise<any> {
    try {
      rootLogger.info('Transforming customer service data', {
        dataType: Array.isArray(rawData) ? 'array' : typeof rawData,
        recordCount: Array.isArray(rawData) ? rawData.length : 1,
        userId: context.userId,
      });

      const records = Array.isArray(rawData) ? rawData : [rawData];

      const transformedRecords = records.map(record => ({
        // Standardize service identifiers
        ticketId: record.ticket_id || record.ticketId || record.id,
        customerId: record.customer_id || record.customerId || record.patient_id,
        caseId: record.case_id || record.caseId,

        // Contact and communication
        contactMethod: this.normalizeContactMethod(record.contact_method || record.channel),
        subject: record.subject || record.title || record.issue_summary,
        description: record.description || record.message || record.details,
        category: this.normalizeCategory(record.category || record.issue_type),
        priority: this.normalizePriority(record.priority || record.urgency),

        // Status and resolution
        status: this.normalizeTicketStatus(record.status || record.ticket_status),
        resolutionStatus: this.normalizeResolutionStatus(record.resolution_status || record.resolution),
        resolution: record.resolution || record.solution,
        resolutionTime: this.calculateResolutionTime(record),

        // Assignment and handling
        assignedTo: record.assigned_to || record.agent_id || record.handler,
        assignedTeam: record.assigned_team || record.team || record.department,
        escalationLevel: record.escalation_level || 0,

        // Timing information
        createdAt: this.normalizeDate(record.created_at || record.submitted_at),
        firstResponseAt: this.normalizeDate(record.first_response_at || record.acknowledged_at),
        resolvedAt: this.normalizeDate(record.resolved_at || record.closed_at),
        lastUpdatedAt: this.normalizeDate(record.updated_at || record.last_modified),

        // Service metrics
        customerSatisfaction: this.normalizeSatisfactionScore(record.customer_satisfaction || record.csat || record.rating),
        sentimentScore: this.analyzeSentiment(record),
        responseTime: this.calculateResponseTime(record),

        // Communication tracking
        messageCount: record.message_count || record.interactions || 1,
        agentResponseCount: record.agent_responses || 0,
        customerResponseCount: record.customer_responses || 0,

        // Business impact
        impactLevel: this.normalizeImpactLevel(record.impact || record.severity),
        businessValue: record.business_value || record.customer_value,
        churnRisk: this.calculateChurnRisk(record),

        // Quality metrics
        firstCallResolution: record.first_call_resolution || record.fcr || false,
        reopenCount: record.reopen_count || 0,
        escalationCount: record.escalation_count || 0,

        // Preserve original data
        _originalData: record,
        _transformedAt: new Date().toISOString(),
        _transformedBy: context.userId,
      }));

      return Array.isArray(rawData) ? transformedRecords : transformedRecords[0];

    } catch (error) {
      rootLogger.error('Customer service data transformation failed', {
        error: (error as Error).message,
        userId: context.userId,
      });
      throw error;
    }
  }

  async validateData(data: any, schema?: DatasetSchema): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Required field validation
    if (!data.ticketId) {
      errors.push('Ticket ID is required');
    }

    // Satisfaction score validation
    if (data.customerSatisfaction !== undefined &&
        (data.customerSatisfaction < 1 || data.customerSatisfaction > 10)) {
      errors.push('Customer satisfaction must be between 1 and 10');
    }

    // Priority validation
    if (data.priority && !['low', 'medium', 'high', 'critical'].includes(data.priority)) {
      errors.push('Priority must be one of: low, medium, high, critical');
    }

    // Date validation
    if (data.createdAt && !this.isValidDate(data.createdAt)) {
      errors.push('Invalid creation date format');
    }

    return { valid: errors.length === 0, errors };
  }

  normalizeFieldNames(data: any): any {
    const fieldMappings = {
      'ticket_id': 'ticketId',
      'customer_id': 'customerId',
      'contact_method': 'contactMethod',
      'assigned_to': 'assignedTo',
      'created_at': 'createdAt',
      'resolved_at': 'resolvedAt',
      'customer_satisfaction': 'customerSatisfaction',
    };

    return this.applyFieldMappings(data, fieldMappings);
  }

  async applyAccessFilters(data: any, context: UserContext | AnonymousContext): Promise<any> {
    // Anonymous users get aggregated service metrics only
    if (context.isAnonymous) {
      return this.getServiceSummary(data);
    }

    const userContext = context as UserContext;

    // Filter based on department scope and service permissions
    if (userContext.departmentScope && userContext.departmentScope.length > 0) {
      return this.filterByServiceAccess(data, userContext);
    }

    return data;
  }

  async extractMetrics(data: any): Promise<Record<string, number>> {
    const records = Array.isArray(data) ? data : [data];

    const resolvedTickets = records.filter(r => r.status === 'resolved');
    const openTickets = records.filter(r => ['open', 'in_progress'].includes(r.status));

    return {
      totalTickets: records.length,
      openTickets: openTickets.length,
      resolvedTickets: resolvedTickets.length,
      averageSatisfaction: this.calculateAverage(records, 'customerSatisfaction'),
      averageResolutionTime: this.calculateAverage(resolvedTickets, 'resolutionTime'),
      averageResponseTime: this.calculateAverage(records, 'responseTime'),
      firstCallResolutionRate: records.filter(r => r.firstCallResolution).length / records.length * 100,
      escalationRate: records.filter(r => r.escalationCount > 0).length / records.length * 100,
      reopenRate: records.filter(r => r.reopenCount > 0).length / records.length * 100,
      highPriorityTickets: records.filter(r => ['high', 'critical'].includes(r.priority)).length,
      averageChurnRisk: this.calculateAverage(records, 'churnRisk'),
      averageSentiment: this.calculateAverage(records, 'sentimentScore'),
    };
  }

  getRecommendedQueries(): string[] {
    return [
      'SELECT * FROM customer_service_tickets WHERE status = $1',
      'SELECT AVG(customer_satisfaction) FROM customer_service_tickets WHERE resolved_at >= $1',
      'SELECT COUNT(*) FROM customer_service_tickets GROUP BY category',
      'SELECT * FROM customer_service_tickets WHERE priority = \'high\' AND status = \'open\'',
      'SELECT assigned_to, AVG(resolution_time) FROM customer_service_tickets GROUP BY assigned_to',
    ];
  }

  // Helper methods
  private normalizeContactMethod(method: string): string {
    const normalizedMethods = {
      'phone': 'phone',
      'email': 'email',
      'chat': 'live_chat',
      'web': 'web_form',
      'social': 'social_media',
      'sms': 'sms',
      'in_person': 'in_person',
    };
    return normalizedMethods[method?.toLowerCase() as keyof typeof normalizedMethods] || method || 'unknown';
  }

  private normalizeCategory(category: string): string {
    const normalizedCategories = {
      'technical': 'technical',
      'billing': 'billing',
      'account': 'account',
      'general': 'general_inquiry',
      'complaint': 'complaint',
      'feature': 'feature_request',
      'bug': 'bug_report',
    };
    return normalizedCategories[category?.toLowerCase() as keyof typeof normalizedCategories] || category || 'general_inquiry';
  }

  private normalizePriority(priority: string | number): string {
    if (typeof priority === 'number') {
      if (priority >= 8) return 'critical';
      if (priority >= 6) return 'high';
      if (priority >= 4) return 'medium';
      return 'low';
    }

    const normalizedPriorities = {
      'urgent': 'critical',
      'high': 'high',
      'normal': 'medium',
      'low': 'low',
    };
    return normalizedPriorities[priority?.toLowerCase() as keyof typeof normalizedPriorities] || priority || 'medium';
  }

  private normalizeTicketStatus(status: string): string {
    const normalizedStatuses = {
      'new': 'open',
      'pending': 'open',
      'in_progress': 'in_progress',
      'working': 'in_progress',
      'resolved': 'resolved',
      'closed': 'resolved',
      'cancelled': 'cancelled',
    };
    return normalizedStatuses[status?.toLowerCase() as keyof typeof normalizedStatuses] || status || 'open';
  }

  private normalizeResolutionStatus(status: string): string {
    const normalizedStatuses = {
      'solved': 'resolved',
      'fixed': 'resolved',
      'completed': 'resolved',
      'duplicate': 'duplicate',
      'wont_fix': 'declined',
      'invalid': 'invalid',
    };
    return normalizedStatuses[status?.toLowerCase() as keyof typeof normalizedStatuses] || status || 'pending';
  }

  private normalizeSatisfactionScore(score: any): number | null {
    if (score === null || score === undefined) return null;

    const numScore = typeof score === 'number' ? score : parseFloat(score);
    if (isNaN(numScore)) return null;

    // Normalize to 1-10 scale
    if (numScore <= 1 && numScore > 0) return numScore * 10; // 0-1 scale
    if (numScore <= 5) return numScore * 2; // 1-5 scale
    return Math.min(numScore, 10); // Cap at 10
  }

  private normalizeImpactLevel(impact: string | number): string {
    if (typeof impact === 'number') {
      if (impact >= 8) return 'critical';
      if (impact >= 6) return 'high';
      if (impact >= 4) return 'medium';
      return 'low';
    }

    const normalizedImpacts = {
      'critical': 'critical',
      'high': 'high',
      'medium': 'medium',
      'low': 'low',
      'minimal': 'low',
    };
    return normalizedImpacts[impact?.toLowerCase() as keyof typeof normalizedImpacts] || impact || 'medium';
  }

  private normalizeDate(dateValue: any): string | null {
    if (!dateValue) return null;
    try {
      return new Date(dateValue).toISOString();
    } catch {
      return null;
    }
  }

  private calculateResolutionTime(record: any): number | null {
    if (record.resolution_time) return record.resolution_time;

    if (record.created_at && record.resolved_at) {
      const created = new Date(record.created_at);
      const resolved = new Date(record.resolved_at);
      return Math.floor((resolved.getTime() - created.getTime()) / (1000 * 60 * 60)); // Hours
    }

    return null;
  }

  private calculateResponseTime(record: any): number | null {
    if (record.response_time) return record.response_time;

    if (record.created_at && record.first_response_at) {
      const created = new Date(record.created_at);
      const responded = new Date(record.first_response_at);
      return Math.floor((responded.getTime() - created.getTime()) / (1000 * 60)); // Minutes
    }

    return null;
  }

  private analyzeSentiment(record: any): number {
    if (record.sentiment_score) return record.sentiment_score;

    // Simplified sentiment analysis based on keywords
    const text = (record.description || record.message || '').toLowerCase();
    let sentiment = 0.5; // Neutral baseline

    // Positive indicators
    if (text.includes('thank') || text.includes('great') || text.includes('excellent')) {
      sentiment += 0.3;
    }

    // Negative indicators
    if (text.includes('angry') || text.includes('frustrated') || text.includes('terrible')) {
      sentiment -= 0.3;
    }

    // Urgency indicators
    if (text.includes('urgent') || text.includes('asap') || text.includes('emergency')) {
      sentiment -= 0.2;
    }

    return Math.max(0, Math.min(1, sentiment));
  }

  private calculateChurnRisk(record: any): number {
    if (record.churn_risk) return record.churn_risk;

    let riskScore = 0;

    // High priority issues increase churn risk
    if (record.priority === 'critical') riskScore += 30;
    else if (record.priority === 'high') riskScore += 20;

    // Multiple escalations increase risk
    if (record.escalation_count > 1) riskScore += 25;

    // Poor satisfaction increases risk
    if (record.customer_satisfaction && record.customer_satisfaction < 5) {
      riskScore += 20;
    }

    // Multiple reopens increase risk
    if (record.reopen_count > 0) riskScore += 15;

    // Negative sentiment increases risk
    if (record.sentiment_score && record.sentiment_score < 0.3) {
      riskScore += 20;
    }

    return Math.min(riskScore, 100);
  }

  private getServiceSummary(data: any): any {
    const records = Array.isArray(data) ? data : [data];

    // Return only high-level service metrics for anonymous users
    return {
      totalTickets: records.length,
      averageSatisfaction: this.calculateAverage(records, 'customerSatisfaction'),
      averageResolutionTime: this.calculateAverage(records, 'resolutionTime'),
      categoryDistribution: this.getCategoryDistribution(records),
      // Remove specific ticket details and customer information
    };
  }

  private filterByServiceAccess(data: any, context: UserContext): any {
    const records = Array.isArray(data) ? data : [data];

    // Filter based on service permissions and department scope
    return records.filter(record => {
      // Allow access if user has customer service department access
      if (context.departmentScope.includes('customer-service') ||
          context.departmentScope.includes('support') ||
          context.departmentScope.includes('service')) {
        return true;
      }

      // Limited access for other departments - only tickets assigned to them
      return record.assignedTo === context.userId;
    });
  }

  private getCategoryDistribution(records: any[]): Record<string, number> {
    const distribution: Record<string, number> = {};

    records.forEach(record => {
      const category = record.category || 'unknown';
      distribution[category] = (distribution[category] || 0) + 1;
    });

    return distribution;
  }

  private applyFieldMappings(data: any, mappings: Record<string, string>): any {
    const mapped = { ...data };

    Object.entries(mappings).forEach(([oldKey, newKey]) => {
      if (mapped[oldKey] !== undefined) {
        mapped[newKey] = mapped[oldKey];
        delete mapped[oldKey];
      }
    });

    return mapped;
  }

  private calculateAverage(records: any[], field: string): number {
    const values = records.map(r => r[field]).filter(v => v !== undefined && v !== null);
    return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
  }

  private isValidDate(dateString: string): boolean {
    return !isNaN(Date.parse(dateString));
  }
}

// ============================================================================
// Domain Adapter Factory and Manager
// ============================================================================

/**
 * Factory for creating domain-specific adapters
 */
class DomainAdapterFactory {
  private static adapters: Map<DomainType, DomainDataAdapter> = new Map();

  static getAdapter(domainType: DomainType): DomainDataAdapter {
    if (!this.adapters.has(domainType)) {
      switch (domainType) {
        case 'clinical':
          this.adapters.set(domainType, new ClinicalDomainAdapter());
          break;
        case 'financial':
          this.adapters.set(domainType, new FinancialDomainAdapter());
          break;
        case 'operational':
          this.adapters.set(domainType, new OperationalDomainAdapter());
          break;
        case 'customer-service':
          this.adapters.set(domainType, new CustomerServiceDomainAdapter());
          break;
        default:
          throw new Error(`Unsupported domain type: ${domainType}`);
      }
    }

    return this.adapters.get(domainType)!;
  }

  static getAllAdapters(): DomainDataAdapter[] {
    return [
      this.getAdapter('clinical'),
      this.getAdapter('financial'),
      this.getAdapter('operational'),
      this.getAdapter('customer-service'),
    ];
  }

  static getSupportedDomains(): DomainType[] {
    return ['clinical', 'financial', 'operational', 'customer-service'];
  }
}

/**
 * Domain Adapter Manager for coordinated multi-domain operations
 */
export class DomainAdapterManager {
  private static instance: DomainAdapterManager;

  static getInstance(): DomainAdapterManager {
    if (!this.instance) {
      this.instance = new DomainAdapterManager();
    }
    return this.instance;
  }

  /**
   * Transform data for multiple domains
   */
  async transformMultiDomainData(
    domainDataMap: Map<DomainType, any>,
    context: UserContext | AnonymousContext
  ): Promise<Map<DomainType, any>> {
    const transformedData = new Map<DomainType, any>();

    for (const [domainType, data] of domainDataMap) {
      try {
        const adapter = DomainAdapterFactory.getAdapter(domainType);
        const transformedDomainData = await adapter.transformData(data, context);
        transformedData.set(domainType, transformedDomainData);

        // Trace the transformation
        await biContextTracer.traceDomainAccess(
          context.userId,
          domainType,
          'transform',
          true,
          undefined
        );

      } catch (error) {
        rootLogger.error('Domain data transformation failed', {
          domainType,
          error: (error as Error).message,
          userId: context.userId,
        });

        // Trace the failure
        await biContextTracer.traceDomainAccess(
          context.userId,
          domainType,
          'transform',
          false,
          (error as Error).message
        );

        // Continue with other domains
      }
    }

    return transformedData;
  }

  /**
   * Apply access filters across multiple domains
   */
  async applyMultiDomainFilters(
    domainDataMap: Map<DomainType, any>,
    context: UserContext | AnonymousContext
  ): Promise<Map<DomainType, any>> {
    const filteredData = new Map<DomainType, any>();

    for (const [domainType, data] of domainDataMap) {
      try {
        const adapter = DomainAdapterFactory.getAdapter(domainType);
        const filteredDomainData = await adapter.applyAccessFilters(data, context);
        filteredData.set(domainType, filteredDomainData);

      } catch (error) {
        rootLogger.error('Domain access filtering failed', {
          domainType,
          error: (error as Error).message,
          userId: context.userId,
        });

        // Continue with other domains
      }
    }

    return filteredData;
  }

  /**
   * Extract metrics from multiple domains
   */
  async extractMultiDomainMetrics(
    domainDataMap: Map<DomainType, any>,
    context: UserContext | AnonymousContext
  ): Promise<Map<DomainType, Record<string, number>>> {
    const metricsMap = new Map<DomainType, Record<string, number>>();

    for (const [domainType, data] of domainDataMap) {
      try {
        const adapter = DomainAdapterFactory.getAdapter(domainType);
        const metrics = await adapter.extractMetrics(data);
        metricsMap.set(domainType, metrics);

      } catch (error) {
        rootLogger.error('Domain metrics extraction failed', {
          domainType,
          error: (error as Error).message,
          userId: context.userId,
        });

        // Continue with other domains
      }
    }

    return metricsMap;
  }

  /**
   * Get recommended queries for multiple domains
   */
  getMultiDomainRecommendedQueries(domainTypes: DomainType[]): Map<DomainType, string[]> {
    const queriesMap = new Map<DomainType, string[]>();

    for (const domainType of domainTypes) {
      try {
        const adapter = DomainAdapterFactory.getAdapter(domainType);
        queriesMap.set(domainType, adapter.getRecommendedQueries());
      } catch (error) {
        rootLogger.warn('Failed to get recommended queries for domain', {
          domainType,
          error: (error as Error).message,
        });
      }
    }

    return queriesMap;
  }

  /**
   * Validate data across multiple domains
   */
  async validateMultiDomainData(
    domainDataMap: Map<DomainType, any>
  ): Promise<Map<DomainType, { valid: boolean; errors: string[] }>> {
    const validationResults = new Map<DomainType, { valid: boolean; errors: string[] }>();

    for (const [domainType, data] of domainDataMap) {
      try {
        const adapter = DomainAdapterFactory.getAdapter(domainType);
        const validation = await adapter.validateData(data);
        validationResults.set(domainType, validation);

      } catch (error) {
        rootLogger.error('Domain data validation failed', {
          domainType,
          error: (error as Error).message,
        });

        validationResults.set(domainType, {
          valid: false,
          errors: [`Validation failed: ${(error as Error).message}`],
        });
      }
    }

    return validationResults;
  }
}

// Export the factory and manager for use by other components
export { DomainAdapterFactory };
