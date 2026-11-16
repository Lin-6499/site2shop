import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceOrigin = process.argv[2] || "https://westandwillow.com";
const targetOrigin = process.argv[3] || "https://azhiip-13.myshopify.com";
const themeId = process.argv[4] || "189590896839";
const password = process.argv[5] || "";
const outDir = resolve(process.argv[6] || "../westandwillow-phase3/diagnostics/footer-landing-pages");
const routes = [
  "/pages/custom-pet-portraits",
  "/pages/custom-memorial-pet-portrait",
  "/pages/custom-cat-portraits",
];
const reviewWidgetRoutes = new Set([
  "/pages/custom-pet-portraits",
  "/pages/custom-memorial-pet-portrait",
]);
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const metrics = async (page: Page, expectedPath: string, role: "source" | "target") =>
  await page.evaluate(({ expectedPath, role }) => {
    const final = new URL(location.href);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || "";
    const body = document.body.innerText.slice(0, 2000);
    const main = document.querySelector("main");
    const routeRoot = role === "target" ? document.querySelector('[data-s2s-page-family="rendered-layout"]') : main;
    const mainBox = main?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;
    const rootBox = routeRoot?.getBoundingClientRect();
    const rootStyle = routeRoot ? getComputedStyle(routeRoot) : null;
    return {
      expectedPath,
      finalPath: final.pathname,
      canonicalPath: canonical ? new URL(canonical).pathname : "",
      challenge: final.pathname === "/password" || /enter using password|verify you are human|captcha/i.test(body),
      soft404: /404|page not found|couldn.t find the page/i.test(`${document.title}\n${body}`),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: mainBox && mainStyle ? { x: mainBox.x, y: mainBox.y, width: mainBox.width, height: mainBox.height, maxWidth: mainStyle.maxWidth, paddingLeft: mainStyle.paddingLeft, paddingRight: mainStyle.paddingRight, overflowX: mainStyle.overflowX } : null,
      routeRoot: rootBox && rootStyle ? { x: rootBox.x, y: rootBox.y, width: rootBox.width, height: rootBox.height, maxWidth: rootStyle.maxWidth, paddingLeft: rootStyle.paddingLeft, paddingRight: rootStyle.paddingRight, overflowX: rootStyle.overflowX } : null,
      sections: routeRoot?.querySelectorAll("section,article,[id^='shopify-section-'],.shopify-section").length || 0,
      directChildren: routeRoot?.children.length || 0,
      marker: document.querySelector('[data-s2s-page-family]')?.getAttribute('data-s2s-page-family') || "",
      rteAncestor: Boolean(routeRoot?.closest('.rte,.s2s-rte')),
      review: {
        widgets: document.querySelectorAll('#looxReviews').length,
        slots: document.querySelectorAll('[data-s2s-page-review-slot]').length,
        mounted: Boolean(document.querySelector('[data-s2s-page-review-mounted="true"] #looxReviews')),
        frames: document.querySelectorAll('#looxReviewsFrame').length,
        frameHeight: document.querySelector<HTMLIFrameElement>('#looxReviewsFrame')?.getBoundingClientRect().height || 0,
        frameOrigin: (() => { const src = document.querySelector<HTMLIFrameElement>('#looxReviewsFrame')?.src; return src ? new URL(src).origin : ""; })(),
        sourceReviewEntities: role === "target" ? document.querySelectorAll('[data-s2s-source-review-entity]').length : 0,
      },
    };
  }, { expectedPath, role });

const hydrateLazyContent = async (page: Page, viewportHeight: number) => {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += Math.max(300, Math.floor(viewportHeight * 0.7))) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(70);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const results = [];
try {
  for (const viewport of viewports) {
    const sourceContext = await browser.newContext({ viewport });
    const targetContext = await browser.newContext({ viewport });
    const source = await sourceContext.newPage();
    const target = await targetContext.newPage();
    for (const path of routes) {
      await source.goto(new URL(path, sourceOrigin).href, { waitUntil: "domcontentloaded" });
      await source.waitForTimeout(1800);
      const dismiss = source.getByText(/no,? i don.t like discounts|no thanks|close/i).last();
      if (await dismiss.count()) await dismiss.click({ timeout: 1200 }).catch(() => {});
      await source.keyboard.press("Escape").catch(() => {});
      await source.locator('#attentive_overlay,#attentive_creative').evaluateAll((elements) => elements.forEach((element) => element.remove()));
      await source.evaluate(() => { document.documentElement.style.overflow = "auto"; document.body.style.overflow = "auto"; });
      await source.waitForTimeout(250);
      const targetUrl = new URL(path, targetOrigin);
      targetUrl.searchParams.set("preview_theme_id", themeId);
      await target.goto(targetUrl.href, { waitUntil: "domcontentloaded" });
      if (new URL(target.url()).pathname === "/password") {
        await target.locator('input[type="password"]').fill(password);
        await target.locator('form[action$="/password"] button[type="submit"], form[action$="/password"] input[type="submit"]').first().click();
        await target.waitForLoadState("domcontentloaded");
        await target.goto(targetUrl.href, { waitUntil: "domcontentloaded" });
      }
      await target.waitForTimeout(1000);
      await target.locator('iframe#preview-bar-iframe, iframe[src*="preview_bar"]').evaluateAll((elements) => elements.forEach((element) => element.remove()));
      await hydrateLazyContent(source, viewport.height);
      await hydrateLazyContent(target, viewport.height);
      const handle = path.split("/").at(-1)!;
      const sourceMetrics = await metrics(source, path, "source");
      const targetMetrics = await metrics(target, path, "target");
      await source.screenshot({ path: resolve(outDir, `${handle}-${viewport.name}-source.png`), fullPage: true });
      await target.screenshot({ path: resolve(outDir, `${handle}-${viewport.name}-target.png`), fullPage: true });
      const expectsReviewWidget = reviewWidgetRoutes.has(path);
      const reviewPass = expectsReviewWidget
        ? sourceMetrics.review.widgets === 1 && sourceMetrics.review.frames === 1 && sourceMetrics.review.frameHeight > 0 && targetMetrics.review.widgets === 1 && targetMetrics.review.mounted && targetMetrics.review.slots === 0 && targetMetrics.review.frames === 1 && targetMetrics.review.frameHeight > 0 && targetMetrics.review.frameOrigin === "https://loox.io"
        : sourceMetrics.review.widgets === 0 && targetMetrics.review.widgets === 0 && targetMetrics.review.slots === 0;
      const structuralPass = targetMetrics.finalPath === path && targetMetrics.canonicalPath === path && !targetMetrics.challenge && !targetMetrics.soft404 && targetMetrics.marker === "rendered-layout" && !targetMetrics.rteAncestor && targetMetrics.horizontalOverflow <= 1 && reviewPass;
      results.push({ path, viewport, structuralPass, source: sourceMetrics, target: targetMetrics });
    }
    await sourceContext.close();
    await targetContext.close();
  }
} finally {
  await browser.close();
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceOrigin, targetOrigin, themeId, structuralPass: results.every((result) => result.structuralPass), visualStatus: "pending-agent-review", results };
await writeFile(resolve(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.structuralPass) process.exitCode = 1;
