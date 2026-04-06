// GitHub PR Workflow - Create, checkout, manage PRs with git integration

import { execSync } from 'child_process';
import { GitHubClient, PullRequest } from './client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface PRCreationOptions {
  title: string;
  body?: string;
  draft?: boolean;
  labels?: string[];
  base?: string;
  push?: boolean; // Auto-push before creating PR
}

export interface PRCheckoutOptions {
  prNumber: number;
  createBranch?: boolean; // Create local branch for PR
}

export interface PROverview {
  pr: PullRequest;
  files: Array<{
    filename: string;
    status: string;
    changes: number;
    additions: number;
    deletions: number;
  }>;
  stats: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
}

// ============================================================================
// PR WORKFLOW
// ============================================================================

export class PRWorkflow {
  private client: GitHubClient;
  private cwd: string;

  constructor(client: GitHubClient, cwd: string = process.cwd()) {
    this.client = client;
    this.cwd = cwd;
  }

  // ========================================================================
  // CREATE PR
  // ========================================================================

  async create(options: PRCreationOptions): Promise<PullRequest> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    const currentBranch = this.client.getCurrentBranch(this.cwd);
    if (!currentBranch) {
      throw new Error('Not on a git branch');
    }

    // Check if we're on main/master
    const defaultBranch = this.getDefaultBranch();
    if (currentBranch === defaultBranch) {
      throw new Error(
        `Cannot create PR from ${defaultBranch} branch. ` +
        `Create a feature branch first: git checkout -b feature/name`
      );
    }

    // Push if requested or if upstream doesn't exist
    if (options.push || !this.hasUpstream(currentBranch)) {
      console.log(`Pushing ${currentBranch} to origin...`);
      this.pushBranch(currentBranch);
    }

    // Generate PR body if not provided
    const body = options.body || await this.generatePRBody(currentBranch, defaultBranch);

    // Create the PR
    const pr = await this.client.createPullRequest(repo.owner, repo.repo, {
      title: options.title,
      body,
      head: currentBranch,
      base: options.base || defaultBranch,
      draft: options.draft,
      labels: options.labels,
    });

    console.log(`✅ Created PR #${pr.number}: ${pr.html_url}`);
    return pr;
  }

  async createFromContext(context: string): Promise<PullRequest> {
    // Generate PR title from context
    const title = await this.generatePRTitle(context);
    
    // Generate body with context and checklist
    const body = await this.generatePRBodyFromContext(context);

    return this.create({
      title,
      body,
      push: true,
    });
  }

  // ========================================================================
  // CHECKOUT PR
  // ========================================================================

  async checkout(prNumber: number): Promise<void> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    const pr = await this.client.getPullRequest(repo.owner, repo.repo, prNumber);
    const branchName = pr.head.ref;

    // Check if we already have a local branch
    const localBranches = this.listLocalBranches();
    
    if (localBranches.includes(branchName)) {
      // Checkout existing branch and pull
      console.log(`Checking out existing branch ${branchName}...`);
      execSync(`git checkout ${branchName}`, { cwd: this.cwd, stdio: 'inherit' });
      execSync(`git pull origin ${branchName}`, { cwd: this.cwd, stdio: 'inherit' });
    } else {
      // Fetch and checkout PR branch
      console.log(`Fetching PR #${prNumber}...`);
      execSync(`git fetch origin pull/${prNumber}/head:pr-${prNumber}`, { 
        cwd: this.cwd, 
        stdio: 'inherit' 
      });
      execSync(`git checkout pr-${prNumber}`, { cwd: this.cwd, stdio: 'inherit' });
    }

    console.log(`✅ Checked out PR #${prNumber}: ${pr.title}`);
  }

  // ========================================================================
  // PR OVERVIEW
  // ========================================================================

  async getOverview(prNumber: number): Promise<PROverview> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    const [pr, files] = await Promise.all([
      this.client.getPullRequest(repo.owner, repo.repo, prNumber),
      this.client.getPullRequestFiles(repo.owner, repo.repo, prNumber),
    ]);

    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      pr,
      files: files.map(f => ({
        filename: f.filename,
        status: f.status,
        changes: f.changes,
        additions: f.additions,
        deletions: f.deletions,
      })),
      stats: {
        totalFiles: files.length,
        totalAdditions,
        totalDeletions,
      },
    };
  }

  // ========================================================================
  // LIST PRs
  // ========================================================================

  async list(options: {
    state?: 'open' | 'closed' | 'all';
    author?: string;
    limit?: number;
  } = {}): Promise<PullRequest[]> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    const prs = await this.client.listPullRequests(repo.owner, repo.repo, {
      state: options.state || 'open',
    });

    // Filter by author if specified
    let filtered = prs;
    if (options.author) {
      filtered = prs.filter(pr => pr.user.login === options.author);
    }

    // Limit results
    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  // ========================================================================
  // DIFF
  // ========================================================================

  async getDiff(prNumber: number): Promise<string> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    return this.client.getPullRequestDiff(repo.owner, repo.repo, prNumber);
  }

  // ========================================================================
  // MERGE
  // ========================================================================

  async merge(prNumber: number, options: {
    method?: 'merge' | 'squash' | 'rebase';
    title?: string;
    message?: string;
  } = {}): Promise<void> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    // Note: Octokit doesn't expose merge directly, use gh CLI
    const method = options.method || 'squash';
    const args = [`gh pr merge ${prNumber}`, `--${method}`];
    
    if (options.title) args.push(`--subject "${options.title}"`);
    if (options.message) args.push(`--body "${options.message}"`);
    args.push('--auto');

    execSync(args.join(' '), { cwd: this.cwd, stdio: 'inherit' });
    console.log(`✅ Merged PR #${prNumber}`);
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  private getDefaultBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref origin/HEAD', {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim().replace('origin/', '');
    } catch {
      return 'main';
    }
  }

  private hasUpstream(branch: string): boolean {
    try {
      execSync(`git rev-parse --abbrev-ref ${branch}@upstream`, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }

  private pushBranch(branch: string): void {
    execSync(`git push -u origin ${branch}`, { cwd: this.cwd, stdio: 'inherit' });
  }

  private listLocalBranches(): string[] {
    const output = execSync('git branch --format="%(refname:short)"', {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    return output.trim().split('\n');
  }

  private async generatePRTitle(context: string): Promise<string> {
    // In production, this would call Kimi to generate a title
    // For now, use a simple heuristic
    const lines = context.split('\n').filter(l => l.trim());
    const firstLine = lines[0] || 'Update code';
    
    // Capitalize first letter, limit to 50 chars
    return firstLine.charAt(0).toUpperCase() + firstLine.slice(1, 50);
  }

  private async generatePRBody(branch: string, base: string): Promise<string> {
    // Get commit messages since branch point
    const commits = execSync(`git log ${base}..${branch} --pretty=format:"- %s"`, {
      cwd: this.cwd,
      encoding: 'utf8',
    });

    return `## Changes

${commits || '- Updates and improvements'}

## Checklist

- [ ] Tests pass
- [ ] Code follows style guidelines
- [ ] Documentation updated (if needed)
`;
  }

  private async generatePRBodyFromContext(context: string): Promise<string> {
    return `## Summary

${context}

## Changes

- Implemented feature/fix
- Updated relevant files

## Checklist

- [ ] Tests pass
- [ ] Code follows style guidelines
- [ ] Self-review completed
`;
  }
}
