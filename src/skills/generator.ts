// Skill Generator - Uses AI to create new skills dynamically

import { KimiClient } from '../kimi.js';
import {
  Skill,
  SkillGenerationRequest,
  SkillGenerationResult,
} from './types.js';

const SKILL_GENERATION_PROMPT = `You are a code generator for an AI agent's Skill System.
Your task is to create a JavaScript skill (tool) based on the user's description.

A skill consists of:
1. A manifest (metadata)
2. Code (parameter schema and execute function body)

The execute function body will be wrapped in an async function like this:
\`\`\`
async function execute(args, context) {
  // YOUR CODE HERE
}
\`\`\`

Available in the function scope:
- \`args\`: The parameters passed by the AI (validated against your schema)
- \`context\`: Tool context with { cwd, env, logger }
  - context.cwd: Current working directory
  - context.env: Environment variables
  - context.logger?: Optional logger

You can use standard JavaScript and these Node.js built-ins:
- fetch (global)
- Buffer, URL, URLSearchParams
- JSON, Math, Date, RegExp
- All standard JS functions

SECURITY RULES:
- Do NOT use eval() or new Function()
- Do NOT access process, require(), or fs directly
- All file operations should use args and return results
- Network requests are allowed but validate inputs

OUTPUT FORMAT - Respond with ONLY a JSON object:
\`\`\`json
{
  "manifest": {
    "id": "snake_case_name",
    "name": "Human Readable Name",
    "description": "What this skill does and when to use it",
    "version": "1.0.0",
    "author": "ai-generated",
    "createdAt": "2026-04-09T...",
    "updatedAt": "2026-04-09T...",
    "tags": ["category", "use-case"],
    "permissions": [
      {"type": "network", "scope": "api.example.com", "description": "Fetches data from API"}
    ]
  },
  "code": {
    "parameters": {
      "type": "object",
      "properties": {
        "paramName": {
          "type": "string",
          "description": "What this parameter does"
        }
      },
      "required": ["paramName"]
    },
    "execute": "// JavaScript code that uses args.paramName and returns result\\nconst result = args.paramName.toUpperCase();\\nreturn result;"
  },
  "explanation": "Why I wrote it this way and how to use it",
  "testCases": [
    {
      "input": {"paramName": "hello"},
      "expectedOutput": "HELLO"
    }
  ]
}
\`\`\`

The code in "execute" is a STRING containing JavaScript code. Escape newlines as \\n and quotes as \\".

Generate a skill for this request:`;

export class SkillGenerator {
  private kimi: KimiClient;

  constructor(kimi: KimiClient) {
    this.kimi = kimi;
  }

  async generate(request: SkillGenerationRequest): Promise<SkillGenerationResult> {
    try {
      // Build the prompt
      const prompt = this.buildPrompt(request);

      // Call Kimi API
      const response = await this.kimi.complete(
        [
          { role: 'system', content: SKILL_GENERATION_PROMPT },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 4000 }
      );

      // Parse the response
      const content = response.choices[0]?.message?.content || '';
      const generated = this.parseResponse(content);

      if (!generated) {
        return {
          success: false,
          error: 'Failed to parse generated skill from AI response',
        };
      }

      // Validate the generated skill
      const validationError = this.validateGeneratedSkill(generated);
      if (validationError) {
        return {
          success: false,
          error: `Generated skill validation failed: ${validationError}`,
        };
      }

      // Add timestamps
      const now = new Date().toISOString();
      generated.manifest.createdAt = now;
      generated.manifest.updatedAt = now;

      // Apply constraints
      if (request.constraints?.safeMode) {
        this.applySafetyConstraints(generated);
      }

      return {
        success: true,
        skill: {
          manifest: generated.manifest,
          code: generated.code,
        },
        explanation: generated.explanation,
        testCases: generated.testCases,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Generation failed',
      };
    }
  }

  private buildPrompt(request: SkillGenerationRequest): string {
    let prompt = request.description;

    if (request.examples && request.examples.length > 0) {
      prompt += '\n\nExamples:\n';
      for (const example of request.examples) {
        prompt += `- ${example}\n`;
      }
    }

    if (request.constraints) {
      prompt += '\n\nConstraints:\n';
      if (request.constraints.noNetwork) {
        prompt += '- No network access allowed\n';
      }
      if (request.constraints.noFilesystem) {
        prompt += '- No filesystem access allowed\n';
      }
      if (request.constraints.safeMode) {
        prompt += '- Extra safety validation required\n';
      }
    }

    return prompt;
  }

  private parseResponse(content: string): any {
    // Extract JSON from markdown code blocks or raw JSON
    let jsonStr = content;

    // Try to extract from markdown code block
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // Clean up any leading/trailing whitespace
    jsonStr = jsonStr.trim();

    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  private validateGeneratedSkill(generated: any): string | null {
    // Check manifest
    if (!generated.manifest) return 'Missing manifest';
    if (!generated.manifest.id) return 'Missing manifest.id';
    if (!generated.manifest.name) return 'Missing manifest.name';
    if (!generated.manifest.description) return 'Missing manifest.description';

    // Validate ID format (snake_case)
    if (!/^[a-z][a-z0-9_]*$/.test(generated.manifest.id)) {
      return 'Invalid manifest.id (must be snake_case)';
    }

    // Check code
    if (!generated.code) return 'Missing code';
    if (!generated.code.execute) return 'Missing code.execute';
    if (!generated.code.parameters) return 'Missing code.parameters';
    if (generated.code.parameters.type !== 'object') {
      return 'Invalid code.parameters (must be type: object)';
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/,
      /new\s+Function\s*\(/,
      /process\.exit/,
      /child_process/,
      /fs\s*\.\s*(writeFile|unlink|rmdir)/,
      /require\s*\(/,
    ];

    const code = generated.code.execute;
    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return `Code contains dangerous pattern: ${pattern}`;
      }
    }

    return null;
  }

  private applySafetyConstraints(skill: any): void {
    // Ensure safe defaults
    if (!skill.manifest.permissions) {
      skill.manifest.permissions = [];
    }

    // Add safe execution note
    skill.manifest.tags = skill.manifest.tags || [];
    if (!skill.manifest.tags.includes('safe-mode')) {
      skill.manifest.tags.push('safe-mode');
    }
  }

  // Generate an improved version of an existing skill
  async evolve(
    skill: Skill,
    feedback: string
  ): Promise<SkillGenerationResult> {
    const request: SkillGenerationRequest = {
      description: `Improve this skill based on feedback:\n\nCurrent skill: ${skill.manifest.name}\nDescription: ${skill.manifest.description}\n\nFeedback: ${feedback}\n\nCurrent code:\n${skill.code.execute}`,
      constraints: { safeMode: true },
    };

    const result = await this.generate(request);
    
    if (result.success && result.skill) {
      // Increment version
      const versionParts = skill.manifest.version.split('.').map(Number);
      versionParts[2] = (versionParts[2] || 0) + 1; // Patch increment
      result.skill.manifest.version = versionParts.join('.');
      
      // Preserve ID but note parent
      result.skill.manifest.id = skill.manifest.id;
      result.skill.manifest.author = `ai-generated (evolved from v${skill.manifest.version})`;
    }

    return result;
  }
}
