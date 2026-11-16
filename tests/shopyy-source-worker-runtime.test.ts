import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {borrowSourceBrowser} from '../src/shopyy/source-session.js';
import {runSourceWorkerOperation,preserveSourceModuleUrl} from '../src/shopyy/source-worker-runtime.js';
import {writeJson} from '../src/shopyy/artifacts.js';

test('bundle URL rewrite preserves actual module location without touching strings or comments',()=>{
 const file=join(process.cwd(),'src/shopyy/artifacts.ts');
 const text='// import.meta.url must remain a comment\nconst literal="import.meta.url";const base=new URL("./",import.meta.url);';
 const rewritten=preserveSourceModuleUrl(text,file);
 assert.ok(rewritten.includes('// import.meta.url must remain a comment'));
 assert.ok(rewritten.includes('const literal="import.meta.url";'));
 assert.ok(rewritten.includes('new URL("./",'+JSON.stringify(pathToFileURL(file).href)+')'));
});

test('fresh source bundles reuse the registered Browser without connecting, creating pages or closing its context/transport',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-worker-runtime-'));
 const project:any={sourceUrl:'https://source.invalid/',workflow:{sourceSession:{connection:{mode:'existing-chrome',userDataDir:'C:/worker-runtime-fixture'}}}};
 let connects=0,contextClosed=0,browserClosed=0,newPages=0,evaluations=0;
 const originalConnect=chromium.connectOverCDP,originalLaunch=chromium.launch;
 chromium.connectOverCDP=(async()=>{connects++;throw Error('Unexpected new connection');}) as any;
 chromium.launch=(async()=>{throw Error('Unexpected browser launch');}) as any;
 const page:any={url:()=>project.sourceUrl,evaluate:async()=>{evaluations++;return[{resourceUrl:'https://source.invalid/api/products?ids=public-fixture',startTime:100,duration:12}];}};
 const context:any={browser:()=>browser,pages:()=>[page],newPage:()=>{newPages++;throw Error('Unexpected new page');},close:async()=>{contextClosed++;}};
 const browser:any={isConnected:()=>true,contexts:()=>[context],close:async()=>{browserClosed++;}};
 const release=borrowSourceBrowser(project,browser);
 try{
  const projectFile=join(root,'project.json');await writeJson(projectFile,project);
  const operation:any={module:'src/shopyy/browser.ts',method:'inspectSourceResources',args:[['/api/products']]};
  const result:any=await runSourceWorkerOperation(projectFile,operation);
  assert.equal(result.rows[0].resources[0].duration,12);
  await assert.rejects(runSourceWorkerOperation(projectFile,{...operation,args:[['/api/products?guessed=true']]}),/without query/);
  const repeated:any=await runSourceWorkerOperation(projectFile,operation);assert.equal(repeated.rows.length,1);
  assert.equal(evaluations,2);assert.equal(connects,0);assert.equal(contextClosed,0);assert.equal(browserClosed,0);assert.equal(newPages,0);
  await assert.rejects(runSourceWorkerOperation(projectFile,{module:'src/shopyy/browser.ts',method:'prepareReview'}),/Unsupported source worker operation/);
 }finally{release();chromium.connectOverCDP=originalConnect;chromium.launch=originalLaunch;await rm(root,{recursive:true,force:true});}
});
