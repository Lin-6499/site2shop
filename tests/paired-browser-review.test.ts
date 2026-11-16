import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { assertPairedBrowserReview } from "../src/paired-browser-review.js";
import { assertAgentVisualReview, computeAgentVisualEvidenceDigest } from "../src/agent-visual-review.js";
import { preparePairedReview, prepareVisualSummary, submitReview } from "../src/visual-review-workflow.js";
import { REVIEW_ASPECTS } from "../src/visual-review-protocol.js";
import { deploy } from "../src/shopify.js";
import { approveRelease } from "../src/release-approval.js";
import { publishPhase5 } from "../src/phase5-publish.js";

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
async function fixture(stage: "preflight" | "online" = "preflight") {
  const out = await mkdtemp(join(tmpdir(), "paired-browser-gate-test-"));
  const put = async (path: string, data: any) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    await writeFile(join(out, path), bytes);
    return { path, sha256: sha(bytes) };
  };
  const read = async (ref: any) => JSON.parse(await readFile(join(out, ref.path), "utf8"));
  // Deliberately synthetic checker fixtures, never storefront acceptance evidence.
  const rules = [{ id: "form-width", operator: "numeric", sourcePointer: "/presentationRaw/form/box/width", targetPointer: "/presentationRaw/form/box/width", tolerance: { absolute: 2, relative: 0 } }];
  const plan: any = {
    schemaVersion: 2, planId: "fixture", revision: 1, contractVersion: "test-1", collectorVersion: "test-1",
    analysis: await put("analysis.json", { synthetic: true, routes: [{ id: "house", components: [{ id: "form", acceptance: { kind: "rendered" } }] }] }),
    viewports: { desktop: { width: 60, height: 40 }, tablet: { width: 40, height: 60 }, mobile: { width: 20, height: 50 } },
    routes: { house: { family: "house", source: { url: "https://source.example/products/house", canonical: "https://source.example/products/house" }, target: { url: "https://target.example/products/house", canonical: "https://target.example/products/house" },
      captureSequence: ["next", "previous"],
      states: { initial: { components: ["form"], rules }, size: { components: ["form"], rules } },
      transitions: { next: { from: "initial", to: "size", action: "click next", condition: "initial selections", components: ["form"] }, previous: { from: "size", to: "initial", action: "click previous", condition: "size selections", components: ["form"] } },
    } },
  };
  for (const [id, node] of Object.entries<any>(plan.routes.house.transitions)) node.probe = Object.fromEntries(["source", "target"].map(side => [side, [{ op: "click", selector: `#${side}-${id}`, effect: "read-only" }]]));
  const planRef = await put("capture-plan.json", plan);
  await put("theme-build.json", { id: "build-A" });
  await put("deployment.json", { themeId: "draft-A", themeBuild: "build-A" });
  const report: any = { schemaVersion: 2, stage, mode: "agent-operated-paired-browser", planSha256: planRef.sha256, planRevision: 1, themeBuild: "build-A", themeId: "draft-A", reviewer: { kind: "skill-agent", skill: "shopify-site-replication" }, findings: [], sessions: [], passed: true };
  const dom = await put("fixture-dom.html", "<form>synthetic test</form>");
  let serial = 0;
  for (const [viewport, dimensions] of Object.entries<any>(plan.viewports)) {
    const screenshot = await put(`${viewport}.png`, await sharp({ create: { ...dimensions, channels: 3, background: "white" } }).png().toBuffer());
    const fullScreenshot = await put(`${viewport}-full.png`, await sharp({ create: { width: dimensions.width, height: dimensions.height * 2, channels: 3, background: "white" } }).png().toBuffer());
    const session: any = { routeId: "house", viewport, checks: [] };
    for (const [kind, id] of [["states", "initial"], ["transitions", "next"], ["states", "size"], ["transitions", "previous"]]) {
      const node = plan.routes.house[kind][id], transition = kind === "transitions";
      const base = Date.UTC(2026, 0, 1) + serial++ * 10000;
      const time = (offset: number) => new Date(base + offset).toISOString();
      const comparison: any = { id: "form", verdict: "pass", rationale: "Synthetic paired form comparison", evidence: [], aspects: Object.fromEntries(REVIEW_ASPECTS.map(a => [a, { verdict: "pass", source: `Synthetic source ${a} observation`, target: `Synthetic target ${a} observation` }])) };
      const check: any = { kind, id, before: {}, after: {}, reviewedAt: time(9000), inspectedImages: [screenshot.path], components: [comparison], verdict: "pass", rationale: "Synthetic paired observation" };
      for (const side of ["source", "target"]) for (const phase of transition ? ["before", "after"] : ["before"]) {
        const observations = { components: { form: { presence: "visible" } }, presentationRaw: { form: { box: { width: 20, height: 10 }, computed: { display: "flex", overflowX: "hidden" } } } };
        const c = { schemaVersion: 2, planId: plan.planId, revision: 1, contractVersion: plan.contractVersion, collectorVersion: plan.collectorVersion,
          routeId: "house", kind: "states", nodeId: !transition ? id : phase === "before" ? node.from : node.to, side, viewport: { name: viewport, ...dimensions }, capturedAt: time(phase === "before" ? 0 : 4000),
          requestedUrl: plan.routes.house[side].url, finalUrl: plan.routes.house[side].url, canonical: plan.routes.house[side].canonical, httpStatus: 200, pageKind: "content", buildId: "build-A", themeId: "draft-A",
          observations, documentSize: { width: dimensions.width, height: dimensions.height * 2 }, artifacts: { dom, screenshot, fullScreenshot } };
        check[phase][side] = await put(`${viewport}-${kind}-${id}-${phase}-${side}.json`, c);
        for (const [pointer, value] of [["/components/form", observations.components.form], ["/presentationRaw/form/box", observations.presentationRaw.form.box], ["/presentationRaw/form/computed", observations.presentationRaw.form.computed]]) comparison.evidence.push({ phase, side, pointer, value });
      }
      const inspection = async (phase: string, at: string, full = false) => put(`${viewport}-${kind}-${id}-${phase}-inspection.json`, {
        schemaVersion: 1, method: "direct-paired-image-and-dom", stage, planSha256: planRef.sha256, themeBuild: "build-A", routeId: "house", viewport, kind, nodeId: id, phase, inspectedAt: at, notes: "Synthetic explicit inspection observations",
        images: ["source", "target"].flatMap(side => [{ side, region: "viewport", image: screenshot }, ...(full ? [{ side, region: "full", image: fullScreenshot }] : [])]),
      });
      check.inspection = await inspection("after", check.reviewedAt, id === "initial");
      if (transition) {
        check.beforeInspection = await inspection("before", time(500));
        const action: any = { action: node.action, from: node.from, to: node.to, condition: node.condition, input: [{ op: "click" }] };
        for (const side of ["source", "target"]) {
          const startedAt = time(side === "source" ? 1000 : 2100), endedAt = time(side === "source" ? 2000 : 3000);
          const trace = await put(`${viewport}-${id}-${side}-trace.json`, { ...node, status: "performed", actualBefore: check.before[side], actualAfter: check.after[side], actionLog: [{ ...node.probe[side][0], startedAt, endedAt }], blockedWrites: [] });
          action[side] = { status: "performed", control: `#${side}-${id}`, input: action.input, startedAt, endedAt, trace };
        }
        check.actionLog = await put(`${viewport}-${id}-action.json`, action);
      }
      session.checks.push(check);
    }
    report.sessions.push(session);
  }
  const save = () => put(`paired-browser-review.${stage}.json`, report);
  const mutateArtifact = async (ref: any, change: (value: any) => void) => {
    const value = await read(ref); change(value); Object.assign(ref, await put(ref.path, value));
  };
  const summary = async () => {
    const paired = await assertPairedBrowserReview(out, stage, "build-A"), evidence = await computeAgentVisualEvidenceDigest(out,stage);
    const review = { schemaVersion: 3, stage, themeBuild: "build-A", reviewer: report.reviewer, evidenceDigest: evidence.digest, evidenceFiles: evidence.files, planSha256: paired.planSha256, planRevision: 1, pairedBrowserReview: paired.artifact, passed: true,
      reviewedAt: "2026-01-02T00:00:00Z", issues: [], decisions: Object.keys(plan.viewports).map(viewport => ({ routeId: "house", family: "house", viewport, inspectedRegions: ["viewport", "full"], inspectedStateIds: ["initial", "size"], inspectedTransitionIds: ["next", "previous"], verdict: "pass", rationale: "Synthetic summary", acceptedDeviations: [] })) };
    await put(`agent-visual-review.${stage}.json`, review); return review;
  };
  await save();
  return { out, plan, report, save, put, read, mutateArtifact, summary };
}
const cleanup = (out: string) => rm(out, { recursive: true, force: true });

test("paired gate accepts explicit synthetic three-device per-operation sessions", async () => {
  const f = await fixture();
  try { await assertPairedBrowserReview(f.out, "preflight", "build-A"); }
  finally { await cleanup(f.out); }
});

test("paired gate rejects blanket pass, missing judgments and incomplete independent coverage", async () => {
  const f = await fixture(), original = structuredClone(f.report);
  const cases: Array<[string, (r: any) => void]> = [
    ["legacy schema", r => r.schemaVersion = 1],
    ["batch review", r => r.sessions[0].checks[0].reviewedAt = r.sessions[0].checks[1].reviewedAt],
    ["missing side", r => { delete r.sessions[0].checks[1].after.target; }],
    ["missing state", r => r.sessions[0].checks.splice(2, 1)],
    ["missing reverse", r => r.sessions[0].checks.pop()],
    ["missing viewport", r => r.sessions.pop()],
    ["duplicate check", r => r.sessions[0].checks.push(r.sessions[0].checks[0])],
    ["wrong order", r => r.sessions[0].checks.reverse()],
    ["not inspected", r => r.sessions[0].checks[1].inspectedImages = []],
    ["no inspection record", r => { delete r.sessions[0].checks[0].inspection; }],
    ["no before inspection", r => { delete r.sessions[0].checks[1].beforeInspection; }],
    ["unchecked component", r => r.sessions[0].checks[0].components = []],
    ["presence-only", r => { delete r.sessions[0].checks[0].components[0].aspects; }],
    ["missing styling judgment", r => r.sessions[0].checks[0].components[0].aspects.styling.target = ""],
    ["missing measurements", r => r.sessions[0].checks[0].components[0].evidence = []],
    ["false measurement", r => r.sessions[0].checks[0].components[0].evidence[0].value = { presence: "absent" }],
    ["layout mismatch", r => r.sessions[0].checks[0].components[0].verdict = "fail"],
    ["stale build", r => r.themeBuild = "older"],
    ["stale plan", r => r.planSha256 = "a".repeat(64)],
    ["script-only review", r => r.mode = "automatic-clicks-only"],
    ["unresolved", r => r.findings.push({ id: "D1", status: "open" })],
    ["unretested fix", r => r.findings.push({ id: "D1", status: "resolved", retestedBuild: "build-A", retestCheckId: "missing", routeId: "house", viewport: "desktop" })],
    ["future", r => r.sessions[0].checks[0].reviewedAt = "2999-01-01T00:00:00Z"],
  ];
  try {
    for (const [label, mutate] of cases) {
      Object.assign(f.report, structuredClone(original)); mutate(f.report); await f.save();
      await assert.rejects(() => assertPairedBrowserReview(f.out, "preflight", "build-A"), Error, label);
    }
  } finally { await cleanup(f.out); }
});

test("paired frame rules and artifacts independently reject drift despite green judgments", async () => {
  for (const [label, change] of [
    ["password", (c: any) => c.pageKind = "password"],
    ["wrong route", (c: any) => c.finalUrl = "https://target.example/"],
    ["wrong canonical", (c: any) => c.canonical = "https://target.example/"],
    ["wrong viewport", (c: any) => c.viewport.width++],
    ["missing component", (c: any) => c.observations.components.form.presence = "absent"],
    ["extra component", (c: any) => c.observations.components.stray = { presence: "visible" }],
    ["layout drift", (c: any) => c.observations.presentationRaw.form.box.width = 50],
    ["absent style measurements", (c: any) => { delete c.observations.presentationRaw.form.computed; }],
    ["unmeasured full page", (c: any) => { delete c.documentSize; }],
    ["tampered file", (c: any) => c.artifacts.screenshot.sha256 = "0".repeat(64)],
    ["missing full page", (c: any) => { delete c.artifacts.fullScreenshot; }],
    ["wrong full dimensions", (c: any) => c.artifacts.fullScreenshot = { path: "mobile.png", sha256: "0".repeat(64) }],
  ] as const) {
    const f = await fixture();
    try {
      await f.mutateArtifact(f.report.sessions[0].checks[0].before.target, change); await f.save();
      await assert.rejects(() => assertPairedBrowserReview(f.out, "preflight", "build-A"), Error, label);
    } finally { await cleanup(f.out); }
  }
});

test("actual trace and direct inspection records cannot be replaced by synthesized action envelopes", async () => {
  for (const mutation of ["missing-trace", "wrong-input", "trace-input", "wrong-control", "wrong-frames", "blocked-write", "wrong-inspection", "missing-full-inspection", "late-before", "old-target"] as const) {
    const f = await fixture();
    try {
      const check = f.report.sessions[0].checks[1];
      if (mutation === "wrong-inspection" || mutation === "missing-full-inspection") {
        await f.mutateArtifact(f.report.sessions[0].checks[0].inspection, c => {
          if (mutation === "wrong-inspection") c.nodeId = "other";
          else c.images = c.images.filter((i: any) => i.region !== "full");
        });
      } else if (mutation === "late-before") await f.mutateArtifact(check.beforeInspection, c => c.inspectedAt = check.reviewedAt);
      else if (mutation === "old-target") await f.mutateArtifact(check.before.target, c => c.capturedAt = "2025-01-01T00:00:00Z");
      else {
        const action = await f.read(check.actionLog);
        if (mutation === "missing-trace") delete action.target.trace;
        else if (mutation === "wrong-input") action.target.input = [{ op: "fill", value: "different" }];
        else await f.mutateArtifact(action.target.trace, trace => {
          if (mutation === "trace-input") trace.actionLog[0].op = "fill";
          else if (mutation === "wrong-control") trace.actionLog[0].selector = "#unrelated-control";
          else if (mutation === "wrong-frames") trace.actualAfter = trace.actualBefore;
          else trace.blockedWrites = ["POST /cart/add"];
        });
        Object.assign(check.actionLog, await f.put(check.actionLog.path, action));
      }
      await f.save();
      await assert.rejects(() => assertPairedBrowserReview(f.out, "preflight", "build-A"), Error, mutation);
    } finally { await cleanup(f.out); }
  }
});

test("online gate rejects wrong draft theme", async () => {
  const f = await fixture("online");
  try {
    await assertPairedBrowserReview(f.out, "online", "build-A");
    f.report.themeId = "live-theme"; await f.save();
    await assert.rejects(() => assertPairedBrowserReview(f.out, "online", "build-A"), /wrong deployed build\/theme/);
  } finally { await cleanup(f.out); }
});

test("summary scope derives from plan, not successful audit rows, and cannot waive missing evidence", async () => {
  const f = await fixture();
  try {
    await f.put("product-family-visual-audit.json", { comparisons: [] });
    const review: any = await f.summary();
    await assertAgentVisualReview(f.out, "preflight");
    for (const change of [
      (r: any) => r.schemaVersion = 2,
      (r: any) => r.decisions = [],
      (r: any) => r.decisions.pop(),
      (r: any) => r.decisions.push(r.decisions[0]),
      (r: any) => r.decisions[0].inspectedTransitionIds = [],
      (r: any) => r.decisions[0].inspectedStateIds = ["initial"],
      (r: any) => r.decisions[0].inspectedRegions = ["viewport"],
      (r: any) => r.decisions[0].acceptedDeviations = ["ignore layout"],
      (r: any) => r.issues = [{ id: "untracked" }],
      (r: any) => r.reviewedAt = "2025-01-01T00:00:00Z",
    ]) {
      const invalid = structuredClone(review); change(invalid); await f.put("agent-visual-review.preflight.json", invalid);
      await assert.rejects(() => assertAgentVisualReview(f.out, "preflight"));
    }
    f.report.sessions[0].checks.pop(); await f.save();
    const changed = await computeAgentVisualEvidenceDigest(f.out,'preflight');
    review.evidenceDigest = changed.digest; await f.put("agent-visual-review.preflight.json", review);
    await assert.rejects(() => assertAgentVisualReview(f.out, "preflight"), /missing planned state\/transition/);
  } finally { await cleanup(f.out); }
});

test("prepare writes pending scope only, refuses overwrite, and cannot authorize release", async () => {
  const f = await fixture();
  try {
    const input = await preparePairedReview(f.out, "preflight"), data = JSON.parse(await readFile(input, "utf8"));
    assert.equal(data.passed, false); assert.equal(data.sessions.length, 3);
    assert.ok(data.sessions.every((s: any) => s.checks.every((c: any) => c.verdict === "pending" && c.reviewedAt === null && c.inspection === null)));
    await assert.rejects(() => preparePairedReview(f.out, "preflight"), /EEXIST/);
    const summary = await prepareVisualSummary(f.out, "preflight"), pending = JSON.parse(await readFile(summary, "utf8"));
    assert.equal(pending.passed, false); assert.equal(pending.decisions.length, 3);
    await assert.rejects(() => submitReview(f.out, "preflight", "paired", input));
    await assert.rejects(() => assertPairedBrowserReview(f.out, "preflight", "build-A"));
    const record = await f.read({ path: "paired-review-work/preflight/paired-submission.json" });
    assert.equal(record.status, "blocked"); assert.ok(record.previous.sha256);
  } finally { await cleanup(f.out); }
});

test('online capture artifacts do not invalidate an unchanged preflight agent review',async()=>{
  const f=await fixture('preflight');
  try{await f.summary();const before=await computeAgentVisualEvidenceDigest(f.out,'preflight');await f.put('online-coverage.json',{stage:'online',pending:true});await f.put('paired-browser-review.online.json',{stage:'online',pending:true});const after=await computeAgentVisualEvidenceDigest(f.out,'preflight');assert.equal(after.digest,before.digest);await assertAgentVisualReview(f.out,'preflight');}
  finally{await cleanup(f.out);}
});

test("failed resubmission cannot erase findings or leave an old green report active", async () => {
  const f = await fixture();
  try {
    const candidate = await f.put("explicit.json", f.report);
    f.report.findings.push({ id: "D1", description: "Known mismatch", status: "open" }); await f.save();
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(() => submitReview(f.out, "preflight", "paired", join(f.out, candidate.path)), /cannot disappear/);
      const saved = await f.read({ path: "paired-browser-review.preflight.json" });
      assert.equal(saved.passed, false); assert.equal(saved.findings[0].id, "D1");
    }
    f.report.findings[0] = { id: "D1", description: "Known mismatch", status: "resolved", routeId: "house", viewport: "desktop", componentId: "form", retestedBuild: "build-A", retestKind: "transitions", retestCheckId: "next" };
    await f.put("explicit.json", f.report);
    const result = await submitReview(f.out, "preflight", "paired", join(f.out, "explicit.json"));
    assert.equal(result.releaseAuthorized, false); assert.equal(result.status, "validated-review-only");
  } finally { await cleanup(f.out); }
});

test("actual upload, approval and publication entrypoints block missing or blanket visual reviews", async () => {
  for (const stage of ["preflight", "online"] as const) {
    const f = await fixture(stage);
    const entrypoints = stage === "preflight" ? [() => deploy(f.out, "example.myshopify.com")]
      : [() => approveRelease(f.out, "test-only"), () => publishPhase5(f.out, "example.myshopify.com")];
    try {
      for (const action of entrypoints) await assert.rejects(action, /visual-review.*is missing/);
      const summary: any = await f.summary();
      f.report.sessions[0].checks[1].components[0].aspects.layout.verdict = "fail";
      await f.save();
      summary.evidenceDigest = (await computeAgentVisualEvidenceDigest(f.out,stage)).digest;
      await f.put(`agent-visual-review.${stage}.json`, summary);
      for (const action of entrypoints) await assert.rejects(action, /layout judgment/);
      await assert.rejects(() => readFile(join(f.out, "release-approval.json")), /ENOENT/);
    } finally { await cleanup(f.out); }
  }
});
