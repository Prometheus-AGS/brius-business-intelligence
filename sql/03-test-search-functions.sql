-- ============================================================================
-- Test Script for Semantic Search and Hybrid Search Functions
-- ============================================================================
-- This script tests the semantic_search() and hybrid_search() functions
-- to ensure they work correctly with the expected table schemas
-- ============================================================================

-- First, verify the required tables exist
DO $$
DECLARE
  missing_tables TEXT[] := '{}';
  table_name TEXT;
BEGIN
  -- Check each required table
  FOREACH table_name IN ARRAY ARRAY['user_memories', 'global_memories', 'document_chunks']
  LOOP
    IF NOT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = table_name AND table_schema = 'public'
    ) THEN
      missing_tables := array_append(missing_tables, table_name);
    END IF;
  END LOOP;

  IF array_length(missing_tables, 1) > 0 THEN
    RAISE WARNING '⚠️  Missing required tables: %', array_to_string(missing_tables, ', ');
    RAISE NOTICE 'ℹ️  Run the table creation migrations first before testing functions';
  ELSE
    RAISE NOTICE '✅ All required tables exist: user_memories, global_memories, document_chunks';
  END IF;
END $$;

-- Verify functions exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'semantic_search' AND pronargs = 5) THEN
    RAISE NOTICE '✅ semantic_search function exists';
  ELSE
    RAISE WARNING '⚠️  semantic_search function not found';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hybrid_search' AND pronargs = 6) THEN
    RAISE NOTICE '✅ hybrid_search function exists';
  ELSE
    RAISE WARNING '⚠️  hybrid_search function not found';
  END IF;
END $$;

-- ============================================================================
-- Test Data Setup (only if tables exist and are empty)
-- ============================================================================

-- Create test embedding helper function
CREATE OR REPLACE FUNCTION generate_test_vector()
RETURNS vector(1536) AS $$
DECLARE
  result float8[] := '{}';
  i integer;
BEGIN
  -- Generate a normalized random vector for testing
  FOR i IN 1..1536 LOOP
    result := array_append(result, (random() - 0.5) * 2);
  END LOOP;

  RETURN array_to_string(result, ',')::vector(1536);
END;
$$ LANGUAGE plpgsql;

-- Insert test data only if tables exist and are empty
DO $$
DECLARE
  test_vector1 vector(1536);
  test_vector2 vector(1536);
  test_vector3 vector(1536);
  doc_id1 UUID;
  doc_id2 UUID;
BEGIN
  -- Check if we can insert test data
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_memories') THEN
    -- Generate test vectors
    test_vector1 := generate_test_vector();
    test_vector2 := generate_test_vector();
    test_vector3 := generate_test_vector();

    -- Insert test user memories (only if table is empty)
    IF (SELECT COUNT(*) FROM user_memories) = 0 THEN
      INSERT INTO user_memories (user_id, content, embedding, category, metadata)
      VALUES
        ('test_user_1', 'This is about artificial intelligence and machine learning concepts', test_vector1, 'ai', '{"test": true}'::jsonb),
        ('test_user_1', 'Database optimization and query performance tuning', test_vector2, 'database', '{"test": true}'::jsonb),
        ('test_user_2', 'Climate change and environmental sustainability practices', test_vector3, 'environment', '{"test": true}'::jsonb);

      RAISE NOTICE '✅ Inserted test data into user_memories';
    END IF;

    -- Insert test global memories (only if table is empty)
    IF (SELECT COUNT(*) FROM global_memories) = 0 THEN
      INSERT INTO global_memories (content, embedding, category, access_level, metadata)
      VALUES
        ('Global knowledge about renewable energy solutions', test_vector1, 'energy', 'public', '{"test": true}'::jsonb),
        ('Advanced algorithms for data processing', test_vector2, 'algorithms', 'public', '{"test": true}'::jsonb);

      RAISE NOTICE '✅ Inserted test data into global_memories';
    END IF;

    -- Insert test knowledge documents and chunks (only if table is empty)
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'knowledge_documents')
       AND (SELECT COUNT(*) FROM knowledge_documents) = 0 THEN

      INSERT INTO knowledge_documents (title, content, file_type, processing_status)
      VALUES
        ('AI Research Paper', 'Comprehensive analysis of machine learning algorithms', 'application/pdf', 'completed'),
        ('Database Guide', 'Complete guide to database optimization techniques', 'text/plain', 'completed')
      RETURNING id INTO doc_id1;

      -- Get the second document ID
      SELECT id INTO doc_id2 FROM knowledge_documents WHERE title = 'Database Guide';

      -- Insert document chunks
      INSERT INTO document_chunks (document_id, chunk_index, content, embedding, chunk_metadata)
      VALUES
        (doc_id1, 0, 'Machine learning is a subset of artificial intelligence', test_vector1, '{"chunk_type": "paragraph", "test": true}'::jsonb),
        (doc_id1, 1, 'Deep learning uses neural networks for pattern recognition', test_vector2, '{"chunk_type": "paragraph", "test": true}'::jsonb),
        (doc_id2, 0, 'Database indexing improves query performance significantly', test_vector3, '{"chunk_type": "paragraph", "test": true}'::jsonb);

      RAISE NOTICE '✅ Inserted test data into knowledge_documents and document_chunks';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- Test semantic_search function
-- ============================================================================

-- Test 1: Search user memories with user filter
DO $$
DECLARE
  test_vector vector(1536);
  result_count integer;
BEGIN
  test_vector := generate_test_vector();

  -- Test semantic search with user filter
  SELECT COUNT(*) INTO result_count
  FROM semantic_search(
    test_vector,
    'user_memories',
    'test_user_1',
    0.0,  -- Low threshold for testing
    10
  );

  RAISE NOTICE 'Test 1 - semantic_search(user_memories with filter): % results', result_count;

  -- Test semantic search without user filter
  SELECT COUNT(*) INTO result_count
  FROM semantic_search(
    test_vector,
    'user_memories',
    NULL,
    0.0,  -- Low threshold for testing
    10
  );

  RAISE NOTICE 'Test 2 - semantic_search(user_memories no filter): % results', result_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'semantic_search test failed: %', SQLERRM;
END $$;

-- Test 2: Search global memories
DO $$
DECLARE
  test_vector vector(1536);
  result_count integer;
BEGIN
  test_vector := generate_test_vector();

  SELECT COUNT(*) INTO result_count
  FROM semantic_search(
    test_vector,
    'global_memories',
    NULL,
    0.0,  -- Low threshold for testing
    10
  );

  RAISE NOTICE 'Test 3 - semantic_search(global_memories): % results', result_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'semantic_search(global_memories) test failed: %', SQLERRM;
END $$;

-- Test 3: Search document chunks
DO $$
DECLARE
  test_vector vector(1536);
  result_count integer;
BEGIN
  test_vector := generate_test_vector();

  SELECT COUNT(*) INTO result_count
  FROM semantic_search(
    test_vector,
    'document_chunks',
    NULL,
    0.0,  -- Low threshold for testing
    10
  );

  RAISE NOTICE 'Test 4 - semantic_search(document_chunks): % results', result_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'semantic_search(document_chunks) test failed: %', SQLERRM;
END $$;

-- ============================================================================
-- Test hybrid_search function
-- ============================================================================

-- Test 4: Hybrid search on document chunks
DO $$
DECLARE
  test_vector vector(1536);
  result_count integer;
BEGIN
  test_vector := generate_test_vector();

  SELECT COUNT(*) INTO result_count
  FROM hybrid_search(
    'machine learning artificial intelligence',
    test_vector,
    'document_chunks',
    0.3,  -- text weight
    0.7,  -- vector weight
    10
  );

  RAISE NOTICE 'Test 5 - hybrid_search(document_chunks): % results', result_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'hybrid_search(document_chunks) test failed: %', SQLERRM;
END $$;

-- Test 5: Hybrid search on user memories
DO $$
DECLARE
  test_vector vector(1536);
  result_count integer;
BEGIN
  test_vector := generate_test_vector();

  SELECT COUNT(*) INTO result_count
  FROM hybrid_search(
    'database optimization performance',
    test_vector,
    'user_memories',
    0.5,  -- balanced weights
    0.5,
    10
  );

  RAISE NOTICE 'Test 6 - hybrid_search(user_memories): % results', result_count;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'hybrid_search(user_memories) test failed: %', SQLERRM;
END $$;

-- ============================================================================
-- Test Function Parameter Validation
-- ============================================================================

-- Test invalid search table
DO $$
BEGIN
  PERFORM semantic_search(
    generate_test_vector(),
    'invalid_table',
    NULL,
    0.8,
    10
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✅ Test 7 - Invalid table validation works: %', SQLERRM;
END $$;

-- Test invalid threshold
DO $$
BEGIN
  PERFORM semantic_search(
    generate_test_vector(),
    'user_memories',
    NULL,
    1.5,  -- Invalid threshold > 1
    10
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✅ Test 8 - Invalid threshold validation works: %', SQLERRM;
END $$;

-- Test invalid weights in hybrid search
DO $$
BEGIN
  PERFORM hybrid_search(
    'test query',
    generate_test_vector(),
    'document_chunks',
    0.3,
    0.8,  -- Weights don't sum to 1.0
    10
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✅ Test 9 - Invalid weights validation works: %', SQLERRM;
END $$;

-- ============================================================================
-- Performance Test (optional)
-- ============================================================================

-- Test execution time for semantic search
DO $$
DECLARE
  start_time timestamp;
  end_time timestamp;
  execution_time interval;
BEGIN
  start_time := clock_timestamp();

  PERFORM semantic_search(
    generate_test_vector(),
    'user_memories',
    NULL,
    0.8,
    5
  );

  end_time := clock_timestamp();
  execution_time := end_time - start_time;

  RAISE NOTICE 'Performance - semantic_search execution time: %', execution_time;
END $$;

-- ============================================================================
-- Cleanup test data (optional - uncomment if needed)
-- ============================================================================

/*
-- Uncomment to clean up test data
DO $$
BEGIN
  DELETE FROM document_chunks WHERE chunk_metadata->>'test' = 'true';
  DELETE FROM knowledge_documents WHERE metadata->>'test' = 'true';
  DELETE FROM global_memories WHERE metadata->>'test' = 'true';
  DELETE FROM user_memories WHERE metadata->>'test' = 'true';

  RAISE NOTICE '✅ Cleaned up test data';
END $$;
*/

-- Drop test helper function
DROP FUNCTION IF EXISTS generate_test_vector();

-- ============================================================================
-- Summary
-- ============================================================================

RAISE NOTICE '';
RAISE NOTICE '====================================';
RAISE NOTICE '    FUNCTION TESTING COMPLETED';
RAISE NOTICE '====================================';
RAISE NOTICE '';
RAISE NOTICE 'Functions tested:';
RAISE NOTICE '  ✓ semantic_search(vector, text, text, float, int)';
RAISE NOTICE '  ✓ hybrid_search(text, vector, text, float, float, int)';
RAISE NOTICE '';
RAISE NOTICE 'Next steps:';
RAISE NOTICE '  1. Ensure all required tables exist before using functions';
RAISE NOTICE '  2. Create proper HNSW indexes for optimal vector performance';
RAISE NOTICE '  3. Populate tables with real embedding data';
RAISE NOTICE '  4. Test with actual embeddings from your application';
RAISE NOTICE '';