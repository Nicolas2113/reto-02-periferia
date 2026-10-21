import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlerFromEnvironment } from '../src/cloud/handler.js';
// Vercel invokes this handler. No listener, in-memory session store or secret at build time.
export default async function api(req:IncomingMessage & {body?:unknown},res:ServerResponse):Promise<void>{
  const handler=handlerFromEnvironment(process.env,process.cwd());
  const fail=(status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error,configured:false,cloud:true,requiresAccess:true}));};
  if(!handler){fail(503,'Configuración web incompleta; no se llamó a proveedores');return;}
  try{
    const origin=process.env.APP_ORIGIN??'';if(req.headers.host!==new URL(origin).host){fail(403,'Host no autorizado');return;}
    let body:string|undefined;
    if(req.method!=='GET'&&req.method!=='HEAD'){
      if(req.body!==undefined){body=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString('utf8'):JSON.stringify(req.body);}
      else{const chunks:Buffer[]=[];let size=0;for await(const part of req){const chunk=Buffer.isBuffer(part)?part:Buffer.from(String(part));size+=chunk.length;if(size>16000){fail(413,'Solicitud demasiado grande');return;}chunks.push(chunk);}body=Buffer.concat(chunks).toString('utf8');}
      if(Buffer.byteLength(body??'')>16000){fail(413,'Solicitud demasiado grande');return;}
    }
    const headers=new Headers();for(const [name,value]of Object.entries(req.headers)){if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);}
    const response=await handler(new Request(new URL(req.url??'/',origin),{method:req.method??'GET',headers,...(body!==undefined?{body}:{})}));
    res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{fail(503,'Solicitud no confirmada; consulte estado o reintente con el mismo identificador');}
}