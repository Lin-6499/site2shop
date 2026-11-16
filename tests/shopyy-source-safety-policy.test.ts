import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceUrlMutationReason,sourceNavigationOptions,waitSourceNavigation,waitSourceReadiness,assertSourceReadiness,sourceReadinessPolicy} from '../src/shopyy/source-safety-policy.js';
import {guardContext,perform} from '../src/shopyy/browser.js';
import {guardSourceSession} from '../src/shopyy/source-session.js';
import {writeJson} from '../src/shopyy/artifacts.js';
import {createServer} from 'node:http';
import {collectSourceScope} from '../src/shopyy/browser.js';
import {VISUAL_FIELDS} from '../src/shopyy/contracts.js';
import {canonical,digest,saveArtifact,jsonFile} from '../src/shopyy/artifacts.js';

test('URL policy blocks Woo/plugin mutations irrespective of GET and permits sort/view/static query values',()=>{
  for(const path of ['/?add-to-cart=12','/?remove_item=abc','/?undo_item=abc','/?add_to_wishlist=1','/?compare=1','/my-account/customer-logout/?_wpnonce=x','/?coupon=SALE','/?wc-ajax=add_to_cart','/?wc-ajax=update_order_review','/wp-admin/admin-ajax.php?action=yith-woocompare-add','/?action=woocommerce_add_to_cart','/logout','/?ADD-TO-CART=3'])assert.ok(sourceUrlMutationReason('https://fixture.invalid'+path),path);
  for(const path of ['/shop/?orderby=price-desc','/shop/?view=list','/shop/?layout=grid','/assets/image.jpg?width=800&height=400&format=webp&v=12','/assets/app.js?ver=1.2&action=load&name=compare','/?wc-ajax=get_variation'])assert.equal(sourceUrlMutationReason('https://fixture.invalid'+path),null,path);
});

test('actual installed capture and session request guards deny dangerous GET/HEAD and all unadmitted writes',async()=>{
  for(const install of [async(c:any)=>guardContext(c,'https://fixture.invalid','source'),async(c:any)=>guardSourceSession(c,{sourceUrl:'https://fixture.invalid'})]){
    let handler:any;await install({route:async(_pattern:any,fn:any)=>{handler=fn;}});
    for(const [method,path,expected] of [['GET','/?add-to-cart=7','abort'],['HEAD','/?remove_item=x','abort'],['OPTIONS','/?wc-ajax=apply_coupon','abort'],['POST','/shop/?orderby=date','abort'],['PUT','/api','abort'],['DELETE','/api','abort'],['GET','/shop/?orderby=price&view=list','continue'],['GET','/img.jpg?width=600&v=2','continue']]){
      let outcome='';await handler({request:()=>({method:()=>method,url:()=>`https://fixture.invalid${path}`,isNavigationRequest:()=>false,resourceType:()=>'fetch',frame:()=>({url:()=>'https://fixture.invalid/shop/'}),postData:()=>''}),abort:async()=>{outcome='abort';},continue:async()=>{outcome='continue';}});assert.equal(outcome,expected,method+' '+path);
    }
  }
});

test('real local network receives sort/view/assets but no mutating GET or unadmitted POST through either guard',async()=>{
  const hits:string[]=[];
  const server=createServer((req,res)=>{hits.push(req.method+' '+req.url);res.writeHead(200,{'Content-Type':'text/html'}).end('<h1>Network safety fixture</h1>');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as any).port;
  const browser=await chromium.launch({headless:true});
  try{
    for(const kind of ['capture','session']){
      hits.length=0;const context=await browser.newContext({serviceWorkers:'block'});
      try{
        if(kind==='capture')await guardContext(context,origin,'source');else await guardSourceSession(context,{sourceUrl:origin});
        const page=await context.newPage();await page.goto(origin+'/');
        await page.evaluate(async()=>{await Promise.allSettled([
          fetch('/?add-to-cart=9'),fetch('/?remove_item=abc'),fetch('/?wc-ajax=apply_coupon'),
          fetch('/shop/?orderby=price&view=list'),fetch('/asset.jpg?width=600&format=webp&v=1'),fetch('/api',{method:'POST',body:'write-must-not-arrive'})
        ]);});
        assert.ok(hits.includes('GET /shop/?orderby=price&view=list'));assert.ok(hits.includes('GET /asset.jpg?width=600&format=webp&v=1'));
        assert.equal(hits.some(p=>/add-to-cart|remove_item|wc-ajax|POST/.test(p)),false,JSON.stringify(hits));
      }finally{await context.close();}
    }
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('legacy sourceReadiness maps do not activate media policy or cause page readiness reads',async()=>{
  const legacy={'/shop/':'h1','/shop/?orderby=price':'.products:not(:has(.gz-lazy-load))'};
  const project={workflow:{sourceReadiness:legacy}};
  assert.equal(sourceReadinessPolicy(project,'/shop/'),null);
  // No locator/evaluate/wait is available: legacy maps must not invoke new waits.
  const page={url:()=>'https://fixture.invalid/shop/'} as any;
  assert.equal(await waitSourceReadiness(page,project,10),null);
  await assertSourceReadiness(page,project);
  assert.deepEqual(project.workflow.sourceReadiness,legacy);
});

test('explicit media readiness remains fail closed for missing rules or unmatched exact paths, including alongside a legacy map',()=>{
  const legacy={'/shop/':'h1'};
  for(const config of [null,{},legacy,{schemaVersion:1,rationale:'Reviewed fixture',rules:[]}]){
    assert.throws(()=>sourceReadinessPolicy({workflow:{sourceReadiness:legacy,sourceMediaReadiness:config}},'/shop/'),/Invalid explicit sourceMediaReadiness policy/);
  }
  const project={workflow:{sourceReadiness:legacy,sourceMediaReadiness:{schemaVersion:1,rationale:'Reviewed fixture',rules:[{paths:['/shop/'],absent:['.gz-lazy-load'],requiredImages:[]}]}}};
  assert.ok(sourceReadinessPolicy(project,'/shop/'));
  assert.throws(()=>sourceReadinessPolicy(project,'/shop/?orderby=price'),/no rule for current exact path/);
  assert.deepEqual(project.workflow.sourceReadiness,legacy);
});

test('stable 0.01 loading veil cannot become ready; only natural disappearance plus complete images succeeds without projection',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',r=>r.abort());
    await page.setContent(`<style>.gz-lazy-load{opacity:0.01}</style><div class="gz-lazy-load"><img id="product" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='3'%3E%3C/svg%3E"></div>`);
    // about:blank has pathname "blank"; use a synthetic HTTP URL, fulfilled locally.
    await page.route('http://readiness.test/shop/',r=>r.fulfill({contentType:'text/html',body:`<style>.gz-lazy-load{opacity:0.01}</style><div class="gz-lazy-load"><img id="product" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='3'%3E%3C/svg%3E"></div>`}));
    await page.goto('http://readiness.test/shop/');
    const project={workflow:{sourceReadiness:{'/shop/':'h1'},sourceMediaReadiness:{schemaVersion:1,rationale:'Synthetic natural lazy-loader regression',rules:[{paths:['/shop/'],absent:['.gz-lazy-load'],requiredImages:[{selector:'#product',minCount:1}]}]}}};
    await assert.rejects(waitSourceReadiness(page,project,100),/Timeout/);
    assert.equal(await page.locator('.gz-lazy-load').count(),1);assert.equal(await page.locator('div').evaluate(n=>getComputedStyle(n).opacity),'0.01');
    // The fixture's site code, not the collector, resolves its own loading state.
    await page.evaluate(()=>{document.querySelector('div')!.classList.remove('gz-lazy-load');});
    assert.match((await waitSourceReadiness(page,project,1000))!,/^[a-f0-9]{64}$/);
    await page.locator('#product').evaluate(n=>(n as HTMLImageElement).src='data:image/png,broken');
    await assert.rejects(waitSourceReadiness(page,project,100),/Timeout/);
    await assert.rejects(assertSourceReadiness(page,project),/changed during/);
    const missing=structuredClone(project);missing.workflow.sourceMediaReadiness.rules[0].requiredImages[0].selector='.missing';
    await assert.rejects(waitSourceReadiness(page,missing,100),/Timeout/);
  }finally{await browser.close();}
});

test('explicit commit strategy still waits for a semantic selector and does not change the default',async()=>{
  assert.deepEqual(sourceNavigationOptions({}),{waitUntil:'domcontentloaded'});
  assert.throws(()=>sourceNavigationOptions({workflow:{sourceNavigation:{waitUntil:'commit'}}}),/rationale/);
  const project={workflow:{sourceNavigation:{waitUntil:'commit',rationale:'Renderer DCL may stall; semantic proof remains required',readySelector:'#ready'}}};
  assert.deepEqual(sourceNavigationOptions(project),{waitUntil:'commit'});
  let waited=false;await waitSourceNavigation({locator:(s:string)=>{assert.equal(s,'#ready');return{waitFor:async()=>{waited=true;throw Error('not ready');}};}} as any,project,10).then(()=>assert.fail('must not skip semantic readiness'),()=>{});assert.ok(waited);
});

test('failed action retains durable op/start/end/result/error and earlier performed steps',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shopyy-safe-journal-'));const path=join(root,'attempt.json');const log:any[]=[];
  try{
    const page:any={on:()=>{},locator:()=>({count:async()=>1,click:async()=>{}})};
    const run=async(action:any)=>{let index=-1;return perform(page,action,'source',20,false,async row=>{if(index<0){index=log.length;log.push({...row});}else log[index]={...row};await writeJson(path,{kind:'attempt-not-success-check',log});});};
    await run({op:'click',selector:'#safe',effect:'read-only'});
    page.locator=()=>({count:async()=>1,click:async()=>{throw Error('fixture actual click failure');}});
    await assert.rejects(run({op:'click',selector:'#failing',effect:'read-only'}),/actual click failure/);
    const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.log.length,2);assert.equal(saved.log[0].result,'performed');const row=saved.log[1];assert.equal(row.op,'click');assert.equal(row.status,'failed');assert.equal(row.result,'failed');assert.match(row.error,/actual click failure/);assert.ok(Date.parse(row.startedAt)<=Date.parse(row.endedAt));assert.equal(saved.checks,undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('formal scoped collector preserves failed edge journals for all devices without manufacturing a successful check',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shopyy-failed-scope-'));
  const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Fixture source</title><h1>Source fixture</h1><button id="safe">Safe local view</button>'));
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as any).port;
  try{
    const provenance=await saveArtifact(root,{kind:'synthetic-only'}),inventory=await saveArtifact(root,{schemaVersion:2,sourceUrl:origin,complete:false,sources:[{url:origin,kind:'rendered',status:'ok',evidence:provenance}],coverage:{viewports:['desktop','tablet','mobile'],surfaces:[],agentReview:provenance},occurrences:[],routes:{'/shop/':{disposition:'mapped',targetPath:'/shop/',family:'collection',rationale:'Synthetic only'}}});
    const state={components:['heading'],paths:{source:'/shop/',target:'/shop/'},ready:{source:'h1',target:'h1'},assertions:{source:[{selector:'h1',read:'text',expected:'Source fixture'}],target:[{selector:'h1',read:'text',expected:'Source fixture'}]}};
    const actions=[{op:'click',selector:'#safe',effect:'read-only'},{op:'click',selector:'#missing',effect:'read-only'}];
    const plan={schemaVersion:2,revision:'failed-edge-fixture',sourceUrl:origin,inventory,viewports:{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}},limits:{timeoutMs:1000,maxActionsPerRoute:20,maxRoutes:2},environment:{locale:'en-US',timezoneId:'UTC'},routes:{shop:{family:'collection',sourcePath:'/shop/',targetPath:'/shop/',rationale:'Synthetic failed edge only',components:{heading:{source:'h1',target:'h1',requiredFields:VISUAL_FIELDS,rules:VISUAL_FIELDS.map(field=>({field,compare:'equal',rationale:'Synthetic fixture'})),owner:{file:'fixture.htm',marker:'fixture'}}},states:{initial:state,expanded:state},transitions:{open:{from:'initial',to:'expanded',input:'',actions:{source:actions,target:actions}},close:{from:'expanded',to:'initial',input:'',actions:{source:[actions[0]],target:[actions[0]]}}},sequence:['open','close']}}};
    const file=join(root,'project.json');await writeJson(join(root,'plan.json'),plan);await writeJson(file,{sourceUrl:origin,capturePlanFile:'plan.json',pageContractsFile:'contracts.json',outputDirectory:'build',workflow:{evidenceDirectory:'evidence'}});
    const intent={schemaVersion:1,scopeId:'failed-edge-fixture',projectSha256:digest(await readFile(file)),planSha256:digest(await readFile(join(root,'plan.json'))),inventory,routeIds:['shop'],viewports:['desktop','tablet','mobile'],sourceActionPolicy:'read-only'};
    const intentSha256=digest(canonical(intent));const review=await saveArtifact(root,{...intent,schemaVersion:1,kind:'source-scope-review',verdict:'approved-for-source-capture-only',reviewer:'isolated-test-not-real-review',reviewedAt:new Date().toISOString(),intentSha256,inventorySha256:inventory.sha256});
    await writeJson(join(root,'scope.json'),{...intent,review});const result=await collectSourceScope(file,'scope.json');assert.equal(result.scopeComplete,false);
    const output=join(root,'evidence/source-scopes',intent.scopeId,intentSha256.slice(0,12)),index=await jsonFile(join(output,'source-scope.json'));
    assert.equal(index.sessions.length,3);
    for(const session of index.sessions){
      assert.ok(session.errors.length);assert.equal(session.checks.some((c:any)=>c.id==='transition:open'),false);
      const attempt=await jsonFile(join(output,'attempts',digest(canonical({rid:'shop',vp:session.viewport,id:'open'}))+'.json'));
      assert.equal(attempt.status,'failed');assert.ok(attempt.error);assert.ok(Date.parse(attempt.startedAt)<=Date.parse(attempt.endedAt));assert.equal(attempt.log.source[0].status,'performed');assert.equal(attempt.log.source[1].status,'failed');assert.equal(attempt.log.source[1].op,'click');assert.ok(attempt.log.source[1].endedAt);
    }
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
