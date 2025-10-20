# Brius Business Intelligence Mastra Agent
## Functional Specification & Implementation Plan

**Version:** 1.0  
**Date:** October 18, 2025  
**Project Root:** `/Users/gqadonis/Projects/prometheus/brius/brius-business-intelligence`

---

## 1. Executive Summary

This document specifies a production-grade Mastra-based Business Intelligence agent system.  
> **Architecture Update (2025-10-19):** The implementation now uses AWS Bedrock (Claude Sonnet + Titan embeddings), Mastra’s built-in memory, direct pgvector access, and MCP-derived tooling. Supabase-specific components referenced below are deprecated and will be replaced with the new Bedrock/pgvector modules during the refactor.

Key capabilities:
- Acts as both an MCP client (consuming configured MCP servers) and MCP server (exposing agents/workflows)
- Provides OpenAI-compatible REST APIs for chat completions, models, and embeddings
- Implements intelligent orchestration with intent-based routing
- Integrates comprehensive observability via LangFuse with per-user tracking
- Exposes RAG knowledge base and document management interfaces

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Brius BI Mastra System                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   OpenAI     │  │  MCP Server  │  │   AG-UI      │    │
│  │   API REST   │  │  (HTTP SSE)  │  │  Interface   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                            │                                │
│                ┌───────────▼───────────┐                   │
│                │  Orchestrator         │                   │
│                │  Workflow             │                   │
│                │  (Intent Classifier)  │                   │
│                └───────────┬───────────┘                   │
│                            │                                │
│         ┌──────────────────┴──────────────────┐            │
│         │                                      │            │
│  ┌──────▼─────────┐              ┌───────────▼──────┐    │
│  │ Business       │              │  Default         │    │
│  │ Intelligence   │              │  Agent           │    │
│  │ Agent          │              │  (Passthrough)   │    │
│  └────────┬───────┘              └──────────┬───────┘    │
│           │                                  │             │
│           └──────────┬───────────────────────┘             │
│                      │                                     │
│           ┌──────────▼──────────┐                         │
│           │  Shared Tools       │                         │
│           │  - Supabase MCP     │                         │
│           │  - RAG Knowledge    │                         │
│           │  - Custom Tools     │                         │
│           └──────────┬──────────┘                         │
│                      │                                     │
│           ┌──────────▼──────────┐                         │
│           │  LangFuse Logger    │                         │
│           │  (Per-User)         │                         │
│           └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ┌─────────┐         ┌──────────┐        ┌──────────┐
   │Supabase │         │ LangFuse │        │  Vector  │
   │   DB    │         │ Service  │        │   Store  │
   └─────────┘         └──────────┘        └──────────┘
```

### 2.2 Technology Stack

- **Framework:** Mastra (TypeScript)
- **Runtime:** Node.js 20+
- **HTTP Server:** Mastra's built-in server (extended with custom routes)
- **MCP Client:** @modelcontextprotocol/sdk
- **MCP Server:** HTTP SSE transport
- **UI Framework:** AG-UI with Vercel AI SDK
- **Observability:** LangFuse
- **Database:** Supabase (PostgreSQL + Vector Store)
- **Embeddings:** AWS Bedrock Titan v2
- **Authentication:** Supabase JWT validation

---

## 3. Component Specifications

### 3.1 MCP Client (Supabase Integration)

**Purpose:** Connect to Supabase's built-in MCP server and additional MCP servers defined in `mcp.json` to access their operations as tools.

**Configuration:**
```typescript
// src/config/mcp-client.ts
export const supabaseMcpConfig = {
  url: 'https://supabase.brius.com',
  supabaseUrl: 'https://gyyottknjakkagswebwh.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  transport: 'http' as const
};
```

**MCP Configuration File (mcp.json):**

The server supports loading additional MCP servers from a standard `mcp.json` file at the project root:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-supabase"],
      "env": {
        "SUPABASE_URL": "https://gyyottknjakkagswebwh.supabase.co",
        "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Implementation Requirements:**
- Initialize MCP client on server startup
- Load and parse `mcp.json` configuration file
- Dynamically spawn MCP server processes based on configuration
- Discover available tools from all configured MCP servers
- Map all MCP tools to Mastra tool format with namespace prefixes (e.g., `supabase:query`, `github:create_issue`)
- Handle connection errors and retries with exponential backoff
- Support JWT-based authentication for user-scoped operations
- Manage lifecycle of spawned MCP processes (start, stop, restart)
- Register all discovered tools in the playground tool registry

**File Structure:**
```
src/mcp/
├── client.ts              # MCP client initialization
├── config-loader.ts       # Load and parse mcp.json
├── process-manager.ts     # Manage MCP server processes
├── supabase-connector.ts  # Supabase MCP specific logic
├── tool-mapper.ts         # Map MCP tools to Mastra tools
└── registry.ts            # Tool registry for playground
```

### 3.2 Agent Memory System

**Purpose:** Provide persistent memory for agents with user-scoped and global contexts.

**Memory Types:**

1. **User Memory (Scoped)**
   - Personal conversation history for each authenticated user
   - User-specific facts, preferences, and context
   - Isolated by user_id from JWT
   - Retrieved automatically on each agent invocation
   - Example: "User prefers quarterly reports in Excel format"

2. **Global Memory (Shared)**
   - Knowledge shared across all users
   - System-level facts, policies, and procedures
   - Company-wide information and context
   - Retrieved based on semantic relevance to query
   - Example: "Company fiscal year starts in April"

**Architecture:**

```
┌─────────────────────────────────────────────────┐
│              Agent Memory System                │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────┐         ┌──────────────┐    │
│  │ User Memory  │         │Global Memory │    │
│  │ (per user)   │         │  (shared)    │    │
│  └──────┬───────┘         └──────┬───────┘    │
│         │                         │             │
│         └────────┬────────────────┘             │
│                  │                              │
│         ┌────────▼────────┐                    │
│         │ Titan v2        │                    │
│         │ Embeddings      │                    │
│         └────────┬────────┘                    │
│                  │                              │
│         ┌────────▼────────┐                    │
│         │ pgvector        │                    │
│         │ (Supabase)      │                    │
│         └─────────────────┘                    │
└─────────────────────────────────────────────────┘
```

**Database Schema:**

```sql
-- User memory table
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024), -- Titan v2 dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX idx_user_memories_embedding ON user_memories 
  USING ivfflat (embedding vector_cosine_ops);

-- Global memory table
CREATE TABLE global_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1024), -- Titan v2 dimension
  metadata JSONB DEFAULT '{}',
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_global_memories_embedding ON global_memories 
  USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_global_memories_category ON global_memories(category);
```

**Memory Operations:**

```typescript
// src/memory/operations.ts

interface MemoryContext {
  userId?: string;
  conversationId?: string;
}

interface MemoryItem {
  content: string;
  metadata?: Record<string, any>;
  category?: string;
}

interface MemorySearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, any>;
}

// Store user memory
async function storeUserMemory(
  userId: string,
  item: MemoryItem
): Promise<void>

// Store global memory
async function storeGlobalMemory(
  item: MemoryItem
): Promise<void>

// Search user memory
async function searchUserMemory(
  userId: string,
  query: string,
  topK: number = 5
): Promise<MemorySearchResult[]>

// Search global memory
async function searchGlobalMemory(
  query: string,
  topK: number = 5,
  category?: string
): Promise<MemorySearchResult[]>

// Combined search (user + global)
async function searchMemory(
  context: MemoryContext,
  query: string,
  topK: number = 10
): Promise<{
  user: MemorySearchResult[];
  global: MemorySearchResult[];
}>
```

**Integration with Agents:**

Every agent automatically receives memory context:

```typescript
// src/agents/business-intelligence.ts
export const businessIntelligenceAgent = new Agent({
  name: 'business-intelligence-agent',
  description: 'Advanced agent for complex business intelligence queries',
  instructions: `You are a business intelligence expert.
  
  You have access to two types of memory:
  - User Memory: Personal context and preferences for this specific user
  - Global Memory: Shared company-wide knowledge and policies
  
  Always consider relevant memories when responding to queries.`,
  model: openai('gpt-4o'),
  tools: sharedTools,
  workflows: { planningWorkflow },
  beforeGenerate: async (context) => {
    // Automatically inject memory before each generation
    const memories = await searchMemory(
      { userId: context.userId },
      context.messages[context.messages.length - 1].content,
      10
    );
    
    return {
      ...context,
      systemContext: {
        userMemories: memories.user,
        globalMemories: memories.global
      }
    };
  }
});
```

**Memory Management REST API:**

```typescript
// Extended from Mastra server routes
POST   /api/memory/user              # Store user memory
GET    /api/memory/user              # Search user memory
DELETE /api/memory/user/:id          # Delete user memory
POST   /api/memory/global            # Store global memory
GET    /api/memory/global            # Search global memory
DELETE /api/memory/global/:id        # Delete global memory
GET    /api/memory/stats             # Memory statistics
```

**File Structure:**
```
src/memory/
├── operations.ts       # Core memory operations
├── embeddings.ts       # Titan v2 embedding generation
├── storage.ts          # Supabase pgvector operations
├── routes.ts           # REST API endpoints
├── middleware.ts       # Memory injection middleware
└── types.ts            # TypeScript types
```

**Implementation Requirements:**
- Use same Titan v2 embedder as knowledge base
- Implement efficient vector search with pgvector
- Cache frequently accessed memories
- Automatic memory injection before agent generation
- Support for memory summarization (to reduce token usage)
- Memory expiration and cleanup policies
- Conflict resolution for global memory updates
- RLS policies for user memory isolation

### 3.3 AG-UI Integration

**Purpose:** Provide interactive UI for agent conversations using Vercel AI SDK.

**Implementation Requirements:**
- Create AG-UI compatible endpoints
- Stream agent responses using Vercel AI SDK's streaming format
- Support tool calls display and user approval
- Handle multi-turn conversations with memory
- Integrate with orchestrator workflow

**Endpoints:**
```
POST /api/chat          # Chat completion with streaming
GET  /api/chat/:id      # Get conversation history
POST /api/chat/:id/approve  # Approve tool execution
```

**File Structure:**
```
src/ui/
├── routes.ts           # AG-UI route handlers
├── streaming.ts        # SSE streaming utilities
└── conversation.ts     # Conversation state management
```

### 3.3 AG-UI Integration

**Purpose:** Provide interactive UI for agent conversations using Vercel AI SDK.

**Implementation Requirements:**
- Create AG-UI compatible endpoints
- Stream agent responses using Vercel AI SDK's streaming format
- Support tool calls display and user approval
- Handle multi-turn conversations with memory
- Integrate with orchestrator workflow

**Endpoints:**
```
POST /api/chat          # Chat completion with streaming
GET  /api/chat/:id      # Get conversation history
POST /api/chat/:id/approve  # Approve tool execution
```

**File Structure:**
```
src/ui/
├── routes.ts           # AG-UI route handlers
├── streaming.ts        # SSE streaming utilities
└── conversation.ts     # Conversation state management
```

### 3.4 Mastra Playground Integration

**Purpose:** Expose all tools, agents, and workflows in the Mastra playground for testing and debugging.

**Tool Registration:**

All tools from the following sources must be registered in the playground:

1. **MCP Tools** - From Supabase and mcp.json servers
2. **Agent Tools** - Shared tools available to agents
3. **Knowledge Base Tools** - Search, upload, manage documents
4. **Memory Tools** - User and global memory operations
5. **Workflow Tools** - Exposed workflows

**Implementation:**

```typescript
// src/playground/registry.ts

interface PlaygroundTool {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  outputSchema: z.ZodSchema;
  category: 'mcp' | 'agent' | 'knowledge' | 'memory' | 'workflow';
  source?: string; // e.g., 'supabase', 'github', 'filesystem'
}

class PlaygroundToolRegistry {
  private tools: Map<string, PlaygroundTool> = new Map();
  
  // Register tool from any source
  register(tool: PlaygroundTool): void {
    const fullId = tool.source 
      ? `${tool.source}:${tool.id}` 
      : tool.id;
    this.tools.set(fullId, tool);
  }
  
  // Get all tools grouped by category
  getAllTools(): Record<string, PlaygroundTool[]> {
    const grouped: Record<string, PlaygroundTool[]> = {};
    for (const tool of this.tools.values()) {
      if (!grouped[tool.category]) {
        grouped[tool.category] = [];
      }
      grouped[tool.category].push(tool);
    }
    return grouped;
  }
  
  // Search tools
  search(query: string): PlaygroundTool[] {
    const results: PlaygroundTool[] = [];
    const lowerQuery = query.toLowerCase();
    
    for (const tool of this.tools.values()) {
      if (
        tool.name.toLowerCase().includes(lowerQuery) ||
        tool.description.toLowerCase().includes(lowerQuery)
      ) {
        results.push(tool);
      }
    }
    return results;
  }
}

export const playgroundRegistry = new PlaygroundToolRegistry();
```

**Automatic Registration:**

```typescript
// src/playground/auto-register.ts

// Register all MCP tools from all servers
async function registerMcpTools() {
  const mcpServers = await loadMcpConfig();
  
  for (const [name, server] of Object.entries(mcpServers)) {
    const client = await connectToMcpServer(server);
    const tools = await client.listTools();
    
    for (const tool of tools) {
      playgroundRegistry.register({
        id: tool.name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        category: 'mcp',
        source: name
      });
    }
  }
}

// Register agent tools
function registerAgentTools() {
  for (const tool of sharedTools) {
    playgroundRegistry.register({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      category: 'agent'
    });
  }
}

// Register on startup
export async function initializePlayground() {
  await registerMcpTools();
  registerAgentTools();
  registerKnowledgeTools();
  registerMemoryTools();
  registerWorkflowTools();
}
```

**Playground UI Endpoint:**

```typescript
// Access playground at /playground
GET /playground                    # Playground UI
GET /api/playground/tools          # List all tools
POST /api/playground/test/:toolId  # Test a tool
```

**File Structure:**
```
src/playground/
├── registry.ts         # Tool registry
├── auto-register.ts    # Automatic registration
├── routes.ts           # Playground endpoints
└── ui.ts               # Playground UI components
```

### 3.5 MCP Server Implementation

**Purpose:** Expose Mastra agents and workflows as MCP tools for other systems.

**Transport:** HTTP Server-Sent Events (SSE) only

**Exposed Capabilities:**
1. **Agents as Tools**
   - Each agent exposed as a callable tool
   - Input: user message + context
   - Output: streamed agent response

2. **Workflows as Tools**
   - Each workflow exposed as a tool
   - Input: workflow-specific parameters
   - Output: workflow results

3. **Knowledge Base Tools**
   - `knowledge/search`: Vector search
   - `knowledge/add`: Add documents
   - `knowledge/delete`: Remove documents
   - `knowledge/list`: List documents

4. **Memory Tools**
   - `memory/save`: Persist conversation state
   - `memory/retrieve`: Get conversation history
   - `memory/clear`: Reset conversation

**Implementation Requirements:**
- Implement MCP protocol over HTTP SSE
- Support tool discovery via `tools/list`
- Handle tool invocation with streaming responses
- Validate incoming requests
- Rate limiting and authentication

**File Structure:**
```
src/mcp-server/
├── index.ts            # MCP server setup
├── protocol.ts         # MCP protocol handlers
├── tools/
│   ├── agents.ts       # Agent tool wrappers
│   ├── workflows.ts    # Workflow tool wrappers
│   ├── knowledge.ts    # Knowledge base tools
│   └── memory.ts       # Memory tools
└── transport/
    └── http-sse.ts     # HTTP SSE transport layer
```

### 3.4 OpenAI API Interface

**Purpose:** Provide OpenAI-compatible REST APIs for maximum compatibility.

**Endpoints:**

#### Chat Completions
```
POST /v1/chat/completions
```

**Request:**
```json
{
  "model": "business-intelligence-agent",
  "messages": [
    {"role": "user", "content": "Analyze Q4 revenue trends"}
  ],
  "stream": true,
  "tools": [...],
  "tool_choice": "auto"
}
```

**Response:** OpenAI-compatible streaming with Bedrock tool behavior

#### Models
```
GET /v1/models
```

**Response:**
```json
{
  "data": [
    {
      "id": "business-intelligence-agent",
      "object": "model",
      "created": 1234567890,
      "owned_by": "brius"
    },
    {
      "id": "default-agent",
      "object": "model",
      "created": 1234567890,
      "owned_by": "brius"
    }
  ]
}
```

#### Embeddings
```
POST /v1/embeddings
```

**Request:**
```json
{
  "model": "amazon.titan-embed-text-v2",
  "input": "Text to embed"
}
```

**Response:** OpenAI-compatible with Bedrock Titan v2 embeddings

**Tool Call Normalization:**
- Detect API version (v1 vs v2) from request headers or format
- Implement Bedrock parallel tool calling behavior
- Transform responses to OpenAI format
- Handle tool_choice semantics correctly

**File Structure:**
```
src/openai-api/
├── routes.ts           # OpenAI API route handlers
├── chat.ts             # Chat completions logic
├── models.ts           # Models endpoint
├── embeddings.ts       # Embeddings with Titan v2
├── normalization/
│   ├── tool-calls.ts   # Tool call format conversion
│   ├── streaming.ts    # Streaming response format
│   └── version-detect.ts # API version detection
└── bedrock/
    └── titan.ts        # Bedrock Titan v2 integration
```

### 3.5 Authentication & Context

**JWT-Based Context:**

**Flow:**
1. Optional `Authorization: Bearer <supabase-jwt>` header
2. If present, validate using `SUPABASE_JWT_SECRET`
3. Extract user information (user_id, email, metadata)
4. Pass to LangFuse for per-user tracking
5. Pass to Supabase MCP for RLS enforcement

**Implementation:**
```typescript
// src/auth/jwt.ts
interface UserContext {
  userId?: string;
  email?: string;
  metadata?: Record<string, any>;
  isAuthenticated: boolean;
}

async function validateJWT(token?: string): Promise<UserContext>
```

**File Structure:**
```
src/auth/
├── jwt.ts              # JWT validation
├── context.ts          # User context management
└── middleware.ts       # Auth middleware
```

### 3.6 LangFuse Integration

**Purpose:** Comprehensive observability with per-user tracking.

**Logged Events:**
1. **Tool Calls**
   - Tool name and parameters
   - Execution time
   - Success/failure status
   - User context

2. **Prompts**
   - Full prompt with system/user messages
   - Model used
   - Token counts
   - User context

3. **Responses**
   - Generated text
   - Tool calls made
   - Token usage
   - Latency metrics
   - User context

4. **Knowledge Base Retrievals**
   - Query text
   - Retrieved documents
   - Similarity scores
   - User context

**Implementation Requirements:**
- Initialize LangFuse client with API keys
- Wrap all agent/workflow executions
- Create trace hierarchies for nested calls
- Tag traces with user_id when available
- Handle errors gracefully (don't break on logging failure)

**File Structure:**
```
src/observability/
├── langfuse.ts         # LangFuse client setup
├── tracer.ts           # Tracing middleware
├── logger.ts           # Event logging
└── decorators.ts       # Logging decorators for agents/tools
```

### 3.7 Orchestrator Workflow

**Purpose:** Intelligent routing based on intent classification to determine query complexity.

**Flow:**
```
User Prompt
    │
    ▼
┌─────────────────┐
│ Intent          │
│ Classification  │
│ (Complexity)    │
│ - Keywords      │
│ - Multi-entity  │
│ - Aggregation   │
│ - Time-series   │
└────────┬────────┘
         │
    ┌────┴────────────┐
    │ Score > 0.7?    │
    │ (High Complexity)│
    └────┬────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
Complex?   Simple?
    │         │
    ▼         ▼
┌─────────┐ ┌──────────┐
│BI Agent │ │ Default  │
│+ KB-First│ │ Agent    │
│ Planning │ │(Direct)  │
└─────────┘ └──────────┘
```

**Intent Classification Criteria:**

The classifier evaluates multiple dimensions to compute a complexity score (0.0 - 1.0):

1. **Keyword Analysis (0.3 weight)**
   - High complexity: "analyze", "compare", "trend", "forecast", "report", "breakdown", "correlation", "impact", "attribution"
   - Medium complexity: "show", "list", "find", "search", "get"
   - Low complexity: "what is", "status", "count"

2. **Entity Count (0.2 weight)**
   - Multiple metrics mentioned: +0.2
   - Multiple time periods: +0.2
   - Multiple dimensions: +0.2
   - Multiple data sources: +0.2

3. **Aggregation Requirements (0.2 weight)**
   - Mathematical operations: +0.2
   - Statistical analysis: +0.2
   - Grouping/bucketing: +0.2
   - Ratios/percentages: +0.2

4. **Temporal Complexity (0.15 weight)**
   - Trend analysis: +0.3
   - Comparison across periods: +0.3
   - Forecasting: +0.4

5. **Output Complexity (0.15 weight)**
   - Report generation: +0.3
   - Visualization: +0.2
   - Formatted output: +0.2
   - Recommendations: +0.3

**Scoring Examples:**

| Query | Keywords | Entities | Aggregation | Temporal | Output | **Total** | Route |
|-------|----------|----------|-------------|----------|---------|-----------|-------|
| "Analyze Q4 revenue trends by product category and compare to last year" | 0.3 | 0.2 | 0.2 | 0.15 | 0.15 | **1.0** | BI Agent |
| "What factors contributed to the 15% increase in customer churn?" | 0.25 | 0.15 | 0.15 | 0.1 | 0.15 | **0.8** | BI Agent |
| "Generate a report on manufacturing efficiency" | 0.3 | 0.1 | 0.15 | 0.0 | 0.15 | **0.7** | BI Agent |
| "Show me revenue for Q4 2024" | 0.1 | 0.1 | 0.0 | 0.0 | 0.0 | **0.2** | Default |
| "What is inventory count for SKU-12345?" | 0.05 | 0.05 | 0.0 | 0.0 | 0.0 | **0.1** | Default |
| "List active employees in Denver" | 0.05 | 0.05 | 0.0 | 0.0 | 0.0 | **0.1** | Default |

**Threshold:** Score ≥ 0.7 → BI Agent with Planning, Score < 0.7 → Default Agent

**Implementation:**
```typescript
// src/workflows/orchestrator.ts

const intentClassifier = createStep({
  id: 'classify-intent',
  description: 'Classify query complexity using multi-dimensional scoring',
  inputSchema: z.object({
    prompt: z.string(),
    userId: z.string().optional()
  }),
  outputSchema: z.object({
    requiresBI: z.boolean(),
    score: z.number(),
    breakdown: z.object({
      keywordScore: z.number(),
      entityScore: z.number(),
      aggregationScore: z.number(),
      temporalScore: z.number(),
      outputScore: z.number()
    }),
    reasoning: z.string()
  }),
  execute: async ({ inputData }) => {
    const prompt = inputData.prompt.toLowerCase();
    
    // 1. Keyword Analysis (weight: 0.3)
    const highComplexityKeywords = [
      'analyze', 'compare', 'trend', 'forecast', 'report', 
      'breakdown', 'correlation', 'impact', 'attribution',
      'optimize', 'evaluate', 'assess'
    ];
    const keywordMatches = highComplexityKeywords.filter(k => 
      prompt.includes(k)
    ).length;
    const keywordScore = Math.min(keywordMatches * 0.1, 0.3);
    
    // 2. Entity Count (weight: 0.2)
    const entities = {
      metrics: ['revenue', 'profit', 'sales', 'cost', 'margin', 'churn'],
      timePeriods: ['q1', 'q2', 'q3', 'q4', 'quarter', 'year', 'month'],
      dimensions: ['product', 'category', 'region', 'customer', 'channel']
    };
    
    let entityCount = 0;
    for (const category of Object.values(entities)) {
      const matches = category.filter(e => prompt.includes(e)).length;
      if (matches > 0) entityCount++;
    }
    const entityScore = Math.min(entityCount * 0.07, 0.2);
    
    // 3. Aggregation Requirements (weight: 0.2)
    const aggregationPatterns = [
      'sum', 'average', 'total', 'count', 'group by',
      'breakdown', 'distribution', 'percentage'
    ];
    const aggMatches = aggregationPatterns.filter(p => 
      prompt.includes(p)
    ).length;
    const aggregationScore = Math.min(aggMatches * 0.07, 0.2);
    
    // 4. Temporal Complexity (weight: 0.15)
    let temporalScore = 0;
    if (prompt.includes('trend') || prompt.includes('over time')) {
      temporalScore = 0.1;
    }
    if (prompt.includes('compare') && (
      prompt.includes('last year') || 
      prompt.includes('previous') ||
      prompt.includes('vs')
    )) {
      temporalScore += 0.05;
    }
    temporalScore = Math.min(temporalScore, 0.15);
    
    // 5. Output Complexity (weight: 0.15)
    let outputScore = 0;
    if (prompt.includes('report')) outputScore += 0.05;
    if (prompt.includes('insight') || prompt.includes('recommendation')) {
      outputScore += 0.05;
    }
    if (prompt.includes('visualiz') || prompt.includes('chart')) {
      outputScore += 0.05;
    }
    outputScore = Math.min(outputScore, 0.15);
    
    // Calculate total score
    const totalScore = 
      keywordScore + 
      entityScore + 
      aggregationScore + 
      temporalScore + 
      outputScore;
    
    const requiresBI = totalScore >= 0.7;
    
    // Generate reasoning
    const reasoning = `
Query complexity score: ${totalScore.toFixed(2)}

Breakdown:
- Keywords (${keywordScore.toFixed(2)}/0.30): ${keywordMatches} high-complexity keywords
- Entities (${entityScore.toFixed(2)}/0.20): ${entityCount} entity categories
- Aggregation (${aggregationScore.toFixed(2)}/0.20): ${aggMatches} aggregation patterns
- Temporal (${temporalScore.toFixed(2)}/0.15): Time-series analysis detected
- Output (${outputScore.toFixed(2)}/0.15): Complex output requirements

${requiresBI ? 
  'HIGH COMPLEXITY → Routing to Business Intelligence Agent with knowledge-first planning workflow' :
  'STANDARD COMPLEXITY → Routing to Default Agent for direct response'}
    `.trim();
    
    return {
      requiresBI,
      score: totalScore,
      breakdown: {
        keywordScore,
        entityScore,
        aggregationScore,
        temporalScore,
        outputScore
      },
      reasoning
    };
  }
});

const routeToAgent = createStep({
  id: 'route-to-agent',
  description: 'Route to appropriate agent based on complexity',
  inputSchema: z.object({
    prompt: z.string(),
    requiresBI: z.boolean(),
    userId: z.string().optional(),
    conversationId: z.string().optional()
  }),
  outputSchema: z.object({
    response: z.string(),
    agent: z.string(),
    tokensUsed: z.number()
  }),
  execute: async ({ inputData, context }) => {
    const messages = [
      { 
        role: 'user' as const, 
        content: inputData.prompt 
      }
    ];
    
    if (inputData.requiresBI) {
      // Use BI Agent with planning workflow
      const result = await businessIntelligenceAgent.generate(messages, {
        userId: inputData.userId,
        conversationId: inputData.conversationId,
        usePlanning: true
      });
      
      return {
        response: result.text,
        agent: 'business-intelligence-agent',
        tokensUsed: result.usage?.totalTokens || 0
      };
    } else {
      // Use Default Agent for direct response
      const result = await defaultAgent.generate(messages, {
        userId: inputData.userId,
        conversationId: inputData.conversationId
      });
      
      return {
        response: result.text,
        agent: 'default-agent',
        tokensUsed: result.usage?.totalTokens || 0
      };
    }
  }
});

export const orchestratorWorkflow = createWorkflow({
  id: 'orchestrator-workflow',
  inputSchema: z.object({
    prompt: z.string(),
    userId: z.string().optional(),
    conversationId: z.string().optional()
  }),
  outputSchema: z.object({
    response: z.string(),
    agent: z.string(),
    complexity: z.object({
      score: z.number(),
      breakdown: z.any(),
      reasoning: z.string()
    }),
    tokensUsed: z.number()
  })
})
  .then(intentClassifier)
  .then(routeToAgent)
  .commit();
```

**Logging & Observability:**

Every routing decision is logged to LangFuse with:
- Original prompt
- Complexity score and breakdown
- Routing decision (BI vs Default)
- Reasoning explanation
- User context (if available)

This enables:
- Analysis of routing accuracy
- Threshold tuning over time
- Understanding query patterns
- A/B testing different routing strategies

**File Structure:**
```
src/workflows/
├── orchestrator.ts         # Main orchestrator workflow
├── intent-classifier.ts    # Complexity scoring logic
├── routing.ts              # Agent routing
└── complexity-tuning.ts    # Tools for threshold adjustment
```

### 3.8 Agents

#### Business Intelligence Agent

**Purpose:** Handle complex analytical queries with a knowledge-base-first planning workflow.

**Planning Workflow Strategy:**

The Business Intelligence Agent uses a sophisticated planning workflow that **prioritizes knowledge base exploration before execution**:

```
User Query
    │
    ▼
┌─────────────────────┐
│ 1. Knowledge Base   │
│    Discovery        │
│    - Search relevant│
│      documents      │
│    - Extract context│
│    - Identify data  │
│      sources        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. Plan Generation  │
│    - Analyze query  │
│      requirements   │
│    - Map to KB info │
│    - Identify tools │
│    - Sequence steps │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 3. Plan Validation  │
│    - Check tool     │
│      availability   │
│    - Verify data    │
│      access         │
│    - Estimate time  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4. Execution        │
│    - Execute steps  │
│      sequentially   │
│    - Handle errors  │
│    - Aggregate data │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 5. Synthesis        │
│    - Format results │
│    - Generate       │
│      insights       │
│    - Create report  │
└─────────────────────┘
```

**Knowledge-First Planning Implementation:**

```typescript
// src/workflows/planning.ts

const knowledgeDiscovery = createStep({
  id: 'knowledge-discovery',
  description: 'Search knowledge bases for relevant context',
  inputSchema: z.object({
    query: z.string(),
    userId: z.string().optional()
  }),
  outputSchema: z.object({
    documents: z.array(z.any()),
    dataSources: z.array(z.string()),
    context: z.string()
  }),
  execute: async ({ inputData, context }) => {
    // 1. Search knowledge base
    const kbResults = await searchKnowledgeBase({
      query: inputData.query,
      topK: 10
    });
    
    // 2. Search user memory
    let userContext = '';
    if (inputData.userId) {
      const userMemories = await searchUserMemory(
        inputData.userId,
        inputData.query,
        5
      );
      userContext = userMemories
        .map(m => m.content)
        .join('\n');
    }
    
    // 3. Search global memory
    const globalMemories = await searchGlobalMemory(
      inputData.query,
      5
    );
    
    // 4. Extract data source information
    const dataSources = extractDataSources(kbResults);
    
    // 5. Build comprehensive context
    const contextSummary = await synthesizeContext({
      knowledgeBase: kbResults,
      userMemory: userContext,
      globalMemory: globalMemories,
      dataSources: dataSources
    });
    
    return {
      documents: kbResults,
      dataSources: dataSources,
      context: contextSummary
    };
  }
});

const planGeneration = createStep({
  id: 'plan-generation',
  description: 'Generate execution plan based on knowledge',
  inputSchema: z.object({
    query: z.string(),
    context: z.string(),
    dataSources: z.array(z.string())
  }),
  outputSchema: z.object({
    plan: z.array(z.object({
      step: z.number(),
      action: z.string(),
      tool: z.string(),
      parameters: z.record(z.any()),
      rationale: z.string()
    })),
    estimatedTime: z.number()
  }),
  execute: async ({ inputData }) => {
    // Use LLM to generate plan informed by knowledge base
    const planningPrompt = `
Based on the following context from the knowledge base:

${inputData.context}

Available data sources:
${inputData.dataSources.join('\n')}

Generate a detailed execution plan for the query: "${inputData.query}"

The plan should:
1. Leverage information from the knowledge base
2. Use appropriate data sources identified
3. Break down complex analysis into sequential steps
4. Specify exact tools and parameters for each step
5. Include error handling strategies
`;
    
    const { text } = await planningAgent.generate([
      { role: 'user', content: planningPrompt }
    ]);
    
    // Parse and structure the plan
    const plan = parsePlanFromLLM(text);
    
    return {
      plan: plan.steps,
      estimatedTime: plan.estimatedTime
    };
  }
});

const planValidation = createStep({
  id: 'plan-validation',
  description: 'Validate plan feasibility',
  execute: async ({ inputData }) => {
    // Check tool availability
    const availableTools = playgroundRegistry.getAllTools();
    
    // Validate each step
    for (const step of inputData.plan) {
      const toolExists = checkToolAvailability(step.tool, availableTools);
      if (!toolExists) {
        throw new Error(`Tool ${step.tool} not available`);
      }
      
      // Check data access
      const hasAccess = await checkDataAccess(step.parameters);
      if (!hasAccess) {
        throw new Error(`Insufficient access for step ${step.step}`);
      }
    }
    
    return { validated: true };
  }
});

const planExecution = createStep({
  id: 'plan-execution',
  description: 'Execute validated plan',
  execute: async ({ inputData, context }) => {
    const results = [];
    
    for (const step of inputData.plan) {
      try {
        // Execute tool with parameters from plan
        const result = await executeTool(step.tool, step.parameters);
        results.push({
          step: step.step,
          success: true,
          data: result
        });
      } catch (error) {
        results.push({
          step: step.step,
          success: false,
          error: error.message
        });
        
        // Handle error according to plan's error strategy
        if (step.errorStrategy === 'fail-fast') {
          break;
        }
      }
    }
    
    return { results };
  }
});

const resultSynthesis = createStep({
  id: 'result-synthesis',
  description: 'Synthesize results into final report',
  execute: async ({ inputData }) => {
    // Use LLM to synthesize results with original context
    const synthesisPrompt = `
Original query: ${inputData.query}

Context from knowledge base:
${inputData.context}

Execution results:
${JSON.stringify(inputData.results, null, 2)}

Provide a comprehensive analysis that:
1. Directly answers the original query
2. Incorporates insights from the knowledge base
3. Highlights key findings from the data
4. Provides actionable recommendations
5. Notes any limitations or caveats
`;
    
    const { text } = await synthesisAgent.generate([
      { role: 'user', content: synthesisPrompt }
    ]);
    
    return { report: text };
  }
});

export const planningWorkflow = createWorkflow({
  id: 'bi-planning-workflow',
  inputSchema: z.object({
    query: z.string(),
    userId: z.string().optional()
  }),
  outputSchema: z.object({
    report: z.string(),
    plan: z.any(),
    executionDetails: z.any()
  })
})
  .then(knowledgeDiscovery)
  .then(planGeneration)
  .then(planValidation)
  .then(planExecution)
  .then(resultSynthesis)
  .commit();
```

**Complexity Threshold:**

Only queries meeting these criteria are routed to the BI Agent with planning:

1. **Explicit Analysis Intent**
   - Keywords: "analyze", "compare", "trend", "forecast", "report", "breakdown"
   - Multiple metrics or dimensions mentioned
   - Time-series analysis requests

2. **Multi-Step Requirements**
   - Requires aggregation across multiple data sources
   - Needs data transformation or calculation
   - Involves complex filtering or correlation

3. **Strategic/Executive Queries**
   - High-level business questions
   - Cross-functional analysis
   - Performance benchmarking

**Examples of Complex Queries (→ BI Agent):**
- "Analyze Q4 revenue trends by product category and compare to last year"
- "What factors contributed to the 15% increase in customer churn this quarter?"
- "Generate a report on manufacturing efficiency across all facilities"
- "Forecast next quarter's revenue based on current pipeline and historical patterns"

**Examples of Simple Queries (→ Default Agent):**
- "What is the current inventory count for product SKU-12345?"
- "Show me today's pending orders"
- "What is the status of customer ticket #5678?"
- "List active employees in the Denver office"

**Capabilities:**
- Multi-step planning for complex queries
- Knowledge-base-first approach to ensure context-aware analysis
- Access to all shared tools
- Memory retrieval for personalization (user + global)
- SQL generation for custom analytics
- Report generation and formatting
- Error handling and plan adaptation

**Configuration:**
```typescript
export const businessIntelligenceAgent = new Agent({
  name: 'business-intelligence-agent',
  description: 'Advanced agent for complex business intelligence queries with knowledge-first planning',
  instructions: `You are a business intelligence expert specializing in data analysis and strategic insights.

PLANNING APPROACH:
1. Always start by consulting the knowledge base for relevant context
2. Review user memory for preferences and past interactions
3. Check global memory for company policies and standards
4. Create a detailed execution plan based on discovered knowledge
5. Validate plan feasibility before execution
6. Execute plan step-by-step with error handling
7. Synthesize results into actionable insights

You have access to comprehensive knowledge bases containing:
- Business definitions and glossaries
- Historical analysis patterns
- Data source documentation
- Best practices for analysis

Use this knowledge to inform your planning and execution.`,
  model: openai('gpt-4o'),
  tools: sharedTools,
  workflows: { planningWorkflow }
});
```

#### Default Agent

**Purpose:** Handle simple queries with direct responses.

**Capabilities:**
- Direct question answering
- Access to all shared tools
- Knowledge base retrieval
- Simple data lookups

**Configuration:**
```typescript
export const defaultAgent = new Agent({
  name: 'default-agent',
  description: 'General-purpose agent for standard queries',
  instructions: `You are a helpful assistant...`,
  model: openai('gpt-4o'),
  tools: sharedTools
});
```

**File Structure:**
```
src/agents/
├── business-intelligence.ts  # BI agent
├── default.ts                # Default agent
└── shared-tools.ts           # Tools available to both
```

### 3.9 RAG Knowledge Base & Document Management

**Purpose:** Manage documents and enable semantic search.

**REST Endpoints:**

```typescript
// Extended from Mastra server routes
POST   /api/knowledge/documents       # Upload document(s)
GET    /api/knowledge/documents       # List documents
GET    /api/knowledge/documents/:id   # Get document
DELETE /api/knowledge/documents/:id   # Delete document
POST   /api/knowledge/search          # Semantic search
POST   /api/knowledge/embed           # Embed text
GET    /api/knowledge/stats           # Knowledge base stats
```

**Document Upload:**
```json
POST /api/knowledge/documents
Content-Type: multipart/form-data

{
  "file": <file>,
  "metadata": {
    "category": "financial-reports",
    "quarter": "Q4-2024"
  }
}
```

**Search:**
```json
POST /api/knowledge/search
{
  "query": "revenue trends",
  "top_k": 5,
  "filters": {
    "category": "financial-reports"
  }
}
```

**Implementation Requirements:**
- Use Supabase vector store for embeddings
- Support PDF, DOCX, TXT, MD formats
- Chunking strategy for large documents
- Metadata filtering
- Hybrid search (vector + keyword)
- Rate limiting

**File Structure:**
```
src/knowledge/
├── routes.ts           # REST endpoint handlers
├── upload.ts           # Document upload & processing
├── search.ts           # Semantic search
├── embeddings.ts       # Titan v2 embedding generation
├── storage.ts          # Supabase storage integration
└── chunking.ts         # Document chunking strategies
```

---

## 4. Configuration & Environment

### 4.1 Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=production

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://gyyottknjakkagswebwh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>

# Supabase MCP
SUPABASE_MCP_URL=https://supabase.brius.com

# Memory Configuration
MEMORY_USER_TABLE=user_memories
MEMORY_GLOBAL_TABLE=global_memories
MEMORY_CACHE_TTL=3600
MEMORY_MAX_CONTEXT_ITEMS=10

# LangFuse
LANGFUSE_PUBLIC_KEY=<public-key>
LANGFUSE_SECRET_KEY=<secret-key>
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# OpenAI
OPENAI_API_KEY=<api-key>

# AWS Bedrock (for Titan v2)
AWS_ACCESS_KEY_ID=<access-key>
AWS_SECRET_ACCESS_KEY=<secret-key>
AWS_REGION=us-east-1
BEDROCK_TITAN_MODEL_ID=amazon.titan-embed-text-v2

# MCP Server
MCP_SERVER_PORT=3001
MCP_SERVER_HOST=0.0.0.0
MCP_CONFIG_PATH=./mcp.json

# Playground
PLAYGROUND_ENABLED=true
PLAYGROUND_AUTH_REQUIRED=false
```

### 4.2 Mastra Configuration

```typescript
// src/config/mastra.ts
export const mastraConfig = {
  server: {
    port: process.env.PORT || 3000,
    routes: [
      ...openAIRoutes,
      ...knowledgeRoutes,
      ...agUIRoutes
    ]
  },
  agents: {
    businessIntelligence: businessIntelligenceAgent,
    default: defaultAgent
  },
  workflows: {
    orchestrator: orchestratorWorkflow,
    planning: planningWorkflow
  },
  integrations: {
    supabase: supabaseIntegration,
    langfuse: langfuseIntegration
  }
};
```

---

## 5. Data Flow Examples

### 5.1 OpenAI API Chat Completion

```
1. Client sends POST /v1/chat/completions
   ↓
2. Extract JWT from Authorization header (optional)
   ↓
3. Validate JWT → UserContext
   ↓
4. Detect API version (v1/v2)
   ↓
5. Start LangFuse trace with user_id
   ↓
6. Route to orchestrator workflow
   ↓
7. Intent classification step
   ↓
8. Route to BI Agent or Default Agent
   ↓
9. Agent executes with shared tools
   ↓
10. Tool calls logged to LangFuse
    ↓
11. Stream response (OpenAI format)
    ↓
12. Log final response to LangFuse
    ↓
13. Return to client
```

### 5.2 MCP Tool Invocation

```
1. MCP client sends tool/call via SSE
   ↓
2. Validate request
   ↓
3. Parse tool name and parameters
   ↓
4. If agent tool:
     → Execute agent with parameters
     → Stream results via SSE
   ↓
5. If workflow tool:
     → Start workflow execution
     → Stream progress updates via SSE
   ↓
6. If knowledge tool:
     → Execute knowledge base operation
     → Return results via SSE
   ↓
7. Log to LangFuse
   ↓
8. Complete SSE stream
```

### 5.3 Knowledge Base Search

```
1. Client sends POST /api/knowledge/search
   ↓
2. Extract query and filters
   ↓
3. Generate embedding using Titan v2
   ↓
4. Query Supabase vector store
   ↓
5. Apply metadata filters
   ↓
6. Rank results
   ↓
7. Log retrieval to LangFuse
   ↓
8. Return formatted results
```

---

## 7. Implementation Plan

### Phase 1: Foundation (Week 1)

**Tasks:**
1. Project setup and scaffolding
   - Initialize Mastra project
   - Set up TypeScript configuration
   - Configure environment variables
   - Set up linting and formatting
   - Create mcp.json configuration file

2. MCP Client integration
   - Implement MCP config loader (mcp.json parser)
   - Implement MCP process manager
   - Implement Supabase MCP client
   - Tool discovery and mapping
   - Connection management
   - Tool namespacing

3. Basic authentication
   - JWT validation
   - User context extraction
   - Middleware setup

4. Database setup
   - Create memory tables (user_memories, global_memories)
   - Create knowledge base tables
   - Set up pgvector indexes
   - Configure RLS policies

**Deliverables:**
- Working MCP client connecting to Supabase
- MCP config loading from mcp.json
- JWT authentication functional
- Database schema deployed
- Basic project structure

### Phase 2: Memory & Storage (Week 2)

**Tasks:**
1. Memory system implementation
   - User memory operations (store, search, delete)
   - Global memory operations
   - Titan v2 embedding generation
   - pgvector integration
   - Memory caching

2. Memory REST API
   - User memory endpoints
   - Global memory endpoints
   - Memory statistics
   - Memory management

3. Memory middleware
   - Automatic memory injection
   - Memory context building
   - Memory summarization

**Deliverables:**
- Full memory system operational
- User and global memory working
- Memory automatically injected into agents
- REST API for memory management

### Phase 3: Agents & Orchestration (Week 3)

**Tasks:**
1. Create agents
   - Business Intelligence agent
   - Default agent
   - Shared tools configuration
   - Memory integration

2. Build planning workflow
   - Knowledge-first discovery step
   - Plan generation step
   - Plan validation step
   - Execution step
   - Synthesis step

3. Build orchestrator workflow
   - Multi-dimensional complexity scoring
   - Intent classification
   - Routing logic
   - Testing with sample queries

4. LangFuse integration
   - Client setup
   - Tracing middleware
   - Event logging
   - Per-user tracking

**Deliverables:**
- Both agents functional with memory
- Planning workflow working (KB-first approach)
- Orchestrator routing correctly based on complexity
- LangFuse logging comprehensive

### Phase 4: Playground & Tool Registry (Week 4)

**Tasks:**
1. Playground tool registry
   - Tool registry implementation
   - Auto-registration for all tool sources
   - Tool search and filtering
   - Tool metadata management

2. Playground UI
   - Tool browser interface
   - Tool testing interface
   - Tool documentation viewer
   - Interactive tool execution

3. Tool registration
   - Register MCP tools with namespaces
   - Register agent tools
   - Register knowledge tools
   - Register memory tools
   - Register workflow tools

**Deliverables:**
- All tools visible in playground
- Tool testing functional
- Comprehensive tool documentation
- Auto-registration working

### Phase 5: OpenAI API (Week 5)

**Tasks:**
1. Chat completions endpoint
   - Request parsing
   - Streaming implementation
   - Tool call normalization
   - Version detection (v1/v2)

2. Models endpoint
   - Agent enumeration
   - Metadata formatting

3. Embeddings endpoint
   - Bedrock Titan v2 integration
   - OpenAI format conversion
   - Batch processing

**Deliverables:**
- Full OpenAI API compatibility
- Tool calling working correctly
- Embeddings functional with Titan v2

### Phase 6: MCP Server (Week 6)

**Tasks:**
1. MCP protocol implementation
   - HTTP SSE transport
   - Tool discovery
   - Tool invocation

2. Expose agents as tools
   - Agent wrappers
   - Streaming responses

3. Expose workflows as tools
   - Workflow wrappers
   - State management

4. Expose knowledge tools
   - Search, upload, manage

5. Expose memory tools
   - User/global memory operations

**Deliverables:**
- MCP server operational
- Agents, workflows, knowledge, and memory exposed
- Compatible with MCP clients

### Phase 7: Knowledge Base (Week 7)

**Tasks:**
1. Document upload
   - File parsing (PDF, DOCX, TXT, MD)
   - Chunking strategies
   - Embedding generation
   - Metadata extraction

2. Search implementation
   - Vector search
   - Metadata filtering
   - Ranking algorithms
   - Hybrid search

3. REST API routes
   - Upload endpoint
   - Search endpoint
   - Management endpoints
   - Statistics endpoint

**Deliverables:**
- Full knowledge base functionality
- Document management working
- Search performing well
- Multiple file formats supported

### Phase 8: AG-UI Integration (Week 8)

**Tasks:**
1. AG-UI endpoints
   - Chat interface
   - Streaming setup
   - Conversation management

2. UI components
   - Message display
   - Tool approval flows
   - Memory visualization
   - Planning workflow visualization

**Deliverables:**
- Working UI for agent interaction
- Smooth streaming experience
- Tool approval functional
- Conversation history working

### Phase 9: Testing & Optimization (Week 9)

**Tasks:**
1. Unit tests
   - Component tests
   - Memory operations tests
   - MCP client tests
   - Workflow tests
   - Integration tests

2. Performance optimization
   - Caching strategies
   - Query optimization
   - Memory management
   - Connection pooling
   - Load testing

3. Error handling
   - Retry logic
   - Graceful degradation
   - User-friendly errors
   - Fallback strategies

**Deliverables:**
- Comprehensive test coverage (>80%)
- Performance benchmarks met
- Robust error handling
- Optimized for production

### Phase 10: Deployment (Week 10)

**Tasks:**
1. Docker containerization
2. CI/CD pipeline setup
3. Monitoring and alerting
4. Documentation completion
5. Production deployment
6. Load testing
7. Security audit

**Deliverables:**
- Production-ready system
- Complete documentation
- Monitoring in place
- Security validated
- System deployed and operational

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
// Example: Intent classification test
describe('IntentClassifier', () => {
  it('should classify BI queries correctly', async () => {
    const result = await classifyIntent('Analyze Q4 revenue trends');
    expect(result.requiresBI).toBe(true);
    expect(result.score).toBeGreaterThan(0.7);
  });
});
```

### 7.2 Integration Tests

- MCP client → Supabase MCP server
- OpenAI API → Orchestrator → Agents
- Knowledge base → Vector store
- LangFuse logging pipeline

### 7.3 End-to-End Tests

- Full user conversation via OpenAI API
- MCP tool calls from external client
- AG-UI interaction flows
- Document upload and search

---

## 8. Performance Requirements

### 8.1 Response Times

- OpenAI chat completion: < 500ms first token
- Knowledge base search: < 200ms
- MCP tool invocation: < 1s
- Document upload: < 5s for 10MB file

### 8.2 Throughput

- 100 concurrent chat requests
- 1000 knowledge base searches/min
- 50 document uploads/hour

### 8.3 Scalability

- Horizontal scaling via load balancer
- Stateless design for multi-instance deployment
- Connection pooling for Supabase
- Rate limiting per user

---

## 9. Security Considerations

### 9.1 Authentication

- JWT validation on all protected endpoints
- Optional auth (graceful degradation)
- Token expiration handling
- Refresh token support

### 9.2 Authorization

- RLS enforcement via Supabase JWT
- Tool access control
- Knowledge base permissions
- User-scoped data isolation

### 9.3 Input Validation

- Schema validation for all endpoints
- SQL injection prevention
- XSS protection
- File upload validation

### 9.4 Rate Limiting

- Per-user rate limits
- Anonymous rate limits
- API key rate limits
- Gradual backoff

---

## 10. Monitoring & Observability

### 10.1 Metrics

- Request rate and latency
- Error rates by type
- Tool execution times
- Token usage
- Cache hit rates

### 10.2 Logging

- Structured JSON logs
- Request/response pairs
- Error stack traces
- Performance traces

### 10.3 Alerts

- High error rate
- Slow response times
- API quota approaching
- Service unavailability

---

## 11. Documentation Requirements

### 11.1 API Documentation

- OpenAPI/Swagger spec for REST APIs
- MCP protocol documentation
- Authentication guide
- Example requests/responses

### 11.2 Developer Guide

- Setup instructions
- Architecture overview
- Component descriptions
- Testing guide

### 11.3 Deployment Guide

- Environment setup
- Configuration options
- Scaling strategies
- Troubleshooting

---

## 12. File Structure

```
brius-business-intelligence/
├── mcp.json                      # MCP server configuration
├── src/
│   ├── config/
│   │   ├── mastra.ts
│   │   ├── mcp-client.ts
│   │   └── environment.ts
│   ├── agents/
│   │   ├── business-intelligence.ts
│   │   ├── default.ts
│   │   └── shared-tools.ts
│   ├── workflows/
│   │   ├── orchestrator.ts
│   │   ├── intent-classifier.ts
│   │   ├── planning.ts
│   │   ├── routing.ts
│   │   └── complexity-tuning.ts
│   ├── mcp/
│   │   ├── client.ts              # MCP client initialization
│   │   ├── config-loader.ts       # Load mcp.json
│   │   ├── process-manager.ts     # Manage MCP processes
│   │   ├── supabase-connector.ts  # Supabase MCP logic
│   │   ├── tool-mapper.ts         # Map MCP tools to Mastra
│   │   └── registry.ts            # Tool registry
│   ├── mcp-server/
│   │   ├── index.ts
│   │   ├── protocol.ts
│   │   ├── tools/
│   │   │   ├── agents.ts
│   │   │   ├── workflows.ts
│   │   │   ├── knowledge.ts
│   │   │   └── memory.ts
│   │   └── transport/
│   │       └── http-sse.ts
│   ├── openai-api/
│   │   ├── routes.ts
│   │   ├── chat.ts
│   │   ├── models.ts
│   │   ├── embeddings.ts
│   │   ├── normalization/
│   │   │   ├── tool-calls.ts
│   │   │   ├── streaming.ts
│   │   │   └── version-detect.ts
│   │   └── bedrock/
│   │       └── titan.ts
│   ├── knowledge/
│   │   ├── routes.ts
│   │   ├── upload.ts
│   │   ├── search.ts
│   │   ├── embeddings.ts
│   │   ├── storage.ts
│   │   └── chunking.ts
│   ├── memory/
│   │   ├── operations.ts          # Core memory operations
│   │   ├── embeddings.ts          # Titan v2 embeddings
│   │   ├── storage.ts             # pgvector operations
│   │   ├── routes.ts              # REST endpoints
│   │   ├── middleware.ts          # Memory injection
│   │   └── types.ts               # TypeScript types
│   ├── playground/
│   │   ├── registry.ts            # Tool registry
│   │   ├── auto-register.ts       # Auto registration
│   │   ├── routes.ts              # Playground endpoints
│   │   └── ui.ts                  # UI components
│   ├── auth/
│   │   ├── jwt.ts
│   │   ├── context.ts
│   │   └── middleware.ts
│   ├── observability/
│   │   ├── langfuse.ts
│   │   ├── tracer.ts
│   │   ├── logger.ts
│   │   └── decorators.ts
│   ├── ui/
│   │   ├── routes.ts
│   │   ├── streaming.ts
│   │   └── conversation.ts
│   ├── utils/
│   │   ├── errors.ts
│   │   ├── validation.ts
│   │   └── response.ts
│   └── index.ts
├── tests/
│   ├── unit/
│   │   ├── memory/
│   │   ├── mcp/
│   │   ├── workflows/
│   │   └── agents/
│   ├── integration/
│   │   ├── mcp-client.test.ts
│   │   ├── openai-api.test.ts
│   │   ├── knowledge-base.test.ts
│   │   └── memory.test.ts
│   └── e2e/
│       ├── chat-completion.test.ts
│       ├── mcp-tools.test.ts
│       └── planning-workflow.test.ts
├── docs/
│   ├── api/
│   │   ├── openai-compatibility.md
│   │   ├── mcp-server.md
│   │   ├── knowledge-base.md
│   │   └── memory.md
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── memory-system.md
│   │   ├── routing-logic.md
│   │   └── planning-workflow.md
│   └── deployment/
│       ├── setup.md
│       ├── configuration.md
│       └── scaling.md
├── migrations/
│   ├── 001_create_memory_tables.sql
│   ├── 002_create_knowledge_tables.sql
│   └── 003_create_indexes.sql
├── .env.example
├── .env
├── tsconfig.json
├── package.json
├── Dockerfile
└── README.md
```

---

## 13. MCP Configuration File (mcp.json)

The `mcp.json` file at the project root defines additional MCP servers that the system will connect to as tool providers.

### Example Configuration

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-supabase"],
      "env": {
        "SUPABASE_URL": "${NEXT_PUBLIC_SUPABASE_URL}",
        "SUPABASE_ANON_KEY": "${NEXT_PUBLIC_SUPABASE_ANON_KEY}"
      },
      "description": "Supabase database and storage operations"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {},
      "description": "Local filesystem access for reading and writing files"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "description": "GitHub repository operations"
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_TEAM_ID": "${SLACK_TEAM_ID}"
      },
      "description": "Slack workspace operations"
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "${POSTGRES_CONNECTION_STRING}"
      },
      "description": "PostgreSQL database operations"
    }
  }
}
```

### Environment Variable Substitution

Environment variables can be referenced using `${VAR_NAME}` syntax. The system will:
1. Read the `mcp.json` file
2. Substitute all `${VAR_NAME}` references with actual environment values
3. Spawn MCP server processes with resolved configuration
4. Connect to each server and discover tools
5. Register all tools in the playground with namespace prefixes

### Tool Namespace Convention

Tools from MCP servers are namespaced to avoid conflicts:
- `supabase:query_table` - Query Supabase table
- `github:create_issue` - Create GitHub issue
- `filesystem:read_file` - Read local file
- `slack:send_message` - Send Slack message

### Dynamic Loading

The MCP configuration is loaded at startup and can be reloaded without restart:

```typescript
// Reload MCP configuration
POST /api/admin/mcp/reload

// List active MCP servers
GET /api/admin/mcp/servers

// Get tools from specific server
GET /api/admin/mcp/servers/:name/tools
```

---

## 14. Dependencies

### Core Dependencies
```json
{
  "dependencies": {
    "@mastra/core": "^latest",
    "@modelcontextprotocol/sdk": "^latest",
    "@ai-sdk/openai": "^latest",
    "@supabase/supabase-js": "^latest",
    "langfuse": "^latest",
    "@aws-sdk/client-bedrock-runtime": "^latest",
    "express": "^4.18.0",
    "zod": "^3.22.0",
    "jose": "^5.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "tsx": "^4.0.0"
  }
}
```

---

## 15. Success Criteria

### Functional
- ✅ MCP client connects to Supabase MCP
- ✅ MCP client loads and connects to servers from mcp.json
- ✅ All MCP tools registered in playground with namespaces
- ✅ User memory system operational
- ✅ Global memory system operational
- ✅ Memory automatically injected into agent contexts
- ✅ OpenAI API fully compatible
- ✅ MCP server exposes all tools (agents, workflows, knowledge, memory)
- ✅ AG-UI interface operational
- ✅ Orchestrator routes based on complexity scoring
- ✅ BI Agent uses knowledge-first planning workflow
- ✅ Knowledge base functional
- ✅ LangFuse logging comprehensive with per-user tracking
- ✅ Playground shows all tools from all sources

### Performance
- ✅ < 500ms first token for chat
- ✅ < 200ms for knowledge search
- ✅ < 150ms for memory retrieval
- ✅ 100+ concurrent users supported
- ✅ 99.9% uptime

### Quality
- ✅ > 80% test coverage
- ✅ Zero critical security issues
- ✅ Complete API documentation
- ✅ All tools documented in playground
- ✅ Successful production deployment

### Memory System
- ✅ User memories isolated by user_id
- ✅ Global memories shared across users
- ✅ Both use pgvector for semantic search
- ✅ Both use same Titan v2 embedder
- ✅ Memory cache reduces latency
- ✅ Memory injection automatic

### MCP Integration
- ✅ mcp.json successfully parsed
- ✅ All configured MCP servers spawned
- ✅ All MCP tools discovered
- ✅ Tools namespaced correctly
- ✅ Tools registered in playground
- ✅ Tools callable by agents

### Planning Workflow
- ✅ Knowledge base searched first
- ✅ Plan generated from KB context
- ✅ Plan validated before execution
- ✅ Execution follows plan
- ✅ Results synthesized with context

---

## 16. New Features Summary

This specification includes the following enhancements beyond the original requirements:

### 1. Dual Memory System
- **User Memory:** Personal context for each authenticated user
- **Global Memory:** Shared knowledge across all users
- Both use pgvector in Supabase for vector storage
- Both use Titan v2 for embeddings
- Automatic injection into agent contexts
- REST API for memory management

### 2. MCP Configuration File Support
- Standard `mcp.json` format support
- Dynamic MCP server spawning
- Environment variable substitution
- Tool discovery from all MCP servers
- Namespaced tool registration
- Runtime configuration reload

### 3. Playground Tool Registry
- All tools visible and testable
- Tools from MCP servers (all sources)
- Tools from agents
- Knowledge base tools
- Memory tools
- Workflow tools
- Interactive testing interface
- Comprehensive documentation

### 4. Knowledge-First Planning
- BI Agent starts with KB search
- Plan informed by knowledge context
- User and global memory consulted
- Multi-step validation
- Context-aware execution
- Synthesis with full context

### 5. Enhanced Complexity Scoring
- Multi-dimensional scoring algorithm
- Keyword analysis (30% weight)
- Entity count (20% weight)
- Aggregation requirements (20% weight)
- Temporal complexity (15% weight)
- Output complexity (15% weight)
- Threshold: 0.7 for BI routing
- Full logging for tuning

---

## 17. Risks & Mitigations

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP protocol compatibility | High | Early testing with reference implementations |
| OpenAI API changes | Medium | Version detection and graceful degradation |
| LangFuse rate limits | Medium | Implement queuing and batching |
| Embedding API latency | High | Cache embeddings, batch requests |

### Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase downtime | High | Implement circuit breakers, fallbacks |
| JWT secret leak | Critical | Rotation policy, secure storage |
| Over-provisioned resources | Medium | Auto-scaling, monitoring |

---

## 16. Future Enhancements

### Phase 2 Features
- Multi-tenant support
- Custom model fine-tuning
- Advanced analytics dashboard
- Webhook support for async operations
- GraphQL API
- Real-time collaboration features
- Plugin system for custom tools

---

---

## Appendix A: Database Migrations

### Migration 001: Create Memory Tables

```sql
-- migrations/001_create_memory_tables.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- User memory table
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024), -- Titan v2 dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user memory
CREATE INDEX idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX idx_user_memories_embedding ON user_memories 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX idx_user_memories_created_at ON user_memories(created_at DESC);

-- Global memory table
CREATE TABLE global_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1024), -- Titan v2 dimension
  metadata JSONB DEFAULT '{}',
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for global memory
CREATE INDEX idx_global_memories_embedding ON global_memories 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX idx_global_memories_category ON global_memories(category);
CREATE INDEX idx_global_memories_created_at ON global_memories(created_at DESC);

-- RLS policies for user memory
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own memories"
  ON user_memories FOR SELECT
  USING (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Users can insert their own memories"
  ON user_memories FOR INSERT
  WITH CHECK (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Users can update their own memories"
  ON user_memories FOR UPDATE
  USING (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Users can delete their own memories"
  ON user_memories FOR DELETE
  USING (user_id = auth.jwt() ->> 'sub');

-- RLS policies for global memory (read-only for users)
ALTER TABLE global_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view global memories"
  ON global_memories FOR SELECT
  USING (true);

-- Service role can manage global memories
CREATE POLICY "Service role can manage global memories"
  ON global_memories FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_user_memories_updated_at
  BEFORE UPDATE ON user_memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_global_memories_updated_at
  BEFORE UPDATE ON global_memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Migration 002: Create Knowledge Base Tables

```sql
-- migrations/002_create_knowledge_tables.sql

-- Documents table
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document chunks table for RAG
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024), -- Titan v2 dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_knowledge_documents_uploaded_by ON knowledge_documents(uploaded_by);
CREATE INDEX idx_knowledge_documents_file_type ON knowledge_documents(file_type);
CREATE INDEX idx_knowledge_documents_created_at ON knowledge_documents(created_at DESC);

CREATE INDEX idx_knowledge_chunks_document_id ON knowledge_chunks(document_id);
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS policies
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view knowledge documents"
  ON knowledge_documents FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can upload documents"
  ON knowledge_documents FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "Anyone can view knowledge chunks"
  ON knowledge_chunks FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage chunks"
  ON knowledge_chunks FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_knowledge_documents_updated_at
  BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Migration 003: Create Indexes for Performance

```sql
-- migrations/003_create_indexes.sql

-- Composite indexes for common queries
CREATE INDEX idx_user_memories_user_created 
  ON user_memories(user_id, created_at DESC);

CREATE INDEX idx_global_memories_category_created 
  ON global_memories(category, created_at DESC);

-- JSONB indexes for metadata filtering
CREATE INDEX idx_user_memories_metadata_gin 
  ON user_memories USING gin(metadata);

CREATE INDEX idx_global_memories_metadata_gin 
  ON global_memories USING gin(metadata);

CREATE INDEX idx_knowledge_documents_metadata_gin 
  ON knowledge_documents USING gin(metadata);

CREATE INDEX idx_knowledge_chunks_metadata_gin 
  ON knowledge_chunks USING gin(metadata);

-- Full-text search indexes (for hybrid search)
CREATE INDEX idx_user_memories_content_fts 
  ON user_memories USING gin(to_tsvector('english', content));

CREATE INDEX idx_global_memories_content_fts 
  ON global_memories USING gin(to_tsvector('english', content));

CREATE INDEX idx_knowledge_chunks_content_fts 
  ON knowledge_chunks USING gin(to_tsvector('english', content));

-- Analyze tables for query planner
ANALYZE user_memories;
ANALYZE global_memories;
ANALYZE knowledge_documents;
ANALYZE knowledge_chunks;
```

---

## Appendix B: Example Requests

## Appendix B: Example Requests

### B.1 OpenAI Chat Completion

```bash
curl -X POST https://api.brius.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "model": "business-intelligence-agent",
    "messages": [
      {"role": "user", "content": "Analyze revenue trends for Q4 2024"}
    ],
    "stream": true
  }'
```

### B.2 Knowledge Base Search

```bash
curl -X POST https://api.brius.com/api/knowledge/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "query": "revenue metrics",
    "top_k": 5
  }'
```

### B.3 Store User Memory

```bash
curl -X POST https://api.brius.com/api/memory/user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "content": "User prefers quarterly reports in Excel format with charts",
    "metadata": {
      "category": "preference",
      "importance": "high"
    }
  }'
```

### B.4 Search User Memory

```bash
curl -X GET https://api.brius.com/api/memory/user?query=reporting%20preferences&top_k=5 \
  -H "Authorization: Bearer <jwt-token>"
```

### B.5 Store Global Memory

```bash
curl -X POST https://api.brius.com/api/memory/global \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "content": "Company fiscal year starts in April and ends in March",
    "metadata": {
      "category": "company-policy"
    }
  }'
```

### B.6 Search Global Memory

```bash
curl -X GET https://api.brius.com/api/memory/global?query=fiscal%20year&category=company-policy&top_k=5 \
  -H "Authorization: Bearer <jwt-token>"
```

### B.7 MCP Tool Call

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "business-intelligence-agent",
    "arguments": {
      "message": "Show me top customers by revenue"
    }
  },
  "id": 1
}
```

### B.8 Playground Tool List

```bash
curl -X GET https://api.brius.com/api/playground/tools \
  -H "Authorization: Bearer <jwt-token>"
```

Response:
```json
{
  "tools": {
    "mcp": [
      {
        "id": "supabase:query_table",
        "name": "Query Supabase Table",
        "description": "Execute SQL query on Supabase table",
        "source": "supabase"
      },
      {
        "id": "github:create_issue",
        "name": "Create GitHub Issue",
        "description": "Create a new issue in a GitHub repository",
        "source": "github"
      }
    ],
    "knowledge": [
      {
        "id": "knowledge:search",
        "name": "Search Knowledge Base",
        "description": "Semantic search across knowledge documents"
      }
    ],
    "memory": [
      {
        "id": "memory:search_user",
        "name": "Search User Memory",
        "description": "Search user-specific memories"
      },
      {
        "id": "memory:search_global",
        "name": "Search Global Memory",
        "description": "Search shared global memories"
      }
    ]
  }
}
```

### B.9 Test Tool in Playground

```bash
curl -X POST https://api.brius.com/api/playground/test/supabase:query_table \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "parameters": {
      "table": "orders",
      "query": "SELECT * FROM orders WHERE status = '\''completed'\'' LIMIT 10"
    }
  }'
```

---

**End of Specification**
