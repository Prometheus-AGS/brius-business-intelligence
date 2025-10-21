-- ============================================================================
-- Knowledge Processing Jobs Table Migration
-- ============================================================================
-- This migration creates the missing knowledge_processing_jobs table that
-- is defined in the Drizzle schema but was missing from the initial migrations.
-- ============================================================================

-- Create the enum types if they don't exist
DO $$
BEGIN
    -- Processing priority enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'processing_priority') THEN
        CREATE TYPE processing_priority AS ENUM ('low', 'normal', 'high', 'critical');
    END IF;

    -- Processing job status enum
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'processing_job_status') THEN
        CREATE TYPE processing_job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
    END IF;
END $$;

-- Create knowledge_processing_jobs table
CREATE TABLE IF NOT EXISTS knowledge_processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    priority processing_priority NOT NULL DEFAULT 'normal',
    status processing_job_status NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Constraints
    CONSTRAINT knowledge_processing_jobs_retry_count_non_negative
        CHECK (retry_count >= 0),
    CONSTRAINT knowledge_processing_jobs_max_retries_positive
        CHECK (max_retries >= 0),
    CONSTRAINT knowledge_processing_jobs_retry_count_lte_max
        CHECK (retry_count <= max_retries)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_document_idx
    ON knowledge_processing_jobs(document_id);

CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_status_idx
    ON knowledge_processing_jobs(status);

CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_priority_idx
    ON knowledge_processing_jobs(priority);

-- Create composite index for the main queue query (status + priority + created_at)
CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_queue_idx
    ON knowledge_processing_jobs(status, priority DESC, created_at ASC)
    WHERE status = 'pending';

-- Create index for document status tracking
CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_document_status_idx
    ON knowledge_processing_jobs(document_id, status);

-- Update knowledge_documents table to add processed_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'knowledge_documents'
        AND column_name = 'processed_at'
    ) THEN
        ALTER TABLE knowledge_documents
        ADD COLUMN processed_at TIMESTAMPTZ;
    END IF;
END $$;

-- Create a function to automatically create processing jobs when documents are inserted
CREATE OR REPLACE FUNCTION create_processing_job_for_document()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create a processing job if the document is in pending status
    IF NEW.processing_status = 'pending' THEN
        INSERT INTO knowledge_processing_jobs (
            document_id,
            priority,
            status,
            metadata
        ) VALUES (
            NEW.id,
            'normal', -- default priority
            'pending',
            jsonb_build_object(
                'auto_created', true,
                'document_title', NEW.title,
                'document_type', NEW.file_type
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically create processing jobs
DROP TRIGGER IF EXISTS trigger_create_processing_job ON knowledge_documents;
CREATE TRIGGER trigger_create_processing_job
    AFTER INSERT ON knowledge_documents
    FOR EACH ROW
    EXECUTE FUNCTION create_processing_job_for_document();

-- Create a function to clean up old completed/failed jobs
CREATE OR REPLACE FUNCTION cleanup_old_processing_jobs(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM knowledge_processing_jobs
    WHERE status IN ('completed', 'failed', 'cancelled')
      AND completed_at < NOW() - INTERVAL '1 day' * days_to_keep;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RAISE NOTICE 'Cleaned up % old processing jobs older than % days', deleted_count, days_to_keep;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add some helpful views for monitoring
CREATE OR REPLACE VIEW processing_jobs_summary AS
SELECT
    status,
    priority,
    COUNT(*) as job_count,
    AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - created_at))) as avg_duration_seconds,
    MIN(created_at) as oldest_job,
    MAX(created_at) as newest_job
FROM knowledge_processing_jobs
GROUP BY status, priority
ORDER BY status, priority;

-- Create a view for active jobs with document details
CREATE OR REPLACE VIEW active_processing_jobs AS
SELECT
    kpj.id as job_id,
    kpj.status,
    kpj.priority,
    kpj.retry_count,
    kpj.max_retries,
    kpj.created_at as job_created_at,
    kpj.started_at,
    kpj.last_error,
    kd.id as document_id,
    kd.title as document_title,
    kd.file_type,
    kd.file_size,
    kd.processing_status as document_status,
    EXTRACT(EPOCH FROM (NOW() - kpj.created_at)) as age_seconds
FROM knowledge_processing_jobs kpj
JOIN knowledge_documents kd ON kpj.document_id = kd.id
WHERE kpj.status IN ('pending', 'processing')
ORDER BY kpj.priority DESC, kpj.created_at ASC;

-- Test the setup by inserting a test record (will be cleaned up)
DO $$
DECLARE
    test_doc_id UUID;
    test_job_count INTEGER;
BEGIN
    -- Insert a test document to verify the trigger works
    INSERT INTO knowledge_documents (
        title,
        content,
        processing_status,
        file_type
    ) VALUES (
        'Test Document for Processing Job Creation',
        'This is a test document to verify that processing jobs are created automatically.',
        'pending',
        'text/plain'
    ) RETURNING id INTO test_doc_id;

    -- Check if the processing job was created
    SELECT COUNT(*) INTO test_job_count
    FROM knowledge_processing_jobs
    WHERE document_id = test_doc_id;

    IF test_job_count = 1 THEN
        RAISE NOTICE '✓ Processing job trigger working correctly';
    ELSE
        RAISE WARNING '⚠ Processing job trigger may not be working (found % jobs)', test_job_count;
    END IF;

    -- Clean up test data
    DELETE FROM knowledge_documents WHERE id = test_doc_id;

    RAISE NOTICE '✓ Test data cleaned up successfully';
END $$;

-- Display summary information
SELECT
    'KNOWLEDGE PROCESSING JOBS MIGRATION COMPLETED' as status,
    (SELECT COUNT(*) FROM knowledge_processing_jobs) as total_jobs,
    (SELECT COUNT(*) FROM knowledge_processing_jobs WHERE status = 'pending') as pending_jobs,
    (SELECT COUNT(*) FROM knowledge_processing_jobs WHERE status = 'processing') as processing_jobs,
    (SELECT COUNT(*) FROM knowledge_processing_jobs WHERE status = 'completed') as completed_jobs,
    (SELECT COUNT(*) FROM knowledge_processing_jobs WHERE status = 'failed') as failed_jobs;

-- Show available views
SELECT
    'AVAILABLE VIEWS' as info,
    'processing_jobs_summary, active_processing_jobs' as view_names;

-- Show available functions
SELECT
    'AVAILABLE FUNCTIONS' as info,
    'cleanup_old_processing_jobs(days_to_keep)' as function_names;

COMMIT;