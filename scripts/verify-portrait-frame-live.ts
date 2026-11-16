import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.argv[2];
const password = process.argv[3] || "";
const out = resolve(process.argv[4] || "../westandwillow-phase3/portrait-frame-acceptance");
if (!base) throw new Error("Usage: tsx scripts/verify-portrait-frame-live.ts <preview-url> [password] [out]");

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];
const results: unknown[] = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname === "/password") {
      await page.locator('input[type="password"]').fill(password);
      await page.locator('form[action$="/password"] button[type="submit"], form[action$="/password"] input[type="submit"]').first().click();
      await page.waitForLoadState("domcontentloaded");
      await page.goto(base, { waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(2500);
    const expected = new URL(base).pathname;
    if (new URL(page.url()).pathname !== expected) throw new Error(`${viewport.name}: wrong route ${page.url()}`);
    await page.locator('[data-portrait-step="1"] [data-portrait-next]').click();
    const frameGroup = page.locator('.s2s-portrait-frame-styles');
    await frameGroup.waitFor({ state: "visible" });
    const headings = await frameGroup.locator('.s2s-portrait-frame-heading').allTextContents();
    const cards = frameGroup.locator('label[data-s2s-frame-value]');
    const swatchAssets = await cards.locator('.s2s-portrait-frame-swatch').evaluateAll(elements => elements.map(element => {
      const image = element.querySelector('img') as HTMLImageElement | null;
      return image?.currentSrc || image?.src || getComputedStyle(element).backgroundImage;
    }).filter(value => value && value !== 'none'));
    const transitions: unknown[] = [];
    for (const value of ["Black", "White", "Walnut", "Birch"]) {
      const input = frameGroup.locator(`input[value="${value}"]`);
      if (!(await input.count())) continue;
      await frameGroup.locator(`label[data-s2s-frame-value="${value.toLowerCase()}"]`).click();
      await page.waitForTimeout(80);
      transitions.push(await page.evaluate(() => ({
        value: (document.querySelector('.s2s-portrait-frame-styles input:checked') as HTMLInputElement)?.value,
        variantId: (document.querySelector('[data-s2s-variant-id]') as HTMLInputElement)?.value,
        visibleSlide: document.querySelector('[data-portrait-slide]:not([hidden])')?.getAttribute('data-portrait-slide'),
        activeThumb: document.querySelector('[data-portrait-thumb][aria-current="true"]')?.getAttribute('data-portrait-thumb'),
      })));
    }
    const metrics = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      frameCards: document.querySelectorAll('.s2s-portrait-frame-styles label[data-s2s-frame-value]').length,
      gallerySources: [...document.querySelectorAll<HTMLImageElement>('[data-portrait-slide] img')].map(image => image.currentSrc || image.src),
    }));
    await page.screenshot({ path: resolve(out, `${viewport.name}-step-2.png`), fullPage: true });
    await frameGroup.screenshot({ path: resolve(out, `${viewport.name}-frame-options.png`) });
    const uniqueSlides = new Set(transitions.map((item: any) => item.visibleSlide));
    const uniqueVariants = new Set(transitions.map((item: any) => item.variantId));
    const passed = headings.map(value => value.trim()).join("|") === "Classic styles:|Specialty styles:" && swatchAssets.length === 4 && metrics.frameCards === 4 && !metrics.horizontalOverflow && uniqueSlides.size === transitions.length && uniqueVariants.size === transitions.length && transitions.every((item: any) => item.visibleSlide === item.activeThumb);
    results.push({ viewport: viewport.name, passed, headings, swatchAssets, metrics, transitions });
    await context.close();
  }
} finally {
  await browser.close();
}
const report = { passed: results.every((item: any) => item.passed), results };
await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
