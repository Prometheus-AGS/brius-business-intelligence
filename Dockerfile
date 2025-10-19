# Use Node.js 22 on Debian base
FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Install system dependencies needed for native modules and PostgreSQL client
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Create .env file template (will be overridden by docker-compose)
RUN touch .env

# Expose the port that Mastra dev server uses (typically 4000)
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

# Start the development server
CMD ["pnpm", "dev"]