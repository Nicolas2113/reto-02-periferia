import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
}
export interface ModelToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  providerContent?: Record<string, unknown>;
}
export interface ModelResponse {
  providerContent?: Record<string, unknown>;
  content: string;
  toolCalls: ModelToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  diagnostics?: { doneReason?: string; contextTokens?: number; outputLimit?: number };
}
export interface ModelOptions { signal: AbortSignal; maxOutputTokens: number }
export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  readonly configured: boolean;
  enviar(messages: ModelMessage[], tools: ToolDefinition[], options: ModelOptions): Promise<ModelResponse>;
}

export class UnconfiguredAdapter implements LlmAdapter {
  readonly provider = 'sin_configurar';
  readonly model = 'sin_configurar';
  readonly configured = false;
  async enviar(_messages: ModelMessage[], _tools: ToolDefinition[], _options: ModelOptions): Promise<ModelResponse> {
    throw new Error('Proveedor LLM no configurado');
  }
}
