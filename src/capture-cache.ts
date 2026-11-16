import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { containedFile, evidenceRequire, readArtifact } from "./evidence-gate.js";
import { hash } from "./util.js";

export const CACHE_VERSION = 1;
export const stable = (value: any): string => JSON.stringify(sort(value));
function sort(value: any): any {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}

// Keep this projection in sync with evidence-gates/source_capture_contract.py.
// Exclude only schema-owned target fields, not arbitrary source input named target.
export function sourceCaptureContract(plan: any, analysis: any, rid: string, vp: string) {
  const route = structuredClone(plan.routes[rid]);
  delete route.target; delete route.localTarget;
  for (const kind of ["states", "transitions"]) {
    route[kind] = Object.fromEntries(Object.entries<any>(route[kind]).filter(([, node]) => !node.viewports || node.viewports.includes(vp)));
    for (const node of Object.values<any>(route[kind])) {
      delete node.generatorBindings;
      for (const field of ["capture", "probe"]) if (node[field]) delete node[field].target;
      for (const rule of node.rules || []) delete rule.targetPointer;
    }
  }
  route.captureSequence = route.captureSequence?.[vp] ?? route.captureSequence;
  const components = structuredClone(analysis.routes.find((r: any) => r.id === rid).components);
  for (const component of components) if (component.acceptance) delete component.acceptance.targetPointer;
  return { schemaVersion: plan.schemaVersion, planId: plan.planId,
    contractVersion: plan.contractVersion, collectorVersion: plan.collectorVersion,
    sourceRevision: plan.sourceRevision ?? null, viewport: { name: vp, ...plan.viewports[vp] },
    limits: plan.limits, route, components };
}

export async function atomicJson(path: string, value: any) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(temp, JSON.stringify(value, null, 2));
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}

export async function verifySourceProvenance(out: string, plan: any, analysis: any, rid: string, vp: string, ref: any) {
  const original = await readArtifact(out, ref);
  const originalAnalysis = await readArtifact(out, original.analysis);
  evidenceRequire(stable(sourceCaptureContract(original, originalAnalysis, rid, vp)) === stable(sourceCaptureContract(plan, analysis, rid, vp)), "source provenance contract changed");
  return original;
}

// Re-hash every reachable byte, not just the top-level capture JSON. Corruption
// is a cache miss; the formal evidence gate remains independently authoritative.
export async function verifyCaptureTree(out: string, value: any, seen = new Set<string>()): Promise<void> {
  if (!value || typeof value !== "object") return;
  if (typeof value.path === "string" && typeof value.sha256 === "string") {
    const identity = `${value.path}:${value.sha256}`;
    if (seen.has(identity)) return;
    const bytes = await readFile(await containedFile(out, value.path));
    evidenceRequire(bytes.length && hash(bytes) === value.sha256, `cached artifact hash mismatch: ${value.path}`);
    if (value.path.endsWith(".json")) await verifyCaptureTree(out, JSON.parse(bytes.toString()), seen);
    seen.add(identity);
    return;
  }
  for (const child of Object.values(value)) await verifyCaptureTree(out, child, seen);
}

export function captureCacheKey(contract: any, runtime: string, stage: string, buildId: string | null, themeId: string | null) {
  return hash(stable({ version: CACHE_VERSION, contract, runtime, stage, buildId, themeId }));
}
export async function loadCaptureCache(out: string, key: string, fingerprint: string, maxAgeMs: number, verified = new Set<string>()) {
  try {
    const entry = JSON.parse(await readFile(join(out, "planned-evidence/cache", `${key}.json`), "utf8"));
    const age = Date.now() - Date.parse(entry.completedAt);
    evidenceRequire(entry.version === CACHE_VERSION && entry.key === key && entry.fingerprint === fingerprint, "cache identity changed");
    evidenceRequire(Number.isFinite(age) && age >= 0 && age <= maxAgeMs, "cache expired");
    evidenceRequire(entry.complete === true && !entry.result.captureFailure, "partial cache entry");
    for (const kind of ["states", "transitions"]) for (const record of Object.values<any>(entry.result[kind]))
      evidenceRequire(!record.status && (record.source || record.target), "failed/missing cached node");
    await verifyCaptureTree(out, entry.result, verified);
    return { entry, reason: "unchanged-complete-workflow" };
  } catch (error) { return { entry: null, reason: String(error) }; }
}
export async function saveCaptureCache(out: string, key: string, fingerprint: string, result: any) {
  await atomicJson(join(out, "planned-evidence/cache", `${key}.json`), {
    version: CACHE_VERSION, key, fingerprint, complete: true, completedAt: new Date().toISOString(), result,
  });
}
