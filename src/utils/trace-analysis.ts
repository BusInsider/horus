// Trace analysis - session summarization and comparison

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { TraceEvent } from './tracer.js';

// Pricing per 1M tokens (input / output) in USD
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'kimi-k2-5': { input: 2.00, output: 8.00 },
  'kimi-k2-6': { input: 2.00, output: 8.00 },
  'kimi-k2-6-preview': { input: 2.00, output: 8.00 },
  'kimi-latest': { input: 2.00, output: 8.00 },
  'kimi-for-coding': { input: 2.00, output: 8.00 },
  'kimi-k2-turbo-preview': { input: 1.15, output: 8.00 },
  'default': { input: 2.00, output: 8.00 },
};

export interface SessionSummary {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  durationMs: number;
  cwd: string;
  mode: string;
  model: string;
  iterations: number;
  apiCalls: number;
  toolCalls: number;
  errors: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  toolDistribution: Record<string, number>;
  errorEvents: Array<{ context?: string; error: string; timestamp: string }>;
  checkpoints: string[];
  modeSwitches: Array<{ from: string; to: string; timestamp: string }>;
}

export interface AggregateStats {
  totalSessions: number;
  totalDurationMs: number;
  totalApiCalls: number;
  totalToolCalls: number;
  totalErrors: number;
  totalTokens: number;
  totalEstimatedCost: number;
  avgDurationMs: number;
  avgApiCalls: number;
  avgToolCalls: number;
  avgTokens: number;
  errorRate: number;
  topTools: Array<{ name: string; count: number }>;
  sessionSummaries: SessionSummary[];
}

function getTraceDir(): string {
  return join(homedir(), '.horus', 'traces');
}

function loadTrace(sessionId: string): TraceEvent[] {
  const filePath = join(getTraceDir(), `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(l => JSON.parse(l));
}

function listTraceFiles(): string[] {
  const traceDir = getTraceDir();
  if (!existsSync(traceDir)) return [];
  return readdirSync(traceDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''));
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  return ((promptTokens / 1_000_000) * pricing.input) + ((completionTokens / 1_000_000) * pricing.output);
}

export function analyzeSession(sessionId: string): SessionSummary | null {
  const events = loadTrace(sessionId);
  if (events.length === 0) return null;

  const sessionStart = events.find(e => e.type === 'session_start');
  const sessionEnd = events.find(e => e.type === 'session_end');

  let apiCalls = 0;
  let toolCalls = 0;
  let errors = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  const toolDistribution: Record<string, number> = {};
  const errorEvents: Array<{ context?: string; error: string; timestamp: string }> = [];
  const checkpoints: string[] = [];
  const modeSwitches: Array<{ from: string; to: string; timestamp: string }> = [];

  for (const event of events) {
    switch (event.type) {
      case 'api_call':
        apiCalls++;
        break;
      case 'tool_call':
        toolCalls++;
        toolDistribution[event.data.name] = (toolDistribution[event.data.name] || 0) + 1;
        break;
      case 'error':
        errors++;
        errorEvents.push({
          context: event.data.context,
          error: event.data.error,
          timestamp: event.timestamp,
        });
        break;
      case 'token_usage':
        promptTokens += event.data.promptTokens || 0;
        completionTokens += event.data.completionTokens || 0;
        totalTokens += event.data.total || 0;
        break;
      case 'checkpoint':
        checkpoints.push(event.data.name);
        break;
      case 'mode_switch':
        modeSwitches.push({
          from: event.data.from,
          to: event.data.to,
          timestamp: event.timestamp,
        });
        break;
    }
  }

  const startTime = sessionStart ? new Date(sessionStart.timestamp) : new Date(events[0].timestamp);
  const endTime = sessionEnd ? new Date(sessionEnd.timestamp) : undefined;
  const durationMs = sessionEnd ? sessionEnd.data.elapsedMs : 0;

  const model = sessionStart?.data.model || 'default';
  const estimatedCost = estimateCost(model, promptTokens, completionTokens);

  return {
    sessionId,
    startTime,
    endTime,
    durationMs,
    cwd: sessionStart?.data.cwd || 'unknown',
    mode: sessionStart?.data.mode || 'unknown',
    model,
    iterations: sessionEnd?.data.iterations || 0,
    apiCalls,
    toolCalls,
    errors,
    totalTokens,
    promptTokens,
    completionTokens,
    estimatedCost,
    toolDistribution,
    errorEvents,
    checkpoints,
    modeSwitches,
  };
}

export function aggregateStats(sessionIds?: string[]): AggregateStats | null {
  const ids = sessionIds || listTraceFiles();
  if (ids.length === 0) return null;

  const summaries = ids.map(id => analyzeSession(id)).filter((s): s is SessionSummary => s !== null);
  if (summaries.length === 0) return null;

  const totalDurationMs = summaries.reduce((sum, s) => sum + s.durationMs, 0);
  const totalApiCalls = summaries.reduce((sum, s) => sum + s.apiCalls, 0);
  const totalToolCalls = summaries.reduce((sum, s) => sum + s.toolCalls, 0);
  const totalErrors = summaries.reduce((sum, s) => sum + s.errors, 0);
  const totalTokens = summaries.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalEstimatedCost = summaries.reduce((sum, s) => sum + s.estimatedCost, 0);

  const allToolCounts: Record<string, number> = {};
  for (const s of summaries) {
    for (const [name, count] of Object.entries(s.toolDistribution)) {
      allToolCounts[name] = (allToolCounts[name] || 0) + count;
    }
  }

  const topTools = Object.entries(allToolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalActions = totalApiCalls + totalToolCalls;

  return {
    totalSessions: summaries.length,
    totalDurationMs,
    totalApiCalls,
    totalToolCalls,
    totalErrors,
    totalTokens,
    totalEstimatedCost,
    avgDurationMs: Math.round(totalDurationMs / summaries.length),
    avgApiCalls: Math.round(totalApiCalls / summaries.length),
    avgToolCalls: Math.round(totalToolCalls / summaries.length),
    avgTokens: Math.round(totalTokens / summaries.length),
    errorRate: totalActions > 0 ? totalErrors / totalActions : 0,
    topTools,
    sessionSummaries: summaries,
  };
}

export function compareSessions(id1: string, id2: string): { left: SessionSummary; right: SessionSummary; deltas: Record<string, number> } | null {
  const left = analyzeSession(id1);
  const right = analyzeSession(id2);
  if (!left || !right) return null;

  const deltas: Record<string, number> = {
    durationMs: right.durationMs - left.durationMs,
    apiCalls: right.apiCalls - left.apiCalls,
    toolCalls: right.toolCalls - left.toolCalls,
    errors: right.errors - left.errors,
    totalTokens: right.totalTokens - left.totalTokens,
    estimatedCost: right.estimatedCost - left.estimatedCost,
    iterations: right.iterations - left.iterations,
  };

  return { left, right, deltas };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs.padStart(2, '0')}s`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `< $0.01`;
  return `$${usd.toFixed(3)}`;
}
