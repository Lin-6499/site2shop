import { chromium, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = 'https://haroldhome.co';
const outDir = resolve('../haroldhome-replication-20261022-v2/family-recon');
const products = [
  { handle: 'custom-house-portrait', familyHint: 'house-portrait' },
  { handle: 'custom-pop-art', familyHint: 'custom-canvas' },
  { handle: 'custom-watercolor-art-canvas', familyHint: 'custom-canvas' },
  { handle: 'gift-card', familyHint: 'gift-card' },
  { handle: 'bless-this-home-with-love-and-laughter-print', familyHint: 'print' },
  { handle: 'digital-only-files-etsy', familyHint: 'digital' },
  { handle: 'home-state-dad-hat', familyHint: 'hat' },
  { handle: 'home-state-wine-glass', familyHint: 'wine-glass' },
  { handle: 'house-portrait-mug', familyHint: 'house-mug' },
];
const viewports = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

async function stabilize(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.querySelectorAll('#attentive_overlay,#attentive_creative,#gorgias-chat-container,iframe[title*="Sign Up"]').forEach(node => node.remove());
    document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
    document.body.style.setProperty('overflow-y', 'auto', 'important');
    document.body.style.setProperty('position', 'static', 'important');
  });
}

async function inspect(page: Page) {
  return page.evaluate(`(() => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const root = document.querySelector('#product-content-area') || document.querySelector('main');
    const box = root?.getBoundingClientRect();
    const controls = [...(root?.querySelectorAll('input,textarea,select') || [])]
      .filter(visible)
      .map(control => ({
        tag: control.tagName.toLowerCase(),
        type: control instanceof HTMLInputElement ? control.type : control.tagName.toLowerCase(),
        name: control.name || '',
        value: control.value,
        required: control.required,
        checked: control instanceof HTMLInputElement ? control.checked : undefined,
      }));
    const buttons = [...(root?.querySelectorAll('button') || [])]
      .filter(visible)
      .map(button => ({ text: (button.textContent || '').trim().replace(/\s+/g, ' '), type: button.type, className: button.className }));
    return {
      pathname: location.pathname,
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      title: document.title,
      text: (root?.innerText || '').trim().slice(0, 12000),
      controls,
      buttons,
      root: box ? { x: box.x, y: box.y, width: box.width, height: box.height, scrollWidth: root?.scrollWidth, clientWidth: root?.clientWidth } : null,
      reviewSummary: [...document.querySelectorAll('.loox-rating,[data-loox-rating]')].filter(visible).map(node => (node.textContent || '').trim()),
      errors: [...document.querySelectorAll('[role="alert"],.error,.errors,.field-error,.validation-error')].filter(visible).map(node => (node.textContent || '').trim()).filter(Boolean),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results: any[] = [];
try {
  for (const product of products) {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const expectedPath = `/products/${product.handle}`;
      await page.goto(`${baseUrl}${expectedPath}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await stabilize(page);
      const states: any[] = [];
      let priorSignature = '';
      for (let step = 0; step < 5; step += 1) {
        const state = await inspect(page);
        const signature = JSON.stringify({ controls: state.controls.map((item: any) => [item.name, item.type]), buttons: state.buttons.map((item: any) => item.text), errors: state.errors });
        states.push({ step: step + 1, ...state });
        if (step === 0 || signature !== priorSignature)
          await page.screenshot({ path: resolve(outDir, `${product.handle}-${viewport.name}-step-${step + 1}.png`), fullPage: false });
        priorSignature = signature;
        const next = page.locator('#product-content-area button.btn-next, #product-content-area button').filter({ hasText: /next/i, visible: true }).first();
        if (!(await next.count())) break;
        await next.evaluate((button: HTMLButtonElement) => button.click());
        await page.waitForTimeout(450);
        const after = await inspect(page);
        const afterSignature = JSON.stringify({ controls: after.controls.map((item: any) => [item.name, item.type]), buttons: after.buttons.map((item: any) => item.text), errors: after.errors });
        if (afterSignature === signature) {
          states.push({ step: step + 2, transition: 'blocked-or-stable', ...after });
          break;
        }
      }
      results.push({ product, viewport, validRoute: states[0]?.pathname === expectedPath && (!states[0]?.canonical || new URL(states[0].canonical).pathname === expectedPath), states });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const families = products.map(product => {
  const matching = results.filter(result => result.product.handle === product.handle);
  const signatures = matching.map(result => result.states.map((state: any) => ({
    controls: state.controls?.map((item: any) => `${item.type}:${item.name}${item.required ? ':required' : ''}`),
    buttons: state.buttons?.map((item: any) => item.text),
  })));
  return { ...product, threeViewportCoverage: matching.length === 3, signatures };
});
const summary = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: baseUrl,
  viewports,
  products: products.length,
  captures: results.length,
  invalidRoutes: results.filter(result => !result.validRoute).map(result => ({ handle: result.product.handle, viewport: result.viewport.name })),
  horizontalOverflow: results.flatMap(result => result.states.filter((state: any) => state.horizontalOverflow > 1).map((state: any) => ({ handle: result.product.handle, viewport: result.viewport.name, step: state.step, pixels: state.horizontalOverflow }))),
};
await writeFile(resolve(outDir, 'family-recon-evidence.json'), JSON.stringify({ summary, families, results }, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.invalidRoutes.length || summary.horizontalOverflow.length ? 1 : 0;
