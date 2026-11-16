import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { json, readJson, write } from "./util.js";
import { REQUIRED_VIEWPORTS } from "./types.js";
import { renderedEvidenceRejection } from "./rendered-page-validity.js";

export type ContractStatus = "verified" | "provisional" | "blocked";

export type ProductFamilyContract = {
  suffix: string;
  family: string;
  representative: string;
  expectedSection: string;
  status: ContractStatus;
  requiredSectionMarkers: string[];
  requiredTemplateSections: string[];
  reason?: string;
};

export type ProductFamilyContractConfig = {
  schemaVersion: 1;
  generatedAt?: string;
  source?: string;
  contracts: ProductFamilyContract[];
};

const contractFile = (out: string) => join(out, "product-family-contracts.json");

async function readLiquidComposition(
  out: string,
  folder: "sections" | "snippets",
  name: string,
  seen = new Set<string>(),
): Promise<string> {
  const key = `${folder}/${name}`;
  if (seen.has(key)) return "";
  seen.add(key);
  const source = await readFile(join(out, "theme", folder, `${name}.liquid`), "utf8");
  const parts = [source];
  for (const match of source.matchAll(/{%\s*render\s+['"]([^'"]+)['"]/g)) {
    try {
      parts.push(await readLiquidComposition(out, "snippets", match[1], seen));
    } catch {
      parts.push(`missing snippet ${match[1]}`);
    }
  }
  return parts.join("\n");
}

export const productFamilyContracts: ProductFamilyContract[] = [
  {
    suffix: "s2s-portrait",
    family: "custom-portrait",
    representative: "custom-one-pet-portrait",
    expectedSection: "s2s-portrait-product",
    status: "verified",
    requiredSectionMarkers: [
      "data-s2s-portrait-product",
      "data-portrait-slide",
      "data-portrait-thumb",
      "data-s2s-photo",
      "data-s2s-variants",
    ],
    requiredTemplateSections: ["main", "details"],
  },
  {
    suffix: "s2s-mug",
    family: "portrait-mug",
    representative: "custom-pet-portrait-mug",
    expectedSection: "s2s-mug-product",
    status: "blocked",
    requiredSectionMarkers: [
      "data-s2s-mug-product",
      "data-s2s-upload-dropzone",
      "property_name: 'Upload Pet Photo 1'",
      "data-s2s-addon-group",
      "data-s2s-addon-skip-line",
      "data-s2s-addon-digital-download",
      "data-s2s-addon-santa-hat",
    ],
    requiredTemplateSections: ["main", "details"],
    reason: "The dedicated mug section now preserves the uploader and add-on controls, but paid add-on cart transactions still need draft-theme interaction verification.",
  },
  {
    suffix: "s2s-royal",
    family: "royal-portrait",
    representative: "the-baroness",
    expectedSection: "s2s-portrait-product",
    status: "provisional",
    requiredSectionMarkers: [
      "data-s2s-portrait-product",
      "data-portrait-slide",
      "data-portrait-thumb",
      "data-s2s-photo",
      "data-s2s-variants",
    ],
    requiredTemplateSections: ["main", "details"],
    reason: "The royal family now uses the captured multi-step portrait workflow; three-viewport interaction and visual parity still require draft verification.",
  },
  ...[
    ["s2s-accessory", "pet-accessory", "custom-pet-portrait-collar", "s2s-accessory-product"],
    ["s2s-addon", "addon", "add-a-santa-hat", "s2s-standard-product"],
    ["s2s-apparel", "standard-apparel", "cat-dad-embroidered-hoodie", "s2s-apparel-product"],
    ["s2s-custom-apparel", "custom-apparel", "custom-pet-face-pajama-short-sleeve-shirt", "s2s-custom-apparel-product"],
    ["s2s-embroidered", "custom-embroidered", "custom-pet-embroidery-crewneck", "s2s-embroidered-product"],
    ["s2s-gift-card", "gift-card", "gift-card", "s2s-gift-card-product"],
    ["s2s-hat", "hat", "cat-mom-dad-hat", "s2s-hat-product"],
    ["s2s-home", "custom-home-gift", "custom-pet-blanket", "s2s-home-product"],
    ["s2s-jewelry", "custom-jewelry", "custom-engraved-pet-portrait-necklace", "s2s-jewelry-product"],
    ["s2s-phone", "phone-case", "custom-pet-portrait-phone-cases", "s2s-phone-product"],
    ["s2s-quote", "quote-sign", "be-the-person-your-dog-things-you-are", "s2s-quote-product"],
  ].map(([suffix, family, representative, expectedSection]) => ({
    suffix,
    family,
    representative,
    expectedSection,
    status: "provisional" as const,
    requiredSectionMarkers: ["data-s2s-variants", "data-family-slide", "data-family-thumb"],
    requiredTemplateSections: ["main", "details"],
    reason: "A representative source workflow has not yet passed structural, interaction, and visual parity review.",
  })),
];

function validateContracts(contracts: ProductFamilyContract[]) {
  if (!contracts.length) throw new Error("Product family contract matrix is empty.");
  const suffixes = new Set<string>();
  for (const contract of contracts) {
    if (!contract.suffix || !contract.family || !contract.representative || !contract.expectedSection)
      throw new Error("Every product family contract needs suffix, family, representative, and expectedSection.");
    if (suffixes.has(contract.suffix))
      throw new Error(`Duplicate product family contract suffix: ${contract.suffix}`);
    suffixes.add(contract.suffix);
    if (!["verified", "provisional", "blocked"].includes(contract.status))
      throw new Error(`Invalid contract status for ${contract.suffix}: ${contract.status}`);
  }
  return contracts;
}

export async function loadProductFamilyContracts(out: string) {
  const configured = await readJson<ProductFamilyContractConfig>(contractFile(out)).catch(() => null);
  return validateContracts(configured?.contracts || productFamilyContracts);
}

function generatedTemplateSections(template: any, fallback: string[]) {
  const sections = template?.sections;
  if (!sections?.main) return fallback;
  if (sections.details_before && sections.loox_reviews && sections.details_after)
    return ["main", "details_before", "loox_reviews", "details_after"];
  if (sections.details && sections.loox_reviews)
    return ["main", "details", "loox_reviews"];
  return fallback;
}

// Keep reviewed project state (status, evidence markers, rationale) while syncing
// generator-owned section topology. Otherwise an older matrix can continue to
// demand the former generic section after the generator has introduced a
// dedicated family section, blocking every later draft upload.
export async function reconcileProductFamilyContractSections(out: string) {
  const configured = await readJson<ProductFamilyContractConfig>(contractFile(out)).catch(() => null);
  if (!configured) return null;
  const canonical = new Map(productFamilyContracts.map(contract => [contract.suffix, contract.expectedSection]));
  let changed = false;
  const contracts = await Promise.all(validateContracts(configured.contracts).map(async contract => {
    const expectedSection = canonical.get(contract.suffix) || contract.expectedSection;
    const template = await readJson<any>(join(out, "theme", "templates", `product.${contract.suffix}.json`)).catch(() => null);
    const requiredTemplateSections = generatedTemplateSections(template, contract.requiredTemplateSections);
    if (expectedSection === contract.expectedSection
      && JSON.stringify(requiredTemplateSections) === JSON.stringify(contract.requiredTemplateSections)) return contract;
    changed = true;
    return { ...contract, expectedSection, requiredTemplateSections };
  }));
  if (!changed) return configured;
  const result = { ...configured, generatedAt: new Date().toISOString(), contracts };
  await json(contractFile(out), result);
  return result;
}

async function loadProductTemplatePlan(out: string) {
  return await readJson<any>(join(out, "phase3-product-template-plan.json")).catch(async () => {
    const productPlan = await readJson<any>(join(out, "phase3-product-plan.json"));
    return {
      source: productPlan.source,
      products: (productPlan.products || []).map((product: any) => ({
        id: null,
        handle: product.handle,
        family: product.family,
        currentStatus: "DRAFT",
        templateSuffix: product.input?.templateSuffix,
      })),
    };
  });
}

export async function initProductFamilyContracts(out: string, force = false) {
  const existing = await readJson<ProductFamilyContractConfig>(contractFile(out)).catch(() => null);
  if (existing && !force)
    throw new Error("product-family-contracts.json already exists. Use --force only when you intend to replace the reviewed matrix.");
  const plan = await loadProductTemplatePlan(out);
  const products = Array.isArray(plan.products) ? plan.products : [];
  const suffixes: string[] = [...new Set<string>(products.map((product: any) => String(product.templateSuffix || "")).filter(Boolean))].sort();
  const contracts: ProductFamilyContract[] = [];
  for (const suffix of suffixes) {
    const familyProducts = products.filter((product: any) => product.templateSuffix === suffix);
    const families = new Map<string, number>();
    for (const product of familyProducts)
      families.set(String(product.family || "unclassified"), (families.get(String(product.family || "unclassified")) || 0) + 1);
    const family = [...families].sort((a, b) => b[1] - a[1])[0]?.[0] || "unclassified";
    const template = await readJson<any>(join(out, "theme", "templates", `product.${suffix}.json`)).catch(() => null);
    const expectedSection = template?.sections?.main?.type || `replace-with-${suffix}-section`;
    contracts.push({
      suffix,
      family,
      representative: familyProducts[0]?.handle || "replace-with-representative-handle",
      expectedSection,
      status: "provisional",
      requiredSectionMarkers: ["data-s2s-variants", "data-family-slide", "data-family-thumb"],
      requiredTemplateSections: ["main", "details"],
      reason: "Generated draft. Review the source workflow, assign a dedicated section where required, capture rendered states, and pass contract plus visual verification before marking verified.",
    });
  }
  const config: ProductFamilyContractConfig = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: plan.source,
    contracts,
  };
  await json(contractFile(out), config);
  return config;
}

type ContractResult = ProductFamilyContract & {
  productCount: number;
  actualSection: string | null;
  failures: string[];
};

const markdown = (results: ContractResult[], totalProducts: number) => {
  const lines = [
    "# Product family contract audit",
    "",
    `Products covered: ${totalProducts}`,
    "",
    "| Suffix | Family | Products | Status | Actual section | Result |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];
  for (const result of results)
    lines.push(
      `| ${result.suffix} | ${result.family} | ${result.productCount} | ${result.status} | ${result.actualSection || "missing"} | ${result.failures.length ? result.failures.join("; ") : "pass"} |`,
    );
  lines.push("", "## Release blockers", "");
  const blockers = results.filter(
    (result) => result.status !== "verified" || result.failures.length,
  );
  if (!blockers.length) lines.push("None.");
  for (const result of blockers)
    lines.push(
      `- ${result.suffix}: ${[result.reason, ...result.failures].filter(Boolean).join(" ")}`,
    );
  return lines.join("\n") + "\n";
};

export async function auditProductFamilyContracts(out: string) {
  const plan = await loadProductTemplatePlan(out);
  const products = Array.isArray(plan.products) ? plan.products : [];
  const contracts = await loadProductFamilyContracts(out);
  const sourceEvidence = await readJson<any>(join(out, "product-family-source-evidence.json")).catch(() => null);
  const results: ContractResult[] = [];
  for (const contract of contracts) {
    const familyProducts = products.filter(
      (product: any) => product.templateSuffix === contract.suffix,
    );
    const templatePath = join(out, "theme", "templates", `product.${contract.suffix}.json`);
    let template: any = null;
    const failures: string[] = [];
    try {
      template = JSON.parse(await readFile(templatePath, "utf8"));
    } catch {
      failures.push("template missing or invalid");
    }
    const actualSection = template?.sections?.main?.type || null;
    if (actualSection !== contract.expectedSection)
      failures.push(`expected ${contract.expectedSection}, found ${actualSection || "none"}`);
    for (const id of contract.requiredTemplateSections)
      if (!template?.sections?.[id]) failures.push(`template section ${id} missing`);
    if (!familyProducts.some((product: any) => product.handle === contract.representative || product.sourceHandle === contract.representative))
      failures.push(`representative ${contract.representative} missing from plan`);
    if (contract.status === "verified") {
      const evidence = sourceEvidence?.families?.find((item: any) => item.suffix === contract.suffix && item.representative === contract.representative);
      for (const { name: viewport } of REQUIRED_VIEWPORTS) {
        const initial = evidence?.viewports?.find((item: any) => item.name === viewport)?.states?.find((state: any) => state.state === "initial");
        if (!initial) failures.push(`${viewport} rendered source evidence missing`);
        else {
          const rejection = renderedEvidenceRejection({
            title: initial.data?.title,
            visibleText: initial.data?.visibleText,
          });
          if (rejection) failures.push(`${viewport} rendered source evidence invalid: ${rejection}`);
        }
      }
    }
    if (actualSection) {
      try {
        const section = await readLiquidComposition(out, "sections", actualSection);
        for (const marker of contract.requiredSectionMarkers)
          if (!section.includes(marker)) failures.push(`marker ${marker} missing`);
      } catch {
        failures.push(`section ${actualSection} missing`);
      }
    }
    results.push({
      ...contract,
      productCount: familyProducts.length,
      actualSection,
      failures,
    });
  }
  const uncontracted = products
    .map((product: any) => product.templateSuffix)
    .filter(
      (suffix: string, index: number, values: string[]) =>
        values.indexOf(suffix) === index &&
        !contracts.some((contract) => contract.suffix === suffix),
    );
  const counts = {
    products: products.length,
    contracts: results.length,
    verified: results.filter((result) => result.status === "verified").length,
    provisional: results.filter((result) => result.status === "provisional").length,
    blocked: results.filter((result) => result.status === "blocked").length,
    structuralFailures: results.filter((result) => result.failures.length).length,
    uncontracted: uncontracted.length,
  };
  const releaseReady =
    !uncontracted.length &&
    results.every(
      (result) => result.status === "verified" && !result.failures.length,
    );
  const report = {
    schemaVersion: 1,
    auditedAt: new Date().toISOString(),
    releaseReady,
    counts,
    uncontracted,
    results,
  };
  await json(join(out, "product-family-contract-audit.json"), report);
  await write(
    join(out, "product-family-contract-audit.md"),
    markdown(results, products.length),
  );
  return report;
}

export async function assertProductFamilyContracts(out: string) {
  const report = await auditProductFamilyContracts(out);
  if (!report.releaseReady)
    throw new Error(
      `Product family contract gate failed: ${report.counts.verified}/${report.counts.contracts} verified, ${report.counts.blocked} blocked, ${report.counts.provisional} provisional, ${report.counts.structuralFailures} structural failures, ${report.counts.uncontracted} uncontracted suffixes.`,
    );
  return report;
}

export async function assertProductFamilyDraftContracts(out: string) {
  const report = await auditProductFamilyContracts(out);
  const structuralFailures = report.results.flatMap((result) =>
    result.failures
      .filter((failure) => !failure.endsWith("rendered source evidence missing"))
      .map((failure) => `${result.suffix}: ${failure}`),
  );
  if (report.uncontracted.length || structuralFailures.length)
    throw new Error(
      `Product family draft gate failed: ${structuralFailures.length} structural failures, ${report.uncontracted.length} uncontracted suffixes. ${structuralFailures.join(" ")}`,
    );
  return report;
}
