// 256K Context Loader - Load entire codebase into context for small projects
// Kimi's 256K context window allows us to skip RAG for many projects

import { promises as fs } from 'fs';
import { join, relative, extname } from 'path';

export interface ContextFile {
  path: string;
  content: string;
  language?: string;
  size: number;
}

export interface LoadContextOptions {
  rootPath: string;
  maxTokens?: number;  // Default: 200000 (reserve 56K for output)
  includePatterns?: string[];
  excludePatterns?: string[];
}

const TOKEN_ESTIMATE_CHARS = 4; // Rough estimate: 4 chars = 1 token

const CODE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sql': 'sql',
  '.sh': 'bash',
};

const DEFAULT_INCLUDE = [
  '**/*.{ts,tsx,js,jsx,py,rs,go,java,rb,php,c,cpp,h,hpp,cs,swift,kt,scala,md,json,yaml,yml,toml,html,css,scss,sql,sh}',
];

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/coverage/**',
  '**/.env*',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/Cargo.lock',
  '**/*.min.js',
  '**/*.min.css',
];

export class ContextLoader {
  private rootPath: string;
  private maxTokens: number;
  private includePatterns: string[];
  private excludePatterns: string[];

  constructor(options: LoadContextOptions) {
    this.rootPath = options.rootPath;
    this.maxTokens = options.maxTokens || 200_000;
    this.includePatterns = options.includePatterns || DEFAULT_INCLUDE;
    this.excludePatterns = options.excludePatterns || DEFAULT_EXCLUDE;
  }

  async loadContext(): Promise<{ files: ContextFile[]; totalTokens: number; truncated: boolean }> {
    const glob = await import('fast-glob');
    const filePaths = await glob.default(this.includePatterns, {
      cwd: this.rootPath,
      ignore: this.excludePatterns,
      absolute: true,
    });

    const files: ContextFile[] = [];
    let totalTokens = 0;
    let truncated = false;

    // Sort by importance (smaller files first, config files prioritized)
    const sortedPaths = this.prioritizeFiles(filePaths);

    for (const filePath of sortedPaths) {
      try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) continue;

        // Skip files that would exceed budget
        const estimatedTokens = Math.ceil(stats.size / TOKEN_ESTIMATE_CHARS);
        if (totalTokens + estimatedTokens > this.maxTokens) {
          truncated = true;
          break;
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const ext = extname(filePath);
        
        files.push({
          path: relative(this.rootPath, filePath),
          content,
          language: CODE_EXTENSIONS[ext],
          size: stats.size,
        });

        totalTokens += Math.ceil(content.length / TOKEN_ESTIMATE_CHARS);
      } catch {
        // Skip unreadable files
      }
    }

    return { files, totalTokens, truncated };
  }

  private prioritizeFiles(paths: string[]): string[] {
    const priorityOrder = [
      /README/i,
      /package\.json/,
      /tsconfig/,
      /\.config\./,
      /Cargo\.toml/,
      /pyproject\.toml/,
      /setup\.py/,
      /Gemfile/,
      /go\.mod/,
    ];

    return paths.sort((a, b) => {
      // Config files first
      const aPriority = priorityOrder.findIndex(p => p.test(a));
      const bPriority = priorityOrder.findIndex(p => p.test(b));
      
      if (aPriority !== -1 && bPriority === -1) return -1;
      if (bPriority !== -1 && aPriority === -1) return 1;
      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      
      // Then smaller files
      return a.length - b.length;
    });
  }

  formatForContext(files: ContextFile[]): string {
    const parts: string[] = [];
    parts.push('# Codebase Context');
    parts.push('');
    parts.push(`Loaded ${files.length} files`);
    parts.push('');

    for (const file of files) {
      const lang = file.language || '';
      parts.push(`## File: ${file.path}${lang ? ` (${lang})` : ''}`);
      parts.push('');
      parts.push('```' + lang);
      parts.push(file.content);
      parts.push('```');
      parts.push('');
    }

    return parts.join('\n');
  }

  shouldUseFullContext(estimatedTokens: number): boolean {
    // Use full context if it fits comfortably within budget
    return estimatedTokens < this.maxTokens * 0.8;
  }
}

// Helper to estimate if a project fits in context
export async function estimateProjectSize(rootPath: string): Promise<{
  fileCount: number;
  totalBytes: number;
  estimatedTokens: number;
  fitsInContext: boolean;
}> {
  const glob = await import('fast-glob');
  const files = await glob.default(DEFAULT_INCLUDE, {
    cwd: rootPath,
    ignore: DEFAULT_EXCLUDE,
  });

  let totalBytes = 0;
  for (const file of files.slice(0, 1000)) { // Sample first 1000
    try {
      const stats = await fs.stat(join(rootPath, file));
      totalBytes += stats.size;
    } catch {
      // Ignore
    }
  }

  const estimatedTokens = Math.ceil(totalBytes / TOKEN_ESTIMATE_CHARS);
  
  return {
    fileCount: files.length,
    totalBytes,
    estimatedTokens,
    fitsInContext: estimatedTokens < 200_000,
  };
}
