// Logging utility for Horus
// Structured logging with levels

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  data?: any;
}

export class Logger {
  private level: LogLevel;
  private context: string;
  private logFile?: string;

  constructor(context: string = 'horus', level: LogLevel = 'info', logFile?: string) {
    this.context = context;
    this.level = level;
    this.logFile = logFile;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;
    
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${message}`;
  }

  private write(entry: LogEntry): void {
    const formatted = this.formatMessage(entry.level, entry.message, entry.data);

    // Console output
    switch (entry.level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }

    // File output if configured
    if (this.logFile) {
      try {
        const fs = require('fs');
        fs.appendFileSync(this.logFile, formatted + '\n');
      } catch (e) {
        // Silent fail for logging errors
      }
    }
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'debug',
        message,
        context: this.context,
        data,
      });
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'info',
        message,
        context: this.context,
        data,
      });
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message,
        context: this.context,
        data,
      });
    }
  }

  error(message: string, error?: Error | any): void {
    if (this.shouldLog('error')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        context: this.context,
        data: error instanceof Error 
          ? { message: error.message, stack: error.stack }
          : error,
      });
    }
  }

  // Create child logger with sub-context
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`, this.level, this.logFile);
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function initLogger(level: LogLevel = 'info', logFile?: string): Logger {
  globalLogger = new Logger('horus', level, logFile);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger('horus', 'info');
  }
  return globalLogger;
}
