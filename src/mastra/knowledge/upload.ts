import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import { knowledgeLogger } from '../observability/logger.js';
import { supabase } from '../config/database.js';
import { DocumentChunkingStrategy, chunkDocument } from './chunking.js';
import { generateKnowledgeEmbeddings } from './embeddings.js';

/**
 * Document Upload Processing
 * Handles multi-format document upload, validation, processing, and storage
 * Supports various document types with configurable processing strategies
 */

export interface DocumentUploadRequest {
  file: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    size: number;
  };
  metadata: {
    title?: string;
    description?: string;
    category?: string;
    tags?: string[];
    userId: string;
    source?: string;
  };
  processing: {
    chunkingStrategy?: DocumentChunkingStrategy;
    generateEmbeddings?: boolean;
    enableSearch?: boolean;
    extractMetadata?: boolean;
  };
}

export interface DocumentUploadResponse {
  id: string;
  title: string;
  originalName: string;
  size: number;
  mimeType: string;
  status: 'processing' | 'completed' | 'failed';
  uploadedAt: string;
  processedAt?: string;
  metadata: {
    category?: string;
    tags?: string[];
    pageCount?: number;
    wordCount?: number;
    characterCount?: number;
    language?: string;
    extractedText?: string;
  };
  processing: {
    chunkCount?: number;
    embeddingCount?: number;
    searchEnabled: boolean;
  };
  error?: string;
}

export interface SupportedFormat {
  extension: string;
  mimeTypes: string[];
  maxSize: number;
  processor: string;
  features: {
    textExtraction: boolean;
    metadataExtraction: boolean;
    chunkingSupport: boolean;
  };
}

// Supported document formats
const SUPPORTED_FORMATS: SupportedFormat[] = [
  {
    extension: '.txt',
    mimeTypes: ['text/plain'],
    maxSize: 10 * 1024 * 1024, // 10MB
    processor: 'text',
    features: {
      textExtraction: true,
      metadataExtraction: false,
      chunkingSupport: true,
    },
  },
  {
    extension: '.md',
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    maxSize: 10 * 1024 * 1024, // 10MB
    processor: 'markdown',
    features: {
      textExtraction: true,
      metadataExtraction: true,
      chunkingSupport: true,
    },
  },
  {
    extension: '.json',
    mimeTypes: ['application/json'],
    maxSize: 5 * 1024 * 1024, // 5MB
    processor: 'json',
    features: {
      textExtraction: true,
      metadataExtraction: true,
      chunkingSupport: true,
    },
  },
  {
    extension: '.csv',
    mimeTypes: ['text/csv', 'application/csv'],
    maxSize: 50 * 1024 * 1024, // 50MB
    processor: 'csv',
    features: {
      textExtraction: true,
      metadataExtraction: true,
      chunkingSupport: true,
    },
  },
  {
    extension: '.pdf',
    mimeTypes: ['application/pdf'],
    maxSize: 100 * 1024 * 1024, // 100MB
    processor: 'pdf',
    features: {
      textExtraction: true,
      metadataExtraction: true,
      chunkingSupport: true,
    },
  },
  {
    extension: '.docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maxSize: 50 * 1024 * 1024, // 50MB
    processor: 'docx',
    features: {
      textExtraction: true,
      metadataExtraction: true,
      chunkingSupport: true,
    },
  },
];

// Validation schemas
const DocumentUploadSchema = z.object({
  file: z.object({
    buffer: z.instanceof(Buffer),
    originalName: z.string().min(1),
    mimeType: z.string(),
    size: z.number().positive(),
  }),
  metadata: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    userId: z.string().min(1),
    source: z.string().optional(),
  }),
  processing: z.object({
    chunkingStrategy: z.enum(['paragraph', 'sentence', 'fixed-size', 'semantic', 'hybrid']).optional().default('hybrid'),
    generateEmbeddings: z.boolean().optional().default(true),
    enableSearch: z.boolean().optional().default(true),
    extractMetadata: z.boolean().optional().default(true),
  }).optional().default({}),
});

/**
 * Document Upload Processor
 */
export class DocumentUploadProcessor {
  private tempDir: string;
  private maxConcurrentUploads: number;
  private currentUploads = new Map<string, DocumentUploadResponse>();

  constructor(tempDir = '/tmp/knowledge-uploads', maxConcurrentUploads = 5) {
    this.tempDir = tempDir;
    this.maxConcurrentUploads = maxConcurrentUploads;
    this.ensureTempDir();
  }

  /**
   * Process document upload
   */
  async processUpload(request: DocumentUploadRequest): Promise<DocumentUploadResponse> {
    knowledgeLogger.info('Starting document upload processing', {
      original_name: request.file.originalName,
      size: request.file.size,
      mime_type: request.file.mimeType,
      user_id: request.metadata.userId,
    });

    // Validate request
    const validation = DocumentUploadSchema.safeParse(request);
    if (!validation.success) {
      throw new Error(`Invalid upload request: ${validation.error.message}`);
    }

    const validRequest = validation.data;

    // Check if we're at capacity
    if (this.currentUploads.size >= this.maxConcurrentUploads) {
      throw new Error('Upload capacity exceeded. Please try again later.');
    }

    // Generate document ID
    const documentId = this.generateDocumentId(validRequest.file);

    // Initialize upload response
    const uploadResponse: DocumentUploadResponse = {
      id: documentId,
      title: validRequest.metadata.title || this.extractTitleFromFilename(validRequest.file.originalName),
      originalName: validRequest.file.originalName,
      size: validRequest.file.size,
      mimeType: validRequest.file.mimeType,
      status: 'processing',
      uploadedAt: new Date().toISOString(),
      metadata: {
        category: validRequest.metadata.category,
        tags: validRequest.metadata.tags,
      },
      processing: {
        searchEnabled: validRequest.processing.enableSearch,
      },
    };

    // Track the upload
    this.currentUploads.set(documentId, uploadResponse);

    try {
      // Validate file format
      await this.validateFileFormat(validRequest.file);

      // Store document metadata
      await this.storeDocumentMetadata(uploadResponse, validRequest.metadata);

      // Extract text content
      const extractedContent = await this.extractTextContent(validRequest.file);
      uploadResponse.metadata.extractedText = extractedContent.text;
      uploadResponse.metadata.pageCount = extractedContent.pageCount;
      uploadResponse.metadata.wordCount = extractedContent.wordCount;
      uploadResponse.metadata.characterCount = extractedContent.characterCount;
      uploadResponse.metadata.language = extractedContent.language;

      // Process document if enabled
      if (validRequest.processing.generateEmbeddings || validRequest.processing.enableSearch) {
        await this.processDocumentContent(uploadResponse, extractedContent, validRequest.processing);
      }

      // Mark as completed
      uploadResponse.status = 'completed';
      uploadResponse.processedAt = new Date().toISOString();

      // Update database
      await this.updateDocumentStatus(documentId, uploadResponse);

      knowledgeLogger.info('Document upload processing completed', {
        document_id: documentId,
        chunks: uploadResponse.processing.chunkCount,
        embeddings: uploadResponse.processing.embeddingCount,
        processing_time: Date.now() - new Date(uploadResponse.uploadedAt).getTime(),
      });

      return uploadResponse;

    } catch (error) {
      uploadResponse.status = 'failed';
      uploadResponse.error = error instanceof Error ? error.message : String(error);

      knowledgeLogger.error('Document upload processing failed', {
        document_id: documentId,
        error: uploadResponse.error,
      });

      // Update database with error
      await this.updateDocumentStatus(documentId, uploadResponse);

      throw error;

    } finally {
      // Clean up
      this.currentUploads.delete(documentId);
    }
  }

  /**
   * Get upload status
   */
  getUploadStatus(documentId: string): DocumentUploadResponse | null {
    return this.currentUploads.get(documentId) || null;
  }

  /**
   * Get all current uploads
   */
  getCurrentUploads(): DocumentUploadResponse[] {
    return Array.from(this.currentUploads.values());
  }

  /**
   * Get supported formats
   */
  getSupportedFormats(): SupportedFormat[] {
    return [...SUPPORTED_FORMATS];
  }

  /**
   * Validate file format
   */
  private async validateFileFormat(file: { originalName: string; mimeType: string; size: number }): Promise<void> {
    const extension = extname(file.originalName).toLowerCase();

    // Find supported format
    const supportedFormat = SUPPORTED_FORMATS.find(format =>
      format.extension === extension && format.mimeTypes.includes(file.mimeType)
    );

    if (!supportedFormat) {
      throw new Error(`Unsupported file format: ${extension} (${file.mimeType})`);
    }

    // Check file size
    if (file.size > supportedFormat.maxSize) {
      throw new Error(`File size exceeds limit: ${file.size} > ${supportedFormat.maxSize} bytes`);
    }

    knowledgeLogger.debug('File format validated', {
      extension,
      mime_type: file.mimeType,
      size: file.size,
      processor: supportedFormat.processor,
    });
  }

  /**
   * Extract text content from document
   */
  private async extractTextContent(file: { buffer: Buffer; originalName: string; mimeType: string }): Promise<{
    text: string;
    pageCount?: number;
    wordCount: number;
    characterCount: number;
    language?: string;
  }> {
    const extension = extname(file.originalName).toLowerCase();

    knowledgeLogger.debug('Extracting text content', {
      extension,
      mime_type: file.mimeType,
      size: file.buffer.length,
    });

    let text: string;
    let pageCount: number | undefined;

    switch (extension) {
      case '.txt':
        text = file.buffer.toString('utf-8');
        break;

      case '.md':
        text = file.buffer.toString('utf-8');
        // Remove markdown syntax for cleaner text
        text = this.cleanMarkdownText(text);
        break;

      case '.json':
        try {
          const jsonData = JSON.parse(file.buffer.toString('utf-8'));
          text = this.extractTextFromJson(jsonData);
        } catch (error) {
          throw new Error(`Invalid JSON format: ${error instanceof Error ? error.message : String(error)}`);
        }
        break;

      case '.csv':
        text = this.extractTextFromCsv(file.buffer.toString('utf-8'));
        break;

      case '.pdf':
        // For PDF, we would use a library like pdf-parse
        // For now, return a placeholder
        text = `[PDF content from ${file.originalName} - PDF parsing not implemented yet]`;
        pageCount = 1; // Placeholder
        break;

      case '.docx':
        // For DOCX, we would use a library like mammoth
        // For now, return a placeholder
        text = `[DOCX content from ${file.originalName} - DOCX parsing not implemented yet]`;
        break;

      default:
        throw new Error(`Text extraction not supported for format: ${extension}`);
    }

    // Calculate statistics
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    const characterCount = text.length;

    // Detect language (basic heuristic)
    const language = this.detectLanguage(text);

    return {
      text,
      pageCount,
      wordCount,
      characterCount,
      language,
    };
  }

  /**
   * Process document content (chunking and embeddings)
   */
  private async processDocumentContent(
    uploadResponse: DocumentUploadResponse,
    extractedContent: { text: string },
    processing: DocumentUploadRequest['processing']
  ): Promise<void> {
    knowledgeLogger.info('Processing document content', {
      document_id: uploadResponse.id,
      text_length: extractedContent.text.length,
      chunking_strategy: processing.chunkingStrategy,
      generate_embeddings: processing.generateEmbeddings,
    });

    // Chunk the document
    const chunks = await chunkDocument(extractedContent.text, {
      strategy: processing.chunkingStrategy || 'hybrid',
      chunkSize: 1000,
      overlap: 200,
      metadata: {
        documentId: uploadResponse.id,
        title: uploadResponse.title,
        category: uploadResponse.metadata.category,
      },
    });

    uploadResponse.processing.chunkCount = chunks.length;

    // Store chunks in database
    await this.storeDocumentChunks(uploadResponse.id, chunks);

    // Generate embeddings if enabled
    if (processing.generateEmbeddings) {
      knowledgeLogger.info('Generating embeddings for document chunks', {
        document_id: uploadResponse.id,
        chunk_count: chunks.length,
      });

      for (const chunk of chunks) {
        try {
          const embedding = await generateKnowledgeEmbeddings(chunk.content);

          // Store embedding
          await this.storeChunkEmbedding(chunk.id, embedding);

        } catch (error) {
          knowledgeLogger.warn('Failed to generate embedding for chunk', {
            document_id: uploadResponse.id,
            chunk_id: chunk.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      uploadResponse.processing.embeddingCount = chunks.length;
    }

    knowledgeLogger.info('Document content processing completed', {
      document_id: uploadResponse.id,
      chunks: uploadResponse.processing.chunkCount,
      embeddings: uploadResponse.processing.embeddingCount,
    });
  }

  /**
   * Store document metadata in database
   */
  private async storeDocumentMetadata(
    uploadResponse: DocumentUploadResponse,
    metadata: DocumentUploadRequest['metadata']
  ): Promise<void> {
    const { error } = await supabase
      .from('knowledge_documents')
      .insert({
        id: uploadResponse.id,
        title: uploadResponse.title,
        original_name: uploadResponse.originalName,
        mime_type: uploadResponse.mimeType,
        file_size: uploadResponse.size,
        status: uploadResponse.status,
        user_id: metadata.userId,
        category: metadata.category,
        description: metadata.description,
        tags: metadata.tags,
        source: metadata.source,
        uploaded_at: uploadResponse.uploadedAt,
        metadata: uploadResponse.metadata,
      });

    if (error) {
      throw new Error(`Failed to store document metadata: ${error.message}`);
    }
  }

  /**
   * Store document chunks in database
   */
  private async storeDocumentChunks(documentId: string, chunks: any[]): Promise<void> {
    const chunkRecords = chunks.map(chunk => ({
      id: chunk.id,
      document_id: documentId,
      content: chunk.content,
      chunk_index: chunk.index,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      metadata: chunk.metadata,
      created_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('document_chunks')
      .insert(chunkRecords);

    if (error) {
      throw new Error(`Failed to store document chunks: ${error.message}`);
    }
  }

  /**
   * Store chunk embedding in database
   */
  private async storeChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const { error } = await supabase
      .from('document_chunks')
      .update({
        embedding: embedding,
        embedding_model: 'amazon.titan-embed-text-v2:0',
        embedded_at: new Date().toISOString(),
      })
      .eq('id', chunkId);

    if (error) {
      throw new Error(`Failed to store chunk embedding: ${error.message}`);
    }
  }

  /**
   * Update document status in database
   */
  private async updateDocumentStatus(documentId: string, uploadResponse: DocumentUploadResponse): Promise<void> {
    const { error } = await supabase
      .from('knowledge_documents')
      .update({
        status: uploadResponse.status,
        processed_at: uploadResponse.processedAt,
        metadata: uploadResponse.metadata,
        processing_info: uploadResponse.processing,
        error_message: uploadResponse.error,
      })
      .eq('id', documentId);

    if (error) {
      knowledgeLogger.error('Failed to update document status', {
        document_id: documentId,
        error: error.message,
      });
    }
  }

  /**
   * Generate unique document ID
   */
  private generateDocumentId(file: { buffer: Buffer; originalName: string }): string {
    const hash = createHash('sha256');
    hash.update(file.buffer);
    hash.update(file.originalName);
    hash.update(Date.now().toString());

    return `doc_${hash.digest('hex').substring(0, 16)}`;
  }

  /**
   * Extract title from filename
   */
  private extractTitleFromFilename(filename: string): string {
    const nameWithoutExtension = basename(filename, extname(filename));
    return nameWithoutExtension.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Clean markdown text
   */
  private cleanMarkdownText(text: string): string {
    return text
      .replace(/^#{1,6}\s+/gm, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italics
      .replace(/`(.*?)`/g, '$1') // Remove inline code
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
      .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
      .trim();
  }

  /**
   * Extract text from JSON
   */
  private extractTextFromJson(data: any, prefix = ''): string {
    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return String(data);
    }

    if (Array.isArray(data)) {
      return data.map((item, index) => this.extractTextFromJson(item, `${prefix}[${index}]`)).join(' ');
    }

    if (typeof data === 'object' && data !== null) {
      return Object.entries(data)
        .map(([key, value]) => `${key}: ${this.extractTextFromJson(value, `${prefix}.${key}`)}`)
        .join(' ');
    }

    return '';
  }

  /**
   * Extract text from CSV
   */
  private extractTextFromCsv(csv: string): string {
    const lines = csv.split('\n');
    const header = lines[0];
    const rows = lines.slice(1).filter(line => line.trim());

    let text = `CSV file with columns: ${header}\n`;
    text += `Contains ${rows.length} data rows.\n`;

    // Sample first few rows for context
    const sampleRows = rows.slice(0, 5);
    if (sampleRows.length > 0) {
      text += 'Sample data:\n' + sampleRows.join('\n');
    }

    return text;
  }

  /**
   * Basic language detection
   */
  private detectLanguage(text: string): string {
    // Very basic language detection - in production, use a proper library
    const sample = text.substring(0, 1000).toLowerCase();

    // English indicators
    if (/\b(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out|day|get|has|him|his|how|its|may|new|now|old|see|two|who|boy|did|man|men|she|too|way|who|oil|sit|set|run|say|eat|far|off|try|ask|use|why)\b/.test(sample)) {
      return 'en';
    }

    // Spanish indicators
    if (/\b(que|de|el|la|en|y|a|es|se|no|te|lo|le|da|su|por|son|con|para|una|sur|también|ya|vez|han|bien|estar|como|donde|muy|sin|sobre|ser|todo|pero|más|hacer|otro|tiempo|casa|cada|mismo)\b/.test(sample)) {
      return 'es';
    }

    // French indicators
    if (/\b(le|de|et|à|un|il|être|et|en|avoir|que|pour|dans|ce|son|une|sur|avec|ne|se|pas|tout|plus|par|grand|ce|le|mais|que|où|ou|sous|pendant|depuis|vers|très|bien|encore|ici|comment|pourquoi)\b/.test(sample)) {
      return 'fr';
    }

    return 'unknown';
  }

  /**
   * Ensure temp directory exists
   */
  private async ensureTempDir(): Promise<void> {
    try {
      await fs.access(this.tempDir);
    } catch {
      await fs.mkdir(this.tempDir, { recursive: true });
    }
  }
}

// Export singleton instance
export const documentUploadProcessor = new DocumentUploadProcessor();