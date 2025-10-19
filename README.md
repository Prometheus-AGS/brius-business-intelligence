# Mastra Business Intelligence - Docker Setup

This project provides a complete Docker setup for running the Mastra playground with PostgreSQL pgvector, Langfuse observability, and AWS Bedrock integration.

## Architecture

The Docker setup includes:

- **Mastra Playground**: Node.js 22 application running in development mode
- **PostgreSQL with pgvector**: Vector database for storage and RAG operations
- **Langfuse**: LLM observability and evaluation platform
- **AWS Bedrock Integration**: Claude 3.5 Sonnet and Titan v2 embedder via AI Gateway

## Prerequisites

1. **Docker & Docker Compose**: Install Docker Desktop or Docker Engine with Docker Compose
2. **AWS Account**: With access to Bedrock services
3. **AI Gateway API Key**: From Vercel (for Bedrock access)
4. **Langfuse Account**: For observability (optional, can use local instance)

## Quick Start

### 1. Clone and Setup

```bash
git clone <your-repo>
cd brius-business-intelligence
```

### 2. Configure Environment

Copy the environment template:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# AWS Bedrock Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key

# AI Gateway Configuration (for Bedrock access)
AI_GATEWAY_API_KEY=your_ai_gateway_api_key

# Langfuse Configuration
LANGFUSE_PUBLIC_KEY=pk-lf-your-public-key
LANGFUSE_SECRET_KEY=sk-lf-your-secret-key
LANGFUSE_BASEURL=http://localhost:3000
```

### 3. Start Services

```bash
docker-compose up -d
```

This will start:
- PostgreSQL with pgvector on port 5432
- Langfuse on port 3000
- Mastra playground on port 4000

### 4. Access Applications

- **Mastra Playground**: http://localhost:4000
- **Langfuse Dashboard**: http://localhost:3000
- **PostgreSQL**: localhost:5432

## Configuration Details

### AWS Bedrock Models

The setup is configured to use:
- **Chat Model**: `anthropic.claude-3-5-sonnet-20241022-v2:0`
- **Embedding Model**: `amazon.titan-embed-text-v2:0`

### PostgreSQL pgvector

- **Version**: PostgreSQL 17 with pgvector extension
- **Database**: `mastra`
- **User**: `mastra`
- **Password**: `mastra_password`

### Langfuse Setup

The Langfuse instance includes:
- Automatic database setup
- Health checks
- Integration with Mastra for LLM observability

## Development

### Local Development

To run locally without Docker:

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Accessing Logs

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f mastra
docker-compose logs -f postgres
docker-compose logs -f langfuse
```

### Database Access

Connect to PostgreSQL:

```bash
# Using psql
docker-compose exec postgres psql -U mastra -d mastra

# Or connect from host
psql -h localhost -p 5432 -U mastra -d mastra
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**: Ensure ports 3000, 4000, and 5432 are available
2. **AWS Credentials**: Verify your AWS credentials have Bedrock access
3. **AI Gateway**: Ensure your AI Gateway API key is valid
4. **Memory Issues**: Increase Docker memory allocation if needed

### Health Checks

All services include health checks:

```bash
# Check service status
docker-compose ps

# Check specific service health
docker-compose exec mastra curl -f http://localhost:4000/health
```

### Reset Database

To reset the PostgreSQL database:

```bash
docker-compose down -v
docker-compose up -d
```

## File Structure

```
.
├── Dockerfile                 # Mastra application container
├── docker-compose.yaml       # Multi-service orchestration
├── init-db.sql              # PostgreSQL initialization
├── .env.example              # Environment template
├── src/mastra/
│   ├── index.ts              # Main Mastra configuration
│   ├── config/
│   │   └── llm-config.ts     # AI Gateway & Bedrock setup
│   ├── agents/
│   │   └── weather-agent.ts  # Example agent with Bedrock
│   └── tools/
│       └── weather-tool.ts   # Example tool
└── README.md                 # This file
```

## Production Deployment

For production deployment:

1. Use environment-specific `.env` files
2. Configure proper secrets management
3. Set up SSL/TLS certificates
4. Use production-grade PostgreSQL setup
5. Configure proper backup strategies

## Support

For issues and questions:
- Check the [Mastra Documentation](https://mastra.ai/docs)
- Review Docker logs for error details
- Ensure all environment variables are properly set