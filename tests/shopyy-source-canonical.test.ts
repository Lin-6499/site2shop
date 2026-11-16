import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { collectSourceScope } from '../src/shopyy/browser.js';
import { prepareSourceScope, sourceScopeIntent } from '../src/shopyy/source-scope.js';
import { verifyScopedSource, exportScopedContracts } from '../src/shopyy/scoped-contracts.js';
import { validateSourcePlan, sourceCanonicalExpectation } from '../src/shopyy/source-plan.js';
import { validatePlan } from '../src/shopyy/gates.js';
import { VISUAL_FIELDS } from '../src/shopyy/contracts.js';
import { canonical, digest, saveArtifact, writeJson, jsonFile } from '../src/shopyy/artifacts.js';

async function fixture(legacy = false) {
 const root = await mkdtemp(join(tmpdir(), 'shopyy-source-canonical-'));
 let origin = '', actualCanonical: string | null | undefined;
 const server = createServer((req, res) => {
  const view = new URL(req.url!, origin).searchParams.get('view') || 'initial';
  const expected = actualCanonical === undefined ? origin + '/shop/' : actualCanonical;
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><title>Canonical fixture</title>${expected === null ? '' : `<link rel="canonical" href="${expected}">`}<h1 data-fixture="collection">${view}</h1><button id="list">List</button><button id="grid">Grid</button><button id="reset">Reset</button><script>document.querySelector('#list').onclick=()=>location.href='/shop?orderby=menu_order&view=list';document.querySelector('#grid').onclick=()=>location.href='/shop?orderby=menu_order&view=grid';document.querySelector('#reset').onclick=()=>location.href='/shop/';</script>`);
 });
 await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); origin = 'http://127.0.0.1:' + (server.address() as any).port;
 const proof = await saveArtifact(root, { kind: 'synthetic-canonical-source-family', sourceUrl: origin, path: '/shop/' });
 const inventory = await saveArtifact(root, { schemaVersion: 2, sourceUrl: origin, complete: false, sources: [{ kind: 'sitemap', url: origin + '/sitemap.xml', status: 'absent' }, { kind: 'rendered', url: origin + '/shop/', status: 'ok', evidence: proof }], coverage: { viewports: ['desktop', 'tablet', 'mobile'], surfaces: [] }, occurrences: [], routes: { '/shop/': { disposition: legacy ? 'mapped' : 'unresolved', ...(legacy ? { targetPath: '/shop/', family: 'collection', representative: 'collection' } : {}), rationale: 'Synthetic fixture; no global acceptance', source: { family: 'collection', representative: 'collection', rationale: 'Explicit source classification', evidence: proof } }, '/pending/': { disposition: 'unresolved', rationale: 'Full-site work remains pending' } } });
 const state = (name: string, path: string) => ({ components: ['heading'], paths: { source: path, ...(legacy ? { target: path } : {}) }, ready: { source: 'h1', ...(legacy ? { target: 'h1' } : {}) }, assertions: { source: [{ selector: 'h1', read: 'text', expected: name }], ...(legacy ? { target: [{ selector: 'h1', read: 'text', expected: name }] } : {}) }, ...(!legacy ? { canonical: { source: origin + '/shop/' } } : {}) });
 const edge = (from: string, to: string, selector: string) => ({ from, to, input: '', actions: { source: [{ op: 'click', selector, effect: 'read-only' }], ...(legacy ? { target: [{ op: 'click', selector, effect: 'read-only' }] } : {}) } });
 const plan: any = { schemaVersion: legacy ? 2 : 1, ...(!legacy ? { kind: 'source-only-plan' } : {}), revision: 'synthetic-canonical-r1', sourceUrl: origin, inventory, viewports: { desktop: { width: 1440, height: 1000 }, tablet: { width: 768, height: 1024 }, mobile: { width: 375, height: 812 } }, limits: { timeoutMs: 5000, maxActionsPerRoute: 10, maxRoutes: 3 }, environment: { locale: 'en-US', timezoneId: 'UTC' }, routes: { collection: { family: 'collection', rationale: 'Synthetic query/slash canonical graph', sourcePath: '/shop/', ...(legacy ? { targetPath: '/shop/' } : {}), components: { heading: { source: 'h1', requiredFields: VISUAL_FIELDS, rules: VISUAL_FIELDS.map(field => ({ field, compare: 'equal' })), ...(legacy ? { target: 'h1', owner: { file: 'theme/fixture.htm', marker: 'data-fixture="collection"' } } : {}) } }, states: { initial: state('initial', '/shop/'), list: state('list', '/shop?orderby=menu_order&view=list'), grid: state('grid', '/shop?orderby=menu_order&view=grid') }, transitions: { list: edge('initial', 'list', '#list'), grid: edge('list', 'grid', '#grid'), reset: edge('grid', 'initial', '#reset') }, sequence: ['list', 'grid', 'reset'] } } };
 if (legacy) { await mkdir(join(root, 'unused-target-build/theme'), { recursive: true }); await writeFile(join(root, 'unused-target-build/theme/fixture.htm'), '<h1 data-fixture="collection">Synthetic fixture owner marker</h1>'); }
 const project: any = { sourceUrl: origin, capturePlanFile: 'plan.json', ...(legacy ? { outputDirectory: 'unused-target-build', pageContractsFile: 'unused-global-contracts.json' } : {}), workflow: { evidenceDirectory: 'evidence' } };
 const file = join(root, 'project.json'); await writeJson(file, project); await writeJson(join(root, 'plan.json'), plan);
 const sign = async (scopeId: string) => {
  const intent: any = { schemaVersion: legacy ? 1 : 2, ...(!legacy ? { role: 'source-only', planMode: 'source-only-v1' } : {}), scopeId, projectSha256: digest(await readFile(file)), planSha256: digest(await readFile(join(root, 'plan.json'))), inventory, routeIds: ['collection'], viewports: ['desktop', 'tablet', 'mobile'], sourceActionPolicy: 'read-only' };
  const review = { schemaVersion: intent.schemaVersion, ...(!legacy ? { role: 'source-only', planMode: 'source-only-v1' } : {}), kind: 'source-scope-review', verdict: 'approved-for-source-capture-only', reviewer: 'synthetic-canonical-fixture-only', reviewedAt: new Date().toISOString(), intentSha256: digest(canonical(intent)), projectSha256: intent.projectSha256, planSha256: intent.planSha256, inventorySha256: inventory.sha256, routeIds: intent.routeIds, viewports: intent.viewports, sourceActionPolicy: 'read-only' };
  const scope = { ...intent, review: await saveArtifact(root, review) }; await writeJson(join(root, 'scope.json'), scope);
  return { scope: 'scope.json', evidenceRoot: 'evidence/source-scopes/' + scopeId + '/' + digest(canonical(sourceScopeIntent(scope))).slice(0, 12), index: 'source-scope.json' };
 };
 return { root, file, origin, plan, sign, setCanonical: (value: string | null | undefined) => { actualCanonical = value; }, close: async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); } };
}

test('declared source canonical binds slash/query aliases across all devices, preserves exact provenance and invalidates changed plan/review identities', async () => {
 const f = await fixture(); try {
  assert.deepEqual(validateSourcePlan(f.plan), []);
  const input = await f.sign('canonical-positive-r1'), result = await collectSourceScope(f.file, input.scope);
  assert.equal(result.scopeComplete, true, JSON.stringify(result.findings));
  const verified = await verifyScopedSource(f.file, input); assert.equal(verified.captures.length, 27); assert.equal(verified.transitions.length, 9);
  assert.ok(verified.captures.every(c => c.value.canonical === f.origin + '/shop/'));
  assert.deepEqual([...new Set(verified.captures.filter(c => c.value.state === 'list').map(c => c.value.finalUrl))], [f.origin + '/shop?orderby=menu_order&view=list']);
  const exported = await exportScopedContracts(f.file, { ...input, output: input.evidenceRoot + '/exports/canonical-r1' });
  assert.equal((await jsonFile(exported.file)).routes.collection.states.list.canonical.source, f.origin + '/shop/');
  const planFile = join(f.root, 'plan.json'), planBytes = await readFile(planFile);
  const changed = structuredClone(f.plan); changed.routes.collection.states.list.canonical.source += '?changed=1'; await writeJson(planFile, changed);
  await assert.rejects(prepareSourceScope(f.file, input.scope), /identity\/plan\/inventory mismatch/);
  await assert.rejects(verifyScopedSource(f.file, input), /identity differs/); await writeFile(planFile, planBytes);
  // Rehashing raw captures/index cannot replace the reviewed canonical expectation.
  const evidence = join(f.root, input.evidenceRoot), indexFile = join(evidence, input.index), indexBytes = await readFile(indexFile), original = JSON.parse(indexBytes.toString());
  const selected = original.sessions[0].checks.find((c: any) => c.id === 'state:list').before.source;
  for (const wrong of [f.origin + '/shop?orderby=menu_order&view=list', f.origin + '/wrong/', f.origin + '/shop/?wrong=1', 'https://foreign.invalid/shop/', null]) {
   const index = structuredClone(original), cap = await jsonFile(join(evidence, selected.path)); cap.canonical = wrong; const ref = await saveArtifact(evidence, cap);
   for (const session of index.sessions) for (const check of session.checks) for (const phase of ['before', 'after']) if (check[phase]?.source?.sha256 === selected.sha256) check[phase].source = ref;
   await writeJson(indexFile, index); await assert.rejects(verifyScopedSource(f.file, input), /Declared source canonical differs/);
  }
  await writeFile(indexFile, indexBytes); assert.equal((await verifyScopedSource(f.file, input)).passed, true);
 } finally { await f.close(); }
});

test('real source canonical must exactly match explicit path/query/origin/null and undeclared aliases remain blocked', async () => {
 const f = await fixture(); try {
  for (const [id, actual] of [['wrong-path', f.origin + '/wrong/'], ['wrong-query', f.origin + '/shop/?wrong=1'], ['wrong-origin', 'https://foreign.invalid/shop/'], ['missing-canonical', null]] as const) {
   f.setCanonical(actual); const input = await f.sign(id + '-r1'), result = await collectSourceScope(f.file, input.scope);
   assert.equal(result.scopeComplete, false, id); await assert.rejects(verifyScopedSource(f.file, input));
  }
  f.setCanonical(undefined);
  for (const state of Object.values<any>(f.plan.routes.collection.states)) delete state.canonical;
  await writeJson(join(f.root, 'plan.json'), f.plan); const input = await f.sign('undeclared-alias-r1');
  const blocked = await collectSourceScope(f.file, input.scope); assert.equal(blocked.scopeComplete, false); assert.match(blocked.findings.join(';'), /Wrong canonical/);
  for (const state of Object.values<any>(f.plan.routes.collection.states)) state.canonical = { source: null };
  await writeJson(join(f.root, 'plan.json'), f.plan); const nullInput = await f.sign('explicit-null-present-r1');
  assert.equal((await collectSourceScope(f.file, nullInput.scope)).scopeComplete, false, 'null is never a wildcard');
  f.setCanonical(null); const absentInput = await f.sign('explicit-null-absent-r1');
  const absent = await collectSourceScope(f.file, absentInput.scope); assert.equal(absent.scopeComplete, true, JSON.stringify(absent.findings));
  assert.ok((await verifyScopedSource(f.file, absentInput)).captures.every(c => c.value.canonical === null));
 } finally { await f.close(); }
});

test('canonical declarations validate exact same-origin URL spelling and do not relax legacy v2 behavior', async () => {
 const f = await fixture(); try {
  for (const value of ['/shop/', 'https://foreign.invalid/shop/', f.origin.replace('http://', 'http://user:pass@') + '/shop/', f.origin + '/shop/#fragment', f.origin.replace('http:', 'HTTP:') + '/shop/', 42, undefined]) {
   const plan = structuredClone(f.plan); plan.routes.collection.states.list.canonical = { source: value };
   assert.match(validateSourcePlan(plan).join(';'), /canonical.source/, String(value));
  }
  for (const declaration of [null, {}, { source: f.origin + '/shop/', target: f.origin + '/shop/' }]) {
   const plan = structuredClone(f.plan); plan.routes.collection.states.list.canonical = declaration; assert.ok(validateSourcePlan(plan).length);
  }
 } finally { await f.close(); }
 const legacy = await fixture(true); try {
  assert.deepEqual(validatePlan(legacy.plan), []);
  for (const state of Object.values<any>(legacy.plan.routes.collection.states)) delete state.canonical;
  assert.deepEqual(sourceCanonicalExpectation(legacy.plan, legacy.plan.routes.collection.states.list), { declared: false });
  await writeJson(join(legacy.root, 'plan.json'), legacy.plan); const input = await legacy.sign('legacy-strict-canonical-r1');
  const result = await collectSourceScope(legacy.file, input.scope); assert.equal(result.scopeComplete, false); assert.match(result.findings.join(';'), /Wrong canonical/);
  await assert.rejects(verifyScopedSource(legacy.file, input));
 } finally { await legacy.close(); }
});
import {stateCanonicalRejection} from '../src/shopyy/contracts.js';

test('bilateral explicit canonical null/alias is exact while undeclared aliases remain strict',async()=>{
 const f=await fixture(true);try{
  const route=f.plan.routes.collection;route.states={initial:{...route.states.initial,canonical:{source:null,target:null}}};route.transitions={};route.sequence=[];f.setCanonical(null);
  assert.deepEqual(validatePlan(f.plan),[]);await writeJson(join(f.root,'plan.json'),f.plan);
  const input=await f.sign('bilateral-null-canonical');assert.equal((await collectSourceScope(f.file,input.scope)).scopeComplete,true);assert.equal((await verifyScopedSource(f.file,input)).passed,true);
  const state=route.states.initial,sourceUrl=f.origin+'/search?q=RT10';
  assert.equal(stateCanonicalRejection(state,'source',null,sourceUrl),null);
  assert.match(stateCanonicalRejection(state,'source',f.origin+'/wrong',sourceUrl)!,/Declared source canonical differs/);
  state.canonical={source:f.origin+'/alias',target:'http://target.invalid/alias'};
  assert.equal(stateCanonicalRejection(state,'source',f.origin+'/alias',sourceUrl),null);
  assert.equal(stateCanonicalRejection(state,'target','http://target.invalid/alias','http://target.invalid/search'),null);
  assert.match(stateCanonicalRejection({},'source',f.origin+'/alias',sourceUrl)!,/Wrong canonical/);
  state.canonical={source:null};assert.match(validatePlan(f.plan).join(';'),/explicit source and target/);
 }finally{await f.close();}
});
