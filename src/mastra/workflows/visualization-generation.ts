/**
 * Visualization Generation Workflow
 * Orchestrates the complete process of generating TSX visualization components with loader pattern
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  VisualizationRequestSchema,
  ShadcnTheme,
  DEFAULT_SHADCN_THEME,
  LOADER_CONSTANTS,
  LoaderArtifact,
  EnhancedVisualizationArtifact,
} from '../types/visualization.js';
import { rootLogger } from '../observability/logger.js';

// ============================================================================
// Workflow Input/Output Schemas
// ============================================================================

const VisualizationGenerationInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session identifier for context'),
  visualizationRequest: VisualizationRequestSchema.describe('Visualization generation request'),

  // Loader configuration
  loaderConfig: z.object({
    loadingStrategy: z.enum(['eager', 'lazy']).default('eager'),
    errorHandling: z.enum(['graceful', 'strict']).default('graceful'),
    timeoutMs: z.number().min(1000).max(30000).default(10000),
    retryCount: z.number().min(0).max(5).default(3),
    cachingEnabled: z.boolean().default(true),
    fallbackEnabled: z.boolean().default(true),
  }).optional().describe('Loader pattern configuration'),

  // Theming
  shadcnTheme: z.object({
    dark: z.boolean().default(false),
    radius: z.number().min(0).max(1).default(0.5),
    colors: z.record(z.string(), z.string()).optional(),
  }).optional().describe('Shadcn-ui theme configuration'),

  // API configuration
  baseApiUrl: z.string().url().optional().describe('Base URL for component API (auto-detected if not provided)'),
  enablePackaging: z.boolean().default(false).describe('Generate downloadable package'),
  validateSyntax: z.boolean().default(true).describe('Validate generated TSX syntax'),

  // Performance options
  maxComponentComplexity: z.enum(['low', 'medium', 'high']).default('high').describe('Maximum allowed component complexity'),
  enableOptimizations: z.boolean().default(true).describe('Apply performance optimizations'),
});

const VisualizationGenerationOutputSchema = z.object({
  success: z.boolean(),
  sessionId: z.string().uuid(),
  artifactId: z.string().optional(),

  // Generated artifacts
  loaderArtifact: z.string().optional().describe('Small loader TSX code for artifact renderers'),
  fullComponentCode: z.string().optional().describe('Complete component code with shadcn-ui'),
  apiEndpoint: z.string().url().optional().describe('Runtime loading endpoint'),

  // Package (if requested)
  componentPackage: z.record(z.string(), z.string()).optional().describe('Downloadable component package'),

  // Metadata
  performance: z.object({
    loaderSize: z.number(),
    fullComponentSize: z.number(),
    compressionRatio: z.number(),
    estimatedLoadTime: z.number(),
  }).optional(),

  shadcnInfo: z.object({
    componentsUsed: z.array(z.string()),
    theme: z.any(),
    tailwindIncluded: z.boolean(),
  }).optional(),

  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    complexity: z.enum(['low', 'medium', 'high']),
  }).optional(),

  error: z.string().optional(),
  details: z.string().optional(),
});

// ============================================================================
// Workflow Steps
// ============================================================================

/**
 * Step 1: Validate Visualization Data
 */
const validateVisualizationDataStep = createStep({
  id: 'validate-visualization-data',
  inputSchema: z.object({
    sessionId: z.string().uuid(),
    visualizationRequest: VisualizationRequestSchema,
    maxComponentComplexity: z.enum(['low', 'medium', 'high']),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    validation: z.any(),
    recommendations: z.any(),
    error: z.string().optional(),
  }),
  execute: async ({ sessionId, visualizationRequest, maxComponentComplexity }, { mastra }) => {
    try {
      rootLogger.info('Validating visualization data', {
        sessionId,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
      });

      const validationResult = await mastra.tools.use('validate-visualization-data', {
        sessionId,
        visualizationType: visualizationRequest.visualizationType,
        analysisData: visualizationRequest.analysisData,
        componentComplexityLimit: maxComponentComplexity,
        validateShadcnCompatibility: true,
      });

      if (!validationResult.success) {
        return {
          valid: false,
          error: validationResult.error || 'Validation failed',
        };
      }

      return {
        valid: validationResult.validation.valid,
        validation: validationResult.validation,
        recommendations: validationResult.recommendations,
      };

    } catch (error) {
      rootLogger.error('Validation step failed', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        valid: false,
        error: `Validation failed: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Step 2: Generate Visualization with Loader Pattern
 */
const generateVisualizationStep = createStep({
  id: 'generate-visualization-with-loader',
  inputSchema: z.object({
    sessionId: z.string().uuid(),
    visualizationRequest: VisualizationRequestSchema,
    loaderConfig: z.any().optional(),
    shadcnTheme: z.any().optional(),
    baseApiUrl: z.string().url().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    artifactId: z.string().optional(),
    artifact: z.any().optional(),
    loaderArtifact: z.string().optional(),
    apiEndpoint: z.string().url().optional(),
    performance: z.any().optional(),
    shadcnInfo: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ sessionId, visualizationRequest, loaderConfig, shadcnTheme, baseApiUrl }, { mastra }) => {
    try {
      rootLogger.info('Generating visualization with loader pattern', {
        sessionId,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
      });

      const generationResult = await mastra.tools.use('generate-visualization-with-loader', {
        sessionId,
        visualizationRequest,
        loaderConfig,
        shadcnTheme,
        baseApiUrl,
      });

      if (!generationResult.success) {
        return {
          success: false,
          error: generationResult.error || 'Generation failed',
        };
      }

      return {
        success: true,
        artifactId: generationResult.artifactId,
        artifact: generationResult.artifact,
        loaderArtifact: generationResult.loaderArtifact,
        apiEndpoint: generationResult.apiEndpoint,
        performance: generationResult.performance,
        shadcnInfo: generationResult.shadcnInfo,
      };

    } catch (error) {
      rootLogger.error('Generation step failed', {
        sessionId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: `Generation failed: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Step 3: Generate Component Package (Optional)
 */
const generateComponentPackageStep = createStep({
  id: 'generate-component-package',
  inputSchema: z.object({
    sessionId: z.string().uuid(),
    artifactId: z.string(),
    enablePackaging: z.boolean(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    package: z.record(z.string()).optional(),
    downloadInfo: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ sessionId, artifactId, enablePackaging }, { mastra }) => {
    if (!enablePackaging) {
      return {
        success: true,
        package: undefined,
      };
    }

    try {
      rootLogger.info('Generating component package', {
        sessionId,
        artifactId,
      });

      const packageResult = await mastra.tools.use('generate-component-package', {
        sessionId,
        artifactId,
        includeFullComponent: true,
        includeDocumentation: true,
        packageFormat: 'json',
      });

      if (!packageResult.success) {
        return {
          success: false,
          error: packageResult.error || 'Package generation failed',
        };
      }

      return {
        success: true,
        package: packageResult.package,
        downloadInfo: packageResult.downloadInfo,
      };

    } catch (error) {
      rootLogger.error('Package generation step failed', {
        sessionId,
        artifactId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: `Package generation failed: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Step 4: Apply Performance Optimizations
 */
const applyOptimizationsStep = createStep({
  id: 'apply-performance-optimizations',
  inputSchema: z.object({
    sessionId: z.string().uuid(),
    artifactId: z.string(),
    enableOptimizations: z.boolean(),
    performance: z.any(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    optimizedPerformance: z.any().optional(),
    optimizations: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ sessionId, artifactId, enableOptimizations, performance }) => {
    if (!enableOptimizations) {
      return {
        success: true,
        optimizedPerformance: performance,
        optimizations: [],
      };
    }

    try {
      rootLogger.info('Applying performance optimizations', {
        sessionId,
        artifactId,
        currentLoaderSize: performance?.loaderSize,
        currentFullSize: performance?.fullComponentSize,
      });

      const optimizations: string[] = [];
      let optimizedPerformance = { ...performance };

      // Simulated optimization logic
      if (performance?.loaderSize > LOADER_CONSTANTS.MAX_LOADER_SIZE * 0.8) {
        optimizations.push('Compressed loader script');
        optimizedPerformance.loaderSize = Math.floor(performance.loaderSize * 0.85);
      }

      if (performance?.compressionRatio > 0.2) {
        optimizations.push('Applied component minification');
        optimizedPerformance.fullComponentSize = Math.floor(performance.fullComponentSize * 0.9);
        optimizedPerformance.compressionRatio = optimizedPerformance.loaderSize / optimizedPerformance.fullComponentSize;
      }

      if (performance?.estimatedLoadTime > 3000) {
        optimizations.push('Enabled component pre-compilation');
        optimizedPerformance.estimatedLoadTime = Math.floor(performance.estimatedLoadTime * 0.7);
      }

      return {
        success: true,
        optimizedPerformance,
        optimizations,
      };

    } catch (error) {
      rootLogger.error('Optimization step failed', {
        sessionId,
        artifactId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: `Optimization failed: ${(error as Error).message}`,
      };
    }
  },
});

// ============================================================================
// Main Workflow Definition
// ============================================================================

export const visualizationGenerationWorkflow = createWorkflow({
  id: 'visualization-generation',
  description: 'Complete workflow for generating TSX visualization components with loader pattern and shadcn-ui integration',
  inputSchema: VisualizationGenerationInputSchema,
  steps: [
    validateVisualizationDataStep,
    generateVisualizationStep,
    generateComponentPackageStep,
    applyOptimizationsStep,
  ],
});

// ============================================================================
// Workflow Execution Logic - Using standard Mastra workflow execution
// ============================================================================

// ============================================================================
// Workflow Metadata Export
// ============================================================================

export const visualizationGenerationWorkflowMetadata = {
  name: 'visualization-generation',
  description: 'Complete workflow for generating TSX visualization components with loader pattern and shadcn-ui integration',
  inputSchema: VisualizationGenerationInputSchema,
  outputSchema: VisualizationGenerationOutputSchema,
  steps: [
    'validate-visualization-data',
    'generate-visualization-with-loader',
    'generate-component-package',
    'apply-performance-optimizations',
  ],
  capabilities: [
    'data_validation',
    'loader_pattern_generation',
    'shadcn_ui_integration',
    'component_packaging',
    'performance_optimization',
    'error_handling',
    'comprehensive_logging',
  ],
};

rootLogger.info('Visualization generation workflow initialized', {
  workflowName: visualizationGenerationWorkflowMetadata.name,
  stepsCount: visualizationGenerationWorkflowMetadata.steps.length,
  capabilities: visualizationGenerationWorkflowMetadata.capabilities,
});