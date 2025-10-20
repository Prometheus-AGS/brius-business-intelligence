import { z } from 'zod';
import { createHash } from 'crypto';
import { knowledgeLogger } from '../observability/logger.js';

/**
 * Document Chunking Strategies
 * Implements multiple strategies for breaking documents into searchable chunks
 * Optimized for semantic search and retrieval augmented generation (RAG)
 */

export type DocumentChunkingStrategy = 'paragraph' | 'sentence' | 'fixed' | 'semantic' | 'hybrid';

export interface ChunkingOptions {
  strategy: DocumentChunkingStrategy;
  chunkSize: number;
  overlap: number;
  metadata?: Record<string, unknown>;
  preserveStructure?: boolean;
  minChunkSize?: number;
  maxChunkSize?: number;
}

export interface DocumentChunk {
  id: string;
  content: string;
  index: number;
  startChar: number;
  endChar: number;
  tokenCount: number;
  metadata: {
    strategy: DocumentChunkingStrategy;
    documentId?: string;
    title?: string;
    category?: string;
    chunkType: 'paragraph' | 'sentence' | 'section' | 'fixed' | 'semantic';
    precedingContext?: string;
    followingContext?: string;
    [key: string]: any;
  };
}

export interface ChunkingResult {
  chunks: DocumentChunk[];
  totalChunks: number;
  totalTokens: number;
  averageChunkSize: number;
  strategy: DocumentChunkingStrategy;
  processingTime: number;
}

// Validation schemas
const ChunkingOptionsSchema = z.object({
  strategy: z.enum(['paragraph', 'sentence', 'fixed', 'semantic', 'hybrid']),
  chunkSize: z.number().min(50).max(8000).default(1000),
  overlap: z.number().min(0).max(1000).default(200),
  metadata: z.record(z.string(), z.unknown()).optional(),
  preserveStructure: z.boolean().default(true),
  minChunkSize: z.number().min(10).default(100),
  maxChunkSize: z.number().min(100).default(4000),
});

/**
 * Document Chunking Service
 */
export class DocumentChunkingService {
  private sentenceEnders = /[.!?]+(?:\s|$)/g;
  private paragraphSeparators = /\n\s*\n/g;
  private sectionHeaders = /^#{1,6}\s+.+$/gm;

  /**
   * Chunk document using specified strategy
   */
  async chunkDocument(text: string, options: ChunkingOptions): Promise<ChunkingResult> {
    const startTime = Date.now();

    knowledgeLogger.info('Starting document chunking', {
      strategy: options.strategy,
      text_length: text.length,
      chunk_size: options.chunkSize,
      overlap: options.overlap,
    });

    // Validate options
    const validationResult = ChunkingOptionsSchema.safeParse(options);
    if (!validationResult.success) {
      throw new Error(`Invalid chunking options: ${validationResult.error.message}`);
    }

    const validOptions = validationResult.data;

    // Clean and prepare text
    const cleanedText = this.preprocessText(text);

    let chunks: DocumentChunk[];

    switch (validOptions.strategy) {
      case 'paragraph':
        chunks = this.chunkByParagraph(cleanedText, validOptions);
        break;

      case 'sentence':
        chunks = this.chunkBySentence(cleanedText, validOptions);
        break;

      case 'fixed':
        chunks = this.chunkByFixedSize(cleanedText, validOptions);
        break;

      case 'semantic':
        chunks = await this.chunkBySemantic(cleanedText, validOptions);
        break;

      case 'hybrid':
        chunks = await this.chunkByHybrid(cleanedText, validOptions);
        break;

      default:
        throw new Error(`Unknown chunking strategy: ${validOptions.strategy}`);
    }

    // Post-process chunks
    chunks = this.postProcessChunks(chunks, validOptions);

    const processingTime = Date.now() - startTime;
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    const averageChunkSize = totalTokens / chunks.length;

    const result: ChunkingResult = {
      chunks,
      totalChunks: chunks.length,
      totalTokens,
      averageChunkSize,
      strategy: validOptions.strategy,
      processingTime,
    };

    knowledgeLogger.info('Document chunking completed', {
      strategy: validOptions.strategy,
      total_chunks: chunks.length,
      total_tokens: totalTokens,
      average_chunk_size: averageChunkSize.toFixed(2),
      processing_time_ms: processingTime,
    });

    return result;
  }

  /**
   * Preprocess text for chunking
   */
  private preprocessText(text: string): string {
    return text
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\r/g, '\n')
      .replace(/\t/g, '    ') // Convert tabs to spaces
      .replace(/\s{3,}/g, '  ') // Reduce multiple spaces
      .trim();
  }

  /**
   * Chunk by paragraphs
   */
  private chunkByParagraph(text: string, options: ChunkingOptions): DocumentChunk[] {
    const paragraphs = text.split(this.paragraphSeparators).filter(p => p.trim().length > 0);
    const chunks: DocumentChunk[] = [];
    let currentChunk = '';
    let currentIndex = 0;
    let charOffset = 0;

    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();

      // Check if adding this paragraph would exceed chunk size
      if (currentChunk && this.estimateTokenCount(currentChunk + '\n\n' + trimmedParagraph) > options.chunkSize) {
        // Create chunk from current content
        if (currentChunk) {
          chunks.push(this.createChunk(
            currentChunk,
            currentIndex,
            charOffset,
            charOffset + currentChunk.length,
            'paragraph',
            options
          ));
          currentIndex++;
          charOffset += currentChunk.length;
        }

        // Start new chunk with overlap
        if (options.overlap > 0 && chunks.length > 0) {
          const overlapText = this.getOverlapText(currentChunk, options.overlap);
          currentChunk = overlapText + (overlapText ? '\n\n' : '') + trimmedParagraph;
        } else {
          currentChunk = trimmedParagraph;
        }
      } else {
        // Add paragraph to current chunk
        currentChunk = currentChunk ? currentChunk + '\n\n' + trimmedParagraph : trimmedParagraph;
      }
    }

    // Add final chunk
    if (currentChunk) {
      chunks.push(this.createChunk(
        currentChunk,
        currentIndex,
        charOffset,
        charOffset + currentChunk.length,
        'paragraph',
        options
      ));
    }

    return chunks;
  }

  /**
   * Chunk by sentences
   */
  private chunkBySentence(text: string, options: ChunkingOptions): DocumentChunk[] {
    const sentences = this.splitIntoSentences(text);
    const chunks: DocumentChunk[] = [];
    let currentChunk = '';
    let currentIndex = 0;
    let charOffset = 0;

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      // Check if adding this sentence would exceed chunk size
      if (currentChunk && this.estimateTokenCount(currentChunk + ' ' + trimmedSentence) > options.chunkSize) {
        // Create chunk from current content
        if (currentChunk) {
          chunks.push(this.createChunk(
            currentChunk,
            currentIndex,
            charOffset,
            charOffset + currentChunk.length,
            'sentence',
            options
          ));
          currentIndex++;
          charOffset += currentChunk.length;
        }

        // Start new chunk with overlap
        if (options.overlap > 0 && chunks.length > 0) {
          const overlapText = this.getOverlapText(currentChunk, options.overlap);
          currentChunk = overlapText + (overlapText ? ' ' : '') + trimmedSentence;
        } else {
          currentChunk = trimmedSentence;
        }
      } else {
        // Add sentence to current chunk
        currentChunk = currentChunk ? currentChunk + ' ' + trimmedSentence : trimmedSentence;
      }
    }

    // Add final chunk
    if (currentChunk) {
      chunks.push(this.createChunk(
        currentChunk,
        currentIndex,
        charOffset,
        charOffset + currentChunk.length,
        'sentence',
        options
      ));
    }

    return chunks;
  }

  /**
   * Chunk by fixed size
   */
  private chunkByFixedSize(text: string, options: ChunkingOptions): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let currentIndex = 0;
    let charOffset = 0;

    while (charOffset < text.length) {
      let chunkEnd = Math.min(charOffset + options.chunkSize, text.length);

      // Try to end at word boundary
      if (chunkEnd < text.length) {
        const wordBoundary = text.lastIndexOf(' ', chunkEnd);
        if (wordBoundary > charOffset + options.chunkSize * 0.8) {
          chunkEnd = wordBoundary;
        }
      }

      const chunkText = text.slice(charOffset, chunkEnd).trim();

      if (chunkText) {
        chunks.push(this.createChunk(
          chunkText,
          currentIndex,
          charOffset,
          chunkEnd,
          'fixed',
          options
        ));
        currentIndex++;
      }

      // Move to next chunk with overlap
      charOffset = chunkEnd - options.overlap;
      if (charOffset <= 0) charOffset = chunkEnd;
    }

    return chunks;
  }

  /**
   * Chunk by semantic boundaries (enhanced approach)
   */
  private async chunkBySemantic(text: string, options: ChunkingOptions): Promise<DocumentChunk[]> {
    knowledgeLogger.debug('Using semantic chunking strategy');

    // For now, implement a heuristic-based semantic chunking
    // In production, this could use embeddings for similarity-based splitting

    const chunks: DocumentChunk[] = [];
    const sections = this.identifySemanticSections(text);
    let currentIndex = 0;

    for (const section of sections) {
      if (this.estimateTokenCount(section.content) <= options.chunkSize) {
        // Section fits in one chunk
        chunks.push(this.createChunk(
          section.content,
          currentIndex,
          section.startChar,
          section.endChar,
          'semantic',
          options
        ));
        currentIndex++;
      } else {
        // Section too large, split by paragraphs within section
        const sectionChunks = this.chunkByParagraph(section.content, {
          ...options,
          metadata: { ...options.metadata, sectionTitle: section.title }
        });

        for (const chunk of sectionChunks) {
          chunks.push({
            ...chunk,
            index: currentIndex,
            startChar: section.startChar + chunk.startChar,
            endChar: section.startChar + chunk.endChar,
            metadata: {
              ...chunk.metadata,
              chunkType: 'semantic',
              sectionTitle: section.title,
            }
          });
          currentIndex++;
        }
      }
    }

    return chunks;
  }

  /**
   * Hybrid chunking strategy (combines multiple approaches)
   */
  private async chunkByHybrid(text: string, options: ChunkingOptions): Promise<DocumentChunk[]> {
    knowledgeLogger.debug('Using hybrid chunking strategy');

    // Step 1: Identify major semantic sections
    const sections = this.identifySemanticSections(text);
    const chunks: DocumentChunk[] = [];
    let currentIndex = 0;

    for (const section of sections) {
      const sectionTokens = this.estimateTokenCount(section.content);

      if (sectionTokens <= options.chunkSize) {
        // Small section - keep as single chunk
        chunks.push(this.createChunk(
          section.content,
          currentIndex,
          section.startChar,
          section.endChar,
          'semantic',
          { ...options, metadata: { ...options.metadata, sectionTitle: section.title } }
        ));
        currentIndex++;
      } else if (sectionTokens <= options.chunkSize * 2) {
        // Medium section - split by paragraphs
        const paragraphChunks = this.chunkByParagraph(section.content, {
          ...options,
          metadata: { ...options.metadata, sectionTitle: section.title }
        });

        for (const chunk of paragraphChunks) {
          chunks.push({
            ...chunk,
            index: currentIndex,
            startChar: section.startChar + chunk.startChar,
            endChar: section.startChar + chunk.endChar,
            metadata: {
              ...chunk.metadata,
              sectionTitle: section.title,
            }
          });
          currentIndex++;
        }
      } else {
        // Large section - use sentence-based chunking for better granularity
        const sentenceChunks = this.chunkBySentence(section.content, {
          ...options,
          metadata: { ...options.metadata, sectionTitle: section.title }
        });

        for (const chunk of sentenceChunks) {
          chunks.push({
            ...chunk,
            index: currentIndex,
            startChar: section.startChar + chunk.startChar,
            endChar: section.startChar + chunk.endChar,
            metadata: {
              ...chunk.metadata,
              sectionTitle: section.title,
            }
          });
          currentIndex++;
        }
      }
    }

    return chunks;
  }

  /**
   * Identify semantic sections in text
   */
  private identifySemanticSections(text: string): Array<{
    content: string;
    title?: string;
    startChar: number;
    endChar: number;
  }> {
    const sections: Array<{
      content: string;
      title?: string;
      startChar: number;
      endChar: number;
    }> = [];

    // Find section headers (markdown style)
    const headerMatches = Array.from(text.matchAll(this.sectionHeaders));

    if (headerMatches.length === 0) {
      // No headers found, treat entire text as one section
      return [{
        content: text,
        startChar: 0,
        endChar: text.length,
      }];
    }

    let lastEndIndex = 0;

    for (let i = 0; i < headerMatches.length; i++) {
      const match = headerMatches[i];
      const nextMatch = headerMatches[i + 1];

      const startIndex = match.index!;
      const endIndex = nextMatch ? nextMatch.index! : text.length;

      // Add content before first header as a section
      if (i === 0 && startIndex > 0) {
        sections.push({
          content: text.slice(0, startIndex).trim(),
          startChar: 0,
          endChar: startIndex,
        });
      }

      // Add section with header
      const sectionContent = text.slice(startIndex, endIndex).trim();
      const title = match[0].replace(/^#+\s*/, '').trim();

      sections.push({
        content: sectionContent,
        title,
        startChar: startIndex,
        endChar: endIndex,
      });
    }

    return sections.filter(section => section.content.length > 0);
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // More sophisticated sentence splitting
    const sentences: string[] = [];
    let currentSentence = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      currentSentence += char;

      // Track quotes
      if ((char === '"' || char === "'") && text[i - 1] !== '\\') {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
          quoteChar = '';
        }
      }

      // Sentence endings
      if (!inQuote && /[.!?]/.test(char)) {
        // Check if this is really the end of a sentence
        if (nextChar && /\s/.test(nextChar)) {
          // Look ahead to see if next non-space character is uppercase
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;

          if (j < text.length && /[A-Z]/.test(text[j])) {
            sentences.push(currentSentence.trim());
            currentSentence = '';
          }
        } else if (!nextChar) {
          // End of text
          sentences.push(currentSentence.trim());
          currentSentence = '';
        }
      }
    }

    // Add any remaining content
    if (currentSentence.trim()) {
      sentences.push(currentSentence.trim());
    }

    return sentences.filter(s => s.length > 0);
  }

  /**
   * Create a document chunk
   */
  private createChunk(
    content: string,
    index: number,
    startChar: number,
    endChar: number,
    chunkType: DocumentChunk['metadata']['chunkType'],
    options: ChunkingOptions
  ): DocumentChunk {
    const id = this.generateChunkId(content, index);
    const tokenCount = this.estimateTokenCount(content);

    return {
      id,
      content: content.trim(),
      index,
      startChar,
      endChar,
      tokenCount,
      metadata: {
        strategy: options.strategy,
        chunkType,
        documentId: options.metadata?.documentId as string | undefined,
        title: options.metadata?.title as string | undefined,
        category: options.metadata?.category as string | undefined,
        ...options.metadata,
      },
    };
  }

  /**
   * Generate unique chunk ID
   */
  private generateChunkId(content: string, index: number): string {
    const hash = createHash('sha256');
    hash.update(content);
    hash.update(index.toString());
    return `chunk_${hash.digest('hex').substring(0, 12)}`;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Get overlap text from the end of a chunk
   */
  private getOverlapText(text: string, overlapSize: number): string {
    if (overlapSize <= 0 || text.length <= overlapSize) {
      return text;
    }

    // Try to find a good breaking point within the overlap
    const overlapText = text.slice(-overlapSize);
    const sentenceBreak = overlapText.indexOf('. ');

    if (sentenceBreak > overlapSize * 0.3) {
      return overlapText.slice(sentenceBreak + 2);
    }

    return overlapText;
  }

  /**
   * Post-process chunks to ensure quality
   */
  private postProcessChunks(chunks: DocumentChunk[], options: ChunkingOptions): DocumentChunk[] {
    return chunks
      .filter(chunk => {
        // Filter out chunks that are too small or too large
        const tokenCount = chunk.tokenCount;
        return tokenCount >= (options.minChunkSize || 100) &&
               tokenCount <= (options.maxChunkSize || 4000);
      })
      .map((chunk, index) => {
        // Add context information
        const precedingChunk = index > 0 ? chunks[index - 1] : null;
        const followingChunk = index < chunks.length - 1 ? chunks[index + 1] : null;

        return {
          ...chunk,
          index, // Re-index after filtering
          metadata: {
            ...chunk.metadata,
            precedingContext: precedingChunk ?
              precedingChunk.content.slice(-100) : undefined,
            followingContext: followingChunk ?
              followingChunk.content.slice(0, 100) : undefined,
          },
        };
      });
  }
}

// Export main chunking function
export async function chunkDocument(text: string, options: ChunkingOptions): Promise<DocumentChunk[]> {
  const service = new DocumentChunkingService();
  const result = await service.chunkDocument(text, options);
  return result.chunks;
}

// Export singleton instance
export const documentChunkingService = new DocumentChunkingService();