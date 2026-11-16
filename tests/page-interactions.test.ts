import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildPageInteractionScript, validatePageInteractionContracts } from "../src/page-interaction-theme.js";

const contracts = {
  schemaVersion: 1 as const,
  pages: {
    "custom-pet-portraits": {
      kind: "choice-route" as const,
      rootSelector: "#step-through-start",
      buttonSelector: "#step-through-start-step-2 .btn-next",
      selections: [{ name: "portrait-style", defaultValue: "modern" }, { name: "pets-count" }],
      routes: {
        "modern|1 pet": "/products/custom-one-pet-portrait",
        "modern|2 pets": "/products/custom-two-pet-portrait",
      },
      gallerySync: {
        selector: ".product-media-gallery",
        selectionName: "pets-count",
        slideByValue: { "1 pet": 0, "2 pets": 1 },
        stickyTopPx: 20,
        stickyMinWidthPx: 0,
      },
    },
  },
};

test("page interaction contracts reject external and source-store destinations", () => {
  assert.throws(() => validatePageInteractionContracts({
    ...contracts,
    pages: { ...contracts.pages, "custom-pet-portraits": {
      ...contracts.pages["custom-pet-portraits"],
      routes: { "modern|1 pet": "https://westandwillow.com/products/custom-one-pet-portrait" },
    } },
  }), /target-store relative path/);
});

test("choice-route interaction resolves the selected target-store path", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div data-s2s-page-handle="custom-pet-portraits"><div class="product-media-gallery"><div class="thumbs-splide"><button class="splide__slide" data-slide="0"></button><button class="splide__slide" data-slide="1"></button></div></div><section id="step-through-start"><input type="radio" name="portrait-style" value="modern" checked><input id="one" type="radio" name="pets-count" value="1 pet" checked hidden><input id="two" type="radio" name="pets-count" value="2 pets" hidden><label for="one">1 pet</label><label for="two">2 pets</label><output id="active-slide">0</output><div id="step-through-start-step-2"><button class="btn-next" type="button">Next</button></div></section></div><script>document.querySelectorAll('[data-slide]').forEach(button=>button.addEventListener('click',()=>document.querySelector('#active-slide').textContent=button.dataset.slide))</script>`);
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as any).__s2sNavigationCalls = calls;
      Object.defineProperty(window, "location", { value: { assign: (value: string) => calls.push(value) } });
    }).catch(() => undefined);
    await page.addScriptTag({ content: buildPageInteractionScript(contracts).replace("window.location.assign(destination)", "window.__s2sNavigationCalls=(window.__s2sNavigationCalls||[]).concat(destination)") });
    await page.locator('label[for="two"]').evaluate((label) => (label as HTMLLabelElement).click());
    assert.equal(await page.locator("#two").isChecked(), true);
    assert.equal(await page.locator("#active-slide").textContent(), "1");
    assert.equal(await page.locator(".product-media-gallery").evaluate((element) => getComputedStyle(element).position), "sticky");
    await page.locator(".btn-next").click();
    assert.deepEqual(await page.evaluate(() => (window as any).__s2sNavigationCalls), ["/products/custom-two-pet-portrait"]);
    assert.equal(await page.locator("[data-s2s-page-handle]").getAttribute("data-s2s-page-interaction-destination"), "/products/custom-two-pet-portrait");
  } finally {
    await browser.close();
  }
});
