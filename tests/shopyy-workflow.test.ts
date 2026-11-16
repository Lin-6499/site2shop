import {videoFixture} from './shopyy-video-fixture.js';import {unzipSync} from 'fflate';import {loadVerifiedMediaAssets,verifyMediaDelivery} from '../src/shopyy/media-comparison.js';
import {verifiedOnlineMediaReadback} from '../src/shopyy/media-comparison.js';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {canonical,digest,saveArtifact,writeJson,jsonFile,buildIdentity,generatorIdentity} from '../src/shopyy/artifacts.js';
import {COLLECTOR,VISUAL_FIELDS,type Plan} from '../src/shopyy/contracts.js';
import {validatePlan,recordGate,compareCaptures} from '../src/shopyy/gates.js';
import {collect,prepareReview,submitReview} from '../src/shopyy/browser.js';
import {packageForDraft,exportContracts} from '../src/shopyy/commands.js';
import {presentationCss} from '../src/shopyy/presentation.js';
import {renderFamilies} from '../src/shopyy/families.js';
import {shopyyAdapter} from '../src/shopyy/renderer.js';
import {serve} from '../src/preview.js';

// An explicitly synthetic storefront tests workflow semantics, not Void Research fidelity.
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Workflow fixture</title><link rel="canonical" href="/"><style>body{margin:20px;font-family:Arial}h1{font-size:24px;line-height:30px}button{width:120px;height:40px}#panel[hidden]{display:none}</style></head><body><h1 data-vr-component="heading">Fixture product</h1><button id="toggle" aria-expanded="false">Details</button><p id="panel" hidden>Details open</p><script>document.getElementById('toggle').onclick=()=>{const p=document.getElementById('panel');p.hidden=!p.hidden;document.getElementById('toggle').setAttribute('aria-expanded',String(!p.hidden))}</script></body></html>`;
async function server(){let build='',body=html,link='/',extraLinks='';const media=new Map<string,Buffer>();const s=createServer((req,res)=>{const bytes=media.get(req.url||'');if(bytes)return res.writeHead(200,{'Content-Type':'image/png'}).end(bytes);res.writeHead(200,{'Content-Type':'text/html','X-Site2Shop-Build':build}).end(body.replace('<body>','<body><a href="'+link+'">Home</a>'+extraLinks));});await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return{url:`http://127.0.0.1:${(s.address() as any).port}`,setBuild:(id:string)=>{build=id},setBody:(s:string)=>{body=s},setLink:(s:string)=>{link=s},setLinks:(s:string)=>{extraLinks=s},setMedia:(path:string,bytes:Buffer)=>{media.set(path,bytes)},close:()=>new Promise<void>(r=>s.close(()=>r()))}}
async function fixture(staged=false,mediaCount=0,stateFields=false,initialContext=false){
 const root=await mkdtemp(join(tmpdir(),'shopyy-workflow-')),source=await server(),target=await server(),output=join(root,'build'),evidence=join(root,'evidence'),mediaServer=mediaCount?await server():null;
 const provenance=await saveArtifact(root,{kind:'synthetic-independent-inventory',routes:['/']});
 const inventoryReview=await saveArtifact(root,{reviewer:'synthetic-test',reviewedAt:new Date().toISOString(),rationale:'Isolated fixture',surfacesReviewed:true,pending:[]});
 const inv={schemaVersion:2,sourceUrl:source.url,complete:true,coverage:{viewports:['desktop','tablet','mobile'],agentReview:inventoryReview,surfaces:['desktop','tablet','mobile'].map(viewport=>({id:viewport,viewport,path:'/',state:'initial',status:'captured',evidence:provenance}))},sources:[{url:source.url+'/sitemap.xml',kind:'sitemap',status:'absent'},{url:source.url,kind:'rendered',status:'ok',evidence:provenance}],occurrences:[{id:'nav1',from:'/',path:'/',text:'Home',surface:'header'}],routes:{'/':{disposition:'mapped',targetPath:'/',family:'fixture',representative:'home',rationale:'Synthetic single-family workflow regression',evidence:provenance}}};
 const inventory=await saveArtifact(root,inv);
 const state=(open:boolean)=>({components:['heading'],paths:{source:'/',target:'/'},ready:{source:'h1',target:'h1'},assertions:{source:[{selector:'#panel',read:'visible' as const,expected:open}],target:[{selector:'#panel',read:'visible' as const,expected:open}]}});
 const plan:Plan={schemaVersion:2,revision:'fixture-1',sourceUrl:source.url,inventory,viewports:{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}},limits:{timeoutMs:10000,maxActionsPerRoute:20,maxRoutes:10},environment:{locale:'en-US',timezoneId:'UTC'},routes:{home:{family:'fixture',rationale:'Synthetic initial/open/close workflow including reverse action',sourcePath:'/',targetPath:'/',components:{heading:{source:'h1',target:'h1',requiredFields:VISUAL_FIELDS,rules:VISUAL_FIELDS.map(field=>({field,compare:['x','y','width','height'].includes(field)?'number':'equal',tolerance:0,rationale:'Identical synthetic fixture renders exactly'})),owner:{file:'theme/common/index.htm',marker:'data-vr-component="heading"'}}},states:{initial:state(false),expanded:state(true)},transitions:{open:{from:'initial',to:'expanded',input:'',actions:{source:[{op:'click',selector:'#toggle',effect:'read-only'}],target:[{op:'click',selector:'#toggle',effect:'read-only'}]}},close:{from:'expanded',to:'initial',input:'',actions:{source:[{op:'click',selector:'#toggle',effect:'read-only'}],target:[{op:'click',selector:'#toggle',effect:'read-only'}]}}},sequence:['open','close']}}};
 if(staged){const targetPaths={preflight:'/local-home?view=preflight',online:'/native-home?view=online'};(inv.routes['/'] as any).targetPaths=targetPaths;plan.inventory=await saveArtifact(root,inv);for(const state of Object.values(plan.routes.home.states))state.targetPaths=targetPaths;}
 if(stateFields){const component=plan.routes.home.components.heading;component.source='#toggle';component.target='#toggle';component.owner.marker='id="toggle"';component.requiredFields=[...component.requiredFields,'focused','ariaExpanded'];component.rules.push({field:'focused',compare:'equal'},{field:'ariaExpanded',compare:'equal'});}
 if(initialContext){
  const actions=[{op:'fill',selector:'#country',value:'US',effect:'read-only'},{op:'click',selector:'#choose-us',effect:'read-only'},{op:'hover',selector:'h1',effect:'read-only'},{op:'scroll',y:0,effect:'read-only'}];plan.routes.home.initialActions={source:structuredClone(actions),target:structuredClone(actions)} as any;plan.routes.home.contextNormalization={id:'real-chat-closed-before-country',rationale:'Explicit ordinary-context branch',preservedBranch:'chat-open remains an independent actual UI branch',dismissals:[{selector:'#dismiss-chat',op:'click',waitMs:10}]};for(const side of ['source','target']as const)plan.routes.home.states.initial.assertions[side].push({selector:'#country',read:'value',expected:'United States'} as any);
  const extra="<input id=\"country\" value=\"Estados Unidos\"><button id=\"choose-us\" onclick=\"document.querySelector('#country').value='United States'\">US</button><aside id=\"chat-panel\"><button id=\"dismiss-chat\" onclick=\"this.parentElement.hidden=true\">Close chat</button></aside>";source.setBody(html.replace('</body>',extra+'</body>'));target.setBody(html.replace('</body>',extra.replace('<aside id="chat-panel">','<aside id="chat-panel" hidden>')+'</body>'));
 }
 let readbackFile:string|undefined;const mediaMap:any={},mediaEntries:any[]=[];const mediaRows:any[]=[];
 if(mediaCount){
  await mkdir(join(root,'inputs/assets/images'),{recursive:true});await mkdir(join(output,'theme/assets/fixture/images'),{recursive:true});
  for(let i=0;i<mediaCount;i++){
   const bytes=await sharp({create:{width:2,height:2,channels:4,background:{r:i*9,g:40,b:120,alpha:1}}}).png().toBuffer(),sha256=digest(bytes),sourcePath='/coa-'+i+'.png',relativePath='images/coa-'+i+'.png',preflightPath='/assets/fixture/'+relativePath,onlineUrl=mediaServer!.url+'/merchant/coa-'+i+'.png';source.setMedia(sourcePath,bytes);target.setMedia(preflightPath,bytes);mediaServer!.setMedia('/merchant/coa-'+i+'.png',bytes);
   await writeFile(join(root,'inputs/assets',relativePath),bytes);await writeFile(join(output,'theme/assets/fixture',relativePath),bytes);
   mediaMap[source.url+sourcePath]={relativePath,sha256,contentType:'image/png'};
   const uploadEvidence=await saveArtifact(root,{storeId:'240667',relativePath,sourceSha256:sha256,params:{url:onlineUrl}}),actual=await fetch(onlineUrl),raw=await saveArtifact(root,Buffer.from(await actual.arrayBuffer()),'bin'),readback=await saveArtifact(root,{url:onlineUrl,status:actual.status,contentType:actual.headers.get('content-type'),sha256,bytes:raw});mediaEntries.push({storeId:'240667',relativePath,sourceSha256:sha256,uploadEvidence,readback});
   (inv.routes as any)[sourcePath]={disposition:'mapped-media',media:{sourceUrl:source.url+sourcePath,sha256},rationale:'Actual synthetic PNG content navigation',evidence:provenance};mediaRows.push({sourcePath,preflightPath,onlineUrl});
  }
  await writeJson(join(root,'inputs/asset-map.json'),mediaMap);readbackFile='inputs/media-readback.json';await writeJson(join(root,readbackFile),{schemaVersion:1,storeId:'240667',entries:mediaEntries});plan.inventory=await saveArtifact(root,inv);source.setLinks(mediaRows.map(r=>'<a target="_blank" href="'+r.sourcePath+'">Certificate</a>').join(''));
 }
 await writeJson(join(root,'plan.json'),plan);
 const project={platform:'shopyy',...(mediaCount?{siteId:'fixture',assetsDirectory:'inputs/assets',shopyy:{assetDirectoryLayout:'tree'}}:{}),sourceUrl:source.url,capturePlanFile:'plan.json',pageContractsFile:'contracts.json',outputDirectory:'build',workflow:{evidenceDirectory:'evidence',localOrigin:target.url,...(staged||mediaCount?{onlineOrigin:target.url}:{}),...(mediaCount?{mediaAssetMapFile:'inputs/asset-map.json',mediaAssetReadbackFile:readbackFile,mediaAssetStoreId:'240667'}:{})}};
 const projectFile=join(root,'project.json');await writeJson(projectFile,project);
 await mkdir(join(output,'theme/common'),{recursive:true});await mkdir(join(output,'preview'),{recursive:true});await writeFile(join(output,'theme/common/index.htm'),html);await writeFile(join(output,'preview/home.html'),html);await writeFile(join(output,'fixture.zip'),'synthetic package');
 const integrity=[{path:'preview/home.html',sha256:digest(html)},{path:'theme/common/index.htm',sha256:digest(html)}];
 for(const row of mediaRows)integrity.push({path:'theme'+row.preflightPath,sha256:digest(await readFile(join(output,'theme'+row.preflightPath)))});
 integrity.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const mediaInputFiles=mediaCount?['inputs/asset-map.json',...(await verifiedOnlineMediaReadback(root,project)).inputFiles,...mediaRows.map(row=>'inputs/assets/images/'+row.sourcePath.slice(1))]:[];
 const inputs={planSha256:digest(await readFile(join(root,'plan.json'))),projectSha256:digest(await readFile(projectFile)),generatorSha256:await generatorIdentity(),files:await Promise.all(mediaInputFiles.sort().map(async path=>({path,sha256:digest(await readFile(join(root,path)))})))},inputDigest=digest(canonical(inputs)),buildId=digest(canonical({files:integrity,inputDigest}));
 await writeJson(join(output,'theme-build.json'),{schemaVersion:2,buildId,inputs,inputDigest,prototype:false,integrity,package:{file:'fixture.zip',sha256:digest('synthetic package')}});
 target.setBuild(buildId);
 return{root,source,target,output,evidence,plan,projectFile,mediaRows,close:async()=>{await source.close();await target.close();await mediaServer?.close();await rm(root,{recursive:true,force:true})}};
}
test('SHOPYY plan rejects omitted viewports, measurements and reverse edges',async()=>{const f=await fixture();try{assert.deepEqual(validatePlan(f.plan),[]);const p=structuredClone(f.plan);delete p.viewports.tablet;assert.match(validatePlan(p).join(';'),/tablet/);const p2=structuredClone(f.plan);p2.routes.home.sequence=['open'];assert.match(validatePlan(p2).join(';'),/transition\/reverse/);const p3=structuredClone(f.plan);p3.routes.home.components.heading.rules=p3.routes.home.components.heading.rules.filter(r=>r.field!=='width');assert.match(validatePlan(p3).join(';'),/width/)}finally{await f.close()}});

test('declared capture-only frame zero stabilizes real infinite motion on three devices and records the context',async()=>{
 const f=await fixture();try{
  const pixelProject=await jsonFile(f.projectFile);pixelProject.workflow.viewportPixelStability={maxRgbDelta:1,maxChangedPixelRatio:0.0005};await writeJson(f.projectFile,pixelProject);
  f.plan.environment.infiniteAnimations='frame-zero';
  f.plan.environment.rasterizeInfiniteFrameZero=true;
  await writeJson(join(f.root,'plan.json'),f.plan);
  f.source.setBody(html.replace('</style>','@keyframes drift{from{transform:translateX(0)}to{transform:translateX(200px)}}h1{animation:drift 2s linear infinite}</style>'));
  const report=await collect(f.projectFile,'source');assert.equal(report.passed,true,JSON.stringify(report.findings));
  const index=await jsonFile(join(f.evidence,'source.json'));
  for(const session of index.sessions){
   const cap=await jsonFile(join(f.evidence,session.checks[0].before.source.path));
   assert.ok(cap.captureEnvironment.viewportPixelStability);
   assert.equal(cap.captureEnvironment.viewportPixelStability.frames[1].sha256,cap.screenshot.sha256);
   assert.equal(cap.components.heading.x,20);
   assert.equal(cap.captureEnvironment.infiniteAnimations,'frame-zero');
   assert.equal(cap.captureEnvironment.frameZeroRasterized,true);
   assert.deepEqual(cap.captureEnvironment.animations,[{name:'drift',duration:2000,playState:'paused',currentTime:0}]);
  }
  const cap=await jsonFile(join(f.evidence,index.sessions[0].checks[0].before.source.path));
  const originalCapture=index.sessions[0].checks[0].before.source;const noProof=structuredClone(cap);delete noProof.captureEnvironment.viewportPixelStability;index.sessions[0].checks[0].before.source=await saveArtifact(f.evidence,noProof);await writeJson(join(f.evidence,'source.json'),index);const pixelRejected=await recordGate(f.projectFile,'source');assert.ok(pixelRejected.findings.some((f:any)=>f.message?.includes('viewport pixel stability')||f.detail?.includes('viewport pixel stability')),JSON.stringify(pixelRejected.findings));index.sessions[0].checks[0].before.source=originalCapture;
  delete cap.captureEnvironment.frameZeroRasterized;
  index.sessions[0].checks[0].before.source=await saveArtifact(f.evidence,cap);
  await writeJson(join(f.evidence,'source.json'),index);
  assert.equal((await recordGate(f.projectFile,'source')).passed,false,'Reject an undeclared or missing pixel projection context');
  const project=await jsonFile(f.projectFile);
  project.workflow.sourceSession={enabled:true,sessionStorageKey:'sb-fixture-auth-token'};
  await writeJson(f.projectFile,project);
  const stale=await recordGate(f.projectFile,'plan');
  assert.ok(stale.findings.some(f=>f.id==='inventory:session'),'Previously unverified reconnaissance cannot satisfy a new authenticated source policy');
  project.workflow.sourceReadQueries=[{id:'new-display-query',method:'POST',origin:new URL(project.sourceUrl).origin,path:'/_serverFn/'+'a'.repeat(64),payloadSha256:'b'.repeat(64),sourcePaths:['/'],rationale:'New isolated display query policy',reviewedSourceModule:{sha256:'c'.repeat(64)}}];
  await writeJson(f.projectFile,project);
  const staleQuery=await recordGate(f.projectFile,'plan');
  assert.ok(staleQuery.findings.some(f=>f.id.startsWith('inventory:read-query:')),'Affected old source captures cannot satisfy a newly admitted display-query policy');
 }finally{await f.close()}
});
test('SHOPYY real browser workflow records three devices and before/action/after; gates reject missing, stale and invented success',async()=>{
 const f=await fixture();try{
  assert.equal((await collect(f.projectFile,'source')).passed,true);
  const result=await collect(f.projectFile,'preflight');assert.equal(result.passed,true,JSON.stringify(result.findings));
  const unreviewed=await recordGate(f.projectFile,'preflight');assert.equal(unreviewed.passed,false);assert.ok(unreviewed.findings.some(x=>x.id==='review:missing'));
  const pending=await prepareReview(f.projectFile,'preflight'),review=await jsonFile(pending);
  assert.ok(review.checks.every((c:any)=>c.verdict==='pending'));
  review.reviewer='synthetic-test-fixture-only';review.reviewedAt=new Date().toISOString();
  for(const row of review.checks){row.verdict='pass';row.rationale='Synthetic identical pages exercise validator; not real-site acceptance';for(const c of row.components){c.verdict='pass';c.rationale='Synthetic fixture'}}
  await writeJson(pending,review);assert.equal((await submitReview(f.projectFile,'preflight',pending)).passed,true);
  const handed=await packageForDraft(f.projectFile,join(f.root,'handoff'));assert.equal(handed.uploadPerformed,false);
  const baseline=await jsonFile(join(f.evidence,'preflight.json'));
  for(const mutation of ['viewport','transition','review','build','image','controls','href','postcondition','served-build','soft404','direct-navigation']){
   const e=structuredClone(baseline);
   if(mutation==='viewport')e.sessions=e.sessions.filter((s:any)=>s.viewport!=='tablet');
   if(mutation==='transition')e.sessions[0].checks=e.sessions[0].checks.filter((c:any)=>c.id!=='transition:close');
   if(mutation==='review')delete e.review;
   if(mutation==='build')e.buildId='0'.repeat(64);
   if(mutation==='image')e.sessions[0].checks[0].before.target={path:'artifacts/no-image.json',sha256:'0'.repeat(64)};
   if(mutation==='controls'){const ref=e.sessions[0].checks[0].before.target,cap=JSON.parse((await readFile(join(f.evidence,ref.path))).toString());cap.controls.push({tag:'button',role:null,name:'Unexpected',type:'button'});e.sessions[0].checks[0].before.target=await saveArtifact(f.evidence,cap)}
   if(['href','postcondition','served-build','soft404'].includes(mutation)){const ref=e.sessions[0].checks[0].before.target,cap=await jsonFile(join(f.evidence,ref.path));if(mutation==='href')cap.controls[0].href='#broken';if(mutation==='postcondition')cap.assertions[0]={actual:true,expected:true,passed:true};if(mutation==='served-build')cap.servedBuildId='old';if(mutation==='soft404')cap.status=404;e.sessions[0].checks[0].before.target=await saveArtifact(f.evidence,cap)}
   if(mutation==='direct-navigation'){const n=await jsonFile(join(f.evidence,e.navigation[0].evidence.path));n.kind='direct-get';e.navigation[0].evidence=await saveArtifact(f.evidence,n)}
   await writeJson(join(f.evidence,'preflight.json'),e);assert.equal((await recordGate(f.projectFile,'preflight')).passed,false,mutation);await assert.rejects(packageForDraft(f.projectFile,join(f.root,'should-not-exist')),/blocked/);
  }
  await writeJson(join(f.evidence,'preflight.json'),baseline);
  f.target.setBuild('old-server');assert.equal((await collect(f.projectFile,'preflight')).passed,false,'Reject unrelated running server');
  await writeFile(join(f.output,'preview/home.html'),html+'tampered');await assert.rejects(buildIdentity(f.output),/Generated-only/);
 }finally{await f.close()}
});

test('SHOPYY source contracts drive shared multi-family generation and actual preview acceptance',async()=>{
 const f=await fixture();let actual:Awaited<ReturnType<typeof serve>>|undefined;
 try{
  assert.equal((await collect(f.projectFile,'source')).passed,true);
  const contractFile=await exportContracts(f.projectFile),contract=await jsonFile(contractFile);
  await assert.rejects(presentationCss(contract,f.plan,f.evidence),/binding required/);
  for(const row of contract.captures)contract.bindings.push({route:row.route,viewport:row.viewport,state:row.state,component:'heading',sourceCapture:row.sourceCapture,selector:'h1',range:{min:f.plan.viewports[row.viewport].width,max:f.plan.viewports[row.viewport].width},styles:{fontSize:{field:'fontSize',observed:row.components.heading.fontSize,transform:'identity'}}});
  assert.match(await presentationCss(contract,f.plan,f.evidence),/font-size:24px/);
  const bad=structuredClone(contract);bad.bindings[0].styles.fontSize.observed='99px';await assert.rejects(presentationCss(bad,f.plan,f.evidence),/Invented/);
  const stale=structuredClone(contract);stale.bindings[0].sourceCapture=contract.bindings[1].sourceCapture;await assert.rejects(presentationCss(stale,f.plan,f.evidence),/Stale/);
  await writeJson(contractFile,contract);
  await mkdir(join(f.root,'assets'));await writeFile(join(f.root,'assets','sentinel.txt'),'asset input');
  await writeFile(join(f.root,'style.css'),'/* fixture */');await writeJson(join(f.root,'content.json'),{source:f.source.url});await writeJson(join(f.root,'design.json'),{source:f.source.url});
  const template=html.replace('<body>','<body><a href="{{route:/}}">Home</a>').replace('</head>','<link rel="stylesheet" href="{{asset:styles/page-contracts.css}}"></head>');
  await writeFile(join(f.root,'home.htm'),template);
  const familyConfig={schemaVersion:2,families:{fixture:{templateFile:'home.htm',nativeFile:'common/index.htm'}},pages:[{sourcePath:'/',targetPath:'/',family:'fixture',data:{}}]};await writeJson(join(f.root,'families.json'),familyConfig);
  const project={...await jsonFile(f.projectFile),siteId:'fixture',contentFile:'content.json',designContractFile:'design.json',commonStyleFile:'style.css',assetsDirectory:'assets',familiesFile:'families.json',shopyy:{templateProfile:'unverified-test',variableMap:{},routeMap:{'/':'/'},assetRootExpression:"<{$asset_root}>"}};await writeJson(f.projectFile,project);
  const missing=structuredClone(familyConfig);missing.pages=[];await writeJson(join(f.root,'families.json'),missing);await assert.rejects(renderFamilies(f.root,project,f.plan),/lacks implemented/);await writeJson(join(f.root,'families.json'),familyConfig);
  const build=await shopyyAdapter.build({projectFile:f.projectFile});
  await f.target.close();actual=await serve(build.outputDirectory,Number(new URL(f.target.url).port));
  assert.equal((await collect(f.projectFile,'preflight')).passed,true);
  assert.equal((await recordGate(f.projectFile,'preflight')).passed,false,'Agent review remains mandatory even for generated fixture');
  const response=await fetch(actual.url);assert.equal(response.headers.get('x-site2shop-build'),build.buildId);
  await writeFile(join(f.root,'assets','sentinel.txt'),'changed input');
  assert.ok((await recordGate(f.projectFile,'preflight')).findings.some(x=>x.id==='build:integrity'));
 }finally{if(actual)await new Promise<void>(r=>actual!.server.close(()=>r()));await f.close()}
});


test('clicked mapped navigation and offline evidence use the explicit stage path, rejecting base or other-stage paths',async()=>{
 const f=await fixture(true);try{
  const build=await buildIdentity(f.output),readback=await saveArtifact(f.evidence,{kind:'synthetic-draft-readback'});
  await writeJson(join(f.evidence,'deployment.json'),{buildId:build.id,role:'draft',skinId:'synthetic',store:'synthetic',origin:f.target.url,readback});
  await writeJson(join(f.evidence,'online-capabilities.json'),Object.fromEntries(['template-rendering','asset-hosting','product-fields','sku-options','cart-payload','route-bindings'].map(id=>[id,{status:'verified',buildId:build.id,skinId:'synthetic',evidence:readback}])));
  for(const stage of ['preflight','online'] as const){
   const expected=f.plan.routes.home.states.initial.targetPaths![stage]!;
   f.target.setLink(expected);f.target.setBody(html.replace('rel="canonical" href="/"','rel="canonical" href="'+expected+'"'));
   const result=await collect(f.projectFile,stage);assert.equal(result.passed,true,JSON.stringify(result.findings));
   const baseline=await jsonFile(join(f.evidence,stage+'.json'));
   assert.equal(baseline.navigation.length,3);
   for(const row of baseline.navigation){assert.equal(row.passed,true);assert.equal(row.finalPath,expected);const raw=await jsonFile(join(f.evidence,row.evidence.path));assert.equal(raw.kind,'clicked-link');assert.equal(raw.finalPath,expected);}
   assert.equal((await recordGate(f.projectFile,stage,false)).passed,true);
   for(const wrong of ['/',f.plan.routes.home.states.initial.targetPaths![stage==='online'?'preflight':'online']!]){
    const evidence=structuredClone(baseline),raw=await jsonFile(join(f.evidence,evidence.navigation[0].evidence.path));raw.finalPath=wrong;evidence.navigation[0].evidence=await saveArtifact(f.evidence,raw);await writeJson(join(f.evidence,stage+'.json'),evidence);
    assert.ok((await recordGate(f.projectFile,stage,false)).findings.some(row=>row.id.startsWith('navigation:')),'Raw navigation must reject '+wrong);
   }
   const evidence=structuredClone(baseline),raw=await jsonFile(join(f.evidence,evidence.navigation[0].evidence.path)),from=await jsonFile(join(f.evidence,raw.fromCapture.path));from.controls.find((c:any)=>c.selector===raw.selector).href='/';raw.fromCapture=await saveArtifact(f.evidence,from);evidence.navigation[0].evidence=await saveArtifact(f.evidence,raw);await writeJson(join(f.evidence,stage+'.json'),evidence);
   assert.ok((await recordGate(f.projectFile,stage,false)).findings.some(row=>row.id.startsWith('navigation:')),'Observed occurrence must retain the exact stage href');
   await writeJson(join(f.evidence,stage+'.json'),baseline);
  }
 }finally{await f.close()}
});


test('24 mapped PNG resources use actual blank-target clicks, cross-origin online readback and strict offline byte evidence',async()=>{
 const f=await fixture(false,24);try{
  const build=await buildIdentity(f.output),readback=await saveArtifact(f.evidence,{kind:'synthetic-draft-readback'});await writeJson(join(f.evidence,'deployment.json'),{buildId:build.id,role:'draft',skinId:'synthetic',store:'240667',origin:f.target.url,readback});await writeJson(join(f.evidence,'online-capabilities.json'),Object.fromEntries(['template-rendering','asset-hosting','product-fields','sku-options','cart-payload','route-bindings'].map(id=>[id,{status:'verified',buildId:build.id,skinId:'synthetic',evidence:readback}])));
  for(const stage of ['preflight','online'] as const){
   f.target.setLinks(f.mediaRows.map(row=>'<a target="_blank" href="'+(stage==='preflight'?row.preflightPath:row.onlineUrl)+'">Certificate</a>').join(''));
   const result=await collect(f.projectFile,stage);assert.equal(result.passed,true,JSON.stringify(result.findings));const baseline=await jsonFile(join(f.evidence,stage+'.json')),media=baseline.navigation.filter((row:any)=>row.kind==='clicked-media');assert.equal(media.length,72);assert.ok(media.every((row:any)=>row.passed&&row.status===200));assert.equal((await recordGate(f.projectFile,stage,false)).passed,true);
   for(const change of ['bytes','kind','href','resource-url']){const evidence=structuredClone(baseline),index=evidence.navigation.findIndex((row:any)=>row.kind==='clicked-media'),row=await jsonFile(join(f.evidence,evidence.navigation[index].evidence.path));if(change==='bytes')row.bytes=await saveArtifact(f.evidence,Buffer.from('wrong resource bytes'),'bin');if(change==='kind')row.kind='clicked-link';if(change==='href')row.observedHref='/wrong.png';if(change==='resource-url')row.resourceUrl=f.source.url+f.mediaRows[0].sourcePath;evidence.navigation[index].evidence=await saveArtifact(f.evidence,row);await writeJson(join(f.evidence,stage+'.json'),evidence);assert.ok((await recordGate(f.projectFile,stage,false)).findings.some(row=>row.id.startsWith('navigation:')),change);}
   await writeJson(join(f.evidence,stage+'.json'),baseline);
  }
  const deployment=await jsonFile(join(f.evidence,'deployment.json'));deployment.store='240668';await writeJson(join(f.evidence,'deployment.json'),deployment);await assert.rejects(collect(f.projectFile,'online'),/identified draft/);assert.ok((await recordGate(f.projectFile,'online',false)).findings.some(row=>row.id==='online:capabilities'));
 }finally{await f.close()}
});


test('full reviewed preflight unlocks merchant upload while native delivery stays blocked until actual byte readback and rebuild',async()=>{
 // Isolated source UI and generated MP4 resources exercise build order, never LP acceptance.
 const f=await fixture();let actual:Awaited<ReturnType<typeof serve>>|undefined;const mediaFiles=new Map<string,Buffer>(),cdn=createServer((req,res)=>{const bytes=mediaFiles.get(req.url||'');if(!bytes)return res.writeHead(404).end();res.writeHead(200,{'content-type':'video/mp4'}).end(bytes);});await new Promise<void>(r=>cdn.listen(0,'127.0.0.1',r));const cdnUrl='http://127.0.0.1:'+(cdn.address()as any).port;
 try{
  await mkdir(join(f.root,'assets/videos'),{recursive:true});const map:any={},merchant:string[]=[];
  for(let i=0;i<4;i++){const free=Buffer.alloc(2*1024*1024+16,i);free.writeUInt32BE(free.length,0);free.write('free',4);const bytes=Buffer.concat([videoFixture,free]),relativePath='videos/v'+i+'.mp4';await writeFile(join(f.root,'assets',relativePath),bytes);map[f.source.url+'/v'+i+'.mp4']={relativePath,sha256:digest(bytes),contentType:'video/mp4'};merchant.push(relativePath);mediaFiles.set('/v'+i+'.mp4',bytes);assert.ok(bytes.length>2*1024*1024);}
  await writeFile(join(f.root,'assets/keep.txt'),'normal skin asset');await writeJson(join(f.root,'asset-map.json'),map);await writeFile(join(f.root,'style.css'),'/* isolated shared fixture */');await writeJson(join(f.root,'content.json'),{source:f.source.url});await writeJson(join(f.root,'design.json'),{source:f.source.url});
  f.plan.routes.home.components.heading.owner.file='theme/templates/index.liquid';await writeJson(join(f.root,'plan.json'),f.plan);
  const template=html.replace('<body>','<body><a href="{{route:/}}">Home</a>').replace('</head>','<link rel="stylesheet" href="{{asset:styles/page-contracts.css}}">'+merchant.map(path=>'{{#native}}<meta data-fixture-media content="{{asset:'+path+'}}">{{/native}}').join('')+'</head>');await writeFile(join(f.root,'home.htm'),template);await writeJson(join(f.root,'families.json'),{schemaVersion:2,partials:{},families:{fixture:{templateFile:'home.htm',nativeFile:'templates/index.liquid'}},pages:[{sourcePath:'/',targetPath:'/',family:'fixture'}]});
  const project:any={...await jsonFile(f.projectFile),siteId:'fixture',contentFile:'content.json',designContractFile:'design.json',commonStyleFile:'style.css',assetsDirectory:'assets',familiesFile:'families.json',shopyy:{templateProfile:'liquid-default-v1',assetDirectoryLayout:'tree',variableMap:{},routeMap:{},assetRootExpression:''}};Object.assign(project.workflow,{mediaAssetMapFile:'asset-map.json',mediaAssetKinds:['image','video'],merchantMediaFiles:merchant,mediaAssetStoreId:'240667',onlineOrigin:f.target.url});await writeJson(f.projectFile,project);
  assert.equal((await collect(f.projectFile,'source')).passed,true);const contractFile=await exportContracts(f.projectFile),contract=await jsonFile(contractFile);for(const row of contract.captures)contract.bindings.push({route:row.route,viewport:row.viewport,state:row.state,component:'heading',sourceCapture:row.sourceCapture,selector:'h1',range:{min:f.plan.viewports[row.viewport].width,max:f.plan.viewports[row.viewport].width},styles:{fontSize:{field:'fontSize',observed:row.components.heading.fontSize,transform:'identity'}}});await writeJson(contractFile,contract);
  const first=await shopyyAdapter.build({projectFile:f.projectFile}),initial=await jsonFile(first.manifestFile);assert.equal(initial.prototype,false);assert.equal(initial.mediaDelivery.pendingNativeBindings.length,4);await assert.rejects(verifyMediaDelivery(f.root,project,{...initial,mediaDelivery:{...initial.mediaDelivery,pendingNativeBindings:[]}}),/missing or changed/);
  const archive=unzipSync(await readFile(first.packageFile));for(const relative of merchant){assert.equal(archive['assets/fixture/'+relative],undefined);assert.equal(first.files.includes('assets/fixture/'+relative),false);assert.equal(digest(await readFile(join(first.outputDirectory,'preview/assets/fixture',relative))),map[f.source.url+'/'+relative.split('/')[1]].sha256);}assert.ok(archive['assets/fixture/keep.txt']);assert.match(await readFile(join(first.outputDirectory,'theme/templates/index.liquid'),'utf8'),/settings.lp_media_/);assert.doesNotMatch(await readFile(join(first.outputDirectory,'theme/templates/index.liquid'),'utf8'),new RegExp(cdnUrl));
  await f.target.close();actual=await serve(first.outputDirectory,Number(new URL(f.target.url).port));const verified=await loadVerifiedMediaAssets(f.root,project,'preflight');assert.equal(verified.source.size,4);for(const relative of merchant){const response:Response=await fetch(actual.url+'/assets/fixture/'+relative);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(digest(Buffer.from(await response.arrayBuffer())),map[f.source.url+'/'+relative.split('/')[1]].sha256);}
  const review=async()=>{const file=await prepareReview(f.projectFile,'preflight'),r=await jsonFile(file);r.reviewer='synthetic-merchant-order-regression';r.reviewedAt=new Date().toISOString();for(const row of r.checks){row.verdict='pass';row.rationale='Isolated identical fixture, not LP visual acceptance';for(const component of row.components){component.verdict='pass';component.rationale='Isolated fixture';}}await writeJson(file,r);assert.equal((await submitReview(f.projectFile,'preflight',file)).passed,true);};
  assert.equal((await collect(f.projectFile,'preflight')).passed,true);await review();assert.equal((await recordGate(f.projectFile,'preflight')).passed,true);await assert.rejects(packageForDraft(f.projectFile,join(f.root,'pending-handoff')),/pending actual upload/);
  const deployment={buildId:first.buildId,role:'draft',skinId:'synthetic',store:'240667',origin:f.target.url,readback:await saveArtifact(f.evidence,{kind:'synthetic-draft'})};await writeJson(join(f.evidence,'deployment.json'),deployment);await assert.rejects(collect(f.projectFile,'online'),/pending actual upload/);
  const badOnline=await jsonFile(join(f.evidence,'preflight.json'));badOnline.stage='online';await writeJson(join(f.evidence,'online.json'),badOnline);assert.ok((await recordGate(f.projectFile,'online',false)).findings.some(row=>row.message.includes('pending actual upload')));
  const entries=[];for(const relativePath of merchant){const sourceSha256=map[f.source.url+'/'+relativePath.split('/')[1]].sha256,url=cdnUrl+'/'+relativePath.split('/')[1],response=await fetch(url),bytes=await saveArtifact(f.root,Buffer.from(await response.arrayBuffer()),'bin'),uploadEvidence=await saveArtifact(f.root,{storeId:'240667',relativePath,sourceSha256,params:{url}}),readback=await saveArtifact(f.root,{url,status:response.status,contentType:response.headers.get('content-type'),sha256:sourceSha256,bytes});entries.push({storeId:'240667',relativePath,sourceSha256,uploadEvidence,readback});}await writeJson(join(f.root,'readback.json'),{schemaVersion:1,storeId:'240667',entries});project.workflow.mediaAssetReadbackFile='readback.json';await writeJson(f.projectFile,project);
  const rebuilt=await shopyyAdapter.build({projectFile:f.projectFile});assert.notEqual(rebuilt.buildId,first.buildId);const current=await jsonFile(rebuilt.manifestFile);assert.deepEqual(current.mediaDelivery.pendingNativeBindings,[]);await verifyMediaDelivery(f.root,project,current,true);const skin=await readFile(join(rebuilt.outputDirectory,'theme/templates/index.liquid'),'utf8');assert.doesNotMatch(skin,/settings.lp_media_/);for(let i=0;i<4;i++)assert.ok(skin.includes(cdnUrl+'/v'+i+'.mp4'));for(const relative of merchant)assert.equal(unzipSync(await readFile(rebuilt.packageFile))['assets/fixture/'+relative],undefined);
  assert.equal((await collect(f.projectFile,'preflight')).passed,true);await review();assert.equal((await packageForDraft(f.projectFile,join(f.root,'verified-handoff'))).uploadPerformed,false);
 }finally{if(actual)await new Promise<void>(r=>actual!.server.close(()=>r()));await new Promise<void>(r=>cdn.close(()=>r()));await f.close();}
});


test('declared bilateral focus and expanded fields are actually observed and offline gates reject wrong, absent or old measurements',async()=>{
 const f=await fixture(false,0,true);try{
  const result=await collect(f.projectFile,'preflight');assert.equal(result.passed,true,JSON.stringify(result.findings));const baseline=await jsonFile(join(f.evidence,'preflight.json'));
  for(const session of baseline.sessions){const initial=session.checks.find((c:any)=>c.id==='state:initial'),expanded=session.checks.find((c:any)=>c.id==='state:expanded');for(const side of ['source','target']){const before=await jsonFile(join(f.evidence,initial.before[side].path)),after=await jsonFile(join(f.evidence,expanded.before[side].path));assert.equal(before.components.heading.focused,false);assert.equal(before.components.heading.ariaExpanded,'false');assert.equal(after.components.heading.focused,true);assert.equal(after.components.heading.ariaExpanded,'true');assert.deepEqual(after.captureEnvironment.declaredStateFields.fieldsByComponent,{heading:['ariaExpanded','focused']});}}
  const expanded=baseline.sessions[0].checks.find((c:any)=>c.id==='state:expanded'),source=await jsonFile(join(f.evidence,expanded.before.source.path)),target=await jsonFile(join(f.evidence,expanded.before.target.path));source.components.heading.focused=undefined;target.components.heading.focused=undefined;assert.match(compareCaptures(f.plan,'home','expanded',source,target).join(';'),/focused: missing measurement/);
  for(const mutation of ['focus','expanded','missing-both','missing-policy','policy-hash']){const evidence=structuredClone(baseline),check=evidence.sessions[0].checks.find((c:any)=>c.id==='state:expanded');for(const side of mutation==='missing-both'||mutation==='missing-policy'?['source','target']:['target']){const cap=await jsonFile(join(f.evidence,check.before[side].path));if(mutation==='focus')cap.components.heading.focused=false;if(mutation==='expanded')cap.components.heading.ariaExpanded='false';if(mutation==='missing-both')delete cap.components.heading.focused;if(mutation==='missing-policy')delete cap.captureEnvironment.declaredStateFields;if(mutation==='policy-hash')cap.captureEnvironment.declaredStateFields.policySha256='0'.repeat(64);check.before[side]=await saveArtifact(f.evidence,cap);}await writeJson(join(f.evidence,'preflight.json'),evidence);const report=await recordGate(f.projectFile,'preflight',false);assert.equal(report.passed,false,mutation);assert.ok(report.findings.some(row=>/focused|ariaExpanded|state field observation policy/.test(row.message)),JSON.stringify(report.findings));}
 }finally{await f.close()}
});


test('explicit initial context uses real visible chat dismissal then country UI reset before captures and clicked navigation',async()=>{
 const f=await fixture(false,0,false,true);try{assert.deepEqual(validatePlan(f.plan),[]);const invalid=structuredClone(f.plan);invalid.routes.home.initialActions!.source=[];assert.ok(validatePlan(invalid).some(x=>/Initial actions/.test(x)));const result=await collect(f.projectFile,'preflight');assert.equal(result.passed,true,JSON.stringify(result.findings));const baseline=await jsonFile(join(f.evidence,'preflight.json'));
  for(const session of baseline.sessions){const log=await jsonFile(join(f.evidence,session.initialContextLog.path));assert.equal(log.source.normalization[0].status,'performed');assert.equal(log.source.normalization[0].matchedCount,1);assert.equal(log.target.normalization[0].status,'not-shown');assert.equal(log.target.normalization[0].matchedCount,1);for(const side of ['source','target']){assert.equal(log[side].actions.length,4);assert.ok(log[side].actions.every((a:any)=>a.status==='performed'));const cap=await jsonFile(join(f.evidence,session.checks[0].before[side].path));assert.equal(cap.captureEnvironment.initialContextPolicySha256,log.policySha256);assert.equal(cap.assertions.at(-1).actual,'United States');}}
  for(const mutation of ['missing-log','wrong-action','skip-count','chronology','missing-policy','nav-log']){const evidence=structuredClone(baseline),session=evidence.sessions[0];if(mutation==='missing-log')delete session.initialContextLog;else if(mutation==='missing-policy'){const ref=session.checks[0].before.source,cap=await jsonFile(join(f.evidence,ref.path));delete cap.captureEnvironment.initialContextPolicySha256;session.checks[0].before.source=await saveArtifact(f.evidence,cap);}else if(mutation==='nav-log'){const nav=await jsonFile(join(f.evidence,evidence.navigation[0].evidence.path));delete nav.initialContextLog;evidence.navigation[0].evidence=await saveArtifact(f.evidence,nav);}else{const log=await jsonFile(join(f.evidence,session.initialContextLog.path));if(mutation==='wrong-action')log.source.actions[0].action.value='GB';if(mutation==='skip-count')log.target.normalization[0].matchedCount=2;if(mutation==='chronology')log.source.actions.at(-1).endedAt='2999-01-01T00:00:00Z';session.initialContextLog=await saveArtifact(f.evidence,log);}await writeJson(join(f.evidence,'preflight.json'),evidence);assert.equal((await recordGate(f.projectFile,'preflight',false)).passed,false,mutation);}
 }finally{await f.close()}
});


test('clicked mapped destinations consume independent data assertions in collector and offline gate, including wrong live price',async()=>{
 const f=await fixture();try{
  const raw=await saveArtifact(f.root,{data:{name:'Fixture product',price:96}}),inventory=JSON.parse((await readFile(join(f.root,f.plan.inventory.path))).toString());inventory.routes['/'].dataAssertions=[{field:'title',source:{ref:raw,pointer:'/data/name'},format:'text',target:{selector:'h1',read:'own-text'}},{field:'price',source:{ref:raw,pointer:'/data/price'},format:'usd',target:{selector:'#actual-price',read:'text'}}];f.plan.inventory=await saveArtifact(f.root,inventory);await writeJson(join(f.root,'plan.json'),f.plan);const manifest=await jsonFile(join(f.output,'theme-build.json'));manifest.inputs.planSha256=digest(await readFile(join(f.root,'plan.json')));manifest.inputDigest=digest(canonical(manifest.inputs));manifest.buildId=digest(canonical({files:manifest.integrity,inputDigest:manifest.inputDigest}));await writeJson(join(f.output,'theme-build.json'),manifest);f.target.setBuild(manifest.buildId);
  f.source.setBody(html.replace('</body>','<strong id="actual-price">$96.00</strong></body>'));f.target.setBody(html.replace('</body>','<strong id="actual-price">$96.00</strong></body>'));assert.equal((await collect(f.projectFile,'preflight')).passed,true);const baseline=await jsonFile(join(f.evidence,'preflight.json'));assert.ok(baseline.navigation.every((n:any)=>n.dataAssertions.passed&&n.dataAssertions.rows.length===2));assert.equal((await recordGate(f.projectFile,'preflight',false)).passed,true);
  for(const change of ['proof','actual']){const evidence=structuredClone(baseline),nav=await jsonFile(join(f.evidence,evidence.navigation[0].evidence.path));if(change==='proof')delete nav.dataAssertions;else nav.dataAssertions.rows[1].actual='$95.00';evidence.navigation[0].evidence=await saveArtifact(f.evidence,nav);await writeJson(join(f.evidence,'preflight.json'),evidence);assert.ok((await recordGate(f.projectFile,'preflight',false)).findings.some(row=>row.id.startsWith('navigation:')));}
  f.target.setBody(html.replace('</body>','<strong id="actual-price">$95.00</strong></body>'));const wrong=await collect(f.projectFile,'preflight');assert.equal(wrong.passed,false);const failed=await jsonFile(join(f.evidence,'preflight.json'));assert.ok(failed.navigation.every((n:any)=>n.dataAssertions.rows.find((r:any)=>r.field==='price').actual==='$95.00'&&!n.passed));
 }finally{await f.close()}
});
