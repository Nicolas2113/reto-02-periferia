import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const MAX_FILES=40,MAX_BYTES=256000;
function relativeFile(name:string):string {
  if(!/^out\/[a-zA-Z0-9_./-]+$/.test(name)||name.length>500||name.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Ruta de artefacto inválida');return name;
}
export async function createWorkspace(assets:string,files:Record<string,string>):Promise<string>{
  const directory=await mkdtemp(path.join(tmpdir(),'periferia-web-'));
  try{
    for(const input of ['fixtures','agent','src/knowledge'])await cp(path.join(assets,input),path.join(directory,input),{recursive:true,errorOnExist:true,force:false});
    let size=0;if(Object.keys(files).length>MAX_FILES)throw new Error('Demasiados artefactos');
    for(const [name,encoded]of Object.entries(files)){
      relativeFile(name);const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)throw new Error('Artefacto inválido');size+=bytes.length;if(size>MAX_BYTES)throw new Error('Artefactos demasiado grandes');
      const target=path.join(directory,...name.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
    }return directory;
  }catch(error){await removeWorkspace(directory);throw error;}
}
export async function snapshotFiles(directory:string):Promise<Record<string,string>>{
  const files:Record<string,string>={};let size=0;
  async function walk(relative:string):Promise<void>{
    const target=path.join(directory,relative);let entries;try{entries=await readdir(target,{withFileTypes:true});}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return;throw error;}
    for(const entry of entries){const name=relative+'/'+entry.name;relativeFile(name);const full=path.join(directory,...name.split('/'));if((await lstat(full)).isSymbolicLink())throw new Error('Artefacto enlazado no permitido');if(entry.isDirectory())await walk(name);else{const bytes=await readFile(full);size+=bytes.length;if(size>MAX_BYTES||Object.keys(files).length>=MAX_FILES)throw new Error('Salida de demo supera límite');files[name]=bytes.toString('base64');}}
  }
  await walk('out');return files;
}
export async function removeWorkspace(directory:string):Promise<void>{
  const target=path.resolve(directory),base=path.resolve(tmpdir());if(!target.startsWith(base+path.sep)||!path.basename(target).startsWith('periferia-web-'))throw new Error('Limpieza fuera de temporal autorizado');await rm(target,{recursive:true,force:true});
}