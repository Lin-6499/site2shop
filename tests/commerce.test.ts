import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { commerceLocales } from "../src/commerce-theme.js";
import { bindVariants } from "../src/catalog.js";

let browser: Browser, base: string, server: ReturnType<typeof createServer>;
const photo = {
  name: "test-pet.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZfkAAAAASUVORK5CYII=",
    "base64",
  ),
};
before(async () => {
  const code = await readFile(
    new URL("../src/commerce.js", import.meta.url),
    "utf8",
  );
  server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/runtime.js" ? "text/javascript" : "text/html",
    );
    res.end(req.url === "/runtime.js" ? code : "<h1>Test destination</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  browser = await chromium.launch({ headless: true, channel: "chromium" });
});
after(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});
const fixture = `<script type="application/json" id="s2s-commerce-config">${JSON.stringify({ root: "/", currency: "USD", shopify: true, text: commerceLocales })}</script>
<form data-s2s-product data-s2s-commerce="true" novalidate>
<script type="application/json" id="s2s-variants">[{"id":100,"price":7700,"compare_at_price":10500,"available":true,"options":["White","Small","Black"]},{"id":101,"price":15400,"compare_at_price":20900,"available":true,"options":["White","Large","Black"]},{"id":102,"price":20000,"compare_at_price":null,"available":true,"options":["White","XL","Black"]}]</script>
<script type="application/json" data-s2s-gallery>{}</script><input data-s2s-variant>
<div data-step="1"><input name="option-background-color" value="White" type="radio" checked><input id="missing" name="option-background-color" value="Missing" type="radio"><button type="button" data-show-step="2">Next</button></div>
<div data-step="2" style="display:none"><input name="option-size" value="Small" type="radio" checked><input name="option-size" value="Large" type="radio"><input name="option-size" value="XL" type="radio"><input name="option-frame-option" value="Black" type="radio" checked><button type="button" data-show-step="3">Next</button></div>
<div data-step="3" style="display:none"><h4>Your photo</h4><input id="input-pet-name-1"><input type="file" data-s2s-file><button type="button" data-show-step="4">Next</button></div>
<div data-step="4" style="display:none"><label for="extra">Artwork Preview <span class="money"></span></label><input type="checkbox" id="extra" data-s2s-addon="proof"><button type="button" data-show-step="5">Review</button></div>
<script data-s2s-addon-product="proof" type="application/json">[{"id":200,"price":1000,"available":true}]</script>
<div data-step="5" style="display:none"><div data-review="photo-1"><img><h5><span></span></h5></div><p data-s2s-addon-summary></p><span class="product-price-final"></span><button type="submit">Add</button></div>
<p data-s2s-status tabindex="-1"></p></form><span class="product-price-compare"></span><script src="/runtime.js" defer></script>`;
async function setup() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/product", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  await page.goto(base + "/product");
  return { page, context };
}
async function enter(page: Page, addon = true) {
  await page.locator('[data-step="1"] button').click();
  await page.locator('[data-step="2"] button').click();
  await page.locator("#input-pet-name-1").fill("Bear");
  await page.locator("[data-s2s-file]").setInputFiles(photo);
  await page.locator('[data-step="3"] button').click();
  if (addon) await page.locator("#extra").check();
  await page.locator('[data-step="4"] button').click();
}
test("variants bind by option values, never by source IDs or array position", () => {
  const entry = {
    sources: [{ id: "111", options: ["White"], galleryPosition: 2 }],
  };
  const target = {
    variants: {
      pageInfo: { hasNextPage: false },
      nodes: [
        {
          id: "gid://shopify/ProductVariant/999",
          price: "77.00",
          selectedOptions: [{ name: "Color", value: "White" }],
        },
      ],
    },
  };
  assert.equal(bindVariants(entry, target)[0].id, 999);
  assert.throws(
    () =>
      bindVariants({ ...entry, sources: [{ options: ["Missing"] }] }, target),
    /Missing target/,
  );
});
test("missing customization blocks progress and unavailable options clear the variant ID", async () => {
  const { page, context } = await setup();
  try {
    await page.locator('[data-step="1"] button').click();
    await page.locator('[data-step="2"] button').click();
    await page.locator('[data-step="3"] button').click();
    assert.equal(await page.locator('[data-step="3"]').isVisible(), true);
    assert.match(
      await page.locator("[data-s2s-status]").innerText(),
      /pet name and photo/,
    );
    await page
      .locator("[data-s2s-file]")
      .setInputFiles({ ...photo, name: "bad.svg", mimeType: "image/svg+xml" });
    assert.match(await page.locator("[data-s2s-status]").innerText(), /JPG/);
    await page.evaluate(() => {
      const el = document.querySelector("#missing") as HTMLInputElement;
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await page.locator("[data-s2s-variant]").inputValue(), "");
    assert.equal(await page.locator("button[type=submit]").isDisabled(), true);
  } finally {
    await context.close();
  }
});
test("switching size updates compare-at price and hides it for a non-sale variant", async () => {
  const { page, context } = await setup();
  try {
    assert.equal(
      await page.locator(".product-price-compare").innerText(),
      "$105.00",
    );
    await page.locator('[data-step="1"] button').click();
    await page.locator('input[name="option-size"][value="Large"]').check();
    assert.equal(
      await page.locator(".product-price-compare").innerText(),
      "$209.00",
    );
    assert.equal(await page.locator("[data-s2s-variant]").inputValue(), "101");
    await page.locator('input[name="option-size"][value="XL"]').check();
    assert.equal(
      await page.locator(".product-price-compare").isVisible(),
      false,
    );
  } finally {
    await context.close();
  }
});
test("empty cart quantity cannot become a destructive zero update", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let writes = 0;
  try {
    await page.route("**/cart-test", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `
      <script type="application/json" id="s2s-commerce-config">${JSON.stringify({ root: "/", text: commerceLocales })}</script>
      <form data-s2s-cart novalidate><div data-key="portrait" data-role="portrait" data-group="test">
      <input type="number" min="0" max="99" data-s2s-quantity value="1"><button type="button" data-s2s-remove>Remove</button></div>
      <button name="update">Update</button><p data-s2s-cart-status></p></form><script src="/runtime.js" defer></script>`,
      }),
    );
    await page.route("**/cart/update.js", (r) => {
      writes++;
      return r.fulfill({ json: { items: [] } });
    });
    await page.goto(base + "/cart-test");
    await page.locator("[data-s2s-quantity]").fill("");
    await page.locator('button[name="update"]').click();
    await page.waitForFunction(
      () => !!document.querySelector("[data-s2s-cart-status]")?.textContent,
    );
    assert.equal(writes, 0);
    assert.equal(new URL(page.url()).pathname, "/cart-test");
  } finally {
    await context.close();
  }
});
test("successful multipart upload includes customization; extras use target IDs and one shared group", async () => {
  const { page, context } = await setup();
  let items: any[] = [],
    parentCalls = 0,
    group = "";
  try {
    await page.route("**/cart.js", (r) => r.fulfill({ json: { items } }));
    await page.route("**/cart/add.js", async (route) => {
      const req = route.request();
      if (req.headers()["content-type"].includes("multipart")) {
        parentCalls++;
        const body = req.postData()!;
        assert.match(body, /filename="test-pet.png"/);
        assert.match(body, /Pet Name 1/);
        assert.match(body, /Bear/);
        group = body.match(
          /name="properties\[_s2s_group\]"\r\n\r\n([^\r]+)/,
        )![1];
        const parent = {
          key: "parent",
          quantity: 1,
          properties: {
            _s2s_group: group,
            "Upload Pet Photo 1": "https://cdn.shopify.com/uploads/test.png",
          },
        };
        items.push(parent);
        await new Promise((r) => setTimeout(r, 100));
        await route.fulfill({ json: parent });
      } else {
        const added = req.postDataJSON().items;
        assert.equal(added[0].id, 200);
        assert.equal(added[0].properties._s2s_group, group);
        items.push({ ...added[0], key: "addon" });
        await route.fulfill({ json: { items: added } });
      }
    });
    await enter(page);
    assert.equal(
      await page.locator(".product-price-final").innerText(),
      "$87.00",
    );
    await page.locator("button[type=submit]").click();
    await page.waitForURL(base + "/cart");
    assert.equal(parentCalls, 1);
    assert.equal(items.length, 2);
  } finally {
    await context.close();
  }
});
test("failed add-on rolls back only the current portrait group and keeps prior cart contents", async () => {
  const { page, context } = await setup();
  let items: any[] = [{ key: "existing", quantity: 1, properties: {} }],
    removed: any;
  try {
    await page.route("**/cart.js", (r) => r.fulfill({ json: { items } }));
    await page.route("**/cart/add.js", (route) => {
      if (route.request().headers()["content-type"].includes("multipart")) {
        const group = route
          .request()
          .postData()!
          .match(/name="properties\[_s2s_group\]"\r\n\r\n([^\r]+)/)![1];
        const parent = {
          key: "new-parent",
          quantity: 1,
          properties: {
            _s2s_group: group,
            "Upload Pet Photo 1": "https://cdn.shopify.com/uploads/test.png",
          },
        };
        items.push(parent);
        return route.fulfill({ json: parent });
      }
      return route.fulfill({
        status: 422,
        json: { description: "Add-on sold out" },
      });
    });
    await page.route("**/cart/update.js", (route) => {
      removed = route.request().postDataJSON().updates;
      items = items.filter((i) => removed[i.key] !== 0);
      return route.fulfill({ json: { items } });
    });
    await enter(page);
    await page.locator("button[type=submit]").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-s2s-status]")?.textContent ===
        "Add-on sold out",
    );
    assert.deepEqual(removed, { "new-parent": 0 });
    assert.equal(items[0].key, "existing");
    assert.equal(items.length, 1);
    assert.equal(await page.locator("#input-pet-name-1").inputValue(), "Bear");
    assert.equal(await page.locator("button[type=submit]").isEnabled(), true);
  } finally {
    await context.close();
  }
});
test("uncertain rollback locks retries and offers cart inspection", async () => {
  const { page, context } = await setup();
  let reads = 0;
  try {
    await page.route("**/cart.js", (r) =>
      ++reads === 1 ? r.fulfill({ json: { items: [] } }) : r.abort(),
    );
    await page.route("**/cart/add.js", (r) => r.abort());
    await enter(page, false);
    await page.locator("button[type=submit]").click();
    await page.locator("[data-s2s-status] a").waitFor();
    assert.equal(await page.locator("button[type=submit]").isDisabled(), true);
    assert.match(
      await page.locator("[data-s2s-status]").innerText(),
      /check your cart/,
    );
  } finally {
    await context.close();
  }
});
