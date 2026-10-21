import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('Paquete web offline: entrada compilada carga con solo dependencias y assets declarados, sin out/.env',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'periferia-bundle-'));
  try{
    for(const relative of ['dist/src','dist/api','fixtures','agent','src/knowledge','web','node_modules/zod'])await cp(path.join(root,relative),path.join(directory,relative),{recursive:true});
    await cp(path.join(root,'package.json'),path.join(directory,'package.json'));
    const entry:unknown=await import(pathToFileURL(path.join(directory,'dist/api/index.js')).href);assert.ok(typeof entry==='object'&&entry!==null&&'default'in entry&&typeof entry.default==='function');
    await assert.rejects(stat(path.join(directory,'out')));await assert.rejects(stat(path.join(directory,'.env')));
    const config=JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8'))as {functions:Record<string,{maxDuration:number;includeFiles:string}>;outputDirectory:string;rewrites:{destination:string}[]};assert.equal(config.functions['api/index.ts']?.maxDuration,120);assert.equal(config.outputDirectory,'web');assert.equal(config.rewrites[0]?.destination,'/api');for(const asset of ['fixtures','agent','src/knowledge'])assert.ok(config.functions['api/index.ts']?.includeFiles.includes(asset));
  }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('periferia-bundle-'));await rm(directory,{recursive:true,force:true});}
});