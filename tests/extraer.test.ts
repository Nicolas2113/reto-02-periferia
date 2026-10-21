import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { contratoSchema } from '../src/extraccion.js';
import { extraer } from '../src/tools/contratos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = path.join(tmpdir(), 'reto-02-tests');
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: contratoSchema }),
  z.object({ ok: z.literal(false), error: z.string().min(1) }),
]);

async function isolated(action: (directory: string) => Promise<void>): Promise<void> {
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'extraer-test-'));
  try {
    await cp(path.join(root, 'fixtures'), path.join(directory, 'fixtures'), { recursive: true });
    await action(directory);
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(output) + path.sep));
    assert.ok(path.basename(target).startsWith('extraer-test-'));
    await rm(target, { recursive: true, force: true });
  }
}

async function extract(directory: string, mensaje_id: string) {
  const raw = await extraer.execute({ mensaje_id }, { directory, sessionId: 'test-hu2' });
  assert.equal(typeof raw, 'string');
  return responseSchema.parse(JSON.parse(raw) as unknown);
}

async function hashes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(full));
    else result[full] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return result;
}

const successes = [
  { id: 'msg-001', expected: { id_contrato: 'CT-2026-015', nit_cliente: '890900111', pais: 'CO', valor: 265000000, moneda: 'COP', fecha_inicio: '2026-08-01', fecha_fin: '2027-07-31', requiere_poliza: true, tipo_poliza: 'cumplimiento' } },
  { id: 'msg-002', expected: { id_contrato: 'CT-2026-016', nit_cliente: '1790012345001', pais: 'EC', valor: 120000, moneda: 'USD', fecha_inicio: '2026-08-15', fecha_fin: '2027-08-14', requiere_poliza: false, tipo_poliza: '' } },
  { id: 'msg-003', expected: { id_contrato: 'CT-2026-011', nit_cliente: '20512345678', pais: 'PE', valor: 520000, moneda: 'PEN', fecha_inicio: null, fecha_fin: '2027-11-01', objeto: null, tipo_documento: 'otrosi' } },
  { id: 'msg-004', expected: { id_contrato: 'CT-2026-012', valor: 210000000, moneda: 'COP', fecha_inicio: '2026-05-15', fecha_fin: '2026-11-14', requiere_poliza: false } },
  { id: 'msg-006', expected: { id_contrato: 'CM-2026-03', nit_cliente: '800222333', valor: 0, moneda: null, valor_indeterminado: true, fecha_inicio: null, fecha_fin: null, plazo_meses: 12, requiere_poliza: null, poliza_condicional: true, tipo_poliza: 'cumplimiento' } },
];

for (const scenario of successes) {
  test(`HU-2 / 7.4: ${scenario.id} extrae valores y preserva ausencias sin clasificar`, async () => {
    await isolated(async directory => {
      const result = await extract(directory, scenario.id);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) return;
      for (const [field, expected] of Object.entries(scenario.expected)) {
        assert.equal(result.data[field as keyof typeof result.data], expected, field);
      }
      for (const [field, confidence] of Object.entries(result.data.confianza)) {
        assert.ok(confidence >= 0 && confidence <= 1);
        if (result.data[field as keyof typeof result.data] === null) assert.equal(confidence, 0, field);
      }
      assert.ok(!('clasificacion' in result.data));
      for (const field of ['comercial', 'estado_poliza', 'ruta_sharepoint', 'fecha_registro', 'fuente'] as const) {
        assert.equal(result.data[field], null);
        assert.equal(result.data.confianza[field], 0);
      }
      if (scenario.id === 'msg-006') {
        assert.ok(result.data.confianza.valor < 0.8);
        assert.match(result.data.evidencias.poliza_condicional ?? '', /100\.000\.000/);
        assert.ok(result.data.advertencias.some(warning => /condicional/.test(warning)));
      }
    });
  });
}

test('HU-2: msg-005 cotización no se transforma en contrato', async () => {
  await isolated(async directory => {
    const result = await extract(directory, 'msg-005');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /no contractual/);
  });
});

test('HU-2: extracción determinista, sin consultar maestro ni comerciales y solo bitácora', async () => {
  const fixtures = await hashes(path.join(root, 'fixtures'));
  const prd = await readFile(path.join(root, 'PRD.md'));
  await isolated(async directory => {
    const before = await hashes(path.join(directory, 'fixtures'));
    const first = await extract(directory, 'msg-003');
    assert.deepEqual(await hashes(path.join(directory, 'fixtures')), before);
    await rm(path.join(directory, 'fixtures', 'reto-02', 'maestro-contratos.csv'));
    await rm(path.join(directory, 'fixtures', 'reto-02', 'comerciales.json'));
    assert.deepEqual(await extract(directory, 'msg-003'), first);
    assert.deepEqual(await readdir(path.join(directory, 'out')), ['log.jsonl']);
    const events = (await readFile(path.join(directory, 'out', 'log.jsonl'), 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    assert.ok(events.every(event => event.herramienta === 'contratos_extraer' && event.mensaje_id === 'msg-003' && event.ok === true));
  });
  assert.deepEqual(await hashes(path.join(root, 'fixtures')), fixtures);
  assert.deepEqual(await readFile(path.join(root, 'PRD.md')), prd);
});

test('6.2: argumento zod descrito, rechaza ID/ruta/entrada inválidos sin lanzar', async () => {
  assert.ok(extraer.args.mensaje_id.description);
  await isolated(async directory => {
    for (const args of [{}, { mensaje_id: '../../PRD.md' }, { mensaje_id: 'C:\\secreto' }, { mensaje_id: 'msg-001', ruta: '../otra' }]) {
      const raw = await extraer.execute(args, { directory, sessionId: 'test-hu2' });
      assert.equal(responseSchema.parse(JSON.parse(raw) as unknown).ok, false);
    }
  });
});

const mutations = [
  { name: 'texto vacío', error: /vacío/, modify: (_text: string) => '   ' },
  { name: 'moneda desconocida', error: /Moneda contractual no admitida/, modify: (text: string) => text.replace('COP $265.000.000', 'EUR 265.000.000') },
  { name: 'fecha inválida', error: /Fecha contractual inválida/, modify: (text: string) => text.replace('(31) de julio de 2027', '(31) de febrero de 2027') },
  { name: 'monto mal formado', error: /valor monetario inválido/, modify: (text: string) => text.replace('COP $265.000.000', 'COP $2.65.000') },
];
for (const scenario of mutations) {
  test(`HU-6: ${scenario.name} retorna error legible`, async () => {
    await isolated(async directory => {
      const file = path.join(directory, 'fixtures', 'reto-02', 'buzon', 'msg-001', 'contrato.txt');
      await writeFile(file, scenario.modify(await readFile(file, 'utf8')));
      const result = await extract(directory, 'msg-001');
      assert.equal(result.ok, false, JSON.stringify(result));
      if (!result.ok) assert.match(result.error, scenario.error);
      // Una llamada errónea no inutiliza la siguiente.
      assert.equal((await extract(directory, 'msg-002')).ok, true);
    });
  });
}

test('HU-2: mensaje/adjunto ausente y ruta de adjunto insegura se rechazan', async () => {
  await isolated(async directory => {
    assert.equal((await extract(directory, 'msg-999')).ok, false);
    const mail = path.join(directory, 'fixtures', 'reto-02', 'buzon', 'msg-001', 'correo.json');
    const parsed = JSON.parse(await readFile(mail, 'utf8')) as Record<string, unknown>;
    parsed.adjuntos = ['../maestro-contratos.csv'];
    await writeFile(mail, JSON.stringify(parsed));
    assert.equal((await extract(directory, 'msg-001')).ok, false);
    parsed.adjuntos = ['no-existe.txt'];
    await writeFile(mail, JSON.stringify(parsed));
    assert.equal((await extract(directory, 'msg-001')).ok, false);
  });
});

test('HU-2: ausencias null/0, no genera AUTO ni utiliza firma/correo como fecha inicial', async () => {
  await isolated(async directory => {
    const file = path.join(directory, 'fixtures', 'reto-02', 'buzon', 'msg-001', 'contrato.txt');
    await writeFile(file, 'CONTRATO DE SERVICIOS\n\nSe firma en agosto de 2026.');
    const result = await extract(directory, 'msg-001');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.id_contrato, null);
    assert.equal(result.data.confianza.id_contrato, 0);
    assert.equal(result.data.fecha_inicio, null);
    assert.equal(result.data.fecha_fin, null);
    assert.equal(result.data.requiere_poliza, null);
  });
});

test('HU-2: deriva fin inclusivo solo con inicio completo y deja evidencia de derivación', async () => {
  await isolated(async directory => {
    const file = path.join(directory, 'fixtures', 'reto-02', 'buzon', 'msg-001', 'contrato.txt');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/TERCERA\. PLAZO\.[\s\S]*?\n\nCUARTA/, 'TERCERA. PLAZO. Doce (12) meses desde 2026-09-01.\n\nCUARTA'));
    const result = await extract(directory, 'msg-001');
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.data.fecha_inicio, '2026-09-01');
    assert.equal(result.data.fecha_fin, '2027-08-31');
    assert.ok(result.data.confianza.fecha_fin < 0.8);
    assert.match(result.data.evidencias.fecha_fin ?? '', /fin inclusivo/);
    assert.ok((result.data.objeto?.length ?? 0) <= 200);
  });
});
