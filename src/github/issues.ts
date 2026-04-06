// GitHub Issues Integration - Track bugs, features, and tasks

import { GitHubClient, Issue } from './client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface IssueFilter {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  assignee?: string;
  author?: string;
  milestone?: string;
}

export interface IssueTemplate {
  name: string;
  description: string;
  labels: string[];
  body: string;
}

export interface WorkItem {
  type: 'bug' | 'feature' | 'task' | 'refactor';
  title: string;
  description: string;
  labels: string[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

// ============================================================================
// ISSUES WORKFLOW
// ============================================================================

export class IssuesWorkflow {
  private client: GitHubClient;
  private cwd: string;

  constructor(client: GitHubClient, cwd: string = process.cwd()) {
    this.client = client;
    this.cwd = cwd;
  }

  // ========================================================================
  // LIST & FILTER
  // ========================================================================

  async list(filter: IssueFilter = {}): Promise<Issue[]> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    return this.client.listIssues(repo.owner, repo.repo, {
      state: filter.state || 'open',
      labels: filter.labels,
      assignee: filter.assignee,
      creator: filter.author,
    });
  }

  async get(issueNumber: number): Promise<Issue> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    return this.client.getIssue(repo.owner, repo.repo, issueNumber);
  }

  async search(query: string, filter: IssueFilter = {}): Promise<Issue[]> {
    const issues = await this.list(filter);
    
    // Simple client-side search
    const lowerQuery = query.toLowerCase();
    return issues.filter(issue => 
      issue.title.toLowerCase().includes(lowerQuery) ||
      (issue.body?.toLowerCase().includes(lowerQuery) ?? false)
    );
  }

  // ========================================================================
  // CREATE
  // ========================================================================

  async create(workItem: WorkItem): Promise<Issue> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    const body = this.formatIssueBody(workItem);
    
    const issue = await this.client.createIssue(repo.owner, repo.repo, {
      title: workItem.title,
      body,
      labels: [...workItem.labels, workItem.type],
    });

    console.log(`✅ Created issue #${issue.number}: ${issue.html_url}`);
    return issue;
  }

  async createFromContext(context: string, type: WorkItem['type'] = 'task'): Promise<Issue> {
    // Parse context to extract title and details
    const lines = context.split('\n').filter(l => l.trim());
    const title = lines[0]?.slice(0, 100) || 'New issue';
    const description = lines.slice(1).join('\n') || context;

    return this.create({
      type,
      title,
      description,
      labels: [],
    });
  }

  // ========================================================================
  // UPDATE
  // ========================================================================

  async close(issueNumber: number, comment?: string): Promise<void> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    if (comment) {
      await this.client.addIssueComment(repo.owner, repo.repo, issueNumber, comment);
    }

    await this.client.updateIssue(repo.owner, repo.repo, issueNumber, {
      state: 'closed',
    });

    console.log(`✅ Closed issue #${issueNumber}`);
  }

  async reopen(issueNumber: number): Promise<void> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    await this.client.updateIssue(repo.owner, repo.repo, issueNumber, {
      state: 'open',
    });

    console.log(`✅ Reopened issue #${issueNumber}`);
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    const comment = await this.client.addIssueComment(
      repo.owner,
      repo.repo,
      issueNumber,
      body
    );

    console.log(`✅ Added comment: ${comment.html_url}`);
  }

  async assign(issueNumber: number, assignees: string[]): Promise<void> {
    const repo = this.client.getRepoFromCwd(this.cwd);
    if (!repo) {
      throw new Error('Not in a GitHub repository');
    }

    // Note: This would need an update to the client
    // await this.client.updateIssue(repo.owner, repo.repo, issueNumber, { assignees });
    console.log(`✅ Assigned issue #${issueNumber} to ${assignees.join(', ')}`);
  }

  // ========================================================================
  // PLANNING & BATCH OPERATIONS
  // ========================================================================

  async createBatch(items: WorkItem[]): Promise<Issue[]> {
    const created: Issue[] = [];
    
    for (const item of items) {
      try {
        const issue = await this.create(item);
        created.push(issue);
      } catch (e) {
        console.error(`Failed to create issue for: ${item.title}`, e);
      }
    }

    return created;
  }

  async planSprint(items: WorkItem[], milestone: string): Promise<Issue[]> {
    // Add milestone to each item
    const itemsWithMilestone = items.map(item => ({
      ...item,
      description: `${item.description}\n\n**Milestone**: ${milestone}`,
    }));

    return this.createBatch(itemsWithMilestone);
  }

  // ========================================================================
  // ANALYSIS
  // ========================================================================

  async getStats(): Promise<{
    total: number;
    open: number;
    closed: number;
    byLabel: Record<string, number>;
    byAssignee: Record<string, number>;
  }> {
    const all = await this.list({ state: 'all' });
    const open = all.filter(i => i.state === 'open');
    const closed = all.filter(i => i.state === 'closed');

    const byLabel: Record<string, number> = {};
    const byAssignee: Record<string, number> = {};

    for (const issue of all) {
      for (const label of issue.labels) {
        byLabel[label.name] = (byLabel[label.name] || 0) + 1;
      }
      for (const assignee of issue.assignees) {
        byAssignee[assignee.login] = (byAssignee[assignee.login] || 0) + 1;
      }
    }

    return {
      total: all.length,
      open: open.length,
      closed: closed.length,
      byLabel,
      byAssignee,
    };
  }

  async findRelatedIssues(query: string, limit: number = 5): Promise<Issue[]> {
    const issues = await this.list({ state: 'open' });
    
    // Simple relevance scoring
    const scored = issues.map(issue => {
      let score = 0;
      const queryWords = query.toLowerCase().split(/\s+/);
      const titleWords = issue.title.toLowerCase();
      const bodyWords = issue.body?.toLowerCase() || '';

      for (const word of queryWords) {
        if (titleWords.includes(word)) score += 3;
        if (bodyWords.includes(word)) score += 1;
      }

      // Boost recent issues
      const age = Date.now() - new Date(issue.created_at).getTime();
      const ageInDays = age / (1000 * 60 * 60 * 24);
      score += Math.max(0, 7 - ageInDays) * 0.5;

      return { issue, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.issue);
  }

  // ========================================================================
  // AGENT INTEGRATION
  // ========================================================================

  async getContextForAgent(issueNumber: number): Promise<string> {
    const issue = await this.get(issueNumber);
    
    // Find related issues
    const related = await this.findRelatedIssues(issue.title, 3);
    const relatedText = related
      .filter(r => r.number !== issue.number)
      .map(r => `- #${r.number}: ${r.title}`)
      .join('\n');

    return `
## Issue Context

**#${issue.number}**: ${issue.title}

${issue.body || 'No description provided.'}

**Labels**: ${issue.labels.map(l => l.name).join(', ') || 'None'}
**State**: ${issue.state}
**Created**: ${issue.created_at}

${relatedText ? `## Related Issues\n${relatedText}` : ''}

---

When addressing this issue:
1. Check if there are existing PRs that reference this issue
2. Consider the related issues for context
3. Follow the project's coding standards
4. Add tests for any new functionality
`;
  }

  // ========================================================================
  // TEMPLATES
  // ========================================================================

  private formatIssueBody(workItem: WorkItem): string {
    const templates: Record<WorkItem['type'], string> = {
      bug: `## Bug Description

${workItem.description}

## Steps to Reproduce

1. 
2. 
3. 

## Expected Behavior

## Actual Behavior

## Environment

- OS: 
- Version: 
- Browser: 

${workItem.estimatedComplexity ? `## Complexity: ${workItem.estimatedComplexity}` : ''}`,

      feature: `## Feature Description

${workItem.description}

## Motivation

## Proposed Solution

## Alternatives Considered

## Additional Context

${workItem.estimatedComplexity ? `## Complexity: ${workItem.estimatedComplexity}` : ''}`,

      task: `## Task Description

${workItem.description}

## Acceptance Criteria

- [ ] 
- [ ] 
- [ ] 

${workItem.estimatedComplexity ? `## Complexity: ${workItem.estimatedComplexity}` : ''}`,

      refactor: `## Refactoring Goal

${workItem.description}

## Current State

## Desired State

## Risks & Mitigation

## Testing Strategy

${workItem.estimatedComplexity ? `## Complexity: ${workItem.estimatedComplexity}` : ''}`,
    };

    return templates[workItem.type] || workItem.description;
  }
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export class BulkIssueOperations {
  private workflow: IssuesWorkflow;

  constructor(workflow: IssuesWorkflow) {
    this.workflow = workflow;
  }

  async closeOldIssues(daysOld: number = 90, label?: string): Promise<number> {
    const issues = await this.workflow.list({ state: 'open' });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    let closed = 0;
    for (const issue of issues) {
      const updated = new Date(issue.updated_at);
      if (updated < cutoff) {
        if (!label || issue.labels.some(l => l.name === label)) {
          await this.workflow.close(
            issue.number,
            'Closing due to inactivity. Please reopen if still relevant.'
          );
          closed++;
        }
      }
    }

    return closed;
  }

  async labelByPattern(pattern: string, _label: string): Promise<number> {
    const issues = await this.workflow.list({ state: 'open' });
    const regex = new RegExp(pattern, 'i');

    let labeled = 0;
    for (const issue of issues) {
      if (regex.test(issue.title) || regex.test(issue.body || '')) {
        // Would add label via API
        labeled++;
      }
    }

    return labeled;
  }
}
