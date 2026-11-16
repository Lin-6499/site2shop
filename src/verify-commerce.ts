import { chromium } from "playwright";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { json, readJson } from "./util.js";
import { report } from "./report.js";
import { safeFetch } from "./network.js";
import sharp from "sharp";

export async function verifyCommerce(out: string, preview: string) {
  const binding = await readJson<any>(join(out, "catalog-binding.json"));
  if (!binding.completed) throw new Error("Complete catalog sync first.");
  const base = new URL(preview);
  if (base.protocol !== "https:" || base.hostname !== binding.store)
    throw new Error(
      "Use an HTTPS preview URL on the bound myshopify.com store.",
    );
  const portrait = binding.products.find((p: any) => p.kind === "portrait");
  const image = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 90, g: 140, b: 110 },
    },
  })
    .png()
    .toBuffer();
  const hash = (data: Buffer) =>
    createHash("sha256").update(data).digest("hex");
  const result: any = {
    themeBuild: (
      await readJson<any>(join(out, "theme-build.json")).catch(() => null)
    )?.id,
    capturedAt: new Date().toISOString(),
    mode: "shopify-commerce",
    store: binding.store,
    productHandle: portrait.handle,
    catalogBound: true,
    uploadPersisted: false,
    cartProperties: false,
    addonsCharged: false,
    quantityUpdate: false,
    removeItem: false,
    checkoutReached: false,
    orderCreated: false,
    errors: [],
  };
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  let isolatedCart = false;
  const page = await context.newPage();
  try {
    await page.goto(base.href, { waitUntil: "domcontentloaded" });
    if (await page.locator('input[name="password"]').count())
      throw new Error(
        "Use the authenticated draft preview link from the theme editor. Storefront password protection is enabled.",
      );
    const cartUrl = new URL("/cart.js", base).href;
    const initial = await (await context.request.get(cartUrl)).json();
    assert.equal(
      initial.item_count,
      0,
      "New isolated browser context must have an empty cart.",
    );
    isolatedCart = true;
    const productUrl = new URL(base);
    productUrl.pathname = "/products/" + portrait.handle;
    productUrl.searchParams.delete("view");
    await page.goto(productUrl.href, { waitUntil: "domcontentloaded" });
    const variants = JSON.parse(
      await page.locator("#s2s-variants").innerText(),
    );
    const initialId = await page.locator("[data-s2s-variant]").inputValue();
    const initialVariant = variants.find(
      (v: any) => String(v.id) === initialId,
    );
    const alternate = variants.find(
      (v: any) =>
        v.options[0] === initialVariant.options[0] &&
        v.options[2] === initialVariant.options[2] &&
        v.options[1] !== initialVariant.options[1] &&
        v.compare_at_price > v.price &&
        v.compare_at_price !== initialVariant.compare_at_price,
    );
    assert.ok(
      alternate,
      "Fixture must include a different size with a different compare-at price.",
    );
    const setSize = (value: string) =>
      page.locator('input[name="option-size"]').evaluateAll((inputs, size) => {
        const input = inputs.find(
          (el) => (el as HTMLInputElement).value === size,
        ) as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    await setSize(alternate.options[1]);
    const compareText = await page.evaluate(
      (cents) =>
        new Intl.NumberFormat(document.documentElement.lang || "en", {
          style: "currency",
          currency: JSON.parse(
            document.querySelector("#s2s-commerce-config")!.textContent!,
          ).currency,
        }).format(cents / 100),
      alternate.compare_at_price,
    );
    assert.equal(
      await page.locator(".product-price-compare").first().innerText(),
      compareText,
    );
    result.compareAtUpdated = true;
    await setSize(initialVariant.options[1]);
    await page.locator('[data-step="1"] [data-show-step="2"]').click();
    await page.locator('[data-step="2"] [data-show-step="3"]').click();
    await page.locator("#input-pet-name-1").fill("Site2Shop Test Pet");
    await page.locator("[data-s2s-file]").setInputFiles({
      name: "site2shop-test.png",
      mimeType: "image/png",
      buffer: image,
    });
    await page.locator("#artwork-proof-checkbox").check();
    await page.locator('[data-step="3"] [data-show-step="4"]').click();
    await page.locator("#checkbox-digital-download").check();
    await page.locator('[data-step="4"] [data-show-step="5"]').click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(out, "verification/commerce-review.png"),
      fullPage: true,
    });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator("#form-custom-pet-portrait").screenshot({
        path: join(out, `verification/commerce-form-${width}.png`),
        style: '[id^="header-"],#PBarNextFrame{visibility:hidden!important}',
      });
    }
    await page.locator('[data-step="5"] [data-atc-mode="atc"]').click();
    await page.waitForURL((u) => u.pathname === "/cart", { timeout: 60000 });
    const cart = await (await context.request.get(cartUrl)).json();
    const parent = cart.items.find(
      (i: any) => i.properties?._s2s_role === "portrait",
    );
    assert.ok(parent);
    assert.equal(parent.properties["Pet Name 1"], "Site2Shop Test Pet");
    assert.ok(portrait.variants.some((v: any) => v.id === parent.variant_id));
    result.cartProperties = true;
    const photoUrl = new URL(parent.properties["Upload Pet Photo 1"], base);
    assert.equal(photoUrl.protocol, "https:");
    assert.ok(photoUrl.pathname.includes("/uploads/"));
    const response = await safeFetch(photoUrl.href);
    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type") || "", /^image\//);
    const stored = Buffer.from(await response.arrayBuffer());
    const decoded = await sharp(stored)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const original = await sharp(image).removeAlpha().raw().toBuffer();
    assert.equal(decoded.info.width, 64);
    assert.equal(decoded.info.height, 48);
    assert.equal(decoded.data.length, original.length);
    const meanPixelError =
      decoded.data.reduce((n, v, i) => n + Math.abs(v - original[i]), 0) /
      original.length;
    assert.ok(
      meanPixelError < 8,
      "Stored photo must visually match the uploaded fixture, allowing CDN re-encoding.",
    );
    result.uploadEvidence = {
      sourceSha256: hash(image),
      storedSha256: hash(stored),
      width: 64,
      height: 48,
      meanPixelError,
      independentHttpRead: true,
    };
    result.uploadPersisted = true;
    const addons = cart.items.filter(
      (i: any) => i.properties?._s2s_role === "addon",
    );
    assert.equal(addons.length, 2);
    assert.ok(
      addons.every(
        (i: any) => i.properties._s2s_group === parent.properties._s2s_group,
      ),
    );
    assert.equal(
      cart.total_price,
      cart.items.reduce((n: number, i: any) => n + i.final_line_price, 0),
    );
    assert.ok(addons.every((i: any) => i.final_line_price > 0));
    result.addonsCharged = true;
    result.currency = cart.currency;
    result.total = cart.total_price;
    result.lineCount = cart.items.length;
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(out, "verification/commerce-cart.png"),
      fullPage: true,
    });
    await page.addStyleTag({
      content: "#PBarNextFrame{display:none!important}",
    });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: join(out, `verification/commerce-cart-${width}.png`),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Cart must not overflow horizontally.",
      );
    }
    const quantity = page.locator('[data-role="portrait"] [data-s2s-quantity]');
    await quantity.fill("");
    assert.equal(
      await quantity.evaluate(
        (el) => (el as HTMLInputElement).validity.valueMissing,
      ),
      true,
    );
    await page.locator('button[name="update"]').click();
    const unchanged = await (await context.request.get(cartUrl)).json();
    assert.ok(unchanged.items.every((i: any) => i.quantity === 1));
    result.emptyQuantityBlocked = true;
    await quantity.fill("2");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator('button[name="update"]').click(),
    ]);
    const doubled = await (await context.request.get(cartUrl)).json();
    assert.ok(doubled.items.every((i: any) => i.quantity === 2));
    result.quantityUpdate = true;
    await page.waitForLoadState("networkidle");
    await page.locator('button[name="checkout"]').click();
    await page
      .waitForURL((u) => u.pathname.includes("checkout"), { timeout: 20000 })
      .catch(() => {});
    const checkoutText = await page.locator("body").innerText();
    result.checkoutBlocked =
      checkoutText.includes("isn’t set up to receive orders yet") ||
      checkoutText.includes("isn't set up to receive orders yet");
    result.checkoutReached =
      /\/checkouts?\//.test(new URL(page.url()).pathname) &&
      !result.checkoutBlocked;
    if (result.checkoutBlocked)
      result.blocker =
        "Shopify: This store isn't set up to receive orders yet.";
    result.checkoutPageTitle = await page.title();
    await page.screenshot({
      path: join(out, "verification/commerce-checkout.png"),
      fullPage: true,
    });
    const cartPage = new URL(base);
    cartPage.pathname = "/cart";
    cartPage.searchParams.delete("view");
    await page.goto(cartPage.href, { waitUntil: "domcontentloaded" });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator('[data-role="portrait"] [data-s2s-remove]').click(),
    ]);
    assert.equal(
      (await (await context.request.get(cartUrl)).json()).item_count,
      0,
    );
    result.removeItem = true;
  } catch (error) {
    result.errors.push(String(error));
    result.pageStatus = await page
      .locator("[data-s2s-status]")
      .textContent()
      .catch(() => null);
    await page
      .screenshot({
        path: join(out, "verification/commerce-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    if (isolatedCart)
      await context.request
        .post(new URL("/cart/clear.js", base).href)
        .catch(() => {});
    await browser.close();
  }
  result.passed =
    result.uploadPersisted &&
    result.cartProperties &&
    result.addonsCharged &&
    result.quantityUpdate &&
    result.removeItem;
  await json(join(out, "verification-commerce.json"), result);
  await report(out);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
