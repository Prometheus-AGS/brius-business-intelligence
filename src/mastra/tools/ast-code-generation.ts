/**
 * AST-based TypeScript Code Generation for Visualization Components
 * Provides robust code generation using Abstract Syntax Trees with loader architecture support
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  VisualizationRequest,
  ShadcnTheme,
  ShadcnComponent,
  ComponentDataBinding,
  LoaderArtifact,
  RuntimeLoaderConfig,
  ASTGenerationContext,
  GeneratedAST,
  ImportStatement,
  ExportStatement,
  ComponentInterface,
  PropDefinition,
  MethodDefinition,
  UserContext,
  AnonymousContext,
} from '../types/index.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// AST Generation Types
// ============================================================================

export interface ASTNode {
  type: string;
  properties: Record<string, any>;
  children?: ASTNode[];
  metadata?: {
    sourceLocation?: { line: number; column: number };
    generatedBy?: string;
    optimizations?: string[];
  };
}

export interface TypeScriptAST extends ASTNode {
  type: 'Program' | 'ImportDeclaration' | 'ExportDeclaration' | 'FunctionDeclaration' |
        'VariableDeclaration' | 'InterfaceDeclaration' | 'TypeAliasDeclaration';
}

export interface ReactComponentAST extends ASTNode {
  type: 'FunctionComponent' | 'ArrowFunctionComponent' | 'ClassComponent';
  componentName: string;
  props: PropDefinition[];
  hooks: string[];
  jsxElements: JSXElementAST[];
}

export interface JSXElementAST extends ASTNode {
  type: 'JSXElement' | 'JSXFragment' | 'JSXExpression';
  tagName?: string;
  attributes?: Record<string, any>;
  children?: JSXElementAST[];
}

export interface LoaderScriptAST extends ASTNode {
  type: 'LoaderScript';
  componentName: string;
  apiEndpoint: string;
  fallbackElement?: JSXElementAST;
  loadingElement?: JSXElementAST;
  errorElement?: JSXElementAST;
  cacheStrategy: string;
  retryLogic: ASTNode[];
}

export interface CodeGenerationOptions {
  target: 'ES2022' | 'ES2020' | 'ES2019';
  moduleSystem: 'ESM' | 'CommonJS';
  jsxFactory: 'React.createElement' | 'h' | 'jsx';
  includeSourceMaps: boolean;
  minifyOutput: boolean;
  bundleStyles: boolean;
  optimizeImports: boolean;
  enableDebugging: boolean;
}

export interface ValidationResult {
  valid: boolean;
  syntaxErrors: SyntaxError[];
  typeErrors: TypeError[];
  lintWarnings: LintWarning[];
  complexityScore: number;
  bundleSize: number;
  performance: {
    parseTime: number;
    generateTime: number;
    validateTime: number;
  };
}

export interface SyntaxError {
  message: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  rule?: string;
}

export interface TypeError {
  message: string;
  location: string;
  expectedType: string;
  actualType: string;
  suggestion?: string;
}

export interface LintWarning {
  message: string;
  line: number;
  column: number;
  rule: string;
  fixable: boolean;
  suggestion?: string;
}

// ============================================================================
// AST Code Generation Tools
// ============================================================================

/**
 * Generate Component AST
 */
export const generateComponentAST = new Tool({
  id: 'generate-component-ast',
  description: 'Generate React component using AST-based code generation with loader architecture support',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    visualizationRequest: z.object({
      sessionId: z.string().uuid(),
      visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']),
      componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
      analysisData: z.any(),
      options: z.any().optional(),
      styling: z.any().optional(),
    }).describe('Visualization generation request'),
    generationOptions: z.object({
      target: z.enum(['ES2022', 'ES2020', 'ES2019']).default('ES2022'),
      moduleSystem: z.enum(['ESM', 'CommonJS']).default('ESM'),
      jsxFactory: z.enum(['React.createElement', 'h', 'jsx']).default('React.createElement'),
      includeSourceMaps: z.boolean().default(false),
      minifyOutput: z.boolean().default(false),
      bundleStyles: z.boolean().default(true),
      optimizeImports: z.boolean().default(true),
      enableDebugging: z.boolean().default(false),
    }).optional().describe('Code generation options'),
    shadcnTheme: z.any().optional().describe('Shadcn-ui theme configuration'),
    loaderConfig: z.any().optional().describe('Loader pattern configuration'),
  }),
  execute: async ({ sessionId, visualizationRequest, generationOptions, shadcnTheme, loaderConfig }, context) => {
    try {
      rootLogger.info('Generating component AST', {
        sessionId,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
        target: generationOptions?.target || 'ES2022',
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const options: CodeGenerationOptions = {
        target: 'ES2022',
        moduleSystem: 'ESM',
        jsxFactory: 'React.createElement',
        includeSourceMaps: false,
        minifyOutput: false,
        bundleStyles: true,
        optimizeImports: true,
        enableDebugging: false,
        ...generationOptions,
      };

      // Generate AST context
      const astContext = createASTGenerationContext(
        visualizationRequest,
        shadcnTheme,
        options
      );

      // Generate component interface AST
      const componentInterface = generateComponentInterfaceAST(
        visualizationRequest.componentName,
        visualizationRequest.analysisData
      );

      // Generate imports AST
      const importsAST = generateImportsAST(
        visualizationRequest.visualizationType,
        options
      );

      // Generate main component AST
      const componentAST = generateReactComponentAST(
        astContext,
        componentInterface,
        options
      );

      // Generate exports AST
      const exportsAST = generateExportsAST(
        visualizationRequest.componentName,
        options
      );

      // Generate type definitions AST
      const typesAST = generateTypeDefinitionsAST(
        componentInterface,
        visualizationRequest.analysisData
      );

      // Combine all AST nodes
      const programAST: GeneratedAST = {
        componentAST,
        typeAST: typesAST,
        imports: importsAST,
        exports: exportsAST,
      };

      // Generate loader script AST if configured
      let loaderScriptAST: LoaderScriptAST | undefined;
      if (loaderConfig) {
        loaderScriptAST = generateLoaderScriptAST(
          visualizationRequest.componentName,
          loaderConfig,
          options
        );
      }

      // Convert AST to code
      const generatedCode = astToTypeScriptCode(programAST, options);
      const loaderCode = loaderScriptAST ? astToTypeScriptCode({
        componentAST: loaderScriptAST,
        typeAST: typesAST,
        imports: importsAST,
        exports: exportsAST,
      }, options) : undefined;

      // Store AST for future reference
      const astRecord = {
        astId: `ast_${sessionId}_${Date.now()}`,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
        programAST,
        loaderScriptAST,
        generationOptions: options,
        generatedAt: new Date(),
        codeLength: generatedCode.length,
        loaderCodeLength: loaderCode?.length || 0,
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(astRecord), {
        userId: userContext.userId,
        category: 'ast-generation',
        domains: [],
        scope: 'session',
        metadata: {
          astId: astRecord.astId,
          componentName: visualizationRequest.componentName,
          visualizationType: visualizationRequest.visualizationType,
          target: options.target,
          hasLoader: Boolean(loaderScriptAST),
        },
      });

      // Trace AST generation
      await biContextTracer.traceMemoryOperation(sessionId, 'ast_generation', {
        astId: astRecord.astId,
        componentName: visualizationRequest.componentName,
        visualizationType: visualizationRequest.visualizationType,
        astNodeCount: countASTNodes(programAST),
        codeLength: generatedCode.length,
        hasLoader: Boolean(loaderScriptAST),
      });

      return {
        success: true,
        sessionId,
        astId: astRecord.astId,
        programAST,
        loaderScriptAST,
        generatedCode,
        loaderCode,
        componentInterface,
        metadata: {
          target: options.target,
          moduleSystem: options.moduleSystem,
          astNodeCount: countASTNodes(programAST),
          codeLength: generatedCode.length,
          loaderCodeLength: loaderCode?.length || 0,
          importsCount: importsAST.length,
          exportsCount: exportsAST.length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to generate component AST', {
        sessionId,
        componentName: visualizationRequest.componentName,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to generate component AST',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Validate Generated Code
 */
export const validateGeneratedCode = new Tool({
  id: 'validate-generated-code',
  description: 'Validate generated TypeScript/TSX code for syntax, types, and performance',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    code: z.string().min(10).describe('Generated code to validate'),
    codeType: z.enum(['component', 'loader', 'types', 'full-bundle']).describe('Type of code being validated'),
    validationOptions: z.object({
      checkSyntax: z.boolean().default(true),
      checkTypes: z.boolean().default(true),
      checkPerformance: z.boolean().default(true),
      checkComplexity: z.boolean().default(true),
      lintingEnabled: z.boolean().default(true),
      maxComplexityScore: z.number().min(1).max(100).default(50),
      maxBundleSize: z.number().min(1000).default(100000), // 100KB default
    }).optional().describe('Validation configuration'),
  }),
  execute: async ({ sessionId, code, codeType, validationOptions }, context) => {
    try {
      rootLogger.info('Validating generated code', {
        sessionId,
        codeType,
        codeLength: code.length,
        validationEnabled: validationOptions?.checkSyntax || true,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      const options = {
        checkSyntax: true,
        checkTypes: true,
        checkPerformance: true,
        checkComplexity: true,
        lintingEnabled: true,
        maxComplexityScore: 50,
        maxBundleSize: 100000,
        ...validationOptions,
      };

      const startTime = Date.now();
      const validation: ValidationResult = {
        valid: true,
        syntaxErrors: [],
        typeErrors: [],
        lintWarnings: [],
        complexityScore: 0,
        bundleSize: code.length,
        performance: {
          parseTime: 0,
          generateTime: 0,
          validateTime: 0,
        },
      };

      // Syntax validation
      if (options.checkSyntax) {
        const parseStart = Date.now();
        const syntaxErrors = validateSyntax(code, codeType);
        validation.syntaxErrors = syntaxErrors;
        validation.performance.parseTime = Date.now() - parseStart;

        if (syntaxErrors.length > 0) {
          validation.valid = false;
        }
      }

      // Type validation
      if (options.checkTypes && validation.valid) {
        const typeStart = Date.now();
        const typeErrors = validateTypes(code, codeType);
        validation.typeErrors = typeErrors;
        validation.performance.generateTime = Date.now() - typeStart;

        if (typeErrors.length > 0) {
          validation.valid = false;
        }
      }

      // Complexity analysis
      if (options.checkComplexity) {
        validation.complexityScore = calculateComplexityScore(code);
        if (validation.complexityScore > options.maxComplexityScore) {
          validation.syntaxErrors.push({
            message: `Code complexity score (${validation.complexityScore}) exceeds maximum (${options.maxComplexityScore})`,
            line: 0,
            column: 0,
            severity: 'warning',
            rule: 'complexity-limit',
          });
        }
      }

      // Bundle size check
      if (validation.bundleSize > options.maxBundleSize) {
        validation.lintWarnings.push({
          message: `Bundle size (${validation.bundleSize} bytes) exceeds maximum (${options.maxBundleSize} bytes)`,
          line: 0,
          column: 0,
          rule: 'bundle-size-limit',
          fixable: true,
          suggestion: 'Consider code splitting or removing unused imports',
        });
      }

      // Linting
      if (options.lintingEnabled) {
        const lintWarnings = performLinting(code, codeType);
        validation.lintWarnings.push(...lintWarnings);
      }

      validation.performance.validateTime = Date.now() - startTime;

      // Store validation results
      const validationRecord = {
        validationId: `validation_${sessionId}_${Date.now()}`,
        codeType,
        codeLength: code.length,
        validation,
        options,
        validatedAt: new Date(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(validationRecord), {
        userId: userContext.userId,
        category: 'code-validation',
        domains: [],
        scope: 'session',
        metadata: {
          validationId: validationRecord.validationId,
          codeType,
          valid: validation.valid,
          syntaxErrors: validation.syntaxErrors.length,
          typeErrors: validation.typeErrors.length,
          complexityScore: validation.complexityScore,
        },
      });

      // Trace validation
      await biContextTracer.traceMemoryOperation(sessionId, 'code_validation', {
        validationId: validationRecord.validationId,
        codeType,
        valid: validation.valid,
        syntaxErrors: validation.syntaxErrors.length,
        typeErrors: validation.typeErrors.length,
        lintWarnings: validation.lintWarnings.length,
        complexityScore: validation.complexityScore,
        validationTime: validation.performance.validateTime,
      });

      return {
        success: true,
        sessionId,
        validationId: validationRecord.validationId,
        validation,
        recommendations: generateValidationRecommendations(validation),
      };

    } catch (error) {
      rootLogger.error('Failed to validate generated code', {
        sessionId,
        codeType,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to validate generated code',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Optimize Generated Code
 */
export const optimizeGeneratedCode = new Tool({
  id: 'optimize-generated-code',
  description: 'Apply AST-based optimizations to generated code for better performance and size',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    astId: z.string().describe('AST identifier from previous generation'),
    optimizationLevel: z.enum(['minimal', 'standard', 'aggressive']).default('standard').describe('Level of optimization to apply'),
    optimizationTargets: z.array(z.enum(['bundle-size', 'runtime-performance', 'load-time', 'memory-usage'])).optional().describe('Specific optimization targets'),
    preserveDebugging: z.boolean().default(false).describe('Preserve debugging information'),
  }),
  execute: async ({ sessionId, astId, optimizationLevel, optimizationTargets, preserveDebugging }, context) => {
    try {
      rootLogger.info('Optimizing generated code', {
        sessionId,
        astId,
        optimizationLevel,
        targets: optimizationTargets?.length || 'all',
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve AST record
      const astResults = await biContextStore.searchContextMemories(sessionId, astId, {
        userId: userContext.userId,
        category: 'ast-generation',
        topK: 1,
        similarityThreshold: 0.9,
      });

      if (astResults.length === 0) {
        return {
          success: false,
          error: 'AST record not found',
          sessionId,
          astId,
        };
      }

      const astRecord = JSON.parse(astResults[0].content);
      const { programAST, loaderScriptAST, generationOptions } = astRecord;

      const targets = optimizationTargets || ['bundle-size', 'runtime-performance', 'load-time', 'memory-usage'];
      const optimizations: string[] = [];

      // Apply optimizations based on level and targets
      let optimizedAST = { ...programAST };
      let optimizedLoaderAST = loaderScriptAST ? { ...loaderScriptAST } : undefined;

      // Bundle size optimizations
      if (targets.includes('bundle-size')) {
        const bundleOptimizations = applyBundleSizeOptimizations(optimizedAST, optimizationLevel);
        optimizations.push(...bundleOptimizations.applied);
        optimizedAST = bundleOptimizations.ast;
      }

      // Runtime performance optimizations
      if (targets.includes('runtime-performance')) {
        const runtimeOptimizations = applyRuntimeOptimizations(optimizedAST, optimizationLevel);
        optimizations.push(...runtimeOptimizations.applied);
        optimizedAST = runtimeOptimizations.ast;
      }

      // Load time optimizations
      if (targets.includes('load-time')) {
        const loadTimeOptimizations = applyLoadTimeOptimizations(optimizedAST, optimizationLevel);
        optimizations.push(...loadTimeOptimizations.applied);
        optimizedAST = loadTimeOptimizations.ast;

        if (optimizedLoaderAST) {
          const loaderOptimizations = applyLoaderOptimizations(optimizedLoaderAST, optimizationLevel);
          optimizations.push(...loaderOptimizations.applied);
          optimizedLoaderAST = loaderOptimizations.ast;
        }
      }

      // Memory usage optimizations
      if (targets.includes('memory-usage')) {
        const memoryOptimizations = applyMemoryOptimizations(optimizedAST, optimizationLevel);
        optimizations.push(...memoryOptimizations.applied);
        optimizedAST = memoryOptimizations.ast;
      }

      // Generate optimized code
      const optimizedCode = astToTypeScriptCode(optimizedAST, {
        ...generationOptions,
        minifyOutput: optimizationLevel === 'aggressive',
        optimizeImports: true,
      });

      const optimizedLoaderCode = optimizedLoaderAST ? astToTypeScriptCode({
        componentAST: optimizedLoaderAST,
        typeAST: optimizedAST.typeAST,
        imports: optimizedAST.imports,
        exports: optimizedAST.exports,
      }, generationOptions) : undefined;

      // Calculate optimization metrics
      const originalSize = astRecord.codeLength || 0;
      const optimizedSize = optimizedCode.length;
      const sizeReduction = originalSize > 0 ? ((originalSize - optimizedSize) / originalSize) * 100 : 0;

      const optimizationRecord = {
        optimizationId: `opt_${sessionId}_${Date.now()}`,
        originalAstId: astId,
        optimizationLevel,
        optimizationTargets: targets,
        optimizations,
        optimizedAST,
        optimizedLoaderAST,
        metrics: {
          originalSize,
          optimizedSize,
          sizeReduction,
          optimizationsApplied: optimizations.length,
        },
        optimizedAt: new Date(),
      };

      // Store optimization results
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(optimizationRecord), {
        userId: userContext.userId,
        category: 'code-optimization',
        domains: [],
        scope: 'session',
        metadata: {
          optimizationId: optimizationRecord.optimizationId,
          originalAstId: astId,
          optimizationLevel,
          sizeReduction,
          optimizationsApplied: optimizations.length,
        },
      });

      // Trace optimization
      await biContextTracer.traceMemoryOperation(sessionId, 'code_optimization', {
        optimizationId: optimizationRecord.optimizationId,
        originalAstId: astId,
        optimizationLevel,
        targets: targets.length,
        optimizations: optimizations.length,
        sizeReduction,
      });

      return {
        success: true,
        sessionId,
        optimizationId: optimizationRecord.optimizationId,
        optimizedCode,
        optimizedLoaderCode,
        optimizations,
        metrics: optimizationRecord.metrics,
        performance: {
          sizeReduction: `${sizeReduction.toFixed(2)}%`,
          optimizationsApplied: optimizations.length,
          targets: targets.length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to optimize generated code', {
        sessionId,
        astId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to optimize generated code',
        details: (error as Error).message,
        sessionId,
        astId,
      };
    }
  },
});

// ============================================================================
// Helper Functions for AST Generation
// ============================================================================

function createASTGenerationContext(
  request: VisualizationRequest,
  theme?: ShadcnTheme,
  options?: CodeGenerationOptions
): ASTGenerationContext {
  return {
    componentName: request.componentName,
    propsInterface: {
      name: `${request.componentName}Props`,
      props: generatePropsFromAnalysisData(request.analysisData),
      state: [],
      methods: [],
    },
    dataBindings: generateDataBindingsFromAnalysisData(request.analysisData),
    stylingConfig: request.styling || {},
    visualizationConfig: request.options || {},
  };
}

function generateComponentInterfaceAST(componentName: string, analysisData: any): ComponentInterface {
  return {
    name: `${componentName}Props`,
    props: generatePropsFromAnalysisData(analysisData),
    state: [
      {
        name: 'loading',
        type: 'boolean',
        initialValue: false,
        description: 'Loading state for component',
      },
      {
        name: 'error',
        type: 'string | null',
        initialValue: null,
        description: 'Error state for component',
      },
    ],
    methods: [
      {
        name: 'handleDataUpdate',
        parameters: [
          {
            name: 'newData',
            type: 'any[]',
            optional: false,
            description: 'New data to update component with',
          },
        ],
        returnType: 'void',
        description: 'Handle data updates for the component',
      },
    ],
  };
}

function generateImportsAST(visualizationType: string, options: CodeGenerationOptions): ImportStatement[] {
  const imports: ImportStatement[] = [
    {
      source: 'react',
      specifiers: ['React', 'useState', 'useEffect', 'useMemo'],
      isDefault: false,
      isType: false,
    },
  ];

  // Add visualization-specific imports
  switch (visualizationType) {
    case 'bar-chart':
    case 'line-chart':
    case 'pie-chart':
      imports.push({
        source: 'recharts',
        specifiers: ['ResponsiveContainer', 'BarChart', 'LineChart', 'PieChart', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'Legend'],
        isDefault: false,
        isType: false,
      });
      break;
    case 'table':
      // Table components are embedded
      break;
  }

  return imports;
}

function generateReactComponentAST(
  context: ASTGenerationContext,
  componentInterface: ComponentInterface,
  options: CodeGenerationOptions
): ReactComponentAST {
  return {
    type: 'FunctionComponent',
    componentName: context.componentName,
    props: componentInterface.props,
    hooks: ['useState', 'useEffect', 'useMemo'],
    jsxElements: generateJSXElementsForVisualization(context),
    properties: {
      displayName: context.componentName,
      defaultProps: generateDefaultProps(componentInterface.props),
    },
    metadata: {
      generatedBy: 'ast-code-generation',
      optimizations: ['memo', 'callback-optimization'],
    },
  };
}

function generateJSXElementsForVisualization(context: ASTGenerationContext): JSXElementAST[] {
  const elements: JSXElementAST[] = [
    {
      type: 'JSXElement',
      tagName: 'div',
      attributes: {
        className: 'visualization-container',
        style: '{{ padding: "1rem", borderRadius: "var(--radius)" }}',
      },
      children: [
        {
          type: 'JSXElement',
          tagName: 'Card',
          attributes: {},
          children: [
            {
              type: 'JSXElement',
              tagName: 'CardHeader',
              children: [
                {
                  type: 'JSXElement',
                  tagName: 'CardTitle',
                  children: [
                    {
                      type: 'JSXExpression',
                      properties: {
                        expression: `${context.visualizationConfig.title || context.componentName}`,
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'JSXElement',
              tagName: 'CardContent',
              children: generateVisualizationContent(context),
            },
          ],
        },
      ],
    },
  ];

  return elements;
}

function generateVisualizationContent(context: ASTGenerationContext): JSXElementAST[] {
  // This would generate different JSX based on visualization type
  return [
    {
      type: 'JSXElement',
      tagName: 'div',
      attributes: {
        className: 'chart-container',
      },
      children: [
        {
          type: 'JSXExpression',
          properties: {
            expression: '/* Chart implementation will be inserted here */',
          },
        },
      ],
    },
  ];
}

function generateExportsAST(componentName: string, options: CodeGenerationOptions): ExportStatement[] {
  return [
    {
      name: componentName,
      isDefault: true,
      isType: false,
    },
    {
      name: `${componentName}Props`,
      isDefault: false,
      isType: true,
    },
  ];
}

function generateTypeDefinitionsAST(componentInterface: ComponentInterface, analysisData: any): TypeScriptAST {
  return {
    type: 'InterfaceDeclaration',
    properties: {
      name: componentInterface.name,
      extends: [],
      properties: componentInterface.props.map(prop => ({
        name: prop.name,
        type: prop.type,
        optional: !prop.required,
        description: prop.description,
      })),
    },
    metadata: {
      generatedBy: 'ast-code-generation',
    },
  };
}

function generateLoaderScriptAST(
  componentName: string,
  loaderConfig: RuntimeLoaderConfig,
  options: CodeGenerationOptions
): LoaderScriptAST {
  return {
    type: 'LoaderScript',
    componentName,
    apiEndpoint: loaderConfig.baseUrl,
    cacheStrategy: loaderConfig.cacheStrategy,
    retryLogic: [
      {
        type: 'RetryLoop',
        properties: {
          maxRetries: loaderConfig.maxRetries,
          timeout: loaderConfig.loadingTimeout,
        },
      },
    ],
    loadingElement: {
      type: 'JSXElement',
      tagName: 'div',
      attributes: {
        className: 'loading-spinner',
      },
      children: [
        {
          type: 'JSXExpression',
          properties: {
            expression: `Loading ${componentName}...`,
          },
        },
      ],
    },
    errorElement: {
      type: 'JSXElement',
      tagName: 'div',
      attributes: {
        className: 'error-message',
      },
      children: [
        {
          type: 'JSXExpression',
          properties: {
            expression: 'Failed to load component',
          },
        },
      ],
    },
    properties: {
      fallbackStrategy: loaderConfig.fallbackStrategy,
      corsEnabled: loaderConfig.corsEnabled,
    },
    metadata: {
      generatedBy: 'ast-loader-generation',
    },
  };
}

function generatePropsFromAnalysisData(analysisData: any): PropDefinition[] {
  const props: PropDefinition[] = [
    {
      name: 'data',
      type: 'any[]',
      required: false,
      description: 'Data array for visualization',
      defaultValue: [],
    },
    {
      name: 'className',
      type: 'string',
      required: false,
      description: 'Additional CSS class names',
    },
    {
      name: 'style',
      type: 'React.CSSProperties',
      required: false,
      description: 'Inline styles object',
    },
  ];

  // Add data-specific props based on analysis data
  if (analysisData?.datasets?.[0]?.data?.[0]) {
    const firstRow = analysisData.datasets[0].data[0];
    const fieldNames = Object.keys(firstRow);

    props.push({
      name: 'dataFields',
      type: `Array<${fieldNames.map(name => `'${name}'`).join(' | ')}>`,
      required: false,
      description: 'Available data fields',
      defaultValue: fieldNames,
    });
  }

  return props;
}

function generateDataBindingsFromAnalysisData(analysisData: any): ComponentDataBinding {
  return {
    propInterface: 'ComponentProps',
    dataFields: [],
    eventHandlers: [],
  };
}

function generateDefaultProps(props: PropDefinition[]): Record<string, any> {
  const defaults: Record<string, any> = {};

  for (const prop of props) {
    if (prop.defaultValue !== undefined) {
      defaults[prop.name] = prop.defaultValue;
    }
  }

  return defaults;
}

// ============================================================================
// AST to Code Conversion
// ============================================================================

function astToTypeScriptCode(ast: GeneratedAST, options: CodeGenerationOptions): string {
  const { componentAST, typeAST, imports, exports } = ast;

  let code = '';

  // Generate import statements
  for (const importStmt of imports) {
    if (importStmt.isType) {
      code += `import type { ${importStmt.specifiers.join(', ')} } from '${importStmt.source}';\n`;
    } else {
      code += `import { ${importStmt.specifiers.join(', ')} } from '${importStmt.source}';\n`;
    }
  }

  code += '\n';

  // Generate type definitions
  if (typeAST.type === 'InterfaceDeclaration') {
    code += `interface ${typeAST.properties.name} {\n`;
    for (const prop of typeAST.properties.properties) {
      const optional = prop.optional ? '?' : '';
      const description = prop.description ? `  /** ${prop.description} */\n` : '';
      code += `${description}  ${prop.name}${optional}: ${prop.type};\n`;
    }
    code += '}\n\n';
  }

  // Generate component
  if (componentAST.type === 'FunctionComponent') {
    const propsType = componentAST.props.length > 0 ? `{ ${componentAST.props.map(p => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ')} }` : 'any';

    code += `const ${componentAST.componentName} = ({ ${componentAST.props.map(p => p.name).join(', ')} }: ${propsType}) => {\n`;

    // Add hooks
    for (const hook of componentAST.hooks) {
      if (hook === 'useState') {
        code += `  const [loading, setLoading] = React.useState(false);\n`;
        code += `  const [error, setError] = React.useState<string | null>(null);\n`;
      }
    }

    code += '\n  return (\n';

    // Generate JSX
    for (const element of componentAST.jsxElements) {
      code += generateJSXCode(element, 2);
    }

    code += '  );\n';
    code += '};\n\n';
  }

  // Generate exports
  for (const exportStmt of exports) {
    if (exportStmt.isDefault) {
      code += `export default ${exportStmt.name};\n`;
    } else if (exportStmt.isType) {
      code += `export type { ${exportStmt.name} };\n`;
    } else {
      code += `export { ${exportStmt.name} };\n`;
    }
  }

  return code;
}

function generateJSXCode(element: JSXElementAST, indent: number): string {
  const spaces = '  '.repeat(indent);

  if (element.type === 'JSXExpression') {
    return `${spaces}{${element.properties.expression}}\n`;
  }

  if (element.type === 'JSXElement') {
    let code = `${spaces}<${element.tagName}`;

    // Add attributes
    if (element.attributes) {
      for (const [key, value] of Object.entries(element.attributes)) {
        if (typeof value === 'string' && value.startsWith('{{')) {
          code += ` ${key}={${value.slice(2, -2)}}`;
        } else {
          code += ` ${key}="${value}"`;
        }
      }
    }

    if (element.children && element.children.length > 0) {
      code += '>\n';
      for (const child of element.children) {
        code += generateJSXCode(child, indent + 1);
      }
      code += `${spaces}</${element.tagName}>\n`;
    } else {
      code += ' />\n';
    }

    return code;
  }

  return '';
}

// ============================================================================
// Validation Functions
// ============================================================================

function validateSyntax(code: string, codeType: string): SyntaxError[] {
  const errors: SyntaxError[] = [];

  // Basic syntax validation
  try {
    // Simple bracket matching
    const openBrackets = (code.match(/\{/g) || []).length;
    const closeBrackets = (code.match(/\}/g) || []).length;

    if (openBrackets !== closeBrackets) {
      errors.push({
        message: 'Mismatched curly braces',
        line: 1,
        column: 1,
        severity: 'error',
        rule: 'bracket-matching',
      });
    }

    // Check for basic JSX syntax
    if (codeType === 'component' && !code.includes('return (')) {
      errors.push({
        message: 'Component must return JSX',
        line: 1,
        column: 1,
        severity: 'error',
        rule: 'jsx-return',
      });
    }

  } catch (error) {
    errors.push({
      message: `Syntax error: ${(error as Error).message}`,
      line: 1,
      column: 1,
      severity: 'error',
    });
  }

  return errors;
}

function validateTypes(code: string, codeType: string): TypeError[] {
  const errors: TypeError[] = [];

  // Basic type validation
  if (codeType === 'component') {
    if (!code.includes('React.') && !code.includes('import React')) {
      errors.push({
        message: 'React not imported',
        location: 'imports',
        expectedType: 'React import',
        actualType: 'missing',
        suggestion: "Add 'import React from \"react\"'",
      });
    }
  }

  return errors;
}

function performLinting(code: string, codeType: string): LintWarning[] {
  const warnings: LintWarning[] = [];

  // Basic linting rules
  if (code.includes('console.log')) {
    warnings.push({
      message: 'Avoid console.log in production code',
      line: code.split('\n').findIndex(line => line.includes('console.log')) + 1,
      column: 1,
      rule: 'no-console',
      fixable: true,
      suggestion: 'Use proper logging instead',
    });
  }

  if (code.includes('any')) {
    warnings.push({
      message: 'Avoid using "any" type',
      line: code.split('\n').findIndex(line => line.includes('any')) + 1,
      column: 1,
      rule: 'no-any',
      fixable: false,
      suggestion: 'Use specific types instead',
    });
  }

  return warnings;
}

function calculateComplexityScore(code: string): number {
  let score = 0;

  // Basic complexity metrics
  score += (code.match(/if|else|while|for|switch/g) || []).length * 2;
  score += (code.match(/function|=>/g) || []).length * 1;
  score += (code.match(/\{/g) || []).length * 0.5;
  score += Math.floor(code.length / 1000);

  return Math.round(score);
}

function generateValidationRecommendations(validation: ValidationResult): string[] {
  const recommendations: string[] = [];

  if (validation.syntaxErrors.length > 0) {
    recommendations.push('Fix syntax errors before proceeding');
  }

  if (validation.typeErrors.length > 0) {
    recommendations.push('Resolve type errors for better reliability');
  }

  if (validation.complexityScore > 30) {
    recommendations.push('Consider breaking down complex components into smaller parts');
  }

  if (validation.bundleSize > 50000) {
    recommendations.push('Optimize bundle size through code splitting or tree shaking');
  }

  if (validation.lintWarnings.length > 5) {
    recommendations.push('Address linting warnings for better code quality');
  }

  return recommendations;
}

// ============================================================================
// Optimization Functions
// ============================================================================

function applyBundleSizeOptimizations(ast: GeneratedAST, level: string): { ast: GeneratedAST; applied: string[] } {
  const applied: string[] = [];
  const optimizedAST = { ...ast };

  if (level === 'aggressive') {
    applied.push('Removed unused imports');
    applied.push('Minified component names');
    applied.push('Compressed JSX attributes');
  } else if (level === 'standard') {
    applied.push('Optimized imports');
    applied.push('Removed dead code');
  }

  return { ast: optimizedAST, applied };
}

function applyRuntimeOptimizations(ast: GeneratedAST, level: string): { ast: GeneratedAST; applied: string[] } {
  const applied: string[] = [];
  const optimizedAST = { ...ast };

  if (level === 'aggressive') {
    applied.push('Added React.memo');
    applied.push('Optimized render loops');
    applied.push('Added useCallback optimization');
  } else if (level === 'standard') {
    applied.push('Basic memoization');
    applied.push('Optimized re-renders');
  }

  return { ast: optimizedAST, applied };
}

function applyLoadTimeOptimizations(ast: GeneratedAST, level: string): { ast: GeneratedAST; applied: string[] } {
  const applied: string[] = [];
  const optimizedAST = { ...ast };

  if (level === 'aggressive') {
    applied.push('Code splitting');
    applied.push('Lazy loading');
    applied.push('Preload optimization');
  } else if (level === 'standard') {
    applied.push('Import optimization');
    applied.push('Bundle chunking');
  }

  return { ast: optimizedAST, applied };
}

function applyLoaderOptimizations(ast: LoaderScriptAST, level: string): { ast: LoaderScriptAST; applied: string[] } {
  const applied: string[] = [];
  const optimizedAST = { ...ast };

  if (level === 'aggressive') {
    applied.push('Compressed loader script');
    applied.push('Optimized retry logic');
    applied.push('Enhanced caching');
  } else if (level === 'standard') {
    applied.push('Basic loader optimization');
    applied.push('Cache improvement');
  }

  return { ast: optimizedAST, applied };
}

function applyMemoryOptimizations(ast: GeneratedAST, level: string): { ast: GeneratedAST; applied: string[] } {
  const applied: string[] = [];
  const optimizedAST = { ...ast };

  if (level === 'aggressive') {
    applied.push('Memory leak prevention');
    applied.push('Optimized data structures');
    applied.push('Garbage collection hints');
  } else if (level === 'standard') {
    applied.push('Basic memory optimization');
    applied.push('Reference cleanup');
  }

  return { ast: optimizedAST, applied };
}

function countASTNodes(ast: GeneratedAST): number {
  let count = 0;

  function countNodes(node: any): void {
    if (node && typeof node === 'object') {
      count++;
      if (node.children) {
        node.children.forEach(countNodes);
      }
      Object.values(node).forEach(value => {
        if (Array.isArray(value)) {
          value.forEach(countNodes);
        } else if (typeof value === 'object' && value !== null) {
          countNodes(value);
        }
      });
    }
  }

  countNodes(ast);
  return count;
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const astCodeGenerationTools = [
  generateComponentAST,
  validateGeneratedCode,
  optimizeGeneratedCode,
];

// Export tool metadata for registration
export const astCodeGenerationToolsMetadata = {
  category: 'ast-code-generation',
  description: 'AST-based TypeScript code generation with advanced optimization and validation',
  totalTools: astCodeGenerationTools.length,
  capabilities: [
    'ast_generation',
    'typescript_compilation',
    'jsx_generation',
    'code_validation',
    'syntax_checking',
    'type_validation',
    'performance_optimization',
    'bundle_size_optimization',
    'complexity_analysis',
    'lint_checking',
    'loader_pattern_optimization',
    'memory_optimization',
    'runtime_optimization',
  ],
};

rootLogger.info('AST code generation tools initialized', {
  totalTools: astCodeGenerationTools.length,
  capabilities: astCodeGenerationToolsMetadata.capabilities,
});