import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { fechaSchema } from './extraccion.js';

export interface Context { directory: string; sessionId: string; hoy?: string }
export const columns = ['id_contrato', 'cliente', 'nit_cliente', 'pais', 'objeto', 'valor', 'moneda',
  'fecha_inicio', 'fecha_fin', 'requiere_poliza', 'tipo_poliza', 'estado_poliza', 'comercial',
  'ruta_sharepoint', 'fecha_registro', 'fuente'] as const;
export type Row = Record<typeof columns[number], string>;
export const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export const fixture = (ctx: Context, ...parts: string[]): string => path.join(ctx.directory, 'fixtures', 'reto-02', ...parts);

export async function safeOut(ctx: Context, ...parts: string[]): Promise<string> {
  const root = path.resolve(ctx.directory, 'out');
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Ruta fuera de out/');
  let cursor = path.resolve(ctx.directory);
  for (const segment of path.relative(cursor, target).split(path.sep)) {
    cursor = path.join(cursor, segment);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Enlace no permitido en out/'); }
    catch (error) { if (!missing(error)) throw error; }
  }
  return target;
}
export async function jsonFile(file: string): Promise<unknown> {
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
}
export async function optionalText(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); } catch (error) { if (missing(error)) return null; throw error; }
}

export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) {
      row.push(cell); if (row.some(value => value !== '')) records.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV inválido: comillas sin cerrar');
  if (cell || row.length) { row.push(cell); records.push(row); }
  if (records.shift()?.join(',') !== columns.join(',')) throw new Error('Encabezado del maestro inválido');
  const result = records.map(values => {
    if (values.length !== columns.length) throw new Error('Fila CSV con columnas incorrectas');
    const record = Object.fromEntries(columns.map((column, i) => [column, values[i] ?? ''])) as Row;
    if (!record.id_contrato || !record.cliente || !/^\d+$/.test(record.nit_cliente)) throw new Error('Maestro con identificación incompleta');
    if (!record.valor.trim() || !Number.isFinite(Number(record.valor)) || Number(record.valor) < 0) throw new Error('Valor inválido en maestro');
    if (!['true', 'false'].includes(record.requiere_poliza)) throw new Error('Póliza inválida en maestro');
    if (!['CO', 'EC', 'PE', 'PA', 'HN'].includes(record.pais) || !['COP', 'USD', 'PEN', 'PAB', 'HNL'].includes(record.moneda)) throw new Error('País o moneda inválidos en maestro');
    if (!['vigente', 'pendiente', 'vencida', 'no_aplica'].includes(record.estado_poliza) || !['buzon', 'manual', 'migracion'].includes(record.fuente)) throw new Error('Estado o fuente inválidos en maestro');
    if (record.fecha_fin < record.fecha_inicio) throw new Error('Plazo inválido en maestro');
    if (!fechaSchema.safeParse(record.fecha_inicio).success || !fechaSchema.safeParse(record.fecha_fin).success || !fechaSchema.safeParse(record.fecha_registro).success) throw new Error('Fecha inválida en maestro');
    return record;
  });
  if (new Set(result.map(record => record.id_contrato)).size !== result.length) throw new Error('El maestro contiene IDs duplicados');
  return result;
}
export function serializeCsv(rows: Row[]): string {
  const escape = (value: string): string => /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return columns.join(',') + '\n' + rows.map(row => columns.map(column => escape(row[column])).join(',')).join('\n') + '\n';
}
export async function readMaster(ctx: Context): Promise<Row[]> {
  const current = await optionalText(await safeOut(ctx, 'sharepoint', 'maestro-contratos.csv'));
  return parseCsv(current ?? await readFile(fixture(ctx, 'maestro-contratos.csv'), 'utf8'));
}

const processedSchema = z.record(z.object({ clasificacion: z.string(), id_contrato: z.string().optional(), ruta_archivo: z.string().optional() }).passthrough());
export type Processed = z.infer<typeof processedSchema>;
export async function readProcessed(ctx: Context): Promise<Processed> {
  const text = await optionalText(await safeOut(ctx, 'procesados.json'));
  if (text === null) return {};
  let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch { throw new Error('procesados.json contiene JSON inválido'); }
  if (Array.isArray(data) && data.every(id => typeof id === 'string')) {
    return Object.fromEntries(data.map(id => [id, { clasificacion: 'procesado' }]));
  }
  const parsed = processedSchema.safeParse(data);
  if (!parsed.success) throw new Error('procesados.json inválido; no se escribirá el registro');
  return parsed.data;
}

// Preflight y reemplazo por archivo, con recuperación ante errores de E/S dentro del proceso.
// No equivale a una transacción resistente a corte de energía o caída del sistema.
export async function commitFiles(ctx: Context, updates: Record<string, string>): Promise<void> {
  const previous = new Map<string, string | null>();
  const staged = new Map<string, string>();
  const applied: string[] = [];
  try {
    for (const relative of Object.keys(updates)) {
      const file = await safeOut(ctx, relative);
      previous.set(file, await optionalText(file));
    }
    for (const [relative, text] of Object.entries(updates)) {
      const file = await safeOut(ctx, relative);
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp-' + randomUUID();
      staged.set(file, temporary);
      await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    }
    for (const [file, temporary] of staged) { await rename(temporary, file); applied.push(file); }
  } catch (error) {
    let recovered = true;
    for (const file of applied.reverse()) {
      try {
        const content = previous.get(file);
        if (content === null) await rm(file, { force: true });
        else if (content !== undefined) await writeFile(file, content, 'utf8');
      } catch { recovered = false; }
    }
    throw new Error(recovered ? 'No se pudo guardar el registro; cambios recuperados, revisar archivos de salida'
      : 'Fallo de escritura y recuperación incompleta; detener registro y revisar out/', { cause: error });
  } finally {
    for (const temporary of staged.values()) { try { await rm(temporary, { force: true }); } catch { /* fallo reportado en registro */ } }
  }
}
let queue: Promise<void> = Promise.resolve();
export async function withWriteLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release: () => void = () => {};
  queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await action(); } finally { release(); }
}
