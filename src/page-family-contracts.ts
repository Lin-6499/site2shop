import { load } from "cheerio";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./util.js";
import { buildPageReviewAdapter } from "./page-review-theme.js";

export const RENDERED_PAGE_TEMPLATE_SUFFIX = "s2s-rendered";

export type PageFamily = "prose" | "rendered-layout";

export type PageFamilyContract = {
  family: PageFamily;
  templateSuffix: string | null;
  marker: string;
  evidence: {
    shopifySections: number;
    semanticSections: number;
    containers: number;
    structuralRoots: number;
  };
};

export function classifyPageBody(body: string): PageFamilyContract {
  const $ = load(body, null, false);
  const shopifySections = $(".shopify-section,[id^='shopify-section-']").length;
  const semanticSections = $("section,article").length;
  const containers = $(".container,.container-fluid").length;
  const structuralRoots = $.root()
    .children()
    .filter((_, node) => !["style", "link", "meta"].includes(node.tagName || ""))
    .length;
  const rendered =
    shopifySections > 0 ||
    semanticSections > 0 ||
    containers > 0 ||
    structuralRoots > 1;
  return {
    family: rendered ? "rendered-layout" : "prose",
    templateSuffix: rendered ? RENDERED_PAGE_TEMPLATE_SUFFIX : null,
    marker: rendered ? "data-s2s-page-family=rendered-layout" : "s2s-content-page",
    evidence: { shopifySections, semanticSections, containers, structuralRoots },
  };
}

export async function assertPageFamilyDraftContracts(out: string) {
  const plan = await readJson<any>(join(out, "phase3-page-plan.json"));
  const binding = await readJson<any>(join(out, "phase3-page-binding.json")).catch(
    () => null,
  );
  const errors: string[] = [];
  const pages = Array.isArray(plan.pages) ? plan.pages : [];
  if (!pages.length) errors.push("page plan has no routes");
  for (const page of pages) {
    if (!page.family || !("templateSuffix" in page) || !page.marker)
      errors.push(`${page.handle || "unknown"}: missing page-family contract fields`);
    if (page.family === "rendered-layout" && page.templateSuffix !== RENDERED_PAGE_TEMPLATE_SUFFIX)
      errors.push(`${page.handle}: rendered layout is not assigned ${RENDERED_PAGE_TEMPLATE_SUFFIX}`);
  }
  if (!binding?.completed) {
    errors.push("page binding is missing or has not completed read-back verification");
  } else {
    const boundPages = Array.isArray(binding.pages) ? binding.pages : [];
    for (const page of pages) {
      const bound = boundPages.find((candidate: any) => candidate.handle === page.handle);
      if (!bound) {
        errors.push(`${page.handle}: no Shopify page binding exists`);
        continue;
      }
      const actualSuffix = bound.templateSuffix || null;
      const expectedSuffix = page.templateSuffix || null;
      if (actualSuffix !== expectedSuffix)
        errors.push(
          `${page.handle}: Shopify template binding is ${actualSuffix || "default"}, expected ${expectedSuffix || "default"}`,
        );
      if ((bound.expectedTemplateSuffix || null) !== expectedSuffix)
        errors.push(`${page.handle}: stored binding expectation is stale`);
    }
    if (binding.verification?.mismatches !== 0)
      errors.push("page binding read-back verification contains mismatches");
  }
  const template = await readFile(
    join(out, `theme/templates/page.${RENDERED_PAGE_TEMPLATE_SUFFIX}.json`),
    "utf8",
  ).catch(() => "");
  const section = await readFile(
    join(out, "theme/sections/s2s-rendered-page.liquid"),
    "utf8",
  ).catch(() => "");
  const fallbackSection = await readFile(
    join(out, "theme/sections/s2s-page.liquid"),
    "utf8",
  ).catch(() => "");
  if (!template.includes('"type":"s2s-rendered-page"'))
    errors.push("rendered page template is missing its generated section binding");
  const reviewPages = pages.filter((page: any) => page.reviewWidget?.slots > 0);
  if (reviewPages.length) {
    if (!template.includes('"page_loox_reviews"') || !template.includes('"type":"s2s-page-reviews"'))
      errors.push("rendered page template is missing its target-store review section");
    const reviewSection = await readFile(join(out, "theme/sections/s2s-page-reviews.liquid"), "utf8").catch(() => "");
    if (!reviewSection.includes('id="looxReviews"') || !reviewSection.includes("data-loox-aggregate"))
      errors.push("landing page review section is not bound to the target-store Loox runtime");
    for (const page of reviewPages)
      if (!page.input?.body?.includes("data-s2s-page-review-slot"))
        errors.push(`${page.handle}: review widget position marker is missing`);
  }
  if (!section.includes('data-s2s-page-family="rendered-layout"'))
    errors.push("rendered page section marker is missing");
  if (/s2s-rte|class="container/.test(section))
    errors.push("rendered page section is constrained by a prose/container wrapper");
  if (!fallbackSection.includes('data-s2s-template-fallback="true"'))
    errors.push("default page template is missing the rendered-layout fallback router");
  for (const page of pages.filter((candidate: any) => candidate.family === "rendered-layout"))
    if (!fallbackSection.includes(page.handle))
      errors.push(`${page.handle}: default page fallback router is missing this rendered route`);
  if (pages.some((page: any) => /loox-rating/.test(page.input?.body || ""))) {
    try {
      const content = await readJson<any>(join(out, "phase3-content-plan.json"));
      const productPlan = await readJson<any>(join(out, "phase3-product-plan.json"));
      const expected = buildPageReviewAdapter(pages, content.records || [], productPlan.products || []);
      const actualContent = await readFile(join(out, "theme/snippets/s2s-page-content.liquid"), "utf8");
      const actualMap = await readFile(join(out, "theme/snippets/s2s-page-rating-product.liquid"), "utf8");
      if (actualContent !== expected.content || actualMap !== expected.mapping)
        errors.push("page review adapter or target-product mapping is stale");
      for (const [name, template] of [["rendered", section], ["fallback", fallbackSection]])
        if (!template.includes("render 's2s-page-content'") || template.includes("{{ page.content }}"))
          errors.push(`${name} page bypasses the target review adapter`);
    } catch (error) {
      errors.push(`page review binding: ${(error as Error).message}`);
    }
  }
  if (errors.length)
    throw new Error(`Page family contract failed: ${errors.join("; ")}`);
  return {
    routes: pages.length,
    renderedLayouts: pages.filter((page: any) => page.family === "rendered-layout").length,
    prose: pages.filter((page: any) => page.family === "prose").length,
    boundRoutes: binding.pages.length,
  };
}
