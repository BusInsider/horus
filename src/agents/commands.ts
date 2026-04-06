// Agent commands for Horus (/agent equivalent)

import chalk from 'chalk';
import {
  discoverAgents,
  getAgent,
  listAgentsByCategory,
  searchAgents,
  formatAgentCard,
  getAgentSystemPrompt,
} from './loader.js';

export async function cmdList(category?: string): Promise<void> {
  const byCat = await listAgentsByCategory();
  
  if (category) {
    const normalizedCat = category.toLowerCase().replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const agents = byCat.get(normalizedCat);
    
    if (agents) {
      console.log(`\n📁 ${normalizedCat} (${agents.length} agents)\n`);
      for (const agent of agents) {
        console.log(formatAgentCard(agent));
        console.log();
      }
    } else {
      console.log(`❌ Category '${category}' not found`);
      console.log(`Available: ${Array.from(byCat.keys()).join(', ')}`);
    }
  } else {
    console.log('\n🎭 The Agency - Available Agents\n');
    let total = 0;
    
    for (const [cat, agents] of Array.from(byCat.entries()).sort()) {
      console.log(`📁 ${cat}: ${agents.length} agents`);
      for (const agent of agents.slice(0, 5)) {
        console.log(`  ${agent.emoji} ${agent.name} (\`${agent.id}\`)`);
      }
      if (agents.length > 5) {
        console.log(`  ... and ${agents.length - 5} more`);
      }
      console.log();
      total += agents.length;
    }
    
    console.log(`Total: ${total} agents across ${byCat.size} categories`);
    console.log('\nUse \`/agent list <category>\` to see all in a category');
    console.log('Use \`/agent show <agent-id>\` to see details');
    console.log('Use \`/agent deploy <agent-id> <task>\` to activate an agent');
  }
}

export async function cmdShow(agentId: string): Promise<void> {
  const agent = await getAgent(agentId);
  
  if (!agent) {
    console.log(`❌ Agent '${agentId}' not found`);
    console.log('Use \`/agent list\` to see available agents');
    return;
  }
  
  console.log(`\n${agent.emoji} ${chalk.bold(agent.name)}`);
  console.log(`ID: \`${agent.id}\``);
  console.log(`Category: ${agent.category}`);
  console.log(`Vibe: ${agent.vibe}`);
  console.log(`\n${agent.description}\n`);
  console.log(`File: ${agent.filepath}\n`);
  console.log(`To deploy: \`/agent deploy ${agent.id} <task description>\``);
}

export async function cmdDeploy(agentId: string, task?: string): Promise<string | null> {
  const agent = await getAgent(agentId);
  
  if (!agent) {
    console.log(`❌ Agent '${agentId}' not found`);
    return null;
  }
  
  if (!task) {
    console.log(`⚠️ No task specified for ${agent.name}`);
    console.log(`Usage: \`/agent deploy ${agent.id} <task description>\``);
    return null;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎭 DEPLOYING: ${agent.emoji} ${agent.name}`);
  console.log(`${'='.repeat(60)}\n`);
  
  const prompt = getAgentSystemPrompt(agent, task);
  
  console.log('Copy this system prompt for your subagent:\n');
  console.log('---');
  console.log(`SYSTEM PROMPT FOR ${agent.name.toUpperCase()}:`);
  console.log('---\n');
  console.log(prompt);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Use with: spawn_subagent(description=task, system_prompt=prompt_above)');
  console.log(`${'='.repeat(60)}`);
  
  return prompt;
}

export async function cmdSearch(query: string): Promise<void> {
  const matches = await searchAgents(query);
  
  if (matches.length > 0) {
    console.log(`\n🔍 Found ${matches.length} agents matching '${query}':\n`);
    for (const agent of matches.slice(0, 20)) {
      console.log(`  ${agent.emoji} ${agent.name} (\`${agent.id}\`) - ${agent.category}`);
    }
  } else {
    console.log(`❌ No agents found matching '${query}'`);
  }
}

// Main handler for /agent command
export async function handleAgentCommand(args: string[]): Promise<string | null> {
  if (args.length === 0) {
    await cmdList();
    return null;
  }
  
  const command = args[0].toLowerCase();
  
  switch (command) {
    case 'list':
      await cmdList(args[1]);
      return null;
      
    case 'show':
      if (args.length < 2) {
        console.log('❌ Usage: /agent show <agent-id>');
      } else {
        await cmdShow(args[1]);
      }
      return null;
      
    case 'deploy':
      if (args.length < 2) {
        console.log('❌ Usage: /agent deploy <agent-id> <task description>');
      } else {
        const agentId = args[1];
        const task = args.slice(2).join(' ');
        return await cmdDeploy(agentId, task || undefined);
      }
      return null;
      
    case 'search':
      if (args.length < 2) {
        console.log('❌ Usage: /agent search <query>');
      } else {
        await cmdSearch(args.slice(1).join(' '));
      }
      return null;
      
    default:
      console.log(`❌ Unknown command: ${command}`);
      console.log('Use \`/agent\` without arguments for help');
      return null;
  }
}

// Print help
export function printAgentHelp(): void {
  console.log(chalk.blue('\n🎭 The Agency - AI Agent Deployment System\n'));
  console.log('Commands:');
  console.log('  /agent list [category]    - List all agents or filter by category');
  console.log('  /agent show <id>          - Show agent details');
  console.log('  /agent deploy <id> <task> - Generate deployment prompt');
  console.log('  /agent search <query>     - Search agents by keyword');
  console.log('\nCategories: engineering, marketing, design, product, sales,');
  console.log('            project-management, specialized, strategy, testing,');
  console.log('            support, spatial-computing, paid-media, game-development, academic');
}
