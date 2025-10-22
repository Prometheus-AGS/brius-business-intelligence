-- Create exec_sql function for executing arbitrary SQL queries and returning JSON results
-- This function is needed by the Supabase tools to execute SQL queries from agents

CREATE OR REPLACE FUNCTION exec_sql(sql TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
    rec RECORD;
    results JSON[] := '{}';
BEGIN
    -- Execute the SQL and collect results
    FOR rec IN EXECUTE sql LOOP
        results := array_append(results, to_json(rec));
    END LOOP;
    
    -- Return the results as a JSON array
    result := array_to_json(results);
    
    RETURN result;
EXCEPTION
    WHEN OTHERS THEN
        -- Return error information as JSON
        RETURN json_build_object(
            'error', true,
            'message', SQLERRM,
            'sqlstate', SQLSTATE,
            'sql', sql
        );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(TEXT) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION exec_sql(TEXT) IS 'Execute arbitrary SQL queries and return results as JSON. Used by Mastra agents for database analysis.';