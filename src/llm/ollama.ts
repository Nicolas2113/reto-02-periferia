import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LlmAdapter, ModelMessage, ModelOptions, ModelResponse, ToolDefinition } from './adapter.js';

// Conversión mínima para los esquemas zod usados por estas herramientas, sin dependencia adicional.
export function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  let result: Record<string, unknown>;
  if (schema instanceof z.ZodEffects) result = jsonSchema(schema.innerType());
  else if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) result = jsonSchema(schema._def.innerType);
  else if (schema instanceof z.ZodNullable) result = { anyOf: [jsonSchema(schema.unwrap()), { type: 'null' }] };
  else if (schema instanceof z.ZodObject) {
    const shape: z.ZodRawShape = schema.shape;
    result = { type: 'object', properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, jsonSchema(value)])),
      required: Object.entries(shape).filter(([, value]) => !value.isOptional()).map(([key]) => key), additionalProperties: false };
  } else if (schema instanceof z.ZodArray) result = { type: 'array', items: jsonSchema(schema.element) };
  else if (schema instanceof z.ZodRecord) result = { type: 'object', additionalProperties: jsonSchema(schema._def.valueType) };
  else if (schema instanceof z.ZodEnum) result = { type: 'string', enum: schema.options };
  else if (schema instanceof z.ZodLiteral) result = { const: schema.value };
  else if (schema instanceof z.ZodUnion) result = { anyOf: (schema.options as z.ZodTypeAny[]).map(jsonSchema) };
  else if (schema instanceof z.ZodString) result = { type: 'string' };
  else if (schema instanceof z.ZodNumber) result = { type: 'number' };
  else if (schema instanceof z.ZodBoolean) result = { type: 'boolean' };
  else if (schema instanceof z.ZodNull) result = { type: 'null' };
  else result = {};
  if (schema.description) result.description = schema.description;
  return result;
}
const ollamaResponse = z.object({
  done_reason: z.string().optional(),
  message: z.object({ content: z.string().default(''), tool_calls: z.array(z.object({
    function: z.object({ name: z.string(), arguments: z.union([z.record(z.unknown()), z.string()]) }),
  })).optional() }), prompt_eval_count: z.number().nonnegative().optional(), eval_count: z.number().nonnegative().optional(),
});

export class OllamaAdapter implements LlmAdapter {
  readonly provider = 'ollama';
  readonly configured = true;
  readonly model: string;
  private readonly url: string;
  private readonly context: number;
  constructor(options: { baseUrl?: string; model?: string; context?: number } = {}) {
    const base = new URL(options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434');
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('Ollama debe usar una URL HTTP de loopback 127.0.0.1 sin credenciales');
    }
    this.url = new URL('/api/chat', base).toString();
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? 'qwen3.5:4b';
    if (/cloud/i.test(this.model)) throw new Error('Solo modelos locales; cloud no está autorizado');
    this.context = options.context ?? Number(process.env.OLLAMA_NUM_CTX ?? 8192);
    if (!Number.isInteger(this.context) || this.context < 2048 || this.context > 32768) throw new Error('Contexto Ollama fuera de rango');
  }
  async enviar(messages: ModelMessage[], tools: ToolDefinition[], options: ModelOptions): Promise<ModelResponse> {
    const callNames = new Map(messages.flatMap(message => (message.toolCalls ?? []).map(call => [call.id, call.name])));
    const payload = {
      model: this.model, stream: false, think: false,
      options: { temperature: 0, num_predict: options.maxOutputTokens, num_ctx: this.context },
      messages: messages.map(message => ({ role: message.role, content: message.content,
        ...(message.toolCallId ? { tool_name: callNames.get(message.toolCallId) ?? '' } : {}),
        ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ type: 'function', function: { name: call.name, arguments: call.args } })) } : {}),
      })),
      tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: jsonSchema(tool.parameters) } })),
    };
    const response = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: options.signal });
    if (!response.ok) throw new Error(`Ollama devolvió HTTP ${response.status}; revise modelo local y compatibilidad de herramientas`);
    const result = ollamaResponse.parse(await response.json() as unknown);
    return { content: result.message.content, toolCalls: (result.message.tool_calls ?? []).map(call => {
      const args: unknown = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) as unknown : call.function.arguments;
      return { id: randomUUID(), name: call.function.name, args: z.record(z.unknown()).parse(args) };
    }), usage: { inputTokens: result.prompt_eval_count ?? 0, outputTokens: result.eval_count ?? 0 },
      diagnostics: { doneReason: result.done_reason, contextTokens: this.context, outputLimit: options.maxOutputTokens } };
  }
}
