import { stable } from "./capture-cache.js";
import sharp from "sharp";

export const REVIEW_ASPECTS = ["structure", "layout", "styling", "overflow", "behavior"] as const;
export function reviewRequire(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Visual inspection blocked: ${message}`);
}
export const textPresent = (v: any) => typeof v === "string" && v.trim().length > 0;
export function reviewTime(value: any) {
  reviewRequire(textPresent(value) && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), "invalid inspection timestamp");
  const time = Date.parse(value);
  reviewRequire(time <= Date.now() + 60000, "future inspection timestamp");
  return time;
}
export function pointerValue(object: any, pointer: string): any {
  reviewRequire(typeof pointer === "string" && pointer.startsWith("/") && !/~(?![01])/.test(pointer), "invalid observation pointer");
  for (const part of pointer.slice(1).split("/").map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    reviewRequire(part && !["__proto__", "constructor", "prototype"].includes(part) && object != null && Object.hasOwn(object, part), `missing observed field ${pointer}`);
    object = object[part];
  }
  reviewRequire(object !== undefined && object !== null, `null observation ${pointer}`);
  return object;
}
export const sameRef = (a: any, b: any) => a && b && a.path === b.path && a.sha256 === b.sha256;
export function requiredReviewRegions(node: any, kind: string, id: string) {
  return [...new Set<string>(["viewport", ...(kind === "states" && id === "initial" ? ["full"] : []), ...(node.visualReview?.requiredRegions || [])])];
}

// Independent comparisons for the actual paired frames; a different green
// coverage capture must not waive a mismatch in the frames the agent reviewed.
export function comparePairedRules(node: any, pair: any) {
  for (const rule of node.rules || []) {
    const a = pointerValue(pair.source.observations, rule.sourcePointer);
    const b = pointerValue(pair.target.observations, rule.targetPointer);
    let passed = false;
    if (rule.operator === "equal") passed = stable(a) === stable(b);
    else if (rule.operator === "unordered") passed = Array.isArray(a) && Array.isArray(b)
      && stable(a.map(stable).sort()) === stable(b.map(stable).sort());
    else if (rule.operator === "numeric") {
      const abs = rule.tolerance?.absolute, rel = rule.tolerance?.relative;
      passed = typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b)
        && Number.isFinite(abs) && abs >= 0 && Number.isFinite(rel) && rel >= 0
        && Math.abs(a - b) <= Math.max(abs, Math.abs(a) * rel);
    }
    reviewRequire(passed, `paired observation comparison failed: ${rule.id}`);
  }
  if (pair.source.observations.presentationContext || pair.target.observations.presentationContext)
    reviewRequire(stable(pair.source.observations.presentationContext) === stable(pair.target.observations.presentationContext), "paired render context differs");
}

export async function validateInspection(
  ref: any, artifact: (ref: any, json?: boolean) => Promise<any>, identity: any,
  phase: "before" | "after", pair: any, regions: string[],
) {
  const record = await artifact(ref);
  reviewRequire(record.schemaVersion === 1 && record.method === "direct-paired-image-and-dom", "missing direct image/DOM inspection record");
  for (const [key, value] of Object.entries({ ...identity, phase })) reviewRequire(record[key] === value, `inspection identity mismatch: ${key}`);
  const at = reviewTime(record.inspectedAt);
  reviewRequire(textPresent(record.notes) && Array.isArray(record.images), "inspection needs actual observations and image references");
  const expected = new Set<string>();
  for (const side of ["source", "target"]) {
    reviewRequire(at >= reviewTime(pair[side].capturedAt), "inspection predates capture");
    for (const region of regions) {
      const key = `${side}:${region}`;
      expected.add(key);
      const image = region === "viewport" ? pair[side].artifacts.screenshot
        : region === "full" ? pair[side].artifacts.fullScreenshot : pair[side].artifacts.reviewRegions?.[region];
      reviewRequire(image, `capture lacks required review region: ${key}`);
      const matches = record.images.filter((i: any) => i.side === side && i.region === region);
      reviewRequire(matches.length === 1 && sameRef(matches[0].image, image), `inspection image mismatch: ${key}`);
      const metadata = await sharp(await artifact(image, false)).metadata();
      reviewRequire(metadata.format === "png" && !!metadata.width && !!metadata.height, "inspection image must be a real PNG");
      if (region === "full") {
        const size = pair[side].documentSize;
        reviewRequire(size && Number.isInteger(size.width) && Number.isInteger(size.height)
          && size.width >= pair[side].viewport.width && size.height >= pair[side].viewport.height
          && metadata.width === size.width && metadata.height === size.height, "full-page review image has invalid or unmeasured document dimensions");
      }
    }
  }
  reviewRequire(record.images.length === expected.size, "unexpected/duplicate inspection images");
  return at;
}

export function validateComponentDecision(comparison: any, id: string, before: any, after: any, transition: boolean, rendered = false) {
  reviewRequire(comparison.verdict === "pass" && textPresent(comparison.rationale), `unresolved component ${id}`);
  for (const aspect of REVIEW_ASPECTS) {
    const decision = comparison.aspects?.[aspect];
    reviewRequire(decision?.verdict === "pass" && textPresent(decision.source) && textPresent(decision.target), `${id}: missing source/target ${aspect} judgment`);
  }
  reviewRequire(Array.isArray(comparison.evidence), `${id}: missing observed evidence`);
  const escaped = id.replace(/~/g, "~0").replace(/\//g, "~1");
  for (const phase of transition ? ["before", "after"] : ["before"]) for (const side of ["source", "target"]) {
    const observed = (phase === "before" ? before : after)[side].observations;
    const required = [`/components/${escaped}`];
    if (rendered) reviewRequire(observed.presentationRaw?.[id]?.box && observed.presentationRaw?.[id]?.computed, `${id}: rendered component lacks actual layout/style measurements`);
    if (observed.presentationRaw?.[id]) required.push(`/presentationRaw/${escaped}/box`, `/presentationRaw/${escaped}/computed`);
    for (const pointer of required) reviewRequire(comparison.evidence.some((e: any) => e.phase === phase && e.side === side && e.pointer === pointer), `${id}: missing ${phase}/${side} measurement citation ${pointer}`);
  }
  for (const item of comparison.evidence) {
    reviewRequire(["source", "target"].includes(item.side) && (transition ? ["before", "after"] : ["before"]).includes(item.phase), "invalid component evidence side/phase");
    const data = (item.phase === "before" ? before : after)[item.side].observations;
    reviewRequire(stable(pointerValue(data, item.pointer)) === stable(item.value), `${id}: review value differs from actual capture`);
  }
}

export function normalizedActions(actions: any[]) {
  reviewRequire(Array.isArray(actions) && actions.length > 0, "missing actual action steps");
  return actions.map(step => {
    reviewRequire(textPresent(step.op), "missing actual operation");
    return Object.fromEntries(["op", "value", "checked", "y"].filter(key => step[key] !== undefined).map(key => [key, step[key]]));
  });
}
