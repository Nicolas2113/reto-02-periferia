import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { readMaster, safeOut, type Context } from './src/almacen.js';
import { contratoSchema, type Contrato } from './src/extraccion.js';
import { alertas, extraer, leer_buzon, registrar, validar } from './src/tools/contratos.js';

interface Callable { execute(args: Record<string, unknown>, ctx: Context): Promise<string> }
const response = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
const validation = z.object({ clasificacion: z.string(), requiere_revision: z.array(z.string()), contrato_normalizado: contratoSchema.nullable() });
async function call(tool: Callable, args: Record<string, unknown>, ctx: Context): Promise<unknown> {
  const result = response.parse(JSON.parse(await tool.execute(args, ctx)) as unknown);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export async function runDemo(directory: string) {
  const ctx: Context = { directory, sessionId: 'demo-sin-modelo', hoy: '2026-09-03' };
  const output = await safeOut(ctx);
  if (output !== path.resolve(directory, 'out')) throw new Error('Ruta de limpieza no válida');
  await rm(output, { recursive: true, force: true });
  const mailbox = z.object({ mensajes: z.array(z.object({ id: z.string() })) }).parse(await call(leer_buzon, {}, ctx));
  const entries: { mensaje: string; clasificacion: string; revision: string[]; accion: string }[] = [];
  let pending: Contrato | null = null;
  for (const message of mailbox.mensajes) {
    const extraction = response.parse(JSON.parse(await extraer.execute({ mensaje_id: message.id }, ctx)) as unknown);
    const contract = extraction.ok ? contratoSchema.parse(extraction.data) : null;
    const result = validation.parse(await call(validar, { mensaje_id: message.id, contrato: contract }, ctx));
    if (result.requiere_revision.length) {
      const refused = response.parse(JSON.parse(await registrar.execute({ mensaje_id: message.id, contrato: result.contrato_normalizado }, ctx)) as unknown);
      if (refused.ok) throw new Error('El registro debió bloquear campos dudosos');
      entries.push({ mensaje: message.id, clasificacion: result.clasificacion, revision: result.requiere_revision, accion: 'pendiente de confirmación (sin registrar)' });
      if (message.id === 'msg-006') pending = result.contrato_normalizado;
    } else {
      const registered = z.object({ accion: z.string() }).parse(await call(registrar, { mensaje_id: message.id, contrato: result.contrato_normalizado }, ctx));
      entries.push({ mensaje: message.id, clasificacion: result.clasificacion, revision: [], accion: registered.accion });
    }
  }
  if (entries.find(entry => entry.mensaje === 'msg-003')?.accion !== 'actualizacion') throw new Error('El otrosí debe actualizarse sin revisión espuria');
  const before = (await readMaster(ctx)).length;
  if (before !== 10 || !pending) throw new Error(`Primera pasada inesperada: ${before} filas o sin pendiente msg-006`);
  // Entrada humana SIMULADA de aceptación, no datos extraídos ni autorización del modelo.
  const human = { valor: 0, moneda: 'COP' as const, fecha_inicio: '2026-08-31', fecha_fin: '2027-08-31', requiere_poliza: true, tipo_poliza: 'cumplimiento' };
  const corrected = contratoSchema.parse({ ...pending, ...human });
  await call(registrar, { mensaje_id: 'msg-006', contrato: corrected, confirmado: true }, ctx);
  const after = (await readMaster(ctx)).length;
  if (after !== 11) throw new Error(`Segunda pasada inesperada: ${after} filas`);
  const report = await call(alertas, { hoy: '2026-09-03' }, ctx);
  return { primeraPasada: entries, filasAntes: before, confirmacionHumanaSimulada: human, filasDespues: after, alertas: report };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await runDemo(process.cwd()), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Error de demo'); process.exitCode = 1; }
}
