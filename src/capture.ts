import { chromium, type Page } from "playwright";
import { join } from "node:path";
import { publicDnsBrowserArgs, publicUrl } from "./network.js";
import { hash, json, write } from "./util.js";
import {
  WIDTHS,
  REQUIRED_VIEWPORTS,
  type SiteIR,
  type CapturePage,
  type PageKind,
} from "./types.js";
import { assertRenderedEvidencePage } from "./rendered-page-validity.js";

async function settle(page: Page) {
  await page
    .evaluate(async () => {
      await document.fonts.ready;
    })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}
export async function screenshotState(page: Page, path: string) {
  await page.evaluate(async () => {
    // Lazy embeds can change document height during scrolling. Re-read it each step.
    for (
      let y = 0;
      y < Math.min(document.documentElement.scrollHeight, 40000);
      y += 650
    ) {
      scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 150));
    }
    document
      .querySelector("footer,#footer")
      ?.scrollIntoView({ block: "end", behavior: "instant" });
  });
  await settle(page);
  await page.evaluate(async () => {
    scrollTo({ top: 0, behavior: "instant" });
    let previous = 0,
      stable = 0;
    for (let i = 0; i < 30 && stable < 5; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const height = document.documentElement.scrollHeight;
      stable = height === previous ? stable + 1 : 0;
      previous = height;
    }
  });
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    timeout: 30000,
  });
}
export async function capture(
  source: string,
  out: string,
  productUrl?: string,
): Promise<SiteIR> {
  const url = (await publicUrl(source)).href;
  const ir: SiteIR = {
    schemaVersion: 1,
    sourceUrl: url,
    capturedAt: new Date().toISOString(),
    engine: "playwright-chromium",
    viewports: WIDTHS,
    pages: [],
    assets: [],
    product: null,
    issues: [],
    status: {
      generated: false,
      localVerified: false,
      shopifyVerified: false,
      commerceVerified: false,
    },
  };
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: publicDnsBrowserArgs,
  });
  const context = await browser.newContext({
    viewport: REQUIRED_VIEWPORTS[0],
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  const seen = new Set<string>();
  const writes: Promise<unknown>[] = [];
  await context.route("**/*", async (route) => {
    try {
      const u = route.request().url();
      if (/^https?:/.test(u)) await publicUrl(u);
      await route.continue();
    } catch {
      await route.abort();
    }
  });
  context.on("response", (response) => {
    const type = response.request().resourceType();
    const url = response.url();
    if (
      !response.ok() ||
      !["image", "stylesheet", "font", "script", "media"].includes(type) ||
      seen.has(url)
    )
      return;
    seen.add(url);
    writes.push(
      (async () => {
        try {
          const body = await response.body();
          if (body.length > 24 * 1024 * 1024) return;
          const key = hash(url);
          await write(join(out, "capture", "network", key), body);
          await json(join(out, "capture", "network", key + ".json"), {
            url,
            mime: response.headers()["content-type"] || "",
            bytes: body.length,
          });
        } catch {}
      })(),
    );
  });
  try {
    for (const kind of ["home", "product"] as PageKind[]) {
      const page = await context.newPage();
      const target = kind === "home" ? url : productUrl;
      if (!target) {
        ir.issues.push({
          code: "NO_PRODUCT",
          message: "No product URL discovered.",
        });
        break;
      }
      console.log(`Capture ${kind}: ${target}`);
      const response = await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await settle(page);
      try {
        await assertRenderedEvidencePage(page, response, "source");
      } catch (error) {
        ir.issues.push({
          code: "SOURCE_BLOCKED",
          message: String(error),
          url: target,
        });
        await json(join(out, "site-ir.json"), ir);
        throw error;
      }
      if (!response) throw new Error(`SOURCE_EVIDENCE_INVALID: no navigation response (${target})`);
      const title = await page.title();
      const raw = await response.text();
      await write(join(out, "capture", `${kind}.raw.html`), raw);
      // Exclude third-party overlays from the baseline, with this decision recorded in the manifest.
      await page.addStyleTag({
        content:
          '#attentive_overlay,#attentive_creative,iframe[title*="Sign Up"],#gorgias-chat-container{display:none!important}body{overflow:visible!important;position:static!important;height:auto!important}',
      });
      const links = await page
        .locator("a[href]")
        .evaluateAll((nodes) =>
          nodes.map((n) => (n as HTMLAnchorElement).href),
        );
      if (kind === "home" && !productUrl)
        productUrl = links.find(
          (v) =>
            new URL(v).origin === new URL(url).origin &&
            new URL(v).pathname.startsWith("/products/"),
        );
      if (kind === "product") {
        const productPath = new URL(target);
        productPath.search = "";
        productPath.pathname += ".js";
        const pr = await context.request
          .get(productPath.href)
          .catch(() => null);
        if (pr?.ok()) {
          ir.product = await pr.json().catch(() => null);
          if (ir.product?.variants?.length === 250)
            ir.issues.push({
              code: "VARIANTS_MAY_BE_TRUNCATED",
              message:
                "Public API returned 250 variants; completeness is not verified.",
            });
        }
        if (!ir.product?.variants?.length) {
          ir.product = await page.evaluate(() => {
            const globals = window as typeof window & {
              OnwardWalletsCurrentProduct?: unknown;
              meta?: { product?: unknown };
              __PRODUCT__?: unknown;
            };
            const candidates: unknown[] = [
              globals.OnwardWalletsCurrentProduct,
              globals.meta?.product,
              globals.__PRODUCT__,
            ];
            for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/json"]')) {
              try {
                candidates.push(JSON.parse(script.textContent || "null"));
              } catch {
                // Ignore unrelated application/json payloads.
              }
            }
            return candidates.find((candidate: any) =>
              candidate && typeof candidate === "object" &&
              Array.isArray(candidate.variants) && candidate.variants.length > 0,
            ) || null;
          });
          if (ir.product?.variants?.length)
            ir.issues.push({
              code: "PRODUCT_EMBEDDED_JSON_FALLBACK",
              message:
                "Public product JSON was unavailable; captured rendered-page embedded Shopify product data instead.",
            });
        }
        if (!ir.product?.variants?.length)
          throw new Error(
            `SOURCE_PRODUCT_DATA_MISSING: no usable variants from ${productPath.href} or rendered embedded product JSON`,
          );
      }
      const entry: CapturePage = {
        kind,
        url: target,
        title,
        html: `capture/${kind}.html`,
        rawHtml: `capture/${kind}.raw.html`,
        links,
        screenshots: {},
        animations: [],
        styles: [],
        scripts: [],
        states: [],
      };
      for (const { width, height } of REQUIRED_VIEWPORTS) {
        await page.setViewportSize({ width, height });
        const file = `capture/${kind}-${width}.png`;
        await screenshotState(page, join(out, file));
        entry.screenshots[width] = file;
      }
      await page.setViewportSize(REQUIRED_VIEWPORTS[0]);
      await settle(page);
      const meta = await page.evaluate(() => ({
        styles: Array.from(
          document.querySelectorAll('link[rel="stylesheet"]'),
        ).map((el) => (el as HTMLLinkElement).href),
        scripts: Array.from(document.scripts)
          .map((s) => s.src)
          .filter(Boolean),
        animations: document.getAnimations().map((a) => ({
          target: (a.effect as KeyframeEffect)?.target?.nodeName,
          timing: a.effect?.getTiming(),
          keyframes: (a.effect as KeyframeEffect)?.getKeyframes?.(),
        })),
      }));
      Object.assign(entry, meta);
      await write(join(out, entry.html), await page.content());
      if (kind === "product") {
        for (let step = 0; step < 3; step++) {
          const next = page.getByRole("button", { name: /^NEXT/i }).first();
          if (!(await next.count()) || !(await next.isVisible())) break;
          const before = await page.locator("main,#main").first().innerText();
          await next.click();
          await settle(page);
          const after = await page.locator("main,#main").first().innerText();
          if (before === after) break;
          const file = `capture/product-step-${step + 2}.html`;
          await write(join(out, file), await page.content());
          entry.states.push({
            action: "next",
            html: file,
            text: after.slice(0, 1800),
          });
          if (await page.locator('input[type="file"]').count()) break;
        }
      }
      ir.pages.push(entry);
      await json(join(out, "site-ir.json"), ir);
      await page.close();
    }
    ir.issues.push({
      code: "CAPTURE_SCOPE",
      message:
        "Only homepage and one product page are in phase 1. Third-party signup/chat overlays excluded; review iframes and backend behavior require integration.",
    });
    await Promise.all(writes);
    await json(join(out, "site-ir.json"), ir);
    return ir;
  } finally {
    await browser.close();
  }
}
