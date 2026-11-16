import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { portraitProductScript } from "../src/product-gallery-theme.js";

test("portrait proof and extras use target variants in one atomic cart group", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const context = await browser.newContext();
  const page = await context.newPage();
  let items: any[] = [];
  let group = "";
  let addOnIds: number[] = [];
  try {
    await page.route("https://shop.test/portrait", (route) => route.fulfill({
      contentType: "text/html",
      body: `<script id="s2s-commerce-config" type="application/json">{"root":"/"}</script><section data-s2s-portrait-product><form class="s2s-portrait-form" enctype="multipart/form-data"><input name="id" data-s2s-variant-id value="101"><div data-portrait-step="1"><fieldset data-s2s-option-group="0"><span data-option-label></span><input type="radio" value="Soft White" checked></fieldset><button type="button" data-portrait-next>Next</button></div><div data-portrait-step="2" hidden><button type="button" data-portrait-next>Next</button><button type="button" data-portrait-previous>Previous</button></div><div data-portrait-step="3" hidden><input type="file" name="properties[Upload Pet Photo]" data-s2s-photo data-s2s-photo-instance="1" required><input id="proof" type="checkbox" data-s2s-addon="proof"><label for="proof">Artwork Preview <span class="money"></span></label><script type="application/json" data-s2s-addon-product="proof">[{"id":501,"price":1000,"available":true}]</script><button type="button" data-portrait-next>Next</button><button type="button" data-portrait-previous>Previous</button></div><div data-portrait-step="4" hidden><input id="priority" type="checkbox" data-s2s-addon="priority"><label for="priority">Priority <span class="money"></span></label><script type="application/json" data-s2s-addon-product="priority">[{"id":502,"price":2000,"available":true}]</script><input name="quantity" type="number" value="1"><button type="submit" data-s2s-submit>Add</button><button type="button" data-portrait-previous>Previous</button></div><p data-s2s-status></p><script type="application/json" data-s2s-variants>[{"id":101,"options":["Soft White"],"price":7700,"available":true}]</script></form></section>`,
    }));
    await page.route("https://shop.test/cart.js", (route) => route.fulfill({ json: { items } }));
    await page.route("https://shop.test/cart/add.js", async (route) => {
      if ((route.request().headers()["content-type"] || "").includes("multipart")) {
        const body = route.request().postData() || "";
        group = body.match(/name="properties\[_s2s_group\]"\r\n\r\n([^\r]+)/)?.[1] || "";
        const parent = { key: "parent", properties: { _s2s_group: group, "Upload Pet Photo": "https://cdn.shopify.com/upload.png" } };
        items.push(parent);
        return route.fulfill({ json: parent });
      }
      const added = route.request().postDataJSON().items;
      addOnIds = added.map((item: any) => item.id).sort();
      assert.ok(added.every((item: any) => item.properties._s2s_group === group));
      items.push(...added.map((item: any, index: number) => ({ ...item, key: `addon-${index}` })));
      return route.fulfill({ json: { items: added } });
    });
    await page.route("https://shop.test/cart", (route) => route.fulfill({ contentType: "text/html", body: "cart" }));
    await page.goto("https://shop.test/portrait");
    await page.addScriptTag({ content: portraitProductScript });
    await page.locator('[data-portrait-step="1"] [data-portrait-next]').click();
    await page.locator('[data-portrait-step="2"] [data-portrait-next]').click();
    await page.locator('[data-s2s-photo]').setInputFiles({ name: "pet.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await page.locator("#proof").check();
    await page.locator('[data-portrait-step="3"] [data-portrait-next]').click();
    await page.locator("#priority").check();
    await page.locator('[data-s2s-submit]').click();
    await page.waitForURL("https://shop.test/cart");
    assert.ok(group);
    assert.deepEqual(addOnIds, [501, 502]);
    assert.equal(items.length, 3);
  } finally {
    await context.close();
    await browser.close();
  }
});
