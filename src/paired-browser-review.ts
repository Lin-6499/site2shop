import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { REQUIRED_VIEWPORTS } from "./types.js";
import sharp from "sharp";
import { verifySourceProvenance } from "./capture-cache.js";
import { stable } from "./capture-cache.js";
import { comparePairedRules, normalizedActions, requiredReviewRegions, sameRef, validateComponentDecision, validateInspection } from "./visual-review-protocol.js";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function requireEvidence(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Paired-browser acceptance blocked: ${message}`);
}
const object = (value: any) => value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: any) => typeof value === "string" && value.trim().length > 0;
const timestamp = (value: any) => {
  requireEvidence(nonempty(value) && /(?:Z|[+-]\d\d:\d\d)$/.test(value), "missing timezone-aware timestamp");
  const time = Date.parse(value);
  requireEvidence(Number.isFinite(time), "invalid timestamp");
  return time;
};
function route(value: string) {
  const url = new URL(value);
  requireEvidence(["https:", "http:"].includes(url.protocol), "invalid content URL");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

// Consistency/coverage validator, not a browser or proof of an agent's honesty.
export type PairedReviewValidationOptions = {
  filename?: string;
  routeIds?: string[];
};

export async function assertPairedBrowserReview(
  out: string,
  stage: "preflight" | "online",
  buildId: string,
  options: PairedReviewValidationOptions = {},
) {
  const root = await realpath(out);
  const planBytes = await readFile(join(root, "capture-plan.json")).catch(() => null);
  requireEvidence(planBytes, "capture-plan.json is missing; successful audit rows cannot define scope");
  const plan = JSON.parse(planBytes.toString());
  requireEvidence(plan.schemaVersion === 2 && Number.isInteger(plan.revision) && plan.revision > 0, "unsupported capture plan");
  requireEvidence(object(plan.viewports) && REQUIRED_VIEWPORTS.every(v => object(plan.viewports[v.name])), "plan lacks desktop/tablet/mobile");
  requireEvidence(object(plan.routes) && Object.keys(plan.routes).length, "plan has no routes");
  const filename = options.filename || `paired-browser-review.${stage}.json`;
  const reportBytes = await readFile(join(root, filename)).catch(() => null);
  requireEvidence(reportBytes, `${filename} is missing; operate and inspect both websites`);
  const report = JSON.parse(reportBytes.toString());
  const planSha256 = sha(planBytes);
  requireEvidence(report.schemaVersion === 2 && report.stage === stage && report.mode === "agent-operated-paired-browser", "invalid paired review mode/schema/stage; legacy blanket reviews require fresh inspection");
  requireEvidence(report.planSha256 === planSha256 && report.planRevision === plan.revision && report.themeBuild === buildId, "stale plan/build identity");
  requireEvidence(report.reviewer?.kind === "skill-agent" && report.reviewer?.skill === "shopify-site-replication", "missing skill agent reviewer");
  let themeId: string | undefined;
  if (stage === "online") {
    const deployment = JSON.parse(await readFile(join(root, "deployment.json"), "utf8"));
    themeId = String(deployment.themeId || "");
    requireEvidence(themeId && deployment.themeBuild === buildId && String(report.themeId) === themeId, "wrong deployed build/theme");
  }
  async function artifact(ref: any, json = true): Promise<any> {
    requireEvidence(object(ref) && nonempty(ref.path) && !isAbsolute(ref.path) && /^[a-f0-9]{64}$/.test(ref.sha256), "missing artifact reference/hash");
    const path = await realpath(resolve(root, ref.path)).catch(() => null);
    requireEvidence(path && !relative(root, path).startsWith("..") && !isAbsolute(relative(root, path)), "artifact missing or outside evidence root");
    const bytes = await readFile(path);
    requireEvidence(bytes.length && sha(bytes) === ref.sha256, `artifact hash mismatch: ${ref.path}`);
    return json ? JSON.parse(bytes.toString()) : bytes;
  }
  const analysis = await artifact(plan.analysis);
  async function capture(ref: any, rid: string, vp: string, stateId: string, side: "source" | "target") {
    const c = await artifact(ref);
    const rp = plan.routes[rid];
    const expected = side === "target" && stage === "preflight" ? rp.localTarget || rp.target : rp[side];
    requireEvidence(c.schemaVersion === 2 && c.kind === "states" && c.routeId === rid && c.nodeId === stateId && c.side === side, "capture state/side identity mismatch");
    let identityPlan = plan;
    if (side === "source") {
      const bytes = await readFile(join(root, "source-coverage.json"), "utf8").catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const coverage = bytes ? JSON.parse(bytes) : null;
      const provenance = coverage?.routes?.[rid]?.viewports?.[vp]?.sourceProvenance;
      if (provenance) {
        requireEvidence(coverage.planSha256 === planSha256, "stale source manifest");
        identityPlan = await verifySourceProvenance(root, plan, await artifact(plan.analysis), rid, vp, provenance);
      }
    }
    requireEvidence(c.planId === identityPlan.planId && c.revision === identityPlan.revision && c.contractVersion === identityPlan.contractVersion && c.collectorVersion === identityPlan.collectorVersion, "stale capture versions");
    requireEvidence(c.pageKind === "content" && c.httpStatus >= 200 && c.httpStatus < 300 && !["failed", "blocked", "invalid", "missing", "timeout"].includes(c.status), "password/challenge/error capture is not content evidence");
    requireEvidence(route(c.requestedUrl) === route(expected.url) && route(c.finalUrl) === route(expected.url) && route(c.canonical) === route(expected.canonical), "wrong capture route/canonical");
    requireEvidence(c.viewport?.name === vp && ["width", "height"].every(axis => c.viewport[axis] === plan.viewports[vp][axis] && Number.isFinite(c.viewport[axis]) && c.viewport[axis] > 0), "wrong actual viewport");
    if (side === "target") requireEvidence(c.buildId === buildId && (stage !== "online" || String(c.themeId) === themeId), "wrong capture build/theme");
    await artifact(c.artifacts?.dom, false);
    const screenshot = await artifact(c.artifacts?.screenshot, false);
    const dimensions = await sharp(screenshot).metadata();
    requireEvidence(dimensions.width === c.viewport.width && dimensions.height === c.viewport.height, "paired screenshot must be a 1x viewport capture, not a crop or another viewport");
    requireEvidence(object(c.observations?.components), "capture missing component observations");
    return c;
  }
  const applicable = (node: any, vp: string) => !node.viewports || node.viewports.includes(vp);
  requireEvidence(Array.isArray(report.sessions), "sessions missing");
  const sessionKeys = new Set<string>();
  for (const session of report.sessions) {
    const key = `${session.routeId}:${session.viewport}`;
    requireEvidence(!sessionKeys.has(key) && plan.routes[session.routeId] && plan.viewports[session.viewport], `duplicate/unknown session ${key}`);
    sessionKeys.add(key);
  }
  const scopedRouteIds = options.routeIds?.length ? new Set(options.routeIds) : null;
  if (scopedRouteIds) {
    requireEvidence(
      [...scopedRouteIds].every((rid) => object(plan.routes[rid])),
      "incremental review contains an unknown route",
    );
    requireEvidence(
      report.incremental?.routeIds && stable([...report.incremental.routeIds].sort()) === stable([...scopedRouteIds].sort()),
      "incremental review scope differs from the requested impact set",
    );
    const expectedSessionKeys = new Set(
      [...scopedRouteIds].flatMap((rid) => Object.keys(plan.viewports).map((viewport) => `${rid}:${viewport}`)),
    );
    requireEvidence(
      sessionKeys.size === expectedSessionKeys.size && [...sessionKeys].every((key) => expectedSessionKeys.has(key)),
      "incremental review sessions exceed or omit the requested impact set",
    );
  }
  for (const [rid, rp] of Object.entries<any>(plan.routes)) {
    if (scopedRouteIds && !scopedRouteIds.has(rid)) continue;
    requireEvidence(object(rp.states) && rp.states.initial && object(rp.transitions) && nonempty(rp.family), "incomplete planned states/transitions/family");
    for (const vp of Object.keys(plan.viewports)) {
      const session = report.sessions.find((s: any) => s.routeId === rid && s.viewport === vp);
      requireEvidence(session && Array.isArray(session.checks), `missing session ${rid}:${vp}`);
      const expected = new Map<string, any>();
      for (const kind of ["states", "transitions"])
        for (const [id, node] of Object.entries<any>(rp[kind]))
          if (applicable(node, vp)) expected.set(`${kind}:${id}`, { kind, id, node });
      const seen = new Set<string>();
      let precedingReviewAt = 0;
      let currentState = "initial";
      const performedEdges: string[] = [];
      for (const check of session.checks) {
        const key = `${check.kind}:${check.id}`;
        const requirement = expected.get(key);
        requireEvidence(requirement && !seen.has(key), `unknown/duplicate check ${rid}:${vp}:${key}`);
        seen.add(key);
        const node = requirement.node;
        const reviewedAt = timestamp(check.reviewedAt);
        requireEvidence(reviewedAt > precedingReviewAt && reviewedAt <= Date.now() + 60000, "review must occur per operation, not in a retroactive batch");
        requireEvidence(seen.size !== 1 || (check.kind === "states" && check.id === "initial"), "session must begin with initial-state inspection");
        const from = check.kind === "states" ? check.id : node.from;
        const to = check.kind === "states" ? check.id : node.to;
        requireEvidence(from === currentState, "review order diverges from the current workflow state");
        const before = {
          source: await capture(check.before?.source, rid, vp, from, "source"),
          target: await capture(check.before?.target, rid, vp, from, "target"),
        };
        const after = check.kind === "states" ? before : {
          source: await capture(check.after?.source, rid, vp, to, "source"),
          target: await capture(check.after?.target, rid, vp, to, "target"),
        };
        comparePairedRules(rp.states[from], before);
        comparePairedRules(rp.states[to], after);
        if (check.kind === "transitions") comparePairedRules(node, after);
        const inspectionIdentity = { stage, planSha256, themeBuild: buildId, routeId: rid, viewport: vp, kind: check.kind, nodeId: check.id };
        // Source observations are content-addressed and may be reused across review
        // batches when the source plan/route/collector identity is unchanged. The
        // generated target must be observed again after the preceding repair review.
        requireEvidence(
          timestamp(before.target.capturedAt) >= precedingReviewAt,
          `target observation predates the preceding agent review batch: ${rid}/${vp}/${key} ` +
            `(preceding=${new Date(precedingReviewAt).toISOString()}, target=${before.target.capturedAt})`,
        );
        if (check.kind === "transitions") {
          requireEvidence(rp.states[from] && rp.states[to] && nonempty(node.action), "unknown transition endpoints/action");
          const action = await artifact(check.actionLog);
          requireEvidence(action.action === node.action && action.from === from && action.to === to && action.condition === node.condition && action.input !== undefined, "action semantics/input mismatch");
          const beforeReviewedAt = await validateInspection(check.beforeInspection, artifact, inspectionIdentity, "before", before, ["viewport"]);
          requireEvidence(beforeReviewedAt > precedingReviewAt, "before inspection must follow the previous decision");
          for (const side of ["source", "target"] as const) {
            requireEvidence(action[side]?.status === "performed" && nonempty(action[side].control) && stable(action[side].input) === stable(action.input), "both sides must perform equivalent UI actions");
            const started = timestamp(action[side].startedAt), ended = timestamp(action[side].endedAt);
            requireEvidence(started >= timestamp(before[side].capturedAt) && started >= beforeReviewedAt && ended >= started && timestamp(after[side].capturedAt) >= ended, "actions are not interleaved with before/after agent review");
            const trace = await artifact(action[side].trace);
            requireEvidence(trace.status === "performed" && ["from", "to", "action", "condition"].every(k => trace[k] === node[k]), "actual trace semantics mismatch");
            requireEvidence(sameRef(trace.actualBefore, check.before[side]) && sameRef(trace.actualAfter, check.after[side]), "action trace does not bind the actual reviewed frames");
            requireEvidence(stable(normalizedActions(trace.actionLog)) === stable(action.input), "shared action input was not derived from both actual traces");
            const recipe = node.probe?.[side];
            requireEvidence(Array.isArray(recipe) && recipe.length === trace.actionLog.length, "actual actions lack a complete independent recipe");
            requireEvidence(recipe.every((step: any, i: number) => Object.entries(step).every(([field, value]) => stable(trace.actionLog[i][field]) === stable(value))), "actual action differs from the planned control/input");
            requireEvidence(action[side].control === (trace.actionLog[0].selector || trace.actionLog[0].op), "control label does not identify the actual action");
            requireEvidence(trace.actionLog[0].startedAt === action[side].startedAt && trace.actionLog.at(-1).endedAt === action[side].endedAt, "action times differ from actual trace");
            let priorEnd = started;
            for (const step of trace.actionLog) {
              requireEvidence(timestamp(step.startedAt) >= priorEnd && timestamp(step.endedAt) >= timestamp(step.startedAt), "nonmonotonic action steps");
              priorEnd = timestamp(step.endedAt);
            }
            requireEvidence(!trace.blockedWrites?.length, "blocked business write is not a successful action");
          }
          performedEdges.push(check.id);
          currentState = to;
        }
        requireEvidence([before.source, before.target, after.source, after.target].every(c => reviewedAt >= timestamp(c.capturedAt)), "review predates observed pages");
        const imagePaths = [before.source, before.target, after.source, after.target].map(c => c.artifacts.screenshot.path);
        requireEvidence(Array.isArray(check.inspectedImages) && imagePaths.every(p => check.inspectedImages.includes(p)), "agent did not inspect both before/after image pairs");
        const inspectedAt = await validateInspection(check.inspection, artifact, inspectionIdentity, "after", after, requiredReviewRegions(node, check.kind, check.id));
        requireEvidence(inspectedAt === reviewedAt, "review time was not recorded by this inspection");
        requireEvidence(Array.isArray(node.components) && node.components.length && Array.isArray(check.components), "component inventory/checks missing");
        const componentIds = new Set([...node.components, ...[before.source, before.target, after.source, after.target].flatMap(c => Object.keys(c.observations.components))]);
        requireEvidence(check.components.length === componentIds.size, "bidirectional component inventory is incomplete or duplicated");
        for (const id of componentIds) {
          const comparisons = check.components.filter((c: any) => c.id === id);
          requireEvidence(comparisons.length === 1, `component ${id} was not checked exactly once`);
          const comparison = comparisons[0];
          for (const pair of [before, after]) {
            const source = pair.source.observations.components[id];
            const target = pair.target.observations.components[id];
            requireEvidence(source && target && ["visible", "hidden", "absent"].includes(source.presence) && source.presence === target.presence, `component ${id} missing/extra or visibility differs`);
          }
          const specification = analysis.routes?.find((r: any) => r.id === rid)?.components?.find((c: any) => c.id === id);
          requireEvidence(specification, `component ${id} lacks an independent reconnaissance specification`);
          validateComponentDecision(comparison, id, before, after, check.kind === "transitions", specification.acceptance?.kind === "rendered");
        }
        requireEvidence(check.verdict === "pass" && nonempty(check.rationale), `failed/blocked pair ${rid}:${vp}:${key}`);
        precedingReviewAt = reviewedAt;
      }
      requireEvidence(seen.size === expected.size, `missing planned state/transition in ${rid}:${vp}`);
      const sequence = rp.captureSequence?.[vp] ?? rp.captureSequence;
      requireEvidence(Array.isArray(sequence) && stable(sequence) === stable(performedEdges), "review did not replay the independent planned sequence");
    }
  }
  requireEvidence(Array.isArray(report.findings) && new Set(report.findings.map((f: any) => f.id)).size === report.findings.length && report.findings.every((f: any) => nonempty(f.id) && nonempty(f.description) && f.status === "resolved" && f.retestedBuild === buildId && nonempty(f.retestCheckId) && ["states", "transitions"].includes(f.retestKind) && report.sessions.some((s: any) => s.routeId === f.routeId && s.viewport === f.viewport && s.checks.some((c: any) => c.id === f.retestCheckId && c.kind === f.retestKind && c.components.some((component: any) => component.id === f.componentId) && c.verdict === "pass"))), "unresolved findings or missing current-build replay");
  requireEvidence(report.passed === true, "paired review not passed");
  return { planSha256, planRevision: plan.revision, artifact: { path: filename, sha256: sha(reportBytes) } };
}
