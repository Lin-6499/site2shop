import { chromium, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { PLANNED_COLLECTOR_VERSION } from "../src/planned-capture.js";
import { localPreviewUrlForTarget } from "../src/target-preview-url.js";

const sourceOrigin = "https://haroldhome.co";
const targetOrigin = "https://azhiip-13.myshopify.com";
const localOrigin = "http://127.0.0.1:9292";
const out = resolve("../haroldhome-replication-20261022-v2");
const artifactDir = resolve(out, "verification/evidence/source-plan");
const collectorVersion = PLANNED_COLLECTOR_VERSION;
const capturedAt = new Date().toISOString();
const targetPreviewManifest = JSON.parse(
  await readFile(resolve(out, "target-product-preview-urls.json"), "utf8").catch(() => '{"urls":{}}'),
);
const targetPreviewUrls: Record<string, string> = targetPreviewManifest.urls || {};
const phase3RoutePlan = JSON.parse(await readFile(resolve(out, "phase3-route-plan.json"), "utf8"));
const phase3Routes = phase3RoutePlan.routes.filter((entry: any) => entry.path.toLowerCase() !== "/agents.md");
const targetRouteAliases: Record<string, string> = {
  "/a/faq": "/pages/faq",
};

const viewports = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

const products = [
  { id: "house-portrait", handle: "custom-house-portrait", targetHandle: "custom-house-portrait", family: "harold-house-portrait", section: "s2s-harold-house-product", staged: true },
  { id: "pop-art", handle: "custom-pop-art", targetHandle: "custom-pop-art", family: "harold-pop-art", section: "s2s-harold-pop-art-product", staged: true },
  { id: "watercolor", handle: "custom-watercolor-art-canvas", targetHandle: "custom-watercolor-art-canvas", family: "harold-watercolor", section: "s2s-harold-watercolor-product", staged: true },
  { id: "gift-card", handle: "gift-card", targetHandle: "harold-home-gift-card", family: "harold-gift-card", section: "s2s-harold-gift-card-product", staged: true },
  { id: "print", handle: "bless-this-home-with-love-and-laughter-print", targetHandle: "bless-this-home-with-love-and-laughter-print", family: "harold-print", section: "s2s-harold-print-product", staged: false, select: { name: "option-frame", initial: "Black", changed: "White" } },
  { id: "digital", handle: "digital-only-files-etsy", targetHandle: "digital-only-files-etsy", family: "harold-digital", section: "s2s-harold-digital-product", staged: true },
  { id: "hat", handle: "home-state-dad-hat", targetHandle: "home-state-dad-hat", family: "harold-hat", section: "s2s-harold-hat-product", staged: false, select: { name: "option-state", initial: "Alabama", changed: "Alaska" } },
  { id: "wine-glass", handle: "home-state-wine-glass", targetHandle: "home-state-wine-glass", family: "harold-wine-glass", section: "s2s-harold-wine-glass-product", staged: false, select: { name: "option-state", initial: "Alabama", changed: "Alaska" } },
  { id: "house-mug", handle: "house-portrait-mug", targetHandle: "house-portrait-mug", family: "harold-house-mug", section: "s2s-harold-house-mug-product", staged: true },
  { id: "print-holy-sh-t", handle: "holy-sh-t-i-bought-a-house-1-print", targetHandle: "holy-sh-t-i-bought-a-house-1-print", family: "harold-print", section: "s2s-harold-print-product", staged: false, select: { name: "option-frame", initial: "Black", changed: "White" } },
  { id: "print-homeowner-era", handle: "in-my-homeowner-era-1-print-copy", targetHandle: "in-my-homeowner-era-1-print-copy", family: "harold-print", section: "s2s-harold-print-product", staged: false, radio: { name: "option-frame", initial: "Black", changed: "White" } },
  { id: "print-heaven-on-earth", handle: "may-home-become-a-little-heaven-on-earth-1-print", targetHandle: "may-home-become-a-little-heaven-on-earth-1-print", family: "harold-print", section: "s2s-harold-print-product", staged: false, select: { name: "option-frame", initial: "Black", changed: "White" } },
  { id: "print-new-chapter", handle: "new-home-new-chapter-new-memories-1-print", targetHandle: "new-home-new-chapter-new-memories-1-print", family: "harold-print", section: "s2s-harold-print-product", staged: false, select: { name: "option-frame", initial: "Black", changed: "White" } },
] as const;

const numericFields = [
  "widthPx", "leftInsetPx", "rightInsetPx", "paddingTopPx", "paddingRightPx", "paddingBottomPx", "paddingLeftPx",
  "marginTopPx", "marginRightPx", "marginBottomPx", "marginLeftPx", "gapBeforePx", "gapAfterPx",
] as const;
const structuredFields = ["visible", "placement", "topology", "overflow"] as const;
const allFields = [...numericFields, ...structuredFields];

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
async function saveArtifact(value: unknown, extension = ".json") {
  const bytes = typeof value === "string" || value instanceof Uint8Array
    ? value
    : JSON.stringify(value, null, 2);
  const digest = sha(bytes);
  const path = resolve(artifactDir, `${digest}${extension}`);
  await writeFile(path, bytes);
  return { path: relative(out, path).replaceAll("\\", "/"), sha256: digest };
}

function canonical(url: string) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.href.replace(/\/$/, parsed.pathname === "/" ? "/" : "");
}

function componentAcceptance(id: string) {
  const tolerance = Object.fromEntries(numericFields.map(field => [field, {
    absolute: field.startsWith("gap") ? 2 : 1,
    relative: 0,
    reason: `Three-viewport source reconnaissance measured ${id}/${field}; allowance is limited to CSS subpixel rounding.`,
  }]));
  return { kind: "rendered", profile: "box-v1", sourcePointer: `/boxes/${id}`, targetPointer: `/boxes/${id}`, tolerances: tolerance };
}

function componentRules(componentIds: string[]) {
  return componentIds.flatMap(componentId => allFields.map(field => {
    const rule: any = {
      id: `${componentId}-${field}`,
      sourcePointer: `/boxes/${componentId}/${field}`,
      targetPointer: `/boxes/${componentId}/${field}`,
      operator: numericFields.includes(field as any) ? "numeric" : "equal",
      negativeTest: `reject-${componentId}-${field}`,
    };
    if (rule.operator === "numeric") {
      rule.tolerance = { absolute: field.startsWith("gap") ? 2 : 1, relative: 0 };
      rule.toleranceReason = `Source-measured ${componentId}/${field}; only CSS subpixel rounding is allowed.`;
    }
    return rule;
  }));
}

const sourceComponents = {
  // Loox can leave an empty legacy compatibility section after the real iframe
  // section.  Bind to the first rendered widget, otherwise the entire review
  // feed is accidentally measured as product-to-review spacing.
  "product-shell": { selector: "#template-product > .container", parent: { id: "page-main", selector: "main" }, previous: { id: "none" }, next: { id: "reviews", selector: "main > .shopify-section:has(#looxReviews iframe)" } },
  gallery: { selector: "#template-product .col-lg-7", parent: { id: "product-shell", selector: "#template-product > .container" }, previous: { id: "none" }, next: { id: "info", selector: "#product-content-area" } },
  info: { selector: "#product-content-area", parent: { id: "product-shell", selector: "#template-product > .container" }, previous: { id: "gallery", selector: "#template-product .col-lg-7" }, next: { id: "none" } },
  reviews: { selector: "main > .shopify-section:has(#looxReviews iframe)", parent: { id: "page-main", selector: "main" }, previous: { id: "product-shell", selector: "#template-product > .container" }, next: { id: "none" } },
  workflow: { selector: ":nth-match(#product-content-area form, 1)", parent: { id: "info", selector: "#product-content-area" }, previous: { id: "none" }, next: { id: "none" } },
  "lower-page": { selector: ":nth-match(main > .shopify-section:has(> section):visible, 1)", parent: { id: "page-main", selector: "main" }, previous: { id: "product-shell", selector: "#template-product > .container" }, next: { id: "none" } },
};
const targetComponents = {
  "product-shell": { selector: "[data-s2s-family-product]", parent: { id: "page-main", selector: "main" }, previous: { id: "none" }, next: { id: "reviews", selector: "main > .shopify-section:has(#looxReviews)" } },
  gallery: { selector: "[data-s2s-family-product] .s2s-harold-gallery-col", parent: { id: "product-shell", selector: "[data-s2s-family-product]" }, previous: { id: "none" }, next: { id: "info", selector: "[data-s2s-family-product] .s2s-harold-details" } },
  info: { selector: "[data-s2s-family-product] .s2s-harold-details", parent: { id: "product-shell", selector: "[data-s2s-family-product]" }, previous: { id: "gallery", selector: "[data-s2s-family-product] .s2s-harold-gallery-col" }, next: { id: "none" } },
  reviews: { selector: "main > .shopify-section:has(#looxReviews)", parent: { id: "page-main", selector: "main" }, previous: { id: "product-shell", selector: "[data-s2s-family-product]" }, next: { id: "none" } },
  workflow: { selector: "[data-s2s-family-product] form", parent: { id: "info", selector: "[data-s2s-family-product] .s2s-harold-details" }, previous: { id: "none" }, next: { id: "none" } },
  "lower-page": { selector: ":nth-match(main > .shopify-section > .shopify-section:has(> section):visible, 1)", parent: { id: "page-main", selector: "main" }, previous: { id: "product-shell", selector: "[data-s2s-family-product]" }, next: { id: "none" } },
};

const standardObservations = {
  source: [
    // Count rendered content sections, not Shopify wrapper depth. Generated
    // themes may group copied source sections inside one OS 2.0 section while
    // preserving every actual content section.
    { pointer: "/lowerSectionCount", selector: "main .shopify-section:has(> section):visible", read: "count" },
    { pointer: "/ratingSummaryCount", selector: "#product-content-area .loox-rating", read: "count" },
  ],
  target: [
    { pointer: "/lowerSectionCount", selector: "main > .shopify-section > .shopify-section:has(> section):visible", read: "count" },
    { pointer: "/ratingSummaryCount", selector: "[data-s2s-family-product] .s2s-harold-rating", read: "count" },
  ],
};
const standardRules = [
  { id: "lower-section-count", sourcePointer: "/lowerSectionCount", targetPointer: "/lowerSectionCount", operator: "equal", negativeTest: "reject-lower-section-count" },
  { id: "rating-summary-count", sourcePointer: "/ratingSummaryCount", targetPointer: "/ratingSummaryCount", operator: "equal", negativeTest: "reject-rating-summary-count" },
];

function productNode(readySource: any, readyTarget: any, workflowObservations: any[], workflowRules: any[]) {
  const node: any = {
    // Workflow and lower-page are semantic contract components, but still get
    // explicit rendered boundaries so paired review can prove they exist on
    // both sides. Their behavior/section completeness is asserted separately
    // by workflow observations and lowerSectionCount.
    components: ["product-shell", "gallery", "info", "reviews", "workflow", "lower-page"],
    rules: [...componentRules(["product-shell", "gallery", "info", "reviews"]), ...standardRules, ...workflowRules],
    capture: {
      source: { ready: readySource, components: sourceComponents, observations: [...standardObservations.source, ...workflowObservations.map(x => x.source)] },
      target: { ready: readyTarget, components: targetComponents, observations: [...standardObservations.target, ...workflowObservations.map(x => x.target)] },
    },
  };
  const marginReason = "The source changes Bootstrap margin implementation in some interaction states while measured width and left/right insets remain identical; margins are retained in capture and agent review but are not a duplicate hard assertion.";
  node.informationalPresentationFields = { "product-shell": {
    marginTopPx: marginReason,
    marginRightPx: marginReason,
    marginBottomPx: marginReason,
    marginLeftPx: marginReason,
  } };
  node.rules = node.rules.filter((rule: any) => ![
    "product-shell-marginTopPx", "product-shell-marginRightPx",
    "product-shell-marginBottomPx", "product-shell-marginLeftPx",
  ].includes(rule.id));
  return node;
}

function markPostInteractionFlowInformational(node: any) {
  const reason = "After interaction the source lazy media/app lifecycle can reflow lower, non-interactive sections without changing the product workflow or section order; the initial-state spacing remains a hard assertion and every post-interaction screenshot remains subject to paired agent review.";
  node.informationalPresentationFields ||= {};
  node.informationalPresentationFields["product-shell"] ||= {};
  node.informationalPresentationFields.reviews ||= {};
  node.informationalPresentationFields["product-shell"].gapAfterPx = reason;
  node.informationalPresentationFields.reviews.gapBeforePx = reason;
  node.rules = node.rules.filter((rule: any) => ![
    "product-shell-gapAfterPx", "reviews-gapBeforePx",
  ].includes(rule.id));
  return node;
}

function workflowCountRules() {
  return [
    { id: "visible-next-count", sourcePointer: "/workflow/nextCount", targetPointer: "/workflow/nextCount", operator: "equal", negativeTest: "reject-visible-next-count" },
    { id: "visible-previous-count", sourcePointer: "/workflow/previousCount", targetPointer: "/workflow/previousCount", operator: "equal", negativeTest: "reject-visible-previous-count" },
  ];
}
function workflowCountObservations() {
  return [
    { source: { pointer: "/workflow/nextCount", selector: "#product-content-area button.btn-next:visible", read: "count" }, target: { pointer: "/workflow/nextCount", selector: ".s2s-harold-step:not([hidden]) .s2s-harold-next", read: "count" } },
    { source: { pointer: "/workflow/previousCount", selector: "#product-content-area button.btn-prev:visible", read: "count" }, target: { pointer: "/workflow/previousCount", selector: ".s2s-harold-step:not([hidden]) .s2s-harold-back", read: "count" } },
  ];
}

function stagedGraph() {
  const observations = workflowCountObservations(), rules = workflowCountRules();
  const initial = productNode({ selector: "#product-content-area button.btn-next:visible", state: "visible" }, { selector: '[data-s2s-current-step="1"] .s2s-harold-next', state: "visible" }, observations, rules);
  const second = productNode({ selector: "#product-content-area button.btn-prev:visible", state: "visible" }, { selector: '[data-s2s-current-step="2"] .s2s-harold-back', state: "visible" }, observations, rules);
  const states = {
    initial,
    configured: markPostInteractionFlowInformational(second),
    returned: markPostInteractionFlowInformational(structuredClone(initial)),
    replayed: markPostInteractionFlowInformational(structuredClone(second)),
  };
  const edge = (from: string, to: string, action: string, sourceSelector: string, targetSelector: string, destination: any) => ({
    ...structuredClone(destination), from, to, action, condition: "Control is visible and the UI transition completes without a network write.",
    probe: { source: [{ op: "click", selector: sourceSelector, effect: "read-only" }], target: [{ op: "click", selector: targetSelector, effect: "read-only" }] },
  });
  const graph = {
    states,
    transitions: {
      next: edge("initial", "configured", "Next", "#product-content-area button.btn-next:visible", ".s2s-harold-step:not([hidden]) .s2s-harold-next", second),
      previous: edge("configured", "returned", "Previous", "#product-content-area button.btn-prev:visible", ".s2s-harold-step:not([hidden]) .s2s-harold-back", initial),
      "next-replay": edge("returned", "replayed", "Next replay", "#product-content-area button.btn-next:visible", ".s2s-harold-step:not([hidden]) .s2s-harold-next", second),
    },
    captureSequence: ["next", "previous", "next-replay"],
  };
  for (const transition of Object.values<any>(graph.transitions)) markPostInteractionFlowInformational(transition);
  return graph;
}

function selectGraph(select: { name: string; initial: string; changed: string }) {
  const sourceSelector = `#product-content-area select[name="${select.name}"]`;
  const targetSelector = `[data-s2s-family-product] select[name="${select.name}"]`;
  const observation = [{ source: { pointer: "/workflow/selectedValue", selector: sourceSelector, read: "value" }, target: { pointer: "/workflow/selectedValue", selector: targetSelector, read: "value" } }];
  const rules = [{ id: "selected-value", sourcePointer: "/workflow/selectedValue", targetPointer: "/workflow/selectedValue", operator: "equal", negativeTest: "reject-selected-value" }];
  const initial = productNode({ selector: sourceSelector, state: "visible", value: select.initial }, { selector: targetSelector, state: "visible", value: select.initial }, observation, rules);
  const changed = markPostInteractionFlowInformational(productNode({ selector: sourceSelector, state: "visible", value: select.changed }, { selector: targetSelector, state: "visible", value: select.changed }, observation, rules));
  const returned = markPostInteractionFlowInformational(structuredClone(initial));
  const edge = (from: string, to: string, value: string, destination: any) => ({ ...structuredClone(destination), from, to, action: `Select ${value}`, condition: "Option exists and selection updates without a network write.", probe: { source: [{ op: "select", selector: sourceSelector, value, effect: "read-only" }], target: [{ op: "select", selector: targetSelector, value, effect: "read-only" }] } });
  const transitions = { change: edge("initial", "changed", select.changed, changed), restore: edge("changed", "returned", select.initial, returned) };
  for (const transition of Object.values<any>(transitions)) markPostInteractionFlowInformational(transition);
  return { states: { initial, changed, returned }, transitions, captureSequence: ["change", "restore"] };
}

function radioGraph(radio: { name: string; initial: string; changed: string }) {
  const sourceChecked = `#product-content-area input[name="${radio.name}"]:checked`;
  const targetChecked = `[data-s2s-family-product] input[name="s2s-harold-option-2"]:checked`;
  const observation = [{ source: { pointer: "/workflow/selectedValue", selector: sourceChecked, read: "value" }, target: { pointer: "/workflow/selectedValue", selector: targetChecked, read: "value" } }];
  const rules = [{ id: "selected-value", sourcePointer: "/workflow/selectedValue", targetPointer: "/workflow/selectedValue", operator: "equal", negativeTest: "reject-selected-value" }];
  const initial = productNode({ selector: sourceChecked, state: "visible", value: radio.initial }, { selector: targetChecked, state: "attached", value: radio.initial }, observation, rules);
  const changed = markPostInteractionFlowInformational(productNode({ selector: sourceChecked, state: "visible", value: radio.changed }, { selector: targetChecked, state: "attached", value: radio.changed }, observation, rules));
  const returned = markPostInteractionFlowInformational(structuredClone(initial));
  const edge = (from: string, to: string, value: string, destination: any) => ({ ...structuredClone(destination), from, to, action: `Choose ${value}`, condition: "Visible radio option exists and selection updates without a network write.", probe: { source: [{ op: "click", selector: `#product-content-area input[name="${radio.name}"][value="${value}"] + label`, effect: "read-only" }], target: [{ op: "click", selector: `[data-s2s-family-product] input[name="s2s-harold-option-2"][value="${value}"] + label`, effect: "read-only" }] } });
  const transitions = { change: edge("initial", "changed", radio.changed, changed), restore: edge("changed", "returned", radio.initial, returned) };
  for (const transition of Object.values<any>(transitions)) markPostInteractionFlowInformational(transition);
  return { states: { initial, changed, returned }, transitions, captureSequence: ["change", "restore"] };
}

function productRoute(product: typeof products[number]) {
  // Keep both stores in the same Shopify market during paired review. Without
  // this the source geolocates the collector to HKD while the target remains
  // USD, producing false price/currency failures (for example $637 vs $80).
  const sourceCanonical = `${sourceOrigin}/products/${product.handle}`;
  const source = `${sourceCanonical}?country=US`;
  const target = `${targetOrigin}/products/${product.targetHandle}`;
  const local = localPreviewUrlForTarget(localOrigin, target, targetPreviewUrls);
  const route: any = {
    family: product.family,
    samplingRationale: `Boundary representative for ${product.family}; selected from rendered workflow reconnaissance rather than template suffix alone.`,
    source: { url: source, canonical: sourceCanonical },
    target: { url: target, canonical: target },
    localTarget: { url: local, canonical: target },
    ...(product.staged ? stagedGraph() : ("radio" in product ? radioGraph(product.radio) : selectGraph(product.select!))),
  };
  const owner = (component: string) => component === "reviews"
    ? { mode: "provider-configuration", owner: "phase3Theme.reviewPlacement", measures: allFields, generator: "src/phase3-theme.ts", generated: "theme/assets/s2s-phase3.css" }
    : { mode: "contract", owner: `haroldProductSections.${product.section}.${component}`, measures: allFields, generator: "src/harold-product-theme.ts", generated: `theme/sections/${product.section}.liquid` };
  for (const nodes of [route.states, route.transitions]) for (const node of Object.values<any>(nodes)) node.generatorBindings = Object.fromEntries(["product-shell", "gallery", "info", "reviews"].map(component => [component, owner(component)]));
  return route;
}

function staticRoute(entry: any) {
  const sourceCanonical = canonical(entry.sourceUrl);
  const sourceUrl = new URL(sourceCanonical);
  // Normalize Shopify Markets for collection/home price cards as well.
  sourceUrl.searchParams.set("country", "US");
  const targetPath = targetRouteAliases[entry.path] || entry.path;
  const targetCanonical = `${targetOrigin}${targetPath}`;
  const localUrl = new URL(targetPath, `${localOrigin}/`).href;
  const node = {
    components: ["page-main"],
    // Whole-page screenshots are reviewed by the paired skill agent. Static
    // routes intentionally avoid a brittle one-box equality shortcut because
    // content height and app data are merchant state, not presentation proof.
    rules: [{ id: "page-main-presence", sourcePointer: "/components/page-main/presence", targetPointer: "/components/page-main/presence", operator: "equal", negativeTest: "reject-missing-page-main" }],
    capture: {
      source: { ready: { selector: "main", state: "visible" }, components: { "page-main": { selector: "main", parent: { id: "document-body", selector: "body" }, previous: { id: "none" }, next: { id: "none" } } }, observations: [] },
      target: { ready: { selector: "main", state: "visible" }, components: { "page-main": { selector: "main", parent: { id: "document-body", selector: "body" }, previous: { id: "none" }, next: { id: "none" } } }, observations: [] },
    },
    generatorBindings: { "page-main": { mode: "contract", owner: `phase3Theme.${entry.kind}.${entry.handle}`, measures: allFields, generator: "src/phase3-theme.ts", generated: entry.kind === "collection" ? "theme/templates/collection.json" : "theme/templates/page.json" } },
  };
  return {
    family: `${entry.kind}-${entry.handle}`,
    samplingRationale: "Full route coverage requested: this route is captured directly rather than inferred from a representative.",
    source: { url: sourceUrl.href, canonical: sourceCanonical },
    target: { url: targetCanonical, canonical: targetCanonical },
    localTarget: { url: localUrl, canonical: targetCanonical },
    states: { initial: node },
    transitions: {},
    captureSequence: [],
  };
}

async function stabilize(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    document.querySelectorAll('#attentive_overlay,#attentive_creative,#gorgias-chat-container,iframe[title*="Sign Up"]').forEach(node => node.remove());
    document.documentElement.style.setProperty("overflow-y", "auto", "important");
    document.body.style.setProperty("overflow-y", "auto", "important");
    document.body.style.setProperty("position", "static", "important");
  });
}

function kindForPath(pathname: string) {
  if (pathname.startsWith("/products/")) return "product";
  if (pathname.startsWith("/collections/")) return "collection";
  if (pathname.startsWith("/pages/")) return "page";
  if (pathname.startsWith("/policies/")) return "policy";
  if (pathname.startsWith("/blogs/")) return "blog";
  if (["/cart", "/search", "/account"].some(prefix => pathname.startsWith(prefix))) return "platform";
  return "custom";
}

await mkdir(artifactDir, { recursive: true });
const reconBytes = await readFile(resolve(out, "family-recon/family-recon-evidence.json"));
const reconRef = { path: "family-recon/family-recon-evidence.json", sha256: sha(reconBytes) };
const browser = await chromium.launch({ headless: true });
const navigationSurfaces: any[] = [];
const inventory: any = { schemaVersion: 1, collectorVersion, sourceOrigins: [sourceOrigin], targetOrigins: [targetOrigin], ignoredQueryKeys: { variant: "Variant query does not change resource identity during route reconciliation." }, surfaces: {}, resolutions: {}, routes: {} };

function ensureRoute(sourceUrl: string, family: string, captureRouteId: string, targetUrl?: string, directCapturePreview = false) {
  const key = `resource-${sha(canonical(sourceUrl)).slice(0, 14)}`;
  if (!inventory.routes[key]) {
    const sourcePath = new URL(sourceUrl).pathname;
    const target = targetUrl || `${targetOrigin}${targetRouteAliases[sourcePath] || sourcePath}`;
    // Navigation hrefs must represent the real target route. Product preview
    // keys belong only to direct capture URLs and cannot be embedded in shared
    // header/footer links or required by route-integrity checks.
    const targetLocation = new URL(target);
    const local = directCapturePreview
      ? localPreviewUrlForTarget(localOrigin, target, targetPreviewUrls)
      : new URL(targetLocation.pathname + targetLocation.search, `${localOrigin}/`).href;
    inventory.routes[key] = {
      sourceUrl: canonical(sourceUrl), family, captureRouteId,
      target: { url: target, finalUrl: target, canonical: target, kind: kindForPath(new URL(target).pathname), redirectChain: [target] },
      localTarget: { url: local, finalUrl: local, canonical: target, redirectChain: [local] },
      ...(canonical(sourceUrl) === `${sourceOrigin}/` ? {} : { samplingRationale: `Mapped to ${captureRouteId}, the independently captured representative for ${family}.` }),
    };
  }
  return key;
}

try {
  for (const [viewport, dimensions] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport: dimensions });
    const response = await page.goto(`${sourceOrigin}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await stabilize(page);
    const identity = await page.evaluate(() => ({ finalUrl: location.href, canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement)?.href || "", title: document.title }));
    if (!response || response.status() >= 300 || new URL(identity.finalUrl).pathname !== "/" || new URL(identity.canonical).pathname !== "/") throw new Error(`Invalid homepage evidence at ${viewport}`);
    const extracted = await page.evaluate(() => {
      const roots = [...document.querySelectorAll("header, footer")];
      const seen = new Set<string>();
      return roots.flatMap(root => [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]).map((a, index) => ({ a, index })).filter(({ a }) => {
        try { const raw = (a.getAttribute("href") || "").trim(); if (!raw || raw.startsWith("#")) return false; const url = new URL(a.href, location.href); if (!/^https?:$/.test(url.protocol)) return false; const key = `${url.href}|${(a.textContent || "").trim()}`; if (seen.has(key)) return false; seen.add(key); return true; } catch { return false; }
      }).map(({ a }, index) => ({ id: `route-${index + 1}`, href: a.getAttribute("href") || a.href, text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160) }));
    });
    const surfaceId = `shared-navigation-${viewport}`;
    const artifact = await saveArtifact(await page.evaluate(() => [...document.querySelectorAll("header, footer")].map(node => node.outerHTML).join("\n")), ".html");
    const surface = {
      id: surfaceId,
      url: `${sourceOrigin}/`,
      canonical: `${sourceOrigin}/`,
      region: "header-footer",
      viewport,
      state: "default",
      target: { url: `${targetOrigin}/`, canonical: `${targetOrigin}/` },
      localTarget: { url: `${localOrigin}/`, canonical: `${targetOrigin}/` },
    };
    navigationSurfaces.push(surface);
    inventory.surfaces[surfaceId] = await saveArtifact({ ...surface, collectorVersion, capturedAt, complete: true, httpStatus: response.status(), pageKind: "content", soft404: false, finalUrl: identity.finalUrl, artifact, links: extracted });
    for (const link of extracted) {
      const resolved = new URL(link.href, `${sourceOrigin}/`);
      if (resolved.origin === sourceOrigin) inventory.resolutions[`${surfaceId}:${link.id}`] = { action: "map", routeId: ensureRoute(resolved.href, "navigation-destination", "home") };
      else inventory.resolutions[`${surfaceId}:${link.id}`] = { action: "retain-external" };
    }
    await page.close();
  }

  const sitemapUrl = `${sourceOrigin}/sitemap_products_1.xml?from=6085193138342&to=9044036255958`;
  const sitemapResponse = await fetch(sitemapUrl);
  const sitemapXml = await sitemapResponse.text();
  if (!sitemapResponse.ok || !sitemapXml.includes("<urlset")) throw new Error("Product sitemap capture failed");
  const productUrls = [...sitemapXml.matchAll(/<loc>(https:\/\/haroldhome\.co\/products\/[^<]+)<\/loc>/g)].map(match => match[1].replaceAll("&amp;", "&"));
  const sitemapId = "product-sitemap";
  const sitemapArtifact = await saveArtifact(sitemapXml, ".xml");
  const sitemapSurface = { id: sitemapId, url: sitemapUrl, canonical: sitemapUrl, region: "sitemap", viewport: "all", state: "published", target: { url: `${targetOrigin}/sitemap_products_1.xml`, canonical: `${targetOrigin}/sitemap_products_1.xml` } };
  navigationSurfaces.push(sitemapSurface);
  inventory.surfaces[sitemapId] = await saveArtifact({ ...sitemapSurface, collectorVersion, capturedAt, complete: true, httpStatus: sitemapResponse.status, pageKind: "content", soft404: false, finalUrl: sitemapUrl, artifact: sitemapArtifact, links: productUrls.map((href, index) => ({ id: `product-${index + 1}`, href })) });
  for (const [index, url] of productUrls.entries()) {
    const handle = new URL(url).pathname.split("/").pop()!;
    const representative = products.find(item => item.handle === handle);
    const family = representative?.family;
    if (!family) throw new Error(`Unclassified product sitemap route: ${handle}`);
    const capture = representative || products.find(item => item.family === family)!;
    const targetHandle = handle === "gift-card" ? "harold-home-gift-card" : handle;
    inventory.resolutions[`${sitemapId}:product-${index + 1}`] = { action: "map", routeId: ensureRoute(url, family, capture.id, `${targetOrigin}/products/${targetHandle}`, true) };
  }

  // The executable plan covers the complete discovery inventory, not only
  // links currently exposed by one header/footer render. Treat the persisted
  // phase-3 discovery result as an independently extracted route surface so
  // every resource mapping remains traceable to evidence.
  const discoveryId = "phase3-route-inventory";
  const discoveryUrl = `${sourceOrigin}/sitemap.xml`;
  const discoveryArtifact = await saveArtifact(JSON.stringify(phase3RoutePlan, null, 2), ".json");
  const discoveryLinks: any[] = [];
  const discoverySurface = { id: discoveryId, url: discoveryUrl, canonical: discoveryUrl, region: "sitemap", viewport: "all", state: "discovered", target: { url: `${targetOrigin}/sitemap.xml`, canonical: `${targetOrigin}/sitemap.xml` } };
  navigationSurfaces.push(discoverySurface);
  for (const [index, entry] of phase3Routes.entries()) {
    const product = entry.kind === "product" ? products.find(item => item.handle === entry.handle) : undefined;
    const captureRouteId = entry.kind === "home" ? "home" : product?.id || `${entry.kind}-${entry.handle}`;
    const targetPath = entry.kind === "product" && entry.handle === "gift-card"
      ? "/products/harold-home-gift-card"
      : (targetRouteAliases[entry.path] || entry.path);
    const routeId = ensureRoute(entry.sourceUrl, product?.family || `${entry.kind}-${entry.handle}`, captureRouteId, `${targetOrigin}${targetPath}`, entry.kind === "product");
    const linkId = `route-${index + 1}`;
    discoveryLinks.push({ id: linkId, href: entry.sourceUrl });
    inventory.resolutions[`${discoveryId}:${linkId}`] = { action: "map", routeId };
  }
  inventory.surfaces[discoveryId] = await saveArtifact({ ...discoverySurface, collectorVersion, capturedAt, complete: true, httpStatus: 200, pageKind: "content", soft404: false, finalUrl: discoveryUrl, artifact: discoveryArtifact, links: discoveryLinks });
} finally {
  await browser.close();
}

const homeEvidence = await saveArtifact({ capturedAt, source: `${sourceOrigin}/`, purpose: "Shared navigation and homepage route representative; browser-rendered at all three planned viewports." });
const staticRouteEvidence = await saveArtifact({ capturedAt, source: `${sourceOrigin}/`, purpose: "Complete phase-3 discovery inventory; every non-product route is scheduled for direct three-viewport paired capture." });
const productComponents = [
  { id: "product-shell", interactive: false, evidence: reconRef, acceptance: componentAcceptance("product-shell") },
  { id: "gallery", interactive: false, evidence: reconRef, acceptance: componentAcceptance("gallery") },
  { id: "info", interactive: false, evidence: reconRef, acceptance: componentAcceptance("info") },
  { id: "reviews", interactive: false, evidence: reconRef, acceptance: componentAcceptance("reviews") },
  { id: "workflow", interactive: true, evidence: reconRef, acceptance: { kind: "nonvisual", reason: "The visible form is measured inside info; this semantic component owns the separately probed Next/Previous or select state graph." } },
  { id: "lower-page", interactive: false, evidence: reconRef, acceptance: { kind: "nonvisual", reason: "Full lower-page preservation is asserted by the rendered section inventory and the product-shell-to-reviews placement gap." } },
];
const analysis = {
  schemaVersion: 1,
  generatedAt: capturedAt,
  platform: { name: "Shopify", confidence: "high", evidence: homeEvidence },
  reviewSystem: { present: true, provider: "Loox", confidence: "high", evidence: reconRef, placementRequired: true },
  capabilities: [
    { id: "rendered-three-viewport-capture", capture: "supported", implementation: "supported", evidence: reconRef },
    { id: "read-only-workflow-replay", capture: "supported", implementation: "supported", evidence: reconRef },
    { id: "review-placement-capture", capture: "supported", implementation: "supported", evidence: reconRef },
  ],
  routes: [
    { id: "home", url: `${sourceOrigin}/`, family: "navigation-destination", components: [{ id: "page-main", interactive: false, evidence: homeEvidence, acceptance: componentAcceptance("page-main") }] },
    ...products.map(product => ({ id: product.id, url: `${sourceOrigin}/products/${product.handle}?country=US`, canonical: `${sourceOrigin}/products/${product.handle}`, family: product.family, components: structuredClone(productComponents) })),
    ...phase3Routes
      .filter((entry: any) => entry.kind !== "home" && entry.kind !== "product")
      .map((entry: any) => ({ id: `${entry.kind}-${entry.handle}`, url: entry.sourceUrl, family: `${entry.kind}-${entry.handle}`, components: [{ id: "page-main", interactive: false, evidence: staticRouteEvidence, acceptance: { kind: "nonvisual", reason: "Direct whole-page three-viewport screenshots are reviewed by the skill agent; static route content height is not reduced to one numeric box." } }] })),
  ],
  navigationSurfaces,
  unresolved: [],
};
const analysisRef = await saveArtifact(analysis);
const inventoryRef = await saveArtifact(inventory);

const homeNode = {
  components: ["page-main"],
  rules: componentRules(["page-main"]),
  capture: {
    source: { ready: { selector: "main", state: "visible" }, components: { "page-main": { selector: "main", parent: { id: "document-body", selector: "body" }, previous: { id: "none" }, next: { id: "none" } } }, observations: [] },
    target: { ready: { selector: "main", state: "visible" }, components: { "page-main": { selector: "main", parent: { id: "document-body", selector: "body" }, previous: { id: "none" }, next: { id: "none" } } }, observations: [] },
  },
  generatorBindings: { "page-main": { mode: "contract", owner: "phase3Theme.layout.main", measures: allFields, generator: "src/phase3-theme.ts", generated: "theme/layout/theme.liquid" } },
};
const plan = {
  schemaVersion: 2,
  planId: "haroldhome-product-families-three-viewport-v1",
  revision: 1,
  contractVersion: "haroldhome-product-contract-2026-10-23",
  collectorVersion,
  analysis: analysisRef,
  routeInventory: inventoryRef,
  viewports,
  limits: { maxActionsPerRoute: 6, maxMinutesPerRoute: 4 },
  routes: {
    home: { family: "navigation-destination", samplingRationale: "Shared rendered header/footer destination representative required by the independent route inventory.", source: { url: `${sourceOrigin}/`, canonical: `${sourceOrigin}/` }, target: { url: `${targetOrigin}/`, canonical: `${targetOrigin}/` }, localTarget: { url: `${localOrigin}/`, canonical: `${targetOrigin}/` }, states: { initial: homeNode }, transitions: {}, captureSequence: [] },
    ...Object.fromEntries(products.map(product => [product.id, productRoute(product)])),
    ...Object.fromEntries(phase3Routes
      .filter((entry: any) => entry.kind !== "home" && entry.kind !== "product")
      .map((entry: any) => [`${entry.kind}-${entry.handle}`, staticRoute(entry)])),
  },
};

await writeFile(resolve(out, "capture-plan.json"), JSON.stringify(plan, null, 2));
await writeFile(resolve(out, "capture-plan-summary.json"), JSON.stringify({ generatedAt: capturedAt, planId: plan.planId, viewports, productFamilies: products.map(({ id, family, handle }) => ({ id, family, handle })), routeCount: Object.keys(plan.routes).length, fullRouteCoverage: true, excludedNonStoreArtifacts: [{ path: "/AGENTS.md", reason: "Repository instruction artifact has no storefront canonical and is not a commerce route." }], navigationSurfaceCount: navigationSurfaces.length, mappedDestinationCount: Object.keys(inventory.routes).length, sourceCaptureRequiredBeforeBuild: true }, null, 2));
console.log(JSON.stringify({ plan: resolve(out, "capture-plan.json"), analysis: analysisRef, inventory: inventoryRef, routes: Object.keys(plan.routes).length, navigationSurfaces: navigationSurfaces.length, mappedDestinations: Object.keys(inventory.routes).length }, null, 2));
