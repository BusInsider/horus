// GitHub Integration - API Client
// PR management, issue tracking, code review

import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

// ============================================================================
// TYPES
// ============================================================================

export interface GitHubConfig {
  token?: string;
  baseUrl?: string; // For GitHub Enterprise
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  user: { login: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  labels: Array<{ name: string; color: string }>;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  created_at: string;
  updated_at: string;
}

export interface PullRequestFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

export interface ReviewComment {
  id: number;
  path: string;
  line?: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export interface CreatePROptions {
  title: string;
  body?: string;
  head: string;
  base?: string;
  draft?: boolean;
  labels?: string[];
}

export interface ReviewPROptions {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body?: string;
  comments?: Array<{
    path: string;
    line: number;
    body: string;
    side?: 'LEFT' | 'RIGHT';
  }>;
}

// ============================================================================
// GITHUB CLIENT
// ============================================================================

export class GitHubClient {
  private octokit: Octokit;
  private token: string;

  constructor(config: GitHubConfig = {}) {
    this.token = config.token || this.loadTokenFromEnv();
    
    this.octokit = new Octokit({
      auth: this.token,
      baseUrl: config.baseUrl,
    });
  }

  private loadTokenFromEnv(): string {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      throw new Error(
        'GitHub token not found. Set GITHUB_TOKEN environment variable ' +
        'or run: gh auth login'
      );
    }
    return token;
  }

  // ========================================================================
  // REPOSITORY DETECTION
  // ========================================================================

  getRepoFromCwd(cwd: string = process.cwd()): { owner: string; repo: string } | null {
    try {
      const remoteUrl = execSync('git remote get-url origin', { 
        cwd, 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      // Parse GitHub URL (HTTPS or SSH)
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    } catch {
      // Not a git repo or no origin remote
    }
    return null;
  }

  getCurrentBranch(cwd: string = process.cwd()): string | null {
    try {
      return execSync('git branch --show-current', {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    } catch {
      return null;
    }
  }

  // ========================================================================
  // PULL REQUESTS
  // ========================================================================

  async listPullRequests(
    owner: string,
    repo: string,
    options: { state?: 'open' | 'closed' | 'all'; head?: string; base?: string } = {}
  ): Promise<PullRequest[]> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: options.state || 'open',
      head: options.head,
      base: options.base,
      per_page: 100,
    });
    return data as PullRequest[];
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return data as PullRequest;
  }

  async createPullRequest(
    owner: string,
    repo: string,
    options: CreatePROptions
  ): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base || 'main',
      draft: options.draft,
    });

    // Add labels if specified
    if (options.labels && options.labels.length > 0) {
      await this.octokit.issues.addLabels({
        owner,
        repo,
        issue_number: data.number,
        labels: options.labels,
      });
    }

    return data as PullRequest;
  }

  async updatePullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    updates: Partial<{ title: string; body: string; state: 'open' | 'closed' }>
  ): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      ...updates,
    });
    return data as PullRequest;
  }

  async getPullRequestFiles(owner: string, repo: string, pullNumber: number): Promise<PullRequestFile[]> {
    const { data } = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return data as PullRequestFile[];
  }

  async getPullRequestDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' },
    });
    return data as unknown as string;
  }

  // ========================================================================
  // PR REVIEWS
  // ========================================================================

  async createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    review: ReviewPROptions
  ): Promise<{ id: number; html_url: string }> {
    const { data } = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event: review.event,
      body: review.body,
      comments: review.comments,
    });
    return { id: data.id, html_url: data.html_url };
  }

  async listReviews(owner: string, repo: string, pullNumber: number): Promise<any[]> {
    const { data } = await this.octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return data;
  }

  async createReviewComment(
    owner: string,
    repo: string,
    pullNumber: number,
    comment: {
      path: string;
      line: number;
      body: string;
      commit_id?: string;
      side?: 'LEFT' | 'RIGHT';
    }
  ): Promise<ReviewComment> {
    // Get the PR to find the head commit SHA if commit_id not provided
    let commitId = comment.commit_id;
    if (!commitId) {
      const pr = await this.getPullRequest(owner, repo, pullNumber);
      commitId = pr.head.sha;
    }
    
    const { data } = await this.octokit.pulls.createReviewComment({
      owner,
      repo,
      pull_number: pullNumber,
      path: comment.path,
      line: comment.line,
      body: comment.body,
      commit_id: commitId,
      side: comment.side,
    });
    return data as ReviewComment;
  }

  async listReviewComments(owner: string, repo: string, pullNumber: number): Promise<ReviewComment[]> {
    const { data } = await this.octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return data as ReviewComment[];
  }

  // ========================================================================
  // ISSUES
  // ========================================================================

  async listIssues(
    owner: string,
    repo: string,
    options: {
      state?: 'open' | 'closed' | 'all';
      labels?: string[];
      assignee?: string;
      creator?: string;
    } = {}
  ): Promise<Issue[]> {
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: options.state || 'open',
      labels: options.labels?.join(','),
      assignee: options.assignee,
      creator: options.creator,
      per_page: 100,
    });
    // Filter out PRs (GitHub returns PRs as issues)
    return (data as Issue[]).filter(i => !('pull_request' in i));
  }

  async getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    const { data } = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return data as Issue;
  }

  async createIssue(
    owner: string,
    repo: string,
    options: {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    }
  ): Promise<Issue> {
    const { data } = await this.octokit.issues.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      labels: options.labels,
      assignees: options.assignees,
    });
    return data as Issue;
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    updates: Partial<{ title: string; body: string; state: 'open' | 'closed'; labels: string[] }>
  ): Promise<Issue> {
    const { data } = await this.octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      ...updates,
    });
    return data as Issue;
  }

  async addIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<{ id: number; html_url: string }> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return { id: data.id, html_url: data.html_url };
  }

  // ========================================================================
  // AUTHENTICATION CHECK
  // ========================================================================

  async checkAuth(): Promise<{ user: string; scopes: string[] }> {
    const { data, headers } = await this.octokit.users.getAuthenticated();
    const scopes = (headers['x-oauth-scopes'] || '').split(',').map(s => s.trim()).filter(Boolean);
    return { user: data.login, scopes };
  }
}
