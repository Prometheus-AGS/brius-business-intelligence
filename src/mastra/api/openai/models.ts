import { Request, Response } from 'express';
import { mcpLogger } from '../../observability/logger.js';

/**
 * OpenAI-Compatible Models API
 * Provides model information for OpenAI compatibility
 */

export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  permission: any[];
  root: string;
  parent: string | null;
  max_tokens?: number;
  capabilities?: string[];
  description?: string;
  pricing?: {
    input_tokens_per_dollar?: number;
    output_tokens_per_dollar?: number;
  };
}

/**
 * Available models in the business intelligence system
 */
const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'business-intelligence',
    object: 'model',
    created: 1704067200, // 2024-01-01
    owned_by: 'brius-bi',
    permission: [],
    root: 'business-intelligence',
    parent: null,
    max_tokens: 4096,
    capabilities: [
      'chat-completions',
      'business-analysis',
      'financial-metrics',
      'data-interpretation',
      'strategic-insights',
      'knowledge-search',
      'memory-context',
    ],
    description: 'Specialized business intelligence agent for complex analytical queries with knowledge-first planning approach',
    pricing: {
      input_tokens_per_dollar: 2000,
      output_tokens_per_dollar: 1000,
    },
  },
  {
    id: 'default-assistant',
    object: 'model',
    created: 1704067200,
    owned_by: 'brius-bi',
    permission: [],
    root: 'default-assistant',
    parent: null,
    max_tokens: 2048,
    capabilities: [
      'chat-completions',
      'general-questions',
      'simple-calculations',
      'quick-responses',
      'basic-guidance',
    ],
    description: 'Fast, efficient assistant for simple queries and general questions',
    pricing: {
      input_tokens_per_dollar: 4000,
      output_tokens_per_dollar: 2000,
    },
  },
];

/**
 * Get all available models
 */
export async function handleListModels(req: Request, res: Response): Promise<void> {
  try {
    mcpLogger.info('Models list requested', {
      user_agent: req.headers['user-agent'],
      client_ip: req.ip,
    });

    const response = {
      object: 'list',
      data: AVAILABLE_MODELS,
    };

    res.json(response);

  } catch (error) {
    mcpLogger.error('Failed to list models', error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Internal server error while listing models',
        type: 'internal_server_error',
        code: 'internal_error',
      },
    });
  }
}

/**
 * Get specific model information
 */
export async function handleGetModel(req: Request, res: Response): Promise<void> {
  try {
    const modelId = req.params.model;

    mcpLogger.info('Model details requested', {
      model_id: modelId,
      user_agent: req.headers['user-agent'],
      client_ip: req.ip,
    });

    const model = AVAILABLE_MODELS.find(m => m.id === modelId);

    if (!model) {
      res.status(404).json({
        error: {
          message: `Model '${modelId}' not found`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      });
      return;
    }

    res.json(model);

  } catch (error) {
    mcpLogger.error('Failed to get model details', error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Internal server error while retrieving model',
        type: 'internal_server_error',
        code: 'internal_error',
      },
    });
  }
}

/**
 * Get model capabilities and usage information
 */
export async function handleModelCapabilities(req: Request, res: Response): Promise<void> {
  try {
    const modelId = req.params.model;

    mcpLogger.info('Model capabilities requested', {
      model_id: modelId,
    });

    const model = AVAILABLE_MODELS.find(m => m.id === modelId);

    if (!model) {
      res.status(404).json({
        error: {
          message: `Model '${modelId}' not found`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      });
      return;
    }

    const capabilities = {
      model_id: model.id,
      capabilities: model.capabilities || [],
      max_tokens: model.max_tokens,
      description: model.description,
      supported_features: {
        streaming: true,
        function_calling: model.id === 'business-intelligence',
        json_mode: true,
        system_messages: true,
        user_context: model.id !== 'default-assistant',
        knowledge_base: model.id === 'business-intelligence',
        memory_persistence: true,
      },
      performance_characteristics: getPerformanceCharacteristics(model.id),
      use_cases: getUseCases(model.id),
    };

    res.json(capabilities);

  } catch (error) {
    mcpLogger.error('Failed to get model capabilities', error instanceof Error ? error : new Error(String(error)));

    res.status(500).json({
      error: {
        message: 'Internal server error while retrieving capabilities',
        type: 'internal_server_error',
        code: 'internal_error',
      },
    });
  }
}

/**
 * Get performance characteristics for a model
 */
function getPerformanceCharacteristics(modelId: string) {
  const characteristics: Record<string, any> = {
    'business-intelligence': {
      latency: 'medium', // 2-5 seconds
      accuracy: 'high',
      complexity_handling: 'excellent',
      context_retention: 'excellent',
      knowledge_integration: 'full',
      reasoning_depth: 'deep',
    },
    'default-assistant': {
      latency: 'low', // <1 second
      accuracy: 'good',
      complexity_handling: 'basic',
      context_retention: 'limited',
      knowledge_integration: 'none',
      reasoning_depth: 'shallow',
    },
  };

  return characteristics[modelId] || {};
}

/**
 * Get use cases for a model
 */
function getUseCases(modelId: string): string[] {
  const useCases: Record<string, string[]> = {
    'business-intelligence': [
      'Financial analysis and reporting',
      'KPI calculation and interpretation',
      'Market research and competitive analysis',
      'Customer segmentation and behavior analysis',
      'Revenue optimization strategies',
      'Risk assessment and management',
      'Operational efficiency analysis',
      'Strategic planning support',
    ],
    'default-assistant': [
      'General questions and explanations',
      'Simple calculations and conversions',
      'Basic business terminology definitions',
      'Quick fact-finding',
      'Simple data interpretation',
      'General guidance and recommendations',
    ],
  };

  return useCases[modelId] || [];
}

/**
 * Health check for models endpoint
 */
export async function modelsHealthCheck(): Promise<{
  healthy: boolean;
  models_available: number;
  error?: string;
}> {
  try {
    return {
      healthy: true,
      models_available: AVAILABLE_MODELS.length,
    };
  } catch (error) {
    return {
      healthy: false,
      models_available: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Add or update model information (for dynamic model management)
 */
export function registerModel(model: ModelInfo): void {
  const existingIndex = AVAILABLE_MODELS.findIndex(m => m.id === model.id);

  if (existingIndex >= 0) {
    AVAILABLE_MODELS[existingIndex] = model;
    mcpLogger.info('Model updated', { model_id: model.id });
  } else {
    AVAILABLE_MODELS.push(model);
    mcpLogger.info('Model registered', { model_id: model.id });
  }
}

/**
 * Remove model from available models
 */
export function unregisterModel(modelId: string): boolean {
  const index = AVAILABLE_MODELS.findIndex(m => m.id === modelId);

  if (index >= 0) {
    AVAILABLE_MODELS.splice(index, 1);
    mcpLogger.info('Model unregistered', { model_id: modelId });
    return true;
  }

  return false;
}

/**
 * Get model statistics
 */
export function getModelStatistics() {
  return {
    total_models: AVAILABLE_MODELS.length,
    models_by_capability: AVAILABLE_MODELS.reduce((acc, model) => {
      model.capabilities?.forEach(cap => {
        acc[cap] = (acc[cap] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>),
    models_with_streaming: AVAILABLE_MODELS.length, // All models support streaming
    models_with_function_calling: AVAILABLE_MODELS.filter(m =>
      m.capabilities?.includes('business-analysis') ||
      m.capabilities?.includes('knowledge-search')
    ).length,
  };
}
