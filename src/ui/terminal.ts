import * as readline from 'readline';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { ToolCall } from '../kimi.js';
import { RecalledMemory } from '../memory/manager.js';

// Configure marked for terminal output
marked.use(markedTerminal() as any);

export type Verbosity = 'quiet' | 'normal' | 'verbose';

export class TerminalUI {
  // @ts-expect-error Used for tracking streaming state, will be used for UI indicators
  private isStreaming = false;
  private verbosity: Verbosity;

  constructor(verbosity: Verbosity = 'normal') {
    this.verbosity = verbosity;
  }

  setVerbosity(level: Verbosity): void {
    this.verbosity = level;
  }

  getVerbosity(): Verbosity {
    return this.verbosity;
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION DISPLAY
  // ═══════════════════════════════════════════════════════════

  showSessionStart(sessionId: string, cwd: string): void {
    if (this.verbosity === 'quiet') {
      // In quiet mode, show nothing at start
      return;
    }

    console.log(chalk.blue(`\n┌─ Horus Session Started ─┐`));
    console.log(chalk.gray(`│ Session: ${sessionId.slice(0, 8)}`));
    console.log(chalk.gray(`│ Working: ${cwd}`));
    console.log(chalk.blue(`└─────────────────────────┘`));
    console.log(chalk.gray('\nCommands: /mode, /checkpoint, /rollback, /plan, /agent, /memory, /restart, exit'));
    console.log(chalk.gray('Tools always available - use /mode to adjust speed/cost\n'));
  }

  showSessionEnd(): void {
    if (this.verbosity === 'quiet') return;
    console.log(chalk.blue('\n[Session ended]\n'));
  }

  // ═══════════════════════════════════════════════════════════
  // INDEXING DISPLAY
  // ═══════════════════════════════════════════════════════════

  showIndexingStart(): void {
    if (this.verbosity === 'quiet') return;
    process.stdout.write(chalk.gray('[Indexing...] '));
  }

  showIndexingComplete(files: number, _chunks: number): void {
    if (this.verbosity === 'quiet') return;
    console.log(chalk.gray(`${files} files indexed`));
  }

  // ═══════════════════════════════════════════════════════════
  // MEMORY DISPLAY
  // ═══════════════════════════════════════════════════════════

  showRecallStart(): void {
    if (this.verbosity === 'quiet') return;
    process.stdout.write(chalk.gray('[Recalling memories...] '));
  }

  showRecalledMemories(memories: RecalledMemory[]): void {
    if (this.verbosity === 'quiet') return;

    if (memories.length === 0) {
      console.log(chalk.gray('none found'));
      return;
    }

    const byType = new Map<string, number>();
    for (const m of memories) {
      byType.set(m.type, (byType.get(m.type) || 0) + 1);
    }

    const parts: string[] = [];
    for (const [type, count] of byType) {
      parts.push(`${count} ${type}`);
    }

    console.log(chalk.gray(parts.join(', ')));

    // Show details in verbose mode
    if (this.verbosity === 'verbose' && memories.length > 0) {
      for (const mem of memories.slice(0, 3)) {
        const preview = mem.content.split('\n')[0].slice(0, 60);
        console.log(chalk.dim(`  • ${preview}${preview.length >= 60 ? '...' : ''}`));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // API CALL DISPLAY
  // ═══════════════════════════════════════════════════════════

  showApiStart(messageCount: number): void {
    if (this.verbosity === 'quiet') return;
    if (this.verbosity === 'verbose') {
      process.stdout.write(chalk.gray(`[Calling API with ${messageCount} messages...]\n`));
    }
  }

  showApiComplete(): void {
    // No-op - handled inline
  }

  // ═══════════════════════════════════════════════════════════
  // STREAMING OUTPUT
  // ═══════════════════════════════════════════════════════════

  write(text: string): void {
    process.stdout.write(text);
    this.isStreaming = true;
  }

  writeThinking(text: string): void {
    // Display reasoning content in dim gray
    if (this.verbosity === 'verbose') {
      process.stdout.write(chalk.gray(text));
    }
  }

  writeLine(line: string): void {
    console.log(line);
  }

  // ═══════════════════════════════════════════════════════════
  // TOOL DISPLAY
  // ═══════════════════════════════════════════════════════════

  showToolCall(toolCall: ToolCall): void {
    const name = toolCall.function.name;
    
    // Quiet mode: minimal tool indication
    if (this.verbosity === 'quiet') {
      process.stdout.write(chalk.cyan(`[${name}] `));
      return;
    }

    // Normal/Verbose mode
    const args = toolCall.function.arguments;
    
    // Parse args for display
    let displayArgs: string;
    try {
      const parsed = JSON.parse(args);
      // Show key params only for cleaner output
      const keyParams = ['path', 'command', 'query', 'pattern', 'fact'];
      const summary = Object.entries(parsed)
        .filter(([k]) => keyParams.some(p => k.toLowerCase().includes(p)))
        .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
        .join(', ');
      displayArgs = summary.length > 60 ? summary.slice(0, 60) + '...' : summary;
    } catch {
      displayArgs = args.slice(0, 60);
    }

    if (displayArgs) {
      console.log(chalk.cyan(`\n[${name}: ${displayArgs}]`));
    } else {
      console.log(chalk.cyan(`\n[${name}]`));
    }
  }

  showToolExecuting(_name: string): void {
    // Already shown in showToolCall
  }

  showToolResult(_name: string, result: string): void {
    if (this.verbosity === 'quiet') return;
    
    // Result is already streamed or shown inline
    const lines = result.split('\n');
    
    // In normal mode, show just first few lines
    if (this.verbosity === 'normal') {
      const previewLines = lines.slice(0, 5);
      let output = previewLines.join('\n');
      
      if (lines.length > 5 || output.length > 200) {
        output = output.slice(0, 200);
        if (!output.endsWith('...')) output += '...';
      }
      
      if (output.length > 0) {
        console.log(chalk.gray(output));
      }
    } else if (this.verbosity === 'verbose') {
      // Verbose mode: show more
      if (lines.length > 0 && result.length > 0) {
        const output = lines.slice(0, 20).join('\n');
        if (output.length > 500) {
          console.log(chalk.gray(output.slice(0, 500) + '...'));
        } else {
          console.log(chalk.gray(output));
        }
      }
    }
  }

  showToolSuccess(name: string): void {
    if (this.verbosity === 'quiet') {
      process.stdout.write(chalk.green('✓ '));
    } else if (this.verbosity === 'normal') {
      console.log(chalk.green(`[${name} ✓]`));
    }
  }

  showToolError(name: string, error: string): void {
    if (this.verbosity === 'quiet') {
      console.log(chalk.red(`[${name} ✗]`));
    } else {
      console.log(chalk.red(`[${name} ✗: ${error.slice(0, 100)}]`));
    }
  }

  writeToolOutput(chunk: string): void {
    if (this.verbosity === 'quiet') return;
    process.stdout.write(chunk);
  }

  // ═══════════════════════════════════════════════════════════
  // ERROR DISPLAY
  // ═══════════════════════════════════════════════════════════

  error(message: string): void {
    console.error(chalk.red(`\nError: ${message}\n`));
  }

  warning(message: string): void {
    console.log(chalk.yellow(`Warning: ${message}`));
  }

  warn(message: string): void {
    this.warning(message);
  }

  // ═══════════════════════════════════════════════════════════
  // INPUT
  // ═══════════════════════════════════════════════════════════

  async prompt(message: string): Promise<string> {
    return new Promise((resolve) => {
      // Use terminal: false to prevent double echo
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      
      // Write the prompt manually
      process.stdout.write(message + ' ');
      
      let input = '';
      
      rl.on('line', (line) => {
        input = line;
        rl.close();
      });
      
      rl.on('close', () => {
        resolve(input);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════

  clearLine(): void {
    process.stdout.write('\r\x1b[K');
  }

  close(): void {
    // Nothing to close - readlines are created per-prompt and closed immediately
  }
}

// Simple spinner for async operations
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval?: NodeJS.Timeout;
  private frame = 0;

  start(text: string): void {
    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.frames[this.frame]} ${text}`);
      this.frame = (this.frame + 1) % this.frames.length;
    }, 80);
  }

  stop(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      process.stdout.write('\r\x1b[K'); // Clear line
      if (message) {
        console.log(message);
      }
    }
  }
}
