// Skill management tools - Allow AI to create and manage skills dynamically

import { Tool, ToolContext, ToolResult } from './types.js';
import { CompiledSkill } from '../skills/types.js';
import { getSkillRegistry } from '../skills/registry.js';
import { SkillGenerator } from '../skills/generator.js';
import { KimiClient } from '../kimi.js';

// Tool: List all available skills
export const createSkillListTool = (): Tool => ({
  name: 'skill_list',
  description: `List all available skills (custom tools) in the system.
Shows built-in, user-created, and community skills with usage stats.
Use this to discover what capabilities are available before creating new skills.`,
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['all', 'builtin', 'user', 'community', 'session'],
        description: 'Filter by skill source',
        default: 'all',
      },
      tag: {
        type: 'string',
        description: 'Filter by tag (optional)',
      },
    },
  },

  async execute(args: { filter?: string; tag?: string }, _context: ToolContext): Promise<ToolResult> {
    const registry = getSkillRegistry();
    let skills = registry.listSkills();

    // Apply filters
    if (args.filter && args.filter !== 'all') {
      skills = skills.filter((s) => {
        const compiled = registry.getTool(s.manifest.id) as CompiledSkill | undefined;
        return compiled?.source === args.filter;
      });
    }

    if (args.tag) {
      skills = skills.filter((s) => s.manifest.tags.includes(args.tag!));
    }

    // Format output
    const lines = skills.map((s) => {
      const tool = registry.getTool(s.manifest.id) as CompiledSkill | undefined;
      return `- ${s.manifest.id} (${tool?.source}): ${s.manifest.description}`;
    });

    return {
      ok: true,
      content: lines.join('\n') || 'No skills found',
      annotations: {
        count: skills.length,
        skills: skills.map((s) => ({
          id: s.manifest.id,
          name: s.manifest.name,
          version: s.manifest.version,
          tags: s.manifest.tags,
          usageCount: s.usageCount,
        })),
      },
    };
  },
});

// Tool: Create a new skill
export const createSkillCreateTool = (kimi: KimiClient): Tool => ({
  name: 'skill_create',
  description: `Create a new skill (custom tool) using AI code generation.
Describe what you want the skill to do in natural language, and the AI will generate:
1. The skill manifest (metadata)
2. The parameter schema
3. The JavaScript implementation

The skill will be registered immediately and available for use.
Example: "Create a skill that fetches weather data from OpenWeatherMap API given a city name"`,
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Natural language description of what the skill should do',
      },
      save: {
        type: 'boolean',
        description: 'Whether to save this skill permanently (default: true)',
        default: true,
      },
      safeMode: {
        type: 'boolean',
        description: 'Enable extra safety validation (default: true)',
        default: true,
      },
      examples: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional example inputs/outputs',
      },
    },
    required: ['description'],
  },

  async execute(
    args: {
      description: string;
      save?: boolean;
      safeMode?: boolean;
      examples?: string[];
    },
    _context: ToolContext
  ): Promise<ToolResult> {
    const generator = new SkillGenerator(kimi);
    const registry = getSkillRegistry();

    try {
      const result = await generator.generate({
        description: args.description,
        examples: args.examples,
        constraints: {
          safeMode: args.safeMode !== false,
        },
      });

      if (!result.success || !result.skill) {
        return {
          ok: false,
          error: result.error || 'Failed to generate skill',
        };
      }

      const { skill } = result;

      // Register the skill
      if (args.save !== false) {
        await registry.saveSkill(skill, 'user');
        await registry.loadSkillFromPath(
          `${process.env.HOME}/.horus/skills/user/${skill.manifest.id}`,
          { source: 'user', validate: true }
        );
      } else {
        // Session-only skill
        registry.registerSessionSkill(skill);
      }

      return {
        ok: true,
        content: `Created skill "${skill.manifest.name}" (${skill.manifest.id})\n\n${skill.manifest.description}\n\nTags: ${skill.manifest.tags.join(', ')}\n\nExplanation: ${result.explanation}`,
        annotations: {
          skillId: skill.manifest.id,
          name: skill.manifest.name,
          version: skill.manifest.version,
          parameters: skill.code.parameters,
          saved: args.save !== false,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to create skill',
      };
    }
  },
});

// Tool: View skill details
export const createSkillViewTool = (): Tool => ({
  name: 'skill_view',
  description: `View the details of a specific skill including its code, parameters, and usage stats.
Use this to understand how a skill works before using or modifying it.`,
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'The skill ID (snake_case)',
      },
      showCode: {
        type: 'boolean',
        description: 'Whether to show the implementation code',
        default: false,
      },
    },
    required: ['skillId'],
  },

  async execute(
    args: { skillId: string; showCode?: boolean },
    _context: ToolContext
  ): Promise<ToolResult> {
    const registry = getSkillRegistry();
    const metadata = registry.getMetadata(args.skillId);
    const tool = registry.getTool(args.skillId);

    if (!metadata || !tool) {
      return {
        ok: false,
        error: `Skill "${args.skillId}" not found`,
      };
    }

    const lines = [
      `Skill: ${metadata.manifest.name} (${metadata.manifest.id})`,
      `Version: ${metadata.manifest.version}`,
      `Source: ${(tool as CompiledSkill).source}`,
      `Description: ${metadata.manifest.description}`,
      `Tags: ${metadata.manifest.tags.join(', ')}`,
      `Author: ${metadata.manifest.author}`,
      `Created: ${metadata.manifest.createdAt}`,
      `Usage Count: ${metadata.usageCount}`,
      `Last Used: ${metadata.lastUsed || 'Never'}`,
      '',
      'Parameters:',
      JSON.stringify(tool.parameters, null, 2),
    ];

    if (args.showCode && 'execute' in tool) {
      lines.push('', 'Implementation:', '// See skill file in ~/.horus/skills/');
    }

    return {
      ok: true,
      content: lines.join('\n'),
    };
  },
});

// Tool: Delete a skill
export const createSkillDeleteTool = (): Tool => ({
  name: 'skill_delete',
  description: `Delete a user-created or session skill.
Cannot delete built-in skills. Use this to remove skills that are no longer needed.`,
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'The skill ID to delete',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm deletion',
        default: false,
      },
    },
    required: ['skillId'],
  },

  async execute(
    args: { skillId: string; confirm?: boolean },
    _context: ToolContext
  ): Promise<ToolResult> {
    if (!args.confirm) {
      return {
        ok: false,
        error: 'Set confirm: true to delete this skill',
      };
    }

    const registry = getSkillRegistry();

    try {
      const deleted = await registry.deleteSkill(args.skillId);
      if (deleted) {
        return {
          ok: true,
          content: `Skill "${args.skillId}" deleted successfully`,
        };
      } else {
        return {
          ok: false,
          error: `Skill "${args.skillId}" not found`,
        };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to delete skill',
      };
    }
  },
});

// Tool: Evolve/improve a skill
export const createSkillEvolveTool = (kimi: KimiClient): Tool => ({
  name: 'skill_evolve',
  description: `Improve an existing skill based on feedback.
The AI will analyze the current skill and your feedback, then generate an improved version
with a incremented version number. The original skill is preserved.`,
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'The skill ID to evolve',
      },
      feedback: {
        type: 'string',
        description: 'What needs to be improved (e.g., "handle errors better", "add timeout parameter")',
      },
    },
    required: ['skillId', 'feedback'],
  },

  async execute(
    args: { skillId: string; feedback: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    const registry = getSkillRegistry();
    const metadata = registry.getMetadata(args.skillId);

    if (!metadata) {
      return {
        ok: false,
        error: `Skill "${args.skillId}" not found`,
      };
    }

    // Load the full skill
    const skillPath = `${process.env.HOME}/.horus/skills/user/${args.skillId}`;
    let skill;
    try {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      const manifestContent = await fs.readFile(
        join(skillPath, 'manifest.json'),
        'utf-8'
      );
      const codeContent = await fs.readFile(join(skillPath, 'skill.js'), 'utf-8');
      skill = {
        manifest: JSON.parse(manifestContent),
        code: JSON.parse(codeContent),
      };
    } catch {
      return {
        ok: false,
        error: `Could not load skill "${args.skillId}" for evolution`,
      };
    }

    const generator = new SkillGenerator(kimi);
    const result = await generator.evolve(skill, args.feedback);

    if (!result.success || !result.skill) {
      return {
        ok: false,
        error: result.error || 'Failed to evolve skill',
      };
    }

    // Save the evolved version
    await registry.saveSkill(result.skill, 'user');
    await registry.loadSkillFromPath(
      `${process.env.HOME}/.horus/skills/user/${result.skill.manifest.id}`,
      { source: 'user', validate: true }
    );

    return {
      ok: true,
      content: `Evolved "${args.skillId}" to version ${result.skill.manifest.version}\n\n${result.explanation}`,
      annotations: {
        newVersion: result.skill.manifest.version,
        skillId: result.skill.manifest.id,
      },
    };
  },
});

// Tool: Get skill usage stats
export const createSkillStatsTool = (): Tool => ({
  name: 'skill_stats',
  description: `Get statistics about skill usage in the system.
Shows total skills, breakdown by source, and most frequently used skills.`,
  parameters: {
    type: 'object',
    properties: {},
  },

  async execute(_args: {}, _context: ToolContext): Promise<ToolResult> {
    const registry = getSkillRegistry();
    const stats = registry.getStats();

    const lines = [
      'Skill Statistics',
      '================',
      `Total Skills: ${stats.total}`,
      '',
      'By Source:',
      `  Built-in: ${stats.bySource.builtin}`,
      `  User: ${stats.bySource.user}`,
      `  Community: ${stats.bySource.community}`,
      `  Session: ${stats.bySource.session}`,
      '',
      'Most Used:',
      ...stats.mostUsed.slice(0, 5).map((s, i) => {
        return `  ${i + 1}. ${s.manifest.name} (${s.usageCount} uses)`;
      }),
    ];

    return {
      ok: true,
      content: lines.join('\n'),
      annotations: stats,
    };
  },
});
