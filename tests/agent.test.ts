import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AgentEngine, createApplication, compactToolResult, type ToolRegistry } from '../src/server.js';
import { UnconfiguredAdapter, type LlmAdapter, type ModelResponse } from '../src/llm/adapter.js';
import { OllamaAdapter, jsonSchema } from '../src/llm/ollama.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = path.join(root, 'out');
const call = (name: string, args: Record<string, unknown> = {}) => ({ id: String(Math.random()), name, args });
class FakeAdapter implements LlmAdapter {
  readonly provider = 'fake_solo_pruebas'; readonly model = 'fake'; readonly configured = true;
  calls = 0;
  constructor(private readonly response: (index: number) => Promise<ModelResponse> | ModelResponse) {}
  async enviar(): Promise<ModelResponse> { return this.response(this.calls++); }
}
async function isolated(action: (directory: string) => Promise<void>): Promise<void> {
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'agent-test-'));
  try { await action(directory); }
  finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(output) + path.sep)); assert.ok(path.basename(target).startsWith('agent-test-'));
    await rm(target, { recursive: true, force: true });
  }
}
function fakeTools() {
  const state: { writes: number; last: Record<string, unknown> | null } = { writes: 0, last: null };
  const contract = { valor: 0, moneda: null, fecha_inicio: null, fecha_fin: null, requiere_poliza: null, tipo_poliza: 'cumplimiento',
    confianza: { valor: 0.5, moneda: 0, fecha_inicio: 0, fecha_fin: 0, requiere_poliza: 0 }, evidencias: {} };
  const args = { mensaje_id: z.string().describe('ID'), contrato: z.record(z.unknown()).describe('Contrato') };
  const tools: ToolRegistry = {
    contratos_leer_buzon: { description: 'Leer', args: {}, async execute() { return JSON.stringify({ ok: true, data: { mensajes: [] } }); } },
    contratos_extraer: { description: 'Extraer', args: { mensaje_id: z.string().describe('ID') }, async execute() { return JSON.stringify({ ok: true, data: contract }); } },
    contratos_validar: { description: 'Validar', args, async execute(input) {
      const value = input.contrato as Record<string, unknown>;
      return JSON.stringify({ ok: true, data: { clasificacion: 'nuevo', requiere_revision: value.moneda === null ? ['valor', 'moneda', 'fecha_inicio', 'fecha_fin', 'requiere_poliza'] : [], contrato_normalizado: value } });
    } },
    contratos_registrar: { description: 'Registrar', args: { ...args, confirmado: z.boolean().optional().describe('Confirmado') }, async execute(input) {
      if (!input.confirmado) return JSON.stringify({ ok: false, error: 'Requiere revisión' });
      state.writes++; state.last = input; return JSON.stringify({ ok: true, data: { id_contrato: 'TEST', accion: 'nuevo' } });
    } },
  };
  return { tools, state };
}

test('CA3: el modelo no puede aprobar ni sustituir snapshot; siguiente turno humano sí', async () => {
  await isolated(async directory => {
    const { tools, state } = fakeTools();
    const adapter = new FakeAdapter(index => ({ content: '', toolCalls: index === 0
      ? [call('contratos_extraer', { mensaje_id: 'msg-006' })]
      : [call('contratos_registrar', { mensaje_id: 'msg-006', confirmado: true, contrato: { valor: 999999, confianza: { valor: 1 } } })] }));
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba de controles backend' });
    const first = await engine.chat({ message: 'Procesa' });
    assert.equal(first.needsConfirmation, true); assert.equal(state.writes, 0);
    assert.equal(first.pending?.contract.valor, 0); assert.ok(first.reply.includes('confirmación humana'));
    assert.ok(first.toolCalls.some(trace => trace.name === 'contratos_validar'));
    const second = await engine.chat({ sessionId: first.sessionId, message: 'Confirmo valores revisados', confirmation: {
      pendingId: first.pending?.id, approved: true, corrections: { valor: 0, moneda: 'COP', fecha_inicio: '2026-09-01', fecha_fin: '2027-08-31', requiere_poliza: false, tipo_poliza: '' },
    } });
    assert.equal(second.needsConfirmation, false); assert.equal(state.writes, 1);
    assert.equal(state.last?.confirmado, true);
    assert.equal((state.last?.contrato as Record<string, unknown>).valor, 0);
  });
});

test('CA3: confirmación de petición antigua o campos internos no autoriza registro', async () => {
  await isolated(async directory => {
    const { tools, state } = fakeTools();
    const adapter = new FakeAdapter(index => ({ content: '', toolCalls: [index === 0 ? call('contratos_extraer', { mensaje_id: 'msg-006' }) : call('contratos_validar', { mensaje_id: 'msg-006' })] }));
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba' });
    const first = await engine.chat({ message: 'Procesa' });
    const another = await engine.chat({ sessionId: first.sessionId, message: 'Explícame antes de confirmar' });
    assert.notEqual(another.pending?.id, first.pending?.id);
    const stale = await engine.chat({ sessionId: first.sessionId, message: 'Confirmo', confirmation: { pendingId: first.pending?.id, approved: true, corrections: {} } });
    assert.equal(stale.needsConfirmation, true); assert.equal(state.writes, 0);
    await assert.rejects(engine.chat({ sessionId: first.sessionId, message: 'Confirmo', confirmation: {
      pendingId: stale.pending?.id, approved: true, corrections: { confianza: { valor: 1 } },
    } }));
    assert.equal(state.writes, 0);
  });
});

test('6.2 y CA5: argumentos inválidos visibles; modelo continúa y sesión queda disponible', async () => {
  await isolated(async directory => {
    const { tools } = fakeTools();
    const adapter = new FakeAdapter(index => ({ content: index === 0 ? '' : 'Error comunicado; continúo.', toolCalls: index === 0 ? [call('contratos_leer_buzon', { ruta: '../otro' })] : [] }));
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba' });
    const result = await engine.chat({ message: 'Lee' });
    assert.equal((result.toolCalls[0]?.result as { ok: boolean }).ok, false);
    assert.match(result.reply, /continúo/);
    assert.equal(engine.session(result.sessionId)?.history.length, 2);
    assert.ok((await readFile(path.join(directory, 'out', 'log.jsonl'), 'utf8')).includes('contratos_leer_buzon'));
  });
});

test('CA1 y §8: tope de iteraciones, presupuesto y sesiones realmente limitan', async () => {
  await isolated(async directory => {
    const { tools } = fakeTools();
    const adapter = new FakeAdapter(() => ({ content: '', toolCalls: [call('contratos_leer_buzon')] }));
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba', limits: { iterations: 2, sessions: 1 } });
    const result = await engine.chat({ message: 'Lee' });
    assert.equal(adapter.calls, 2); assert.match(result.reply, /límite de iteraciones/);
    await assert.rejects(engine.chat({ message: 'Otra sesión' }), /límite de sesiones/);
    const budget = new FakeAdapter(() => ({ content: 'No debe ejecutarse', toolCalls: [] }));
    const tiny = new AgentEngine({ directory, adapter: budget, tools, prompt: 'Prueba', limits: { sessionTokens: 10 } });
    assert.match((await tiny.chat({ message: 'Lee' })).reply, /presupuesto/); assert.equal(budget.calls, 0);
  });
});

test('CA5: timeout y fallo del proveedor no matan la sesión ni revelan diagnóstico interno', async () => {
  await isolated(async directory => {
    const { tools } = fakeTools();
    const adapter = new FakeAdapter(index => index === 0 ? new Promise<ModelResponse>(() => {}) : { content: 'Recuperado', toolCalls: [] });
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba', limits: { timeoutMs: 15 } });
    const first = await engine.chat({ message: 'Lee' }); assert.match(first.reply, /tardó demasiado/);
    assert.equal((await engine.chat({ sessionId: first.sessionId, message: 'Reintenta' })).reply, 'Recuperado');
    const faulty = new AgentEngine({ directory, adapter: new FakeAdapter(() => { throw new Error('diagnóstico privado interno'); }), tools, prompt: 'Prueba' });
    assert.ok(!(await faulty.chat({ message: 'Lee' })).reply.includes('diagnóstico privado'));
    const missing = new AgentEngine({ directory, adapter: new UnconfiguredAdapter(), tools, prompt: 'Prueba' });
    assert.match((await missing.chat({ message: 'Lee' })).reply, /no simula un LLM/);
  });
});

test('Adaptador Ollama: esquema preserva descripción y solo permite loopback/modelo local', () => {
  const schema = jsonSchema(z.object({ mensaje_id: z.string().describe('ID del mensaje') }));
  assert.equal(((schema.properties as Record<string, Record<string, unknown>>).mensaje_id)?.description, 'ID del mensaje');
  assert.throws(() => new OllamaAdapter({ baseUrl: 'https://example.com' }), /loopback/);
  assert.throws(() => new OllamaAdapter({ model: 'modelo:cloud' }), /cloud/);
});

test('API/health y chat HTTP: frontend servido, historial y solicitudes inválidas', async () => {
  await isolated(async directory => {
    await cp(path.join(root, 'agent'), path.join(directory, 'agent'), { recursive: true });
    await cp(path.join(root, 'src', 'knowledge'), path.join(directory, 'src', 'knowledge'), { recursive: true });
    await cp(path.join(root, 'web'), path.join(directory, 'web'), { recursive: true });
    const { tools } = fakeTools();
    const { server } = await createApplication({ directory, tools, adapter: new FakeAdapter(() => ({ content: 'Respuesta fake de prueba', toolCalls: [] })) });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}`;
      const health = await (await fetch(base + '/api/health')).json() as Record<string, unknown>;
      assert.equal(health.provider, 'fake_solo_pruebas'); assert.ok(!('key' in health));
      assert.match(await (await fetch(base)).text(), /Revisión humana requerida/);
      const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hola' }) });
      const data = await response.json() as Record<string, unknown>;
      assert.equal(data.reply, 'Respuesta fake de prueba');
      assert.equal((await fetch(base + '/api/sessions/' + String(data.sessionId))).status, 200);
      assert.equal((await fetch(base + '/api/chat', { method: 'POST', body: '{' })).status, 400);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

test('CA3: validación humana fallida mantiene formulario y nunca intenta registrar', async () => {
  await isolated(async directory => {
    const { tools, state } = fakeTools();
    const valid = tools.contratos_validar;
    assert.ok(valid);
    const original = valid.execute;
    valid.execute = async (args, ctx) => {
      const contract = args.contrato as Record<string, unknown>;
      return contract.fecha_inicio === '2026-99-99' ? JSON.stringify({ ok: false, error: 'Fecha inválida' }) : original(args, ctx);
    };
    const adapter = new FakeAdapter(index => ({ content: '', toolCalls: [index === 0 ? call('contratos_extraer', { mensaje_id: 'msg-006' }) : call('contratos_validar', { mensaje_id: 'msg-006' })] }));
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba de validación' });
    const first = await engine.chat({ message: 'Procesa' });
    const invalid = await engine.chat({ sessionId: first.sessionId, message: 'Confirmo datos', confirmation: {
      pendingId: first.pending?.id, approved: true, corrections: { moneda: 'COP', fecha_inicio: '2026-99-99' },
    } });
    assert.equal(state.writes, 0); assert.equal(invalid.needsConfirmation, true);
    assert.ok(!invalid.toolCalls.some(trace => trace.name === 'contratos_registrar'));
    assert.match(invalid.reply, /no pasó la validación/);
  });
});

test('CA3: texto que propone valor distinto no aprueba silenciosamente el snapshot anterior', async () => {
  await isolated(async directory => {
    const { tools, state } = fakeTools();
    const adapter = new FakeAdapter(index => ({ content: '', toolCalls: [index === 0 ? call('contratos_extraer', { mensaje_id: 'msg-006' }) : call('contratos_validar', { mensaje_id: 'msg-006' })] }));
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba de intención humana' });
    const first = await engine.chat({ message: 'Procesa' });
    const changed = await engine.chat({ sessionId: first.sessionId, message: 'confirmo valor 999' });
    assert.equal(state.writes, 0); assert.equal(changed.needsConfirmation, true);
    assert.equal(changed.pending?.contract.valor, 0);
    assert.ok(!changed.toolCalls.some(trace => trace.name === 'contratos_registrar'));
    assert.notEqual(changed.pending?.id, first.pending?.id);
  });
});

test('§8: contabiliza tokens reales positivos y conserva reserva si proveedor informa cero', async () => {
  await isolated(async directory => {
    const entry = fakeTools().tools.contratos_leer_buzon;
    assert.ok(entry);
    const tools = { contratos_leer_buzon: entry };
    const adapter = new FakeAdapter(index => index === 0
      ? { content: '', toolCalls: [call('contratos_leer_buzon')], usage: { inputTokens: 10, outputTokens: 5 } }
      : { content: 'Resultado', toolCalls: [], usage: { inputTokens: 20, outputTokens: 5 } });
    const engine = new AgentEngine({ directory, adapter, tools, prompt: 'Prueba', limits: { sessionTokens: 3000, outputTokens: 32 } });
    const result = await engine.chat({ message: 'Lee' });
    assert.equal(result.reply, 'Resultado'); assert.equal(adapter.calls, 2);
    assert.equal(engine.session(result.sessionId)?.budget.consumed, 40);
    const zero = new AgentEngine({ directory, tools, prompt: 'Prueba', adapter: new FakeAdapter(() => ({
      content: 'Sin conteo fiable', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 },
    })), limits: { outputTokens: 32 } });
    const response = await zero.chat({ message: 'Lee' });
    assert.ok((zero.session(response.sessionId)?.budget.consumed ?? 0) > 0);
  });
});


test('§8: compacta solo contexto del modelo, mantiene incertidumbres y continúa salida length acotada', async () => {
  const original = { ok: true, data: { valor: null, confianza: { valor: 0 }, evidencias: { valor: 'Ausente' }, advertencias: ['No inventar'], requiere_revision: ['valor'] } };
  const compact = JSON.parse(compactToolResult(original)) as {data: Record<string, unknown>};
  assert.equal(compact.data.evidencias, undefined); assert.equal(compact.data.confianza, undefined);
  assert.deepEqual(compact.data.campos_baja_confianza, ['valor']); assert.deepEqual(compact.data.advertencias, ['No inventar']);
  assert.equal(original.data.evidencias.valor, 'Ausente');
  await isolated(async directory => {
    const adapter = new FakeAdapter(index => ({ content: index === 0 ? 'Truncado' : 'Continuado', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 }, diagnostics: { doneReason: index === 0 ? 'length' : 'stop', outputLimit: 2048, contextTokens: 8192 } }));
    const engine = new AgentEngine({ directory, adapter, tools: {}, prompt: 'Prueba', limits: {iterations: 2} });
    const result = await engine.chat({message: 'Explica el flujo'}); assert.equal(result.reply, 'Continuado'); assert.equal(adapter.calls, 2);
    assert.ok((await readFile(path.join(directory, 'out', 'log.jsonl'), 'utf8')).includes('length'));
  });
});


test('CA1: petición operacional con plan recibe un solo reintento; explicación no lo fuerza', async () => {
  await isolated(async directory => {
    const { tools } = fakeTools();
    const adapter = new FakeAdapter(index => index === 1 ? {content: '', toolCalls: [call('contratos_leer_buzon')]} : {content: index === 0 ? 'Comenzaré consultando el buzón' : 'Buzón consultado', toolCalls: []});
    const engine = new AgentEngine({directory,adapter,tools,prompt:'Prueba'});
    const result = await engine.chat({message:'Procesa el buzón de contratos con fecha de hoy 2026-09-03.'});
    assert.equal(adapter.calls,3); assert.equal(result.toolCalls.length,1); assert.equal(result.toolCalls[0]?.name,'contratos_leer_buzon');
    const plain = new FakeAdapter(() => ({content:'Procederé a listar',toolCalls:[]}));
    const plainEngine = new AgentEngine({directory,adapter:plain,tools,prompt:'Prueba'});
    const failed = await plainEngine.chat({message:'Lista mensajes pendientes'});
    assert.equal(plain.calls,2); assert.equal(failed.toolCalls.length,0); assert.ok(failed.reply.includes('no ejecutó ninguna herramienta'));
    const explanation = new FakeAdapter(() => ({content:'El buzón almacena mensajes simulados.',toolCalls:[]}));
    const explainEngine = new AgentEngine({directory,adapter:explanation,tools,prompt:'Prueba'});
    const explained = await explainEngine.chat({message:'¿Cómo funciona la lectura del buzón?'});
    assert.equal(explanation.calls,1); assert.equal(explained.toolCalls.length,0); assert.ok(explained.reply.includes('simulados'));
  });
});


test('CA1: buzón vacío no omite alertas explícitas; un solo reintento o pendiente honesto', async () => {
  await isolated(async directory => {
    const tools = fakeTools().tools;
    tools.contratos_alertas = {description: 'Alertas',args:{hoy:z.string()},async execute(){return JSON.stringify({ok:true,data:{ruta:'out/alertas.md',vencimientos:[]}});}};
    const request = 'Procesa el buzón con hoy 2026-09-03 y termina con el reporte de alertas.';
    const adapter = new FakeAdapter(index => ({content:index===0?'Consultaré buzón':index===2?'Procederé a generar reporte':'Resultado real',toolCalls:index===1?[call('contratos_leer_buzon')]:index===3?[call('contratos_alertas',{hoy:'2026-09-03'})]:[]}));
    const engine = new AgentEngine({directory,adapter,tools,prompt:'Prueba'});
    const result = await engine.chat({message:request}); assert.equal(adapter.calls,5);
    assert.deepEqual(result.toolCalls.map(trace=>trace.name),['contratos_leer_buzon','contratos_alertas']);
    const omission = new FakeAdapter(index=>({content:'Generaré las alertas',toolCalls:index===1?[call('contratos_leer_buzon')]:[]}));
    const omitted = await new AgentEngine({directory,adapter:omission,tools,prompt:'Prueba'}).chat({message:request});
    assert.equal(omission.calls,4); assert.ok(omitted.reply.includes('reporte de alertas solicitado sigue pendiente')); assert.equal(omitted.toolCalls.length,1);
    for (const message of ['Lista mensajes pendientes, sin generar alertas', 'Lista mensajes que tengan alertas']) {
      const negative = new FakeAdapter(index=>({content:'Buzón consultado',toolCalls:index===0?[call('contratos_leer_buzon')]:[]}));
      await new AgentEngine({directory,adapter:negative,tools,prompt:'Prueba'}).chat({message}); assert.equal(negative.calls,2);
    }
    tools.contratos_alertas = {description:'Alertas fallidas',args:{hoy:z.string()},async execute(){return JSON.stringify({ok:false,error:'No se pudo escribir el reporte'});}};
    const failure = new FakeAdapter(index=>({content:'Generaré reporte',toolCalls:index===0?[call('contratos_leer_buzon'),call('contratos_alertas',{hoy:'2026-09-03'})]:[]}));
    const failed = await new AgentEngine({directory,adapter:failure,tools,prompt:'Prueba'}).chat({message:request});
    assert.equal(failure.calls,2); assert.ok(failed.reply.includes('herramienta falló')); assert.ok(failed.reply.includes('reporte sigue pendiente'));
    const explanation = new FakeAdapter(()=>({content:'Las alertas usan una fecha de referencia',toolCalls:[]}));
    await new AgentEngine({directory,adapter:explanation,tools,prompt:'Prueba'}).chat({message:'¿Cómo genera el sistema las alertas?'}); assert.equal(explanation.calls,1);
  });
});
