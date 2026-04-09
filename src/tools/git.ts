// Git tools - Git operations
import { spawn } from 'child_process';
import { Tool, ToolContext, ToolResult } from './types.js';

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
      });
    });
  });
}

export const gitStatusTool: Tool = {
  name: 'git_status',
  description: 'Check git repository status - shows modified, staged, and untracked files',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(_args: {}, context: ToolContext): Promise<ToolResult> {
    const result = await runGit(['status', '--short'], context.cwd);
    
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: result.stderr || 'Not a git repository',
      };
    }

    return {
      ok: true,
      content: result.stdout || 'Working tree clean',
    };
  },
};

export const gitDiffTool: Tool = {
  name: 'git_diff',
  description: 'Show git diff of uncommitted changes',
  parameters: {
    type: 'object',
    properties: {
      staged: {
        type: 'boolean',
        description: 'Show staged changes instead of unstaged',
        default: false,
      },
    },
    required: [],
  },

  async execute(args: { staged?: boolean }, context: ToolContext): Promise<ToolResult> {
    const gitArgs = args.staged ? ['diff', '--staged'] : ['diff'];
    const result = await runGit(gitArgs, context.cwd);
    
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: result.stderr || 'Git diff failed',
      };
    }

    const content = result.stdout || 'No changes';
    return {
      ok: true,
      content: content.length > 8000 ? content.slice(0, 8000) + '\n... (truncated)' : content,
    };
  },
};

export const gitLogTool: Tool = {
  name: 'git_log',
  description: 'Show recent git commit history',
  parameters: {
    type: 'object',
    properties: {
      n: {
        type: 'number',
        description: 'Number of commits to show',
        default: 10,
      },
    },
    required: [],
  },

  async execute(args: { n?: number }, context: ToolContext): Promise<ToolResult> {
    const result = await runGit(['log', '--oneline', '-n', String(args.n || 10)], context.cwd);
    
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: result.stderr || 'Git log failed',
      };
    }

    return {
      ok: true,
      content: result.stdout || 'No commits',
    };
  },
};
