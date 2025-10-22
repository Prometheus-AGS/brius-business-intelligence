# PostgreSQL Database Setup Guide

This directory contains SQL scripts to set up the complete pgvector-based database schema for the Brius Business Intelligence Mastra framework.

## 🚨 **CRITICAL: Execute Scripts in This Exact Order**

The scripts have dependencies and must be run in the correct sequence:

### 1. **Memory Tables** (Run First)
```bash
psql -f sql/00-create-memory-tables.sql
```
- Creates `user_memories` and `global_memories` tables
- Sets up vector embeddings and indexes
- Required by search functions

### 2. **Semantic Search Function**
```bash
psql -f sql/01-create-semantic-search-function.sql
```
- Creates `semantic_search()` function
- Enables vector similarity search across memory tables

### 3. **Hybrid Search Function**
```bash
psql -f sql/02-create-hybrid-search-function.sql
```
- Creates `hybrid_search()` function
- Combines vector search with full-text search

### 4. **Document Tables**
```bash
psql -f sql/04-create-document-chunks-table.sql
```
- Creates `knowledge_documents` and `document_chunks` tables
- Sets up document processing infrastructure

### 5. **Test Functions** (Optional)
```bash
psql -f sql/03-test-search-functions.sql
```
- Validates all functions work correctly
- Creates test data and runs comprehensive tests

## 📋 **Prerequisites**

### Required PostgreSQL Extensions
- **pgvector** - Vector similarity search capabilities
- **uuid-ossp** or **gen_random_uuid()** support - UUID generation

### Verify Extensions
```sql
-- Check if pgvector is available
SELECT * FROM pg_available_extensions WHERE name = 'vector';

-- Check if vector extension is installed
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Install if needed (requires superuser)
CREATE EXTENSION IF NOT EXISTS vector;
```

### Database Permissions
Your database user needs these permissions:
- `CREATE` - To create tables and functions
- `CREATE INDEX` - To create performance indexes
- `USAGE` on schema `public`

## 📊 **Tables Created**

### Memory Tables
| Table | Purpose | Key Features |
|-------|---------|-------------|
| `user_memories` | User-specific memory storage | Vector embeddings, user isolation |
| `global_memories` | Shared memory across users | Access level controls, global search |

### Knowledge Tables
| Table | Purpose | Key Features |
|-------|---------|-------------|
| `knowledge_documents` | Document metadata | File processing status, categorization |
| `document_chunks` | Chunked document content | Vector embeddings, parent-child relationship |

## 🔍 **Functions Created**

### Search Functions
| Function | Purpose | Parameters |
|----------|---------|------------|
| `semantic_search()` | Vector similarity search | embedding, table, user_filter, threshold, count |
| `hybrid_search()` | Combined text + vector search | text, embedding, table, text_weight, vector_weight, count |

### Helper Functions
| Function | Purpose |
|----------|---------|
| `get_user_memory_stats()` | User memory analytics |
| `get_global_memory_stats()` | Global memory analytics |
| `get_document_chunks_with_document()` | Document chunk retrieval |
| `get_chunk_statistics()` | Document processing stats |

## ⚡ **Performance Features**

### Vector Indexes
- **HNSW indexes** on all embedding columns for fast similarity search
- **IVFFlat alternatives** available for faster creation on large datasets

### Full-Text Search
- **GIN indexes** on content columns for hybrid search performance
- **English language** configuration optimized for text ranking

### Standard Indexes
- **B-tree indexes** on foreign keys, timestamps, and filter columns
- **GIN indexes** on JSONB metadata for flexible querying

## 🧪 **Testing Your Setup**

After running all scripts, verify everything works:

```sql
-- 1. Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('user_memories', 'global_memories', 'knowledge_documents', 'document_chunks');

-- 2. Check functions exist
SELECT proname FROM pg_proc
WHERE proname IN ('semantic_search', 'hybrid_search');

-- 3. Check vector extension
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- 4. Test semantic search (will return empty results but shouldn't error)
SELECT * FROM semantic_search(
  '[0.1,0.2,0.3]'::vector(1536),
  'user_memories',
  NULL,
  0.0,
  1
);
```

## 🐛 **Troubleshooting**

### Common Issues

#### "relation does not exist" Error
- **Cause**: Scripts run out of order
- **Solution**: Run `00-create-memory-tables.sql` first

#### "extension 'vector' does not exist" Error
- **Cause**: pgvector not installed
- **Solution**: Install pgvector extension (requires superuser privileges)

#### "permission denied" Error
- **Cause**: Insufficient database permissions
- **Solution**: Ensure user has CREATE privileges

#### Vector Index Creation is Slow
- **Cause**: HNSW indexes take time on large datasets
- **Solution**: Comment out HNSW, uncomment IVFFlat alternatives, or wait for completion

### Check Database Status
```sql
-- View all tables and their sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- View all indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND (indexname LIKE '%hnsw%' OR indexname LIKE '%fts%')
ORDER BY tablename, indexname;
```

## 🔗 **Integration with Mastra Framework**

These tables and functions integrate directly with your TypeScript code:

- **[src/mastra/memory/operations.ts](../src/mastra/memory/operations.ts)** - Uses memory tables
- **[src/mastra/database/vector-ops.ts](../src/mastra/database/vector-ops.ts)** - Calls search functions
- **[src/mastra/tools/supabase-tools.ts](../src/mastra/tools/supabase-tools.ts)** - Executes SQL via RPC

No code changes needed - your existing TypeScript will work immediately after running these SQL scripts.

## 📝 **Next Steps**

1. **Run the scripts** in the specified order
2. **Test the functions** using the test script
3. **Start your Mastra application** - all database operations should now work
4. **Monitor performance** - Add more indexes if needed for your specific use cases
5. **Populate with data** - Use your application to add memories and documents

## 📧 **Support**

If you encounter issues:
1. Check the troubleshooting section above
2. Verify you have the required PostgreSQL extensions
3. Ensure scripts were run in the correct order
4. Check database logs for detailed error messages

---

🎉 **Success!** After running these scripts, your Mastra AI framework will have a fully functional pgvector-based database ready for semantic search and memory operations!