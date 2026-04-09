#!/usr/bin/env node
// Test tool execution

const { KimiClient } = require('./dist/cli-enhanced.js');

async function test() {
  const kimi = new KimiClient({
    apiKey: 'sk-kimi-fI1KRarXgVDaNFSpcSgyfcunyQS9wOgtyOL2pXUDqsI2T2JQJ0GladvGNBFXH1KW',
    baseUrl: 'https://api.kimi.com/coding/v1',
    model: 'kimi-k2-5',
  });
  
  const tools = [{
    type: 'function',
    function: {
      name: 'view',
      description: 'View file contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to file' }
        },
        required: ['path']
      }
    }
  }];
  
  const messages = [
    { role: 'system', content: 'You are a helpful assistant with tool access.' },
    { role: 'user', content: 'View the file at /home/jackm/.horus/config.json' }
  ];
  
  console.log('Testing tool execution...\n');
  console.log('Messages:', JSON.stringify(messages, null, 2));
  console.log('Tools:', JSON.stringify(tools.map(t => t.function.name)));
  console.log('\n--- Starting stream ---\n');
  
  try {
    let hasToolCalls = false;
    for await (const chunk of kimi.stream(messages, tools)) {
      console.log(`[${chunk.type}]`, 
        chunk.content ? `Content: "${chunk.content.slice(0, 50)}"` : '',
        chunk.toolCall ? `Tool: ${JSON.stringify(chunk.toolCall).slice(0, 100)}` : ''
      );
      
      if (chunk.type === 'tool_call') {
        hasToolCalls = true;
      }
      
      if (chunk.type === 'done') {
        console.log('\n--- Stream complete ---');
        console.log('Has tool calls:', hasToolCalls);
        break;
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
