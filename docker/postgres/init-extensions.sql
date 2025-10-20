-- ============================================================================
-- PostgreSQL Extensions Initialization for Mastra Document Processing
-- ============================================================================
-- This script initializes pgvector and pgmq extensions and sets up
-- the message queues for document processing pipeline
-- ============================================================================

-- Enable extensions in correct order
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgmq CASCADE;

-- Create message queues for document processing
SELECT pgmq.create('document_extraction');
SELECT pgmq.create('document_embedding');

-- Verify installation
\echo 'Installed extensions:'
\dx

\echo 'Available message queues:'
SELECT * FROM pgmq.list_queues();

-- Grant permissions for message queues (adjust user as needed)
-- GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO mastra;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO mastra;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO mastra;

\echo 'PostgreSQL extensions and queues initialized successfully!'