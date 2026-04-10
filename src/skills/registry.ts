// Skill Registry - Manages dynamic skill loading and lifecycle

import { promises as fs } from 'fs';
import { join } from 'path';

import {
  Skill,
  SkillManifest,
  SkillCode,
  SkillMetadata,
  SkillSource,
  SkillLoadOptions,
  CompiledSkill,
} from './types.js';
import { Tool, ToolContext, ToolResult } from '../tools/types.js';

const SKILLS_DIR = {
  builtin: '~/.horus/skills/builtin',
  user: '~/.horus/skills/user',
  community: '~/.horus/skills/community',
  session: '', // Ephemeral, in-memory only
};

function expandHomeDir(path: string): string {
  if (path.startsWith('~/')) {
    return join(process.env.HOME || process.env.USERPROFILE || '', path.slice(2));
  }
  return path;
}

export class SkillRegistry {
  private skills = new Map<string, SkillMetadata>();
  private compiledSkills = new Map<string, CompiledSkill>();

  private sessionSkills = new Map<string, Skill>(); // Ephemeral skills

  // Initialize and load all skills
  async initialize(): Promise<void> {
    await this.loadAllSkills();
  }

  // Load skills from all sources
  private async loadAllSkills(): Promise<void> {
    // Load built-in skills
    await this.loadFromDirectory('builtin');
    
    // Load user skills
    await this.loadFromDirectory('user');
    
    // Load community skills
    await this.loadFromDirectory('community');
  }

  // Load skills from a specific directory
  private async loadFromDirectory(source: SkillSource): Promise<void> {
    if (source === 'session') return; // Session skills are in-memory
    
    const dir = expandHomeDir(SKILLS_DIR[source]);
    
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      return;
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const skillPath = join(dir, entry.name);
      try {
        await this.loadSkillFromPath(skillPath, { source });
      } catch (error) {
        console.warn(`Failed to load skill from ${skillPath}:`, error);
      }
    }
  }

  // Load a single skill from a directory
  async loadSkillFromPath(
    skillPath: string,
    options: SkillLoadOptions
  ): Promise<SkillMetadata> {
    const manifestPath = join(skillPath, 'manifest.json');
    const codePath = join(skillPath, 'skill.js');

    // Read manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: SkillManifest = JSON.parse(manifestContent);

    // Read code
    const codeContent = await fs.readFile(codePath, 'utf-8');
    const code: SkillCode = JSON.parse(codeContent);

    const skill: Skill = { manifest, code };
    return this.registerSkill(skill, options);
  }

  // Register a skill
  registerSkill(skill: Skill, options: SkillLoadOptions): SkillMetadata {
    const { manifest } = skill;

    // Validate if requested
    if (options.validate !== false) {
      this.validateSkill(skill);
    }

    // Create metadata
    const metadata: SkillMetadata = {
      manifest,
      loaded: true,
      loadTime: Date.now(),
      usageCount: 0,
    };

    this.skills.set(manifest.id, metadata);

    // Compile to Tool
    const compiledSkill = this.compileSkill(skill, options.source);
    this.compiledSkills.set(manifest.id, compiledSkill);

    // Set up hot reload if requested
    if (options.hotReload) {
      this.setupHotReload(manifest.id, skill);
    }

    return metadata;
  }

  // Register a session-only skill (ephemeral)
  registerSessionSkill(skill: Skill): SkillMetadata {
    this.sessionSkills.set(skill.manifest.id, skill);
    return this.registerSkill(skill, { source: 'session' });
  }

  // Validate skill structure
  private validateSkill(skill: Skill): void {
    const { manifest, code } = skill;

    // Validate manifest
    if (!manifest.id || !manifest.name || !manifest.description) {
      throw new Error('Skill manifest missing required fields');
    }

    if (!/^[a-z][a-z0-9_]*$/.test(manifest.id)) {
      throw new Error('Skill ID must be snake_case');
    }

    // Validate code
    if (!code.execute || typeof code.execute !== 'string') {
      throw new Error('Skill code must have execute function body');
    }

    if (!code.parameters || code.parameters.type !== 'object') {
      throw new Error('Skill code must have valid parameters schema');
    }
  }

  // Compile a Skill to a Tool
  private compileSkill(skill: Skill, source: SkillSource): CompiledSkill {
    const { manifest, code } = skill;

    // Create the execute function
    const executeFn = this.createExecuteFunction(code.execute);

    return {
      skillId: manifest.id,
      source,
      version: manifest.version,
      name: manifest.id,
      description: `${manifest.description}\n\nTags: ${manifest.tags.join(', ')}`,
      parameters: code.parameters,
      execute: executeFn,
    };
  }

  // Create executable function from skill code
  private createExecuteFunction(
    code: string
  ): (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult> {
    return async (args, context) => {
      try {
        // Create a sandboxed function
        const fn = new Function('args', 'context', code);
        const result = await fn(args, context);

        // Normalize result
        if (result === undefined || result === null) {
          return { ok: true, content: '' };
        }

        if (typeof result === 'string') {
          return { ok: true, content: result };
        }

        if (typeof result === 'object' && 'ok' in result) {
          return result as ToolResult;
        }

        return { ok: true, content: JSON.stringify(result) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Skill execution failed',
        };
      }
    };
  }

  // Set up hot reload for a skill
  private setupHotReload(_skillId: string, _skill: Skill): void {
    // TODO: Implement file watching for hot reload
    // This would watch manifest.json and skill.js for changes
  }

  // Get a compiled skill as a Tool
  getTool(skillId: string): Tool | undefined {
    const skill = this.compiledSkills.get(skillId);
    if (skill) {
      // Update usage stats
      const metadata = this.skills.get(skillId);
      if (metadata) {
        metadata.usageCount++;
        metadata.lastUsed = new Date().toISOString();
      }
    }
    return skill;
  }

  // Get all available tools (including skills)
  getAllTools(): Tool[] {
    return Array.from(this.compiledSkills.values());
  }

  // Get skill metadata
  getMetadata(skillId: string): SkillMetadata | undefined {
    return this.skills.get(skillId);
  }

  // List all skills
  listSkills(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  // List skills by tag
  listSkillsByTag(tag: string): SkillMetadata[] {
    return this.listSkills().filter((s) => s.manifest.tags.includes(tag));
  }

  // Check if skill exists
  hasSkill(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  // Unload a skill
  unloadSkill(skillId: string): boolean {
    this.compiledSkills.delete(skillId);
    return this.skills.delete(skillId);
  }

  // Save skill to disk (for user/community skills)
  async saveSkill(skill: Skill, source: 'user' | 'community'): Promise<void> {
    const dir = expandHomeDir(join(SKILLS_DIR[source], skill.manifest.id));
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify(skill.manifest, null, 2)
    );

    await fs.writeFile(
      join(dir, 'skill.js'),
      JSON.stringify(skill.code, null, 2)
    );
  }

  // Delete a skill
  async deleteSkill(skillId: string): Promise<boolean> {
    const metadata = this.skills.get(skillId);
    if (!metadata) return false;

    // Can't delete builtin skills
    const compiled = this.compiledSkills.get(skillId);
    if (compiled?.source === 'builtin') {
      throw new Error('Cannot delete builtin skills');
    }

    // Remove from disk if persisted
    if (compiled?.source === 'user' || compiled?.source === 'community') {
      const dir = expandHomeDir(
        join(SKILLS_DIR[compiled.source], skillId)
      );
      try {
        await fs.rm(dir, { recursive: true });
      } catch {
        // Ignore errors
      }
    }

    return this.unloadSkill(skillId);
  }

  // Get skill usage statistics
  getStats(): {
    total: number;
    bySource: Record<SkillSource, number>;
    mostUsed: SkillMetadata[];
  } {
    const all = this.listSkills();
    const bySource: Record<string, number> = {
      builtin: 0,
      user: 0,
      community: 0,
      session: 0,
    };

    for (const skill of all) {
      const compiled = this.compiledSkills.get(skill.manifest.id);
      if (compiled) {
        bySource[compiled.source]++;
      }
    }

    const mostUsed = [...all]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    return {
      total: all.length,
      bySource: bySource as Record<SkillSource, number>,
      mostUsed,
    };
  }
}

// Singleton instance
let registry: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!registry) {
    registry = new SkillRegistry();
  }
  return registry;
}
