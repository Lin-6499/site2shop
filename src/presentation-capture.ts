import type { Page } from "playwright";

export type Anchor = { id: string; selector?: string };
export type PresentationLocator = { id: string; selector: string; parent: Anchor; previous: Anchor; next: Anchor };

// Browser-only code. Selectors/semantic anchors come from reconnaissance, never target success rows.
const OBSERVER = String.raw`(mappings) => {
  const one = (selector, label) => {
    if (typeof selector !== 'string' || !selector) throw Error(label + ': missing selector');
    const nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1) throw Error(label + ': expected one element, found ' + nodes.length);
    return nodes[0];
  };
  const number = (value, label) => {
    if (!/^-?[\d.]+(?:px)?$/.test(value)) throw Error(label + ': unresolved CSS value ' + value);
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n)) throw Error(label + ': nonfinite measurement');
    return n;
  };
  const rect = node => {
    const b = node.getBoundingClientRect();
    return {left:b.left, right:b.right, top:b.top + scrollY, bottom:b.bottom + scrollY, width:b.width, height:b.height};
  };
  const context = {cssViewport:{width:innerWidth,height:innerHeight},documentClientWidth:document.documentElement.clientWidth,
    devicePixelRatio,visualViewportScale:visualViewport ? visualViewport.scale : 1,
    rootZoom:getComputedStyle(document.documentElement).zoom === 'normal' ? 1 : Number(getComputedStyle(document.documentElement).zoom)};
  const boxes = {}, raw = {}, components = {};
  for (const mapping of mappings) {
    if (!mapping.id || boxes[mapping.id]) throw Error('duplicate/missing component ID');
    const el = one(mapping.selector, mapping.id), parent = one(mapping.parent?.selector, mapping.id + '/parent');
    if (!mapping.parent.id || parent === el || !parent.contains(el)) throw Error(mapping.id + ': invalid containing block');
    const anchor = (ref, direction) => {
      if (!ref?.id) throw Error(mapping.id + ': missing ' + direction + ' semantic anchor');
      if (ref.id === 'none') { if (ref.selector) throw Error('none anchor cannot have selector'); return null; }
      const node = one(ref.selector, mapping.id + '/' + direction);
      if (node === el || node.contains(el) || el.contains(node)) throw Error('anchor overlaps measured component');
      const order = el.compareDocumentPosition(node);
      if (!(order & (direction === 'previous' ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING))) throw Error('anchor order mismatch');
      return node;
    };
    const previous = anchor(mapping.previous, 'previous'), next = anchor(mapping.next, 'next');
    const style = getComputedStyle(el), ps = getComputedStyle(parent), b = rect(el), p = rect(parent);
    const pixel = name => number(style[name], mapping.id + '/' + name);
    const pl = p.left + number(ps.borderLeftWidth,'parent border') + number(ps.paddingLeft,'parent padding');
    const pr = p.right - number(ps.borderRightWidth,'parent border') - number(ps.paddingRight,'parent padding');
    const pt = p.top + number(ps.borderTopWidth,'parent border') + number(ps.paddingTop,'parent padding');
    const pb = p.bottom - number(ps.borderBottomWidth,'parent border') - number(ps.paddingBottom,'parent padding');
    let visible = b.width > 0 && b.height > 0;
    for (let node = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) visible = false;
    }
    const nativeScrollbarX = ['scroll','auto'].includes(style.overflowX)
      && (style.overflowX === 'scroll' || el.scrollWidth > el.clientWidth + 1)
      && style.scrollbarWidth !== 'none' && getComputedStyle(el,'::-webkit-scrollbar').display !== 'none'
      && getComputedStyle(el,'::-webkit-scrollbar').height !== '0px';
    const directionalGap = (anchor, direction) => {
      if (!anchor) return 0;
      const a = rect(anchor), epsilon = 1;
      if (direction === 'previous') {
        if (a.right <= b.left + epsilon) return b.left - a.right;
        if (a.bottom <= b.top + epsilon) return b.top - a.bottom;
      } else {
        if (b.right <= a.left + epsilon) return a.left - b.right;
        if (b.bottom <= a.top + epsilon) return a.top - b.bottom;
      }
      return 0;
    };
    boxes[mapping.id] = {
      widthPx:b.width,leftInsetPx:b.left-pl,rightInsetPx:pr-b.right,
      paddingTopPx:pixel('paddingTop'),paddingRightPx:pixel('paddingRight'),paddingBottomPx:pixel('paddingBottom'),paddingLeftPx:pixel('paddingLeft'),
      marginTopPx:pixel('marginTop'),marginRightPx:pixel('marginRight'),marginBottomPx:pixel('marginBottom'),marginLeftPx:pixel('marginLeft'),
      gapBeforePx:directionalGap(previous,'previous'),gapAfterPx:directionalGap(next,'next'),
      visible,placement:{parent:mapping.parent.id,previous:mapping.previous.id,next:mapping.next.id},
      topology:{display:style.display,flow:style.display.includes('flex') ? style.flexDirection : style.display.includes('grid') ? style.gridAutoFlow : 'normal',
        tracks:style.display.includes('grid') ? String(style.gridTemplateColumns.split(/\s+/).length) : 'none'},
      overflow:{x:style.overflowX,y:style.overflowY,nativeScrollbarX}
    };
    raw[mapping.id] = {locator:mapping,box:b,parentBox:p,previousBox:previous ? rect(previous) : null,nextBox:next ? rect(next) : null,
      clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,computed:Object.fromEntries([
        'display','position','width','maxWidth','height','maxHeight','paddingTop','paddingRight','paddingBottom','paddingLeft',
        'marginTop','marginRight','marginBottom','marginLeft','gap','rowGap','columnGap','alignItems','justifyContent',
        'gridTemplateColumns','flexDirection','flexWrap','overflowX','overflowY','fontFamily','fontSize','lineHeight','color','borderRadius'
      ].map(key => [key,style[key]]))};
    components[mapping.id] = {presence:visible ? 'visible' : 'hidden'};
  }
  return {boxes,presentationContext:context,presentationRaw:raw,components};
}`;

export async function capturePresentation(page: Page, mappings: PresentationLocator[]) {
  if (!Array.isArray(mappings) || !mappings.length) throw new Error("Presentation capture requires an independent component locator inventory");
  await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 15000 });
  let previous = "", stable = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const measured = await page.evaluate(`(${OBSERVER})(${JSON.stringify(mappings)})`) as any;
    const signature = JSON.stringify({ boxes: measured.boxes, context: measured.presentationContext });
    stable = signature === previous ? stable + 1 : 0;
    if (stable >= 2) return measured;
    previous = signature;
    await page.waitForTimeout(100);
  }
  throw new Error("Presentation layout did not stabilize; capture is invalid, not a passing baseline");
}
