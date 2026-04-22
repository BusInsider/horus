// Trace export - JSON, CSV, Markdown formats

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { TraceEvent } from './tracer.js';
import { analyzeSession, aggregateStats, type SessionSummary } from './trace-analysis.js';

export type ExportFormat = 'json' | 'csv' | 'markdown';

const traceDir = join(homedir(), '.horus', 'traces');

function loadEvents(sessionId: string): TraceEvent[] {
  const filePath = join(traceDir, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(l => JSON.parse(l));
}

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function escapeCSV(value: any): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function exportTrace(sessionId: string, format: ExportFormat): string {
  const summary = analyzeSession(sessionId);
  const events = loadEvents(sessionId);

  if (!summary || events.length === 0) {
    throw new Error(`Trace not found: ${sessionId}`);
  }

  switch (format) {
    case 'json':
      return exportJSON(sessionId, summary, events);
    case 'csv':
      return exportCSV(sessionId, summary, events);
    case 'markdown':
      return exportMarkdown(sessionId, summary, events);
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

function exportJSON(sessionId: string, summary: SessionSummary, events: TraceEvent[]): string {
  const data = {
    sessionId,
    summary: {
      startTime: summary.startTime.toISOString(),
      endTime: summary.endTime?.toISOString(),
      duration: formatDuration(summary.durationMs),
      durationMs: summary.durationMs,
      cwd: summary.cwd,
      mode: summary.mode,
      model: summary.model,
      iterations: summary.iterations,
      apiCalls: summary.apiCalls,
      toolCalls: summary.toolCalls,
      errors: summary.errors,
      totalTokens: summary.totalTokens,
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      estimatedCost: summary.estimatedCost,
      toolDistribution: summary.toolDistribution,
      checkpoints: summary.checkpoints,
    },
    errors: summary.errorEvents,
    modeSwitches: summary.modeSwitches,
    events,
  };
  return JSON.stringify(data, null, 2);
}

function exportCSV(_sessionId: string, summary: SessionSummary, events: TraceEvent[]): string {
  const lines: string[] = [];
  lines.push('timestamp,sessionId,type,toolName,error,resultLength,promptTokens,completionTokens,totalTokens,data');

  for (const event of events) {
    const d = event.data;
    lines.push([
      event.timestamp,
      event.sessionId,
      event.type,
      d.name || d.tool || '',
      d.error ? String(d.error).slice(0, 200) : '',
      d.resultLength || '',
      d.promptTokens || '',
      d.completionTokens || '',
      d.total || '',
      JSON.stringify(d).slice(0, 500),
    ].map(escapeCSV).join(','));
  }

  // Summary rows
  lines.push('');
  lines.push('metric,value');
  lines.push(`durationMs,${summary.durationMs}`);
  lines.push(`apiCalls,${summary.apiCalls}`);
  lines.push(`toolCalls,${summary.toolCalls}`);
  lines.push(`errors,${summary.errors}`);
  lines.push(`totalTokens,${summary.totalTokens}`);
  lines.push(`estimatedCost,${summary.estimatedCost.toFixed(4)}`);
  for (const [tool, count] of Object.entries(summary.toolDistribution)) {
    lines.push(`tool_${tool},${count}`);
  }

  return lines.join('\n');
}

function exportMarkdown(sessionId: string, summary: SessionSummary, events: TraceEvent[]): string {
  const lines: string[] = [];

  lines.push(`# Session Trace Report`);
  lines.push('');
  lines.push(`**Session ID:** \`${sessionId}\``);
  lines.push(`**Date:** ${summary.startTime.toLocaleString()}`);
  lines.push(`**Duration:** ${formatDuration(summary.durationMs)}`);
  lines.push(`**Working Directory:** \`${summary.cwd}\``);
  lines.push(`**Mode:** ${summary.mode}`);
  lines.push(`**Model:** ${summary.model}`);
  lines.push('');

  // Stats table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Iterations | ${summary.iterations} |`);
  lines.push(`| API Calls | ${summary.apiCalls} |`);
  lines.push(`| Tool Calls | ${summary.toolCalls} |`);
  lines.push(`| Errors | ${summary.errors} |`);
  lines.push(`| Total Tokens | ${summary.totalTokens.toLocaleString()} |`);
  lines.push(`| Prompt Tokens | ${summary.promptTokens.toLocaleString()} |`);
  lines.push(`| Completion Tokens | ${summary.completionTokens.toLocaleString()} |`);
  lines.push(`| Estimated Cost | $${summary.estimatedCost.toFixed(4)} |`);
  lines.push('');

  // Tool distribution
  if (Object.keys(summary.toolDistribution).length > 0) {
    lines.push('## Tool Usage');
    lines.push('');
    lines.push('| Tool | Calls |');
    lines.push('|---|---|');
    for (const [tool, count] of Object.entries(summary.toolDistribution).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${tool} | ${count} |`);
    }
    lines.push('');
  }

  // Errors
  if (summary.errorEvents.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const err of summary.errorEvents) {
      lines.push(`- **${err.timestamp}**: ${err.error}${err.context ? ` (${err.context})` : ''}`);
    }
    lines.push('');
  }

  // Checkpoints
  if (summary.checkpoints.length > 0) {
    lines.push('## Checkpoints');
    lines.push('');
    for (const cp of summary.checkpoints) {
      lines.push(`- ${cp}`);
    }
    lines.push('');
  }

  // Timeline
  lines.push('## Timeline');
  lines.push('');
  lines.push('| Time | Type | Details |');
  lines.push('|---|---|---|');
  for (const event of events) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    let details = '';
    switch (event.type) {
      case 'api_call':
        details = `${event.data.messages} msgs, ${event.data.tools} tools`;
        break;
      case 'tool_call':
        details = event.data.name || event.data.tool || '?';
        break;
      case 'tool_result':
        details = event.data.error ? `Error: ${event.data.error}` : `Success (${event.data.durationMs}ms)`;
        break;
      case 'error':
        details = event.data.error || 'Unknown';
        break;
      case 'token_usage':
        details = `${event.data.promptTokens} in / ${event.data.completionTokens} out`;
        break;
      case 'checkpoint':
        details = event.data.name || '?';
        break;
      case 'plan':
        details = `${event.data.stepCount} steps`;
        break;
      case 'mode_switch':
        details = `${event.data.from} → ${event.data.to}`;
        break;
      default:
        details = JSON.stringify(event.data).slice(0, 80);
    }
    lines.push(`| ${time} | ${event.type} | ${details.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export function exportCostSummary(): string {
  const stats = aggregateStats();
  if (!stats || stats.totalSessions === 0) {
    return 'No traces found.';
  }

  const lines: string[] = [];
  lines.push('# Cost Summary Report');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Total Sessions | ${stats.totalSessions} |`);
  lines.push(`| Total Duration | ${formatDuration(stats.totalDurationMs)} |`);
  lines.push(`| Total API Calls | ${stats.totalApiCalls.toLocaleString()} |`);
  lines.push(`| Total Tool Calls | ${stats.totalToolCalls.toLocaleString()} |`);
  lines.push(`| Total Errors | ${stats.totalErrors} |`);
  lines.push(`| Total Tokens | ${stats.totalTokens.toLocaleString()} |`);
  lines.push(`| Total Estimated Cost | $${stats.totalEstimatedCost.toFixed(4)} |`);
  lines.push(`| Avg Duration | ${formatDuration(stats.avgDurationMs)} |`);
  lines.push(`| Avg Tokens | ${Math.round(stats.avgTokens).toLocaleString()} |`);
  lines.push(`| Error Rate | ${(stats.errorRate * 100).toFixed(1)}% |`);
  lines.push('');

  if (stats.topTools.length > 0) {
    lines.push('## Top Tools');
    lines.push('');
    lines.push('| Tool | Calls | % |');
    lines.push('|---|---|---|');
    for (const t of stats.topTools.slice(0, 10)) {
      const pct = stats.totalToolCalls > 0 ? ((t.count / stats.totalToolCalls) * 100).toFixed(1) : '0';
      lines.push(`| ${t.name} | ${t.count} | ${pct}% |`);
    }
    lines.push('');
  }

  lines.push('## Per-Session Breakdown');
  lines.push('');
  lines.push('| Session | Date | Duration | Tokens | Cost | Tools | Errors |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of stats.sessionSummaries) {
    const date = s.startTime.toLocaleDateString();
    lines.push(`| \`${s.sessionId.slice(0, 8)}\` | ${date} | ${formatDuration(s.durationMs)} | ${s.totalTokens.toLocaleString()} | $${s.estimatedCost.toFixed(4)} | ${s.toolCalls} | ${s.errors} |`);
  }
  lines.push('');

  return lines.join('\n');
}
