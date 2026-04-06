// Error handling and recovery for Horus

import { Logger } from './utils/logger.js';

export interface ErrorContext {
  operation: string;
  tool?: string;
  sessionId?: string;
  recoverable: boolean;
}

export class HorusError extends Error {
  public code: string;
  public context: ErrorContext;
  public originalError?: Error;

  constructor(message: string, code: string, context: ErrorContext, originalError?: Error) {
    super(message);
    this.name = 'HorusError';
    this.code = code;
    this.context = context;
    this.originalError = originalError;
  }
}

export enum ErrorCode {
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_CONTEXT_LENGTH = 'API_CONTEXT_LENGTH',
  API_AUTH = 'API_AUTH',
  API_TIMEOUT = 'API_TIMEOUT',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_EXECUTION = 'TOOL_EXECUTION',
  TOOL_TIMEOUT = 'TOOL_TIMEOUT',
  MEMORY_FULL = 'MEMORY_FULL',
  CHECKPOINT_FAILED = 'CHECKPOINT_FAILED',
  SESSION_CORRUPT = 'SESSION_CORRUPT',
  CONFIG_INVALID = 'CONFIG_INVALID',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class ErrorHandler {
  private logger: Logger;
  private retryCount: Map<string, number> = new Map();
  private maxRetries = 3;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('error-handler');
  }

  async handle(error: Error, context: ErrorContext): Promise<{ recovered: boolean; result?: any }> {
    const horusError = this.classifyError(error, context);
    
    this.logger.error(`Error in ${context.operation}:`, horusError);

    if (!context.recoverable) {
      this.logger.error('Non-recoverable error, failing fast');
      throw horusError;
    }

    const strategy = this.getRecoveryStrategy(horusError.code);
    
    if (strategy) {
      return this.attemptRecovery(horusError, strategy);
    }

    return { recovered: false };
  }

  private classifyError(error: Error, context: ErrorContext): HorusError {
    const message = error.message.toLowerCase();

    // API errors
    if (message.includes('429') || message.includes('rate limit')) {
      return new HorusError('API rate limit exceeded', ErrorCode.API_RATE_LIMIT, context, error);
    }
    if (message.includes('413') || message.includes('context length') || message.includes('too long')) {
      return new HorusError('Context length exceeded', ErrorCode.API_CONTEXT_LENGTH, context, error);
    }
    if (message.includes('401') || message.includes('unauthorized') || message.includes('auth')) {
      return new HorusError('API authentication failed', ErrorCode.API_AUTH, context, error);
    }
    if (message.includes('timeout') || message.includes('etimedout')) {
      return new HorusError('Request timeout', ErrorCode.API_TIMEOUT, context, error);
    }

    // Tool errors
    if (message.includes('tool not found') || message.includes('unknown tool')) {
      return new HorusError('Tool not found', ErrorCode.TOOL_NOT_FOUND, context, error);
    }
    if (message.includes('tool execution')) {
      return new HorusError('Tool execution failed', ErrorCode.TOOL_EXECUTION, context, error);
    }

    // Memory errors
    if (message.includes('memory') || message.includes('tokens')) {
      return new HorusError('Memory limit reached', ErrorCode.MEMORY_FULL, context, error);
    }

    // Network errors
    if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
      return new HorusError('Network error', ErrorCode.NETWORK_ERROR, context, error);
    }

    return new HorusError(error.message, ErrorCode.UNKNOWN, context, error);
  }

  private getRecoveryStrategy(code: ErrorCode): string | null {
    const strategies: Record<string, string | null> = {
      [ErrorCode.API_RATE_LIMIT]: 'retry_with_backoff',
      [ErrorCode.API_CONTEXT_LENGTH]: 'compress_context',
      [ErrorCode.API_TIMEOUT]: 'retry_with_backoff',
      [ErrorCode.NETWORK_ERROR]: 'retry_with_backoff',
      [ErrorCode.TOOL_TIMEOUT]: 'retry_with_backoff',
      [ErrorCode.TOOL_EXECUTION]: 'retry_once',
      [ErrorCode.MEMORY_FULL]: 'compress_memory',
      [ErrorCode.API_AUTH]: null,
      [ErrorCode.TOOL_NOT_FOUND]: null,
      [ErrorCode.UNKNOWN]: null,
    };

    return strategies[code] || null;
  }

  private async attemptRecovery(error: HorusError, strategy: string): Promise<{ recovered: boolean; result?: any }> {
    const key = `${error.context.operation}:${error.code}`;
    const attempts = this.retryCount.get(key) || 0;

    if (attempts >= this.maxRetries) {
      this.logger.error(`Max retries (${this.maxRetries}) exceeded for ${key}`);
      return { recovered: false };
    }

    this.retryCount.set(key, attempts + 1);

    switch (strategy) {
      case 'retry_with_backoff':
        return this.retryWithBackoff(error, attempts);
      
      case 'retry_once':
        if (attempts === 0) {
          this.logger.info('Retrying once...');
          await this.delay(1000);
          return { recovered: true };
        }
        return { recovered: false };
      
      case 'compress_context':
        this.logger.info('Attempting to compress context...');
        return { recovered: true, result: { action: 'compress_context' } };
      
      case 'compress_memory':
        this.logger.info('Attempting to compress memory...');
        return { recovered: true, result: { action: 'compress_memory' } };
      
      default:
        return { recovered: false };
    }
  }

  private async retryWithBackoff(error: HorusError, attempt: number): Promise<{ recovered: boolean }> {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30s
    this.logger.info(`Retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})...`);
    await this.delay(delay);
    return { recovered: true };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  resetRetryCount(operation?: string): void {
    if (operation) {
      for (const key of this.retryCount.keys()) {
        if (key.startsWith(operation)) {
          this.retryCount.delete(key);
        }
      }
    } else {
      this.retryCount.clear();
    }
  }
}

// Global error handler instance
let globalErrorHandler: ErrorHandler | null = null;

export function getErrorHandler(logger?: Logger): ErrorHandler {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandler(logger);
  }
  return globalErrorHandler;
}
