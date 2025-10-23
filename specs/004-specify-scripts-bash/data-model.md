# Data Model: Business Intelligence Context Enhancement

**Generated**: 2025-10-23 | **Feature**: Business Intelligence Context Enhancement

## Entity Overview

This data model defines the core entities for managing user context, analysis sessions, and visualization artifacts within the enhanced BI system.

## 1. User Context Entity

### Core Attributes
- **userId**: UUID - Unique identifier extracted from JWT
- **sessionId**: UUID - Current session identifier
- **roleId**: String - User's assigned role (analyst, manager, admin)
- **departmentScope**: String[] - Authorized departments/regions
- **permissions**: Object - Granular permission matrix by domain
- **preferences**: Object - User-specific UI and analysis preferences
- **lastActivity**: Timestamp - Session activity tracking
- **tokenExpiry**: Timestamp - JWT expiration tracking

### Relationships
- **HasMany**: Analysis Sessions (1:N)
- **HasMany**: Memory Entries (1:N, user-scoped)
- **BelongsTo**: Department/Region scope definitions

### Validation Rules
- userId must be valid UUID from JWT claims
- roleId must exist in system role definitions
- departmentScope array cannot be empty for non-admin users
- permissions object must contain all four domains (clinical, financial, operational, customer-service)
- tokenExpiry must be future timestamp

### State Transitions
- **Created**: Initial context establishment from JWT
- **Active**: Normal operation with valid token
- **Refreshing**: Background token renewal in progress
- **Reconstructing**: Context recovery from session history
- **Degraded**: Limited functionality due to context issues
- **Expired**: Session ended, requires re-authentication

## 2. Analysis Session Entity

### Core Attributes
- **sessionId**: UUID - Unique session identifier
- **userId**: UUID - Associated user context
- **startTime**: Timestamp - Session initiation
- **lastQueryTime**: Timestamp - Most recent query execution
- **queryHistory**: Array - Ordered list of queries and responses
- **contextState**: Object - Current workflow and data context
- **domainAccess**: String[] - Domains accessed in this session
- **status**: Enum - Session status (active, paused, completed, failed)

### Relationships
- **BelongsTo**: User Context (N:1)
- **HasMany**: Query Results (1:N)
- **HasMany**: Visualization Artifacts (1:N)

### Validation Rules
- sessionId must be unique across system
- userId must reference valid User Context
- queryHistory must maintain chronological order
- contextState must be serializable JSON object
- domainAccess must be subset of user's permitted domains

### State Transitions
- **Initiated**: Session created with user context
- **Active**: Queries being processed
- **Waiting**: User input required
- **Processing**: Long-running analysis in progress
- **Completed**: Analysis finished successfully
- **Failed**: Unrecoverable error occurred

## 3. Domain Dataset Entity

### Core Attributes
- **datasetId**: UUID - Unique dataset identifier
- **domainType**: Enum - Domain classification (clinical, financial, operational, customer-service)
- **tableName**: String - Source table name
- **schema**: Object - Table structure and field definitions
- **relationships**: Array - Foreign key relationships to other datasets
- **accessLevel**: Enum - Required permission level (public, department, restricted)
- **dataQuality**: Object - Quality metrics and completeness scores
- **lastAnalyzed**: Timestamp - Schema analysis timestamp

### Relationships
- **HasMany**: Query Results (1:N)
- **RelatedTo**: Other Domain Datasets (M:N via relationships)

### Validation Rules
- domainType must be one of four defined domains
- tableName must exist in connected databases
- schema must include field types and constraints
- relationships must reference valid dataset IDs
- dataQuality scores must be between 0 and 1

## 4. Visualization Artifact Entity

### Core Attributes
- **artifactId**: UUID - Unique artifact identifier
- **sessionId**: UUID - Associated analysis session
- **componentName**: String - Generated React component name
- **componentCode**: Text - Complete TSX component source
- **dataBinding**: Object - Data structure and prop definitions
- **styleDefinition**: Object - Embedded CSS styling rules
- **generationTime**: Timestamp - Component creation time
- **dependencies**: Array - Required external packages (minimal)

### Relationships
- **BelongsTo**: Analysis Session (N:1)
- **Uses**: Query Results for data binding (N:M)

### Validation Rules
- componentName must be valid React component name (PascalCase)
- componentCode must be valid TSX syntax
- dataBinding must match component prop interface
- styleDefinition must be valid CSS-in-JS object
- dependencies array should be minimal per requirements

## 5. Agent Architecture Pattern Entity

### Core Attributes
- **patternId**: UUID - Unique pattern identifier
- **patternType**: Enum - Pattern classification (planner-executor, reactive, streaming, hybrid)
- **queryComplexity**: Object - Complexity scoring criteria
- **performanceMetrics**: Object - Response time, accuracy, resource usage
- **usageCount**: Integer - Pattern selection frequency
- **successRate**: Float - Query completion success rate
- **lastEvaluated**: Timestamp - Performance evaluation timestamp

### Relationships
- **UsedBy**: Analysis Sessions (M:N)
- **Produces**: Performance benchmarks (1:N)

### Validation Rules
- patternType must be supported pattern
- queryComplexity must include scoring matrix
- performanceMetrics must include time, accuracy, resources
- successRate must be between 0 and 1
- usageCount must be non-negative integer

## 6. Memory Scope Entity

### Core Attributes
- **memoryId**: UUID - Unique memory entry identifier
- **scope**: Enum - Memory scope (user, global)
- **userId**: UUID - Associated user (null for global scope)
- **contentType**: Enum - Memory content type (conversation, knowledge, preference)
- **content**: Object - Stored memory content
- **embeddings**: Vector - pgvector embeddings for semantic search
- **createdAt**: Timestamp - Memory creation time
- **lastAccessed**: Timestamp - Recent access tracking

### Relationships
- **BelongsTo**: User Context (N:1, nullable for global)
- **RelatedTo**: Analysis Sessions via semantic similarity

### Validation Rules
- scope must be either 'user' or 'global'
- userId required for user scope, null for global scope
- content must be serializable and indexable
- embeddings must be valid pgvector format
- contentType must be supported memory type

## 7. Context State Entity (Session Management)

### Core Attributes
- **stateId**: UUID - Unique state identifier
- **sessionId**: UUID - Associated session
- **stateData**: Object - Current context state
- **historyStack**: Array - Previous state snapshots
- **reconstructionData**: Object - Recovery information
- **lastUpdate**: Timestamp - State modification time
- **isCorrupted**: Boolean - Corruption detection flag

### Relationships
- **BelongsTo**: Analysis Session (1:1)
- **MaintainedBy**: Context reconstruction workflows

### Validation Rules
- sessionId must reference valid Analysis Session
- stateData must be serializable JSON
- historyStack must maintain chronological order
- reconstructionData must include recovery metadata
- isCorrupted flag triggers recovery procedures

## Database Schema Considerations

### pgvector Integration
- Memory Scope entities use pgvector for semantic similarity search
- Embedding vectors stored using pgvector data types
- Indexes created for efficient similarity queries
- Compatibility with AWS Bedrock Titan v2 embeddings

### Performance Optimization
- Database indexes on frequently queried fields (userId, sessionId, timestamps)
- Query optimization for multi-domain data access patterns
- Connection pooling for concurrent user sessions
- Caching strategies for frequently accessed context data

### Security Implementation
- Row-level security for user-scoped data access
- Encrypted storage for sensitive context information
- Audit logging for all context state changes
- Token-based access control integration

### Migration Strategy
- Schema versioning for incremental updates
- Backward compatibility with existing Mastra memory structures
- Data migration utilities for existing user contexts
- Rollback procedures for failed migrations

## Integration Points

### Mastra Framework Integration
- Entity definitions align with Mastra agent memory patterns
- Type definitions exported through `src/mastra/types/index.ts`
- Validation schemas implemented using Zod
- Integration with existing Mastra storage configurations

### MCP Server Integration
- Domain Dataset entities populated via Supabase MCP server
- Schema analysis automated through MCP tool calls
- Real-time data quality monitoring via MCP connections
- Context passing through MCP metadata headers

### JWT Integration
- User Context entities populated from JWT claims
- Token refresh mechanisms update context state
- Permission matrices derived from JWT role information
- Department/region scope extracted from JWT custom claims