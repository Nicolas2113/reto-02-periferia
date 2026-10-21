import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { STATE_TTL } from './store.js';
export const cookieName='__Host-periferia-demo';
export function safeEqual(left:string,right:string):boolean{return timingSafeEqual(createHash('sha256').update(left).digest(),createHash('sha256').update(right).digest());}
const identity=z.object({id:z.string().uuid(),issued:z.number().int(),expires:z.number().int()}).strict();
export function signVisitor(id:string,secret:string,now:number):string{
  const payload=Buffer.from(JSON.stringify({id,issued:Math.floor(now/1000),expires:Math.floor(now/1000)+STATE_TTL})).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
}
export function visitorFromCookie(header:string|null,secret:string,now:number):string|null{
  try{const cookies=(header??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));if(cookies.length!==1)return null;const token=cookies[0]?.slice(cookieName.length+1)??'';if(token.length>600)return null;const [payload,signature,...extra]=token.split('.');if(!payload||!signature||extra.length||!safeEqual(signature,createHmac('sha256',secret).update(payload).digest('base64url')))return null;const value=identity.parse(JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as unknown);const seconds=Math.floor(now/1000);return value.expires>seconds&&value.issued<=seconds&&value.expires-value.issued===STATE_TTL?value.id:null;}catch{return null;}
}
export function newIdentity(secret:string,now:number){const id=randomUUID();return {id,cookie:cookieName+'='+signVisitor(id,secret,now)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+STATE_TTL};}