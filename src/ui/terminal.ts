import { ReadLine, createInterface } from 'readline';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { ToolCall } from '../kimi.js';
import { RecalledMemory } from '../memory/manager.js';

// Configure marked for terminal output
marked.use(markedTerminal() as any);

export class TerminalUI {
  private rl?: ReadLine;
  private isStreaming: boolean = false;

  constructor() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION DISPLAY
  // ═══════════════════════════════════════════════════════════

  showSessionStart(sessionId: string, cwd: string): void {
    console.log(chalk.blue(`\n┌─ Horus Session Started ─┐`));
    console.log(chalk.gray(`│ Session: ${sessionId.slice(0, 8)}`));
    console.log(chalk.gray(`│ Working: ${cwd}`));
    console.log(chalk.blue(`└─────────────────────────┘\n`));
  }

  showSessionEnd(): void {
    console.log(chalk.blue('\n[Session ended]\n'));
  }

  // ═══════════════════════════════════════════════════════════
  // INDEXING DISPLAY
  // ═══════════════════════════════════════════════════════════

  showIndexingStart(): void {
    process.stdout.write(chalk.gray('[Indexing workspace...] '));
  }

  showIndexingComplete(files: number, chunks: number): void {
    console.log(chalk.gray(`${files} files, ${chunks} chunks indexed`));
  }

  // ═══════════════════════════════════════════════════════════
  // MEMORY DISPLAY
  // ═══════════════════════════════════════════════════════════

  showRecallStart(): void {
    process.stdout.write(chalk.gray('[Recalling memories...] '));
  }

  showRecalledMemories(memories: RecalledMemory[]): void {
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

    // Show details if interesting
    if (memories.length > 0) {
      for (const mem of memories.slice(0, 3)) {
        const preview = mem.content.split('\n')[0].slice(0, 60);
        console.log(chalk.dim(`  • ${preview}${preview.length >= 60 ? '...' : ''}`));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STREAMING OUTPUT
  // ═══════════════════════════════════════════════════════════

  write(text: string): void {
    process.stdout.write(text);
    this.isStreaming = true;
  }

  writeLine(line: string): void {
    console.log(line);
  }

  // ═══════════════════════════════════════════════════════════
  // TOOL DISPLAY
  // ═══════════════════════════════════════════════════════════

  showToolCall(toolCall: ToolCall): void {
    const name = toolCall.function.name;
    const args = toolCall.function.arguments;
    
    // Parse args for display
    let displayArgs: string;
    try {
      const parsed = JSON.parse(args);
      const summary = Object.entries(parsed)
        .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
        .join(', ');
      displayArgs = summary.length > 60 ? summary.slice(0, 60) + '...' : summary;
    } catch {
      displayArgs = args.slice(0, 60);
    }

    console.log(chalk.cyan(`\n[${name}: ${displayArgs}]`));
  }

  showToolExecuting(name: string): void {
    // Already shown in showToolCall
  }

  showToolResult(name: string, result: string): void {
    // Result is already streamed or shown inline
    const lines = result.split('\n').slice(0, 20);
    if (lines.length > 0 && result.length > 0) {
      const output = lines.join('\n');
      if (output.length > 500) {
        console.log(chalk.gray(output.slice(0, 500) + '...'));
      } else {
        console.log(chalk.gray(output));
      }
    }
  }

  showToolError(name: string, error: string): void {
    console.log(chalk.red(`[Error in ${name}: ${error.slice(0, 100)}]`));
  }

  writeToolOutput(chunk: string): void {
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
      if (!this.rl) {
        resolve('');
        return;
      }
      this.rl.question(chalk.green(message + ' '), (answer) => {
        resolve(answer);
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
    this.rl?.close();
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
