import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectSourceScope,perform} from '../src/shopyy/browser.js';
import {validateSourcePlan} from '../src/shopyy/source-plan.js';
import {verifyScopedSource} from '../src/shopyy/scoped-contracts.js';
import {canonical,digest,jsonFile,saveArtifact,writeJson} from '../src/shopyy/artifacts.js';
import {VISUAL_FIELDS} from '../src/shopyy/contracts.js';

async function fixture(mode:'fade'|'media'|'fonts',hidden=false){
  const root=await mkdtemp(join(tmpdir(),'shopyy-failure-checkpoint-'));
  const server=createServer((req,res)=>{
    if(req.url==='/held-font'){return;}
    res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><title>Local failure diagnostic fixture</title>
      <!-- This visibility delay deliberately exceeds the production 1500ms rendered-readiness window. -->
      <style>#panel{width:200px;height:60px;visibility:hidden;opacity:0;transition:opacity 3.2s linear,visibility 0s linear 3.2s}#panel.open{visibility:visible;opacity:1;transition:none}</style>
      <main><h1>Public fixture heading</h1><button id="open">Open</button><button id="close">Close backdrop</button><div id="panel">Public panel</div><input id="secret" value="INPUT_PRIVATE_SENTINEL"></main>
      <aside>PRIVATE_BODY_SENTINEL</aside>
      <script>
      document.querySelector('#open').onclick=()=>document.querySelector('#panel').classList.add('open');
      document.querySelector('#close').onclick=()=>{
        document.querySelector('#panel').classList.remove('open');
        if('${mode}'==='media')document.querySelector('#panel').classList.add('media-loading');
        if('${mode}'==='fonts'){
          const font=new FontFace('HeldFont','url(/held-font)');document.fonts.add(font);
          document.querySelector('h1').style.fontFamily='HeldFont';document.fonts.load('16px HeldFont').catch(()=>{});
        }
      };
      </script>`);
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+(server.address() as any).port;
  const proof=await saveArtifact(root,{kind:'localhost-only-synthetic-classification'});
  const inventory=await saveArtifact(root,{schemaVersion:2,sourceUrl:origin,complete:false,sources:[{kind:'sitemap',url:origin+'/sitemap.xml',status:'absent'},{kind:'rendered',url:origin+'/shop/',status:'ok',evidence:proof}],coverage:{viewports:['desktop','tablet','mobile'],surfaces:[]},occurrences:[],routes:{'/shop/':{disposition:'unresolved',rationale:'Synthetic source-only fixture',source:{family:'collection',representative:'collection',rationale:'Synthetic classification',evidence:proof}}}});
  const state=(open:boolean)=>({components:['heading','panel','secret'],paths:{source:'/shop/'},ready:{source:'h1'},assertions:{source:[{selector:'#panel',read:'visible',expected:open},{selector:'#secret',read:'value',expected:'INPUT_PRIVATE_SENTINEL'}]}});
  const component=(selector:string)=>({source:selector,requiredFields:VISUAL_FIELDS,rules:VISUAL_FIELDS.map(field=>({field,compare:'equal'}))});
  const plan:any={schemaVersion:1,kind:'source-only-plan',revision:'diagnostic-fixture',sourceUrl:origin,inventory,viewports:{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}},limits:{timeoutMs:hidden?5000:500,maxActionsPerRoute:4,maxRoutes:1},environment:{locale:'en-US',timezoneId:'UTC'},routes:{collection:{family:'collection',rationale:'Source diagnostics regression only',sourcePath:'/shop/',components:{heading:component('h1'),panel:component('#panel'),secret:component('#secret')},states:{initial:state(false),expanded:state(true)},transitions:{open:{from:'initial',to:'expanded',input:'',actions:{source:[{op:'click',selector:'#open',effect:'read-only'}]}},close:{from:'expanded',to:'initial',input:'',actions:{source:[{op:'click',selector:'#close',effect:'read-only',...(hidden?{waitAfter:{hidden:'#panel'}}:{})}]}}},sequence:['open','close']}}};
  const project={sourceUrl:origin,capturePlanFile:'plan.json',workflow:{evidenceDirectory:'evidence',sourceMediaReadiness:{schemaVersion:1,rationale:'Fixture natural media readiness',rules:[{paths:['/shop/'],absent:['.media-loading'],requiredImages:[]}]}}};
  const file=join(root,'project.json');await writeJson(file,project);await writeJson(join(root,'plan.json'),plan);
  const intent={schemaVersion:2,role:'source-only',planMode:'source-only-v1',scopeId:'capture-diagnostics-fixture',projectSha256:digest(await readFile(file)),planSha256:digest(await readFile(join(root,'plan.json'))),inventory,routeIds:['collection'],viewports:['desktop','tablet','mobile'],sourceActionPolicy:'read-only'};
  const intentSha256=digest(canonical(intent));const review=await saveArtifact(root,{...intent,kind:'source-scope-review',verdict:'approved-for-source-capture-only',reviewer:'synthetic-fixture-not-real-review',reviewedAt:new Date().toISOString(),intentSha256,inventorySha256:inventory.sha256});
  await writeJson(join(root,'scope.json'),{...intent,review});
  const evidenceRoot='evidence/source-scopes/'+intent.scopeId+'/'+intentSha256.slice(0,12),output=join(root,evidenceRoot);
  return{root,file,plan,output,evidenceRoot,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}};
}

test('source-only validator accepts hidden and rejects empty/malformed/unknown waitAfter without changing optional legacy actions',async()=>{
  const f=await fixture('fade',true);try{
    assert.deepEqual(validateSourcePlan(f.plan),[]);
    for(const bad of [null,false,'#panel',[],{}, {hidden:''},{hidden:' '},{hidden:5},{hidden:'#panel',force:true}]){
      const plan=structuredClone(f.plan);plan.routes.collection.transitions.close.actions.source[0].waitAfter=bad;
      assert.ok(validateSourcePlan(plan).some(e=>e.includes('post-action readiness')),JSON.stringify(bad));
    }
    for(const compatible of [undefined,{visible:'#panel'},{absent:'#panel'}]){
      const plan=structuredClone(f.plan);plan.routes.collection.transitions.close.actions.source[0].waitAfter=compatible;
      assert.deepEqual(validateSourcePlan(plan),[]);
    }
  }finally{await f.close();}
});

test('stable geometry alone fails visibility assertion and saves the actual pre-recovery result without private body/input values',async()=>{
  const f=await fixture('fade');try{
    const result=await collectSourceScope(f.file,'scope.json');assert.equal(result.scopeComplete,false);
    const index=await jsonFile(join(f.output,'source-scope.json'));assert.equal(index.sessions.length,3);
    for(const session of index.sessions){
      assert.equal(session.checks.some((c:any)=>c.id==='transition:close'),false);
      const attempt=await jsonFile(join(f.output,'attempts',digest(canonical({rid:'collection',vp:session.viewport,id:'close'}))+'.json'));
      assert.equal(attempt.status,'failed');assert.equal(attempt.log.source[0].status,'performed');
      assert.match(session.errors.join(' '),/assertions.*#panel.*expected=false actual=true/);
      const match=session.errors.join(' ').match(/failed-state diagnostic (artifacts\/[a-f0-9]+\.json)/);assert.ok(match);
      const bytes=await readFile(join(f.output,match[1]),'utf8'),diagnostic=JSON.parse(bytes);
      assert.equal(diagnostic.kind,'failed-state-diagnostic-not-capture');assert.equal(diagnostic.accepted,false);assert.equal(diagnostic.checkpoint,'assertions');assert.equal(diagnostic.viewport,session.viewport);
      assert.equal(diagnostic.state,'initial');assert.equal(diagnostic.side,'source');assert.equal(diagnostic.actualUrl,new URL('/shop/',f.plan.sourceUrl).href);
      assert.equal(diagnostic.observation.kind,'pre-failure-measurement');assert.equal(diagnostic.observation.components.panel.visible,true);
      assert.deepEqual(Object.keys(diagnostic.observation.components).sort(),['heading','panel','secret']);
      assert.equal(diagnostic.assertions[0].selector,'#panel');assert.equal(diagnostic.assertions[0].read,'visible');assert.equal(diagnostic.assertions[0].actual,true);assert.equal(diagnostic.assertions[0].expected,false);assert.equal(diagnostic.assertions[0].passed,false);
      assert.equal(diagnostic.assertions[1].actual,'[redacted:text-or-input-value]');
      assert.equal(bytes.includes('PRIVATE_BODY_SENTINEL'),false);assert.equal(bytes.includes('INPUT_PRIVATE_SENTINEL'),false);
      assert.equal(diagnostic.screenshot,undefined);assert.equal(diagnostic.schemaVersion,undefined);
    }
    await assert.rejects(verifyScopedSource(f.file,{scope:'scope.json',evidenceRoot:f.evidenceRoot,index:'source-scope.json'}));
  }finally{await f.close();}
});

test('hidden waits for actual CSS visibility, preserves exact reviewed action in journals and passes three-device verifier',async()=>{
  const f=await fixture('fade',true);try{
    const result=await collectSourceScope(f.file,'scope.json');assert.equal(result.scopeComplete,true,JSON.stringify(result));
    const verified=await verifyScopedSource(f.file,{scope:'scope.json',evidenceRoot:f.evidenceRoot,index:'source-scope.json'});
    assert.equal(verified.transitions.length,6);
    const index=await jsonFile(join(f.output,'source-scope.json'));
    for(const session of index.sessions){
      assert.deepEqual(session.errors,[]);const close=session.checks.find((c:any)=>c.id==='transition:close');const log=await jsonFile(join(f.output,close.actionLog.path));
      assert.equal(log.source[0].status,'performed');assert.deepEqual(log.source[0].action.waitAfter,{hidden:'#panel'});
      const cap=await jsonFile(join(f.output,close.after.source.path));assert.equal(cap.assertions[0].actual,false);assert.equal(cap.components.panel.visible,false);
    }
    const artifacts=await readdir(join(f.output,'artifacts'));for(const name of artifacts.filter(n=>n.endsWith('.json')))assert.notEqual((await jsonFile(join(f.output,'artifacts',name))).kind,'failed-state-diagnostic-not-capture');
    // Existing verifier binds the entire action, including hidden, not just op.
    const close=index.sessions[0].checks.find((c:any)=>c.id==='transition:close');const log=await jsonFile(join(f.output,close.actionLog.path));log.source[0].action.waitAfter.hidden='#wrong';close.actionLog=await saveArtifact(f.output,log);await writeJson(join(f.output,'source-scope.json'),index);
    await assert.rejects(verifyScopedSource(f.file,{scope:'scope.json',evidenceRoot:f.evidenceRoot,index:'source-scope.json'}));
  }finally{await f.close();}
});

for(const mode of ['media','fonts'] as const)test(`${mode} timeout records the precise checkpoint, never substitutes a later read, and retains performed edge logs`,async()=>{
  const f=await fixture(mode);try{
    const result=await collectSourceScope(f.file,'scope.json');assert.equal(result.scopeComplete,false);
    const index=await jsonFile(join(f.output,'source-scope.json'));
    for(const session of index.sessions){
      const match=session.errors.join(' ').match(/failed-state diagnostic (artifacts\/[a-f0-9]+\.json)/);assert.ok(match,JSON.stringify(session));
      const diagnostic=await jsonFile(join(f.output,match[1]));assert.equal(diagnostic.checkpoint,mode);assert.equal(diagnostic.accepted,false);assert.match(diagnostic.error,/Timeout/);assert.equal(diagnostic.observation,null);assert.match(diagnostic.observationUnavailable,/no after-failure sampling/);
      assert.ok(diagnostic.checkpoints.some((c:any)=>c.checkpoint===mode));assert.equal(diagnostic.assertions[0].status,'not-read');assert.equal(diagnostic.assertions[0].actual,null);
      const attempt=await jsonFile(join(f.output,'attempts',digest(canonical({rid:'collection',vp:session.viewport,id:'close'}))+'.json'));assert.equal(attempt.status,'failed');assert.equal(attempt.log.source[0].result,'performed');assert.match(attempt.error,new RegExp('failed at '+mode));
      assert.equal(session.checks.some((c:any)=>c.id==='transition:close'),false);
    }
  }finally{await f.close();}
});

test('a hidden wait timeout is a failed action with the exact waitAfter policy retained',async()=>{
  const log:any[]=[];let index=-1;
  const page:any={on:()=>{},locator:(selector:string)=>selector==='#close'?{count:async()=>1,click:async()=>{}}:{waitFor:async(options:any)=>{assert.equal(options.state,'hidden');throw Error('fixture hidden timeout');}}};
  await assert.rejects(perform(page,{op:'click',selector:'#close',effect:'read-only',waitAfter:{hidden:'#panel'}},'source',50,false,async row=>{if(index<0){index=log.length;log.push({...row});}else log[index]={...row};}),/hidden timeout/);
  assert.equal(log[0].status,'failed');assert.equal(log[0].action.waitAfter.hidden,'#panel');assert.ok(log[0].endedAt);
});
