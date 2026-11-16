import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicJson } from "./capture-cache.js";
import { loadEvidencePlan, saveEvidence } from "./evidence-gate.js";
import { readJson } from "./util.js";
import { assertPairedBrowserReview } from "./paired-browser-review.js";
import { assertAgentVisualReview, computeAgentVisualEvidenceDigest, requiredVisualDecisions, type AgentVisualReviewStage } from "./agent-visual-review.js";
import { REVIEW_ASPECTS, reviewRequire } from "./visual-review-protocol.js";
import { incrementalContext, promoteAcceptanceBaseline, sealAcceptanceBaseline } from './incremental-acceptance.js';
import { assertReviewedReleaseEvidence } from './reviewed-release-evidence.js';

async function writeNew(path: string, data: any) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), { flag: "wx" });
  return path; // Never overwrite actual decisions with a new skeleton.
}
export async function preparePairedReview(out: string, stage: AgentVisualReviewStage) {
  const { plan, planSha256 } = await loadEvidencePlan(out);
  const build = await readJson<any>(join(out, "theme-build.json"));
  const context=await incrementalContext(out);
  reviewRequire(!context?.impact.zeroChanges,'unchanged validated baseline needs no new browser review');
  const deployment = stage === "online" ? await readJson<any>(join(out, "deployment.json")) : null;
  const sessions: any[] = [];
  for (const [routeId, route] of Object.entries<any>(plan.routes)) for (const viewport of Object.keys(plan.viewports)) {
    if(context&&!context.routeIds.includes(routeId))continue;
    const checks: any[] = [], states = new Set<string>();
    const add = (kind: string, id: string) => {
      const node = route[kind][id];
      checks.push({ kind, id, before: null, ...(kind === "transitions" ? { after: null, actionLog: null, beforeInspection: null } : {}),
        inspection: null, inspectedImages: [], reviewedAt: null, verdict: "pending", rationale: "",
        components: node.components.map((id: string) => ({ id, verdict: "pending", rationale: "", evidence: [],
          aspects: Object.fromEntries(REVIEW_ASPECTS.map(aspect => [aspect, { verdict: "pending", source: "", target: "" }])) })) });
    };
    add("states", "initial"); states.add("initial");
    const sequence = route.captureSequence?.[viewport] ?? route.captureSequence;
    reviewRequire(Array.isArray(sequence), "review requires independently planned captureSequence");
    for (const id of sequence) {
      add("transitions", id);
      const to = route.transitions[id].to;
      if (!states.has(to)) { add("states", to); states.add(to); }
    }
    // Uncovered requirements remain pending; never infer scope from successes.
    for (const [id, node] of Object.entries<any>(route.states)) if ((!node.viewports || node.viewports.includes(viewport)) && !states.has(id)) add("states", id);
    for (const [id, node] of Object.entries<any>(route.transitions)) if ((!node.viewports || node.viewports.includes(viewport)) && !sequence.includes(id)) add("transitions", id);
    sessions.push({ routeId, viewport, checks });
  }
  return writeNew(join(out, "paired-review-work", stage, ...(context?[build.id]:[]), "paired-review-input.json"), {
    schemaVersion: 2, stage, mode: "agent-operated-paired-browser", planSha256, planRevision: plan.revision,
    themeBuild: build.id, ...(deployment ? { themeId: String(deployment.themeId) } : {}),
    ...(context?{incremental:{routeIds:context.routeIds,baselineSha256:context.impact.baseline?.sha256,inputsDigest:context.impact.inputsDigest}}:{}),
    reviewer: { kind: "skill-agent", skill: "shopify-site-replication" }, sessions, findings: [], passed: false,
  });
}
export async function prepareVisualSummary(out: string, stage: AgentVisualReviewStage) {
  const { plan, planSha256 } = await loadEvidencePlan(out);
  const evidence = await computeAgentVisualEvidenceDigest(out,stage);
  const context=await incrementalContext(out),pairedName=`paired-browser-review.${stage}${context?'.incremental':''}.json`;
  const pairedBytes = await readFile(join(out, pairedName));
  const paired = await saveEvidence(out, pairedBytes, "json");
  paired.path = pairedName;
  return writeNew(join(out, "paired-review-work", stage, ...(context?[evidence.themeBuild]:[]), "visual-review-input.json"), {
    schemaVersion: 3, stage, themeBuild: evidence.themeBuild, planSha256, planRevision: plan.revision,
    evidenceDigest: evidence.digest, evidenceFiles: evidence.files, pairedBrowserReview: paired,
    ...(context?{incremental:{routeIds:context.routeIds,baselineSha256:context.impact.baseline?.sha256,inputsDigest:context.impact.inputsDigest}}:{}),
    reviewer: { kind: "skill-agent", skill: "shopify-site-replication" }, reviewedAt: null,
    decisions: (await requiredVisualDecisions(out,context?.routeIds)).map(r => ({ routeId: r.routeId, family: r.family, viewport: r.viewport,
      requirements: r, inspectedRegions: [], inspectedStateIds: [], inspectedTransitionIds: [],
      verdict: "pending", rationale: "", acceptedDeviations: [] })), issues: [], passed: false,
  });
}

// Submission preserves supplied observations. No invented timestamps, actions,
// image-inspection claims, default verdicts, or automatic finding closure.
export async function submitReview(out: string, stage: AgentVisualReviewStage, kind: "paired" | "visual", input: string) {
  const candidateBytes = await readFile(input), candidate = JSON.parse(candidateBytes.toString());
  reviewRequire(candidate.stage === stage, "submitted review has the wrong stage");
  const context=await incrementalContext(out);
  const filename = `${kind === "paired" ? "paired-browser-review" : "agent-visual-review"}.${stage}${context?'.incremental':''}.json`;
  reviewRequire(!context?.impact.zeroChanges,'unchanged sealed baseline does not need a new review submission');
  const previous = await readFile(join(out, filename)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const findingField = kind === "paired" ? "findings" : "issues";
  const oldFindings: any[] = previous ? JSON.parse(previous.toString())[findingField] || [] : [];
  const record: any = { submittedAt: new Date().toISOString(), candidate: await saveEvidence(out, candidateBytes, "json"),
    previous: previous ? await saveEvidence(out, previous, "json") : null, status: "unvalidated" };
  await atomicJson(join(out, filename), candidate);
  try {
    for (const finding of oldFindings) if (finding.id)
      reviewRequire(candidate[findingField]?.some((f: any) => f.id === finding.id), `finding ${finding.id} cannot disappear; retain it and record replay`);
    const build = await readJson<any>(join(out, "theme-build.json"));
    if (kind === "paired") await assertPairedBrowserReview(out, stage, build.id,context?{filename,routeIds:context.routeIds}:{});
    else await assertAgentVisualReview(out, stage);
    record.status = "validated-review-only";
    if(kind==='visual'&&stage==='online'&&await readFile(join(out,'acceptance-dependencies.json')).catch(()=>null)){
      const validate=async()=>{await assertReviewedReleaseEvidence(out,'preflight',true,{full:!context});await assertReviewedReleaseEvidence(out,'online',true,{full:!context});};
      if(context&&!context.impact.zeroChanges)record.baseline=await promoteAcceptanceBaseline(out,validate);
      else if(!context)record.baseline=await sealAcceptanceBaseline(out,validate);
      if(record.baseline)record.status='validated-and-baseline-updated';
    }
    return { filename, status: record.status, releaseAuthorized: false };
  } catch (error) {
    // A new defect on the same build must not leave an old green report active.
    const retained = Array.isArray(candidate[findingField]) ? [...candidate[findingField]] : [];
    for (const finding of oldFindings) if (!retained.some((f: any) => f.id === finding.id)) retained.push(finding);
    await atomicJson(join(out, filename), { ...candidate, [findingField]: retained, passed: false });
    record.status = "blocked"; record.reason = String(error);
    record.nextAction = "Inspect missing/divergent pairs, repair the earliest incorrect layer within authority, then replay. Do not bulk-fill pass.";
    throw error;
  } finally { await atomicJson(join(out, "paired-review-work", stage, `${kind}-submission.json`), record); }
}
