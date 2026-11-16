import { load, type CheerioAPI } from "cheerio";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { collectAssets, cssUrls, resolveAsset, rewriteCss } from "./assets.js";
import { write, json, readJson, escapeHtml } from "./util.js";
import type { SiteIR, Asset } from "./types.js";
import {
  bindCommerceMarkup,
  commerceLocales,
  writeCommerceTheme,
} from "./commerce-theme.js";
import { writePhase3Theme } from "./phase3-theme.js";
import { auditProductFamilyContracts, reconcileProductFamilyContractSections } from "./product-family-contracts.js";
import { auditCollectionFamilyContract } from "./collection-contracts.js";
import { looxRatingSnippet, looxThemeSettings } from "./loox-theme.js";
import { assertExecutableEvidence, recordGeneratorPresentationBindings } from "./evidence-gate.js";
import { normalizedThemeBuildBytes, THEME_BUILD_PLACEHOLDER } from "./theme-integrity.js";

export function sanitize($: CheerioAPI) {
  $(
    'script,iframe,base,object,embed,noscript,link[rel="preconnect"],link[rel="dns-prefetch"]',
  ).remove();
  $(
    '[id^="shopify-block-"],#attentive_overlay,#attentive_creative,#gorgias-chat-container,[id^="bogos-"],#shopify-pc__banner',
  ).remove();
  $("*").each((_, el) => {
    const a = $(el).attr() || {};
    for (const name of Object.keys(a)) {
      // Browsers tolerate malformed attribute names that Shopify's Liquid parser
      // correctly rejects. Drop only names that cannot be valid HTML attributes.
      if (!/^[^\s"'<>\/=]+$/.test(name)) {
        $(el).removeAttr(name);
        continue;
      }
      if (
        /^on/i.test(name) ||
        name === "srcdoc" ||
        name === "nonce" ||
        name === "integrity"
      )
        $(el).removeAttr(name);
      if (
        ["href", "src", "action", "formaction"].includes(name) &&
        /^\s*(javascript|vbscript):/i.test(a[name])
      )
        $(el).removeAttr(name);
    }
  });
  $('[aria-hidden="true"]')
    .not(".modal,.offcanvas,.collapse")
    .removeAttr("aria-hidden");
  $("body").removeAttr("style");
  $("form").removeAttr("data-variants");
  $("form").attr("action", "#").attr("method", "get");
  $("[formaction]").removeAttr("formaction");
  $(
    'input[name="form_type"],input[name="utf8"],input[name="product-id"],input[name="section-id"]',
  ).remove();
}

/**
 * Restore the behavioral contract of captured header controls after sanitizing
 * source HTML. The source storefront renders its offcanvas targets dynamically;
 * a static capture can therefore retain the triggers while losing a target
 * (most commonly the cart). Bootstrap also requires a local fragment selector,
 * not a rewritten `/#fragment` URL, in order to resolve an offcanvas element.
 */
export function ensureHeaderInteractionContracts($: CheerioAPI) {
  const controls = ["offcanvas-search", "offcanvas-cart", "offcanvas-nav"];
  for (const id of controls) {
    $(`[aria-controls="${id}"]`)
      .attr("href", `#${id}`)
      .attr("data-bs-toggle", "offcanvas")
      .attr("aria-expanded", "false");
  }

  const search = $("#offcanvas-search").first();
  if (search.length) {
    search.attr("role", "dialog").attr("aria-modal", "true");
    search.find(".offcanvas-title").first().attr("id", "offcanvas-search-label");
    search
      .find('form[role="search"]')
      .first()
      .attr("action", "{{ routes.search_url }}")
      .attr("method", "get");
    search.find('input[type="search"]').first().attr("name", "q");
  }

  const nav = $("#offcanvas-nav").first();
  if (nav.length) nav.attr("role", "dialog").attr("aria-modal", "true");

  const cartContents = `
  <div class="offcanvas-header bg-light">
    <h2 id="offcanvas-cart-label" class="h6 ls-1 offcanvas-title">Cart ({{ cart.item_count }})</h2>
    <button class="btn-close" type="button" data-bs-dismiss="offcanvas" aria-label="Close"></button>
  </div>
  <div class="offcanvas-body">
    {% if cart.item_count != 0 %}
      <ul class="list-unstyled s2s-header-cart-items" role="list">
        {% for item in cart.items %}
          <li class="d-flex gap-3 py-3 border-bottom">
            {% if item.image %}<a href="{{ item.url }}"><img src="{{ item.image | image_url: width: 160 }}" alt="{{ item.product.title | escape }}" width="80" height="80" loading="lazy"></a>{% endif %}
            <div><a href="{{ item.url }}">{{ item.product.title | escape }}</a><p class="mb-0 small">{{ item.quantity }} × {{ item.final_price | money }}</p></div>
          </li>
        {% endfor %}
      </ul>
      <p class="d-flex justify-content-between fw-bold"><span>Subtotal</span><span>{{ cart.total_price | money }}</span></p>
      <a class="btn btn-outline-primary w-100 mb-3" href="{{ routes.cart_url }}">View cart</a>
      <a class="btn btn-primary w-100" href="/checkout">Checkout</a>
    {% else %}
      <p>Your cart is empty.</p>
      <a class="btn btn-primary w-100" href="{{ routes.all_products_collection_url }}">Continue shopping</a>
    {% endif %}
  </div>
`;
  const existingCart = $("#offcanvas-cart").first();
  if (existingCart.length) {
    existingCart
      .attr("role", "dialog")
      .attr("aria-modal", "true")
      .attr("aria-labelledby", "offcanvas-cart-label")
      .html(cartContents);
  } else {
    const cart = `<div id="offcanvas-cart" class="offcanvas offcanvas-end offcanvas-mobile-full" tabindex="-1" aria-labelledby="offcanvas-cart-label" role="dialog" aria-modal="true" style="width: 400px">${cartContents}</div>`;
    const section = $("#shopify-section-offcanvas-cart").first();
    if (section.length) section.append(cart);
    else $("body").append(`<div id="shopify-section-offcanvas-cart" class="shopify-section">${cart}</div>`);
  }
}

export function extractProductDetails($: CheerioAPI, main = $("main").first()) {
  const children = main.children();
  let productIndex = -1;
  children.each((index, element) => {
    const child = $(element);
    if (child.is("#template-product") || child.find("#template-product").length) {
      productIndex = index;
      return false;
    }
  });
  if (productIndex < 0) throw new Error("Missing #template-product boundary.");
  const details = children.slice(productIndex + 1);
  details
    .find('a[href*="__template-product"],a[href$="#template-product"]')
    .attr("href", "#template-product");
  return details
    .map((_, element) => $.html(element))
    .get()
    .join("\n");
}

const REVIEW_BOUNDARY_ATTR = "data-s2s-rendered-review-boundary";

/**
 * Record the position of the review widget that actually rendered on the
 * source page before sanitization removes its cross-origin iframe. A source
 * can contain both a legacy rendered Loox section and a second, empty app
 * block, so the iframe is the authoritative boundary rather than the first
 * element with an id of `looxReviews`.
 */
export function markRenderedReviewBoundary($: CheerioAPI) {
  const frame = $(
    '#looxReviewsFrame,iframe[title*="review" i],iframe[src*="loox" i],iframe[src*="judge.me" i],iframe[src*="yotpo" i]',
  ).first();
  const widget = frame.length
    ? frame
    : $(
        '#looxReviews[data-upgraded="true"],#loox-reviews-feed,.jdgm-review-widget,.yotpo-main-widget,.okeReviews-widget-holder',
      ).first();
  const boundary = widget.closest(".shopify-section").first();
  if (boundary.length) boundary.attr(REVIEW_BOUNDARY_ATTR, "true");
  return boundary.length > 0;
}

export function extractProductDetailsParts(
  $: CheerioAPI,
  main = $("main").first(),
) {
  const children = main.children();
  let productIndex = -1;
  children.each((index, element) => {
    const child = $(element);
    if (child.is("#template-product") || child.find("#template-product").length) {
      productIndex = index;
      return false;
    }
  });
  if (productIndex < 0) throw new Error("Missing #template-product boundary.");

  const before: string[] = [];
  const after: string[] = [];
  let foundReviewBoundary = false;
  children.slice(productIndex + 1).each((_, element) => {
    const child = $(element);
    if (child.attr(REVIEW_BOUNDARY_ATTR) === "true") {
      foundReviewBoundary = true;
      return;
    }
    // Account-bound review app shells are replaced by the target-store app
    // block. Keeping an empty duplicate changes spacing and section counts.
    const id = child.attr("id") || "";
    if (/loox-product-reviews|judge-me|yotpo|okendo/i.test(id)) return;
    child
      .find('a[href*="__template-product"],a[href$="#template-product"]')
      .attr("href", "#template-product");
    (foundReviewBoundary ? after : before).push($.html(element));
  });
  return {
    before: before.join("\n"),
    after: after.join("\n"),
    hasReviewBoundary: foundReviewBoundary,
  };
}

async function writeFamilyProductDetails(
  out: string,
  theme: string,
  map: Map<string, Asset>,
) {
  const evidence = await readJson<any>(
    join(out, "product-family-source-evidence.json"),
  ).catch(() => null);
  if (!Array.isArray(evidence?.families)) return;
  const assetBinding = await readJson<any>(
    join(out, "phase4-asset-binding.json"),
  ).catch(() => ({ assets: [] }));
  const boundAssets = (assetBinding.assets || [])
    .filter((item: any) => item?.sourceUrl && item?.targetUrl)
    .sort((a: any, b: any) => String(b.sourceUrl).length - String(a.sourceUrl).length);
  const [productPlan, capturePlan, sourceCoverage] = await Promise.all([
    readJson<any>(join(out, "phase3-product-plan.json")).catch(() => null),
    readJson<any>(join(out, "capture-plan.json")).catch(() => null),
    readJson<any>(join(out, "source-coverage.json")).catch(() => null),
  ]);
  const presentationCorrections = await readJson<any>(
    join(out, "presentation-corrections.json"),
  ).catch(() => ({ products: {} }));
  const reviewGapCorrection = (handle: string) => {
    const values = presentationCorrections?.products?.[handle]?.reviewGapCorrectionPx || {};
    const desktop = Number(values.desktop || 0);
    const tablet = Number(values.tablet || 0);
    const mobile = Number(values.mobile || 0);
    if (![desktop, tablet, mobile].some((value) => Number.isFinite(value) && value > 0)) return "";
    const height = (value: number) => `${Math.max(0, value).toFixed(3).replace(/\.?0+$/, "")}px`;
    return `<div class="s2s-evidence-gap-correction" aria-hidden="true"></div><style>
.s2s-evidence-gap-correction{display:none}
@media(min-width:1025px){.s2s-evidence-gap-correction{display:block;height:${height(desktop)}}}
@media(min-width:768px) and (max-width:1024px){.s2s-evidence-gap-correction{display:block;height:${height(tablet)}}}
@media(max-width:767px){.s2s-evidence-gap-correction{display:block;height:${height(mobile)}}}
</style>`;
  };
  const capturedBySuffix = new Map<string, Array<{ handle: string; sourceUrl: string; html: string }>>();
  for (const product of productPlan?.products || []) {
    const suffix = String(product?.input?.templateSuffix || "");
    const handle = String(product?.handle || "");
    if (!/^s2s-[a-z0-9-]+$/.test(suffix) || !handle) continue;
    const routeEntry = Object.entries<any>(capturePlan?.routes || {}).find(([, route]) => {
      try {
        return new URL(String(route?.source?.canonical || route?.source?.url || "")).pathname === `/products/${handle}`;
      } catch {
        return false;
      }
    });
    if (!routeEntry) continue;
    const [routeId, route] = routeEntry;
    const sourceRef = sourceCoverage?.routes?.[routeId]?.viewports?.desktop?.states?.initial?.source;
    const observation = sourceRef?.path
      ? await readJson<any>(join(out, sourceRef.path)).catch(() => null)
      : null;
    const domPath = observation?.artifacts?.dom?.path;
    const html = domPath ? await readFile(join(out, domPath), "utf8").catch(() => "") : "";
    if (!html) continue;
    const group = capturedBySuffix.get(suffix) || [];
    group.push({ handle, sourceUrl: String(route?.source?.url || route?.source?.canonical || ""), html });
    capturedBySuffix.set(suffix, group);
  }
  // Keep the older representative capture as a compatibility fallback for
  // projects created before the complete route-evidence gate existed.
  for (const family of evidence.families) {
    const suffix = String(family?.suffix || "");
    if (capturedBySuffix.has(suffix)) continue;
    const sourceUrl = String(family?.url || "");
    if (!/^s2s-[a-z0-9-]+$/.test(suffix) || !sourceUrl) continue;
    const htmlPath = join(out, "product-family-evidence", "source", suffix, "desktop", "initial.html");
    const html = await readFile(htmlPath, "utf8").catch(() => "");
    if (!html) continue;
    capturedBySuffix.set(suffix, [{
      handle: new URL(sourceUrl).pathname.split("/").filter(Boolean).pop() || suffix,
      sourceUrl,
      html,
    }]);
  }
  const liquidCase = (items: Array<{ handle: string; html: string }>) =>
    items.length === 1
      ? items[0].html
      : `{% case product.handle %}\n${items.map((item) => `{% when '${item.handle}' %}\n${item.html}`).join("\n")}\n{% endcase %}`;
  for (const [suffix, captures] of capturedBySuffix) {
    const rendered: Array<{ handle: string; before: string; after: string; hasReviewBoundary: boolean }> = [];
    for (const capture of captures) {
      let html = capture.html;
    // Product-family capture is the source of truth for post-purchase content.
    // Rebind already-imported Shopify Files before parsing so a rebuild never
    // falls back to another family's generic content or source-store hotlinks.
    for (const asset of boundAssets) {
      const assetSourceUrl = String(asset.sourceUrl);
      const targetUrl = String(asset.targetUrl);
      // Rendered Shopify markup commonly changes an absolute CDN URL to a
      // protocol-relative URL. Both spellings identify the same captured
      // asset and must resolve through the persisted target-store binding.
      // Keeping this normalization in the generator prevents later builds
      // from reintroducing source-store hotlinks.
      const aliases = new Set([
        assetSourceUrl,
        assetSourceUrl.replace(/^https?:/, ""),
        assetSourceUrl.replace(/^http:/, "https:"),
      ]);
      for (const alias of aliases)
        html = html.split(alias).join(targetUrl);
    }
    const $ = load(html);
    markRenderedReviewBoundary($);
    sanitize($);
    preserveCapturedProductCardRatingSlots($);
    staticReviewEvidence($, $);
    rewriteMarkup($, capture.sourceUrl, map);
    const main = $("main,[role=main]").first();
    if (!main.length) continue;
    const details = extractProductDetailsParts($, main);
    if (!details.before.trim() && !details.after.trim()) continue;
      rendered.push({
        handle: capture.handle,
        ...details,
        before: details.before + (details.hasReviewBoundary ? reviewGapCorrection(capture.handle) : ""),
      });
    }
    if (!rendered.length) continue;
    const sectionType = `s2s-details-${suffix.replace(/^s2s-/, "")}`;
    const familyName = suffix.replace(/^s2s-/, "");
    if (rendered.some((item) => item.hasReviewBoundary)) {
      await write(
        join(theme, `sections/${sectionType}-before.liquid`),
        liquidCase(rendered.map((item) => ({ handle: item.handle, html: tokensDecode(item.before) }))) + schema("Details before reviews"),
      );
      await write(
        join(theme, `sections/${sectionType}-after.liquid`),
        liquidCase(rendered.map((item) => ({ handle: item.handle, html: tokensDecode(item.after) }))) + schema("Details after reviews"),
      );
    } else {
      await write(
        join(theme, `sections/${sectionType}.liquid`),
        liquidCase(rendered.map((item) => ({ handle: item.handle, html: tokensDecode(item.before) }))) + schema(`Family ${familyName}`),
      );
    }
  }
}
function cssToLiquid(css: string, base: string, map: Map<string, Asset>) {
  let text = rewriteCss(css, base, map);
  for (const a of map.values())
    if (a.status === "ready")
      text = text.split(`"${a.file}"`).join(`"{{ '${a.file}' | asset_url }}"`);
  return text;
}
function rewriteMarkup($: CheerioAPI, base: string, map: Map<string, Asset>) {
  const local = (v: string) => {
    const u = resolveAsset(v, base);
    const a = u ? map.get(u) : null;
    return a ? `{{ '${a.file}' | asset_url }}` : v;
  };
  $("img,source,video").each((_, el) => {
    for (const attr of ["src", "poster", "data-src"]) {
      const v = $(el).attr(attr);
      if (v) $(el).attr(attr, local(v));
    }
    const srcset = $(el).attr("srcset");
    if (srcset)
      $(el).attr(
        "srcset",
        srcset
          .split(",")
          .map((p) => {
            const [u, ...d] = p.trim().split(/\s+/);
            return `${local(u)} ${d.join(" ")}`.trim();
          })
          .join(", "),
      );
    if (el.tagName === "img" && (!$(el).attr("width") || !$(el).attr("height"))) {
      const original = $(el).attr("src") || $(el).attr("data-src") || "";
      const liquidMatch = original.match(/'([^']+)'\s*\|\s*asset_url/);
      const asset = liquidMatch
        ? [...map.values()].find((item) => item.file === liquidMatch[1])
        : map.get(resolveAsset(original, base) || "");
      if (asset?.width && asset?.height) {
        $(el).attr("width", String(asset.width));
        $(el).attr("height", String(asset.height));
      }
    }
  });
  $("style").each((_, el) => {
    $(el).text(cssToLiquid($(el).text(), base, map));
  });
  $("[style]").each((_, el) => {
    $(el).attr("style", cssToLiquid($(el).attr("style")!, base, map));
  });
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    try {
      const u = new URL(href, base);
      if (u.origin === new URL(base).origin)
        $(el).attr("href", u.pathname + u.search + u.hash);
    } catch {}
  });
  // Keep internal navigation store-relative while satisfying Theme Check.
  // The suffix is preserved, so this is a route representation change rather
  // than a guessed redirect or a source-domain link.
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href === "/") {
      $(el).attr("href", "{{ routes.root_url }}");
      return;
    }
    if (href === "/collections/all") {
      $(el).attr("href", "{{ routes.all_products_collection_url }}");
      return;
    }
    const collection = href.match(/^\/collections(\/[^?#]+)([?#].*)?$/);
    if (collection)
      $(el).attr(
        "href",
        `{{ routes.collections_url }}${collection[1]}${collection[2] || ""}`,
      );
  });
  // Tooltip HTML is data, not an event handler. Preserve its visual assets locally.
  $("[data-bs-title]").each((_, el) => {
    $(el).attr(
      "data-bs-title",
      ($(el).attr("data-bs-title") || "").replace(
        /(src=['"])([^'"]+)/g,
        (_m, p, v) => p + local(v),
      ),
    );
  });
}

type NavigationDisposition = {
  path: string;
  action: "remove";
  reason: string;
  evidence: { requestedUrl: string; httpStatus: number; pageKind: string; capturedAt: string };
};

type NavigationRewrite = {
  sourcePath: string;
  targetPath: string;
  reason: string;
};

export function applyNavigationRewrites($: CheerioAPI, rewrites: NavigationRewrite[]) {
  const counts: Record<string, number> = {};
  for (const rewrite of rewrites) {
    if (!rewrite.sourcePath.startsWith("/") || !rewrite.targetPath.startsWith("/") || rewrite.targetPath.startsWith("//"))
      throw new Error(`Unsafe navigation rewrite: ${JSON.stringify(rewrite)}`);
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href") || "";
      let url: URL;
      try { url = new URL(href, "https://site2shop.invalid"); } catch { return; }
      if (url.origin !== "https://site2shop.invalid" || url.pathname !== rewrite.sourcePath) return;
      $(element).attr("href", `${rewrite.targetPath}${url.search}${url.hash}`);
      counts[rewrite.sourcePath] = (counts[rewrite.sourcePath] || 0) + 1;
    });
  }
  return counts;
}

export function applyNavigationDispositions(
  $: CheerioAPI,
  base: string,
  dispositions: NavigationDisposition[],
) {
  const removed: string[] = [];
  for (const disposition of dispositions) {
    if (disposition.action !== "remove") continue;
    if (
      disposition.evidence?.httpStatus !== 404 &&
      disposition.evidence?.httpStatus !== 410
    ) throw new Error(`${disposition.path}: removal requires source 404/410 evidence`);
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href") || "";
      let path = "";
      try { path = new URL(href, base).pathname.replace(/\/$/, "") || "/"; } catch { return; }
      if (path !== disposition.path) return;
      const item = $(element).closest("li");
      (item.length ? item : $(element)).remove();
      removed.push(path);
    });
  }
  for (const disposition of dispositions) {
    if (disposition.action === "remove" && !removed.includes(disposition.path))
      throw new Error(`${disposition.path}: declared navigation removal did not match generated markup`);
  }
  return removed;
}
function schema(name: string, extra: any[] = []) {
  return `\n{% schema %}\n${JSON.stringify({ name, settings: extra, presets: [{ name }] }, null, 2)}\n{% endschema %}\n`;
}
function tokensDecode(html: string) {
  return html.replace(/\{\{[\s\S]*?\}\}/g, (t) =>
    t
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"'),
  );
}
const supportedProductForm =
  '#form-custom-pet-portrait,form.shopify-product-form:has([data-step="1"])';

function adaptProduct($: CheerioAPI, ir: SiteIR) {
  const form = $(supportedProductForm).first();
  if (!form.length) {
    ir.issues.push({
      code: "NO_ADAPTER",
      message:
        "This product form does not match a supported multi-step Shopify product adapter.",
    });
    return;
  }
  const variants = JSON.stringify(ir.product?.variants || []).replace(
    /</g,
    "\\u003c",
  );
  form.attr("data-s2s-product", "true").removeAttr("data-product-id");
  form.find('select[name="id"]').remove();
  form.prepend('<input type="hidden" name="id" data-s2s-variant>');
  form.append(
    `<script type="application/json" id="s2s-variants">{% if product != blank %}{{ product.variants | json }}{% else %}${variants}{% endif %}</script>`,
  );
  form.append('<p data-s2s-status role="status" class="mt-4"></p>');
  form
    .find('[data-atc-addon],input[type="checkbox"][data-price]')
    .attr("disabled", "disabled")
    .attr("title", "Requires target-store add-on integration");
  form.find('input[type="file"]').attr("data-s2s-local-file", "true");
  form.find('button[type="submit"]').attr("data-s2s-disabled-commerce", "true");
  $("#product-content-area h1")
    .first()
    .html(
      `{% if product != blank %}{{ product.title | escape }}{% else %}${escapeHtml(ir.product?.title || "Custom Pet Portrait")}{% endif %}`,
    );
  ir.issues.push({
    code: "PHASE2_UPLOAD",
    message:
      "Multi-step UI and local file preview only. Durable uploads, paid add-ons and order placement intentionally unavailable until phase 2.",
  });
}
function staticReviewEvidence($: CheerioAPI, rendered: CheerioAPI) {
  // Never persist the source merchant's rendered review totals or account-bound widgets.
  // Phase 3 installs target-store Loox app blocks and metafield-backed summaries instead.
  void rendered;
  $(".loox-rating,#looxReviews,#loox-reviews-feed,#looxReviewsFrame,#loox-rating-icon-svg-store").remove();
}

function preserveCapturedProductCardRatingSlots($: CheerioAPI) {
  $("li.product-list-item .loox-rating").each((index, element) => {
    const rating = $(element);
    const card = rating.closest("li.product-list-item");
    const href = card.find('a[href*="/products/"]').first().attr("href") || "";
    const match = href.match(/\/products\/([^?#/]+)/);
    if (!match) return;
    const handle = decodeURIComponent(match[1]).replace(/[^a-z0-9-]/gi, "");
    if (!handle) return;
    const variable = `s2s_captured_rating_product_${index + 1}`;
    rating.replaceWith(
      `<div class="s2s-captured-card-rating">{% assign ${variable} = all_products['${handle}'] %}{% render 's2s-product-rating', product: ${variable}, link_to_reviews: true, card: true %}</div>`,
    );
  });
}

export function addReviewRatingSlots($: CheerioAPI, kind: "home" | "product") {
  const settings: Array<Record<string, string>> = [];
  const values: Record<string, string> = {};
  if (kind === "product") {
    const title = $("#product-content-area h1").first();
    if (title.length)
      title.after("{% render 's2s-product-rating', product: product, link_to_reviews: true %}");
    return { settings, values };
  }
  $("li.product-list-item").each((index, element) => {
    const card = $(element);
    const href = card.find('a[href*="/products/"]').first().attr("href") || "";
    const match = href.match(/\/products\/([^?#/]+)/);
    const heading = card.find("h3.product-title").first();
    if (!match || !heading.length) return;
    const id = `rating_product_${String(index + 1).padStart(2, "0")}`;
    settings.push({ type: "product", id, label: `Rating product ${index + 1}` });
    values[id] = decodeURIComponent(match[1]);
    heading.after(
      `{% assign s2s_card_product = section.settings.${id} %}{% if s2s_card_product != blank %}<div class="s2s-home-card-rating">{% render 's2s-product-rating', product: s2s_card_product %}</div>{% endif %}`,
    );
  });
  return { settings, values };
}

export async function compile(out: string, commerce = false) {
  await assertExecutableEvidence(out, "source");
  const ir = await readJson<SiteIR>(join(out, "site-ir.json"));
  const phase3 = await readJson<any>(join(out, "phase3-route-plan.json")).catch(
    () => null,
  );
  const phase3ProductPlan = await readJson<any>(join(out, "phase3-product-plan.json")).catch(
    () => null,
  );
  const navigationDispositions = await readJson<{ dispositions: NavigationDisposition[] }>(
    join(out, "navigation-dispositions.json"),
  ).then((value) => value.dispositions || []).catch(() => []);
  const navigationRewrites = await readJson<{ rewrites: NavigationRewrite[] }>(
    join(out, "navigation-rewrites.json"),
  ).then((value) => value.rewrites || []).catch(() => []);
  let binding = await readJson<any>(join(out, "catalog-binding.json")).catch(
    () => null,
  );
  if (binding && !binding.completed)
    throw new Error(
      "Catalog sync is incomplete. Finish catalog sync before compiling commerce.",
    );
  if (!binding && commerce) {
    const plan = await readJson<any>(join(out, "catalog-plan.json"));
    binding = {
      planned: true,
      products: plan.products.map((p: any) => ({
        handle: p.input.handle,
        sourceHandle: p.sourceHandle,
        kind: p.kind,
        selector: p.selector,
      })),
    };
  }
  if (ir.pages.length < 2)
    throw new Error("Both homepage and product evidence are required.");
  const productEvidence = ir.pages.find((p) => p.kind === "product");
  if (
    !productEvidence ||
    !load(await readFile(join(out, productEvidence.rawHtml), "utf8"))(
      supportedProductForm,
    ).length
  )
    throw new Error(
      "Unsupported product structure. The current compiler requires a multi-step Shopify product form; capture evidence remains available for a new adapter.",
    );
  ir.issues = ir.issues.filter(
    (i) => !["PHASE2_UPLOAD", "NO_ADAPTER"].includes(i.code),
  );
  ir.status.localVerified = false;
  ir.status.shopifyVerified = false;
  const familyEvidence = await readJson<any>(
    join(out, "product-family-source-evidence.json"),
  ).catch(() => null);
  const familyAssetSources = Array.isArray(familyEvidence?.families)
    ? familyEvidence.families
        .filter(
          (family: any) =>
            /^s2s-[a-z0-9-]+$/.test(String(family?.suffix || "")) &&
            Boolean(family?.url),
        )
        .map((family: any) => ({
          htmlPath: join(
            out,
            "product-family-evidence",
            "source",
            String(family.suffix),
            "desktop",
            "initial.html",
          ),
          baseUrl: String(family.url),
        }))
    : [];
  const map = await collectAssets(ir, out, familyAssetSources);
  const theme = join(out, "theme");
  const home = ir.pages.find((p) => p.kind === "home")!;
  const $home = load(await readFile(join(out, home.rawHtml), "utf8"));
  const styleHead: string[] = [];
  $home("head")
    .children()
    .each((_, el) => {
      if (el.tagName === "style")
        styleHead.push(
          `<style>${cssToLiquid($home(el).text(), home.url, map)}</style>`,
        );
      if (el.tagName === "link" && $home(el).attr("rel") === "stylesheet") {
        const u = resolveAsset($home(el).attr("href") || "", home.url);
        const a = u ? map.get(u) : null;
        if (a?.status === "ready")
          styleHead.push(`{{ '${a.file}' | asset_url | stylesheet_tag }}`);
      }
    });
  const layouts: Record<string, string> = {};
  let homeRatingSettings: Array<Record<string, string>> = [];
  let homeRatingValues: Record<string, string> = {};
  for (const p of ir.pages) {
    const $ = load(await readFile(join(out, p.rawHtml), "utf8"));
    const rendered = load(await readFile(join(out, p.html), "utf8"));
    sanitize($);
    staticReviewEvidence($, rendered);
    rewriteMarkup($, p.url, map);
    if (navigationRewrites.length) applyNavigationRewrites($, navigationRewrites);
    if (p.kind === "home" && navigationDispositions.length)
      applyNavigationDispositions($, p.url, navigationDispositions);
    if (p.kind === "product") adaptProduct($, ir);
    if (binding) bindCommerceMarkup($, binding, ir.product);
    if (p.kind === "home") ensureHeaderInteractionContracts($);
    if (p.kind === "home" || p.kind === "product") {
      const reviewSlots = addReviewRatingSlots($, p.kind);
      if (p.kind === "home") {
        homeRatingSettings = reviewSlots.settings;
        homeRatingValues = reviewSlots.values;
      }
    }
    // Preserve a single source-owned main DOM boundary. Common chrome is extracted without changing selectors.
    const main = $("main").first();
    if (!main.length) throw new Error(`Missing main element on ${p.url}`);
    if (p.kind === "home") {
      // Preserve header/footer wrappers. Granular editor settings belong to the next phase.
      const before: string[] = [];
      const after: string[] = [];
      let past = false;
      $("body")
        .children()
        .each((_, el) => {
          if (el === main[0]) {
            past = true;
            return;
          }
          const html = $.html(el);
          (past ? after : before).push(html);
        });
      await write(
        join(theme, "snippets/s2s-header.liquid"),
        tokensDecode(before.join("\n")),
      );
      await write(
        join(theme, "snippets/s2s-footer.liquid"),
        tokensDecode(after.join("\n")),
      );
    }
    let mainHtml = main.html() || "";
    // Inline page-specific styles outside the main element are still needed for the original cascade.
    if (p.kind === "product") {
      const extra = $("head style")
        .map((_, el) => $.html(el))
        .get()
        .join("\n");
      mainHtml = extra + mainHtml;
      if (phase3) {
        const detailsHtml = extractProductDetails($, main);
        if (!detailsHtml.trim())
          throw new Error("Captured product page has no content after #template-product.");
        await write(
          join(theme, "sections/s2s-product-details.liquid"),
          tokensDecode(detailsHtml) + schema("Captured product details"),
        );
      }
    }
    await write(
      join(theme, `sections/s2s-${p.kind}.liquid`),
      tokensDecode(mainHtml) +
        schema(
          p.kind === "home" ? "Captured homepage" : "Captured product",
          p.kind === "home" ? homeRatingSettings : [],
        ),
    );
    layouts[p.kind] = $("body").attr("class") || "";
  }
  await json(join(theme, "templates/index.json"), {
    sections: { main: { type: "s2s-home", settings: homeRatingValues } },
    order: ["main"],
  });
  await json(join(theme, "templates/product.json"), {
    sections: { main: { type: "s2s-product", settings: {} } },
    order: ["main"],
  });
  // An alternate index allows a product visual preview before catalog import, without pretending it is a real product.
  await json(join(theme, "templates/index.s2s-product.json"), {
    sections: { main: { type: "s2s-product", settings: {} } },
    order: ["main"],
  });
  await json(join(theme, "templates/page.s2s-product.json"), {
    sections: { main: { type: "s2s-product", settings: {} } },
    order: ["main"],
  });
  await write(
    join(theme, "snippets/s2s-product-rating.liquid"),
    looxRatingSnippet,
  );
  const looxCoreFallback = phase3
    ? `<script>(function(){if(window.LOOX||document.querySelector('script[src*="loox.io/widget/"]'))return;var s=document.createElement('script');s.async=true;s.src='https://loox.io/widget/loox.js?shop={{ shop.permanent_domain | url_encode }}';document.head.appendChild(s);}());</script>`
    : "";
  const layout = `<!doctype html>\n<html lang="{{ request.locale.iso_code }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="site2shop-build-id" content="${THEME_BUILD_PLACEHOLDER}"><title>{{ page_title | escape }}</title><link rel="canonical" href="{{ canonical_url }}">\n{{ content_for_header }}\n${styleHead.join("\n")}\n{{ 's2s-runtime.css' | asset_url | stylesheet_tag }}${phase3 ? "\n{{ 's2s-phase3.css' | asset_url | stylesheet_tag }}" : ""}\n<script src="{{ 's2s-splide.js' | asset_url }}" defer></script><script src="{{ 's2s-bootstrap.js' | asset_url }}" defer></script><script src="{{ 's2s-runtime.js' | asset_url }}" defer></script></head>\n<body class="{% if request.page_type == 'product' or template.suffix == 's2s-product' %}${layouts.product}{% else %}${layouts.home}{% endif %} s2s-page-type-{{ request.page_type }}">\n{% render 's2s-header' %}<main id="main" role="main">{{ content_for_layout }}</main>{% render 's2s-footer' %}\n${looxCoreFallback}</body></html>`;
  const includeCommerce = Boolean(binding || phase3);
  const commerceConfig = includeCommerce
    ? `<script id="s2s-commerce-config" type="application/json">{"root":{{ routes.root_url | json }},"currency":{{ cart.currency.iso_code | json }},"shopify":true,"text":{${Object.keys(
        commerceLocales,
      )
        .map((k) => `"${k}":{{ 's2s.${k}' | t | json }}`)
        .join(
          ",",
        )}}}</script>{{ 's2s-commerce.css' | asset_url | stylesheet_tag }}<script src="{{ 's2s-commerce.js' | asset_url }}" defer></script>`
    : "";
  await write(
    join(theme, "layout/theme.liquid"),
    layout.replace("</head>", commerceConfig + "</head>"),
  );
  await json(join(theme, "config/settings_schema.json"), [
    {
      name: "theme_info",
      theme_name: "Site2Shop Reference",
      theme_author: "Site2Shop",
      theme_version: phase3 ? "0.3.0" : binding ? "0.2.0" : "0.1.0",
      theme_documentation_url: "https://shopify.dev/docs/storefronts/themes",
      theme_support_url: "https://shopify.dev/docs/storefronts/themes",
    },
    {
      name: "Reference capture",
      settings: [
        {
          type: "paragraph",
          content: phase3
            ? "Phase 3 foundation: route inventory plus content, collection and standard product templates. Route objects still require reviewed import."
            : binding
              ? "Phase 2: catalog binding, custom photo properties and cart. Test checkout before launch."
              : "Phase 1 reference theme. Durable uploads and commerce integration are not enabled.",
        },
      ],
    },
  ]);
  await json(
    join(theme, "config/settings_data.json"),
    phase3 ? looxThemeSettings : { current: {} },
  );
  await json(join(theme, "locales/en.default.json"), {
    general: { accessibility: { skip_to_content: "Skip to content" } },
    ...(binding || phase3 ? { s2s: commerceLocales } : {}),
  });
  if (includeCommerce) await writeCommerceTheme(out);
  if (phase3) {
    await writeFamilyProductDetails(out, theme, map);
    await writePhase3Theme(out);
    await reconcileProductFamilyContractSections(out);
    await auditProductFamilyContracts(out);
    await auditCollectionFamilyContract(out);
  }
  const src = dirname(fileURLToPath(import.meta.url));
  for (const [from, to] of [
    ["runtime.js", "s2s-runtime.js"],
    ["runtime.css", "s2s-runtime.css"],
  ])
    await write(join(theme, "assets", to), await readFile(join(src, from)));
  await write(
    join(theme, "assets/s2s-splide.js"),
    await readFile(
      join(src, "../node_modules/@splidejs/splide/dist/js/splide.min.js"),
    ),
  );
  await write(
    join(theme, "assets/s2s-bootstrap.js"),
    await readFile(
      join(src, "../node_modules/bootstrap/dist/js/bootstrap.bundle.min.js"),
    ),
  );
  await json(join(out, "store-data.json"), {
    schemaVersion: 1,
    source: ir.sourceUrl,
    products: ir.product ? [ir.product] : [],
    importStatus: binding?.completed ? "bound" : "not-imported",
    binding: binding?.completed ? "catalog-binding.json" : null,
    sourceIdsAreNotTargetIds: true,
  });
  await json(join(out, "install-manifest.json"), {
    schemaVersion: 1,
    theme: "theme.zip",
    source: ir.sourceUrl,
    pages: phase3
      ? [
          "/",
          `/products/${binding?.products?.[0]?.handle || phase3ProductPlan?.products?.[0]?.handle || ir.product?.handle}`,
          "/cart",
          "page template",
          "collection template",
          "standard product template",
        ]
      : binding
        ? ["/", `/products/${binding.products[0].handle}`, "/cart"]
        : ["/", "/?view=s2s-product"],
    product: ir.product?.handle,
    sourceIdsAreNotTargetIds: true,
    requirements: binding
      ? [
          "Checkout/payment and shipping setup",
          "Test order verification",
          "Review app integration",
          "Uncaptured pages and products",
        ]
      : [
          "Catalog import / product binding",
          "Durable upload adapter (phase 2)",
          "Add-on product mapping (phase 2)",
          "Review app integration",
        ],
    scope: phase3
      ? "phase 2 routes plus phase 3 route inventory and generic page/collection/standard-product templates; source objects not yet imported"
      : binding
        ? "homepage, one bound portrait product, four add-on products and cart; checkout/order verification separate"
        : "homepage plus one product visual template",
  });
  if (binding) ir.issues = ir.issues.filter((i) => i.code !== "PHASE2_UPLOAD");
  ir.status.generated = true;
  await json(join(out, "site-ir.json"), ir);
  await packageTheme(out);
  await recordGeneratorPresentationBindings(out);
  return ir;
}
export async function packageTheme(out: string) {
  const {applyCollectionRouteAliases}=await import('./resource-route-aliases.js');
  await applyCollectionRouteAliases(out);
  const root = join(out, "theme");
  const files: Record<string, Uint8Array> = {};
  async function walk(dir: string, prefix = "") {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      const name = prefix + e.name;
      if (e.isDirectory()) await walk(path, name + "/");
      else if (!e.name.startsWith("."))
        files[name] = new Uint8Array(await readFile(path));
    }
  }
  await walk(root);
  const digest = createHash("sha256");
  for (const name of Object.keys(files).sort())
    digest.update(name).update("\0").update(normalizedThemeBuildBytes(name, files[name]));
  const buildId = digest.digest("hex");
  const layoutName = "layout/theme.liquid";
  if (files[layoutName]) {
    files[layoutName] = Buffer.from(Buffer.from(files[layoutName]).toString("utf8").replace(THEME_BUILD_PLACEHOLDER, buildId).replace(/(<meta\s+name=["']site2shop-build-id["']\s+content=["'])[^"']*(["']\s*\/?>)/i, `$1${buildId}$2`));
    await write(join(root, layoutName), Buffer.from(files[layoutName]));
  }
  await json(join(out, "theme-build.json"), {
    id: buildId,
    builtAt: new Date().toISOString(),
  });
  await write(
    join(out, "theme.zip"),
    Buffer.from(zipSync(files, { level: 6 })),
  );
}
