import { z } from 'zod';
const json=z.record(z.unknown());
const call=z.object({id:z.string(),name:z.string(),args:json}).strict();
const message=z.object({role:z.enum(['system','user','assistant','tool']),content:z.string(),toolCalls:z.array(call).optional(),toolCallId:z.string().optional(),providerContent:json.optional()}).strict();
const item=z.object({messageId:z.string(),stage:z.enum(['extract','validate','register','review','closed','error']),hasContract:z.boolean(),classification:z.string().optional(),action:z.string().optional(),reviewFields:z.array(z.string()).optional(),error:z.string().optional()}).strict();
const batch=z.object({originalRequest:z.string(),referenceDate:z.string().date().nullable(),reportRequested:z.boolean(),paused:z.boolean().optional(),initialized:z.boolean(),items:z.array(item),errors:z.array(z.string()),reportGenerated:z.boolean(),reportAttempted:z.boolean(),status:z.enum(['reading','running','review','pending','error','complete'])}).strict();
const trace=z.object({name:z.string(),arguments:json,result:z.unknown()}).strict();
const pending=z.object({id:z.string().uuid(),turn:z.number().int().nonnegative(),messageId:z.string(),contract:json,fields:z.array(z.string()).min(1)}).strict();
// Los datos vienen del almacén backend, nunca del cuerpo enviado por el navegador.
export const engineStateSchema=z.object({version:z.literal(1),sessions:z.array(z.object({
  id:z.string().uuid(),messages:z.array(message),history:z.array(z.object({role:z.string(),content:z.string(),toolCalls:z.array(trace).optional(),batch:z.unknown().optional()})),
  contracts:z.array(z.tuple([z.string(),json])),nonContracts:z.array(z.string()),pending:pending.optional(),turn:z.number().int().nonnegative(),spent:z.number().int().nonnegative(),batch:batch.optional(),
}).strict()).max(5)}).strict();
export type EngineState=z.infer<typeof engineStateSchema>;