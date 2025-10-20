# Extending Mastra Routes with `registerApiRoute`

## Objective

**Primary Goal:** Extend the internal Hono HTTP server in Mastra by adding custom API routes using the `registerApiRoute` method from `@mastra/core/server`.

## Why This Approach

Mastra uses Hono as its underlying HTTP server framework. Rather than spinning up a separate Express or Hono server, we leverage Mastra's built-in `apiRoutes` configuration to:

- Keep custom endpoints colocated with agent/workflow endpoints
- Access the Mastra instance directly within route handlers via `c.get("mastra")`
- Maintain a single unified server deployment
- Utilize Mastra's middleware pipeline and configuration

## Implementation Method

### Core Pattern

```typescript
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";

export const mastra = new Mastra({
  // ... agents, workflows, etc.
  server: {
    apiRoutes: [
      registerApiRoute("/your-custom-path", {
        method: "GET" | "POST" | "PUT" | "DELETE",
        handler: async (c) => {
          // Route logic here
          return c.json({ data: "response" });
        },
        middleware: [/* optional per-route middleware */]
      })
    ],
    port: 4111,
    // ... other server config
  }
});
```

### Key Benefits of This Approach

1. **Direct Mastra Integration**: Access agents and workflows directly from custom routes
2. **Unified Server**: Single port, single deployment, single configuration
3. **Middleware Support**: Apply auth, logging, or validation per-route or globally
4. **Hono Context**: Full access to Hono's `Context` object with request/response helpers
5. **OpenAPI Integration**: Routes can be documented alongside auto-generated endpoints

## Practical Example

```typescript
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";

export const mastra = new Mastra({
  agents: { /* ... */ },
  workflows: { /* ... */ },
  server: {
    port: 4111,
    apiRoutes: [
      // Health check endpoint
      registerApiRoute("/health", {
        method: "GET",
        handler: async (c) => {
          return c.json({ status: "ok", timestamp: Date.now() });
        }
      }),

      // Protected internal endpoint
      registerApiRoute("/internal/stats", {
        method: "GET",
        middleware: [
          async (c, next) => {
            const token = c.req.header("x-internal-token");
            if (token !== process.env.INTERNAL_TOKEN) {
              return c.json({ error: "unauthorized" }, { status: 403 });
            }
            await next();
          }
        ],
        handler: async (c) => {
          const mas = c.get("mastra");
          // Access agents/workflows through Mastra instance
          const result = await mas.someMethod();
          return c.json({ result });
        }
      }),

      // POST endpoint with body parsing
      registerApiRoute("/custom/process", {
        method: "POST",
        handler: async (c) => {
          const { input } = await c.req.json();
          const mas = c.get("mastra");
          
          // Call an agent
          const agentResult = await mas.callAgent("myAgent", { input });
          
          return c.json({ processed: true, data: agentResult });
        }
      })
    ],
    cors: {
      origin: ["https://prometheus-platform.com"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true
    }
  }
});
```

## Architecture Considerations

### Route Organization

For maintainability in production:

```typescript
// routes/health.ts
export const healthRoute = registerApiRoute("/health", {
  method: "GET",
  handler: async (c) => c.json({ status: "ok" })
});

// routes/internal.ts
export const internalRoutes = [
  registerApiRoute("/internal/stats", { /* ... */ }),
  registerApiRoute("/internal/metrics", { /* ... */ })
];

// mastra.config.ts
import { healthRoute } from "./routes/health";
import { internalRoutes } from "./routes/internal";

export const mastra = new Mastra({
  server: {
    apiRoutes: [
      healthRoute,
      ...internalRoutes,
      // ... more routes
    ]
  }
});
```

### Global Middleware

Apply cross-cutting concerns to all routes:

```typescript
server: {
  middleware: [
    async (c, next) => {
      // Logging, telemetry, auth checks, etc.
      console.log(`${c.req.method} ${c.req.path}`);
      await next();
    }
  ],
  apiRoutes: [/* ... */]
}
```

### Route Namespacing

Prevent collision with Mastra's auto-generated endpoints:

- `/custom/*` - Custom business logic
- `/internal/*` - Internal platform operations
- `/v1/api/*` - Versioned public APIs
- `/health`, `/metrics` - Standard observability endpoints

## Deployment Workflow

1. **Define routes** using `registerApiRoute` in server config
2. **Build** with `mastra build` → generates `.mastra/output/index.mjs`
3. **Deploy** the bundled server to cloud/edge/local
4. **Access routes** at `http://your-server:4111/your-custom-path`

## Alternative: Separate Server (Not Recommended for This Use Case)

While you *could* create a separate Hono/Express server and call Mastra agents as a sub-app, this adds complexity:

- Multiple ports/servers to manage
- Manual routing between services
- More deployment overhead
- Loss of integrated context/middleware

**Recommendation:** Use `registerApiRoute` for unified architecture unless you have specific requirements (e.g., serving a large React SPA, integrating legacy services).

## Summary

**Use `registerApiRoute` to extend Mastra's internal Hono server** by defining custom routes in the `server.apiRoutes` array. This provides:

- ✅ Single unified HTTP server
- ✅ Direct access to Mastra agents/workflows
- ✅ Per-route and global middleware
- ✅ Full Hono Context API
- ✅ Colocated deployment with built-in endpoints

This approach maintains architectural simplicity while providing full extensibility for Prometheus platform requirements.