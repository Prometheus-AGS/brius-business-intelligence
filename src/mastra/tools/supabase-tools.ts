/**
 * Custom Supabase Tools
 * Direct integration with Supabase using @supabase/supabase-js
 * Replaces the Supabase MCP server with custom tools that match the same signatures
 * but without requiring project_id parameter
 */

import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/environment.js';
import { rootLogger } from '../observability/logger.js';

// Initialize Supabase client with service role key
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

/**
 * List all tables in the database schemas
 */
export const listTablesTools = {
  id: 'supabase-list-tables',
  description: 'List all tables in one or more schemas in the Supabase database',
  inputSchema: z.object({
    schemas: z.array(z.string()).optional().default(['public']).describe('List of schemas to include. Defaults to ["public"]'),
  }),
  execute: async (args: any = {}) => {
    const schemas = args.schemas || ['public'];
    const client = getSupabaseClient();

    try {
      // Add comprehensive logging for debugging
      console.log('🔍 [DEBUG] Starting Supabase table listing...');
      console.log('🔍 [DEBUG] Requested schemas:', schemas);
      console.log('🔍 [DEBUG] Environment check:');
      console.log('  - SUPABASE_URL from env object:', env.SUPABASE_URL ? '✅ Set' : '❌ Missing');
      console.log('  - SUPABASE_SERVICE_ROLE_KEY from env object:', env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
      console.log('  - SUPABASE_URL from process.env:', process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing');
      console.log('  - SUPABASE_SERVICE_ROLE_KEY from process.env:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');

      // Use the env object instead of process.env for consistency
      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in environment configuration');
      }

      console.log('🔍 [DEBUG] Making request to:', `${supabaseUrl}/rest/v1/`);

      // Since information_schema.tables isn't accessible via PostgREST in this setup,
      // we need to get table information from the Supabase public schema directly
      // Let's try to get all tables by querying the system tables available to us

      // First, let's try to use a workaround by checking what tables we can access
      // We'll use the REST API to introspect the schema
      const requestHeaders = {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };

      console.log('🔍 [DEBUG] Request headers:', {
        ...requestHeaders,
        'apikey': requestHeaders.apikey ? `${requestHeaders.apikey.substring(0, 10)}...` : 'Missing',
        'Authorization': requestHeaders.Authorization ? `Bearer ${requestHeaders.Authorization.substring(7, 17)}...` : 'Missing',
      });

      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        headers: requestHeaders,
      });

      console.log('🔍 [DEBUG] Response status:', response.status, response.statusText);
      console.log('🔍 [DEBUG] Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.log('🔍 [DEBUG] Error response body:', errorText);
        throw new Error(`Failed to fetch schema info: ${response.status} ${response.statusText}. Response: ${errorText}`);
      }

      const schemaInfo = await response.text();

      // Parse the OpenAPI spec to extract table names
      type TableInfo = {
        table_schema: string;
        table_name: string;
        table_type: string;
      };
      let tables: TableInfo[] = [];

      try {
        const openApiSpec = JSON.parse(schemaInfo);
        if (openApiSpec.definitions) {
          // Extract table names from OpenAPI definitions
          tables = Object.keys(openApiSpec.definitions)
            .filter(key => !key.includes('_') || key.startsWith('auth_') === false) // Filter out internal tables
            .map(tableName => ({
              table_schema: schemas.includes('public') ? 'public' : schemas[0] || 'public',
              table_name: tableName,
              table_type: 'BASE TABLE'
            }));
        }
      } catch (parseError) {
        // If parsing fails, we'll return a basic structure
        console.warn('Could not parse OpenAPI spec:', parseError);
      }

      // If we couldn't get tables from the OpenAPI spec, try some known system approaches
      if (tables.length === 0) {
        // Try to use exec_sql to create a function that returns table info, but since it only returns 'OK',
        // we'll need to provide a hardcoded response for common tables that might exist
        const commonTables = [
          // No hardcoded tables - all tables should be discovered dynamically
          // Foreign data wrapper tables and non-native tables should not be referenced here
        ];

        return {
          success: true,
          tables: commonTables,
          schemas: schemas,
          method: 'common_tables_fallback',
          note: 'Unable to introspect schema directly. Returning common table structure. Use execute_sql tool for specific queries.',
        };
      }

      return {
        success: true,
        tables: tables,
        schemas: schemas,
        method: 'openapi_introspection',
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        schemas: schemas,
        note: 'Schema introspection not available via PostgREST. Consider using execute_sql tool for DDL operations.',
      };
    }
  },
};

/**
 * Execute raw SQL query in the database
 */
export const executeSqlTool = {
  id: 'supabase-execute-sql',
  description: 'Execute raw SQL in the Supabase database using the exec_sql RPC function',
  inputSchema: z.object({
    query: z.string().describe('The SQL query to execute'),
  }),
  execute: async (args: any) => {
    const client = getSupabaseClient();
    const startTime = Date.now();
    const executionId = `sql_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Handle multiple parameter patterns
      let query: string;
      
      if (typeof args === 'string') {
        query = args;
      } else if (args && args.context && args.context.query) {
        // Mastra agent execution context
        query = args.context.query;
      } else if (args && args.query) {
        // Direct playground execution
        query = args.query;
      } else {
        query = '';
      }
      
      // Enhanced logging for debugging and observability (avoiding circular references)
      rootLogger.info('🔍 SUPABASE EXECUTE SQL TOOL CALLED', {
        execution_id: executionId,
        tool_id: 'supabase-execute-sql',
        args_type: typeof args,
        extracted_query: query,
        query_length: query.length,
        has_context: !!(args && args.context),
        timestamp: new Date().toISOString(),
      });

      console.log('🔍 [DEBUG] Execute SQL tool called with:', {
        executionId,
        extractedQuery: query,
        argType: typeof args,
        hasContext: !!(args && args.context),
        contextQuery: args && args.context ? args.context.query : 'N/A',
        directQuery: args && args.query ? args.query : 'N/A',
      });

      // Ensure query parameter is defined and is a string
      if (!query || typeof query !== 'string') {
        const errorResult = {
          success: false,
          error: 'Query parameter is required and must be a string',
          query: query || 'undefined',
          execution_id: executionId,
          debug: {
            extractedQuery: query,
            argType: typeof args,
            hasContext: !!(args && args.context),
            contextQuery: args && args.context ? args.context.query : 'N/A',
            directQuery: args && args.query ? args.query : 'N/A',
          },
        };

        rootLogger.error('❌ SUPABASE SQL EXECUTION FAILED - INVALID QUERY', {
          execution_id: executionId,
          tool_id: 'supabase-execute-sql',
          error: errorResult.error,
          execution_time_ms: Date.now() - startTime,
        });

        return errorResult;
      }

      // Execute the SQL using the enhanced exec_sql RPC function that returns JSON results
      rootLogger.info('🚀 EXECUTING SQL QUERY', {
        execution_id: executionId,
        tool_id: 'supabase-execute-sql',
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        query_length: query.length,
      });

      const { data, error } = await client.rpc('exec_sql', {
        sql: query.trim()
      });

      const executionTime = Date.now() - startTime;

      if (error) {
        const errorResult = {
          success: false,
          error: `SQL execution failed: ${error.message}`,
          query: query,
          execution_id: executionId,
          execution_time_ms: executionTime,
        };

        rootLogger.error('❌ SUPABASE SQL EXECUTION FAILED - DATABASE ERROR', {
          execution_id: executionId,
          tool_id: 'supabase-execute-sql',
          error: error.message,
          query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
          execution_time_ms: executionTime,
        });

        return errorResult;
      }

      const successResult = {
        success: true,
        result: data,
        query: query,
        execution_id: executionId,
        execution_time_ms: executionTime,
        note: 'SQL executed successfully via enhanced exec_sql RPC function',
        message: `Query executed successfully. Results: ${JSON.stringify(data)}. Please interpret these results and provide a clear answer to the user's question.`,
      };

      // Comprehensive success logging
      rootLogger.info('✅ SUPABASE SQL EXECUTION SUCCESSFUL', {
        execution_id: executionId,
        tool_id: 'supabase-execute-sql',
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        result_type: Array.isArray(data) ? 'array' : typeof data,
        result_length: Array.isArray(data) ? data.length : 1,
        result_preview: JSON.stringify(data).substring(0, 500) + (JSON.stringify(data).length > 500 ? '...' : ''),
        execution_time_ms: executionTime,
        success: true,
      });

      console.log('✅ [SUCCESS] SQL execution completed:', {
        executionId,
        query: query.substring(0, 100) + '...',
        resultType: Array.isArray(data) ? 'array' : typeof data,
        resultLength: Array.isArray(data) ? data.length : 1,
        executionTime: `${executionTime}ms`,
        success: true,
      });

      return successResult;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        query: args?.query || 'undefined',
        execution_id: executionId,
        execution_time_ms: executionTime,
        note: 'Make sure the "exec_sql" RPC function is available in your Supabase project',
        debug: {
          errorStack: error instanceof Error ? error.stack : undefined,
        },
      };

      rootLogger.error('❌ SUPABASE SQL EXECUTION FAILED - EXCEPTION', {
        execution_id: executionId,
        tool_id: 'supabase-execute-sql',
        error: error instanceof Error ? error.message : String(error),
        query: args?.query || 'undefined',
        execution_time_ms: executionTime,
        error_stack: error instanceof Error ? error.stack : undefined,
      });

      return errorResult;
    }
  },
};

/**
 * List all database extensions
 */
export const listExtensionsTool = {
  id: 'supabase-list-extensions',
  description: 'List all extensions installed in the Supabase database',
  inputSchema: z.object({}),
  execute: async () => {
    const client = getSupabaseClient();

    try {
      const { data, error } = await client.rpc('exec_sql', {
        sql: `
          SELECT
            extname as name,
            extversion as version,
            nspname as schema,
            extrelocatable as relocatable,
            extowner::regrole as owner
          FROM pg_extension
          JOIN pg_namespace ON pg_extension.extnamespace = pg_namespace.oid
          ORDER BY extname
        `
      });

      if (error) {
        throw new Error(`Failed to list extensions: ${error.message}`);
      }

      return {
        success: true,
        extensions: data || [],
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * List all database migrations
 */
export const listMigrationsTool = {
  id: 'supabase-list-migrations',
  description: 'List all applied migrations in the Supabase database',
  inputSchema: z.object({}),
  execute: async () => {
    const client = getSupabaseClient();

    try {
      // Try to query the migrations table - different projects may have different setups
      const { data, error } = await client.rpc('exec_sql', {
        sql: `
          SELECT
            version,
            name,
            applied_at
          FROM supabase_migrations.schema_migrations
          ORDER BY version DESC
          LIMIT 100
        `
      });

      if (error) {
        // If supabase_migrations doesn't exist, try alternative approach
        const { data: altData, error: altError } = await client.rpc('exec_sql', {
          sql: `
            SELECT
              schemaname as schema,
              tablename as table_name,
              tableowner as owner
            FROM pg_tables
            WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            ORDER BY schemaname, tablename
          `
        });

        if (altError) {
          throw new Error(`Failed to list migrations: ${error.message}`);
        }

        return {
          success: true,
          migrations: [],
          note: 'No migrations table found, showing database tables instead',
          tables: altData || [],
        };
      }

      return {
        success: true,
        migrations: data || [],
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Apply a database migration
 */
export const applyMigrationTool = {
  id: 'supabase-apply-migration',
  description: 'Apply a database migration to the Supabase database',
  inputSchema: z.object({
    name: z.string().describe('The name of the migration in snake_case'),
    query: z.string().describe('The SQL migration query to apply'),
  }),
  execute: async (args: any) => {
    const { name, query } = args;
    const client = getSupabaseClient();

    try {
      // Execute the migration query
      const { data, error } = await client.rpc('exec_sql', {
        sql: query.trim()
      });

      if (error) {
        throw new Error(`Migration execution failed: ${error.message}`);
      }

      return {
        success: true,
        migration: {
          name,
          applied_at: new Date().toISOString(),
          query,
        },
        result: data,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        migration: {
          name,
          query,
        },
      };
    }
  },
};

/**
 * List all Edge Functions using Supabase Management API
 */
export const listEdgeFunctionsTool = {
  id: 'supabase-list-edge-functions',
  description: 'List all Edge Functions in the Supabase project',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const projectRef = env.SUPABASE_PROJECT_REF;
      const accessToken = env.SUPABASE_ACCESS_TOKEN;

      if (!projectRef || !accessToken) {
        return {
          success: false,
          error: 'SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN environment variables are required for Edge Functions management',
          functions: [],
          note: 'Configure your Supabase Management API credentials to use Edge Functions tools',
        };
      }

      const response = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/functions`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to list Edge Functions: ${response.status} ${response.statusText}. ${errorText}`,
          functions: [],
        };
      }

      const functions = await response.json();

      return {
        success: true,
        functions: functions,
        project_ref: projectRef,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        functions: [],
      };
    }
  },
};

/**
 * Get Edge Function details using Supabase Management API
 */
export const getEdgeFunctionTool = {
  id: 'supabase-get-edge-function',
  description: 'Get details of a specific Edge Function',
  inputSchema: z.object({
    function_slug: z.string().describe('The slug of the Edge Function'),
  }),
  execute: async (args: any) => {
    try {
      const { function_slug } = args;
      const projectRef = env.SUPABASE_PROJECT_REF;
      const accessToken = env.SUPABASE_ACCESS_TOKEN;

      if (!projectRef || !accessToken) {
        return {
          success: false,
          error: 'SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN environment variables are required for Edge Functions management',
          function_slug,
          note: 'Configure your Supabase Management API credentials to use Edge Functions tools',
        };
      }

      const response = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/functions/${function_slug}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to get Edge Function details: ${response.status} ${response.statusText}. ${errorText}`,
          function_slug,
        };
      }

      const functionDetails = await response.json();

      return {
        success: true,
        function: functionDetails,
        function_slug,
        project_ref: projectRef,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        function_slug: args?.function_slug || 'unknown',
      };
    }
  },
};

/**
 * Deploy Edge Function using Supabase Management API
 */
export const deployEdgeFunctionTool = {
  id: 'supabase-deploy-edge-function',
  description: 'Deploy an Edge Function to the Supabase project',
  inputSchema: z.object({
    name: z.string().describe('The name of the Edge Function'),
    files: z.array(z.object({
      name: z.string(),
      content: z.string(),
    })).describe('The files to upload for the function'),
    entrypoint_path: z.string().optional().default('index.ts').describe('The entrypoint file path'),
    import_map_path: z.string().optional().describe('The import map file path'),
  }),
  execute: async (args: any) => {
    try {
      const { name, files, entrypoint_path, import_map_path } = args;
      const projectRef = env.SUPABASE_PROJECT_REF;
      const accessToken = env.SUPABASE_ACCESS_TOKEN;

      if (!projectRef || !accessToken) {
        return {
          success: false,
          error: 'SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN environment variables are required for Edge Functions management',
          function_name: name,
          files_count: files.length,
          note: 'Configure your Supabase Management API credentials to use Edge Functions tools',
        };
      }

      // Create the function body for deployment
      const functionBody = {
        slug: name,
        name: name,
        source: files.find((f: { name: string; content: string }) => f.name === entrypoint_path)?.content || files[0]?.content,
        entrypoint_path: entrypoint_path || 'index.ts',
        import_map_path: import_map_path,
        verify_jwt: true,
      };

      const response = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/functions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(functionBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to deploy Edge Function: ${response.status} ${response.statusText}. ${errorText}`,
          function_name: name,
          files_count: files.length,
        };
      }

      const deploymentResult = await response.json();

      return {
        success: true,
        function: deploymentResult,
        function_name: name,
        files_count: files.length,
        project_ref: projectRef,
        note: 'Edge Function deployed successfully via Supabase Management API',
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        function_name: args?.name || 'unknown',
        files_count: args?.files?.length || 0,
      };
    }
  },
};

// Export all tools as an array for easy registration
export const supabaseTools = [
  listTablesTools,
  executeSqlTool,
  listExtensionsTool,
  listMigrationsTool,
  applyMigrationTool,
  listEdgeFunctionsTool,
  getEdgeFunctionTool,
  deployEdgeFunctionTool,
];
