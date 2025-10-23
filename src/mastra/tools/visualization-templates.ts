/**
 * Visualization Template System with Interactive Components and API Connectivity
 * Provides templates for different chart types with embedded REST API calls and interactive features
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  VisualizationType,
  ShadcnTheme,
  ShadcnComponent,
  LoaderTemplate,
  TemplateGenerationContext,
  ComponentDataBinding,
  UserContext,
  AnonymousContext,
} from '../types/index.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Interactive Template Types
// ============================================================================

export interface InteractiveTemplate {
  templateId: string;
  name: string;
  description: string;
  visualizationType: VisualizationType;
  interactionTypes: InteractionType[];
  apiConnections: ApiConnectionConfig[];
  shadcnComponents: ShadcnComponent[];
  stateManagement: StateManagementConfig;
  componentTemplate: string;
  stylesTemplate: string;
  hooksTemplate: string;
  apiClientTemplate: string;
  fallbackTemplate: string;
}

export type InteractionType =
  | 'data-refresh'
  | 'filter-data'
  | 'sort-data'
  | 'export-data'
  | 'drill-down'
  | 'real-time-updates'
  | 'form-submit'
  | 'data-mutation'
  | 'pagination'
  | 'search';

export interface ApiConnectionConfig {
  name: string;
  type: 'supabase' | 'mcp-server' | 'rest-api';
  endpoint: string;
  methods: string[];
  authentication: 'jwt' | 'api-key' | 'anonymous';
  rateLimiting?: {
    maxRequests: number;
    windowMs: number;
  };
  caching?: {
    enabled: boolean;
    ttlMs: number;
    strategy: 'memory' | 'localStorage';
  };
}

export interface StateManagementConfig {
  stateVariables: StateVariable[];
  effects: EffectConfig[];
  eventHandlers: EventHandlerConfig[];
}

export interface StateVariable {
  name: string;
  type: string;
  initialValue: any;
  description: string;
  persistent?: boolean; // Store in localStorage
}

export interface EffectConfig {
  name: string;
  dependencies: string[];
  action: string;
  cleanup?: string;
}

export interface EventHandlerConfig {
  name: string;
  event: string;
  handler: string;
  debounce?: number;
  throttle?: number;
}

export interface TemplateCustomization {
  theme: ShadcnTheme;
  layout: 'single-panel' | 'multi-panel' | 'dashboard' | 'modal';
  sizing: 'fixed' | 'responsive' | 'fullscreen';
  interactions: InteractionType[];
  apiEndpoints: ApiConnectionConfig[];
  customStyling?: Record<string, any>;
  brandingOptions?: {
    logo?: string;
    colors?: Record<string, string>;
    typography?: Record<string, string>;
  };
}

// ============================================================================
// Template System Tools
// ============================================================================

/**
 * Generate Interactive Visualization Template
 */
export const generateInteractiveTemplate = new Tool({
  id: 'generate-interactive-template',
  description: 'Generate interactive visualization template with API connectivity and shadcn-ui components',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']),
    componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/).describe('Component name in PascalCase'),

    // Interactive features
    interactionTypes: z.array(z.enum([
      'data-refresh', 'filter-data', 'sort-data', 'export-data',
      'drill-down', 'real-time-updates', 'form-submit', 'data-mutation',
      'pagination', 'search'
    ])).describe('Types of interactions to include'),

    // API connectivity
    apiConnections: z.array(z.object({
      name: z.string(),
      type: z.enum(['supabase', 'mcp-server', 'rest-api']),
      endpoint: z.string().url(),
      methods: z.array(z.string()),
      authentication: z.enum(['jwt', 'api-key', 'anonymous']).default('jwt'),
      rateLimiting: z.object({
        maxRequests: z.number().default(100),
        windowMs: z.number().default(60000),
      }).optional(),
      caching: z.object({
        enabled: z.boolean().default(true),
        ttlMs: z.number().default(300000),
        strategy: z.enum(['memory', 'localStorage']).default('memory'),
      }).optional(),
    })).describe('API connections for data operations'),

    // Template customization
    customization: z.object({
      theme: z.any().optional(),
      layout: z.enum(['single-panel', 'multi-panel', 'dashboard', 'modal']).default('single-panel'),
      sizing: z.enum(['fixed', 'responsive', 'fullscreen']).default('responsive'),
      customStyling: z.record(z.any()).optional(),
      brandingOptions: z.object({
        logo: z.string().optional(),
        colors: z.record(z.string()).optional(),
        typography: z.record(z.string()).optional(),
      }).optional(),
    }).optional().describe('Template customization options'),

    // Data schema
    dataSchema: z.object({
      tables: z.array(z.object({
        name: z.string(),
        columns: z.array(z.object({
          name: z.string(),
          type: z.string(),
          nullable: z.boolean().default(false),
        })),
        primaryKey: z.string().optional(),
        relationships: z.array(z.object({
          targetTable: z.string(),
          type: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
          foreignKey: z.string(),
        })).optional(),
      })),
      defaultTable: z.string(),
    }).optional().describe('Database schema for API operations'),
  }),
  execute: async ({ sessionId, visualizationType, componentName, interactionTypes, apiConnections, customization, dataSchema }, context) => {
    try {
      rootLogger.info('Generating interactive visualization template', {
        sessionId,
        componentName,
        visualizationType,
        interactionTypes: interactionTypes.length,
        apiConnections: apiConnections.length,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Create interactive template configuration
      const templateConfig: InteractiveTemplate = {
        templateId: `template_${componentName}_${Date.now()}`,
        name: `${componentName} Interactive Template`,
        description: `Interactive ${visualizationType} component with API connectivity`,
        visualizationType,
        interactionTypes,
        apiConnections,
        shadcnComponents: getRequiredShadcnComponents(visualizationType, interactionTypes),
        stateManagement: generateStateManagement(interactionTypes, apiConnections),
        componentTemplate: await generateComponentTemplate(componentName, visualizationType, interactionTypes, apiConnections, customization),
        stylesTemplate: generateStylesTemplate(customization),
        hooksTemplate: generateHooksTemplate(interactionTypes, apiConnections),
        apiClientTemplate: generateApiClientTemplate(apiConnections),
        fallbackTemplate: generateFallbackTemplate(componentName, visualizationType),
      };

      // Generate complete interactive component
      const interactiveComponent = await assembleInteractiveComponent(templateConfig, dataSchema);

      // Store template for reuse
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(templateConfig), {
        userId: userContext.userId,
        category: 'interactive-template',
        domains: [],
        scope: 'session',
        metadata: {
          templateId: templateConfig.templateId,
          componentName,
          visualizationType,
          interactionCount: interactionTypes.length,
          apiConnectionCount: apiConnections.length,
        },
      });

      // Trace template generation
      await biContextTracer.traceMemoryOperation(sessionId, 'interactive_template_generation', {
        templateId: templateConfig.templateId,
        componentName,
        visualizationType,
        interactionTypes: interactionTypes.length,
        apiConnections: apiConnections.length,
        shadcnComponents: templateConfig.shadcnComponents.length,
      });

      return {
        success: true,
        sessionId,
        templateId: templateConfig.templateId,
        template: templateConfig,
        interactiveComponent,
        metadata: {
          componentSize: interactiveComponent.length,
          interactionTypes: interactionTypes.length,
          apiConnections: apiConnections.length,
          shadcnComponents: templateConfig.shadcnComponents.length,
          estimatedComplexity: calculateTemplateComplexity(templateConfig),
        },
      };

    } catch (error) {
      rootLogger.error('Failed to generate interactive template', {
        sessionId,
        componentName,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to generate interactive template',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Get Available Templates
 */
export const getAvailableTemplates = new Tool({
  id: 'get-available-templates',
  description: 'Get list of available visualization templates with their capabilities',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']).optional(),
    interactionType: z.enum([
      'data-refresh', 'filter-data', 'sort-data', 'export-data',
      'drill-down', 'real-time-updates', 'form-submit', 'data-mutation',
      'pagination', 'search'
    ]).optional(),
    includeBuiltIn: z.boolean().default(true).describe('Include built-in templates'),
    includeCustom: z.boolean().default(true).describe('Include user-created templates'),
  }),
  execute: async ({ sessionId, visualizationType, interactionType, includeBuiltIn, includeCustom }, context) => {
    try {
      rootLogger.info('Getting available templates', {
        sessionId,
        visualizationType,
        interactionType,
        includeBuiltIn,
        includeCustom,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const templates = [];

      // Add built-in templates
      if (includeBuiltIn) {
        const builtInTemplates = getBuiltInTemplates();
        templates.push(...builtInTemplates.filter(template =>
          (!visualizationType || template.visualizationType === visualizationType) &&
          (!interactionType || template.interactionTypes.includes(interactionType))
        ));
      }

      // Add custom templates
      if (includeCustom) {
        const customTemplates = await getCustomTemplates(sessionId, userContext, {
          visualizationType,
          interactionType,
        });
        templates.push(...customTemplates);
      }

      return {
        success: true,
        sessionId,
        templates: templates.map(template => ({
          templateId: template.templateId,
          name: template.name,
          description: template.description,
          visualizationType: template.visualizationType,
          interactionTypes: template.interactionTypes,
          apiConnections: template.apiConnections.map(conn => ({
            name: conn.name,
            type: conn.type,
            methods: conn.methods,
          })),
          shadcnComponents: template.shadcnComponents,
          complexity: calculateTemplateComplexity(template),
          estimatedSize: estimateComponentSize(template),
        })),
        metadata: {
          totalTemplates: templates.length,
          builtInCount: includeBuiltIn ? getBuiltInTemplates().length : 0,
          customCount: templates.length - (includeBuiltIn ? getBuiltInTemplates().length : 0),
        },
      };

    } catch (error) {
      rootLogger.error('Failed to get available templates', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to get available templates',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Customize Template
 */
export const customizeTemplate = new Tool({
  id: 'customize-template',
  description: 'Customize an existing template with specific requirements and styling',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    templateId: z.string().describe('Base template ID to customize'),
    componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/).describe('New component name'),
    customizations: z.object({
      theme: z.any().optional(),
      layout: z.enum(['single-panel', 'multi-panel', 'dashboard', 'modal']).optional(),
      sizing: z.enum(['fixed', 'responsive', 'fullscreen']).optional(),
      additionalInteractions: z.array(z.enum([
        'data-refresh', 'filter-data', 'sort-data', 'export-data',
        'drill-down', 'real-time-updates', 'form-submit', 'data-mutation',
        'pagination', 'search'
      ])).optional(),
      additionalApiConnections: z.array(z.object({
        name: z.string(),
        type: z.enum(['supabase', 'mcp-server', 'rest-api']),
        endpoint: z.string().url(),
        methods: z.array(z.string()),
        authentication: z.enum(['jwt', 'api-key', 'anonymous']).default('jwt'),
      })).optional(),
      customStyling: z.record(z.any()).optional(),
      brandingOptions: z.object({
        logo: z.string().optional(),
        colors: z.record(z.string()).optional(),
        typography: z.record(z.string()).optional(),
      }).optional(),
    }).describe('Customization options'),
  }),
  execute: async ({ sessionId, templateId, componentName, customizations }, context) => {
    try {
      rootLogger.info('Customizing template', {
        sessionId,
        templateId,
        componentName,
        hasTheme: Boolean(customizations.theme),
        hasCustomStyling: Boolean(customizations.customStyling),
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Find base template
      const baseTemplate = await findTemplate(sessionId, templateId);
      if (!baseTemplate) {
        return {
          success: false,
          error: 'Base template not found',
          sessionId,
          templateId,
        };
      }

      // Apply customizations
      const customizedTemplate: InteractiveTemplate = {
        ...baseTemplate,
        templateId: `template_${componentName}_${Date.now()}`,
        name: `${componentName} Custom Template`,
        interactionTypes: [
          ...baseTemplate.interactionTypes,
          ...(customizations.additionalInteractions || []),
        ],
        apiConnections: [
          ...baseTemplate.apiConnections,
          ...(customizations.additionalApiConnections || []),
        ],
        componentTemplate: await generateComponentTemplate(
          componentName,
          baseTemplate.visualizationType,
          [...baseTemplate.interactionTypes, ...(customizations.additionalInteractions || [])],
          [...baseTemplate.apiConnections, ...(customizations.additionalApiConnections || [])],
          customizations
        ),
        stylesTemplate: generateStylesTemplate(customizations),
        hooksTemplate: generateHooksTemplate(
          [...baseTemplate.interactionTypes, ...(customizations.additionalInteractions || [])],
          [...baseTemplate.apiConnections, ...(customizations.additionalApiConnections || [])]
        ),
        apiClientTemplate: generateApiClientTemplate([
          ...baseTemplate.apiConnections,
          ...(customizations.additionalApiConnections || [])
        ]),
      };

      // Update state management for new interactions
      customizedTemplate.stateManagement = generateStateManagement(
        customizedTemplate.interactionTypes,
        customizedTemplate.apiConnections
      );

      // Update required shadcn components
      customizedTemplate.shadcnComponents = getRequiredShadcnComponents(
        customizedTemplate.visualizationType,
        customizedTemplate.interactionTypes
      );

      // Generate customized component
      const customizedComponent = await assembleInteractiveComponent(customizedTemplate);

      // Store customized template
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(customizedTemplate), {
        userId: userContext.userId,
        category: 'interactive-template',
        domains: [],
        scope: 'session',
        metadata: {
          templateId: customizedTemplate.templateId,
          baseTemplateId: templateId,
          componentName,
          customized: true,
          interactionCount: customizedTemplate.interactionTypes.length,
          apiConnectionCount: customizedTemplate.apiConnections.length,
        },
      });

      // Trace template customization
      await biContextTracer.traceMemoryOperation(sessionId, 'template_customization', {
        templateId: customizedTemplate.templateId,
        baseTemplateId: templateId,
        componentName,
        customizationsApplied: Object.keys(customizations).length,
        newInteractions: customizations.additionalInteractions?.length || 0,
        newApiConnections: customizations.additionalApiConnections?.length || 0,
      });

      return {
        success: true,
        sessionId,
        templateId: customizedTemplate.templateId,
        customizedTemplate,
        customizedComponent,
        metadata: {
          baseTemplateId: templateId,
          componentSize: customizedComponent.length,
          customizationsApplied: Object.keys(customizations).length,
          complexity: calculateTemplateComplexity(customizedTemplate),
        },
      };

    } catch (error) {
      rootLogger.error('Failed to customize template', {
        sessionId,
        templateId,
        componentName,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to customize template',
        details: (error as Error).message,
        sessionId,
        templateId,
      };
    }
  },
});

// ============================================================================
// Template Generation Functions
// ============================================================================

async function generateComponentTemplate(
  componentName: string,
  visualizationType: VisualizationType,
  interactionTypes: InteractionType[],
  apiConnections: ApiConnectionConfig[],
  customization?: any
): Promise<string> {
  const hasDataRefresh = interactionTypes.includes('data-refresh');
  const hasFiltering = interactionTypes.includes('filter-data');
  const hasSorting = interactionTypes.includes('sort-data');
  const hasExport = interactionTypes.includes('export-data');
  const hasPagination = interactionTypes.includes('pagination');
  const hasSearch = interactionTypes.includes('search');
  const hasRealTime = interactionTypes.includes('real-time-updates');
  const hasFormSubmit = interactionTypes.includes('form-submit');
  const hasDataMutation = interactionTypes.includes('data-mutation');

  const apiClientImports = apiConnections.map(conn =>
    `import { ${conn.name}Client } from './api-clients/${conn.name}';`
  ).join('\n');

  return `import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
${hasFiltering || hasSearch ? `import { Input } from './components/ui/input';` : ''}
${hasFiltering ? `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';` : ''}
${hasSorting ? `import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';` : ''}
${hasExport ? `import { Download, FileText, FileSpreadsheet } from 'lucide-react';` : ''}
${hasDataRefresh ? `import { RefreshCw } from 'lucide-react';` : ''}
${hasSearch ? `import { Search } from 'lucide-react';` : ''}
${hasPagination ? `import { ChevronLeft, ChevronRight } from 'lucide-react';` : ''}
${hasFormSubmit || hasDataMutation ? `import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from './components/ui/form';` : ''}
${hasFormSubmit || hasDataMutation ? `import { useForm } from 'react-hook-form';` : ''}
import { Alert, AlertDescription } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { Skeleton } from './components/ui/skeleton';
import { Toast } from './components/ui/toast';
${generateVisualizationImports(visualizationType)}
${apiClientImports}

// API Client Setup
${apiConnections.map(conn => `const ${conn.name} = new ${conn.name}Client('${conn.endpoint}');`).join('\n')}

// Component Interface
interface ${componentName}Props {
  data?: any[];
  ${hasFiltering ? 'defaultFilters?: Record<string, any>;' : ''}
  ${hasSorting ? 'defaultSort?: { field: string; direction: \'asc\' | \'desc\' };' : ''}
  ${hasPagination ? 'pageSize?: number;' : ''}
  ${customization?.theme ? 'theme?: any;' : ''}
  className?: string;
  style?: React.CSSProperties;
  onDataChange?: (data: any[]) => void;
  onError?: (error: string) => void;
}

const ${componentName}: React.FC<${componentName}Props> = ({
  data: initialData = [],
  ${hasFiltering ? 'defaultFilters = {},' : ''}
  ${hasSorting ? 'defaultSort = { field: \'id\', direction: \'asc\' },' : ''}
  ${hasPagination ? 'pageSize = 10,' : ''}
  ${customization?.theme ? 'theme,' : ''}
  className,
  style,
  onDataChange,
  onError,
}) => {
  // State Management
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  ${hasFiltering ? 'const [filters, setFilters] = useState(defaultFilters);' : ''}
  ${hasSorting ? 'const [sort, setSort] = useState(defaultSort);' : ''}
  ${hasPagination ? 'const [currentPage, setCurrentPage] = useState(1);' : ''}
  ${hasSearch ? 'const [searchTerm, setSearchTerm] = useState(\'\');' : ''}
  ${hasRealTime ? 'const [realTimeEnabled, setRealTimeEnabled] = useState(false);' : ''}
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // API Operations
  const fetchData = useCallback(async (params: any = {}) => {
    setLoading(true);
    setError(null);

    try {
      ${apiConnections.length > 0 ? `
      // Use primary API connection for data fetching
      const response = await ${apiConnections[0].name}.get('/data', {
        params: {
          ...params,
          ${hasFiltering ? '...filters,' : ''}
          ${hasSorting ? 'sort: sort.field, direction: sort.direction,' : ''}
          ${hasPagination ? 'page: currentPage, limit: pageSize,' : ''}
          ${hasSearch ? 'search: searchTerm,' : ''}
        }
      });

      if (response.success) {
        setData(response.data);
        setLastUpdated(new Date());
        onDataChange?.(response.data);
      } else {
        throw new Error(response.error || 'Failed to fetch data');
      }
      ` : `
      // Simulated data fetching
      await new Promise(resolve => setTimeout(resolve, 1000));
      setData(initialData);
      setLastUpdated(new Date());
      `}
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [${hasFiltering ? 'filters' : ''}, ${hasSorting ? 'sort' : ''}, ${hasPagination ? 'currentPage, pageSize' : ''}, ${hasSearch ? 'searchTerm' : ''}, onDataChange, onError]);

  ${hasDataMutation ? `
  const mutateData = useCallback(async (operation: 'create' | 'update' | 'delete', payload: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await ${apiConnections[0]?.name || 'api'}.post(\`/data/\${operation}\`, payload);

      if (response.success) {
        // Refresh data after mutation
        await fetchData();
        return response.data;
      } else {
        throw new Error(response.error || \`Failed to \${operation} data\`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      onError?.(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchData, onError]);
  ` : ''}

  ${hasExport ? `
  const exportData = useCallback(async (format: 'json' | 'csv' | 'excel') => {
    try {
      const response = await ${apiConnections[0]?.name || 'api'}.post('/data/export', {
        data: filteredData,
        format,
      });

      if (response.success) {
        // Create download link
        const blob = new Blob([response.data], {
          type: format === 'json' ? 'application/json' :
                format === 'csv' ? 'text/csv' :
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = \`export.\${format}\`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError('Failed to export data');
    }
  }, [data]);
  ` : ''}

  // Data Processing
  const filteredData = useMemo(() => {
    let result = data;

    ${hasSearch ? `
    if (searchTerm) {
      result = result.filter(item =>
        Object.values(item).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }
    ` : ''}

    ${hasFiltering ? `
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value != null) {
        result = result.filter(item => item[key] === value);
      }
    });
    ` : ''}

    ${hasSorting ? `
    result = [...result].sort((a, b) => {
      const aVal = a[sort.field];
      const bVal = b[sort.field];
      const modifier = sort.direction === 'asc' ? 1 : -1;

      if (aVal < bVal) return -1 * modifier;
      if (aVal > bVal) return 1 * modifier;
      return 0;
    });
    ` : ''}

    return result;
  }, [data, ${hasSearch ? 'searchTerm' : ''}, ${hasFiltering ? 'filters' : ''}, ${hasSorting ? 'sort' : ''}]);

  ${hasPagination ? `
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredData.slice(startIndex, startIndex + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredData.length / pageSize);
  ` : ''}

  // Effects
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  ${hasRealTime ? `
  useEffect(() => {
    if (!realTimeEnabled) return;

    const interval = setInterval(() => {
      fetchData();
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [realTimeEnabled, fetchData]);
  ` : ''}

  // Event Handlers
  ${hasDataRefresh ? `
  const handleRefresh = useCallback(() => {
    fetchData();
  }, [fetchData]);
  ` : ''}

  ${hasFiltering ? `
  const handleFilterChange = useCallback((key: string, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    ${hasPagination ? 'setCurrentPage(1);' : ''}
  }, []);
  ` : ''}

  ${hasSorting ? `
  const handleSortChange = useCallback((field: string, direction: 'asc' | 'desc') => {
    setSort({ field, direction });
    ${hasPagination ? 'setCurrentPage(1);' : ''}
  }, []);
  ` : ''}

  ${hasSearch ? `
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    ${hasPagination ? 'setCurrentPage(1);' : ''}
  }, []);
  ` : ''}

  const displayData = ${hasPagination ? 'paginatedData' : 'filteredData'};

  return (
    <div className={className} style={style}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>${componentName}</CardTitle>
              <CardDescription>
                ${generateVisualizationDescription(visualizationType)}
                {lastUpdated && (
                  <span className="text-xs text-muted-foreground">
                    Last updated: {lastUpdated.toLocaleString()}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              ${hasRealTime ? `
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRealTimeEnabled(!realTimeEnabled)}
              >
                {realTimeEnabled ? 'Disable' : 'Enable'} Real-time
              </Button>
              ` : ''}
              ${hasDataRefresh ? `
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={loading}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
                Refresh
              </Button>
              ` : ''}
              ${hasExport ? `
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download size={16} />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => exportData('json')}>
                    <FileText size={16} />
                    JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportData('csv')}>
                    <FileSpreadsheet size={16} />
                    CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportData('excel')}>
                    <FileSpreadsheet size={16} />
                    Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              ` : ''}
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex items-center gap-4 mt-4">
            ${hasSearch ? `
            <div className="flex items-center gap-2">
              <Search size={16} />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-64"
              />
            </div>
            ` : ''}

            ${hasFiltering ? `
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Filters:</span>
              {/* Add specific filter controls based on data schema */}
              <Select onValueChange={(value) => handleFilterChange('status', value)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            ` : ''}

            ${hasSorting ? `
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Sort by:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    {sort.field} ({sort.direction})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleSortChange('name', 'asc')}>
                    Name (A-Z)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSortChange('name', 'desc')}>
                    Name (Z-A)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSortChange('created', 'desc')}>
                    Newest First
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSortChange('created', 'asc')}>
                    Oldest First
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            ` : ''}
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert className="mb-4 border-destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <div>
              {displayData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No data available
                </div>
              ) : (
                <>
                  {/* Visualization Component */}
                  ${generateVisualizationComponent(visualizationType, 'displayData')}

                  {/* Data Summary */}
                  <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                    <span>
                      Showing {displayData.length} of {filteredData.length} records
                      {filteredData.length !== data.length && \` (filtered from \${data.length})\`}
                    </span>
                    ${realTimeEnabled ? `
                    <Badge variant="secondary">
                      Real-time updates enabled
                    </Badge>
                    ` : ''}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>

        ${hasPagination ? `
        <CardFooter>
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1 || loading}
              >
                <ChevronLeft size={16} />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || loading}
              >
                Next
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </CardFooter>
        ` : ''}
      </Card>
    </div>
  );
};

export default ${componentName};`;
}

function generateVisualizationImports(visualizationType: VisualizationType): string {
  switch (visualizationType) {
    case 'bar-chart':
    case 'line-chart':
    case 'pie-chart':
      return `import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';`;
    case 'table':
      return `import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';`;
    case 'scatter-plot':
      return `import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';`;
    case 'heatmap':
      return `import { ResponsiveContainer } from 'recharts';`;
    case 'dashboard':
      return `import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Grid } from './components/ui/grid';`;
    default:
      return '';
  }
}

function generateVisualizationDescription(visualizationType: VisualizationType): string {
  switch (visualizationType) {
    case 'bar-chart':
      return 'Interactive bar chart with filtering and sorting capabilities';
    case 'line-chart':
      return 'Interactive line chart with real-time data updates';
    case 'pie-chart':
      return 'Interactive pie chart with drill-down functionality';
    case 'table':
      return 'Interactive data table with search, sort, and export features';
    case 'scatter-plot':
      return 'Interactive scatter plot with data point exploration';
    case 'heatmap':
      return 'Interactive heatmap with hover details and filtering';
    case 'dashboard':
      return 'Interactive dashboard with multiple visualization panels';
    default:
      return 'Interactive data visualization component';
  }
}

function generateVisualizationComponent(visualizationType: VisualizationType, dataVar: string): string {
  switch (visualizationType) {
    case 'bar-chart':
      return `<ResponsiveContainer width="100%" height={400}>
                <BarChart data={${dataVar}}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>`;

    case 'line-chart':
      return `<ResponsiveContainer width="100%" height={400}>
                <LineChart data={${dataVar}}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>`;

    case 'pie-chart':
      return `<ResponsiveContainer width="100%" height={400}>
                <PieChart>
                  <Pie
                    data={${dataVar}}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => \`\${name} \${(percent * 100).toFixed(0)}%\`}
                    outerRadius={80}
                    fill="hsl(var(--primary))"
                    dataKey="value"
                  >
                    {${dataVar}.map((entry, index) => (
                      <Cell key={\`cell-\${index}\`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>`;

    case 'table':
      return `<Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(${dataVar}[0] || {}).map(key => (
                      <TableHead key={key}>{key}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {${dataVar}.map((row, index) => (
                    <TableRow key={index}>
                      {Object.values(row).map((value, cellIndex) => (
                        <TableCell key={cellIndex}>{String(value)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>`;

    case 'scatter-plot':
      return `<ResponsiveContainer width="100%" height={400}>
                <ScatterChart data={${dataVar}}>
                  <CartesianGrid />
                  <XAxis dataKey="x" />
                  <YAxis dataKey="y" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter dataKey="value" fill="hsl(var(--primary))" />
                </ScatterChart>
              </ResponsiveContainer>`;

    case 'dashboard':
      return `<Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  <TabsTrigger value="reports">Reports</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {${dataVar}.slice(0, 4).map((item, index) => (
                      <Card key={index}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">
                            {item.name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{item.value}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>`;

    default:
      return `<div className="p-4 border rounded">
                <pre>{JSON.stringify(${dataVar}, null, 2)}</pre>
              </div>`;
  }
}

function generateStylesTemplate(customization?: any): string {
  const brandColors = customization?.brandingOptions?.colors || {};
  const typography = customization?.brandingOptions?.typography || {};

  return `/* Component Styles */
:root {
  /* Brand Colors */
  ${Object.entries(brandColors).map(([key, value]) => `--brand-${key}: ${value};`).join('\n  ')}

  /* Typography */
  ${Object.entries(typography).map(([key, value]) => `--font-${key}: ${value};`).join('\n  ')}

  /* Interactive States */
  --interactive-hover: hsl(var(--primary) / 0.8);
  --interactive-active: hsl(var(--primary) / 0.9);
}

.visualization-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background) / 0.8);
  backdrop-filter: blur(2px);
  z-index: 10;
}

.interactive-button {
  transition: all 0.2s ease-in-out;
}

.interactive-button:hover {
  background: var(--interactive-hover);
}

.interactive-button:active {
  background: var(--interactive-active);
}

.data-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
}

.filter-controls {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.pagination-controls {
  display: flex;
  align-items: center;
  justify-content: between;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid hsl(var(--border));
}

/* Responsive Design */
@media (max-width: 768px) {
  .filter-controls {
    flex-direction: column;
  }

  .data-grid {
    grid-template-columns: 1fr;
  }
}

/* Animation Classes */
.fade-in {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.slide-up {
  animation: slideUp 0.3s ease-in-out;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}`;
}

function generateHooksTemplate(interactionTypes: InteractionType[], apiConnections: ApiConnectionConfig[]): string {
  return `/* Custom Hooks for ${interactionTypes.join(', ')} */

import { useState, useEffect, useCallback, useMemo } from 'react';

// Data Fetching Hook
export const useDataFetching = (apiClient: any, endpoint: string) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (params?: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get(endpoint, { params });
      if (response.success) {
        setData(response.data);
      } else {
        throw new Error(response.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiClient, endpoint]);

  return { data, loading, error, fetchData, refetch: fetchData };
};

${interactionTypes.includes('filter-data') ? `
// Filtering Hook
export const useFiltering = (data: any[], initialFilters: Record<string, any> = {}) => {
  const [filters, setFilters] = useState(initialFilters);

  const filteredData = useMemo(() => {
    return data.filter(item => {
      return Object.entries(filters).every(([key, value]) => {
        if (!value || value === '') return true;
        return item[key] === value;
      });
    });
  }, [data, filters]);

  const updateFilter = useCallback((key: string, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  return { filters, filteredData, updateFilter, clearFilters };
};
` : ''}

${interactionTypes.includes('sort-data') ? `
// Sorting Hook
export const useSorting = (data: any[], initialSort?: { field: string; direction: 'asc' | 'desc' }) => {
  const [sort, setSort] = useState(initialSort || { field: 'id', direction: 'asc' });

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sort.field];
      const bVal = b[sort.field];
      const modifier = sort.direction === 'asc' ? 1 : -1;

      if (aVal < bVal) return -1 * modifier;
      if (aVal > bVal) return 1 * modifier;
      return 0;
    });
  }, [data, sort]);

  const updateSort = useCallback((field: string, direction?: 'asc' | 'desc') => {
    setSort(prev => ({
      field,
      direction: direction || (prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc')
    }));
  }, []);

  return { sort, sortedData, updateSort };
};
` : ''}

${interactionTypes.includes('pagination') ? `
// Pagination Hook
export const usePagination = (data: any[], pageSize: number = 10) => {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(data.length / pageSize);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return data.slice(startIndex, startIndex + pageSize);
  }, [data, currentPage, pageSize]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, page)));
  }, [totalPages]);

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  return {
    currentPage,
    totalPages,
    paginatedData,
    goToPage,
    nextPage,
    prevPage,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1
  };
};
` : ''}

${interactionTypes.includes('search') ? `
// Search Hook
export const useSearch = (data: any[], searchFields: string[] = []) => {
  const [searchTerm, setSearchTerm] = useState('');

  const searchedData = useMemo(() => {
    if (!searchTerm) return data;

    return data.filter(item => {
      if (searchFields.length > 0) {
        return searchFields.some(field =>
          String(item[field]).toLowerCase().includes(searchTerm.toLowerCase())
        );
      } else {
        return Object.values(item).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
    });
  }, [data, searchTerm, searchFields]);

  return { searchTerm, searchedData, setSearchTerm };
};
` : ''}

${interactionTypes.includes('real-time-updates') ? `
// Real-time Updates Hook
export const useRealTimeUpdates = (fetchData: () => void, interval: number = 30000) => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const intervalId = setInterval(fetchData, interval);
    return () => clearInterval(intervalId);
  }, [enabled, fetchData, interval]);

  return { enabled, setEnabled };
};
` : ''}`;
}

function generateApiClientTemplate(apiConnections: ApiConnectionConfig[]): string {
  return apiConnections.map(conn => `
// ${conn.name} API Client
class ${conn.name}Client {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.initAuth();
  }

  private async initAuth() {
    ${conn.authentication === 'jwt' ? `
    // JWT Authentication
    this.authToken = localStorage.getItem('auth_token') ||
                     sessionStorage.getItem('auth_token');
    ` : conn.authentication === 'api-key' ? `
    // API Key Authentication
    this.authToken = process.env.REACT_APP_API_KEY || '';
    ` : `
    // Anonymous Authentication
    this.authToken = null;
    `}
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      ${conn.authentication === 'jwt' ? `
      headers['Authorization'] = \`Bearer \${this.authToken}\`;
      ` : conn.authentication === 'api-key' ? `
      headers['X-API-Key'] = this.authToken;
      ` : ''}
    }

    return headers;
  }

  async request(method: string, endpoint: string, data?: any, params?: any) {
    const url = new URL(endpoint, this.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const config: RequestInit = {
      method,
      headers: this.getHeaders(),
      ${conn.type === 'supabase' ? `
      // Supabase-specific configuration
      mode: 'cors',
      credentials: 'include',
      ` : `
      mode: 'cors',
      credentials: 'same-origin',
      `}
    };

    if (data && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url.toString(), config);

      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
      }

      const result = await response.json();
      return { success: true, data: result };
    } catch (error) {
      console.error(\`${conn.name} API Error:\`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  ${conn.methods.map(method => `
  async ${method.toLowerCase()}(endpoint: string, data?: any, params?: any) {
    return this.request('${method.toUpperCase()}', endpoint, data, params);
  }
  `).join('')}

  ${conn.type === 'supabase' ? `
  // Supabase-specific methods
  async select(table: string, options?: {
    columns?: string;
    filter?: Record<string, any>;
    order?: string;
    limit?: number;
    offset?: number;
  }) {
    let endpoint = \`/rest/v1/\${table}\`;
    const params: Record<string, any> = {};

    if (options?.columns) {
      params.select = options.columns;
    }

    if (options?.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        params[key] = \`eq.\${value}\`;
      });
    }

    if (options?.order) {
      params.order = options.order;
    }

    if (options?.limit) {
      params.limit = options.limit;
    }

    if (options?.offset) {
      params.offset = options.offset;
    }

    return this.get(endpoint, undefined, params);
  }

  async insert(table: string, data: any) {
    return this.post(\`/rest/v1/\${table}\`, data);
  }

  async update(table: string, data: any, filter: Record<string, any>) {
    let endpoint = \`/rest/v1/\${table}\`;
    const params: Record<string, any> = {};

    Object.entries(filter).forEach(([key, value]) => {
      params[key] = \`eq.\${value}\`;
    });

    return this.request('PATCH', endpoint, data, params);
  }

  async delete(table: string, filter: Record<string, any>) {
    let endpoint = \`/rest/v1/\${table}\`;
    const params: Record<string, any> = {};

    Object.entries(filter).forEach(([key, value]) => {
      params[key] = \`eq.\${value}\`;
    });

    return this.request('DELETE', endpoint, undefined, params);
  }
  ` : ''}
}

export { ${conn.name}Client };
`).join('\n\n');
}

function generateFallbackTemplate(componentName: string, visualizationType: VisualizationType): string {
  return `const ${componentName}Fallback = ({ error, retry }: { error?: string; retry?: () => void }) => (
  <div style={{
    padding: '2rem',
    border: '2px dashed #ccc',
    borderRadius: '8px',
    textAlign: 'center',
    minHeight: '300px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  }}>
    <h3>${componentName}</h3>
    <p>Visualization Type: ${visualizationType}</p>
    {error && (
      <div style={{ color: '#ef4444', marginTop: '1rem' }}>
        <p>Error: {error}</p>
      </div>
    )}
    <div style={{ marginTop: '1rem' }}>
      {retry && (
        <button
          onClick={retry}
          style={{
            padding: '0.5rem 1rem',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      )}
    </div>
    <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
      <small>Interactive component failed to load</small>
    </div>
  </div>
);

export default ${componentName}Fallback;`;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getRequiredShadcnComponents(visualizationType: VisualizationType, interactionTypes: InteractionType[]): ShadcnComponent[] {
  const baseComponents: ShadcnComponent[] = ['card', 'button'];

  // Add visualization-specific components
  switch (visualizationType) {
    case 'table':
      baseComponents.push('table', 'badge');
      break;
    case 'dashboard':
      baseComponents.push('tabs', 'separator');
      break;
  }

  // Add interaction-specific components
  if (interactionTypes.includes('filter-data')) {
    baseComponents.push('select', 'input');
  }

  if (interactionTypes.includes('sort-data')) {
    baseComponents.push('dropdown-menu');
  }

  if (interactionTypes.includes('search')) {
    baseComponents.push('input');
  }

  if (interactionTypes.includes('form-submit') || interactionTypes.includes('data-mutation')) {
    baseComponents.push('input', 'label');
  }

  if (interactionTypes.includes('pagination')) {
    baseComponents.push('button');
  }

  // Always include these for interactive components
  baseComponents.push('alert', 'skeleton', 'toast');

  return [...new Set(baseComponents)]; // Remove duplicates
}

function generateStateManagement(interactionTypes: InteractionType[], apiConnections: ApiConnectionConfig[]): StateManagementConfig {
  const stateVariables: StateVariable[] = [
    {
      name: 'data',
      type: 'any[]',
      initialValue: [],
      description: 'Main data array',
    },
    {
      name: 'loading',
      type: 'boolean',
      initialValue: false,
      description: 'Loading state',
    },
    {
      name: 'error',
      type: 'string | null',
      initialValue: null,
      description: 'Error state',
    },
  ];

  const effects: EffectConfig[] = [
    {
      name: 'fetchInitialData',
      dependencies: [],
      action: 'fetchData()',
    },
  ];

  const eventHandlers: EventHandlerConfig[] = [];

  // Add state variables based on interactions
  if (interactionTypes.includes('filter-data')) {
    stateVariables.push({
      name: 'filters',
      type: 'Record<string, any>',
      initialValue: {},
      description: 'Active filters',
      persistent: true,
    });

    eventHandlers.push({
      name: 'handleFilterChange',
      event: 'filter-change',
      handler: 'updateFilter',
      debounce: 300,
    });
  }

  if (interactionTypes.includes('sort-data')) {
    stateVariables.push({
      name: 'sort',
      type: '{ field: string; direction: "asc" | "desc" }',
      initialValue: { field: 'id', direction: 'asc' },
      description: 'Sort configuration',
      persistent: true,
    });
  }

  if (interactionTypes.includes('search')) {
    stateVariables.push({
      name: 'searchTerm',
      type: 'string',
      initialValue: '',
      description: 'Search term',
    });

    eventHandlers.push({
      name: 'handleSearchChange',
      event: 'search-change',
      handler: 'updateSearch',
      debounce: 500,
    });
  }

  if (interactionTypes.includes('pagination')) {
    stateVariables.push({
      name: 'currentPage',
      type: 'number',
      initialValue: 1,
      description: 'Current page number',
    });
  }

  if (interactionTypes.includes('real-time-updates')) {
    stateVariables.push({
      name: 'realTimeEnabled',
      type: 'boolean',
      initialValue: false,
      description: 'Real-time updates enabled',
      persistent: true,
    });

    effects.push({
      name: 'realTimeUpdates',
      dependencies: ['realTimeEnabled'],
      action: 'setupRealTimeUpdates()',
      cleanup: 'clearInterval(realTimeInterval)',
    });
  }

  return {
    stateVariables,
    effects,
    eventHandlers,
  };
}

async function assembleInteractiveComponent(template: InteractiveTemplate, dataSchema?: any): Promise<string> {
  // Combine all template parts into a complete component
  let component = template.componentTemplate;

  // Add API client setup
  if (template.apiConnections.length > 0) {
    component = template.apiClientTemplate + '\n\n' + component;
  }

  // Add styles
  if (template.stylesTemplate) {
    component += '\n\n/* Styles */\n' + template.stylesTemplate;
  }

  // Add hooks
  if (template.hooksTemplate) {
    component += '\n\n/* Custom Hooks */\n' + template.hooksTemplate;
  }

  return component;
}

function calculateTemplateComplexity(template: InteractiveTemplate): 'low' | 'medium' | 'high' {
  let score = 0;

  score += template.interactionTypes.length * 2;
  score += template.apiConnections.length * 3;
  score += template.shadcnComponents.length;
  score += template.stateManagement.stateVariables.length;

  if (score <= 10) return 'low';
  if (score <= 20) return 'medium';
  return 'high';
}

function estimateComponentSize(template: InteractiveTemplate): number {
  // Rough estimation of component size in bytes
  let size = 5000; // Base component size

  size += template.interactionTypes.length * 1000; // Each interaction adds ~1KB
  size += template.apiConnections.length * 2000; // Each API connection adds ~2KB
  size += template.shadcnComponents.length * 500; // Each shadcn component adds ~0.5KB

  return size;
}

function getBuiltInTemplates(): InteractiveTemplate[] {
  return [
    {
      templateId: 'interactive-table',
      name: 'Interactive Data Table',
      description: 'Full-featured data table with search, sort, filter, and pagination',
      visualizationType: 'table',
      interactionTypes: ['data-refresh', 'filter-data', 'sort-data', 'search', 'pagination', 'export-data'],
      apiConnections: [],
      shadcnComponents: ['table', 'input', 'select', 'button', 'dropdown-menu', 'card'],
      stateManagement: {
        stateVariables: [],
        effects: [],
        eventHandlers: [],
      },
      componentTemplate: '',
      stylesTemplate: '',
      hooksTemplate: '',
      apiClientTemplate: '',
      fallbackTemplate: '',
    },
    {
      templateId: 'real-time-dashboard',
      name: 'Real-time Dashboard',
      description: 'Multi-panel dashboard with real-time updates and data mutations',
      visualizationType: 'dashboard',
      interactionTypes: ['data-refresh', 'real-time-updates', 'data-mutation', 'filter-data'],
      apiConnections: [],
      shadcnComponents: ['card', 'tabs', 'button', 'alert', 'badge'],
      stateManagement: {
        stateVariables: [],
        effects: [],
        eventHandlers: [],
      },
      componentTemplate: '',
      stylesTemplate: '',
      hooksTemplate: '',
      apiClientTemplate: '',
      fallbackTemplate: '',
    },
    // Add more built-in templates...
  ];
}

async function getCustomTemplates(sessionId: string, userContext: UserContext | AnonymousContext, filters: any): Promise<InteractiveTemplate[]> {
  try {
    const results = await biContextStore.searchContextMemories(sessionId, 'interactive-template', {
      userId: userContext.userId,
      category: 'interactive-template',
      topK: 50,
      similarityThreshold: 0.3,
    });

    return results
      .map(result => {
        try {
          return JSON.parse(result.content) as InteractiveTemplate;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(template =>
        (!filters.visualizationType || template.visualizationType === filters.visualizationType) &&
        (!filters.interactionType || template.interactionTypes.includes(filters.interactionType))
      );
  } catch (error) {
    rootLogger.error('Failed to get custom templates', {
      sessionId,
      error: (error as Error).message,
    });
    return [];
  }
}

async function findTemplate(sessionId: string, templateId: string): Promise<InteractiveTemplate | null> {
  try {
    // Check built-in templates first
    const builtIn = getBuiltInTemplates().find(t => t.templateId === templateId);
    if (builtIn) return builtIn;

    // Search user templates
    const results = await biContextStore.searchContextMemories(sessionId, templateId, {
      category: 'interactive-template',
      topK: 1,
      similarityThreshold: 0.9,
    });

    if (results.length > 0) {
      const template = JSON.parse(results[0].content) as InteractiveTemplate;
      if (template.templateId === templateId) {
        return template;
      }
    }

    return null;
  } catch (error) {
    rootLogger.error('Failed to find template', {
      sessionId,
      templateId,
      error: (error as Error).message,
    });
    return null;
  }
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const visualizationTemplateTools = [
  generateInteractiveTemplate,
  getAvailableTemplates,
  customizeTemplate,
];

// Export tool metadata for registration
export const visualizationTemplateToolsMetadata = {
  category: 'visualization-templates',
  description: 'Interactive visualization templates with API connectivity and shadcn-ui integration',
  totalTools: visualizationTemplateTools.length,
  capabilities: [
    'interactive_templates',
    'api_connectivity',
    'supabase_integration',
    'mcp_server_integration',
    'state_management',
    'real_time_updates',
    'data_mutations',
    'filtering_sorting',
    'pagination_search',
    'export_functionality',
    'responsive_design',
    'custom_styling',
    'brand_customization',
    'template_reuse',
    'fallback_handling',
  ],
};

rootLogger.info('Visualization template tools initialized', {
  totalTools: visualizationTemplateTools.length,
  capabilities: visualizationTemplateToolsMetadata.capabilities,
});