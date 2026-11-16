import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const store = process.argv[2] || "https://azhiip-13.myshopify.com";
const themeId = process.argv[3] || "189590896839";
const password = process.argv[4] || "";
const outDir = resolve(process.argv[5] || "../westandwillow-phase3/diagnostics/footer-navigation-online");
const retained = [
  "/collections/all",
  "/pages/custom-pet-portraits",
  "/products/custom-pet-portrait-mug",
  "/products/custom-pet-portrait-phone-cases",
  "/products/custom-pet-blanket",
  "/pages/custom-memorial-pet-portrait",
  "/products/pet-greeting-cards",
  "/collections/quote-signs",
  "/products/gift-card",
  "/products/custom-horse-portrait",
  "/pages/custom-cat-portraits",
];
const removed = ["/products/custom-pet-bowl", "/products/throw-pillow"];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const start = new URL("/products/custom-one-pet-portrait", store);
    start.searchParams.set("preview_theme_id", themeId);
    await page.goto(start.href, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname === "/password") {
      await page.locator('input[type="password"]').fill(password);
      await page.locator('form[action$="/password"] button[type="submit"], form[action$="/password"] input[type="submit"]').first().click();
      await page.waitForLoadState("domcontentloaded");
      await page.goto(start.href, { waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(500);
    const footer = page.locator("footer").last();
    await footer.scrollIntoViewIfNeeded();
    const footerPaths = await footer.locator("a[href]").evaluateAll((links) => links.map((link) => {
      try { return new URL((link as HTMLAnchorElement).href).pathname.replace(/\/$/, "") || "/"; }
      catch { return ""; }
    }));
    await footer.screenshot({ path: resolve(outDir, `${viewport.name}-footer.png`) });
    const probes = [];
    for (const expectedPath of retained) {
      const url = new URL(expectedPath, store);
      url.searchParams.set("preview_theme_id", themeId);
      const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      probes.push(await page.evaluate(({ expectedPath, status }) => {
        const final = new URL(location.href);
        const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || "";
        const body = document.body.innerText.slice(0, 1500);
        return {
          expectedPath,
          status,
          finalPath: final.pathname,
          canonicalPath: canonical ? new URL(canonical).pathname : "",
          challenge: final.pathname === "/password" || /enter using password|verify you are human|captcha/i.test(body),
          soft404: /404|page not found|couldn.t find the page/i.test(`${document.title}\n${body}`),
        };
      }, { expectedPath, status: response?.status() || 0 }));
    }
    const missingRetained = retained.filter((path) => !footerPaths.includes(path));
    const presentRemoved = removed.filter((path) => footerPaths.includes(path));
    const passed = !missingRetained.length && !presentRemoved.length && probes.every((probe) =>
      probe.status === 200 && probe.finalPath === probe.expectedPath && probe.canonicalPath === probe.expectedPath && !probe.challenge && !probe.soft404
    );
    results.push({ viewport, passed, missingRetained, presentRemoved, probes });
    await context.close();
  }
} finally {
  await browser.close();
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), store, themeId, passed: results.every((result) => result.passed), results };
await writeFile(resolve(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
