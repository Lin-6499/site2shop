import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {borrowSourceBrowser,existingChromeEndpoint,openSourceBrowser,sourceStorage,sourceStorageCurrent,observeBrowserContext,type SourceSessionProject} from '../src/shopyy/source-session.js';

test('existing Chrome leases retain user context/pages, use local endpoint and never export storage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-cdp-'));
 try{
  await writeFile(join(root,'DevToolsActivePort'),'9222\n/devtools/browser/fixture-123\n');
  const project:SourceSessionProject={sourceUrl:'https://source.invalid/',workflow:{preserveClassicScrollbars:true,sourceSession:{enabled:true,sessionStorageKey:'sb-fixture-auth-token',connection:{mode:'existing-chrome',userDataDir:root,timeoutMs:1234}}}};
  const events:any[]=[];let contextClosed=0,userPageClosed=0,disconnected=0;
  const userPage={close:async()=>{userPageClosed++;}};
  const context:any={pages:()=>[userPage],close:async()=>{contextClosed++;},storageState:()=>{throw Error('storage must not be read');},newPage:async()=>{const page={bringToFront:async()=>events.push(['front']),setViewportSize:async(v:any)=>events.push(['viewport',v]),close:async()=>{events.push(['page-close']);},evaluate:async()=>({locale:'zh-CN',languages:['zh-CN','zh'],timezoneId:'Asia/Shanghai'})};events.push(['new-page']);return page;}};
  const browser:any={contexts:()=>[context],close:async()=>{disconnected++;},newContext:()=>{throw Error('must use existing context');}};
  const engine:any={launch:()=>{throw Error('must not launch Chrome');},connectOverCDP:async(...args:any[])=>{events.push(['connect',...args]);return browser;}};
  assert.equal(await sourceStorage(project),undefined);
  assert.equal(sourceStorageCurrent(project,undefined),true);
  const session=await openSourceBrowser(project,undefined,engine);
  assert.deepEqual(events[0],['connect','ws://127.0.0.1:9222/devtools/browser/fixture-123',{noDefaults:true,timeout:1234}]);
  const lease=await session.createContext({viewport:{width:390,height:844},locale:'en-US',timezoneId:'UTC'});
  const page=await lease.newPage();
  assert.deepEqual(await observeBrowserContext(page),{locale:'zh-CN',languages:['zh-CN','zh'],timezoneId:'Asia/Shanghai'});
  assert.deepEqual(events[2],['viewport',{width:390,height:844}]);assert.deepEqual(events[3],['front']);
  await lease.close();await lease.close();
  const second=await session.createContext({viewport:{width:768,height:1024}});await second.newPage();
  await session.close();await session.close();
  assert.equal(events.filter(e=>e[0]==='page-close').length,2);
  assert.equal(contextClosed,0);assert.equal(userPageClosed,0);assert.equal(disconnected,1);
  await assert.rejects(lease.newPage(),/lease is closed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('existing Chrome validates DevTools endpoint and disconnects when no default context exists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-cdp-endpoint-'));
 try{
  const project:SourceSessionProject={sourceUrl:'https://source.invalid',workflow:{sourceSession:{connection:{mode:'existing-chrome',userDataDir:root}}}};
  await assert.rejects(existingChromeEndpoint(project),/Enable remote debugging/);
  await writeFile(join(root,'DevToolsActivePort'),'99999\n/devtools/browser/id');
  await assert.rejects(existingChromeEndpoint(project),/valid local DevTools endpoint/);
  await writeFile(join(root,'DevToolsActivePort'),'9222\n/devtools/browser/id');
  let closed=0;
  await assert.rejects(openSourceBrowser(project,undefined,{connectOverCDP:async()=>({contexts:()=>[],close:async()=>{closed++;}})} as any),/existing context/);
  assert.equal(closed,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('isolated source leases preserve owned context and supplied browser lifetimes',async()=>{
 let contextClosed=0,browserClosed=0;const options:any[]=[];
 const context:any={newPage:async()=>({}),close:async()=>{contextClosed++;}};
 const browser:any={newContext:async(o:any)=>{options.push(o);return context;},close:async()=>{browserClosed++;}};
 const session=await openSourceBrowser({sourceUrl:'https://source.invalid'},browser);
 const lease=await session.createContext({locale:'en-US',timezoneId:'UTC'});await lease.newPage();await lease.close();await session.close();
 assert.equal(contextClosed,1);assert.equal(browserClosed,0);assert.deepEqual(options,[{locale:'en-US',timezoneId:'UTC'}]);
});


test('registered source browser is reused across calls without connecting or closing its transport',async()=>{
 const project:SourceSessionProject={sourceUrl:'https://source.invalid/',workflow:{sourceSession:{connection:{mode:'existing-chrome',userDataDir:'C:/fixture-profile'}}}};
 let connects=0,closed=0,pageClosed=0,fronts=0,connected=true;
 const context:any={newPage:async()=>({bringToFront:async()=>{fronts++;},close:async()=>{pageClosed++;}}),close:()=>{throw Error('User context must stay open');}};
 const browser:any={isConnected:()=>connected,contexts:()=>[context],close:async()=>{closed++;}};
 const engine:any={connectOverCDP:()=>{connects++;throw Error('Must not connect');},launch:()=>{throw Error('Must not launch');}};
 const release=borrowSourceBrowser(project,browser);
 try{
  for(let i=0;i<2;i++){const session=await openSourceBrowser(project,undefined,engine);const lease=await session.createContext({});await lease.newPage();await session.close();}
  assert.equal(connects,0);assert.equal(closed,0);assert.equal(pageClosed,2);assert.equal(fronts,2);
  const different={...project,sourceUrl:'https://other.invalid/'};
  await assert.rejects(openSourceBrowser(different,undefined,engine),/Enable remote debugging/);
  connected=false;
  await assert.rejects(openSourceBrowser(project,undefined,engine),/Enable remote debugging/);
 }finally{release();release();}
 assert.equal(closed,0);
});
