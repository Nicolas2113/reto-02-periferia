import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DemoStore, emptyState, LEASE_MS, type RedisTransport, UpstashRest } from '../src/cloud/store.js';
import { createCloudHandler, handlerFromEnvironment, type CloudConfig } from '../src/cloud/handler.js';
import { newIdentity, visitorFromCookie } from '../src/cloud/security.js';
import { createWorkspace, removeWorkspace, snapshotFiles } from '../src/cloud/workspace.js';
import { readMaster, readProcessed } from '../src/almacen.js';
import { GeminiAdapter, geminiSchema, GeminiError } from '../src/llm/gemini.js';
import type { LlmAdapter, ModelMessage, ModelResponse, ToolDefinition } from '../src/llm/adapter.js';
const assets=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// In-memory Redis protocol/Lua contract double. No Redis/Gemini network or credentials.
class FakeRedis implements RedisTransport {
  values=new Map<string,string>();expires=new Map<string,number>();time=0;ambiguous=false;
  get(key:string){if((this.expires.get(key)??Infinity)<=this.time){this.values.delete(key);this.expires.delete(key);}return this.values.get(key)??null;}
  async command(args:(string|number)[]):Promise<unknown>{
    const a=args.map(String),cmd=a[0],key=a[1]??'';
    if(cmd==='GET')return this.get(key);
    if(cmd==='SET'){if(a.includes('NX')&&this.get(key)!==null)return null;this.values.set(key,a[2]??'');const px=a.indexOf('PX'),ex=a.indexOf('EX');if(px>=0||ex>=0)this.expires.set(key,this.time+Number(a[(px>=0?px:ex)+1])*(px>=0?1:1000));return 'OK';}
    if(cmd!=='EVAL')throw new Error('Unexpected fake command');
    const script=a[1]??'',count=Number(a[2]),keys=a.slice(3,3+count),v=a.slice(3+count),k=keys[0]??'';
    if(script.includes('commit-v1')){if(this.get(k)!==v[0])return -1;const stateKey=keys[1]??'',raw=this.get(stateKey);if(raw===null)return -2;if((JSON.parse(raw)as {version:number}).version!==Number(v[1]))return -3;this.values.set(stateKey,v[2]??'');this.expires.set(stateKey,this.time+Number(v[3])*1000);this.values.delete(k);if(this.ambiguous){this.ambiguous=false;throw new Error('network after durable commit');}return 1;}
    if(script.includes('release-v1')){if(this.get(k)!==v[0])return 0;this.values.delete(k);return 1;}
    if(script.includes('rate-v1')){const value=Number(this.get(k)??0);if(value>=Number(v[0]))return 0;this.values.set(k,String(value+1));return 1;}
    if(script.includes('budget-v1')){const calls=Number(this.get(k)??0),tokens=Number(this.get(keys[1]??'')??0),rpm=Number(this.get(keys[2]??'')??0);if(calls>=Number(v[0])||tokens+Number(v[2])>Number(v[1])||rpm>=Number(v[3]))return 0;this.values.set(k,String(calls+1));this.values.set(keys[1]??'',String(tokens+Number(v[2])));this.values.set(keys[2]??'',String(rpm+1));return 1;}
    throw new Error('Unexpected Lua');
  }
}
const config:CloudConfig={origin:'https://demo.example',accessCode:'a'.repeat(40),cookieSecret:'s'.repeat(40),model:'gemini-3.8-flash',modelCalls:100,modelTokens:3000000,modelRpm:60};
class BatchFake implements LlmAdapter {
  readonly provider='fake_solo_pruebas';readonly model='fake';readonly configured=true;calls=0;
  async enviar(_messages:ModelMessage[],tools:ToolDefinition[]):Promise<ModelResponse>{this.calls++;assert.equal(tools.length,1);const tool=tools[0];assert.ok(tool);const args:Record<string,unknown>={};for(const [key,schema]of Object.entries(tool.parameters.shape))if(schema instanceof z.ZodLiteral)args[key]=schema.value;return {content:'',toolCalls:[{id:randomUUID(),name:tool.name,args}],usage:{inputTokens:30,outputTokens:10}};}
}
function request(route:string,body?:unknown,cookie?:string,id?:string){return new Request(config.origin+route,{method:body===undefined?'GET':'POST',headers:{origin:config.origin,'Content-Type':'application/json',...(cookie?{cookie}:{}),...(id?{'x-request-id':id}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function setup(adapter:LlmAdapter=new BatchFake(),cloudConfig=config){const redis=new FakeRedis(),store=new DemoStore(redis,'tests');const handler=()=>createCloudHandler({assets,config:cloudConfig,store,adapter:()=>adapter});return {redis,store,handler,adapter};}
async function login(handler:ReturnType<typeof createCloudHandler>){const response=await handler(request('/api/access',{code:config.accessCode}));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);return cookie;}
const instruction='Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.';
test('Cloud: cold starts, revisión humana real del backend y snapshot aislado 10→11; fake de modelo explícito',async()=>{
  const s=setup(),cookie=await login(s.handler()),id=randomUUID();
  const response=await s.handler()(request('/api/chat',{message:instruction},cookie,id));assert.equal(response.status,200);const first=await response.json()as {sessionId:string;needsConfirmation:boolean;pending:{id:string};batch:{status:string;items:{stage:string}[]}};
  assert.equal(first.needsConfirmation,true);assert.equal(first.batch.status,'review');assert.equal(first.batch.items.filter(i=>i.stage==='closed').length,5);
  const visitor=visitorFromCookie(cookie,config.cookieSecret,Date.now());assert.ok(visitor);const state=await s.store.load(visitor);assert.ok(state);const temp=await createWorkspace(assets,state.files);try{assert.equal((await readMaster({directory:temp,sessionId:'test'})).length,10);assert.equal(Object.keys(await readProcessed({directory:temp,sessionId:'test'})).length,5);}finally{await removeWorkspace(temp);}
  const restored=await s.handler()(request('/api/state',undefined,cookie));assert.equal(restored.status,200);assert.equal(((await restored.json())as {session:{pending:{id:string}}}).session.pending.id,first.pending.id);
  const forged=await s.handler()(request('/api/chat',{sessionId:first.sessionId,message:'Confirmo',confirmation:{pendingId:randomUUID(),approved:true,corrections:{}}},cookie,randomUUID()));assert.equal(forged.status,200);assert.equal(((await forged.json())as {needsConfirmation:boolean}).needsConfirmation,true);
  const current=await s.handler()(request('/api/state',undefined,cookie));const pending=((await current.json())as {session:{pending:{id:string}}}).session.pending;
  const second=await s.handler()(request('/api/chat',{sessionId:first.sessionId,message:'Confirmo datos ficticios explícitos solo de prueba',confirmation:{pendingId:pending.id,approved:true,corrections:{valor:0,moneda:'COP',fecha_inicio:'2026-08-31',fecha_fin:'2027-08-31',requiere_poliza:true,tipo_poliza:'cumplimiento'}}},cookie,randomUUID()));assert.equal(second.status,200);const final=await second.json()as {needsConfirmation:boolean;batch:{status:string;reportGenerated:boolean}};assert.equal(final.needsConfirmation,false);assert.equal(final.batch.status,'complete');assert.equal(final.batch.reportGenerated,true);
  const after=await s.store.load(visitor);assert.ok(after);const output=await createWorkspace(assets,after.files);try{assert.equal((await readMaster({directory:output,sessionId:'test'})).length,11);assert.equal(Object.keys(await readProcessed({directory:output,sessionId:'test'})).length,6);}finally{await removeWorkspace(output);}
  const other=await login(s.handler());const otherState=await s.handler()(request('/api/state',undefined,other));assert.deepEqual(await otherState.json(),{session:null});const foreign=await s.handler()(request('/api/sessions/'+first.sessionId,undefined,other));assert.equal(foreign.status,404);
});
test('Cloud: commit ambiguo se recupera con mismo requestId sin volver a llamar al modelo',async()=>{
  const adapter:LlmAdapter={provider:'fake_solo_pruebas',model:'fake',configured:true,enviar:async()=>({content:'Explicación sin herramientas',toolCalls:[],usage:{inputTokens:1,outputTokens:1}})};let calls=0;const original=adapter.enviar;adapter.enviar=async(...args)=>{calls++;return original(...args);};const s=setup(adapter),cookie=await login(s.handler()),id=randomUUID(),body={message:'¿Qué es un contrato?'};s.redis.ambiguous=true;
  assert.equal((await s.handler()(request('/api/chat',body,cookie,id))).status,503);assert.equal(calls,1);
  const retry=await s.handler()(request('/api/chat',body,cookie,id));assert.equal(retry.status,200);assert.equal(calls,1);
  assert.equal((await s.handler()(request('/api/chat',{message:'Otro contenido'},cookie,id))).status,409);
});
test('Cloud: lease, CAS y dueño expirado impiden sobreescrituras concurrentes',async()=>{
  const s=setup(),id=randomUUID();await s.store.initialize(id);assert.equal(await s.store.acquire(id,'old'),true);assert.equal(await s.store.acquire(id,'other'),false);s.redis.time+=LEASE_MS+1;assert.equal(await s.store.acquire(id,'new'),true);await assert.rejects(s.store.commit(id,'old',0,{...emptyState(),version:1}));await s.store.commit(id,'new',0,{...emptyState(),version:1});assert.equal((await s.store.load(id))?.version,1);await s.store.acquire(id,'third');await assert.rejects(s.store.commit(id,'third',0,{...emptyState(),version:1}));
});
test('Cloud: entrada pública falla cerrada sin cookie/origen/config; no acepta estado del cliente',async()=>{
  const s=setup();assert.equal(handlerFromEnvironment({},assets),null);assert.equal((await s.handler()(request('/api/chat',{message:'hola'},undefined,randomUUID()))).status,401);const cookie=await login(s.handler());assert.equal((await s.handler()(new Request(config.origin+'/api/chat',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'}))).status,403);assert.equal((await s.handler()(request('/api/chat',{message:'hola',engine:{}},cookie,randomUUID()))).status,400);
  const identity=newIdentity(config.cookieSecret,0);assert.equal(visitorFromCookie(identity.cookie,config.cookieSecret,7200001),null);assert.equal(visitorFromCookie(identity.cookie.replace('periferia-demo=','periferia-demo=x'),config.cookieSecret,1),null);
});
test('Cloud: cuota bloquea modelo y conserva estado pendiente en lugar de afirmar ejecución',async()=>{
  const s=setup(new BatchFake(),{...config,modelTokens:1}),cookie=await login(s.handler());const response=await s.handler()(request('/api/chat',{message:instruction},cookie,randomUUID()));assert.equal(response.status,200);const result=await response.json()as {reply:string;toolCalls:unknown[];batch:{status:string}};assert.equal((s.adapter as BatchFake).calls,0);assert.equal(result.toolCalls.length,0);assert.equal(result.batch.status,'pending');assert.match(result.reply,/Cuota/);
});
test('Cloud: rutas de snapshot y credenciales de transporte rechazadas o saneadas',async()=>{
  await assert.rejects(createWorkspace(assets,{'out/../PRD.md':'eA=='}));await assert.rejects(createWorkspace(assets,{'out/x':'not-base64'}));assert.throws(()=>new UpstashRest({url:'https://evil.example',token:'fake'}));
  const rest=new UpstashRest({url:'https://demo.upstash.io',token:'fake-not-real',fetcher:async()=>new Response('secret-provider-detail',{status:401})});await assert.rejects(rest.command(['GET','x']),error=>error instanceof Error&&!error.message.includes('secret-provider-detail'));
  const directory=await createWorkspace(assets,{});try{assert.deepEqual(await snapshotFiles(directory),{});}finally{await removeWorkspace(directory);}
});
test('Gemini: native calls, schemas, firmas opacas y functionResponse conservados con transporte falso',async()=>{
  const payloads:Record<string,unknown>[]=[];const adapter=new GeminiAdapter({apiKey:'fake-not-real',model:config.model,fetcher:async(url,init)=>{assert.ok(!String(url).includes('fake-not-real'));payloads.push(JSON.parse(String(init?.body))as Record<string,unknown>);return Response.json({candidates:[{content:{role:'model',parts:[{functionCall:{name:'leer',args:{id:'x'},id:'native-1'},thoughtSignature:'opaque-signature'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,thoughtsTokenCount:3,totalTokenCount:15}});}});
  const tool={name:'leer',description:'Lee',parameters:z.object({id:z.string().describe('ID')})},options={signal:AbortSignal.timeout(1000),maxOutputTokens:100};const first=await adapter.enviar([{role:'system',content:'Reglas'},{role:'user',content:'Lista'}],[tool],options);assert.equal(first.toolCalls[0]?.id,'native-1');assert.equal(first.usage?.outputTokens,5);
  await adapter.enviar([{role:'user',content:'Lista'},{role:'assistant',content:'',toolCalls:first.toolCalls,providerContent:first.providerContent},{role:'tool',toolCallId:'native-1',content:'{"ok":true}'}],[tool],options);assert.match(JSON.stringify(payloads[1]),/opaque-signature/);assert.match(JSON.stringify(payloads[1]),/functionResponse/);assert.deepEqual(geminiSchema(z.enum(['COP','USD'])),{type:'STRING',enum:['COP','USD']});assert.throws(()=>new GeminiAdapter({apiKey:'fake',model:'gemini-3.1-pro-preview'}));
});
test('Gemini: cuota/seguridad/respuesta inválida no fallback ni secretos en errores',async()=>{
  let calls=0;const adapter=new GeminiAdapter({apiKey:'fake',model:config.model,fetcher:async()=>{calls++;return new Response('secret',{status:429});}});await assert.rejects(adapter.enviar([{role:'user',content:'Hola'}],[],{signal:AbortSignal.timeout(1000),maxOutputTokens:10}),error=>error instanceof GeminiError&&error.status===429&&!error.message.includes('secret'));assert.equal(calls,1);
  const blocked=new GeminiAdapter({apiKey:'fake',model:config.model,fetcher:async()=>Response.json({promptFeedback:{blockReason:'SAFETY'}})});await assert.rejects(blocked.enviar([],[],{signal:AbortSignal.timeout(1000),maxOutputTokens:10}));
});test('Cloud: recibo desalojado no se vuelve a ejecutar y snapshot corrupto falla cerrado',async()=>{
  const s=setup(),cookie=await login(s.handler()),visitor=visitorFromCookie(cookie,config.cookieSecret,Date.now());assert.ok(visitor);const id=randomUUID();await s.store.acquire(visitor,'test');await s.store.commit(visitor,'test',0,{...emptyState(),version:1,seenRequests:[id]});assert.equal((await s.handler()(request('/api/chat',{message:'hola'},cookie,id))).status,409);
  s.redis.values.set('tests:visitor:'+visitor,'{"version":1,"engine":"corrupto"}');assert.equal((await s.handler()(request('/api/state',undefined,cookie))).status,503);
});
test('Cloud: error previo al commit no publica un registro ni progreso temporal',async()=>{
  const s=setup(),cookie=await login(s.handler()),visitor=visitorFromCookie(cookie,config.cookieSecret,Date.now());assert.ok(visitor);const original=s.store.commit.bind(s.store);s.store.commit=async()=>{throw new Error('Redis no disponible');};assert.equal((await s.handler()(request('/api/chat',{message:instruction},cookie,randomUUID()))).status,503);const state=await s.store.load(visitor);assert.equal(state?.version,0);assert.deepEqual(state?.files,{});assert.deepEqual(state?.engine.sessions,[]);s.store.commit=original;
});
