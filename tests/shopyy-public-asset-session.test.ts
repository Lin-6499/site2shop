import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicAssetClient} from '../src/shopyy/public-http.js';
import {borrowSourceBrowser,sourceSessionPolicy} from '../src/shopyy/source-session.js';
import {collectSourceAssets} from '../src/shopyy/source-assets.js';
import {saveArtifact,writeJson} from '../src/shopyy/artifacts.js';

function registered(urls=['https://assets.invalid/catalog']){
 const project={sourceUrl:'https://assets.invalid/',workflow:{publicAssetTransport:'existing-chrome-session',sourceSession:{connection:{mode:'existing-chrome' as const,userDataDir:'test-borrowed-assets'}}}};
 const calls={browserClose:0,contextClose:0,newContext:0,newPage:0,pageClose:0,front:0,evaluations:0,routes:0};
 function page(initial:string){let url=initial,closed=false;return{url:()=>url,isClosed:()=>closed,bringToFront:async()=>{calls.front++},evaluate:async(fn:any,arg:any)=>{calls.evaluations++;return fn(arg)},goto:async(next:string)=>{url=next},route:async()=>{calls.routes++},close:async()=>{closed=true;calls.pageClose++},setViewportSize:async()=>{throw Error('Do not change user viewport')}};}
 const pages=urls.map(page),context={pages:()=>pages,newPage:async()=>{calls.newPage++;const p=page('about:blank');pages.push(p);return p},close:async()=>{calls.contextClose++}};
 const browser={isConnected:()=>true,contexts:()=>[context],newContext:async()=>{calls.newContext++;throw Error('Do not create a context')},close:async()=>{calls.browserClose++}};
 return{project,calls,release:borrowSourceBrowser(project,browser as any)};
}

// These tests execute the fetch callback against an in-memory fetch mock, never CDP.
test('Chrome asset transport borrows registered page, exact observed GET only, and never exports cookie headers',async()=>{
 const session=registered(['https://assets.invalid/api/products','https://elsewhere.invalid/','https://assets.invalid/catalog']);
 const previous=globalThis.fetch,requests:any[]=[];let client:any;
 try{
  globalThis.fetch=async(url:any,options:any)=>{requests.push({url,options});return new Response(new Uint8Array([0,1,2,3]),{headers:{'content-type':'video/mp4','set-cookie':'secret=never-export','etag':'public-hash'}})};
  ({client}=await publicAssetClient(session.project,['https://assets.invalid/video.mp4','https://assets.invalid/logout']));
  const response=await client.get('https://assets.invalid/video.mp4',{method:'POST'});
  assert.equal(response.ok(),true);assert.equal(response.status(),200);assert.deepEqual(await response.body(),Buffer.from([0,1,2,3]));
  assert.equal(response.headers()['set-cookie'],undefined);assert.equal(response.headers().etag,'public-hash');
  assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.credentials,'same-origin');assert.equal(requests[0].options.redirect,'error');
  await assert.rejects(client.get('https://elsewhere.invalid/video.mp4'),/exact observed/);
  await assert.rejects(client.get('https://assets.invalid/unobserved.mp4'),/exact observed/);
  await assert.rejects(client.get('https://assets.invalid/logout'),/read-only/);
  assert.equal(requests.length,1);assert.equal(session.calls.newContext,0);assert.equal(session.calls.newPage,0);assert.ok(session.calls.front>0);
  await client.dispose();await client.dispose();assert.equal(session.calls.browserClose,0);assert.equal(session.calls.contextClose,0);assert.equal(session.calls.pageClose,0);
 }finally{globalThis.fetch=previous;await client?.dispose();session.release()}
});

test('Chrome asset transport refuses a new connection and closes only its own fallback page',async()=>{
 const project={sourceUrl:'https://unregistered.invalid/',workflow:{publicAssetTransport:'existing-chrome-session',sourceSession:{connection:{mode:'existing-chrome',userDataDir:'test-unregistered'}}}};
 await assert.rejects(publicAssetClient(project,['https://unregistered.invalid/image.png']),/already registered/);
 const session=registered(['https://assets.invalid/api/products']);let client:any;
 try{({client}=await publicAssetClient(session.project,[]));assert.equal(session.calls.newPage,1);assert.equal(session.calls.routes,1);await client.dispose();assert.equal(session.calls.pageClose,1);assert.equal(session.calls.contextClose,0);assert.equal(session.calls.browserClose,0)}finally{await client?.dispose();session.release()}
});

test('Chrome asset transport rejects HTML and enforces separate image/video byte budgets',async()=>{
 const session=registered(),previous=globalThis.fetch;let client:any;
 try{
  const urls=['html','fake','image','large-video','video'].map(n=>'https://assets.invalid/'+n);
  ({client}=await publicAssetClient(session.project,urls));
  globalThis.fetch=async(url:any)=>{
   const name=String(url).split('/').pop();
   if(name==='html')return new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}});
   if(name==='fake')return new Response('<!doctype html><html>challenge</html>',{headers:{'content-type':'video/mp4'}});
   return new Response(new Uint8Array([1]),{headers:{'content-type':name==='image'?'image/png':'video/mp4','content-length':String((name==='large-video'?101:11)*1024*1024)}});
  };
  await assert.rejects(client.get(urls[0]),/HTML/);await assert.rejects(client.get(urls[1]),/HTML/);
  await assert.rejects(client.get(urls[2]),/size budget/);await assert.rejects(client.get(urls[3]),/size budget/);
  assert.equal((await client.get(urls[4])).ok(),true);
 }finally{globalThis.fetch=previous;await client?.dispose();session.release()}
});

test('Asset collector consumes hashed styles/media/posters and preserves supplemental session/hash policy checks',async()=>{
 const session=registered(),root=await mkdtemp(join(tmpdir(),'shopyy-session-assets-')),previous=globalThis.fetch;
 let requests=0;
 try{
  await mkdir(join(root,'assets'));const project={...session.project,assetsDirectory:'assets',workflow:{...session.project.workflow,sourceAssetObservationsFile:'supplemental.json'}};
  const primary=await saveArtifact(root,{kind:'reconnaissance-not-acceptance',structure:'<main>Media</main>',styles:['/theme.css'],media:[{tag:'VIDEO',src:'/observed.mp4',poster:'/poster.png'},{tag:'IMG',src:'https://unreviewed.invalid/image.png'}]});
  const supplemental={kind:'reconnaissance-not-acceptance',structure:'<main>Other media</main>',requestedPath:'/',url:project.sourceUrl,sourceSessionCurrent:true,sourceSessionPolicySha256:sourceSessionPolicy(project),stylesheets:['/other.css'],media:[{tag:'SOURCE',src:'/observed.webm'}]};
  const extra=await saveArtifact(root,supplemental);
  await writeJson(join(root,'supplemental.json'),[extra]);await writeJson(join(root,'project.json'),project);
  await writeJson(join(root,'contracts/route-inventory.v2.json'),{sourceUrl:project.sourceUrl,coverage:{surfaces:[{status:'captured',evidence:primary}]}});
  globalThis.fetch=async(url:any,options:any)=>{requests++;assert.equal(options.method,'GET');const path=new URL(String(url)).pathname;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':path.endsWith('.mp4')?'video/mp4':path.endsWith('.webm')?'video/webm':path.endsWith('.css')?'text/css':'image/png'}})};
  const result=await collectSourceAssets(join(root,'project.json'));assert.equal(result.passed,true);assert.equal(result.downloaded,5);assert.equal(requests,5);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.equal(manifest.assets.filter((a:any)=>a.kind==='video').length,2);assert.ok(manifest.assets.some((a:any)=>a.file.endsWith('.webm')));
  const stale=await saveArtifact(root,{...supplemental,sourceSessionPolicySha256:'0'.repeat(64)});await writeJson(join(root,'supplemental.json'),[stale]);await assert.rejects(collectSourceAssets(join(root,'project.json')),/session is stale/);assert.equal(requests,5);
  await writeJson(join(root,'supplemental.json'),[extra]);await writeFile(join(root,extra.path),'changed');await assert.rejects(collectSourceAssets(join(root,'project.json')),/Changed evidence/);assert.equal(requests,5);
  assert.equal(session.calls.browserClose,0);assert.equal(session.calls.contextClose,0);
 }finally{globalThis.fetch=previous;session.release();await rm(root,{recursive:true,force:true})}
});

async function jsonPlanFixture(project:any){
 const root=await mkdtemp(join(tmpdir(),'shopyy-public-json-'));
 await mkdir(join(root,'assets/source-current'),{recursive:true});await writeJson(join(root,'assets/source-current/manifest.json'),{sentinel:'visual-assets-unchanged'});
 const script=await saveArtifact(root,"const productDetail = slug => api('/products/slug/' + slug);",'js');
 const catalog=await saveArtifact(root,{kind:'published-catalog',products:['a','b','c']});
 const plan={schemaVersion:1,kind:'source-public-data-request-plan',sourceUrl:project.sourceUrl,allowedPathPrefix:'/api/products/slug/',provenance:[{kind:'public-client-script',...script},{kind:'published-catalog',...catalog}],requests:['a','b','c'].map(id=>({id,url:project.sourceUrl+'api/products/slug/'+id}))};
 await writeJson(join(root,'planning/read-plan.json'),plan);await writeJson(join(root,'project.json'),{...project,assetsDirectory:'assets'});
 return{root,plan,projectFile:join(root,'project.json'),options:{publicJsonPlanFile:'planning/read-plan.json',outputDirectory:'recon/data'}};
}

test('Public JSON mode reads three planned products at one-second spacing, preserves raw bodies, and reuses verified responses',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch,times:number[]=[],raws=new Map<string,string>();
 try{
  globalThis.fetch=async(url:any,options:any)=>{times.push(Date.now());assert.equal(options.method,'GET');const id=new URL(String(url)).pathname.split('/').pop()!;const raw=' {\n "code":200,"data":{"slug":"'+id+'","detailSections":[]}}\n';raws.set(id,raw);return new Response(raw,{headers:{'content-type':'application/json; charset=utf-8'}})};
  const result=await collectSourceAssets(fixture.projectFile,fixture.options);assert.equal(result.kind,'source-public-data-not-acceptance');assert.equal(result.role,'public-content-data');assert.equal(result.formalCaptureEvidence,false);assert.equal(result.downloaded,3);assert.equal(result.passed,true);
  assert.ok(times[1]-times[0]>=900&&times[2]-times[1]>=900);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.equal(manifest.completed.length,3);assert.equal(manifest.formalCaptureEvidence,false);assert.equal(manifest.pending.length,0);
  for(const record of manifest.completed){const raw=await readFile(join(result.directory,record.file));assert.equal(raw.toString(),raws.get(record.id));assert.equal(record.httpStatus,200);assert.equal(record.apiCode,200);assert.equal(record.provenance.length,2);assert.equal(record.formalCaptureEvidence,false);}
  const reused=await collectSourceAssets(fixture.projectFile,fixture.options);assert.equal(reused.reused,3);assert.equal(times.length,3);
  assert.deepEqual(JSON.parse(await readFile(join(fixture.root,'assets/source-current/manifest.json'),'utf8')),{sentinel:'visual-assets-unchanged'});
  assert.equal(session.calls.browserClose,0);assert.equal(session.calls.contextClose,0);assert.equal(session.calls.newPage,0);assert.equal(session.calls.newContext,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Public JSON mode rejects private/cross-origin/query/hash/mismatched requests and changed provenance before fetch',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;let requests=0;
 try{
  globalThis.fetch=async()=>{requests++;throw Error('Unexpected network request')};
  const mutations=[(p:any)=>{p.allowedPathPrefix='/api/admin/products/'},(p:any)=>{p.requests[0].url='https://other.invalid/api/products/slug/a'},(p:any)=>{p.requests[0].url+='?x=1'},(p:any)=>{p.requests[0].url+='#'},(p:any)=>{p.requests[0].url+='?'},(p:any)=>{p.requests[0].url='https://user:pass@assets.invalid/api/products/slug/a'},(p:any)=>{p.requests[0].id='wrong'},(p:any)=>{p.requests[1]=p.requests[0]},(p:any)=>{p.provenance=p.provenance.slice(0,1)}];
  for(const mutate of mutations){const plan=structuredClone(fixture.plan);mutate(plan);await writeJson(join(fixture.root,'planning/read-plan.json'),plan);await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/prefix|URL|slug|provenance/);}
  await writeJson(join(fixture.root,'planning/read-plan.json'),fixture.plan);
  await assert.rejects(collectSourceAssets(fixture.projectFile,{...fixture.options,outputDirectory:'assets/source-current'}),/visual asset output/);
  await writeFile(join(fixture.root,fixture.plan.provenance[0].path),'changed');await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/Changed evidence/);
  assert.equal(requests,0);assert.equal(session.calls.evaluations,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Public JSON mode records non-JSON, API-code and HTTP failures without claiming accepted content',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;
 try{
  globalThis.fetch=async(url:any)=>{const id=new URL(String(url)).pathname.split('/').pop();if(id==='a')return new Response('<html>not data</html>',{headers:{'content-type':'text/html'}});return new Response(JSON.stringify({code:500,data:null}),{status:id==='c'?500:200,headers:{'content-type':'application/json'}})};
  const result=await collectSourceAssets(fixture.projectFile,fixture.options);assert.equal(result.passed,false);assert.equal(result.failed,3);assert.equal(result.downloaded,0);assert.equal(result.pending,0);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.equal(manifest.completed.length,0);assert.match(manifest.failures[0].error,/HTML/);assert.match(manifest.failures[1].error,/API code 500/);assert.match(manifest.failures[2].error,/HTTP 500/);assert.equal(manifest.failures[2].httpStatus,500);assert.ok(manifest.failures[2].sha256);
  assert.equal(await readFile(join(result.directory,'c.response.json'),'utf8'),JSON.stringify({code:500,data:null}));
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Public JSON HTTP429 stops immediately with current/rest pending, even when its response is HTML',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch,ids:string[]=[];
 try{
  globalThis.fetch=async(url:any)=>{const id=new URL(String(url)).pathname.split('/').pop()!;ids.push(id);if(id==='b')return new Response('<html>rate limited</html>',{status:429,headers:{'content-type':'text/html'}});return new Response(JSON.stringify({code:200,data:{slug:id}}),{headers:{'content-type':'application/json'}})};
  const result=await collectSourceAssets(fixture.projectFile,fixture.options);assert.deepEqual(ids,['a','b']);assert.equal(result.passed,false);assert.equal(result.pending,2);assert.equal(result.downloaded,1);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.equal(manifest.stopReason,'http-429');assert.deepEqual(manifest.pending.map((r:any)=>r.id),['b','c']);assert.equal(manifest.failures[0].httpStatus,429);assert.match(manifest.failures[0].error,/without retry/);assert.equal(session.calls.browserClose,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Public JSON mode enforces its five-MiB transport cap',async()=>{
 const session=registered(),previous=globalThis.fetch;let client:any;
 try{globalThis.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(6*1024*1024)}});({client}=await publicAssetClient(session.project,['https://assets.invalid/api/products/slug/a'],{maxResponseBytes:5*1024*1024}));await assert.rejects(client.get('https://assets.invalid/api/products/slug/a'),/size budget/)}finally{globalThis.fetch=previous;await client?.dispose();session.release()}
});

async function optInQueryPlan(fixture:any,values={locale:'es-ES',warehouseCode:'CNFC'}){
 const origin=new URL(fixture.plan.sourceUrl).origin,probe=fixture.plan.requests[0];
 const observation={kind:'planning-public-source-resources-not-acceptance',sourceOrigin:origin,paths:[new URL(probe.url).pathname],rows:[{sourcePage:origin+'/es/peptide/a.html',resources:[{resourceUrl:probe.url+'?'+new URLSearchParams(values),startTime:1,duration:2}]}]};
 const evidence=await saveArtifact(fixture.root,observation);
 const plan={...fixture.plan,publicQueryParameters:values,publicQueryObservation:evidence,requests:fixture.plan.requests.map((request:any,index:number)=>({...request,url:request.url+'?'+new URLSearchParams(index%2?{warehouseCode:values.warehouseCode,locale:values.locale}:values)}))};
 await writeJson(join(fixture.root,'planning/read-plan.json'),plan);return{plan,observation};
}

test('Public JSON query opt-in accepts observed es-ES/CNFC values, any key order, and preserves query provenance',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;let requests=0;
 try{
  const {plan}=await optInQueryPlan(fixture);
  globalThis.fetch=async(url:any,options:any)=>{requests++;const parsed=new URL(String(url));assert.equal(options.method,'GET');assert.equal(parsed.searchParams.get('locale'),'es-ES');assert.equal(parsed.searchParams.get('warehouseCode'),'CNFC');return new Response(JSON.stringify({code:200,data:{slug:parsed.pathname.split('/').pop()}}),{headers:{'content-type':'application/json'}})};
  const result=await collectSourceAssets(fixture.projectFile,fixture.options);assert.equal(result.passed,true);assert.equal(result.downloaded,3);assert.equal(requests,3);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.deepEqual(manifest.publicQueryParameters,{locale:'es-ES',warehouseCode:'CNFC'});assert.deepEqual(manifest.publicQueryObservation,plan.publicQueryObservation);assert.ok(manifest.completed.every((row:any)=>row.publicQueryParameters.locale==='es-ES'&&row.formalCaptureEvidence===false));
  assert.equal(session.calls.newContext,0);assert.equal(session.calls.newPage,0);assert.equal(session.calls.browserClose,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Public JSON query opt-in accepts actual pt-BR/USFC tag values without inferring a legacy fr-FR locale',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;
 try{
  const {plan}=await optInQueryPlan(fixture,{locale:'pt-BR',warehouseCode:'USFC'});plan.requests=plan.requests.slice(0,1);await writeJson(join(fixture.root,'planning/read-plan.json'),plan);
  globalThis.fetch=async(url:any)=>{const parsed=new URL(String(url));assert.equal(parsed.searchParams.get('locale'),'pt-BR');assert.equal(parsed.searchParams.get('warehouseCode'),'USFC');return new Response(JSON.stringify({code:200,data:{slug:'a'}}),{headers:{'content-type':'application/json'}})};
  assert.equal((await collectSourceAssets(fixture.projectFile,fixture.options)).passed,true);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Public JSON defaults still reject locale queries; opt-in rejects altered values, extra/duplicate keys and changed query evidence',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;let requests=0;
 try{
  globalThis.fetch=async()=>{requests++;throw Error('Unexpected fetch')};
  const original=structuredClone(fixture.plan);original.requests[0].url+='?locale=es-ES&warehouseCode=CNFC';await writeJson(join(fixture.root,'planning/read-plan.json'),original);await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/query/);
  const {plan,observation}=await optInQueryPlan(fixture);
  const mutations=[
   (p:any)=>{p.requests[0].url=p.requests[0].url.replace('es-ES','pt-BR')},
   (p:any)=>{p.requests[0].url=p.requests[0].url.replace('CNFC','USFC')},
   (p:any)=>{p.requests[0].url+='&token=not-allowed'},
   (p:any)=>{p.requests[0].url+='&locale=es-ES'},
   (p:any)=>{p.requests[0].url=p.requests[0].url.replace('&warehouseCode=CNFC','')},
   (p:any)=>{p.requests[0].url+='#'},
   (p:any)=>{p.publicQueryParameters.locale='fr-FR'},
   (p:any)=>{p.publicQueryParameters.warehouseCode='USFC'},
   (p:any)=>{p.publicQueryParameters.token='not-allowed'},
   (p:any)=>{p.publicQueryParameters.locale='../../en'},
   (p:any)=>{p.publicQueryParameters.warehouseCode='CNFC&token=bad'},
   (p:any)=>{delete p.publicQueryObservation},
   (p:any)=>{p.provenance[0].sha256='0'.repeat(64)}
  ];
  for(const mutate of mutations){const candidate=structuredClone(plan);mutate(candidate);await writeJson(join(fixture.root,'planning/read-plan.json'),candidate);await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/query|hash|Changed evidence/);}
  const wrongKind=await saveArtifact(fixture.root,{...observation,kind:'not-a-resource-observation'});await writeJson(join(fixture.root,'planning/read-plan.json'),{...plan,publicQueryObservation:wrongKind});await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/observation identity/);
  await writeJson(join(fixture.root,'planning/read-plan.json'),plan);await writeFile(join(fixture.root,plan.publicQueryObservation.path),'tampered');await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/Changed evidence/);
  assert.equal(requests,0);assert.equal(session.calls.evaluations,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Reviewed locale query mode preserves HTTP429 stop and pending semantics',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;let requests=0;
 try{
  await optInQueryPlan(fixture,{locale:'pt-BR',warehouseCode:'CNFC'});
  globalThis.fetch=async()=>{requests++;return new Response('<html>rate limited</html>',{status:429,headers:{'content-type':'text/html'}})};
  const result=await collectSourceAssets(fixture.projectFile,fixture.options);assert.equal(result.passed,false);assert.equal(result.pending,3);assert.equal(result.downloaded,0);assert.equal(requests,1);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.equal(manifest.stopReason,'http-429');assert.equal(manifest.failures[0].publicQueryParameters.locale,'pt-BR');assert.equal(manifest.formalCaptureEvidence,false);assert.equal(session.calls.browserClose,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Certificate library accepts only its actual observed locale-only public GET',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;let requests=0;
 try{
  const origin=new URL(fixture.plan.sourceUrl).origin,url=origin+'/api/products/coa/library?locale=pt-BR';
  const observation=await saveArtifact(fixture.root,{kind:'planning-public-source-resources-not-acceptance',sourceOrigin:origin,paths:['/api/products/coa/library'],rows:[{sourcePage:origin+'/pt/coa/',resources:[{resourceUrl:url}]}]});
  const plan={...fixture.plan,allowedPathPrefix:'/api/products/coa/',requests:[{id:'library',url}],publicQueryParameters:{locale:'pt-BR'},publicQueryObservation:observation};
  await writeJson(join(fixture.root,'planning/read-plan.json'),plan);
  globalThis.fetch=async(value:any,options:any)=>{requests++;assert.equal(String(value),url);assert.equal(options.method,'GET');return new Response(JSON.stringify({code:200,data:[{catalogCode:'RT10',title:'Actual report',description:'Published content'}]}),{headers:{'content-type':'application/json'}})};
  const result=await collectSourceAssets(fixture.projectFile,fixture.options);assert.equal(result.passed,true);assert.equal(result.downloaded,1);assert.equal(requests,1);
  const manifest=JSON.parse(await readFile(join(result.directory,'manifest.json'),'utf8'));assert.deepEqual(manifest.publicQueryParameters,{locale:'pt-BR'});assert.deepEqual(manifest.publicQueryObservation,observation);assert.equal(manifest.formalCaptureEvidence,false);
  const mutations=[
   (p:any)=>{p.requests[0].url+='&shortName=RT10'},
   (p:any)=>{p.requests[0].url+='&locale=pt-BR'},
   (p:any)=>{p.requests[0].url=p.requests[0].url.replace('pt-BR','en')},
   (p:any)=>{p.publicQueryParameters.warehouseCode='CNFC'},
   (p:any)=>{p.requests[0]={id:'other',url:origin+'/api/products/coa/other?locale=pt-BR'}},
   (p:any)=>{p.allowedPathPrefix='/api/products/slug/';p.requests[0].url=origin+'/api/products/slug/library?locale=pt-BR'},
   (p:any)=>{delete p.publicQueryObservation}
  ];
  for(const mutate of mutations){const candidate=structuredClone(plan);mutate(candidate);await writeJson(join(fixture.root,'planning/read-plan.json'),candidate);await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/query|observation/);}
  assert.equal(requests,1);assert.equal(session.calls.browserClose,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});

test('Bare product locale-only reads require an explicit mode and exact observed query',async()=>{
 const session=registered(),fixture=await jsonPlanFixture(session.project),previous=globalThis.fetch;let requests=0;
 try{
  const origin=new URL(fixture.plan.sourceUrl).origin,url=origin+'/api/products/slug/a?locale=es-ES';
  const observation=await saveArtifact(fixture.root,{kind:'planning-public-source-resources-not-acceptance',sourceOrigin:origin,paths:['/api/products/slug/a'],rows:[{sourcePage:origin+'/es/peptide/a.html',resources:[{resourceUrl:url}]}]});
  const plan={...fixture.plan,publicQueryMode:'locale-only',requests:[{id:'a',url}],publicQueryParameters:{locale:'es-ES'},publicQueryObservation:observation};
  globalThis.fetch=async(value:any)=>{requests++;assert.equal(String(value),url);return new Response(JSON.stringify({code:200,data:{slug:'a',price:80}}),{headers:{'content-type':'application/json'}})};
  await writeJson(join(fixture.root,'planning/read-plan.json'),plan);
  assert.equal((await collectSourceAssets(fixture.projectFile,fixture.options)).passed,true);
  const mutations=[
   (p:any)=>{delete p.publicQueryMode},
   (p:any)=>{p.publicQueryMode='all'},
   (p:any)=>{p.requests[0].url+='&warehouseCode=CNFC'},
   (p:any)=>{p.requests[0].url+='&locale=es-ES'},
   (p:any)=>{p.publicQueryParameters.locale='pt-BR';p.requests[0].url=url.replace('es-ES','pt-BR')},
   (p:any)=>{p.allowedPathPrefix='/api/products/other/';p.requests[0].url=url.replace('/slug/','/other/')},
   (p:any)=>{delete p.publicQueryObservation}
  ];
  for(const mutate of mutations){const candidate=structuredClone(plan);mutate(candidate);await writeJson(join(fixture.root,'planning/read-plan.json'),candidate);await assert.rejects(collectSourceAssets(fixture.projectFile,fixture.options),/query|observation/);}
  assert.equal(requests,1);assert.equal(session.calls.browserClose,0);
 }finally{globalThis.fetch=previous;session.release();await rm(fixture.root,{recursive:true,force:true})}
});
