-- Business Intelligence Context Enhancement Tables
-- Plain PostgreSQL migration (no Supabase dependencies)
-- Migration: 007-create-bi-context-tables
-- Created: 2025-10-23

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create enums for BI context management (plain PostgreSQL)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'context_status') THEN
        CREATE TYPE context_status AS ENUM ('active', 'paused', 'completed', 'failed', 'degraded');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
        CREATE TYPE session_status AS ENUM ('initiated', 'active', 'waiting', 'processing', 'completed', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'domain_type') THEN
        CREATE TYPE domain_type AS ENUM ('clinical', 'financial', 'operational', 'customer-service');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pattern_type') THEN
        CREATE TYPE pattern_type AS ENUM ('planner-executor', 'reactive', 'streaming', 'hybrid');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'memory_scope') THEN
        CREATE TYPE memory_scope AS ENUM ('user', 'global');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_type') THEN
        CREATE TYPE content_type AS ENUM ('conversation', 'knowledge', 'preference');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_level') THEN
        CREATE TYPE access_level AS ENUM ('public', 'restricted', 'admin');
    END IF;
END
$$;

-- ============================================================================
-- User Context table for managing authenticated and anonymous user sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_id UUID NOT NULL UNIQUE,
    role_id TEXT NOT NULL,
    department_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
    permissions JSONB NOT NULL,
    preferences JSONB,
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    token_expiry TIMESTAMP WITH TIME ZONE NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 0, -- 0=false, 1=true (for compatibility)
    status context_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for user_contexts
CREATE INDEX IF NOT EXISTS user_contexts_user_id_idx ON user_contexts(user_id);
CREATE INDEX IF NOT EXISTS user_contexts_session_id_idx ON user_contexts(session_id);
CREATE INDEX IF NOT EXISTS user_contexts_status_idx ON user_contexts(status);
CREATE INDEX IF NOT EXISTS user_contexts_last_activity_idx ON user_contexts(last_activity);
CREATE INDEX IF NOT EXISTS user_contexts_role_anonymous_idx ON user_contexts(role_id, is_anonymous);

-- ============================================================================
-- Analysis Sessions table for tracking user BI sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS analysis_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_query_time TIMESTAMP WITH TIME ZONE,
    query_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_state JSONB NOT NULL,
    domain_access JSONB NOT NULL DEFAULT '[]'::jsonb,
    status session_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for analysis_sessions
CREATE INDEX IF NOT EXISTS analysis_sessions_user_id_idx ON analysis_sessions(user_id);
CREATE INDEX IF NOT EXISTS analysis_sessions_session_id_idx ON analysis_sessions(session_id);
CREATE INDEX IF NOT EXISTS analysis_sessions_status_idx ON analysis_sessions(status);
CREATE INDEX IF NOT EXISTS analysis_sessions_start_time_idx ON analysis_sessions(start_time DESC);

-- ============================================================================
-- Domain Datasets table for multi-domain data integration
-- ============================================================================
CREATE TABLE IF NOT EXISTS domain_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL UNIQUE,
    domain_type domain_type NOT NULL,
    table_name TEXT NOT NULL,
    schema JSONB NOT NULL,
    relationships JSONB NOT NULL DEFAULT '[]'::jsonb,
    access_level access_level NOT NULL DEFAULT 'public',
    data_quality JSONB,
    last_analyzed TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for domain_datasets
CREATE INDEX IF NOT EXISTS domain_datasets_dataset_id_idx ON domain_datasets(dataset_id);
CREATE INDEX IF NOT EXISTS domain_datasets_domain_type_idx ON domain_datasets(domain_type);
CREATE INDEX IF NOT EXISTS domain_datasets_table_name_idx ON domain_datasets(table_name);
CREATE INDEX IF NOT EXISTS domain_datasets_access_level_idx ON domain_datasets(access_level);
CREATE INDEX IF NOT EXISTS domain_datasets_last_analyzed_idx ON domain_datasets(last_analyzed DESC NULLS LAST);

-- ============================================================================
-- Visualization Artifacts table for React component generation
-- ============================================================================
CREATE TABLE IF NOT EXISTS visualization_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id UUID NOT NULL UNIQUE,
    session_id UUID NOT NULL,
    component_name TEXT NOT NULL,
    component_code TEXT NOT NULL,
    data_binding JSONB NOT NULL,
    style_definition JSONB NOT NULL,
    dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    generation_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for visualization_artifacts
CREATE INDEX IF NOT EXISTS visualization_artifacts_artifact_id_idx ON visualization_artifacts(artifact_id);
CREATE INDEX IF NOT EXISTS visualization_artifacts_session_id_idx ON visualization_artifacts(session_id);
CREATE INDEX IF NOT EXISTS visualization_artifacts_component_name_idx ON visualization_artifacts(component_name);
CREATE INDEX IF NOT EXISTS visualization_artifacts_generation_time_idx ON visualization_artifacts(generation_time DESC);

-- ============================================================================
-- Agent Architecture Patterns table for pattern evaluation
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_architecture_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_id UUID NOT NULL UNIQUE,
    pattern_type pattern_type NOT NULL,
    query_complexity JSONB NOT NULL,
    performance_metrics JSONB NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    success_rate INTEGER NOT NULL DEFAULT 0, -- Using integer for decimal * 10000
    last_evaluated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for agent_architecture_patterns
CREATE INDEX IF NOT EXISTS agent_architecture_patterns_pattern_id_idx ON agent_architecture_patterns(pattern_id);
CREATE INDEX IF NOT EXISTS agent_architecture_patterns_pattern_type_idx ON agent_architecture_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS agent_architecture_patterns_usage_count_idx ON agent_architecture_patterns(usage_count DESC);
CREATE INDEX IF NOT EXISTS agent_architecture_patterns_success_rate_idx ON agent_architecture_patterns(success_rate DESC);

-- ============================================================================
-- Context State table for session management and recovery
-- ============================================================================
CREATE TABLE IF NOT EXISTS context_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_id UUID NOT NULL UNIQUE,
    session_id UUID NOT NULL UNIQUE,
    state_data JSONB NOT NULL,
    history_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
    reconstruction_data JSONB,
    last_update TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    is_corrupted INTEGER NOT NULL DEFAULT 0, -- 0=false, 1=true (for compatibility)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for context_states
CREATE INDEX IF NOT EXISTS context_states_state_id_idx ON context_states(state_id);
CREATE INDEX IF NOT EXISTS context_states_session_id_idx ON context_states(session_id);
CREATE INDEX IF NOT EXISTS context_states_last_update_idx ON context_states(last_update DESC);
CREATE INDEX IF NOT EXISTS context_states_corrupted_idx ON context_states(is_corrupted)
WHERE is_corrupted = 1;

-- ============================================================================
-- Enhanced Memory Tables (extending existing memory system for BI context)
-- ============================================================================

-- Update existing user_memories table to support BI context scoping
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_memories' AND column_name = 'session_id') THEN
        ALTER TABLE user_memories ADD COLUMN session_id UUID;
        CREATE INDEX IF NOT EXISTS user_memories_session_id_idx ON user_memories(session_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_memories' AND column_name = 'content_type') THEN
        ALTER TABLE user_memories ADD COLUMN content_type content_type DEFAULT 'conversation';
        CREATE INDEX IF NOT EXISTS user_memories_content_type_idx ON user_memories(content_type);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_memories' AND column_name = 'scope') THEN
        ALTER TABLE user_memories ADD COLUMN scope memory_scope DEFAULT 'user';
        CREATE INDEX IF NOT EXISTS user_memories_scope_idx ON user_memories(scope);
    END IF;
END
$$;

-- Update existing global_memories table to support BI context scoping
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'global_memories' AND column_name = 'content_type') THEN
        ALTER TABLE global_memories ADD COLUMN content_type content_type DEFAULT 'knowledge';
        CREATE INDEX IF NOT EXISTS global_memories_content_type_idx ON global_memories(content_type);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'global_memories' AND column_name = 'scope') THEN
        ALTER TABLE global_memories ADD COLUMN scope memory_scope DEFAULT 'global';
        CREATE INDEX IF NOT EXISTS global_memories_scope_idx ON global_memories(scope);
    END IF;
END
$$;

-- ============================================================================
-- Functions for Context Management (Plain PostgreSQL)
-- ============================================================================

-- Function to update context last_activity automatically
CREATE OR REPLACE FUNCTION update_context_activity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_activity = NOW();
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating activity
DROP TRIGGER IF EXISTS trigger_user_contexts_activity ON user_contexts;
CREATE TRIGGER trigger_user_contexts_activity
    BEFORE UPDATE ON user_contexts
    FOR EACH ROW
    EXECUTE FUNCTION update_context_activity();

-- Function to maintain query history size limit
CREATE OR REPLACE FUNCTION maintain_query_history()
RETURNS TRIGGER AS $$
DECLARE
    history_array JSONB;
    history_count INTEGER;
    max_entries INTEGER := 100; -- Configurable limit
BEGIN
    history_array := NEW.query_history;
    history_count := jsonb_array_length(history_array);

    -- Trim history if it exceeds max entries
    IF history_count > max_entries THEN
        -- Keep only the most recent entries
        NEW.query_history := (
            SELECT jsonb_agg(elem)
            FROM (
                SELECT elem
                FROM jsonb_array_elements(history_array) AS elem
                ORDER BY (elem->>'timestamp')::timestamp DESC
                LIMIT max_entries
            ) AS recent_entries
        );
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for maintaining query history
DROP TRIGGER IF EXISTS trigger_analysis_sessions_history ON analysis_sessions;
CREATE TRIGGER trigger_analysis_sessions_history
    BEFORE UPDATE ON analysis_sessions
    FOR EACH ROW
    WHEN (OLD.query_history IS DISTINCT FROM NEW.query_history)
    EXECUTE FUNCTION maintain_query_history();

-- ============================================================================
-- Context Recovery Functions (Plain PostgreSQL)
-- ============================================================================

-- Function to mark context as corrupted and trigger recovery
CREATE OR REPLACE FUNCTION mark_context_corrupted(p_session_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE context_states
    SET
        is_corrupted = 1,
        reconstruction_data = jsonb_build_object(
            'corruption_detected_at', NOW(),
            'automatic_recovery_triggered', true
        ),
        updated_at = NOW()
    WHERE session_id = p_session_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get context recovery data
CREATE OR REPLACE FUNCTION get_context_recovery_data(p_session_id UUID)
RETURNS TABLE (
    state_data JSONB,
    history_count INTEGER,
    last_valid_state JSONB,
    corruption_timestamp TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cs.state_data,
        jsonb_array_length(cs.history_stack) as history_count,
        (
            SELECT elem
            FROM jsonb_array_elements(cs.history_stack) AS elem
            WHERE (elem->>'contextValid')::boolean = true
            ORDER BY (elem->>'timestamp')::timestamp DESC
            LIMIT 1
        ) as last_valid_state,
        (cs.reconstruction_data->>'corruption_detected_at')::timestamp with time zone as corruption_timestamp
    FROM context_states cs
    WHERE cs.session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Performance and Monitoring Functions (Plain PostgreSQL)
-- ============================================================================

-- Function to get active session statistics
CREATE OR REPLACE FUNCTION get_active_session_stats()
RETURNS TABLE (
    total_active_sessions INTEGER,
    authenticated_sessions INTEGER,
    anonymous_sessions INTEGER,
    average_session_duration INTERVAL,
    domains_accessed JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::INTEGER as total_active_sessions,
        SUM(CASE WHEN is_anonymous = 0 THEN 1 ELSE 0 END)::INTEGER as authenticated_sessions,
        SUM(CASE WHEN is_anonymous = 1 THEN 1 ELSE 0 END)::INTEGER as anonymous_sessions,
        AVG(NOW() - uc.created_at) as average_session_duration,
        jsonb_agg(DISTINCT uc.department_scope) as domains_accessed
    FROM user_contexts uc
    WHERE uc.status = 'active';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Performance Optimization
-- ============================================================================

-- Create partial indexes for active sessions only
CREATE INDEX IF NOT EXISTS user_contexts_active_idx
ON user_contexts(user_id, session_id, last_activity)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS analysis_sessions_active_idx
ON analysis_sessions(user_id, last_query_time)
WHERE status = 'active';

-- GIN indexes for JSONB columns that will be queried
CREATE INDEX IF NOT EXISTS user_contexts_permissions_gin_idx
ON user_contexts USING GIN (permissions);

CREATE INDEX IF NOT EXISTS analysis_sessions_domain_access_gin_idx
ON analysis_sessions USING GIN (domain_access);

CREATE INDEX IF NOT EXISTS domain_datasets_schema_gin_idx
ON domain_datasets USING GIN (schema);

CREATE INDEX IF NOT EXISTS domain_datasets_relationships_gin_idx
ON domain_datasets USING GIN (relationships);

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE user_contexts IS 'User context management for authenticated and anonymous BI sessions (Plain PostgreSQL)';
COMMENT ON COLUMN user_contexts.is_anonymous IS 'Flag for anonymous users (0=authenticated, 1=anonymous)';
COMMENT ON COLUMN user_contexts.department_scope IS 'Array of departments/regions the user has access to';
COMMENT ON COLUMN user_contexts.permissions IS 'Permission matrix for clinical, financial, operational, customer-service domains';

COMMENT ON TABLE analysis_sessions IS 'BI analysis sessions with query history and context state';
COMMENT ON COLUMN analysis_sessions.query_history IS 'Ordered array of queries and responses with timestamps';
COMMENT ON COLUMN analysis_sessions.context_state IS 'Current workflow and data context state';
COMMENT ON COLUMN analysis_sessions.domain_access IS 'Domains accessed during this session';

COMMENT ON TABLE domain_datasets IS 'Multi-domain data integration metadata and relationships';
COMMENT ON COLUMN domain_datasets.data_quality IS 'Quality metrics: completeness, consistency, accuracy, timeliness, validity';
COMMENT ON COLUMN domain_datasets.relationships IS 'Foreign key relationships to other datasets';

COMMENT ON TABLE visualization_artifacts IS 'Generated React TSX components with embedded styling';
COMMENT ON COLUMN visualization_artifacts.component_code IS 'Complete TSX component source code';
COMMENT ON COLUMN visualization_artifacts.style_definition IS 'CSS-in-JS styling rules embedded in component';

COMMENT ON TABLE agent_architecture_patterns IS 'Agent pattern evaluation and performance metrics';
COMMENT ON COLUMN agent_architecture_patterns.success_rate IS 'Success rate as integer (actual rate * 10000)';
COMMENT ON COLUMN agent_architecture_patterns.query_complexity IS 'Complexity scoring criteria for pattern selection';

COMMENT ON TABLE context_states IS 'Session context state management and recovery data';
COMMENT ON COLUMN context_states.history_stack IS 'Previous context state snapshots for recovery';
COMMENT ON COLUMN context_states.is_corrupted IS 'Corruption detection flag (0=valid, 1=corrupted)';

-- ============================================================================
-- Migration Verification
-- ============================================================================

-- Verify all tables were created successfully
DO $$
DECLARE
    table_count INTEGER;
    expected_tables TEXT[] := ARRAY[
        'user_contexts',
        'analysis_sessions',
        'domain_datasets',
        'visualization_artifacts',
        'agent_architecture_patterns',
        'context_states'
    ];
    missing_tables TEXT[] := ARRAY[]::TEXT[];
    table_name TEXT;
BEGIN
    -- Check all expected tables exist
    FOREACH table_name IN ARRAY expected_tables
    LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = table_name) THEN
            missing_tables := array_append(missing_tables, table_name);
        END IF;
    END LOOP;

    -- Raise error if any tables are missing
    IF array_length(missing_tables, 1) > 0 THEN
        RAISE EXCEPTION 'Failed to create tables: %', array_to_string(missing_tables, ', ');
    END IF;

    -- Verify pgvector extension
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RAISE EXCEPTION 'pgvector extension not available - check database configuration';
    END IF;

    -- Success message
    RAISE NOTICE 'BI Context Enhancement migration 007 completed successfully - % tables created', array_length(expected_tables, 1);
END
$$;