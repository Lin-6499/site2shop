import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collect} from '../src/shopyy/browser.js';
import {exportContracts} from '../src/shopyy/commands.js';
import {recordGate} from '../src/shopyy/gates.js';
import {canonical,digest,generatorIdentity,jsonFile,saveArtifact,writeJson} from '../src/shopyy/artifacts.js';
import {VISUAL_FIELDS,type Plan} from '../src/shopyy/contracts.js';

// A protocol regression using real local pages; this is not storefront acceptance.
const html=`<!doctype html><html><head><title>Baseline protocol fixture</title><link rel="canonical" href="/"><style>body{margin:20px;font-family:Arial}h1{font-size:24px;line-height:30px}button{width:120px;height:40px}</style></head><body><a href="/">Home</a><main><h1 id="heading">Fixture</h1><button id="toggle" type="button" aria-expanded="false">Details</button><p id="panel" hidden>Details open</p></main><script>document.querySelector('#toggle').onclick=()=>{const p=document.querySelector('#panel');p.hidden=!p.hidden;document.querySelector('#heading').textContent=p.hidden?'Fixture':'Expanded fixture';document.querySelector('#toggle').setAttribute('aria-expanded',String(!p.hidden))}</script></body></html>`;

async function pageServer(){
 let buildId='',closed=false,requests=0;
 const server=createServer((_req,res)=>{requests++;res.writeHead(200,{'content-type':'text/html','x-site2shop-build':buildId}).end(html);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:'http://127.0.0.1:'+(server.address() as any).port,get requests(){return requests;},setBuild:(id:string)=>{buildId=id;},close:async()=>{if(closed)return;closed=true;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

test('verified source baseline replays target actions with the source offline and rejects scope, failure and contract drift before target access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-baseline-integration-')),source=await pageServer(),target=await pageServer(),evidence=join(root,'evidence'),output=join(root,'build'),projectFile=join(root,'project.json');
 try{
  const provenance=await saveArtifact(root,{kind:'synthetic-local-source-baseline-protocol-only'}),review=await saveArtifact(root,{reviewer:'synthetic-test-only',reviewedAt:new Date().toISOString(),rationale:'Protocol fixture, not site acceptance',surfacesReviewed:true,pending:[]});
  const inventory=await saveArtifact(root,{schemaVersion:2,sourceUrl:source.origin,complete:true,coverage:{viewports:['desktop','tablet','mobile'],agentReview:review,surfaces:['desktop','tablet','mobile'].map(viewport=>({id:viewport,viewport,path:'/',state:'initial',status:'captured',evidence:provenance}))},sources:[{url:source.origin+'/sitemap.xml',kind:'sitemap',status:'absent'},{url:source.origin+'/',kind:'rendered',status:'ok',evidence:provenance}],occurrences:[{id:'home',from:'/',path:'/',text:'Home',surface:'header'}],routes:{'/':{disposition:'mapped',targetPath:'/',family:'fixture',representative:'home',rationale:'Real local open and reverse action protocol',evidence:provenance}}});
  const state=(open:boolean)=>({components:['heading'],paths:{source:'/',target:'/'},ready:{source:'#heading',target:'#heading'},assertions:{source:[{selector:'#panel',read:'visible' as const,expected:open}],target:[{selector:'#panel',read:'visible' as const,expected:open}]}});
  const plan:Plan={schemaVersion:2,revision:'baseline-local-protocol',sourceUrl:source.origin,inventory,viewports:{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:390,height:844}},limits:{timeoutMs:10000,maxActionsPerRoute:10,maxRoutes:1},environment:{locale:'en-US',timezoneId:'UTC'},routes:{home:{family:'fixture',rationale:'Explicit local open/close workflow',sourcePath:'/',targetPath:'/',components:{heading:{source:'#heading',target:'#heading',requiredFields:[...VISUAL_FIELDS,'text'],rules:[...VISUAL_FIELDS,'text'].map(field=>({field,compare:'equal'})),owner:{file:'theme/common/index.htm',marker:'id="heading"'}}},states:{initial:state(false),expanded:state(true)},transitions:{open:{from:'initial',to:'expanded',input:'',actions:{source:[{op:'click',selector:'#toggle',effect:'read-only'}],target:[{op:'click',selector:'#toggle',effect:'read-only'}]}},close:{from:'expanded',to:'initial',input:'',actions:{source:[{op:'click',selector:'#toggle',effect:'read-only'}],target:[{op:'click',selector:'#toggle',effect:'read-only'}]}}},sequence:['open','close']}}};
  await writeJson(join(root,'plan.json'),plan);
  await writeJson(projectFile,{platform:'shopyy',sourceUrl:source.origin,capturePlanFile:'plan.json',pageContractsFile:'contracts.json',outputDirectory:'build',workflow:{evidenceDirectory:'evidence',localOrigin:target.origin}});
  await assert.rejects(collect(projectFile,'source',{sourceBaseline:true}),/baseline|source/i);assert.equal(source.requests,0);
  assert.equal((await collect(projectFile,'source')).passed,true);
  await exportContracts(projectFile);
  const sourceBytes=await readFile(join(evidence,'source.json')),sourceIndex=JSON.parse(sourceBytes.toString()),contractBytes=await readFile(join(root,'contracts.json'));
  await mkdir(join(output,'theme/common'),{recursive:true});await mkdir(join(output,'preview'),{recursive:true});
  await writeFile(join(output,'theme/common/index.htm'),html);await writeFile(join(output,'preview/home.html'),html);await writeFile(join(output,'fixture.zip'),'synthetic protocol package');
  const writeBuild=async()=>{
   const integrity=[{path:'preview/home.html',sha256:digest(html)},{path:'theme/common/index.htm',sha256:digest(html)}],inputs={planSha256:digest(await readFile(join(root,'plan.json'))),projectSha256:digest(await readFile(projectFile)),generatorSha256:await generatorIdentity(),files:[{path:'contracts.json',sha256:digest(await readFile(join(root,'contracts.json')))}]},inputDigest=digest(canonical(inputs)),buildId=digest(canonical({files:integrity,inputDigest}));
   await writeJson(join(output,'theme-build.json'),{schemaVersion:2,buildId,inputs,inputDigest,prototype:false,integrity,package:{file:'fixture.zip',sha256:digest('synthetic protocol package')}});target.setBuild(buildId);return buildId;
  };
  await writeBuild();await source.close();const stoppedSourceRequests=source.requests;
  const rejectBeforeTarget=async()=>{const count=target.requests;await assert.rejects(collect(projectFile,'preflight',{sourceBaseline:true}),/baseline|source|contract|plan|scope/i);assert.equal(target.requests,count);};
  await writeJson(join(evidence,'source.json'),{...sourceIndex,scope:{kind:'source-capture-only',intentSha256:'0'.repeat(64)}});await rejectBeforeTarget();await writeFile(join(evidence,'source.json'),sourceBytes);
  const failed=structuredClone(sourceIndex);failed.sessions[0].errors.push('Preserved source failure');await writeJson(join(evidence,'source.json'),failed);await rejectBeforeTarget();await writeFile(join(evidence,'source.json'),sourceBytes);
  const changedPlan=structuredClone(plan);changedPlan.revision='different-source-plan';await writeJson(join(root,'plan.json'),changedPlan);await rejectBeforeTarget();await writeJson(join(root,'plan.json'),plan);
  const changedContract=JSON.parse(contractBytes.toString());changedContract.captures[0].sourceCapture=sourceIndex.sessions[0].checks.find((c:any)=>c.id==='state:expanded').before.source;await writeJson(join(root,'contracts.json'),changedContract);await writeBuild();await rejectBeforeTarget();await writeFile(join(root,'contracts.json'),contractBytes);await writeBuild();
  const report=await collect(projectFile,'preflight',{sourceBaseline:true});assert.equal(report.passed,true,JSON.stringify(report.findings));
  assert.equal(source.requests,stoppedSourceRequests,'Source server is closed; replay must never request it again');assert.deepEqual(await readFile(join(evidence,'source.json')),sourceBytes,'Replaying cannot rewrite source evidence');
  const paired=await jsonFile(join(evidence,'preflight.json'));assert.ok(paired.sourceBaseline);
  assert.equal(paired.sessions.length,3);
  for(const session of paired.sessions){
   const original=sourceIndex.sessions.find((s:any)=>s.route===session.route&&s.viewport===session.viewport);
   for(const check of session.checks){const before=original.checks.find((c:any)=>c.id===check.id);assert.ok(check.sourceBaseline);assert.deepEqual(check.before.source,before.before.source);if(before.after)assert.deepEqual(check.after.source,before.after.source);if(check.kind==='transition'){const oldLog=await jsonFile(join(evidence,before.actionLog.path)),newLog=await jsonFile(join(evidence,check.actionLog.path));assert.deepEqual(newLog.source,oldLog.source);assert.ok(newLog.target.every((row:any)=>row.status==='performed'));assert.ok(Date.parse(newLog.target[0].startedAt)>Date.parse(oldLog.source.at(-1).endedAt));}}
   const expanded=session.checks.find((c:any)=>c.id==='state:expanded'),cap=await jsonFile(join(evidence,expanded.before.target.path));assert.equal(cap.components.heading.text,'Expanded fixture','Target action must actually update the DOM');
  }
  const gated=await recordGate(projectFile,'preflight',false);assert.equal(gated.passed,true,JSON.stringify(gated.findings));
 }finally{await source.close();await target.close();await rm(root,{recursive:true,force:true});}
});
