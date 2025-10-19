# Mastra Business Intelligence MCP Server

This document provides comprehensive documentation for the Model Context Protocol (MCP) server implementation in the Mastra Business Intelligence system.

## Overview

The Mastra MCP Server exposes the system's AI agents, workflows, knowledge base, and memory capabilities to external MCP clients such as:

- Cursor IDE with MCP support
- Claude Desktop application
- Other MCP-compatible tools and editors
- Web-based applications via HTTP SSE

## Architecture

The MCP server implementation follows a modular architecture with clear separation of concerns:

```
src/mastra/mcp-server/
├── index.ts                 # Main server initialization and configuration
├── start.ts                 # CLI startup script with argument parsing
├── protocol.ts              # Core MCP protocol implementation
├── transport/
│   └── http-sse.ts          # HTTP Server-Sent Events transport
└── tools/
    ├── agents.ts            # Agent tool wrappers for MCP exposure
    ├── workflows.ts         # Workflow tool wrappers for MCP exposure
    ├── knowledge.ts         # Knowledge base MCP tools
    └── memory.ts            # Memory system MCP tools
```

### Key Components

#### 1. MCP Protocol Handler (`protocol.ts`)
- Implements core MCP protocol methods (tools, resources, prompts, logging)
- Handles tool discovery and execution
- Manages resource access and metadata
- Provides comprehensive error handling and observability

#### 2. Transport Layer (`transport/http-sse.ts`)
- HTTP Server-Sent Events implementation for web clients
- Real-time bidirectional communication
- CORS support for cross-origin requests
- Connection management with heartbeat and timeout handling

#### 3. Tool Wrappers (`tools/*.ts`)
- **Agents**: Execute AI agents with business intelligence capabilities
- **Workflows**: Run multi-step business processes with state management
- **Knowledge**: Search and manage knowledge base documents
- **Memory**: Store, retrieve, and manage user and global memory

#### 4. Server Management (`index.ts`)
- Centralized server configuration and lifecycle management
- Support for multiple transport types (stdio, SSE, both)
- Health checking and statistics reporting
- Graceful startup and shutdown procedures

## Installation and Setup

### Prerequisites

- Node.js ≥20.9.0
- pnpm package manager
- Required environment variables (see [Environment Variables](#environment-variables))

### Installation

The MCP server dependencies are already included in the main project. No additional installation is required.

## Usage

### Starting the Server

#### Using npm Scripts (Recommended)

```bash
# Start with default configuration (both stdio and SSE)
pnpm run mcp:start

# Start only stdio transport (for command-line clients)
pnpm run mcp:start:stdio

# Start only SSE transport (for web clients)
pnpm run mcp:start:sse

# Start in development mode with debug logging
pnpm run mcp:start:dev

# Start in production mode
pnpm run mcp:start:prod
```

#### Using Direct Node Execution

```bash
# Start with custom configuration
node --loader ts-node/esm src/mastra/mcp-server/start.ts --transport both --port 3001 --log-level info

# Show help for all available options
node --loader ts-node/esm src/mastra/mcp-server/start.ts --help
```

#### Programmatic Usage

```typescript
import { createMastraMCPServer, MastraMCPServerConfig } from './src/mastra/mcp-server/index.js';

const config: MastraMCPServerConfig = {
  name: 'my-mastra-server',
  version: '1.0.0',
  transport: {
    type: 'sse',
    sse: {
      port: 3001,
      host: '0.0.0.0',
    },
  },
  tools: {
    enableAgents: true,
    enableWorkflows: true,
    enableKnowledge: true,
    enableMemory: true,
  },
  environment: 'production',
};

const server = createMastraMCPServer(config);
await server.start();
```

### Monitoring and Health Checks

When running with SSE transport, the server provides several HTTP endpoints:

```bash
# Check server health
pnpm run mcp:health
# Or: curl -s http://localhost:3001/health

# Get server statistics
pnpm run mcp:stats
# Or: curl -s http://localhost:3001/stats

# Get server information
pnpm run mcp:info
# Or: curl -s http://localhost:3001/info
```

## Configuration

### CLI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--name` | string | `mastra-business-intelligence` | Server name |
| `--version` | string | `1.0.0` | Server version |
| `--transport` | `stdio\|sse\|both` | `both` | Transport type |
| `--port` | number | `3001` | SSE server port |
| `--host` | string | `0.0.0.0` | SSE server host |
| `--enable-agents` | boolean | `true` | Enable agent tools |
| `--disable-agents` | - | - | Disable agent tools |
| `--enable-workflows` | boolean | `true` | Enable workflow tools |
| `--disable-workflows` | - | - | Disable workflow tools |
| `--enable-knowledge` | boolean | `true` | Enable knowledge base tools |
| `--disable-knowledge` | - | - | Disable knowledge base tools |
| `--enable-memory` | boolean | `true` | Enable memory tools |
| `--disable-memory` | - | - | Disable memory tools |
| `--log-level` | `debug\|info\|warn\|error` | `info` | Log level |
| `--environment` | `development\|production\|test` | `development` | Environment |
| `--config-file` | string | - | Configuration file path |
| `--enable-tracing` | boolean | `true` | Enable observability tracing |
| `--disable-tracing` | - | - | Disable observability tracing |
| `--max-connections` | number | `100` | Maximum SSE connections |
| `--timeout` | number | `300000` | Connection timeout (ms) |

### Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `MCP_SERVER_NAME` | string | Override server name |
| `MCP_SERVER_VERSION` | string | Override server version |
| `MCP_TRANSPORT` | `stdio\|sse\|both` | Override transport type |
| `MCP_PORT` | number | Override SSE port |
| `MCP_HOST` | string | Override SSE host |
| `MCP_SSE_PATH` | string | Override SSE endpoint path |
| `MCP_MESSAGE_PATH` | string | Override message endpoint path |
| `MCP_ENABLE_AGENTS` | boolean | Override agent tools setting |
| `MCP_ENABLE_WORKFLOWS` | boolean | Override workflow tools setting |
| `MCP_ENABLE_KNOWLEDGE` | boolean | Override knowledge tools setting |
| `MCP_ENABLE_MEMORY` | boolean | Override memory tools setting |
| `MCP_ENABLE_TRACING` | boolean | Override tracing setting |
| `MCP_LOG_LEVEL` | `debug\|info\|warn\|error` | Override log level |
| `NODE_ENV` | `development\|production\|test` | Override environment |

### Configuration Files

You can use a configuration file (JavaScript or JSON) to specify server settings:

```javascript
// mcp-config.js
export default {
  name: 'custom-mastra-server',
  version: '2.0.0',
  transport: {
    type: 'sse',
    sse: {
      port: 4001,
      cors: {
        origin: ['http://localhost:3000', 'https://mydomain.com'],
        credentials: true,
      },
    },
  },
  tools: {
    enableAgents: true,
    enableWorkflows: false,
    enableKnowledge: true,
    enableMemory: true,
  },
  options: {
    enableTracing: false,
    logLevel: 'warn',
  },
};
```

Then start with: `--config-file ./mcp-config.js`

## Available Tools

The MCP server exposes the following categories of tools:

### Agent Tools

- `execute-agent-business-intelligence-agent`: Execute the business intelligence agent
- `execute-agent-default-agent`: Execute the default agent
- `agent-info-*`: Get information about specific agents
- `list-agents`: List all available agents
- `agent-health-check`: Check agent system health

### Workflow Tools

- `execute-workflow-orchestrator`: Execute the orchestrator workflow
- `execute-workflow-planning`: Execute the planning workflow
- `execute-workflow-intent-classifier`: Execute the intent classifier workflow
- `workflow-info-*`: Get information about specific workflows
- `list-workflows`: List all available workflows
- `workflow-health-check`: Check workflow system health

### Knowledge Base Tools

- `knowledge-search`: Search the knowledge base
- `get-document`: Retrieve specific documents
- `find-similar-documents`: Find similar documents
- `knowledge-stats`: Get knowledge base statistics
- `document-upload-status`: Check document processing status
- `knowledge-health-check`: Check knowledge system health

### Memory Tools

- `search-all-memory`: Search both user and global memory
- `search-user-memory`: Search user-specific memory
- `search-global-memory`: Search global memory
- `store-memory`: Store new memory entries
- `update-memory`: Update existing memory entries
- `delete-memory`: Delete memory entries
- `memory-stats`: Get memory usage statistics
- `memory-health-check`: Check memory system health

## Client Integration

### Cursor IDE

To use with Cursor IDE, add the following to your MCP configuration:

```json
{
  "mcpServers": {
    "mastra-business-intelligence": {
      "command": "node",
      "args": [
        "--loader", "ts-node/esm",
        "/path/to/your/project/src/mastra/mcp-server/start.ts",
        "--transport", "stdio"
      ],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "mastra-business-intelligence": {
      "command": "node",
      "args": [
        "--loader", "ts-node/esm",
        "/absolute/path/to/project/src/mastra/mcp-server/start.ts",
        "--transport", "stdio",
        "--log-level", "info"
      ]
    }
  }
}
```

### Web Clients

For web-based clients, use the HTTP SSE transport:

```javascript
// Connect to SSE endpoint
const eventSource = new EventSource('http://localhost:3001/mcp/sse');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

// Send messages via POST
fetch('http://localhost:3001/mcp/message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'tools/call',
    data: {
      toolName: 'knowledge-search',
      arguments: {
        query: 'business intelligence',
        maxResults: 5,
      },
    },
  }),
});
```

## Observability

### Logging

The server uses structured logging with configurable levels:

- **debug**: Detailed information for debugging
- **info**: General operational information
- **warn**: Warning conditions that should be addressed
- **error**: Error conditions that need immediate attention

### Tracing

When tracing is enabled, the server integrates with LangFuse for comprehensive observability:

- Tool execution traces
- Agent conversation traces
- Workflow step traces
- Performance metrics
- Error tracking

### Health Monitoring

The server provides comprehensive health checking:

- **Component Health**: Individual system component status
- **Connection Health**: Active connection monitoring
- **Performance Metrics**: Response times and throughput
- **Resource Usage**: Memory and CPU utilization

## Troubleshooting

### Common Issues

#### Server Won't Start

1. **Port Already in Use**
   ```bash
   # Check what's using the port
   lsof -i :3001

   # Use a different port
   pnpm run mcp:start -- --port 3002
   ```

2. **TypeScript Compilation Errors**
   ```bash
   # Ensure TypeScript and ts-node are installed
   pnpm install

   # Check TypeScript configuration
   npx tsc --noEmit
   ```

3. **Missing Dependencies**
   ```bash
   # Reinstall dependencies
   rm -rf node_modules
   pnpm install
   ```

#### Client Connection Issues

1. **CORS Errors** (Web clients)
   - Ensure the client origin is included in CORS configuration
   - Check browser developer console for specific CORS messages

2. **stdio Transport Issues** (Cursor/Claude Desktop)
   - Verify the file path in the MCP configuration is absolute
   - Check that Node.js version ≥20.9.0 is installed
   - Ensure all required environment variables are set

3. **Tool Execution Failures**
   - Check server logs for detailed error messages
   - Verify that all required services (database, APIs) are available
   - Ensure proper authentication tokens are configured

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
pnpm run mcp:start:dev
```

Or set the log level explicitly:

```bash
pnpm run mcp:start -- --log-level debug
```

### Performance Tuning

For high-load scenarios:

1. **Increase Connection Limits**
   ```bash
   pnpm run mcp:start -- --max-connections 500
   ```

2. **Adjust Timeouts**
   ```bash
   pnpm run mcp:start -- --timeout 600000  # 10 minutes
   ```

3. **Disable Tracing** in production for better performance:
   ```bash
   pnpm run mcp:start -- --disable-tracing
   ```

## Security Considerations

### Network Security

- **CORS Configuration**: Properly configure allowed origins for web clients
- **Host Binding**: Bind to specific interfaces rather than 0.0.0.0 in production
- **Port Security**: Use non-standard ports and consider firewall rules

### Data Security

- **Memory Isolation**: User memory is isolated by user ID
- **Access Control**: Implement proper authentication in client applications
- **Audit Logging**: Enable tracing for security auditing

### Environment Security

- **Environment Variables**: Store sensitive configuration in environment variables
- **File Permissions**: Ensure configuration files have appropriate permissions
- **Process Security**: Run the server with minimal required privileges

## Development

### Adding Custom Tools

To add custom tools to the MCP server:

1. Create tool definitions using the Mastra `createTool` function
2. Add tools to the `customTools` array in server configuration
3. Restart the server to register new tools

Example:

```typescript
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const myCustomTool = createTool({
  id: 'my-custom-tool',
  description: 'My custom tool for MCP clients',
  inputSchema: z.object({
    input: z.string().describe('Input parameter'),
  }),
  outputSchema: z.object({
    result: z.string().describe('Tool result'),
  }),
  execute: async ({ input }) => {
    // Tool implementation
    return { result: `Processed: ${input.input}` };
  },
});

// Add to server configuration
const config = {
  // ... other config
  tools: {
    enableAgents: true,
    enableWorkflows: true,
    enableKnowledge: true,
    enableMemory: true,
    customTools: [myCustomTool],
  },
};
```

### Testing

Test the MCP server using the provided monitoring endpoints:

```bash
# Test server startup
pnpm run mcp:start:dev &
SERVER_PID=$!

# Test health endpoint
curl -f http://localhost:3001/health || echo "Health check failed"

# Test stats endpoint
curl -f http://localhost:3001/stats || echo "Stats check failed"

# Clean up
kill $SERVER_PID
```

## API Reference

### HTTP Endpoints (SSE Transport)

#### GET /mcp/sse
Server-Sent Events endpoint for real-time communication.

**Response**: SSE stream with MCP protocol messages

#### POST /mcp/message
Message posting endpoint for client-to-server communication.

**Request Body**:
```json
{
  "connectionId": "optional_connection_id",
  "type": "message_type",
  "data": {},
  "id": "optional_message_id"
}
```

**Response**:
```json
{
  "success": true,
  "messageId": "message_id",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /health
Health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "name": "mastra-business-intelligence",
  "version": "1.0.0",
  "uptime": 12345,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /stats
Server statistics endpoint.

**Response**:
```json
{
  "status": "running",
  "uptime": 12345,
  "connections": {
    "total": 10,
    "active": 5,
    "sse": {
      "connections": 5,
      "totalMessages": 1000
    }
  },
  "tools": {
    "registered": 25,
    "byCategory": {
      "agents": 4,
      "workflows": 8,
      "knowledge": 6,
      "memory": 7
    }
  },
  "requests": {
    "total": 1000,
    "successful": 950,
    "failed": 50,
    "averageResponseTime": 150
  },
  "memory": {
    "used": 134217728,
    "total": 268435456
  }
}
```

#### GET /info
Server information endpoint.

**Response**:
```json
{
  "name": "mastra-business-intelligence",
  "version": "1.0.0",
  "description": "Mastra Business Intelligence MCP Server",
  "transport": "both",
  "tools": {
    "total": 25,
    "categories": {
      "agents": 4,
      "workflows": 8,
      "knowledge": 6,
      "memory": 7
    }
  },
  "environment": "development"
}
```

## License

This MCP server implementation is part of the Mastra Business Intelligence system and follows the same licensing terms as the parent project.

## Support

For issues, feature requests, or contributions:

1. Check the troubleshooting section above
2. Review server logs for detailed error information
3. Consult the main project documentation
4. Open an issue in the project repository

---

*This documentation is current as of the MCP server implementation date. For the most up-to-date information, refer to the source code and inline documentation.*