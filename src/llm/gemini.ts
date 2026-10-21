import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LlmAdapter, ModelMessage, ModelOptions, ModelResponse, ToolDefinition } from './adapter.js';
export const freeModels=['gemini-3.8-flash','gemini-3.5-flash-lite'] as const;
export class GeminiError extends Error {constructor(readonly status:number){super(status===429?'Gemini: cuota agotada; conservar progreso':`Gemini: proveedor no disponible (${status})`);}}
export function geminiSchema(schema:z.ZodTypeAny):Record<string,unknown>{
  let result:Record<string,unknown>;
  if(schema instanceof z.ZodOptional||schema instanceof z.ZodDefault)result=geminiSchema(schema._def.innerType);
  else if(schema instanceof z.ZodEffects)result=geminiSchema(schema.innerType());
  else if(schema instanceof z.ZodNullable)result={...geminiSchema(schema.unwrap()),nullable:true};
  else if(schema instanceof z.ZodObject){const shape:z.ZodRawShape=schema.shape;result={type:'OBJECT',properties:Object.fromEntries(Object.entries(shape).map(([key,value])=>[key,geminiSchema(value)])),required:Object.entries(shape).filter(([,value])=>!value.isOptional()).map(([key])=>key)};}
  else if(schema instanceof z.ZodLiteral)result=typeof schema.value==='string'?{type:'STRING',enum:[schema.value]}:{type:typeof schema.value==='boolean'?'BOOLEAN':'NUMBER'};
  else if(schema instanceof z.ZodEnum)result={type:'STRING',enum:schema.options};
  else if(schema instanceof z.ZodString)result={type:'STRING'};
  else if(schema instanceof z.ZodNumber)result={type:'NUMBER'};
  else if(schema instanceof z.ZodBoolean)result={type:'BOOLEAN'};
  else if(schema instanceof z.ZodArray)result={type:'ARRAY',items:geminiSchema(schema.element)};
  else throw new Error('Schema de herramienta no soportado por Gemini');
  if(schema.description)result.description=schema.description;return result;
}
const candidateSchema=z.object({content:z.object({role:z.string(),parts:z.array(z.record(z.unknown()))}).passthrough().optional(),finishReason:z.string().optional()});
const apiSchema=z.object({candidates:z.array(candidateSchema).optional(),promptFeedback:z.object({blockReason:z.string().optional()}).optional(),usageMetadata:z.object({promptTokenCount:z.number().int().nonnegative().optional(),candidatesTokenCount:z.number().int().nonnegative().optional(),thoughtsTokenCount:z.number().int().nonnegative().optional(),totalTokenCount:z.number().int().nonnegative().optional()}).optional()});
const functionSchema=z.object({name:z.string().min(1),args:z.record(z.unknown()).default({}),id:z.string().optional()});
export class GeminiAdapter implements LlmAdapter {
  readonly provider='gemini';readonly configured=true;readonly model:string;
  private readonly fetcher:typeof fetch;
  constructor(private readonly options:{apiKey:string;model:string;fetcher?:typeof fetch}){
    if(!options.apiKey||!freeModels.includes(options.model as typeof freeModels[number]))throw new Error('Gemini requiere clave backend y un modelo de la lista gratuita aprobada');
    this.model=options.model;this.fetcher=options.fetcher??fetch;
  }
  async enviar(messages:ModelMessage[],tools:ToolDefinition[],options:ModelOptions):Promise<ModelResponse>{
    const calls=new Map(messages.flatMap(message=>(message.toolCalls??[]).map(call=>[call.id,{call,native:message.providerContent}])));
    const contents=messages.filter(message=>message.role!=='system').map(message=>{
      if(message.role==='assistant'&&message.providerContent)return structuredClone(message.providerContent);
      if(message.role==='tool'){
        const previous=message.toolCallId?calls.get(message.toolCallId):undefined;if(!previous)throw new Error('Resultado Gemini sin llamada conocida');
        let result:unknown;try{result=JSON.parse(message.content) as unknown;}catch{result={texto:message.content};}
        const parts=previous.native?.parts;const native=Array.isArray(parts)?parts.map(part=>z.record(z.unknown()).parse(part)).find(part=>{const fc=functionSchema.safeParse(part.functionCall);return fc.success&&fc.data.name===previous.call.name;}):undefined;
        const fc=native?functionSchema.safeParse(native.functionCall):undefined;
        return {role:'user',parts:[{functionResponse:{name:previous.call.name,...(fc?.success&&fc.data.id?{id:fc.data.id}:{}),response:result}}]};
      }
      return {role:message.role==='assistant'?'model':'user',parts:[...(message.content?[{text:message.content}]:[]),...(message.toolCalls??[]).map(call=>({functionCall:{name:call.name,args:call.args}}))]};
    });
    const payload={systemInstruction:{parts:[{text:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n')}]},contents,
      ...(tools.length?{tools:[{functionDeclarations:tools.map(tool=>({name:tool.name,description:tool.description,parameters:geminiSchema(tool.parameters)}))}]}:{}),
      generationConfig:{temperature:0,maxOutputTokens:options.maxOutputTokens}};
    let response:Response;try{response=await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':this.options.apiKey},body:JSON.stringify(payload),signal:options.signal,redirect:'error'});}catch{throw new Error('Gemini: conexión interrumpida; no se confirma una nueva ejecución');}
    if(!response.ok)throw new GeminiError(response.status);
    let raw:z.infer<typeof apiSchema>;try{raw=apiSchema.parse(await response.json() as unknown);}catch{throw new Error('Gemini: respuesta inválida');}
    const first=raw.candidates?.[0];if(raw.promptFeedback?.blockReason||!first?.content||!['STOP','MAX_TOKENS',undefined].includes(first.finishReason))throw new Error('Gemini no devolvió una respuesta utilizable; solicitud bloqueada o incompleta');
    const parts=first.content.parts,usage=raw.usageMetadata;
    return {content:parts.filter(part=>part.thought!==true&&typeof part.text==='string').map(part=>String(part.text)).join(''),providerContent:first.content,
      toolCalls:parts.filter(part=>part.functionCall!==undefined).map(part=>{const call=functionSchema.parse(part.functionCall);return {id:call.id??randomUUID(),name:call.name,args:call.args};}),
      ...(usage?{usage:{inputTokens:usage.promptTokenCount??0,outputTokens:Math.max((usage.candidatesTokenCount??0)+(usage.thoughtsTokenCount??0),(usage.totalTokenCount??0)-(usage.promptTokenCount??0))}}:{}),
      diagnostics:{doneReason:first.finishReason==='MAX_TOKENS'?'length':'stop',outputLimit:options.maxOutputTokens}};
  }
}