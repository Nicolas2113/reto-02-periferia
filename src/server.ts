import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as exports from './tools/contratos.js';
import { UnconfiguredAdapter, type LlmAdapter, type ModelMessage, type ModelToolCall, type ToolDefinition } from './llm/adapter.js';
import { OllamaAdapter } from './llm/ollama.js';

type JsonObject = Record<string, unknown>;
interface Tool {
  description: string; args: z.ZodRawShape;
  execute(args: JsonObject, ctx: { directory: string; sessionId: string; hoy?: string }): Promise<string>;
}
export type ToolRegistry = Record<string, Tool>;
export interface Trace { name: string; arguments: JsonObject; result: unknown }
interface Pending { id: string; turn: number; messageId: string; contract: JsonObject; fields: string[] }
interface Session {
  id: string; messages: ModelMessage[]; history: { role: string; content: string; toolCalls?: Trace[] }[];
  contracts: Map<string, JsonObject>; nonContracts: Set<string>; pending?: Pending; turn: number; spent: number; busy: boolean;
}
export interface Limits { iterations: number; sessionTokens: number; outputTokens: number; timeoutMs: number; sessions: number }
const defaults: Limits = { iterations: 25, sessionTokens: 120000, outputTokens: 2048, timeoutMs: 90000, sessions: 50 };
const correctionSchema = z.object({
  valor: z.number().finite().nonnegative().optional(), moneda: z.enum(['COP', 'USD', 'PEN', 'PAB', 'HNL']).optional(),
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requiere_poliza: z.boolean().optional(), tipo_poliza: z.string().max(200).optional(),
}).strict();
const chatSchema = z.object({
  sessionId: z.string().uuid().optional(), message: z.string().min(1).max(12000),
  confirmation: z.object({ pendingId: z.string().uuid(), approved: z.literal(true), corrections: correctionSchema.default({}) }).strict().optional(),
}).strict();
export type ChatInput = z.infer<typeof chatSchema>;
const responseSchema = z.object({ content: z.string(), toolCalls: z.array(z.object({
  id: z.string(), name: z.string(), args: z.record(z.unknown()),
})).max(25), usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).optional(),
  diagnostics: z.object({ doneReason: z.string().optional(), contextTokens: z.number().optional(), outputLimit: z.number().optional() }).optional() });
const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() }),
]);
const object = (value: unknown): JsonObject | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
const clone = (value: JsonObject): JsonObject => structuredClone(value);

// Solo la conversación del modelo se compacta; contratos internos y trazas conservan toda evidencia.
export function compactToolResult(value: unknown): string {
  const remove = new Set(['confianza', 'evidencias', 'contrato_normalizado']);
  return JSON.stringify(value, (key: string, item: unknown) => {
    if (remove.has(key)) return undefined;
    const data = object(item), confidence = data ? object(data.confianza) : undefined;
    return confidence ? { ...data, campos_baja_confianza: Object.entries(confidence).filter(([, score]) => typeof score === 'number' && score < 0.8).map(([field]) => field) } : item;
  });
}

function registry(): ToolRegistry {
  return Object.fromEntries(Object.entries(exports).flatMap(([name, value]) => {
    const candidate: unknown = value;
    if (!candidate || typeof candidate !== 'object' || !('execute' in candidate) || !('args' in candidate) || !('description' in candidate)) return [];
    return [[`contratos_${name}`, candidate as Tool]];
  }));
}
function definitions(tools: ToolRegistry): ToolDefinition[] {
  return Object.entries(tools).map(([name, tool]) => {
    // El modelo elige el mensaje; el backend aporta el contrato real obtenido de herramientas.
    const args = Object.fromEntries(Object.entries(tool.args).filter(([field]) => field !== 'contrato' && field !== 'confirmado'));
    return { name, description: tool.description, parameters: z.object(args).strict() };
  });
}

export class AgentEngine {
  private readonly sessions = new Map<string, Session>();
  private readonly limits: Limits;
  private readonly tools: ToolRegistry;
  private readonly catalog: ToolDefinition[];
  constructor(private readonly options: { directory: string; adapter: LlmAdapter; prompt: string; tools?: ToolRegistry; limits?: Partial<Limits> }) {
    this.limits = { ...defaults, ...options.limits };
    this.tools = options.tools ?? registry(); this.catalog = definitions(this.tools);
    for (const value of Object.values(this.limits)) if (!Number.isInteger(value) || value <= 0) throw new Error('Límites inválidos');
  }
  health() { return { ok: true, provider: this.options.adapter.provider, model: this.options.adapter.model, configured: this.options.adapter.configured }; }
  session(id: string) {
    const current = this.sessions.get(id);
    return current ? { id, history: current.history, pending: this.publicPending(current), budget: { consumed: current.spent, limit: this.limits.sessionTokens } } : null;
  }
  private publicPending(session: Session) {
    const pending = session.pending;
    return pending ? { id: pending.id, mensaje_id: pending.messageId, fields: pending.fields, contract: pending.contract } : null;
  }
  private async trace(session: Session, name: string, args: JsonObject, result: unknown, traces: Trace[]): Promise<void> {
    traces.push({ name, arguments: clone(args), result });
    const output = path.join(this.options.directory, 'out');
    for (const candidate of [output, path.join(output, 'log.jsonl')]) {
      try { if ((await lstat(candidate)).isSymbolicLink()) throw new Error('Salida enlazada no permitida'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    await mkdir(output, { recursive: true });
    const envelope = envelopeSchema.safeParse(result);
    await appendFile(path.join(output, 'log.jsonl'), JSON.stringify({
      ts: new Date().toISOString(), herramienta: name, mensaje_id: typeof args.mensaje_id === 'string' ? args.mensaje_id : null,
      ok: envelope.success && envelope.data.ok, resumen: 'Llamada del ciclo de chat', sessionId: session.id,
    }) + '\n');
  }
  private async invoke(session: Session, name: string, args: JsonObject, traces: Trace[]): Promise<unknown> {
    let result: unknown;
    const tool = this.tools[name];
    if (!tool) result = { ok: false, error: 'Herramienta desconocida' };
    else {
      const parsed = z.object(tool.args).strict().safeParse(args);
      if (!parsed.success) result = { ok: false, error: `Argumentos inválidos: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}` };
      else {
        try { result = envelopeSchema.parse(JSON.parse(await tool.execute(parsed.data, { directory: this.options.directory, sessionId: session.id })) as unknown); }
        catch { result = { ok: false, error: 'La herramienta no pudo completar la operación; la sesión sigue disponible' }; }
      }
    }
    await this.trace(session, name, args, result, traces);
    const envelope = envelopeSchema.safeParse(result);
    const data = envelope.success && envelope.data.ok ? object(envelope.data.data) : undefined;
    const id = typeof args.mensaje_id === 'string' ? args.mensaje_id : undefined;
    if (data && name === 'contratos_leer_buzon' && Array.isArray(data.mensajes)) {
      for (const raw of data.mensajes) { const mail = object(raw); if (mail?.tiene_contrato === false && typeof mail.id === 'string') session.nonContracts.add(mail.id); }
    }
    if (id && data && name === 'contratos_extraer') session.contracts.set(id, clone(data));
    if (id && data && name === 'contratos_validar') {
      const normalized = object(data.contrato_normalizado);
      if (normalized) session.contracts.set(id, clone(normalized));
      const fields = Array.isArray(data.requiere_revision) ? data.requiere_revision.filter((field): field is string => typeof field === 'string') : [];
      if (fields.length && normalized) session.pending = { id: randomUUID(), turn: session.turn, messageId: id, contract: clone(normalized), fields };
    }
    return result;
  }
  private question(session: Session): string {
    const pending = session.pending;
    return pending ? `Necesito confirmación humana para ${pending.messageId}: ${pending.fields.join(', ')}. Revise los valores mostrados y complete los ausentes en el formulario antes de confirmar. No se ha registrado este contrato.` : 'No hay confirmación pendiente.';
  }
  private async modelCall(session: Session): Promise<z.infer<typeof responseSchema>> {
    const bytes = Buffer.byteLength(JSON.stringify(session.messages) + JSON.stringify(this.catalog.map(tool => ({ name: tool.name, description: tool.description }))));
    const reserve = bytes + this.limits.outputTokens;
    if (session.spent + reserve > this.limits.sessionTokens) throw new Error('budget');
    // Reserva conservadora: bytes de texto son una cota operativa, no facturación exacta.
    session.spent += reserve;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = responseSchema.parse(await Promise.race([
        this.options.adapter.enviar(session.messages, this.catalog, { signal: controller.signal, maxOutputTokens: this.limits.outputTokens }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, this.limits.timeoutMs); }),
      ]));
      const actual = response.usage ? response.usage.inputTokens + response.usage.outputTokens : 0;
      if (Number.isSafeInteger(actual) && actual > 0) session.spent += actual - reserve;
      // Sin consumo informado, con cero o timeout se conserva la reserva; no se presume costo cero.
      if (session.spent > this.limits.sessionTokens) throw new Error('budget');
      await mkdir(path.join(this.options.directory, 'out'), { recursive: true });
      await appendFile(path.join(this.options.directory, 'out', 'log.jsonl'), JSON.stringify({
        ts: new Date().toISOString(), tipo: 'llm', sessionId: session.id,
        provider: this.options.adapter.provider, model: this.options.adapter.model,
        usage: response.usage ?? null, diagnostics: response.diagnostics ?? null,
      }) + '\n');
      return response;
    } finally { if (timer) clearTimeout(timer); }
  }
  private async perform(session: Session, call: ModelToolCall, traces: Trace[]): Promise<unknown> {
    let args = clone(call.args);
    if (call.name === 'contratos_validar' || call.name === 'contratos_registrar') {
      const id = typeof args.mensaje_id === 'string' ? args.mensaje_id : '';
      const contract = session.contracts.get(id);
      if (!contract && !session.nonContracts.has(id)) {
        const result = { ok: false, error: 'Primero debe extraer el contrato mediante contratos_extraer; el modelo no puede aportar datos inventados' };
        await this.trace(session, call.name, { mensaje_id: id }, result, traces); return result;
      }
      args = { mensaje_id: id, contrato: contract ? clone(contract) : null };
      if (call.name === 'contratos_registrar') {
        const validation = envelopeSchema.safeParse(await this.invoke(session, 'contratos_validar', args, traces));
        if (!validation.success || !validation.data.ok) return validation.success ? validation.data : { ok: false, error: 'Validación fallida' };
        if (session.pending) return { ok: false, error: 'Requiere confirmación humana en el siguiente turno' };
        args.confirmado = false;
      }
    }
    return this.invoke(session, call.name, args, traces);
  }
  private async confirm(session: Session, input: ChatInput, traces: Trace[]): Promise<string> {
    const pending = session.pending;
    if (!pending) return 'No hay una confirmación pendiente; solicite procesar o validar un contrato primero.';
    const explicitText = /^\s*(?:confirmo|s[ií],?\s+confirmo)[.!]?\s*$/i.test(input.message);
    const approved = input.confirmation?.approved === true || explicitText;
    const validId = !input.confirmation || input.confirmation.pendingId === pending.id;
    if (!approved || !validId || pending.turn !== session.turn - 1) {
      pending.turn = session.turn; pending.id = randomUUID(); return this.question(session);
    }
    const corrected = clone(pending.contract);
    const corrections = input.confirmation?.corrections ?? {};
    const confidence = object(corrected.confianza), evidence = object(corrected.evidencias);
    for (const [field, value] of Object.entries(corrections)) {
      corrected[field] = value;
      if (confidence) confidence[field] = 1;
      if (evidence) evidence[field] = 'Dato aportado explícitamente por la persona en la confirmación';
    }
    session.pending = undefined;
    session.contracts.set(pending.messageId, corrected);
    const args = { mensaje_id: pending.messageId, contrato: corrected };
    const validation = await this.invoke(session, 'contratos_validar', args, traces);
    const check = envelopeSchema.safeParse(validation);
    if (!check.success || !check.data.ok) {
      session.pending = { ...pending, id: randomUUID(), turn: session.turn, contract: corrected };
      return 'La corrección no pasó la validación; revise el resultado y corrija el formulario. No se registró.';
    }
    const normalized = session.contracts.get(pending.messageId) ?? corrected;
    if (['valor', 'moneda', 'fecha_inicio', 'fecha_fin', 'requiere_poliza', 'tipo_poliza'].some(field => normalized[field] !== corrected[field])) {
      session.pending = { ...pending, id: randomUUID(), turn: session.turn, contract: clone(normalized) };
      return 'La validación cambió valores respecto a lo revisado. Confirme el nuevo formulario antes de registrar.';
    }
    // La aprobación pertenece a este turno humano y este snapshot; no pasa por el modelo.
    session.pending = undefined;
    const result = await this.invoke(session, 'contratos_registrar', {
      mensaje_id: pending.messageId, contrato: session.contracts.get(pending.messageId) ?? corrected, confirmado: true,
    }, traces);
    const registered = envelopeSchema.safeParse(result);
    if (registered.success && registered.data.ok) return 'La herramienta confirmó el registro solicitado. Puede continuar con el buzón o pedir las alertas.';
    session.pending = { ...pending, id: randomUUID(), turn: session.turn, contract: clone(normalized) };
    return 'No se registró: revise el error de la herramienta y aporte los datos válidos que faltan en el formulario.';
  }
  async chat(raw: unknown) {
    const input = chatSchema.parse(raw);
    let session = input.sessionId ? this.sessions.get(input.sessionId) : undefined;
    if (input.sessionId && !session) throw new Error('Sesión no encontrada');
    if (!session) {
      if (this.sessions.size >= this.limits.sessions) throw new Error('Se alcanzó el límite de sesiones de esta instancia');
      session = { id: randomUUID(), messages: [{ role: 'system', content: this.options.prompt }], history: [], contracts: new Map(), nonContracts: new Set(), turn: 0, spent: 0, busy: false };
      this.sessions.set(session.id, session);
    }
    if (session.busy) throw new Error('Espere a que termine el turno actual');
    session.busy = true; session.turn++;
    const traces: Trace[] = [];
    session.messages.push({ role: 'user', content: input.message }); session.history.push({ role: 'user', content: input.message });
    let reply = '';
    const operational = /^\s*(?:por favor[,;:]?\s*)?(?:procesa|lista|consulta|lee|extrae|valida|registra|genera|muestra|revisa)\b/i.test(input.message);
    let guidedRetry = false;
    try {
      if (session.pending || input.confirmation) reply = await this.confirm(session, input, traces);
      else if (!this.options.adapter.configured) reply = 'Falta configurar un proveedor LLM. La demo determinista funciona sin modelo; el chat no simula un LLM.';
      else {
        for (let iteration = 0; iteration < this.limits.iterations; iteration++) {
          const response = await this.modelCall(session);
          session.messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
          if (!response.toolCalls.length) {
            if (response.diagnostics?.doneReason === 'length') {
              session.messages.push({ role: 'user', content: 'La salida anterior alcanzó el límite de tokens. Continúa usando herramientas desde el último resultado confirmado; no repitas registros ni vuelvas a narrar el contrato completo.' });
              continue;
            }
            if (operational && traces.length === 0) {
              if (!guidedRetry) {
                guidedRetry = true;
                session.messages.push({ role: 'user', content: 'La petición anterior solicita una operación real. Todavía no has llamado ninguna herramienta. Ejecuta ahora la primera herramienta correspondiente a esa petición; un plan escrito no ejecuta acciones. Mantén las validaciones y la confirmación humana obligatorias. Si no puedes ejecutar, dilo sin afirmar resultados.' });
                continue;
              }
              reply = 'El modelo respondió con texto pero no ejecutó ninguna herramienta. No se ha procesado esta solicitud. Puede pedir una operación concreta, como listar los mensajes pendientes.'; break;
            }
            reply = response.content || 'El modelo no devolvió texto ni llamadas de herramienta.'; break;
          }
          for (const call of response.toolCalls) {
            const result = await this.perform(session, call, traces);
            session.messages.push({ role: 'tool', content: compactToolResult(result), toolCallId: call.id });
            if (session.pending) break;
          }
          if (session.pending) { reply = this.question(session); break; }
        }
        if (!reply) reply = 'Alcancé el límite de iteraciones. Revise las herramientas ejecutadas; quedan acciones pendientes que puede solicitar en otro turno.';
      }
    } catch (error) {
      reply = error instanceof Error && error.message === 'timeout' ? 'El modelo tardó demasiado. La sesión se conserva; puede intentar otra vez.'
        : error instanceof Error && error.message === 'budget' ? 'Se alcanzó el presupuesto de esta sesión. Revise los resultados obtenidos.'
        : 'No se pudo completar el turno del modelo o herramienta. La sesión se conserva; revise la configuración local y vuelva a intentar.';
    } finally { session.busy = false; }
    session.messages.push({ role: 'assistant', content: reply }); session.history.push({ role: 'assistant', content: reply, toolCalls: traces });
    return { sessionId: session.id, reply, toolCalls: traces, needsConfirmation: Boolean(session.pending), pending: this.publicPending(session) };
  }
}

function limit(name: string, fallback: number): number { const raw = process.env[name]; return raw ? Number(raw) : fallback; }
export async function createApplication(options: { directory: string; adapter?: LlmAdapter; tools?: ToolRegistry; limits?: Partial<Limits> }): Promise<{ server: Server; engine: AgentEngine }> {
  const prompt = await readFile(path.join(options.directory, 'agent', 'prompt.md'), 'utf8');
  const knowledge = await readFile(path.join(options.directory, 'src', 'knowledge', 'registro-contratos.md'), 'utf8');
  const adapter = options.adapter ?? (process.env.LLM_PROVIDER === 'disabled' ? new UnconfiguredAdapter() : new OllamaAdapter());
  const engine = new AgentEngine({ ...options, adapter, prompt: `${prompt}\n\n${knowledge}` });
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/health') return send(200, engine.health());
      if (request.method === 'GET' && /^\/api\/sessions\/[a-f0-9-]+$/.test(url.pathname)) {
        const session = engine.session(url.pathname.split('/').at(-1) ?? ''); return send(session ? 200 : 404, session ?? { error: 'Sesión no encontrada' });
      }
      if (request.method === 'POST' && url.pathname === '/api/chat') {
        let body = ''; for await (const chunk of request) { body += String(chunk); if (Buffer.byteLength(body) > 1000000) return send(413, { error: 'Solicitud demasiado grande' }); }
        return send(200, await engine.chat(JSON.parse(body) as unknown));
      }
      if (request.method === 'GET' && url.pathname === '/') {
        const html = await readFile(path.join(options.directory, 'web', 'index.html'), 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html); return;
      }
      send(404, { error: 'Ruta no encontrada' });
    } catch (error) { send(400, { error: error instanceof z.ZodError || error instanceof SyntaxError ? 'Solicitud no válida' : 'No se pudo completar la solicitud; revise sesión y configuración local' }); }
  });
  return { server, engine };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { server } = await createApplication({ directory: process.cwd(), limits: {
    iterations: limit('MAX_ITERATIONS', defaults.iterations), sessionTokens: limit('MAX_SESSION_TOKENS', defaults.sessionTokens),
    outputTokens: limit('MAX_OUTPUT_TOKENS', defaults.outputTokens), timeoutMs: limit('LLM_TIMEOUT_MS', defaults.timeoutMs), sessions: limit('MAX_SESSIONS', defaults.sessions),
  } });
  const port = limit('PORT', 3000);
  server.listen(port, '127.0.0.1', () => console.log(`Chat local: http://127.0.0.1:${port}`));
}
