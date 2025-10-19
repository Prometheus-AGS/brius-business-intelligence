import { Tool } from '@mastra/core';
import { z } from 'zod';
import { mcpLogger, trackPerformance } from '../observability/logger.js';
import { memoryTools, searchAllMemoryTool, searchUserMemoryTool, searchGlobalMemoryTool } from '../tools/memory-tools.js';
import { getMCPTools, getMCPToolsByNamespace, getMCPToolsByServer } from '../tools/mcp-registry.js';

/**
 * Shared Tools Configuration
 * Common tools available to all agents in the business intelligence system
 * Provides foundation capabilities for memory, knowledge, and MCP integration
 */

/**
 * Knowledge Search Tool
 * Searches the knowledge base for relevant information
 */
export const knowledgeSearchTool = new Tool({
  id: 'knowledge-search',
  name: 'Knowledge Search',
  description: 'Search the knowledge base for relevant business information, definitions, and context',
  inputSchema: z.object({
    query: z.string().min(1).describe('Search query for knowledge base'),
    top_k: z.number().int().min(1).max(10).default(5).describe('Number of results to return'),
    category: z.string().optional().describe('Optional category filter (e.g., "metrics", "processes")'),
    include_metadata: z.boolean().default(true).describe('Include source metadata in results'),
  }),
  execute: async ({ context, input }) => {
    const { query, top_k, category, include_metadata } = input;

    mcpLogger.info('Knowledge search initiated', {
      query: query.substring(0, 100),
      top_k,
      category,
      user_id: context.userId,
    });

    return await trackPerformance(
      mcpLogger,
      'knowledge-search',
      async () => {
        // TODO: Integrate with actual knowledge search when implemented
        // For now, return mock results based on query
        const mockResults = generateMockKnowledgeResults(query, top_k, category);

        mcpLogger.info('Knowledge search completed', {
          results_count: mockResults.length,
          query_processed: query.substring(0, 50),
        });

        return {
          results: mockResults,
          total_found: mockResults.length,
          search_time_ms: Math.floor(Math.random() * 100) + 50,
          query_processed: query,
        };
      },
      { query, category }
    );
  },
});

/**
 * Memory Search Tool - Enhanced version using real memory operations
 * Searches user and global memory for relevant context
 */
export const memorySearchTool = searchAllMemoryTool;

/**
 * Business Calculation Tool
 * Performs common business calculations and metrics
 */
export const businessCalculationTool = new Tool({
  id: 'business-calculation',
  name: 'Business Calculation',
  description: 'Perform business calculations like growth rates, ratios, and financial metrics',
  inputSchema: z.object({
    calculation_type: z.enum([
      'growth_rate',
      'percentage_change',
      'ratio',
      'average',
      'compound_growth',
      'conversion_rate',
      'roi',
      'margin',
    ]).describe('Type of calculation to perform'),
    values: z.record(z.number()).describe('Input values for calculation (key-value pairs)'),
    period: z.string().optional().describe('Time period for the calculation'),
    format: z.enum(['decimal', 'percentage', 'currency']).default('decimal').describe('Output format'),
  }),
  execute: async ({ context, input }) => {
    const { calculation_type, values, period, format } = input;

    mcpLogger.info('Business calculation initiated', {
      calculation_type,
      values_count: Object.keys(values).length,
      period,
      format,
    });

    return await trackPerformance(
      mcpLogger,
      'business-calculation',
      async () => {
        const result = performBusinessCalculation(calculation_type, values, period, format);

        mcpLogger.info('Business calculation completed', {
          calculation_type,
          result_value: result.value,
        });

        return result;
      },
      { calculation_type, period }
    );
  },
});

/**
 * Data Validation Tool
 * Validates data quality and identifies potential issues
 */
export const dataValidationTool = new Tool({
  id: 'data-validation',
  name: 'Data Validation',
  description: 'Validate data quality, identify outliers, and check for completeness',
  inputSchema: z.object({
    data: z.array(z.record(z.any())).describe('Data to validate'),
    validation_rules: z.array(z.string()).optional().describe('Specific validation rules to apply'),
    strict_mode: z.boolean().default(false).describe('Enable strict validation mode'),
  }),
  execute: async ({ context, input }) => {
    const { data, validation_rules, strict_mode } = input;

    mcpLogger.info('Data validation initiated', {
      data_rows: data.length,
      validation_rules: validation_rules?.length || 0,
      strict_mode,
    });

    return await trackPerformance(
      mcpLogger,
      'data-validation',
      async () => {
        const validation = performDataValidation(data, validation_rules, strict_mode);

        mcpLogger.info('Data validation completed', {
          is_valid: validation.is_valid,
          issues_found: validation.issues.length,
        });

        return validation;
      },
      { data_size: data.length, strict_mode }
    );
  },
});

/**
 * Generate mock knowledge results for development
 */
function generateMockKnowledgeResults(query: string, topK: number, category?: string) {
  const queryLower = query.toLowerCase();
  const results = [];

  // Business metrics knowledge
  if (queryLower.includes('revenue') || queryLower.includes('sales') || queryLower.includes('financial')) {
    results.push({
      id: 'revenue-metrics-guide',
      title: 'Revenue Recognition and Metrics',
      content: 'Revenue is the total amount of income generated by a business from its operations. Key metrics include Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), and revenue growth rate.',
      source: 'Business Metrics Encyclopedia',
      category: 'financial',
      relevance_score: 0.95,
    });
  }

  if (queryLower.includes('customer') || queryLower.includes('churn') || queryLower.includes('retention')) {
    results.push({
      id: 'customer-metrics-guide',
      title: 'Customer Lifecycle Metrics',
      content: 'Customer metrics include Customer Acquisition Cost (CAC), Customer Lifetime Value (CLV), churn rate, and Net Promoter Score (NPS). These metrics help evaluate customer relationship health.',
      source: 'Customer Analytics Handbook',
      category: 'customer',
      relevance_score: 0.90,
    });
  }

  if (queryLower.includes('kpi') || queryLower.includes('metric') || queryLower.includes('performance')) {
    results.push({
      id: 'kpi-framework',
      title: 'KPI Framework and Best Practices',
      content: 'Key Performance Indicators (KPIs) should be Specific, Measurable, Achievable, Relevant, and Time-bound (SMART). Common business KPIs include operational efficiency, financial performance, and customer satisfaction metrics.',
      source: 'Performance Management Guide',
      category: 'performance',
      relevance_score: 0.85,
    });
  }

  // Default knowledge if no specific matches
  if (results.length === 0) {
    results.push({
      id: 'general-business-concepts',
      title: 'General Business Analysis Concepts',
      content: 'Business analysis involves examining business processes, identifying areas for improvement, and recommending solutions. Common techniques include SWOT analysis, trend analysis, and comparative studies.',
      source: 'Business Analysis Fundamentals',
      category: 'general',
      relevance_score: 0.70,
    });
  }

  return results.slice(0, topK);
}

/**
 * Generate mock memory results for development
 */
function generateMockMemoryResults(query: string, scope: string, topK: number, userId?: string) {
  const results = [];

  if (scope === 'user' || scope === 'both') {
    results.push({
      id: 'user-pref-1',
      type: 'user',
      content: 'User prefers quarterly financial reports with visual charts and executive summaries',
      similarity_score: 0.8,
      created_at: new Date().toISOString(),
      metadata: { category: 'preference', importance: 'high' },
    });
  }

  if (scope === 'global' || scope === 'both') {
    results.push({
      id: 'global-policy-1',
      type: 'global',
      content: 'Company policy requires all financial analyses to include year-over-year comparisons and confidence intervals',
      similarity_score: 0.75,
      created_at: new Date().toISOString(),
      metadata: { category: 'policy', department: 'finance' },
    });
  }

  return results.slice(0, topK);
}

/**
 * Perform business calculation
 */
function performBusinessCalculation(
  type: string,
  values: Record<string, number>,
  period?: string,
  format: string = 'decimal'
) {
  let result: number;
  let explanation: string;

  switch (type) {
    case 'growth_rate':
      const current = values.current || values.new_value;
      const previous = values.previous || values.old_value;
      result = ((current - previous) / previous) * 100;
      explanation = `Growth rate calculated as ((${current} - ${previous}) / ${previous}) * 100`;
      break;

    case 'percentage_change':
      const newVal = values.new_value;
      const oldVal = values.old_value;
      result = ((newVal - oldVal) / oldVal) * 100;
      explanation = `Percentage change: ((${newVal} - ${oldVal}) / ${oldVal}) * 100`;
      break;

    case 'ratio':
      const numerator = values.numerator;
      const denominator = values.denominator;
      result = numerator / denominator;
      explanation = `Ratio calculated as ${numerator} / ${denominator}`;
      break;

    case 'roi':
      const gain = values.gain || values.profit;
      const cost = values.cost || values.investment;
      result = ((gain - cost) / cost) * 100;
      explanation = `ROI calculated as ((${gain} - ${cost}) / ${cost}) * 100`;
      break;

    default:
      result = 0;
      explanation = `Calculation type ${type} not implemented`;
  }

  // Format result
  let formattedValue: string;
  switch (format) {
    case 'percentage':
      formattedValue = `${result.toFixed(2)}%`;
      break;
    case 'currency':
      formattedValue = `$${result.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      break;
    default:
      formattedValue = result.toFixed(2);
  }

  return {
    calculation_type: type,
    value: result,
    formatted_value: formattedValue,
    explanation,
    period,
    inputs: values,
  };
}

/**
 * Perform data validation
 */
function performDataValidation(
  data: any[],
  validationRules?: string[],
  strictMode: boolean = false
) {
  const issues = [];
  let isValid = true;

  // Basic validation
  if (data.length === 0) {
    issues.push('Dataset is empty');
    isValid = false;
  }

  // Check for missing values
  const missingValues = data.filter(row =>
    Object.values(row).some(value => value === null || value === undefined || value === '')
  );

  if (missingValues.length > 0) {
    issues.push(`${missingValues.length} rows contain missing values`);
    if (strictMode) isValid = false;
  }

  // Check for duplicates
  const uniqueRows = new Set(data.map(row => JSON.stringify(row)));
  if (uniqueRows.size < data.length) {
    issues.push(`${data.length - uniqueRows.size} duplicate rows found`);
    if (strictMode) isValid = false;
  }

  return {
    is_valid: isValid,
    total_rows: data.length,
    issues,
    missing_values_count: missingValues.length,
    duplicate_rows_count: data.length - uniqueRows.size,
    validation_rules_applied: validationRules || [],
  };
}

/**
 * Get MCP tools with error handling
 */
function getMCPToolsSafely(): Tool[] {
  try {
    return getMCPTools();
  } catch (error) {
    mcpLogger.warn('Failed to get MCP tools', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Export all shared tools for agent registration
 */
export const sharedTools = [
  knowledgeSearchTool,
  memorySearchTool,
  businessCalculationTool,
  dataValidationTool,
  // Add additional memory tools for specialized use cases
  ...memoryTools.filter(tool => tool.id !== 'search-all-memory'), // Avoid duplicate
  // Add MCP tools dynamically
  ...getMCPToolsSafely(),
];

/**
 * Get tools by category for specific agent needs
 */
export function getToolsByCategory(category: 'knowledge' | 'memory' | 'calculation' | 'validation' | 'mcp' | 'all') {
  switch (category) {
    case 'knowledge':
      return [knowledgeSearchTool];
    case 'memory':
      return memoryTools;
    case 'calculation':
      return [businessCalculationTool];
    case 'validation':
      return [dataValidationTool];
    case 'mcp':
      return getMCPToolsSafely();
    case 'all':
    default:
      return sharedTools;
  }
}

/**
 * Get MCP tools by namespace for specialized agent needs
 */
export function getMCPToolsByNamespaceSafely(namespace: string): Tool[] {
  try {
    return getMCPToolsByNamespace(namespace);
  } catch (error) {
    mcpLogger.warn('Failed to get MCP tools by namespace', {
      namespace,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get MCP tools by server for specialized agent needs
 */
export function getMCPToolsByServerSafely(serverId: string): Tool[] {
  try {
    return getMCPToolsByServer(serverId);
  } catch (error) {
    mcpLogger.warn('Failed to get MCP tools by server', {
      server_id: serverId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get all available tools including dynamically loaded MCP tools
 * This function refreshes the tool list to include any newly registered MCP tools
 */
export function getAllAvailableTools(): Tool[] {
  return [
    knowledgeSearchTool,
    memorySearchTool,
    businessCalculationTool,
    dataValidationTool,
    ...memoryTools.filter(tool => tool.id !== 'search-all-memory'),
    ...getMCPToolsSafely(),
  ];
}