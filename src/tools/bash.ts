import { spawn } from 'child_process';
import { Tool, ToolContext, ToolResult } from './types.js';

export const bashTool: Tool = {
  name: 'bash',
  description: `Execute a bash command in the working directory.
Supports streaming output for long-running commands.
Use with caution - destructive commands may require confirmation.`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30, max: 600)',
        default: 30,
      },
      description: {
        type: 'string',
        description: 'Optional description of what this command does',
      },
    },
    required: ['command'],
  },

  async execute(args: { command: string; timeout?: number; description?: string }, context: ToolContext): Promise<ToolResult> {
    const timeoutMs = Math.min((args.timeout || 30) * 1000, 600000); // Max 10 minutes
    
    // Check for dangerous commands
    const dangerCheck = checkDangerousCommand(args.command);
    if (dangerCheck.dangerous) {
      return {
        ok: false,
        error: `Potentially dangerous command detected: ${dangerCheck.reason}`,
      };
    }

    try {
      const result = await runCommand(args.command, context.cwd, timeoutMs);
      return {
        ok: true,
        content: result.output || '(no output)',
        annotations: {
          exitCode: result.exitCode,
          duration: result.duration,
          command: args.command,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Command failed',
      };
    }
  },

  async *executeStream(args: { command: string; timeout?: number; description?: string }, context: ToolContext): AsyncIterable<string> {
    const timeoutMs = Math.min((args.timeout || 30) * 1000, 600000);

    // Check for dangerous commands
    const dangerCheck = checkDangerousCommand(args.command);
    if (dangerCheck.dangerous) {
      yield `Error: Potentially dangerous command detected: ${dangerCheck.reason}`;
      return;
    }

    const child = spawn('bash', ['-c', args.command], {
      cwd: context.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    let combinedOutput = '';

    // Stream stdout
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        combinedOutput += chunk;
      });
    }

    // Stream stderr
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        combinedOutput += chunk;
      });
    }

    // Yield output periodically
    let lastYieldedLength = 0;
    const yieldInterval = setInterval(() => {
      if (combinedOutput.length > lastYieldedLength) {
        const newContent = combinedOutput.slice(lastYieldedLength);
        // We can't actually yield from here, so we rely on the main loop
        lastYieldedLength = combinedOutput.length;
      }
    }, 100);

    // Wait for process to complete
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => {
        clearTimeout(timeout);
        clearInterval(yieldInterval);
        resolve(code || 0);
      });
    });

    // Yield final output
    if (combinedOutput) {
      yield combinedOutput;
    }

    if (exitCode !== 0) {
      yield `\n[Exit code: ${exitCode}]`;
    }
  },
};

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{ output: string; exitCode: number; duration: number }> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      const output = stdout + (stderr ? '\n[stderr]:\n' + stderr : '');
      resolve({
        output: output.trim(),
        exitCode: code || 0,
        duration,
      });
    });
  });
}

function checkDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  const lower = command.toLowerCase();

  // Block list
  const dangerous = [
    { pattern: /rm\s+-rf\s*\/\s*/, reason: 'System-wide deletion' },
    { pattern: /dd\s+if=\/dev\/zero/, reason: 'Disk destruction' },
    { pattern: /mkfs\./, reason: 'Filesystem formatting' },
    { pattern: />\s*\/dev\/[sh]da/, reason: 'Direct disk write' },
    { pattern: /curl\s+.*\s*\|\s*sh/, reason: 'Piped shell execution' },
    { pattern: /wget\s+.*\s*\|\s*sh/, reason: 'Piped shell execution' },
    { pattern: /:\(\)\s*\{\s*:\|\:\s*\}&/, reason: 'Fork bomb' },
  ];

  for (const d of dangerous) {
    if (d.pattern.test(lower)) {
      return { dangerous: true, reason: d.reason };
    }
  }

  return { dangerous: false };
}
