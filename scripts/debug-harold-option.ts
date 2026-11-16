import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const target = process.argv[2] || 'https://haroldhome.co/products/custom-house-portrait';
await page.goto(target, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await page.evaluate(() => document.querySelectorAll('#attentive_overlay,#attentive_creative,iframe[title*="Sign Up"]').forEach(node => node.remove()));
const snapshot = async (stage: string) => ({
  stage,
  variants: await page.locator('#product-content-area input[type="radio"]').evaluateAll(nodes => nodes.map((node: HTMLInputElement) => ({ id: node.id, name: node.name, value: node.value, checked: node.checked, className: node.className, label: document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent?.trim() }))),
  hiddenId: await page.locator('#product-content-area select[name="id"],#product-content-area input[name="id"]').evaluateAll((nodes: any[]) => nodes.map(node => ({ tag: node.tagName, value: node.value }))),
});
const output: any[] = [await snapshot('before')];
const option = page.locator('#product-content-area input[type="radio"]:not(:checked)').first();
const id = await option.getAttribute('id');
if (id) await page.locator(`#product-content-area label[for=${JSON.stringify(id)}]`).first().evaluate((label: HTMLElement) => label.click());
await page.waitForTimeout(500);
output.push(await snapshot('after-label-dom-click'));
const current = page.locator(`#product-content-area input[id=${JSON.stringify(id)}]`).first();
if (await current.count()) await current.evaluate((node: HTMLInputElement) => { node.checked = true; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(500);
output.push(await snapshot('after-property-and-events'));
const nextButtons = page.locator('#product-content-area button').filter({ hasText: /NEXT/i });
output.push({ stage: 'before-next', next: await nextButtons.evaluateAll((nodes: HTMLButtonElement[]) => nodes.map(node => ({ text: node.textContent?.trim(), disabled: node.disabled, visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length), cls: node.className }))) });
const next = nextButtons.filter({ visible: true }).first();
if (await next.count()) await next.evaluate((node: HTMLButtonElement) => node.click());
await page.waitForTimeout(500);
output.push({ stage: 'after-next', text: await page.locator('#product-content-area').innerText(), next: await nextButtons.evaluateAll((nodes: HTMLButtonElement[]) => nodes.map(node => ({ text: node.textContent?.trim(), disabled: node.disabled, visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length), cls: node.className }))) });
console.log(JSON.stringify(output, null, 2));
await browser.close();
