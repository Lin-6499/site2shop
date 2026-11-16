import { chromium, type Page } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const baseUrl = 'https://haroldhome.co';
const productPath = '/products/custom-house-portrait';
const outDir = resolve('../haroldhome-skill-test-20261022/cart-validation');
const testFile = resolve('../haroldhome-skill-test-20261022/desktop-home-initial.png');
const reportPath = resolve('../haroldhome-skill-test-20261022/report.html');
const viewports = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

async function dismissPopup(page: Page) {
  const frameClose = page.frameLocator('#attentive_creative').getByRole('button', { name: /dismiss this popup/i });
  if (await frameClose.count().catch(() => 0)) await frameClose.first().click({ timeout: 1500 }).catch(() => undefined);
  for (const locator of [
    page.getByRole('button', { name: /dismiss this popup/i }),
    page.locator('#closeIconContainer'),
  ]) {
    if (await locator.count()) await locator.first().click({ timeout: 1000 }).catch(() => undefined);
  }
}

async function waitForPondIdle(page: Page, expected: number) {
  await page.waitForFunction((count) => {
    const items = Array.from(document.querySelectorAll('#product-content-area .filepond--item'));
    return items.length >= count && items.every(el => el.getAttribute('data-filepond-item-state') === 'idle');
  }, expected, { timeout: 30000 });
}

async function fillStable(locator: any, value: string) {
  const field = locator.filter({ visible: true }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await field.fill(value);
    await field.press('Tab');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 350));
    const actual = await field.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => el.value);
    if (actual === value) return true;
  }
  return false;
}

async function pageEvidence(page: Page) {
  return await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#product-content-area');
    return {
      pathname: location.pathname,
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '',
      text: (root?.innerText || '').trim(),
      buttons: Array.from(root?.querySelectorAll('button') || []).filter(el => {
        const h = el as HTMLElement;
        return !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length) && getComputedStyle(h).visibility !== 'hidden';
      }).map(el => (el.textContent || '').trim()),
      checked: Array.from(root?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked,input[type="radio"]:checked') || []).map(el => ({ name: el.name, value: el.value })),
      values: Array.from(root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[type="text"],textarea') || []).map(el => ({ name: el.name, value: el.value })),
      pond: Array.from(root?.querySelectorAll('.filepond--item') || []).map(el => ({ state: el.getAttribute('data-filepond-item-state'), text: (el.textContent || '').trim() })),
      errors: Array.from(root?.querySelectorAll('[role="alert"],.error,.errors,.field-error,.validation-error') || []).filter(el => {
        const h = el as HTMLElement;
        return !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length) && getComputedStyle(h).visibility !== 'hidden';
      }).map(el => (el.textContent || '').trim()).filter(Boolean),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results: any[] = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const cartRequests: Array<{ method: string; url: string }> = [];
    const cartResponses: Array<{ status: number; url: string }> = [];
    page.on('request', req => {
      if (/\/cart\/(add|change|update)(\.js)?/.test(req.url())) cartRequests.push({ method: req.method(), url: req.url() });
    });
    page.on('response', res => {
      if (/\/cart\/(add|change|update)(\.js)?/.test(res.url())) cartResponses.push({ status: res.status(), url: res.url() });
    });

    await page.goto(`${baseUrl}${productPath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await dismissPopup(page);

    const root = page.locator('#product-content-area');
    const next = () => root.locator('button.btn-next:visible').first();
    const previous = () => root.locator('button.btn-prev:visible').first();
    const clickNext = async () => {
      await dismissPopup(page);
      await next().evaluate(el => el.scrollIntoView({ block: 'center' }));
      await next().evaluate((el: HTMLButtonElement) => el.click());
    };

    // Step 1: preserve the source default Traditional style.
    await dismissPopup(page);
    await clickNext();

    // Step 2: size and frame.
    const size12 = root.locator('label[for]').filter({ hasText: '12x16"', visible: true }).first();
    if (await size12.count()) await size12.click({ force: true });
    await page.waitForTimeout(300);
    await clickNext();

    // Step 3: required house image and personalization.
    await root.locator('input[type="file"][name="properties[House photo]"]').setInputFiles(testFile);
    await waitForPondIdle(page, 1);
    const line1 = root.locator('input[name="properties[Text Line 1]"]');
    const line2 = root.locator('input[name="properties[Text Line 2]"]');
    const notes = root.locator('textarea[name*="Notes for the designer"]');
    await root.evaluate((el, values) => {
      const targets = [
        [el.querySelector<HTMLInputElement>('input[name="properties[Text Line 1]"]'), values.line1],
        [el.querySelector<HTMLInputElement>('input[name="properties[Text Line 2]"]'), values.line2],
        [el.querySelector<HTMLTextAreaElement>('textarea[name*="Notes for the designer"]'), values.notes],
      ] as const;
      for (const [target, value] of targets) if (target) target.value = value;
      for (const [target] of targets) if (target) {
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, { line1: 'Codex Validation', line2: viewport.name, notes: 'Automated replication contract validation only.' });
    await page.waitForTimeout(350);
    const uploadState = await pageEvidence(page);
    await clickNext();
    await page.waitForTimeout(500);

    // Step 4: exercise all conditional add-ons, including a second required upload.
    const extras = root.locator('input[type="checkbox"]:visible');
    const extraCount = await extras.count();
    for (let i = 0; i < extraCount; i += 1) await extras.nth(i).setChecked(true);
    const petUpload = root.locator('input[type="file"][name="properties[Pet photo]"]');
    if (await petUpload.count()) {
      await petUpload.setInputFiles(testFile);
      await waitForPondIdle(page, 2);
    }
    const placement = root.locator('input[name="properties[Pet placement]"], textarea[name="properties[Pet placement]"]').filter({ visible: true });
    if (await placement.count()) await fillStable(placement, 'Front lawn, validation only.');
    await page.waitForTimeout(250);
    const extrasState = await pageEvidence(page);
    await page.screenshot({ path: resolve(outDir, `${viewport.name}-extras.png`), fullPage: false });

    // Source families may either add directly or advance to a review step.
    const toReview = root.getByRole('button', { name: /^add to cart$/i }).filter({ visible: true }).first();
    const firstCartResponsePromise = page.waitForResponse(res => /\/cart\/add(\.js)?/.test(res.url()), { timeout: 20000 }).catch(() => null);
    await dismissPopup(page);
    await toReview.evaluate((el: HTMLButtonElement) => el.click());
    let firstResponse = await firstCartResponsePromise;
    await page.waitForTimeout(1800);
    const reviewState = await pageEvidence(page);
    await page.screenshot({ path: resolve(outDir, `${viewport.name}-review.png`), fullPage: false });

    const readCart = () => page.evaluate(async () => {
      const response = await fetch('/cart.js', { credentials: 'same-origin' });
      return await response.json();
    });
    let cart = await readCart();

    // If this family used an intermediate review state, perform its final add. Never proceed to checkout.
    const finalAdd = root.getByRole('button', { name: /add to cart & shop more/i }).filter({ visible: true }).first();
    if (cart.item_count === 0 && await finalAdd.count()) {
      const finalCartResponsePromise = page.waitForResponse(res => /\/cart\/add(\.js)?/.test(res.url()), { timeout: 20000 }).catch(() => null);
      await dismissPopup(page);
      await finalAdd.evaluate((el: HTMLButtonElement) => el.click());
      firstResponse = firstResponse || await finalCartResponsePromise;
      await page.waitForTimeout(1800);
      cart = await readCart();
    }
    await page.screenshot({ path: resolve(outDir, `${viewport.name}-post-cart.png`), fullPage: false });

    const mainItem = cart.items.find((item: any) => /Custom House Portrait/i.test(item.product_title || item.title || ''));
    const properties = mainItem?.properties || {};
    const assertions = {
      routeWasCorrect: uploadState.pathname === productPath && (!uploadState.canonical || new URL(uploadState.canonical).pathname === productPath),
      mainUploadAccepted: uploadState.pond.length >= 1 && uploadState.pond.every((p: any) => p.state === 'idle'),
      extrasReached: /Any Extras\?/.test(extrasState.text),
      allExtrasSelected: extrasState.checked.filter((c: any) => !c.name).length === 3,
      petUploadAccepted: extrasState.pond.length >= 2 && extrasState.pond.every((p: any) => p.state === 'idle'),
      reviewOrDirectCart: /Review your details/i.test(reviewState.text) || cart.item_count >= 1,
      cartRequestSucceeded: !!firstResponse && firstResponse.status() >= 200 && firstResponse.status() < 300,
      cartHasItems: cart.item_count >= 1 && cart.items.length >= 1,
      mainProductPresent: !!mainItem,
      expectedVariantSelected: /Traditional/.test(mainItem?.variant_title || '') && /12x16/.test(mainItem?.variant_title || ''),
      personalizationPresent: properties['Text Line 1'] === 'Codex Validation' && properties['Text Line 2'] === viewport.name,
      notesPresent: properties['Notes for the designer (optional)'] === 'Automated replication contract validation only.',
      mainUploadPropertyPresent: Object.entries(properties).some(([key, value]) => /house photo/i.test(key) && !!value),
      petUploadPropertyPresent: Object.entries(properties).some(([key, value]) => /pet photo/i.test(key) && !!value),
      petPlacementPresent: properties['Pet placement'] === 'Front lawn, validation only.',
      allAddonItemsPresent: ['Add a pet to your home portrait', 'Digital Download', 'Skip The Line'].every(title => cart.items.some((item: any) => item.product_title === title)),
      noCheckoutVisited: !/\/checkout/i.test(page.url()),
      noHorizontalOverflow: uploadState.horizontalOverflow <= 1 && extrasState.horizontalOverflow <= 1,
    };

    results.push({
      viewport,
      testFile: relative(outDir, testFile).replaceAll('\\', '/'),
      uploadState,
      extrasState,
      reviewState,
      cartRequests,
      cartResponses,
      finalResponse: firstResponse ? { status: firstResponse.status(), url: firstResponse.url() } : null,
      finalUrl: page.url(),
      cart: {
        itemCount: cart.item_count,
        totalPrice: cart.total_price,
        items: cart.items.map((item: any) => ({
          id: item.id,
          productId: item.product_id,
          productTitle: item.product_title,
          variantTitle: item.variant_title,
          quantity: item.quantity,
          finalPrice: item.final_price,
          properties: item.properties,
        })),
      },
      assertions,
    });

    await context.close();
  }
} finally {
  await browser.close();
}

const checks = results.flatMap(result => Object.entries(result.assertions).map(([name, passed]) => ({ viewport: result.viewport.name, name, passed })));
const summary = {
  testedAt: new Date().toISOString(),
  source: `${baseUrl}${productPath}`,
  isolatedAnonymousContexts: true,
  checkoutExecuted: false,
  viewports,
  assertions: {
    total: checks.length,
    passed: checks.filter(check => check.passed).length,
    failed: checks.filter(check => !check.passed),
  },
  status: checks.every(check => check.passed) ? 'passed' : 'failed',
};

await writeFile(resolve(outDir, 'cart-validation-evidence.json'), JSON.stringify({ summary, results }, null, 2), 'utf8');

const report = await readFile(reportPath, 'utf8');
const marker = '<h2>正确阻断</h2>';
const section = `<h2>三端购物车成功路径</h2><p class="${summary.status === 'passed' ? 'ok' : 'warn'}">独立匿名上下文完成 ${summary.assertions.passed}/${summary.assertions.total} 项断言；未进入 checkout。<a href="cart-validation/cart-validation-evidence.json">查看购物车结构化证据</a></p>`;
const existingSection = /<h2>三端购物车成功路径<\/h2><p class="(?:ok|warn)">.*?<\/p>/;
let updated = existingSection.test(report)
  ? report.replace(existingSection, section)
  : report.replace(marker, `${section}${marker}`);
updated = updated.replace(
  /<h2>正确阻断<\/h2><div class="warn">.*?<\/div>/,
  '<h2>安全边界</h2><div class="warn"><p>已验证至匿名购物车并读取 <code>/cart.js</code>；没有进入 checkout、付款、上传主题或发布。</p></div>',
);
await writeFile(reportPath, updated, 'utf8');

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.status === 'passed' ? 0 : 1;
