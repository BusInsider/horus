import { promises as fs } from 'fs';
import { isAbsolute, join, dirname } from 'path';
import DiffMatchPatch from 'diff-match-patch';
import { Tool, ToolContext, ToolResult } from './types.js';

const dmp = new DiffMatchPatch();

export const editTool: Tool = {
  name: 'edit',
  description: `Edit a file by replacing text. Uses diff-based matching for reliability.
IMPORTANT: The oldString must match the file content exactly (or very closely).
For new files, use oldString: "" (empty string).`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit (absolute or relative to working directory)',
      },
      oldString: {
        type: 'string',
        description: 'The existing text to replace. Use empty string for new files.',
      },
      newString: {
        type: 'string',
        description: 'The new text to insert in place of oldString',
      },
    },
    required: ['path', 'oldString', 'newString'],
  },

  async execute(args: { path: string; oldString: string; newString: string }, context: ToolContext): Promise<ToolResult> {
    const targetPath = isAbsolute(args.path) ? args.path : join(context.cwd, args.path);

    try {
      // Check if file exists
      let content: string;
      let isNewFile = false;

      try {
        content = await fs.readFile(targetPath, 'utf-8');
      } catch (error) {
        // File doesn't exist
        if (args.oldString === '') {
          // Creating new file
          isNewFile = true;
          content = '';
        } else {
          return {
            ok: false,
            error: `File not found: ${targetPath}. To create a new file, set oldString to ""`,
          };
        }
      }

      // Try exact match first
      if (content.includes(args.oldString)) {
        const newContent = content.replace(args.oldString, args.newString);
        await writeFileAtomic(targetPath, newContent);

        const linesChanged = countLinesChanged(args.oldString, args.newString);
        return {
          ok: true,
          content: isNewFile
            ? `Created file: ${targetPath}`
            : `Edited ${targetPath} (${linesChanged})`,
          annotations: {
            path: targetPath,
            isNewFile,
            linesChanged,
          },
        };
      }

      // Try fuzzy match with diff-match-patch
      if (args.oldString.length > 10) {
        const patches = dmp.patch_make(args.oldString, args.newString);
        const [patchedContent, results] = dmp.patch_apply(patches, content);

        // Check if patch applied successfully
        if (results.every(r => r)) {
          await writeFileAtomic(targetPath, patchedContent);
          const linesChanged = countLinesChanged(args.oldString, args.newString);
          return {
            ok: true,
            content: `Edited ${targetPath} with fuzzy match (${linesChanged})`,
            annotations: {
              path: targetPath,
              isNewFile,
              linesChanged,
              fuzzyMatch: true,
            },
          };
        }
      }

      // No match found
      // Find similar lines to help debug
      const similarLines = findSimilarLines(content, args.oldString);
      let errorMsg = `Could not find exact match in ${targetPath}`;
      if (similarLines.length > 0) {
        errorMsg += `\n\nDid you mean:\n${similarLines.join('\n')}`;
      }

      return {
        ok: false,
        error: errorMsg,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

async function writeFileAtomic(targetPath: string, content: string): Promise<void> {
  // Ensure directory exists
  await fs.mkdir(dirname(targetPath), { recursive: true });

  // Write to temp file then rename for atomicity
  const tempPath = targetPath + '.tmp';
  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, targetPath);
}

function countLinesChanged(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n').length;
  const newLines = newStr.split('\n').length;

  if (oldLines === newLines) {
    return `${oldLines} line${oldLines === 1 ? '' : 's'} modified`;
  }
  if (oldLines === 0 || oldStr === '') {
    return `${newLines} line${newLines === 1 ? '' : 's'} added`;
  }
  if (newLines === 0 || newStr === '') {
    return `${oldLines} line${oldLines === 1 ? '' : 's'} removed`;
  }

  const diff = newLines - oldLines;
  if (diff > 0) {
    return `${oldLines} modified, ${diff} added`;
  }
  return `${newLines} modified, ${-diff} removed`;
}

function findSimilarLines(content: string, target: string): string[] {
  const lines = content.split('\n');
  const targetLines = target.split('\n');
  const matches: Array<{ line: string; score: number }> = [];

  // Look for similar individual lines
  for (const line of lines.slice(0, 100)) { // Limit search
    for (const targetLine of targetLines.slice(0, 5)) {
      if (targetLine.length < 10) continue;
      const score = similarity(line, targetLine);
      if (score > 0.7) {
        matches.push({ line: line.trim(), score });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3).map(m => `  ${m.line}`);
}

function similarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  const costs: number[] = [];
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (shorter[i - 1] !== longer[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[longer.length] = lastValue;
  }

  return (longer.length - costs[longer.length]) / longer.length;
}
