#!/usr/bin/env node

/**
 * MCP Integration Diagnostic Script
 * Validates the complete MCP integration without requiring full server startup
 * Tests configuration, imports, and basic functionality
 */

import { config } from 'dotenv';
import { readFile, access } from 'fs/promises';
import { resolve } from 'path';

// Load environment variables from .env file
config();

console.log('🔍 MCP Integration Diagnostic Starting...\n');

// Test 1: Environment Variables
console.log('📋 TEST 1: Environment Variables');
const requiredEnvVars = [
  'MCP_CONFIG_PATH',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_MCP_URL',
  'SUPABASE_MCP_FEATURES',
  'SUPABASE_MCP_READ_ONLY'
];

let envTestPassed = true;
for (const envVar of requiredEnvVars) {
  const value = process.env[envVar];
  if (value) {
    console.log(`✅ ${envVar}: ${value}`);
  } else {
    console.log(`❌ ${envVar}: MISSING`);
    envTestPassed = false;
  }
}
console.log(`Environment Variables Test: ${envTestPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

// Test 2: Configuration Files
console.log('📋 TEST 2: Configuration Files');
let configTestPassed = true;

try {
  // Check mcp.json exists and is valid
  const mcpConfigPath = process.env.MCP_CONFIG_PATH || './mcp.json';
  await access(mcpConfigPath);
  const mcpConfigContent = await readFile(mcpConfigPath, 'utf-8');
  const mcpConfig = JSON.parse(mcpConfigContent);
  
  console.log(`✅ mcp.json found at: ${mcpConfigPath}`);
  console.log(`✅ mcp.json is valid JSON`);
  
  if (mcpConfig.mcpServers) {
    const serverCount = Object.keys(mcpConfig.mcpServers).length;
    console.log(`✅ Found ${serverCount} MCP servers configured:`);
    
    for (const [serverId, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
      console.log(`   - ${serverId}: ${serverConfig.description || 'No description'}`);
      console.log(`     Command: ${serverConfig.command} ${(serverConfig.args || []).join(' ')}`);
      console.log(`     Enabled: ${serverConfig.enabled !== false ? 'Yes' : 'No'}`);
    }
  } else {
    console.log(`❌ No mcpServers found in configuration`);
    configTestPassed = false;
  }
  
} catch (error) {
  console.log(`❌ Configuration file error: ${error.message}`);
  configTestPassed = false;
}

console.log(`Configuration Files Test: ${configTestPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

// Test 3: Package Dependencies
console.log('📋 TEST 3: Package Dependencies');
let dependencyTestPassed = true;

try {
  const packageJsonContent = await readFile('./package.json', 'utf-8');
  const packageJson = JSON.parse(packageJsonContent);
  
  const requiredDeps = [
    '@mastra/core',
    '@mastra/mcp',
    '@modelcontextprotocol/sdk',
    '@supabase/mcp-server-supabase',
    'zod'
  ];
  
  console.log('✅ package.json found and parsed');
  
  for (const dep of requiredDeps) {
    if (packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep]) {
      const version = packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep];
      console.log(`✅ ${dep}: ${version}`);
    } else {
      console.log(`❌ ${dep}: MISSING`);
      dependencyTestPassed = false;
    }
  }
  
} catch (error) {
  console.log(`❌ Package dependency error: ${error.message}`);
  dependencyTestPassed = false;
}

console.log(`Package Dependencies Test: ${dependencyTestPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

// Test 4: File Structure
console.log('📋 TEST 4: File Structure');
let fileStructureTestPassed = true;

const requiredFiles = [
  'src/mastra/index.ts',
  'src/mastra/mcp/registry.ts',
  'src/mastra/mcp/client.ts',
  'src/mastra/mcp/config-loader.ts',
  'src/mastra/mcp/process-manager.ts',
  'src/mastra/mcp/tool-mapper.ts',
  'src/mastra/mcp/monitoring.ts',
  'src/mastra/tools/mcp-registry.ts',
  'src/mastra/agents/shared-tools.ts',
  'src/mastra/api/playground/tools.ts'
];

for (const filePath of requiredFiles) {
  try {
    await access(filePath);
    console.log(`✅ ${filePath}`);
  } catch (error) {
    console.log(`❌ ${filePath}: NOT FOUND`);
    fileStructureTestPassed = false;
  }
}

console.log(`File Structure Test: ${fileStructureTestPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

// Test 5: Import Validation (Static Analysis)
console.log('📋 TEST 5: Import Validation');
let importTestPassed = true;

try {
  // Check key integration points
  const sharedToolsContent = await readFile('src/mastra/agents/shared-tools.ts', 'utf-8');
  const registryContent = await readFile('src/mastra/mcp/registry.ts', 'utf-8');
  const playgroundContent = await readFile('src/mastra/api/playground/tools.ts', 'utf-8');
  
  // Check for key imports
  const importChecks = [
    {
      file: 'shared-tools.ts',
      content: sharedToolsContent,
      expectedImports: [
        'mcpToolRegistry',
        'initializeMCPToolRegistration',
        'getMCPTools'
      ]
    },
    {
      file: 'registry.ts', 
      content: registryContent,
      expectedImports: [
        'EventEmitter',
        'mcpConfigLoader',
        'mcpProcessManager',
        'mcpClient'
      ]
    },
    {
      file: 'playground/tools.ts',
      content: playgroundContent,
      expectedImports: [
        'getAllAvailableTools',
        'getToolCounts'
      ]
    }
  ];
  
  for (const check of importChecks) {
    console.log(`Checking imports in ${check.file}:`);
    for (const expectedImport of check.expectedImports) {
      if (check.content.includes(expectedImport)) {
        console.log(`  ✅ ${expectedImport}`);
      } else {
        console.log(`  ❌ ${expectedImport}: NOT FOUND`);
        importTestPassed = false;
      }
    }
  }
  
} catch (error) {
  console.log(`❌ Import validation error: ${error.message}`);
  importTestPassed = false;
}

console.log(`Import Validation Test: ${importTestPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

// Test 6: TypeScript Configuration
console.log('📋 TEST 6: TypeScript Configuration');
let tsConfigTestPassed = true;

try {
  const tsConfigContent = await readFile('tsconfig.json', 'utf-8');
  const tsConfig = JSON.parse(tsConfigContent);
  
  console.log('✅ tsconfig.json found and parsed');
  
  // Check key TypeScript settings
  const compilerOptions = tsConfig.compilerOptions || {};
  
  const expectedSettings = {
    'module': ['ESNext', 'ES2022', 'ES2020'],
    'moduleResolution': ['node', 'bundler'],
    'target': ['ES2022', 'ES2020', 'ESNext'],
    'strict': [true]
  };
  
  for (const [setting, expectedValues] of Object.entries(expectedSettings)) {
    const actualValue = compilerOptions[setting];
    if (expectedValues.includes(actualValue)) {
      console.log(`✅ ${setting}: ${actualValue}`);
    } else {
      console.log(`⚠️  ${setting}: ${actualValue} (expected one of: ${expectedValues.join(', ')})`);
    }
  }
  
} catch (error) {
  console.log(`❌ TypeScript configuration error: ${error.message}`);
  tsConfigTestPassed = false;
}

console.log(`TypeScript Configuration Test: ${tsConfigTestPassed ? '✅ PASSED' : '❌ FAILED'}\n`);

// Summary
console.log('📊 DIAGNOSTIC SUMMARY');
console.log('='.repeat(50));

const tests = [
  { name: 'Environment Variables', passed: envTestPassed },
  { name: 'Configuration Files', passed: configTestPassed },
  { name: 'Package Dependencies', passed: dependencyTestPassed },
  { name: 'File Structure', passed: fileStructureTestPassed },
  { name: 'Import Validation', passed: importTestPassed },
  { name: 'TypeScript Configuration', passed: tsConfigTestPassed }
];

const passedTests = tests.filter(t => t.passed).length;
const totalTests = tests.length;

for (const test of tests) {
  console.log(`${test.passed ? '✅' : '❌'} ${test.name}`);
}

console.log(`\n🎯 Overall Result: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All diagnostic tests passed! MCP integration appears to be properly configured.');
  console.log('\n📝 Next Steps:');
  console.log('1. Run the development server to test runtime initialization');
  console.log('2. Check server logs for MCP connection status');
  console.log('3. Test playground API endpoints for MCP tool visibility');
  console.log('4. Validate tool execution functionality');
} else {
  console.log('⚠️  Some diagnostic tests failed. Review the issues above before proceeding.');
  console.log('\n🔧 Recommended Actions:');
  if (!envTestPassed) console.log('- Set missing environment variables in .env file');
  if (!configTestPassed) console.log('- Fix mcp.json configuration issues');
  if (!dependencyTestPassed) console.log('- Install missing package dependencies');
  if (!fileStructureTestPassed) console.log('- Ensure all required MCP integration files exist');
  if (!importTestPassed) console.log('- Fix import/export issues in TypeScript files');
  if (!tsConfigTestPassed) console.log('- Review TypeScript configuration settings');
}

console.log('\n🔍 Diagnostic Complete');
