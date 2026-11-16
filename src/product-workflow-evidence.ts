import type { Page } from "playwright";

export const PRODUCT_SCOPE = '#product-content-area,.s2s-portrait-details,.s2s-family-details,.product__info-container,.product-info,.product-single__meta';

export async function productWorkflowScope(page: Page) {
  const known = page.locator(PRODUCT_SCOPE).filter({ visible: true }).first();
  if (await known.count()) return known;
  const form = page.locator('form[action*="/cart/add"],form[data-product-form]').filter({ visible: true }).first();
  if (!(await form.count())) throw new Error("Product workflow scope is missing; cannot treat an unrelated form as product evidence.");
  return form;
}

export async function inspectProductWorkflow(page: Page): Promise<any> {
  await productWorkflowScope(page);
  return page.evaluate(String.raw`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const root = Array.from(document.querySelectorAll('#product-content-area,.s2s-portrait-details,.s2s-family-details,.product__info-container,.product-info,.product-single__meta')).find(visible)
      || Array.from(document.querySelectorAll('form[action*="/cart/add"],form[data-product-form]')).find(visible);
    if (!root) throw new Error('Product workflow root missing');
    const label = (input) => input.getAttribute('aria-label') || input.labels?.[0]?.textContent?.trim() || '';
    const fields = Array.from(root.querySelectorAll('input,select,textarea')).filter(input => {
      if (input.type === 'hidden') return false;
      const visibleLabels = Array.from(input.labels || []).filter(label => label.getAttribute('aria-hidden') !== 'true' && visible(label));
      // Backing radios used to synchronize composite controls are not customer
      // choices unless a visible label exposes them. Counting their 1px
      // visually-hidden box created false workflow mismatches.
      if (input.type === 'radio') return visibleLabels.length > 0;
      return visible(input) || visibleLabels.length > 0;
    }).map(input => ({ type: input.type, name: input.name, label: label(input), value: input.type === 'file' ? '' : input.value, checked: input.checked, required: input.required, disabled: input.disabled }));
    const buttons = Array.from(root.querySelectorAll('button,[role="button"]')).filter(visible).map(element => ({
      text: element.getAttribute('aria-label') || element.textContent?.trim() || '',
      from: element.getAttribute('data-hide-step'), to: element.getAttribute('data-show-step'),
    }));
    const steps = Array.from(root.querySelectorAll('[data-show-step]')).map(element => ({from: element.getAttribute('data-hide-step'), to: element.getAttribute('data-show-step')}));
    return {
      text: root.innerText,
      headings: Array.from(root.querySelectorAll('h2,h3,h4,legend')).filter(visible).map(element => element.textContent?.trim()),
      fields, buttons, declaredTransitions: steps,
      variantId: root.querySelector('input[name="id"]')?.value || null,
      nextPresent: buttons.some(button => /^next(?:\s*[→➜-])?$/i.test(button.text)),
      previousPresent: buttons.some(button => /^(previous|back|←)$/i.test(button.text)),
      validationError: /please add all required information|required photo|choose a.*photo/i.test(root.innerText),
    };
  })()`);
}

export function compareWorkflowState(source: any, target: any) {
  if (!source || !target) return { passed: false, reasons: ["workflow state evidence missing"] };
  const normalize = (value: string) => String(value || '').toLowerCase().replace(/&quot;?/g, '"').replace(/\s+/g, ' ').trim();
  const visibleChoice = (field: any, includeMoney = true) => {
    const value = normalize(field.value);
    const label = normalize(field.label);
    if (field.type === 'radio') return value && value !== 'on' ? value : label.replace(/\+?\$\s*\d+(?:\.\d{2})?/g, '').trim();
    const moneyText = label.match(/\$\s*\d+(?:\.\d{2})?/i)?.[0] || '';
    const money = moneyText ? `$${Number(moneyText.replace(/[^\d.]/g, '')).toFixed(2)}` : '';
    const title = label.split(/\$\s*\d+(?:\.\d{2})?/i)[0].trim();
    return includeMoney ? `${title}:${money}` : title;
  };
  // Radio DOM names are implementation details (e.g. source option-color vs target s2s-option-1).
  // Compare visible choices instead; personalization names remain part of the submitted contract.
  const signature = (field: any) => field.type === 'radio'
    // Radio values are frequently implementation plumbing (the source framing
    // toggle even uses the same `on` value for both choices). The rendered
    // label is the user-facing contract and is stable across implementations.
    ? `radio:${visibleChoice(field)}:${Boolean(field.required)}`
    : field.type === 'file'
      // File input names are platform plumbing (many app-rendered sources omit
      // them entirely). Compare the rendered control and validate the required
      // upload through the observed Next transition instead.
      ? 'file'
      : field.type === 'checkbox'
        // App implementations often append help copy to the same label. The
        // customer-facing checkbox title and price are the stable contract.
        ? `checkbox:${visibleChoice(field, false)}:${Boolean(field.required)}`
        : field.type === 'text' || field.type === 'textarea'
          // Shopify line-item property names vary between app plumbing
          // (`Pet Name 1`) and native theme forms (`Pet Name`). Preserve the
          // number of visible text controls and their requiredness here; cart
          // property names are asserted separately by the commerce contract.
          ? `text:${Boolean(field.required)}`
          : field.type === 'select-one'
            // The select name is theme/app plumbing. The visible label and
            // enabled option set are asserted by the option-select contract.
            ? `select-one:${normalize(field.label)}:${Boolean(field.required)}`
          : `${field.type}:${normalize(field.name)}:${Boolean(field.required)}`;
  const sourceFields = (source.fields || []).map(signature).sort();
  const targetFields = (target.fields || []).map(signature).sort();
  const checkboxData = (state: any) => (state.fields || [])
    .filter((field: any) => field.type === 'checkbox')
    .map((field: any) => visibleChoice(field, true)).sort();
  const sourceCheckboxData = checkboxData(source);
  const targetCheckboxData = checkboxData(target);
  const reasons: string[] = [];
  if (JSON.stringify(sourceFields) !== JSON.stringify(targetFields)) reasons.push('visible fields/options/requiredness differ');
  if (source.nextPresent !== target.nextPresent) reasons.push('next-step availability differs');
  if (source.previousPresent !== target.previousPresent) reasons.push('previous-step availability differs');
  if (source.validationError !== target.validationError) reasons.push('validation state differs');
  return {
    passed: !reasons.length,
    reasons,
    sourceFields,
    targetFields,
    businessDataDifferences: JSON.stringify(sourceCheckboxData) === JSON.stringify(targetCheckboxData)
      ? []
      : [{ kind: 'addon-price', source: sourceCheckboxData, target: targetCheckboxData }],
  };
}

/** A rejected or unvisited Next edge is not evidence of a completed workflow. */
export function assessCapturedWorkflowPath(states: any[] | undefined) {
  if (!states?.length) return { passed: false, reason: 'workflow evidence missing' };
  const path = states.filter(state => state.state === 'initial' || state.state === 'variant' || /^(?:blocked-)?step-\d+$/.test(state.state));
  if (!path.length || path.some(state => !state.data?.workflow)) return { passed: false, reason: 'workflow state data missing' };
  if (path.some(state => state.state.startsWith('blocked-')))
    return { passed: false, reason: 'required-input rejection captured; downstream success path remains untested' };
  if (path[path.length - 1].data.workflow.nextPresent)
    return { passed: false, reason: 'a rendered Next edge was not traversed; do not interpret locator failure as a terminal step' };
  return { passed: true, reason: 'reachable Next path ended; this is not proof of uploads, reverse transitions or cart submission' };
}
