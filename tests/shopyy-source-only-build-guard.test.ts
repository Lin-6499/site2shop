import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { shopyyAdapter } from '../src/shopyy/renderer.js';
import { buildPlatform } from '../src/platform.js';
import { registerBuiltInPlatforms } from '../src/platforms/index.js';
import { digest, writeJson, saveArtifact } from '../src/shopyy/artifacts.js';
import { VISUAL_FIELDS } from '../src/shopyy/contracts.js';
import { validateSourcePlan } from '../src/shopyy/source-plan.js';

async function snapshot(root: string): Promise<unknown[]> {
 const result: unknown[] = [];
 async function walk(dir: string, prefix: string) {
  for (const name of (await readdir(dir)).sort()) {
   const path = join(dir, name), relative = prefix + name, stat = await lstat(path);
   assert.equal(stat.isSymbolicLink(), false);
   if (stat.isDirectory()) { result.push({ path: relative + '/', directory: true }); await walk(path, relative + '/'); }
   else result.push({ path: relative, sha256: digest(await readFile(path)), size: stat.size, mtimeMs: stat.mtimeMs });
  }
 }
 await walk(root, ''); return result;
}

async function fixture() {
 const root = await mkdtemp(join(tmpdir(), 'shopyy-build-source-guard-')), file = join(root, 'project.json'), output = join(root, 'output'), evidence = join(root, 'evidence');
 const source = 'http://127.0.0.1:9'; // Identity only: this fixture does not make HTTP requests.
 const plan = { schemaVersion: 2, revision: 'synthetic-incomplete-prototype', sourceUrl: source, routes: {}, viewports: {} };
 const content = { source, navigation: [], hero: { eyebrow: '', title: 'Local prototype guard fixture', body: '', primaryAction: { label: 'Home', path: '/' }, secondaryAction: { label: 'Home', path: '/' } }, researcherPicks: [], batchTesting: { title: '', body: '', items: [] }, qualityItems: [], newsletter: { title: '', body: '', button: '' }, disclaimer: '' };
 const contracts = { schemaVersion: 2, captures: [], bindings: [] };
 const project = { platform: 'shopyy', siteId: 'build-guard-fixture', sourceUrl: source, capturePlanFile: 'plan.json', contentFile: 'content.json', designContractFile: 'design.json', pageContractsFile: 'contracts.json', commonStyleFile: 'style.css', assetsDirectory: 'assets', outputDirectory: 'output', workflow: { evidenceDirectory: 'evidence' }, shopyy: { templateProfile: 'synthetic-prototype-only', assetRootExpression: '/fixture-assets', routeMap: { '/': '/', '/shop': '/collection' }, variableMap: Object.fromEntries(['productList', 'productId', 'productTitle', 'productUrl', 'productImage', 'productPrice', 'productCategory', 'detailId', 'detailTitle', 'detailImage', 'detailPrice', 'detailDescription'].map(key => [key, '$fixture'])) } };
 await writeJson(file, project); await writeJson(join(root, 'plan.json'), plan); await writeJson(join(root, 'content.json'), content); await writeJson(join(root, 'design.json'), { source }); await writeJson(join(root, 'contracts.json'), contracts);
 await mkdir(join(root, 'assets')); await writeFile(join(root, 'assets/sentinel.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>'); await writeFile(join(root, 'style.css'), '/* synthetic prototype */');
 await mkdir(evidence); await writeFile(join(evidence, 'sentinel.bin'), Buffer.from([0, 255, 11, 37]));
 // Seed an actually owned, valid prototype output. Without a mode check, the old
 // prototype path could clear/regenerate this output while ignoring source fields.
 const initial = await shopyyAdapter.build({ projectFile: file, prototype: true });
 await writeFile(join(output, 'sentinel.bin'), Buffer.from([255, 0, 1, 254])); await mkdir(join(output, 'empty-sentinel'));
 const proof = await saveArtifact(root, { kind: 'synthetic-source-classification', sourceUrl: source, path: '/', family: 'collection' });
 const inventory = await saveArtifact(root, { schemaVersion: 2, sourceUrl: source, complete: false, sources: [{ kind: 'sitemap', url: source + '/sitemap.xml', status: 'absent' }, { kind: 'rendered', url: source, status: 'ok', evidence: proof }], coverage: { viewports: ['desktop', 'tablet', 'mobile'], surfaces: [] }, occurrences: [], routes: { '/': { disposition: 'unresolved', rationale: 'Target intentionally not designed', source: { family: 'collection', representative: 'collection', rationale: 'Synthetic source family', evidence: proof } } } });
 const sourcePlan: any = { schemaVersion: 1, kind: 'source-only-plan', revision: 'synthetic-source-plan', sourceUrl: source,
  inventory, viewports: { desktop: { width: 1440, height: 1000 }, tablet: { width: 768, height: 1024 }, mobile: { width: 375, height: 812 } }, limits: { timeoutMs: 5000, maxActionsPerRoute: 4, maxRoutes: 1 }, environment: { locale: 'en-US', timezoneId: 'UTC' },
  routes: { collection: { family: 'collection', rationale: 'Source-only guard fixture', sourcePath: '/', components: { heading: { source: 'h1', requiredFields: VISUAL_FIELDS, rules: VISUAL_FIELDS.map(field => ({ field, compare: 'equal' })) } }, states: { initial: { components: ['heading'], paths: { source: '/' }, ready: { source: 'h1' }, assertions: { source: [{ selector: 'h1', read: 'text', expected: 'Fixture' }] } } }, transitions: {}, sequence: [] } }
 };
 assert.deepEqual(validateSourcePlan(sourcePlan), []);
 return { root, file, output, evidence, project, plan, contracts, sourcePlan, initial, close: () => rm(root, { recursive: true, force: true }) };
}

test('renderer rejects source-only plan/schema/roles at direct adapter and dispatcher before any output or gate side effect; prototype is no exception', async () => {
 registerBuiltInPlatforms();
 const f = await fixture(); try {
  const outputBefore = await snapshot(f.output), evidenceBefore = await snapshot(f.evidence);
  const variants: [string, any, any, any][] = [
   ['source-plan-v1', f.project, f.sourcePlan, f.contracts],
   ['source-schema-kind-removed', f.project, { ...f.sourcePlan, kind: undefined }, f.contracts],
   ['source-kind-with-v2', f.project, { ...f.sourcePlan, schemaVersion: 2 }, f.contracts],
   ['source-role-with-v2', f.project, { ...f.plan, role: 'source-only' }, f.contracts],
   ['source-mode-with-v2', f.project, { ...f.plan, planMode: 'source-only-v1' }, f.contracts],
   ['source-scope-role-with-v2', f.project, { ...f.plan, scope: { role: 'source-only', planMode: 'source-only-v1' } }, f.contracts],
   ['source-project-role-with-v2', { ...f.project, role: 'source-only' }, f.plan, f.contracts],
   ['source-contract-with-v2', f.project, f.plan, { ...f.contracts, kind: 'reviewed-scoped-source-only', role: 'source-only', planMode: 'source-only-v1' }],
   ['source-index-as-contract', f.project, f.plan, { schemaVersion: 2, scope: { kind: 'source-capture-only' }, sessions: [] }]
  ];
  for (const [label, project, plan, contracts] of variants) {
   await writeJson(f.file, project); await writeJson(join(f.root, 'plan.json'), plan); await writeJson(join(f.root, 'contracts.json'), contracts);
   for (const prototype of [false, true]) for (const build of [shopyyAdapter.build, (request: Parameters<typeof shopyyAdapter.build>[0]) => buildPlatform('shopyy', request)]) {
    await assert.rejects(build({ projectFile: f.file, prototype }), /Source-only input cannot enter SHOPYY build/, label);
    assert.deepEqual(await snapshot(f.output), outputBefore, label + ': output changed');
    assert.deepEqual(await snapshot(f.evidence), evidenceBefore, label + ': evidence/gate wrote files');
   }
  }
  // Source plan mode is checked before reading content or calling a gate at all.
  await writeJson(f.file, { ...f.project, contentFile: 'missing-content.json' }); await writeJson(join(f.root, 'plan.json'), f.sourcePlan);
  for (const prototype of [false, true]) {
   const freshOutput = join(f.root, 'must-not-be-created-' + prototype);
   await assert.rejects(shopyyAdapter.build({ projectFile: f.file, outputDirectory: freshOutput, prototype }), /Source-only input cannot enter SHOPYY build/);
   await assert.rejects(lstat(freshOutput), /ENOENT/);
  }
  // Real CLI dispatch is protected by the same adapter, with no browser/network.
  await writeJson(f.file, f.project);
  for (const prototype of [false, true]) {
   const args = ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'platform-build', '--platform', 'shopyy', '--project', f.file, '--output', f.output, ...(prototype ? ['--prototype'] : [])];
   await assert.rejects(promisify(execFile)(process.execPath, args, { timeout: 15000 }), (error: any) => error.code === 1 && /Source-only input cannot enter SHOPYY build/.test(error.stderr));
   assert.deepEqual(await snapshot(f.output), outputBefore); assert.deepEqual(await snapshot(f.evidence), evidenceBefore);
  }
  // Restore the unchanged v2 prototype and prove it can still regenerate its owned output.
  await writeJson(join(f.root, 'plan.json'), f.plan); await writeJson(join(f.root, 'contracts.json'), f.contracts);
  const result = await shopyyAdapter.build({ projectFile: f.file, prototype: true });
  assert.equal(result.buildId, f.initial.buildId);
  assert.deepEqual(await readFile(join(f.output, 'sentinel.bin')), Buffer.from([255, 0, 1, 254]));
  assert.deepEqual(await snapshot(f.evidence), evidenceBefore);
 } finally { await f.close(); }
});
