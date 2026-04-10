// Skill System - Type definitions for dynamic tools
// Skills are AI-generatable, versioned, and hot-reloadable tools

import { Tool } from '../tools/types.js';

export interface SkillManifest {
  id: string;                    // Unique identifier (e.g., "csv_parser", "api_client")
  name: string;                  // Display name
  description: string;           // What this skill does
  version: string;               // Semver
  author: string;                // Creator (user, ai, or community)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  tags: string[];                // Categories for search/discovery
  dependencies?: string[];       // Other skill IDs required
  permissions: SkillPermission[]; // Required capabilities
}

export interface SkillPermission {
  type: 'filesystem' | 'network' | 'command' | 'env';
  scope: string;                 // e.g., "read", "write", "~/.config"
  description: string;
}

export interface SkillCode {
  // The skill implementation
  execute: string;               // JavaScript function body as string
  // Schema for parameter validation
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      default?: unknown;
    }>;
    required?: string[];
  };
}

export interface Skill {
  manifest: SkillManifest;
  code: SkillCode;
}

export interface SkillMetadata {
  manifest: SkillManifest;
  // Runtime info
  loaded: boolean;
  loadTime?: number;
  error?: string;
  usageCount: number;
  lastUsed?: string;
}

// Skill sources
export type SkillSource = 'builtin' | 'user' | 'community' | 'session';

export interface SkillLoadOptions {
  source: SkillSource;
  hotReload?: boolean;           // Watch for changes
  validate?: boolean;            // Validate before loading
}

// Skill generation request
export interface SkillGenerationRequest {
  description: string;           // Natural language description of what to build
  examples?: string[];           // Example inputs/outputs
  constraints?: {
    noNetwork?: boolean;         // Don't allow network access
    noFilesystem?: boolean;      // Don't allow file operations
    safeMode?: boolean;          // Extra validation
  };
}

// Skill generation result
export interface SkillGenerationResult {
  success: boolean;
  skill?: Skill;
  error?: string;
  explanation?: string;          // AI explanation of the generated code
  testCases?: {                  // Auto-generated test cases
    input: Record<string, unknown>;
    expectedOutput: unknown;
  }[];
}

// Compiled skill (ready to use as Tool)
export interface CompiledSkill extends Tool {
  skillId: string;
  source: SkillSource;
  version: string;
}

// Skill evolution tracking
export interface SkillEvolution {
  skillId: string;
  generations: SkillGeneration[];
}

export interface SkillGeneration {
  version: string;
  prompt: string;
  createdAt: string;
  parentVersion?: string;        // For branching/evolution
  performance?: {                // Runtime metrics
    successRate: number;
    avgExecutionTime: number;
  };
}

// Skill marketplace entry
export interface SkillMarketplaceEntry {
  manifest: SkillManifest;
  stats: {
    downloads: number;
    rating: number;
    reviews: number;
  };
  source: {
    type: 'git' | 'npm' | 'local';
    url: string;
  };
}
