// Agent Loader for Horus
// Reads agent .md files from agency-agents directory

import { promises as fs } from 'fs';
import { join, resolve } from 'path';

export interface Agent {
  id: string;
  name: string;
  description: string;
  emoji: string;
  vibe: string;
  color: string;
  content: string;
  category: string;
  filepath: string;
}

interface AgentFrontmatter {
  name?: string;
  description?: string;
  emoji?: string;
  vibe?: string;
  color?: string;
}

const AGENTS_DIR = resolve(process.env.HOME || '~', '.hermes/workspace/agency-agents');

const CATEGORIES = [
  'engineering', 'marketing', 'design', 'product', 
  'sales', 'project-management', 'specialized', 'strategy',
  'testing', 'support', 'spatial-computing', 'paid-media',
  'game-development', 'academic'
];

export async function discoverAgents(category?: string): Promise<Agent[]> {
  const agents: Agent[] = [];
  
  const categoriesToSearch = category ? [category] : CATEGORIES;
  
  for (const cat of categoriesToSearch) {
    const catDir = join(AGENTS_DIR, cat);
    
    try {
      const files = await fs.readdir(catDir);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filepath = join(catDir, file);
          const agent = await parseAgentFile(filepath);
          if (agent) {
            agents.push(agent);
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }
  
  return agents.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const agents = await discoverAgents();
  
  // Try exact match first
  for (const agent of agents) {
    if (agent.id === agentId || agent.id.toLowerCase() === agentId.toLowerCase()) {
      return agent;
    }
  }
  
  // Try fuzzy match
  for (const agent of agents) {
    if (agentId.toLowerCase() in agent.id.toLowerCase() ||
        agentId.toLowerCase() in agent.name.toLowerCase()) {
      return agent;
    }
  }
  
  return null;
}

export async function parseAgentFile(filepath: string): Promise<Agent | null> {
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    
    // Extract YAML frontmatter
    const match = content.match(/^---\s*\n(.*?)\n---\s*\n/s);
    if (!match) {
      return null;
    }
    
    const frontmatter = parseFrontmatter(match[1]);
    const body = content.slice(match[0].length);
    
    // Generate ID from filename
    const filename = filepath.split('/').pop() || '';
    const agentId = filename
      .replace('.md', '')
      .replace(/^(engineering|marketing|design|product|sales|project-management|specialized)-/, '');
    
    // Get category from path
    const parts = filepath.split('/');
    const categoryIndex = parts.indexOf('agency-agents');
    const category = categoryIndex >= 0 && categoryIndex < parts.length - 1
      ? parts[categoryIndex + 1]
      : 'unknown';
    
    return {
      id: agentId,
      name: frontmatter.name || agentId,
      description: frontmatter.description || '',
      emoji: frontmatter.emoji || '🤖',
      vibe: frontmatter.vibe || '',
      color: frontmatter.color || 'blue',
      content: body.trim(),
      category,
      filepath,
    };
  } catch (error) {
    console.error(`Error parsing ${filepath}:`, error);
    return null;
  }
}

function parseFrontmatter(text: string): AgentFrontmatter {
  const result: AgentFrontmatter = {};
  
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes(':') && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');
      
      switch (key.trim()) {
        case 'name':
          result.name = value;
          break;
        case 'description':
          result.description = value;
          break;
        case 'emoji':
          result.emoji = value;
          break;
        case 'vibe':
          result.vibe = value;
          break;
        case 'color':
          result.color = value;
          break;
      }
    }
  }
  
  return result;
}

export function getAgentSystemPrompt(agent: Agent, taskContext: string = ''): string {
  return `You are ${agent.name} ${agent.emoji}

${agent.content}

---

CURRENT TASK CONTEXT:
${taskContext}

You have access to all standard Horus tools (view, edit, bash, search, etc.).
Work autonomously but report back with clear progress updates.`;
}

export async function listAgentsByCategory(): Promise<Map<string, Agent[]>> {
  const agents = await discoverAgents();
  const byCat = new Map<string, Agent[]>();
  
  for (const agent of agents) {
    const cat = agent.category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    if (!byCat.has(cat)) {
      byCat.set(cat, []);
    }
    byCat.get(cat)!.push(agent);
  }
  
  return byCat;
}

export function formatAgentCard(agent: Agent): string {
  return `${agent.emoji} **${agent.name}** (\`${agent.id}\`)\n  _${agent.description}_`;
}

export async function searchAgents(query: string): Promise<Agent[]> {
  const agents = await discoverAgents();
  const queryLower = query.toLowerCase();
  
  return agents.filter(agent =>
    agent.name.toLowerCase().includes(queryLower) ||
    agent.description.toLowerCase().includes(queryLower) ||
    agent.id.toLowerCase().includes(queryLower) ||
    agent.vibe.toLowerCase().includes(queryLower)
  );
}
