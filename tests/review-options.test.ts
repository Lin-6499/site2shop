import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Liquid } from "liquidjs";
import { load } from "cheerio";
import { chromium } from "playwright";
import { buildPageReviewAdapter } from "../src/page-review-theme.js";
import { looxRatingSnippet } from "../src/loox-theme.js";
import { familyProductSections, familyProductScript, familyProductStyles, familyVariantSyncScript } from "../src/family-product-theme.js";

const stripDoc = (s: string) => s.replace(/{%[-]?\s*doc\s*[-]?%}[\s\S]*?{%[-]?\s*enddoc\s*[-]?%}/g, "");
const products = [{ kind: "product", handle: "source-pet", sourceSnapshot: { id: 101 } }];
const plan = [{ handle: "source-pet", input: { handle: "target-pet" } }];
const summary = '<a class="loox-rating mb-2" data-id="101" data-rating="4.9" data-raters="19191"><b>★★★★★</b>(19,191)</a>';

async function renderBody(body: string, allProducts: object) {
  const adapter = buildPageReviewAdapter([{ handle: "landing", input: { body } }], products, plan);
  const dir = await mkdtemp(join(tmpdir(), "s2s-page-rating-"));
  try {
    await writeFile(join(dir, "s2s-page-rating-product.liquid"), stripDoc(adapter.mapping));
    await writeFile(join(dir, "s2s-product-rating.liquid"), stripDoc(looxRatingSnippet));
    const engine = new Liquid({ root: dir, extname: ".liquid", globals: { all_products: allProducts } });
    return await engine.parseAndRender(stripDoc(adapter.content), { page: { content: body } });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const targetProduct = { id: 909, url: "/products/target-pet", metafields: { loox: { avg_rating: 3, num_reviews: 2 } } };

test("landing rating uses target data in its original position and never reuses source totals", async () => {
  const html = await renderBody(`<h1>Portrait</h1>${summary}<p>From $77</p>`, { "target-pet": targetProduct });
  const $ = load(html, null, false);
  assert.equal($("[data-s2s-product-rating]").attr("data-id"), "909");
  assert.equal($("[data-s2s-product-rating]").attr("data-rating"), "3");
  assert.equal($("[data-s2s-product-rating]").attr("data-raters"), "2");
  assert.equal($("h1").next().attr("data-s2s-page-rating"), "");
  assert.equal($("a").attr("href"), "/products/target-pet#looxReviewsFrame");
  assert.ok(!html.includes("19191") && !html.includes("19,191") && !html.includes('data-id="101"'));
  for (const product of [{ id: 909 }, { ...targetProduct, metafields: { loox: { avg_rating: 3, num_reviews: 0 } } }]) {
    const empty = await renderBody(`${summary}<footer>End</footer>`, { "target-pet": product });
    assert.ok(!empty.includes("data-s2s-product-rating") && !empty.includes("19,191"));
    assert.ok(empty.includes("<footer>End</footer>"));
  }
  const standard = await renderBody(summary, { "target-pet": { ...targetProduct, metafields: { reviews: { rating: { value: { rating: 4.5 } }, rating_count: { value: 7 } } } } });
  assert.equal(load(standard)("[data-s2s-product-rating]").attr("data-raters"), "7");
});

test("page adapter preserves long imported bodies, ordinary anchors, article tags and empty pages", async () => {
  const links = Array.from({ length: 160 }, (_, i) => `<a href="/pages/p-${i}">Link ${i}</a>`).join("");
  const body = `<article><aside>Start</aside>${links}${summary}<footer>End</footer></article>`;
  const html = await renderBody(body, { "target-pet": targetProduct });
  const $ = load(html, null, false);
  assert.equal($("a[href^='/pages/p-']").length, 160);
  assert.equal($("[data-s2s-page-rating]").length, 1);
  assert.equal($("article footer").text(), "End");
  assert.equal($("aside").text(), "Start");
  assert.equal(await renderBody("", {}), "");
  const singleQuotes = summary.replaceAll('"', "'");
  assert.equal(load(await renderBody(singleQuotes, { "target-pet": targetProduct }))("[data-s2s-product-rating]").attr("data-id"), "909");
});

test("unsupported review references fail generation instead of retaining source proof", () => {
  assert.throws(() => buildPageReviewAdapter([{ handle: "bad", input: { body: summary.replace("101", "999") } }], products, plan), /unmapped/);
  assert.throws(() => buildPageReviewAdapter([{ handle: "bad", input: { body: summary.replaceAll("<a", "<div").replaceAll("</a>", "</div>") } }], products, plan), /unsupported/);
});

test("all imported landing summaries resolve to target handles without truncating content", async () => {
  const out = resolve("../westandwillow-phase3");
  const pages = JSON.parse(await readFile(join(out, "phase3-page-plan.json"), "utf8")).pages;
  const records = JSON.parse(await readFile(join(out, "phase3-content-plan.json"), "utf8")).records;
  const plans = JSON.parse(await readFile(join(out, "phase3-product-plan.json"), "utf8")).products;
  const adapter = buildPageReviewAdapter(pages, records, plans);
  assert.ok(adapter.coverage.length > 0);
  const dir = await mkdtemp(join(tmpdir(), "s2s-imported-page-rating-"));
  try {
    await writeFile(join(dir, "s2s-page-rating-product.liquid"), stripDoc(adapter.mapping));
    await writeFile(join(dir, "s2s-product-rating.liquid"), stripDoc(looxRatingSnippet));
    const allProducts = Object.fromEntries(plans.map((p: any, i: number) => [p.input?.handle || p.handle, { ...targetProduct, id: 900000 + i }]));
    const engine = new Liquid({ root: dir, extname: ".liquid", globals: { all_products: allProducts } });
    for (const page of pages.filter((p: any) => adapter.coverage.some(c => c.handle === p.handle))) {
      const before = load(page.input.body, null, false);
      const html = await engine.parseAndRender(stripDoc(adapter.content), { page: { content: page.input.body } });
      const after = load(html, null, false);
      assert.equal(after("[data-s2s-product-rating]").length, before(".loox-rating").length, page.handle);
      assert.equal(after("a").not(".s2s-rating-link").length, before("a").not(".loox-rating").length, page.handle);
      assert.equal(after("img").length, before("img").length, page.handle);
      assert.equal(after("section").length, before("section").length, page.handle);
      assert.ok(after("[data-s2s-product-rating]").toArray().every(el => after(el).attr("data-raters") === "2"), page.handle);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function phoneMarkup(override?: object) {
  const variants = [
    { id: 110, options: ["iPhone", "iPhone 14"], price: 3500, available: true },
    { id: 111, options: ["iPhone", "iPhone 15"], price: 3900, available: true },
    { id: 120, options: ["Samsung", "Galaxy S10"], price: 4000, available: true },
    { id: 121, options: ["Samsung", "Galaxy S9"], price: 3800, available: true },
    { id: 122, options: ["Samsung", "Galaxy S8"], price: 3700, available: false },
    { id: 130, options: ["Unavailable brand", "Unavailable model"], price: 3700, available: false },
  ];
  const product = { title: "Local test phone case", images: [], variants, selected_or_first_available_variant: variants[0],
    options_with_values: [
      { name: "Phone Make:", position: 1, values: ["iPhone", "Samsung", "Unavailable brand"], selected_value: "iPhone" },
      { name: "Phone Model:", position: 2, values: ["iPhone 14", "iPhone 15", "Galaxy S9", "Galaxy S10", "Galaxy S8", "Unavailable model"], selected_value: "iPhone 14" },
    ] };
  const engine = new Liquid();
  engine.registerFilter("json", JSON.stringify);
  engine.registerFilter("money", v => "$" + (v / 100).toFixed(2));
  engine.registerFilter("stylesheet_tag", () => "");
  const markup = familyProductSections["s2s-phone-product"]
    .replace(/{% schema %}[\s\S]*?{% endschema %}/g, "")
    .replace(/{% content_for[^%]*%}|{% render[^%]*%}/g, "")
    .replace(/{% form[^%]*%}/g, '<form class="s2s-family-form">')
    .replace(/{% endform %}/g, "</form>")
    .replace(/<script src=[^>]*><\/script>/g, "");
  return engine.parseAndRender(markup, { product: override || product, section: { id: "test" } });
}

test("generated phone dropdown preserves brand compatibility, price and cart variant on all three viewports", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const html = await phoneMarkup();
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${familyProductStyles}</style>${html}`);
      await page.addScriptTag({ content: familyVariantSyncScript });
      await page.addScriptTag({ content: familyProductScript });
      const select = page.getByLabel("Phone Model", { exact: true });
      assert.equal(await select.count(), 1);
      assert.equal(await page.locator('[data-s2s-option-group="1"] input[type="radio"]').count(), 0);
      assert.equal(await select.inputValue(), "iPhone 14");
      assert.equal(await select.locator("option:disabled").count(), 4);
      await page.getByLabel("Samsung", { exact: true }).check();
      assert.equal(await select.inputValue(), "Galaxy S9");
      assert.equal(await page.locator('[name="id"]').inputValue(), "121");
      assert.equal(await page.locator('[data-s2s-price]').textContent(), "$38.00");
      assert.equal(await select.locator("option:enabled").count(), 2);
      await select.selectOption("Galaxy S10");
      assert.equal(await page.locator('[name="id"]').inputValue(), "120");
      assert.equal(await page.locator('[data-s2s-price]').textContent(), "$40.00");
      assert.equal(await page.locator("form").evaluate(f => new FormData(f as HTMLFormElement).get("id")), "120");
      await page.getByLabel("Unavailable brand", { exact: true }).check();
      assert.equal(await select.isDisabled(), true);
      assert.equal(await page.locator('[data-s2s-submit]').isDisabled(), true);
      assert.equal(await page.locator('[name="id"]').inputValue(), "");
      await page.getByLabel("iPhone", { exact: true }).check();
      assert.equal(await select.inputValue(), "iPhone 14");
      assert.equal(await select.isDisabled(), false);
      await select.selectOption("iPhone 15");
      assert.equal(await page.locator('[name="id"]').inputValue(), "111");
      assert.equal(await page.locator('[data-s2s-submit]').isDisabled(), false);
      const box = await select.boundingBox();
      assert.equal(box?.height, 38);
      assert.ok(box && box.width > 100 && box.x + box.width <= viewport.width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("every bound phone product preserves its own option inventory and brand relation at three viewports", async () => {
  const out = resolve("../westandwillow-phase3");
  const templates = JSON.parse(await readFile(join(out, "phase3-product-template-plan.json"), "utf8")).products;
  const products = JSON.parse(await readFile(join(out, "phase3-product-plan.json"), "utf8")).products;
  const consumers = templates.filter((p: any) => p.templateSuffix === "s2s-phone");
  assert.ok(consumers.length > 1);
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const page = await browser.newPage();
    for (const bound of consumers) {
      const input = products.find((p: any) => p.handle === bound.handle).input;
      const variants = input.variants.map((v: any, i: number) => ({ id: 900000 + i, options: v.optionValues.map((o: any) => o.name), price: Number(v.price) * 100, available: true }));
      const product = { title: input.title, images: [], variants, selected_or_first_available_variant: variants[0],
        options_with_values: input.productOptions.map((o: any, i: number) => ({ name: o.name, position: i + 1, values: o.values.map((v: any) => v.name), selected_value: variants[0].options[i] })) };
      const html = await phoneMarkup(product);
      for (const viewport of [{ width: 1920, height: 1080 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${familyProductStyles}</style>${html}`);
        await page.addScriptTag({ content: familyProductScript });
        const select = page.getByLabel("Phone Model", { exact: true });
        assert.equal(await select.locator("option").count(), product.options_with_values[1].values.length, bound.handle);
        assert.equal(await page.locator('[data-s2s-option-group="1"] input').count(), 0, bound.handle);
        for (const brand of product.options_with_values[0].values) {
          await page.getByLabel(brand, { exact: true }).check();
          const enabled = await select.locator("option:enabled").evaluateAll(nodes => nodes.map(n => (n as HTMLOptionElement).value));
          const normalizedBrand = brand.toLowerCase();
          const expected = product.options_with_values[1].values.filter((model: string) => {
            const normalizedModel = model.toLowerCase();
            return normalizedBrand === "samsung" ? /^(?:samsung\s+)?galaxy\b/.test(normalizedModel) : normalizedModel.startsWith(normalizedBrand);
          });
          assert.deepEqual(enabled, expected, bound.handle + ": " + brand);
          for (const model of [enabled[0], enabled.at(-1)]) {
            await select.selectOption(model!);
            const selected = variants.find((v: any) => v.options[0] === brand && v.options[1] === model && (v.options.length < 3 || v.options[2] === product.options_with_values[2].selected_value));
            assert.equal(await page.locator('[name="id"]').inputValue(), selected ? String(selected.id) : "", bound.handle);
          }
        }
        assert.equal(await select.evaluate(el => el.getBoundingClientRect().height), 38, bound.handle);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, bound.handle);
      }
    }
  } finally { await browser.close(); }
});
