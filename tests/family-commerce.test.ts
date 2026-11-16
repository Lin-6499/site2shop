import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { familyProductScript } from "../src/family-product-theme.js";

async function runSubmit(required: boolean) {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const context = await browser.newContext();
  const page = await context.newPage();
  let parentCalls = 0;
  try {
    await page.route("https://shop.test/product", (route) => route.fulfill({
      contentType: "text/html",
      body: `<script id="s2s-commerce-config" type="application/json">{"root":"/"}</script>
        <section data-s2s-family-product><form class="s2s-family-form" enctype="multipart/form-data">
          <input name="id" data-s2s-variant-id value="101">
          <input type="file" name="properties[House photo]" data-s2s-photo ${required ? "required data-s2s-required-photo" : ""}>
          <button type="submit" data-s2s-submit>Add</button><p data-s2s-status></p>
          <script type="application/json" data-s2s-variants>[{"id":101,"options":[],"price":5000,"available":true}]</script>
        </form></section>`,
    }));
    await page.route("https://shop.test/cart.js", (route) => route.fulfill({ json: { items: parentCalls ? [{ key: "parent", properties: { _s2s_group: "group" } }] : [] } }));
    await page.route("https://shop.test/cart/add.js", (route) => {
      parentCalls++;
      return route.fulfill({ json: { key: "parent", properties: { _s2s_group: "group" } } });
    });
    await page.route("https://shop.test/cart", (route) => route.fulfill({ contentType: "text/html", body: "cart" }));
    await page.goto("https://shop.test/product");
    await page.addScriptTag({ content: familyProductScript });
    await page.locator("form").evaluate((form) => form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    await page.waitForTimeout(100);
    return { parentCalls, status: await page.locator("[data-s2s-status]").innerText() };
  } finally {
    await context.close();
    await browser.close();
  }
}

test("optional family upload may be empty while required upload remains guarded", async () => {
  const optional = await runSubmit(false);
  assert.equal(optional.parentCalls, 1);
  assert.doesNotMatch(optional.status, /Choose a JPG/);

  const required = await runSubmit(true);
  assert.equal(required.parentCalls, 0);
  assert.match(required.status, /Choose a JPG/);
});
