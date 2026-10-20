import { appendFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

interface Context { directory: string; sessionId: string }
interface Message {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
  tiene_contrato: boolean;
  clasificacion?: 'rechazado';
  motivo?: string;
}
interface MessageError { mensaje_id: string; error: string }

const noArguments = z.object({}).strict();
const mailSchema = z.object({
  id: z.string().min(1),
  de: z.string().email(),
  asunto: z.string(),
  fecha: z.string().datetime({ offset: true }),
  adjuntos: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)),
});
const processedSchema = z.union([
  z.record(z.unknown()),
  z.array(z.string()),
]);

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function json(file: string): Promise<unknown> {
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
}

async function pendingIds(directory: string): Promise<Set<string>> {
  try {
    const processed = processedSchema.safeParse(await json(path.join(directory, 'out', 'procesados.json')));
    if (!processed.success) throw new Error('out/procesados.json debe ser un objeto por ID o una lista de IDs');
    return new Set(Array.isArray(processed.data) ? processed.data : Object.keys(processed.data));
  } catch (error) {
    if (isMissing(error)) return new Set();
    if (error instanceof SyntaxError) throw new Error('out/procesados.json contiene JSON inválido');
    throw error;
  }
}

function normalizedTitle(text: string): string {
  return text.replace(/^\uFEFF/, '').trim().split(/\r?\n/, 1)[0]?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase() ?? '';
}

async function hasContract(messageDirectory: string, attachments: string[]): Promise<boolean> {
  for (const attachment of attachments) {
    // El PRD entrega texto ya extraído; PDF/OCR no pertenece a esta herramienta P0.
    if (!attachment.toLowerCase().endsWith('.txt')) continue;
    const file = path.join(messageDirectory, attachment);
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Adjunto enlazado no permitido');
    const title = normalizedTitle(await readFile(file, 'utf8'));
    if (/^contrato\b/.test(title) || /^otrosi\b.*\bcontrato\b/.test(title)) return true;
  }
  return false;
}

async function listMessages(ctx: Context): Promise<{ mensajes: Message[]; errores: MessageError[] }> {
  const mailbox = path.join(ctx.directory, 'fixtures', 'reto-02', 'buzon');
  const processed = await pendingIds(ctx.directory);
  const directories = (await readdir(mailbox, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !processed.has(entry.name))
    .map(entry => entry.name).sort();
  const mensajes: Message[] = [];
  const errores: MessageError[] = [];
  for (const id of directories) {
    try {
      const messageDirectory = path.join(mailbox, id);
      const parsed = mailSchema.safeParse(await json(path.join(messageDirectory, 'correo.json')));
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))];
        throw new Error(`correo.json inválido; revisar campos: ${fields.join(', ')}`);
      }
      const mail = parsed.data;
      if (mail.id !== id) throw new Error('ID del correo no coincide con el directorio');
      const tiene_contrato = await hasContract(messageDirectory, mail.adjuntos);
      mensajes.push({
        id: mail.id, de: mail.de, asunto: mail.asunto, fecha: mail.fecha,
        adjuntos: mail.adjuntos, tiene_contrato,
        ...(!tiene_contrato ? {
          clasificacion: 'rechazado' as const,
          motivo: 'Sin adjunto de contrato identificable: los TXT no tienen título de contrato u otrosí',
        } : {}),
      });
    } catch (error) {
      errores.push({ mensaje_id: id, error: readable(error, `No se pudo leer ${id}`) });
    }
  }
  return { mensajes, errores };
}

function readable(error: unknown, fallback: string): string {
  if (error instanceof SyntaxError) return 'correo.json contiene JSON inválido';
  if (error instanceof Error && 'code' in error) {
    if (error.code === 'ENOENT') return `${fallback}: falta un archivo o directorio requerido`;
    if (error.code === 'EACCES' || error.code === 'EPERM') return `${fallback}: acceso denegado`;
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

async function log(ctx: Context, ok: boolean, resumen: string): Promise<void> {
  const output = path.join(ctx.directory, 'out');
  for (const candidate of [output, path.join(output, 'log.jsonl')]) {
    try {
      if ((await lstat(candidate)).isSymbolicLink()) throw new Error('No se permiten enlaces en la bitácora');
    } catch (error) { if (!isMissing(error)) throw error; }
  }
  await mkdir(output, { recursive: true });
  await appendFile(path.join(output, 'log.jsonl'), JSON.stringify({
    ts: new Date().toISOString(), herramienta: 'contratos_leer_buzon',
    mensaje_id: null, ok, resumen,
  }) + '\n', 'utf8');
}

export const leer_buzon = {
  description: 'Lista correos pendientes del buzón simulado e identifica adjuntos de contrato u otrosí, informando rechazos y errores por mensaje.',
  args: {},
  async execute(args: Record<string, unknown>, ctx: Context): Promise<string> {
    let result: { ok: true; data: { mensajes: Message[]; errores: MessageError[] } } | { ok: false; error: string };
    try {
      noArguments.parse(args);
      const data = await listMessages(ctx);
      result = { ok: true, data };
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof z.ZodError ? 'contratos_leer_buzon no recibe argumentos' : readable(error, 'No se pudo leer el buzón'),
      };
    }
    try {
      await log(ctx, result.ok, result.ok
        ? `${result.data.mensajes.length} pendientes; ${result.data.errores.length} errores de lectura`
        : result.error);
    } catch {
      return JSON.stringify({ ok: false, error: 'No se pudo guardar out/log.jsonl; verifica el acceso al directorio de salida' });
    }
    return JSON.stringify(result);
  },
};
