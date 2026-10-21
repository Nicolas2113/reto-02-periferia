import { DiagnosticError } from '../diagnostico.js';
import { z } from 'zod';
import { engineStateSchema } from '../session-state.js';
export const STATE_TTL=7200,LEASE_MS=150000,MAX_STATE_BYTES=900000;
export const cloudStateSchema=z.object({version:z.number().int().nonnegative(),engine:engineStateSchema,files:z.record(z.string()),activeSessionId:z.string().uuid().optional(),seenRequests:z.array(z.string().uuid()).max(100),receipts:z.array(z.object({id:z.string().uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/),result:z.record(z.unknown())}).strict()).max(4)}).strict();
export type CloudState=z.infer<typeof cloudStateSchema>;
export const emptyState=():CloudState=>({version:0,engine:{version:1,sessions:[]},files:{},seenRequests:[],receipts:[]});
export interface RedisTransport { command(args:(string|number)[]):Promise<unknown> }
export class StoreError extends DiagnosticError {constructor(status?:number){super('PERSISTENCE_FAILED','persistence',status);}}
export class UpstashRest implements RedisTransport {
  private readonly url:string;private readonly fetcher:typeof fetch;
  constructor(private readonly options:{url:string;token:string;fetcher?:typeof fetch}){
    const url=new URL(options.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.upstash.io')||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!options.token)throw new Error('Configuración Upstash inválida');
    this.url=url.toString();this.fetcher=options.fetcher??fetch;
  }
  async command(args:(string|number)[]):Promise<unknown>{
    try{const response=await this.fetcher(this.url,{method:'POST',headers:{Authorization:'Bearer '+this.options.token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw new StoreError(response.status);const value=z.object({result:z.unknown().optional(),error:z.string().optional()}).parse(await response.json() as unknown);if(value.error)throw new StoreError();return value.result;}catch(error){throw error instanceof StoreError?error:new StoreError();}
  }
}
export const commitScript=`-- commit-v1
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return -1 end
local raw=redis.call('GET',KEYS[2]); if not raw then return -2 end
local current=cjson.decode(raw); if current.version ~= tonumber(ARGV[2]) then return -3 end
redis.call('SET',KEYS[2],ARGV[3],'EX',ARGV[4]); redis.call('DEL',KEYS[1]); return 1`;
export const releaseScript=`-- release-v1
if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
export const rateScript=`-- rate-v1
local current=tonumber(redis.call('GET',KEYS[1]) or '0'); if current >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR',KEYS[1]); if current == 0 then redis.call('EXPIRE',KEYS[1],ARGV[2]) end return 1`;
export const budgetScript=`-- budget-v1
local calls=tonumber(redis.call('GET',KEYS[1]) or '0'); local tokens=tonumber(redis.call('GET',KEYS[2]) or '0'); local minute=tonumber(redis.call('GET',KEYS[3]) or '0')
if calls >= tonumber(ARGV[1]) or tokens+tonumber(ARGV[3]) > tonumber(ARGV[2]) or minute >= tonumber(ARGV[4]) then return 0 end
redis.call('INCR',KEYS[1]); redis.call('INCRBY',KEYS[2],ARGV[3]); redis.call('INCR',KEYS[3]); redis.call('EXPIRE',KEYS[1],172800); redis.call('EXPIRE',KEYS[2],172800); redis.call('EXPIRE',KEYS[3],120); return 1`;
export class DemoStore {
  constructor(private readonly redis:RedisTransport,readonly namespace:string,private readonly now:()=>number=Date.now){if(!/^[a-zA-Z0-9_-]{1,60}$/.test(namespace))throw new Error('Namespace inválido');}
  private stateKey(visitor:string){if(!z.string().uuid().safeParse(visitor).success)throw new Error('Visitante inválido');return this.namespace+':visitor:'+visitor;}
  private lockKey(visitor:string){return this.stateKey(visitor)+':lock';}
  async initialize(visitor:string):Promise<boolean>{return await this.redis.command(['SET',this.stateKey(visitor),JSON.stringify(emptyState()),'NX','EX',STATE_TTL])==='OK';}
  async load(visitor:string):Promise<CloudState|null>{const raw=await this.redis.command(['GET',this.stateKey(visitor)]);if(raw===null)return null;if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_STATE_BYTES)throw new StoreError();try{return cloudStateSchema.parse(JSON.parse(raw) as unknown);}catch(error){throw error instanceof StoreError?error:new StoreError();}}
  async acquire(visitor:string,owner:string):Promise<boolean>{return await this.redis.command(['SET',this.lockKey(visitor),owner,'NX','PX',LEASE_MS])==='OK';}
  async release(visitor:string,owner:string):Promise<void>{await this.redis.command(['EVAL',releaseScript,1,this.lockKey(visitor),owner]);}
  async commit(visitor:string,owner:string,expected:number,state:CloudState):Promise<void>{
    const parsed=cloudStateSchema.parse(state),raw=JSON.stringify(parsed);if(parsed.version!==expected+1||Buffer.byteLength(raw)>MAX_STATE_BYTES)throw new Error('Estado demasiado grande o versión inválida; no se confirmó guardado');
    const result=await this.redis.command(['EVAL',commitScript,2,this.lockKey(visitor),this.stateKey(visitor),owner,expected,raw,STATE_TTL]);if(result!==1)throw new StoreError();
  }
  async rate(bucket:string,limit:number,seconds:number):Promise<boolean>{if(!/^[\w:-]+$/.test(bucket)||limit<1)throw new Error('Cupo inválido');return await this.redis.command(['EVAL',rateScript,1,this.namespace+':rate:'+bucket,limit,seconds])===1;}
  async reserveModel(charge:number,limits:{calls:number;tokens:number;rpm:number}):Promise<boolean>{
    const date=new Date(this.now()).toISOString().slice(0,10),minute=Math.floor(this.now()/60000);
    return await this.redis.command(['EVAL',budgetScript,3,this.namespace+':models:'+date,this.namespace+':tokens:'+date,this.namespace+':minute:'+minute,limits.calls,limits.tokens,Math.ceil(charge),limits.rpm])===1;
  }
}