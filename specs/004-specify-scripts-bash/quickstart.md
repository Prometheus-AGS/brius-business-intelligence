# Quickstart: Business Intelligence Context Enhancement

**Generated**: 2025-10-23 | **Feature**: Business Intelligence Context Enhancement

## Overview

This quickstart guide helps developers implement and test the enhanced BI context management system with JWT-based authentication, multi-domain analysis, and React component generation.

## Prerequisites

### Development Environment
- Node.js 20.9.0+
- TypeScript 5.0+
- PostgreSQL with pgvector 17 extension
- Docker (for local development)
- pnpm package manager

### Dependencies
```bash
# Core Mastra framework
pnpm add @mastra/core @mastra/loggers

# Database and storage
pnpm add pg drizzle-orm drizzle-kit pgvector

# Authentication and security
pnpm add jsonwebtoken @types/jsonwebtoken zod

# React component generation
pnpm add @babel/generator @babel/types typescript

# Testing
pnpm add -D vitest @vitest/ui jsdom
```

### Environment Configuration
```bash
# .env file
PGVECTOR_DATABASE_URL="postgresql://user:pass@localhost:5432/brius_bi"
JWT_SECRET="your-jwt-secret-key"
JWT_EXPIRY="8h"
LANGFUSE_PUBLIC_KEY="your-langfuse-public-key"
LANGFUSE_SECRET_KEY="your-langfuse-secret-key"
MASTRA_LOG_LEVEL="info"
```

## Quick Setup (10 minutes)

### 1. Database Initialization
```bash
# Create database with pgvector extension
psql -c "CREATE DATABASE brius_bi;"
psql -d brius_bi -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Run schema migrations
pnpm drizzle-kit migrate
```

### 2. Context Management Setup
```typescript
// src/mastra/types/context.ts
import { z } from 'zod';

export const UserContextSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  roleId: z.string(),
  departmentScope: z.array(z.string()),
  permissions: z.object({
    clinical: z.object({
      read: z.boolean(),
      query: z.boolean(),
      export: z.boolean(),
    }),
    financial: z.object({
      read: z.boolean(),
      query: z.boolean(),
      export: z.boolean(),
    }),
    operational: z.object({
      read: z.boolean(),
      query: z.boolean(),
      export: z.boolean(),
    }),
    customerService: z.object({
      read: z.boolean(),
      query: z.boolean(),
      export: z.boolean(),
    }),
  }),
  tokenExpiry: z.date(),
});

export type UserContext = z.infer<typeof UserContextSchema>;
```

### 3. JWT Middleware Setup
```typescript
// src/mastra/api/middleware/jwt-context.ts
import jwt from 'jsonwebtoken';
import { UserContext } from '../../types/context.js';

export function extractJWTContext(token: string): UserContext {
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

  return {
    userId: decoded.sub,
    sessionId: crypto.randomUUID(),
    roleId: decoded.role,
    departmentScope: decoded.departments || [],
    permissions: decoded.permissions,
    tokenExpiry: new Date(decoded.exp * 1000),
  };
}

export async function refreshJWTToken(userId: string): Promise<string> {
  // Implement token refresh logic
  const newToken = jwt.sign(
    { sub: userId, role: 'analyst' },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRY }
  );
  return newToken;
}
```

### 4. Context Store Implementation
```typescript
// src/mastra/memory/context-store.ts
import { UserContext } from '../types/context.js';

export class ContextStore {
  private contexts = new Map<string, UserContext>();
  private sessionHistory = new Map<string, any[]>();

  async storeContext(sessionId: string, context: UserContext): Promise<void> {
    this.contexts.set(sessionId, context);
    this.sessionHistory.set(sessionId, []);
  }

  async getContext(sessionId: string): Promise<UserContext | null> {
    return this.contexts.get(sessionId) || null;
  }

  async reconstructContext(sessionId: string): Promise<UserContext | null> {
    const history = this.sessionHistory.get(sessionId);
    if (!history || history.length === 0) return null;

    // Implement context reconstruction from history
    const lastValidState = history.findLast(entry => entry.contextValid);
    return lastValidState?.context || null;
  }
}
```

## Basic Usage Examples

### 1. Initialize Analysis Session
```typescript
// Initialize context-aware BI session
import { mastra } from '../mastra/index.js';

const session = await mastra.createSession({
  userId: 'user-123',
  sessionType: 'interactive',
  preferences: {
    defaultVisualization: 'chart',
    timezone: 'America/Chicago',
  },
});

console.log('Session ID:', session.sessionId);
```

### 2. Execute Context-Aware Query
```typescript
// Execute multi-domain query with context
const analysisResult = await mastra.agents['business-intelligence-agent'].generate([
  {
    role: 'user',
    content: 'Show me patient satisfaction scores correlated with revenue trends for my assigned regions'
  }
], {
  threadId: session.sessionId,
  resourceId: session.userId,
});

console.log('Analysis:', analysisResult);
```

### 3. Generate React Visualization
```typescript
// Generate TSX component from analysis results
const visualization = await fetch('/api/v1/visualization/generate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sessionId: session.sessionId,
    visualizationType: 'bar-chart',
    componentName: 'PatientSatisfactionChart',
    analysisData: analysisResult.data,
    options: {
      title: 'Patient Satisfaction vs Revenue',
      interactive: true,
      responsive: true,
    },
  }),
});

const component = await visualization.json();
console.log('Generated Component:', component.componentCode);
```

### 4. Handle Context Recovery
```typescript
// Handle context corruption and recovery
try {
  const context = await contextStore.getContext(sessionId);
  if (!context) {
    // Attempt context reconstruction
    const recovered = await contextStore.reconstructContext(sessionId);
    if (recovered) {
      console.log('Context recovered from session history');
    } else {
      console.log('Context recovery failed, using degraded mode');
    }
  }
} catch (error) {
  console.error('Context error:', error);
  // Implement fallback logic
}
```

## Testing Examples

### 1. Context Management Tests
```typescript
// tests/unit/context-tools.test.ts
import { describe, it, expect } from 'vitest';
import { ContextStore } from '../src/mastra/memory/context-store.js';

describe('Context Management', () => {
  it('should store and retrieve user context', async () => {
    const store = new ContextStore();
    const context = {
      userId: 'test-user',
      sessionId: 'test-session',
      roleId: 'analyst',
      departmentScope: ['cardiology'],
      permissions: { clinical: { read: true, query: true, export: false } },
      tokenExpiry: new Date(Date.now() + 3600000),
    };

    await store.storeContext('test-session', context);
    const retrieved = await store.getContext('test-session');

    expect(retrieved).toEqual(context);
  });

  it('should reconstruct context from session history', async () => {
    const store = new ContextStore();
    // Test context reconstruction logic
  });
});
```

### 2. Visualization Generation Tests
```typescript
// tests/unit/visualization.test.ts
import { describe, it, expect } from 'vitest';
import { generateReactComponent } from '../src/mastra/tools/visualization-tools.js';

describe('Visualization Generation', () => {
  it('should generate valid TSX component', async () => {
    const analysisData = {
      datasets: [{
        name: 'satisfaction',
        data: [{ score: 85, revenue: 100000 }]
      }],
      schema: { fields: [{ name: 'score', type: 'number' }] },
    };

    const component = await generateReactComponent({
      visualizationType: 'bar-chart',
      componentName: 'TestChart',
      analysisData,
    });

    expect(component.componentCode).toContain('export default function TestChart');
    expect(component.componentCode).toContain('interface TestChartProps');
  });
});
```

### 3. Integration Tests
```typescript
// tests/integration/context-workflows.test.ts
import { describe, it, expect } from 'vitest';
import { mastra } from '../src/mastra/index.js';

describe('Context Workflow Integration', () => {
  it('should maintain context throughout BI analysis workflow', async () => {
    // Test complete workflow with context passing
    const session = await mastra.createSession({ userId: 'test-user' });

    const analysis = await mastra.agents['business-intelligence-agent'].generate([
      { role: 'user', content: 'Analyze clinical outcomes' }
    ], { threadId: session.sessionId });

    // Verify context maintained
    expect(analysis.metadata).toHaveProperty('userId');
    expect(analysis.metadata).toHaveProperty('sessionId');
  });
});
```

## Development Workflow

### 1. Local Development
```bash
# Start development environment
pnpm dev

# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Check types
pnpm type-check
```

### 2. MCP Server Testing
```bash
# Test Supabase MCP server connection
claude mcp test brius-supabase

# Validate MCP tool integration
pnpm test:integration
```

### 3. Performance Testing
```bash
# Run context passing performance tests
pnpm test:performance

# Monitor context memory usage
pnpm monitor:memory
```

## Configuration Options

### Context Management
```typescript
// Context configuration options
const contextConfig = {
  tokenRefreshThreshold: 15 * 60 * 1000, // 15 minutes
  sessionTimeout: 8 * 60 * 60 * 1000,    // 8 hours
  maxHistoryEntries: 100,
  enableRecovery: true,
  recoveryAttempts: 3,
};
```

### Visualization Generation
```typescript
// Visualization generation limits
const visualizationConfig = {
  maxDataRows: 10000,
  maxComplexity: 'high',
  enableAnimations: false,
  defaultTheme: 'medical',
  cacheComponents: true,
};
```

## Troubleshooting

### Common Issues

**Context Lost During Workflow**
- Check JWT token expiry
- Verify middleware configuration
- Review session history logs

**Visualization Generation Failed**
- Validate analysis data structure
- Check component complexity limits
- Review TypeScript compilation errors

**Performance Degradation**
- Monitor context store memory usage
- Check database connection pooling
- Review MCP server response times

### Debug Commands
```bash
# Debug context flow
DEBUG=context pnpm dev

# Debug MCP integration
DEBUG=mcp pnpm dev

# Debug visualization generation
DEBUG=visualization pnpm dev
```

## Next Steps

1. **Implement Architecture Evaluation**: Add agent pattern benchmarking
2. **Enhance Error Recovery**: Implement advanced context reconstruction
3. **Add Performance Monitoring**: Real-time context operation metrics
4. **Expand Visualization Types**: Additional chart types and dashboard layouts
5. **Implement Caching**: Context and component caching strategies

## Resources

- [Mastra Framework Documentation](https://docs.mastra.ai)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [React TypeScript Guide](https://react-typescript-cheatsheet.netlify.app/)
- [JWT Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
- [OpenAPI Specification](https://spec.openapis.org/oas/v3.0.3)