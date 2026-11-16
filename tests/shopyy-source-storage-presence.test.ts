import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,type Browser} from 'playwright';
import {borrowSourceBrowser,inspectSourceStorageKeyPresence,checkSourceSession} from '../src/shopyy/source-session.js';
import {runSourceWorkerOperation} from '../src/shopyy/source-worker-runtime.js';

test('source storage presence uses real evaluate, requested key names only, and never owns the browser/page',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'source-presence-')),server=createServer((_,response)=>response.end('<h1>Public fixture</h1>'));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+(server.address() as any).port,browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
 const counts={newContext:0,newPage:0,pageClose:0,browserClose:0,navigate:0};let release:(()=>void)|undefined;
 try{
  await page.goto(origin);
  await page.evaluate(()=>{localStorage.setItem('mall-auth-token','SYNTHETIC-VALUE-NEVER-RETURN');localStorage.setItem('unrequested-fixture-key','SYNTHETIC-OTHER-VALUE');(window as any).storageReads=0;Storage.prototype.getItem=function(){(window as any).storageReads++;throw Error('getItem is forbidden');};Storage.prototype.setItem=Storage.prototype.removeItem=()=>{throw Error('Storage mutation is forbidden');};});
  const project={sourceUrl:origin+'/',workflow:{sourceSession:{connection:{mode:'existing-chrome' as const,userDataDir:directory}}}},projectFile=join(directory,'project.json');await writeFile(projectFile,JSON.stringify(project));
  const facade={isConnected:()=>true,contexts:()=>[context],newContext:()=>{counts.newContext++;throw Error('No new context');},close:()=>{counts.browserClose++;throw Error('No disconnect');}} as unknown as Browser;
  const original={newPage:context.newPage.bind(context),close:page.close.bind(page),goto:page.goto.bind(page),url:page.url.bind(page)};
  context.newPage=async()=>{counts.newPage++;throw Error('No new page');};page.close=async()=>{counts.pageClose++;throw Error('No page close');};page.goto=async()=>{counts.navigate++;throw Error('No navigation');};
  release=borrowSourceBrowser(project,facade);
  const result=await inspectSourceStorageKeyPresence(projectFile,['mall-auth-token','absent-fixture-key']);
  assert.deepEqual(result.requestedKeys,[{key:'mall-auth-token',present:true},{key:'absent-fixture-key',present:false}]);assert.equal(result.origin,origin);assert.equal(result.valuesRead,false);assert.ok(Number.isFinite(Date.parse(result.timestamp)));
  assert.equal(JSON.stringify(result).includes('SYNTHETIC'),false);assert.equal(JSON.stringify(result).includes('unrequested-fixture-key'),false);assert.equal(await page.evaluate(()=>(window as any).storageReads),0);
  await t.test('existing checkSourceSession method hot-loads only the explicit presence option before profile/page operations',async()=>{
   const presence=await runSourceWorkerOperation(projectFile,{module:'src/shopyy/source-session.ts',method:'checkSourceSession',args:[{storageKeyPresence:['mall-auth-token']}]}) as any;
   assert.deepEqual(presence.requestedKeys,[{key:'mall-auth-token',present:true}]);assert.equal(presence.valuesRead,false);assert.equal(await page.evaluate(()=>(window as any).storageReads),0);
   for(const options of [null,{}, {unknown:[]},{storageKeyPresence:['other-key']},{storageKeyPresence:['mall-auth-token'],extra:true}])await assert.rejects(checkSourceSession(join(directory,'not-read.json'),options as any),/Unsupported source session check option/);
   assert.deepEqual(counts,{newContext:0,newPage:0,pageClose:0,browserClose:0,navigate:0});
  });
  release();release=undefined;
  await assert.rejects(inspectSourceStorageKeyPresence(projectFile,['mall-auth-token']),/registered existing source browser/);
  const other={...project,sourceUrl:'https://other.invalid/'},otherFile=join(directory,'other.json');await writeFile(otherFile,JSON.stringify(other));release=borrowSourceBrowser(other,facade);
  await assert.rejects(inspectSourceStorageKeyPresence(otherFile,['mall-auth-token']),/No existing same-origin source page/);
  page.url=()=>other.sourceUrl;await assert.rejects(inspectSourceStorageKeyPresence(otherFile,['mall-auth-token']),/origin mismatch/);page.url=original.url;
  assert.equal(await page.evaluate(()=>(window as any).storageReads),0);assert.deepEqual(counts,{newContext:0,newPage:0,pageClose:0,browserClose:0,navigate:0});assert.equal(page.isClosed(),false);
  page.close=original.close;page.goto=original.goto;context.newPage=original.newPage;
 }finally{release?.();await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
