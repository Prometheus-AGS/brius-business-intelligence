/**
 * Integration Points Contract for Bedrock LLM Service
 *
 * This contract defines how the Bedrock LLM service integrates with other
 * system components including the consolidated database, existing agents,
 * and MCP servers.
 */

import type {
  BedrockLLMServiceConfig,
  TitanEmbeddingResponse,
  ClaudeTextGenerationRequest,
  ClaudeTextGenerationResponse,
} from '../../data-model';

/**
 * Consolidated Database Integration
 *
 * The service must integrate with the existing consolidated database pattern
 * established in src/mastra/config/consolidated-database.ts
 */
export interface IConsolidatedDatabaseIntegration {
  /**
   * Get the vector operations service for embedding storage/retrieval
   * This should use the existing getVectorOpsService() function
   */
  getVectorOperations(): {
    storeUserMemory(
      userId: string,
      content: string,
      embedding: number[],
      category?: string,
      metadata?: Record<string, any>
    ): Promise<string>;

    storeGlobalMemory(
      content: string,
      embedding: number[],
      category?: string,
      accessLevel?: 'public' | 'restricted' | 'admin',
      createdBy?: string,
      metadata?: Record<string, any>
    ): Promise<string>;

    storeDocumentChunk(
      documentId: string,
      chunkIndex: number,
      content: string,
      embedding: number[],
      chunkMetadata?: Record<string, any>
    ): Promise<string>;

    semanticSearch(
      queryEmbedding: number[],
      options: {
        searchTable: 'user_memories' | 'global_memories' | 'document_chunks';
        userFilter?: string;
        matchThreshold?: number;
        matchCount?: number;
      }
    ): Promise<Array<{
      id: string;
      content: string;
      similarity: number;
      metadata: Record<string, any>;
    }>>;
  };

  /**
   * Get the memory store for agent memory operations
   * This should use the existing getMemoryStore() function
   */
  getMemoryStore(): {
    add(params: {
      messages: Array<{ role: string; content: string }>;
      userId: string;
      sessionId: string;
      runId?: string;
    }): Promise<void>;

    get(params: {
      userId: string;
      sessionId: string;
      runId?: string;
    }): Promise<Array<{ role: string; content: string }>>;

    search(params: {
      text: string;
      userId: string;
      sessionId?: string;
      limit?: number;
    }): Promise<Array<{
      content: string;
      similarity: number;
      metadata: Record<string, any>;
    }>>;
  };

  /**
   * Get the connection pool for direct database access
   * This should use the existing getConnectionPool() function
   */
  getConnectionPool(): {
    query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
  };
}

/**
 * Existing Agent Integration
 *
 * The service should integrate seamlessly with existing agents like
 * the business intelligence agent in src/mastra/agents/business-intelligence.ts
 */
export interface IAgentIntegration {
  /**
   * Provide enhanced text generation capabilities to existing agents
   */
  enhanceAgent(agentId: string, capabilities: {
    useClaudeForGeneration?: boolean;
    useTitanForEmbeddings?: boolean;
    enableMemoryStorage?: boolean;
    enableKnowledgeSearch?: boolean;
  }): Promise<void>;

  /**
   * Create agent memory with semantic search capabilities
   */
  createSemanticMemory(params: {
    agentId: string;
    userId: string;
    sessionId: string;
    content: string;
    metadata?: Record<string, any>;
  }): Promise<{
    memoryId: string;
    embedding: number[];
    similarity?: number;
  }>;

  /**
   * Search agent memory using semantic similarity
   */
  searchAgentMemory(params: {
    agentId: string;
    userId: string;
    query: string;
    limit?: number;
    threshold?: number;
  }): Promise<Array<{
    content: string;
    similarity: number;
    timestamp: string;
    metadata: Record<string, any>;
  }>>;

  /**
   * Generate contextual responses using agent memory and knowledge base
   */
  generateContextualResponse(params: {
    agentId: string;
    userId: string;
    query: string;
    includeMemory?: boolean;
    includeKnowledge?: boolean;
    maxTokens?: number;
  }): Promise<{
    response: string;
    sources: Array<{
      type: 'memory' | 'knowledge';
      content: string;
      similarity: number;
    }>;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }>;
}

/**
 * MCP Server Integration
 *
 * The service should integrate with MCP servers for enhanced capabilities
 * including the Mastra MCP server, Context7, and Tavily
 */
export interface IMCPServerIntegration {
  /**
   * Mastra MCP Server Integration
   * Leverage existing MCP tools and knowledge from the Mastra ecosystem
   */
  getMastraMCPTools(): Promise<Array<{
    name: string;
    description: string;
    schema: any;
    execute: (params: any) => Promise<any>;
  }>>;

  /**
   * Context7 MCP Server Integration
   * Access up-to-date documentation and code examples
   */
  getContext7Documentation(params: {
    libraryName: string;
    topic?: string;
    maxTokens?: number;
  }): Promise<{
    libraryId: string;
    documentation: string;
    examples: Array<{
      title: string;
      code: string;
      description: string;
    }>;
  }>;

  /**
   * Tavily MCP Server Integration
   * Perform web searches for current information
   */
  performWebSearch(params: {
    query: string;
    maxResults?: number;
    includeContent?: boolean;
    domains?: string[];
  }): Promise<{
    results: Array<{
      title: string;
      url: string;
      content?: string;
      snippet: string;
      relevanceScore: number;
    }>;
    totalResults: number;
  }>;

  /**
   * Enhanced RAG with MCP integration
   * Combine internal knowledge with external sources
   */
  performEnhancedRAG(params: {
    query: string;
    includeWeb?: boolean;
    includeDocumentation?: boolean;
    includeKnowledge?: boolean;
    userId?: string;
  }): Promise<{
    answer: string;
    sources: Array<{
      type: 'internal' | 'web' | 'documentation';
      title: string;
      content: string;
      url?: string;
      relevance: number;
    }>;
    confidence: number;
    processingTime: number;
  }>;
}

/**
 * Observability Integration
 *
 * The service should integrate with existing observability infrastructure
 * including Langfuse, OpenTelemetry, and error tracking
 */
export interface IObservabilityIntegration {
  /**
   * Langfuse Integration
   * Leverage existing instrumentation setup from .mastra/output/instrumentation.mjs
   */
  getLangfuseTracer(): {
    trace<T>(
      operationName: string,
      operation: () => Promise<T>,
      metadata?: Record<string, any>
    ): Promise<T>;

    startSpan(name: string, metadata?: Record<string, any>): {
      addEvent(name: string, attributes?: Record<string, any>): void;
      setStatus(status: { code: 'ok' | 'error'; message?: string }): void;
      end(): void;
      getTraceId(): string;
    };
  };

  /**
   * Error Tracking Integration
   * Use existing error handling patterns from src/mastra/observability/error-handling.ts
   */
  getErrorTracker(): {
    recordError(
      error: Error,
      context: {
        component: string;
        operation: string;
        userId?: string;
        metadata?: Record<string, any>;
      },
      severity: 'low' | 'medium' | 'high' | 'critical'
    ): Promise<void>;

    withErrorHandling<T>(
      operation: () => Promise<T>,
      context: {
        component: string;
        operation: string;
        metadata?: Record<string, any>;
      },
      severity: 'low' | 'medium' | 'high' | 'critical'
    ): Promise<T>;
  };

  /**
   * Performance Monitoring
   * Track service performance metrics
   */
  getPerformanceMonitor(): {
    recordLatency(operation: string, latencyMs: number, metadata?: Record<string, any>): void;
    recordThroughput(operation: string, count: number, metadata?: Record<string, any>): void;
    recordCost(operation: string, cost: number, currency: string, metadata?: Record<string, any>): void;
    recordTokenUsage(operation: string, tokens: { input: number; output: number }, metadata?: Record<string, any>): void;
  };
}

/**
 * Knowledge Base Integration
 *
 * The service should integrate with existing knowledge base infrastructure
 * from src/mastra/knowledge/ and src/mastra/tools/knowledge-search.ts
 */
export interface IKnowledgeBaseIntegration {
  /**
   * Enhanced Knowledge Search
   * Leverage existing knowledge search capabilities with improved embeddings
   */
  searchKnowledge(params: {
    query: string;
    searchType?: 'semantic' | 'keyword' | 'hybrid';
    maxResults?: number;
    minScore?: number;
    categories?: string[];
    userId?: string;
  }): Promise<{
    results: Array<{
      chunk: {
        id: string;
        content: string;
        chunkIndex: number;
      };
      document: {
        id: string;
        title: string;
        category?: string;
        tags?: string[];
      };
      score: number;
      highlight?: string;
    }>;
    totalResults: number;
    processingTime: number;
  }>;

  /**
   * Document Embedding Enhancement
   * Re-embed existing documents with improved Titan v2 embeddings
   */
  enhanceDocumentEmbeddings(params: {
    documentIds?: string[];
    batchSize?: number;
    preserveOriginal?: boolean;
  }): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: Array<{
      documentId: string;
      error: string;
    }>;
    processingTime: number;
  }>;

  /**
   * Intelligent Document Chunking
   * Use Claude for improved document chunking strategies
   */
  improveDocumentChunking(params: {
    documentId: string;
    content: string;
    chunkingStrategy?: 'semantic' | 'paragraph' | 'sentence' | 'intelligent';
    maxChunkSize?: number;
    overlapSize?: number;
  }): Promise<{
    chunks: Array<{
      content: string;
      startChar: number;
      endChar: number;
      embedding: number[];
      metadata: Record<string, any>;
    }>;
    totalChunks: number;
    averageChunkSize: number;
  }>;
}

/**
 * Configuration Integration
 *
 * The service should integrate with existing configuration patterns
 * and environment management
 */
export interface IConfigurationIntegration {
  /**
   * Environment Configuration
   * Load configuration from environment variables and config files
   */
  loadConfiguration(): Promise<BedrockLLMServiceConfig>;

  /**
   * Dynamic Configuration Updates
   * Support runtime configuration changes without service restart
   */
  updateConfiguration(updates: Partial<BedrockLLMServiceConfig>): Promise<{
    success: boolean;
    updatedFields: string[];
    errors?: string[];
    restartRequired?: boolean;
  }>;

  /**
   * Configuration Validation
   * Validate configuration against AWS resources and permissions
   */
  validateConfiguration(config: BedrockLLMServiceConfig): Promise<{
    valid: boolean;
    errors: Array<{
      field: string;
      error: string;
      suggestion?: string;
    }>;
    warnings: Array<{
      field: string;
      warning: string;
      impact: string;
    }>;
  }>;

  /**
   * Secrets Management
   * Secure handling of AWS credentials and API keys
   */
  getSecrets(): Promise<{
    awsCredentials?: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    };
    langfuseCredentials?: {
      publicKey: string;
      secretKey: string;
      baseUrl: string;
    };
  }>;
}

/**
 * Testing Integration
 *
 * The service should provide comprehensive testing capabilities
 */
export interface ITestingIntegration {
  /**
   * Mock Service for Testing
   * Provide mock implementations for testing environments
   */
  createMockService(config?: {
    enableClaude?: boolean;
    enableTitan?: boolean;
    simulateLatency?: number;
    simulateErrors?: boolean;
  }): Promise<{
    generateText: (request: ClaudeTextGenerationRequest) => Promise<ClaudeTextGenerationResponse>;
    generateEmbedding: (text: string) => Promise<TitanEmbeddingResponse>;
    getHealth: () => Promise<{ healthy: boolean }>;
  }>;

  /**
   * Integration Test Helpers
   * Helpers for testing service integration with other components
   */
  getTestHelpers(): {
    createTestUser(userId: string): Promise<void>;
    createTestMemories(userId: string, memories: string[]): Promise<string[]>;
    createTestDocuments(documents: Array<{ title: string; content: string }>): Promise<string[]>;
    cleanupTestData(userId?: string): Promise<void>;
  };

  /**
   * Performance Testing
   * Tools for performance and load testing
   */
  getPerformanceTestTools(): {
    benchmarkTextGeneration(config: {
      concurrency: number;
      requests: number;
      requestSize: 'small' | 'medium' | 'large';
    }): Promise<{
      totalRequests: number;
      successfulRequests: number;
      averageLatency: number;
      p95Latency: number;
      p99Latency: number;
      tokensPerSecond: number;
    }>;

    benchmarkEmbeddings(config: {
      concurrency: number;
      requests: number;
      textSize: 'small' | 'medium' | 'large';
    }): Promise<{
      totalRequests: number;
      successfulRequests: number;
      averageLatency: number;
      embeddingsPerSecond: number;
    }>;
  };
}

/**
 * Integration Requirements Checklist
 *
 * This checklist ensures all integration points are properly implemented
 */
export const IntegrationRequirements = [
  'Consolidated database integration using existing getVectorOpsService()',
  'Memory store integration using existing getMemoryStore()',
  'Connection pool integration using existing getConnectionPool()',
  'Agent enhancement capabilities for existing business intelligence agent',
  'Semantic memory creation and search for agents',
  'MCP server integration for Mastra, Context7, and Tavily',
  'Enhanced RAG capabilities combining internal and external sources',
  'Langfuse tracing integration with existing instrumentation',
  'Error tracking integration with existing error handling patterns',
  'Performance monitoring and metrics collection',
  'Knowledge base search enhancement with improved embeddings',
  'Document embedding enhancement using Titan v2',
  'Intelligent document chunking using Claude',
  'Environment configuration loading and validation',
  'Dynamic configuration updates without restart',
  'Secure secrets management for AWS and Langfuse credentials',
  'Mock service implementation for testing',
  'Integration test helpers for cleanup and setup',
  'Performance testing tools for benchmarking',
] as const;

/**
 * Integration Testing Contract
 *
 * Defines the testing requirements for integration points
 */
export interface IIntegrationTesting {
  /**
   * Test consolidated database integration
   */
  testDatabaseIntegration(): Promise<{
    vectorOpsWorking: boolean;
    memoryStoreWorking: boolean;
    connectionPoolWorking: boolean;
    errors: string[];
  }>;

  /**
   * Test agent integration
   */
  testAgentIntegration(): Promise<{
    agentEnhancementWorking: boolean;
    semanticMemoryWorking: boolean;
    contextualResponseWorking: boolean;
    errors: string[];
  }>;

  /**
   * Test MCP server integration
   */
  testMCPIntegration(): Promise<{
    mastraMCPWorking: boolean;
    context7Working: boolean;
    tavilyWorking: boolean;
    errors: string[];
  }>;

  /**
   * Test observability integration
   */
  testObservabilityIntegration(): Promise<{
    langfuseWorking: boolean;
    errorTrackingWorking: boolean;
    performanceMonitoringWorking: boolean;
    errors: string[];
  }>;

  /**
   * Test knowledge base integration
   */
  testKnowledgeIntegration(): Promise<{
    searchWorking: boolean;
    embeddingEnhancementWorking: boolean;
    chunkingWorking: boolean;
    errors: string[];
  }>;

  /**
   * Run all integration tests
   */
  runAllIntegrationTests(): Promise<{
    allTestsPassed: boolean;
    results: Record<string, boolean>;
    errors: Record<string, string[]>;
    totalTests: number;
    passedTests: number;
    failedTests: number;
  }>;
}