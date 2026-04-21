// Kimi API client with streaming support

export interface KimiConfig {
  apiKey: string;
  baseUrl: string;
  model: 'kimi-k2-5' | 'kimi-k2-6' | 'kimi-k2-6-preview' | 'kimi-latest' | 'kimi-for-coding';
  maxRetries?: number;
  timeoutMs?: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  reasoning_content?: string;  // Kimi-specific: thinking/reasoning content
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface StreamChunk {
  type: 'token' | 'reasoning' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export class KimiClient {
  private config: Required<KimiConfig>;
  private sessionId: string;

  constructor(config: KimiConfig) {
    this.config = {
      maxRetries: 3,
      timeoutMs: 120000,
      ...config,
    };
    // Generate session ID for prefix caching
    // Session affinity helps API cache system prompt + tools
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    // Simple hash of config to create consistent session ID
    const hash = Buffer.from(`${this.config.model}:${this.config.baseUrl}`).toString('base64').slice(0, 16);
    return `horus_${hash}_${Date.now().toString(36)}`;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getModel(): string {
    return this.config.model;
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      thinking?: { type: 'enabled' | 'disabled' };
      topP?: number;
      model?: string;
    }
  ): AsyncGenerator<StreamChunk> {
    const url = `${this.config.baseUrl}/chat/completions`;
    
    // Map model names for kimi-for-coding endpoint
    let modelName: string = options?.model || this.config.model;
    if (this.config.baseUrl.includes('api.kimi.com')) {
      // The Kimi coding endpoint uses 'kimi-for-coding' as the model identifier
      // regardless of whether the user selected k2.5, k2.6, or turbo
      const codingEndpointModels = ['kimi-k2-5', 'kimi-k2-6', 'kimi-k2-6-preview', 'kimi-k2-turbo-preview', 'kimi-latest'];
      if (codingEndpointModels.includes(modelName)) {
        modelName = 'kimi-for-coding';
      }
    }
    
    const body: any = {
      model: modelName,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 0.95,
      max_tokens: options?.maxTokens ?? 4000,
    };
    
    // Add thinking configuration if provided (Kimi-specific)
    if (options?.thinking) {
      body.thinking = options.thinking;
    }
    


    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        // Determine User-Agent based on endpoint
        const isKimiCoding = this.config.baseUrl.includes('api.kimi.com');
        const userAgent = isKimiCoding 
          ? 'KimiCLI/1.0'  // Required for api.kimi.com/coding/v1
          : 'Horus/0.1.0';

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            'User-Agent': userAgent,
            'X-Session-Id': this.sessionId,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const error = await this.handleError(response);
          if (error.retryable && retries < this.config.maxRetries - 1) {
            retries++;
            await this.delay(1000 * Math.pow(2, retries));
            continue;
          }
          yield { type: 'error', content: error.message };
          return;
        }

        if (!response.body) {
          yield { type: 'error', content: 'No response body' };
          return;
        }

        // Parse SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentToolCalls: ToolCall[] = [];
        let lineCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            lineCount++;
            const trimmed = line.trim();
            // SSE format: "data: ..." or "data:..." (space is optional)
            if (!trimmed.startsWith('data:')) continue;

            // Extract data after "data:" (handle both "data: " and "data:")
            const data = trimmed.slice(5).trimStart();
            if (data === '[DONE]') {
              yield { type: 'done' };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

              // Handle Kimi's interleaved thinking + content
              // reasoning_content = chain-of-thought, content = final response
              if (delta?.reasoning_content) {
                yield { type: 'reasoning', content: delta.reasoning_content };
              }
              if (delta?.content) {
                yield { type: 'token', content: delta.content };
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const existing = currentToolCalls[tc.index];
                  if (existing) {
                    existing.function.arguments += tc.function?.arguments || '';
                  } else {
                    currentToolCalls[tc.index] = {
                      id: tc.id,
                      type: 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || '',
                      },
                    };
                  }
                }
              }

              if (parsed.choices?.[0]?.finish_reason === 'tool_calls') {
                for (const tc of currentToolCalls) {
                  yield { type: 'tool_call', toolCall: tc };
                }
                currentToolCalls = [];
              }

              if (parsed.usage) {
                yield {
                  type: 'done',
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                  },
                };
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }

        return;
      } catch (error) {
        retries++;
        if (retries >= this.config.maxRetries) {
          yield {
            type: 'error',
            content: error instanceof Error ? error.message : 'Unknown error',
          };
          return;
        }
        await this.delay(1000 * Math.pow(2, retries));
      }
    }
  }

  async complete(
    messages: Message[],
    options?: { maxTokens?: number; temperature?: number; responseFormat?: { type: string } }
  ): Promise<{
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: ToolCall[];
      };
    }>;
    usage?: {
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
    };
  }> {
    const url = `${this.config.baseUrl}/chat/completions`;
    
    // Map model names for kimi-for-coding endpoint (same as stream())
    let modelName = this.config.model;
    if (this.config.baseUrl.includes('api.kimi.com')) {
      const codingEndpointModels = ['kimi-k2-5', 'kimi-k2-6', 'kimi-k2-6-preview', 'kimi-k2-turbo-preview', 'kimi-latest'];
      if (codingEndpointModels.includes(modelName)) {
        modelName = 'kimi-for-coding';
      }
    }
    
    const body: any = {
      model: modelName,
      messages,
      stream: false,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
    };
    
    if (options?.responseFormat) {
      body.response_format = options.responseFormat;
    }

    // Determine User-Agent based on endpoint
    const isKimiCoding = this.config.baseUrl.includes('api.kimi.com');
    const userAgent = isKimiCoding 
      ? 'KimiCLI/1.0'  // Required for api.kimi.com/coding/v1
      : 'Horus/0.1.0';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'User-Agent': userAgent,
        'X-Session-Id': this.sessionId,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kimi API error: ${response.status} ${error}`);
    }

    return await response.json() as {
      choices: Array<{ message: { content?: string; tool_calls?: ToolCall[] } }>;
      usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
    };
  }

  private async handleError(response: Response): Promise<{ message: string; retryable: boolean }> {
    const text = await response.text();
    
    switch (response.status) {
      case 429:
        return { message: `Rate limited: ${text}`, retryable: true };
      case 413:
        return { message: `Context too long: ${text}`, retryable: false };
      case 500:
      case 502:
      case 503:
        return { message: `Server error: ${text}`, retryable: true };
      case 401:
        return { message: `Authentication failed: ${text}`, retryable: false };
      case 400:
        return { message: `Bad request: ${text}`, retryable: false };
      default:
        return { message: `HTTP ${response.status}: ${text}`, retryable: response.status >= 500 };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
