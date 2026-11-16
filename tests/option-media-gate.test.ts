import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { assertOptionMediaAcceptance, compareOptionObservation } from '../src/option-media-gate.js';
import { computeThemeBuildId } from '../src/theme-integrity.js';
import { inventoryOptionGroups, selectObservedOption } from '../src/option-probes.js';
import { assertExecutableEvidence, PROJECT_ROOT, recordGeneratorPresentationBindings, runEvidenceNegativeTests } from '../src/evidence-gate.js';
import { deploy } from '../src/shopify.js';
import { publishPhase5 } from '../src/phase5-publish.js';

// Synthetic artifacts only. These tests never read store credentials or contact a store.
type Stage = 'preflight' | 'online';
type Fixture = {
  out: string;
  build: string;
  stage: Stage;
  plan: any;
  contract: any;
  manifest: any;
  report: any;
  catalog: any;
  cases: Array<{ handle: string; width: number; step: number; source: any; target: any }>;
};
type Mutation = (fixture: Fixture) => void;
const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const store = 'fixture.myshopify.com';
const generatedName = 'sections/test.liquid';
const generatedBody = '<section>SYNTHETIC OPTION GATE FIXTURE</section>';

async function save(out: string, path: string, value: unknown) {
  const bytes = JSON.stringify(value);
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return { path, sha256: sha256(bytes) };
}

async function fixture(t: TestContext, mutate: Mutation = () => {}, stage: Stage = 'preflight'): Promise<Fixture> {
  const out = await mkdtemp(join(tmpdir(), 'site2shop-option-gate-'));
  t.after(async () => {
    assert.equal(dirname(resolve(out)), resolve(tmpdir()));
    await rm(out, { recursive: true, force: true });
  });
  await mkdir(join(out, 'theme/sections'), { recursive: true });
  await writeFile(join(out, 'theme', generatedName), generatedBody);
  const build = await computeThemeBuildId(out);
  const plan = {
    schemaVersion: 1, handles: ['shirt'],
    viewports: [{ name: 'desktop', width: 1440 }, { name: 'tablet', width: 768 }, { name: 'mobile', width: 390 }],
  };
  const groups = [{ name: 'Size', values: ['S', 'M'].map(value => ({ value, kind: 'image', asset: `https://source.invalid/${value}.png`, color: null })) }];
  const observations = plan.viewports.flatMap(viewport => ['S', 'M', 'S'].map((size, step) => ({
    viewport: { width: viewport.width }, selected: [size], main: 'https://source.invalid/shirt.png',
    kind: ['initial', 'change', 'reverse'][step],
    controls: ['S', 'M'].map(value => ({ value, checked: size === value, disabled: false, label: { width: 32, height: 32, x: 0 } })),
  })));
  const contract = { schemaVersion: 1, products: { shirt: {
    source: 'https://source.invalid/products/shirt', options: ['Size'], groups,
    images: ['https://source.invalid/shirt.png'], variantMedia: { S: 0, M: 0 }, observations,
  } } };
  const catalog = {
    url: `https://${store}/products/shirt.js`, images: ['https://target.invalid/shirt.png'],
    variants: ['S', 'M'].map((size, index) => ({ id: String(100 + index), options: [size], price: 1000, available: true })),
  };
  const cases = observations.map((source, index) => {
    const variant = catalog.variants.find(item => item.options[0] === source.selected[0])!;
    return {
      handle: 'shirt', width: source.viewport.width, step: index % 3, source,
      target: {
        buildId: build, viewport: { width: source.viewport.width }, themeId: 99,
        url: `${stage === 'online' ? `https://${store}` : 'http://localhost:3000'}/products/shirt?variant=${variant.id}`,
        selected: [...source.selected], variantId: variant.id, expectedVariant: structuredClone(variant),
        price: '$10.00', buttonDisabled: false, main: 'https://target.invalid/shirt.png', mainLoaded: true, overflow: false,
        controls: ['S', 'M'].map(value => ({ group: 0, value, checked: source.selected[0] === value, disabled: false,
          width: 32, height: 32, x: 0, asset: `https://target.invalid/local-${value.toLowerCase()}.png`, assetLoaded: true })),
      },
    };
  });
  const state: Fixture = {
    out, build, stage, plan, contract, catalog, cases,
    manifest: { build: { id: build }, files: [{ name: generatedName, sha256: sha256(generatedBody) }],
      assetNames: { 'https://source.invalid/S.png': 'local-s.png', 'https://source.invalid/M.png': 'local-m.png' } },
    report: { schemaVersion: 1, stage, buildId: build, passed: true, cases: [],
      ...(stage === 'online' ? { store, themeId: 99 } : {}) },
  };
  mutate(state);
  state.contract.planSha256 = sha256(JSON.stringify(state.plan));
  state.manifest.contractHash = sha256(JSON.stringify(state.contract));
  state.report.sourceSha256 = state.manifest.contractHash;
  for (const item of state.cases) {
    const ref = await save(out, `artifacts/${item.width}-${item.step}.json`, { source: item.source, target: item.target });
    state.report.cases.push({ handle: item.handle, width: item.width, step: item.step, artifact: ref.path, sha256: ref.sha256 });
  }
  if (stage === 'online') state.report.catalogs = { shirt: await save(out, 'catalogs/shirt.json', state.catalog) };
  await save(out, 'phase3-product-template-binding.json', { products: [{ handle: 'shirt', templateSuffix: 's2s-embroidered' }] });
  await save(out, 'phase3-content-plan.json', { records: [{ handle: 'shirt', kind: 'product', sourceSnapshot: state.catalog }] });
  await save(out, 'theme-build.json', { id: build });
  await save(out, 'option-media-contracts.json', state.contract);
  await save(out, 'option-media-evidence/plan.json', state.plan);
  await save(out, 'option-media-build.json', state.manifest);
  await save(out, stage === 'online' ? 'option-media-online/report.json' : 'option-media-acceptance/report.json', state.report);
  await save(out, 'deployment.json', { store, themeId: 99, themeBuild: build, role: 'unpublished', published: false });
  return state;
}

test('option gate accepts complete independently bound preflight and online evidence', async t => {
  for (const stage of ['preflight', 'online'] as const) await t.test(stage, async t => {
    const state = await fixture(t, undefined, stage);
    assert.deepEqual(await assertOptionMediaAcceptance(state.out, stage), { applicable: true, count: 9, buildId: state.build });
  });
});

test('storefront CDN alias requires matching content hashes, catalog membership and target host', async t => {
  const state = await fixture(t, undefined, 'online');
  const item=state.cases[0];
  item.target.main=`https://${store}/cdn/shop/files/shirt.png?width=1600`;
  const proof={alias:`https://${store}/cdn/shop/files/shirt.png`,canonical:'https://target.invalid/shirt.png',aliasSha256:'a'.repeat(64),canonicalSha256:'a'.repeat(64)};
  assert.deepEqual(compareOptionObservation(item.source,item.target,state.catalog.variants,state.catalog.images,[proof]),[]);
  for(const changed of [{...proof,aliasSha256:'b'.repeat(64)},{...proof,canonical:'https://other.invalid/shirt.png'},{...proof,aliasSha256:'',canonicalSha256:''}]){
    assert.ok(compareOptionObservation(item.source,item.target,state.catalog.variants,state.catalog.images,[changed]).includes('main image absent from independently captured catalog'));
  }
  item.target.url='https://other-store.myshopify.com/products/shirt';
  assert.ok(compareOptionObservation(item.source,item.target,state.catalog.variants,state.catalog.images,[proof]).includes('main image absent from independently captured catalog'));
});

const rejectionCases: Array<{ name: string; mutate: Mutation; error: RegExp; stage?: Stage }> = [
  { name: 'empty viewport denominator and empty green report', mutate: s => { s.plan.viewports = []; s.cases = []; }, error: /viewport denominator incomplete/ },
  { name: 'missing reverse source steps and matching report entries', mutate: s => {
    s.contract.products.shirt.observations = s.contract.products.shirt.observations.filter((o: any) => o.kind !== 'reverse');
    s.cases = s.cases.filter(c => c.source.kind !== 'reverse');
  }, error: /missing reverse to baseline/ },
  { name: 'missing source consumer', mutate: s => { delete s.contract.products.shirt; }, error: /missing consumer/ },
  { name: 'missing source option group', mutate: s => { s.contract.products.shirt.groups = []; }, error: /incomplete option groups/ },
  { name: 'missing report case despite passed=true', mutate: s => { s.cases.pop(); }, error: /missing or duplicated option evidence/ },
  { name: 'wrong loaded main image', mutate: s => { s.cases[0].target.main = 'https://target.invalid/wrong.png'; }, error: /semantic main image differs/ },
  { name: 'wrong loaded swatch', mutate: s => { s.cases[0].target.controls[0].asset = 'https://target.invalid/wrong.png'; }, error: /wrong-but-present option asset/ },
  { name: 'same basename outside catalog', mutate: s => { s.cases[0].target.main = 'https://other.invalid/other/shirt.png'; }, error: /main image absent from independently captured catalog/ },
  { name: 'same basename in two catalog directories', mutate: s => {
    s.catalog.images.push('https://other.invalid/other/shirt.png'); s.cases[0].target.main = 'https://other.invalid/other/shirt.png';
  }, error: /ambiguous or wrong source-to-target media identity/ },
  { name: 'stale report build', mutate: s => { s.report.buildId = 'old-build'; }, error: /acceptance stale or wrong stage/ },
  { name: 'stale raw observation under current report', mutate: s => { s.cases[0].target.buildId = 'old-build'; }, error: /target artifact stale build/ },
  { name: 'wrong observation viewport', mutate: s => { s.cases[0].target.viewport.width = 390; }, error: /target viewport mismatch/ },
  { name: 'wrong report stage', mutate: s => { s.report.stage = 'online'; }, error: /acceptance stale or wrong stage/ },
  { name: 'local observation relabeled online', stage: 'online', mutate: s => {
    s.cases[0].target.url = 'http://localhost:3000/products/shirt?variant=100';
  }, error: /not the intended storefront/ },
  { name: 'wrong raw online theme', stage: 'online', mutate: s => { s.cases[0].target.themeId = 100; }, error: /no verified draft identity/ },
  { name: 'forged expected price cannot replace independent catalog', mutate: s => {
    s.cases[0].target.price = '$1.00'; s.cases[0].target.expectedVariant.price = 100;
  }, error: /price/ },
];
for (const field of ['checked', 'disabled', 'width', 'height', 'x'] as const) {
  const error = field === 'checked' ? /checked state/ : field === 'disabled' ? /disabled state/ : field === 'x' ? /control horizontal alignment/ : /control dimensions/;
  rejectionCases.push(
    { name: `missing control ${field}`, mutate: s => { delete s.cases[0].target.controls[0][field]; }, error },
    { name: `wrong control ${field}`, mutate: s => { s.cases[0].target.controls[0][field] = field === 'checked' ? false : field === 'disabled' ? true : 72; }, error },
  );
}
for (const field of ['price', 'buttonDisabled'] as const) {
  const error = field === 'price' ? /price/ : /availability/;
  rejectionCases.push(
    { name: `missing ${field}`, mutate: s => { delete s.cases[0].target[field]; }, error },
    { name: `wrong ${field}`, mutate: s => { s.cases[0].target[field] = field === 'price' ? '$0.01' : true; }, error },
  );
}
test('option gate rejects independently constructed incomplete, stale and misleading evidence', async t => {
  for (const entry of rejectionCases) await t.test(entry.name, async t => {
    const state = await fixture(t, entry.mutate, entry.stage);
    await assert.rejects(() => assertOptionMediaAcceptance(state.out, state.stage), entry.error);
  });
});

// Exercise the real upload entrypoint after its existing executable-evidence gate.
// Reuse the established synthetic fixture; never bypass that gate or fake its result.
async function prepareUploadPrerequisite(state: Fixture) {
  await promisify(childProcess.execFile)(process.env.SITE2SHOP_PYTHON || 'python', [
    '-X', 'utf8', fileURLToPath(new URL('./fixtures/make-evidence-fixture.py', import.meta.url)), state.out, state.build,
  ]);
  await assertExecutableEvidence(state.out, 'source');
  const registry = await recordGeneratorPresentationBindings(state.out);
  const coverage = JSON.parse(await readFile(join(state.out, 'preflight-coverage.json'), 'utf8'));
  for (const entry of registry.entries) coverage.routes[entry.routeId].viewports[entry.viewport][entry.kind][entry.nodeId].presentationBindings = entry.bindings;
  await save(state.out, 'preflight-coverage.json', coverage);
  await runEvidenceNegativeTests(state.out, 'preflight');
  await assertExecutableEvidence(state.out, 'preflight');
}

async function preparePublicationPrerequisite(state: Fixture) {
  await prepareUploadPrerequisite(state);
  const read = async (path: string) => JSON.parse(await readFile(join(state.out, path), 'utf8'));
  const coverage = await read('preflight-coverage.json');
  coverage.stage = 'online';
  coverage.themeId = '99';
  for (const [viewport, result] of Object.entries<any>(coverage.routes.sample.viewports)) {
    const record = result.states.initial;
    const observation = await read(record.target.path);
    observation.themeId = '99';
    record.target = await save(state.out, `online-prerequisite/${viewport}.json`, observation);
    record.negativeTests = {};
  }
  const navigation = await read(coverage.navigation.path);
  navigation.stage = 'online';
  navigation.themeId = '99';
  for (const [id, ref] of Object.entries<any>(navigation.surfaces)) {
    const observation = await read(ref.path);
    observation.themeId = '99';
    navigation.surfaces[id] = await save(state.out, `online-prerequisite/surface-${id}.json`, observation);
  }
  for (const [viewport, ref] of Object.entries<any>(navigation.routes.sample)) {
    const observation = await read(ref.path);
    observation.themeId = '99';
    navigation.routes.sample[viewport] = await save(state.out, `online-prerequisite/route-${viewport}.json`, observation);
  }
  coverage.navigation = await save(state.out, 'online-prerequisite/navigation.json', navigation);
  await save(state.out, 'online-coverage.json', coverage);
  await runEvidenceNegativeTests(state.out, 'online');
  await assertExecutableEvidence(state.out, 'online');
}

function preventExternalWork(t: TestContext, allowLocalChecker: boolean) {
  const attempts: string[] = [], localChecks: string[] = [];
  const originalSpawn = childProcess.spawn;
  const checker = resolve(PROJECT_ROOT, 'scripts/evidence-gates/validate_evidence_coverage.py');
  t.mock.method(childProcess, 'spawn', ((command: string, args: string[], options: any) => {
    if (allowLocalChecker && command === (process.env.SITE2SHOP_PYTHON || 'python') &&
      args[0] === '-X' && args[1] === 'utf8' && resolve(args[2]) === checker) {
      localChecks.push(checker);
      return originalSpawn(command, args, options);
    }
    attempts.push(`spawn:${command}`);
    throw new Error('External command forbidden by option-gate test');
  }) as typeof childProcess.spawn);
  for (const method of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
    t.mock.method(childProcess, method, (() => {
      attempts.push(method); throw new Error('External command forbidden by option-gate test');
    }) as any);
  }
  t.mock.method(globalThis, 'fetch', async () => {
    attempts.push('fetch'); throw new Error('Network forbidden by option-gate test');
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { attempts, localChecks };
}

test('wrong image stops actual upload after prerequisite gates without invoking Shopify', async t => {
  const state = await fixture(t, s => { s.cases[0].target.main = 'https://target.invalid/wrong.png'; });
  await prepareUploadPrerequisite(state);
  const calls = preventExternalWork(t, true);
  try {
    // Require the option error specifically: an unrelated prerequisite failure is not a pass.
    await assert.rejects(() => deploy(state.out, store), /semantic main image differs/);
    assert.equal(calls.localChecks.length, 1, 'the existing local evidence checker must actually run');
  } finally { assert.deepEqual(calls.attempts, []); }
});

test('wrong image stops actual publication after prerequisite gates without invoking Shopify', async t => {
  const state = await fixture(t, s => { s.cases[0].target.main = 'https://target.invalid/wrong.png'; }, 'online');
  await preparePublicationPrerequisite(state);
  const calls = preventExternalWork(t, true);
  try {
    await assert.rejects(() => publishPhase5(state.out, store), /semantic main image differs/);
    assert.equal(calls.localChecks.length, 1, 'the existing local evidence checker must actually run');
  }
  finally { assert.deepEqual(calls.attempts, []); }
});

test('browser option inventory preserves disabled values and can click an implicit label with an input id', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <label><input type="radio" name="Size" value="S" checked>S</label>
      <label><input type="radio" name="Size" value="M" disabled>M unavailable</label>
      <select name="Color"><option>Red</option><option disabled>Blue</option></select>
      <select name="Finish" disabled><option>Matte</option><option>Glossy</option></select>
    </main>`);
    const groups = await inventoryOptionGroups(page.locator('main'));
    assert.deepEqual(groups.map(g => ({ name: g.name, values: g.values, disabledValues: g.disabledValues, disabled: g.disabled })), [
      { name: 'Size', values: ['S'], disabledValues: ['M'], disabled: false },
      { name: 'Color', values: ['Red'], disabledValues: ['Blue'], disabled: false },
      { name: 'Finish', values: [], disabledValues: ['Matte', 'Glossy'], disabled: true },
    ]);
    await page.setContent('<main><label><input id="size-s" type="radio" name="Size" value="S" checked>S</label><label><input id="size-m" type="radio" name="Size" value="M">M</label></main>');
    const [group] = await inventoryOptionGroups(page.locator('main'));
    await selectObservedOption(page.locator('main'), group, 'M');
    assert.equal(await page.locator('#size-m').isChecked(), true);
    await selectObservedOption(page.locator('main'), group, group.baseline);
    assert.equal(await page.locator('#size-s').isChecked(), true);
  } finally { await browser.close(); }
});

test('browser option inventory distinguishes different labels that reuse the same radio value', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <label for="frame-on">Add frame</label><input id="frame-on" type="radio" name="frame" value="on" checked>
      <label for="frame-off">No frame</label><input id="frame-off" type="radio" name="frame" value="on">
    </main>`);
    const [group] = await inventoryOptionGroups(page.locator('main'));
    assert.deepEqual(group.values, ['Add frame', 'No frame']);
    assert.equal(group.baseline, 'Add frame');
    await selectObservedOption(page.locator('main'), group, 'No frame');
    assert.equal(await page.locator('#frame-off').isChecked(), true);
    await selectObservedOption(page.locator('main'), group, group.baseline);
    assert.equal(await page.locator('#frame-on').isChecked(), true);
  } finally { await browser.close(); }
});

test('radio probe falls back to the actual input when a theme label click is intercepted', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <label for="style-a" onclick="event.preventDefault()">Style A</label><input id="style-a" type="radio" name="style" value="A" checked>
      <label for="style-b" onclick="event.preventDefault()">Style B</label><input id="style-b" type="radio" name="style" value="B">
    </main>`);
    const [group] = await inventoryOptionGroups(page.locator('main'));
    await selectObservedOption(page.locator('main'), group, 'B');
    assert.equal(await page.locator('#style-b').isChecked(), true);
  } finally { await browser.close(); }
});
