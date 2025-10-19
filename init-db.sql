-- Initialize PostgreSQL database with pgvector extension for Mastra
-- This script runs automatically when the PostgreSQL container starts

-- Create the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create a database for Mastra if it doesn't exist
-- (The main database is already created via POSTGRES_DB environment variable)

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE mastra TO mastra;

-- Create schema for vector operations if needed
CREATE SCHEMA IF NOT EXISTS vectors;
GRANT ALL ON SCHEMA vectors TO mastra;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'PostgreSQL with pgvector extension initialized successfully for Mastra';
END $$;

-- Create a database for Langfuse if it doesn't exist
CREATE DATABASE langfuse;

-- Create a user for Langfuse if it doesn't exist
CREATE USER langfuse WITH PASSWORD 'langfuse_password';
GRANT ALL PRIVILEGES ON DATABASE langfuse TO langfuse;

-- Connect to langfuse database to set up permissions
\c langfuse;

-- Grant permissions on the public schema (required for Prisma migrations)
GRANT ALL ON SCHEMA public TO langfuse;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO langfuse;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO langfuse;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO langfuse;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO langfuse;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO langfuse;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO langfuse;

-- Make langfuse the owner of the public schema
ALTER SCHEMA public OWNER TO langfuse;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'PostgreSQL with pgvector extension initialized successfully for Langfuse and user created';
END $$;
