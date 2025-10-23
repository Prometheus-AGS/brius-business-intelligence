/**
 * Visualization API Routes
 * Provides CORS-enabled endpoints for serving generated visualization components
 * Supports the loader pattern architecture with runtime component loading
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { etag } from 'hono/etag';
import { cache } from 'hono/cache';
import { z } from 'zod';
import { biContextStore } from '../../memory/context-store.js';
import { biSessionManager } from '../../memory/session-manager.js';
import { biContextTracer } from '../../observability/context-tracer.js';
import {
  ComponentRegistry,
  EnhancedVisualizationArtifact,
  ComponentLoadResponse,
  ComponentServeRequest,
  ComponentServeResponse,
  DEFAULT_CORS_CONFIG,
  LOADER_CONSTANTS,
} from '../../types/visualization.js';
import { getUserContext, hasPermission } from '../middleware/jwt-context.js';
import { rootLogger } from '../../observability/logger.js';
import { withErrorHandling } from '../../observability/error-handling.js';

// ============================================================================
// API Route Schemas
// ============================================================================

const ComponentServeRequestSchema = z.object({
  artifactId: z.string().uuid().describe('Artifact ID to serve'),
  version: z.string().optional().describe('Specific version to serve'),
  theme: z.enum(['light', 'dark']).optional().describe('Theme variant'),
  format: z.enum(['tsx', 'js', 'bundle']).default('tsx').describe('Response format'),
  minify: z.boolean().default(false).describe('Minify the response'),
  includeStyles: z.boolean().default(true).describe('Include CSS styles in response'),
  includeTypes: z.boolean().default(false).describe('Include TypeScript definitions'),
});

const ComponentListRequestSchema = z.object({
  sessionId: z.string().uuid().optional().describe('Session ID for user-scoped components'),
  limit: z.number().min(1).max(100).default(20).describe('Maximum components to return'),
  offset: z.number().min(0).default(0).describe('Offset for pagination'),
  visualizationType: z.enum(['bar-chart', 'line-chart', 'pie-chart', 'table', 'scatter-plot', 'heatmap', 'dashboard']).optional(),
  sortBy: z.enum(['created', 'name', 'size', 'usage']).default('created').describe('Sort order'),
  sortDirection: z.enum(['asc', 'desc']).default('desc').describe('Sort direction'),
});

const ComponentMetadataRequestSchema = z.object({
  artifactId: z.string().uuid().describe('Artifact ID for metadata'),
  includeUsageStats: z.boolean().default(false).describe('Include usage statistics'),
  includePerformanceMetrics: z.boolean().default(false).describe('Include performance data'),
});

// ============================================================================
// Visualization API Routes
// ============================================================================

export function getVisualizationRoutes() {
  return [

    /**
     * GET /api/v1/components/:artifactId
     * Serve a specific component by artifact ID with loader pattern support
     */
    registerApiRoute('/api/v1/components/:artifactId', {
      method: 'GET',
      handler: async (c) => {
  try {
    const artifactId = c.req.param('artifactId');
    const query = c.req.query();

    // Validate query parameters
    const request = ComponentServeRequestSchema.safeParse({
      artifactId,
      ...query,
    });

    if (!request.success) {
      return c.json({
        success: false,
        error: 'Invalid request parameters',
        details: request.error.issues,
      }, 400);
    }

    const { version, theme, format, minify, includeStyles, includeTypes } = request.data;

    rootLogger.info('Serving component', {
      artifactId,
      format,
      theme,
      minify,
      userAgent: c.req.header('User-Agent'),
      origin: c.req.header('Origin'),
    });

    // Search for component in registry across all sessions
    // Note: This searches globally to enable cross-session component sharing
    const registryResults = await searchComponentRegistry(artifactId);

    if (registryResults.length === 0) {
      return c.json({
        success: false,
        error: {
          code: 'COMPONENT_NOT_FOUND',
          message: `Component with artifact ID ${artifactId} not found`,
          fallback: generateFallbackComponent(artifactId),
        },
        metadata: {
          version: 'unknown',
          cacheHeaders: {
            'Cache-Control': 'no-cache',
          },
          size: 0,
        },
      }, 404);
    }

    const registry = JSON.parse(registryResults[0].content) as ComponentRegistry;

    // Check if component has expired
    if (new Date() > new Date(registry.expiryTime)) {
      return c.json({
        success: false,
        error: {
          code: 'COMPONENT_EXPIRED',
          message: `Component has expired`,
          fallback: generateFallbackComponent(artifactId),
        },
        metadata: {
          version: registry.version,
          cacheHeaders: {
            'Cache-Control': 'no-cache',
          },
          size: registry.fullComponentCode.length,
        },
      }, 410);
    }

    // Prepare component response based on format
    let componentCode = registry.fullComponentCode;
    let styles = '';
    let types = '';

    // Apply theme modifications if requested
    if (theme) {
      componentCode = applyThemeToComponent(componentCode, theme, registry);
    }

    // Include styles if requested
    if (includeStyles) {
      styles = registry.styleBundle.tailwindCSS + '\n' + registry.styleBundle.customCSS;
    }

    // Include types if requested
    if (includeTypes) {
      types = registry.typeDefinitions;
    }

    // Apply minification if requested
    if (minify) {
      componentCode = minifyCode(componentCode);
      styles = minifyCSS(styles);
    }

    // Format response based on requested format
    let responseContent: any;
    let contentType = 'application/json';

    switch (format) {
      case 'tsx':
        responseContent = {
          success: true,
          component: {
            code: componentCode,
            styles: styles,
            types: types,
            shadcnComponents: registry.shadcnComponents,
          },
          metadata: {
            version: registry.version,
            cacheHeaders: {
              'Cache-Control': 'public, max-age=3600',
              'ETag': generateETag(componentCode),
            },
            size: componentCode.length,
          },
        };
        break;

      case 'js':
        // Return pre-compiled JavaScript if available
        responseContent = {
          success: true,
          component: {
            code: registry.precompiledJS || componentCode,
            styles: styles,
            shadcnComponents: registry.shadcnComponents,
          },
          metadata: {
            version: registry.version,
            cacheHeaders: {
              'Cache-Control': 'public, max-age=3600',
              'ETag': generateETag(registry.precompiledJS || componentCode),
            },
            size: (registry.precompiledJS || componentCode).length,
          },
        };
        break;

      case 'bundle':
        // Return complete bundle with everything embedded
        const bundleCode = createCompleteBundle(registry, includeStyles, includeTypes);
        responseContent = bundleCode;
        contentType = 'application/javascript';
        break;
    }

    // Set response headers
    const etag = responseContent.metadata?.cacheHeaders?.ETag || generateETag(JSON.stringify(responseContent));
    c.header('ETag', etag);
    c.header('Cache-Control', 'public, max-age=3600');
    c.header('X-Component-Version', registry.version);
    c.header('X-Bundle-Size', responseContent.metadata?.size?.toString() || '0');
    c.header('X-Load-Time', Date.now().toString());

    // Check if client has cached version
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch === etag) {
      return c.body(null, 304);
    }

    // Trace component serving
    await traceComponentServing(artifactId, format, {
      userAgent: c.req.header('User-Agent') || 'unknown',
      origin: c.req.header('Origin') || 'unknown',
      responseSize: JSON.stringify(responseContent).length,
      cacheHit: false,
    });

    return c.json(responseContent, 200, {
      'Content-Type': contentType,
    });

  } catch (error) {
    rootLogger.error('Failed to serve component', {
      artifactId: c.req.param('artifactId'),
      error: (error as Error).message,
    });

    return c.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to serve component',
        fallback: generateFallbackComponent(c.req.param('artifactId')),
      },
      metadata: {
        version: 'unknown',
        cacheHeaders: {
          'Cache-Control': 'no-cache',
        },
        size: 0,
      },
    }, 500);
  }
});

/**
 * GET /api/v1/components/:artifactId/package
 * Download complete component package
 */
visualizationRoutes.get('/api/v1/components/:artifactId/package', async (c) => {
  try {
    const artifactId = c.req.param('artifactId');
    const format = c.req.query('format') || 'json';

    rootLogger.info('Serving component package', {
      artifactId,
      format,
      origin: c.req.header('Origin'),
    });

    // Find component registry
    const registryResults = await searchComponentRegistry(artifactId);

    if (registryResults.length === 0) {
      return c.json({
        success: false,
        error: 'Component not found',
      }, 404);
    }

    const registry = JSON.parse(registryResults[0].content) as ComponentRegistry;

    // Generate complete package
    const componentPackage = {
      component: registry.fullComponentCode,
      types: registry.typeDefinitions,
      styles: registry.styleBundle.tailwindCSS + '\n' + registry.styleBundle.customCSS,
      packageJson: generatePackageJson(registry),
      readme: generateReadme(registry),
      example: generateUsageExample(registry),
      shadcnComponents: registry.shadcnComponents,
      theme: registry.styleBundle.themeConfig,
    };

    // Set download headers
    const filename = `${registry.componentName.toLowerCase()}-component.${format}`;
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Type', format === 'json' ? 'application/json' : 'application/zip');

    // Trace package download
    await traceComponentServing(artifactId, 'package', {
      userAgent: c.req.header('User-Agent') || 'unknown',
      origin: c.req.header('Origin') || 'unknown',
      responseSize: JSON.stringify(componentPackage).length,
      cacheHit: false,
    });

    return c.json({
      success: true,
      package: componentPackage,
      downloadInfo: {
        format,
        totalSize: JSON.stringify(componentPackage).length,
        filesIncluded: Object.keys(componentPackage).length,
        filename,
      },
    });

  } catch (error) {
    rootLogger.error('Failed to serve component package', {
      artifactId: c.req.param('artifactId'),
      error: (error as Error).message,
    });

    return c.json({
      success: false,
      error: 'Failed to serve component package',
      details: (error as Error).message,
    }, 500);
  }
});

/**
 * GET /api/v1/components/:artifactId/metadata
 * Get component metadata and information
 */
visualizationRoutes.get('/api/v1/components/:artifactId/metadata', async (c) => {
  try {
    const artifactId = c.req.param('artifactId');
    const query = c.req.query();

    const request = ComponentMetadataRequestSchema.safeParse({
      artifactId,
      ...query,
    });

    if (!request.success) {
      return c.json({
        success: false,
        error: 'Invalid request parameters',
        details: request.error.issues,
      }, 400);
    }

    const { includeUsageStats, includePerformanceMetrics } = request.data;

    // Find component registry
    const registryResults = await searchComponentRegistry(artifactId);

    if (registryResults.length === 0) {
      return c.json({
        success: false,
        error: 'Component not found',
      }, 404);
    }

    const registry = JSON.parse(registryResults[0].content) as ComponentRegistry;

    const metadata: any = {
      artifactId: registry.artifactId,
      componentName: registry.componentName,
      version: registry.version,
      expiryTime: registry.expiryTime,
      createdAt: new Date(registry.expiryTime.getTime() - 24 * 60 * 60 * 1000), // Assuming 24h validity
      size: {
        fullComponent: registry.fullComponentCode.length,
        precompiled: registry.precompiledJS?.length || 0,
        styles: (registry.styleBundle.tailwindCSS + registry.styleBundle.customCSS).length,
        types: registry.typeDefinitions.length,
      },
      shadcnComponents: registry.shadcnComponents.map(c => ({
        name: c.componentName,
        version: c.version,
        dependencies: c.dependencies,
      })),
      dependencies: registry.dependencies.map(d => ({
        name: d.name,
        version: d.version,
        source: d.source,
      })),
      theme: {
        dark: registry.styleBundle.themeConfig.dark,
        radius: registry.styleBundle.themeConfig.radius,
        primaryColor: registry.styleBundle.themeConfig.colors.primary,
      },
    };

    // Add usage stats if requested
    if (includeUsageStats) {
      metadata.usageStats = await getComponentUsageStats(artifactId);
    }

    // Add performance metrics if requested
    if (includePerformanceMetrics) {
      metadata.performanceMetrics = await getComponentPerformanceMetrics(artifactId);
    }

    return c.json({
      success: true,
      metadata,
    });

  } catch (error) {
    rootLogger.error('Failed to serve component metadata', {
      artifactId: c.req.param('artifactId'),
      error: (error as Error).message,
    });

    return c.json({
      success: false,
      error: 'Failed to serve component metadata',
      details: (error as Error).message,
    }, 500);
  }
});

// ============================================================================
// Component Discovery Routes
// ============================================================================

/**
 * GET /api/v1/components
 * List available components with pagination and filtering
 */
visualizationRoutes.get('/api/v1/components', async (c) => {
  try {
    const query = c.req.query();

    const request = ComponentListRequestSchema.safeParse(query);

    if (!request.success) {
      return c.json({
        success: false,
        error: 'Invalid request parameters',
        details: request.error.issues,
      }, 400);
    }

    const { sessionId, limit, offset, visualizationType, sortBy, sortDirection } = request.data;

    rootLogger.info('Listing components', {
      sessionId,
      limit,
      offset,
      visualizationType,
      sortBy,
      origin: c.req.header('Origin'),
    });

    // Search for components
    const components = await listComponents({
      sessionId,
      limit,
      offset,
      visualizationType,
      sortBy,
      sortDirection,
    });

    return c.json({
      success: true,
      components: components.items,
      pagination: {
        limit,
        offset,
        total: components.total,
        hasMore: offset + limit < components.total,
      },
      filters: {
        visualizationType,
        sortBy,
        sortDirection,
      },
    });

  } catch (error) {
    rootLogger.error('Failed to list components', {
      error: (error as Error).message,
    });

    return c.json({
      success: false,
      error: 'Failed to list components',
      details: (error as Error).message,
    }, 500);
  }
});

/**
 * GET /api/v1/health
 * Health check endpoint
 */
visualizationRoutes.get('/api/v1/health', async (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: LOADER_CONSTANTS.API_VERSION,
    cors: {
      enabled: true,
      allowOrigin: '*',
      allowMethods: wideOpenCorsConfig.allowMethods,
    },
    cache: {
      enabled: true,
      maxAge: 3600,
    },
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

async function searchComponentRegistry(artifactId: string): Promise<any[]> {
  try {
    // Search across all sessions for the component registry
    // This is a global search to enable cross-session component sharing
    const results = await biContextStore.searchGlobalContextMemories(artifactId, {
      category: 'component-registry',
      topK: 1,
      similarityThreshold: 0.9,
    });

    return results.filter(result => {
      try {
        const registry = JSON.parse(result.content);
        return registry.artifactId === artifactId;
      } catch {
        return false;
      }
    });
  } catch (error) {
    rootLogger.error('Failed to search component registry', {
      artifactId,
      error: (error as Error).message,
    });
    return [];
  }
}

async function listComponents(options: {
  sessionId?: string;
  limit: number;
  offset: number;
  visualizationType?: string;
  sortBy: string;
  sortDirection: string;
}): Promise<{ items: any[]; total: number }> {
  try {
    const searchTerm = options.visualizationType || 'component-registry';
    const searchOptions = {
      category: 'component-registry',
      topK: options.limit * 2, // Get more for filtering
      similarityThreshold: 0.3,
    };

    let results;
    if (options.sessionId) {
      results = await biContextStore.searchContextMemories(options.sessionId, searchTerm, searchOptions);
    } else {
      results = await biContextStore.searchGlobalContextMemories(searchTerm, searchOptions);
    }

    const components = results
      .map(result => {
        try {
          const registry = JSON.parse(result.content) as ComponentRegistry;
          return {
            artifactId: registry.artifactId,
            componentName: registry.componentName,
            version: registry.version,
            createdAt: new Date(registry.expiryTime.getTime() - 24 * 60 * 60 * 1000),
            expiryTime: registry.expiryTime,
            size: registry.fullComponentCode.length,
            shadcnComponents: registry.shadcnComponents.length,
            visualizationType: extractVisualizationType(registry.componentName),
            theme: registry.styleBundle.themeConfig.dark ? 'dark' : 'light',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(component => {
        if (options.visualizationType && component.visualizationType !== options.visualizationType) {
          return false;
        }
        return new Date() < new Date(component.expiryTime); // Filter expired components
      });

    // Sort components
    components.sort((a, b) => {
      let aValue, bValue;

      switch (options.sortBy) {
        case 'name':
          aValue = a.componentName.toLowerCase();
          bValue = b.componentName.toLowerCase();
          break;
        case 'size':
          aValue = a.size;
          bValue = b.size;
          break;
        case 'created':
        default:
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
      }

      if (options.sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    // Apply pagination
    const paginatedComponents = components.slice(options.offset, options.offset + options.limit);

    return {
      items: paginatedComponents,
      total: components.length,
    };
  } catch (error) {
    rootLogger.error('Failed to list components', {
      error: (error as Error).message,
    });
    return { items: [], total: 0 };
  }
}

function extractVisualizationType(componentName: string): string {
  const name = componentName.toLowerCase();
  if (name.includes('bar')) return 'bar-chart';
  if (name.includes('line')) return 'line-chart';
  if (name.includes('pie')) return 'pie-chart';
  if (name.includes('table')) return 'table';
  if (name.includes('scatter')) return 'scatter-plot';
  if (name.includes('heatmap')) return 'heatmap';
  if (name.includes('dashboard')) return 'dashboard';
  return 'unknown';
}

function applyThemeToComponent(code: string, theme: string, registry: ComponentRegistry): string {
  // Apply theme-specific modifications to the component code
  if (theme === 'dark') {
    // Replace theme colors with dark theme variants
    const darkColors = {
      ...registry.styleBundle.themeConfig.colors,
      background: 'hsl(240 10% 3.9%)',
      foreground: 'hsl(0 0% 98%)',
      primary: 'hsl(0 0% 98%)',
      secondary: 'hsl(240 3.7% 15.9%)',
    };

    let themedCode = code;
    for (const [key, value] of Object.entries(darkColors)) {
      themedCode = themedCode.replace(
        new RegExp(`--${key}:\\s*[^;]+;`, 'g'),
        `--${key}: ${value};`
      );
    }

    return themedCode;
  }

  return code;
}

function minifyCode(code: string): string {
  // Basic code minification
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .replace(/\/\/.*$/gm, '') // Remove single-line comments
    .replace(/^\s+/gm, '') // Remove leading whitespace
    .replace(/\s+$/gm, '') // Remove trailing whitespace
    .replace(/\n+/g, '\n') // Collapse multiple newlines
    .trim();
}

function minifyCSS(css: string): string {
  // Basic CSS minification
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/;\s*}/g, '}') // Remove unnecessary semicolons
    .replace(/\s*{\s*/g, '{') // Remove spaces around braces
    .replace(/}\s*/g, '}') // Remove spaces after braces
    .trim();
}

function generateETag(content: string): string {
  // Simple ETag generation based on content hash
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

function createCompleteBundle(
  registry: ComponentRegistry,
  includeStyles: boolean,
  includeTypes: boolean
): string {
  let bundle = '';

  // Add styles if requested
  if (includeStyles) {
    bundle += `/* Styles */\n`;
    bundle += `const styles = document.createElement('style');\n`;
    bundle += `styles.textContent = ${JSON.stringify(registry.styleBundle.tailwindCSS + '\n' + registry.styleBundle.customCSS)};\n`;
    bundle += `document.head.appendChild(styles);\n\n`;
  }

  // Add component code
  bundle += `/* Component */\n`;
  bundle += registry.fullComponentCode;
  bundle += `\n\n`;

  // Add export
  bundle += `export default ${registry.componentName};\n`;

  return bundle;
}

function generatePackageJson(registry: ComponentRegistry): string {
  const dependencies = registry.dependencies.reduce((acc, dep) => {
    acc[dep.name] = dep.version;
    return acc;
  }, {} as Record<string, string>);

  return JSON.stringify({
    name: registry.componentName.toLowerCase(),
    version: registry.version,
    description: `Generated ${registry.componentName} visualization component`,
    main: `${registry.componentName}.tsx`,
    types: `${registry.componentName}.d.ts`,
    dependencies,
    peerDependencies: {
      react: "^18.0.0",
      "@types/react": "^18.0.0"
    }
  }, null, 2);
}

function generateReadme(registry: ComponentRegistry): string {
  return `# ${registry.componentName}

Generated visualization component with shadcn-ui integration.

## Usage

\`\`\`tsx
import ${registry.componentName} from './${registry.componentName}';

const data = [
  // Your data here
];

export default function App() {
  return <${registry.componentName} data={data} />;
}
\`\`\`

## Shadcn-UI Components Used

${registry.shadcnComponents.map(c => `- ${c.componentName}`).join('\n')}

## Dependencies

${registry.dependencies.map(d => `- ${d.name}@${d.version}`).join('\n')}

Generated with Mastra Business Intelligence framework.
`;
}

function generateUsageExample(registry: ComponentRegistry): string {
  return `import React from 'react';
import ${registry.componentName} from './${registry.componentName}';

// Sample data for your component
const sampleData = [
  // Add your data here
];

export default function Example() {
  return (
    <div style={{ padding: '20px' }}>
      <h1>${registry.componentName} Example</h1>
      <${registry.componentName}
        data={sampleData}
        // Component will load with embedded shadcn-ui styling
      />
    </div>
  );
}`;
}

function generateFallbackComponent(artifactId: string): string {
  return `const FallbackComponent = ({ data = [], ...props }) => (
  <div style={{
    padding: '20px',
    border: '2px dashed #ccc',
    borderRadius: '8px',
    textAlign: 'center',
    minHeight: '200px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  }}>
    <h3>Component Not Available</h3>
    <p>Artifact ID: ${artifactId}</p>
    <p>Component could not be loaded</p>
    <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
      <small>This is a fallback component</small>
    </div>
  </div>
);

export default FallbackComponent;`;
}

async function getComponentUsageStats(artifactId: string): Promise<any> {
  // Simulated usage stats - in production this would query actual usage data
  return {
    totalLoads: Math.floor(Math.random() * 1000) + 100,
    uniqueOrigins: Math.floor(Math.random() * 50) + 10,
    averageLoadTime: Math.floor(Math.random() * 2000) + 500,
    lastAccessed: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
    popularBrowsers: [
      { name: 'Chrome', percentage: 65 },
      { name: 'Firefox', percentage: 20 },
      { name: 'Safari', percentage: 10 },
      { name: 'Edge', percentage: 5 },
    ],
  };
}

async function getComponentPerformanceMetrics(artifactId: string): Promise<any> {
  // Simulated performance metrics
  return {
    bundleSize: Math.floor(Math.random() * 50000) + 10000,
    gzippedSize: Math.floor(Math.random() * 20000) + 5000,
    parseTime: Math.floor(Math.random() * 100) + 10,
    renderTime: Math.floor(Math.random() * 50) + 5,
    memoryUsage: Math.floor(Math.random() * 10) + 2,
    cacheHitRate: Math.floor(Math.random() * 40) + 60,
    errorRate: Math.random() * 0.05,
  };
}

async function traceComponentServing(
  artifactId: string,
  format: string,
  metadata: {
    userAgent: string;
    origin: string;
    responseSize: number;
    cacheHit: boolean;
  }
): Promise<void> {
  try {
    await biContextTracer.traceMemoryOperation('global', 'component_serving', {
      artifactId,
      format,
      userAgent: metadata.userAgent,
      origin: metadata.origin,
      responseSize: metadata.responseSize,
      cacheHit: metadata.cacheHit,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    rootLogger.warn('Failed to trace component serving', {
      artifactId,
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// Export Routes and Metadata
// ============================================================================

export const visualizationRoutesMetadata = {
  name: 'visualization-routes',
  description: 'CORS-enabled API routes for serving generated visualization components',
  basePath: '/api/v1',
  endpoints: [
    'GET /api/v1/components/:artifactId',
    'GET /api/v1/components/:artifactId/package',
    'GET /api/v1/components/:artifactId/metadata',
    'GET /api/v1/components',
    'GET /api/v1/health',
  ],
  cors: {
    enabled: true,
    allowOrigin: '*',
    allowMethods: wideOpenCorsConfig.allowMethods,
    allowHeaders: wideOpenCorsConfig.allowHeaders,
    maxAge: wideOpenCorsConfig.maxAge,
  },
  caching: {
    enabled: true,
    maxAge: 3600,
    etagSupport: true,
  },
  capabilities: [
    'component_serving',
    'package_download',
    'metadata_retrieval',
    'component_discovery',
    'wide_open_cors',
    'caching',
    'etag_support',
    'theme_switching',
    'minification',
    'usage_analytics',
    'performance_metrics',
    'fallback_handling',
  ],
};

rootLogger.info('Visualization API routes initialized', {
  basePath: visualizationRoutesMetadata.basePath,
  endpoints: visualizationRoutesMetadata.endpoints.length,
  corsEnabled: visualizationRoutesMetadata.cors.enabled,
  capabilities: visualizationRoutesMetadata.capabilities,
});