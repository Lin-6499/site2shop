import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { familyProductScript, familyProductStyles } from "../src/family-product-theme.js";
import { portraitProductScript, productGalleryScript } from "../src/product-gallery-theme.js";

test("family gallery hides its track and purchase controls remain aligned responsively", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.setContent(`<style>${familyProductStyles}</style><section data-s2s-family-product><div class="s2s-family-gallery" style="width:748px">${Array.from({ length: 8 }, (_, index) => `<figure data-family-slide="${index}"${index ? " hidden" : ""}></figure>`).join("")}<div class="s2s-family-thumbs-viewport" data-family-thumbs-viewport><div class="s2s-family-thumbs" data-family-thumbs-track>${Array.from({ length: 8 }, (_, index) => `<button class="s2s-family-thumb${index === 0 ? " is-active" : ""}" data-family-thumb="${index}"></button>`).join("")}</div></div></div><form class="s2s-family-form" style="width:486px"><div class="s2s-family-purchase"><label class="visually-hidden" for="q">Quantity</label><input id="q" name="quantity" type="number" value="1"><button type="submit" data-s2s-submit>Add to cart</button></div></form></section>`);
    await page.addScriptTag({ content: productGalleryScript });
    await page.addScriptTag({ content: familyProductScript });
    const desktop = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>("[data-family-thumbs-viewport]")!;
      const items = [...document.querySelectorAll<HTMLElement>("[data-family-thumb]")];
      const quantity = document.querySelector<HTMLElement>('input[name="quantity"]')!;
      const submit = document.querySelector<HTMLElement>('[data-s2s-submit]')!;
      return { overflow: getComputedStyle(viewport).overflowX, widths: items.slice(0, 5).map((item) => item.getBoundingClientRect().width), sixthLeft: items[5].getBoundingClientRect().left, viewportRight: viewport.getBoundingClientRect().right, quantity: quantity.getBoundingClientRect(), submit: submit.getBoundingClientRect() };
    });
    assert.equal(desktop.overflow, "hidden");
    assert.equal(desktop.widths.length, 5);
    assert.ok(desktop.widths.every((width) => Math.abs(width - desktop.widths[0]) < 0.1));
    assert.ok(desktop.sixthLeft >= desktop.viewportRight);
    assert.equal(desktop.quantity.height, 42);
    assert.equal(desktop.submit.height, 42);
    assert.ok(Math.abs(desktop.quantity.bottom - desktop.submit.bottom) < 0.1);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.locator("[data-family-thumbs-viewport]").evaluate((element: HTMLElement) => { element.parentElement!.style.width = "700px"; });
    await page.waitForFunction(() => {
      const width = document.querySelector<HTMLElement>("[data-family-thumb]")?.getBoundingClientRect().width || 0;
      return width > 129 && width < 131;
    });
    const tablet = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>("[data-family-thumbs-viewport]")!;
      const items = [...document.querySelectorAll<HTMLElement>("[data-family-thumb]")];
      const quantity = document.querySelector<HTMLElement>('input[name="quantity"]')!;
      const submit = document.querySelector<HTMLElement>('[data-s2s-submit]')!;
      return {
        overflow: getComputedStyle(viewport).overflowX,
        widths: items.slice(0, 5).map((item) => item.getBoundingClientRect().width),
        sixthLeft: items[5].getBoundingClientRect().left,
        viewportRight: viewport.getBoundingClientRect().right,
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        heightDelta: Math.abs(quantity.getBoundingClientRect().height - submit.getBoundingClientRect().height),
        bottomDelta: Math.abs(quantity.getBoundingClientRect().bottom - submit.getBoundingClientRect().bottom),
      };
    });
    assert.equal(tablet.overflow, "hidden");
    assert.ok(tablet.widths.every((width) => width > 129 && width < 131), JSON.stringify(tablet.widths));
    assert.ok(tablet.sixthLeft >= tablet.viewportRight);
    assert.equal(tablet.documentOverflow, false);
    assert.ok(tablet.heightDelta < 0.1);
    assert.ok(tablet.bottomDelta < 0.1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("[data-family-thumbs-viewport]").evaluate((element: HTMLElement) => { element.parentElement!.style.width = "358px"; });
    await page.waitForFunction(() => {
      const width = document.querySelector<HTMLElement>("[data-family-thumb]")?.getBoundingClientRect().width || 0;
      return width > 100 && width < 120;
    });
    const mobile = await page.locator("[data-family-thumb]").evaluateAll((items: HTMLElement[]) => items.slice(0, 3).map((item) => item.getBoundingClientRect().width));
    assert.ok(mobile.every((width) => width > 100 && width < 120), JSON.stringify(mobile));
  } finally {
    await browser.close();
  }
});


test("portrait options use the shared gallery and keep the target variant synchronized", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.setContent(`<section data-s2s-portrait-product><figure data-portrait-slide="0"></figure><figure data-portrait-slide="1" hidden></figure><button data-portrait-previous></button><button data-portrait-next></button><div data-portrait-thumbs-viewport><div data-portrait-thumbs-track><button data-portrait-thumb="0" aria-current="true"></button><button data-portrait-thumb="1"></button></div></div><form class="s2s-portrait-form"><input data-s2s-variant-id name="id" value="1"><div data-portrait-step="1"><fieldset data-s2s-option-group="0"><span data-option-label></span><input type="radio" name="style" value="One" data-s2s-option="0" checked><input type="radio" name="style" value="Two" data-s2s-option="0"></fieldset><button type="button" data-portrait-next>Next</button></div><div data-portrait-step="2" hidden><button type="button" data-portrait-previous>Previous</button><button type="button" data-portrait-next>Next</button></div><div data-portrait-step="3" hidden><input type="file" name="properties[Upload Pet Photo 1]" data-s2s-photo data-s2s-photo-instance="1" accept="image/jpeg,image/png,image/webp" required><input type="file" name="properties[Upload Pet Photo 2]" data-s2s-photo data-s2s-photo-instance="2" accept="image/jpeg,image/png,image/webp" required><button type="button" data-portrait-previous>Previous</button><button type="button" data-portrait-next>Next</button></div><div data-portrait-step="4" hidden><button type="submit" data-s2s-submit>Add</button><button type="button" data-portrait-previous>Previous</button></div><p data-s2s-status></p><script type="application/json" data-s2s-variants>[{"id":1,"options":["One"],"price":1000,"available":true},{"id":2,"options":["Two"],"price":1200,"available":true}]</script></form></section>`);
    await page.addScriptTag({ content: productGalleryScript });
    await page.addScriptTag({ content: portraitProductScript });
    await page.locator('input[value="Two"]').check();
    assert.equal(await page.locator('[data-s2s-variant-id]').getAttribute("value"), "2");
    assert.equal(await page.locator('[data-portrait-slide="0"]').getAttribute("hidden"), "");
    assert.equal(await page.locator('[data-portrait-slide="1"]').getAttribute("hidden"), null);
    await page.locator('[data-portrait-step="1"] [data-portrait-next]').click();
    assert.equal(await page.locator('[data-portrait-step="2"]').getAttribute("hidden"), null);
    await page.locator('[data-portrait-step="2"] [data-portrait-next]').click();
    assert.equal(await page.locator('[data-portrait-step="3"]').getAttribute("hidden"), null);
    await page.locator('[data-portrait-step="3"] [data-portrait-next]').click();
    assert.notEqual(await page.locator('[data-portrait-step="3"]').getAttribute("hidden"), "");
    assert.equal(await page.locator('[data-portrait-step="4"]').getAttribute("hidden"), "");
    assert.match(await page.locator('[data-s2s-status]').textContent() || "", /every pet/i);
    await page.locator('[data-portrait-step="3"] [data-portrait-previous]').click();
    assert.equal(await page.locator('[data-portrait-step="2"]').getAttribute("hidden"), null);
  } finally {
    await browser.close();
  }
});

test("portrait frame and size changes select the captured variant media instead of guessing from the first option", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.setContent(`<section data-s2s-portrait-product>${Array.from({ length: 4 }, (_, index) => `<figure data-portrait-slide="${index}"${index ? " hidden" : ""}></figure>`).join("")}<button data-portrait-previous></button><button data-portrait-next></button><div data-portrait-thumbs-viewport><div data-portrait-thumbs-track>${Array.from({ length: 4 }, (_, index) => `<button data-portrait-thumb="${index}"${index === 0 ? ' aria-current="true"' : ""}></button>`).join("")}</div></div><form class="s2s-portrait-form"><input data-s2s-variant-id name="id" value="11"><fieldset data-s2s-option-group="0"><input type="radio" name="background" value="Soft White" data-s2s-option="0" checked></fieldset><fieldset data-s2s-option-group="1"><input type="radio" name="size" value="8x10" data-s2s-option="1" checked></fieldset><fieldset class="s2s-portrait-frame-styles" data-s2s-option-group="2"><input type="radio" name="frame" value="Black" data-s2s-option="2" checked><input type="radio" name="frame" value="White" data-s2s-option="2"></fieldset><button type="submit" data-s2s-submit>Add</button><p data-s2s-status></p><script type="application/json" data-s2s-variants>[{"id":11,"options":["Soft White","8x10","Black"],"price":7700,"available":true},{"id":12,"options":["Soft White","8x10","White"],"price":7700,"available":true}]</script><script type="application/json" data-s2s-variant-media-map>{"Soft White\\u001f8x10\\u001fBlack":0,"Soft White\\u001f8x10\\u001fWhite":2}</script></form></section>`);
    await page.addScriptTag({ content: productGalleryScript });
    await page.addScriptTag({ content: portraitProductScript });
    await page.locator('input[value="White"]').check();
    assert.equal(await page.locator('[data-s2s-variant-id]').getAttribute("value"), "12");
    assert.equal(await page.locator('[data-portrait-slide="2"]').getAttribute("hidden"), null);
    assert.equal(await page.locator('[data-portrait-thumb="2"]').getAttribute("aria-current"), "true");
  } finally {
    await browser.close();
  }
});
