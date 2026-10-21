import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { leer_buzon } from '../src/tools/contratos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = path.join(tmpdir(), 'reto-02-tests');
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({
    mensajes: z.array(z.object({
      id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string(),
      adjuntos: z.array(z.string()), tiene_contrato: z.boolean(),
      clasificacion: z.literal('rechazado').optional(), motivo: z.string().optional(),
    })),
    errores: z.array(z.object({ mensaje_id: z.string(), error: z.string() })),
  }) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

async function hashes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(full));
    else result[full] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return result;
}

async function isolated(action: (directory: string) => Promise<void>): Promise<void> {
  // Datos de prueba aislados en el directorio temporal del sistema, sin tocar los fixtures originales.
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'leer-buzon-test-'));
  try {
    await cp(path.join(root, 'fixtures'), path.join(directory, 'fixtures'), { recursive: true });
    await action(directory);
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(output) + path.sep));
    assert.ok(path.basename(target).startsWith('leer-buzon-test-'));
    await rm(target, { recursive: true, force: true });
  }
}

async function execute(directory: string, args: Record<string, unknown> = {}) {
  const raw = await leer_buzon.execute(args, { directory, sessionId: 'test-hu1' });
  assert.equal(typeof raw, 'string');
  return responseSchema.parse(JSON.parse(raw) as unknown);
}

test('HU-1 y 7.4: seis mensajes, otrosí reconocido, cotización rechazada y originales intactos', async () => {
  const before = await hashes(path.join(root, 'fixtures'));
  const prd = await readFile(path.join(root, 'PRD.md'));
  await isolated(async directory => {
    const result = await execute(directory);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.data.mensajes.map(message => message.id), ['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005', 'msg-006']);
    assert.deepEqual(result.data.errores, []);
    assert.equal(result.data.mensajes.filter(message => message.tiene_contrato).length, 5);
    assert.equal(result.data.mensajes.find(message => message.id === 'msg-003')?.tiene_contrato, true);
    const quote = result.data.mensajes.find(message => message.id === 'msg-005');
    assert.equal(quote?.tiene_contrato, false);
    assert.equal(quote?.clasificacion, 'rechazado');
    assert.ok(quote?.motivo);
    const event = JSON.parse((await readFile(path.join(directory, 'out', 'log.jsonl'), 'utf8')).trim()) as Record<string, unknown>;
    assert.equal(event.herramienta, 'contratos_leer_buzon');
    assert.equal(event.ok, true);
    await assert.rejects(readFile(path.join(directory, 'out', 'procesados.json')));
  });
  assert.deepEqual(await hashes(path.join(root, 'fixtures')), before);
  assert.deepEqual(await readFile(path.join(root, 'PRD.md')), prd);
});

test('HU-1: excluye IDs presentes en procesados.json sin cambiar ese archivo', async () => {
  await isolated(async directory => {
    await mkdir(path.join(directory, 'out'));
    const file = path.join(directory, 'out', 'procesados.json');
    const processed = '{"msg-001":{"clasificacion":"nuevo"},"msg-005":{"clasificacion":"rechazado"}}';
    await writeFile(file, processed);
    const result = await execute(directory);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.data.mensajes.map(message => message.id), ['msg-002', 'msg-003', 'msg-004', 'msg-006']);
    assert.equal(await readFile(file, 'utf8'), processed);
  });
});

test('6.2 y HU-6: procesados corrupto devuelve error legible y no lanza', async () => {
  await isolated(async directory => {
    await mkdir(path.join(directory, 'out'));
    await writeFile(path.join(directory, 'out', 'procesados.json'), '{');
    const result = await execute(directory);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /procesados.json.*JSON inválido/);
  });
});

test('HU-6: un correo corrupto no aborta los otros cinco', async () => {
  await isolated(async directory => {
    await writeFile(path.join(directory, 'fixtures', 'reto-02', 'buzon', 'msg-001', 'correo.json'), '{');
    const result = await execute(directory);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.mensajes.length, 5);
    assert.equal(result.data.errores[0]?.mensaje_id, 'msg-001');
    assert.match(result.data.errores[0]?.error ?? '', /JSON inválido/);
  });
});

test('6.2: valida entrada vacía con zod y rechaza argumentos inesperados', async () => {
  await isolated(async directory => {
    const result = await execute(directory, { ruta: '../../otro' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /no recibe argumentos/);
  });
});
