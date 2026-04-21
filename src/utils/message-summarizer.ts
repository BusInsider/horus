// Message summarizer - heuristic extraction for deep history compaction
// No LLM calls - saves tokens and latency

import type { Message } from '../memory/schema.js';

export interface MessageSummary {
  decisions: string[];
  actions: string[];
  outcomes: string[];
  errors: string[];
}

const MAX_SUMMARY_LINE_LENGTH = 200;

export function summarizeMessages(messages: Message[]): string {
  const summary = extractSummary(messages);
  return formatSummary(summary);
}

export function extractSummary(messages: Message[]): MessageSummary {
  const decisions: string[] = [];
  const actions: string[] = [];
  const outcomes: string[] = [];
  const errors: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'assistant': {
        // Extract first sentence as decision/plan
        if (msg.content) {
          const firstSentence = extractFirstSentence(msg.content);
          if (firstSentence && firstSentence.length > 10) {
            decisions.push(truncate(firstSentence, MAX_SUMMARY_LINE_LENGTH));
          }
        }

        // Extract tool calls as actions
        if (msg.toolCalls) {
          try {
            const calls = JSON.parse(msg.toolCalls);
            for (const call of calls) {
              const name = call.function?.name || call.name || 'unknown';
              const args = call.function?.arguments || call.arguments || {};
              // Summarize args: keep only first key for brevity
              const argKeys = Object.keys(args);
              const argSummary = argKeys.length > 0
                ? `${argKeys[0]}=${truncate(String(args[argKeys[0]]), 60)}`
                : '';
              actions.push(`${name}(${argSummary})`);
            }
          } catch {
            // Invalid tool_calls JSON, skip
          }
        }

        // Extract reasoning content decisions
        if (msg.reasoningContent) {
          const firstLine = msg.reasoningContent.split('\n')[0].trim();
          if (firstLine.length > 10 && !decisions.includes(firstLine)) {
            decisions.push(truncate(firstLine, MAX_SUMMARY_LINE_LENGTH));
          }
        }
        break;
      }

      case 'tool': {
        if (msg.content) {
          // Check for error indicators
          const lower = msg.content.toLowerCase();
          if (lower.includes('error') || lower.includes('fail') || lower.includes('exception') || lower.includes('❌')) {
            const firstLine = msg.content.split('\n')[0].trim();
            errors.push(truncate(firstLine, MAX_SUMMARY_LINE_LENGTH));
          } else {
            // Keep first line as outcome
            const firstLine = msg.content.split('\n')[0].trim();
            if (firstLine.length > 0) {
              outcomes.push(truncate(firstLine, MAX_SUMMARY_LINE_LENGTH));
            }
          }
        }
        break;
      }

      case 'user': {
        // Extract user corrections or clarifications
        if (msg.content) {
          const lower = msg.content.toLowerCase();
          if (lower.includes('no,') || lower.includes('wrong') || lower.includes('incorrect') || lower.includes('fix')) {
            const firstSentence = extractFirstSentence(msg.content);
            if (firstSentence) {
              decisions.push(`[Correction] ${truncate(firstSentence, MAX_SUMMARY_LINE_LENGTH)}`);
            }
          }
        }
        break;
      }
    }
  }

  return { decisions, actions, outcomes, errors };
}

export function formatSummary(summary: MessageSummary): string {
  const lines: string[] = [];
  lines.push('=== CONVERSATION HISTORY (summarized) ===');

  if (summary.decisions.length > 0) {
    lines.push('\nKey decisions:');
    for (const d of dedupe(summary.decisions).slice(0, 8)) {
      lines.push(`  • ${d}`);
    }
  }

  if (summary.actions.length > 0) {
    lines.push('\nActions taken:');
    for (const a of dedupe(summary.actions).slice(0, 10)) {
      lines.push(`  • ${a}`);
    }
  }

  if (summary.outcomes.length > 0) {
    lines.push('\nOutcomes:');
    for (const o of dedupe(summary.outcomes).slice(0, 8)) {
      lines.push(`  • ${o}`);
    }
  }

  if (summary.errors.length > 0) {
    lines.push('\nErrors encountered:');
    for (const e of dedupe(summary.errors).slice(0, 5)) {
      lines.push(`  • ${e}`);
    }
  }

  lines.push('=== END SUMMARY ===');
  return lines.join('\n');
}

// Trim a message to fit within a token budget
export function trimMessage(msg: Message, maxTokens: number): Message {
  const maxChars = maxTokens * 4; // rough estimate
  if (!msg.content || msg.content.length <= maxChars) return msg;

  const trimmed = msg.content.slice(0, maxChars);
  // Try to end at a newline or sentence boundary
  const lastNewline = trimmed.lastIndexOf('\n');
  const lastSentence = trimmed.lastIndexOf('.');
  const cutPoint = Math.max(lastNewline, lastSentence);
  const finalContent = cutPoint > maxChars * 0.7 ? trimmed.slice(0, cutPoint + 1) : trimmed;

  return {
    ...msg,
    content: finalContent + '\n[...truncated]',
  };
}

// Trim tool results aggressively while preserving error info
export function trimToolResult(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;

  const lines = content.split('\n');
  const isError = content.toLowerCase().includes('error') || content.toLowerCase().includes('exception');

  if (isError) {
    // For errors, keep first 10 lines + last 5 lines
    const head = lines.slice(0, 10).join('\n');
    const tail = lines.slice(-5).join('\n');
    return head + '\n\n[...error truncated...]\n\n' + tail;
  }

  // For normal output, keep first N lines + last line
  const headLines = Math.floor(maxChars / 80); // assume ~80 chars per line
  const head = lines.slice(0, headLines).join('\n');
  return head + '\n[...output truncated: ' + lines.length + ' lines total...]';
}

// ─── Helpers ───

function extractFirstSentence(text: string): string {
  // Split on sentence boundaries, respecting abbreviations roughly
  const match = text.match(/^[^.!?]+[.!?]+/);
  return match ? match[0].trim() : text.split('\n')[0].trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
