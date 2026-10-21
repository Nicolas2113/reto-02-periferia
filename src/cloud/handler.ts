import { DiagnosticError, reportDiagnostic, type DiagnosticStage } from '../diagnostico.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AgentEngine, chatSchema } from '../server.js';
import type { LlmAdapter } from '../llm/adapter.js';
import { GeminiAdapter, freeModels } from '../llm/gemini.js';
import { DemoStore, UpstashRest, StoreError } from './store.js';
import { createWorkspace, removeWorkspace, snapshotFiles } from './workspace.js';
import { newIdentity, safeEqual, visitorFromCookie } from './security.js';
export interface CloudConfig {origin:string;accessCode:string;cookieSecret:string;model:string;modelCalls:number;modelTokens:number;modelRpm:number}
interface Options {config:CloudConfig;store:DemoStore;assets:string;adapter:()=>LlmAdapter;now?:()=>number}
class HttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
const exportsMap:Record<string,string>={'alertas.md':'out/alertas.md','maestro-contratos.csv':'out/sharepoint/maestro-contratos.csv','historial.jsonl':'out/sharepoint/historial.jsonl','log.jsonl':'out/log.jsonl'};
const json=(status:number,value:unknown,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
async function input(request:Request):Promise<unknown>{
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'Use JSON');
  const text=await request.text();if(Buffer.byteLength(text)>16000)throw new HttpError(413,'Solicitud demasiado grande');try{return JSON.parse(text) as unknown;}catch{throw new HttpError(400,'JSON inválido');}
}
export function createCloudHandler(options:Options):(request:Request)=>Promise<Response>{
  const {config,store}=options,now=options.now??Date.now;
  if((new URL(config.origin).protocol!=='https:'||new URL(config.origin).origin!==config.origin)||config.accessCode.length<32||config.cookieSecret.length<32||!freeModels.includes(config.model as typeof freeModels[number]))throw new Error('Configuración cloud inválida');
  async function engine(directory:string,raw:unknown,deadline:number){
    const prompt=await readFile(path.join(options.assets,'agent','prompt.md'),'utf8'),knowledge=await readFile(path.join(options.assets,'src','knowledge','registro-contratos.md'),'utf8'),real=options.adapter();
    const adapter:LlmAdapter={provider:real.provider,model:real.model,configured:real.configured,async enviar(messages,tools,modelOptions){
      const remaining=deadline-now();if(remaining<=0)throw new Error('timeout');
      // Reserva conservadora de cupo, no facturación exacta. Nunca se devuelve tras error/crash.
      const charge=Buffer.byteLength(JSON.stringify(messages))+modelOptions.maxOutputTokens+16384;
      let reserved:boolean;try{reserved=await store.reserveModel(charge,{calls:config.modelCalls,tokens:config.modelTokens,rpm:config.modelRpm});}catch(error){throw new DiagnosticError('REDIS_RESERVATION_FAILED','redis_reservation',error instanceof DiagnosticError?error.httpStatus:undefined);}
      if(!reserved)throw new Error('quota');
      return real.enviar(messages,tools,{...modelOptions,signal:AbortSignal.any([modelOptions.signal,AbortSignal.timeout(Math.max(1,remaining))])});
    }};
    const value=new AgentEngine({directory,adapter,prompt:prompt+'\n\n'+knowledge,limits:{iterations:25,sessionTokens:120000,outputTokens:2048,timeoutMs:15000,sessions:5}});value.restoreState(raw);return value;
  }
  return async request=>{
    const started=now();let failureStage:DiagnosticStage='persistence';let visitor:string|null=null,owner:string|undefined,directory:string|undefined;
    try{
      const url=new URL(request.url);if(url.origin!==config.origin)throw new HttpError(403,'Origen no autorizado');
      visitor=visitorFromCookie(request.headers.get('cookie'),config.cookieSecret,now());
      if(request.method==='GET'&&url.pathname==='/api/health')return json(200,{ok:true,configured:true,cloud:true,requiresAccess:!visitor,provider:'gemini',model:config.model});
      if(request.method==='POST'){
        if(request.headers.get('origin')!==config.origin)throw new HttpError(403,'Origen no autorizado');
        const length=Number(request.headers.get('content-length')??0);if(!Number.isFinite(length)||length>16000)throw new HttpError(413,'Solicitud demasiado grande');
      }
      const minute=Math.floor(now()/60000),day=new Date(now()).toISOString().slice(0,10);
      if(request.method==='POST'&&url.pathname==='/api/access'){
        if(!await store.rate('access-minute:'+minute,10,120)||!await store.rate('access-day:'+day,100,172800))throw new HttpError(429,'Acceso temporalmente limitado');
        const value=z.object({code:z.string().max(200)}).strict().parse(await input(request));if(!safeEqual(value.code,config.accessCode))throw new HttpError(401,'Código de acceso incorrecto');
        if(visitor&&await store.load(visitor))return json(200,{ok:true});
        const identity=newIdentity(config.cookieSecret,now());if(!await store.initialize(identity.id))throw new StoreError();return json(200,{ok:true},{'Set-Cookie':identity.cookie});
      }
      if(!visitor)throw new HttpError(401,'Ingrese el código de acceso de la demo');
      if(request.method==='GET'){
        if(!await store.rate('reads:'+visitor+':'+minute,30,120))throw new HttpError(429,'Demasiadas consultas');
        const state=await store.load(visitor);if(!state)throw new HttpError(410,'La demo expiró; ingrese de nuevo');
        if(url.pathname==='/api/state'||/^\/api\/sessions\/[a-f0-9-]+$/.test(url.pathname)){
          const id=url.pathname==='/api/state'?state.activeSessionId:url.pathname.split('/').at(-1);if(!id)return json(200,{session:null});
          const value=await engine(options.assets,state.engine,started+100000),session=value.session(id);if(!session)throw new HttpError(404,'Sesión no encontrada');return json(200,url.pathname==='/api/state'?{session}:session);
        }
        const name=url.pathname.startsWith('/api/exports/')?url.pathname.slice('/api/exports/'.length):'';const file=Object.hasOwn(exportsMap,name)?exportsMap[name]:undefined;
        if(file){const data=state.files[file];if(data===undefined)throw new HttpError(404,'El artefacto todavía no existe');return new Response(Buffer.from(data,'base64'),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
        throw new HttpError(404,'Ruta no encontrada');
      }
      if(request.method!=='POST'||url.pathname!=='/api/chat')throw new HttpError(405,'Método no disponible');
      const requestId=z.string().uuid().parse(request.headers.get('x-request-id')),body=chatSchema.parse(await input(request));
      const fingerprint=createHash('sha256').update(JSON.stringify(body)).digest('hex');owner=randomUUID();
      if(!await store.acquire(visitor,owner))throw new HttpError(409,'Turno en curso; reintente el mismo requestId');
      const state=await store.load(visitor);if(!state)throw new HttpError(410,'La demo expiró; ingrese de nuevo');
      const receipt=state.receipts.find(value=>value.id===requestId);if(receipt){if(receipt.hash!==fingerprint)throw new HttpError(409,'requestId ya usado con otro contenido');return json(200,receipt.result);}
      if(state.seenRequests.includes(requestId))throw new HttpError(409,'Turno ya guardado; consulte el estado antes de continuar');
      if(state.seenRequests.length>=100)throw new HttpError(429,'Límite de turnos por visitante alcanzado');
      if(!await store.rate('chat-day:'+day,50,172800))throw new HttpError(429,'Cupo diario de la demo agotado');
      failureStage='workspace';directory=await createWorkspace(options.assets,state.files);const value=await engine(directory,state.engine,started+100000);const result=await value.chat(body);
      // Un registro fallido no publica un snapshot parcial, aunque otros temporales hayan cambiado.
      if(result.toolCalls.some(call=>call.name==='contratos_registrar'&&typeof call.result==='object'&&call.result!==null&&'ok'in call.result&&call.result.ok===false))throw new StoreError();
      const next={version:state.version+1,engine:value.exportState(),activeSessionId:result.sessionId,files:await snapshotFiles(directory),seenRequests:[...state.seenRequests,requestId],receipts:[...state.receipts,{id:requestId,hash:fingerprint,result}].slice(-4)};
      failureStage='persistence';await store.commit(visitor,owner,state.version,next);return json(200,result);
    }catch(error){
      if(error instanceof HttpError)return json(error.status,{error:error.message});
      if(error instanceof z.ZodError)return json(400,{error:'Solicitud o estado inválido'});
      const diagnosticCode=reportDiagnostic(error,{stage:failureStage,provider:'gemini',model:config.model,started});
      return json(503,{diagnosticCode,error:'Operación no confirmada. Conserve el requestId y reintente; no se presume que haya fallado el commit. [Diagnóstico: '+diagnosticCode+']'});
    }finally{
      if(visitor&&owner){try{await store.release(visitor,owner);}catch{/* El lease expira; no se repite un commit de resultado incierto. */}}
      if(directory){try{await removeWorkspace(directory);}catch{/* Temporal aislado; no es estado durable. */}}
    }
  };
}
export function handlerFromEnvironment(env:NodeJS.ProcessEnv,assets:string):((request:Request)=>Promise<Response>)|null{
  try{
    const required=['APP_ORIGIN','DEMO_ACCESS_CODE','DEMO_COOKIE_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','GEMINI_API_KEY','GEMINI_MODEL','DEMO_NAMESPACE'];
    if(required.some(name=>!env[name]||/REEMPLAZAR|CHANGE_ME/.test(env[name]??'')))return null;
    const numeric=(name:string,fallback:number,max:number)=>{const value=Number(env[name]??fallback);if(!Number.isInteger(value)||value<1||value>max)throw new Error('Límite cloud inválido');return value;};
    const config:CloudConfig={origin:env.APP_ORIGIN??'',accessCode:env.DEMO_ACCESS_CODE??'',cookieSecret:env.DEMO_COOKIE_SECRET??'',model:env.GEMINI_MODEL??'',modelCalls:numeric('DEMO_MODEL_CALLS_DAY',60,100),modelTokens:numeric('DEMO_MODEL_TOKENS_DAY',2000000,3000000),modelRpm:numeric('DEMO_MODEL_RPM',1,60)};
    return createCloudHandler({config,assets,store:new DemoStore(new UpstashRest({url:env.UPSTASH_REDIS_REST_URL??'',token:env.UPSTASH_REDIS_REST_TOKEN??''}),env.DEMO_NAMESPACE??''),adapter:()=>new GeminiAdapter({apiKey:env.GEMINI_API_KEY??'',model:config.model})});
  }catch{return null;}
}