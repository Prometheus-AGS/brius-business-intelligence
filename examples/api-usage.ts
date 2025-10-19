/**
 * Business Intelligence API Usage Examples
 * Demonstrates how to use the Mastra Business Intelligence system
 */

import { executeOrchestrator } from '../src/mastra/index.js';
import { OrchestratorInput } from '../src/mastra/types/index.js';

/**
 * Example 1: Direct Orchestrator Usage
 * Use the orchestrator directly for intelligent routing
 */
async function exampleDirectOrchestrator() {
  console.log('=== Example 1: Direct Orchestrator Usage ===\n');

  const input: OrchestratorInput = {
    prompt: 'What was our customer acquisition cost last quarter and how does it compare to industry benchmarks?',
    user_id: 'demo-user-123',
    conversation_id: 'demo-conversation-456',
  };

  try {
    const result = await executeOrchestrator(input);

    console.log('Selected Agent:', result.selected_agent);
    console.log('Execution Path:', result.execution_path);
    console.log('Performance Metrics:', result.performance_metrics);
    console.log('Response:', result.agent_response);

    if ((result as any).fallback_info?.fallback_used) {
      console.log('Fallback Used:', (result as any).fallback_info);
    }

  } catch (error) {
    console.error('Orchestrator execution failed:', error);
  }
}

/**
 * Example 2: OpenAI-Compatible API Usage
 * Use the OpenAI-compatible endpoints via HTTP
 */
async function exampleOpenAIAPI() {
  console.log('\n=== Example 2: OpenAI-Compatible API Usage ===\n');

  const apiBaseUrl = 'http://localhost:3000/api/openai';

  // Example chat completion request
  const chatRequest = {
    model: 'business-intelligence',
    messages: [
      {
        role: 'user',
        content: 'Analyze our Q3 revenue performance and identify key growth drivers'
      }
    ],
    stream: false,
    temperature: 0.1,
    user: 'demo-user-123',
  };

  try {
    const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer your-api-key-here', // Optional
      },
      body: JSON.stringify(chatRequest),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Chat Completion Response:');
    console.log('Model:', result.model);
    console.log('Response:', result.choices[0].message.content);
    console.log('Usage:', result.usage);

  } catch (error) {
    console.error('API request failed:', error);
  }
}

/**
 * Example 3: Streaming Chat Completion
 * Demonstrates real-time streaming responses
 */
async function exampleStreamingAPI() {
  console.log('\n=== Example 3: Streaming API Usage ===\n');

  const apiBaseUrl = 'http://localhost:3000/api/openai';

  const streamRequest = {
    model: 'business-intelligence',
    messages: [
      {
        role: 'user',
        content: 'Provide a comprehensive analysis of our sales pipeline and conversion rates'
      }
    ],
    stream: true,
    temperature: 0.1,
  };

  try {
    const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(streamRequest),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    console.log('Streaming response:');
    console.log('---');

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log('\n---');
        console.log('Stream completed');
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            console.log('\nStream finished');
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;

            if (content) {
              process.stdout.write(content);
            }
          } catch (e) {
            // Ignore parsing errors for malformed chunks
          }
        }
      }
    }

  } catch (error) {
    console.error('Streaming request failed:', error);
  }
}

/**
 * Example 4: Model Information and Capabilities
 * Explore available models and their capabilities
 */
async function exampleModelInfo() {
  console.log('\n=== Example 4: Model Information ===\n');

  const apiBaseUrl = 'http://localhost:3000/api/openai';

  try {
    // List all models
    console.log('Available Models:');
    const modelsResponse = await fetch(`${apiBaseUrl}/v1/models`);
    const models = await modelsResponse.json();

    models.data.forEach((model: any) => {
      console.log(`- ${model.id}: ${model.description || 'No description'}`);
    });

    // Get specific model capabilities
    console.log('\nBusiness Intelligence Model Capabilities:');
    const capabilitiesResponse = await fetch(`${apiBaseUrl}/v1/models/business-intelligence/capabilities`);
    const capabilities = await capabilitiesResponse.json();

    console.log('Capabilities:', capabilities.capabilities);
    console.log('Use Cases:', capabilities.use_cases);
    console.log('Performance:', capabilities.performance_characteristics);

  } catch (error) {
    console.error('Model info request failed:', error);
  }
}

/**
 * Example 5: Health Check and System Status
 * Monitor system health and performance
 */
async function exampleHealthCheck() {
  console.log('\n=== Example 5: Health Check ===\n');

  const apiBaseUrl = 'http://localhost:3000/api/openai';

  try {
    const healthResponse = await fetch(`${apiBaseUrl}/health`);
    const health = await healthResponse.json();

    console.log('System Health:', health.healthy ? '✅ Healthy' : '❌ Unhealthy');
    console.log('Services:');

    Object.entries(health.services).forEach(([service, status]: [string, any]) => {
      console.log(`  ${service}: ${status.healthy ? '✅' : '❌'} (${status.latency || 0}ms)`);
    });

  } catch (error) {
    console.error('Health check failed:', error);
  }
}

/**
 * Example 6: Complex Business Query with Context
 * Demonstrates advanced business intelligence features
 */
async function exampleComplexBusinessQuery() {
  console.log('\n=== Example 6: Complex Business Query ===\n');

  const input: OrchestratorInput = {
    prompt: `I need a comprehensive analysis of our Q3 2024 performance. Please include:
    1. Revenue growth compared to Q2 2024 and Q3 2023
    2. Customer acquisition metrics and trends
    3. Key performance indicators across all business units
    4. Risk factors and opportunities identified
    5. Strategic recommendations for Q4 planning

    Please provide both quantitative analysis and qualitative insights, with confidence levels for each recommendation.`,
    user_id: 'exec-user-789',
    conversation_id: 'strategic-review-q3-2024',
    context: {
      user_role: 'executive',
      priority: 'high',
      department: 'strategy',
      requested_format: 'executive_summary',
    },
  };

  try {
    const result = await executeOrchestrator(input);

    console.log('Query Classification:');
    console.log('  Intent:', result.intent_classification.classification.intent);
    console.log('  Complexity Score:', result.intent_classification.classification.complexity_score);
    console.log('  Selected Agent:', result.selected_agent);

    console.log('\nExecution Details:');
    console.log('  Path:', result.execution_path);
    console.log('  Performance:', result.performance_metrics);

    console.log('\nBusiness Analysis Result:');
    console.log(result.agent_response);

  } catch (error) {
    console.error('Complex query execution failed:', error);
  }
}

/**
 * Run all examples
 */
async function runExamples() {
  console.log('🚀 Business Intelligence API Examples\n');
  console.log('Note: Make sure the server is running on http://localhost:3000\n');

  try {
    await exampleDirectOrchestrator();
    await exampleOpenAIAPI();
    await exampleStreamingAPI();
    await exampleModelInfo();
    await exampleHealthCheck();
    await exampleComplexBusinessQuery();

    console.log('\n✅ All examples completed successfully!');

  } catch (error) {
    console.error('\n❌ Example execution failed:', error);
  }
}

// Export examples for individual use
export {
  exampleDirectOrchestrator,
  exampleOpenAIAPI,
  exampleStreamingAPI,
  exampleModelInfo,
  exampleHealthCheck,
  exampleComplexBusinessQuery,
  runExamples,
};

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(console.error);
}