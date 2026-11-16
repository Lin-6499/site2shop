import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "../src/preview.js";
import { readJson, json } from "../src/util.js";
import { assertGeneratedThemeIntegrity } from "../src/theme-integrity.js";

const out = resolve(process.argv[2] || "../westandwillow-phase3");
const output = join(out, "diagnostics/scroll-all-families-20261022");
await mkdir(output, { recursive: true });
const build = await assertGeneratedThemeIntegrity(out);
const binding = await readJson<any>(join(out, "phase3-product-template-binding.json"));
const contract = await readJson<any>(join(out, "product-scroll-contracts.json"));
const source = await readJson<any>(join(out, contract.evidence));
const sourceModes = new Map<string, string>();
for (const [mode, handles] of Object.entries(source.groups) as [string, string[]][]) {
  assert.ok(["bounded-gallery", "document-flow"].includes(mode), "Unknown source scroll mode");
  for (const handle of handles) {
    assert.ok(!sourceModes.has(handle), `Duplicate source route: ${handle}`);
    sourceModes.set(handle, mode);
  }
}
assert.equal(sourceModes.size + source.invalid.length, binding.products.length, "Source inventory coverage");
for (const product of binding.products) {
  assert.ok(sourceModes.has(product.handle) || source.invalid.includes(product.handle), `Missing source route: ${product.handle}`);
}
const { server, url } = await serve(out);
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage();
const results: any[] = [];
const near = (a: number, b: number, message: string) => assert.ok(Math.abs(a - b) < 2, `${message}: ${a} != ${b}`);
try {
  for (const product of binding.products) {
    const template = await readJson<any>(join(out, `theme/templates/product.${product.templateSuffix}.json`));
    const section = template.sections.main.type;
    const expectedMode = contract.overrides[section]?.[product.handle] || contract.defaultsBySuffix[product.templateSuffix];
    assert.ok(expectedMode, `Missing source mode for ${product.handle}`);
    if (sourceModes.has(product.handle)) assert.equal(expectedMode, sourceModes.get(product.handle), `Generated contract differs from source: ${product.handle}`);
    else assert.ok(contract.unverifiedSourceRoutes.includes(product.handle), `Unverified source route not declared: ${product.handle}`);
    await page.goto(`${url}/preview/products/${product.handle}.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('[data-family-slide="0"] img,[data-portrait-slide="0"] img');
      return !img || (img.complete && img.naturalWidth > 0);
    }, undefined, { timeout: 30000 });
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const result: any = { handle: product.handle, suffix: product.templateSuffix, section, viewport, expectedMode, sourceVerified: !contract.unverifiedSourceRoutes.includes(product.handle), passed: false, samples: [] };
      results.push(result);
      try {
        await page.setViewportSize(viewport);
        await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const read = () => page.evaluate(() => {
          const r = document.querySelector<HTMLElement>("[data-s2s-scroll-mode]")!;
          const g = r.querySelector<HTMLElement>(".s2s-family-gallery,.s2s-portrait-gallery")!;
          const d = r.querySelector<HTMLElement>(".s2s-family-details,.s2s-portrait-details")!;
          const style = getComputedStyle(r);
          return { mode: r.dataset.s2sScrollMode, y: scrollY, root: r.getBoundingClientRect().toJSON(), gallery: g.getBoundingClientRect().toJSON(), details: d.getBoundingClientRect().toJSON(), pt: parseFloat(style.paddingTop), pb: parseFloat(style.paddingBottom), gap: parseFloat(style.rowGap), gp: getComputedStyle(g).position, dp: getComputedStyle(d).position, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
        });
        const initial = await read();
        result.samples.push(initial);
        const desktop = viewport.width >= 992;
        const pinned = desktop && expectedMode === "bounded-gallery";
        assert.equal(initial.mode, expectedMode);
        assert.equal(initial.dp, "static");
        assert.equal(initial.gp, pinned ? "sticky" : "static");
        assert.equal(initial.overflow, false, "horizontal page overflow");
        const naturalHeight = initial.pt + initial.pb + (desktop ? Math.max(initial.gallery.height, initial.details.height) : initial.gallery.height + initial.details.height + initial.gap);
        near(initial.root.height, naturalHeight, "natural containing block height");
        for (const y of [100, 250, 600, 1200, 2200, 1200, 600, 250, 0]) {
          await page.evaluate(y => scrollTo(0, y), y);
          const s = await read();
          result.samples.push(s);
          near(s.details.top - s.root.top, initial.details.top - initial.root.top, "details document-flow");
          near(s.root.height, naturalHeight, "no artificial runway");
          near(s.gallery.top, pinned ? Math.min(Math.max(20, s.root.top + s.pt), s.root.bottom - s.pb - s.gallery.height) : s.root.top + initial.gallery.top - initial.root.top, "gallery scroll bounds");
          if (!desktop) assert.ok(s.details.top >= s.gallery.bottom - 1, "stacked overlap");
        }
        result.passed = true;
      } catch (error) {
        result.error = String(error);
      }
    }
    console.log(`${product.handle}: ${results.slice(-3).filter(x => x.passed).length}/3`);
  }
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await json(join(output, "local-generated-scroll.json"), { schemaVersion: 1, scope: "local-generated-column-scroll-only", notShopifyRuntime: true, notFullSiteAcceptance: true, themeBuild: build.actual, checkedAt: new Date().toISOString(), results, passed: results.length === binding.products.length * 3 && results.every(r => r.passed) });
}
assert.equal(results.length, binding.products.length * 3);
assert.equal(results.filter(r => !r.passed).length, 0, "See local-generated-scroll.json for failures");
