#!/usr/bin/env node
// Simple test to debug the chat flow

const { KimiClient } = require('./dist/cli-enhanced.js');

async function test() {
  console.log('Testing Kimi API directly...\n');
  
  const kimi = new KimiClient({
    apiKey: 'sk-kimi-fI1KRarXgVDaNFSpcSgyfcunyQS9wOgtyOL2pXUDqsI2T2JQJ0GladvGNBFXH1KW',
    baseUrl: 'https://api.kimi.com/coding/v1',
    model: 'kimi-k2-5',
  });
  
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello! Say "Test successful" and nothing else.' }
  ];
  
  console.log('Sending messages:', JSON.stringify(messages, null, 2));
  console.log('\n--- Starting stream ---\n');
  
  try {
    let chunkCount = 0;
    for await (const chunk of kimi.stream(messages, [])) {
      chunkCount++;
      console.log(`[Chunk ${chunkCount}] Type: ${chunk.type}`, 
        chunk.content ? `Content: "${chunk.content}"` : '',
        chunk.toolCall ? `Tool: ${chunk.toolCall.function.name}` : ''
      );
      
      if (chunk.type === 'done') {
        console.log('\n--- Stream complete ---');
        break;
      }
    }
    console.log(`\nTotal chunks received: ${chunkCount}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
