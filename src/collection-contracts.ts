import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { json, readJson } from "./util.js";
import { REQUIRED_VIEWPORTS } from "./types.js";
import {
  COLLECTION_EVIDENCE_COLLECTOR_VERSION,
  COLLECTION_EVIDENCE_CONTRACT_VERSION,
  COLLECTION_EVIDENCE_SCHEMA_VERSION,
} from "./collection-family-evidence.js";

async function readComposedLiquid(out: string, relativePath: string, seen = new Set<string>()) {
  if (seen.has(relativePath)) return "";
  seen.add(relativePath);
  const source = await readFile(join(out, "theme", relativePath), "utf8").catch(() => "");
  let composed = source;
  const renders = source.matchAll(/\{%\s*render\s+['"]([^'"]+)['"]/g);
  for (const match of renders)
    composed += await readComposedLiquid(out, `snippets/${match[1]}.liquid`, seen);
  return composed;
}

export const collectionFamilyContract = {
  schemaVersion: 1,
  family: "reference-product-grid",
  status: "provisional",
  appliesTo: "imported collections using templates/collection.json",
  expectedSection: "s2s-collection",
  requiredMarkers: [
    "data-s2s-collection-grid",
    "data-s2s-collection-card",
    "data-s2s-collection-shop",
    "data-s2s-collection-price",
    "s2s-product-rating",
  ],
  layout: {
    desktopColumns: 3,
    tabletColumns: 2,
    mobileColumns: 2,
    imageAspectRatio: "1/1",
  },
};

export async function auditCollectionFamilyContract(out: string) {
  const template = JSON.parse(
    await readFile(join(out, "theme/templates/collection.json"), "utf8"),
  );
  const sectionType = template.sections?.main?.type;
  const source = sectionType
    ? await readComposedLiquid(out, `sections/${sectionType}.liquid`)
    : "";
  const css = await readFile(join(out, "theme/assets/s2s-phase3.css"), "utf8").catch(
    () => "",
  );
  const evidence = await readJson<any>(join(out, "collection-family-evidence/layout-audit.json")).catch(() => null);
  const failures: string[] = [];
  if (sectionType !== collectionFamilyContract.expectedSection)
    failures.push(`collection.json must use ${collectionFamilyContract.expectedSection}`);
  if (!template.order?.includes("main")) failures.push("collection.json must order main");
  for (const marker of collectionFamilyContract.requiredMarkers)
    if (!source.includes(marker)) failures.push(`missing marker ${marker}`);
  if (!source.includes("product.metafields.loox.avg_rating"))
    failures.push("collection cards must bind target Loox rating metafields");
  if (!source.includes("product.metafields.reviews.rating.value.rating")
    || !source.includes("product.metafields.reviews.rating_count.value"))
    failures.push("collection cards must bind standard Shopify review metafields as fallback");
  if (!source.includes("data-s2s-rating-source") || !source.includes("data-id=\"{{ product.id }}\""))
    failures.push("collection card rating binding markers are missing");
  if (!css.includes("grid-template-columns:repeat(3"))
    failures.push("missing three-column desktop collection layout");
  if (!css.includes("grid-template-columns:repeat(2"))
    failures.push("missing tablet/mobile two-column collection layout");
  if (!css.includes("@media(max-width:989px)"))
    failures.push("missing tablet collection breakpoint");
  if (!css.includes("@media(max-width:479px)"))
    failures.push("missing mobile collection breakpoint");
  if (!evidence) failures.push("collection layout evidence missing");
  else if (evidence.schemaVersion !== COLLECTION_EVIDENCE_SCHEMA_VERSION
    || evidence.contractVersion !== COLLECTION_EVIDENCE_CONTRACT_VERSION
    || evidence.collectorVersion !== COLLECTION_EVIDENCE_COLLECTOR_VERSION)
    failures.push("collection layout evidence is stale and must be recaptured with rating binding fields");
  else {
    if (evidence.errors?.length) failures.push("collection layout evidence contains capture errors");
    for (const { name, width, height } of REQUIRED_VIEWPORTS) {
      const assertion = evidence.assertions?.[name];
      const sourceBounds = evidence.sourceReferenceBounds?.[name];
      const interaction = evidence.interactions?.[name];
      if (!assertion || !sourceBounds) failures.push(`${name} collection source/target layout evidence missing`);
      else {
        if (assertion.viewport !== `${width}x${height}`)
          failures.push(`${name} collection viewport must be ${width}x${height}`);
        if (assertion.horizontalOverflow) failures.push(`${name} collection has horizontal overflow`);
      }
      if (!interaction?.passed) failures.push(`${name} collection interaction evidence missing or failed`);
      if (assertion?.ratings?.implementationPassed === false)
        failures.push(`${name} collection rating binding failed`);
      // Review data is merchant-owned dynamic content. Missing target ratings are
      // reported by the evidence packet but do not invalidate a correctly bound
      // card component or authorize copying source review totals.
      if (!assertion?.passed && assertion?.ratings?.implementationPassed !== false)
        failures.push(`${name} collection layout contract failed`);
    }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    contract: collectionFamilyContract,
    passed: failures.length === 0,
    failures,
  };
  await json(join(out, "collection-family-contract-audit.json"), report);
  return report;
}

export async function assertCollectionFamilyContract(out: string) {
  const report = await auditCollectionFamilyContract(out);
  if (!report.passed)
    throw new Error(`Collection family contract failed: ${report.failures.join("; ")}`);
  return report;
}
