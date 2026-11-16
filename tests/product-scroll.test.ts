import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { customProductSection, standardProductSection, familyProductScript, familyProductSections, familyProductStyles } from "../src/family-product-theme.js";
import { portraitSection, portraitStyles } from "../src/portrait-theme.js";
import { applyProductScrollOverrides } from "../src/product-scroll-theme.js";
import { Liquid } from "liquidjs";

const boundedSections = new Set([
  "s2s-accessory-product", "s2s-apparel-product", "s2s-custom-apparel-product",
  "s2s-embroidered-product", "s2s-hat-product", "s2s-jewelry-product",
]);
const sections = {
  ...familyProductSections,
  "s2s-standard-product": standardProductSection,
  "s2s-custom-product": customProductSection,
  "s2s-portrait-product": portraitSection,
};

test("project-owned route exceptions survive generation without merging distinct scroll behaviors", async () => {
  const engine = new Liquid();
  const section = '<section data-s2s-scroll-mode="bounded-gallery" data-s2s-sticky-gallery></section>';
  const generated = applyProductScrollOverrides(section, { "short-form": "document-flow" });
  const short = await engine.parseAndRender(generated, { product: { handle: "short-form" } });
  const long = await engine.parseAndRender(generated, { product: { handle: "long-form" } });
  assert.ok(short.includes('data-s2s-scroll-mode="document-flow"'));
  assert.ok(long.includes('data-s2s-scroll-mode="bounded-gallery"'));
  assert.ok(!short.includes("data-s2s-sticky-gallery"));
  assert.throws(() => applyProductScrollOverrides(section, { "x' %}": "document-flow" }));
  assert.throws(() => applyProductScrollOverrides('<section></section>', { x: "document-flow" }));
});

test("scroll behavior is opt-in and the obsolete information-follow runtime is removed", () => {
  for (const [name, section] of Object.entries(sections)) {
    assert.equal(section.includes("data-s2s-sticky-gallery"), boundedSections.has(name), name);
    assert.equal(section.match(/data-s2s-scroll-mode="([^"]+)"/)?.[1], boundedSections.has(name) ? "bounded-gallery" : "document-flow", name);
    assert.ok(!section.includes("data-s2s-information-follow"), name);
  }
  assert.ok(!familyProductScript.includes("information-follow"));
  assert.ok(!familyProductScript.includes("syncInformationFollow"));
  assert.ok(!familyProductStyles.includes("information-follow-min-height"));
});

test("source details disclosures remain family-specific instead of flattening every description", () => {
  const gift = familyProductSections["s2s-gift-card-product"];
  const quote = familyProductSections["s2s-quote-product"];
  assert.match(standardProductSection, /<details class="s2s-family-description s2s-family-description-disclosure">/);
  assert.match(gift, /<summary>Details<\/summary>/);
  assert.doesNotMatch(quote, /s2s-family-description-disclosure/);
  assert.match(familyProductStyles, /s2s-family-description-disclosure summary/);
});

test("source contract: gallery pins, details flow, natural boundary releases in both directions on all breakpoints", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage();
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} != ${expected}`);
  try {
    for (const viewport of [
      { width: 1920, height: 1080 }, { width: 1920, height: 720 },
      { width: 1200, height: 900 }, { width: 1121, height: 960 },
      { width: 992, height: 960 }, { width: 991, height: 960 },
      { width: 834, height: 1194 }, { width: 768, height: 1024 }, { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${familyProductStyles}</style>
        <header style="height:180px"></header>
        <section class="s2s-family-pdp" data-s2s-family-product data-s2s-sticky-gallery data-s2s-scroll-mode="bounded-gallery">
          <div class="s2s-family-gallery" style="height:780px">Gallery</div>
          <div class="s2s-family-details" style="height:1420px">Details
            <form class="s2s-family-form"><button type="submit" data-s2s-submit>Add</button>
              <script type="application/json" data-s2s-variants>[]</script></form>
          </div>
        </section><footer style="height:1500px"></footer>`);
      await page.addScriptTag({ content: familyProductScript });
      const read = () => page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("[data-s2s-sticky-gallery]")!;
        const gallery = root.querySelector<HTMLElement>(".s2s-family-gallery")!;
        const details = root.querySelector<HTMLElement>(".s2s-family-details")!;
        const style = getComputedStyle(root);
        return {
          y: scrollY, root: root.getBoundingClientRect().toJSON(),
          gallery: gallery.getBoundingClientRect().toJSON(), details: details.getBoundingClientRect().toJSON(),
          paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom),
          gap: parseFloat(style.rowGap), minHeight: style.minHeight,
          galleryPosition: getComputedStyle(gallery).position, detailsPosition: getComputedStyle(details).position,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      const initial = await read();
      const desktop = viewport.width >= 992;
      assert.equal(initial.detailsPosition, "static", JSON.stringify(viewport));
      assert.equal(initial.galleryPosition, desktop ? "sticky" : "static");
      const naturalHeight = initial.paddingTop + initial.paddingBottom +
        (desktop ? 1420 : 780 + 1420 + initial.gap);
      close(initial.root.height, naturalHeight, "no artificial scroll runway");
      assert.equal(initial.overflow, false);
      for (const scroll of [350, 650, 1000, 1700, 1000, 650, 350, 0]) {
        await page.evaluate((y) => scrollTo(0, y), scroll);
        const sample = await read();
        close(sample.details.top + sample.y, initial.details.top + initial.y, "details flow with document");
        const expectedGalleryTop = desktop
          ? Math.min(Math.max(20, sample.root.top + sample.paddingTop), sample.root.bottom - sample.paddingBottom - sample.gallery.height)
          : initial.gallery.top + initial.y - sample.y;
        close(sample.gallery.top, expectedGalleryTop, `gallery ${viewport.width} / ${scroll}`);
        close(sample.root.height, naturalHeight, "scroll does not add blank space");
      }
      // Short forms and a later content expansion must be bounded without a resize observer.
      await page.locator(".s2s-family-details").evaluate((e: HTMLElement) => { e.style.height = "400px"; });
      const short = await read();
      close(short.root.height, short.paddingTop + short.paddingBottom + (desktop ? 780 : 780 + 400 + short.gap), "short form natural height");
      await page.locator(".s2s-family-details").evaluate((e: HTMLElement) => { e.style.height = "1600px"; });
      const expanded = await read();
      close(expanded.root.height, expanded.paddingTop + expanded.paddingBottom + (desktop ? 1600 : 780 + 1600 + expanded.gap), "expanded form natural height");
    }
    await page.setViewportSize({ width: 1200, height: 900 });
    assert.equal(await page.locator(".s2s-family-gallery").evaluate(e => getComputedStyle(e).position), "sticky");
    await page.setViewportSize({ width: 768, height: 1024 });
    assert.equal(await page.locator(".s2s-family-gallery").evaluate(e => getComputedStyle(e).position), "static");
    assert.equal(await page.locator(".s2s-family-details").evaluate(e => getComputedStyle(e).position), "static");
  } finally {
    await browser.close();
  }
});

test("every generated product section preserves its source scroll mode across desktop, tablet, mobile and boundary widths", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage();
  const close = (actual: number, expected: number, label: string) =>
    assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} != ${expected}`);
  try {
    for (const [name, section] of Object.entries(sections)) {
      const kind = name === "s2s-portrait-product" ? "portrait" : "family";
      const mode = section.match(/data-s2s-scroll-mode="([^"]+)"/)?.[1];
      for (const viewport of [{ width: 1920, height: 1080 }, { width: 1121, height: 960 }, { width: 992, height: 960 }, { width: 991, height: 960 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${kind === "family" ? familyProductStyles : portraitStyles}</style>
          <header style="height:180px"></header>
          <section class="s2s-${kind}-pdp" data-s2s-scroll-mode="${mode}">
            <div class="s2s-${kind}-gallery" style="height:600px">Media</div>
            <div class="s2s-${kind}-details" style="height:1300px">Form</div>
          </section><footer style="height:1600px"></footer>`);
        const read = () => page.evaluate((kind) => {
          const r = document.querySelector<HTMLElement>(`.s2s-${kind}-pdp`)!;
          const g = r.querySelector<HTMLElement>(`.s2s-${kind}-gallery`)!;
          const d = r.querySelector<HTMLElement>(`.s2s-${kind}-details`)!;
          const style = getComputedStyle(r);
          return { y: scrollY, r: r.getBoundingClientRect().toJSON(), g: g.getBoundingClientRect().toJSON(), d: d.getBoundingClientRect().toJSON(), pt: parseFloat(style.paddingTop), pb: parseFloat(style.paddingBottom), gap: parseFloat(style.rowGap), gp: getComputedStyle(g).position, dp: getComputedStyle(d).position, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
        }, kind);
        const initial = await read();
        const columns = viewport.width >= 992;
        const pinned = columns && boundedSections.has(name);
        assert.equal(initial.dp, "static", name);
        assert.equal(initial.gp, pinned ? "sticky" : "static", name);
        assert.equal(initial.overflow, false, name);
        for (const y of [100, 250, 600, 1400, 2600, 1400, 600, 250, 100, 0]) {
          await page.evaluate(y => scrollTo(0, y), y);
          const s = await read();
          close(s.d.top - s.r.top, initial.d.top - initial.r.top, `${name}: details stay in document flow`);
          close(s.g.top, pinned ? Math.min(Math.max(20, s.r.top + s.pt), s.r.bottom - s.pb - s.g.height) : initial.g.top + initial.y - s.y, `${name}: gallery mode`);
          close(s.r.height, s.pt + s.pb + (columns ? 1300 : 1900 + s.gap), `${name}: no added runway`);
          if (!columns) assert.ok(s.d.top >= s.g.bottom, `${name}: stacked form is not covered`);
        }
        // A wrong-column regression must fail even if all markers remain present.
        await page.addStyleTag({ content: `.s2s-${kind}-details{position:sticky!important;top:20px!important}` });
        const broken = await read();
        assert.throws(() => assert.equal(broken.dp, "static"), `${name}: negative sticky-details regression`);
      }
    }
  } finally {
    await browser.close();
  }
});
