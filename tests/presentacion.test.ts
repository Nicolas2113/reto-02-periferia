import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

// DOM simulado: no sustituye una comprobacion visual en navegador.
class DomNode {
  readonly children: DomNode[]=[];
  readonly attributes: Record<string,string>={};
  className=''; hidden=false; value: string|number=''; tabIndex=0;
  private text='';
  constructor(readonly tagName:string) {}
  get childNodes(){return this.children;}
  get textContent():string{return this.text+this.children.map(child=>child.textContent).join('');}
  set textContent(value:string){this.text=String(value);this.children.length=0;}
  set innerHTML(_value:string){throw new Error('HTML no confiable nunca debe insertarse');}
  append(...nodes:(DomNode|string)[]){for(const node of nodes){if(typeof node==='string'){const child=new DomNode('#text');child.textContent=node;this.children.push(child);}else this.children.push(node);}}
  replaceChildren(){this.text='';this.children.length=0;}
  setAttribute(name:string,value:string){this.attributes[name]=value;}
  addEventListener(_name:string,_listener:unknown){}
  scrollIntoView(_options:unknown){}
  focus(){}
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
async function runtime(){
  const html=await readFile(path.join(root,'web','index.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(script);
  const nodes=new Map<string,DomNode>();
  const document={createElement:(tag:string)=>new DomNode(tag),createTextNode:(text:string)=>{const node=new DomNode('#text');node.textContent=text;return node;},getElementById:(id:string)=>{let node=nodes.get(id);if(!node){node=new DomNode('div');nodes.set(id,node);}return node;}};
  const target=new DomNode('div');
  const sandbox={document,target,input:'',role:'Asistente',calls:[] as unknown[],fetch:async()=>({json:async()=>({configured:true,provider:'fake_DOM',model:'sin_LLM'})})};
  const context=createContext(sandbox);runInContext(script,context);
  return {target,nodes,sandbox,render:(text:string)=>{sandbox.input=text;runInContext('renderMarkdown(target,input)',context);return target;},message:(role:string,text:string,calls:unknown[]=[])=>{sandbox.role=role;sandbox.input=text;sandbox.calls=calls;runInContext('message(role,input,calls)',context);return document.getElementById('messages');}};
}
function all(node:DomNode):DomNode[]{return [node,...node.children.flatMap(all)];}
const find=(node:DomNode,tag:string)=>all(node).filter(value=>value.tagName===tag);
const sample=`# Alertas de contratos

Fecha de referencia: **2026-09-03**. Horizonte inclusivo: 2026-09-03 a 2026-11-02.

## Vencen entre 0 y 60 días (inclusive)
- CT-2026-004 - Logística del Istmo S.A.; fin 2026-10-15; a 42 días; póliza pendiente
- CT-2026-009 - Agroexport Sula; fin 2026-09-30; a 27 días; póliza vigente

## Pólizas pendientes o no vigentes
- CM-2026-03 - DISTRIBUIDORA CARIBE; fin 2027-08-31; póliza pendiente

## Registrados desde el corte 2026-05-30
- CT-2026-015 - INDUSTRIAS DELTA; fin 2027-07-31; póliza pendiente

Advertencia: no registre datos dudosos sin confirmación humana.

Estado del lote: complete.

| Mensaje | Etapa | Acción |
|---|---|---|
| msg-001 | closed | nuevo |
| msg-002 | closed | nuevo |
| msg-003 | closed | actualizacion |
| msg-004 | closed | duplicado |
| msg-005 | closed | rechazado |
| msg-006 | closed | nuevo |`;

test('Presentacion: reporte con jerarquia, listas y tabla preserva datos y advertencias',async()=>{
  const ui=await runtime(),view=ui.render(sample);
  assert.equal(find(view,'h2')[0]?.textContent,'Alertas de contratos');assert.equal(find(view,'h3').length,3);
  assert.equal(find(view,'ul').length,3);assert.equal(find(view,'li').length,4);
  assert.equal(find(view,'table').length,1);assert.equal(find(view,'tbody')[0]?.children.length,6);assert.equal(find(view,'th').length,3);
  for(const phrase of ['2026-09-03','2026-11-02','2026-10-15; a 42 días','2026-09-30; a 27 días','2027-08-31','2026-05-30','no registre datos dudosos sin confirmación humana','Estado del lote: complete.','msg-006'])assert.ok(view.textContent.includes(phrase),phrase);
  assert.equal(find(view,'strong')[0]?.textContent,'2026-09-03');
  const badges=all(view).filter(node=>node.className.includes('status-pill'));assert.equal(badges.length,6);assert.ok(badges.every(node=>node.textContent==='closed'));
  const region=all(view).find(node=>node.className==='report-table');assert.equal(region?.tabIndex,0);assert.equal(region?.attributes.role,'region');
});

test('Presentacion: pipes escapados y codigo en celdas no rompen datos ni columnas',async()=>{
  const ui=await runtime();const view=ui.render('| Cliente | Código |\n|---|---|\n| Cliente \\| filial | `A|B` |\n| __proto__ | review |');
  const rows=find(view,'tbody')[0]?.children;assert.equal(rows?.length,2);assert.equal(rows?.[0]?.children.length,2);
  assert.equal(rows?.[0]?.children[0]?.textContent,'Cliente | filial');assert.equal(rows?.[0]?.children[1]?.textContent,'A|B');
  assert.equal(rows?.[1]?.children[0]?.textContent,'__proto__');assert.equal(rows?.[1]?.children[1]?.textContent,'review');
});

test('Seguridad: HTML SVG eventos y URLs maliciosas permanecen texto inerte en todos los bloques',async()=>{
  const payload='<img src=x onerror="globalThis.__xss=1"><svg onload="globalThis.__xss=2"></svg><script>globalThis.__xss=3</script><iframe srcdoc="x"></iframe>';
  const ui=await runtime();const view=ui.render(`# ${payload}\n\n${payload}\n\n- ${payload}\n\n| Dato | Valor |\n|---|---|\n| ${payload} | [Abrir](javascript:alert(1)) |\n\n\u0060\u0060\u0060html\n${payload}\n\u0060\u0060\u0060`);
  for(const tag of ['img','svg','script','iframe','a','style','object','embed'])assert.equal(find(view,tag).length,0,tag);
  for(const node of all(view))for(const attribute of Object.keys(node.attributes))assert.ok(!/^(on|src|href|style)/i.test(attribute));
  assert.ok(view.textContent.includes(payload));assert.ok(view.textContent.includes('javascript:alert(1)'));assert.equal(find(view,'code').at(-1)?.textContent,payload);
});

test('Seguridad: usuario y trazas conservan texto literal sin interpretar Markdown ni HTML',async()=>{
  const ui=await runtime(),payload='# Usuario **literal** <img src=x onerror=alert(1)>';
  const log=ui.message('Tú',payload);const user=log.children.at(-1);assert.ok(user);assert.ok(user.className.includes('user'));
  const body=user.children[1];assert.equal(body?.textContent,payload);assert.equal(find(user,'h2').length,0);assert.equal(find(user,'strong').length,0);assert.equal(find(user,'img').length,0);
  const assistant=ui.message('Asistente','## Reporte',[{name:'contratos_alertas',arguments:{hoy:'2026-09-03'},result:{ok:true,data:{texto:payload}}}]).children.at(-1);assert.ok(assistant);
  assert.equal(find(assistant,'details').length,1);assert.ok(find(assistant,'pre')[0]?.textContent.includes(payload));assert.equal(find(assistant,'img').length,0);
});

test('Presentacion: Markdown incompleto conserva texto y bloques de codigo no ejecutan contenido',async()=>{
  const ui=await runtime();const view=ui.render('Párrafo uno\nLínea dos **sin cierre\n\n| A | B |\n|---|---|\n| a | b |\n| fila | con | exceso |\n\n1. Primero\n2. Segundo\n\n\u0060\u0060\u0060js\n<script>alert(1)</script>');
  assert.ok(view.textContent.includes('Línea dos **sin cierre'));assert.ok(view.textContent.includes('| fila | con | exceso |'));
  assert.equal(find(view,'br').length,1);assert.equal(find(view,'ol').length,1);assert.equal(find(view,'ol')[0]?.children[0]?.value,1);
  assert.equal(find(view,'code')[0]?.textContent,'<script>alert(1)</script>');assert.equal(find(view,'script').length,0);
});