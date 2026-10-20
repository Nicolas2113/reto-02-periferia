import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { contratoSchema, extraerTexto, fechaSchema, type Contrato } from './extraccion.js';
import { columns, commitFiles, fixture, jsonFile, optionalText, readMaster, readProcessed, safeOut, serializeCsv, type Context, type Row } from './almacen.js';

const businessFields = ['cliente', 'nit_cliente', 'pais', 'objeto', 'valor', 'moneda', 'fecha_inicio', 'fecha_fin', 'requiere_poliza', 'tipo_poliza'] as const;
const operational = new Set(['comercial', 'estado_poliza', 'ruta_sharepoint', 'fecha_registro', 'fuente']);
const normalize = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
interface Source { de: string; name: string; text: string; contract: Contrato | null }
export interface Validation {
  clasificacion: 'nuevo' | 'actualizacion' | 'duplicado' | 'rechazado';
  id_contrato_existente?: string;
  requiere_revision: string[];
  diferencias: Record<string, { antes: string; despues: string }>;
  contrato_normalizado: Contrato | null;
  advertencias: string[];
  motivo?: string;
}

async function source(ctx: Context, id: string): Promise<Source> {
  if (!/^msg-[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('ID de mensaje no válido');
  const directory = fixture(ctx, 'buzon', id);
  for (const file of [directory, path.join(directory, 'correo.json')]) {
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Mensaje enlazado no permitido');
  }
  const mail = z.object({ id: z.literal(id), de: z.string().email(), adjuntos: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)) })
    .parse(await jsonFile(path.join(directory, 'correo.json')));
  const contracts: { name: string; text: string }[] = [];
  for (const name of mail.adjuntos) {
    if (!name.endsWith('.txt')) continue;
    const file = path.join(directory, name);
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Adjunto enlazado no permitido');
    const text = await readFile(file, 'utf8');
    const title = normalize(text.trim().split(/\r?\n/, 1)[0] ?? '');
    if (/^contrato\b/.test(title) || /^otrosi\b.*\bcontrato\b/.test(title)) contracts.push({ name, text });
  }
  if (contracts.length > 1) throw new Error('Varios contratos: seleccionar adjunto');
  const selected = contracts[0];
  return selected ? { de: mail.de, ...selected, contract: extraerTexto(selected.text) }
    : { de: mail.de, name: '', text: '', contract: null };
}
function similarity(left: string, right: string): number {
  const a = new Set(normalize(left).split(' ').filter(Boolean));
  const b = new Set(normalize(right).split(' ').filter(Boolean));
  const union = new Set([...a, ...b]).size;
  return union ? [...a].filter(word => b.has(word)).length / union : 0;
}
function rowValue(row: Row, field: string): string | number | boolean | null {
  if (!columns.includes(field as typeof columns[number])) return null;
  const value = row[field as keyof Row];
  return field === 'valor' ? Number(value) : field === 'requiere_poliza' ? value === 'true' : value;
}
const reject = (motivo: string, contract: Contrato | null): Validation => ({
  clasificacion: 'rechazado', requiere_revision: [], diferencias: {}, contrato_normalizado: contract, advertencias: [], motivo,
});

export async function validateContract(ctx: Context, id: string, proposed: Contrato | null): Promise<Validation> {
  const input = await source(ctx, id);
  const extracted = input.contract;
  if (!extracted || !proposed) return reject('Sin adjunto contractual identificable o sin datos de contrato', proposed);
  if (!extracted.cliente || (!extracted.objeto && extracted.tipo_documento !== 'otrosi')) return reject('Texto sin partes y objeto identificables', proposed);
  const contract = contratoSchema.parse(structuredClone(proposed));
  const master = await readMaster(ctx);
  const existing = master.find(row => row.id_contrato === contract.id_contrato)
    ?? master.find(row => row.nit_cliente === contract.nit_cliente && similarity(row.objeto, contract.objeto ?? '') >= 0.9);
  const amendment = extracted.tipo_documento === 'otrosi';
  if (amendment && !existing) return reject('Otrosí sin contrato existente identificable; requiere revisión administrativa', contract);
  const review = new Set<string>();
  // La confianza del llamador no es autoridad: se recalcula desde la extracción original.
  for (const field of Object.keys(extracted.confianza) as (keyof Contrato['confianza'])[]) {
    if (operational.has(field)) continue;
    const inherited = amendment && existing && extracted[field] === null && contract[field] === rowValue(existing, field);
    const sameClient = field === 'cliente' && typeof contract[field] === 'string' && typeof extracted[field] === 'string'
      && normalize(contract[field]) === normalize(extracted[field]);
    if (contract[field] === extracted[field] || sameClient) contract.confianza[field] = extracted.confianza[field];
    else if (inherited) contract.confianza[field] = 0.9;
    else {
      contract.confianza[field] = contract[field] === null ? 0 : 0.5;
      if (businessFields.includes(field as typeof businessFields[number]) || field === 'id_contrato') review.add(field);
    }
  }
  if (amendment && existing) {
    for (const field of businessFields) {
      if (contract[field] === null) {
        Object.assign(contract, { [field]: rowValue(existing, field) });
        contract.confianza[field] = 0.9;
        contract.evidencias[field] = `Dato conservado del maestro: ${existing.id_contrato}`;
      }
    }
  }
  if (existing) {
    contract.id_contrato = existing.id_contrato; contract.confianza.id_contrato = 0.9;
    if (contract.cliente && normalize(contract.cliente) === normalize(existing.cliente)) contract.cliente = existing.cliente;
  }
  if (contract.id_contrato && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(contract.id_contrato)) throw new Error('ID de contrato no seguro para archivo');
  const warnings = [...contract.advertencias];
  const commercial = z.array(z.object({ email: z.string().email(), nombre: z.string() })).parse(await jsonFile(fixture(ctx, 'comerciales.json')))
    .find(person => person.email.toLowerCase() === input.de.toLowerCase());
  contract.comercial = commercial?.nombre ?? `No registrado: ${input.de}`;
  contract.confianza.comercial = commercial ? 0.9 : 0.8;
  if (!commercial) warnings.push(`Remitente comercial no registrado: ${input.de}; no bloquea`);
  if (contract.requiere_poliza === false) { contract.tipo_poliza = ''; contract.confianza.tipo_poliza = Math.max(0.8, contract.confianza.tipo_poliza); }
  for (const field of businessFields) {
    if (contract[field] === null || contract.confianza[field] < 0.8) review.add(field);
  }
  if (contract.requiere_poliza && !contract.tipo_poliza) review.add('tipo_poliza');
  if (contract.fecha_inicio && contract.fecha_fin && contract.fecha_fin < contract.fecha_inicio) throw new Error('Fecha fin anterior a inicio');
  const differences: Validation['diferencias'] = {};
  if (existing) {
    for (const field of businessFields) {
      if (contract[field] !== null && String(contract[field]) !== existing[field]) {
        differences[field] = { antes: existing[field], despues: String(contract[field]) };
        if (!amendment || !['valor', 'moneda', 'fecha_fin'].includes(field)) review.add(field);
      }
    }
  }
  const sameKey = existing && existing.id_contrato === contract.id_contrato
    && existing.valor === String(contract.valor) && existing.fecha_inicio === contract.fecha_inicio && existing.fecha_fin === contract.fecha_fin;
  const classification = existing ? (sameKey && (!amendment || Object.keys(differences).length === 0) ? 'duplicado' : 'actualizacion') : 'nuevo';
  return {
    clasificacion: classification, ...(existing ? { id_contrato_existente: existing.id_contrato } : {}),
    requiere_revision: classification === 'duplicado' ? [] : [...review].sort(), diferencias: differences,
    contrato_normalizado: contratoSchema.parse(contract), advertencias: warnings,
  };
}

function operationDate(ctx: Context): string { return fechaSchema.parse(ctx.hoy ?? new Date().toISOString().slice(0, 10)); }
function allocateId(rows: Row[], year: string): string {
  let sequence = 1;
  while (rows.some(row => row.id_contrato === `AUTO-${year}-${String(sequence).padStart(3, '0')}`)) sequence++;
  return `AUTO-${year}-${String(sequence).padStart(3, '0')}`;
}

export async function registerContract(ctx: Context, id: string, proposed: Contrato | null, confirmed: boolean) {
  const processed = await readProcessed(ctx);
  if (processed[id]) return { id_contrato: processed[id].id_contrato ?? null, accion: 'ya_procesado', ruta_archivo: processed[id].ruta_archivo ?? null };
  const validation = await validateContract(ctx, id, proposed);
  const contract = validation.contrato_normalizado;
  if (['rechazado', 'duplicado'].includes(validation.clasificacion)) {
    const existing = validation.id_contrato_existente ? (await readMaster(ctx)).find(row => row.id_contrato === validation.id_contrato_existente) : undefined;
    processed[id] = { clasificacion: validation.clasificacion, ...(existing ? { id_contrato: existing.id_contrato, ruta_archivo: existing.ruta_sharepoint } : {}) };
    await commitFiles(ctx, { 'procesados.json': JSON.stringify(processed, null, 2) + '\n' });
    return { id_contrato: existing?.id_contrato ?? null, accion: validation.clasificacion, ruta_archivo: existing?.ruta_sharepoint ?? null, motivo: validation.motivo };
  }
  if (!contract) throw new Error('No hay datos de contrato');
  if (validation.requiere_revision.length && !confirmed) throw new Error(`requiere revisión: ${validation.requiere_revision.join(', ')}`);
  // Confirmar confianza baja no completa datos inexistentes ni evita validación de tipos/calendario.
  const missingFields = businessFields.filter(field => contract[field] === null);
  if (missingFields.length) throw new Error(`Faltan datos confirmados: ${missingFields.join(', ')}`);
  if (!contract.cliente?.trim() || !contract.objeto?.trim() || !contract.nit_cliente || !contract.fecha_inicio || !contract.fecha_fin) throw new Error('Datos obligatorios incompletos');
  if (contract.fecha_fin < contract.fecha_inicio) throw new Error('Fecha fin anterior a inicio');
  if (contract.requiere_poliza && !contract.tipo_poliza) throw new Error('Falta tipo de póliza');
  const rows = await readMaster(ctx);
  const date = operationDate(ctx);
  const contractId = validation.id_contrato_existente ?? contract.id_contrato ?? allocateId(rows, date.slice(0, 4));
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(contractId)) throw new Error('ID de contrato no seguro');
  const slug = normalize(contract.cliente).replace(/ /g, '-');
  if (!slug) throw new Error('Cliente sin identificador de archivo válido');
  const relativeArchive = `Contratos/${contract.fecha_inicio.slice(0, 4)}/${slug}/${contractId}.txt`;
  const existing = rows.find(row => row.id_contrato === contractId);
  const row = Object.fromEntries(columns.map(column => [column, String(contract[column] ?? '')])) as Row;
  row.id_contrato = contractId;
  row.estado_poliza = existing?.estado_poliza ?? (contract.requiere_poliza ? 'pendiente' : 'no_aplica');
  row.ruta_sharepoint = relativeArchive;
  row.fecha_registro = existing?.fecha_registro ?? date;
  row.fuente = existing?.fuente ?? 'buzon';
  if (existing) rows[rows.indexOf(existing)] = row; else rows.push(row);
  const document = await source(ctx, id);
  const historyPath = await safeOut(ctx, 'sharepoint', 'historial.jsonl');
  const history = await optionalText(historyPath) ?? '';
  if (history.trim()) {
    const schema = z.object({ ts: z.string(), id_contrato: z.string(), accion: z.string(), cambios: z.unknown(), mensaje_id: z.string() });
    try { for (const line of history.trim().split('\n')) schema.parse(JSON.parse(line) as unknown); }
    catch { throw new Error('historial.jsonl inválido; no se escribirá el registro'); }
  }
  const action = existing ? 'actualizacion' : 'nuevo';
  processed[id] = { clasificacion: action, id_contrato: contractId, ruta_archivo: relativeArchive };
  await commitFiles(ctx, {
    'sharepoint/maestro-contratos.csv': serializeCsv(rows),
    [`sharepoint/${relativeArchive}`]: document.text,
    'sharepoint/historial.jsonl': history + JSON.stringify({ ts: new Date().toISOString(), id_contrato: contractId, accion: action, cambios: existing ? validation.diferencias : row, mensaje_id: id }) + '\n',
    'procesados.json': JSON.stringify(processed, null, 2) + '\n',
  });
  return { id_contrato: contractId, accion: action, ruta_archivo: relativeArchive };
}

export async function generateAlerts(ctx: Context, today: string) {
  fechaSchema.parse(today);
  const rows = await readMaster(ctx);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 60);
  const limit = end.toISOString().slice(0, 10);
  const cutoff = '2026-05-30';
  const vencen = rows.filter(row => row.fecha_fin >= today && row.fecha_fin <= limit);
  const polizas_pendientes = rows.filter(row => row.requiere_poliza === 'true' && row.estado_poliza !== 'vigente');
  const registrados_desde_corte = rows.filter(row => row.fecha_registro >= cutoff);
  const daysUntil = (row: Row): number => Math.round((Date.parse(`${row.fecha_fin}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const section = (title: string, items: Row[], includeDays = false): string => `## ${title}\n\n` + (items.length ? items.map(row => `- ${row.id_contrato} - ${row.cliente.replace(/[\r\n]/g, ' ')}; fin ${row.fecha_fin}${includeDays ? `; a ${daysUntil(row)} días` : ''}; póliza ${row.estado_poliza}`).join('\n') : 'Sin casos.') + '\n\n';
  const report = `# Alertas de contratos\n\nFecha de referencia: ${today}. Horizonte inclusivo: ${today} a ${limit}; no incluye ya vencidos.\n\n`
    + section('Vencen entre 0 y 60 días (inclusive)', vencen, true) + section('Pólizas pendientes o no vigentes', polizas_pendientes)
    + section(`Registrados desde el corte ${cutoff}`, registrados_desde_corte);
  await commitFiles(ctx, { 'alertas.md': report });
  return { ruta: 'out/alertas.md', hoy: today, hasta: limit, dias_horizonte: 60, fecha_corte: cutoff, reporte: report, vencen, polizas_pendientes, registrados_desde_corte };
}
