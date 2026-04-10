// Tool exports
// Leveraging Kimi's 128 tool limit - we can register many specialized tools

// Core file operations
export { viewTool } from './view.js';
export { editTool } from './edit.js';
export { catTool, lsTool, mkdirTool, rmTool } from './fileops.js';

// Search and discovery
export { searchTool } from './search.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';

// Command execution
export { bashTool } from './bash.js';

// Git operations
export { gitStatusTool, gitDiffTool, gitLogTool } from './git.js';

// Data processing
export { fetchTool } from './fetch.js';
export { jsonParseTool, jsonFormatTool } from './json.js';
export { mathTool } from './math.js';

// Memory
export { createRecallTool, createRememberTool, createIndexWorkspaceTool } from './memory.js';

// Skill management
export {
  createSkillListTool,
  createSkillCreateTool,
  createSkillViewTool,
  createSkillDeleteTool,
  createSkillEvolveTool,
  createSkillStatsTool,
} from './skill.js';

// Types and utilities
export { createToolDefinition, Tool, ToolContext, ToolResult } from './types.js';
export { ToolOrchestrator, ToolClassification, ToolCall as InternalToolCall } from './orchestrator.js';

// Tool batching
export { ToolBatcher, BatchedCall, Batch, BatchResult, getToolBatcher } from './batcher.js';
