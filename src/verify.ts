import { chromium } from "playwright";
import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { readJson, json } from "./util.js";
import { serve, renderPreview } from "./preview.js";
import { report } from "./report.js";
import { REQUIRED_VIEWPORTS, type SiteIR } from "./types.js";
import { assertRenderedEvidencePage } from "./rendered-page-validity.js";
import { assertRenderedEvidenceRoute } from "./rendered-page-validity.js";
import { unlockStorefrontIfNeeded } from "./storefront-auth.js";

async function navigateForVerification(page: import("playwright").Page, targetUrl: string, remote: boolean) {
  let response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (remote)
    response = (await unlockStorefrontIfNeeded(page, targetUrl)) || response;
  await assertRenderedEvidencePage(page, response, remote ? "target" : "source");
  await assertRenderedEvidenceRoute(page, targetUrl, remote ? "target" : "source");
  return response;
}

export function requireSourceScreenshot(
  screenshots: Record<string, string> | undefined,
  kind: string,
  width: number,
) {
  const source = screenshots?.[String(width)];
  if (!source)
    throw new Error(
      `SOURCE_SCREENSHOT_MISSING: ${kind} has no ${width}px baseline for the current required viewport contract`,
    );
  return source;
}

export async function verify(out: string, remote?: string) {
  const ir = await readJson<SiteIR>(join(out, "site-ir.json"));
  const binding = await readJson<any>(join(out, "catalog-binding.json")).catch(
    () => null,
  );
  const productPath =
    remote && binding?.completed
      ? `/products/${binding.products.find((p: any) => p.kind === "portrait").handle}`
      : null;
  await renderPreview(out);
  await mkdir(join(out, "verification"), { recursive: true });
  const local = remote ? null : await serve(out);
  const base = remote || local!.url;
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
  });
  const result: any = {
    themeBuild: (
      await readJson<any>(join(out, "theme-build.json")).catch(() => null)
    )?.id,
    mode: remote ? "shopify" : "local",
    capturedAt: new Date().toISOString(),
    scope:
      "homepage and alternate product template; visual metric covers each required desktop/tablet/mobile viewport height",
    passed: false,
    screenshots: [],
    functional: {},
    errors: [],
    outboundRequests: [],
    excludedOverlays: remote
      ? ["#PBarNextFrame (Shopify draft preview toolbar)"]
      : [],
  };
  if (remote) ir.status.shopifyVerified = false;
  else ir.status.localVerified = false;
  try {
    const page = await browser.newPage({
      viewport: REQUIRED_VIEWPORTS[0],
      locale: "en-US",
    });
    page.on("pageerror", (e) => result.errors.push(e.message));
    page.on("request", (req) => {
      if (
        req.url().startsWith("http") &&
        !req.url().startsWith(base.split("?")[0]) &&
        !req.url().includes(".myshopify.com") &&
        !req.url().includes("cdn.shopify.com")
      )
        result.outboundRequests.push(req.url());
    });
    for (const kind of ["home", "product"]) {
      for (const { width, height } of REQUIRED_VIEWPORTS) {
        const url = new URL(base);
        if (kind === "product") {
          if (productPath) {
            url.pathname = productPath;
            url.searchParams.delete("view");
          } else url.searchParams.set("view", "s2s-product");
        }
        await page.setViewportSize({ width, height });
        await navigateForVerification(page, url.href, !!remote);
        await page.waitForFunction(() => document.fonts.status === "loaded");
        await page.evaluate(async () => {
          const max = Math.min(document.documentElement.scrollHeight, 24000);
          for (let y = 0; y < max; y += 650) {
            scrollTo({ top: y, behavior: "instant" });
            await new Promise((r) => setTimeout(r, 100));
          }
          scrollTo({ top: 0, behavior: "instant" });
        });
        await page
          .waitForLoadState("networkidle", { timeout: 5000 })
          .catch(() => {});
        if (remote) {
          await page.screenshot({
            path: join(out, `verification/raw-shopify-${kind}-${width}.png`),
            fullPage: true,
            animations: "disabled",
          });
          await page.addStyleTag({
            content: "#PBarNextFrame{display:none!important}",
          });
        }
        const file = `verification/${remote ? "shopify-" : ""}${kind}-${width}.png`;
        await page.screenshot({
          path: join(out, file),
          fullPage: true,
          animations: "disabled",
        });
        const source = requireSourceScreenshot(
          ir.pages.find((p) => p.kind === kind)?.screenshots,
          kind,
          width,
        );
        let percent: number | null = null;
        let diffPath: string | null = null;
        try {
          const a = await sharp(join(out, source))
            .extract({ left: 0, top: 0, width, height })
            .ensureAlpha()
            .raw()
            .toBuffer();
          const b = await sharp(join(out, file))
            .extract({ left: 0, top: 0, width, height })
            .ensureAlpha()
            .raw()
            .toBuffer();
          const diff = Buffer.alloc(width * height * 4);
          const count = pixelmatch(a, b, diff, width, height, { threshold: 0.1 });
          percent = Number(((count / (width * height)) * 100).toFixed(2));
          diffPath = `verification/diff-${remote ? "shopify-" : ""}${kind}-${width}.png`;
          await sharp(diff, { raw: { width, height, channels: 4 } })
            .png()
            .toFile(join(out, diffPath));
        } catch (e) {
          result.errors.push("Screenshot diff: " + String(e));
        }
        result.screenshots.push({
          kind,
          width,
          source,
          target: file,
          diff: diffPath,
          topDiffPercent: percent,
        });
      }
    }
    const url = new URL(base);
    if (productPath) {
      url.pathname = productPath;
      url.searchParams.delete("view");
    } else url.searchParams.set("view", "s2s-product");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigateForVerification(page, url.href, !!remote);
    await page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});
    result.functional.productHeading =
      (await page.locator("#product-content-area h1").count()) === 1;
    result.functional.initialControlsInViewport = await page
      .locator('[data-step="1"]')
      .evaluate((el) => el.getBoundingClientRect().top < 1000);
    const thumb = page.locator(".thumbs-splide .splide__slide").nth(1);
    await thumb.click();
    await page.waitForTimeout(600);
    result.functional.gallerySynced = await page
      .locator(".main-splide .splide__slide")
      .nth(1)
      .evaluate((el) => el.classList.contains("is-active"));
    const next = page.locator('[data-step="1"] [data-show-step="2"]');
    await next.click();
    result.functional.step2 = await page.locator('[data-step="2"]').isVisible();
    await page.locator('[data-step="2"] [data-show-step="3"]').click();
    result.functional.step3 = await page.locator('[data-step="3"]').isVisible();
    await page.locator('[data-step="3"] [data-show-step="2"]').click();
    result.functional.back = await page.locator('[data-step="2"]').isVisible();
    const faq = page.locator('.faq button[data-bs-toggle="collapse"]').last();
    if (await faq.count()) {
      await faq.click();
      const target = await faq.getAttribute("data-bs-target");
      result.functional.faqExpanded =
        (await faq.getAttribute("aria-expanded")) === "true";
    }
    result.functional.noUnexpectedPageErrors = result.errors.length === 0;
    result.functional.durableUploads = false;
    result.functional.orders = false;
    const passed =
      result.functional.productHeading &&
      result.functional.initialControlsInViewport &&
      result.functional.gallerySynced &&
      result.functional.step2 &&
      result.functional.step3 &&
      result.functional.back &&
      result.functional.faqExpanded &&
      result.functional.noUnexpectedPageErrors;
    result.passed = !!passed;
    if (remote) ir.status.shopifyVerified = !!passed;
    else ir.status.localVerified = !!passed;
  } catch (e) {
    result.errors.push(String(e));
  } finally {
    await browser.close();
    await new Promise<void>((r) =>
      local ? local.server.close(() => r()) : r(),
    );
  }
  result.outboundRequests = [...new Set(result.outboundRequests)];
  await json(join(out, `verification-${result.mode}.json`), result);
  await json(join(out, "verification.json"), result);
  await json(join(out, "site-ir.json"), ir);
  await report(out);
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        passed: result.passed,
        functional: result.functional,
        errors: result.errors,
        screenshots: result.screenshots.map((s: any) => ({
          kind: s.kind,
          width: s.width,
          diff: s.topDiffPercent,
        })),
      },
      null,
      2,
    ),
  );
  return result;
}
