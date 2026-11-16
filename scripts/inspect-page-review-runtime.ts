import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const url = process.argv[2] || "https://azhiip-13.myshopify.com/pages/custom-pet-portraits?preview_theme_id=189590896839";
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname === "/password") {
    await page.locator('input[type="password"]').fill("powrto");
    await page.locator('form[action$="/password"] button[type="submit"],form[action$="/password"] input[type="submit"]').first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(2500);
  console.log(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    sections: [...document.querySelectorAll<HTMLElement>('.shopify-section')].map(element => ({ id: element.id, display: getComputedStyle(element).display, sample: element.outerHTML.slice(0, 220) })),
    rendered: [...document.querySelectorAll<HTMLElement>('[data-s2s-page-family]')].map(element => ({ fallback: element.dataset.s2sTemplateFallback || "", handle: element.dataset.s2sPageHandle || "" })),
    slots: document.querySelectorAll('[data-s2s-page-review-slot]').length,
    widgets: document.querySelectorAll('#looxReviews').length,
    widgetState: (() => { const widget = document.querySelector<HTMLElement>('#looxReviews'); return widget ? { height: widget.getBoundingClientRect().height, children: widget.children.length, text: (widget.innerText || '').slice(0, 160), html: widget.innerHTML.slice(0, 220) } : null; })(),
    scripts: [...document.scripts].map(script => script.src).filter(src => /loox/i.test(src)),
  })), null, 2));
} finally {
  await browser.close();
}
