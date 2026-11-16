import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'node:http';import {chromium} from 'playwright';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {beginSourceRenderedAction,waitSourceRenderedReadiness} from '../src/shopyy/source-rendered-readiness.js';
import {borrowSourceBrowser} from '../src/shopyy/source-session.js';import {inspectSourceResources} from '../src/shopyy/browser.js';import {writeJson,readRef} from '../src/shopyy/artifacts.js';

test('SPA URL changes before DOM; rendered readiness waits for exact heading/query, completed public request and 1500ms stable identity without canonical',async()=>{
 const server=createServer((req,res)=>{if(req.url?.startsWith('/api/')){setTimeout(()=>res.writeHead(200,{'Content-Type':'application/json'}).end('{}'),450);return;}res.writeHead(200,{'Content-Type':'text/html'}).end(`<title>Old FAQ</title><main><h1>FAQ</h1><a href="/product?warehouse=USFC39">Product</a><button id="go">Shipping</button></main><script>document.querySelector('#go').onclick=()=>{history.pushState({},'', '/help/shipping');fetch('/api/products/warehouse-availability?warehouse=CNFC').then(()=>{document.title='Shipping';document.querySelector('h1').textContent='Shipping';document.querySelector('a').href='/product?warehouse=CNFC';});};</script>`);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();beginSourceRenderedAction(page);await page.goto(origin);beginSourceRenderedAction(page);await page.locator('#go').click();const result=await waitSourceRenderedReadiness(page,{sourceUrl:origin,workflow:{sourceRenderedReadiness:{rules:[{pathPattern:'^/help/shipping$',selector:'h1',expectedText:'Shipping',requiredHrefQuery:{selector:'main a',parameter:'warehouse',value:'CNFC'},resourcePaths:['/api/products/warehouse-availability']}]}}},5000);assert.ok(result.stableMs>=1500);assert.equal(await page.title(),'Shipping');assert.equal(await page.locator('link[rel=canonical]').count(),0);
  await assert.rejects(waitSourceRenderedReadiness(page,{sourceUrl:origin,workflow:{sourceRenderedReadiness:{rules:[{pathPattern:'shipping',selector:'h1',expectedText:'Wrong heading'}]}}},10),/expectedText differs/);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('public resource inspection reads existing same-origin performance entries and closes only its empty lease',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-public-resources-'));let closed=0,observations=0;
 const project:any={sourceUrl:'https://source.invalid/',workflow:{sourceSession:{connection:{mode:'existing-chrome',userDataDir:'C:/resource-fixture'}}}};
 const page:any={url:()=>project.sourceUrl,evaluate:async(_fn:any,arg:any)=>{observations++;assert.deepEqual(arg.paths,['/api/products/warehouse-availability']);return[{resourceUrl:'https://source.invalid/api/products/warehouse-availability?productIds=public1&warehouseCode=CNFC',startTime:12,duration:34}];}};
 const context:any={pages:()=>[page,{url:()=> 'https://other.invalid/'}],newPage:()=>{throw Error('No new page');},close:()=>{throw Error('No context close');}};
 const browser:any={isConnected:()=>true,contexts:()=>[context],close:()=>{closed++;}};
 const release=borrowSourceBrowser(project,browser);
 try{const file=join(root,'project.json');await writeJson(file,project);const result=await inspectSourceResources(file,['/api/products/warehouse-availability']);assert.equal(result.rows.length,1);assert.equal(observations,1);assert.equal(closed,0);const raw=JSON.parse((await readRef(join(root,'verification/recon-current'),result.evidence)).toString());assert.equal(raw.rows[0].resources[0].duration,34);await assert.rejects(inspectSourceResources(file,['/api/products?guess=1']),/without query/);}
 finally{release();await rm(root,{recursive:true,force:true});}
});

test('changing public main text still fails readiness and reports bounded exact change fragments without token/email fields',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<!doctype html><title>Public product fixture</title><main><h1>Product</h1><p id="ticker">Public stock tick 0 support@example.invalid</p></main><script>let tick=0;setInterval(()=>document.querySelector("#ticker").textContent="Public stock tick "+(++tick)+" support@example.invalid",100)</script>');beginSourceRenderedAction(page);
  await assert.rejects(waitSourceRenderedReadiness(page,{sourceUrl:'https://source.invalid/'},100),error=>{
   const detail=(error as any).sourceRenderedReadinessDiagnostic;
   assert.match(String(error),/has not stabilized/);assert.ok(detail.identityChanges.length>0&&detail.identityChanges.length<=6);
   assert.ok(detail.identityChanges.some((change:any)=>change.fields.includes('main')&&change.main.before.includes('Public stock tick')));
   assert.ok(!JSON.stringify(detail).includes('support@example.invalid'));assert.ok(JSON.stringify(detail).includes('[redacted-email]'));
   assert.equal(detail.queryValuesRedacted,true);return true;
  });
 }finally{await browser.close();}
});

test('a public request finishing after unchanged DOM starts a new complete 1500ms stability window',async()=>{
 const server=createServer((req,res)=>{if(req.url==='/api/products'){setTimeout(()=>res.writeHead(200,{'Content-Type':'application/json'}).end('{}'),400);return;}res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Stable product</title><main><h1>Product</h1><p>Stable public content</p></main><script>fetch("/api/products")</script>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();beginSourceRenderedAction(page);await page.goto(origin,{waitUntil:'domcontentloaded'});const started=Date.now();const result=await waitSourceRenderedReadiness(page,{sourceUrl:origin},3000);assert.ok(Date.now()-started>=1750);assert.ok(result.stableMs>=1500);assert.ok(Date.parse(result.stableSince)-Date.parse(result.actionStartedAt)>=300,'timer must start after pending public request finishes');}
 finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('module resource opt-in observes at most 200 existing same-origin safe Nuxt scripts without relaxing exact API filtering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopyy-module-resources-'));
 const server=createServer((req,res)=>{if(req.url?.startsWith('/api/products')){res.writeHead(200,{'Content-Type':'application/json'}).end('{}');return;}if(req.url?.includes('.js')){res.writeHead(200,{'Content-Type':'application/javascript'}).end('export default 1;');return;}res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><main>Public fixture</main>'+Array.from({length:203},(_,i)=>`<script type="module" src="/_nuxt/Chunk${i}.js"></script>`).join('')+'<script type="module" src="/_nuxt/Query.js?not-public-module=fixture"></script><script type="module" src="/outside/Wrong.js"></script><script>fetch("/api/products?ids=public")</script>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({headless:true});let release:(()=>void)|undefined;
 try{
  const page=await browser.newPage();await page.goto(origin,{waitUntil:'networkidle'});
  const project:any={sourceUrl:origin,workflow:{sourceSession:{connection:{mode:'existing-chrome',userDataDir:join(root,'not-a-real-profile')}}}};const file=join(root,'project.json');await writeJson(file,project);release=borrowSourceBrowser(project,browser);
  const ordinary=await inspectSourceResources(file,['/api/products']);assert.ok(ordinary.rows[0].resources.every((r:any)=>new URL(r.resourceUrl).pathname==='/api/products'));
  const observed=await inspectSourceResources(file,['/api/products'],{includeModuleScripts:true}),resources=observed.rows[0].resources;
  assert.equal(resources.filter((r:any)=>new URL(r.resourceUrl).pathname.startsWith('/_nuxt/')).length,200);
  assert.ok(resources.some((r:any)=>new URL(r.resourceUrl).pathname==='/api/products'));assert.ok(!resources.some((r:any)=>/Query.js|Wrong.js/.test(r.resourceUrl)));
  assert.equal(observed.rows[0].sourcePage,page.url());assert.equal(browser.isConnected(),true);
 }finally{release?.();await browser.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
