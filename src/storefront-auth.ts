import type { Page, Response } from "playwright";

/**
 * Unlock a Shopify password-protected storefront for the current browser
 * context. The password is supplied only through the process environment and
 * is never returned to callers or persisted in evidence artifacts.
 */
export async function unlockStorefrontIfNeeded(page: Page, targetUrl: string): Promise<Response | null> {
  const password = process.env.SITE2SHOP_STOREFRONT_PASSWORD;
  if (!password) return null;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const input = page.locator('form[action*="/password"] input[name="password"]').first();
    const onPasswordRoute = /\/password(?:[/?#]|$)/i.test(page.url());
    if (!(await input.count())) {
      if (!onPasswordRoute) return response;
      response = await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(300);
      continue;
    }

    await input.fill(password);
    const form = input.locator("xpath=ancestor::form[1]");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      form.evaluate((node: HTMLFormElement) => node.requestSubmit()),
    ]);

    // Shopify commonly redirects to the storefront root after unlocking.
    // Revisit the exact route (including preview theme identity) after every
    // attempt and verify that another password challenge did not replace it.
    response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(300);
    if (!/\/password(?:[/?#]|$)/i.test(page.url()) && !(await page.locator('form[action*="/password"] input[name="password"]').count()))
      return response;
  }
  return response;
}
