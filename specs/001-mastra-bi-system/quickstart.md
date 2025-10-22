# Quickstart Guide: Mastra Business Intelligence System

**Date**: October 18, 2025
**Feature**: Mastra Business Intelligence System
**Branch**: 001-mastra-bi-system

## Overview

This guide provides step-by-step instructions for setting up and running the Mastra Business Intelligence system locally for development and testing.

## Prerequisites

- **Node.js**: Version 20+ required
- **pnpm**: Package manager (required, not npm or yarn)
- **Supabase Account**: For PostgreSQL database with pgvector
- **AWS Account**: For Bedrock Titan v2 embeddings
- **LangFuse Account**: For observability (optional but recommended)
- **Git**: For version control

## Quick Setup (5 minutes)

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd brius-business-intelligence

# Install dependencies (ONLY use pnpm)
pnpm install
```

### 2. Environment Configuration

Create `.env` file in the project root:

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# Memory Configuration
MEMORY_USER_TABLE=user_memories
MEMORY_GLOBAL_TABLE=global_memories
MEMORY_CACHE_TTL=3600
MEMORY_MAX_CONTEXT_ITEMS=10

# LangFuse Observability (Optional)
LANGFUSE_PUBLIC_KEY=your-langfuse-public-key
LANGFUSE_SECRET_KEY=your-langfuse-secret-key
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key

# AWS Bedrock Configuration
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
BEDROCK_TITAN_MODEL_ID=amazon.titan-embed-text-v2

# MCP Server Configuration
MCP_SERVER_PORT=3001
MCP_SERVER_HOST=0.0.0.0
MCP_CONFIG_PATH=./mcp.json

# Playground Configuration
PLAYGROUND_ENABLED=true
PLAYGROUND_AUTH_REQUIRED=false
```

### 3. Database Setup

Set up Supabase database with required tables and extensions:

```bash
# Run database migrations (if available)
pnpm run db:migrate

# Or execute SQL manually in Supabase dashboard:
# 1. Enable pgvector extension
# 2. Create user_memories table
# 3. Create global_memories table
# 4. Create knowledge_documents table
# 5. Create knowledge_chunks table
# 6. Set up RLS policies
```

### 4. MCP Configuration

Create `mcp.json` file for external tool integration:

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
    }
  }
}
```

### 5. Start Development Server

```bash
# Start the development server
pnpm dev

# Server will start on:
# - Main API: http://localhost:3000
# - MCP Server: http://localhost:3001
# - Playground: http://localhost:3000/playground
```

## First Steps

### Test Basic Functionality

1. **Check Health**: Visit `http://localhost:3000/health`
2. **Playground**: Visit `http://localhost:3000/playground` to see available tools
3. **OpenAI API**: Test chat completion at `http://localhost:3000/v1/chat/completions`

### Example API Calls

#### Simple Query (Default Agent)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default-agent",
    "messages": [
      {"role": "user", "content": "What time is it?"}
    ]
  }'
```

#### Complex Query (Business Intelligence Agent)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "business-intelligence-agent",
    "messages": [
      {"role": "user", "content": "Analyze Q4 revenue trends by product category"}
    ],
    "stream": true
  }'
```

#### Store User Memory (with JWT)

```bash
curl -X POST http://localhost:3000/api/memory/user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-jwt-token" \
  -d '{
    "content": "User prefers quarterly reports in Excel format",
    "metadata": {"category": "preference", "importance": "high"}
  }'
```

#### Search Knowledge Base

```bash
curl -X POST http://localhost:3000/api/knowledge/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "revenue metrics definition",
    "top_k": 5
  }'
```

## Development Workflow

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:unit
pnpm test:integration
pnpm test:e2e

# Run tests in watch mode
pnpm test:watch
```

### Building for Production

```bash
# Build the application
pnpm build

# Start production server
pnpm start
```

### MCP Tool Development

1. **View Available Tools**: Check playground at `/playground`
2. **Test Tools**: Use playground interface to test individual tools
3. **Add New MCP Servers**: Update `mcp.json` and restart server
4. **Monitor Tool Performance**: Check LangFuse dashboard for tool execution metrics

## Common Issues and Solutions

### Database Connection Issues

```bash
# Check Supabase connection
curl -H "Authorization: Bearer your-anon-key" \
  -X GET "your-supabase-url/rest/v1/"

# Verify pgvector extension
# In Supabase SQL editor: SELECT * FROM pg_extension WHERE extname = 'vector';
```

### MCP Server Connection Issues

```bash
# Check MCP server status
curl http://localhost:3001/health

# View MCP server logs
pnpm dev --verbose

# Test MCP tool discovery
curl -X POST http://localhost:3001/mcp/v1/tools/list \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list", "params": {}}'
```

### Memory System Issues

```bash
# Test embedding generation
curl -X POST http://localhost:3000/api/knowledge/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "test embedding generation"}'

# Check vector indexes
# In Supabase: EXPLAIN ANALYZE SELECT * FROM user_memories ORDER BY embedding <-> '[0,1,0...]' LIMIT 5;
```

### Authentication Issues

```bash
# Verify JWT configuration
# Check SUPABASE_JWT_SECRET matches your Supabase project
# Test JWT validation with a known good token

# Test anonymous access
curl -X GET http://localhost:3000/api/memory/global?query=test
```

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                 Mastra BI System (Port 3000)               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ OpenAI API   │  │  REST APIs   │  │   AG-UI      │    │
│  │ Compatible   │  │  Knowledge   │  │  Interface   │    │
│  └──────┬───────┘  │  Memory      │  └──────┬───────┘    │
│         │          └──────┬───────┘         │             │
│         │                 │                 │             │
│         └─────────────────┴─────────────────┘             │
│                           │                               │
│               ┌───────────▼───────────┐                   │
│               │  Orchestrator         │                   │
│               │  Workflow             │                   │
│               │  (Intent Classifier)  │                   │
│               └───────────┬───────────┘                   │
│                           │                               │
│        ┌──────────────────┴──────────────────┐            │
│        │                                     │            │
│ ┌──────▼─────────┐                ┌────────▼──────┐      │
│ │ Business       │                │  Default      │      │
│ │ Intelligence   │                │  Agent        │      │
│ │ Agent          │                │               │      │
│ └────────┬───────┘                └───────┬───────┘      │
│          │                                │               │
│          └────────┬───────────────────────┘               │
│                   │                                       │
│        ┌──────────▼──────────┐                           │
│        │  Memory & Knowledge │                           │
│        │  + MCP Integration  │                           │
│        └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐    ┌──────────────┐    ┌──────────────┐
│ MCP Server      │    │  Supabase    │    │  LangFuse    │
│ (Port 3001)     │    │  Database    │    │  Observability│
└─────────────────┘    └──────────────┘    └──────────────┘
```

### Data Flow

1. **User Request** → OpenAI API or REST endpoint
2. **Authentication** → JWT validation (optional)
3. **Intent Classification** → Route to appropriate agent
4. **Memory Injection** → Retrieve user and global context
5. **Agent Execution** → Use tools and workflows
6. **MCP Tool Calls** → External system integration
7. **Response Synthesis** → Combine results and context
8. **Observability** → Log to LangFuse
9. **Response Delivery** → Stream or return JSON

## Next Steps

### Production Deployment

1. **Environment**: Set `NODE_ENV=production`
2. **Database**: Configure production Supabase instance
3. **Security**: Update JWT secrets and API keys
4. **Monitoring**: Enable comprehensive LangFuse logging
5. **Scaling**: Configure load balancers and health checks

### Feature Development

1. **New Agents**: Add to `src/mastra/agents/`
2. **New Tools**: Add to `src/mastra/tools/`
3. **New Workflows**: Add to `src/mastra/workflows/`
4. **MCP Integration**: Update `mcp.json` configuration

### Monitoring and Optimization

1. **Performance**: Monitor API response times
2. **Tool Usage**: Track tool execution success rates
3. **Memory Usage**: Monitor vector search performance
4. **User Analytics**: Track query complexity routing accuracy

## Support and Resources

- **Documentation**: `/docs` directory for detailed specifications
- **Playground**: `/playground` for interactive tool testing
- **Health Check**: `/health` for system status
- **Mastra Framework**: [Mastra documentation](https://docs.mastra.ai)
- **MCP Protocol**: [Model Context Protocol specification](https://modelcontextprotocol.io)

## Development Tips

1. **Use pnpm**: Always use pnpm for package management
2. **Type Safety**: Ensure all shared types are in `src/mastra/types/`
3. **Tool Registration**: Register all new agents/workflows in `src/mastra/index.ts`
4. **Testing**: Write tests for all new functionality
5. **Documentation**: Update API contracts for any new endpoints
