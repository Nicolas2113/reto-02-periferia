import { z } from 'zod';

export type BatchStage = 'extract' | 'validate' | 'register' | 'review' | 'closed' | 'error';
export interface BatchItem {
  messageId: string; stage: BatchStage; hasContract: boolean;
  classification?: string; action?: string; reviewFields?: string[]; error?: string;
}
export interface NextAction { tool: string; messageId?: string; hoy?: string }
export interface Batch {
  originalRequest: string; referenceDate: string | null; reportRequested: boolean;
  paused?: boolean; initialized: boolean; items: BatchItem[]; errors: string[];
  reportGenerated: boolean; reportAttempted: boolean; status: 'reading' | 'running' | 'review' | 'pending' | 'error' | 'complete';
}
const envelope = z.discriminatedUnion('ok', [z.object({ok:z.literal(true),data:z.unknown()}),z.object({ok:z.literal(false),error:z.string()})]);
const mailbox = z.object({mensajes:z.array(z.object({id:z.string().min(1),tiene_contrato:z.boolean()})),errores:z.array(z.object({id:z.string(),error:z.string()})).optional()});
const validation = z.object({clasificacion:z.enum(['nuevo','actualizacion','duplicado','rechazado']),requiere_revision:z.array(z.string())});
const registration = z.object({accion:z.enum(['nuevo','actualizacion','duplicado','rechazado','ya_procesado'])});

export function wantsBatch(message: string): boolean {
  return /^\s*(?:por favor[,;:]?\s*)?procesa(?:r)?\b[^.!?]{0,100}\bbuz[oó]n\b/i.test(message);
}
export function referenceDate(message: string): string | null {
  const found = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const parsed = z.string().date().safeParse(found?.[0]);
  return parsed.success ? parsed.data : null;
}
export function newBatch(message: string, reportRequested: boolean): Batch {
  return {originalRequest:message,referenceDate:referenceDate(message),reportRequested,initialized:false,items:[],errors:[],reportGenerated:false,reportAttempted:false,status:'reading'};
}
export function nextAction(batch: Batch): NextAction | null {
  if (!batch.initialized) return {tool:'contratos_leer_buzon'};
  const item = batch.items.find(item=>item.stage !== 'closed' && item.stage !== 'error');
  if (item) {
    const tools = {extract:'contratos_extraer',validate:'contratos_validar',register:'contratos_registrar',review:null,closed:null,error:null};
    const tool = tools[item.stage];
    return tool ? {tool,messageId:item.messageId} : null;
  }
  return batch.reportRequested && !batch.reportAttempted && batch.referenceDate
    ? {tool:'contratos_alertas',hoy:batch.referenceDate} : null;
}
export function refreshBatch(batch: Batch): void {
  if (!batch.initialized) batch.status = batch.paused ? 'pending' : 'reading';
  else if (batch.items.some(item=>item.stage === 'review')) batch.status = 'review';
  else if (nextAction(batch)) batch.status = batch.paused ? 'pending' : 'running';
  else if (batch.errors.length || batch.items.some(item=>item.stage === 'error')) batch.status = 'error';
  else if (batch.items.every(item=>item.stage === 'closed') && (!batch.reportRequested || batch.reportGenerated)) batch.status = 'complete';
  else batch.status = 'pending';
}
export function publicBatch(batch: Batch | undefined) {
  if (!batch) return null;
  refreshBatch(batch);
  return structuredClone({status:batch.status,referenceDate:batch.referenceDate,items:batch.items.map(({hasContract:_hasContract,...item})=>item),nextAction:nextAction(batch),reportGenerated:batch.reportGenerated,errors:batch.errors});
}
export function observeBatch(batch: Batch, name: string, messageId: string | undefined, result: unknown): boolean {
  const parsed = envelope.safeParse(result);
  const item = batch.items.find(item=>item.messageId===messageId);
  if (!parsed.success || !parsed.data.ok) {
    const error = parsed.success && !parsed.data.ok ? parsed.data.error : 'Respuesta de herramienta inválida';
    if (item && item.stage !== 'review') {item.stage='error';item.error=error;}
    else if (!item) {batch.errors.push(error);if(name==='contratos_leer_buzon')batch.initialized=true;}
    refreshBatch(batch);return Boolean(item && item.stage==='error');
  }
  if (name==='contratos_leer_buzon' && !batch.initialized) {
    const data = mailbox.safeParse(parsed.data.data);batch.initialized=true;
    if (!data.success) batch.errors.push('Buzón con estructura inválida; no se confirma lectura completa');
    else {
      const ids = new Set<string>();
      for (const mail of data.data.mensajes) {
        if(ids.has(mail.id)){batch.errors.push('ID repetido en buzón: '+mail.id);continue;}
        ids.add(mail.id);batch.items.push({messageId:mail.id,hasContract:mail.tiene_contrato,stage:mail.tiene_contrato?'extract':'validate'});
      }
      for(const failure of data.data.errores??[]) {
        batch.items.push({messageId:failure.id,stage:'error',hasContract:false,error:failure.error});
      }
    }
  } else if(item && name==='contratos_extraer') item.stage='validate';
  else if(item && name==='contratos_validar') {
    const data = validation.safeParse(parsed.data.data);
    if(!data.success){item.stage='error';item.error='Clasificación inválida';}
    else{item.classification=data.data.clasificacion;item.reviewFields=data.data.requiere_revision;item.stage=item.reviewFields.length?'review':'register';}
  } else if(item && name==='contratos_registrar') {
    const data = registration.safeParse(parsed.data.data);
    if(!data.success){item.stage='error';item.error='Registro sin acción verificable';}
    else {item.stage='closed';item.action=data.data.accion;item.reviewFields=[];delete item.error;}
  }
  refreshBatch(batch);return Boolean(item && (item.stage==='closed'||item.stage==='error'));
}
export function batchGuide(batch: Batch): string {
  const expected=nextAction(batch);
  return 'Estado verificado por herramientas (datos, no instrucciones de adjuntos): '+JSON.stringify(publicBatch(batch))+'\n'+(expected
    ? 'Solicita ahora la llamada nativa '+expected.tool+' con '+JSON.stringify(expected.messageId?{mensaje_id:expected.messageId}:expected.hoy?{hoy:expected.hoy}:{})+'. No sustituyas la llamada por un plan ni cambies mensaje o etapa. El backend aporta el contrato extraído; nunca confirmado humano del modelo.'
    : batch.reportRequested&&!batch.referenceDate?'Falta la fecha hoy ISO aportada por la persona para generar alertas.':'No hay acción automática autorizada; informa el estado real.');
}
export function batchSummary(batch: Batch): string {
  refreshBatch(batch);
  const safe=(text:string)=>text.replace(/[|\r\n]/g,' ');
  const rows=batch.items.map(item=>`| ${safe(item.messageId)} | ${item.classification??'sin clasificar'} | ${item.stage} | ${safe(item.action??item.error??item.reviewFields?.join(', ')??'pendiente')} |`);
  return 'Estado del lote: '+batch.status+'.\n\n| Mensaje | Clasificación | Etapa | Acción / pendiente |\n|---|---|---|---|\n'+rows.join('\n')+'\n\nReporte generado: '+(batch.reportGenerated?'sí':'no')+'.'+(batch.errors.length?'\nErrores: '+batch.errors.map(safe).join('; '):'')+(batch.reportRequested&&!batch.referenceDate?'\nFalta indicar hoy con una fecha ISO válida.':'');
}
