import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:http';
import{collectSourceScope,collect}from'../src/shopyy/browser.js';import{prepareSourceScope,sourceScopeIntent}from'../src/shopyy/source-scope.js';import{gate}from'../src/shopyy/gates.js';import{exportContracts}from'../src/shopyy/commands.js';import{VISUAL_FIELDS,type Plan}from'../src/shopyy/contracts.js';import{canonical,digest,saveArtifact,writeJson,jsonFile}from'../src/shopyy/artifacts.js';
import { verifyScopedSource, exportScopedContracts } from '../src/shopyy/scoped-contracts.js';
import { mkdir, symlink, unlink, realpath } from 'node:fs/promises';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'shopyy-source-scope-')),server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><title>Safe source fixture</title><link rel="canonical" href="${new URL(req.url!,'http://source').pathname}"><h1>Scoped read-only source</h1><button id="toggle">Details</button><p id="panel" hidden>Observed detail</p><script>document.querySelector('#toggle').onclick=()=>document.querySelector('#panel').hidden=!document.querySelector('#panel').hidden</script>`));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address()as any).port,provenance=await saveArtifact(root,{kind:'isolated-synthetic-surface'}),review=await saveArtifact(root,{reviewer:'independent-fixture',reviewedAt:new Date().toISOString(),rationale:'Synthetic source-scoped collector regression',surfacesReviewed:true,pending:[]});
 const routes:any={},mapped:any={};for(const letter of ['a','b','c','d']){const id='core-'+letter,path='/core/'+letter;const state=(open:boolean)=>({components:['heading'],paths:{source:path,target:'/pages/'+letter},ready:{source:'h1',target:'h1'},assertions:{source:[{selector:'#panel',read:'visible',expected:open}],target:[{selector:'#panel',read:'visible',expected:open}]}});routes[id]={family:'core',sourcePath:path,targetPath:'/pages/'+letter,rationale:'Explicit bounded source family',components:{heading:{source:'h1',target:'h1',requiredFields:VISUAL_FIELDS,rules:VISUAL_FIELDS.map(field=>({field,compare:['x','y','width','height'].includes(field)?'number':'equal',tolerance:0,rationale:'Same isolated fixture'})),owner:{file:'theme/core.htm',marker:'Scoped read-only source'}}},states:{initial:state(false),expanded:state(true)},transitions:{open:{from:'initial',to:'expanded',input:'',actions:{source:[{op:'click',selector:'#toggle',effect:'read-only'}],target:[{op:'click',selector:'#toggle',effect:'local-fixture'}]}},close:{from:'expanded',to:'initial',input:'',actions:{source:[{op:'click',selector:'#toggle',effect:'read-only'}],target:[{op:'click',selector:'#toggle',effect:'local-fixture'}]}}},sequence:['open','close']};mapped[path]={disposition:'mapped',targetPath:'/pages/'+letter,family:'core',representative:id,rationale:'Reviewed selected source family'};}
 const inventory:any={schemaVersion:2,sourceUrl:origin,complete:false,sources:[{url:origin+'/sitemap.xml',kind:'sitemap',status:'absent'},{url:origin,kind:'rendered',status:'ok',evidence:provenance}],coverage:{viewports:['desktop','tablet','mobile'],surfaces:['desktop','tablet','mobile'].map(viewport=>({id:viewport,viewport,path:'/core/a',state:'initial',status:'captured',evidence:provenance})),agentReview:review},occurrences:[],routes:{...mapped,'/outside':{disposition:'unresolved',rationale:'Still pending global work'}}};
 const plan:Plan={schemaVersion:2,revision:'scoped-fixture-1',sourceUrl:origin,inventory:await saveArtifact(root,inventory),viewports:{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}},limits:{timeoutMs:10000,maxActionsPerRoute:10,maxRoutes:10},environment:{locale:'en-US',timezoneId:'UTC'},routes};await writeJson(join(root,'plan.json'),plan);await writeJson(join(root,'contracts.json'),{captures:[],bindings:[],sentinel:'unchanged'});const project={sourceUrl:origin,capturePlanFile:'plan.json',pageContractsFile:'contracts.json',outputDirectory:'build',workflow:{evidenceDirectory:'evidence'}};const file=join(root,'project.json');await writeJson(file,project);await writeJson(join(root,'evidence/source.json'),{sentinel:'global-source-unchanged'});
 const sign=async(overrides:any={})=>{const current=await jsonFile(join(root,'plan.json')),intent:any={schemaVersion:1,scopeId:'core-four-r1',projectSha256:digest(await readFile(file)),planSha256:digest(await readFile(join(root,'plan.json'))),inventory:current.inventory,routeIds:['core-a','core-b','core-c','core-d'],viewports:['desktop','tablet','mobile'],sourceActionPolicy:'read-only',...overrides},proof={schemaVersion:1,kind:'source-scope-review',verdict:'approved-for-source-capture-only',reviewer:'independent-fixture-only',reviewedAt:new Date().toISOString(),intentSha256:digest(canonical(intent)),projectSha256:intent.projectSha256,planSha256:intent.planSha256,inventorySha256:intent.inventory.sha256,routeIds:intent.routeIds,viewports:intent.viewports,sourceActionPolicy:intent.sourceActionPolicy},spec={...intent,review:await saveArtifact(root,proof)};await writeJson(join(root,'scope.json'),spec);return spec;};
 await sign();return{root,file,plan,inventory,sign,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}};
}
test('reviewed four-route source subgraph captures actual three-device actions while the global incomplete gate and contracts remain blocked',async()=>{
 const f=await fixture();try{const beforeSource=await readFile(join(f.root,'evidence/source.json'),'utf8'),beforeContracts=await readFile(join(f.root,'contracts.json'),'utf8'),globalBefore=await gate(f.file,'plan');assert.equal(globalBefore.passed,false);await assert.rejects(collect(f.file,'source'),/Plan not ready/);
 const result=await collectSourceScope(f.file,'scope.json');assert.equal(result.scopeComplete,true,JSON.stringify(result.findings));assert.equal(result.globalAccepted,false);assert.equal(result.formalBuildAllowed,false);assert.equal(result.globalPlanGateBefore.passed,false);assert.equal(result.globalPlanGateAfter.passed,false);assert.equal(await readFile(join(f.root,'evidence/source.json'),'utf8'),beforeSource);assert.equal(await readFile(join(f.root,'contracts.json'),'utf8'),beforeContracts);await assert.rejects(exportContracts(f.file),/Source gate failed/);const spec=await jsonFile(join(f.root,'scope.json')),dir=join(f.root,'evidence/source-scopes',spec.scopeId,digest(canonical(sourceScopeIntent(spec))).slice(0,12)),index=await jsonFile(join(dir,'source-scope.json'));await assert.rejects(readFile(join(dir,'source.json')),/ENOENT/);assert.equal(index.sessions.length,12);assert.ok(index.sessions.every((s:any)=>!s.errors.length&&s.checks.length===4));assert.deepEqual((await gate(f.file,'plan')).findings.map(f=>f.id),globalBefore.findings.map(f=>f.id));await assert.rejects(collectSourceScope(f.file,'scope.json'),/EEXIST/);
 // A copied scoped index must remain explicitly unacceptable even if the synthetic inventory later becomes globally complete.
 const updated=structuredClone(f.inventory);updated.complete=true;delete updated.routes['/outside'];f.plan.inventory=await saveArtifact(f.root,updated);await writeJson(join(f.root,'plan.json'),f.plan);await writeJson(join(f.root,'evidence/source.json'),index);const rejected=await gate(f.file,'source');assert.equal(rejected.passed,false);assert.ok(rejected.findings.some(f=>f.id==='coverage:scope-only'));
 }finally{await f.close();}
});
test('scoped source refuses missing/stale review, plan/inventory drift, extra routes/viewports and dangerous actions before launching a browser',async()=>{
 const f=await fixture();try{const original=await jsonFile(join(f.root,'scope.json'));for(const mutation of ['missing-review','wrong-plan-hash','wrong-inventory','extra-route','extra-viewport','missing-viewport','stale-review']){const spec=structuredClone(original);if(mutation==='missing-review')delete spec.review;if(mutation==='wrong-plan-hash')spec.planSha256='0'.repeat(64);if(mutation==='wrong-inventory')spec.inventory.sha256='0'.repeat(64);if(mutation==='extra-route')spec.routeIds.push('outside');if(mutation==='extra-viewport')spec.viewports.push('wide');if(mutation==='missing-viewport')spec.viewports.pop();if(mutation==='stale-review')spec.scopeId='changed-intent';await writeJson(join(f.root,'bad-scope.json'),spec);await assert.rejects(prepareSourceScope(f.file,'bad-scope.json'),(error:unknown)=>error instanceof Error,mutation);}
 const bad=structuredClone(f.plan);bad.routes['core-a'].transitions.open.actions.source[0].effect='local-fixture';await writeJson(join(f.root,'plan.json'),bad);await f.sign({scopeId:'dangerous-r1'});await assert.rejects(prepareSourceScope(f.file,'scope.json'),/source writes|dangerous action/);assert.deepEqual(await jsonFile(join(f.root,'evidence/source.json')),{sentinel:'global-source-unchanged'});
 }finally{await f.close();}
});

test('offline scoped contracts independently reverify the shared three-device fixture and preserve all global boundaries', async () => {
 const f = await fixture();
 try {
  const project = await jsonFile(f.file);
  project.workflow.viewportPixelStability={maxRgbDelta:1,maxChangedPixelRatio:0.0005};
  project.workflow.sourceMediaReadiness = { schemaVersion: 1, rationale: 'Synthetic fixture must have no loading mask', rules: [{ paths: ['/core/a', '/core/b', '/core/c', '/core/d'], absent: ['#fixture-loading'], requiredImages: [] }] };
  await writeJson(f.file, project); await f.sign();
  const globalSource = await readFile(join(f.root, 'evidence/source.json')), globalContracts = await readFile(join(f.root, 'contracts.json'));
  const result = await collectSourceScope(f.file, 'scope.json');
  assert.equal(result.scopeComplete, true, JSON.stringify(result.findings));
  const spec = await jsonFile(join(f.root, 'scope.json'));
  const evidenceRoot = 'evidence/source-scopes/' + spec.scopeId + '/' + digest(canonical(sourceScopeIntent(spec))).slice(0, 12);
  const root = join(f.root, evidenceRoot), indexFile = join(root, 'source-scope.json');
  const input = { scope: 'scope.json', evidenceRoot, index: 'source-scope.json' };
  const original = await jsonFile(indexFile), originalIndex = await readFile(indexFile);
  // A fabricated success report is irrelevant; the verifier neither consumes nor writes it.
  await writeJson(join(root, 'scope-report.json'), { scopeComplete: true, globalAccepted: true });
  const verified = await verifyScopedSource(f.file, input);
  assert.equal(verified.passed, true); assert.equal(verified.globalPlanGate.passed, false);
  assert.equal(verified.formalBuildAllowed, false); assert.equal(verified.globalAccepted, false);
  assert.equal(verified.captures.length, 72); assert.equal(verified.transitions.length, 24);
  assert.ok(verified.captures.every((capture:any)=>capture.value.captureEnvironment.viewportPixelStability));
  const exported = await exportScopedContracts(f.file, { ...input, output: evidenceRoot + '/exports/collection-r1' });
  const exportedBytes = await readFile(exported.file), contract = JSON.parse(exportedBytes.toString());
  assert.equal(contract.kind, 'reviewed-scoped-source-only');
  assert.equal(contract.roots.scopeEvidence, await realpath(root));
  // Nested image and action references must resolve relative to the explicit scope root, not global evidence.
  for (const entry of contract.provenance.references) {
   const bytes = await readFile(join(entry.root === 'scope' ? contract.roots.scopeEvidence : contract.roots.project, entry.ref.path));
   assert.equal(digest(bytes), entry.ref.sha256);
  }
  assert.ok(contract.captures.every((c: any) => c.value.buildId === null && c.value.servedBuildId === null));
  await assert.rejects(exportScopedContracts(f.file, { ...input, output: evidenceRoot + '/exports/collection-r1' }), /EEXIST/);
  for (const output of ['contracts.json', 'evidence', 'evidence/source.json', 'evidence/repair-ledger.json', 'build', evidenceRoot + '/exports/../bad', '/absolute'])
   await assert.rejects(exportScopedContracts(f.file, { ...input, output }), /Output/);
  await assert.rejects(exportContracts(f.file), /Source gate failed/);
  const ledger = await readFile(join(f.root, 'evidence/repair-ledger.json'));
  const mutateIndex = async (label: string, edit: (index: any) => void | Promise<void>) => {
   const index = structuredClone(original); await edit(index); await writeJson(indexFile, index);
   await assert.rejects(verifyScopedSource(f.file, input), (error: unknown) => error instanceof Error, label);
   await assert.rejects(exportScopedContracts(f.file, { ...input, output: evidenceRoot + '/exports/rejected-' + label }), (error: unknown) => error instanceof Error, label);
   await assert.rejects(readFile(join(root, 'exports/rejected-' + label, 'contracts.json')), /ENOENT/);
   await writeFile(indexFile, originalIndex);
  };
  for (const [label, edit] of Object.entries({
   'schema': (e: any) => { e.schemaVersion = 1; },
   'scope': (e: any) => { e.scope.intentSha256 = '0'.repeat(64); e.scopeComplete = true; },
   'build': (e: any) => { e.buildId = 'invented'; },
   'device': (e: any) => { e.sessions = e.sessions.filter((s: any) => s.viewport !== 'mobile'); },
   'duplicate': (e: any) => { e.sessions.push(e.sessions[0]); },
   'reverse-edge': (e: any) => { e.sessions[0].checks = e.sessions[0].checks.filter((c: any) => c.id !== 'transition:close'); },
   'log': (e: any) => { delete e.sessions[0].checks.find((c: any) => c.kind === 'transition').actionLog; },
   'log-hash': (e: any) => { e.sessions[0].checks.find((c: any) => c.kind === 'transition').actionLog.sha256 = '0'.repeat(64); },
   'log-file': (e: any) => { e.sessions[0].checks.find((c: any) => c.kind === 'transition').actionLog.path = 'artifacts/missing-log.json'; },
   'capture-hash': (e: any) => { e.sessions[0].checks[0].before.source.sha256 = '0'.repeat(64); },
   'capture-missing': (e: any) => { e.sessions[0].checks[0].before.source.path = 'artifacts/missing.json'; },
   'capture-escape': (e: any) => { e.sessions[0].checks[0].before.source.path = '../source.json'; }
  })) await mutateIndex(label, edit);
  const mutateCapture = async (label: string, edit: (cap: any) => void) => mutateIndex(label, async e => {
   const old = e.sessions[0].checks[0].before.source;
   const cap = await jsonFile(join(root, old.path)); edit(cap);
   const ref = await saveArtifact(root, cap);
   for (const check of e.sessions[0].checks) for (const phase of ['before', 'after']) if (check[phase]?.source?.sha256 === old.sha256) check[phase].source = ref;
  });
  for (const [label, edit] of Object.entries({
   'canonical': (c: any) => { c.canonical = 'http://evil.invalid/core/a'; },
   'canonical-query': (c: any) => { c.canonical = c.finalUrl + '?wrong=1'; },
   'requested': (c: any) => { c.requestedUrl += '?wrong=1'; },
   'served-build': (c: any) => { c.servedBuildId = 'invented'; },
   'viewport-proof-missing': (c:any)=>{delete c.captureEnvironment.viewportPixelStability;},
   'viewport-proof-policy': (c:any)=>{c.captureEnvironment.viewportPixelStability.policySha256='0'.repeat(64);},
   'viewport-proof-statistics': (c:any)=>{c.captureEnvironment.viewportPixelStability.difference.maxDelta=2;},
   'readiness-policy': (c: any) => { c.captureEnvironment.sourceReadinessPolicySha256 = '0'.repeat(64); },
   'readiness-missing': (c: any) => { delete c.captureEnvironment.sourceReadinessPolicySha256; },
   'assertion': (c: any) => { c.assertions[0].actual = !c.assertions[0].expected; },
   'measurement': (c: any) => { delete c.components.heading.width; },
   'image': (c: any) => { delete c.screenshot; },
   'fullpage': (c: any) => { c.fullPage.path = 'artifacts/missing.png'; },
   'image-hash': (c: any) => { c.screenshot.sha256 = '0'.repeat(64); },
   'image-escape': (c: any) => { c.screenshot.path = '../../contracts.json'; },
   'timestamp': (c: any) => { c.capturedAt = 'invalid'; }
  })) await mutateCapture(label, edit);
  for (const label of ['action-end', 'action-start', 'action-identity', 'action-order']) await mutateIndex(label, async e => {
   const check = e.sessions[0].checks.find((c: any) => c.id === 'transition:open');
   const log = await jsonFile(join(root, check.actionLog.path));
   if (label === 'action-end') log.source[0].endedAt = 'invalid';
   if (label === 'action-start') log.source[0].startedAt = 'invalid';
   if (label === 'action-identity') log.source[0].action.selector = '#wrong';
   if (label === 'action-order') log.source[0].startedAt = new Date(0).toISOString();
   check.actionLog = await saveArtifact(root, log);
  });
  // Changed bytes under a previously signed review cannot be blessed by scopeComplete.
  const reviewFile = join(f.root, spec.review.path), reviewBytes = await readFile(reviewFile);
  await writeFile(reviewFile, '{}'); await assert.rejects(verifyScopedSource(f.file, input), /Changed evidence/); await writeFile(reviewFile, reviewBytes);
  for (const label of ['intent', 'time']) {
   const badReview = JSON.parse(reviewBytes.toString());
   if (label === 'intent') badReview.intentSha256 = '0'.repeat(64); else badReview.reviewedAt = 'invalid';
   const badSpec = { ...spec, review: await saveArtifact(f.root, badReview) };
   await writeJson(join(f.root, 'scope.json'), badSpec);
   await assert.rejects(verifyScopedSource(f.file, input), /review|timestamp/);
   await writeJson(join(f.root, 'scope.json'), spec);
  }
  const planFile = join(f.root, 'plan.json'), planBytes = await readFile(planFile);
  await writeFile(planFile, Buffer.concat([planBytes, Buffer.from(' ')])); await assert.rejects(verifyScopedSource(f.file, input), /identity differs/); await writeFile(planFile, planBytes);
  const projectBytes = await readFile(f.file), changedProject = JSON.parse(projectBytes.toString());
  changedProject.workflow.sourceMediaReadiness.rules[0].absent.push('#another-loading-mask');
  await writeJson(f.file, changedProject); await assert.rejects(verifyScopedSource(f.file, input), /identity differs/); await writeFile(f.file, projectBytes);
  const frozenReviewFile = join(root, 'inputs/review.json'), frozen = await readFile(frozenReviewFile);
  await writeFile(frozenReviewFile, '{}'); await assert.rejects(verifyScopedSource(f.file, input), /Frozen review differs/); await writeFile(frozenReviewFile, frozen);
  // Junctions exercise realpath containment on Windows without administrator symlink privilege.
  const outside = join(f.root, 'outside-scope'); await mkdir(outside);
  const firstCap = await jsonFile(join(root, original.sessions[0].checks[0].before.source.path));
  const imageBytes = await readFile(join(root, firstCap.screenshot.path)); await writeFile(join(outside, 'same.png'), imageBytes);
  await symlink(outside, join(root, 'escaped-images'), 'junction');
  await mutateCapture('symlink-image', c => { c.screenshot = { path: 'escaped-images/same.png', sha256: digest(imageBytes) }; });
  await unlink(join(root, 'escaped-images'));
  await mkdir(join(root, 'elsewhere')); await symlink(join(root, 'elsewhere'), join(root, 'exports/symlink-r1'), 'junction');
  await assert.rejects(exportScopedContracts(f.file, { ...input, output: evidenceRoot + '/exports/symlink-r1' }), /EEXIST/);
  await unlink(join(root, 'exports/symlink-r1'));
  assert.equal((await verifyScopedSource(f.file, input)).passed, true);
  assert.deepEqual(await readFile(exported.file), exportedBytes);
  assert.deepEqual(await readFile(join(f.root, 'evidence/source.json')), globalSource);
  assert.deepEqual(await readFile(join(f.root, 'contracts.json')), globalContracts);
  assert.deepEqual(await readFile(join(f.root, 'evidence/repair-ledger.json')), ledger);
  assert.equal((await gate(f.file, 'source')).passed, false);
 } finally { await f.close(); }
});
