import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const store = process.argv[2] || "https://azhiip-13.myshopify.com";
const themeId = process.argv[3] || "189590896839";
const password = process.argv[4] || "";
const out = resolve(process.argv[5] || "../westandwillow-phase3/diagnostics/footer-shop-route-audit.json");
const routes = [
  ["Shop All Products", "/collections/all"],
  ["Custom Pet Portraits", "/pages/custom-pet-portraits"],
  ["Mugs", "/products/custom-pet-portrait-mug"],
  ["Custom Pet Bowl", "/products/custom-pet-bowl"],
  ["Phone Cases", "/products/custom-pet-portrait-phone-cases"],
  ["Custom Pet Blanket", "/products/custom-pet-blanket"],
  ["Throw Pillow", "/products/throw-pillow"],
  ["Memorial Pet Portrait", "/pages/custom-memorial-pet-portrait"],
  ["Pet Portrait Greeting Cards", "/products/pet-greeting-cards"],
  ["Quote Signs", "/collections/quote-signs"],
  ["Gift Card", "/products/gift-card"],
  ["Custom Horse Portraits", "/products/custom-horse-portrait"],
  ["Custom Cat Portraits", "/pages/custom-cat-portraits"],
] as const;

await mkdir(resolve(out, ".."), { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const first = new URL(routes[0][1], store);
first.searchParams.set("preview_theme_id", themeId);
await page.goto(first.href, { waitUntil: "domcontentloaded" });
if (new URL(page.url()).pathname === "/password" && password) {
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form[action$="/password"] button[type="submit"], form[action$="/password"] input[type="submit"]').first().click();
  await page.waitForLoadState("domcontentloaded");
}

const results = [];
for (const [label, path] of routes) {
  const url = new URL(path, store);
  url.searchParams.set("preview_theme_id", themeId);
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  results.push(await page.evaluate(({ label, expectedPath, status }) => {
    const final = new URL(location.href);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || "";
    const text = document.body.innerText.slice(0, 4000);
    const challenge = final.pathname === "/password" || /enter using password|verify you are human|captcha/i.test(text);
    const soft404 = /404|page not found|couldn.t find the page/i.test(`${document.title}\n${text.slice(0, 1000)}`);
    return {
      label,
      expectedPath,
      requestedUrl: location.origin + expectedPath,
      finalUrl: location.href,
      finalPath: final.pathname,
      canonical,
      status,
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() || "",
      challenge,
      soft404,
      correctPath: final.pathname === expectedPath,
      pageFamilyMarker: document.querySelector('[data-s2s-page-family]')?.getAttribute('data-s2s-page-family') || "",
      generatedMain: Boolean(document.querySelector('[data-s2s-page-family], .s2s-family-pdp, .s2s-portrait-pdp, .s2s-collection-page')),
    };
  }, { label, expectedPath: path, status: response?.status() || 0 }));
}
await browser.close();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  store,
  themeId,
  routes: results,
  reachable: results.filter(item => item.status === 200 && item.correctPath && !item.challenge && !item.soft404).length,
  total: results.length,
};
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
