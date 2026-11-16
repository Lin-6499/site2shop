import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, json, readJson, write } from "./util.js";
import { assertGeneratedThemeIntegrity } from "./theme-integrity.js";
import { assertPairedBrowserReview } from "./paired-browser-review.js";
import { incrementalContext } from './incremental-acceptance.js';

export type EvidenceStage = "source" | "preflight" | "online";
const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = runtimeRoot.endsWith('.codex-build') ? dirname(runtimeRoot) : runtimeRoot;
export const BOX_FIELDS = ["widthPx", "leftInsetPx", "rightInsetPx", "paddingTopPx", "paddingRightPx", "paddingBottomPx", "paddingLeftPx", "marginTopPx", "marginRightPx", "marginBottomPx", "marginLeftPx", "gapBeforePx", "gapAfterPx", "visible", "placement", "topology", "overflow"];
export function evidenceRequire(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Evidence gate blocked: ${message}`);
}
export async function containedFile(root: string, name: string) {
  evidenceRequire(typeof name === "string" && name && !isAbsolute(name), "relative evidence/owner path required");
  const base = await realpath(root), path = await realpath(resolve(base, name));
  const rel = relative(base, path);
  evidenceRequire(rel && !rel.startsWith("..") && !isAbsolute(rel), "artifact escapes its root");
  return path;
}
export async function readArtifact(out: string, ref: any) {
  evidenceRequire(ref && /^[a-f0-9]{64}$/.test(ref.sha256), "missing artifact hash");
  const bytes = await readFile(await containedFile(out, ref.path));
  evidenceRequire(bytes.length && hash(bytes) === ref.sha256, `artifact hash mismatch: ${ref.path}`);
  return JSON.parse(bytes.toString());
}
export async function saveEvidence(out: string, bytes: Buffer | string, extension: string) {
  const sha256 = hash(bytes), path = `planned-evidence/artifacts/${sha256}.${extension}`;
  await write(join(out, path), bytes);
  return { path, sha256 };
}
export async function loadEvidencePlan(out: string) {
  const bytes = await readFile(join(out, "capture-plan.json")).catch(() => null);
  evidenceRequire(bytes, "capture-plan.json is missing; discover scope before formal capture");
  const plan = JSON.parse(bytes.toString());
  return { plan, planSha256: hash(bytes), analysis: await readArtifact(out, plan.analysis) };
}

async function runChecker(args: string[], runner = "validate_evidence_coverage.py") {
  const script = join(PROJECT_ROOT, "scripts/evidence-gates", runner);
  const candidates = process.env.SITE2SHOP_PYTHON
    ? [{ command: process.env.SITE2SHOP_PYTHON, prefix: [] as string[] }]
    : [{ command: "python", prefix: [] }, { command: "python3", prefix: [] }, { command: "py", prefix: ["-3"] }];
  for (const candidate of candidates) {
    try {
      return await new Promise<any>((done, reject) => {
        const child = spawn(candidate.command, [...candidate.prefix, "-X", "utf8", script, ...args], { shell: false, windowsHide: true });
        let stdout = "", stderr = "";
        const timer = setTimeout(() => { child.kill(); reject(new Error("Evidence gate timed out; external action remains blocked")); }, 60000);
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => {
          clearTimeout(timer);
          let result: any;
          try { result = JSON.parse(stdout); } catch { reject(new Error(`Evidence checker returned invalid output (${code}): ${stderr.slice(-1000)}`)); return; }
          if (code !== 0 || result.passed !== true || !Array.isArray(result.errors) || result.errors.length)
            reject(new Error(`Evidence gate blocked: ${(result.errors || [stderr]).join("; ")}`));
          else done(result);
        });
      });
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Evidence gate blocked: Python 3.10+ is unavailable. Set SITE2SHOP_PYTHON to an interpreter path (not a shell command).");
}

export async function assertEvidencePlan(out: string) {
  await loadEvidencePlan(out);
  return runChecker(["--plan", join(resolve(out), "capture-plan.json")]);
}

export async function runEvidenceNegativeTests(out: string, stage: "preflight" | "online") {
  await assertEvidencePlan(out);
  const integrity = await assertGeneratedThemeIntegrity(out);
  const context = await incrementalContext(out);
  if(context?.impact.zeroChanges)return{passed:true,reused:true,baseline:context.impact.baseline,reason:'No new implementation/source effect; retained negative-test proofs remain intact.'};
  const filename = `${stage}-coverage${context ? '.incremental' : ''}.json`;
  const coverage = await readJson<any>(join(out, filename));
  evidenceRequire(coverage.stage === stage && coverage.buildId === integrity.actual, "stale target coverage for fault injection");
  return runChecker([join(resolve(out), filename), "--plan", join(resolve(out), "capture-plan.json")], "run_negative_tests.py");
}

// Always recompute from hashed artifacts; a stored passed flag is never sufficient.
export async function assertExecutableEvidence(out: string, stage: EvidenceStage, options: {full?: boolean} = {}) {
  await loadEvidencePlan(out);
  const context = stage !== 'source' && !options.full ? await incrementalContext(out) : null;
  if (context) {
    if(context.impact.zeroChanges){if(stage==='online'){const d=await readJson<any>(join(out,'deployment.json'));evidenceRequire(d.role==='unpublished'&&!d.published&&d.themeBuild===context.impact.buildId&&String(d.themeId)===context.baseline.themeId,'retained online baseline belongs to a different deployment');}return{passed:true,stage,incremental:true,unchanged:true,buildId:context.impact.buildId,baselineBuildId:context.baseline.buildId,routeIds:[] as string[]};}
    const filename = `${stage}-coverage.incremental.json`, coverage = await readJson<any>(join(out,filename));
    evidenceRequire(coverage.buildId === context.impact.buildId && coverage.incremental?.baselineSha256 === context.impact.baseline?.sha256 && coverage.incremental?.inputsDigest === context.impact.inputsDigest, 'incremental coverage does not bind recomputed impact and sealed baseline');
    const args=[join(resolve(out),filename),'--plan',join(resolve(out),'capture-plan.json'),'--stage',stage,'--build-id',context.impact.buildId,...context.routeIds.flatMap(id=>['--scoped-route',id])];
    if(stage==='online') { const d=await readJson<any>(join(out,'deployment.json')); evidenceRequire(d.role==='unpublished'&&!d.published&&d.themeBuild===context.impact.buildId&&String(d.themeId)===context.baseline.themeId,'wrong incremental deployment'); args.push('--theme-id',String(d.themeId)); }
    await assertGeneratorPresentationBindings(out,stage,context.impact.buildId,true,filename,context.routeIds);
    await runChecker(args);
    return {passed:true,stage,incremental:true,buildId:context.impact.buildId,baselineBuildId:context.baseline.buildId,routeIds:context.routeIds};
  }
  const manifest = join(resolve(out), `${stage}-coverage.json`);
  evidenceRequire(await readFile(manifest).catch(() => null), `${stage}-coverage.json is missing`);
  const args = [manifest, "--plan", join(resolve(out), "capture-plan.json"), "--stage", stage];
  if (stage !== "source") {
    const integrity = await assertGeneratedThemeIntegrity(out);
    const coverage = await readJson<any>(manifest);
    evidenceRequire(coverage.buildId === integrity.actual, 'stale target evidence requires a sealed full baseline and dependency-derived incremental replay');
    args.push("--build-id", integrity.actual);
    if (stage === "online") {
      const deployment = await readJson<any>(join(out, "deployment.json"));
      evidenceRequire(deployment.role === "unpublished" && !deployment.published && deployment.themeBuild === integrity.actual && deployment.themeId, "wrong/stale unpublished deployment");
      args.push("--theme-id", String(deployment.themeId));
    }
    await assertGeneratorPresentationBindings(out, stage, integrity.actual);
  }
  return runChecker(args);
}

export async function withEvidenceGate<T>(out: string, stage: EvidenceStage, action: () => Promise<T>) {
  await assertExecutableEvidence(out, stage);
  return action();
}

export async function executableEvidenceCheck(out: string, stage: EvidenceStage) {
  try {
    await assertExecutableEvidence(out, stage);
    return { check: "independent-planned-presentation-and-workflow", stage, passed: true, reason: null };
  } catch (error) {
    return { check: "independent-planned-presentation-and-workflow", stage, passed: false, reason: String(error) };
  }
}

// Mapping is generator-owned declaration, not an automatic fidelity claim.
// Agent review must inspect these owners. No mappings are invented for legacy defaults.
export async function recordGeneratorPresentationBindings(out: string) {
  const { plan, planSha256, analysis } = await loadEvidencePlan(out);
  const source = await readJson<any>(join(out, "source-coverage.json"));
  evidenceRequire(source.planSha256 === planSha256, "source coverage uses an older plan");
  const build = await readJson<any>(join(out, "theme-build.json"));
  const entries: any[] = [];
  for (const [rid, rp] of Object.entries<any>(plan.routes)) {
    const components = analysis.routes.find((route: any) => route.id === rid).components;
    for (const vp of Object.keys(plan.viewports)) for (const kind of ["states", "transitions"]) {
      for (const [nid, node] of Object.entries<any>(rp[kind])) {
        if (node.viewports && !node.viewports.includes(vp)) continue;
        const bindings: any = {}, owners: any = {};
        for (const cid of node.components) {
          const spec = components.find((c: any) => c.id === cid).acceptance;
          if (spec.kind === "nonvisual") continue;
          const owner = node.generatorBindings?.[cid];
          evidenceRequire(owner && ["contract", "provider-configuration"].includes(owner.mode) && owner.owner?.trim(), `${rid}/${nid}/${cid}: no verified generator owner; generic defaults remain provisional`);
          evidenceRequire(Array.isArray(owner.measures) && owner.measures.length === BOX_FIELDS.length && BOX_FIELDS.every(f => owner.measures.includes(f)), `${cid}: incomplete generator measure mapping`);
          const generator = await readFile(await containedFile(PROJECT_ROOT, owner.generator));
          const generatedPath = await containedFile(out, owner.generated);
          const themeRelative = relative(await realpath(join(out, "theme")), generatedPath);
          evidenceRequire(themeRelative && !themeRelative.startsWith("..") && !isAbsolute(themeRelative), "generated binding must reference a theme file");
          const generated = await readFile(generatedPath);
          const sourceRef = source.routes[rid].viewports[vp][kind][nid].source;
          await readArtifact(out, sourceRef);
          bindings[cid] = { mode: owner.mode, owner: owner.owner, measures: owner.measures,
            sourceCaptureSha256: sourceRef.sha256, sourcePointer: spec.sourcePointer,
            generator: await saveEvidence(out, generator, "generator"), generated: await saveEvidence(out, generated, "generated") };
          owners[cid] = { generator: owner.generator, generated: owner.generated };
        }
        entries.push({ routeId: rid, viewport: vp, kind, nodeId: nid, bindings, owners });
      }
    }
  }
  const result = { schemaVersion: 1, planSha256, buildId: build.id, entries };
  await json(join(out, "generator-presentation-bindings.json"), result);
  return result;
}

async function assertGeneratorPresentationBindings(out: string, stage: EvidenceStage, buildId: string, requireCoverageBindings = true, filename = `${stage}-coverage.json`, routeIds?: string[]) {
  const { planSha256, plan } = await loadEvidencePlan(out);
  const registry = await readJson<any>(join(out, "generator-presentation-bindings.json"));
  const coverage = await readJson<any>(join(out, filename));
  evidenceRequire(registry.schemaVersion === 1 && registry.planSha256 === planSha256 && registry.buildId === buildId && Array.isArray(registry.entries), "stale generator bindings");
  const seen = new Set<string>();
  for (const entry of registry.entries) {
    if(routeIds&&!routeIds.includes(entry.routeId))continue;
    const key = `${entry.routeId}/${entry.viewport}/${entry.kind}/${entry.nodeId}`;
    evidenceRequire(!seen.has(key), `duplicate binding ${key}`); seen.add(key);
    const node = plan.routes[entry.routeId]?.[entry.kind]?.[entry.nodeId];
    evidenceRequire(node && plan.viewports[entry.viewport] && (!node.viewports || node.viewports.includes(entry.viewport)), `unplanned binding ${key}`);
    const record = coverage.routes?.[entry.routeId]?.viewports?.[entry.viewport]?.[entry.kind]?.[entry.nodeId];
    if (requireCoverageBindings)
      evidenceRequire(record && JSON.stringify(record.presentationBindings || {}) === JSON.stringify(entry.bindings), `coverage does not bind generated implementation: ${key}`);
    for (const [cid, binding] of Object.entries<any>(entry.bindings)) {
      const owner = node.generatorBindings?.[cid];
      evidenceRequire(owner && owner.generator === entry.owners[cid]?.generator && owner.generated === entry.owners[cid]?.generated && owner.owner === binding.owner && owner.mode === binding.mode, `generator owner drift: ${cid}`);
      for (const field of ["generator", "generated"]) {
        const bytes = await readFile(await containedFile(field === "generator" ? PROJECT_ROOT : out, owner[field]));
        evidenceRequire(hash(bytes) === binding[field].sha256, `current ${field} differs from bound artifact: ${cid}`);
      }
    }
  }
  for (const [rid, rp] of Object.entries<any>(plan.routes)) for (const vp of Object.keys(plan.viewports))
    for (const kind of ["states", "transitions"]) for (const [nid, node] of Object.entries<any>(rp[kind]))
      if ((!routeIds||routeIds.includes(rid))&&(!node.viewports || node.viewports.includes(vp))) evidenceRequire(seen.has(`${rid}/${vp}/${kind}/${nid}`), "generator binding inventory incomplete");
}
