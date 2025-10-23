/**
 * Data Binding and Prop Interface Generation
 * Analyzes API schemas and generates TypeScript interfaces and data bindings for React components
 */

import { z } from 'zod';
import { Tool } from '@mastra/core/tools';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer } from '../observability/context-tracer.js';
import {
  ComponentDataBinding,
  DataFieldBinding,
  EventHandlerBinding,
  PropDefinition,
  ComponentInterface,
  UserContext,
  AnonymousContext,
} from '../types/index.js';
import { getUserContext, hasPermission } from '../api/middleware/jwt-context.js';
import { rootLogger } from '../observability/logger.js';
import { withErrorHandling } from '../observability/error-handling.js';

// ============================================================================
// Data Binding Types
// ============================================================================

export interface DataSchema {
  tables: TableSchema[];
  relationships: RelationshipSchema[];
  enums: EnumSchema[];
  functions: FunctionSchema[];
}

export interface TableSchema {
  name: string;
  schema: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  foreignKeys: ForeignKeySchema[];
  indexes: IndexSchema[];
  policies: PolicySchema[];
  description?: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: any;
  description?: string;
  constraints?: ConstraintSchema[];
}

export interface ConstraintSchema {
  type: 'unique' | 'check' | 'foreign_key' | 'primary_key';
  definition: string;
  referencedTable?: string;
  referencedColumn?: string;
}

export interface RelationshipSchema {
  name: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  cascadeDelete?: boolean;
}

export interface EnumSchema {
  name: string;
  values: string[];
  description?: string;
}

export interface FunctionSchema {
  name: string;
  parameters: ParameterSchema[];
  returnType: string;
  description?: string;
}

export interface ParameterSchema {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: any;
}

export interface IndexSchema {
  name: string;
  columns: string[];
  unique: boolean;
  type: 'btree' | 'gin' | 'gist' | 'hash';
}

export interface PolicySchema {
  name: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  roles: string[];
  expression: string;
}

export interface GeneratedBinding {
  bindingId: string;
  componentName: string;
  dataSchema: DataSchema;
  propInterface: TypeScriptInterface;
  dataBindings: ComponentDataBinding;
  eventHandlers: EventHandlerBinding[];
  validationSchemas: ValidationSchema[];
  transformationFunctions: TransformationFunction[];
  metadata: BindingMetadata;
}

export interface TypeScriptInterface {
  name: string;
  extends?: string[];
  properties: InterfaceProperty[];
  generics?: GenericParameter[];
  documentation?: string;
}

export interface InterfaceProperty {
  name: string;
  type: string;
  optional: boolean;
  readonly?: boolean;
  description?: string;
  validation?: ValidationRule[];
}

export interface GenericParameter {
  name: string;
  constraint?: string;
  defaultType?: string;
}

export interface ValidationSchema {
  fieldName: string;
  rules: ValidationRule[];
  customValidator?: string;
  errorMessages: Record<string, string>;
}

export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'pattern' | 'email' | 'url' | 'custom';
  value?: any;
  message?: string;
}

export interface TransformationFunction {
  name: string;
  inputType: string;
  outputType: string;
  implementation: string;
  description: string;
}

export interface BindingMetadata {
  generatedAt: Date;
  schemaVersion: string;
  apiEndpoints: string[];
  complexity: 'low' | 'medium' | 'high';
  estimatedSize: number;
  dependencies: string[];
}

// ============================================================================
// Data Binding Tools
// ============================================================================

/**
 * Analyze API Schema and Generate Bindings
 */
export const analyzeApiSchemaAndGenerateBindings = new Tool({
  id: 'analyze-api-schema-generate-bindings',
  description: 'Analyze API schema from Supabase or other sources and generate TypeScript interfaces and data bindings',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    componentName: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/).describe('Component name in PascalCase'),

    // Schema source configuration
    schemaSource: z.object({
      type: z.enum(['supabase', 'postgres', 'mysql', 'api-spec', 'graphql', 'manual']),
      connectionConfig: z.object({
        endpoint: z.string().url().optional(),
        apiKey: z.string().optional(),
        database: z.string().optional(),
        schema: z.string().default('public'),
        tables: z.array(z.string()).optional().describe('Specific tables to analyze'),
      }).optional(),
      schemaData: z.any().optional().describe('Manually provided schema data'),
    }).describe('Schema source configuration'),

    // Binding configuration
    bindingConfig: z.object({
      primaryTable: z.string().describe('Primary table for data operations'),
      includeRelationships: z.boolean().default(true).describe('Include related table data'),
      maxRelationshipDepth: z.number().min(1).max(5).default(2).describe('Maximum depth for relationships'),
      generateCrudOperations: z.boolean().default(true).describe('Generate CRUD operation bindings'),
      includeValidation: z.boolean().default(true).describe('Generate validation schemas'),
      includeTransformations: z.boolean().default(false).describe('Generate data transformation functions'),
      customFields: z.array(z.object({
        name: z.string(),
        type: z.string(),
        source: z.string().describe('Source of the field (e.g., "computed", "joined")'),
        transformation: z.string().optional(),
      })).optional().describe('Custom computed fields'),
    }).describe('Data binding configuration'),

    // Component configuration
    componentConfig: z.object({
      interactionTypes: z.array(z.string()).optional(),
      eventHandlers: z.array(z.string()).optional(),
      stateManagement: z.enum(['none', 'local', 'context', 'redux']).default('local'),
      errorHandling: z.enum(['throw', 'return', 'callback']).default('callback'),
      loadingStates: z.boolean().default(true),
    }).optional().describe('Component-specific configuration'),
  }),
  execute: async ({ sessionId, componentName, schemaSource, bindingConfig, componentConfig }, context) => {
    try {
      rootLogger.info('Analyzing API schema and generating bindings', {
        sessionId,
        componentName,
        schemaType: schemaSource.type,
        primaryTable: bindingConfig.primaryTable,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Analyze schema based on source type
      let dataSchema: DataSchema;
      switch (schemaSource.type) {
        case 'supabase':
          dataSchema = await analyzeSupabaseSchema(schemaSource.connectionConfig);
          break;
        case 'postgres':
          dataSchema = await analyzePostgresSchema(schemaSource.connectionConfig);
          break;
        case 'api-spec':
          dataSchema = await analyzeApiSpecSchema(schemaSource.connectionConfig);
          break;
        case 'manual':
          dataSchema = parseManualSchema(schemaSource.schemaData);
          break;
        default:
          throw new Error(`Unsupported schema source type: ${schemaSource.type}`);
      }

      // Generate TypeScript interface
      const propInterface = generatePropInterface(
        componentName,
        dataSchema,
        bindingConfig
      );

      // Generate data bindings
      const dataBindings = generateDataBindings(
        dataSchema,
        bindingConfig,
        componentConfig
      );

      // Generate event handlers
      const eventHandlers = generateEventHandlers(
        dataSchema,
        bindingConfig,
        componentConfig
      );

      // Generate validation schemas
      const validationSchemas = bindingConfig.includeValidation
        ? generateValidationSchemas(dataSchema, bindingConfig)
        : [];

      // Generate transformation functions
      const transformationFunctions = bindingConfig.includeTransformations
        ? generateTransformationFunctions(dataSchema, bindingConfig)
        : [];

      // Create generated binding
      const generatedBinding: GeneratedBinding = {
        bindingId: `binding_${componentName}_${Date.now()}`,
        componentName,
        dataSchema,
        propInterface,
        dataBindings,
        eventHandlers,
        validationSchemas,
        transformationFunctions,
        metadata: {
          generatedAt: new Date(),
          schemaVersion: '1.0.0',
          apiEndpoints: extractApiEndpoints(schemaSource),
          complexity: calculateBindingComplexity(dataSchema, bindingConfig),
          estimatedSize: estimateBindingSize(propInterface, dataBindings),
          dependencies: extractDependencies(dataSchema, bindingConfig),
        },
      };

      // Store generated binding
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(generatedBinding), {
        userId: userContext.userId,
        category: 'data-binding',
        domains: [],
        scope: 'session',
        metadata: {
          bindingId: generatedBinding.bindingId,
          componentName,
          primaryTable: bindingConfig.primaryTable,
          schemaType: schemaSource.type,
          complexity: generatedBinding.metadata.complexity,
          hasValidation: validationSchemas.length > 0,
          hasTransformations: transformationFunctions.length > 0,
        },
      });

      // Generate TypeScript code
      const generatedCode = generateTypeScriptBindingCode(generatedBinding);

      // Trace binding generation
      await biContextTracer.traceMemoryOperation(sessionId, 'data_binding_generation', {
        bindingId: generatedBinding.bindingId,
        componentName,
        schemaType: schemaSource.type,
        tablesAnalyzed: dataSchema.tables.length,
        propertiesGenerated: propInterface.properties.length,
        bindingsGenerated: dataBindings.dataFields.length,
        eventHandlersGenerated: eventHandlers.length,
        validationRulesGenerated: validationSchemas.reduce((sum, schema) => sum + schema.rules.length, 0),
      });

      return {
        success: true,
        sessionId,
        bindingId: generatedBinding.bindingId,
        generatedBinding,
        generatedCode,
        summary: {
          interfaceName: propInterface.name,
          propertiesCount: propInterface.properties.length,
          dataBindingsCount: dataBindings.dataFields.length,
          eventHandlersCount: eventHandlers.length,
          validationSchemasCount: validationSchemas.length,
          transformationFunctionsCount: transformationFunctions.length,
          estimatedComplexity: generatedBinding.metadata.complexity,
          codeSize: generatedCode.length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to analyze schema and generate bindings', {
        sessionId,
        componentName,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to analyze schema and generate bindings',
        details: (error as Error).message,
        sessionId,
      };
    }
  },
});

/**
 * Generate Custom Data Transformations
 */
export const generateCustomDataTransformations = new Tool({
  id: 'generate-custom-data-transformations',
  description: 'Generate custom data transformation functions for complex data processing',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    bindingId: z.string().describe('Existing binding ID to enhance'),
    transformations: z.array(z.object({
      name: z.string().describe('Transformation function name'),
      description: z.string().describe('Description of what the transformation does'),
      inputType: z.string().describe('Input data type'),
      outputType: z.string().describe('Output data type'),
      logic: z.object({
        type: z.enum(['map', 'filter', 'reduce', 'aggregate', 'join', 'pivot', 'custom']),
        configuration: z.any().describe('Transformation-specific configuration'),
        customCode: z.string().optional().describe('Custom JavaScript/TypeScript code'),
      }),
      validation: z.object({
        inputValidation: z.array(z.string()).optional(),
        outputValidation: z.array(z.string()).optional(),
        errorHandling: z.enum(['throw', 'return-null', 'default-value']).default('throw'),
        defaultValue: z.any().optional(),
      }).optional(),
      performance: z.object({
        memoize: z.boolean().default(false),
        async: z.boolean().default(false),
        batchSize: z.number().optional(),
      }).optional(),
    })).describe('Transformation functions to generate'),
  }),
  execute: async ({ sessionId, bindingId, transformations }, context) => {
    try {
      rootLogger.info('Generating custom data transformations', {
        sessionId,
        bindingId,
        transformationsCount: transformations.length,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve existing binding
      const bindingResults = await biContextStore.searchContextMemories(sessionId, bindingId, {
        userId: userContext.userId,
        category: 'data-binding',
        topK: 1,
        similarityThreshold: 0.9,
      });

      if (bindingResults.length === 0) {
        return {
          success: false,
          error: 'Binding not found',
          sessionId,
          bindingId,
        };
      }

      const existingBinding = JSON.parse(bindingResults[0].content) as GeneratedBinding;

      // Generate transformation functions
      const generatedTransformations: TransformationFunction[] = [];

      for (const transform of transformations) {
        const transformationFunction = await generateTransformationFunction(
          transform,
          existingBinding.dataSchema
        );
        generatedTransformations.push(transformationFunction);
      }

      // Update binding with new transformations
      const updatedBinding: GeneratedBinding = {
        ...existingBinding,
        transformationFunctions: [
          ...existingBinding.transformationFunctions,
          ...generatedTransformations,
        ],
        metadata: {
          ...existingBinding.metadata,
          generatedAt: new Date(),
          complexity: recalculateBindingComplexity(existingBinding, generatedTransformations),
        },
      };

      // Store updated binding
      await biContextStore.storeContextMemory(sessionId, JSON.stringify(updatedBinding), {
        userId: userContext.userId,
        category: 'data-binding',
        domains: [],
        scope: 'session',
        metadata: {
          bindingId: updatedBinding.bindingId,
          componentName: updatedBinding.componentName,
          hasTransformations: true,
          transformationsCount: updatedBinding.transformationFunctions.length,
          updated: true,
        },
      });

      // Generate updated TypeScript code
      const updatedCode = generateTypeScriptBindingCode(updatedBinding);

      // Trace transformation generation
      await biContextTracer.traceMemoryOperation(sessionId, 'transformation_generation', {
        bindingId: updatedBinding.bindingId,
        transformationsAdded: generatedTransformations.length,
        totalTransformations: updatedBinding.transformationFunctions.length,
        complexity: updatedBinding.metadata.complexity,
      });

      return {
        success: true,
        sessionId,
        bindingId: updatedBinding.bindingId,
        updatedBinding,
        generatedTransformations,
        updatedCode,
        summary: {
          newTransformationsCount: generatedTransformations.length,
          totalTransformationsCount: updatedBinding.transformationFunctions.length,
          updatedComplexity: updatedBinding.metadata.complexity,
          codeSize: updatedCode.length,
        },
      };

    } catch (error) {
      rootLogger.error('Failed to generate custom data transformations', {
        sessionId,
        bindingId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to generate custom data transformations',
        details: (error as Error).message,
        sessionId,
        bindingId,
      };
    }
  },
});

/**
 * Validate Data Binding Compatibility
 */
export const validateDataBindingCompatibility = new Tool({
  id: 'validate-data-binding-compatibility',
  description: 'Validate data binding compatibility with component requirements and API schema',
  inputSchema: z.object({
    sessionId: z.string().uuid().describe('Session identifier for context'),
    bindingId: z.string().describe('Binding ID to validate'),
    componentRequirements: z.object({
      requiredFields: z.array(z.string()).describe('Fields required by the component'),
      optionalFields: z.array(z.string()).optional().describe('Optional fields'),
      dataTypes: z.record(z.string()).describe('Expected data types for fields'),
      constraints: z.array(z.object({
        field: z.string(),
        type: z.enum(['required', 'unique', 'min', 'max', 'pattern']),
        value: z.any().optional(),
      })).optional(),
    }).describe('Component data requirements'),
    apiSchema: z.any().optional().describe('Current API schema to validate against'),
    validationLevel: z.enum(['strict', 'loose', 'warning-only']).default('strict').describe('Validation strictness'),
  }),
  execute: async ({ sessionId, bindingId, componentRequirements, apiSchema, validationLevel }, context) => {
    try {
      rootLogger.info('Validating data binding compatibility', {
        sessionId,
        bindingId,
        requiredFields: componentRequirements.requiredFields.length,
        validationLevel,
      });

      const userContext = await biContextStore.getUserContext(sessionId);
      if (!userContext) {
        return {
          success: false,
          error: 'Session not found',
          sessionId,
        };
      }

      // Retrieve binding
      const bindingResults = await biContextStore.searchContextMemories(sessionId, bindingId, {
        userId: userContext.userId,
        category: 'data-binding',
        topK: 1,
        similarityThreshold: 0.9,
      });

      if (bindingResults.length === 0) {
        return {
          success: false,
          error: 'Binding not found',
          sessionId,
          bindingId,
        };
      }

      const binding = JSON.parse(bindingResults[0].content) as GeneratedBinding;

      // Perform validation
      const validationResult = await performBindingValidation(
        binding,
        componentRequirements,
        apiSchema,
        validationLevel
      );

      // Store validation results
      const validationRecord = {
        validationId: `validation_${bindingId}_${Date.now()}`,
        bindingId,
        componentRequirements,
        validationResult,
        validationLevel,
        validatedAt: new Date(),
      };

      await biContextStore.storeContextMemory(sessionId, JSON.stringify(validationRecord), {
        userId: userContext.userId,
        category: 'binding-validation',
        domains: [],
        scope: 'session',
        metadata: {
          validationId: validationRecord.validationId,
          bindingId,
          valid: validationResult.valid,
          errorsCount: validationResult.errors.length,
          warningsCount: validationResult.warnings.length,
        },
      });

      // Trace validation
      await biContextTracer.traceMemoryOperation(sessionId, 'binding_validation', {
        bindingId,
        validationId: validationRecord.validationId,
        valid: validationResult.valid,
        errorsCount: validationResult.errors.length,
        warningsCount: validationResult.warnings.length,
        validationLevel,
      });

      return {
        success: true,
        sessionId,
        bindingId,
        validationId: validationRecord.validationId,
        validationResult,
        recommendations: generateValidationRecommendations(validationResult),
      };

    } catch (error) {
      rootLogger.error('Failed to validate data binding compatibility', {
        sessionId,
        bindingId,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: 'Failed to validate data binding compatibility',
        details: (error as Error).message,
        sessionId,
        bindingId,
      };
    }
  },
});

// ============================================================================
// Schema Analysis Functions
// ============================================================================

async function analyzeSupabaseSchema(connectionConfig: any): Promise<DataSchema> {
  try {
    // Simulated Supabase schema analysis
    // In production, this would make actual API calls to Supabase
    const mockSchema: DataSchema = {
      tables: [
        {
          name: 'users',
          schema: 'public',
          columns: [
            { name: 'id', type: 'uuid', nullable: false, defaultValue: 'gen_random_uuid()' },
            { name: 'email', type: 'text', nullable: false },
            { name: 'name', type: 'text', nullable: true },
            { name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' },
            { name: 'updated_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' },
            { name: 'status', type: 'user_status', nullable: false, defaultValue: 'active' },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
          indexes: [
            { name: 'users_email_key', columns: ['email'], unique: true, type: 'btree' },
          ],
          policies: [
            {
              name: 'Users can view own data',
              command: 'SELECT',
              roles: ['authenticated'],
              expression: 'auth.uid() = id',
            },
          ],
        },
        {
          name: 'posts',
          schema: 'public',
          columns: [
            { name: 'id', type: 'uuid', nullable: false, defaultValue: 'gen_random_uuid()' },
            { name: 'title', type: 'text', nullable: false },
            { name: 'content', type: 'text', nullable: true },
            { name: 'author_id', type: 'uuid', nullable: false },
            { name: 'published', type: 'boolean', nullable: false, defaultValue: false },
            { name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' },
            { name: 'updated_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' },
          ],
          primaryKey: ['id'],
          foreignKeys: [
            {
              type: 'foreign_key',
              definition: 'FOREIGN KEY (author_id) REFERENCES users(id)',
              referencedTable: 'users',
              referencedColumn: 'id',
            },
          ],
          indexes: [
            { name: 'posts_author_id_idx', columns: ['author_id'], unique: false, type: 'btree' },
          ],
          policies: [],
        },
      ],
      relationships: [
        {
          name: 'posts_author',
          sourceTable: 'posts',
          sourceColumn: 'author_id',
          targetTable: 'users',
          targetColumn: 'id',
          type: 'many-to-one',
        },
      ],
      enums: [
        {
          name: 'user_status',
          values: ['active', 'inactive', 'pending', 'suspended'],
        },
      ],
      functions: [
        {
          name: 'get_user_posts',
          parameters: [
            { name: 'user_id', type: 'uuid', required: true },
            { name: 'published_only', type: 'boolean', required: false, defaultValue: true },
          ],
          returnType: 'posts[]',
          description: 'Get all posts for a specific user',
        },
      ],
    };

    return mockSchema;
  } catch (error) {
    rootLogger.error('Failed to analyze Supabase schema', {
      error: (error as Error).message,
    });
    throw error;
  }
}

async function analyzePostgresSchema(connectionConfig: any): Promise<DataSchema> {
  // Simulated PostgreSQL schema analysis
  return analyzeSupabaseSchema(connectionConfig);
}

async function analyzeApiSpecSchema(connectionConfig: any): Promise<DataSchema> {
  // Simulated API spec schema analysis (OpenAPI, GraphQL, etc.)
  return analyzeSupabaseSchema(connectionConfig);
}

function parseManualSchema(schemaData: any): DataSchema {
  // Parse manually provided schema data
  return schemaData as DataSchema;
}

// ============================================================================
// Interface Generation Functions
// ============================================================================

function generatePropInterface(
  componentName: string,
  dataSchema: DataSchema,
  bindingConfig: any
): TypeScriptInterface {
  const primaryTable = dataSchema.tables.find(t => t.name === bindingConfig.primaryTable);
  if (!primaryTable) {
    throw new Error(`Primary table '${bindingConfig.primaryTable}' not found in schema`);
  }

  const properties: InterfaceProperty[] = [];

  // Add data property
  properties.push({
    name: 'data',
    type: `${pascalCase(primaryTable.name)}[]`,
    optional: true,
    description: `Array of ${primaryTable.name} records`,
  });

  // Add individual field properties based on columns
  for (const column of primaryTable.columns) {
    const tsType = mapDatabaseTypeToTypeScript(column.type, dataSchema.enums);
    properties.push({
      name: column.name,
      type: column.nullable ? `${tsType} | null` : tsType,
      optional: column.nullable || column.defaultValue !== undefined,
      description: column.description || `${column.name} field`,
      validation: generateColumnValidation(column),
    });
  }

  // Add relationship properties if included
  if (bindingConfig.includeRelationships) {
    const relationships = dataSchema.relationships.filter(
      r => r.sourceTable === primaryTable.name || r.targetTable === primaryTable.name
    );

    for (const relationship of relationships) {
      const isSource = relationship.sourceTable === primaryTable.name;
      const relatedTable = isSource ? relationship.targetTable : relationship.sourceTable;
      const relatedTableSchema = dataSchema.tables.find(t => t.name === relatedTable);

      if (relatedTableSchema) {
        const propName = isSource
          ? relationship.targetTable
          : `${relationship.sourceTable}_rel`;

        properties.push({
          name: propName,
          type: relationship.type === 'one-to-many' || relationship.type === 'many-to-many'
            ? `${pascalCase(relatedTable)}[]`
            : pascalCase(relatedTable),
          optional: true,
          description: `Related ${relatedTable} records`,
        });
      }
    }
  }

  // Add custom fields
  if (bindingConfig.customFields) {
    for (const customField of bindingConfig.customFields) {
      properties.push({
        name: customField.name,
        type: customField.type,
        optional: true,
        description: `Custom field: ${customField.source}`,
      });
    }
  }

  // Add standard component props
  properties.push(
    {
      name: 'className',
      type: 'string',
      optional: true,
      description: 'Additional CSS class names',
    },
    {
      name: 'style',
      type: 'React.CSSProperties',
      optional: true,
      description: 'Inline styles',
    },
    {
      name: 'loading',
      type: 'boolean',
      optional: true,
      description: 'Loading state',
    },
    {
      name: 'error',
      type: 'string | null',
      optional: true,
      description: 'Error message',
    },
    {
      name: 'onDataChange',
      type: `(data: ${pascalCase(primaryTable.name)}[]) => void`,
      optional: true,
      description: 'Callback when data changes',
    },
    {
      name: 'onError',
      type: '(error: string) => void',
      optional: true,
      description: 'Error callback',
    }
  );

  return {
    name: `${componentName}Props`,
    properties,
    documentation: `Props interface for ${componentName} component based on ${primaryTable.name} table`,
  };
}

function generateDataBindings(
  dataSchema: DataSchema,
  bindingConfig: any,
  componentConfig: any
): ComponentDataBinding {
  const primaryTable = dataSchema.tables.find(t => t.name === bindingConfig.primaryTable);
  if (!primaryTable) {
    throw new Error(`Primary table '${bindingConfig.primaryTable}' not found in schema`);
  }

  const dataFields: DataFieldBinding[] = [];

  // Generate bindings for table columns
  for (const column of primaryTable.columns) {
    dataFields.push({
      name: column.name,
      type: mapDatabaseTypeToTypeScript(column.type, dataSchema.enums),
      source: `data.${column.name}`,
      transformation: column.type.includes('timestamp') ? 'formatDate' : undefined,
      validation: generateColumnValidationString(column),
    });
  }

  // Generate bindings for relationships
  if (bindingConfig.includeRelationships) {
    const relationships = dataSchema.relationships.filter(
      r => r.sourceTable === primaryTable.name
    );

    for (const relationship of relationships) {
      dataFields.push({
        name: relationship.name,
        type: `${pascalCase(relationship.targetTable)}${relationship.type.includes('many') ? '[]' : ''}`,
        source: `relationships.${relationship.name}`,
        transformation: relationship.type.includes('many') ? 'arrayTransform' : undefined,
      });
    }
  }

  // Generate bindings for custom fields
  if (bindingConfig.customFields) {
    for (const customField of bindingConfig.customFields) {
      dataFields.push({
        name: customField.name,
        type: customField.type,
        source: `custom.${customField.name}`,
        transformation: customField.transformation,
      });
    }
  }

  return {
    propInterface: `${primaryTable.name}Props`,
    dataFields,
    eventHandlers: [], // Will be populated by generateEventHandlers
  };
}

function generateEventHandlers(
  dataSchema: DataSchema,
  bindingConfig: any,
  componentConfig: any
): EventHandlerBinding[] {
  const handlers: EventHandlerBinding[] = [];

  if (bindingConfig.generateCrudOperations) {
    handlers.push(
      {
        event: 'onCreate',
        handler: `async (data: ${pascalCase(bindingConfig.primaryTable)}) => { /* Create implementation */ }`,
        description: `Handle creation of new ${bindingConfig.primaryTable} record`,
      },
      {
        event: 'onUpdate',
        handler: `async (id: string, data: Partial<${pascalCase(bindingConfig.primaryTable)}>) => { /* Update implementation */ }`,
        description: `Handle update of ${bindingConfig.primaryTable} record`,
      },
      {
        event: 'onDelete',
        handler: `async (id: string) => { /* Delete implementation */ }`,
        description: `Handle deletion of ${bindingConfig.primaryTable} record`,
      }
    );
  }

  // Add component-specific event handlers
  if (componentConfig?.interactionTypes) {
    for (const interactionType of componentConfig.interactionTypes) {
      switch (interactionType) {
        case 'filter-data':
          handlers.push({
            event: 'onFilterChange',
            handler: `(filters: Record<string, any>) => { /* Filter implementation */ }`,
            description: 'Handle data filtering',
          });
          break;
        case 'sort-data':
          handlers.push({
            event: 'onSortChange',
            handler: `(field: string, direction: 'asc' | 'desc') => { /* Sort implementation */ }`,
            description: 'Handle data sorting',
          });
          break;
        case 'search':
          handlers.push({
            event: 'onSearch',
            handler: `(searchTerm: string) => { /* Search implementation */ }`,
            description: 'Handle data search',
          });
          break;
      }
    }
  }

  return handlers;
}

function generateValidationSchemas(
  dataSchema: DataSchema,
  bindingConfig: any
): ValidationSchema[] {
  const primaryTable = dataSchema.tables.find(t => t.name === bindingConfig.primaryTable);
  if (!primaryTable) return [];

  const schemas: ValidationSchema[] = [];

  for (const column of primaryTable.columns) {
    const rules: ValidationRule[] = [];

    if (!column.nullable && !column.defaultValue) {
      rules.push({
        type: 'required',
        message: `${column.name} is required`,
      });
    }

    // Add type-specific validation
    switch (column.type) {
      case 'text':
      case 'varchar':
        if (column.constraints?.some(c => c.type === 'unique')) {
          rules.push({
            type: 'custom',
            value: 'uniqueConstraint',
            message: `${column.name} must be unique`,
          });
        }
        break;
      case 'integer':
      case 'bigint':
        rules.push({
          type: 'custom',
          value: 'isInteger',
          message: `${column.name} must be an integer`,
        });
        break;
      case 'email':
        rules.push({
          type: 'email',
          message: `${column.name} must be a valid email address`,
        });
        break;
      case 'url':
        rules.push({
          type: 'url',
          message: `${column.name} must be a valid URL`,
        });
        break;
    }

    if (rules.length > 0) {
      schemas.push({
        fieldName: column.name,
        rules,
        errorMessages: rules.reduce((acc, rule) => {
          acc[rule.type] = rule.message || `Invalid ${column.name}`;
          return acc;
        }, {} as Record<string, string>),
      });
    }
  }

  return schemas;
}

function generateTransformationFunctions(
  dataSchema: DataSchema,
  bindingConfig: any
): TransformationFunction[] {
  const functions: TransformationFunction[] = [];

  // Add common transformation functions
  functions.push(
    {
      name: 'formatDate',
      inputType: 'string | Date',
      outputType: 'string',
      implementation: `
const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString();
};`,
      description: 'Format date for display',
    },
    {
      name: 'formatCurrency',
      inputType: 'number',
      outputType: 'string',
      implementation: `
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};`,
      description: 'Format number as currency',
    }
  );

  // Add table-specific transformations
  const primaryTable = dataSchema.tables.find(t => t.name === bindingConfig.primaryTable);
  if (primaryTable) {
    // Generate transformation for enum fields
    for (const column of primaryTable.columns) {
      const enumSchema = dataSchema.enums.find(e => e.name === column.type);
      if (enumSchema) {
        functions.push({
          name: `format${pascalCase(column.name)}`,
          inputType: column.type,
          outputType: 'string',
          implementation: `
const format${pascalCase(column.name)} = (value: ${column.type}): string => {
  const labels = {
    ${enumSchema.values.map(v => `'${v}': '${v.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase())}'`).join(',\n    ')}
  };
  return labels[value] || value;
};`,
          description: `Format ${column.name} enum value for display`,
        });
      }
    }
  }

  return functions;
}

// ============================================================================
// Code Generation Functions
// ============================================================================

function generateTypeScriptBindingCode(binding: GeneratedBinding): string {
  let code = '';

  // Add imports
  code += `import React from 'react';\n`;
  code += `import { z } from 'zod';\n\n`;

  // Add enums
  for (const enumSchema of binding.dataSchema.enums) {
    code += `export enum ${pascalCase(enumSchema.name)} {\n`;
    for (const value of enumSchema.values) {
      code += `  ${value.toUpperCase()} = '${value}',\n`;
    }
    code += `}\n\n`;
  }

  // Add data interfaces
  for (const table of binding.dataSchema.tables) {
    code += `export interface ${pascalCase(table.name)} {\n`;
    for (const column of table.columns) {
      const tsType = mapDatabaseTypeToTypeScript(column.type, binding.dataSchema.enums);
      const optional = column.nullable ? '?' : '';
      code += `  ${column.name}${optional}: ${tsType};\n`;
    }
    code += `}\n\n`;
  }

  // Add component props interface
  code += generateInterfaceCode(binding.propInterface);
  code += '\n';

  // Add validation schemas
  if (binding.validationSchemas.length > 0) {
    code += '// Validation Schemas\n';
    for (const schema of binding.validationSchemas) {
      code += generateValidationSchemaCode(schema);
    }
    code += '\n';
  }

  // Add transformation functions
  if (binding.transformationFunctions.length > 0) {
    code += '// Transformation Functions\n';
    for (const func of binding.transformationFunctions) {
      code += func.implementation;
      code += '\n\n';
    }
  }

  // Add data binding hooks
  code += generateDataBindingHooks(binding);

  return code;
}

function generateInterfaceCode(interfaceSchema: TypeScriptInterface): string {
  let code = '';

  if (interfaceSchema.documentation) {
    code += `/**\n * ${interfaceSchema.documentation}\n */\n`;
  }

  code += `export interface ${interfaceSchema.name}`;

  if (interfaceSchema.generics && interfaceSchema.generics.length > 0) {
    code += '<';
    code += interfaceSchema.generics.map(g => {
      let generic = g.name;
      if (g.constraint) generic += ` extends ${g.constraint}`;
      if (g.defaultType) generic += ` = ${g.defaultType}`;
      return generic;
    }).join(', ');
    code += '>';
  }

  if (interfaceSchema.extends && interfaceSchema.extends.length > 0) {
    code += ` extends ${interfaceSchema.extends.join(', ')}`;
  }

  code += ' {\n';

  for (const prop of interfaceSchema.properties) {
    if (prop.description) {
      code += `  /** ${prop.description} */\n`;
    }

    const readonly = prop.readonly ? 'readonly ' : '';
    const optional = prop.optional ? '?' : '';
    code += `  ${readonly}${prop.name}${optional}: ${prop.type};\n`;
  }

  code += '}\n';

  return code;
}

function generateValidationSchemaCode(schema: ValidationSchema): string {
  let code = `export const ${camelCase(schema.fieldName)}ValidationSchema = z.object({\n`;

  // This is a simplified version - in production would generate full Zod schemas
  for (const rule of schema.rules) {
    switch (rule.type) {
      case 'required':
        code += `  ${schema.fieldName}: z.string().min(1, '${rule.message}'),\n`;
        break;
      case 'email':
        code += `  ${schema.fieldName}: z.string().email('${rule.message}'),\n`;
        break;
      case 'url':
        code += `  ${schema.fieldName}: z.string().url('${rule.message}'),\n`;
        break;
      case 'min':
        code += `  ${schema.fieldName}: z.number().min(${rule.value}, '${rule.message}'),\n`;
        break;
      case 'max':
        code += `  ${schema.fieldName}: z.number().max(${rule.value}, '${rule.message}'),\n`;
        break;
    }
  }

  code += `});\n\n`;
  return code;
}

function generateDataBindingHooks(binding: GeneratedBinding): string {
  const primaryTable = binding.dataSchema.tables.find(t => t.name === binding.bindingConfig?.primaryTable);
  if (!primaryTable) return '';

  return `
// Custom hook for ${binding.componentName} data operations
export const use${binding.componentName}Data = () => {
  const [data, setData] = React.useState<${pascalCase(primaryTable.name)}[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async (filters?: Record<string, any>) => {
    setLoading(true);
    setError(null);

    try {
      // API call implementation would go here
      const response = await fetch('/api/${primaryTable.name}', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
      }

      const result = await response.json();
      setData(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const createRecord = React.useCallback(async (record: Omit<${pascalCase(primaryTable.name)}, 'id' | 'created_at' | 'updated_at'>) => {
    // Implementation for creating new record
    return fetchData();
  }, [fetchData]);

  const updateRecord = React.useCallback(async (id: string, updates: Partial<${pascalCase(primaryTable.name)}>) => {
    // Implementation for updating record
    return fetchData();
  }, [fetchData]);

  const deleteRecord = React.useCallback(async (id: string) => {
    // Implementation for deleting record
    return fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    fetchData,
    createRecord,
    updateRecord,
    deleteRecord,
  };
};
`;
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapDatabaseTypeToTypeScript(dbType: string, enums: EnumSchema[]): string {
  // Check if it's an enum type
  const enumSchema = enums.find(e => e.name === dbType);
  if (enumSchema) {
    return pascalCase(dbType);
  }

  // Map standard database types to TypeScript types
  const typeMap: Record<string, string> = {
    'uuid': 'string',
    'text': 'string',
    'varchar': 'string',
    'char': 'string',
    'integer': 'number',
    'bigint': 'number',
    'smallint': 'number',
    'decimal': 'number',
    'numeric': 'number',
    'real': 'number',
    'double precision': 'number',
    'boolean': 'boolean',
    'timestamptz': 'Date',
    'timestamp': 'Date',
    'date': 'Date',
    'time': 'string',
    'json': 'any',
    'jsonb': 'any',
    'array': 'any[]',
  };

  return typeMap[dbType.toLowerCase()] || 'any';
}

function generateColumnValidation(column: ColumnSchema): ValidationRule[] {
  const rules: ValidationRule[] = [];

  if (!column.nullable) {
    rules.push({ type: 'required', message: `${column.name} is required` });
  }

  // Add type-specific validation rules
  if (column.type === 'email') {
    rules.push({ type: 'email', message: 'Must be a valid email address' });
  }

  if (column.type === 'url') {
    rules.push({ type: 'url', message: 'Must be a valid URL' });
  }

  return rules;
}

function generateColumnValidationString(column: ColumnSchema): string {
  const rules = generateColumnValidation(column);
  return rules.map(rule => `${rule.type}${rule.value ? `(${rule.value})` : ''}`).join(' | ');
}

async function generateTransformationFunction(
  transform: any,
  dataSchema: DataSchema
): Promise<TransformationFunction> {
  let implementation = '';

  switch (transform.logic.type) {
    case 'map':
      implementation = `
const ${transform.name} = (data: ${transform.inputType}): ${transform.outputType} => {
  ${transform.logic.customCode || '// Custom mapping logic here'}
  return data; // Placeholder
};`;
      break;

    case 'filter':
      implementation = `
const ${transform.name} = (data: ${transform.inputType}): ${transform.outputType} => {
  ${transform.logic.customCode || '// Custom filtering logic here'}
  return data; // Placeholder
};`;
      break;

    case 'custom':
      implementation = transform.logic.customCode || `
const ${transform.name} = (data: ${transform.inputType}): ${transform.outputType} => {
  // Custom transformation logic
  return data as ${transform.outputType};
};`;
      break;

    default:
      implementation = `
const ${transform.name} = (data: ${transform.inputType}): ${transform.outputType} => {
  // ${transform.description}
  return data as ${transform.outputType};
};`;
  }

  return {
    name: transform.name,
    inputType: transform.inputType,
    outputType: transform.outputType,
    implementation,
    description: transform.description,
  };
}

async function performBindingValidation(
  binding: GeneratedBinding,
  requirements: any,
  apiSchema: any,
  validationLevel: string
) {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  for (const requiredField of requirements.requiredFields) {
    const binding_field = binding.dataBindings.dataFields.find(f => f.name === requiredField);
    if (!binding_field) {
      if (validationLevel === 'strict') {
        errors.push(`Required field '${requiredField}' not found in data binding`);
      } else {
        warnings.push(`Required field '${requiredField}' not found in data binding`);
      }
    }
  }

  // Check data types
  for (const [fieldName, expectedType] of Object.entries(requirements.dataTypes)) {
    const bindingField = binding.dataBindings.dataFields.find(f => f.name === fieldName);
    if (bindingField && bindingField.type !== expectedType) {
      if (validationLevel === 'strict') {
        errors.push(`Field '${fieldName}' type mismatch: expected ${expectedType}, got ${bindingField.type}`);
      } else {
        warnings.push(`Field '${fieldName}' type mismatch: expected ${expectedType}, got ${bindingField.type}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      fieldsChecked: requirements.requiredFields.length,
      typesChecked: Object.keys(requirements.dataTypes).length,
      errorsFound: errors.length,
      warningsFound: warnings.length,
    },
  };
}

function generateValidationRecommendations(validationResult: any): string[] {
  const recommendations: string[] = [];

  if (validationResult.errors.length > 0) {
    recommendations.push('Fix validation errors before proceeding with component generation');
  }

  if (validationResult.warnings.length > 0) {
    recommendations.push('Review validation warnings for potential issues');
  }

  if (validationResult.summary.typesChecked === 0) {
    recommendations.push('Consider adding type validation for better type safety');
  }

  return recommendations;
}

function extractApiEndpoints(schemaSource: any): string[] {
  const endpoints: string[] = [];

  if (schemaSource.connectionConfig?.endpoint) {
    endpoints.push(schemaSource.connectionConfig.endpoint);
  }

  return endpoints;
}

function calculateBindingComplexity(dataSchema: DataSchema, bindingConfig: any): 'low' | 'medium' | 'high' {
  let score = 0;

  score += dataSchema.tables.length * 2;
  score += dataSchema.relationships.length * 3;
  score += dataSchema.enums.length;
  score += dataSchema.functions.length * 2;

  if (bindingConfig.includeRelationships) score += 5;
  if (bindingConfig.generateCrudOperations) score += 3;
  if (bindingConfig.includeValidation) score += 2;
  if (bindingConfig.includeTransformations) score += 4;

  if (score <= 10) return 'low';
  if (score <= 25) return 'medium';
  return 'high';
}

function recalculateBindingComplexity(binding: GeneratedBinding, newTransformations: TransformationFunction[]): 'low' | 'medium' | 'high' {
  // Simplified recalculation
  const currentComplexity = binding.metadata.complexity;
  const addedComplexity = newTransformations.length > 5 ? 'high' : newTransformations.length > 2 ? 'medium' : 'low';

  if (currentComplexity === 'high' || addedComplexity === 'high') return 'high';
  if (currentComplexity === 'medium' || addedComplexity === 'medium') return 'medium';
  return 'low';
}

function estimateBindingSize(propInterface: TypeScriptInterface, dataBindings: ComponentDataBinding): number {
  return propInterface.properties.length * 100 + dataBindings.dataFields.length * 50;
}

function extractDependencies(dataSchema: DataSchema, bindingConfig: any): string[] {
  const dependencies = ['react', 'zod'];

  if (bindingConfig.includeValidation) {
    dependencies.push('@hookform/resolvers', 'react-hook-form');
  }

  if (dataSchema.functions.length > 0) {
    dependencies.push('@supabase/supabase-js');
  }

  return dependencies;
}

// String utility functions
function pascalCase(str: string): string {
  return str.replace(/(^\w|_\w)/g, (match) => match.replace('_', '').toUpperCase());
}

function camelCase(str: string): string {
  return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

// ============================================================================
// Export Tools Array
// ============================================================================

export const dataBindingGeneratorTools = [
  analyzeApiSchemaAndGenerateBindings,
  generateCustomDataTransformations,
  validateDataBindingCompatibility,
];

// Export tool metadata for registration
export const dataBindingGeneratorToolsMetadata = {
  category: 'data-binding-generator',
  description: 'Advanced data binding and prop interface generation for React components with API schema analysis',
  totalTools: dataBindingGeneratorTools.length,
  capabilities: [
    'schema_analysis',
    'supabase_integration',
    'postgres_analysis',
    'api_spec_parsing',
    'typescript_interface_generation',
    'data_binding_generation',
    'validation_schema_generation',
    'transformation_functions',
    'relationship_mapping',
    'enum_handling',
    'crud_operation_binding',
    'compatibility_validation',
    'custom_field_support',
    'type_safety',
    'code_generation',
  ],
};

rootLogger.info('Data binding generator tools initialized', {
  totalTools: dataBindingGeneratorTools.length,
  capabilities: dataBindingGeneratorToolsMetadata.capabilities,
});