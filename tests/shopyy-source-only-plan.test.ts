import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { collect, collectSourceScope } from '../src/shopyy/browser.js';
import { prepareSourceScope, sourceScopeIntent } from '../src/shopyy/source-scope.js';
import { verifyScopedSource, exportScopedContracts } from '../src/shopyy/scoped-contracts.js';
import { exportContracts } from '../src/shopyy/commands.js';
import { validatePlan, gate } from '../src/shopyy/gates.js';
import { validateSourcePlan, loadScopedPlan, verifySourceInventory, bilateralPlan, SOURCE_ONLY_COLLECTOR, captureActions } from '../src/shopyy/source-plan.js';
import { VISUAL_FIELDS, COLLECTOR, type Plan } from '../src/shopyy/contracts.js';
import { canonical, digest, saveArtifact, writeJson, jsonFile } from '../src/shopyy/artifacts.js';

async function fixture() {
 const root = await mkdtemp(join(tmpdir(), 'shopyy-source-only-'));
 const server = createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><title>Source-only fixture</title><link rel="canonical" href="/shop/"><h1>Source collection</h1><button id="toggle">Details</button><p id="panel" hidden>Observed detail</p><script>document.querySelector('#toggle').onclick=()=>document.querySelector('#panel').hidden=!document.querySelector('#panel').hidden</script>`));
 await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
 const origin = 'http://127.0.0.1:' + (server.address() as any).port;
 const sourceProof = await saveArtifact(root, { kind: 'synthetic-source-family-classification', sourceUrl: origin, path: '/shop/', family: 'collection', rationale: 'Isolated source-only workflow regression, not real-site evidence' });
 const inventory: any = { schemaVersion: 2, sourceUrl: origin, complete: false,
  sources: [{ kind: 'sitemap', url: origin + '/sitemap.xml', status: 'absent' }, { kind: 'rendered', url: origin + '/shop/', status: 'ok', evidence: sourceProof }],
  coverage: { viewports: ['desktop', 'tablet', 'mobile'], surfaces: ['desktop', 'tablet', 'mobile'].map(viewport => ({ id: viewport, viewport, path: '/shop/', state: 'initial', status: 'captured', evidence: sourceProof })) },
  occurrences: [{ id: 'outside', from: '/shop/', path: '/outside/', text: 'Pending route', surface: 'desktop' }],
  routes: { '/shop/': { disposition: 'unresolved', rationale: 'Target mapping intentionally undecided', source: { family: 'collection', representative: 'collection', rationale: 'Explicit source classification', evidence: sourceProof } }, '/outside/': { disposition: 'unresolved', rationale: 'Full inventory work remains pending' } }
 };
 const state = (open: boolean) => ({ components: ['heading'], paths: { source: '/shop/' }, ready: { source: 'h1' }, assertions: { source: [{ selector: '#panel', read: 'visible', expected: open }] } });
 const plan: any = { schemaVersion: 1, kind: 'source-only-plan', revision: 'source-fixture-r1', sourceUrl: origin,
  inventory: await saveArtifact(root, inventory), viewports: { desktop: { width: 1440, height: 1000 }, tablet: { width: 768, height: 1024 }, mobile: { width: 375, height: 812 } }, limits: { timeoutMs: 5000, maxActionsPerRoute: 4, maxRoutes: 5 }, environment: { locale: 'en-US', timezoneId: 'UTC' },
  routes: { collection: { family: 'collection', rationale: 'Reviewed synthetic collection source graph', sourcePath: '/shop/',
   components: { heading: { source: 'h1', requiredFields: VISUAL_FIELDS, rules: VISUAL_FIELDS.map(field => ({ field, compare: ['x', 'y', 'width', 'height'].includes(field) ? 'number' : 'equal', tolerance: 0, rationale: 'Predeclared fixture geometry policy' })) } },
   states: { initial: state(false), expanded: state(true) }, transitions: { open: { from: 'initial', to: 'expanded', input: '', actions: { source: [{ op: 'click', selector: '#toggle', effect: 'read-only' }] } }, close: { from: 'expanded', to: 'initial', input: '', actions: { source: [{ op: 'click', selector: '#toggle', effect: 'read-only' }] } } }, sequence: ['open', 'close']
  } }
 };
 const project: any = { sourceUrl: origin, capturePlanFile: 'source-plan.json', workflow: { evidenceDirectory: 'source-evidence', sourceMediaReadiness: { schemaVersion: 1, rationale: 'No source loading overlay may remain', rules: [{ paths: ['/shop/'], absent: ['.loading'], requiredImages: [] }] } } };
 const file = join(root, 'project.json'); await writeJson(file, project); await writeJson(join(root, 'source-plan.json'), plan);
 const sign = async (changes: { intent?: any; review?: any } = {}) => {
  const current = await jsonFile(join(root, 'source-plan.json'));
  const intent: any = { schemaVersion: 2, role: 'source-only', planMode: 'source-only-v1', scopeId: 'source-collection-r1', projectSha256: digest(await readFile(file)), planSha256: digest(await readFile(join(root, 'source-plan.json'))), inventory: current.inventory, routeIds: ['collection'], viewports: ['desktop', 'tablet', 'mobile'], sourceActionPolicy: 'read-only', ...changes.intent };
  const review: any = { schemaVersion: 2, role: 'source-only', planMode: 'source-only-v1', kind: 'source-scope-review', verdict: 'approved-for-source-capture-only', reviewer: 'synthetic-fixture-reviewer-only', reviewedAt: new Date().toISOString(), intentSha256: digest(canonical(intent)), projectSha256: intent.projectSha256, planSha256: intent.planSha256, inventorySha256: intent.inventory.sha256, routeIds: intent.routeIds, viewports: intent.viewports, sourceActionPolicy: intent.sourceActionPolicy, ...changes.review };
  const spec = { ...intent, review: await saveArtifact(root, review) }; await writeJson(join(root, 'scope.json'), spec); return spec;
 };
 await sign();
 return { root, file, plan, project, inventory, sign, close: async () => { await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); } };
}

test('explicit pure-source plan captures/reverifies/exports the full three-device graph without target/owner inventions', async () => {
 const f = await fixture(); try {
  assert.deepEqual(validateSourcePlan(f.plan), []);
  const cli = await promisify(execFile)(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'shopyy-workflow', 'source-plan-validate', '--project', f.file]);
  assert.equal(JSON.parse(cli.stdout).passed, true); assert.equal(JSON.parse(cli.stdout).planMode, 'source-only-v1');
  assert.ok(validatePlan(f.plan as Plan).length);
  const projectBytes = await readFile(f.file), planBytes = await readFile(join(f.root, 'source-plan.json'));
  const result = await collectSourceScope(f.file, 'scope.json');
  assert.equal(result.scopeComplete, true, JSON.stringify(result.findings)); assert.equal(result.planMode, 'source-only-v1');
  assert.equal(result.globalPlanGateAfter.passed, false); assert.equal(result.formalBuildAllowed, false);
  const spec = await jsonFile(join(f.root, 'scope.json')), evidenceRoot = 'source-evidence/source-scopes/' + spec.scopeId + '/' + digest(canonical(sourceScopeIntent(spec))).slice(0, 12);
  const input = { scope: 'scope.json', evidenceRoot, index: 'source-scope.json' };
  const verified = await verifyScopedSource(f.file, input);
  assert.equal(verified.planMode, 'source-only-v1'); assert.equal(verified.role, 'source-only');
  assert.equal(verified.captures.length, 18); assert.equal(verified.transitions.length, 6);
  assert.deepEqual(Object.keys(verified.routes.collection.components.heading).sort(), ['requiredFields', 'rules', 'source']);
  assert.ok(verified.captures.every(c => c.value.collectorVersion === SOURCE_ONLY_COLLECTOR && c.value.side === 'source' && c.value.buildId === null && c.value.servedBuildId === null));
  assert.ok(verified.transitions.every(t => !t.value.target));
  const exported = await exportScopedContracts(f.file, { ...input, output: evidenceRoot + '/exports/source-r1' });
  const contract = await jsonFile(exported.file); assert.equal(contract.planMode, 'source-only-v1'); assert.equal(contract.globalAccepted, false);
  assert.deepEqual(await readFile(f.file), projectBytes); assert.deepEqual(await readFile(join(f.root, 'source-plan.json')), planBytes);
  for (const global of ['source-evidence/source.json', 'source-evidence/repair-ledger.json', 'contracts.json']) await assert.rejects(readFile(join(f.root, global)), /ENOENT/);
  // This project deliberately has no target storage/composer fields. Global entrypoints reject before browser work.
  for (const stage of ['source', 'preflight', 'online'] as const) await assert.rejects(collect(f.file, stage), /Source-only plan cannot enter global/);
  await assert.rejects(exportContracts(f.file), /cannot export global contracts/);
  assert.throws(() => bilateralPlan(f.plan), /Source-only plan/);
  assert.throws(() => captureActions(f.plan.routes.collection.transitions.open, 'desktop', 'target'), /no target actions/);
  // Existing global gate is still red when given the usual storage fields; no global acceptance is inferred.
  await writeJson(f.file, { ...f.project, outputDirectory: 'unused-build', pageContractsFile: 'unused-contracts.json' });
  assert.equal((await gate(f.file, 'plan')).passed, false); assert.equal((await gate(f.file, 'source')).passed, false);
  await writeFile(f.file, projectBytes);
  const indexFile = join(f.root, evidenceRoot, 'source-scope.json'), index = await jsonFile(indexFile), originalIndex = await readFile(indexFile);
  for (const mutation of ['legacy-collector', 'scope-mode', 'target-capture']) {
   const edited = structuredClone(index);
   if (mutation === 'legacy-collector') edited.collectorVersion = COLLECTOR;
   if (mutation === 'scope-mode') delete edited.scope.planMode;
   if (mutation === 'target-capture') { const cap = await jsonFile(join(f.root, evidenceRoot, edited.sessions[0].checks[0].before.source.path)); cap.side = 'target'; edited.sessions[0].checks[0].before.source = await saveArtifact(join(f.root, evidenceRoot), cap); }
   await writeJson(indexFile, edited); await assert.rejects(verifyScopedSource(f.file, input)); await writeFile(indexFile, originalIndex);
  }
  const scopeBytes = await readFile(join(f.root, 'scope.json'));
  for (const edit of [(s: any) => { s.schemaVersion = 1; delete s.role; delete s.planMode; }, (s: any) => { s.planMode = 'bilateral-v2'; }, (s: any) => { s.role = 'target'; }]) {
   const bad = JSON.parse(scopeBytes.toString()); edit(bad); await writeJson(join(f.root, 'scope.json'), bad); await assert.rejects(verifyScopedSource(f.file, input), /mode\/role/);
  }
  await writeFile(join(f.root, 'scope.json'), scopeBytes);
  const review = await jsonFile(join(f.root, spec.review.path)); review.planMode = 'bilateral-v2';
  const bad = { ...spec, review: await saveArtifact(f.root, review) }; await writeJson(join(f.root, 'scope.json'), bad); await assert.rejects(verifyScopedSource(f.file, input), /mode\/role/);
  await writeFile(join(f.root, 'scope.json'), scopeBytes);
  // Re-labeling/removing fields is not automatic promotion: both legacy validator and reviewed identities reject it.
  const mislabeled = structuredClone(f.plan); mislabeled.schemaVersion = 2; delete mislabeled.kind;
  assert.ok(validatePlan(mislabeled).length); await writeJson(join(f.root, 'source-plan.json'), mislabeled);
  await assert.rejects(verifyScopedSource(f.file, input));
 } finally { await f.close(); }
});

test('source-only validator and preparation fail closed before browser execution for incomplete/unsafe/mixed-mode plans', async () => {
 const f = await fixture(); try {
  const mutations: Record<string, (p: any) => void> = {
   'missing-device': p => { delete p.viewports.mobile; },
   'extra-device': p => { p.viewports.watch = { width: 100, height: 100 }; },
   'reverse-edge': p => { p.routes.collection.sequence.pop(); },
   'reverse-edge-deleted': p => { p.routes.collection.sequence.pop(); delete p.routes.collection.transitions.close; },
   'selector': p => { delete p.routes.collection.components.heading.source; },
   'field': p => { p.routes.collection.components.heading.requiredFields = VISUAL_FIELDS.filter(f => f !== 'width'); },
   'unsupported-field': p => { p.routes.collection.components.heading.requiredFields.push('imaginaryMeasurement'); p.routes.collection.components.heading.rules.push({ field: 'imaginaryMeasurement', compare: 'equal' }); },
   'rule': p => { p.routes.collection.components.heading.rules.pop(); },
   'rule-duplicate': p => { p.routes.collection.components.heading.rules.push(p.routes.collection.components.heading.rules[0]); },
   'rule-tolerance': p => { p.routes.collection.components.heading.rules.find((r: any) => r.compare === 'number').tolerance = -1; },
   'readonly': p => { p.routes.collection.transitions.open.actions.source[0].effect = 'local-fixture'; },
   'action': p => { delete p.routes.collection.transitions.open.actions; },
   'input': p => { p.routes.collection.transitions.open.actions.source[0] = { op: 'select', selector: '#toggle', value: 'wrong', effect: 'read-only' }; },
   'ready': p => { delete p.routes.collection.states.initial.ready; },
   'assertion': p => { p.routes.collection.states.initial.assertions.source = []; },
   'assertion-read': p => { p.routes.collection.states.initial.assertions.source[0].read = 'unsupported'; },
   'target-state': p => { p.routes.collection.states.initial.paths.target = '/invented'; },
   'target-owner': p => { p.routes.collection.components.heading.owner = { file: 'invented', marker: 'invented' }; },
   'target-action': p => { p.routes.collection.transitions.open.actions.target = [{ op: 'click', selector: '#toggle', effect: 'local-fixture' }]; },
   'identity': p => { p.sourceUrl = 'not-a-url'; },
   'mutation-route': p => { p.routes.collection.states.initial.paths.source = '/shop/?add-to-cart=1'; },
   'limit': p => { p.limits.maxActionsPerRoute = 1; },
   'env': p => { delete p.environment.locale; },
   'timezone': p => { p.environment.timezoneId = 'Invalid/FixtureZone'; },
   'animation': p => { p.environment.infiniteAnimations = 'invented'; },
   'duplicate-selector': p => { p.routes.collection.components.second = structuredClone(p.routes.collection.components.heading); p.routes.collection.states.initial.components.push('second'); }
  };
  for (const [label, edit] of Object.entries(mutations)) {
   const plan = structuredClone(f.plan); edit(plan); assert.ok(validateSourcePlan(plan).length, label);
   await writeJson(join(f.root, 'source-plan.json'), plan); await f.sign(); await assert.rejects(prepareSourceScope(f.file, 'scope.json'), (error: unknown) => error instanceof Error, label);
  }
  await writeJson(join(f.root, 'source-plan.json'), f.plan);
  for (const changes of [{ intent: { schemaVersion: 1, role: undefined, planMode: undefined } }, { review: { schemaVersion: 1, role: undefined, planMode: undefined } }, { review: { intentSha256: '0'.repeat(64) } }, { review: { planSha256: '0'.repeat(64) } }]) {
   await f.sign(changes); await assert.rejects(prepareSourceScope(f.file, 'scope.json'), /mode\/role|review/);
  }
  for (const mutation of ['family', 'representative', 'provenance']) {
   const inventory = structuredClone(f.inventory);
   if (mutation === 'family') inventory.routes['/shop/'].source.family = 'product';
   if (mutation === 'representative') inventory.routes['/shop/'].source.representative = 'other';
   if (mutation === 'provenance') inventory.routes['/shop/'].source.evidence.sha256 = '0'.repeat(64);
   const plan = structuredClone(f.plan); plan.inventory = await saveArtifact(f.root, inventory); await writeJson(join(f.root, 'source-plan.json'), plan); await f.sign();
   await assert.rejects(verifySourceInventory(await loadScopedPlan(f.file), ['collection'])); await assert.rejects(prepareSourceScope(f.file, 'scope.json'));
  }
  await writeJson(join(f.root, 'source-plan.json'), f.plan); await f.sign();
  await mkdir(join(f.root, 'outside-evidence')); await symlink(join(f.root, 'outside-evidence'), join(f.root, 'source-evidence'), 'junction');
  await assert.rejects(prepareSourceScope(f.file, 'scope.json'), /Unsafe source-only evidence ancestry/);
  await assert.rejects(readFile(join(f.root, 'outside-evidence/source-scopes/source-collection-r1/source-scope.json')), /ENOENT/);
  await unlink(join(f.root, 'source-evidence'));
 } finally { await f.close(); }
});

test('source-only real capture rejects an ambiguous source component and cannot export a success contract', async () => {
 const f = await fixture(); try {
  f.plan.routes.collection.components.heading.source = 'h1,button';
  await writeJson(join(f.root, 'source-plan.json'), f.plan); const spec = await f.sign();
  assert.deepEqual(validateSourcePlan(f.plan), []); // DOM uniqueness is proved by the collector, not invented statically.
  const result = await collectSourceScope(f.file, 'scope.json'); assert.equal(result.scopeComplete, false);
  const evidenceRoot = 'source-evidence/source-scopes/' + spec.scopeId + '/' + digest(canonical(sourceScopeIntent(spec))).slice(0, 12);
  const input = { scope: 'scope.json', evidenceRoot, index: 'source-scope.json' };
  await assert.rejects(verifyScopedSource(f.file, input));
  await assert.rejects(exportScopedContracts(f.file, { ...input, output: evidenceRoot + '/exports/no-success' }));
  await assert.rejects(readFile(join(f.root, evidenceRoot, 'exports/no-success/contracts.json')), /ENOENT/);
 } finally { await f.close(); }
});
