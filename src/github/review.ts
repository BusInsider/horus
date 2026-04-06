// GitHub Code Review - Automated PR review with AI assistance

import { GitHubClient, ReviewPROptions, PullRequestFile } from './client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ReviewSuggestion {
  path: string;
  line: number;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'style' | 'security' | 'performance' | 'maintainability' | 'bug';
}

export interface ReviewSummary {
  summary: string;
  suggestions: ReviewSuggestion[];
  approve: boolean;
  confidence: number; // 0-1
}

export interface FileReview {
  path: string;
  content: string;
  patch: string;
  language: string;
  suggestions: ReviewSuggestion[];
}

export interface ReviewOptions {
  prNumber: number;
  detailed?: boolean;
  focus?: ('security' | 'performance' | 'style' | 'maintainability')[];
  autoComment?: boolean; // Post comments to PR
}

// ============================================================================
// CODE REVIEW ENGINE
// ============================================================================

export class CodeReview {
  private client: GitHubClient;
  private cwd: string;

  constructor(client: GitHubClient, cwd: string = process.cwd()) {
    this.client = client;
    this.cwd = cwd;
  }

  // ========================================================================
  // MAIN REVIEW FLOW
  // ========================================================================

  async review(options: ReviewOptions): Promise<ReviewSummary> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    console.log(`Fetching PR #${options.prNumber}...`);
    const [pr, files] = await Promise.all([
      this.client.getPullRequest(repo.owner, repo.repo, options.prNumber),
      this.client.getPullRequestFiles(repo.owner, repo.repo, options.prNumber),
    ]);

    console.log(`Analyzing ${files.length} files...`);

    // Review each file
    const fileReviews: FileReview[] = [];
    for (const file of files) {
      if (this.shouldReviewFile(file.filename)) {
        const review = await this.reviewFile(file, options);
        fileReviews.push(review);
      }
    }

    // Compile overall summary
    const summary = this.compileReviewSummary(fileReviews, pr);

    // Post comments if requested
    if (options.autoComment && summary.suggestions.length > 0) {
      await this.postReviewComments(repo.owner, repo.repo, options.prNumber, summary);
    }

    return summary;
  }

  // ========================================================================
  // FILE REVIEW
  // ========================================================================

  private async reviewFile(file: PullRequestFile, options: ReviewOptions): Promise<FileReview> {
    const language = this.detectLanguage(file.filename);
    
    // Parse patch to find changed lines
    const changedLines = this.parsePatch(file.patch || '');
    
    // Generate suggestions (in production, would call Kimi)
    const suggestions = this.analyzeCode(file, changedLines, options);

    return {
      path: file.filename,
      content: '', // Could fetch full content if needed
      patch: file.patch || '',
      language,
      suggestions,
    };
  }

  private analyzeCode(
    file: PullRequestFile, 
    changedLines: Array<{ line: number; content: string }>,
    options: ReviewOptions
  ): ReviewSuggestion[] {
    const suggestions: ReviewSuggestion[] = [];
    const focus = options.focus || ['security', 'performance', 'maintainability'];

    // Simple pattern-based analysis (in production, use Kimi)
    for (const { line, content } of changedLines) {
      // Security checks
      if (focus.includes('security')) {
        if (content.match(/password\s*=\s*["']/i)) {
          suggestions.push({
            path: file.filename,
            line,
            body: '⚠️ **Security**: Hardcoded password detected. Use environment variables or a secrets manager.',
            severity: 'critical',
            category: 'security',
          });
        }
        if (content.match(/eval\s*\(/)) {
          suggestions.push({
            path: file.filename,
            line,
            body: '⚠️ **Security**: `eval()` can execute arbitrary code. Consider safer alternatives.',
            severity: 'critical',
            category: 'security',
          });
        }
      }

      // Performance checks
      if (focus.includes('performance')) {
        if (content.match(/\.map\s*\(.*\)\.filter\s*\(/)) {
          suggestions.push({
            path: file.filename,
            line,
            body: '💡 **Performance**: Consider combining map+filter into a single reduce to avoid extra iteration.',
            severity: 'info',
            category: 'performance',
          });
        }
      }

      // Style checks
      if (focus.includes('style')) {
        if (content.length > 120) {
          suggestions.push({
            path: file.filename,
            line,
            body: '📝 **Style**: Line exceeds 120 characters. Consider breaking into multiple lines.',
            severity: 'info',
            category: 'style',
          });
        }
        if (content.match(/console\.log/)) {
          suggestions.push({
            path: file.filename,
            line,
            body: '📝 **Style**: Remove debug console.log before merging.',
            severity: 'warning',
            category: 'style',
          });
        }
      }
    }

    return suggestions;
  }

  // ========================================================================
  // SUMMARY COMPILATION
  // ========================================================================

  private compileReviewSummary(fileReviews: FileReview[], pr: any): ReviewSummary {
    const allSuggestions = fileReviews.flatMap(f => f.suggestions);
    
    // Group by severity
    const critical = allSuggestions.filter(s => s.severity === 'critical');
    const warnings = allSuggestions.filter(s => s.severity === 'warning');
    const info = allSuggestions.filter(s => s.severity === 'info');

    // Generate summary text
    let summary = `## Code Review Summary\n\n`;
    summary += `**PR**: ${pr.title}\n`;
    summary += `**Files reviewed**: ${fileReviews.length}\n`;
    summary += `**Suggestions**: ${allSuggestions.length} (${critical.length} critical, ${warnings.length} warnings, ${info.length} info)\n\n`;

    if (critical.length > 0) {
      summary += `### 🚨 Critical Issues\n\n`;
      for (const issue of critical) {
        summary += `- **${issue.path}:${issue.line}**: ${issue.body}\n`;
      }
      summary += '\n';
    }

    if (warnings.length > 0) {
      summary += `### ⚠️ Warnings\n\n`;
      for (const issue of warnings.slice(0, 5)) {
        summary += `- **${issue.path}:${issue.line}**: ${issue.body}\n`;
      }
      if (warnings.length > 5) {
        summary += `- ... and ${warnings.length - 5} more\n`;
      }
      summary += '\n';
    }

    // Determine if we should approve
    const approve = critical.length === 0 && warnings.length <= 3;
    const confidence = Math.max(0, 1 - (critical.length * 0.3 + warnings.length * 0.1));

    summary += `### Recommendation\n\n`;
    summary += approve ? '✅ **Approve**' : '❌ **Request Changes**';
    summary += ` (confidence: ${Math.round(confidence * 100)}%)\n`;

    return {
      summary,
      suggestions: allSuggestions,
      approve,
      confidence,
    };
  }

  // ========================================================================
  // POST REVIEW COMMENTS
  // ========================================================================

  private async postReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
    summary: ReviewSummary
  ): Promise<void> {
    // Post line-by-line comments for critical issues
    const criticalComments = summary.suggestions
      .filter(s => s.severity === 'critical')
      .slice(0, 10); // Limit to 10 comments

    for (const suggestion of criticalComments) {
      try {
        await this.client.createReviewComment(owner, repo, prNumber, {
          path: suggestion.path,
          line: suggestion.line,
          body: suggestion.body,
        });
      } catch (e) {
        console.warn(`Failed to post comment on ${suggestion.path}:${suggestion.line}`);
      }
    }

    // Post overall review
    const reviewEvent: ReviewPROptions['event'] = summary.approve ? 'APPROVE' : 'REQUEST_CHANGES';
    
    await this.client.createReview(owner, repo, prNumber, {
      event: reviewEvent,
      body: summary.summary,
    });

    console.log(`Posted review: ${reviewEvent}`);
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  private shouldReviewFile(filename: string): boolean {
    // Skip binary files, lock files, etc.
    const skipExtensions = ['.lock', '.json', '.yaml', '.yml', '.md', '.txt', '.png', '.jpg'];
    const skipPatterns = ['node_modules/', 'dist/', 'build/', '.git/', 'package-lock.json', 'yarn.lock'];

    if (skipExtensions.some(ext => filename.endsWith(ext))) return false;
    if (skipPatterns.some(pattern => filename.includes(pattern))) return false;

    return true;
  }

  private detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
    };
    return langMap[ext || ''] || 'unknown';
  }

  private parsePatch(patch: string): Array<{ line: number; content: string }> {
    const lines: Array<{ line: number; content: string }> = [];
    const patchLines = patch.split('\n');
    let currentLine = 0;

    for (const line of patchLines) {
      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -start,len +start,len @@
        const match = line.match(/\+\d+/);
        if (match) {
          currentLine = parseInt(match[0].slice(1), 10);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        // Added line
        lines.push({
          line: currentLine,
          content: line.slice(1),
        });
        currentLine++;
      } else if (!line.startsWith('-') && !line.startsWith('\ No newline')) {
        // Context line (not removed)
        currentLine++;
      }
    }

    return lines;
  }
}

// ============================================================================
// AI-ASSISTED REVIEW (Integration point for Kimi)
// ============================================================================

export interface AIReviewOptions {
  prNumber: number;
  focusAreas?: string[];
  reviewStyle?: 'thorough' | 'quick' | 'security-focused';
}

export class AIAssistedReview {
  private codeReview: CodeReview;

  constructor(client: GitHubClient, cwd?: string) {
    this.codeReview = new CodeReview(client, cwd);
  }

  async generateReviewContext(prNumber: number): Promise<string> {
    // This would be called by the Agent to get context for Kimi
    const summary = await this.codeReview.review({
      prNumber,
      detailed: true,
    });

    return `
You are reviewing a pull request. Here is the initial analysis:

${summary.summary}

Please provide a detailed code review focusing on:
1. Architectural concerns
2. Logic errors or edge cases
3. Test coverage gaps
4. Documentation needs

Respond with specific, actionable feedback.
`;
  }

  async submitAIReview(
    prNumber: number,
    aiFeedback: string,
    client: GitHubClient
  ): Promise<void> {
    const repo = client.getRepoFromCwd();
    if (!repo) throw new Error('Not in a GitHub repository');

    await client.createReview(repo.owner, repo.repo, prNumber, {
      event: 'COMMENT',
      body: `## AI-Assisted Review\n\n${aiFeedback}`,
    });
  }
}
