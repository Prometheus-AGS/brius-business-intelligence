# Data Model: Mastra Business Intelligence System

**Date**: October 18, 2025
**Feature**: Mastra Business Intelligence System
**Branch**: 001-mastra-bi-system

## Overview

This document defines the data entities, relationships, and validation rules for the Mastra Business Intelligence system. The model supports user-scoped memory, global shared knowledge, document management, MCP tool integration, and comprehensive observability.

## Core Entities

### User Memory

**Purpose**: Personal conversation context, preferences, and historical interactions isolated by user ID

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `user_id`: String (required, indexed) - JWT subject claim for user identification
- `content`: Text (required) - Human-readable memory content
- `embedding`: Vector(1024) (indexed) - Titan v2 embedding for semantic search
- `metadata`: JSONB (optional) - Flexible structured data (preferences, categories, importance)
- `created_at`: Timestamp (auto-generated, indexed)
- `updated_at`: Timestamp (auto-updated)

**Relationships**:
- Belongs to User (via user_id)
- No foreign key constraints (user management handled by Supabase Auth)

**Validation Rules**:
- user_id must be valid JWT subject
- content must be non-empty string
- embedding must be 1024-dimensional vector
- metadata must be valid JSON if provided

**State Transitions**:
- Created → Active (when stored)
- Active → Updated (when modified)
- Active → Deleted (when user removes)

### Global Memory

**Purpose**: Shared organizational knowledge, policies, and procedures accessible to all users

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `content`: Text (required) - Knowledge content
- `embedding`: Vector(1024) (indexed) - Titan v2 embedding for semantic search
- `metadata`: JSONB (optional) - Category, source, importance, expiration
- `category`: String (optional, indexed) - Organizational grouping (policy, procedure, knowledge)
- `created_at`: Timestamp (auto-generated, indexed)
- `updated_at`: Timestamp (auto-updated)

**Relationships**:
- Standalone entity with no direct relationships

**Validation Rules**:
- content must be non-empty string
- embedding must be 1024-dimensional vector
- category must be from predefined list if specified
- metadata must be valid JSON if provided

**State Transitions**:
- Created → Active (when stored)
- Active → Updated (when modified by admin)
- Active → Expired (based on metadata expiration)
- Active → Deleted (when admin removes)

### Knowledge Documents

**Purpose**: Uploaded files with metadata, processing status, and chunk relationships for semantic search

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `filename`: String (required) - Original filename
- `content`: Text (required) - Extracted text content
- `file_type`: String (required) - MIME type or extension (PDF, DOCX, TXT, MD)
- `file_size`: Integer (required) - File size in bytes
- `metadata`: JSONB (optional) - Upload context, categories, access controls
- `uploaded_by`: String (optional, indexed) - User ID who uploaded
- `processing_status`: String (required) - pending, processing, completed, failed
- `created_at`: Timestamp (auto-generated, indexed)
- `updated_at`: Timestamp (auto-updated)

**Relationships**:
- Has many Document Chunks (one-to-many)
- Uploaded by User (via uploaded_by)

**Validation Rules**:
- filename must be non-empty string
- file_type must be supported format
- file_size must be positive integer ≤ 10MB
- processing_status must be valid enum
- content required when processing_status = completed

**State Transitions**:
- Created → Pending (on upload)
- Pending → Processing (when chunking starts)
- Processing → Completed (when chunks generated)
- Processing → Failed (on processing error)
- Completed → Updated (when reprocessed)

### Document Chunks

**Purpose**: Processed text segments with vector embeddings and parent document relationships

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `document_id`: UUID (required, foreign key, indexed) - Parent document reference
- `chunk_index`: Integer (required) - Sequence order within document
- `content`: Text (required) - Chunk text content
- `embedding`: Vector(1024) (indexed) - Titan v2 embedding for semantic search
- `metadata`: JSONB (optional) - Chunk-specific data (page numbers, headings, confidence)
- `created_at`: Timestamp (auto-generated)

**Relationships**:
- Belongs to Knowledge Document (many-to-one via document_id)

**Validation Rules**:
- document_id must reference existing Knowledge Document
- chunk_index must be non-negative integer
- content must be non-empty string
- embedding must be 1024-dimensional vector

**State Transitions**:
- Created → Active (when chunk is stored)
- Active → Updated (when document reprocessed)
- Active → Deleted (when parent document deleted)

### MCP Tool Registry

**Purpose**: Discovered tools from external servers with namespacing, schemas, and availability status

**Attributes**:
- `id`: String (primary key) - Namespaced tool ID (e.g., "supabase:query_table")
- `name`: String (required) - Display name
- `description`: Text (required) - Tool functionality description
- `input_schema`: JSONB (required) - Zod schema for input validation
- `output_schema`: JSONB (optional) - Expected output structure
- `category`: String (required) - Tool category (mcp, agent, knowledge, memory, workflow)
- `source`: String (optional) - MCP server source name
- `availability_status`: String (required) - available, unavailable, error
- `last_health_check`: Timestamp (updated periodically)
- `metadata`: JSONB (optional) - Tool-specific configuration, rate limits
- `created_at`: Timestamp (auto-generated)
- `updated_at`: Timestamp (auto-updated)

**Relationships**:
- Has many Tool Execution Logs (one-to-many)

**Validation Rules**:
- id must follow namespace:tool_name pattern
- input_schema must be valid Zod schema JSON
- availability_status must be valid enum
- category must be from predefined list

**State Transitions**:
- Discovered → Available (on successful registration)
- Available → Unavailable (on health check failure)
- Unavailable → Available (on recovery)
- Available → Error (on repeated failures)

### Conversation Context

**Purpose**: Session state including message history, tool calls, and user preferences for continuity

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `user_id`: String (optional, indexed) - Associated user if authenticated
- `session_id`: String (required, indexed) - Session identifier
- `messages`: JSONB (required) - Message history with roles and content
- `tool_calls`: JSONB (optional) - Tool invocation history
- `user_preferences`: JSONB (optional) - Session-specific preferences
- `context_summary`: Text (optional) - Compressed context for long conversations
- `created_at`: Timestamp (auto-generated, indexed)
- `updated_at`: Timestamp (auto-updated)
- `expires_at`: Timestamp (required, indexed) - Session expiration

**Relationships**:
- Associated with User (via user_id, optional)

**Validation Rules**:
- session_id must be unique string
- messages must be valid message array
- expires_at must be future timestamp
- user_id must match JWT if provided

**State Transitions**:
- Created → Active (on first message)
- Active → Updated (on new messages)
- Active → Expired (past expires_at)
- Expired → Deleted (on cleanup)

### Agent Workflows

**Purpose**: Multi-step execution plans with validation, error handling, and result synthesis

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `workflow_type`: String (required) - orchestrator, planning, intent-classification
- `user_id`: String (optional, indexed) - Associated user if authenticated
- `input_data`: JSONB (required) - Workflow input parameters
- `execution_plan`: JSONB (optional) - Generated execution steps
- `current_step`: Integer (required, default 0) - Current execution position
- `step_results`: JSONB (optional) - Results from completed steps
- `final_result`: JSONB (optional) - Workflow output
- `status`: String (required) - pending, running, completed, failed, cancelled
- `error_details`: JSONB (optional) - Error information if failed
- `created_at`: Timestamp (auto-generated, indexed)
- `updated_at`: Timestamp (auto-updated)
- `completed_at`: Timestamp (optional) - Completion timestamp

**Relationships**:
- Associated with User (via user_id, optional)
- Has many Tool Execution Logs (via workflow execution)

**Validation Rules**:
- workflow_type must be valid enum
- status must be valid enum
- current_step must be non-negative integer
- input_data must be valid JSON

**State Transitions**:
- Created → Pending (on creation)
- Pending → Running (on execution start)
- Running → Completed (on successful completion)
- Running → Failed (on error)
- Running → Cancelled (on user/system cancellation)

### Tool Execution Logs

**Purpose**: Performance metrics, success rates, and error details for monitoring and optimization

**Attributes**:
- `id`: UUID (primary key, auto-generated)
- `tool_id`: String (required, indexed) - Reference to MCP Tool Registry
- `user_id`: String (optional, indexed) - User who invoked tool
- `workflow_id`: UUID (optional, indexed) - Associated workflow if applicable
- `input_parameters`: JSONB (required) - Tool input data
- `output_result`: JSONB (optional) - Tool output data
- `execution_time_ms`: Integer (required) - Execution duration
- `status`: String (required) - success, error, timeout, cancelled
- `error_message`: Text (optional) - Error details if failed
- `langfuse_trace_id`: String (optional, indexed) - LangFuse correlation ID
- `created_at`: Timestamp (auto-generated, indexed)

**Relationships**:
- References MCP Tool Registry (via tool_id)
- Associated with User (via user_id, optional)
- Associated with Agent Workflow (via workflow_id, optional)

**Validation Rules**:
- tool_id must reference existing tool
- execution_time_ms must be positive integer
- status must be valid enum
- input_parameters must be valid JSON

**State Transitions**:
- Created → Success (on successful execution)
- Created → Error (on execution failure)
- Created → Timeout (on execution timeout)
- Created → Cancelled (on cancellation)

## Indexes and Performance

### Primary Indexes
- All entities have UUID primary keys with btree indexes
- User-scoped entities indexed on user_id for efficient queries
- Time-based entities indexed on created_at for chronological access

### Vector Indexes
- IVFFLAT indexes on all embedding columns for approximate nearest neighbor search
- Configurable list parameters (default: 100) for different dataset sizes
- Cosine distance operator for semantic similarity

### Composite Indexes
- (user_id, created_at) for user memory chronological queries
- (category, created_at) for global memory categorized queries
- (tool_id, created_at) for tool execution history
- (workflow_id, current_step) for workflow step tracking

### Full-Text Search Indexes
- GIN indexes on content columns for hybrid search capabilities
- English language configuration for business document processing
- Combined with vector search for comprehensive retrieval

## Data Retention and Cleanup

### User Memory Retention
- No automatic expiration (user-controlled)
- Optional cleanup based on user preferences
- GDPR compliance through user-initiated deletion

### Global Memory Retention
- Admin-controlled retention policies
- Optional expiration dates in metadata
- Version history for policy changes

### Conversation Context Retention
- Default 30-day expiration
- Configurable per session type
- Automatic cleanup of expired sessions

### Tool Execution Logs Retention
- 90-day retention for operational monitoring
- Aggregated metrics preserved longer
- Privacy-compliant log scrubbing

## Security and Access Control

### Row Level Security (RLS)
- User memory isolated by JWT user_id
- Global memory readable by all, writable by admins
- Knowledge documents with optional access controls
- Conversation context scoped to session and user

### Data Encryption
- Database encryption at rest (Supabase managed)
- TLS encryption in transit for all connections
- JWT token validation for authenticated access
- Environment variable protection for secrets

### Audit and Compliance
- All data modifications logged with timestamps
- User attribution through JWT claims
- Tool execution audit trail
- GDPR-compliant data export and deletion

## Data Migration Strategy

### Schema Evolution
- Versioned database migrations
- Backward-compatible schema changes
- Index creation with concurrent builds
- Testing migrations on representative datasets

### Data Seeding
- Initial global memory with organizational knowledge
- Sample MCP tool configurations
- Development environment test data
- Production bootstrap procedures