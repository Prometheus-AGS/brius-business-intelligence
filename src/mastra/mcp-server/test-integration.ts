#!/usr/bin/env node

// Using global setTimeout instead of promises version
import { rootLogger } from '../observability/logger.js';
import { createMastraMCPServer, MastraMCPServerConfig } from './index.js';

/**
 * MCP Server Integration Test
 * Tests basic functionality of the MCP server to ensure it starts correctly
 * and provides expected functionality for external clients
 */

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class MCPServerIntegrationTest {
  private testResults: TestResult[] = [];
  private server: any = null;
  private readonly testConfig: MastraMCPServerConfig;

  constructor() {
    this.testConfig = {
      name: 'test-mastra-mcp-server',
      version: '1.0.0-test',
      description: 'Test instance of Mastra MCP Server',
      transport: {
        type: 'sse',
        sse: {
          port: 3002, // Use different port to avoid conflicts
          host: '127.0.0.1',
          path: '/mcp/sse',
          messagePath: '/mcp/message',
          cors: {
            origin: true,
            credentials: true,
          },
          heartbeatInterval: 30000,
          maxConnections: 10,
          timeout: 60000,
        },
      },
      tools: {
        enableAgents: true,
        enableWorkflows: true,
        enableKnowledge: true,
        enableMemory: true,
        customTools: [],
      },
      options: {
        enableTracing: false, // Disable tracing for testing
        logLevel: 'warn', // Reduce log noise during testing
        maxRequestSize: 1024 * 1024,
        requestTimeout: 30000,
      },
      environment: 'test',
    };
  }

  /**
   * Run a single test with timing and error handling
   */
  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();

    try {
      await testFn();
      this.testResults.push({
        name,
        passed: true,
        duration: Date.now() - startTime,
      });
      console.log(`✅ ${name} (${Date.now() - startTime}ms)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.testResults.push({
        name,
        passed: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      });
      console.log(`❌ ${name} (${Date.now() - startTime}ms): ${errorMessage}`);
    }
  }

  /**
   * Test server startup and shutdown
   */
  private async testServerLifecycle(): Promise<void> {
    this.server = createMastraMCPServer(this.testConfig);

    // Test startup
    await this.server.start();

    if (!this.server.isRunning()) {
      throw new Error('Server is not running after start()');
    }

    // Test basic server properties
    const config = this.server.getConfig();
    if (config.name !== this.testConfig.name) {
      throw new Error(`Server name mismatch: expected ${this.testConfig.name}, got ${config.name}`);
    }

    // Test stats
    const stats = await this.server.getStats();
    if (stats.status !== 'running') {
      throw new Error(`Server status is ${stats.status}, expected 'running'`);
    }

    if (stats.tools.registered === 0) {
      throw new Error('No tools registered');
    }
  }

  /**
   * Test HTTP endpoints
   */
  private async testHTTPEndpoints(): Promise<void> {
    const baseUrl = `http://${this.testConfig.transport.sse!.host}:${this.testConfig.transport.sse!.port}`;

    // Test health endpoint
    const healthResponse = await globalThis.fetch(`${baseUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Health endpoint returned ${healthResponse.status}`);
    }

    const healthData = await healthResponse.json();
    if (healthData.status !== 'healthy') {
      throw new Error(`Health status is ${healthData.status}`);
    }

    // Test stats endpoint
    const statsResponse = await globalThis.fetch(`${baseUrl}/stats`);
    if (!statsResponse.ok) {
      throw new Error(`Stats endpoint returned ${statsResponse.status}`);
    }

    const statsData = await statsResponse.json();
    if (statsData.status !== 'running') {
      throw new Error(`Stats shows status ${statsData.status}`);
    }

    // Test info endpoint
    const infoResponse = await globalThis.fetch(`${baseUrl}/info`);
    if (!infoResponse.ok) {
      throw new Error(`Info endpoint returned ${infoResponse.status}`);
    }

    const infoData = await infoResponse.json();
    if (infoData.name !== this.testConfig.name) {
      throw new Error(`Info name mismatch: expected ${this.testConfig.name}, got ${infoData.name}`);
    }
  }

  /**
   * Test SSE connection
   */
  private async testSSEConnection(): Promise<void> {
    const baseUrl = `http://${this.testConfig.transport.sse!.host}:${this.testConfig.transport.sse!.port}`;

    // Create a promise that resolves when we receive the connected event
    const connectionPromise = new Promise<void>((resolve, reject) => {
      const timeoutId: NodeJS.Timeout = setTimeout(() => {
        reject(new Error('SSE connection timeout'));
      }, 10000);

      // For testing, we'll use node's EventSource equivalent
      // In a real environment, you might use a different approach
      globalThis.fetch(`${baseUrl}${this.testConfig.transport.sse!.path}`, {
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      }).then(async (response) => {
        if (!response.ok) {
          reject(new Error(`SSE connection failed: ${response.status}`));
          return;
        }

        // Read the first chunk to verify connection
        const reader = response.body?.getReader();
        if (!reader) {
          reject(new Error('No response body reader'));
          return;
        }

        try {
          const { value } = await reader.read();
          if (value) {
            const chunk = new TextDecoder().decode(value);
            if (chunk.includes('event: connected')) {
              clearTimeout(timeoutId);
              resolve();
            } else {
              reject(new Error('Did not receive connected event'));
            }
          } else {
            reject(new Error('No data received from SSE'));
          }
        } catch (error) {
          reject(error);
        } finally {
          reader.releaseLock();
        }
      }).catch(reject);
    });

    await connectionPromise;
  }

  /**
   * Test tool registration and categories
   */
  private async testToolRegistration(): Promise<void> {
    const stats = await this.server.getStats();

    // Check that tools are registered
    if (stats.tools.registered === 0) {
      throw new Error('No tools registered');
    }

    // Check that expected categories are present
    const expectedCategories = ['agents', 'workflows', 'knowledge', 'memory'];
    const actualCategories = Object.keys(stats.tools.byCategory);

    for (const category of expectedCategories) {
      if (!actualCategories.includes(category)) {
        throw new Error(`Expected tool category '${category}' not found`);
      }

      if (stats.tools.byCategory[category] === 0) {
        throw new Error(`No tools registered in category '${category}'`);
      }
    }

    // Verify minimum expected tool counts
    if (stats.tools.byCategory.agents < 2) {
      throw new Error(`Expected at least 2 agent tools, got ${stats.tools.byCategory.agents}`);
    }

    if (stats.tools.byCategory.workflows < 3) {
      throw new Error(`Expected at least 3 workflow tools, got ${stats.tools.byCategory.workflows}`);
    }

    if (stats.tools.byCategory.knowledge < 5) {
      throw new Error(`Expected at least 5 knowledge tools, got ${stats.tools.byCategory.knowledge}`);
    }

    if (stats.tools.byCategory.memory < 7) {
      throw new Error(`Expected at least 7 memory tools, got ${stats.tools.byCategory.memory}`);
    }
  }

  /**
   * Test server shutdown
   */
  private async testServerShutdown(): Promise<void> {
    if (!this.server) {
      throw new Error('Server not initialized');
    }

    await this.server.stop();

    if (this.server.isRunning()) {
      throw new Error('Server is still running after stop()');
    }

    // Try to access endpoints after shutdown (should fail)
    const baseUrl = `http://${this.testConfig.transport.sse!.host}:${this.testConfig.transport.sse!.port}`;

    try {
      await globalThis.fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      throw new Error('Health endpoint still accessible after shutdown');
    } catch (error) {
      if (error instanceof Error && error.name === 'ConnectTimeoutError') {
        // This is expected - server is shut down
        return;
      }
      if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed'))) {
        // This is also expected - connection refused
        return;
      }
      throw error;
    }
  }

  /**
   * Run all integration tests
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting MCP Server Integration Tests\n');

    const startTime = Date.now();

    // Run tests in sequence
    await this.runTest('Server Lifecycle (Start)', () => this.testServerLifecycle());

    // Add small delay to ensure server is fully ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.runTest('HTTP Endpoints', () => this.testHTTPEndpoints());
    await this.runTest('SSE Connection', () => this.testSSEConnection());
    await this.runTest('Tool Registration', () => this.testToolRegistration());
    await this.runTest('Server Shutdown', () => this.testServerShutdown());

    const totalTime = Date.now() - startTime;

    // Print results summary
    console.log('\n📊 Test Results Summary');
    console.log('========================');

    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => r.passed === false).length;

    console.log(`Total Tests: ${this.testResults.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total Time: ${totalTime}ms`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`  - ${result.name}: ${result.error}`);
        });
    }

    console.log('\n✅ All tests completed!');

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  }
}

/**
 * Main test execution
 */
async function main(): Promise<void> {
  const tester = new MCPServerIntegrationTest();

  // Handle interruption gracefully
  process.on('SIGINT', async () => {
    console.log('\n⚠️  Test interrupted. Cleaning up...');
    process.exit(1);
  });

  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('💥 Test execution failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal test error:', error);
    process.exit(1);
  });
}

export { MCPServerIntegrationTest };