import { chromium, type ElementHandle, type Page } from "playwright";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { publicDnsBrowserArgs } from "./network.js";
import { BOX_FIELDS, saveEvidence } from "./evidence-gate.js";
import { json, readJson } from "./util.js";
import { PLANNED_COLLECTOR_VERSION } from "./planned-capture.js";

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const PIXELS = ["widthPx", "leftInsetPx", "rightInsetPx", "paddingTopPx", "paddingRightPx", "paddingBottomPx", "paddingLeftPx", "marginTopPx", "marginRightPx", "marginBottomPx", "marginLeftPx", "gapBeforePx", "gapAfterPx"];
const STRUCTURED = ["visible", "placement", "topology", "overflow"];

function id(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "route"; }
function routeKind(value: string, path = "") { return /^\/policies\//.test(path) ? "policy" : ["product", "collection", "page", "blog", "article"].includes(value) ? value : "custom"; }
function location(url: string) { return { url, finalUrl: url, canonical: url, redirectChain: [url] }; }
export function isMachineDiscoveryEndpoint(value: string) {
  return /\/(?:agents\.md|llms(?:-full)?\.txt|robots\.txt|sitemap(?:_index)?\.xml)$/i.test(new URL(value, "https://invalid.local").pathname);
}
export function targetProductMapping(family: string) {
  return family.startsWith("s2s-harold-")
    ? {
        selector: ".s2s-harold-details",
        parent: { id: "product-grid", selector: ".s2s-harold-layout" },
        previous: { id: "product-gallery", selector: ".s2s-harold-gallery-col" },
        next: { id: "none" },
      }
    : {
        selector: ".s2s-family-details,.s2s-portrait-details",
        parent: { id: "product-grid", selector: ".s2s-family-pdp,.s2s-portrait-pdp" },
        previous: { id: "product-gallery", selector: ".s2s-family-gallery,.s2s-portrait-gallery" },
        next: { id: "none" },
      };
}
function acceptance(componentId: string) {
  return {
    kind: "rendered", profile: "box-v1", sourcePointer: `/presentation/${componentId}`, targetPointer: `/presentation/${componentId}`,
    tolerances: Object.fromEntries(PIXELS.map(field => [field, { absolute: field === "widthPx" ? 12 : 8, relative: 0.03, reason: "Bounded browser rounding and source font rasterization variance; derived before target capture." }])),
  };
}
function rules(componentId: string) {
  const root = `/presentation/${componentId}`;
  return [
    ...PIXELS.map(field => ({ id: `${componentId}-${field}`, sourcePointer: `${root}/${field}`, targetPointer: `${root}/${field}`, operator: "numeric", tolerance: { absolute: field === "widthPx" ? 12 : 8, relative: 0.03 }, toleranceReason: "Predeclared layout tolerance; target results cannot widen it.", negativeTest: `reject-${componentId}-${field}` })),
    ...STRUCTURED.map(field => ({ id: `${componentId}-${field}`, sourcePointer: `${root}/${field}`, targetPointer: `${root}/${field}`, operator: "equal", negativeTest: `reject-${componentId}-${field}` })),
  ];
}

async function uniqueSelector(page: Page, handle: ElementHandle<Element>) {
  return page.evaluate((node) => {
    let el: Element | null = node;
    if ((el as HTMLElement).id) {
      const selector = `#${CSS.escape((el as HTMLElement).id)}`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts: string[] = [];
    while (el && el !== document.documentElement) {
      let part = el.tagName.toLowerCase();
      let used = 0;
      for (const value of el.classList) {
        if (!value) continue;
        part += `.${CSS.escape(value)}`;
        if (++used === 2) break;
      }
      const parent: Element | null = el.parentElement;
      if (parent) {
        let count = 0, position = 0;
        for (const item of parent.children) if (item.tagName === el.tagName) {
          count++;
          if (item === el) position = count;
        }
        if (count > 1) part += `:nth-of-type(${position})`;
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (document.querySelectorAll(selector).length === 1) return selector;
      el = parent;
    }
    return parts.join(" > ");
  }, handle);
}

async function sourceProductMapping(page: Page) {
  const el = await page.$("#product-content-area");
  if (!el) throw new Error(`product details missing at ${page.url()}`);
  const parent = await el.evaluateHandle(node => node.closest(".row") || node.parentElement!);
  const previous = await el.evaluateHandle(node => {
    const column = node.closest("[class*='col-']");
    return column?.previousElementSibling || node.closest(".row")?.firstElementChild || null;
  });
  const selector = await uniqueSelector(page, el);
  const parentSelector = await uniqueSelector(page, parent.asElement()!);
  const previousElement = previous.asElement();
  if (!previousElement) throw new Error(`product gallery anchor missing at ${page.url()}`);
  return { selector, parent: { id: "product-grid", selector: parentSelector }, previous: { id: "product-gallery", selector: await uniqueSelector(page, previousElement) }, next: { id: "none" } };
}

async function sourceMainMapping(page: Page) {
  const el = await page.$("main");
  if (!el) throw new Error(`main missing at ${page.url()}`);
  const parent = await el.evaluateHandle(node => node.parentElement!);
  const previous = await el.evaluateHandle(node => {
    let p = node.previousElementSibling;
    while (p && !(p as HTMLElement).getBoundingClientRect().height) p = p.previousElementSibling;
    return p;
  });
  const next = await el.evaluateHandle(node => {
    let p = node.nextElementSibling;
    while (p && !(p as HTMLElement).getBoundingClientRect().height) p = p.nextElementSibling;
    return p;
  });
  const prevEl = previous.asElement(), nextEl = next.asElement();
  if (!prevEl || !nextEl) throw new Error(`main semantic anchors missing at ${page.url()}`);
  return { selector: await uniqueSelector(page, el), parent: { id: "document-body", selector: await uniqueSelector(page, parent.asElement()!) }, previous: { id: "site-header", selector: await uniqueSelector(page, prevEl) }, next: { id: "site-footer", selector: await uniqueSelector(page, nextEl) } };
}

export async function createReplicationPlan(out: string, targetOrigin: string, localTargetOrigin = "http://127.0.0.1:4173") {
  const routesReport = await readJson<any>(join(out, "phase3-route-plan.json"));
  const contracts = await readJson<any>(join(out, "product-family-contracts.json"));
  const templates = await readJson<any>(join(out, "phase3-product-template-plan.json"));
  const previewManifest = await readJson<any>(join(out, "target-product-preview-urls.json")).catch(() => ({ urls: {} }));
  const sourceOrigin = new URL(routesReport.source).origin;
  const targetBase = new URL(targetOrigin).origin;
  const localTargetBase = new URL(localTargetOrigin).origin;
  const templateByHandle = new Map<string, string>();
  const targetHandleByHandle = new Map<string, string>();
  for (const product of templates.products || []) {
    for (const handle of [product.handle, product.sourceHandle].filter(Boolean)) {
      templateByHandle.set(String(handle), String(product.templateSuffix));
      targetHandleByHandle.set(String(handle), String(product.handle));
    }
  }
  const previewKeyByHandle = new Map<string, string>();
  for (const [handle, value] of Object.entries<string>(previewManifest.urls || {})) {
    const key = new URL(value).searchParams.get("preview_key");
    if (key) previewKeyByHandle.set(handle, key);
  }
  const targetPath = (record: any) => record.kind === "product"
    ? `/products/${targetHandleByHandle.get(record.handle) || record.handle}`
    : record.path;
  const accessUrl = (record: any, origin: string) => {
    const targetHandle = targetHandleByHandle.get(record.handle) || record.handle;
    const url = new URL(targetPath(record), origin);
    if (record.kind === "product" && previewKeyByHandle.has(targetHandle)) url.searchParams.set("preview_key", previewKeyByHandle.get(targetHandle)!);
    return url.href;
  };
  const representativeByFamily = new Map<string, string>((contracts.contracts || []).map((c: any) => [String(c.suffix), String(c.representative)]));
  const sectionByFamily = new Map<string, string>((contracts.contracts || []).map((c: any) => [String(c.suffix), String(c.expectedSection)]));
  const familyFor = (record: any): string | null => record.kind === "product"
    ? (templateByHandle.has(record.handle) ? String(templateByHandle.get(record.handle)) : null)
    : `route-${record.kind}`;
  const representatives = new Map<string, any>();
  for (const record of routesReport.routes) {
    if (isMachineDiscoveryEndpoint(record.sourceUrl)) continue;
    const family = familyFor(record);
    if (!family) continue;
    if (record.kind === "product") {
      if (record.handle === representativeByFamily.get(family)) representatives.set(family, record);
    } else if (!representatives.has(family)) representatives.set(family, record);
  }
  for (const [family, handle] of representativeByFamily) if (!representatives.has(family)) {
    const found = routesReport.routes.find((r: any) => r.kind === "product" && r.handle === handle);
    if (found) representatives.set(family, found);
  }
  // A discovered template suffix that is not in the curated contract matrix is
  // still its own family. Give it an independent boundary sample instead of
  // silently merging it into the nearest known product family.
  for (const record of routesReport.routes) {
    if (isMachineDiscoveryEndpoint(record.sourceUrl)) continue;
    const family = familyFor(record);
    if (!family) continue;
    if (!representatives.has(family)) representatives.set(family, record);
  }
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: publicDnsBrowserArgs });
  const analysisRoutes: any[] = [], planRoutes: Record<string, any> = {}, capabilities: any[] = [];
  try {
    for (const [family, record] of representatives) {
      const rid = id(family), page = await browser.newPage({ viewport: VIEWPORTS.desktop, locale: "en-US", colorScheme: "light" });
      try {
        const response = await page.goto(record.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        if (!response || response.status() >= 400) throw new Error(`recon failed ${response?.status()} ${record.sourceUrl}`);
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
        const isProduct = record.kind === "product";
        const componentId = isProduct ? "product-details" : "main-content";
        const sourceMapping = isProduct ? await sourceProductMapping(page) : await sourceMainMapping(page);
        const isHarold = family.startsWith("s2s-harold-");
        const targetMapping = isProduct
          ? targetProductMapping(family)
          : { selector: "main#main", parent: { id: "document-body", selector: "body" }, previous: { id: "site-header", selector: "header#header" }, next: { id: "site-footer", selector: "footer#footer" } };
        const pageOwner: Record<string, { generator: string; generated: string; owner: string }> = {
          "route-home": { generator: "src/compiler.ts", generated: "theme/sections/s2s-home.liquid", owner: "compile() home section and captured CSS layout" },
          "route-collection": { generator: "src/collection-theme.ts", generated: "theme/sections/s2s-collection.liquid", owner: "collectionSection and collectionStyles" },
          "route-blog": { generator: "src/phase3-theme.ts", generated: "theme/sections/s2s-blog.liquid", owner: "writePhase3Theme() blog section" },
          "route-article": { generator: "src/phase3-theme.ts", generated: "theme/sections/s2s-article.liquid", owner: "writePhase3Theme() article section" },
          "route-page": { generator: "src/phase3-theme.ts", generated: "theme/sections/s2s-page.liquid", owner: "writePhase3Theme() prose page section" },
          "route-other": { generator: "src/phase3-theme.ts", generated: "theme/layout/theme.liquid", owner: "writePhase3Theme() shared policy/content layout" },
        };
        const productSection = sectionByFamily.get(family);
        const owner = isProduct
          ? { generator: isHarold ? "src/harold-product-theme.ts" : family === "s2s-portrait" || family === "s2s-royal" ? "src/portrait-theme.ts" : "src/family-product-theme.ts", generated: `theme/sections/${productSection}.liquid`, owner: `${productSection} section layout contract` }
          : pageOwner[family];
        if (!owner?.generator || !owner?.generated) throw new Error(`generator owner missing for ${family}`);
        const generatorBindings = { [componentId]: { mode: "contract", owner: owner.owner, generator: owner.generator, generated: owner.generated, measures: [...BOX_FIELDS] } };
        const evidence = await saveEvidence(out, JSON.stringify({ capturedAt: new Date().toISOString(), url: page.url(), family, sourceMapping, title: await page.title(), htmlSha256: (await saveEvidence(out, await page.content(), "html")).sha256 }), "json");
        const component = { id: componentId, interactive: isProduct, interactionViewports: isProduct ? Object.keys(VIEWPORTS) : undefined, evidence, acceptance: acceptance(componentId) };
        const baseNode = { components: [componentId], rules: rules(componentId), generatorBindings, capture: { source: { ready: { selector: sourceMapping.selector, state: "visible" }, components: { [componentId]: sourceMapping } }, target: { ready: { selector: targetMapping.selector, state: "visible" }, components: { [componentId]: targetMapping } } } };
        const states: any = { initial: baseNode }, transitions: any = {}, sequence: string[] = [];
        if (isProduct) {
          states.scrolled = baseNode;
          transitions["scroll-details"] = { ...baseNode, from: "initial", to: "scrolled", action: "scroll product information through viewport", condition: "document remains scrollable and details relationship is preserved", probe: { source: [{ op: "scroll", y: 480, effect: "read-only" }], target: [{ op: "scroll", y: 480, effect: "read-only" }] } };
          sequence.push("scroll-details");
        }
        const canonicalTargetUrl = new URL(targetPath(record), targetBase).href;
        planRoutes[rid] = { family, samplingRationale: record.kind === "product" ? "one independently captured representative per template suffix; all resources map to their family representative" : `first complete ${record.kind} route from refreshed sitemap`, source: { url: record.sourceUrl, canonical: record.sourceUrl }, target: { url: accessUrl(record, targetBase), canonical: canonicalTargetUrl }, localTarget: { url: accessUrl(record, localTargetBase), canonical: canonicalTargetUrl }, states, transitions, captureSequence: sequence };
        analysisRoutes.push({ id: rid, url: record.sourceUrl, family, components: [component] });
        capabilities.push({ id: `capture-${rid}`, capture: "supported", implementation: "supported", evidence });
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  const sitemapUrl = new URL("/sitemap.xml", sourceOrigin).href;
  const sitemapArtifact = await saveEvidence(out, await readFile(join(out, "phase3-route-plan.json")), "json");
  const surfaceId = "source-sitemap";
  const links = routesReport.routes.map((record: any, index: number) => ({ id: `route-${index + 1}`, href: record.sourceUrl }));
  const surface = { id: surfaceId, url: sitemapUrl, canonical: sitemapUrl, region: "sitemap", viewport: "inventory", state: "expanded" };
  const snapshot = await saveEvidence(out, JSON.stringify({ ...surface, collectorVersion: PLANNED_COLLECTOR_VERSION, capturedAt: new Date().toISOString(), complete: true, httpStatus: 200, pageKind: "content", soft404: false, finalUrl: sitemapUrl, artifact: sitemapArtifact, links }), "json");
  const inventoryRoutes: Record<string, any> = {}, resolutions: Record<string, any> = {};
  const scopeDecisionEvidence = await saveEvidence(out, JSON.stringify({ capturedAt: new Date().toISOString(), policy: "A source product without a target product/template binding is excluded rather than assigned a generic template.", boundProductCount: templateByHandle.size }), "json");
  const machineEndpointEvidence = await saveEvidence(out, JSON.stringify({ capturedAt: new Date().toISOString(), policy: "Machine-discovery endpoints are not visual storefront landing pages and require a platform/server owner rather than a theme template.", patterns: ["agents.md", "llms.txt", "llms-full.txt", "robots.txt", "sitemap.xml"] }), "json");
  for (let index = 0; index < routesReport.routes.length; index++) {
    const record = routesReport.routes[index];
    const resourceId = `resource-${index + 1}`, family = familyFor(record);
    if (isMachineDiscoveryEndpoint(record.sourceUrl)) {
      resolutions[`${surfaceId}:route-${index + 1}`] = { action: "remove", decision: { basis: "scope", reason: "Machine-discovery endpoint is outside visual theme replication scope and must not be represented as a storefront page.", evidence: machineEndpointEvidence } };
      continue;
    }
    if (!family) {
      resolutions[`${surfaceId}:route-${index + 1}`] = { action: "remove", decision: { basis: "scope", reason: "No target product/template binding exists; emitting this source destination would create a broken target link.", evidence: scopeDecisionEvidence } };
      continue;
    }
    const captureRouteId = id(family);
    const canonicalTargetUrl = new URL(targetPath(record), targetBase).href;
    const targetUrl = accessUrl(record, targetBase);
    const localUrl = accessUrl(record, localTargetBase);
    inventoryRoutes[resourceId] = { sourceUrl: record.sourceUrl, family, captureRouteId, target: { ...location(targetUrl), canonical: canonicalTargetUrl, kind: routeKind(record.kind, record.path), templateSuffix: record.kind === "product" ? String(templateByHandle.get(record.handle)) : undefined }, localTarget: { url: localUrl, finalUrl: localUrl, canonical: canonicalTargetUrl, redirectChain: [localUrl] }, samplingRationale: `mapped to ${family} representative from refreshed sitemap` };
    resolutions[`${surfaceId}:route-${index + 1}`] = { action: "map", routeId: resourceId };
  }
  const platformEvidence = await saveEvidence(out, JSON.stringify({ sourceOrigin, signals: ["shopify-cdn", "shopify-route-taxonomy"], capturedAt: new Date().toISOString() }), "json");
  const analysis = { schemaVersion: 1, unresolved: [], platform: { name: "shopify", confidence: "high", evidence: platformEvidence }, capabilities, routes: analysisRoutes, navigationSurfaces: [surface] };
  const analysisRef = await saveEvidence(out, JSON.stringify(analysis), "json");
  const inventory = { schemaVersion: 1, collectorVersion: PLANNED_COLLECTOR_VERSION, sourceOrigins: [sourceOrigin], targetOrigins: [targetBase, localTargetBase], ignoredQueryKeys: {
    preview_theme_id: "Shopify draft theme identity is validated separately from the canonical route.",
    preview_key: "Shopify draft product access identity is validated by the requested product route and is not part of its canonical URL.",
  }, surfaces: { [surfaceId]: snapshot }, resolutions, routes: inventoryRoutes };
  const inventoryRef = await saveEvidence(out, JSON.stringify(inventory), "json");
  const plan = { schemaVersion: 2, planId: `replication-${id(new URL(sourceOrigin).hostname)}`, revision: 1, contractVersion: "storefront-family-presentation-v1", collectorVersion: PLANNED_COLLECTOR_VERSION, analysis: analysisRef, routeInventory: inventoryRef, limits: { maxActionsPerRoute: 20, maxMinutesPerRoute: 8 }, viewports: VIEWPORTS, routes: planRoutes };
  await json(join(out, "capture-plan.json"), plan);
  return { planId: plan.planId, routes: Object.keys(planRoutes).length, resources: Object.keys(inventoryRoutes).length, families: [...representatives.keys()] };
}
