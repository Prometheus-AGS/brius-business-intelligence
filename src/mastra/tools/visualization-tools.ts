/**
 * Visualization Tools - TSX Component Generation with Loader Pattern
 * Generates small loader artifacts that dynamically load full shadcn-ui components at runtime
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  VisualizationRequest,
  VisualizationArtifact,
  LoaderArtifact,
  ComponentRegistry,
  EnhancedVisualizationArtifact,
  ShadcnTheme,
  ShadcnComponent,
  ShadcnChartConfig,
  RuntimeLoaderConfig,
  LoaderTemplate,
  ComponentLoadResponse,
  VisualizationRequestSchema,
  LoaderArtifactSchema,
  ComponentRegistrySchema,
  DEFAULT_SHADCN_THEME,
  SUPPORTED_SHADCN_COMPONENTS,
  LOADER_CONSTANTS,
  DEFAULT_CORS_CONFIG,
} from '../types/visualization.js';
import {
  UserContext,
  AnonymousContext,
} from '../types/context.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Visualization Generation Tools
// ============================================================================

/**
 * Generate Visualization with Loader Pattern
 */
export const generateVisualizationWithLoader = new Tool({
  id: 'generate-visualization-with-loader',
  description: 'Generate small loader artifact that dynamically loads full shadcn-ui component at runtime',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    visualizationRequest: VisualizationRequestSchema.describe('Visualization generation request'),
    loaderConfig: z.object({
      loadingStrategy: z.enum(['eager', 'lazy']).default('eager'),
      errorHandling: z.enum(['graceful', 'strict']).default('graceful'),
      timeoutMs: z.number().min(1000).max(30000).default(10000),
      retryCount: z.number().min(0).max(5).default(3),
      cachingEnabled: z.boolean().default(true),
      fallbackEnabled: z.boolean().default(true),
    }).optional(),
    shadcnTheme: z.object({
      dark: z.boolean().default(false),
      radius: z.number().min(0).max(1).default(0.5),
      colors: z.record(z.string()).optional(),
    }).optional(),
    baseApiUrl: z.string().url().optional().describe('Base URL for component API (auto-detected if not provided)'),
  }),
  execute: async ({ sessionId, visualizationRequest, loaderConfig, shadcnTheme, baseApiUrl }, context) => {
    try {
      rootLogger.info('Generating visualization with loader pattern', {
        sessionId,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
        loadingStrategy: loaderConfig?.loadingStrategy || 'eager',
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const config = {
        loadingStrategy: 'eager',
        errorHandling: 'graceful',
        timeoutMs: 10000,
        retryCount: 3,
        cachingEnabled: true,
        fallbackEnabled: true,
        ...loaderConfig,
      };

      const theme = {
        ...DEFAULT_SHADCN_THEME,
        ...shadcnTheme,
      };

      const artifactId = `artifact_${sessionId}_${Date.now()}`;
      const registryId = `registry_${sessionId}_${Date.now()}`;

      // Generate full shadcn-ui component first
      const fullComponent = await generateFullShadcnComponent(
        visualizationRequest,
        theme,
        artifactId
      );

      // Create component registry entry
      const registryEntry: ComponentRegistry = {
        registryId,
        artifactId,
        componentName: visualizationRequest.componentName,
        fullComponentCode: fullComponent.code,
        precompiledJS: fullComponent.compiled,
        typeDefinitions: fullComponent.types,
        shadcnComponents: fullComponent.shadcnComponents,
        styleBundle: fullComponent.styleBundle,
        dependencies: fullComponent.dependencies,
        version: '1.0.0',
        expiryTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };

      // Generate small loader artifact
      const apiEndpoint = baseApiUrl
        ? `${baseApiUrl}/api/v1/components/${artifactId}`
        : `http://localhost:4111/api/v1/components/${artifactId}`;

      const loaderArtifact = await generateLoaderArtifact(
        visualizationRequest,
        apiEndpoint,
        config,
        theme,
        artifactId,
        fullComponent
      );

      // Create enhanced visualization artifact
      const enhancedArtifact: EnhancedVisualizationArtifact = {
        // Original VisualizationArtifact properties
        artifactId,
        sessionId,
        componentName: visualizationRequest.componentName,
        componentCode: loaderArtifact.loaderCode, // Small loader code
        typeDefinitions: fullComponent.types,
        styleDefinition: fullComponent.styleBundle.themeConfig,
        dataBinding: {
          propInterface: fullComponent.propInterface,
          dataFields: generateDataFieldBindings(visualizationRequest.analysisData),
          eventHandlers: generateEventHandlerBindings(visualizationRequest.visualizationType),
        },
        dependencies: fullComponent.dependencies.map(d => d.name),
        generationTime: new Date(),
        metadata: {
          linesOfCode: fullComponent.code.split('\n').length,
          complexity: calculateComponentComplexity(visualizationRequest),
          dataBindings: generateDataFieldBindings(visualizationRequest.analysisData).map(d => d.name),
          propInterface: fullComponent.propInterface,
          exports: [visualizationRequest.componentName],
          dependencies: fullComponent.dependencies.map(d => d.name),
        },
        // Enhanced properties
        loaderArtifact,
        registryEntry,
        renderingStrategy: 'loader',
        estimatedLoadTime: calculateEstimatedLoadTime(registryEntry),
        compatibilityMode: 'modern',
      };

      // Store registry entry
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(registryEntry), {
        userId: userContext.userId,
        category: 'component-registry',
        domains: [],
        scope: 'session',
        metadata: {
          registryId,
          artifactId,
          componentName: visualizationRequest.componentName,
          componentSize: registryEntry.fullComponentCode.length,
          shadcnComponentsCount: registryEntry.shadcnComponents.length,
        },
      });

      // Store enhanced artifact
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(enhancedArtifact), {
        userId: userContext.userId,
        category: 'visualization-artifact',
        domains: [],
        scope: 'session',
        metadata: {
          artifactId,
          componentName: visualizationRequest.componentName,
          visualizationType: visualizationRequest.visualizationType,
          renderingStrategy: 'loader',
          loaderSize: loaderArtifact.loaderCode.length,
          fullComponentSize: registryEntry.fullComponentCode.length,
        },
      });

      // Trace visualization generation
      await biContextTracer.traceMemoryOperation(sessionId, 'visualization_generation', {
        artifactId,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
        renderingStrategy: 'loader',
        loaderSize: loaderArtifact.loaderCode.length,
        fullComponentSize: registryEntry.fullComponentCode.length,
        shadcnComponentsUsed: registryEntry.shadcnComponents.length,
      });

      return {
        success: true,
        sessionId,
        artifactId,
        artifact: enhancedArtifact,
        loaderArtifact: loaderArtifact.loaderCode, // This is what gets sent to artifact renderers
        apiEndpoint,
        performance: {
          loaderSize: loaderArtifact.loaderCode.length,
          fullComponentSize: registryEntry.fullComponentCode.length,
          compressionRatio: loaderArtifact.loaderCode.length / registryEntry.fullComponentCode.length,
          estimatedLoadTime: enhancedArtifact.estimatedLoadTime,
        },
        shadcnInfo: {
          componentsUsed: registryEntry.shadcnComponents.map(c => c.componentName),
          theme: theme,
          tailwindIncluded: true,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to generate visualization with loader', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to generate visualization with loader',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Generate Component Package for Download
 */
export const generateComponentPackage = new Tool({
  id: 'generate-component-package',
  description: 'Generate downloadable component package with all dependencies and documentation',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    artifactId: z.string().uuid().describe('Artifact ID to package'),
    includeFullComponent: z.boolean().default(true).describe('Include full component code (not just loader)'),
    includeDocumentation: z.boolean().default(true).describe('Include usage documentation'),
    packageFormat: z.enum(['zip', 'tar', 'json']).default('json').describe('Package format'),
  }),
  execute: async ({ sessionId, artifactId, includeFullComponent, includeDocumentation, packageFormat }, context) => {
    try {
      rootLogger.info('Generating component package', {
        sessionId,
        artifactId,
        includeFullComponent,
        packageFormat,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve enhanced artifact
      const artifactResults = await biContextStore.searchContextMemories(sessionId, artifactId, {
        userId: userContext.userId,
        category: 'visualization-artifact',
        topK: 1,
        similarityThreshold: 0.8,
      });

      if (artifactResults.length === 0) {
        return {
          success: false,
          error: 'Visualization artifact not found',
          artifactId,
          sessionId,
        };
      }

      const artifact = JSON.parse(artifactResults[0].content) as EnhancedVisualizationArtifact;

      // Generate package contents
      const packageContents = await createComponentPackage(
        artifact,
        includeFullComponent,
        includeDocumentation
      );

      // Trace package generation
      await biContextTracer.traceMemoryOperation(sessionId, 'component_package_generation', {
        artifactId,
        packageFormat,
        includeFullComponent,
        packageSize: JSON.stringify(packageContents).length,
        filesIncluded: Object.keys(packageContents).length,
      });

      return {
        success: true,
        sessionId,
        artifactId,
        package: packageContents,
        downloadInfo: {
          format: packageFormat,
          totalSize: JSON.stringify(packageContents).length,
          filesIncluded: Object.keys(packageContents).length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to generate component package', {
        sessionId,
        artifactId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to generate component package',
        details: (error as Error).message,
        sessionId,
        artifactId,
      };
    }
  },
});

/**
 * Validate Visualization Data
 */
export const validateVisualizationData = new Tool({
  id: 'validate-visualization-data',
  description: 'Validate analysis data compatibility with visualization types and component generation',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']),
    analysisData: z.any().describe('Analysis data to validate'),
    componentComplexityLimit: z.enum(['low', 'medium', 'high']).default('high').describe('Maximum allowed component complexity'),
    validateShadcnCompatibility: z.boolean().default(true).describe('Validate shadcn-ui component compatibility'),
  }),
  execute: async ({ sessionId, visualizationType, analysisData, componentComplexityLimit, validateShadcnCompatibility }, context) => {
    try {
      rootLogger.info('Validating visualization data', {
        sessionId,
        visualizationType,
        datasetCount: analysisData.datasets?.length || 0,
        complexityLimit: componentComplexityLimit,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const validation = {
        valid: true,
        errors: [] as string[],
        warnings: [] as string[],
        suggestions: [] as string[],
        estimatedComplexity: 'low' as 'low' | 'medium' | 'high',
        shadcnCompatibility: { compatible: true, issues: [] as string[] },
      };

      // Validate data structure
      const dataValidation = validateDataStructure(analysisData, visualizationType);
      validation.errors.push(...dataValidation.errors);
      validation.warnings.push(...dataValidation.warnings);
      validation.estimatedComplexity = dataValidation.complexity;

      // Validate component complexity
      if (exceedsComplexityLimit(dataValidation.complexity, componentComplexityLimit)) {
        validation.errors.push(`Component complexity (${dataValidation.complexity}) exceeds limit (${componentComplexityLimit})`);
        validation.valid = false;
      }

      // Validate shadcn-ui compatibility
      if (validateShadcnCompatibility) {
        const shadcnValidation = validateShadcnComponentCompatibility(visualizationType, analysisData);
        validation.shadcnCompatibility = shadcnValidation;
        if (!shadcnValidation.compatible) {
          validation.errors.push(...shadcnValidation.issues);
          validation.valid = false;
        }
      }

      // Generate suggestions
      validation.suggestions.push(...generateOptimizationSuggestions(analysisData, visualizationType));

      // Store validation results
      const validationRecord = {
        sessionId,
        visualizationType,
        validation,
        timestamp: new Date().toISOString(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(validationRecord), {
        userId: userContext.userId,
        category: 'visualization-validation',
        domains: [],
        scope: 'session',
        metadata: {
          visualizationType,
          valid: validation.valid,
          complexity: validation.estimatedComplexity,
          errorCount: validation.errors.length,
        },
      });

      return {
        success: true,
        sessionId,
        validation,
        recommendations: {
          canProceed: validation.valid,
          optimizations: validation.suggestions,
          alternativeTypes: validation.valid ? [] : suggestAlternativeVisualizations(analysisData),
        },
      };

    } catch (error) {
      rootLogger.error('Failed to validate visualization data', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to validate visualization data',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

// ============================================================================
// Helper Functions for Component Generation
// ============================================================================

async function generateFullShadcnComponent(
  request: VisualizationRequest,
  theme: ShadcnTheme,
  artifactId: string
) {
  const { componentName, visualizationType, analysisData, options, styling } = request;

  // Determine required shadcn components based on visualization type
  const requiredComponents = getRequiredShadcnComponents(visualizationType);

  // Generate shadcn component specifications
  const shadcnComponents = await generateShadcnComponentSpecs(requiredComponents, theme);

  // Generate the full component code
  const componentCode = generateFullComponentCode({
    componentName,
    visualizationType,
    analysisData,
    options,
    styling,
    shadcnComponents,
    theme,
  });

  // Generate TypeScript definitions
  const typeDefinitions = generateTypeDefinitions(componentName, analysisData);

  // Generate prop interface
  const propInterface = generatePropInterface(componentName, analysisData);

  // Create style bundle
  const styleBundle = createStyleBundle(theme, styling);

  // Determine dependencies
  const dependencies = createDependencyList(shadcnComponents);

  // Compile to JavaScript (simulated - in production would use actual compilation)
  const compiledJS = await compileToJavaScript(componentCode);

  return {
    code: componentCode,
    compiled: compiledJS,
    types: typeDefinitions,
    propInterface,
    shadcnComponents,
    styleBundle,
    dependencies,
  };
}

function getRequiredShadcnComponents(visualizationType: string): ShadcnComponent[] {
  const componentMap: Record<string, ShadcnComponent[]> = {
    'bar-chart': ['card', 'chart'],
    'line-chart': ['card', 'chart'],
    'pie-chart': ['card', 'chart'],
    'table': ['table', 'card', 'badge'],
    'scatter-plot': ['card', 'chart'],
    'heatmap': ['card', 'chart', 'tooltip'],
    'dashboard': ['card', 'tabs', 'chart', 'table', 'badge', 'separator'],
  };

  return componentMap[visualizationType] || ['card'];
}

async function generateShadcnComponentSpecs(
  components: ShadcnComponent[],
  theme: ShadcnTheme
): Promise<Array<{ componentName: string; version: string; source: string; styles: string; dependencies: string[] }>> {
  const specs = [];

  for (const component of components) {
    const spec = await getShadcnComponentSource(component, theme);
    specs.push(spec);
  }

  return specs;
}

async function getShadcnComponentSource(component: ShadcnComponent, theme: ShadcnTheme) {
  // Embedded shadcn-ui component sources (simplified - in production would fetch from registry)
  const componentSources: Record<ShadcnComponent, string> = {
    card: `
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-sm",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
`,
    chart: `
"use client"

import * as React from "react"
import { TrendingUp } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export interface ChartProps {
  data: any[]
  config: Record<string, { label: string; color?: string }>
  type: 'area' | 'bar' | 'line' | 'pie'
  className?: string
  [key: string]: any
}

export const Chart = React.forwardRef<HTMLDivElement, ChartProps>(
  ({ data, config, type, className, ...props }, ref) => {
    const ChartComponent = {
      area: AreaChart,
      bar: BarChart,
      line: LineChart,
      pie: PieChart,
    }[type]

    return (
      <Card ref={ref} className={className}>
        <CardContent className="p-6">
          <ChartContainer config={config}>
            <ResponsiveContainer width="100%" height={350}>
              <ChartComponent data={data} {...props}>
                {type !== 'pie' && <CartesianGrid vertical={false} />}
                {type !== 'pie' && <XAxis dataKey="name" tickLine={false} tickMargin={10} axisLine={false} />}
                {type !== 'pie' && <YAxis />}
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dashed" />} />
                {Object.entries(config).map(([key, { color }]) => {
                  const Component = type === 'area' ? Area : type === 'bar' ? Bar : type === 'line' ? Line : null
                  return Component ? (
                    <Component
                      key={key}
                      dataKey={key}
                      type="natural"
                      fill={color}
                      stroke={color}
                      strokeWidth={2}
                    />
                  ) : null
                })}
              </ChartComponent>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    )
  }
)
Chart.displayName = "Chart"
`,
    table: `
import * as React from "react"
import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
}
`,
    // Minimal implementations for other components
    button: 'export const Button = ({ children, ...props }) => <button className="px-4 py-2 rounded bg-primary text-primary-foreground" {...props}>{children}</button>',
    badge: 'export const Badge = ({ children, variant = "default", ...props }) => <span className="inline-flex px-2 py-1 rounded text-xs font-medium" {...props}>{children}</span>',
    tooltip: 'export const Tooltip = ({ children }) => <div className="relative group">{children}</div>',
    tabs: 'export const Tabs = ({ children }) => <div className="w-full">{children}</div>',
    separator: 'export const Separator = () => <hr className="border-border" />',
    // Add other components as needed...
    avatar: '',
    dialog: '',
    'dropdown-menu': '',
    select: '',
    input: '',
    label: '',
    progress: '',
    skeleton: '',
    alert: '',
    toast: '',
    popover: '',
    command: '',
    calendar: '',
  };

  return {
    componentName: component,
    version: LOADER_CONSTANTS.API_VERSION,
    source: componentSources[component] || `export const ${component} = () => null;`,
    styles: generateShadcnStyles(component, theme),
    dependencies: getShadcnDependencies(component),
  };
}

function generateShadcnStyles(component: ShadcnComponent, theme: ShadcnTheme): string {
  // Generate Tailwind CSS classes and CSS variables for the theme
  const cssVariables = Object.entries(theme.colors)
    .map(([key, value]) => `  --${key}: ${value};`)
    .join('\n');

  return `
:root {
${cssVariables}
  --radius: ${theme.radius}rem;
}

.dark {
${cssVariables}
}

/* Component-specific styles for ${component} */
.${component}-theme {
  --primary: ${theme.colors.primary};
  --secondary: ${theme.colors.secondary};
  --background: ${theme.colors.background};
  --foreground: ${theme.colors.foreground};
}
`;
}

function getShadcnDependencies(component: ShadcnComponent): string[] {
  const dependencyMap: Record<ShadcnComponent, string[]> = {
    card: ['@radix-ui/react-slot'],
    chart: ['recharts', 'lucide-react'],
    table: ['@radix-ui/react-slot'],
    button: ['@radix-ui/react-slot'],
    badge: [],
    tooltip: ['@radix-ui/react-tooltip'],
    tabs: ['@radix-ui/react-tabs'],
    separator: ['@radix-ui/react-separator'],
    // Add other component dependencies...
    avatar: ['@radix-ui/react-avatar'],
    dialog: ['@radix-ui/react-dialog'],
    'dropdown-menu': ['@radix-ui/react-dropdown-menu'],
    select: ['@radix-ui/react-select'],
    input: [],
    label: ['@radix-ui/react-label'],
    progress: ['@radix-ui/react-progress'],
    skeleton: [],
    alert: [],
    toast: ['@radix-ui/react-toast'],
    popover: ['@radix-ui/react-popover'],
    command: ['cmdk'],
    calendar: ['react-day-picker'],
  };

  return dependencyMap[component] || [];
}

function generateFullComponentCode(params: {
  componentName: string;
  visualizationType: string;
  analysisData: any;
  options?: any;
  styling?: any;
  shadcnComponents: any[];
  theme: ShadcnTheme;
}): string {
  const { componentName, visualizationType, analysisData, options, styling, shadcnComponents, theme } = params;

  // Generate imports for required shadcn components
  const imports = shadcnComponents
    .map(comp => `// ${comp.componentName} component embedded`)
    .join('\n');

  // Generate the main component based on visualization type
  const componentBody = generateVisualizationComponent(visualizationType, analysisData, options, styling);

  return `
import * as React from 'react';

${imports}

// Embedded shadcn-ui components
${shadcnComponents.map(comp => comp.source).join('\n\n')}

// Utility function
function cn(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

// Theme CSS (embedded)
const ThemeStyles = () => (
  <style jsx>{\`
    :root {
      ${Object.entries(theme.colors).map(([key, value]) => `--${key}: ${value};`).join('\n      ')}
      --radius: ${theme.radius}rem;
    }

    .chart-container {
      width: 100%;
      height: 100%;
    }

    /* Additional component styles */
    .visualization-container {
      padding: 1rem;
      border-radius: var(--radius);
      background: var(--background);
      color: var(--foreground);
      border: 1px solid var(--border);
    }
  \`}</style>
);

// Main visualization component
${componentBody}

export default ${componentName};
`.trim();
}

function generateVisualizationComponent(
  visualizationType: string,
  analysisData: any,
  options?: any,
  styling?: any
): string {
  const componentTemplates: Record<string, string> = {
    'bar-chart': `
export const {{componentName}} = ({ data = [], ...props }) => {
  const chartConfig = {
    ${analysisData.datasets?.[0]?.data?.[0] ? Object.keys(analysisData.datasets[0].data[0]).slice(1, 4).map(key =>
      `${key}: { label: "${key}", color: "hsl(var(--primary))" }`
    ).join(',\n    ') : ''}
  };

  return (
    <>
      <ThemeStyles />
      <div className="visualization-container">
        <Card>
          <CardHeader>
            <CardTitle>${options?.title || 'Bar Chart'}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart data={data} width={${options?.width || 800}} height={${options?.height || 400}}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                {Object.keys(chartConfig).map(key => (
                  <Bar key={key} dataKey={key} fill={chartConfig[key].color} />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </>
  );
};`,
    'line-chart': `
export const {{componentName}} = ({ data = [], ...props }) => {
  const chartConfig = {
    ${analysisData.datasets?.[0]?.data?.[0] ? Object.keys(analysisData.datasets[0].data[0]).slice(1, 4).map(key =>
      `${key}: { label: "${key}", color: "hsl(var(--primary))" }`
    ).join(',\n    ') : ''}
  };

  return (
    <>
      <ThemeStyles />
      <div className="visualization-container">
        <Card>
          <CardHeader>
            <CardTitle>${options?.title || 'Line Chart'}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <LineChart data={data} width={${options?.width || 800}} height={${options?.height || 400}}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                {Object.keys(chartConfig).map(key => (
                  <Line key={key} type="monotone" dataKey={key} stroke={chartConfig[key].color} />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </>
  );
};`,
    'table': `
export const {{componentName}} = ({ data = [], ...props }) => {
  const columns = data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <>
      <ThemeStyles />
      <div className="visualization-container">
        <Card>
          <CardHeader>
            <CardTitle>${options?.title || 'Data Table'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map(column => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row, index) => (
                  <TableRow key={index}>
                    {columns.map(column => (
                      <TableCell key={column}>{row[column]}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
};`,
    'dashboard': `
export const {{componentName}} = ({ data = [], ...props }) => {
  return (
    <>
      <ThemeStyles />
      <div className="visualization-container">
        <Card>
          <CardHeader>
            <CardTitle>${options?.title || 'Dashboard'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="overview">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Dashboard widgets would go here */}
                <Card>
                  <CardContent className="p-6">
                    <div className="text-2xl font-bold">
                      {data.length}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total Records
                    </p>
                  </CardContent>
                </Card>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </>
  );
};`,
  };

  const template = componentTemplates[visualizationType] || componentTemplates['bar-chart'];
  return template.replace(/\{\{componentName\}\}/g, '{{componentName}}');
}

async function generateLoaderArtifact(
  request: VisualizationRequest,
  apiEndpoint: string,
  config: any,
  theme: ShadcnTheme,
  artifactId: string,
  fullComponent: any
): Promise<LoaderArtifact> {

  const loaderCode = generateLoaderScript({
    componentName: request.componentName,
    apiEndpoint,
    fallbackComponent: config.fallbackEnabled ? generateFallbackComponent(request) : undefined,
    config: {
      baseUrl: apiEndpoint.split('/api/')[0],
      corsEnabled: true,
      loadingTimeout: config.timeoutMs,
      maxRetries: config.retryCount,
      fallbackStrategy: config.errorHandling === 'graceful' ? 'placeholder' : 'error',
      cacheStrategy: config.cachingEnabled ? 'localStorage' : 'none',
      errorReporting: true,
    },
    shadcnTheme: theme,
    requiredComponents: getRequiredShadcnComponents(request.visualizationType),
  });

  return {
    artifactId,
    sessionId: request.sessionId,
    componentName: request.componentName,
    loaderCode,
    apiEndpoint,
    fallbackCode: config.fallbackEnabled ? generateFallbackComponent(request) : undefined,
    metadata: {
      originalComponentSize: fullComponent.code.length,
      loadingStrategy: config.loadingStrategy,
      errorHandling: config.errorHandling,
      timeoutMs: config.timeoutMs,
      retryCount: config.retryCount,
      cachingEnabled: config.cachingEnabled,
    },
    generationTime: new Date(),
  };
}

function generateLoaderScript(data: {
  componentName: string;
  apiEndpoint: string;
  fallbackComponent?: string;
  config: RuntimeLoaderConfig;
  shadcnTheme: ShadcnTheme;
  requiredComponents: ShadcnComponent[];
}): string {
  return `
import React, { useState, useEffect } from 'react';

const ${data.componentName} = ({ data = [], ...props }) => {
  const [Component, setComponent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadComponent = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check cache first
        if ('${data.config.cacheStrategy}' === 'localStorage') {
          const cached = localStorage.getItem('component-${data.componentName}');
          if (cached) {
            const { component, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < ${LOADER_CONSTANTS.CACHE_DURATION}) {
              const ComponentFromCache = new Function('React', component);
              setComponent(() => ComponentFromCache(React));
              setLoading(false);
              return;
            }
          }
        }

        // Load component from API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ${data.config.loadingTimeout});

        const response = await fetch('${data.apiEndpoint}', {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }

        const result = await response.json();

        if (result.success && result.component) {
          // Inject styles
          if (result.component.styles) {
            const styleElement = document.createElement('style');
            styleElement.textContent = result.component.styles;
            document.head.appendChild(styleElement);
          }

          // Create component from code
          const ComponentFunction = new Function(
            'React',
            'useState',
            'useEffect',
            \`return \${result.component.code}\`
          );

          const LoadedComponent = ComponentFunction(React, useState, useEffect);
          setComponent(() => LoadedComponent);

          // Cache if enabled
          if ('${data.config.cacheStrategy}' === 'localStorage') {
            localStorage.setItem('component-${data.componentName}', JSON.stringify({
              component: result.component.code,
              timestamp: Date.now(),
            }));
          }
        } else {
          throw new Error(result.error?.message || 'Component loading failed');
        }

      } catch (err) {
        console.error('Component loading error:', err);
        setError(err.message);

        // Use fallback if available
        ${data.fallbackComponent ? `
        if ('${data.config.fallbackStrategy}' === 'placeholder') {
          const FallbackComponent = () => (
            <div style={{
              padding: '20px',
              border: '2px dashed #ccc',
              borderRadius: '8px',
              textAlign: 'center',
              color: '#666'
            }}>
              <h3>Visualization Loading...</h3>
              <p>Component failed to load: {err.message}</p>
              <p>Using fallback display</p>
            </div>
          );
          setComponent(() => FallbackComponent);
        }
        ` : ''}
      } finally {
        setLoading(false);
      }
    };

    loadComponent();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div style={{
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        background: '${data.shadcnTheme.colors.background}',
        color: '${data.shadcnTheme.colors.foreground}',
        border: '1px solid ${data.shadcnTheme.colors.border}',
        borderRadius: '${data.shadcnTheme.radius}rem'
      }}>
        <div style={{
          width: '20px',
          height: '20px',
          border: '2px solid ${data.shadcnTheme.colors.primary}',
          borderTop: '2px solid transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginRight: '10px'
        }}></div>
        <span>Loading ${data.componentName}...</span>
        <style jsx>{\`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        \`}</style>
      </div>
    );
  }

  // Error state
  if (error && !Component) {
    return (
      <div style={{
        padding: '20px',
        border: '2px solid #ef4444',
        borderRadius: '8px',
        background: '#fef2f2',
        color: '#dc2626',
        textAlign: 'center'
      }}>
        <h3>Failed to Load ${data.componentName}</h3>
        <p>{error}</p>
        <p style={{ fontSize: '12px', marginTop: '10px' }}>
          API Endpoint: ${data.apiEndpoint}
        </p>
      </div>
    );
  }

  // Render loaded component
  if (Component) {
    return <Component data={data} {...props} />;
  }

  // Final fallback
  return (
    <div style={{
      padding: '20px',
      border: '1px solid #ccc',
      borderRadius: '8px',
      textAlign: 'center',
      color: '#666'
    }}>
      <p>Component not available</p>
    </div>
  );
};

export default ${data.componentName};
`.trim();
}

function generateFallbackComponent(request: VisualizationRequest): string {
  return `
const FallbackComponent = ({ data = [], ...props }) => (
  <div style={{
    padding: '20px',
    border: '2px dashed #ccc',
    borderRadius: '8px',
    textAlign: 'center',
    minHeight: '300px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  }}>
    <h3>${request.options?.title || request.componentName}</h3>
    <p>Visualization: ${request.visualizationType}</p>
    <p>Data points: {data.length}</p>
    <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
      <small>Component loading failed - showing fallback</small>
    </div>
  </div>
);
`;
}

function generateTypeDefinitions(componentName: string, analysisData: any): string {
  const dataTypes = analysisData.datasets?.[0]?.data?.[0]
    ? Object.entries(analysisData.datasets[0].data[0])
        .map(([key, value]) => `  ${key}: ${typeof value};`)
        .join('\n')
    : '  [key: string]: any;';

  return `
export interface ${componentName}Props {
  data?: Array<{
${dataTypes}
  }>;
  className?: string;
  style?: React.CSSProperties;
}

export interface ${componentName}Data {
${dataTypes}
}

export default ${componentName};
`;
}

function generatePropInterface(componentName: string, analysisData: any): string {
  return `${componentName}Props`;
}

function createStyleBundle(theme: ShadcnTheme, styling?: any): any {
  return {
    tailwindCSS: generateTailwindCSS(theme),
    customCSS: generateCustomCSS(styling),
    cssVariables: theme.colors,
    themeConfig: theme,
  };
}

function generateTailwindCSS(theme: ShadcnTheme): string {
  return `
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    ${Object.entries(theme.colors).map(([key, value]) => `--${key}: ${value};`).join('\n    ')}
    --radius: ${theme.radius}rem;
  }
}

@layer components {
  .chart-container {
    @apply w-full h-full;
  }

  .visualization-container {
    @apply p-4 rounded-lg bg-background text-foreground border border-border;
  }
}
`;
}

function generateCustomCSS(styling?: any): string {
  if (!styling) return '';

  return `
/* Custom styling overrides */
.custom-visualization {
  ${styling.fontFamily ? `font-family: ${styling.fontFamily};` : ''}
  ${styling.fontSize ? `font-size: ${styling.fontSize}px;` : ''}
  ${styling.borderRadius ? `border-radius: ${styling.borderRadius}px;` : ''}
}
`;
}

function createDependencyList(shadcnComponents: any[]): any[] {
  const baseDependencies = [
    { name: 'react', version: '^18.0.0', source: 'npm' as const },
    { name: '@types/react', version: '^18.0.0', source: 'npm' as const },
  ];

  const shadcnDependencies = shadcnComponents.flatMap(comp =>
    comp.dependencies.map((dep: string) => ({
      name: dep,
      version: 'latest',
      source: 'npm' as const,
    }))
  );

  return [...baseDependencies, ...shadcnDependencies];
}

async function compileToJavaScript(tsxCode: string): Promise<string> {
  // Simulated TypeScript compilation
  // In production, this would use actual TypeScript compiler API
  return tsxCode
    .replace(/interface \w+[^}]*}/g, '') // Remove interfaces
    .replace(/: \w+(\[\])?/g, '') // Remove type annotations
    .replace(/import.*from.*';/g, '') // Remove imports (they'll be injected)
    .replace(/export default /g, '');
}

async function createComponentPackage(
  artifact: EnhancedVisualizationArtifact,
  includeFullComponent: boolean,
  includeDocumentation: boolean
) {
  const pkg = {
    component: includeFullComponent ? artifact.registryEntry.fullComponentCode : artifact.loaderArtifact.loaderCode,
    types: artifact.typeDefinitions,
    readme: includeDocumentation ? generateReadme(artifact) : '',
    packageJson: generatePackageJson(artifact),
    example: generateUsageExample(artifact),
  };

  if (includeFullComponent) {
    pkg['styles'] = artifact.registryEntry.styleBundle.tailwindCSS;
    pkg['theme'] = JSON.stringify(artifact.registryEntry.styleBundle.themeConfig, null, 2);
  }

  return pkg;
}

function generateReadme(artifact: EnhancedVisualizationArtifact): string {
  return `
# ${artifact.componentName}

Generated visualization component with shadcn-ui integration.

## Usage

\`\`\`tsx
import ${artifact.componentName} from './${artifact.componentName}';

const data = [
  // Your data here
];

export default function App() {
  return <${artifact.componentName} data={data} />;
}
\`\`\`

## Props

See \`${artifact.componentName}.d.ts\` for TypeScript definitions.

## Loading Strategy

This component uses a ${artifact.renderingStrategy} pattern:
- Loader artifact size: ${artifact.loaderArtifact.loaderCode.length} bytes
- Full component size: ${artifact.registryEntry.fullComponentCode.length} bytes
- Estimated load time: ${artifact.estimatedLoadTime}ms

## Shadcn-UI Components Used

${artifact.registryEntry.shadcnComponents.map(c => `- ${c.componentName}`).join('\n')}

## Dependencies

${artifact.dependencies.map(d => `- ${d}`).join('\n')}

Generated on ${artifact.generationTime.toISOString()}
`;
}

function generatePackageJson(artifact: EnhancedVisualizationArtifact): string {
  const dependencies = artifact.registryEntry.dependencies.reduce((acc, dep) => {
    acc[dep.name] = dep.version;
    return acc;
  }, {} as Record<string, string>);

  return JSON.stringify({
    name: artifact.componentName.toLowerCase(),
    version: "1.0.0",
    description: `Generated ${artifact.componentName} visualization component`,
    main: `${artifact.componentName}.tsx`,
    types: `${artifact.componentName}.d.ts`,
    dependencies,
    peerDependencies: {
      react: "^18.0.0",
      "@types/react": "^18.0.0"
    }
  }, null, 2);
}

function generateUsageExample(artifact: EnhancedVisualizationArtifact): string {
  return `
import React from 'react';
import ${artifact.componentName} from './${artifact.componentName}';

// Sample data for your component
const sampleData = [
  ${artifact.loaderArtifact.metadata.originalComponentSize > 0 ? '// Add your data here' : ''}
];

export default function Example() {
  return (
    <div style={{ padding: '20px' }}>
      <h1>${artifact.componentName} Example</h1>
      <${artifact.componentName}
        data={sampleData}
        ${artifact.renderingStrategy === 'loader' ? '// Component will load dynamically' : ''}
      />
    </div>
  );
}
`;
}

// ============================================================================
// Utility Functions
// ============================================================================

function validateDataStructure(analysisData: any, visualizationType: string) {
  const validation = {
    errors: [] as string[],
    warnings: [] as string[],
    complexity: 'low' as 'low' | 'medium' | 'high',
  };

  // Basic data structure validation
  if (!analysisData.datasets || analysisData.datasets.length === 0) {
    validation.errors.push('No datasets provided for visualization');
    return validation;
  }

  const dataset = analysisData.datasets[0];
  if (!dataset.data || dataset.data.length === 0) {
    validation.errors.push('Dataset contains no data rows');
    return validation;
  }

  // Complexity assessment
  const rowCount = dataset.data.length;
  const fieldCount = Object.keys(dataset.data[0] || {}).length;

  if (rowCount > 1000 || fieldCount > 20) {
    validation.complexity = 'high';
  } else if (rowCount > 100 || fieldCount > 10) {
    validation.complexity = 'medium';
  }

  // Visualization-specific validation
  switch (visualizationType) {
    case 'pie-chart':
      if (fieldCount < 2) {
        validation.errors.push('Pie chart requires at least 2 fields (label and value)');
      }
      break;
    case 'scatter-plot':
      if (fieldCount < 2) {
        validation.errors.push('Scatter plot requires at least 2 numeric fields (x and y)');
      }
      break;
    case 'heatmap':
      if (fieldCount < 3) {
        validation.errors.push('Heatmap requires at least 3 fields (x, y, and value)');
      }
      break;
  }

  return validation;
}

function exceedsComplexityLimit(complexity: 'low' | 'medium' | 'high', limit: 'low' | 'medium' | 'high'): boolean {
  const complexityLevels = { low: 1, medium: 2, high: 3 };
  return complexityLevels[complexity] > complexityLevels[limit];
}

function validateShadcnComponentCompatibility(visualizationType: string, analysisData: any) {
  const requiredComponents = getRequiredShadcnComponents(visualizationType);
  const issues: string[] = [];

  // Check if all required shadcn components are supported
  for (const component of requiredComponents) {
    if (!SUPPORTED_SHADCN_COMPONENTS.includes(component)) {
      issues.push(`Shadcn component '${component}' not supported in current version`);
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
    requiredComponents,
  };
}

function calculateComponentComplexity(request: VisualizationRequest): 'low' | 'medium' | 'high' {
  const dataset = request.analysisData.datasets[0];
  if (!dataset) return 'low';

  const rowCount = dataset.data.length;
  const fieldCount = Object.keys(dataset.data[0] || {}).length;
  const hasInteractivity = request.options?.interactive;
  const isResponsive = request.options?.responsive;

  let score = 0;
  if (rowCount > 1000) score += 3;
  else if (rowCount > 100) score += 2;
  else score += 1;

  if (fieldCount > 10) score += 3;
  else if (fieldCount > 5) score += 2;
  else score += 1;

  if (hasInteractivity) score += 2;
  if (isResponsive) score += 1;

  if (score >= 8) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

function calculateEstimatedLoadTime(registry: ComponentRegistry): number {
  const baseTime = 500; // Base loading time
  const sizeTime = registry.fullComponentCode.length / 1000; // 1ms per 1KB
  const componentTime = registry.shadcnComponents.length * 100; // 100ms per component

  return Math.round(baseTime + sizeTime + componentTime);
}

function generateDataFieldBindings(analysisData: any) {
  if (!analysisData.datasets?.[0]?.data?.[0]) return [];

  return Object.entries(analysisData.datasets[0].data[0]).map(([key, value]) => ({
    name: key,
    type: typeof value,
    source: 'data',
    transformation: '',
    validation: `typeof value === '${typeof value}'`,
  }));
}

function generateEventHandlerBindings(visualizationType: string) {
  const handlers = [];

  switch (visualizationType) {
    case 'table':
      handlers.push({
        event: 'onRowClick',
        handler: '(row) => console.log("Row clicked:", row)',
        description: 'Handle table row click events',
      });
      break;
    case 'bar-chart':
    case 'line-chart':
      handlers.push({
        event: 'onDataPointClick',
        handler: '(dataPoint) => console.log("Data point clicked:", dataPoint)',
        description: 'Handle chart data point click events',
      });
      break;
  }

  return handlers;
}

function generateOptimizationSuggestions(analysisData: any, visualizationType: string): string[] {
  const suggestions: string[] = [];

  const dataset = analysisData.datasets?.[0];
  if (dataset?.data?.length > 1000) {
    suggestions.push('Consider data pagination for large datasets');
    suggestions.push('Enable lazy loading for better performance');
  }

  if (visualizationType === 'table' && dataset?.data?.length > 100) {
    suggestions.push('Add virtual scrolling for large tables');
  }

  if (visualizationType === 'dashboard') {
    suggestions.push('Consider breaking dashboard into separate components');
  }

  return suggestions;
}

function suggestAlternativeVisualizations(analysisData: any): string[] {
  const dataset = analysisData.datasets?.[0];
  if (!dataset?.data?.[0]) return [];

  const fieldCount = Object.keys(dataset.data[0]).length;
  const rowCount = dataset.data.length;

  const alternatives: string[] = [];

  if (rowCount > 1000) {
    alternatives.push('table'); // Better for large datasets
  }

  if (fieldCount <= 2) {
    alternatives.push('bar-chart', 'line-chart');
  }

  if (fieldCount >= 3) {
    alternatives.push('scatter-plot', 'heatmap');
  }

  return alternatives;
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const visualizationTools = [
  generateVisualizationWithLoader,
  generateComponentPackage,
  validateVisualizationData,
];

// Export tool metadata for registration
export const visualizationToolsMetadata = {
  category: 'visualization',
  description: 'TSX component generation with loader pattern and shadcn-ui integration',
  totalTools: visualizationTools.length,
  capabilities: [
    'loader_pattern_generation',
    'shadcn_ui_integration',
    'self_contained_components',
    'artifact_renderer_compatible',
    'runtime_component_loading',
    'embedded_styling',
    'fallback_handling',
    'component_packaging',
    'data_validation',
  ],
};

rootLogger.info('Visualization tools initialized', {
  totalTools: visualizationTools.length,
  capabilities: visualizationToolsMetadata.capabilities,
});