import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  BusinessIntelligencePlannerInputSchema,
  BusinessIntelligencePlannerOutputSchema,
  DataRequirementSchema,
  AnalysisStepSchema,
  type BusinessIntelligencePlannerInput,
  type BusinessIntelligencePlannerOutput,
  type DataRequirement,
  type AnalysisStep,
} from '../types/workflows.js';
import { getSharedToolMap, getToolCounts } from '../agents/shared-tools.js';

// Internal analysis schema for intermediate processing
const QueryAnalysisSchema = z.object({
  primary_intent: z.string(),
  business_domain: z.array(z.string()),
  analysis_type: z.enum(['descriptive', 'diagnostic', 'predictive', 'prescriptive']),
  complexity_indicators: z.object({
    data_sources_needed: z.array(z.string()),
    analysis_depth: z.enum(['surface', 'moderate', 'deep', 'comprehensive']),
    time_sensitivity: z.enum(['immediate', 'within_hours', 'within_days', 'flexible']),
    stakeholder_impact: z.enum(['individual', 'team', 'department', 'organization']),
  }),
  key_entities: z.array(z.string()),
  temporal_aspects: z.array(z.string()),
  success_criteria: z.array(z.string()),
});

const ToolAvailabilitySchema = z.object({
  database_tools: z.array(z.string()),
  analysis_tools: z.array(z.string()),
  reporting_tools: z.array(z.string()),
  external_data_tools: z.array(z.string()),
  ai_tools: z.array(z.string()),
  total_available: z.number(),
});

// Step 1: Analyze the query for business intelligence planning
const analyzeQueryStep = createStep({
  id: 'analyze-bi-query',
  inputSchema: BusinessIntelligencePlannerInputSchema,
  outputSchema: BusinessIntelligencePlannerInputSchema.extend({
    query_analysis: QueryAnalysisSchema,
  }),
  execute: async ({ inputData }) => {
    const analysis = analyzeBusinessIntelligenceQuery(
      inputData.query,
      inputData.context,
      inputData.knowledge_context,
      inputData.memory_context
    );
    return { ...inputData, query_analysis: analysis };
  },
});

// Step 2: Assess available tools and capabilities
const assessToolsStep = createStep({
  id: 'assess-available-tools',
  inputSchema: analyzeQueryStep.outputSchema,
  outputSchema: analyzeQueryStep.outputSchema.extend({
    tool_availability: ToolAvailabilitySchema,
  }),
  execute: async ({ inputData }) => {
    const toolAvailability = await assessAvailableTools(inputData.available_tools);
    return { ...inputData, tool_availability: toolAvailability };
  },
});

// Step 3: Generate data requirements
const generateDataRequirementsStep = createStep({
  id: 'generate-data-requirements',
  inputSchema: assessToolsStep.outputSchema,
  outputSchema: assessToolsStep.outputSchema.extend({
    data_requirements: z.array(DataRequirementSchema),
  }),
  execute: async ({ inputData }) => {
    const dataRequirements = generateDataRequirements(
      inputData.query_analysis,
      inputData.tool_availability,
      inputData.constraints
    );
    return { ...inputData, data_requirements: dataRequirements };
  },
});

// Step 4: Create execution plan
const createExecutionPlanStep = createStep({
  id: 'create-execution-plan',
  inputSchema: generateDataRequirementsStep.outputSchema,
  outputSchema: BusinessIntelligencePlannerOutputSchema,
  execute: async ({ inputData }) => {
    const planningStartTime = Date.now();

    const analysisSteps = generateAnalysisSteps(
      inputData.query_analysis,
      inputData.data_requirements,
      inputData.tool_availability
    );

    const executionPlan = {
      data_requirements: inputData.data_requirements,
      analysis_steps: analysisSteps,
      estimated_execution_time_ms: estimateExecutionTime(analysisSteps, inputData.data_requirements),
      confidence_in_plan: calculatePlanConfidence(
        inputData.query_analysis,
        analysisSteps,
        inputData.tool_availability
      ),
      risk_factors: identifyRiskFactors(analysisSteps, inputData.data_requirements),
    };

    const planningTime = Date.now() - planningStartTime;

    return {
      original_query: inputData.query,
      analysis_approach: inputData.query_analysis.analysis_type,
      execution_plan: executionPlan,
      context_summary: generateContextSummary(inputData),
      expected_deliverables: generateExpectedDeliverables(inputData.query_analysis),
      success_metrics: inputData.query_analysis.success_criteria,
      planning_metadata: {
        planning_time_ms: planningTime,
        tools_considered: [
          ...inputData.tool_availability.database_tools,
          ...inputData.tool_availability.analysis_tools,
          ...inputData.tool_availability.reporting_tools,
        ].slice(0, 10), // Limit for readability
        knowledge_sources_consulted: (inputData.knowledge_context || []).map(k => k.id),
        complexity_assessment: mapComplexityAssessment(inputData.query_analysis.complexity_indicators.analysis_depth),
      },
    } satisfies BusinessIntelligencePlannerOutput;
  },
});

// Main workflow
export const businessIntelligencePlannerWorkflow = createWorkflow({
  id: 'business-intelligence-planner',
  inputSchema: BusinessIntelligencePlannerInputSchema,
  outputSchema: BusinessIntelligencePlannerOutputSchema,
})
  .then(analyzeQueryStep)
  .then(assessToolsStep)
  .then(generateDataRequirementsStep)
  .then(createExecutionPlanStep)
  .commit();

// Execution function
export async function executeBusinessIntelligencePlanner(
  input: BusinessIntelligencePlannerInput
): Promise<BusinessIntelligencePlannerOutput> {
  const run = await businessIntelligencePlannerWorkflow.createRunAsync();
  const result = await run.start({ inputData: input });

  if (result.status !== 'success') {
    const error = (result as { error?: unknown }).error;
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Business Intelligence planner workflow failed');
  }

  return result.result as BusinessIntelligencePlannerOutput;
}

// Helper functions
function analyzeBusinessIntelligenceQuery(
  query: string,
  context?: Record<string, unknown>,
  knowledgeContext?: any[],
  memoryContext?: any[]
): z.infer<typeof QueryAnalysisSchema> {
  const lowerQuery = query.toLowerCase();

  // Determine analysis type
  let analysisType: 'descriptive' | 'diagnostic' | 'predictive' | 'prescriptive' = 'descriptive';
  if (lowerQuery.includes('why') || lowerQuery.includes('cause') || lowerQuery.includes('reason')) {
    analysisType = 'diagnostic';
  } else if (lowerQuery.includes('predict') || lowerQuery.includes('forecast') || lowerQuery.includes('future')) {
    analysisType = 'predictive';
  } else if (lowerQuery.includes('recommend') || lowerQuery.includes('should') || lowerQuery.includes('optimize')) {
    analysisType = 'prescriptive';
  }

  // Extract business domains
  const businessDomains: string[] = [];
  if (lowerQuery.includes('customer') || lowerQuery.includes('patient')) businessDomains.push('customer_management');
  if (lowerQuery.includes('sales') || lowerQuery.includes('revenue')) businessDomains.push('sales');
  if (lowerQuery.includes('marketing') || lowerQuery.includes('campaign')) businessDomains.push('marketing');
  if (lowerQuery.includes('operation') || lowerQuery.includes('process')) businessDomains.push('operations');
  if (lowerQuery.includes('finance') || lowerQuery.includes('cost') || lowerQuery.includes('profit')) businessDomains.push('finance');
  if (lowerQuery.includes('product') || lowerQuery.includes('brava') || lowerQuery.includes('orthodontic')) businessDomains.push('product');

  // Determine complexity
  let analysisDepth: 'surface' | 'moderate' | 'deep' | 'comprehensive' = 'moderate';
  const complexityKeywords = ['trend', 'analysis', 'deep', 'comprehensive', 'detailed', 'thorough'];
  const matchCount = complexityKeywords.filter(keyword => lowerQuery.includes(keyword)).length;
  if (matchCount >= 3) analysisDepth = 'comprehensive';
  else if (matchCount >= 2) analysisDepth = 'deep';
  else if (matchCount >= 1) analysisDepth = 'moderate';
  else analysisDepth = 'surface';

  // Extract entities
  const keyEntities: string[] = [];
  if (lowerQuery.includes('customer') || lowerQuery.includes('patient')) keyEntities.push('customers');
  if (lowerQuery.includes('product') || lowerQuery.includes('brava')) keyEntities.push('products');
  if (lowerQuery.includes('region') || lowerQuery.includes('location')) keyEntities.push('regions');
  if (lowerQuery.includes('time') || lowerQuery.includes('date')) keyEntities.push('time_periods');

  return {
    primary_intent: extractPrimaryIntent(query),
    business_domain: businessDomains.length > 0 ? businessDomains : ['general'],
    analysis_type: analysisType,
    complexity_indicators: {
      data_sources_needed: identifyDataSources(lowerQuery),
      analysis_depth: analysisDepth,
      time_sensitivity: determineTimeSensitivity(lowerQuery),
      stakeholder_impact: determineStakeholderImpact(lowerQuery),
    },
    key_entities: keyEntities,
    temporal_aspects: extractTemporalAspects(lowerQuery),
    success_criteria: generateSuccessCriteria(query, analysisType),
  };
}

async function assessAvailableTools(availableTools?: string[]): Promise<z.infer<typeof ToolAvailabilitySchema>> {
  const toolMap = await getSharedToolMap();
  const allTools = Object.keys(toolMap);

  const databaseTools = allTools.filter(tool =>
    tool.includes('supabase') || tool.includes('postgres') || tool.includes('database') || tool.includes('sql')
  );

  const analysisTools = allTools.filter(tool =>
    tool.includes('analyze') || tool.includes('calculate') || tool.includes('process')
  );

  const reportingTools = allTools.filter(tool =>
    tool.includes('report') || tool.includes('dashboard') || tool.includes('chart')
  );

  const externalDataTools = allTools.filter(tool =>
    tool.includes('api') || tool.includes('fetch') || tool.includes('external')
  );

  const aiTools = allTools.filter(tool =>
    tool.includes('bedrock') || tool.includes('claude') || tool.includes('ai') || tool.includes('llm')
  );

  return {
    database_tools: databaseTools,
    analysis_tools: analysisTools,
    reporting_tools: reportingTools,
    external_data_tools: externalDataTools,
    ai_tools: aiTools,
    total_available: allTools.length,
  };
}

function generateDataRequirements(
  analysis: z.infer<typeof QueryAnalysisSchema>,
  toolAvailability: z.infer<typeof ToolAvailabilitySchema>,
  constraints?: any
): DataRequirement[] {
  const requirements: DataRequirement[] = [];

  // Always need basic data access
  if (toolAvailability.database_tools.length > 0) {
    requirements.push({
      source: 'primary_database',
      type: 'database_query',
      parameters: {
        tables: identifyRelevantTables(analysis),
        constraints: constraints || {},
      },
      description: 'Access to primary business data tables',
      priority: 'critical',
      expected_format: 'structured_data',
    });
  }

  // Add semantic search if knowledge context is important
  if (analysis.complexity_indicators.analysis_depth !== 'surface') {
    requirements.push({
      source: 'knowledge_base',
      type: 'semantic_search',
      parameters: {
        query: analysis.primary_intent,
        entities: analysis.key_entities,
      },
      description: 'Contextual knowledge and historical insights',
      priority: 'important',
      expected_format: 'text_chunks',
    });
  }

  // Add external data if needed
  if (analysis.business_domain.includes('market') || analysis.analysis_type === 'predictive') {
    requirements.push({
      source: 'external_apis',
      type: 'api_call',
      parameters: {
        endpoints: identifyExternalSources(analysis),
      },
      description: 'External market or contextual data',
      priority: 'optional',
      expected_format: 'json_data',
    });
  }

  return requirements;
}

function generateAnalysisSteps(
  analysis: z.infer<typeof QueryAnalysisSchema>,
  dataRequirements: DataRequirement[],
  toolAvailability: z.infer<typeof ToolAvailabilitySchema>
): AnalysisStep[] {
  const steps: AnalysisStep[] = [];

  // Step 1: Data Collection
  steps.push({
    step_id: 'collect_primary_data',
    step_type: 'data_collection',
    description: 'Collect primary data from identified sources',
    tool_calls: dataRequirements.filter(req => req.priority === 'critical').map(req => ({
      tool_id: selectOptimalTool(req.type, toolAvailability),
      parameters: req.parameters,
      expected_output_format: req.expected_format,
    })),
    success_criteria: 'Primary data successfully retrieved and validated',
    fallback_options: ['use_cached_data', 'request_manual_data_export'],
  });

  // Step 2: Data Processing
  if (analysis.complexity_indicators.analysis_depth !== 'surface') {
    steps.push({
      step_id: 'process_and_clean_data',
      step_type: 'data_processing',
      description: 'Clean, validate, and prepare data for analysis',
      tool_calls: [{
        tool_id: selectOptimalTool('data_processing', toolAvailability),
        parameters: {
          cleaning_rules: generateCleaningRules(analysis),
          validation_criteria: generateValidationCriteria(analysis),
        },
        expected_output_format: 'cleaned_dataset',
      }],
      dependencies: ['collect_primary_data'],
      success_criteria: 'Data quality score above 0.8',
      fallback_options: ['manual_data_review', 'accept_lower_quality_threshold'],
    });
  }

  // Step 3: Analysis
  steps.push({
    step_id: 'perform_analysis',
    step_type: 'analysis',
    description: `Perform ${analysis.analysis_type} analysis on prepared data`,
    tool_calls: [{
      tool_id: selectOptimalTool('analysis', toolAvailability),
      parameters: {
        analysis_type: analysis.analysis_type,
        metrics: identifyKeyMetrics(analysis),
        dimensions: analysis.key_entities,
      },
      expected_output_format: 'analysis_results',
    }],
    dependencies: analysis.complexity_indicators.analysis_depth !== 'surface' ?
      ['collect_primary_data', 'process_and_clean_data'] : ['collect_primary_data'],
    success_criteria: 'Analysis completed with statistical significance',
    fallback_options: ['simplified_analysis', 'descriptive_summary'],
  });

  // Step 4: Synthesis
  steps.push({
    step_id: 'synthesize_insights',
    step_type: 'synthesis',
    description: 'Generate insights and recommendations from analysis results',
    tool_calls: [{
      tool_id: selectOptimalTool('ai_synthesis', toolAvailability),
      parameters: {
        context: analysis.primary_intent,
        business_domain: analysis.business_domain,
        stakeholder_level: analysis.complexity_indicators.stakeholder_impact,
      },
      expected_output_format: 'structured_insights',
    }],
    dependencies: ['perform_analysis'],
    success_criteria: 'Actionable insights generated with confidence scores',
    fallback_options: ['manual_insight_generation', 'basic_summary'],
  });

  return steps;
}

// Additional helper functions
function extractPrimaryIntent(query: string): string {
  return query.split(/[.!?]/)[0].trim() || query.substring(0, 100) + '...';
}

function identifyDataSources(query: string): string[] {
  const sources: string[] = [];
  if (query.includes('table') || query.includes('database')) sources.push('database');
  if (query.includes('file') || query.includes('csv')) sources.push('files');
  if (query.includes('api')) sources.push('external_api');
  return sources.length > 0 ? sources : ['database'];
}

function determineTimeSensitivity(query: string): 'immediate' | 'within_hours' | 'within_days' | 'flexible' {
  if (query.includes('urgent') || query.includes('asap')) return 'immediate';
  if (query.includes('today') || query.includes('quickly')) return 'within_hours';
  if (query.includes('this week')) return 'within_days';
  return 'flexible';
}

function determineStakeholderImpact(query: string): 'individual' | 'team' | 'department' | 'organization' {
  if (query.includes('organization') || query.includes('company')) return 'organization';
  if (query.includes('department') || query.includes('division')) return 'department';
  if (query.includes('team') || query.includes('group')) return 'team';
  return 'individual';
}

function extractTemporalAspects(query: string): string[] {
  const aspects: string[] = [];
  if (query.includes('trend')) aspects.push('trending');
  if (query.includes('seasonal')) aspects.push('seasonal');
  if (query.includes('monthly')) aspects.push('monthly');
  if (query.includes('quarterly')) aspects.push('quarterly');
  if (query.includes('yearly') || query.includes('annual')) aspects.push('annual');
  return aspects;
}

function generateSuccessCriteria(query: string, analysisType: string): string[] {
  const criteria = ['Analysis completed without errors', 'Results are statistically significant'];

  if (analysisType === 'predictive') {
    criteria.push('Forecast accuracy validated against historical data');
  }
  if (analysisType === 'prescriptive') {
    criteria.push('Recommendations are actionable and measurable');
  }

  return criteria;
}

function identifyRelevantTables(analysis: z.infer<typeof QueryAnalysisSchema>): string[] {
  const tables: string[] = [];

  if (analysis.key_entities.includes('customers')) tables.push('customers', 'customer_interactions');
  if (analysis.key_entities.includes('products')) tables.push('products', 'product_sales');
  if (analysis.key_entities.includes('regions')) tables.push('regions', 'regional_sales');
  if (analysis.business_domain.includes('sales')) tables.push('sales', 'transactions');
  if (analysis.business_domain.includes('finance')) tables.push('financial_data', 'revenue');

  return tables.length > 0 ? tables : ['main_data'];
}

function identifyExternalSources(analysis: z.infer<typeof QueryAnalysisSchema>): string[] {
  const sources: string[] = [];

  if (analysis.business_domain.includes('market')) sources.push('market_data_api');
  if (analysis.analysis_type === 'predictive') sources.push('economic_indicators_api');

  return sources;
}

function selectOptimalTool(operation: string, toolAvailability: z.infer<typeof ToolAvailabilitySchema>): string {
  switch (operation) {
    case 'database_query':
      return toolAvailability.database_tools[0] || 'fallback_query_tool';
    case 'data_processing':
      return toolAvailability.analysis_tools[0] || 'fallback_processing_tool';
    case 'analysis':
      return toolAvailability.analysis_tools[0] || 'fallback_analysis_tool';
    case 'ai_synthesis':
      return toolAvailability.ai_tools[0] || 'fallback_ai_tool';
    default:
      return 'generic_tool';
  }
}

function generateCleaningRules(analysis: z.infer<typeof QueryAnalysisSchema>): Record<string, unknown> {
  return {
    remove_nulls: true,
    standardize_formats: true,
    validate_ranges: analysis.complexity_indicators.analysis_depth !== 'surface',
  };
}

function generateValidationCriteria(analysis: z.infer<typeof QueryAnalysisSchema>): Record<string, unknown> {
  return {
    completeness_threshold: 0.8,
    accuracy_threshold: 0.9,
    consistency_checks: analysis.complexity_indicators.analysis_depth === 'comprehensive',
  };
}

function identifyKeyMetrics(analysis: z.infer<typeof QueryAnalysisSchema>): string[] {
  const metrics: string[] = [];

  if (analysis.business_domain.includes('sales')) metrics.push('revenue', 'conversion_rate');
  if (analysis.business_domain.includes('customer_management')) metrics.push('retention_rate', 'satisfaction_score');
  if (analysis.business_domain.includes('finance')) metrics.push('profit_margin', 'roi');

  return metrics.length > 0 ? metrics : ['primary_kpi'];
}

function estimateExecutionTime(steps: AnalysisStep[], requirements: DataRequirement[]): number {
  let totalTime = 0;

  // Base time per step
  totalTime += steps.length * 30000; // 30 seconds per step

  // Additional time for data requirements
  totalTime += requirements.length * 15000; // 15 seconds per data requirement

  // Additional time for complex analysis
  const complexSteps = steps.filter(step => step.step_type === 'analysis' || step.step_type === 'synthesis');
  totalTime += complexSteps.length * 60000; // 1 minute per complex step

  return totalTime;
}

function calculatePlanConfidence(
  analysis: z.infer<typeof QueryAnalysisSchema>,
  steps: AnalysisStep[],
  toolAvailability: z.infer<typeof ToolAvailabilitySchema>
): number {
  let confidence = 0.5; // Base confidence

  // Boost confidence based on tool availability
  if (toolAvailability.total_available > 10) confidence += 0.2;
  else if (toolAvailability.total_available > 5) confidence += 0.1;

  // Boost confidence based on clear analysis steps
  if (steps.length >= 4) confidence += 0.1;
  if (steps.length >= 6) confidence += 0.1;

  // Adjust based on complexity
  if (analysis.complexity_indicators.analysis_depth === 'comprehensive') confidence -= 0.1;
  else if (analysis.complexity_indicators.analysis_depth === 'surface') confidence += 0.1;

  return Math.min(0.95, Math.max(0.3, confidence));
}

function identifyRiskFactors(steps: AnalysisStep[], requirements: DataRequirement[]): string[] {
  const risks: string[] = [];

  const criticalRequirements = requirements.filter(req => req.priority === 'critical');
  if (criticalRequirements.length > 3) {
    risks.push('Multiple critical data dependencies may cause execution delays');
  }

  const complexSteps = steps.filter(step => step.dependencies && step.dependencies.length > 2);
  if (complexSteps.length > 0) {
    risks.push('Complex step dependencies may create execution bottlenecks');
  }

  if (requirements.some(req => req.type === 'api_call')) {
    risks.push('External API dependencies may cause timeouts or rate limiting');
  }

  return risks;
}

function generateContextSummary(inputData: any): string {
  const parts: string[] = [];

  parts.push(`Query: "${inputData.query}"`);

  if (inputData.knowledge_context && inputData.knowledge_context.length > 0) {
    parts.push(`Knowledge sources: ${inputData.knowledge_context.length} available`);
  }

  if (inputData.memory_context && inputData.memory_context.length > 0) {
    parts.push(`Memory context: ${inputData.memory_context.length} relevant items`);
  }

  parts.push(`Analysis approach: ${inputData.query_analysis.analysis_type}`);
  parts.push(`Complexity level: ${inputData.query_analysis.complexity_indicators.analysis_depth}`);

  return parts.join('. ');
}

function generateExpectedDeliverables(analysis: z.infer<typeof QueryAnalysisSchema>): string[] {
  const deliverables = ['Executive summary of findings'];

  if (analysis.analysis_type === 'descriptive') {
    deliverables.push('Statistical summary and visualizations');
  }

  if (analysis.analysis_type === 'diagnostic') {
    deliverables.push('Root cause analysis report');
  }

  if (analysis.analysis_type === 'predictive') {
    deliverables.push('Forecast models and projections');
  }

  if (analysis.analysis_type === 'prescriptive') {
    deliverables.push('Actionable recommendations with implementation plan');
  }

  deliverables.push('Data quality assessment');
  deliverables.push('Next steps and follow-up opportunities');

  return deliverables;
}

function mapComplexityAssessment(depth: string): 'low' | 'medium' | 'high' | 'very_high' {
  switch (depth) {
    case 'surface': return 'low';
    case 'moderate': return 'medium';
    case 'deep': return 'high';
    case 'comprehensive': return 'very_high';
    default: return 'medium';
  }
}