// Progress indicators for long-running operations

import { Logger } from '../utils/logger.js';

export interface ProgressOptions {
  total?: number;
  title: string;
  showPercent?: boolean;
  showETA?: boolean;
}

export class ProgressBar {
  private options: ProgressOptions;
  private current = 0;
  private startTime: number;

  constructor(options: ProgressOptions, _logger?: Logger) {
    this.options = {
      showPercent: true,
      showETA: true,
      ...options,
    };
    this.startTime = Date.now();
  }

  update(current: number, message?: string): void {
    this.current = current;
    this.render(message);
  }

  increment(amount = 1, message?: string): void {
    this.current += amount;
    this.render(message);
  }

  complete(message?: string): void {
    if (this.options.total) {
      this.current = this.options.total;
    }
    this.render(message || 'Complete');
    process.stdout.write('\n');
  }

  private render(message?: string): void {
    const percent = this.options.total
      ? Math.min(100, Math.round((this.current / this.options.total) * 100))
      : 0;

    const width = 30;
    const filled = this.options.total
      ? Math.round((this.current / this.options.total) * width)
      : Math.min(width, Math.floor(this.current / 10));
    const empty = width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    let line = `${this.options.title}: [${bar}]`;

    if (this.options.showPercent && this.options.total) {
      line += ` ${percent}%`;
    }

    if (this.options.showETA && this.options.total && percent > 0) {
      const elapsed = Date.now() - this.startTime;
      const eta = Math.round((elapsed / percent) * (100 - percent));
      line += ` ETA: ${this.formatTime(eta)}`;
    }

    if (message) {
      line += ` | ${message}`;
    }

    // Clear line and rewrite
    process.stdout.write(`\r${line.padEnd(80)}`);
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Spinner for indeterminate progress
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frame = 0;
  private interval?: NodeJS.Timeout;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.frames[this.frame]} ${this.text}`);
      this.frame = (this.frame + 1) % this.frames.length;
    }, 80);
  }

  update(text: string): void {
    this.text = text;
  }

  stop(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      process.stdout.write(`\r${message || ''}`.padEnd(80) + '\n');
    }
  }
}

// Multi-step progress
export class MultiStepProgress {
  private steps: string[];
  private currentStep = 0;
  private completed: Set<number> = new Set();

  constructor(steps: string[]) {
    this.steps = steps;
  }

  startStep(index: number): void {
    this.currentStep = index;
    this.render();
  }

  completeStep(index: number): void {
    this.completed.add(index);
    this.render();
  }

  render(): void {
    console.clear();
    console.log('');

    this.steps.forEach((step, index) => {
      const isCompleted = this.completed.has(index);
      const isCurrent = index === this.currentStep;

      if (isCompleted) {
        console.log(`  ✅ ${step}`);
      } else if (isCurrent) {
        console.log(`  ▶️  ${step}`);
      } else {
        console.log(`  ⏳ ${step}`);
      }
    });

    console.log('');
  }

  complete(): void {
    this.steps.forEach((_, index) => this.completed.add(index));
    this.render();
  }
}

// Usage helpers
export function withProgress<T>(
  options: ProgressOptions,
  fn: (progress: ProgressBar) => Promise<T>
): Promise<T> {
  const progress = new ProgressBar(options);
  return fn(progress).finally(() => progress.complete());
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = new Spinner(text);
  spinner.start();
  try {
    const result = await fn();
    spinner.stop('✅ ' + text);
    return result;
  } catch (error) {
    spinner.stop('❌ ' + text);
    throw error;
  }
}
