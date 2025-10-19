-- Create processing_jobs table for async document processing
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    progress JSONB,
    metadata JSONB NOT NULL,

    -- Add indexes for common queries
    CONSTRAINT processing_jobs_priority_check CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    CONSTRAINT processing_jobs_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_priority ON processing_jobs(priority);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_document_id ON processing_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs USING GIN ((metadata->>'userId'));

-- Create compound index for queue processing
CREATE INDEX IF NOT EXISTS idx_processing_jobs_queue ON processing_jobs(status, priority, created_at)
WHERE status IN ('pending', 'processing');

-- Add RLS policies if enabled
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Policy for users to see only their own jobs
CREATE POLICY processing_jobs_user_access ON processing_jobs
    FOR ALL USING (metadata->>'userId' = auth.uid()::text);

-- Policy for service role to manage all jobs
CREATE POLICY processing_jobs_service_access ON processing_jobs
    FOR ALL USING (auth.role() = 'service_role');

-- Add comments for documentation
COMMENT ON TABLE processing_jobs IS 'Queue for async document processing jobs with status tracking and retry logic';
COMMENT ON COLUMN processing_jobs.id IS 'Unique job identifier';
COMMENT ON COLUMN processing_jobs.document_id IS 'Associated document ID';
COMMENT ON COLUMN processing_jobs.priority IS 'Job priority: low, normal, high, critical';
COMMENT ON COLUMN processing_jobs.status IS 'Current job status';
COMMENT ON COLUMN processing_jobs.retry_count IS 'Number of retry attempts made';
COMMENT ON COLUMN processing_jobs.max_retries IS 'Maximum number of retry attempts allowed';
COMMENT ON COLUMN processing_jobs.progress IS 'Job progress information including stage, percentage, and current step';
COMMENT ON COLUMN processing_jobs.metadata IS 'Job metadata including user ID and request data';