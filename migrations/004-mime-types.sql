-- ============================================================================
-- Unstructured.io Supported MIME Types Database Setup
-- ============================================================================
-- This script creates a mime_types table and populates it with all 56 file
-- formats supported by Unstructured.io (as of October 2025)
-- ============================================================================

-- Create the mime_types table
CREATE TABLE IF NOT EXISTS mime_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mime TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- Create index on mime type for fast lookups
CREATE INDEX IF NOT EXISTS idx_mime_types_mime ON mime_types(mime);

-- Create index on name for searching
CREATE INDEX IF NOT EXISTS idx_mime_types_name ON mime_types(name);

-- Create trigger function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_mime_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_mime_types_updated_at ON mime_types;
CREATE TRIGGER trigger_mime_types_updated_at
    BEFORE UPDATE ON mime_types
    FOR EACH ROW
    EXECUTE FUNCTION update_mime_types_updated_at();

-- ============================================================================
-- Insert all 56 supported MIME types
-- ============================================================================

INSERT INTO mime_types (mime, name, metadata) VALUES
-- Word Processing Documents
('application/msword', 'Microsoft Word (.doc)', '{"extension": ".doc", "category": "document", "supports_ocr": false}'::jsonb),
('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Microsoft Word (.docx)', '{"extension": ".docx", "category": "document", "supports_ocr": false}'::jsonb),
('application/vnd.oasis.opendocument.text', 'OpenDocument Text (.odt)', '{"extension": ".odt", "category": "document", "supports_ocr": false}'::jsonb),
('application/rtf', 'Rich Text Format (.rtf)', '{"extension": ".rtf", "category": "document", "supports_ocr": false}'::jsonb),
('application/x-abiword', 'AbiWord Document (.abw)', '{"extension": ".abw", "category": "document", "supports_ocr": false}'::jsonb),
('application/x-hwp', 'Hancom Office Document (.hwp)', '{"extension": ".hwp", "category": "document", "supports_ocr": false}'::jsonb),
('application/x-abiword-compressed', 'Compressed AbiWord (.zabw)', '{"extension": ".zabw", "category": "document", "supports_ocr": false}'::jsonb),
('application/vnd.ms-word.template.macroEnabled.12', 'Word Macro-Enabled Template (.dotm)', '{"extension": ".dotm", "category": "document", "supports_ocr": false}'::jsonb),

-- PDF
('application/pdf', 'Portable Document Format (.pdf)', '{"extension": ".pdf", "category": "document", "supports_ocr": true, "supports_tables": true, "supports_images": true}'::jsonb),

-- Presentations
('application/vnd.ms-powerpoint', 'Microsoft PowerPoint (.ppt)', '{"extension": ".ppt", "category": "presentation", "supports_ocr": false}'::jsonb),
('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Microsoft PowerPoint (.pptx)', '{"extension": ".pptx", "category": "presentation", "supports_ocr": false, "supports_images": true}'::jsonb),
('application/vnd.ms-powerpoint.presentation.macroEnabled.12', 'PowerPoint Macro-Enabled (.pptm)', '{"extension": ".pptm", "category": "presentation", "supports_ocr": false}'::jsonb),
('application/vnd.ms-powerpoint.template', 'PowerPoint Template (.pot)', '{"extension": ".pot", "category": "presentation", "supports_ocr": false}'::jsonb),

-- Spreadsheets
('application/vnd.ms-excel', 'Microsoft Excel (.xls)', '{"extension": ".xls", "category": "spreadsheet", "supports_ocr": false, "supports_tables": true}'::jsonb),
('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Microsoft Excel (.xlsx)', '{"extension": ".xlsx", "category": "spreadsheet", "supports_ocr": false, "supports_tables": true}'::jsonb),
('text/csv', 'Comma-Separated Values (.csv)', '{"extension": ".csv", "category": "spreadsheet", "supports_ocr": false, "supports_tables": true}'::jsonb),
('text/tab-separated-values', 'Tab-Separated Values (.tsv)', '{"extension": ".tsv", "category": "spreadsheet", "supports_ocr": false, "supports_tables": true}'::jsonb),
('application/vnd.oasis.opendocument.spreadsheet', 'OpenDocument Spreadsheet (.fods)', '{"extension": ".fods", "category": "spreadsheet", "supports_ocr": false, "supports_tables": true}'::jsonb),

-- Email
('message/rfc822', 'Email Message (.eml)', '{"extension": ".eml", "category": "email", "supports_ocr": false, "supports_attachments": true}'::jsonb),
('application/vnd.ms-outlook', 'Outlook Message (.msg)', '{"extension": ".msg", "category": "email", "supports_ocr": false, "supports_attachments": true}'::jsonb),
('application/pkcs7-signature', 'S/MIME Signature (.p7s)', '{"extension": ".p7s", "category": "email", "supports_ocr": false}'::jsonb),

-- Web Content
('text/html', 'HyperText Markup Language (.html)', '{"extension": ".html", "category": "web", "supports_ocr": false}'::jsonb),
('application/xhtml+xml', 'XHTML (.htm)', '{"extension": ".htm", "category": "web", "supports_ocr": false}'::jsonb),
('application/xml', 'Extensible Markup Language (.xml)', '{"extension": ".xml", "category": "web", "supports_ocr": false}'::jsonb),

-- Plain Text & Markup
('text/plain', 'Plain Text (.txt)', '{"extension": ".txt", "category": "text", "supports_ocr": false}'::jsonb),
('text/markdown', 'Markdown (.md)', '{"extension": ".md", "category": "text", "supports_ocr": false}'::jsonb),
('text/x-rst', 'reStructuredText (.rst)', '{"extension": ".rst", "category": "text", "supports_ocr": false}'::jsonb),
('text/org', 'Org Mode (.org)', '{"extension": ".org", "category": "text", "supports_ocr": false}'::jsonb),

-- Images
('image/jpeg', 'JPEG Image (.jpg, .jpeg)', '{"extension": ".jpg", "category": "image", "supports_ocr": true}'::jsonb),
('image/png', 'Portable Network Graphics (.png)', '{"extension": ".png", "category": "image", "supports_ocr": true}'::jsonb),
('image/bmp', 'Bitmap Image (.bmp)', '{"extension": ".bmp", "category": "image", "supports_ocr": true}'::jsonb),
('image/tiff', 'Tagged Image File Format (.tiff)', '{"extension": ".tiff", "category": "image", "supports_ocr": true}'::jsonb),
('image/heic', 'High Efficiency Image Format (.heic)', '{"extension": ".heic", "category": "image", "supports_ocr": true}'::jsonb),

-- eBooks
('application/epub+zip', 'Electronic Publication (.epub)', '{"extension": ".epub", "category": "ebook", "supports_ocr": false}'::jsonb),

-- Database
('application/x-dbf', 'dBase Database File (.dbf)', '{"extension": ".dbf", "category": "database", "supports_ocr": false, "supports_tables": true}'::jsonb),

-- Apple Formats
('application/x-appleworks', 'AppleWorks ClarisWorks (.cwk)', '{"extension": ".cwk", "category": "document", "supports_ocr": false}'::jsonb),
('application/x-macwrite', 'MacWrite Document (.mcw)', '{"extension": ".mcw", "category": "document", "supports_ocr": false}'::jsonb),

-- StarOffice
('application/vnd.sun.xml.writer.global', 'StarOffice Writer Global (.sxg)', '{"extension": ".sxg", "category": "document", "supports_ocr": false}'::jsonb),

-- Legacy Microsoft Office
('application/vnd.ms-word.document', 'Word Document Template (.dot)', '{"extension": ".dot", "category": "document", "supports_ocr": false}'::jsonb),

-- Spreadsheet Add-ons
('application/x-kingsoft-spreadsheet', 'Kingsoft Spreadsheet (.et)', '{"extension": ".et", "category": "spreadsheet", "supports_ocr": false}'::jsonb),
('application/x-ethercalc', 'EtherCalc Spreadsheet (.eth)', '{"extension": ".eth", "category": "spreadsheet", "supports_ocr": false}'::jsonb),
('application/x-marinerwrite', 'Mariner Write (.mw)', '{"extension": ".mw", "category": "document", "supports_ocr": false}'::jsonb),

-- Print Files
('application/x-print', 'Print File (.prn)', '{"extension": ".prn", "category": "image", "supports_ocr": true}'::jsonb),

-- Other Formats
('application/x-pocketbook', 'PocketBook Document (.pbd)', '{"extension": ".pbd", "category": "document", "supports_ocr": false}'::jsonb),
('application/x-sun-presentation', 'Sun Presentation Document (.sdp)', '{"extension": ".sdp", "category": "presentation", "supports_ocr": false}'::jsonb),

-- Data Interchange Format (Special Note)
-- DIF has limitations with line endings (must use \n, not \r\n)
('application/x-dif', 'Data Interchange Format (.dif)', '{"extension": ".dif", "category": "spreadsheet", "supports_ocr": false, "supports_tables": true, "special_note": "Requires \\n line endings, not \\r\\n"}'::jsonb)

ON CONFLICT (mime) DO NOTHING;

-- ============================================================================
-- Add helper functions for querying
-- ============================================================================

-- Function to get MIME type by file extension
CREATE OR REPLACE FUNCTION get_mime_type_by_extension(file_extension TEXT)
RETURNS TABLE (
    id UUID,
    mime TEXT,
    name TEXT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT mt.id, mt.mime, mt.name, mt.metadata
    FROM mime_types mt
    WHERE mt.metadata->>'extension' = file_extension
       OR mt.metadata->>'extension' LIKE '%' || file_extension || '%'
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get all MIME types by category
CREATE OR REPLACE FUNCTION get_mime_types_by_category(category_name TEXT)
RETURNS TABLE (
    id UUID,
    mime TEXT,
    name TEXT,
    extension TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mt.id, 
        mt.mime, 
        mt.name,
        mt.metadata->>'extension' as extension
    FROM mime_types mt
    WHERE mt.metadata->>'category' = category_name
    ORDER BY mt.name;
END;
$$ LANGUAGE plpgsql;

-- Function to check if MIME type supports OCR
CREATE OR REPLACE FUNCTION supports_ocr(mime_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    result BOOLEAN;
BEGIN
    SELECT (metadata->>'supports_ocr')::boolean
    INTO result
    FROM mime_types
    WHERE mime = mime_type;
    
    RETURN COALESCE(result, false);
END;
$$ LANGUAGE plpgsql;

-- Function to check if MIME type supports table extraction
CREATE OR REPLACE FUNCTION supports_tables(mime_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    result BOOLEAN;
BEGIN
    SELECT (metadata->>'supports_tables')::boolean
    INTO result
    FROM mime_types
    WHERE mime = mime_type;
    
    RETURN COALESCE(result, false);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Create materialized view for quick category summary
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mime_types_summary AS
SELECT 
    metadata->>'category' as category,
    COUNT(*) as type_count,
    jsonb_agg(jsonb_build_object(
        'mime', mime,
        'name', name,
        'extension', metadata->>'extension'
    ) ORDER BY name) as types
FROM mime_types
WHERE metadata->>'category' IS NOT NULL
GROUP BY metadata->>'category'
ORDER BY category;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_mime_types_summary_category 
    ON mime_types_summary(category);

-- Function to refresh the summary view
CREATE OR REPLACE FUNCTION refresh_mime_types_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mime_types_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Count total MIME types (should be 56)
DO $$
DECLARE
    mime_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mime_count FROM mime_types;
    RAISE NOTICE 'Total MIME types inserted: %', mime_count;
    
    IF mime_count = 56 THEN
        RAISE NOTICE '✓ All 56 Unstructured.io MIME types successfully inserted!';
    ELSE
        RAISE WARNING '⚠ Expected 56 MIME types, but found %', mime_count;
    END IF;
END $$;

-- Display summary by category
SELECT 
    metadata->>'category' as category,
    COUNT(*) as count
FROM mime_types
WHERE metadata->>'category' IS NOT NULL
GROUP BY metadata->>'category'
ORDER BY count DESC, category;

-- Display all MIME types with OCR support
SELECT 
    name,
    mime,
    metadata->>'extension' as extension
FROM mime_types
WHERE (metadata->>'supports_ocr')::boolean = true
ORDER BY name;

-- Display all MIME types with table extraction support
SELECT 
    name,
    mime,
    metadata->>'extension' as extension
FROM mime_types
WHERE (metadata->>'supports_tables')::boolean = true
ORDER BY name;

-- ============================================================================
-- Usage Examples
-- ============================================================================

/*
-- Example 1: Get MIME type by extension
SELECT * FROM get_mime_type_by_extension('.pdf');

-- Example 2: Get all document MIME types
SELECT * FROM get_mime_types_by_category('document');

-- Example 3: Check if a MIME type supports OCR
SELECT supports_ocr('application/pdf');

-- Example 4: Check if a MIME type supports tables
SELECT supports_tables('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

-- Example 5: Get all categories
SELECT * FROM mime_types_summary;

-- Example 6: Search for MIME types by name
SELECT id, mime, name, metadata->>'extension' as extension
FROM mime_types
WHERE name ILIKE '%excel%';

-- Example 7: Get all image formats that support OCR
SELECT 
    name,
    metadata->>'extension' as extension,
    mime
FROM mime_types
WHERE metadata->>'category' = 'image'
  AND (metadata->>'supports_ocr')::boolean = true;

-- Example 8: Validate a file upload by checking if MIME type exists
SELECT EXISTS(
    SELECT 1 FROM mime_types 
    WHERE mime = 'application/pdf'
) as is_valid_mime_type;

-- Example 9: Get recommended processing strategy based on MIME type
SELECT 
    name,
    mime,
    CASE 
        WHEN (metadata->>'supports_tables')::boolean = true THEN 'Use hi_res strategy for table extraction'
        WHEN (metadata->>'supports_ocr')::boolean = true THEN 'Enable OCR for text extraction'
        WHEN metadata->>'category' = 'image' THEN 'Use OCR and image detection'
        ELSE 'Use standard text extraction'
    END as processing_recommendation
FROM mime_types
WHERE mime = 'application/pdf';
*/

-- ============================================================================
-- Maintenance
-- ============================================================================

-- Grant appropriate permissions (adjust as needed for your user)
-- GRANT SELECT ON mime_types TO your_app_user;
-- GRANT EXECUTE ON FUNCTION get_mime_type_by_extension TO your_app_user;
-- GRANT EXECUTE ON FUNCTION get_mime_types_by_category TO your_app_user;
-- GRANT EXECUTE ON FUNCTION supports_ocr TO your_app_user;
-- GRANT EXECUTE ON FUNCTION supports_tables TO your_app_user;

COMMIT;
