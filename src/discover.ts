import { join } from "node:path";
import { load } from "cheerio";
import { chromium } from "playwright";
import { safeFetch } from "./network.js";
import { json, pool, readJson, write } from "./util.js";
import { hash } from "./util.js";
import { REQUIRED_VIEWPORTS, type SiteIR } from "./types.js";
import { screenshotState } from "./capture.js";
import { assertRenderedEvidencePage } from "./rendered-page-validity.js";

export type RouteKind =
  | "home"
  | "product"
  | "collection"
  | "page"
  | "blog"
  | "article"
  | "other";

export type RouteRecord = {
  sourceUrl: string;
  path: string;
  kind: RouteKind;
  handle: string;
  lastmod?: string;
  title?: string;
  referencedFromHome: boolean;
  migration: "existing" | "candidate" | "deferred";
  priority: number;
};

export function mergeRenderedNavigationRoutes(
  sitemapRoutes: RouteRecord[],
  renderedLinks: string[],
  origin: string,
) {
  const byPath = new Map(sitemapRoutes.map((route) => [route.path, route]));
  for (const href of renderedLinks) {
    const path = cleanPath(href, origin);
    if (!path) continue;
    const existing = byPath.get(path);
    if (existing) {
      existing.referencedFromHome = true;
      existing.priority = Math.max(existing.priority, existing.migration === "existing" ? 100 : 90);
      continue;
    }
    const kind = classifyRoute(path);
    const deferred = ["blog", "article", "other"].includes(kind);
    byPath.set(path, {
      sourceUrl: new URL(path, origin).href,
      path,
      kind,
      handle: path.split("/").filter(Boolean).at(-1) || "home",
      referencedFromHome: true,
      migration: deferred ? "deferred" : "candidate",
      priority: 90,
    });
  }
  return [...byPath.values()].sort(
    (a, b) => b.priority - a.priority || a.path.localeCompare(b.path),
  );
}

const entities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");

export function xmlLocations(xml: string) {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) =>
    entities(match[1].trim()),
  );
}

export function classifyRoute(path: string): RouteKind {
  if (path === "/") return "home";
  if (path.startsWith("/products/")) return "product";
  if (path.startsWith("/collections/")) return "collection";
  if (path.startsWith("/pages/")) return "page";
  if (/^\/blogs\/[^/]+\/?$/.test(path)) return "blog";
  if (path.startsWith("/blogs/")) return "article";
  return "other";
}

function sitemapEntries(xml: string, origin: string) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)]
    .map((match) => {
      const body = match[1];
      const loc = body.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1];
      if (!loc) return null;
      const url = new URL(entities(loc.trim()));
      if (url.origin !== origin) return null;
      const lastmod = body
        .match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]
        ?.trim();
      const title = body.match(
        /<(?:image:)?title>([\s\S]*?)<\/(?:image:)?title>/i,
      )?.[1];
      return {
        url,
        lastmod,
        title: title ? entities(title.trim()) : undefined,
      };
    })
    .filter(Boolean) as Array<{ url: URL; lastmod?: string; title?: string }>;
}

const cleanPath = (input: string, origin: string) => {
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin) return null;
    return url.pathname.replace(/\/$/, "") || "/";
  } catch {
    return null;
  }
};

export async function discoverRoutes(out: string, sampleCount = 3) {
  const ir = await readJson<SiteIR>(join(out, "site-ir.json"));
  const origin = new URL(ir.sourceUrl).origin;
  const sitemapUrl = new URL("/sitemap.xml", origin).href;
  const indexResponse = await safeFetch(sitemapUrl);
  if (!indexResponse.ok)
    throw new Error(`Sitemap returned ${indexResponse.status}`);
  const indexXml = await indexResponse.text();
  const childMaps = xmlLocations(indexXml).filter(
    (url) => new URL(url).origin === origin,
  );
  const maps = await pool(childMaps, 4, async (url) => {
    const response = await safeFetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    const xml = await response.text();
    return { url, entries: sitemapEntries(xml, origin) };
  });
  const homeLinks = new Set(
    ir.pages
      .filter((page) => page.kind === "home")
      .flatMap((page) => page.links)
      .map((url) => cleanPath(url, origin))
      .filter(Boolean) as string[],
  );
  const existing = new Set(["/"]);
  if (ir.product?.handle) existing.add(`/products/${ir.product.handle}`);
  const byPath = new Map<string, RouteRecord>();
  for (const map of maps) {
    for (const entry of map.entries) {
      const path = entry.url.pathname.replace(/\/$/, "") || "/";
      const kind = classifyRoute(path);
      const referencedFromHome = homeLinks.has(path);
      const migrated = existing.has(path);
      const deferred = ["blog", "article", "other"].includes(kind);
      const priority = migrated
        ? 100
        : referencedFromHome
          ? 90
          : kind === "product"
            ? 60
            : ["collection", "page"].includes(kind)
              ? 50
              : 20;
      byPath.set(path, {
        sourceUrl: entry.url.href,
        path,
        kind,
        handle: path.split("/").filter(Boolean).at(-1) || "home",
        lastmod: entry.lastmod,
        title: entry.title,
        referencedFromHome,
        migration: migrated ? "existing" : deferred ? "deferred" : "candidate",
        priority,
      });
    }
  }
  if (!byPath.has("/"))
    byPath.set("/", {
      sourceUrl: origin + "/",
      path: "/",
      kind: "home",
      handle: "home",
      referencedFromHome: true,
      migration: "existing",
      priority: 100,
    });
  const routes = mergeRenderedNavigationRoutes(
    [...byPath.values()],
    [...homeLinks],
    origin,
  );
  const counts = Object.fromEntries(
    [...new Set(routes.map((route) => route.kind))].map((kind) => [
      kind,
      routes.filter((route) => route.kind === kind).length,
    ]),
  );
  const plan = {
    schemaVersion: 1,
    source: origin,
    generatedAt: new Date().toISOString(),
    sitemap: sitemapUrl,
    sitemapCount: childMaps.length,
    routeCount: routes.length,
    counts,
    homeReferencedCandidates: routes.filter(
      (route) => route.referencedFromHome && route.migration === "candidate",
    ).length,
    policy: {
      firstWave: "Home-linked products, collections and pages",
      deferred:
        "Blogs, articles, account, checkout, apps and third-party feeds",
      note: "A sitemap URL is evidence of existence, not proof that its business behavior can be cloned from public HTML.",
    },
    routes,
  };
  await json(join(out, "phase3-route-plan.json"), plan);
  const summary = [
    "# Site2Shop 第三阶段路由清单",
    "",
    `生成时间：${plan.generatedAt}`,
    `源站：${origin}`,
    `站点地图：${childMaps.length} 个；唯一公开路由：${routes.length} 条。`,
    "",
    "| 类型 | 数量 |",
    "| --- | ---: |",
    ...Object.entries(counts).map(([kind, count]) => `| ${kind} | ${count} |`),
    "",
    `第一批：首页直接引用且尚未迁移的商品、集合、内容页共 ${plan.homeReferencedCandidates} 条。`,
    "博客、文章、账户、结账、应用与第三方 feed 暂缓，公开 HTML 不足以证明其后台行为。",
    "",
    "## 第一批路由",
    "",
    ...routes
      .filter(
        (route) => route.referencedFromHome && route.migration === "candidate",
      )
      .map((route) => `- ${route.kind} · ${route.path}`),
    "",
  ].join("\n");
  await write(join(out, "phase3-route-summary.md"), summary);
  if (sampleCount > 0) await capturePrioritySamples(out, routes, sampleCount);
  console.log(
    `Discovered ${routes.length} routes; ${plan.homeReferencedCandidates} home-linked candidates.`,
  );
  return plan;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchContent(input: string) {
  const direct = await safeFetch(input);
  if (direct.status !== 429 && direct.status < 500) return direct;
  const original = new URL(input);
  const reader = `https://r.jina.ai/http://${original.host}${original.pathname}${original.search}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await safeFetch(
      reader,
      /\.js(?:\?|$)|\.json(?:\?|$)/.test(input)
        ? {}
        : { "X-Target-Selector": "main" },
    );
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt < 3) await wait(2000 * (attempt + 1));
  }
  return direct;
}

const jinaBody = (text: string) =>
  text.includes("Markdown Content:")
    ? text.split("Markdown Content:").slice(1).join("Markdown Content:").trim()
    : text;

function markdownHtml(markdown: string) {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const inline = (value: string) =>
    value
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)/g, '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return escaped
    .split(/\r?\n\r?\n+/)
    .map((block) => {
      const value = block.trim();
      if (!value) return "";
      const heading = value.match(/^(#{1,6})\s+([\s\S]+)$/);
      if (heading)
        return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      if (/^(?:[-*]\s+.+(?:\r?\n|$))+/.test(value))
        return `<ul>${value
          .split(/\r?\n/)
          .map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`)
          .join("")}</ul>`;
      return `<p>${inline(value).replace(/\r?\n/g, "<br>")}</p>`;
    })
    .join("");
}

export async function planPhase3Content(
  out: string,
  all = false,
  resume = false,
) {
  const routePlan = await readJson<any>(join(out, "phase3-route-plan.json"));
  const previous = resume
    ? await readJson<any>(join(out, "phase3-content-progress.json")).catch(
        () => readJson<any>(join(out, "phase3-content-plan.json")).catch(() => null),
      )
    : null;
  const completed = new Map(
    (previous?.records || [])
      .filter((record: any) => record.status === "ready")
      .map((record: any) => [record.path, record]),
  );
  const routes = (routePlan.routes as RouteRecord[]).filter((route) =>
    all
      ? route.kind !== "home"
      : route.referencedFromHome && route.migration === "candidate",
  );
  const productCatalog = new Map<string, any>();
  if (all && routes.some((route) => route.kind === "product" && !completed.has(route.path))) {
    try {
      const endpoint = new URL("/products.json?limit=250", routePlan.source);
      const response = await fetchContent(endpoint.href);
      if (response.ok) {
        const payload = JSON.parse(jinaBody(await response.text()));
        for (const product of payload.products || [])
          productCatalog.set(product.handle, product);
      }
    } catch {}
  }
  const records = await pool(routes, all ? 1 : 4, async (route) => {
    if (completed.has(route.path)) return completed.get(route.path);
    const record = await (async () => {
      try {
      if (route.kind === "product") {
        let product = productCatalog.get(route.handle);
        if (!product) {
          const endpoint = new URL(route.sourceUrl);
          endpoint.pathname += ".js";
          const response = await fetchContent(endpoint.href);
          if (!response.ok)
            throw new Error(`Product JSON returned ${response.status}`);
          const text = await response.text();
          product = JSON.parse(jinaBody(text));
        }
        const money = (value: unknown) =>
          typeof value === "number"
            ? value
            : Math.round(Number(value || 0) * 100);
        const images = (product.images || []).map((image: any) =>
          typeof image === "string" ? image : image.src,
        );
        const variants = (product.variants || []).map((variant: any) => ({
          ...variant,
          price: money(variant.price),
          compare_at_price:
            variant.compare_at_price == null
              ? null
              : money(variant.compare_at_price),
          options:
            variant.options ||
            [variant.option1, variant.option2, variant.option3].filter(
              (value) => value != null,
            ),
          featured_image: variant.featured_image ||
            (variant.featured_image_id
              ? {
                  position:
                    (product.images || []).findIndex(
                      (image: any) => image.id === variant.featured_image_id,
                    ) + 1,
                }
              : null),
        }));
        return {
          ...route,
          status: "ready",
          sourceSnapshot: {
            id: String(product.id),
            title: product.title,
            handle: product.handle,
            vendor: product.vendor,
            type: product.type,
            tags: product.tags,
            description: product.description || product.body_html || "",
            options: product.options,
            images,
            variants,
          },
          fingerprint: hash(JSON.stringify(product)),
          requires: [
            "target product ID binding",
            "product-family adapter review",
            "media localization or approved remote import",
          ],
        };
      }
      const response = await fetchContent(route.sourceUrl);
      if (!response.ok) throw new Error(`HTML returned ${response.status}`);
      const sourceText = await response.text();
      const viaReader = response.url.includes("r.jina.ai");
      const html = viaReader
        ? `<main>${markdownHtml(jinaBody(sourceText))}</main>`
        : sourceText;
      const $ = load(html);
      $(
        "script,iframe,object,embed,noscript,form,#attentive_overlay,#attentive_creative,#gorgias-chat-container",
      ).remove();
      if (route.kind === "other")
        return {
          ...route,
          status: "deferred",
          requires: ["non-storefront machine-readable route"],
        };
      const main = $("main").first();
      if (!main.length) throw new Error("No main element");
      if (route.kind === "page") {
        const bodyHtml = main.html() || "";
        return {
          ...route,
          status: "ready",
          sourceSnapshot: {
            title:
              $("main h1").first().text().trim() ||
              $("title")
                .text()
                .replace(/\s*[–—-]\s*West\s*&\s*Willow.*$/i, "")
                .trim(),
            handle: route.handle,
            bodyHtml,
          },
          fingerprint: hash(bodyHtml),
          requires: [
            "asset localization",
            "form replacement where applicable",
            "third-party widget replacement where applicable",
          ],
        };
      }
      if (route.kind === "collection") {
        const productsUrl = new URL(
          `/collections/${route.handle}/products.json?limit=250`,
          routePlan.source,
        );
        const productsResponse = await fetchContent(productsUrl.href);
        if (!productsResponse.ok)
          throw new Error(
            `Collection products returned ${productsResponse.status}`,
          );
        const collectionProducts = JSON.parse(
          jinaBody(await productsResponse.text()),
        );
        const handles = (collectionProducts.products || []).map(
          (p: any) => p.handle,
        );
        const descriptionHtml =
          $("main").find(".collection-description").html() || "";
        return {
          ...route,
          status: "ready",
          sourceSnapshot: {
            title:
              $("main h1").first().text().trim() || route.title || route.handle,
            handle: route.handle,
            descriptionHtml,
            productHandles: handles,
          },
          fingerprint: hash(JSON.stringify({ descriptionHtml, handles })),
          requires: [
            "target collection ID binding",
            "all referenced products imported before membership",
          ],
        };
      }
      if (route.kind === "blog") {
        return {
          ...route,
          status: "ready",
          sourceSnapshot: {
            title:
              $("main h1").first().text().trim() || route.title || route.handle,
            handle: route.handle,
          },
          fingerprint: hash(route.handle),
          requires: ["target blog ID binding"],
        };
      }
      if (route.kind === "article") {
        const parts = route.path.split("/").filter(Boolean);
        const article = $("main article").first();
        const bodyRoot = article.length ? article : $("main").first();
        const bodyHtml = bodyRoot.html() || "";
        const publishedText =
          $("meta[property='article:published_time']").attr("content") ||
          $("time").first().attr("datetime") ||
          route.lastmod;
        return {
          ...route,
          status: "ready",
          sourceSnapshot: {
            title:
              bodyRoot.find("h1").first().text().trim() ||
              $("main h1").first().text().trim() ||
              route.title ||
              route.handle,
            handle: route.handle,
            blogHandle: parts[1],
            bodyHtml,
            summaryHtml:
              $("meta[name='description']").attr("content") || "",
            publishedAt: publishedText || null,
          },
          fingerprint: hash(bodyHtml),
          requires: [
            "target blog ID binding",
            "asset localization",
            "author fallback review",
          ],
        };
      }
      return {
        ...route,
        status: "deferred",
        requires: ["unsupported route kind"],
      };
      } catch (error) {
        return { ...route, status: "failed", error: String(error) };
      }
    })();
    completed.set(route.path, record);
    if (all)
      await json(join(out, "phase3-content-progress.json"), {
        updatedAt: new Date().toISOString(),
        records: [...completed.values()],
      });
    return record;
  });
  const ready = records.filter((record: any) => record.status === "ready");
  const plan = {
    schemaVersion: 1,
    source: routePlan.source,
    generatedAt: new Date().toISOString(),
    mode: "read-only-source-snapshot",
    writeReady: false,
    reason:
      "Products need family adapters; pages and articles need asset/widget review; collections require imported target product IDs.",
    counts: {
      total: records.length,
      ready: ready.length,
      failed: records.filter((record: any) => record.status === "failed")
        .length,
      products: ready.filter((record: any) => record.kind === "product").length,
      collections: ready.filter((record: any) => record.kind === "collection")
        .length,
      pages: ready.filter((record: any) => record.kind === "page").length,
      blogs: ready.filter((record: any) => record.kind === "blog").length,
      articles: ready.filter((record: any) => record.kind === "article").length,
      deferred: records.filter((record: any) => record.status === "deferred")
        .length,
    },
    records,
  };
  await json(join(out, "phase3-content-plan.json"), plan);
  console.log(
    `Prepared ${plan.counts.ready}/${plan.counts.total} source snapshots; no Shopify writes performed.`,
  );
  return plan;
}

async function capturePrioritySamples(
  out: string,
  routes: RouteRecord[],
  sampleCount: number,
) {
  const kinds: RouteKind[] = ["product", "collection", "page"];
  const selected = kinds
    .map((kind) =>
      routes.find(
        (route) =>
          route.kind === kind &&
          route.referencedFromHome &&
          route.migration === "candidate",
      ),
    )
    .filter(Boolean)
    .slice(0, sampleCount) as RouteRecord[];
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
  });
  const context = await browser.newContext({
    viewport: REQUIRED_VIEWPORTS[0],
    locale: "en-US",
    serviceWorkers: "block",
  });
  const samples: any[] = [];
  try {
    for (const route of selected) {
      const page = await context.newPage();
      const response = await page.goto(route.sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 8000 })
        .catch(() => {});
      await assertRenderedEvidencePage(page, response, "source");
      if (!response) throw new Error(`SOURCE_EVIDENCE_INVALID: no navigation response (${route.sourceUrl})`);
      await page.addStyleTag({
        content:
          '#attentive_overlay,#attentive_creative,iframe[title*="Sign Up"],#gorgias-chat-container{display:none!important}body{overflow:visible!important;position:static!important;height:auto!important}',
      });
      const key = `${route.kind}-${route.handle}`.replace(/[^a-z0-9-]/gi, "-");
      const raw = await response.text();
      await write(join(out, "capture", "phase3", `${key}.raw.html`), raw);
      const rendered = await page.content();
      await write(join(out, "capture", "phase3", `${key}.html`), rendered);
      const item: any = {
        kind: route.kind,
        path: route.path,
        sourceUrl: route.sourceUrl,
        title: await page.title(),
        screenshots: {},
      };
      for (const { width, height } of REQUIRED_VIEWPORTS) {
        await page.setViewportSize({ width, height });
        const file = `capture/phase3/${key}-${width}.png`;
        await screenshotState(page, join(out, file));
        item.screenshots[width] = file;
      }
      samples.push(item);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await json(join(out, "phase3-samples.json"), {
    capturedAt: new Date().toISOString(),
    samples,
  });
}
