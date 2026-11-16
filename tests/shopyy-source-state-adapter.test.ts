import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SOURCE_STATE_ADAPTER,SOURCE_STATE_FIELDS,stateMediaPolicy,waitStateMedia,sampleStateMedia,verifyStateMediaProof,performSourceScroll,observeSourceFields,readSourceAssertion,validSemanticScroll,verifySourceScrollProof} from '../src/shopyy/source-state-adapter.js';
import {waitSourceReadiness,assertSourceReadiness,sourceReadinessPolicy} from '../src/shopyy/source-safety-policy.js';
import {perform,collectSourceScope} from '../src/shopyy/browser.js';
import {validateSourcePlan} from '../src/shopyy/source-plan.js';
import {verifyScopedSource} from '../src/shopyy/scoped-contracts.js';
import {sourceScopeIntent} from '../src/shopyy/source-scope.js';
import {VISUAL_FIELDS} from '../src/shopyy/contracts.js';
import {digest,canonical,saveArtifact,writeJson,jsonFile} from '../src/shopyy/artifacts.js';
const settle={frames:8,tolerancePx:0.5};
const svg="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='9'%3E%3C/svg%3E";
const config=()=>({schemaVersion:2,rationale:'Synthetic state-specific natural media; not real-site evidence',rules:[
  {paths:['/'],states:['initial'],absent:['.loading'],requiredImages:[],viewportImages:true,uiReady:'domcontentloaded-jquery-ready',coverage:'viewport'},
  {paths:['/'],states:['fullpage-after-traversal'],absent:['.loading'],requiredImages:[{selector:'#lower',minCount:1}],viewportImages:true,uiReady:'domcontentloaded-jquery-ready',coverage:'fullpage-after-traversal'}
]});
const project=()=>({workflow:{sourceMediaReadiness:config()}});
const body=`<!doctype html><title>Isolated state adapter</title><style>html{scroll-behavior:smooth}body{margin:0}#top{height:80px}#lower{display:block;width:80px;height:90px;margin-top:10000px}#rail{display:flex;overflow-x:auto;scroll-behavior:smooth;width:200px;height:80px}#rail>button{flex:0 0 180px}#clip{width:20px;height:20px;overflow:hidden;position:relative}#outside{position:absolute;left:80px;width:10px;height:10px}</style><h1 id="top">Natural fixture</h1><img id="hero" width="8" height="9" src="${svg}"><button id="focus" aria-expanded="false">Local control</button><div id="rail"><button>A</button><button id="last">B</button></div><div id="clip"><span id="outside">Clipped</span></div><img id="lower" loading="lazy" data-src="${svg}"><script>window.jQuery=function(){};document.addEventListener('DOMContentLoaded',()=>{requestAnimationFrame(()=>{jQuery.isReady=true})});const io=new IntersectionObserver(rows=>{for(const r of rows)if(r.isIntersecting){r.target.src=r.target.dataset.src;io.unobserve(r.target)}});io.observe(document.querySelector('#lower'));</script>`;

test('strict v2 config rejects unknown modes/JS/keys, missing and overlapping states; legacy default remains untouched',()=>{
  assert.equal(sourceReadinessPolicy({workflow:{sourceReadiness:{'/':'h1'}}},'/'),null);
  for(const mutate of [(c:any)=>c.evaluate='return true',(c:any)=>c.rules[0].uiReady='eval',(c:any)=>c.rules[0].viewportImages=false,(c:any)=>c.rules[0].requiredImages=[{selector:'img',minCount:0}],(c:any)=>c.rules[1].requiredImages=[],(c:any)=>c.rules[0].states=[],(c:any)=>c.rules.push(c.rules[0])]){
    const c=config();mutate(c);assert.throws(()=>stateMediaPolicy({workflow:{sourceMediaReadiness:c}},'/','initial'));
  }
  assert.throws(()=>stateMediaPolicy(project(),'/'),/explicit state/);
  assert.throws(()=>stateMediaPolicy(project(),'/','unknown'),/exactly one/);
  assert.throws(()=>stateMediaPolicy(project(),'/other','initial'),/exactly one/);
  assert.equal(validSemanticScroll({op:'scroll-element',selector:'#rail',x:100,effect:'read-only',settle}),true);
  for(const change of [{x:-1},{settle:{frames:1,tolerancePx:0}},{settle:{frames:8,tolerancePx:3}},{script:'evil'},{effect:'local-fixture'}])assert.equal(validSemanticScroll({op:'scroll-element',selector:'#rail',x:100,effect:'read-only',settle,...change}),false);
});

test('real browser state media differs by state, naturally scroll-loads without changing loading/src, fails missing/broken images and UI',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:500,height:400}});
    await page.route('**/*',r=>r.request().url()==='http://synthetic.test/'?r.fulfill({contentType:'text/html',body}):r.abort());
    await page.goto('http://synthetic.test/');
    const p=project(),initial=stateMediaPolicy(p,'/','initial')!,full=stateMediaPolicy(p,'/','fullpage-after-traversal')!;
    const first=await waitStateMedia(page,initial,2000);verifyStateMediaProof(initial,first);
    assert.equal(first.ui.jqueryReady,true);assert.equal(await page.locator('#lower').getAttribute('src'),null);
    await assert.rejects(waitStateMedia(page,full,150),/Timeout/);
    const action:any={op:'scroll-into-view',selector:'#lower',block:'center',effect:'read-only',settle};
    const proof=await performSourceScroll(page,action,4000);verifySourceScrollProof(action,proof);assert.equal(proof.element.inViewport,true);
    const after=await waitStateMedia(page,full,2000);verifyStateMediaProof(full,after);assert.ok(after.requiredImages[0].images[0].naturalWidth>0);
    assert.equal(await page.locator('#lower').getAttribute('loading'),'lazy');assert.equal(await page.locator('#lower').getAttribute('src'),svg);
    assert.match((await waitSourceReadiness(page,p,2000,'fullpage-after-traversal'))!,/^[a-f0-9]{64}$/);
    await assertSourceReadiness(page,p,'fullpage-after-traversal');
    for(const change of [(s:any)=>delete s.ui,(s:any)=>s.state='initial',(s:any)=>s.requiredImages[0].images[0].naturalWidth=0,(s:any)=>s.requiredImages=[]]){const bad=structuredClone(after);change(bad);assert.throws(()=>verifyStateMediaProof(full,bad));}
    // Fixture site error branch; collector never edits src or loading.
    await page.evaluate(()=>{(document.querySelector('#lower') as HTMLImageElement).src='data:image/png,broken';});
    await assert.rejects(waitStateMedia(page,full,150),/Timeout/);
    await assert.rejects(assertSourceReadiness(page,p,'fullpage-after-traversal'));
    const missing=project();missing.workflow.sourceMediaReadiness.rules[1].requiredImages[0].selector='#missing';
    await assert.rejects(waitStateMedia(page,stateMediaPolicy(missing,'/','fullpage-after-traversal')!,150),/Timeout/);
    await page.evaluate(()=>{(window as any).jQuery.isReady=false;});
    await assert.rejects(waitStateMedia(page,initial,150),/Timeout/);
  }finally{await browser.close();}
});

test('horizontal forward/reverse and animated document scroll wait for actual positions; intersection accounts for clipping and actual focus/ARIA/lock',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:500,height:400}});await page.setContent(body);
    const h:any={op:'scroll-element',selector:'#rail',x:160,effect:'read-only',settle};
    const forward=await performSourceScroll(page,h,3000);verifySourceScrollProof(h,forward);assert.ok(Math.abs(forward.scroll.x-160)<=0.5);
    const reverse=await performSourceScroll(page,{...h,x:0},3000);assert.ok(Math.abs(reverse.scroll.x)<=0.5);
    await assert.rejects(performSourceScroll(page,{...h,x:10000},1000),/reachable/);
    await assert.rejects(perform(page,h,'target',1000,false,undefined,true),/source-only/);
    await assert.rejects(perform(page,h,'source',1000,false),/source-only/);
    const rows:any[]=[];await perform(page,h,'source',3000,false,async r=>{rows.push(structuredClone(r));},true);verifySourceScrollProof(h,rows.at(-1).observation);
    await page.locator('#focus').focus();
    const fields=await observeSourceFields(page,{button:'#focus',clipped:'#outside',last:'#last'});
    assert.equal(fields.button.focused,true);assert.equal(fields.button.ariaExpanded,'false');assert.equal(fields.button.tabIndex,0);assert.equal(fields.clipped.inViewport,false);
    assert.equal(await readSourceAssertion(page,'#focus','focused'),true);
    await page.evaluate(()=>{document.body.style.overflow='hidden';document.querySelector('#focus')!.setAttribute('aria-expanded','true');});
    const locked=await observeSourceFields(page,{button:'#focus'});assert.equal(locked.button.scrollLock.locked,true);assert.equal(locked.button.ariaExpanded,'true');
    await page.evaluate(()=>document.body.style.overflow='');
    await performSourceScroll(page,{op:'scroll-into-view',selector:'#lower',block:'center',effect:'read-only',settle},4000);
    assert.equal((await observeSourceFields(page,{lower:'#lower'})).lower.inViewport,true);
    await performSourceScroll(page,{op:'scroll-into-view',selector:'#top',block:'start',effect:'read-only',settle},4000);
    const topGeometry=await page.locator('#top').evaluate(n=>({viewportY:n.getBoundingClientRect().y,documentY:n.getBoundingClientRect().y+scrollY,scrollY}));
    assert.ok(Math.abs(topGeometry.viewportY)<=0.5);assert.ok(Math.abs(topGeometry.scrollY-topGeometry.documentY)<=0.5);
    const bad=structuredClone(forward);bad.scroll.x=0;assert.throws(()=>verifySourceScrollProof(h,bad));
  }finally{await browser.close();}
});

test('formal source-only collector and offline scope verifier share state media/observer/action policy; tampered raw proofs fail',async()=>{
  const root=await mkdtemp(join(tmpdir(),'source-state-adapter-'));
  const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><title>Synthetic formal adapter</title><link rel="canonical" href="/"><style>body{margin:0}#rail{display:flex;overflow:auto;width:200px;height:70px}button{flex:0 0 180px}</style><h1>State adapter fixture</h1><img src="${svg}" width="8" height="9"><div id="rail"><button id="first" aria-expanded="false">One</button><button>Two</button></div><script>window.jQuery=function(){};jQuery.isReady=true;</script>`));
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as any).port;
  try{
    const classification=await saveArtifact(root,{kind:'synthetic-not-site-evidence'}),inventory=await saveArtifact(root,{schemaVersion:2,sourceUrl:origin,complete:false,sources:[{kind:'sitemap',status:'absent',url:origin+'/sitemap.xml'},{kind:'rendered',status:'ok',url:origin,evidence:classification}],coverage:{viewports:['desktop','tablet','mobile'],surfaces:[]},occurrences:[],routes:{'/':{disposition:'unresolved',rationale:'Synthetic unresolved target',source:{family:'home',representative:'home',rationale:'Isolated test',evidence:classification}}}});
    const state=(x:number)=>({observer:SOURCE_STATE_ADAPTER,components:['rail'],paths:{source:'/'},ready:{source:'#rail'},assertions:{source:[{selector:'#rail',read:'inViewport',expected:true},{selector:'#first',read:'ariaExpanded',expected:'false'}]}});
    const action=(x:number)=>({op:'scroll-element',selector:'#rail',x,settle,effect:'read-only'});
    const fields=[...VISUAL_FIELDS,...SOURCE_STATE_FIELDS,'scrollLeft'];
    const plan:any={schemaVersion:1,kind:'source-only-plan',revision:'synthetic-adapter-r1',sourceUrl:origin,inventory,viewports:{desktop:{width:800,height:600},tablet:{width:768,height:1024},mobile:{width:375,height:812}},limits:{timeoutMs:4000,maxActionsPerRoute:4,maxRoutes:1},environment:{locale:'en-US',timezoneId:'UTC'},routes:{home:{family:'home',rationale:'Synthetic adapter test',sourcePath:'/',components:{rail:{source:'#rail',requiredFields:fields,rules:fields.map(field=>({field,compare:'equal'}))}},states:{initial:state(0),scrolled:state(160)},transitions:{right:{from:'initial',to:'scrolled',input:'',actions:{source:[action(160)]}},left:{from:'scrolled',to:'initial',input:'',actions:{source:[action(0)]}}},sequence:['right','left']}}};
    assert.deepEqual(validateSourcePlan(plan),[]);
    for(const mutate of [(p:any)=>p.routes.home.states.initial.observer='eval',(p:any)=>delete p.routes.home.states.initial.observer,(p:any)=>p.routes.home.transitions.right.actions.source[0].settle.frames=0,(p:any)=>p.limits.maxActionsPerRoute=1]){const bad=structuredClone(plan);mutate(bad);assert.ok(validateSourcePlan(bad).length);}
    const cfg=config();cfg.rules=[{...cfg.rules[0],states:['initial','scrolled']}];
    const file=join(root,'project.json');await writeJson(file,{sourceUrl:origin,capturePlanFile:'plan.json',workflow:{evidenceDirectory:'evidence',sourceMediaReadiness:cfg}});await writeJson(join(root,'plan.json'),plan);
    const intent={schemaVersion:2,role:'source-only',planMode:'source-only-v1',scopeId:'adapter-synthetic',projectSha256:digest(await readFile(file)),planSha256:digest(await readFile(join(root,'plan.json'))),inventory,routeIds:['home'],viewports:['desktop','tablet','mobile'],sourceActionPolicy:'read-only'};
    const review=await saveArtifact(root,{...intent,kind:'source-scope-review',verdict:'approved-for-source-capture-only',reviewer:'synthetic-test-only',reviewedAt:new Date().toISOString(),intentSha256:digest(canonical(intent)),inventorySha256:inventory.sha256});
    const scope={...intent,review};await writeJson(join(root,'scope.json'),scope);
    const result=await collectSourceScope(file,'scope.json');assert.equal(result.scopeComplete,true,JSON.stringify(result.findings));assert.equal(result.formalBuildAllowed,false);
    const evidenceRoot='evidence/source-scopes/adapter-synthetic/'+digest(canonical(sourceScopeIntent(scope as any))).slice(0,12),input={scope:'scope.json',evidenceRoot,index:'source-scope.json'};
    const verified=await verifyScopedSource(file,input);assert.equal(verified.captures.length,18);
    const indexFile=join(root,evidenceRoot,'source-scope.json'),index=await jsonFile(indexFile);
    for(const mutate of [(c:any)=>delete c.captureEnvironment.sourceStateMedia,(c:any)=>c.captureEnvironment.sourceStateMedia.state='other',(c:any)=>delete c.components.rail.inViewport]){
      const changed=structuredClone(index),cap=await jsonFile(join(root,evidenceRoot,changed.sessions[0].checks[0].before.source.path));mutate(cap);changed.sessions[0].checks[0].before.source=await saveArtifact(join(root,evidenceRoot),cap);await writeJson(indexFile,changed);await assert.rejects(verifyScopedSource(file,input));await writeJson(indexFile,index);
    }
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
