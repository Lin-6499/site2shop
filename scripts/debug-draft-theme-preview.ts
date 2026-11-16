import { chromium } from "playwright";
import { join, resolve } from "node:path";
import { readJson } from "../src/util.js";

const out = resolve(process.argv[2] || "../haroldhome-replication-20261022-v2");
const previews = await readJson<any>(join(out, "target-product-preview-urls.json"));
const handle = "custom-house-portrait";
const original = new URL(previews.urls[handle]);
const previewKey = original.searchParams.get("preview_key");
const themeId = String(previews.themeId);
const candidates = [
  original.href,
  `https://${previews.store}/products/${handle}?preview_key=${previewKey}&preview_theme_id=${themeId}`,
  `https://${previews.store}/products_preview?preview_key=${previewKey}&preview_theme_id=${themeId}`,
  `${original.origin}/products/${handle}?preview_key=${previewKey}&preview_theme_id=${themeId}`,
];

const browser = await chromium.launch({ headless: true });
for (const candidate of candidates) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (new URL(page.url()).pathname === "/password" && process.env.SITE2SHOP_STOREFRONT_PASSWORD) {
    const input = page.locator('input[type="password"]').first();
    if (await input.count()) {
      await input.fill(process.env.SITE2SHOP_STOREFRONT_PASSWORD);
      await Promise.all([
        page.waitForLoadState("domcontentloaded"),
        page.locator('button[type="submit"], input[type="submit"]').first().click(),
      ]);
      await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
  }
  await page.waitForTimeout(2500);
  const result = await page.evaluate(() => ({
    finalUrl: location.href,
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || null,
    title: document.title,
    bodyClass: document.body.className,
    templateSections: Array.from(document.querySelectorAll('[id^="shopify-section-template"]')).slice(0, 5).map((node) => node.id),
    haroldSection: Boolean(document.querySelector('[data-s2s-harold-family]')),
    mainText: document.querySelector('[id^="shopify-section-template"][id$="__main"]')?.textContent?.replace(/\s+/g, " ").trim().slice(0, 800) || null,
    stylesheets: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map((node) => node.href).filter((href) => href.includes("harold") || href.includes("s2s")),
    password: Boolean(document.querySelector('form[action*="/password"]')),
  }));
  console.log(JSON.stringify({ candidate, ...result }, null, 2));
  await context.close();
}
await browser.close();
