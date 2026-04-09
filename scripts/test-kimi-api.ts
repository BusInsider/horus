#!/usr/bin/env node
/**
 * Simple test script for Kimi API connection
 * Run with: npx ts-node scripts/test-kimi-api.ts
 */

import { KimiClient } from '../src/kimi.js';
import { loadConfig } from '../src/config.js';

async function testConnection() {
  console.log('🧪 Testing Kimi API Connection\n');

  // Load config
  const config = loadConfig();
  
  console.log('Configuration:');
  console.log(`  Base URL: ${config.provider.baseUrl}`);
  console.log(`  Model: ${config.provider.model}`);
  console.log(`  API Key: ${config.provider.apiKey ? '✅ Set' : '❌ Not set'}\n`);

  if (!config.provider.apiKey) {
    console.error('❌ Error: No API key configured');
    console.log('Set KIMI_API_KEY environment variable or run `horus configure`');
    process.exit(1);
  }

  // Create client
  const client = new KimiClient({
    apiKey: config.provider.apiKey,
    baseUrl: config.provider.baseUrl,
    model: config.provider.model,
  });

  // Test 1: Simple completion
  console.log('Test 1: Simple completion...');
  try {
    const response = await client.complete([
      { role: 'user', content: 'Say "Kimi API test successful" and nothing else.' }
    ], { maxTokens: 20 });
    
    console.log(`  Response: "${response.trim()}"`);
    if (response.toLowerCase().includes('successful')) {
      console.log('  ✅ Test 1 passed\n');
    } else {
      console.log('  ⚠️  Test 1: Unexpected response but connection works\n');
    }
  } catch (error) {
    console.error(`  ❌ Test 1 failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }

  // Test 2: Streaming
  console.log('Test 2: Streaming response...');
  try {
    const chunks: string[] = [];
    for await (const chunk of client.stream(
      [{ role: 'user', content: 'Count from 1 to 3' }],
      []
    )) {
      if (chunk.type === 'token' && chunk.content) {
        chunks.push(chunk.content);
      } else if (chunk.type === 'done') {
        break;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.content || 'Streaming error');
      }
    }
    
    const response = chunks.join('');
    console.log(`  Response: "${response.trim()}"`);
    console.log(`  Chunks received: ${chunks.length}`);
    console.log('  ✅ Test 2 passed\n');
  } catch (error) {
    console.error(`  ❌ Test 2 failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }

  // Test 3: Tool calling
  console.log('Test 3: Tool calling...');
  try {
    const tools = [{
      type: 'function' as const,
      function: {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object' as const,
          properties: {
            location: { type: 'string', description: 'City name' }
          },
          required: ['location']
        }
      }
    }];

    let toolCallReceived = false;
    for await (const chunk of client.stream(
      [{ role: 'user', content: 'What is the weather in Beijing?' }],
      tools
    )) {
      if (chunk.type === 'tool_call') {
        toolCallReceived = true;
        console.log(`  Tool call: ${chunk.toolCall?.function.name}`);
        console.log(`  Arguments: ${chunk.toolCall?.function.arguments}`);
        break;
      } else if (chunk.type === 'done') {
        break;
      }
    }

    if (toolCallReceived) {
      console.log('  ✅ Test 3 passed\n');
    } else {
      console.log('  ⚠️  Test 3: No tool call received (model may have responded directly)\n');
    }
  } catch (error) {
    console.error(`  ❌ Test 3 failed: ${error instanceof Error ? error.message : error}\n`);
  }

  console.log('🎉 All tests completed!');
}

testConnection().catch(console.error);
