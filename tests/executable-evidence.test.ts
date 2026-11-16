import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { assertExecutableEvidence, loadEvidencePlan, recordGeneratorPresentationBindings, runEvidenceNegativeTests, saveEvidence, withEvidenceGate } from "../src/evidence-gate.js";
import { packageTheme, compile } from "../src/compiler.js";
import { deploy } from "../src/shopify.js";
import { approveRelease } from "../src/release-approval.js";
import { publishPhase5 } from "../src/phase5-publish.js";
import { assertReviewSystemViewportCoverage } from "../src/product-family-evidence.js";
import { capturePlannedEvidence, PLANNED_COLLECTOR_VERSION } from "../src/planned-capture.js";
import { hash } from "../src/util.js";

const exec = promisify(execFile);
const read = async (out: string, file: string) => JSON.parse(await readFile(join(out, file), "utf8"));
const put = async (out: string, file: string, value: any) => writeFile(join(out, file), JSON.stringify(value));

async function fixture() {
  const out = await mkdtemp(join(tmpdir(), "site2shop-executable-gate-"));
  await mkdir(join(out, "theme/sections"), { recursive: true });
  await writeFile(join(out, "theme/sections/test.liquid"), "<section>TEST ONLY</section>");
  await packageTheme(out);
  const build = await read(out, "theme-build.json");
  await exec(process.env.SITE2SHOP_PYTHON || "python", ["-X", "utf8", "tests/fixtures/make-evidence-fixture.py", out, build.id]);
  await assertExecutableEvidence(out, "source");
  const registry = await recordGeneratorPresentationBindings(out);
  const coverage = await read(out, "preflight-coverage.json");
  for (const entry of registry.entries) coverage.routes[entry.routeId].viewports[entry.viewport][entry.kind][entry.nodeId].presentationBindings = entry.bindings;
  await put(out, "preflight-coverage.json", coverage);
  await runEvidenceNegativeTests(out, "preflight");
  return out;
}

test("actual build/upload/approval/publication entrypoints reject missing plans before external work", async () => {
  const out = await mkdtemp(join(tmpdir(), "site2shop-missing-plan-"));
  try {
    for (const action of [() => compile(out), () => deploy(out, "example.myshopify.com"), () => approveRelease(out, "test"), () => publishPhase5(out, "example.myshopify.com")])
      await assert.rejects(action, /capture-plan.json is missing/);
    await assert.rejects(() => assertReviewSystemViewportCoverage(out), /review-system-evidence.json is missing/);
    await put(out, "review-system-evidence.json", { scope: [], placements: [], status: "passed" });
    await assert.rejects(() => assertReviewSystemViewportCoverage(out), /empty or malformed/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("strict gate accepts valid artifacts, executes negatives, and prevents an action after measured padding drift", async () => {
  const out = await fixture();
  try {
    let actions = 0;
    await withEvidenceGate(out, "preflight", async () => { actions++; });
    assert.equal(actions, 1);
    const coverage = await read(out, "preflight-coverage.json");
    const record = coverage.routes.sample.viewports.mobile.states.initial;
    const data = await read(out, record.target.path);
    data.observations.boxes.widget.paddingTopPx += 40;
    record.target = await saveEvidence(out, JSON.stringify(data), "json");
    record.passed = true;
    record.dataDifference = "empty target reviews must not excuse layout drift";
    await put(out, "preflight-coverage.json", coverage);
    await assert.rejects(() => withEvidenceGate(out, "preflight", async () => { actions++; }), /comparison failed: paddingTopPx/);
    assert.equal(actions, 1);
    await assert.rejects(() => runEvidenceNegativeTests(out, "preflight"), /baseline comparison failed: paddingTopPx/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("missing tablet, changed generator binding, altered build and tampered evidence all fail closed", async () => {
  const out = await fixture();
  try {
    const original = await read(out, "preflight-coverage.json");
    const missing = structuredClone(original);
    delete missing.routes.sample.viewports.tablet;
    await put(out, "preflight-coverage.json", missing);
    await assert.rejects(() => assertExecutableEvidence(out, "preflight"), /coverage does not bind|viewport coverage/);
    const changed = structuredClone(original);
    changed.routes.sample.viewports.mobile.states.initial.presentationBindings.form.mode = "generic-default";
    await put(out, "preflight-coverage.json", changed);
    await assert.rejects(() => assertExecutableEvidence(out, "preflight"), /does not bind generated implementation/);
    await put(out, "preflight-coverage.json", original);
    await writeFile(join(out, "theme/sections/test.liquid"), "<section>unrecorded edit</section>");
    await assert.rejects(() => assertExecutableEvidence(out, "preflight"), /integrity|differ|mismatch|changed/i);
    await writeFile(join(out, "theme/sections/test.liquid"), "<section>TEST ONLY</section>");
    const target = original.routes.sample.viewports.mobile.states.initial.target;
    await writeFile(join(out, target.path), "{}");
    await assert.rejects(() => assertExecutableEvidence(out, "preflight"), /artifact hash mismatch/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("online gate requires independently bound unpublished deployment, not a renamed preflight report", async () => {
  const out = await fixture();
  try {
    const coverage = await read(out, "preflight-coverage.json");
    coverage.stage = "online";
    await put(out, "online-coverage.json", coverage);
    await put(out, "deployment.json", { role: "main", published: true, themeBuild: coverage.buildId, themeId: "draft-A" });
    await assert.rejects(() => assertExecutableEvidence(out, "online"), /wrong\/stale unpublished deployment/);
    await put(out, "deployment.json", { role: "unpublished", published: false, themeBuild: coverage.buildId, themeId: "draft-A" });
    await assert.rejects(() => assertExecutableEvidence(out, "online"), /navigation build\/stage/);
    const { planSha256 } = await loadEvidencePlan(out);
    assert.equal(coverage.planSha256, planSha256);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("formal collector saves real three-viewport captures and refuses password routes without relabeling them", async () => {
  const out = await fixture();
  let passwordPage = false;
  let wrongCanonical = false;
  const build = await read(out, "theme-build.json");
  const server = createServer((request, response) => {
    if (passwordPage) { response.writeHead(200, { "Content-Type": "text/html" }); response.end('<title>Please log in</title><form action="/password">Enter store using password</form>'); return; }
    response.writeHead(200, { "Content-Type": "text/html" });
    const canonical = wrongCanonical ? '/wrong-canonical' : new URL(request.url || '/', 'http://fixture.invalid').pathname;
    response.end(`<html><head><title>Synthetic component test</title><link rel="canonical" href="${canonical}"><meta name="site2shop-build-id" content="${build.id}"></head><body><main><div id="press">Press</div><section id="widget" style="min-height:80px">Reviews<span class="field">option</span></section><footer>Footer</footer></main></body></html>`);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try {
    const port = (server.address() as { port: number }).port;
    const plan = await read(out, "capture-plan.json");
    plan.collectorVersion = PLANNED_COLLECTOR_VERSION;
    const inventory = await read(out, plan.routeInventory.path);
    inventory.collectorVersion = PLANNED_COLLECTOR_VERSION;
    for (const [id, ref] of Object.entries<any>(inventory.surfaces)) {
      const surface = await read(out, ref.path);
      surface.collectorVersion = PLANNED_COLLECTOR_VERSION;
      inventory.surfaces[id] = await saveEvidence(out, JSON.stringify(surface), "json");
    }
    inventory.routes.sample.localTarget = { url: `http://127.0.0.1:${port}/sample`, finalUrl: `http://127.0.0.1:${port}/sample`, canonical: `http://127.0.0.1:${port}/sample`, redirectChain: [`http://127.0.0.1:${port}/sample`] };
    plan.routeInventory = await saveEvidence(out, JSON.stringify(inventory), "json");
    const route = plan.routes.sample;
    route.localTarget = { url: `http://127.0.0.1:${port}/sample`, canonical: `http://127.0.0.1:${port}/sample` };
    route.captureSequence = [];
    route.states.initial.capture = { target: {
      ready: { selector: "#widget", state: "visible" },
      components: { form: { selector: "#widget", parent: { id: "content", selector: "main" }, previous: { id: "press", selector: "#press" }, next: { id: "footer", selector: "footer" } } },
      observations: [{ pointer: "/fields", selector: ".field", read: "texts" }],
    } };
    await put(out, "capture-plan.json", plan);
    const source = await read(out, "source-coverage.json");
    source.planSha256 = hash(await readFile(join(out, "capture-plan.json")));
    for (const vp of Object.values<any>(source.routes.sample.viewports)) {
      const record = vp.states.initial, data = await read(out, record.source.path);
      data.collectorVersion = PLANNED_COLLECTOR_VERSION;
      record.source = await saveEvidence(out, JSON.stringify(data), "json");
    }
    await put(out, "source-coverage.json", source);
    await recordGeneratorPresentationBindings(out);
    const coverage = await capturePlannedEvidence(out, "target", "preflight");
    for (const [vp, dims] of Object.entries<any>(plan.viewports)) {
      const record = coverage.routes.sample.viewports[vp].states.initial;
      const data = await read(out, record.target.path);
      assert.deepEqual(data.observations.presentationContext.cssViewport, dims);
      assert.equal(data.pageKind, "content");
      assert.equal(data.observations.boxes.widget.widthPx, dims.width - 16);
      assert.equal(data.requestedUrl, route.localTarget.url);
      assert.ok(data.artifacts.screenshot.sha256);
      assert.ok(data.artifacts.fullScreenshot.sha256);
      assert.ok(data.documentSize.width >= dims.width && data.documentSize.height >= dims.height);
    }
    assert.equal((await read(out, "preflight-capture-result.json")).acceptance, "not-run");
    const reused = await capturePlannedEvidence(out, "target", "preflight");
    assert.deepEqual((await read(out, "preflight-capture-result.json")).stats, { reusedWorkflows: 3, capturedWorkflows: 0, totalWorkflows: 3 });
    for (const vp of Object.keys(plan.viewports)) assert.deepEqual(reused.routes.sample.viewports[vp].states.initial.target, coverage.routes.sample.viewports[vp].states.initial.target);
    const damaged = await read(out, reused.routes.sample.viewports.mobile.states.initial.target.path);
    await writeFile(join(out, damaged.artifacts.screenshot.path), "corrupt cache screenshot");
    await capturePlannedEvidence(out, "target", "preflight");
    assert.deepEqual((await read(out, "preflight-capture-result.json")).stats, { reusedWorkflows: 2, capturedWorkflows: 1, totalWorkflows: 3 });
    await capturePlannedEvidence(out, "target", "preflight", { precheckOnly: true });
    const precheckResult = await read(out, "preflight-capture-result.json");
    assert.equal(precheckResult.captureComplete, false);
    assert.equal(precheckResult.stats.capturedWorkflows, 0);
    assert.equal((await read(out, "preflight-precheck.json")).passed, true);
    wrongCanonical = true;
    await assert.rejects(() => capturePlannedEvidence(out, "target", "preflight"), /canonical/);
    wrongCanonical = false;
    passwordPage = true;
    await assert.rejects(() => capturePlannedEvidence(out, "target", "preflight"), /storefront password page/);
    const failed = await read(out, "preflight-coverage.json");
    assert.ok(Object.values<any>(failed.routes.sample.viewports).every(vp => vp.states.initial.status === "failed" && !vp.states.initial.target));
    assert.equal((await read(out, "preflight-capture-result.json")).stats.capturedWorkflows, 0);
    passwordPage = false;
    await capturePlannedEvidence(out, "target", "preflight");
    assert.equal((await read(out, "preflight-capture-result.json")).stats.reusedWorkflows, 3, "failed precheck must not erase completed workflow caches");
  } finally {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await rm(out, { recursive: true, force: true });
  }
});

test("source-only provenance allows a target plan revision but rejects changed source contracts", async () => {
  const out = await fixture();
  try {
    const plan = await read(out, "capture-plan.json");
    const originalPlan = await saveEvidence(out, await readFile(join(out, "capture-plan.json")), "json");
    const coverage = await read(out, "source-coverage.json");
    const before = coverage.routes.sample.viewports.desktop.states.initial.source;
    // Old evidence must retain its real revision and timestamp.
    plan.revision++;
    plan.routes.sample.states.initial.generatorBindings.form.owner += ".target-only-change";
    await put(out, "capture-plan.json", plan);
    coverage.planSha256 = hash(await readFile(join(out, "capture-plan.json")));
    for (const slot of Object.values<any>(coverage.routes.sample.viewports)) slot.sourceProvenance = originalPlan;
    await put(out, "source-coverage.json", coverage);
    await assertExecutableEvidence(out, "source");
    assert.equal((await read(out, before.path)).revision, plan.revision - 1);
    const { verifySourceProvenance } = await import("../src/capture-cache.js");
    const analysis = await read(out, plan.analysis.path);
    await verifySourceProvenance(out, plan, analysis, "sample", "desktop", originalPlan);
    plan.sourceRevision = "changed-source-content";
    await put(out, "capture-plan.json", plan);
    coverage.planSha256 = hash(await readFile(join(out, "capture-plan.json")));
    await put(out, "source-coverage.json", coverage);
    await assert.rejects(() => assertExecutableEvidence(out, "source"), /source provenance contract changed/);
    await assert.rejects(() => verifySourceProvenance(out, plan, analysis, "sample", "desktop", originalPlan), /source provenance contract changed/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("build hashing is deterministic for punctuation and mixed-case theme filenames", async () => {
  const out = await mkdtemp(join(tmpdir(), "site2shop-hash-order-"));
  try {
    await mkdir(join(out, "theme/assets"), { recursive: true });
    for (const name of ["a-z.js", "a_z.js", "Z.css", "z2.css"]) await writeFile(join(out, "theme/assets", name), name);
    await packageTheme(out);
    const { assertGeneratedThemeIntegrity } = await import("../src/theme-integrity.js");
    await assert.doesNotReject(() => assertGeneratedThemeIntegrity(out));
  } finally { await rm(out, { recursive: true, force: true }); }
});
