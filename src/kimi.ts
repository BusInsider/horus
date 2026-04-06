// Kimi API client with streaming support

export interface KimiConfig {
  apiKey: string;
  baseUrl: string;
  model: 'kimi-k2-5' | 'kimi-latest';
  maxRetries?: number;
  timeoutMs?: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
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
  type: 'token' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export class KimiClient {
  private config: Required<KimiConfig>;

  constructor(config: KimiConfig) {
    this.config = {
      maxRetries: 3,
      timeoutMs: 120000,
      ...config,
    };
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    options?: { temperature?: number; maxTokens?: number }
  ): AsyncGenerator<StreamChunk> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = {
      model: this.config.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    };

    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              yield { type: 'done' };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

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
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = {
      model: this.config.model,
      messages,
      stream: false,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 500,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kimi API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
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
