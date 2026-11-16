import { chromium } from "playwright";
import assert from "node:assert/strict";
import { join } from "node:path";
import sharp from "sharp";
import { json, readJson } from "./util.js";
import { unlockStorefrontIfNeeded } from "./storefront-auth.js";
import { assertRenderedEvidencePage, assertRenderedEvidenceRoute } from "./rendered-page-validity.js";

export async function verifyHaroldCommerce(out: string, targetBase: string, onlyHandle?: string, familyDelayMs = 0) {
  const evidence = await readJson<any>(join(out, "product-family-target-evidence.json"));
  const build = await readJson<any>(join(out, "theme-build.json"));
  const base = new URL(targetBase);
  const image = await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 74, g: 125, b: 98 } },
  }).png().toBuffer();
  const report: any = {
    schemaVersion: 1,
    themeBuild: build?.id || null,
    targetBase: base.href,
    checkedAt: new Date().toISOString(),
    orderCreated: false,
    checkoutSubmitted: false,
    families: [],
    passed: false,
  };
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const families = (evidence.families || []).filter((family: any) => !onlyHandle || family.targetHandle === onlyHandle);
    if (!families.length) throw new Error(`No Harold product family found for handle: ${onlyHandle}`);
    for (const [familyIndex, family] of families.entries()) {
      const result: any = {
        suffix: family.suffix,
        handle: family.targetHandle,
        stepsVisited: [],
        variantSelected: null,
        uploadProperties: [],
        addonCount: 0,
        parentLinePresent: false,
        cartCleared: false,
        errors: [],
      };
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      try {
        const url = new URL(family.url);
        url.searchParams.set("preview_theme_id", base.searchParams.get("preview_theme_id") || "");
        let response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
        for (let retry = 0; response?.status() === 429 && retry < 4; retry += 1) {
          await page.waitForTimeout(5000 * (retry + 1));
          response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
        }
        response = await unlockStorefrontIfNeeded(page, url.href) || response;
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await assertRenderedEvidencePage(page, response, "target");
        await assertRenderedEvidenceRoute(page, url.href, "target");
        const form = page.locator("form.s2s-family-form").first();
        await form.waitFor({ state: "visible", timeout: 30000 });
        const readCart = async () => {
          let last: any = null;
          for (let retry = 0; retry < 5; retry += 1) {
            last = await page.evaluate(async () => {
              const response = await fetch("/cart.js", { headers: { accept: "application/json" }, cache: "no-store" });
              return {
                ok: response.ok,
                status: response.status,
                type: response.headers.get("content-type") || "",
                body: await response.text(),
              };
            });
            if (last.status !== 429) break;
            await page.waitForTimeout(2000 * (retry + 1));
          }
          if (!last?.ok || !/(?:application\/json|text\/javascript)/i.test(last.type))
            throw new Error(`cart.js returned ${last?.status} ${last?.type || "unknown"}: ${String(last?.body || "").slice(0, 120)}`);
          return JSON.parse(last.body);
        };
        const clearCart = () => page.evaluate(async () => {
          const response = await fetch("/cart/clear.js", { method: "POST", headers: { accept: "application/json" } });
          if (!response.ok) throw new Error(`cart clear returned ${response.status}`);
        });
        await clearCart();

        const groups = form.locator("[data-s2s-option-group]");
        const groupCount = await groups.count();
        for (let index = 0; index < groupCount; index += 1) {
          const radios = groups.nth(index).locator('input[type="radio"]:not([name="form-option-framing-swicher"]):not([hidden])');
          if (await radios.count() > 1) {
            // Option changes may replace the option group's DOM. `check()` then waits on
            // the detached input and reports a false failure even though the variant did
            // change. Trigger the real click and verify the live form state afterwards.
            await radios.nth(1).click({ force: true });
            await page.waitForTimeout(150);
            break;
          }
          const select = groups.nth(index).locator("select");
          if (await select.count() && await select.locator("option:not([disabled])").count() > 1) {
            await select.selectOption({ index: 1 });
            break;
          }
        }

        for (let guard = 0; guard < 12; guard += 1) {
          const current = Number(await page.locator("[data-s2s-harold-workflow]").getAttribute("data-s2s-current-step") || 1);
          if (!result.stepsVisited.includes(current)) result.stepsVisited.push(current);
          const panel = form.locator(`[data-s2s-step="${current}"]`);
          for (const input of await panel.locator('input[type="file"][required]').all())
            await input.setInputFiles({ name: `s2s-${family.targetHandle}.png`, mimeType: "image/png", buffer: image });
          const next = panel.locator("[data-s2s-step-next]");
          if (!await next.count() || !await next.isVisible()) break;
          await next.click();
          await page.waitForTimeout(100);
        }

        const addons = form.locator("[data-s2s-addon]:not([disabled])");
        const addonTotal = await addons.count();
        for (let index = 0; index < addonTotal; index += 1) await addons.nth(index).check();
        result.addonsSelected = addonTotal;
        result.variantSelected = await page.locator("[data-s2s-family-product]").getAttribute("data-s2s-selected-variant");
        assert.ok(result.variantSelected, "selected target variant is missing");

        const submit = form.locator("[data-s2s-submit]");
        await submit.waitFor({ state: "visible", timeout: 10000 });
        const requiredUploads = await form.locator('input[type="file"][required]').count();
        // The production form intentionally redirects to /cart after the portrait
        // and add-on requests finish. Wait for that navigation (when it occurs)
        // before reading cart.js so the validator does not evaluate in a destroyed
        // product-page execution context and report a false commerce failure.
        const [cartResponse] = await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
          submit.click(),
        ]);
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        if (!cartResponse) throw new Error(`cart page did not load after submission (${page.url()})`);
        const expectedCartUrl = new URL("/cart", url).href;
        await assertRenderedEvidencePage(page, cartResponse, "target");
        await assertRenderedEvidenceRoute(page, expectedCartUrl, "target");
        assert.ok(await page.locator("[data-s2s-cart]").count(), "generated cart form is missing");
        let cart: any = null;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          cart = await readCart();
          // The product script adds the portrait first and add-ons second. Waiting
          // merely for a non-empty cart races the second request and produces a
          // false "missing add-ons" failure.
          if (Number(cart?.item_count || 0) >= addonTotal + 1) break;
          await page.waitForTimeout(500);
        }
        if (!cart || Number(cart.item_count || 0) < addonTotal + 1) {
          const status = await form.locator("[data-s2s-status]").textContent().catch(() => "");
          throw new Error(`cart did not reach ${addonTotal + 1} expected line(s) after submission (actual ${Number(cart?.item_count || 0)})${status?.trim() ? `: ${status.trim()}` : ""}`);
        }
        const parent = cart.items.find((item: any) => item.properties?._s2s_role === "portrait");
        assert.ok(parent, "portrait parent line is missing from cart");
        assert.equal(String(parent.variant_id), String(result.variantSelected), "cart variant differs from selected variant");
        result.parentLinePresent = true;
        result.uploadProperties = Object.entries(parent.properties || {})
          .filter(([key, value]) => !key.startsWith("_") && /photo|upload/i.test(key) && Boolean(value))
          .map(([key]) => key);
        assert.ok(result.uploadProperties.length >= requiredUploads, "required upload properties are missing from cart");
        const added = cart.items.filter((item: any) => item.properties?._s2s_role === "addon");
        assert.equal(added.length, addonTotal, "selected add-ons are missing from cart");
        assert.ok(added.every((item: any) => item.final_line_price > 0), "add-on price must be positive");
        assert.ok(added.every((item: any) => item.properties?._s2s_group === parent.properties?._s2s_group), "add-on group differs from parent group");
        result.addonCount = added.length;
        result.lineCount = cart.items.length;
        result.cartTotal = cart.total_price;
        await clearCart();
        const cleared = await readCart();
        assert.equal(cleared.item_count, 0, "isolated verification cart was not cleared");
        result.cartCleared = true;
        result.passed = true;
      } catch (error) {
        result.errors.push(String(error));
        result.passed = false;
        await page.screenshot({ path: join(out, "verification", `harold-commerce-${family.suffix}-failure.png`), fullPage: true }).catch(() => {});
      } finally {
        await page.evaluate(() => fetch("/cart/clear.js", { method: "POST" })).catch(() => {});
        await context.close();
      }
      report.families.push(result);
      if (familyDelayMs > 0 && familyIndex < families.length - 1)
        await new Promise((resolve) => setTimeout(resolve, familyDelayMs));
    }
  } finally {
    await browser.close();
  }
  report.passed = report.families.length > 0 && report.families.every((family: any) => family.passed);
  await json(join(out, "verification-harold-commerce.json"), report);
  return report;
}
