import dotenv from 'dotenv';
import { PostgresStore } from '@mastra/pg';
import { PgVector } from '@mastra/pg';
import { Memory } from '@mastra/memory';
import { Mastra } from '@mastra/core/mastra';
import { DefaultExporter } from '@mastra/core/ai-tracing';
import { PinoLogger } from '@mastra/loggers';
import { env, getPort } from './environment.js';
import {
  getPostgresStore,
  getVectorStore,
  getMemoryStore,
  getConnectionPool,
  checkDatabaseHealth,
  ensureVectorIndexes
} from './consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap, getToolCounts } from '../agents/shared-tools.js';
import { businessIntelligenceAgent } from '../agents/business-intelligence.js';
import { defaultAgent } from '../agents/default.js';
import { intentClassifierWorkflow } from '../workflows/intent-classifier.js';
import { defaultOrchestrationWorkflow } from '../workflows/default-orchestration.js';
import { businessIntelligenceOrchestrationWorkflow } from '../workflows/business-intelligence-orchestration.js';
import { planningWorkflow } from '../workflows/planning.js';
import { rootLogger } from '../observability/logger.js';
import { getKnowledgeRoutes } from '../api/routes/knowledge.js';
import { documentProcessingQueue } from '../knowledge/processing-queue.js';

export interface StartupPhase {
  name: string;
  description: string;
  required: boolean;
  timeout: number;
  retries: number;
  execute: () => Promise<void>;
}

export interface StartupResult {
  success: boolean;
  phases: Array<{
    name: string;
    success: boolean;
    duration: number;
    error?: string;
    retries?: number;
  }>;
  totalDuration: number;
  mastraInstance?: Mastra;
}

export class StartupManager {
  private phases: StartupPhase[] = [];
  private mastraInstance: Mastra | null = null;
  private isShuttingDown = false;
  private startupResult: StartupResult | null = null;

  constructor() {
    this.setupPhases();
    this.setupShutdownHandlers();
  }

  private setupPhases(): void {
    this.phases = [
      {
        name: 'environment',
        description: 'Load environment configuration',
        required: true,
        timeout: 5000,
        retries: 0,
        execute: async () => {
          // Environment is already loaded via dotenv.config() in index.ts
          rootLogger.info('Environment configuration loaded', {
            node_env: env.NODE_ENV,
            database_configured: Boolean(env.PGVECTOR_DATABASE_URL),
            langfuse_configured: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
          });
        }
      },
      {
        name: 'database_health',
        description: 'Check database connectivity and health',
        required: true,
        timeout: 30000,
        retries: 5,
        execute: async () => {
          const health = await checkDatabaseHealth();
          if (!health.healthy) {
            throw new Error(`Database health check failed: ${health.error}`);
          }
          rootLogger.info('Database health check passed', {
            pgvector_version: health.pgvectorVersion,
            connection_details: health.connectionDetails,
          });
        }
      },
      {
        name: 'vector_store',
        description: 'Initialize vector store and indexes',
        required: false,
        timeout: 60000,
        retries: 3,
        execute: async () => {
          await ensureVectorIndexes();
          rootLogger.info('Vector store initialized with pgvector indexes');
        }
      },
      {
        name: 'memory_store',
        description: 'Initialize memory store',
        required: false,
        timeout: 30000,
        retries: 3,
        execute: async () => {
          const memoryStore = getMemoryStore();
          rootLogger.info('Memory store initialized', {
            working_memory: true,
            semantic_recall: false, // Disabled until embedder configured
          });
        }
      },
      {
        name: 'mcp_tools',
        description: 'Load and register MCP tools',
        required: false,
        timeout: 45000,
        retries: 3,
        execute: async () => {
          await ensureMcpToolsLoaded();
          const toolCounts = getToolCounts();
          rootLogger.info('MCP tools loaded', toolCounts);
        }
      },
      {
        name: 'agents_workflows',
        description: 'Register agents and workflows',
        required: true,
        timeout: 10000,
        retries: 1,
        execute: async () => {
          // Agents and workflows are registered during Mastra instantiation
          rootLogger.info('Agents and workflows ready for registration');
        }
      },
      {
        name: 'api_routes',
        description: 'Initialize API routes',
        required: true,
        timeout: 10000,
        retries: 1,
        execute: async () => {
          const knowledgeRoutes = getKnowledgeRoutes();
          rootLogger.info('API routes initialized', {
            knowledge_routes: knowledgeRoutes.length,
          });
        }
      },
      {
        name: 'mastra_instance',
        description: 'Create Mastra instance',
        required: true,
        timeout: 15000,
        retries: 1,
        execute: async () => {
          await this.createMastraInstance();
          rootLogger.info('Mastra instance created successfully');
        }
      },
      {
        name: 'background_services',
        description: 'Start background services',
        required: false,
        timeout: 10000,
        retries: 2,
        execute: async () => {
          documentProcessingQueue.start();
          rootLogger.info('Background services started', {
            document_processing_queue: true,
          });
        }
      }
    ];
  }

  private async createMastraInstance(): Promise<void> {
    const observabilityConfig = env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY
      ? {
          configs: {
            langfuse: {
              serviceName: 'brius-business-intelligence',
              exporters: [new DefaultExporter()],
            },
          },
          configSelector: () => 'langfuse',
        }
      : {
          default: { enabled: true },
        };

    this.mastraInstance = new Mastra({
      agents: {
        [businessIntelligenceAgent.name]: businessIntelligenceAgent,
        [defaultAgent.name]: defaultAgent,
      },
      workflows: {
        [intentClassifierWorkflow.id]: intentClassifierWorkflow,
        [defaultOrchestrationWorkflow.id]: defaultOrchestrationWorkflow,
        [businessIntelligenceOrchestrationWorkflow.id]: businessIntelligenceOrchestrationWorkflow,
        [planningWorkflow.id]: planningWorkflow,
      },
      storage: getPostgresStore(),
      vectors: { primary: getVectorStore() },
      logger: new PinoLogger({
        name: 'brius-bi-system',
        level: (process.env.MASTRA_LOG_LEVEL as any) || 'info',
      }),
      telemetry: {
        enabled: false,
      },
      observability: observabilityConfig,
      server: {
        apiRoutes: [
          ...getKnowledgeRoutes(),
        ],
      },
    });
  }

  private setupShutdownHandlers(): void {
    const gracefulShutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        rootLogger.warn('Shutdown already in progress, forcing exit');
        process.exit(1);
      }

      this.isShuttingDown = true;
      rootLogger.info(`Received ${signal}, starting graceful shutdown`);

      try {
        await this.shutdown();
        rootLogger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        rootLogger.error('Shutdown error', { error: error instanceof Error ? error.message : error });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart
  }

  private async executePhaseWithRetry(phase: StartupPhase): Promise<{
    success: boolean;
    duration: number;
    error?: string;
    retries: number;
  }> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= phase.retries) {
      try {
        rootLogger.info(`Starting phase: ${phase.name}`, {
          attempt: attempts + 1,
          max_attempts: phase.retries + 1,
          timeout: phase.timeout,
        });

        // Execute with timeout
        await Promise.race([
          phase.execute(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Phase ${phase.name} timed out after ${phase.timeout}ms`)), phase.timeout)
          )
        ]);

        const duration = Date.now() - startTime;
        rootLogger.info(`Phase completed: ${phase.name}`, {
          duration_ms: duration,
          attempts: attempts + 1,
        });

        return { success: true, duration, retries: attempts };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts++;

        if (attempts <= phase.retries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
          rootLogger.warn(`Phase failed, retrying: ${phase.name}`, {
            attempt: attempts,
            error: lastError.message,
            retry_delay_ms: backoffDelay,
          });
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    const duration = Date.now() - startTime;
    const errorMessage = lastError?.message || 'Unknown error';

    if (phase.required) {
      rootLogger.error(`Required phase failed: ${phase.name}`, {
        error: errorMessage,
        attempts,
        duration_ms: duration,
      });
    } else {
      rootLogger.warn(`Optional phase failed: ${phase.name}`, {
        error: errorMessage,
        attempts,
        duration_ms: duration,
      });
    }

    return { success: false, duration, error: errorMessage, retries: attempts };
  }

  public async initialize(): Promise<StartupResult> {
    const overallStartTime = Date.now();
    const phaseResults: StartupResult['phases'] = [];

    rootLogger.info('Starting Mastra initialization', {
      total_phases: this.phases.length,
      required_phases: this.phases.filter(p => p.required).length,
      optional_phases: this.phases.filter(p => !p.required).length,
    });

    for (const phase of this.phases) {
      if (this.isShuttingDown) {
        rootLogger.warn('Shutdown requested during startup, aborting');
        break;
      }

      const result = await this.executePhaseWithRetry(phase);
      phaseResults.push({
        name: phase.name,
        success: result.success,
        duration: result.duration,
        error: result.error,
        retries: result.retries,
      });

      // Stop if required phase failed
      if (!result.success && phase.required) {
        const totalDuration = Date.now() - overallStartTime;
        this.startupResult = {
          success: false,
          phases: phaseResults,
          totalDuration,
        };

        rootLogger.error('Startup failed due to required phase failure', {
          failed_phase: phase.name,
          total_duration_ms: totalDuration,
        });

        return this.startupResult;
      }
    }

    const totalDuration = Date.now() - overallStartTime;
    const successfulPhases = phaseResults.filter(p => p.success).length;
    const success = phaseResults.filter(p => p.success && this.phases.find(phase => phase.name === p.name)?.required).length === 
                   this.phases.filter(p => p.required).length;

    this.startupResult = {
      success,
      phases: phaseResults,
      totalDuration,
      mastraInstance: this.mastraInstance || undefined,
    };

    if (success) {
      rootLogger.info('Mastra initialization completed successfully', {
        successful_phases: successfulPhases,
        total_phases: this.phases.length,
        total_duration_ms: totalDuration,
        agents: this.mastraInstance ? Object.keys(this.mastraInstance.getAgents()).length : 0,
        workflows: this.mastraInstance ? Object.keys(this.mastraInstance.getWorkflows()).length : 0,
      });
    } else {
      rootLogger.error('Mastra initialization failed', {
        successful_phases: successfulPhases,
        total_phases: this.phases.length,
        total_duration_ms: totalDuration,
      });
    }

    return this.startupResult;
  }

  public async shutdown(): Promise<void> {
    rootLogger.info('Starting graceful shutdown');

    const shutdownTasks = [
      {
        name: 'document_processing_queue',
        task: async () => {
          if (documentProcessingQueue) {
            documentProcessingQueue.stop();
          }
        }
      },
      {
        name: 'database_connections',
        task: async () => {
          const pool = getConnectionPool();
          if (pool) {
            await pool.end();
          }
        }
      },
      {
        name: 'mastra_instance',
        task: async () => {
          // Mastra handles its own cleanup
          this.mastraInstance = null;
        }
      }
    ];

    for (const { name, task } of shutdownTasks) {
      try {
        await Promise.race([
          task(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Shutdown task ${name} timed out`)), 5000)
          )
        ]);
        rootLogger.info(`Shutdown task completed: ${name}`);
      } catch (error) {
        rootLogger.error(`Shutdown task failed: ${name}`, {
          error: error instanceof Error ? error.message : error
        });
      }
    }

    rootLogger.info('Graceful shutdown completed');
  }

  public getMastraInstance(): Mastra | null {
    return this.mastraInstance;
  }

  public getStartupResult(): StartupResult | null {
    return this.startupResult;
  }

  public isInitialized(): boolean {
    return this.startupResult?.success === true && this.mastraInstance !== null;
  }
}

// Singleton instance
let startupManager: StartupManager | null = null;

export function getStartupManager(): StartupManager {
  if (!startupManager) {
    startupManager = new StartupManager();
  }
  return startupManager;
}

// Health info generation
export function generateHealthInfo(mastra: Mastra) {
  return {
    service: 'brius-business-intelligence',
    version: '1.0.0',
    environment: env.NODE_ENV,
    features: {
      agent_count: Object.keys(mastra.getAgents()).length,
      workflow_count: Object.keys(mastra.getWorkflows()).length,
      langfuse_enabled: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
      memory_enabled: true,
      knowledge_base_enabled: true,
      bedrock_llm_enabled: true,
    },
    agents: Object.keys(mastra.getAgents()),
    workflows: Object.keys(mastra.getWorkflows()),
    tools: Object.keys(getSharedToolMap()),
    tool_counts: getToolCounts(),
  };
}

// Configuration export
export function generateConfig() {
  return {
    port: getPort(),
    environment: env.NODE_ENV,
    database: {
      url: env.PGVECTOR_DATABASE_URL,
      type: 'pgvector',
    },
    observability: {
      langfuse: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
    },
  };
}