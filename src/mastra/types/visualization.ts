import { z } from 'zod';

/**
 * Visualization types for React TSX component generation
 */

// ============================================================================
// Base Visualization Types
// ============================================================================

export type VisualizationType =
  | 'bar-chart'
  | 'line-chart'
  | 'pie-chart'
  | 'table'
  | 'scatter-plot'
  | 'heatmap'
  | 'dashboard';

export type ColorScheme = 'default' | 'medical' | 'financial' | 'operational' | 'custom';
export type ComponentComplexity = 'low' | 'medium' | 'high';

// ============================================================================
// Data Structure Types
// ============================================================================

export interface DataSet {
  name: string;
  data: Record<string, any>[];
  domain?: 'clinical' | 'financial' | 'operational' | 'customer-service';
}

export interface DataSchema {
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

export interface DataRelationship {
  sourceField: string;
  targetDataset: string;
  targetField: string;
  relationshipType: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface AnalysisData {
  datasets: DataSet[];
  schema: DataSchema;
  metadata?: AnalysisMetadata;
  relationships?: DataRelationship[];
}

export interface AnalysisMetadata {
  queryText?: string;
  executionTime?: number;
  rowCount?: number;
  domains?: string[];
  generatedAt?: Date;
}

// ============================================================================
// Visualization Configuration Types
// ============================================================================

export interface VisualizationOptions {
  title?: string;
  width?: number;
  height?: number;
  interactive?: boolean;
  responsive?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  animations?: boolean;
}

export interface StylingOptions {
  colorScheme?: ColorScheme;
  customColors?: string[];
  fontFamily?: string;
  fontSize?: number;
  borderRadius?: number;
}

export interface VisualizationRequest {
  sessionId: string;
  visualizationType: VisualizationType;
  analysisData: AnalysisData;
  componentName: string;
  options?: VisualizationOptions;
  styling?: StylingOptions;
}

// ============================================================================
// Component Generation Types
// ============================================================================

export interface VisualizationArtifact {
  artifactId: string;
  sessionId: string;
  componentName: string;
  componentCode: string;
  typeDefinitions: string;
  styleDefinition: Record<string, any>;
  dataBinding: ComponentDataBinding;
  dependencies: string[];
  generationTime: Date;
  metadata: ComponentMetadata;
}

export interface ComponentDataBinding {
  propInterface: string;
  dataFields: DataFieldBinding[];
  eventHandlers: EventHandlerBinding[];
}

export interface DataFieldBinding {
  name: string;
  type: string;
  source: string;
  transformation?: string;
  validation?: string;
}

export interface EventHandlerBinding {
  event: string;
  handler: string;
  description: string;
}

export interface ComponentMetadata {
  linesOfCode: number;
  complexity: ComponentComplexity;
  dataBindings: string[];
  propInterface: string;
  exports: string[];
  dependencies: string[];
}

// ============================================================================
// Template System Types
// ============================================================================

export interface VisualizationTemplate {
  type: VisualizationType;
  name: string;
  description: string;
  requirements: TemplateRequirements;
  preview?: string; // Base64 encoded preview image
}

export interface TemplateRequirements {
  minFields: number;
  maxFields: number;
  requiredFieldTypes: string[];
  supportedDomains: string[];
  complexityLimit: ComponentComplexity;
}

// ============================================================================
// Generation Process Types
// ============================================================================

export interface GenerationRequest {
  templateType: VisualizationType;
  componentName: string;
  analysisData: AnalysisData;
  options: VisualizationOptions;
  styling: StylingOptions;
}

export interface GenerationResult {
  success: boolean;
  artifact?: VisualizationArtifact;
  error?: string;
  warnings?: string[];
  generationTime: number;
}

export interface ComponentPackage {
  component: string; // Main component file content
  types: string;     // TypeScript definitions
  readme: string;    // Usage instructions
  packageJson: string; // Package.json with dependencies
  example: string;   // Usage example
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationRequest {
  visualizationType: VisualizationType;
  analysisData: AnalysisData;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
  estimatedComplexity: ComponentComplexity;
}

// ============================================================================
// TSX Generation Specific Types
// ============================================================================

export interface TSXGenerationConfig {
  reactVersion: string;
  typeScriptVersion: string;
  useHooks: boolean;
  embedStyling: boolean;
  minimalDependencies: boolean;
}

export interface ComponentInterface {
  name: string;
  props: PropDefinition[];
  state?: StateDefinition[];
  methods?: MethodDefinition[];
}

export interface PropDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: any;
}

export interface StateDefinition {
  name: string;
  type: string;
  initialValue: any;
  description?: string;
}

export interface MethodDefinition {
  name: string;
  parameters: ParameterDefinition[];
  returnType: string;
  description?: string;
}

export interface ParameterDefinition {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

// ============================================================================
// AST Generation Types
// ============================================================================

export interface ASTGenerationContext {
  componentName: string;
  propsInterface: ComponentInterface;
  dataBindings: DataFieldBinding[];
  stylingConfig: StylingOptions;
  visualizationConfig: VisualizationOptions;
}

export interface GeneratedAST {
  componentAST: any; // Babel AST node
  typeAST: any;      // TypeScript AST node
  imports: ImportStatement[];
  exports: ExportStatement[];
}

export interface ImportStatement {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isType: boolean;
}

export interface ExportStatement {
  name: string;
  isDefault: boolean;
  isType: boolean;
}

// ============================================================================
// Validation Schemas (Zod)
// ============================================================================

export const VisualizationOptionsSchema = z.object({
  title: z.string().optional(),
  width: z.number().min(200).max(2000).optional(),
  height: z.number().min(150).max(1500).optional(),
  interactive: z.boolean().default(true),
  responsive: z.boolean().default(true),
  showLegend: z.boolean().default(true),
  showGrid: z.boolean().default(false),
  animations: z.boolean().default(false),
});

export const StylingOptionsSchema = z.object({
  colorScheme: z.enum(['default', 'medical', 'financial', 'operational', 'custom']).optional(),
  customColors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).optional(),
  fontFamily: z.string().default('system-ui, sans-serif'),
  fontSize: z.number().min(10).max(24).default(12),
  borderRadius: z.number().min(0).max(20).default(4),
});

export const DataSetSchema = z.object({
  name: z.string(),
  data: z.array(z.record(z.any())),
  domain: z.enum(['clinical', 'financial', 'operational', 'customer-service']).optional(),
});

export const FieldDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'date', 'array', 'object']),
  nullable: z.boolean(),
  description: z.string().optional(),
});

export const DataSchemaSchema = z.object({
  fields: z.array(FieldDefinitionSchema),
  primaryKey: z.string().optional(),
  indexes: z.array(z.string()),
});

export const AnalysisDataSchema = z.object({
  datasets: z.array(DataSetSchema),
  schema: DataSchemaSchema,
  metadata: z.object({
    queryText: z.string().optional(),
    executionTime: z.number().optional(),
    rowCount: z.number().optional(),
    domains: z.array(z.string()).optional(),
    generatedAt: z.date().optional(),
  }).optional(),
  relationships: z.array(z.object({
    sourceField: z.string(),
    targetDataset: z.string(),
    targetField: z.string(),
    relationshipType: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
  })).optional(),
});

export const VisualizationRequestSchema = z.object({
  sessionId: z.string().uuid(),
  visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']),
  analysisData: AnalysisDataSchema,
  componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/), // PascalCase validation
  options: VisualizationOptionsSchema.optional(),
  styling: StylingOptionsSchema.optional(),
});

export const ValidationRequestSchema = z.object({
  visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']),
  analysisData: AnalysisDataSchema,
});

// ============================================================================
// Constants
// ============================================================================

export const SUPPORTED_VISUALIZATION_TYPES: VisualizationType[] = [
  'bar-chart',
  'line-chart',
  'pie-chart',
  'table',
  'scatter-plot',
  'heatmap',
  'dashboard',
];

export const DEFAULT_VISUALIZATION_OPTIONS: VisualizationOptions = {
  width: 800,
  height: 600,
  interactive: true,
  responsive: true,
  showLegend: true,
  showGrid: false,
  animations: false,
};

export const DEFAULT_STYLING_OPTIONS: StylingOptions = {
  colorScheme: 'default',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  borderRadius: 4,
};

export const MAX_DATA_ROWS = 10000;
export const MAX_COMPONENT_COMPLEXITY: ComponentComplexity = 'high';
export const MIN_COMPONENT_NAME_LENGTH = 3;
export const MAX_COMPONENT_NAME_LENGTH = 50;

export const COLOR_SCHEMES: Record<ColorScheme, string[]> = {
  default: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'],
  medical: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#34495e'],
  financial: ['#27ae60', '#e74c3c', '#f39c12', '#3498db', '#9b59b6', '#95a5a6'],
  operational: ['#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6', '#34495e'],
  custom: [], // Will be populated from user input
};

export const REACT_DEPENDENCIES = [
  'react',
  '@types/react',
];

export const MINIMAL_DEPENDENCIES = [
  'react',
  '@types/react',
];

// ============================================================================
// Loader Pattern Architecture Types (NEW)
// ============================================================================

/**
 * Small loader artifact that gets sent to artifact renderers
 * Contains minimal TSX with runtime loader script
 */
export interface LoaderArtifact {
  artifactId: string;
  sessionId: string;
  componentName: string;
  loaderCode: string; // Small TSX with loader script
  apiEndpoint: string; // URL to fetch full component
  fallbackCode?: string; // Fallback if loading fails
  metadata: LoaderMetadata;
  generationTime: Date;
}

export interface LoaderMetadata {
  originalComponentSize: number; // Size of full component in bytes
  loadingStrategy: 'eager' | 'lazy';
  errorHandling: 'graceful' | 'strict';
  timeoutMs: number;
  retryCount: number;
  cachingEnabled: boolean;
}

/**
 * Full component stored server-side for runtime loading
 */
export interface ComponentRegistry {
  registryId: string;
  artifactId: string;
  componentName: string;
  fullComponentCode: string; // Complete TSX with shadcn-ui
  precompiledJS?: string; // Pre-compiled JavaScript
  typeDefinitions: string;
  shadcnComponents: ShadcnComponentSpec[];
  styleBundle: StyleBundle;
  dependencies: ComponentDependency[];
  version: string;
  expiryTime: Date;
}

export interface ShadcnComponentSpec {
  componentName: string; // e.g., 'Button', 'Card', 'Chart'
  version: string; // shadcn-ui canary version
  source: string; // Embedded component source
  styles: string; // Associated Tailwind/CSS
  dependencies: string[]; // Internal shadcn dependencies
}

export interface StyleBundle {
  tailwindCSS: string; // Complete Tailwind CSS
  customCSS: string; // Additional custom styles
  cssVariables: Record<string, string>; // CSS custom properties
  themeConfig: ShadcnTheme;
}

export interface ShadcnTheme {
  dark: boolean;
  radius: number;
  colors: {
    background: string;
    foreground: string;
    primary: string;
    secondary: string;
    accent: string;
    muted: string;
    border: string;
    [key: string]: string;
  };
}

export interface ComponentDependency {
  name: string;
  version: string;
  source: 'npm' | 'cdn' | 'embedded';
  url?: string; // CDN URL if applicable
  embedded?: string; // Embedded code if source is 'embedded'
}

/**
 * Runtime loading configuration
 */
export interface RuntimeLoaderConfig {
  baseUrl: string; // API base URL
  corsEnabled: boolean;
  loadingTimeout: number;
  maxRetries: number;
  fallbackStrategy: 'error' | 'placeholder' | 'minimal';
  cacheStrategy: 'memory' | 'localStorage' | 'none';
  errorReporting: boolean;
}

/**
 * Loader script template data
 */
export interface LoaderScriptData {
  componentName: string;
  apiEndpoint: string;
  fallbackComponent?: string;
  config: RuntimeLoaderConfig;
  shadcnTheme: ShadcnTheme;
  requiredComponents: string[]; // shadcn components needed
}

/**
 * API response for component loading
 */
export interface ComponentLoadResponse {
  success: boolean;
  component?: {
    code: string; // Full component code
    styles: string; // CSS bundle
    types: string; // TypeScript definitions
    shadcnComponents: ShadcnComponentSpec[];
  };
  error?: {
    code: string;
    message: string;
    fallback?: string;
  };
  metadata: {
    version: string;
    cacheHeaders: Record<string, string>;
    size: number;
  };
}

/**
 * Enhanced visualization artifact with loader pattern
 */
export interface EnhancedVisualizationArtifact extends VisualizationArtifact {
  // Original properties plus:
  loaderArtifact: LoaderArtifact; // Small artifact for renderers
  registryEntry: ComponentRegistry; // Full component for API
  renderingStrategy: 'loader' | 'embedded'; // How to deliver
  estimatedLoadTime: number; // Predicted load time
  compatibilityMode: 'modern' | 'legacy'; // Artifact renderer compatibility
}

// ============================================================================
// Shadcn-UI Integration Types
// ============================================================================

export type ShadcnComponent =
  | 'button' | 'card' | 'chart' | 'table' | 'badge' | 'avatar'
  | 'dialog' | 'dropdown-menu' | 'select' | 'input' | 'label'
  | 'tabs' | 'tooltip' | 'progress' | 'skeleton' | 'separator'
  | 'alert' | 'toast' | 'popover' | 'command' | 'calendar';

export interface ShadcnComponentConfig {
  component: ShadcnComponent;
  props: Record<string, any>;
  children?: ShadcnComponentConfig[];
  className?: string;
  variant?: string;
}

export interface ShadcnChartConfig {
  type: 'area' | 'bar' | 'line' | 'pie' | 'radar' | 'radial';
  data: any[];
  config: {
    [key: string]: {
      label: string;
      color?: string;
      theme?: {
        light: string;
        dark: string;
      };
    };
  };
  chartProps?: Record<string, any>;
}

// ============================================================================
// Template System Extensions for Loader Pattern
// ============================================================================

export interface LoaderTemplate {
  templateId: string;
  name: string;
  description: string;
  loaderScript: string; // Template for loader TSX
  supportedComponents: ShadcnComponent[];
  minimalFallback: string; // Fallback component code
  estimatedLoadTime: number;
  browserCompatibility: string[];
}

export interface TemplateGenerationContext {
  template: LoaderTemplate;
  componentName: string;
  apiEndpoint: string;
  themeConfig: ShadcnTheme;
  dataBindings: ComponentDataBinding;
  errorHandling: 'graceful' | 'strict';
}

// ============================================================================
// API Route Types for Component Serving
// ============================================================================

export interface ComponentServeRequest {
  artifactId: string;
  version?: string;
  theme?: 'light' | 'dark';
  format?: 'tsx' | 'js' | 'bundle';
  minify?: boolean;
}

export interface ComponentServeResponse {
  component: string;
  styles: string;
  types?: string;
  metadata: {
    size: number;
    version: string;
    lastModified: string;
    etag: string;
  };
  cacheControl: string;
}

// ============================================================================
// Validation Schemas for Loader Pattern
// ============================================================================

export const LoaderArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  sessionId: z.string().uuid(),
  componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
  loaderCode: z.string().min(100).max(5000), // Keep loaders small
  apiEndpoint: z.string().url(),
  fallbackCode: z.string().optional(),
  metadata: z.object({
    originalComponentSize: z.number().positive(),
    loadingStrategy: z.enum(['eager', 'lazy']),
    errorHandling: z.enum(['graceful', 'strict']),
    timeoutMs: z.number().min(1000).max(30000),
    retryCount: z.number().min(0).max(5),
    cachingEnabled: z.boolean(),
  }),
  generationTime: z.date(),
});

export const ComponentRegistrySchema = z.object({
  registryId: z.string().uuid(),
  artifactId: z.string().uuid(),
  componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
  fullComponentCode: z.string().min(500), // Full components are larger
  precompiledJS: z.string().optional(),
  typeDefinitions: z.string(),
  shadcnComponents: z.array(z.object({
    componentName: z.string(),
    version: z.string(),
    source: z.string(),
    styles: z.string(),
    dependencies: z.array(z.string()),
  })),
  styleBundle: z.object({
    tailwindCSS: z.string(),
    customCSS: z.string(),
    cssVariables: z.record(z.string()),
    themeConfig: z.object({
      dark: z.boolean(),
      radius: z.number(),
      colors: z.record(z.string()),
    }),
  }),
  dependencies: z.array(z.object({
    name: z.string(),
    version: z.string(),
    source: z.enum(['npm', 'cdn', 'embedded']),
    url: z.string().url().optional(),
    embedded: z.string().optional(),
  })),
  version: z.string(),
  expiryTime: z.date(),
});

export const ShadcnChartConfigSchema = z.object({
  type: z.enum(['area', 'bar', 'line', 'pie', 'radar', 'radial']),
  data: z.array(z.any()),
  config: z.record(z.object({
    label: z.string(),
    color: z.string().optional(),
    theme: z.object({
      light: z.string(),
      dark: z.string(),
    }).optional(),
  })),
  chartProps: z.record(z.any()).optional(),
});

// ============================================================================
// Constants for Loader Pattern
// ============================================================================

export const LOADER_CONSTANTS = {
  MAX_LOADER_SIZE: 5000, // bytes
  DEFAULT_TIMEOUT: 10000, // ms
  DEFAULT_RETRIES: 3,
  CACHE_DURATION: 3600000, // 1 hour in ms
  API_VERSION: 'v1',
} as const;

export const SHADCN_CANARY_VERSION = '0.0.0-canary';

export const DEFAULT_SHADCN_THEME: ShadcnTheme = {
  dark: false,
  radius: 0.5,
  colors: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(240 10% 3.9%)',
    primary: 'hsl(240 5.9% 10%)',
    secondary: 'hsl(240 4.8% 95.9%)',
    accent: 'hsl(240 4.8% 95.9%)',
    muted: 'hsl(240 4.8% 95.9%)',
    border: 'hsl(240 5.9% 90%)',
  },
};

export const SUPPORTED_SHADCN_COMPONENTS: ShadcnComponent[] = [
  'button', 'card', 'chart', 'table', 'badge', 'avatar',
  'dialog', 'dropdown-menu', 'select', 'input', 'label',
  'tabs', 'tooltip', 'progress', 'skeleton', 'separator',
  'alert', 'toast', 'popover', 'command', 'calendar'
];

// Default CORS configuration for component serving
export const DEFAULT_CORS_CONFIG = {
  origins: ['*'], // Allow all origins for artifact renderers
  methods: ['GET', 'OPTIONS'],
  headers: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false,
  maxAge: 86400, // 24 hours
} as const;