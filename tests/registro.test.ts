import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runDemo } from '../demo.js';
import { parseCsv, readMaster, serializeCsv, type Context } from '../src/almacen.js';
import { contratoSchema, type Contrato } from '../src/extraccion.js';
import { type Validation } from '../src/registro.js';
import { alertas, extraer, leer_buzon, registrar, validar } from '../src/tools/contratos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
interface Callable { execute(args: Record<string, unknown>, ctx: Context): Promise<string> }
async function result(tool: Callable, args: Record<string, unknown>, ctx: Context) {
  return JSON.parse(await tool.execute(args, ctx)) as { ok: boolean; data?: unknown; error?: string };
}
async function call<T>(tool: Callable, args: Record<string, unknown>, ctx: Context): Promise<T> {
  const output = await result(tool, args, ctx);
  assert.equal(output.ok, true, output.error);
  return output.data as T;
}
async function extract(ctx: Context, id: string): Promise<Contrato | null> {
  const output = await result(extraer, { mensaje_id: id }, ctx);
  return output.ok ? contratoSchema.parse(output.data) : null;
}
async function isolated(action: (ctx: Context) => Promise<void>): Promise<void> {
  const output = path.join(root, 'out');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'registro-test-'));
  try {
    await cp(path.join(root, 'fixtures'), path.join(directory, 'fixtures'), { recursive: true });
    await action({ directory, sessionId: 'test-registro', hoy: '2026-09-03' });
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(output) + path.sep));
    assert.ok(path.basename(target).startsWith('registro-test-'));
    await rm(target, { recursive: true, force: true });
  }
}
async function hashes(directory: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(output, await hashes(full));
    else output[full] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return output;
}

test('HU3: seis clasificaciones, parche de otrosí y remitente desconocido sin bloqueo espurio', async () => {
  await isolated(async ctx => {
    const expected = ['nuevo', 'nuevo', 'actualizacion', 'duplicado', 'rechazado', 'nuevo'];
    for (let i = 1; i <= 6; i++) {
      const id = `msg-${String(i).padStart(3, '0')}`;
      const data = await call<Validation>(validar, { mensaje_id: id, contrato: await extract(ctx, id) }, ctx);
      assert.equal(data.clasificacion, expected[i - 1]);
      if (i < 6) assert.deepEqual(data.requiere_revision, []);
      if (i === 3) {
        assert.equal(data.contrato_normalizado?.valor, 520000);
        assert.equal(data.contrato_normalizado?.fecha_fin, '2027-11-01');
        assert.equal(data.contrato_normalizado?.fecha_inicio, '2026-05-02');
        assert.equal(data.contrato_normalizado?.objeto, 'Célula ágil de desarrollo para sistema de operaciones');
        assert.deepEqual(Object.keys(data.diferencias).sort(), ['fecha_fin', 'valor']);
      }
      if (i === 6) {
        for (const field of ['valor', 'moneda', 'fecha_inicio', 'fecha_fin', 'requiere_poliza']) assert.ok(data.requiere_revision.includes(field));
        assert.ok(!data.requiere_revision.includes('comercial'));
        assert.ok(data.advertencias.some(warning => /no registrado/.test(warning)));
      }
    }
  });
});

test('HU4/demo: 10 antes y11 después, otrosí aplicado, historial y determinismo con originales intactos', async () => {
  const original = await hashes(path.join(root, 'fixtures'));
  const prd = await readFile(path.join(root, 'PRD.md'));
  await isolated(async ctx => {
    const first = await runDemo(ctx.directory);
    assert.equal(first.filasAntes, 10);
    assert.equal(first.filasDespues, 11);
    assert.equal(first.primeraPasada.find(entry => entry.mensaje === 'msg-003')?.accion, 'actualizacion');
    const rows = await readMaster(ctx);
    assert.equal(new Set(rows.map(row => row.id_contrato)).size, 11);
    const amendment = rows.find(row => row.id_contrato === 'CT-2026-011');
    assert.equal(amendment?.valor, '520000');
    assert.equal(amendment?.fecha_fin, '2027-11-01');
    assert.equal(amendment?.fecha_registro, '2026-05-05');
    assert.equal(amendment?.estado_poliza, 'vigente');
    const history = (await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'historial.jsonl'), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(history.map(entry => entry.mensaje_id), ['msg-001', 'msg-002', 'msg-003', 'msg-006']);
    assert.equal(await readFile(path.join(ctx.directory, 'out', 'sharepoint', amendment?.ruta_sharepoint ?? ''), 'utf8'), await readFile(path.join(ctx.directory, 'fixtures', 'reto-02', 'buzon', 'msg-003', 'otrosi.txt'), 'utf8'));
    const csv = await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv'), 'utf8');
    assert.deepEqual(await runDemo(ctx.directory), first);
    assert.equal(await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv'), 'utf8'), csv);
  });
  assert.deepEqual(await hashes(path.join(root, 'fixtures')), original);
  assert.deepEqual(await readFile(path.join(root, 'PRD.md')), prd);
});

test('HU4: revisión no se evita elevando confianza ni confirmado permite datos incompletos o inválidos', async () => {
  await isolated(async ctx => {
    const extracted = await extract(ctx, 'msg-006');
    assert.ok(extracted);
    for (const field of Object.keys(extracted.confianza) as (keyof Contrato['confianza'])[]) extracted.confianza[field] = 1;
    const validation = await call<Validation>(validar, { mensaje_id: 'msg-006', contrato: extracted }, ctx);
    assert.ok(validation.requiere_revision.includes('valor'));
    assert.equal((await result(registrar, { mensaje_id: 'msg-006', contrato: extracted }, ctx)).ok, false);
    assert.equal((await result(registrar, { mensaje_id: 'msg-006', contrato: extracted, confirmado: true }, ctx)).ok, false);
    for (const patch of [{ valor: -1 }, { moneda: 'EUR' }, { fecha_inicio: '2026-02-30' }, { id_contrato: '../../archivo' }]) {
      assert.equal((await result(registrar, { mensaje_id: 'msg-006', contrato: { ...extracted, ...patch }, confirmado: true }, ctx)).ok, false);
    }
    await assert.rejects(readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv')));
    await assert.rejects(readFile(path.join(ctx.directory, 'out', 'procesados.json')));
  });
});

test('HU4: registro idempotente, duplicado/rechazado no modifican maestro ni historial', async () => {
  await isolated(async ctx => {
    const contract = await extract(ctx, 'msg-001');
    await call(registrar, { mensaje_id: 'msg-001', contrato: contract }, ctx);
    const csv = await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv'), 'utf8');
    const history = await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'historial.jsonl'), 'utf8');
    const repeated = await call<{ accion: string }>(registrar, { mensaje_id: 'msg-001', contrato: contract }, ctx);
    assert.equal(repeated.accion, 'ya_procesado');
    await call(registrar, { mensaje_id: 'msg-004', contrato: await extract(ctx, 'msg-004') }, ctx);
    await call(registrar, { mensaje_id: 'msg-005', contrato: null }, ctx);
    assert.equal(await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv'), 'utf8'), csv);
    assert.equal(await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'historial.jsonl'), 'utf8'), history);
    const pending = await call<{ mensajes: { id: string }[] }>(leer_buzon, {}, ctx);
    assert.deepEqual(pending.mensajes.map(message => message.id), ['msg-002', 'msg-003', 'msg-006']);
  });
});

test('HU4: dos registros simultáneos del mismo mensaje generan una sola fila e historial', async () => {
  await isolated(async ctx => {
    const contract = await extract(ctx, 'msg-001');
    await Promise.all([call(registrar, { mensaje_id: 'msg-001', contrato: contract }, ctx), call(registrar, { mensaje_id: 'msg-001', contrato: contract }, ctx)]);
    assert.equal((await readMaster(ctx)).length, 9);
    assert.equal((await readFile(path.join(ctx.directory, 'out', 'sharepoint', 'historial.jsonl'), 'utf8')).trim().split('\n').length, 1);
  });
});

test('HU4: CSV escapa comas, comillas y saltos de línea', async () => {
  await isolated(async ctx => {
    const rows = await readMaster(ctx);
    const first = rows[0];
    assert.ok(first);
    first.objeto = 'Soporte, "prioritario"\nsegunda línea';
    assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
  });
});

test('HU4: fallo de preflight no deja maestro o historial parcial', async () => {
  await isolated(async ctx => {
    await mkdir(path.join(ctx.directory, 'out', 'procesados.json'), { recursive: true });
    const output = await result(registrar, { mensaje_id: 'msg-001', contrato: await extract(ctx, 'msg-001') }, ctx);
    assert.equal(output.ok, false);
    await assert.rejects(readFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv')));
    await assert.rejects(readFile(path.join(ctx.directory, 'out', 'sharepoint', 'historial.jsonl')));
  });
});

test('HU5: horizonte inclusivo0/60días, pólizas, corte y fecha inválida', async () => {
  await isolated(async ctx => {
    const rows = (await readMaster(ctx)).slice(0, 4);
    const dates = ['2026-09-02', '2026-09-03', '2026-11-02', '2026-11-03'];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]; if (!row) throw new Error('Fila de prueba ausente');
      row.id_contrato = `B${i}`; row.fecha_fin = dates[i] ?? ''; row.fecha_registro = i === 3 ? '2026-09-03' : '2026-01-01';
      row.requiere_poliza = i === 2 ? 'false' : 'true'; row.estado_poliza = i === 1 ? 'vigente' : i === 3 ? 'vencida' : 'pendiente';
    }
    await mkdir(path.join(ctx.directory, 'out', 'sharepoint'), { recursive: true });
    await writeFile(path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv'), serializeCsv(rows));
    const data = await call<{ vencen: { id_contrato: string }[]; polizas_pendientes: { id_contrato: string }[]; registrados_desde_corte: { id_contrato: string }[] }>(alertas, { hoy: '2026-09-03' }, ctx);
    assert.deepEqual(data.vencen.map(row => row.id_contrato), ['B1', 'B2']);
    assert.deepEqual(data.polizas_pendientes.map(row => row.id_contrato), ['B0', 'B3']);
    assert.deepEqual(data.registrados_desde_corte.map(row => row.id_contrato), ['B3']);
    const report = await readFile(path.join(ctx.directory, 'out', 'alertas.md'), 'utf8');
    assert.equal((report.match(/^## /gm) ?? []).length, 3);
    assert.equal((await result(alertas, { hoy: '2026-02-30' }, ctx)).ok, false);
    assert.equal(await readFile(path.join(ctx.directory, 'out', 'alertas.md'), 'utf8'), report);
  });
});

test('HU3/HU4: maestro o historial corruptos impiden nueva escritura silenciosa', async () => {
  await isolated(async ctx => {
    const contract = await extract(ctx, 'msg-001');
    await mkdir(path.join(ctx.directory, 'out', 'sharepoint'), { recursive: true });
    const rows = await readMaster(ctx);
    const row = rows[0]; assert.ok(row); row.moneda = 'EUR';
    const file = path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv');
    const corrupt = serializeCsv(rows);
    await writeFile(file, corrupt);
    assert.equal((await result(registrar, { mensaje_id: 'msg-001', contrato: contract }, ctx)).ok, false);
    assert.equal(await readFile(file, 'utf8'), corrupt);
    await rm(file);
    const history = path.join(ctx.directory, 'out', 'sharepoint', 'historial.jsonl');
    await writeFile(history, '{');
    assert.equal((await result(registrar, { mensaje_id: 'msg-001', contrato: contract }, ctx)).ok, false);
    assert.equal(await readFile(history, 'utf8'), '{');
    await assert.rejects(readFile(file));
  });
});

test('RN2/HU4: coincidencia NIT+objeto evita fila nueva; ID ausente se genera AUTO al registrar', async () => {
  await isolated(async ctx => {
    const extracted = await extract(ctx, 'msg-001'); assert.ok(extracted);
    const rows = await readMaster(ctx); const template = rows[0]; assert.ok(template);
    rows.push({ ...template, id_contrato: 'BASE-MATCH', nit_cliente: extracted.nit_cliente ?? '', objeto: extracted.objeto ?? '', valor: '100' });
    await mkdir(path.join(ctx.directory, 'out', 'sharepoint'), { recursive: true });
    const master = path.join(ctx.directory, 'out', 'sharepoint', 'maestro-contratos.csv');
    await writeFile(master, serializeCsv(rows));
    const validation = await call<Validation>(validar, { mensaje_id: 'msg-001', contrato: extracted }, ctx);
    assert.equal(validation.clasificacion, 'actualizacion');
    assert.equal(validation.id_contrato_existente, 'BASE-MATCH');
    assert.ok(validation.requiere_revision.includes('valor'));
    await rm(master);
    const attachment = path.join(ctx.directory, 'fixtures', 'reto-02', 'buzon', 'msg-001', 'contrato.txt');
    await writeFile(attachment, (await readFile(attachment, 'utf8')).replace('No. CT-2026-015', ''));
    const withoutId = await extract(ctx, 'msg-001'); assert.ok(withoutId); assert.equal(withoutId.id_contrato, null);
    const saved = await call<{ id_contrato: string }>(registrar, { mensaje_id: 'msg-001', contrato: withoutId }, ctx);
    assert.equal(saved.id_contrato, 'AUTO-2026-001');
    assert.equal((await readMaster(ctx)).length, 9);
  });
});

test('HU5 fidelidad: 2026-10-15 está a 42 días y el reporte devuelto coincide con el archivo', async () => {
  await isolated(async ctx => {
    const before = await hashes(path.join(ctx.directory, 'fixtures'));
    const data = await call<{ hoy: string; hasta: string; dias_horizonte: number; fecha_corte: string; reporte: string; vencen: { id_contrato: string; fecha_fin: string }[] }>(alertas, { hoy: '2026-09-03' }, ctx);
    assert.equal(data.hoy, '2026-09-03');
    assert.equal(data.hasta, '2026-11-02');
    assert.equal(data.dias_horizonte, 60);
    assert.equal(data.fecha_corte, '2026-05-30');
    assert.ok(data.vencen.some(row => row.id_contrato === 'CT-2026-004' && row.fecha_fin === '2026-10-15'));
    assert.match(data.reporte, /CT-2026-004[^\n]*fin 2026-10-15; a 42 días/);
    assert.equal(data.reporte, await readFile(path.join(ctx.directory, 'out', 'alertas.md'), 'utf8'));
    assert.deepEqual(await hashes(path.join(ctx.directory, 'fixtures')), before);
  });
});