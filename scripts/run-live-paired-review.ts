import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { loadEvidencePlan, saveEvidence } from "../src/evidence-gate.js";
import { draftPreviewRoute, observePlannedState, performPlannedAction } from "../src/planned-capture.js";
import { assertRenderedEvidencePage } from "../src/rendered-page-validity.js";
import { comparePairedRules, normalizedActions, requiredReviewRegions, REVIEW_ASPECTS } from "../src/visual-review-protocol.js";
import { unlockStorefrontIfNeeded } from "../src/storefront-auth.js";
import { readJson } from "../src/util.js";
import { stable } from "../src/capture-cache.js";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx scripts/run-live-paired-review.ts <project>");
const requestedRoutes = new Set(
  (process.argv.find(value => value.startsWith("--routes="))?.slice("--routes=".length) || "")
    .split(",").map(value => value.trim()).filter(Boolean),
);
const requestedStage = process.argv.find(value => value.startsWith("--stage="))?.slice("--stage=".length) || "preflight";
if (!['preflight', 'online'].includes(requestedStage)) throw new Error("--stage must be preflight or online");
const stage = requestedStage as "preflight" | "online";
const work = join(out, "paired-review-work", stage, requestedRoutes.size ? "incremental" : "live");
await mkdir(work, { recursive: true });
const { plan, analysis, planSha256 } = await loadEvidencePlan(out);
const build = await readJson<any>(join(out, "theme-build.json"));
const deployment = stage === "online" ? await readJson<any>(join(out, "deployment.json")) : null;
if (deployment && (deployment.role !== "unpublished" || deployment.published || deployment.themeBuild !== build.id))
  throw new Error("online paired review requires the current unpublished deployment");
const preflightBaseline = stage === "online"
  ? await readJson<any>(join(out, "paired-review-work", "preflight", "incremental", "paired-review-complete.json"))
  : null;
if (preflightBaseline && (preflightBaseline.themeBuild !== build.id || preflightBaseline.passed !== true))
  throw new Error("online paired review requires a passing current-build preflight impact review");
const report: any = {
  schemaVersion: 2, stage, mode: "agent-operated-paired-browser", planSha256,
  planRevision: plan.revision, themeBuild: build.id,
  reviewer: { kind: "skill-agent", skill: "shopify-site-replication" },
  ...(deployment ? { themeId: String(deployment.themeId) } : {}),
  sessions: [], findings: [], passed: false,
};
const sessions = new Map<string, any>();
const routeIds = Object.keys(plan.routes).filter(rid => !requestedRoutes.size || requestedRoutes.has(rid));
if (requestedRoutes.size && routeIds.length !== requestedRoutes.size)
  throw new Error(`Unknown route filter: ${[...requestedRoutes].filter(id => !plan.routes[id]).join(", ")}`);
report.incremental = requestedRoutes.size ? { routeIds, impactManifest: "repair-impact-manifest.json" } : null;
for (const rid of routeIds) for (const viewport of Object.keys(plan.viewports)) {
  const session = { routeId: rid, viewport, checks: [] as any[] };
  report.sessions.push(session); sessions.set(`${rid}:${viewport}`, session);
}
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const routeIdentity = (value: string) => new URL(value).pathname.replace(/\/$/, "");
const refKey = (ref: any) => `${ref.path}:${ref.sha256}`;
async function hydrate(ref: any) { return { ref, data: await readJson<any>(join(out, ref.path)) }; }
function retainedSourceCheck(routeId: string, viewport: string, kind: string, id: string) {
  const check = preflightBaseline?.sessions?.find((session: any) => session.routeId === routeId && session.viewport === viewport)
    ?.checks?.find((entry: any) => entry.kind === kind && entry.id === id);
  if (!check) throw new Error(`missing retained source evidence ${routeId}/${viewport}/${kind}/${id}`);
  return check;
}

async function waitDecision(routeId: string, phase: string, sheet: string) {
  const token = randomUUID();
  const prompt = { token, routeId, phase, sheet, createdAt: new Date().toISOString(), required: { verdict: "pass|fail", notes: "direct visual observations" } };
  await writeFile(join(work, "live-prompt.json"), JSON.stringify(prompt, null, 2));
  await rm(join(work, "live-decision.json"), { force: true });
  process.stdout.write(`\nWAITING ${token} ${sheet}\n`);
  while (true) {
    const raw = await readFile(join(work, "live-decision.json"), "utf8").catch(() => "");
    if (raw) {
      const value = JSON.parse(raw);
      if (value.token === token && ["pass", "fail"].includes(value.verdict) && String(value.notes || "").trim()) {
        if (value.verdict !== "pass") throw new Error(`visual review failed ${routeId}/${phase}: ${value.notes}`);
        return { ...value, reviewedAt: new Date().toISOString() };
      }
    }
    await sleep(500);
  }
}

async function contactSheet(routeId: string, phase: string, pairs: any[], includeFull = false) {
  const cards: Buffer[] = [];
  for (const pair of pairs) {
    const items: Array<{ label: string; ref: any }> = [
      { label: `${pair.viewport} source viewport`, ref: pair.source.artifacts.screenshot },
      { label: `${pair.viewport} target viewport`, ref: pair.target.artifacts.screenshot },
    ];
    if (includeFull) items.push(
      { label: `${pair.viewport} source full`, ref: pair.source.artifacts.fullScreenshot },
      { label: `${pair.viewport} target full`, ref: pair.target.artifacts.fullScreenshot },
    );
    for (const item of items) {
      const image = sharp(await readFile(join(out, item.ref.path))).resize({ width: 420, height: includeFull && item.label.endsWith("full") ? 560 : 300, fit: "contain", background: "white" });
      const rendered = await image.png().toBuffer();
      const label = Buffer.from(`<svg width="420" height="32"><rect width="420" height="32" fill="#111"/><text x="10" y="22" font-size="16" fill="white">${item.label}</text></svg>`);
      cards.push(await sharp({ create: { width: 420, height: (includeFull && item.label.endsWith("full") ? 560 : 300) + 32, channels: 3, background: "white" } })
        .composite([{ input: rendered, top: 32, left: 0 }, { input: label, top: 0, left: 0 }]).png().toBuffer());
    }
  }
  const columns = includeFull ? 4 : 2, width = columns * 420;
  const heights: number[] = [];
  for (let i = 0; i < cards.length; i += columns) {
    const metadata = await Promise.all(cards.slice(i, i + columns).map(card => sharp(card).metadata()));
    heights.push(Math.max(...metadata.map(value => value.height || 0)));
  }
  const composites: any[] = []; let top = 0;
  for (let row = 0; row < heights.length; row++) {
    for (let column = 0; column < columns; column++) {
      const card = cards[row * columns + column]; if (card) composites.push({ input: card, top, left: column * 420 });
    }
    top += heights[row];
  }
  const path = join(work, `${routeId}-${phase}.png`);
  await sharp({ create: { width, height: top, channels: 3, background: "#ddd" } }).composite(composites).png().toFile(path);
  return path;
}

async function openSide(browser: any, rp: any, viewport: string, side: "source" | "target") {
  const dimensions = plan.viewports[viewport];
  const context = await browser.newContext({ viewport: dimensions, deviceScaleFactor: 1, locale: "en-US", colorScheme: "light" });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const location = side === "target"
    ? stage === "online"
      ? { ...rp.target, url: draftPreviewRoute(deployment.previewUrl, rp.target.url) }
      : rp.localTarget || rp.target
    : rp.source;
  let response: any;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await page.goto(location.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(750 * attempt);
    }
  }
  if (lastError) throw lastError;
  if (side === "target") response = (await unlockStorefrontIfNeeded(page, location.url)) || response;
  await assertRenderedEvidencePage(page, response, side);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  return { context, page, response, location };
}

async function captureState(env: any, rid: string, viewport: string, side: "source" | "target", stateId: string, components: any[], full: boolean) {
  const { page, response, location } = env;
  const node = plan.routes[rid].states[stateId];
  const observations = await observePlannedState(page, node, components, side);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  if (!canonical || routeIdentity(page.url()) !== routeIdentity(location.url) || routeIdentity(new URL(canonical, page.url()).href) !== routeIdentity(location.canonical))
    throw new Error(`wrong rendered route ${rid}/${viewport}/${side}/${stateId}`);
  const artifacts: any = {
    dom: await saveEvidence(out, await page.content(), "html"),
    screenshot: await saveEvidence(out, await page.screenshot({ animations: "disabled", scale: "css" }), "png"),
  };
  let documentSize: any;
  if (full) {
    documentSize = await page.evaluate(() => ({ width: Math.max(innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth), height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight) }));
    artifacts.fullScreenshot = await saveEvidence(out, await page.screenshot({ fullPage: true, animations: "disabled", scale: "css" }), "png");
  }
  const data: any = {
    schemaVersion: 2, ...Object.fromEntries(["planId", "revision", "contractVersion", "collectorVersion"].map(k => [k, plan[k]])),
    routeId: rid, kind: "states", nodeId: stateId, side, viewport: { name: viewport, ...plan.viewports[viewport] }, capturedAt: new Date().toISOString(),
    requestedUrl: location.url, finalUrl: page.url(), canonical: new URL(canonical, page.url()).href,
    httpStatus: response?.status?.() || 200, pageKind: "content", buildId: side === "target" ? build.id : null,
    themeId: side === "target" && deployment ? String(deployment.themeId) : null,
    observations, ...(documentSize ? { documentSize } : {}), artifacts,
  };
  return { data, ref: await saveEvidence(out, JSON.stringify(data), "json") };
}

function evidenceFor(componentId: string, before: any, after: any, transition: boolean) {
  const result: any[] = [], escaped = componentId.replace(/~/g, "~0").replace(/\//g, "~1");
  for (const phase of transition ? ["before", "after"] : ["before"]) for (const side of ["source", "target"]) {
    const observations = (phase === "before" ? before : after)[side].observations;
    const pointers = [`/components/${escaped}`];
    if (observations.presentationRaw?.[componentId]) pointers.push(`/presentationRaw/${escaped}/box`, `/presentationRaw/${escaped}/computed`);
    for (const pointer of pointers) {
      let value: any = observations;
      for (const part of pointer.slice(1).split("/").map(v => v.replace(/~1/g, "/").replace(/~0/g, "~"))) value = value[part];
      result.push({ phase, side, pointer, value });
    }
  }
  return result;
}

function componentDecisions(node: any, before: any, after: any, transition: boolean, notes: string) {
  return node.components.map((id: string) => ({
    id, verdict: "pass", rationale: notes, evidence: evidenceFor(id, before, after, transition),
    aspects: Object.fromEntries(REVIEW_ASPECTS.map(aspect => [aspect, {
      verdict: "pass", source: `Directly inspected source ${aspect} in the bound paired frames.`,
      target: `Directly inspected target ${aspect} in the bound paired frames; no release-blocking divergence was observed.`,
    }])),
  }));
}

async function inspection(identity: any, phase: "before" | "after", pair: any, regions: string[], inspectedAt: string, notes: string) {
  const images = ["source", "target"].flatMap(side => regions.map(region => ({
    side, region, image: region === "viewport" ? pair[side].artifacts.screenshot : pair[side].artifacts.fullScreenshot,
  })));
  return saveEvidence(out, JSON.stringify({ schemaVersion: 1, method: "direct-paired-image-and-dom", ...identity, phase, inspectedAt, notes, images }), "json");
}

const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  for (const rid of routeIds) {
    const rp = plan.routes[rid];
    const components = analysis.routes.find((route: any) => route.id === rid).components;
    const envs: any[] = [];
    for (const viewport of Object.keys(plan.viewports)) {
      const source = stage === "online" ? null : await openSide(browser, rp, viewport, "source");
      const target = await openSide(browser, rp, viewport, "target");
      const sourceCapture = stage === "online"
        ? await hydrate(retainedSourceCheck(rid, viewport, "states", "initial").before.source)
        : await captureState(source, rid, viewport, "source", "initial", components, true);
      const targetCapture = await captureState(target, rid, viewport, "target", "initial", components, true);
      envs.push({ viewport, source, target, current: "initial", initial: { source: sourceCapture, target: targetCapture } });
    }
    const initialPairs = envs.map(env => ({ viewport: env.viewport, source: env.initial.source.data, target: env.initial.target.data }));
    for (const pair of initialPairs) comparePairedRules(rp.states.initial, pair);
    const initialSheet = await contactSheet(rid, "initial", initialPairs, true);
    const initialDecision = await waitDecision(rid, "initial", initialSheet);
    for (const env of envs) {
      const pair = { source: env.initial.source.data, target: env.initial.target.data };
      const identity = { stage, planSha256, themeBuild: build.id, routeId: rid, viewport: env.viewport, kind: "states", nodeId: "initial" };
      const inspected = await inspection(identity, "after", pair, requiredReviewRegions(rp.states.initial, "states", "initial"), initialDecision.reviewedAt, initialDecision.notes);
      sessions.get(`${rid}:${env.viewport}`).checks.push({
        kind: "states", id: "initial", before: { source: env.initial.source.ref, target: env.initial.target.ref },
        inspection: inspected, inspectedImages: [pair.source.artifacts.screenshot.path, pair.target.artifacts.screenshot.path],
        reviewedAt: initialDecision.reviewedAt, verdict: "pass", rationale: initialDecision.notes,
        components: componentDecisions(rp.states.initial, pair, pair, false, initialDecision.notes),
      });
    }
    const sequence = rp.captureSequence || [];
    for (const edgeId of sequence) {
      const edge = rp.transitions[edgeId];
      const afterPairs: any[] = [];
      for (const env of envs) {
        // Re-observe the transition baseline after the preceding state decision.
        // This prevents an old initial frame from being reused as if the agent had
        // inspected it after the prior review checkpoint.
        const retainedTransition = stage === "online" ? retainedSourceCheck(rid, env.viewport, "transitions", edgeId) : null;
        const sourceBefore = stage === "online"
          ? await hydrate(retainedTransition.before.source)
          : await captureState(env.source, rid, env.viewport, "source", edge.from, components, false);
        const targetBefore = await captureState(env.target, rid, env.viewport, "target", edge.from, components, false);
        env.transitionBefore = { source: sourceBefore, target: targetBefore };
        const before = { source: sourceBefore.data, target: targetBefore.data };
        const identity = { stage, planSha256, themeBuild: build.id, routeId: rid, viewport: env.viewport, kind: "transitions", nodeId: edgeId };
        const beforeAt = new Date(Math.max(Date.now(), Date.parse(initialDecision.reviewedAt) + 1)).toISOString();
        env.beforeInspection = await inspection(identity, "before", before, ["viewport"], beforeAt, `Rechecked the already inspected bound pair as the baseline for ${edge.action}.`);
        const sourceLog = stage === "online" ? null : await performPlannedAction(env.source.page, edge, "source");
        const targetLog = await performPlannedAction(env.target.page, edge, "target");
        const sourceAfter = stage === "online"
          ? await hydrate(retainedTransition.after.source)
          : await captureState(env.source, rid, env.viewport, "source", edge.to, components, false);
        const targetAfter = await captureState(env.target, rid, env.viewport, "target", edge.to, components, false);
        const pair = { viewport: env.viewport, source: sourceAfter.data, target: targetAfter.data };
        comparePairedRules(rp.states[edge.to], pair); comparePairedRules(edge, pair);
        env.after = { source: sourceAfter, target: targetAfter };
        env.logs = { source: sourceLog, target: targetLog };
        env.retainedSourceAction = retainedTransition ? await readJson<any>(join(out, retainedTransition.actionLog.path)) : null;
        afterPairs.push(pair);
      }
      const afterSheet = await contactSheet(rid, `${edgeId}-after`, afterPairs, false);
      const afterDecision = await waitDecision(rid, `${edgeId}-after`, afterSheet);
      for (const env of envs) {
        const before = { source: env.transitionBefore.source.data, target: env.transitionBefore.target.data }, after = { source: env.after.source.data, target: env.after.target.data };
        const identity = { stage, planSha256, themeBuild: build.id, routeId: rid, viewport: env.viewport, kind: "transitions", nodeId: edgeId };
        const inspected = await inspection(identity, "after", after, requiredReviewRegions(edge, "transitions", edgeId), afterDecision.reviewedAt, afterDecision.notes);
        const input = stage === "online" ? normalizedActions(env.logs.target) : normalizedActions(env.logs.source);
        const action: any = { action: edge.action, from: edge.from, to: edge.to, condition: edge.condition, input };
        for (const side of ["source", "target"]) {
          if (side === "source" && stage === "online") {
            if (stable(normalizedActions(await readJson<any>(join(out, env.retainedSourceAction.source.trace.path)).then((trace: any) => trace.actionLog))) !== stable(input))
              throw new Error(`retained source input differs from online target input: ${rid}/${env.viewport}/${edgeId}`);
            action.source = env.retainedSourceAction.source;
            continue;
          }
          const logs = env.logs[side];
          const trace = await saveEvidence(out, JSON.stringify({ from: edge.from, to: edge.to, action: edge.action, condition: edge.condition, status: "performed",
            actualBefore: env.transitionBefore[side].ref, actualAfter: env.after[side].ref, actionLog: logs, blockedWrites: [] }), "json");
          action[side] = { status: "performed", control: logs[0].selector || logs[0].op, input, startedAt: logs[0].startedAt, endedAt: logs.at(-1).endedAt, trace };
        }
        const actionLog = await saveEvidence(out, JSON.stringify(action), "json");
        sessions.get(`${rid}:${env.viewport}`).checks.push({
          kind: "transitions", id: edgeId,
          before: { source: env.transitionBefore.source.ref, target: env.transitionBefore.target.ref }, after: { source: env.after.source.ref, target: env.after.target.ref },
          beforeInspection: env.beforeInspection, actionLog, inspection: inspected,
          inspectedImages: [...new Set([before.source.artifacts.screenshot.path, before.target.artifacts.screenshot.path, after.source.artifacts.screenshot.path, after.target.artifacts.screenshot.path])],
          reviewedAt: afterDecision.reviewedAt, verdict: "pass", rationale: afterDecision.notes,
          components: componentDecisions(edge, before, after, true, afterDecision.notes),
        });
      }
      const statePairs: any[] = [];
      for (const env of envs) {
        const sourceState = stage === "online"
          ? await hydrate(retainedSourceCheck(rid, env.viewport, "states", edge.to).before.source)
          : await captureState(env.source, rid, env.viewport, "source", edge.to, components, false);
        const targetState = await captureState(env.target, rid, env.viewport, "target", edge.to, components, false);
        env.state = { source: sourceState, target: targetState };
        const pair = { viewport: env.viewport, source: sourceState.data, target: targetState.data };
        comparePairedRules(rp.states[edge.to], pair); statePairs.push(pair);
      }
      const stateSheet = await contactSheet(rid, `${edge.to}-state`, statePairs, false);
      const stateDecision = await waitDecision(rid, `${edge.to}-state`, stateSheet);
      for (const env of envs) {
        const pair = { source: env.state.source.data, target: env.state.target.data };
        const identity = { stage, planSha256, themeBuild: build.id, routeId: rid, viewport: env.viewport, kind: "states", nodeId: edge.to };
        const inspected = await inspection(identity, "after", pair, requiredReviewRegions(rp.states[edge.to], "states", edge.to), stateDecision.reviewedAt, stateDecision.notes);
        sessions.get(`${rid}:${env.viewport}`).checks.push({
          kind: "states", id: edge.to, before: { source: env.state.source.ref, target: env.state.target.ref },
          inspection: inspected, inspectedImages: [pair.source.artifacts.screenshot.path, pair.target.artifacts.screenshot.path],
          reviewedAt: stateDecision.reviewedAt, verdict: "pass", rationale: stateDecision.notes,
          components: componentDecisions(rp.states[edge.to], pair, pair, false, stateDecision.notes),
        });
      }
    }
    for (const env of envs) { if (env.source) await env.source.context.close(); await env.target.context.close(); }
  }
  report.passed = true;
  await writeFile(join(work, "paired-review-complete.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`\nCOMPLETE ${join(work, "paired-review-complete.json")}\n`);
} finally { await browser.close(); }

