import { z } from 'zod';

export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Fecha de calendario inválida');

const valuesSchema = z.object({
  id_contrato: z.string().nullable(), cliente: z.string().nullable(),
  nit_cliente: z.string().regex(/^\d+$/).nullable(),
  pais: z.enum(['CO', 'EC', 'PE', 'PA', 'HN']).nullable(),
  objeto: z.string().max(200).nullable(), valor: z.number().finite().nonnegative().nullable(),
  moneda: z.enum(['COP', 'USD', 'PEN', 'PAB', 'HNL']).nullable(),
  fecha_inicio: fechaSchema.nullable(), fecha_fin: fechaSchema.nullable(),
  requiere_poliza: z.boolean().nullable(), tipo_poliza: z.string().nullable(),
  estado_poliza: z.enum(['vigente', 'pendiente', 'vencida', 'no_aplica']).nullable(),
  comercial: z.string().nullable(), ruta_sharepoint: z.string().nullable(),
  fecha_registro: fechaSchema.nullable(), fuente: z.enum(['buzon', 'manual', 'migracion']).nullable(),
  valor_indeterminado: z.boolean().nullable(), plazo_meses: z.number().int().positive().nullable(),
  poliza_condicional: z.boolean().nullable(), tipo_documento: z.enum(['contrato', 'otrosi']),
});
type Values = z.infer<typeof valuesSchema>;
type Field = keyof Values;
const confidenceShape = Object.fromEntries(Object.keys(valuesSchema.shape)
  .map(field => [field, z.number().min(0).max(1)])) as Record<Field, z.ZodNumber>;
export const contratoSchema = valuesSchema.extend({
  confianza: z.object(confidenceShape).strict(), evidencias: z.record(z.string()),
  advertencias: z.array(z.string()),
}).strict();
export type Contrato = z.infer<typeof contratoSchema>;

// Escala ordinal de evidencia, no probabilidades: literal / inferencia simple / derivación / ambigüedad / ausencia.
const LITERAL = 0.9, INFERIDO = 0.8, DERIVADO = 0.7, AMBIGUO = 0.5;
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const normalized = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const compact = (text: string): string => text.replace(/\s+/g, ' ').trim();

function clause(paragraphs: string[], label: string): string | undefined {
  return paragraphs.find(paragraph => {
    const start = normalized(paragraph).slice(0, 140);
    return new RegExp(`^[a-z]+\\.\\s*(?:${label}\\.|modificar la clausula [a-z]+ \\(${label}\\))`).test(start);
  });
}

function amount(raw: string): number {
  const decimal = /[.,]\d{2}$/.test(raw) ? raw.slice(-3, -2) : null;
  const group = decimal === '.' ? ',' : '.';
  const valid = decimal
    ? new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})*(?:\\${decimal}\\d{2})$|^\\d+(?:\\${decimal}\\d{2})$`).test(raw)
    : /^\d+$|^\d{1,3}(?:[.]\d{3})+$|^\d{1,3}(?:,\d{3})+$/.test(raw);
  if (!valid) throw new Error('Formato de valor monetario inválido');
  const whole = decimal ? raw.slice(0, -3).replace(/[.,]/g, '') + '.' + raw.slice(-2) : raw.replace(/[.,]/g, '');
  const result = Number(whole);
  if (!Number.isFinite(result) || result < 0) throw new Error('Valor monetario inválido');
  return result;
}

function dates(text: string): { value: string; index: number; evidence: string }[] {
  const source = normalized(text);
  const matches: { value: string; index: number; evidence: string }[] = [];
  const datePattern = /\b\d{4}-\d{2}-\d{2}\b|(?:\((\d{1,2})\)|\b(\d{1,2}))\s+de\s+([a-z]+)\s+de\s+(\d{4})/g;
  for (const match of source.matchAll(datePattern)) {
    let value = match[0];
    if (match[4]) {
      const month = match[3] === 'setiembre' ? 9 : months.indexOf(match[3] ?? '') + 1;
      if (!month) throw new Error('Mes contractual desconocido');
      value = `${match[4]}-${String(month).padStart(2, '0')}-${(match[1] ?? match[2] ?? '').padStart(2, '0')}`;
    }
    if (!fechaSchema.safeParse(value).success) throw new Error('Fecha contractual inválida');
    matches.push({ value, index: match.index ?? 0, evidence: match[0] });
  }
  return matches;
}

export function extraerTexto(text: string): Contrato {
  if (!text.trim()) throw new Error('Texto contractual vacío');
  const title = normalized(text.replace(/^\uFEFF/, '').trim().split(/\r?\n/, 1)[0] ?? '');
  const isAmendment = /^otrosi\b.*\bcontrato\b/.test(title);
  if (!/^contrato\b/.test(title) && !isAmendment) throw new Error('Documento no contractual: no hay contrato u otrosí identificable');
  const values: Values = {
    id_contrato: null, cliente: null, nit_cliente: null, pais: null, objeto: null,
    valor: null, moneda: null, fecha_inicio: null, fecha_fin: null,
    requiere_poliza: null, tipo_poliza: null, estado_poliza: null, comercial: null,
    ruta_sharepoint: null, fecha_registro: null, fuente: null,
    valor_indeterminado: null, plazo_meses: null, poliza_condicional: null,
    tipo_documento: isAmendment ? 'otrosi' : 'contrato',
  };
  const confidence = Object.fromEntries(Object.keys(values).map(field => [field, 0])) as Record<Field, number>;
  const evidence: Record<string, string> = {};
  const warnings: string[] = [];
  function set<K extends Field>(field: K, value: Values[K], score: number, source: string): void {
    values[field] = value;
    confidence[field] = value === null ? 0 : score;
    if (value !== null) evidence[field] = source;
  }
  set('tipo_documento', values.tipo_documento, LITERAL, title);
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(compact).filter(Boolean);
  const id = text.match(/\bCONTRATO[^\r\n]*?\bNo\.\s*([A-Z0-9][A-Z0-9-]*)/i);
  if (id?.[1]) set('id_contrato', id[1], LITERAL, id[0]);
  const party = text.match(/\bEntre(?:\s+los\s+suscritos,)?\s+(.+?),\s*(?:identificad[ao]\s+con\s+)?(NIT|RUC)\s+([\d.-]+)/i);
  if (party?.[1] && party[2] && party[3] && !normalized(party[1]).includes('periferia it group')) {
    set('cliente', compact(party[1]), LITERAL, party[0]);
    const taxId = party[2].toUpperCase() === 'NIT' ? party[3].split('-')[0] ?? '' : party[3];
    set('nit_cliente', taxId.replace(/\D/g, ''), LITERAL, party[3]);
    // Solo la parte de la contraparte, para no atribuirle Colombia por la sede de Periferia.
    const counterpart = text.slice(party.index ?? 0).split(/\s+y\s+PERIFERIA\b/i)[0] ?? '';
    const countryText = normalized(counterpart);
    if (/ecuador|quito/.test(countryText)) set('pais', 'EC', INFERIDO, 'Domicilio de contraparte: Ecuador/Quito');
    else if (/peru|\blima\b/.test(countryText)) set('pais', 'PE', INFERIDO, 'Domicilio de contraparte: Perú/Lima');
    else if (/panama/.test(countryText)) set('pais', 'PA', INFERIDO, 'Domicilio de contraparte: Panamá');
    else if (/honduras/.test(countryText)) set('pais', 'HN', INFERIDO, 'Domicilio de contraparte: Honduras');
    else if (/colombia|bogota|medellin|barranquilla/.test(countryText)) set('pais', 'CO', INFERIDO, 'Domicilio de contraparte en Colombia');
  }
  const objectClause = clause(paragraphs, 'objeto');
  if (objectClause) {
    const object = objectClause.replace(/^\p{L}+\.\s*OBJETO\.\s*/iu, '');
    set('objeto', object.length <= 200 ? object : object.slice(0, 200).replace(/\s+\S*$/, ''), LITERAL, objectClause);
    if (object.length > 200) warnings.push('objeto resumido por recorte a máximo 200 caracteres; texto completo en evidencias.objeto');
  }
  const valueClause = clause(paragraphs, 'valor');
  if (valueClause) {
    if (/no tiene un valor determinado|valor (?:es )?indeterminado|por demanda/.test(normalized(valueClause))) {
      set('valor', 0, AMBIGUO, valueClause);
      set('valor_indeterminado', true, LITERAL, valueClause);
      warnings.push('Valor por demanda: 0 es representación del PRD, no valor total conocido; requiere revisión');
    } else {
      const money = valueClause.match(/\b([A-Z]{3})\s*\$?\s*([0-9][0-9.,]*)/);
      if (money?.[1] && money[2]) {
        const currency = valuesSchema.shape.moneda.safeParse(money[1]);
        if (!currency.success) throw new Error('Moneda contractual no admitida');
        set('valor', amount(money[2]), LITERAL, money[0]);
        set('moneda', currency.data, LITERAL, money[0]);
        set('valor_indeterminado', false, LITERAL, valueClause);
      }
    }
  }
  const term = clause(paragraphs, 'plazo');
  if (term) {
    const duration = term.match(/(?:\((\d{1,3})\)|\b(\d{1,3}))\s+meses\b/i);
    if (duration) set('plazo_meses', Number(duration[1] ?? duration[2]), LITERAL, duration[0]);
    for (const date of dates(term)) {
      const before = normalized(term.slice(0, date.index));
      const start = Math.max(before.lastIndexOf('desde'), before.lastIndexOf('a partir'));
      const end = before.lastIndexOf('hasta');
      if (end > start) set('fecha_fin', date.value, LITERAL, date.evidence);
      else if (start >= 0) set('fecha_inicio', date.value, LITERAL, date.evidence);
    }
    if (values.fecha_inicio && values.plazo_meses && !values.fecha_fin) {
      const start = new Date(`${values.fecha_inicio}T00:00:00Z`);
      if (start.getUTCDate() <= 28) {
        start.setUTCMonth(start.getUTCMonth() + values.plazo_meses);
        start.setUTCDate(start.getUTCDate() - 1);
        set('fecha_fin', start.toISOString().slice(0, 10), DERIVADO, 'Inicio completo + plazo en meses - un día (fin inclusivo)');
      } else warnings.push('Fecha fin por plazo con inicio al final de mes: se deja pendiente de revisión');
    }
    if (!values.fecha_inicio && values.plazo_meses) warnings.push('Plazo conocido, pero sin día de inicio no se calcula fecha fin');
    if (values.fecha_inicio && values.fecha_fin && values.fecha_fin < values.fecha_inicio) throw new Error('Fecha fin anterior a fecha inicio');
  }
  const guarantees = clause(paragraphs, 'garantias') ?? clause(paragraphs, 'polizas');
  if (guarantees) {
    const source = normalized(guarantees);
    const conditional = /para cada orden|cuyo valor|supere|siempre que|cuando/.test(source);
    set('poliza_condicional', conditional, LITERAL, guarantees);
    const types: string[] = [];
    if (/cumplimiento/.test(source)) types.push('cumplimiento');
    if (/responsabilidad civil/.test(source)) types.push('responsabilidad_civil');
    if (/calidad/.test(source)) types.push('calidad');
    if (/salarios|prestaciones/.test(source)) types.push('salarios_prestaciones');
    if (types.length) set('tipo_poliza', types.join(';'), LITERAL, guarantees);
    if (!conditional && /poliza|garantia/.test(source)) set('requiere_poliza', true, LITERAL, guarantees);
    if (conditional) warnings.push('Póliza condicional por orden: requiere_poliza queda null; confirmar aplicabilidad, no obligación global');
  } else if (!isAmendment && values.cliente && values.objeto && /se firma/i.test(text) && !/poliza|garantia/.test(normalized(text))) {
    set('requiere_poliza', false, INFERIDO, 'Contrato con cierre de firma y sin cláusula de garantía en el TXT entregado');
    set('tipo_poliza', '', INFERIDO, 'Sin garantía en el TXT entregado');
  }
  if (isAmendment) warnings.push('Otrosí parcial: ausencias conservadas como null/0, sin consultar el maestro');
  return contratoSchema.parse({ ...values, confianza: confidence, evidencias: evidence, advertencias: warnings });
}
