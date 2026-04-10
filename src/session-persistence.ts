// Session persistence for crash recovery
// Auto-saves session state and can resume from crashes

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

import { Logger } from './utils/logger.js';

export interface SessionCheckpoint {
  id: string;
  sessionId: string;
  timestamp: number;
  messages: any[];
  workingDirectory: string;
  currentPlan?: any;
  metadata: {
    lastTool?: string;
    lastToolResult?: string;
    iterationCount: number;
  };
}

export interface AutoSaveConfig {
  enabled: boolean;
  intervalMs: number;
  maxCheckpoints: number;
  checkpointDir: string;
}

export class SessionPersistence {
  private config: AutoSaveConfig;
  private logger: Logger;

  private saveInterval?: NodeJS.Timeout;
  private lastCheckpoint?: SessionCheckpoint;

  constructor(config?: Partial<AutoSaveConfig>, logger?: Logger) {
    this.config = {
      enabled: true,
      intervalMs: 30000, // 30 seconds
      maxCheckpoints: 10,
      checkpointDir: join(homedir(), '.horus', 'checkpoints'),
      ...config,
    };
    this.logger = logger || new Logger('session-persistence');
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      await fs.mkdir(this.config.checkpointDir, { recursive: true });
      this.logger.debug('Session persistence initialized');
    } catch (error) {
      this.logger.error('Failed to initialize checkpoint directory:', error);
    }
  }

  startAutoSave(sessionId: string, getState: () => Partial<SessionCheckpoint>): void {
    if (!this.config.enabled) return;


    
    this.saveInterval = setInterval(async () => {
      try {
        const state = getState();
        await this.createCheckpoint({
          sessionId,
          ...state,
        } as SessionCheckpoint);
      } catch (error) {
        this.logger.error('Auto-save failed:', error);
      }
    }, this.config.intervalMs);

    this.logger.debug(`Auto-save started for session ${sessionId}`);
  }

  stopAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = undefined;
      this.logger.debug('Auto-save stopped');
    }
  }

  async createCheckpoint(checkpoint: Omit<SessionCheckpoint, 'id' | 'timestamp'>): Promise<SessionCheckpoint> {
    const fullCheckpoint: SessionCheckpoint = {
      ...checkpoint,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    try {
      const filepath = this.getCheckpointPath(fullCheckpoint.sessionId, fullCheckpoint.id);
      await fs.mkdir(dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, JSON.stringify(fullCheckpoint, null, 2), 'utf-8');

      this.lastCheckpoint = fullCheckpoint;
      this.logger.debug(`Checkpoint created: ${fullCheckpoint.id}`);

      // Cleanup old checkpoints
      await this.cleanupOldCheckpoints(fullCheckpoint.sessionId);

      return fullCheckpoint;
    } catch (error) {
      this.logger.error('Failed to create checkpoint:', error);
      throw error;
    }
  }

  async loadCheckpoint(checkpointId: string): Promise<SessionCheckpoint | null> {
    try {
      // Search in all session directories
      const sessions = await fs.readdir(this.config.checkpointDir);
      
      for (const sessionId of sessions) {
        const filepath = this.getCheckpointPath(sessionId, checkpointId);
        try {
          const content = await fs.readFile(filepath, 'utf-8');
          return JSON.parse(content) as SessionCheckpoint;
        } catch {
          // Continue searching
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to load checkpoint:', error);
      return null;
    }
  }

  async loadLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | null> {
    try {
      const sessionDir = join(this.config.checkpointDir, sessionId);
      const files = await fs.readdir(sessionDir).catch(() => []);

      if (files.length === 0) return null;

      // Sort by timestamp (newest first)
      const checkpoints = await Promise.all(
        files.map(async (file) => {
          const filepath = join(sessionDir, file);
          const content = await fs.readFile(filepath, 'utf-8');
          return JSON.parse(content) as SessionCheckpoint;
        })
      );

      checkpoints.sort((a, b) => b.timestamp - a.timestamp);
      return checkpoints[0];
    } catch (error) {
      this.logger.error('Failed to load latest checkpoint:', error);
      return null;
    }
  }

  async listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    try {
      const sessionDir = join(this.config.checkpointDir, sessionId);
      const files = await fs.readdir(sessionDir).catch(() => []);

      const checkpoints = await Promise.all(
        files.map(async (file) => {
          const filepath = join(sessionDir, file);
          const content = await fs.readFile(filepath, 'utf-8');
          return JSON.parse(content) as SessionCheckpoint;
        })
      );

      return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      this.logger.error('Failed to list checkpoints:', error);
      return [];
    }
  }

  async deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    try {
      const filepath = this.getCheckpointPath(sessionId, checkpointId);
      await fs.unlink(filepath);
      this.logger.debug(`Checkpoint deleted: ${checkpointId}`);
    } catch (error) {
      this.logger.error('Failed to delete checkpoint:', error);
    }
  }

  async checkForCrashedSession(): Promise<SessionCheckpoint | null> {
    try {
      const sessions = await fs.readdir(this.config.checkpointDir);
      
      for (const sessionId of sessions) {
        const latest = await this.loadLatestCheckpoint(sessionId);
        if (latest) {
          // Check if checkpoint is recent (within last hour)
          const age = Date.now() - latest.timestamp;
          if (age < 60 * 60 * 1000) { // 1 hour
            this.logger.info(`Found recent checkpoint from crashed session: ${sessionId}`);
            return latest;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to check for crashed sessions:', error);
      return null;
    }
  }

  async resumeFromCheckpoint(checkpointId: string): Promise<{ success: boolean; checkpoint?: SessionCheckpoint; error?: string }> {
    try {
      const checkpoint = await this.loadCheckpoint(checkpointId);
      
      if (!checkpoint) {
        return { success: false, error: 'Checkpoint not found' };
      }

      // Validate checkpoint data
      if (!checkpoint.messages || !checkpoint.workingDirectory) {
        return { success: false, error: 'Invalid checkpoint data' };
      }

      this.logger.info(`Resuming from checkpoint: ${checkpointId}`);
      return { success: true, checkpoint };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private getCheckpointPath(sessionId: string, checkpointId: string): string {
    return join(this.config.checkpointDir, sessionId, `${checkpointId}.json`);
  }

  private async cleanupOldCheckpoints(sessionId: string): Promise<void> {
    try {
      const checkpoints = await this.listCheckpoints(sessionId);
      
      if (checkpoints.length > this.config.maxCheckpoints) {
        const toDelete = checkpoints.slice(this.config.maxCheckpoints);
        
        for (const checkpoint of toDelete) {
          await this.deleteCheckpoint(sessionId, checkpoint.id);
        }

        this.logger.debug(`Cleaned up ${toDelete.length} old checkpoints`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old checkpoints:', error);
    }
  }

  getLastCheckpoint(): SessionCheckpoint | undefined {
    return this.lastCheckpoint;
  }
}

// Global instance
let globalSessionPersistence: SessionPersistence | null = null;

export function getSessionPersistence(config?: Partial<AutoSaveConfig>, logger?: Logger): SessionPersistence {
  if (!globalSessionPersistence) {
    globalSessionPersistence = new SessionPersistence(config, logger);
  }
  return globalSessionPersistence;
}
