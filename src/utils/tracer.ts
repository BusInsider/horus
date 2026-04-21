// Session tracer - structured observability for Horus
// Writes JSON lines to ~/.horus/traces/{session-id}.jsonl

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type TraceEventType =
  | 'session_start'
  | 'session_end'
  | 'api_call'
  | 'api_response'
  | 'tool_call'
  | 'tool_result'
  | 'mode_switch'
  | 'checkpoint'
  | 'error'
  | 'plan'
  | 'token_usage';

export interface TraceEvent {
  timestamp: string;
  sessionId: string;
  type: TraceEventType;
  data: Record<string, any>;
}

export interface SessionTrace {
  sessionId: string;
  startTime: string;
  endTime?: string;
  cwd: string;
  mode: string;
  model: string;
  events: TraceEvent[];
}

export class Tracer {
  private sessionId: string;
  private traceDir: string;
  private traceFile: string;
  private enabled: boolean;
  private eventCount: number = 0;

  constructor(sessionId: string, enabled: boolean = true) {
    this.sessionId = sessionId;
    this.enabled = enabled;
    this.traceDir = join(homedir(), '.horus', 'traces');
    this.traceFile = join(this.traceDir, `${sessionId}.jsonl`);

    if (this.enabled) {
      this.ensureDirectory();
    }
  }

  private ensureDirectory(): void {
    if (!existsSync(this.traceDir)) {
      mkdirSync(this.traceDir, { recursive: true });
    }
  }

  private write(event: TraceEvent): void {
    if (!this.enabled) return;
    try {
      appendFileSync(this.traceFile, JSON.stringify(event) + '\n');
      this.eventCount++;
    } catch {
      // Silent fail - tracing should never break the agent
    }
  }

  recordSessionStart(cwd: string, mode: string, model: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'session_start',
      data: { cwd, mode, model },
    });
  }

  recordSessionEnd(elapsedMs: number, iterations: number): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'session_end',
      data: { elapsedMs, iterations, totalEvents: this.eventCount },
    });
  }

  recordApiCall(messages: number, tools: number, temperature: number, model?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'api_call',
      data: { messages, tools, temperature, model },
    });
  }

  recordApiResponse(content: string, reasoningContent?: string, toolCalls?: number): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'api_response',
      data: {
        contentLength: content.length,
        reasoningLength: reasoningContent?.length || 0,
        toolCalls: toolCalls || 0,
      },
    });
  }

  recordToolCall(name: string, args: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'tool_call',
      data: { name, args },
    });
  }

  recordToolResult(name: string, result: string, durationMs: number, error?: boolean): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'tool_result',
      data: { name, resultLength: result.length, durationMs, error: error || false },
    });
  }

  recordModeSwitch(from: string, to: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'mode_switch',
      data: { from, to },
    });
  }

  recordCheckpoint(name: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'checkpoint',
      data: { name },
    });
  }

  recordError(error: string, context?: string): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'error',
      data: { error, context },
    });
  }

  recordPlan(steps: string[]): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'plan',
      data: { stepCount: steps.length, steps },
    });
  }

  recordTokenUsage(promptTokens: number, completionTokens: number): void {
    this.write({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: 'token_usage',
      data: { promptTokens, completionTokens, total: promptTokens + completionTokens },
    });
  }
}

// Trace viewer for human-readable output
export class TraceViewer {
  private traceDir: string;

  constructor() {
    this.traceDir = join(homedir(), '.horus', 'traces');
  }

  listTraces(): Array<{ id: string; date: Date; events: number }> {
    if (!existsSync(this.traceDir)) return [];

    const files = readdirSync(this.traceDir).filter(f => f.endsWith('.jsonl'));
    return files.map(f => {
      const id = f.replace('.jsonl', '');
      const content = readFileSync(join(this.traceDir, f), 'utf-8').trim();
      const lines = content ? content.split('\n') : [];
      const firstEvent = lines[0] ? JSON.parse(lines[0]) : null;
      return {
        id,
        date: firstEvent ? new Date(firstEvent.timestamp) : new Date(0),
        events: lines.length,
      };
    }).sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  viewTrace(sessionId: string): string {
    const filePath = join(this.traceDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) {
      return `Trace not found: ${sessionId}`;
    }

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return 'Empty trace';

    const lines = content.split('\n');
    const events = lines.map(l => JSON.parse(l) as TraceEvent);

    let output = '';
    output += `╔${'═'.repeat(68)}╗\n`;
    output += `║${' '.repeat(20)}SESSION TRACE${' '.repeat(35)}║\n`;
    output += `╠${'═'.repeat(68)}╣\n`;

    let sessionEnd: TraceEvent | null = null;
    let toolCalls = 0;
    let apiCalls = 0;
    let errors = 0;
    let totalTokens = 0;

    for (const event of events) {
      switch (event.type) {
        case 'session_start':
          output += `║ 🚀 Session Start: ${new Date(event.timestamp).toLocaleString().padEnd(45)}║\n`;
          output += `║    CWD: ${(event.data.cwd || 'unknown').toString().slice(0, 55).padEnd(55)}║\n`;
          output += `║    Mode: ${(event.data.mode || 'unknown').toString().padEnd(53)}║\n`;
          output += `║    Model: ${(event.data.model || 'unknown').toString().padEnd(52)}║\n`;
          break;
        case 'session_end':
          sessionEnd = event;
          break;
        case 'api_call':
          apiCalls++;
          output += `║ 🤖 API Call  | msgs: ${String(event.data.messages).padStart(2)} | tools: ${String(event.data.tools).padStart(2)} | temp: ${String(event.data.temperature).padEnd(23)}║\n`;
          break;
        case 'tool_call':
          toolCalls++;
          output += `║ 🔧 Tool Call | ${(event.data.name || '?').toString().padEnd(52)}║\n`;
          break;
        case 'tool_result':
          const status = event.data.error ? '❌' : '✅';
          output += `║    ${status} Result | ${String(event.data.durationMs).padStart(4)}ms | len: ${String(event.data.resultLength).padStart(5).padEnd(39)}║\n`;
          break;
        case 'error':
          errors++;
          output += `║ ❌ ERROR: ${(event.data.error || 'Unknown').toString().slice(0, 56).padEnd(56)}║\n`;
          break;
        case 'token_usage':
          totalTokens += event.data.total || 0;
          output += `║ 📊 Tokens: ${String(event.data.promptTokens).padStart(6)} in / ${String(event.data.completionTokens).padStart(6)} out${' '.repeat(29)}║\n`;
          break;
        case 'mode_switch':
          output += `║ 🔄 Mode: ${event.data.from} → ${event.data.to}${' '.repeat(44)}║\n`;
          break;
        case 'checkpoint':
          output += `║ 💾 Checkpoint: ${(event.data.name || '?').toString().slice(0, 50).padEnd(50)}║\n`;
          break;
        case 'plan':
          output += `║ 📋 Plan: ${String(event.data.stepCount).padStart(2)} steps${' '.repeat(49)}║\n`;
          break;
      }
    }

    if (sessionEnd) {
      const elapsed = sessionEnd.data.elapsedMs;
      const mins = Math.floor(elapsed / 60000);
      const secs = ((elapsed % 60000) / 1000).toFixed(1);
      output += `╠${'═'.repeat(68)}╣\n`;
      output += `║ ⏱️  ${mins}m ${secs}s | ${String(apiCalls).padStart(2)} API | ${String(toolCalls).padStart(2)} tools | ${String(errors).padStart(1)} errs | ${String(totalTokens).padStart(5)} tok${' '.repeat(12)}║\n`;
    }
    output += `╚${'═'.repeat(68)}╝\n`;

    return output;
  }

  viewTraceRaw(sessionId: string): TraceEvent[] {
    const filePath = join(this.traceDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];

    return content.split('\n').map(l => JSON.parse(l));
  }
}
