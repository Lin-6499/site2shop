import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readJson } from "./util.js";
import { assertPairedBrowserReview } from "./paired-browser-review.js";
import { requiredReviewRegions, reviewRequire, reviewTime, textPresent } from "./visual-review-protocol.js";
import { stable } from "./capture-cache.js";
import { incrementalContext } from './incremental-acceptance.js';

export type AgentVisualReviewStage = "preflight" | "online";

const evidenceFiles = [
  "product-family-visual-audit.json",
  "collection-family-evidence/layout-audit.json",
  "page-family-visual-audit.json",
  "capture-plan.json",
  "source-coverage.json",
  "preflight-coverage.json",
  "online-coverage.json",
  "paired-browser-review.preflight.json",
  "paired-browser-review.online.json",
  "preflight-coverage.incremental.json", "online-coverage.incremental.json",
  "paired-browser-review.preflight.incremental.json", "paired-browser-review.online.incremental.json",
];

async function existingEvidence(out: string, stage?: AgentVisualReviewStage) {
  const result: Array<{ file: string; content: string }> = [];
  for (const file of evidenceFiles) {
    if(stage&&!['capture-plan.json','source-coverage.json',`${stage}-coverage.json`,`${stage}-coverage.incremental.json`,`paired-browser-review.${stage}.json`,`paired-browser-review.${stage}.incremental.json`].includes(file))continue;
    const content = await readFile(join(out, file), "utf8").catch(() => null);
    if (content) result.push({ file, content });
  }
  return result;
}

export async function computeAgentVisualEvidenceDigest(out: string, stage?: AgentVisualReviewStage) {
  const build = await readJson<any>(join(out, "theme-build.json"));
  const evidence = await existingEvidence(out, stage);
  if (!evidence.length) throw new Error("Agent visual review blocked: no structured visual evidence exists.");
  const hash = createHash("sha256");
  hash.update(String(build.id));
  for (const item of evidence.sort((a, b) => a.file.localeCompare(b.file))) {
    hash.update("\0");
    hash.update(item.file);
    hash.update("\0");
    hash.update(item.content);
  }
  return { digest: hash.digest("hex"), files: evidence.map((item) => item.file), themeBuild: build.id };
}

function decisionKey(routeId: string, viewport: string) {
  return `${routeId}\0${viewport}`;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

async function readBoundArtifact(out: string, ref: any) {
  reviewRequire(ref && typeof ref.path === "string" && !isAbsolute(ref.path) && /^[a-f0-9]{64}$/.test(ref.sha256), "invalid incremental artifact reference");
  const root = await realpath(out);
  const path = await realpath(resolve(root, ref.path)).catch(() => null);
  reviewRequire(path && !relative(root, path).startsWith("..") && !isAbsolute(relative(root, path)), "incremental artifact is missing or outside the evidence root");
  const bytes = await readFile(path);
  reviewRequire(sha256(bytes) === ref.sha256, `incremental artifact hash mismatch: ${ref.path}`);
  return { bytes, value: JSON.parse(bytes.toString()) };
}

async function assertBaselineVisualDecisions(out: string, review: any, pairedRef: any) {
  reviewRequire(review.schemaVersion === 3 && review.stage === "preflight" && review.reviewer?.kind === "skill-agent" && review.reviewer?.skill === "shopify-site-replication", "invalid baseline skill-agent review");
  reviewRequire(review.passed === true && typeof review.themeBuild === "string" && review.themeBuild.length > 0, "baseline skill-agent review did not pass");
  reviewRequire(review.pairedBrowserReview?.path === pairedRef.path && review.pairedBrowserReview?.sha256 === pairedRef.sha256, "baseline visual review does not bind the retained paired review");
  const requirements = await requiredVisualDecisions(out);
  const decisions = new Map((review.decisions || []).map((item: any) => [decisionKey(item.routeId, item.viewport), item]));
  reviewRequire(decisions.size === requirements.length, "baseline visual review coverage is incomplete");
  for (const requirement of requirements) {
    const decision: any = decisions.get(decisionKey(requirement.routeId, requirement.viewport));
    reviewRequire(decision && decision.family === requirement.family && decision.verdict === "pass" && textPresent(decision.rationale), "baseline visual decision is missing or failed");
    reviewRequire(requirement.regions.every((region: string) => decision.inspectedRegions?.includes(region)), "baseline visual regions are incomplete");
    reviewRequire(stable([...(decision.inspectedStateIds || [])].sort()) === stable([...requirement.states].sort()), "baseline visual states are incomplete");
    reviewRequire(stable([...(decision.inspectedTransitionIds || [])].sort()) === stable([...requirement.transitions].sort()), "baseline visual transitions are incomplete");
    reviewRequire(Array.isArray(decision.acceptedDeviations) && decision.acceptedDeviations.length === 0, "baseline contains an uncontracted visual deviation");
  }
}

async function assertIncrementalAgentVisualReview(out: string, stage: AgentVisualReviewStage, evidence: any) {
  reviewRequire(stage === "preflight", "incremental evidence reuse is only valid before uploading the repaired draft; online acceptance must inspect the deployed build");
  const filename = `agent-visual-review.${stage}.incremental.json`;
  const record = await readJson<any>(join(out, filename)).catch(() => null);
  reviewRequire(record, `${filename} is missing`);
  reviewRequire(record.schemaVersion === 1 && record.stage === stage && record.themeBuild === evidence.themeBuild, "incremental visual review has stale build identity");
  reviewRequire(record.reviewer?.kind === "skill-agent" && record.reviewer?.skill === "shopify-site-replication" && record.passed === true && textPresent(record.rationale), "incremental visual review lacks an explicit passing skill-agent decision");
  reviewRequire(record.evidenceDigest === evidence.digest && stable([...(record.evidenceFiles || [])].sort()) === stable([...evidence.files].sort()), "incremental visual review is stale for the current evidence set");
  const [impactArtifact, baselinePairedArtifact, baselineVisualArtifact, incrementalPairedArtifact] = await Promise.all([
    readBoundArtifact(out, record.impactManifest),
    readBoundArtifact(out, record.baselinePairedBrowserReview),
    readBoundArtifact(out, record.baselineAgentVisualReview),
    readBoundArtifact(out, record.incrementalPairedBrowserReview),
  ]);
  const impact = impactArtifact.value;
  reviewRequire(impact.schemaVersion === 1 && impact.buildId === evidence.themeBuild && impact.scopeExpansion?.fullSiteRecaptureRequired === false, "impact manifest is stale or requires full-site recapture");
  const routeIds = [...new Set([...(impact.replayRequired || []), ...(impact.boundedConsumerSmoke || [])].map((entry: any) => entry.routeFamily))];
  reviewRequire(routeIds.length > 0 && routeIds.every((id) => typeof id === "string"), "impact manifest has no bounded route set");
  const baselinePaired = baselinePairedArtifact.value;
  reviewRequire(baselinePaired.themeBuild && baselinePaired.themeBuild !== evidence.themeBuild, "baseline review must identify the previous accepted build");
  await assertPairedBrowserReview(out, stage, baselinePaired.themeBuild, { filename: record.baselinePairedBrowserReview.path });
  await assertBaselineVisualDecisions(out, baselineVisualArtifact.value, record.baselinePairedBrowserReview);
  await assertPairedBrowserReview(out, stage, evidence.themeBuild, { filename: record.incrementalPairedBrowserReview.path, routeIds });
  const delta = incrementalPairedArtifact.value;
  reviewRequire(delta.incremental?.impactManifest === record.impactManifest.path, "incremental paired review does not name the bound impact manifest");
  const deltaKeys = new Set((delta.sessions || []).map((session: any) => `${session.routeId}\0${session.viewport}`));
  for (const routeId of routeIds) for (const viewport of ["desktop", "tablet", "mobile"])
    reviewRequire(deltaKeys.has(`${routeId}\0${viewport}`), `incremental three-device coverage is missing: ${routeId}:${viewport}`);
  reviewRequire(reviewTime(record.reviewedAt) >= Math.max(...delta.sessions.flatMap((session: any) => session.checks.map((check: any) => reviewTime(check.reviewedAt)))), "incremental summary predates its paired inspections");
  return { ...record, filename };
}

export async function requiredVisualDecisions(out: string, routeIds?: string[]) {
  const plan = await readJson<any>(join(out, "capture-plan.json"));
  const requirements: any[] = [];
  for (const [routeId, route] of Object.entries<any>(plan.routes)) for (const viewport of Object.keys(plan.viewports)) {
    if(routeIds&&!routeIds.includes(routeId))continue;
    const states = Object.entries<any>(route.states).filter(([, n]) => !n.viewports || n.viewports.includes(viewport));
    const transitions = Object.entries<any>(route.transitions).filter(([, n]) => !n.viewports || n.viewports.includes(viewport));
    requirements.push({ routeId, family: route.family, viewport,
      regions: [...new Set([...states.flatMap(([id, n]) => requiredReviewRegions(n, "states", id)), ...transitions.flatMap(([id, n]) => requiredReviewRegions(n, "transitions", id))])],
      states: states.map(([id]) => id), transitions: transitions.map(([id]) => id) });
  }
  reviewRequire(requirements.length > 0, "empty independent review inventory");
  return requirements;
}

async function assertScopedVisualReview(out:string,stage:AgentVisualReviewStage,context:NonNullable<Awaited<ReturnType<typeof incrementalContext>>>) {
  const record=await readJson<any>(join(out,`agent-visual-review.${stage}.incremental.json`)),evidence=await computeAgentVisualEvidenceDigest(out,stage);
  reviewRequire(record.schemaVersion===3&&record.stage===stage&&record.themeBuild===evidence.themeBuild&&record.passed===true,'incremental visual review missing or stale');
  reviewRequire(record.reviewer?.kind==='skill-agent'&&record.reviewer?.skill==='shopify-site-replication','incremental skill-agent review required');
  reviewRequire(record.incremental?.baselineSha256===context.impact.baseline?.sha256&&record.incremental?.inputsDigest===context.impact.inputsDigest,'visual review does not bind recomputed baseline/impact');
  reviewRequire(record.evidenceDigest===evidence.digest&&stable([...(record.evidenceFiles||[])].sort())===stable([...evidence.files].sort()),'incremental visual evidence changed');
  const filename=`paired-browser-review.${stage}.incremental.json`,paired=await assertPairedBrowserReview(out,stage,evidence.themeBuild,{filename,routeIds:context.routeIds});
  reviewRequire(record.pairedBrowserReview?.path===paired.artifact.path&&record.pairedBrowserReview?.sha256===paired.artifact.sha256,'incremental visual review not bound to paired session');
  const requirements=await requiredVisualDecisions(out,context.routeIds),decisions=new Map((record.decisions||[]).map((d:any)=>[decisionKey(d.routeId,d.viewport),d]));
  reviewRequire(decisions.size===requirements.length&&decisions.size===record.decisions.length,'incremental visual coverage differs from computed impact');
  for(const r of requirements){const d:any=decisions.get(decisionKey(r.routeId,r.viewport));reviewRequire(d?.verdict==='pass'&&d.family===r.family&&textPresent(d.rationale),'incremental route decision failed');for(const[field,ids]of[['inspectedStateIds',r.states],['inspectedTransitionIds',r.transitions]]as const)reviewRequire(stable([...(d[field]||[])].sort())===stable([...ids].sort()),'incremental states/transitions missing');reviewRequire(r.regions.every((x:string)=>d.inspectedRegions?.includes(x))&&Array.isArray(d.acceptedDeviations)&&d.acceptedDeviations.length===0,'incremental regions incomplete or uncontracted deviations');}
  const report=await readJson<any>(join(out,filename));reviewRequire(report.sessions.every((s:any)=>s.checks.every((c:any)=>reviewTime(record.reviewedAt)>=reviewTime(c.reviewedAt))),'incremental summary predates paired inspection');
  reviewRequire(Array.isArray(record.issues)&&record.issues.every((issue:any)=>issue.id&&report.findings.some((f:any)=>f.id===issue.id&&f.status==='resolved'&&f.retestedBuild===evidence.themeBuild)),'unresolved incremental findings');
  return record;
}
export async function assertAgentVisualReview(out: string, stage: AgentVisualReviewStage, options:{full?:boolean}={}) {
  const context=!options.full?await incrementalContext(out):null;
  if(context?.impact.zeroChanges){if(stage==='online'){const d=await readJson<any>(join(out,'deployment.json'));reviewRequire(d.role==='unpublished'&&!d.published&&d.themeBuild===context.impact.buildId&&String(d.themeId)===context.baseline.themeId,'retained visual baseline belongs to a different deployment');}const latest=context.baseline.latestEvidence?.[`agent-visual-review.${stage}.incremental.json`]||context.baseline.evidence[`agent-visual-review.${stage}.json`];const previous=(await readBoundArtifact(out,latest)).value;return{passed:true,reused:true,baseline:context.impact.baseline,routeReceipts:context.baseline.routeReceipts,themeBuild:context.baseline.buildId,reviewedAt:previous.reviewedAt,evidenceDigest:previous.evidenceDigest};}
  if(context)return assertScopedVisualReview(out,stage,context);
  const filename = `agent-visual-review.${stage}.json`;
  const [review, evidence] = await Promise.all([
    readJson<any>(join(out, filename)).catch(() => null),
    computeAgentVisualEvidenceDigest(out,stage),
  ]);
  const prefix = stage === "preflight" ? "Draft upload" : "Publication";
  if (!review) throw new Error(`${prefix} blocked: ${filename} is missing; a skill-guided agent must inspect the current evidence.`);
  if (review.schemaVersion !== 3 || review.reviewer?.kind !== "skill-agent" || review.reviewer?.skill !== "shopify-site-replication")
    throw new Error(`${prefix} blocked: visual review requires schema 3 and explicit skill-agent decisions; legacy blanket reviews are invalid.`);
  if (review.stage !== stage) throw new Error(`${prefix} blocked: the visual review stage is invalid.`);
  if (review.themeBuild !== evidence.themeBuild || review.evidenceDigest !== evidence.digest) {
    throw new Error(`${prefix} blocked: stale full review; incremental reuse requires a sealed baseline and dependency-derived scope.`);
  }
  if (!Array.isArray(review.evidenceFiles) || stable([...review.evidenceFiles].sort()) !== stable([...evidence.files].sort()))
    throw new Error(`${prefix} blocked: the agent visual review does not enumerate all current evidence files.`);
  const paired = await assertPairedBrowserReview(out, stage, evidence.themeBuild);
  const sessionReport = await readJson<any>(join(out, paired.artifact.path));
  const reviewedAt = reviewTime(review.reviewedAt);
  reviewRequire(Array.isArray(review.decisions), "missing explicit review decisions");
  const decisions = new Map(review.decisions.map((item: any) => [decisionKey(item.routeId, item.viewport), item]));
  const requirements = await requiredVisualDecisions(out);
  reviewRequire(decisions.size === review.decisions.length && decisions.size === requirements.length, "duplicate/extra/missing route decisions");
  const missing: string[] = [];
  const failed: string[] = [];
  for (const requirement of requirements) {
    const key = decisionKey(requirement.routeId, requirement.viewport);
    const decision: any = decisions.get(key);
    if (!decision || !requirement.regions.every((region: string) => decision.inspectedRegions?.includes(region))) {
      missing.push(`${requirement.routeId}:${requirement.viewport}`);
      continue;
    }
    reviewRequire(decision.family === requirement.family, "decision family differs from independent plan");
    for (const [field, ids] of [["inspectedStateIds", requirement.states], ["inspectedTransitionIds", requirement.transitions]] as const)
      reviewRequire(Array.isArray(decision[field]) && stable([...decision[field]].sort()) === stable([...ids].sort()), `incomplete ${field}: ${key}`);
    const session = sessionReport.sessions.find((s: any) => s.routeId === requirement.routeId && s.viewport === requirement.viewport);
    reviewRequire(session.checks.every((c: any) => reviewedAt >= reviewTime(c.reviewedAt)), "summary predates actual inspections");
    if (decision.verdict !== "pass") failed.push(key);
    if (!textPresent(decision.rationale)) missing.push(`${key}:rationale`);
    reviewRequire(Array.isArray(decision.acceptedDeviations) && decision.acceptedDeviations.length === 0, "deviations need an independently revised contract, not a blanket visual waiver");
  }
  if (missing.length) throw new Error(`${prefix} blocked: agent visual review coverage is incomplete (${missing.join(", ")}).`);
  if (failed.length || review.passed !== true)
    throw new Error(`${prefix} blocked: the skill-guided agent found unresolved visual defects (${failed.join(", ") || "review marked failed"}).`);
  reviewRequire(Array.isArray(review.issues) && review.issues.every((issue: any) => issue.id && sessionReport.findings.some((f: any) => f.id === issue.id && f.status === "resolved" && f.retestedBuild === evidence.themeBuild)), "unresolved or untracked review issues");
  if (review.planSha256 !== paired.planSha256 || review.planRevision !== paired.planRevision || review.pairedBrowserReview?.path !== paired.artifact.path || review.pairedBrowserReview?.sha256 !== paired.artifact.sha256)
    throw new Error(`${prefix} blocked: the agent review does not bind the current paired-browser session and plan.`);
  return review;
}
