import {build} from 'esbuild';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {Browser} from 'playwright';
import {digest,jsonFile} from './artifacts.js';
import {openSourceBrowser,usesExistingChrome} from './source-session.js';

const allowed={
 'src/shopyy/browser.ts':['inspectSourceComponents','inspectSourceResources','collect','collectSourceScope'],
 'src/shopyy/discovery.ts':['discover'],
 'src/shopyy/source-session.ts':['checkSourceSession','inspectSourceStorageKeyPresence'],
 'src/shopyy/source-assets.ts':['collectSourceAssets']
} as const;
export type SourceWorkerOperation={module:keyof typeof allowed;method:string;args?:unknown[]};
const projectCodeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

/** Rewrite expressions only; strings/comments containing import.meta.url remain untouched. */
export function preserveSourceModuleUrl(contents:string,filename:string){
 const source=ts.createSourceFile(filename,contents,ts.ScriptTarget.Latest,true);
 const replacements:{start:number;end:number}[]=[];
 const visit=(node:ts.Node)=>{
  if(ts.isPropertyAccessExpression(node)&&node.name.text==='url'&&ts.isMetaProperty(node.expression)&&node.expression.keywordToken===ts.SyntaxKind.ImportKeyword&&node.expression.name.text==='meta')replacements.push({start:node.getStart(source),end:node.end});
  ts.forEachChild(node,visit);
 };
 visit(source);
 for(const replacement of replacements.sort((a,b)=>b.start-a.start))contents=contents.slice(0,replacement.start)+JSON.stringify(pathToFileURL(filename).href)+contents.slice(replacement.end);
 return contents;
}

async function currentSourceOperation(operation:SourceWorkerOperation){
 const methods:readonly string[]|undefined=allowed[operation.module];
 if(!methods?.includes(operation.method)||operation.args!==undefined&&!Array.isArray(operation.args))throw Error('Unsupported source worker operation');
 const result=await build({
  absWorkingDir:projectCodeRoot,
  stdin:{contents:`export {${operation.method} as runOperation} from ${JSON.stringify('./'+operation.module)};export {borrowSourceBrowser as registerBrowser} from './src/shopyy/source-session.ts';`,resolveDir:projectCodeRoot,sourcefile:'source-worker-entry.ts',loader:'ts'},
  bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',write:false,logLevel:'silent',
  plugins:[{name:'preserve-source-module-url',setup(builder){builder.onLoad({filter:/\.[cm]?[jt]sx?$/},async args=>{
   const path=relative(join(projectCodeRoot,'src'),args.path);if(path.startsWith('..')||resolve(args.path)===projectCodeRoot)return;
   const contents=preserveSourceModuleUrl(await readFile(args.path,'utf8'),args.path);
   return{contents,loader:args.path.endsWith('.tsx')?'tsx':args.path.endsWith('.ts')?'ts':'js'};
  });}}]
 });
 const code=result.outputFiles[0].text,hash=digest(code),cache=join(projectCodeRoot,'node_modules','.cache','source-worker');
 await mkdir(cache,{recursive:true});
 const file=join(cache,hash+'.mjs');
 await writeFile(file,code,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 return await import(pathToFileURL(file).href) as {runOperation:(projectFile:string,...args:unknown[])=>Promise<unknown>;registerBrowser:(project:any,browser:Browser)=>()=>void};
}

/** Refresh local collector code while preserving the worker's one registered Chrome transport. */
export async function runSourceWorkerOperation(projectFile:string,operation:SourceWorkerOperation){
 // Validate and build before borrowing the worker's already registered connection.
 const fresh=await currentSourceOperation(operation),project=await jsonFile(projectFile);
 if(!usesExistingChrome(project))throw Error('Source worker operations require an existing-chrome connection');
 const factory=await openSourceBrowser(project);
 let lease:Awaited<ReturnType<typeof factory.createContext>>|undefined,release:(()=>void)|undefined;
 try{
  lease=await factory.createContext({});
  const browser=lease.context.browser();
  if(!browser?.isConnected())throw Error('Registered source browser is disconnected');
  release=fresh.registerBrowser(project,browser);
  return await fresh.runOperation(projectFile,...operation.args||[]);
 }finally{
  try{release?.();}finally{try{await lease?.close();}finally{await factory.close();}}
 }
}
