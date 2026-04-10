// Session Templates - Pre-configured session setups

import Database from 'better-sqlite3';

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  systemPrompt?: string;
  initialContext?: string[];
  tools?: string[]; // Tool whitelist/blacklist
  mode?: 'auto' | 'semi' | 'review';
  tags: string[];
  isDefault?: boolean;
}

export interface CreateTemplateInput {
  name: string;
  description: string;
  systemPrompt?: string;
  initialContext?: string[];
  tools?: string[];
  mode?: 'auto' | 'semi' | 'review';
  tags?: string[];
  isDefault?: boolean;
}

export class SessionTemplates {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(this.dbPath), { recursive: true });
    
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.initTables();
    this.seedDefaultTemplates();
  }

  private initTables(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_templates (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        system_prompt TEXT,
        initial_context TEXT, -- JSON array
        tools TEXT, -- JSON array
        mode TEXT DEFAULT 'semi',
        tags TEXT, -- JSON array
        is_default INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_templates_name ON session_templates(name);
      CREATE INDEX IF NOT EXISTS idx_templates_tags ON session_templates(tags);
    `);
  }

  private seedDefaultTemplates(): void {
    if (!this.db) return;

    const defaults: CreateTemplateInput[] = [
      {
        name: 'code-review',
        description: 'Focused code review session with detailed analysis',
        systemPrompt: `You are a thorough code reviewer. Focus on:
- Security vulnerabilities
- Performance issues
- Code maintainability
- Best practices
- Edge cases

Be constructive and provide specific suggestions.`,
        mode: 'review',
        tags: ['review', 'code', 'analysis'],
      },
      {
        name: 'explore',
        description: 'Explore and understand a codebase',
        systemPrompt: `You are helping explore and understand a codebase. 
Focus on:
- High-level architecture
- Key components and their relationships
- Entry points and data flow
- Important patterns and conventions

Ask clarifying questions when needed.`,
        mode: 'semi',
        tags: ['explore', 'learn', 'architecture'],
      },
      {
        name: 'debug',
        description: 'Debug an issue systematically',
        systemPrompt: `You are debugging an issue. Follow a systematic approach:
1. Gather information about the problem
2. Form hypotheses about causes
3. Test hypotheses with targeted investigation
4. Verify the fix

Be methodical and document your reasoning.`,
        mode: 'semi',
        tags: ['debug', 'fix', 'investigate'],
      },
      {
        name: 'refactor',
        description: 'Refactor code safely with checkpoints',
        systemPrompt: `You are refactoring code. Prioritize:
1. Safety - make small, verifiable changes
2. Tests - ensure tests pass after each change
3. Clarity - improve readability and maintainability
4. Checkpoints - create checkpoints before significant changes

Never change behavior without tests.`,
        mode: 'review',
        tags: ['refactor', 'improve', 'clean'],
      },
      {
        name: 'quick-task',
        description: 'Fast task execution with minimal confirmation',
        systemPrompt: `Execute tasks efficiently with minimal user intervention.
- Make reasonable assumptions
- Ask only for critical decisions
- Provide concise summaries
- Use auto mode for straightforward tasks`,
        mode: 'auto',
        tags: ['fast', 'auto', 'quick'],
      },
    ];

    const stmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM session_templates'
    );
    const { count } = stmt.get() as any;

    if (count === 0) {
      for (const template of defaults) {
        this.create(template);
      }
    }
  }

  create(input: CreateTemplateInput): SessionTemplate {
    if (!this.db) throw new Error('Not initialized');

    const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO session_templates 
        (id, name, description, created_at, updated_at, system_prompt, 
         initial_context, tools, mode, tags, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description,
      now,
      now,
      input.systemPrompt || null,
      input.initialContext ? JSON.stringify(input.initialContext) : null,
      input.tools ? JSON.stringify(input.tools) : null,
      input.mode || 'semi',
      input.tags ? JSON.stringify(input.tags) : '[]',
      input.isDefault ? 1 : 0
    );

    return {
      id,
      name: input.name,
      description: input.description,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      systemPrompt: input.systemPrompt,
      initialContext: input.initialContext,
      tools: input.tools,
      mode: input.mode || 'semi',
      tags: input.tags || [],
      isDefault: input.isDefault,
    };
  }

  get(name: string): SessionTemplate | null {
    if (!this.db) throw new Error('Not initialized');

    const row = this.db.prepare(
      'SELECT * FROM session_templates WHERE name = ?'
    ).get(name) as any;

    if (!row) return null;

    return this.rowToTemplate(row);
  }

  list(): SessionTemplate[] {
    if (!this.db) throw new Error('Not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM session_templates ORDER BY is_default DESC, name ASC
    `).all() as any[];

    return rows.map(r => this.rowToTemplate(r));
  }

  update(name: string, updates: Partial<CreateTemplateInput>): boolean {
    if (!this.db) throw new Error('Not initialized');

    const sets: string[] = [];
    const values: any[] = [];

    if (updates.description) {
      sets.push('description = ?');
      values.push(updates.description);
    }
    if (updates.systemPrompt !== undefined) {
      sets.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.initialContext) {
      sets.push('initial_context = ?');
      values.push(JSON.stringify(updates.initialContext));
    }
    if (updates.tools) {
      sets.push('tools = ?');
      values.push(JSON.stringify(updates.tools));
    }
    if (updates.mode) {
      sets.push('mode = ?');
      values.push(updates.mode);
    }
    if (updates.tags) {
      sets.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.isDefault !== undefined) {
      sets.push('is_default = ?');
      values.push(updates.isDefault ? 1 : 0);
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(name);

    const result = this.db.prepare(`
      UPDATE session_templates SET ${sets.join(', ')} WHERE name = ?
    `).run(...values);

    return result.changes > 0;
  }

  delete(name: string): boolean {
    if (!this.db) throw new Error('Not initialized');

    const result = this.db.prepare(
      'DELETE FROM session_templates WHERE name = ?'
    ).run(name);

    return result.changes > 0;
  }

  getDefault(): SessionTemplate | null {
    if (!this.db) throw new Error('Not initialized');

    const row = this.db.prepare(
      'SELECT * FROM session_templates WHERE is_default = 1 LIMIT 1'
    ).get() as any;

    if (!row) {
      // Return first template as fallback
      const first = this.db.prepare(
        'SELECT * FROM session_templates ORDER BY name LIMIT 1'
      ).get() as any;
      return first ? this.rowToTemplate(first) : null;
    }

    return this.rowToTemplate(row);
  }

  setDefault(name: string): boolean {
    if (!this.db) throw new Error('Not initialized');

    // Clear existing default
    this.db.prepare(
      'UPDATE session_templates SET is_default = 0 WHERE is_default = 1'
    ).run();

    // Set new default
    const result = this.db.prepare(
      'UPDATE session_templates SET is_default = 1 WHERE name = ?'
    ).run(name);

    return result.changes > 0;
  }

  private rowToTemplate(row: any): SessionTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      systemPrompt: row.system_prompt || undefined,
      initialContext: row.initial_context ? JSON.parse(row.initial_context) : undefined,
      tools: row.tools ? JSON.parse(row.tools) : undefined,
      mode: row.mode || 'semi',
      tags: row.tags ? JSON.parse(row.tags) : [],
      isDefault: row.is_default === 1,
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
