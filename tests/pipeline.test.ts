import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import { isPrivateIp, publicUrl } from "../src/network.js";
import {
  sanitize,
  packageTheme,
  extractProductDetails,
  extractProductDetailsParts,
  markRenderedReviewBoundary,
  addReviewRatingSlots,
  applyNavigationDispositions,
  applyNavigationRewrites,
  ensureHeaderInteractionContracts,
} from "../src/compiler.js";
import { writePhase3Theme } from "../src/phase3-theme.js";
import { safePageBody } from "../src/phase3-store.js";
import {
  haroldProductScript,
  haroldProductSections,
  haroldProductStyles,
  haroldProductTemplates,
} from "../src/harold-product-theme.js";
import { compareWorkflowState } from "../src/product-workflow-evidence.js";
import { assertCollectionFamilyContract } from "../src/collection-contracts.js";
import {
  assertProductFamilyContracts,
  assertProductFamilyDraftContracts,
  auditProductFamilyContracts,
  initProductFamilyContracts,
  loadProductFamilyContracts,
  productFamilyContracts,
  reconcileProductFamilyContractSections,
} from "../src/product-family-contracts.js";
import {
  rewriteCss,
  cssUrls,
  inspectRasterAsset,
  canonicalShopifyAssetUrl,
} from "../src/assets.js";
import { parseCliJson } from "../src/shopify.js";
import { classifyRoute, mergeRenderedNavigationRoutes, xmlLocations } from "../src/discover.js";
import { draftPreviewRoute, isBusinessWriteRequest } from "../src/planned-capture.js";
import { isMachineDiscoveryEndpoint, targetProductMapping } from "../src/replication-plan.js";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";

test("asset inspection rejects mislabeled unsupported image bytes", async () => {
  const jpeg = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 3,
      background: "#ffffff",
    },
  })
    .jpeg()
    .toBuffer();
  assert.deepEqual(await inspectRasterAsset(jpeg), {
    width: 3,
    height: 2,
    extension: ".jpeg",
  });
  const mislabeledJxl = Buffer.from(
    "0000000c4a584c200d0a870a00000014667479706a786c20",
    "hex",
  );
  await assert.rejects(
    inspectRasterAsset(mislabeledJxl),
    /unsupported image format|undecodable raster image format/i,
  );
});

test("online evidence routes preserve the unpublished theme identity on every pathname", () => {
  assert.equal(
    draftPreviewRoute(
      "https://shop.example/?preview_theme_id=123",
      "https://shop.example/products/sample?variant=456",
    ),
    "https://shop.example/products/sample?preview_theme_id=123&variant=456",
  );
});

test("capture write guard allows read-only Shopify bootstrap while still blocking commerce mutations", () => {
  const page = "https://example.com/products/sample";
  assert.equal(isBusinessWriteRequest("https://example.com/shopify_pay/accelerated_checkout", "POST", page), false);
  assert.equal(isBusinessWriteRequest("https://example.com/.well-known/shopify/monorail/unstable/produce_batch", "POST", page), false);
  assert.equal(isBusinessWriteRequest("https://example.com/api/collect", "POST", page), false);
  assert.equal(isBusinessWriteRequest("https://example.com/api/event/collect", "POST", page), false);
  assert.equal(isBusinessWriteRequest("https://example.com/cart/add.js", "POST", page), true);
  assert.equal(isBusinessWriteRequest("https://example.com/checkout", "POST", page), true);
});

test("replication reconnaissance excludes machine-discovery endpoints from visual route families", () => {
  assert.equal(isMachineDiscoveryEndpoint("https://example.com/agents.md"), true);
  assert.equal(isMachineDiscoveryEndpoint("https://example.com/llms-full.txt"), true);
  assert.equal(isMachineDiscoveryEndpoint("https://example.com/robots.txt"), true);
  assert.equal(isMachineDiscoveryEndpoint("https://example.com/sitemap.xml"), true);
  assert.equal(isMachineDiscoveryEndpoint("https://example.com/pages/agents"), false);
});

test("Harold presentation measurements use the Bootstrap row and column reference boxes", () => {
  const mapping = targetProductMapping("s2s-harold-house");
  assert.equal(mapping.selector, ".s2s-harold-details");
  assert.equal(mapping.parent.selector, ".s2s-harold-layout");
  assert.equal(mapping.previous.selector, ".s2s-harold-gallery-col");
});
import { join } from "node:path";
import { unzipSync } from "fflate";
import { assertGeneratedThemeIntegrity } from "../src/theme-integrity.js";
import {
  assertDraftVisualAuditNotFailed,
  assertReviewSystemViewportCoverage,
  assertVisualAuditPassed,
  PRODUCT_EVIDENCE_COLLECTOR_VERSION,
  PRODUCT_EVIDENCE_CONTRACT_VERSION,
  PRODUCT_EVIDENCE_SCHEMA_VERSION,
  reviewPlacementRequired,
} from "../src/product-family-evidence.js";
import { looxThemeSettings } from "../src/loox-theme.js";
import { REQUIRED_VIEWPORTS } from "../src/types.js";
import { renderedEvidenceRejection, routeIdentityRejection } from "../src/rendered-page-validity.js";
import { assertPageFamilyDraftContracts, classifyPageBody, RENDERED_PAGE_TEMPLATE_SUFFIX } from "../src/page-family-contracts.js";
import { assertAgentVisualReview, computeAgentVisualEvidenceDigest } from "../src/agent-visual-review.js";

test("desktop, tablet, and mobile are mandatory canonical viewports", () => {
  assert.deepEqual(REQUIRED_VIEWPORTS, [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ]);
});

test("blog cards follow the source single-column tablet contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-blog-breakpoint-test-"));
  try {
    await writePhase3Theme(dir);
    const css = await readFile(join(dir, "theme/assets/s2s-phase3.css"), "utf8");
    assert.match(css, /@media\(max-width:1024px\)\{\.s2s-article-grid\{grid-template-columns:1fr\}\}/);
    assert.doesNotMatch(css, /@media\(max-width:767px\)\{\.s2s-article-grid\{grid-template-columns:repeat\(2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty hidden review placeholders are not treated as rendered source evidence", () => {
  assert.equal(reviewPlacementRequired("product-summary", { present: true, visible: false, empty: true }), false);
  assert.equal(reviewPlacementRequired("product-summary", { present: true, visible: true, empty: true }), false);
  assert.equal(reviewPlacementRequired("product-summary", { present: true, visible: true, empty: false }), true);
  assert.equal(reviewPlacementRequired("product-widget", { present: true, visible: true, empty: true }), true);
});

test("structured pages use a rendered-layout template while prose keeps the default", async () => {
  const structured = classifyPageBody('<div class="shopify-section"><section class="container">Landing</section></div>');
  const prose = classifyPageBody('<p>Readable body copy.</p>');
  assert.equal(structured.family, "rendered-layout");
  assert.equal(structured.templateSuffix, RENDERED_PAGE_TEMPLATE_SUFFIX);
  assert.equal(prose.family, "prose");
  assert.equal(prose.templateSuffix, null);
  const dir = await mkdtemp(join(tmpdir(), "site2shop-page-family-test-"));
  try {
    await mkdir(join(dir, "theme/sections"), { recursive: true });
    await writeFile(join(dir, "theme/sections/s2s-product-details.liquid"), "details");
    await writeFile(join(dir, "phase3-page-plan.json"), JSON.stringify({ pages: [
      { handle: "landing", family: "rendered-layout", templateSuffix: RENDERED_PAGE_TEMPLATE_SUFFIX, marker: "data-s2s-page-family=rendered-layout", reviewWidget: { provider: "loox", slots: 1, dataPolicy: "target-store-only" }, input: { body: '<div data-s2s-page-review-slot="loox"></div>' } },
      { handle: "policy", family: "prose", templateSuffix: null, marker: "s2s-content-page" },
    ] }));
    await writePhase3Theme(dir);
    await writeFile(join(dir, "phase3-page-binding.json"), JSON.stringify({
      completed: true,
      verification: { mismatches: 0 },
      pages: [
        { handle: "landing", templateSuffix: RENDERED_PAGE_TEMPLATE_SUFFIX, expectedTemplateSuffix: RENDERED_PAGE_TEMPLATE_SUFFIX },
        { handle: "policy", templateSuffix: null, expectedTemplateSuffix: null },
      ],
    }));
    const template = JSON.parse(await readFile(join(dir, "theme/templates/page.s2s-rendered.json"), "utf8"));
    const section = await readFile(join(dir, "theme/sections/s2s-rendered-page.liquid"), "utf8");
    const proseSection = await readFile(join(dir, "theme/sections/s2s-page.liquid"), "utf8");
    assert.equal(template.sections.main.type, "s2s-rendered-page");
    assert.equal(template.sections.page_loox_reviews.type, "s2s-page-reviews");
    const reviewSection = await readFile(join(dir, "theme/sections/s2s-page-reviews.liquid"), "utf8");
    assert.match(reviewSection, /id="looxReviews"/);
    assert.match(reviewSection, /data-loox-aggregate/);
    assert.match(section, /data-s2s-page-family="rendered-layout"/);
    assert.doesNotMatch(section, /s2s-rte|class="container/);
    assert.match(proseSection, /s2s-rte/);
    assert.match(proseSection, /data-s2s-template-fallback="true"/);
    assert.match(proseSection, /landing/);
    assert.match(proseSection, /"name":"Reference page router"/);
    await assert.doesNotReject(assertPageFamilyDraftContracts(dir));
    await writeFile(join(dir, "phase3-page-binding.json"), JSON.stringify({
      completed: true,
      verification: { mismatches: 0 },
      pages: [
        { handle: "landing", templateSuffix: null, expectedTemplateSuffix: RENDERED_PAGE_TEMPLATE_SUFFIX },
        { handle: "policy", templateSuffix: null, expectedTemplateSuffix: null },
      ],
    }));
    await assert.rejects(assertPageFamilyDraftContracts(dir), /Shopify template binding is default, expected s2s-rendered/);
    await writeFile(join(dir, "phase3-page-binding.json"), JSON.stringify({
      completed: true,
      verification: { mismatches: 0 },
      pages: [
        { handle: "landing", templateSuffix: RENDERED_PAGE_TEMPLATE_SUFFIX, expectedTemplateSuffix: RENDERED_PAGE_TEMPLATE_SUFFIX },
        { handle: "policy", templateSuffix: null, expectedTemplateSuffix: null },
      ],
    }));
    await writeFile(join(dir, "theme/sections/s2s-rendered-page.liquid"), '<div class="container s2s-rte">{{ page.content }}</div>');
    await assert.rejects(assertPageFamilyDraftContracts(dir), /prose\/container wrapper/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("landing page sanitizer replaces source review entities with a positional target-app slot", () => {
  const input = '<section>Before</section><div class="shopify-block shopify-app-block"><div id="looxReviews" class="loox-widget" data-product-id=""><div id="loox-reviews-feed"><article class="loox-review">Source merchant review</article></div></div></div><section>After</section><a class="loox-rating" data-id="101"></a>';
  const output = safePageBody(input);
  const $ = load(output, null, false);
  assert.equal($("[data-s2s-page-review-slot='loox']").length, 1);
  assert.equal($("#looxReviews,#loox-reviews-feed,.loox-review").length, 0);
  assert.equal($(".loox-rating").length, 1, "summary remains available for target-product binding");
  assert.equal($("section").first().next().attr("data-s2s-page-review-slot"), "loox");
  assert.equal($("section").last().text(), "After");
});

test("password and anti-bot pages cannot become rendered evidence", () => {
  assert.equal(renderedEvidenceRejection({ title: "Please Log In", visibleText: "Will be opening soon... Enter store using password:" }), "storefront password page");
  assert.equal(renderedEvidenceRejection({ title: "Just a moment...", html: '<div id="cf-chl-widget"></div>' }), "anti-bot challenge page");
  assert.equal(renderedEvidenceRejection({ status: 429, title: "Product" }), "HTTP 429");
  assert.equal(renderedEvidenceRejection({ status: 200, title: "Custom Pet Portrait", visibleText: "Add to cart" }), null);
});

test("rendered evidence must remain on the requested route after storefront unlock", () => {
  const expected = "https://store.example/products/custom-pet?preview_theme_id=123";
  assert.equal(routeIdentityRejection(expected, "https://store.example/products/custom-pet", "https://store.example/products/custom-pet"), null);
  assert.match(routeIdentityRejection(expected, "https://store.example/", "https://store.example/") || "", /unexpected final route/);
  assert.match(routeIdentityRejection(expected, "https://store.example/products/custom-pet", "https://store.example/") || "", /unexpected canonical route/);
});

test("capture rejects local destinations including mapped IPv6 and credentials", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "172.16.0.4",
    "169.254.169.254",
    "::1",
    "::ffff:7f00:1",
    "::ffff:192.168.1.1",
    "fd00::123",
  ])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/",
    "http://127.1/",
    "http://[::ffff:7f00:1]/",
    "https://user:pass@example.com",
  ])
    await assert.rejects(publicUrl(url));
  assert.equal(isPrivateIp("8.8.8.8"), false);
});
test("source scripts and submission destinations cannot survive sanitization", () => {
  const $ = load(
    '<main><img onerror="alert(1)" src=x><a href="javascript:alert(1)">x</a><script>fetch("https://merchant")</script><iframe src=x></iframe><form action="https://merchant" method="post"><button formaction="https://elsewhere">send</button></form></main>',
  );
  sanitize($);
  assert.equal($("script,iframe,[onerror],[formaction]").length, 0);
  assert.equal($("a").attr("href"), undefined);
  assert.equal($("form").attr("action"), "#");
  assert.equal($("form").attr("method"), "get");
});
test("product details extraction preserves every section after the product boundary", () => {
  const $ = load(
    '<main><div class="shopify-section"><div id="template-product">form</div></div><div id="story"><a href="/products/example#shopify-section-template__template-product">Story</a></div><div id="faq">FAQ</div></main>',
  );
  const details = extractProductDetails($);
  assert.doesNotMatch(details, /form/);
  assert.match(details, /id="story"/);
  assert.match(details, /id="faq"/);
  assert.match(details, /href="#template-product"/);
});
test("rendered review iframe splits captured product details at its real source position", () => {
  const $ = load(
    '<main><div><div id="template-product">form</div></div><div id="story">Story</div><div id="legacy" class="shopify-section"><div id="looxReviews"><iframe id="looxReviewsFrame"></iframe></div></div><div id="separator">Separator</div><div id="shopify-section-template__loox-product-reviews-app-section" class="shopify-section"><div id="looxReviews"></div></div><div id="related">Related</div></main>',
  );
  assert.equal(markRenderedReviewBoundary($), true);
  sanitize($);
  const parts = extractProductDetailsParts($);
  assert.equal(parts.hasReviewBoundary, true);
  assert.match(parts.before, /id="story"/);
  assert.doesNotMatch(parts.before + parts.after, /looxReviews|loox-product-reviews/);
  assert.match(parts.after, /id="separator"/);
  assert.match(parts.after, /id="related"/);
});
test("captured product and homepage cards receive generator-owned rating slots", () => {
  const product = load('<main><div id="product-content-area"><h1>Product</h1></div></main>');
  addReviewRatingSlots(product, "product");
  assert.match(product.html(), /render 's2s-product-rating'.*link_to_reviews: true/);
  const home = load('<main><li class="product-list-item"><a href="/products/example"></a><h3 class="product-title">Example</h3></li></main>');
  const binding = addReviewRatingSlots(home, "home");
  assert.equal(binding.values.rating_product_01, "example");
  assert.equal(binding.settings[0].type, "product");
  assert.match(home.html(), /section\.settings\.rating_product_01/);
});
test("Loox core script app embed is generator-owned and enabled", () => {
  const [blockId, block] = Object.entries(looxThemeSettings.current.blocks)[0];
  assert.match(blockId, /^\d{17,20}$/);
  assert.match(block.type, /shopify:\/\/apps\/loox-reviews\/blocks\/loox-inject\//);
  assert.equal(block.disabled, false);
});
test("phase 3 product templates render captured details after the family form", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-phase3-test-"));
  try {
    await mkdir(join(dir, "theme/sections"), { recursive: true });
    await writeFile(join(dir, "theme/sections/s2s-product-details.liquid"), "details");
    await writeFile(join(dir, "theme/sections/s2s-details-phone.liquid"), "phone details");
    await writeFile(join(dir, "theme/sections/s2s-details-harold-house.liquid"), "house details");
    await writeFile(join(dir, "theme/sections/s2s-details-harold-pop-art-before.liquid"), "pop before");
    await writeFile(join(dir, "theme/sections/s2s-details-harold-pop-art-after.liquid"), "pop after");
    await writeFile(join(dir, "product-family-source-evidence.json"), JSON.stringify({
      families: [{ suffix: "s2s-phone", viewports: [{ states: [{ state: "initial", data: { layout: { reviews: { cards: { count: 3 } } } } }] }] }],
    }));
    await writePhase3Theme(dir);
    for (const suffix of [
      "s2s-standard",
      "s2s-custom",
      "s2s-accessory",
      "s2s-apparel",
      "s2s-custom-apparel",
      "s2s-embroidered",
      "s2s-gift-card",
      "s2s-hat",
      "s2s-home",
      "s2s-jewelry",
      "s2s-mug",
      "s2s-phone",
      "s2s-portrait",
      "s2s-quote",
      "s2s-royal",
      "s2s-addon",
    ]) {
      const template = JSON.parse(
        await readFile(join(dir, `theme/templates/product.${suffix}.json`), "utf8"),
      );
      assert.deepEqual(template.order, suffix === "s2s-phone"
        ? ["main", "details", "recommendations", "loox_reviews"]
        : ["main", "details", "loox_reviews"]);
      assert.equal(
        template.sections.details.type,
        suffix === "s2s-phone" ? "s2s-details-phone" : "s2s-product-details",
      );
      if (suffix === "s2s-phone") assert.equal(template.sections.recommendations.type, "s2s-product-recommendations");
      else assert.equal(template.sections.recommendations, undefined);
      assert.equal(template.sections.loox_reviews.type, "apps");
      assert.equal(template.sections.loox_reviews.blocks.loox_reviews_star_rating, undefined);
      assert.match(template.sections.loox_reviews.blocks.loox_reviews_widget.type, /shopify:\/\/apps\/loox-reviews\/blocks\/loox-dynamic-section\//);
    }
    const defaultTemplate = JSON.parse(
      await readFile(join(dir, "theme/templates/product.json"), "utf8"),
    );
    assert.deepEqual(defaultTemplate.order, ["main", "loox_reviews"]);
    assert.equal(defaultTemplate.sections.loox_reviews.type, "apps");
    const haroldHouseTemplate = JSON.parse(
      await readFile(join(dir, "theme/templates/product.s2s-harold-house.json"), "utf8"),
    );
    assert.equal(haroldHouseTemplate.sections.details.type, "s2s-details-harold-house",
      "Harold templates must use their captured family details instead of the generic product tail");
    const haroldPopTemplate = JSON.parse(
      await readFile(join(dir, "theme/templates/product.s2s-harold-pop-art.json"), "utf8"),
    );
    assert.deepEqual(haroldPopTemplate.order, ["main", "details_before", "loox_reviews", "details_after"]);
    assert.equal(haroldPopTemplate.sections.details_before.type, "s2s-details-harold-pop-art-before");
    assert.equal(haroldPopTemplate.sections.details_after.type, "s2s-details-harold-pop-art-after");
    const rating = await readFile(join(dir, "theme/snippets/s2s-product-rating.liquid"), "utf8");
    assert.match(rating, /class="loox-rating s2s-product-rating"/);
    assert.match(rating, /product\.metafields\.loox\.avg_rating/);
    assert.doesNotMatch(rating, /metafields\.loox\.avg_rating\.value/);
    assert.match(rating, /product\.metafields\.reviews\.rating\.value\.rating/);
    assert.match(rating, /product\.metafields\.reviews\.rating_count\.value/);
    assert.match(rating, /s2s_rating_count_number > 0/);
    assert.match(rating, /data-s2s-rating-source/);
    assert.match(rating, /data-s2s-product-rating/);
    assert.match(rating, /s2s-rating-fallback/);
    assert.match(rating, /product\.url \| append: '#looxReviewsFrame'/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Harold families retain dedicated sections and their captured workflow contracts", () => {
  assert.equal(haroldProductTemplates.length, 9);
  assert.equal(new Set(haroldProductTemplates.map((item) => item.section)).size, 9);
  for (const { suffix, section } of haroldProductTemplates) {
    const liquid = haroldProductSections[section];
    assert.ok(liquid, `${suffix} must have a generator-owned section`);
    assert.match(liquid, new RegExp(`data-s2s-${suffix.replace(/^s2s-/, "")}`));
    assert.match(liquid, /data-s2s-variants/);
    assert.match(liquid, /data-family-slide/);
    assert.match(liquid, /data-family-thumb/);
    assert.match(liquid, /content_for 'blocks'/);
    assert.match(liquid, /s2s-family-product\.css/);
    assert.match(liquid, /id="product-content-area"/);
    assert.match(liquid, /data-s2s-harold-family=/);
  }
  assert.match(haroldProductSections["s2s-harold-house-product"], /properties\[House photo\]/);
  assert.match(haroldProductSections["s2s-harold-house-product"], /properties\[Text Line 2\]/);
  assert.match(haroldProductSections["s2s-harold-house-product"], /all_products\['add-a-pet-to-your-home-portrait'\]/);
  assert.match(haroldProductSections["s2s-harold-house-product"], /data-s2s-addon="add-a-pet-to-your-home-portrait"/);
  assert.doesNotMatch(haroldProductSections["s2s-harold-house-product"], /Unavailable until a target-store add-on product is approved/);
  assert.match(haroldProductSections["s2s-harold-house-mug-product"], /data-s2s-total-steps="3"/);
  assert.match(haroldProductSections["s2s-harold-watercolor-product"], /name="form-option-framing-swicher"/);
  assert.match(haroldProductSections["s2s-harold-watercolor-product"], /data-s2s-framing-group/);
  assert.match(haroldProductSections["s2s-harold-watercolor-product"], /forloop\.index0 == 1/);
  assert.match(haroldProductSections["s2s-harold-watercolor-product"], /data-s2s-framing-group[^>]*data-s2s-option-group/);
  assert.doesNotMatch(haroldProductSections["s2s-harold-watercolor-product"], /data-s2s-frame-values[^>]*data-s2s-option-group/);
  assert.match(haroldProductSections["s2s-harold-print-product"], /name="option-\{\{ option\.name \| handleize \}\}"/);
  assert.match(haroldProductSections["s2s-harold-hat-product"], /data-s2s-option-select/);
  assert.match(haroldProductSections["s2s-harold-gift-card-product"], /data-s2s-total-steps="3"/);
  assert.match(haroldProductSections["s2s-harold-gift-card-product"], /properties\[House photo\]/);
  assert.match(haroldProductSections["s2s-harold-digital-product"], /data-s2s-hidden-option/);
  assert.match(haroldProductSections["s2s-harold-print-product"], /type="number" name="quantity"/);
  assert.match(haroldProductSections["s2s-harold-house-product"], /type="hidden" name="quantity"/);
});

test("cross-platform file plumbing does not replace observed upload workflow behavior", () => {
  const base = { nextPresent: true, previousPresent: false, validationError: false };
  const result = compareWorkflowState(
    { ...base, fields: [{ type: "file", name: "", required: false }] },
    { ...base, fields: [{ type: "file", name: "properties[House photo]", required: false }] },
  );
  assert.equal(result.passed, true);
});

test("Harold step workflow, responsive layout, and hidden thumbnail rail are generator-owned", () => {
  assert.match(haroldProductScript, /data-s2s-step-next/);
  assert.doesNotMatch(haroldProductScript, /data-s2s-step-back/);
  assert.match(haroldProductScript, /10485760/);
  assert.match(haroldProductScript, /data-s2s-framing-group/);
  assert.match(haroldProductScript, /'canvas','poster only'/);
  assert.match(haroldProductStyles, /s2s-harold-details\{position:static/);
  assert.match(haroldProductStyles, /s2s-harold-thumb-nav/);
  assert.match(haroldProductStyles, /s2s-harold-image-option--style/);
  assert.match(haroldProductStyles, /s2s-harold-frame-card/);
  assert.match(haroldProductStyles, /input:checked\+label::before\{content:"✓"/);
  assert.match(haroldProductStyles, /overflow:hidden/);
  assert.match(haroldProductStyles, /scrollbar-width:none/);
  assert.match(haroldProductStyles, /@media\(max-width:800px\)/);
  assert.match(haroldProductStyles, /height:42px/);
});
test("collection templates preserve the source card contract across breakpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-collection-test-"));
  try {
    await mkdir(join(dir, "theme/sections"), { recursive: true });
    await writeFile(join(dir, "theme/sections/s2s-product-details.liquid"), "details");
    await writePhase3Theme(dir);
    const section = await readFile(join(dir, "theme/sections/s2s-collection.liquid"), "utf8");
    const card = await readFile(join(dir, "theme/snippets/s2s-collection-product-card.liquid"), "utf8");
    const css = await readFile(join(dir, "theme/assets/s2s-phase3.css"), "utf8");
    assert.match(section, /data-s2s-collection-grid/);
    assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    assert.match(section, /data-s2s-collection-sort/);
    assert.match(section, /render 's2s-collection-product-card'/);
    assert.match(section, /forloop\.index <= 4/);
    assert.match(card, /data-s2s-collection-card/);
    assert.match(card, /data-s2s-collection-shop/);
    assert.match(card, /data-s2s-collection-price/);
    assert.match(card, /collection_shop_now/);
    assert.match(card, /render 's2s-product-rating'.*link_to_reviews: true, card: true/);
    assert.match(css, /s2s-collection-card__rating:empty\{display:none\}/);
    assert.match(card, /data-s2s-rating-binding data-id="\{\{ product\.id \}\}"/);
    assert.doesNotMatch(css, /s2s-collection-card__rating\{min-height/);
    assert.match(css, /s2s-rating-fallback::after/);
    assert.match(css, /--s2s-rating-percent/);
    assert.match(css, /grid-template-columns:repeat\(3/);
    assert.match(css, /grid-template-columns:repeat\(2/);
    assert.match(css, /@media\(max-width:989px\)/);
    assert.match(css, /@media\(max-width:479px\)/);
    assert.match(css, /\.image-compare\{position:relative;aspect-ratio:1200\/950;overflow:hidden\}/);
    assert.match(css, /body:has\(\[data-s2s-harold-pop-art\]\) \.image-compare,body:has\(\[data-s2s-harold-watercolor\]\) \.image-compare\{aspect-ratio:1\/1\}/);
    assert.match(css, /\.image-compare>img\+img\{position:absolute;inset:0 0 0 50%;width:50%;object-position:right\}/);
    await mkdir(join(dir, "collection-family-evidence"), { recursive: true });
    await writeFile(join(dir, "collection-family-evidence/layout-audit.json"), JSON.stringify({
      schemaVersion: 3,
      contractVersion: "collection-family-layout-v2",
      collectorVersion: "2.1.0",
      passed: true,
      assertions: Object.fromEntries(REQUIRED_VIEWPORTS.map(({ name, width, height }) => [name, { viewport: `${width}x${height}`, horizontalOverflow: false, passed: true }])),
      sourceReferenceBounds: Object.fromEntries(REQUIRED_VIEWPORTS.map(({ name }) => [name, { grid: {}, card: {}, image: {} }])),
      interactions: Object.fromEntries(REQUIRED_VIEWPORTS.map(({ name }) => [name, { passed: true }])),
    }));
    await assert.doesNotReject(assertCollectionFamilyContract(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

  test("Harold pop art preserves source color swatch assets instead of substituting gallery images", async () => {
    const sections = haroldProductSections as Record<string, string>;
    const popArt = sections["s2s-harold-pop-art-product"];
    assert.match(popArt, /s2s-harold-pop-color/);
    assert.match(popArt, /s2s-44a9ee92dc97e7f8\.png/);
    assert.match(popArt, /s2s-4f5cabe5469f912c\.png/);
    assert.match(popArt, /s2s-076c0657a48563df\.png/);
    assert.match(popArt, /s2s-a03f44ef70c5ea05\.png/);
    assert.match(popArt, /Portrait Color:/);
  });

  test("Harold print preserves the one product whose source frame control is radio-based", () => {
    const print = haroldProductSections["s2s-harold-print-product"];
    assert.match(print, /product\.handle == 'in-my-homeowner-era-1-print-copy'/);
    assert.match(print, /name="s2s-harold-option-\{\{ option\.position \}\}"/);
    assert.match(print, /data-s2s-option-select/);
  });
test("portrait templates use dynamic artwork imagery and an uncapped gallery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-portrait-test-"));
  try {
    await mkdir(join(dir, "theme/sections"), { recursive: true });
    await writeFile(join(dir, "theme/sections/s2s-product-details.liquid"), "details");
    await writePhase3Theme(dir);
    const template = JSON.parse(
      await readFile(join(dir, "theme/templates/product.s2s-portrait.json"), "utf8"),
    );
    const section = await readFile(
      join(dir, "theme/sections/s2s-portrait-product.liquid"),
      "utf8",
    );
    const phase3Css = await readFile(join(dir, "theme/assets/s2s-phase3.css"), "utf8");
    const haroldCss = await readFile(join(dir, "theme/assets/s2s-harold-product.css"), "utf8");
    assert.equal(template.sections.main.type, "s2s-portrait-product");
    assert.match(section, /for image in product\.images/);
    assert.doesNotMatch(section, /product\.images limit:/);
    assert.match(section, /if is_artwork/);
    assert.match(section, /product\.images \| slice: forloop\.index0, 1 \| first/);
    assert.match(section, /content_for 'blocks'/);
    assert.match(phase3Css, /\.s2s-portrait-gallery,\.s2s-portrait-details\{min-width:0\}/);
    assert.match(phase3Css, /\.s2s-portrait-pdp\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(haroldCss, /\.s2s-harold-details\{position:static;top:auto;/);
    assert.doesNotMatch(haroldCss, /\.s2s-harold-details\{position:sticky/);
    assert.deepEqual(template.sections.main.block_order, ["loox_star_rating"]);
    assert.match(template.sections.main.blocks.loox_star_rating.type, /loox-reviews\/blocks\/loox-rating/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("every non-portrait product template uses the complete interactive family gallery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-family-test-"));
  try {
    await mkdir(join(dir, "theme/sections"), { recursive: true });
    await writeFile(join(dir, "theme/sections/s2s-product-details.liquid"), "details");
    await writePhase3Theme(dir);
    const custom = await readFile(join(dir, "theme/sections/s2s-custom-product.liquid"), "utf8");
    const standard = await readFile(join(dir, "theme/sections/s2s-standard-product.liquid"), "utf8");
    const familyScript = await readFile(join(dir, "theme/assets/s2s-family-product.js"), "utf8");
    const galleryScript = await readFile(join(dir, "theme/assets/s2s-product-gallery.js"), "utf8");
    const familyStyles = await readFile(join(dir, "theme/assets/s2s-family-product.css"), "utf8");
    const portraitScript = await readFile(join(dir, "theme/assets/s2s-portrait-product.js"), "utf8");
    const portraitStyles = await readFile(join(dir, "theme/assets/s2s-portrait-product.css"), "utf8");
    const uploader = await readFile(join(dir, "theme/snippets/s2s-product-uploader.liquid"), "utf8");
    const addons = await readFile(join(dir, "theme/snippets/s2s-product-addons.liquid"), "utf8");
    const trust = await readFile(join(dir, "theme/snippets/s2s-product-trust.liquid"), "utf8");
    for (const section of [custom, standard]) {
      assert.match(section, /for image in product\.images/);
      assert.doesNotMatch(section, /product\.images limit:/);
      assert.match(section, /data-family-thumb/);
      assert.match(section, /data-family-thumbs-viewport/);
      assert.match(section, /type="radio"/);
      assert.match(section, /data-s2s-variants/);
    }
    assert.match(custom, /render 's2s-product-uploader'/);
    assert.doesNotMatch(standard, /render 's2s-product-uploader'/);
    for (const snippet of [uploader, addons, trust]) assert.match(snippet, /{% doc %}/);
    assert.match(uploader, /data-s2s-dropzone/);
    assert.match(uploader, /accessory_remove_notice/);
    assert.match(addons, /addon_variant\.price \| money/);
    assert.match(addons, /priority_addon_help/);
    assert.match(trust, /delivery_window/);
    assert.match(familyScript, /cart\/add\.js/);
    assert.match(familyScript, /event\.preventDefault\(\)/);
    assert.match(familyScript, /data\.set\('id',variant\.id\)/);
    assert.doesNotMatch(custom, /data-s2s-variant-id/);
    assert.match(familyScript, /properties\[_s2s_group\]/);
    assert.match(familyScript, /new DataTransfer/);
    assert.match(galleryScript, /ResizeObserver/);
    assert.match(galleryScript, /perPage/);
    assert.match(galleryScript, /pointerdown/);
    assert.match(galleryScript, /requestAnimationFrame/);
    assert.doesNotMatch(familyScript, /scrollIntoView/);
    assert.match(familyStyles, /\.s2s-family-thumbs-viewport\{[^}]*overflow:hidden/);
    assert.match(familyStyles, /\.s2s-family-purchase\{display:flex/);
    assert.match(familyStyles, /height:42px/);
    assert.doesNotMatch(familyStyles, /\.s2s-family-thumbs\{[^}]*overflow-x:auto/);
    assert.doesNotMatch(portraitScript, /scrollIntoView/);
    assert.match(galleryScript, /data-portrait-thumbs-viewport/);
    assert.match(portraitStyles, /\.s2s-portrait-thumbs-viewport\{[^}]*overflow:hidden/);
    const dedicated: Record<string, string> = {
      "s2s-accessory": "s2s-accessory-product",
      "s2s-apparel": "s2s-apparel-product",
      "s2s-custom-apparel": "s2s-custom-apparel-product",
      "s2s-embroidered": "s2s-embroidered-product",
      "s2s-hat": "s2s-hat-product",
      "s2s-home": "s2s-home-product",
      "s2s-jewelry": "s2s-jewelry-product",
      "s2s-mug": "s2s-mug-product",
      "s2s-phone": "s2s-phone-product",
    };
    for (const [suffix, expectedSection] of Object.entries(dedicated)) {
      const template = JSON.parse(await readFile(join(dir, `theme/templates/product.${suffix}.json`), "utf8"));
      assert.equal(template.sections.main.type, expectedSection);
      const section = await readFile(join(dir, `theme/sections/${expectedSection}.liquid`), "utf8");
      assert.match(section, new RegExp(`data-${expectedSection}`));
    }
    for (const suffix of ["s2s-addon"]) {
      const template = JSON.parse(await readFile(join(dir, `theme/templates/product.${suffix}.json`), "utf8"));
      assert.equal(template.sections.main.type, "s2s-standard-product");
    }
    const giftCardTemplate = JSON.parse(await readFile(join(dir, "theme/templates/product.s2s-gift-card.json"), "utf8"));
    assert.equal(giftCardTemplate.sections.main.type, "s2s-gift-card-product");
    const royalTemplate = JSON.parse(await readFile(join(dir, "theme/templates/product.s2s-royal.json"), "utf8"));
    assert.equal(royalTemplate.sections.main.type, "s2s-portrait-product");
    const mug = await readFile(join(dir, "theme/sections/s2s-mug-product.liquid"), "utf8");
    assert.match(mug, /property_name: 'Upload Pet Photo 1'/);
    assert.match(mug, /show_skip: true/);
    assert.match(mug, /show_digital: true/);
    assert.match(mug, /show_santa: true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("pixel diagnostics do not override objective contracts and agent visual review", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-visual-gate-test-"));
  try {
    await writeFile(join(dir, "theme-build.json"), JSON.stringify({ id: "build-2" }));
    const evidenceVersions = {
      evidenceSchemaVersion: PRODUCT_EVIDENCE_SCHEMA_VERSION,
      evidenceContractVersion: PRODUCT_EVIDENCE_CONTRACT_VERSION,
      evidenceCollectorVersion: PRODUCT_EVIDENCE_COLLECTOR_VERSION,
    };
    const coverage = {
      ...evidenceVersions,
      requiredViewports: REQUIRED_VIEWPORTS,
      comparisons: REQUIRED_VIEWPORTS.map(({ name }) => ({ viewport: name, passed: true })),
      contractChecks: REQUIRED_VIEWPORTS.map(({ name }) => ({ viewport: name, check: "required-viewport-evidence", passed: true })),
    };
    await writeFile(join(dir, "product-family-visual-audit.json"), JSON.stringify({ ...coverage, passed: true, objectivePassed: true, pixelDiagnosticsPassed: false, themeBuild: "build-2" }));
    await assert.doesNotReject(() => assertDraftVisualAuditNotFailed(dir));
    await assert.doesNotReject(() => assertVisualAuditPassed(dir));
    await writeFile(join(dir, "product-family-visual-audit.json"), JSON.stringify({ ...coverage, passed: true, themeBuild: "build-1" }));
    await assert.rejects(() => assertDraftVisualAuditNotFailed(dir), /visual audit is stale/);
    await assert.rejects(() => assertVisualAuditPassed(dir), /visual audit is stale/);
    await writeFile(join(dir, "product-family-visual-audit.json"), JSON.stringify({ ...evidenceVersions, passed: true, themeBuild: "build-2" }));
    await assert.rejects(() => assertDraftVisualAuditNotFailed(dir), /desktop, tablet, and mobile/);
    await assert.rejects(() => assertVisualAuditPassed(dir), /desktop, tablet, and mobile/);
    await writeFile(join(dir, "product-family-visual-audit.json"), JSON.stringify({ ...coverage, passed: true, objectivePassed: true, pixelDiagnosticsPassed: false, themeBuild: "build-2" }));
    await assertDraftVisualAuditNotFailed(dir);
    await assertVisualAuditPassed(dir);
    await assert.rejects(() => assertAgentVisualReview(dir, "preflight"), /skill-guided agent/);
    const evidence = await computeAgentVisualEvidenceDigest(dir);
    const decisions = REQUIRED_VIEWPORTS.map(({ name }) => ({
      scope: "product-family",
      family: "s2s-test",
      viewport: name,
      inspectedRegions: ["full", "main", "form"],
      verdict: "pass",
      rationale: "Structured geometry, topology, overflow, and interaction evidence were reviewed with the paired images.",
    }));
    const audit = JSON.parse(await readFile(join(dir, "product-family-visual-audit.json"), "utf8"));
    audit.comparisons = REQUIRED_VIEWPORTS.map(({ name }) => ({ suffix: "s2s-test", viewport: name, region: "full", passed: false }));
    audit.contractChecks = REQUIRED_VIEWPORTS.map(({ name }) => ({ suffix: "s2s-test", viewport: name, check: "required-viewport-evidence", passed: true }));
    await writeFile(join(dir, "product-family-visual-audit.json"), JSON.stringify(audit));
    const currentEvidence = await computeAgentVisualEvidenceDigest(dir);
    await writeFile(join(dir, "agent-visual-review.preflight.json"), JSON.stringify({
      schemaVersion: 3,
      stage: "preflight",
      themeBuild: "build-2",
      reviewedAt: new Date().toISOString(),
      reviewer: { kind: "skill-agent", skill: "shopify-site-replication" },
      evidenceDigest: currentEvidence.digest,
      evidenceFiles: currentEvidence.files,
      decisions,
      passed: true,
    }));
    await assert.rejects(() => assertAgentVisualReview(dir, "preflight"), /capture-plan.json is missing/);
    assert.notEqual(evidence.digest, currentEvidence.digest);
    audit.checkedAt = new Date().toISOString();
    await writeFile(join(dir, "product-family-visual-audit.json"), JSON.stringify(audit));
    await assert.rejects(() => assertAgentVisualReview(dir, "preflight"), /stale/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("review placement gate requires desktop, tablet, and mobile for every captured surface", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-review-viewport-test-"));
  try {
    const placements = ["desktop", "mobile"].map((viewport) => ({ surface: "product_summary", viewport }));
    await writeFile(join(dir, "review-system-evidence.json"), JSON.stringify({ status: "provisional", scope: ["product_summary"], missing: [], notCapturedByThisCommand: [], placements }));
    await assert.rejects(() => assertReviewSystemViewportCoverage(dir), /desktop, tablet, and mobile/);
    placements.push({ surface: "product_summary", viewport: "tablet" });
    await writeFile(join(dir, "review-system-evidence.json"), JSON.stringify({ status: "provisional", scope: ["product_summary"], missing: [], notCapturedByThisCommand: [], placements }));
    await assert.doesNotReject(() => assertReviewSystemViewportCoverage(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("product family contracts audit every bound template and block unsafe release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-contract-test-"));
  try {
    await mkdir(join(dir, "theme/sections"), { recursive: true });
    await writeFile(join(dir, "theme/sections/s2s-product-details.liquid"), "details");
    await writeFile(
      join(dir, "phase3-product-template-plan.json"),
      JSON.stringify({
        products: productFamilyContracts.map((contract) => ({
          handle: contract.representative,
          templateSuffix: contract.suffix,
        })),
      }),
    );
    await writePhase3Theme(dir);
    const report = await auditProductFamilyContracts(dir);
    assert.equal(report.releaseReady, false);
    assert.equal(report.counts.contracts, productFamilyContracts.length);
    assert.equal(report.counts.verified, 1);
    assert.equal(report.counts.provisional, 12);
    assert.equal(report.counts.blocked, 1);
    assert.equal(report.counts.uncontracted, 0);
    assert.ok(report.counts.structuralFailures >= 1);
    const mug = report.results.find((result) => result.suffix === "s2s-mug");
    assert.equal(mug?.status, "blocked");
    assert.doesNotMatch(mug?.failures.join(" ") || "", /expected s2s-mug-product|marker .* missing/);
    await assert.doesNotReject(assertProductFamilyDraftContracts(dir));
    await assert.rejects(assertProductFamilyContracts(dir), /contract gate failed/);
    assert.match(
      await readFile(join(dir, "product-family-contract-audit.md"), "utf8"),
      /Release blockers/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("build reconciliation updates dedicated family sections without erasing reviewed contract state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-contract-reconcile-test-"));
  try {
    await mkdir(join(dir, "theme/templates"), { recursive: true });
    const configured = structuredClone(productFamilyContracts);
    const gift = configured.find(contract => contract.suffix === "s2s-gift-card")!;
    const quote = configured.find(contract => contract.suffix === "s2s-quote")!;
    gift.expectedSection = "s2s-standard-product";
    gift.status = "verified";
    gift.reason = "reviewed evidence must survive";
    quote.expectedSection = "s2s-standard-product";
    configured.push({
      suffix: "project-owned-family",
      family: "project-owned",
      representative: "project-owned-product",
      expectedSection: "project-owned-product",
      status: "provisional",
      requiredSectionMarkers: ["data-project-owned"],
      requiredTemplateSections: ["main", "details"],
    });
    await writeFile(join(dir, "product-family-contracts.json"), JSON.stringify({ schemaVersion: 1, contracts: configured }));
    await writeFile(join(dir, "theme/templates/product.s2s-gift-card.json"), JSON.stringify({ sections: {
      main: { type: "s2s-gift-card-product" },
      details_before: { type: "s2s-details-gift-card-before" },
      loox_reviews: { type: "apps" },
      details_after: { type: "s2s-details-gift-card-after" },
    } }));
    await writeFile(join(dir, "theme/templates/product.project-owned-family.json"), JSON.stringify({ sections: {
      main: { type: "project-owned-product" },
      details_before: { type: "project-owned-before" },
      loox_reviews: { type: "apps" },
      details_after: { type: "project-owned-after" },
    } }));
    await reconcileProductFamilyContractSections(dir);
    const reconciled = await loadProductFamilyContracts(dir);
    assert.equal(reconciled.find(contract => contract.suffix === "s2s-gift-card")?.expectedSection, "s2s-gift-card-product");
    assert.equal(reconciled.find(contract => contract.suffix === "s2s-quote")?.expectedSection, "s2s-quote-product");
    assert.equal(reconciled.find(contract => contract.suffix === "s2s-gift-card")?.status, "verified");
    assert.equal(reconciled.find(contract => contract.suffix === "s2s-gift-card")?.reason, "reviewed evidence must survive");
    assert.deepEqual(reconciled.find(contract => contract.suffix === "s2s-gift-card")?.requiredTemplateSections,
      ["main", "details_before", "loox_reviews", "details_after"]);
    assert.deepEqual(reconciled.find(contract => contract.suffix === "project-owned-family")?.requiredTemplateSections,
      ["main", "details_before", "loox_reviews", "details_after"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("new sites initialize a project-owned provisional contract matrix", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-contract-init-test-"));
  try {
    await mkdir(join(dir, "theme/templates"), { recursive: true });
    await writeFile(join(dir, "phase3-product-template-plan.json"), JSON.stringify({ products: [
      { handle: "alpha", family: "engraved", templateSuffix: "custom-engraved" },
      { handle: "beta", family: "apparel", templateSuffix: "custom-apparel" },
    ] }));
    await writeFile(join(dir, "theme/templates/product.custom-engraved.json"), JSON.stringify({ sections: { main: { type: "engraved-product" } } }));
    await writeFile(join(dir, "theme/templates/product.custom-apparel.json"), JSON.stringify({ sections: { main: { type: "apparel-product" } } }));
    const initialized = await initProductFamilyContracts(dir);
    assert.equal(initialized.contracts.length, 2);
    assert.ok(initialized.contracts.every((contract) => contract.status === "provisional"));
    assert.equal((await loadProductFamilyContracts(dir)).find((contract) => contract.suffix === "custom-engraved")?.expectedSection, "engraved-product");
    await assert.rejects(initProductFamilyContracts(dir), /already exists/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CSS localization preserves data URIs and media while rebasing nested resources", () => {
  const css =
    "@media(min-width:1px){a{background:url(../pic.png)}}b{src:url(data:font/woff2;base64,AA)}";
  const base = "https://example.com/css/a.css";
  const urls = cssUrls(css, base);
  assert.deepEqual(urls, ["https://example.com/pic.png"]);
  const result = rewriteCss(
    css,
    base,
    new Map([
      [
        urls[0],
        {
          url: urls[0],
          file: "local.png",
          sha256: "",
          bytes: 1,
          mime: "image/png",
          status: "ready",
        },
      ],
    ]),
  );
  assert.match(result, /url\("local.png"\)/);
  assert.match(result, /@media/);
  assert.match(result, /data:font/);
});
test("custom-domain Shopify assets fall back to the canonical store CDN", () => {
  assert.equal(
    canonicalShopifyAssetUrl(
      "https://store.example/cdn/shop/files/example.png?v=12",
      "https://cdn.shopify.com/s/files/1/0447/0279/3894",
    ),
    "https://cdn.shopify.com/s/files/1/0447/0279/3894/files/example.png?v=12",
  );
  assert.equal(
    canonicalShopifyAssetUrl(
      "https://store.example/cdn/shop/t/53/assets/example.css?v=9",
      "https://cdn.shopify.com/s/files/1/0447/0279/3894/",
    ),
    "https://cdn.shopify.com/s/files/1/0447/0279/3894/t/53/assets/example.css?v=9",
  );
  assert.equal(
    canonicalShopifyAssetUrl(
      "https://store.example/images/example.png",
      "https://cdn.shopify.com/s/files/1/0447/0279/3894",
    ),
    null,
  );
});
test("Shopify JSON parser accepts strict-push check output before result", () => {
  assert.equal(
    parseCliJson('[{"errorCount":0}]\n{"theme":{"id":42}}\n').theme.id,
    42,
  );
});
test("phase 3 sitemap discovery decodes URLs and classifies Shopify routes", () => {
  assert.deepEqual(
    xmlLocations(
      "<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>",
    ),
    ["https://example.com/a?x=1&y=2"],
  );
  assert.equal(classifyRoute("/products/portrait"), "product");
  assert.equal(classifyRoute("/collections/gifts"), "collection");
  assert.equal(classifyRoute("/pages/faq"), "page");
  assert.equal(classifyRoute("/blogs/news/post"), "article");
});
test("rendered navigation adds internal routes omitted by the sitemap", () => {
  const routes = mergeRenderedNavigationRoutes(
    [{
      sourceUrl: "https://example.com/collections/all",
      path: "/collections/all",
      kind: "collection",
      handle: "all",
      referencedFromHome: false,
      migration: "candidate",
      priority: 50,
    }],
    ["/collections/all", "/products/footer-only", "https://outside.example/item"],
    "https://example.com",
  );
  assert.equal(routes.find((route) => route.path === "/collections/all")?.referencedFromHome, true);
  assert.deepEqual(
    routes.find((route) => route.path === "/products/footer-only"),
    {
      sourceUrl: "https://example.com/products/footer-only",
      path: "/products/footer-only",
      kind: "product",
      handle: "footer-only",
      referencedFromHome: true,
      migration: "candidate",
      priority: 90,
    },
  );
  assert.equal(routes.some((route) => route.path === "/item"), false);
});
test("evidenced broken navigation destinations are removed from every footer occurrence", () => {
  const $ = load('<footer><ul><li><a href="/products/gone">Gone</a></li><li><a href="/products/kept">Kept</a></li></ul><div><a href="https://example.com/products/gone">Gone again</a></div></footer>');
  const removed = applyNavigationDispositions($, "https://example.com", [{
    path: "/products/gone",
    action: "remove",
    reason: "Source product no longer exists",
    evidence: {
      requestedUrl: "https://example.com/products/gone",
      httpStatus: 404,
      pageKind: "not-found",
      capturedAt: "2026-10-23T00:00:00.000Z",
    },
  }]);
  assert.equal(removed.length, 2);
  assert.equal($('a[href="/products/gone"]').length, 0);
  assert.equal($('a[href="/products/kept"]').length, 1);
});
test("navigation removal rejects unsupported evidence", () => {
  const $ = load('<footer><a href="/products/live">Live</a></footer>');
  assert.throws(() => applyNavigationDispositions($, "https://example.com", [{
    path: "/products/live",
    action: "remove",
    reason: "Not enough evidence",
    evidence: {
      requestedUrl: "https://example.com/products/live",
      httpStatus: 200,
      pageKind: "content",
      capturedAt: "2026-10-23T00:00:00.000Z",
    },
  }]), /requires source 404\/410 evidence/);
});
test("app-proxy navigation can be explicitly rewritten to a generator-owned page", () => {
  const $ = load('<header><a href="https://source.example/a/faq?from=nav#top">FAQ</a></header><footer><a href="/a/faq">FAQ</a></footer>');
  const counts = applyNavigationRewrites($, [{
    sourcePath: "/a/faq",
    targetPath: "/pages/faq",
    reason: "The target does not own the source app proxy.",
  }]);
  assert.equal(counts["/a/faq"], 1);
  assert.equal($('a[href="/pages/faq"]').length, 1);
  assert.equal($('a[href*="source.example/a/faq"]').length, 1);
});
test("captured header controls retain executable offcanvas contracts", () => {
  const $ = load(`
    <body>
      <a href="/#offcanvas-search" aria-controls="offcanvas-search">Search</a>
      <a href="/#offcanvas-cart" aria-controls="offcanvas-cart">Cart</a>
      <a href="/#offcanvas-nav" aria-controls="offcanvas-nav">Menu</a>
      <main></main>
      <div id="offcanvas-nav"></div>
      <div id="shopify-section-offcanvas-cart"></div>
      <div id="offcanvas-search"><h2 class="offcanvas-title" id="wrong-label">Search</h2><form action="#" role="search"><input type="search"></form></div>
    </body>
  `);
  ensureHeaderInteractionContracts($);
  for (const id of ["offcanvas-search", "offcanvas-cart", "offcanvas-nav"]) {
    const trigger = $(`[aria-controls="${id}"]`);
    assert.equal(trigger.attr("href"), `#${id}`);
    assert.equal(trigger.attr("data-bs-toggle"), "offcanvas");
    assert.equal(trigger.attr("aria-expanded"), "false");
    assert.equal($(`#${id}`).length, 1);
  }
  assert.equal($('#offcanvas-search form[role="search"]').attr("action"), "{{ routes.search_url }}");
  assert.equal($('#offcanvas-search input[type="search"]').attr("name"), "q");
  assert.equal($("#offcanvas-search .offcanvas-title").attr("id"), "offcanvas-search-label");
  assert.match($("#offcanvas-cart").html() || "", /cart\.items/);
  assert.match($("#offcanvas-cart").html() || "", /routes\.cart_url/);
});
test("header runtime exposes opened drawers and never intercepts store search", async () => {
  const css = await readFile(join(process.cwd(), "src/runtime.css"), "utf8");
  const js = await readFile(join(process.cwd(), "src/runtime.js"), "utf8");
  assert.match(css, /\.offcanvas\.show[\s\S]*visibility:\s*visible\s*!important/);
  assert.match(js, /show\.bs\.offcanvas/);
  assert.match(js, /hidden\.bs\.offcanvas/);
  assert.match(js, /form:not\(\[role=search\]\)/);
});
test("ZIP contains native theme root and excludes capture files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-test-"));
  try {
    await mkdir(join(dir, "theme/layout"), { recursive: true });
    await writeFile(
      join(dir, "theme/layout/theme.liquid"),
      "{{ content_for_header }}{{ content_for_layout }}",
    );
    await writeFile(join(dir, "site-ir.json"), "{}");
    await packageTheme(dir);
    const files = Object.keys(
      unzipSync(await readFile(join(dir, "theme.zip"))),
    );
    assert.deepEqual(files, ["layout/theme.liquid"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("deployment integrity rejects edits made only to generated theme files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "site2shop-integrity-test-"));
  try {
    await mkdir(join(dir, "theme/layout"), { recursive: true });
    const path = join(dir, "theme/layout/theme.liquid");
    await writeFile(path, "{{ content_for_header }}{{ content_for_layout }}");
    await packageTheme(dir);
    await assert.doesNotReject(assertGeneratedThemeIntegrity(dir));
    await writeFile(path, "manual generated-file edit");
    await assert.rejects(assertGeneratedThemeIntegrity(dir), /generator source and rebuild/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
