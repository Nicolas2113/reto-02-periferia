import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { reportDiagnostic, DiagnosticError } from '../src/diagnostico.js';
import { GeminiAdapter, GeminiError } from '../src/llm/gemini.js';
import { AgentEngine } from '../src/server.js';
import type { LlmAdapter } from '../src/llm/adapter.js';
const secret='SENSITIVE_MARKER_NEVER_LOG';
async function isolated(action:(directory:string)=>Promise<void>){const dir=await mkdtemp(path.join(tmpdir(),'periferia-diagnostic-'));try{await action(dir);}finally{assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(dir).startsWith('periferia-diagnostic-'));await rm(dir,{recursive:true,force:true});}}
test('Diagnóstico: status Gemini se clasifica sin cuerpo, credenciales ni excepción cruda',()=>{
  for(const status of [400,401,403,404,429,500,503,418]){const events:string[]=[];const error=new GeminiError(status);error.message=secret;error.stack=secret;const code=reportDiagnostic(error,{provider:'gemini',model:'gemini-3.8-flash',started:Date.now()},event=>events.push(event));assert.equal(code,status>=500?'GEMINI_HTTP_5XX':status===418?'GEMINI_HTTP_OTHER':'GEMINI_HTTP_'+status);const event=JSON.parse(events[0]??'')as Record<string,unknown>;assert.equal(event.httpStatus,status);assert.equal(event.stage,'provider');assert.equal(event.model,'gemini-3.8-flash');assert.ok(!JSON.stringify(event).includes(secret));assert.deepEqual(Object.keys(event).sort(),['event','code','stage','provider','model','httpStatus','durationMs'].sort());}
});
test('Diagnóstico: contexto y errores arbitrarios nunca se serializan; sink fallido no rompe sesión',()=>{
  const output:string[]=[];assert.equal(reportDiagnostic(new Error(secret),{provider:secret,model:secret,started:Date.now()},value=>output.push(value)),'AGENT_FAILED');assert.ok(!output.join('').includes(secret));assert.match(output[0]??'',/"model":"other"/);assert.doesNotThrow(()=>reportDiagnostic(new DiagnosticError('AUDIT_WRITE_FAILED','audit'),{started:Date.now()},()=>{throw new Error(secret);}));
});
test('Diagnóstico: Gemini429 visible en respuesta, evento seguro y sesión pendiente recuperable',async()=>{
  await isolated(async directory=>{const engine=new AgentEngine({directory,prompt:'Reglas ficticias',adapter:{provider:'gemini',model:'gemini-3.8-flash',configured:true,enviar:async()=>{throw new GeminiError(429);}}});const result=await engine.chat({message:'Procesa el buzón con fecha de hoy 2026-09-03 y termina con el reporte de alertas.'});assert.equal(result.diagnosticCode,'GEMINI_HTTP_429');assert.match(result.reply,/Cuota/);assert.match(result.reply,/GEMINI_HTTP_429/);assert.equal(result.toolCalls.length,0);assert.equal(result.batch?.status,'pending');assert.ok(engine.session(result.sessionId));assert.ok(!JSON.stringify(result).includes(secret));});
});
test('Diagnóstico: escritura de bitácora fallida se distingue de error del modelo',async()=>{
  await isolated(async directory=>{await writeFile(path.join(directory,'out'),'archivo obstáculo ficticio');const adapter:LlmAdapter={provider:'gemini',model:'gemini-3.8-flash',configured:true,enviar:async()=>({content:'Texto de prueba',toolCalls:[],usage:{inputTokens:1,outputTokens:1}})};const result=await new AgentEngine({directory,adapter,prompt:'Prueba'}).chat({message:'¿Qué es un contrato?'});assert.equal(result.diagnosticCode,'AUDIT_WRITE_FAILED');assert.match(result.reply,/AUDIT_WRITE_FAILED/);assert.ok(!result.reply.includes(directory));});
});
test('Diagnóstico: transporte, respuesta inválida y bloqueo de Gemini son códigos distintos',async()=>{
  const options={signal:AbortSignal.timeout(1000),maxOutputTokens:10};
  for(const [fetcher,code]of [[async()=>{throw new Error(secret);},'GEMINI_TRANSPORT'],[async()=>Response.json({candidates:'invalid-'+secret}),'GEMINI_RESPONSE_INVALID'],[async()=>Response.json({promptFeedback:{blockReason:secret}}),'GEMINI_RESPONSE_BLOCKED']]as const){const adapter=new GeminiAdapter({apiKey:secret,model:'gemini-3.8-flash',fetcher});await assert.rejects(adapter.enviar([{role:'user',content:'Prueba'}],[],options),error=>error instanceof DiagnosticError&&error.code===code&&!error.message.includes(secret));}
});