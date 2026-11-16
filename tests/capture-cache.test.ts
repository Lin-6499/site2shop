import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicJson, captureCacheKey, loadCaptureCache, saveCaptureCache, sourceCaptureContract, stable } from "../src/capture-cache.js";
import { saveEvidence } from "../src/evidence-gate.js";
import { assertCaptureAdapters } from "../src/planned-capture.js";

const config = { ready: { selector: "#next:visible", state: "visible" }, components: { form: { selector: "form" } }, observations: [] };
const node = () => ({ components: ["form"], capture: { source: structuredClone(config), target: structuredClone(config) }, rules: [{ sourcePointer: "/field", targetPointer: "/field" }] });
function fixture() {
  return {
    plan: { schemaVersion: 2, planId: "sample", revision: 1, contractVersion: "1", collectorVersion: "1", limits: { maxActionsPerRoute: 4 },
      viewports: { desktop: { width: 1920, height: 1080 } },
      routes: { sample: { source: { url: "https://source.example/" }, target: { url: "https://target.example/" },
        states: { initial: node(), next: node() }, transitions: { next: { ...node(), from: "initial", to: "next", action: "next", condition: "ready", probe: { source: [{ op: "click", selector: "#next", effect: "read-only" }], target: [{ op: "click", selector: "#next", effect: "read-only" }] } } }, captureSequence: ["next"] } } },
    analysis: { routes: [{ id: "sample", components: [{ id: "form", acceptance: { sourcePointer: "/form", targetPointer: "/form" } }] }] },
  };
}
test("source cache ignores target-only changes; every source recipe, viewport, version and workflow change invalidates", () => {
  const { plan, analysis } = fixture();
  const signature = (p: any) => stable(sourceCaptureContract(p, analysis, "sample", "desktop"));
  const baseline = signature(plan);
  const target = structuredClone(plan);
  target.revision++;
  target.routes.sample.target.url += "new";
  target.routes.sample.states.initial.capture.target.ready.selector = "#fixed-target";
  assert.equal(signature(target), baseline);
  for (const mutate of [
    (p: any) => p.routes.sample.states.initial.capture.source.ready.selector = "#new-source",
    (p: any) => p.routes.sample.transitions.next.probe.source[0].selector = "#new-action",
    (p: any) => p.routes.sample.transitions.next.probe.source[0].value = { target: "source-owned-input" },
    (p: any) => p.routes.sample.captureSequence = [],
    (p: any) => p.viewports.desktop.width++, (p: any) => p.collectorVersion = "2",
    (p: any) => p.sourceRevision = "refreshed-content",
  ]) {
    const p = structuredClone(plan); mutate(p); assert.notEqual(signature(p), baseline);
  }
  assert.notEqual(captureCacheKey(baseline, "runtime", "preflight", "build1", null), captureCacheKey(baseline, "runtime", "preflight", "build2", null));
});

test("complete cache resumes; partial, aged, changed-content, corrupted and orphan artifacts cannot pass", async () => {
  const out = await mkdtemp(join(tmpdir(), "capture-cache-test-"));
  try {
    const dom = await saveEvidence(out, "<main>test</main>", "html");
    const ref = await saveEvidence(out, JSON.stringify({ artifacts: { dom } }), "json");
    const result = { states: { initial: { source: ref } }, transitions: {} };
    const key = "a".repeat(64), path = join(out, "planned-evidence/cache", `${key}.json`);
    await saveCaptureCache(out, key, "fresh", result);
    assert.ok((await loadCaptureCache(out, key, "fresh", 60000)).entry);
    assert.equal((await loadCaptureCache(out, key, "changed", 60000)).entry, null);
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const mutation of [{ complete: false }, { completedAt: "2000-01-01T00:00:00Z" }, { completedAt: "2999-01-01T00:00:00Z" }, { result: { ...result, captureFailure: { status: "failed" } } }]) {
      await atomicJson(path, { ...original, ...mutation });
      assert.equal((await loadCaptureCache(out, key, "fresh", 60000)).entry, null);
    }
    await atomicJson(path, original);
    await writeFile(join(out, dom.path), "tampered");
    assert.equal((await loadCaptureCache(out, key, "fresh", 60000)).entry, null);
    await rm(join(out, dom.path));
    assert.equal((await loadCaptureCache(out, key, "fresh", 60000)).entry, null);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("adapter precheck rejects omitted states, unsupported operations and broken graphs before opening a browser", () => {
  const { plan } = fixture();
  assert.doesNotThrow(() => assertCaptureAdapters(plan, "source"));
  for (const mutate of [
    (p: any) => p.routes.sample.captureSequence = [],
    (p: any) => p.routes.sample.transitions.next.probe.source[0].op = "unsupported",
    (p: any) => p.routes.sample.transitions.next.from = "next",
    (p: any) => delete p.routes.sample.states.next.capture.source,
  ]) {
    const p = structuredClone(plan); mutate(p);
    assert.throws(() => assertCaptureAdapters(p, "source"), /Evidence gate blocked/);
  }
});
