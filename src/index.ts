// Main exports for Horus

export { KimiClient, Message, ToolDefinition, ToolCall } from './kimi.js';
export { MemoryManager, MemoryManagerConfig, RecalledMemory } from './memory/manager.js';
export { EnhancedAgent as Agent, EnhancedAgentConfig as AgentConfig } from './agent-enhanced.js';
export { TerminalUI } from './ui/terminal.js';
export { loadConfig, Config } from './config.js';
export * from './tools/index.js';

// Phase 2: Advanced features
export { HibernationManager, AgentState, getHibernationManager } from './hibernation.js';
export * from './swarm/index.js';
