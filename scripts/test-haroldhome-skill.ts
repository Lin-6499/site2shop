import { chromium, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const baseUrl = 'https://haroldhome.co';
const outDir = resolve('../haroldhome-skill-test-20261022');
const viewports = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const routes = {
  home: '/',
  collection: '/collections/custom-home-products',
  product: '/products/custom-house-portrait',
};

type RecordValue = Record<string, unknown>;

async function dismissNonEssential(page: Page) {
  for (const selector of [
    '#onetrust-accept-btn-handler',
    'button:has-text("Accept")',
    'button:has-text("Close")',
  ]) {
    const button = page.locator(selector).filter({ visible: true }).first();
    if (await button.count()) await button.click({ timeout: 1000 }).catch(() => undefined);
  }
}

async function routeEvidence(page: Page, expectedPath: string): Promise<RecordValue> {
  return await page.evaluate((expected) => {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '';
    const bodyText = document.body.innerText;
    const challenge = /password|captcha|challenge/i.test(location.pathname) ||
      /enter using password|verify you are human|captcha/i.test(bodyText.slice(0, 1500));
    const horizontalOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return {
      expectedPath: expected,
      pathname: location.pathname,
      canonical,
      title: document.title,
      validRoute: location.pathname === expected && (!canonical || new URL(canonical).pathname === expected),
      challenge,
      horizontalOverflow,
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
    };
  }, expectedPath);
}

async function rectAndStyle(page: Page, selector: string) {
  return await page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      selector,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      style: {
        display: s.display,
        position: s.position,
        gridTemplateColumns: s.gridTemplateColumns,
        flexDirection: s.flexDirection,
        gap: s.gap,
        overflowX: s.overflowX,
        padding: s.padding,
        margin: s.margin,
      },
    };
  }).catch(() => null);
}

async function visibleProductState(page: Page) {
  return await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#product-content-area');
    const fields = Array.from(root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') || [])
      .filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({
        tag: el.tagName,
        type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
        name: el.getAttribute('name') || '',
        value: el.value,
        checked: el instanceof HTMLInputElement ? el.checked : undefined,
        required: el.hasAttribute('required'),
      }));
    const buttons = Array.from(root?.querySelectorAll<HTMLButtonElement>('button') || [])
      .filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({ text: (el.textContent || '').trim(), className: el.className }));
    const r = root?.getBoundingClientRect();
    return {
      text: (root?.innerText || '').trim(),
      fields,
      buttons,
      rootRect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      rootOverflow: root ? { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth } : null,
      selectedVariant: (root?.querySelector<HTMLSelectElement>('select[name="id"]')?.value || ''),
      reviewSummary: (document.querySelector('[data-loox-rating]')?.textContent || '').trim(),
      visibleErrors: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"],.error,.errors,.field-error,.validation-error'))
        .filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden')
        .map((el) => (el.textContent || '').trim()).filter(Boolean),
    };
  });
}

async function shot(page: Page, name: string, selector?: string) {
  const path = resolve(outDir, `${name}.png`);
  if (selector && await page.locator(selector).count()) {
    await page.locator(selector).first().screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage: false });
  }
  return relative(outDir, path).replaceAll('\\', '/');
}

const browser = await chromium.launch({ headless: true });
const results: RecordValue[] = [];

try {
  await mkdir(outDir, { recursive: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    // Homepage reconnaissance plus a real accordion transition.
    await page.goto(`${baseUrl}${routes.home}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissNonEssential(page);
    const homeRoute = await routeEvidence(page, routes.home);
    const homeInitial = await shot(page, `${viewport.name}-home-initial`);
    const faqButton = page.locator('button').filter({ hasText: /how|what|can|do you/i, visible: true }).first();
    let faqTransition: RecordValue = { discovered: false };
    if (await faqButton.count()) {
      const before = await faqButton.getAttribute('aria-expanded');
      const label = (await faqButton.innerText()).trim();
      await faqButton.click();
      await page.waitForTimeout(250);
      faqTransition = { discovered: true, label, before, after: await faqButton.getAttribute('aria-expanded') };
    }
    results.push({ family: 'home', viewport, route: homeRoute, screenshot: homeInitial, faqTransition,
      layout: [await rectAndStyle(page, 'header'), await rectAndStyle(page, 'main'), await rectAndStyle(page, '#looxReviewsFrame')] });

    // Collection evidence including card rating/provider placement.
    await page.goto(`${baseUrl}${routes.collection}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const collectionRoute = await routeEvidence(page, routes.collection);
    const cardFacts = await page.evaluate(() => ({
      productLinks: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/products/"]')).map(a => a.pathname).filter((v, i, a) => a.indexOf(v) === i),
      looxBadges: document.querySelectorAll('[data-loox-rating],.loox-rating').length,
      visibleRatingText: Array.from(document.querySelectorAll<HTMLElement>('[data-loox-rating],.loox-rating')).filter(el => el.offsetParent !== null).map(el => (el.textContent || '').trim()),
    }));
    results.push({ family: 'collection', viewport, route: collectionRoute,
      screenshot: await shot(page, `${viewport.name}-collection-initial`), cardFacts,
      layout: [await rectAndStyle(page, 'main'), await rectAndStyle(page, '.product-grid'), await rectAndStyle(page, '.collection')] });

    // Product state graph: initial -> step 2 -> changed option -> step 3 -> rejected required path -> previous.
    await page.goto(`${baseUrl}${routes.product}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissNonEssential(page);
    const productRoute = await routeEvidence(page, routes.product);
    const initial = await visibleProductState(page);
    const initialShot = await shot(page, `${viewport.name}-product-step-1`, '#product-content-area');
    const gallery = await rectAndStyle(page, '.product-media, .product-gallery, [class*="product-media"]');
    const productPanel = await rectAndStyle(page, '#product-content-area');

    const next = () => page.locator('#product-content-area button.btn-next').filter({ visible: true }).first();
    const previous = () => page.locator('#product-content-area button.btn-prev').filter({ visible: true }).first();
    await next().click();
    await page.waitForTimeout(250);
    const step2 = await visibleProductState(page);
    const step2Shot = await shot(page, `${viewport.name}-product-step-2`, '#product-content-area');

    const sizeLabel = page.locator('#product-content-area label[for]').filter({ hasText: '12x16"', visible: true }).first();
    const variantBefore = (step2 as any).selectedVariant;
    if (await sizeLabel.count()) await sizeLabel.click();
    await page.waitForTimeout(300);
    const changed = await visibleProductState(page);
    const variantAfter = (changed as any).selectedVariant;

    await next().click();
    await page.waitForTimeout(250);
    const step3 = await visibleProductState(page);
    const step3Shot = await shot(page, `${viewport.name}-product-step-3`, '#product-content-area');
    await next().click();
    await page.waitForTimeout(250);
    const rejected = await visibleProductState(page);
    const rejectedShot = await shot(page, `${viewport.name}-product-required-rejected`, '#product-content-area');
    await previous().click();
    await page.waitForTimeout(250);
    const returned = await visibleProductState(page);

    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(100);
    const scrollBefore = await page.locator('#product-content-area').first().evaluate((el) => ({
      top: el.getBoundingClientRect().top,
      position: getComputedStyle(el).position,
    }));
    await page.evaluate(() => scrollTo(0, 350));
    await page.waitForTimeout(100);
    const scrollAfter = await page.locator('#product-content-area').first().evaluate((el) => el.getBoundingClientRect().top);
    const scrollContract = { position: scrollBefore.position, beforeTop: scrollBefore.top, afterTop: scrollAfter, delta: scrollAfter - scrollBefore.top };

    results.push({
      family: 'product-house-portrait', viewport, route: productRoute,
      screenshots: { initial: initialShot, step2: step2Shot, step3: step3Shot, rejected: rejectedShot },
      layout: { gallery, productPanel, scrollContract },
      workflow: {
        initial, step2, changed, step3, rejected, returned,
        assertions: {
          step2Reached: /Size:/.test((step2 as any).text || ''),
          sizeChanged: (changed as any).fields?.some((f: any) => f.name === 'option-choose-a-size' && f.value === '12x16"' && f.checked),
          variantChanged: !!variantBefore && !!variantAfter && variantBefore !== variantAfter,
          uploadStepReached: (step3 as any).fields?.some((f: any) => f.name === 'properties[House photo]' && f.required),
          requiredPathRejected: (rejected as any).visibleErrors?.some((t: string) => /required information/i.test(t)),
          previousRetainsSize: (returned as any).fields?.some((f: any) => f.name === 'option-choose-a-size' && f.value === '12x16"' && f.checked),
          noPanelOverflow: (rejected as any).rootOverflow?.scrollWidth <= (rejected as any).rootOverflow?.clientWidth,
        },
      },
      blockedByAuthority: ['successful required-file upload', 'post-upload add-on state', 'add to cart / checkout'],
    });

    await context.close();
  }
} finally {
  await browser.close();
}

const assertions = results.flatMap((r: any) => r.workflow ? Object.entries(r.workflow.assertions).map(([name, passed]) => ({ viewport: r.viewport.name, name, passed })) : []);
const invalidRoutes = results.filter((r: any) => !r.route.validRoute || r.route.challenge);
const horizontalOverflow = results.filter((r: any) => Number(r.route.horizontalOverflow) > 1).map((r: any) => ({ family: r.family, viewport: r.viewport.name, pixels: r.route.horizontalOverflow }));
const summary = {
  testedAt: new Date().toISOString(),
  source: baseUrl,
  platform: { name: 'Shopify', confidence: 'high', evidence: ['Shopify runtime/CDN', 'product variant form structure'] },
  reviews: { provider: 'Loox', confidence: 'high', evidence: ['loox.io iframe', 'data-loox-rating badges'] },
  routes: routes,
  viewports,
  resultCount: results.length,
  assertions: { total: assertions.length, passed: assertions.filter(a => a.passed).length, failed: assertions.filter(a => !a.passed) },
  invalidRoutes,
  horizontalOverflow,
  completion: 'blocked',
  blockers: [
    'A complete successful product workflow requires a real file upload; no upload was performed without explicit user confirmation.',
    'Add-to-cart and checkout were intentionally not executed because this was a source-site capture test, not a transaction request.',
  ],
};

await writeFile(resolve(outDir, 'evidence.json'), JSON.stringify({ summary, results }, null, 2), 'utf8');
const rows = results.map((r: any) => `<tr><td>${r.family}</td><td>${r.viewport.name}</td><td>${r.route.validRoute && !r.route.challenge ? '有效' : '无效'}</td><td>${r.route.horizontalOverflow}px</td><td>${r.screenshot ? `<a href="${r.screenshot}">截图</a>` : Object.entries(r.screenshots || {}).map(([k,v]) => `<a href="${v}">${k}</a>`).join(' · ')}</td></tr>`).join('');
const failures = assertions.filter(a => !a.passed).map(a => `<li>${a.viewport}: ${a.name}</li>`).join('') || '<li>安全范围内无断言失败</li>';
const html = `<!doctype html><meta charset="utf-8"><title>Harold Home — shopify-site-replication SKILL 测试</title><style>body{font:15px/1.55 system-ui;max-width:1200px;margin:32px auto;padding:0 20px;color:#17262a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:9px;text-align:left}.ok{color:#176b43}.warn{background:#fff4df;padding:14px}code{background:#f2f4f4;padding:2px 5px}</style><h1>Harold Home：优化后 SKILL 实站测试</h1><p>平台：Shopify（高置信） · 评论：Loox（高置信） · ${summary.testedAt}</p><p class="${assertions.every(a=>a.passed)&&!invalidRoutes.length?'ok':'warn'}">三端安全范围断言 ${summary.assertions.passed}/${summary.assertions.total} 通过；路由无效 ${invalidRoutes.length}；可见横向溢出 ${horizontalOverflow.length} 处。</p><h2>采集范围</h2><table><tr><th>页面族</th><th>视口</th><th>路由证据</th><th>横向溢出</th><th>截图</th></tr>${rows}</table><h2>商品工作流</h2><p>实际执行：初始风格 → NEXT → 尺寸/边框 → 12x16 规格切换 → NEXT → 必填上传 → 空提交拒绝 → Previous 返回并验证状态保留。</p><ul>${failures}</ul><h2>正确阻断</h2><div class="warn"><p>本次没有上传文件，也没有加入购物车。完整成功路径仍应判为 <strong>blocked</strong>，不能伪装成通过。</p><ul>${summary.blockers.map(b=>`<li>${b}</li>`).join('')}</ul></div><p><a href="evidence.json">查看完整结构化证据</a></p>`;
await writeFile(resolve(outDir, 'report.html'), html, 'utf8');
console.log(JSON.stringify(summary, null, 2));
process.exitCode = assertions.some(a => !a.passed) || invalidRoutes.length ? 1 : 0;
