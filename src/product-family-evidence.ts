import { chromium, type Page } from "playwright";
import pixelmatch from "pixelmatch";
import sharp from "sharp";
import { join } from "node:path";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { publicDnsBrowserArgs, publicUrl } from "./network.js";
import { json, write, readJson, pool, hash } from "./util.js";
import { productWorkflowScope, inspectProductWorkflow, compareWorkflowState, assessCapturedWorkflowPath } from "./product-workflow-evidence.js";
import { loadProductFamilyContracts } from "./product-family-contracts.js";
import { REQUIRED_VIEWPORTS } from "./types.js";
import { assertRenderedEvidencePage, assertRenderedEvidenceRoute, renderedEvidenceRejection } from "./rendered-page-validity.js";
import { unlockStorefrontIfNeeded } from "./storefront-auth.js";
import { compareOptionSelects } from "./option-control-contracts.js";
import { executableEvidenceCheck } from "./evidence-gate.js";
import { inventoryOptionGroups, selectObservedOption } from "./option-probes.js";
import { assertAgentVisualReview } from "./agent-visual-review.js";

const viewports = REQUIRED_VIEWPORTS;

export const PRODUCT_EVIDENCE_SCHEMA_VERSION = 2;
export const PRODUCT_EVIDENCE_CONTRACT_VERSION = "product-component-workflow-v5";
export const PRODUCT_EVIDENCE_COLLECTOR_VERSION = "5.2.0";

export function reviewPlacementRequired(surface: "product-summary" | "product-widget", component: any) {
  return Boolean(
    component?.present
    && component?.visible
    && (surface === "product-widget" || !component?.empty),
  );
}

export function hasCurrentProductEvidenceState(data: any) {
  return Boolean(
    data?.evidence?.schemaVersion === PRODUCT_EVIDENCE_SCHEMA_VERSION
    && data?.evidence?.contractVersion === PRODUCT_EVIDENCE_CONTRACT_VERSION
    && data?.evidence?.collectorVersion === PRODUCT_EVIDENCE_COLLECTOR_VERSION
    && Array.isArray(data?.workflow?.fields)
    && Array.isArray(data?.optionSelects)
    && typeof data?.workflow?.nextPresent === 'boolean'
    && data?.layout?.informationColumn?.metric
    && data?.layout?.informationColumn?.scroll?.mode
    && data.layout.informationColumn.scroll.mode !== "invalid-scroll-lock",
  );
}

export function hasCurrentProductEvidenceReport(report: any) {
  return Boolean(
    report?.schemaVersion === PRODUCT_EVIDENCE_SCHEMA_VERSION
    && report?.contractVersion === PRODUCT_EVIDENCE_CONTRACT_VERSION
    && report?.collectorVersion === PRODUCT_EVIDENCE_COLLECTOR_VERSION,
  );
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(400);
}

async function hydrateRenderedReviews(page: Page) {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const height = Math.min(document.documentElement.scrollHeight, 40000);
    for (let y = 0; y < height; y += Math.max(900, innerHeight * 1.25)) {
      scrollTo({ top: y, behavior: "instant" });
      await delay(50);
    }
    const review = document.querySelector(
      '#looxReviews,#loox-reviews-feed,.loox-widget,[data-loox-aggregate],iframe[title*="review" i],iframe[src*="loox" i]',
    );
    review?.scrollIntoView({ block: "center", behavior: "instant" });
    await delay(300);
    scrollTo({ top: 0, behavior: "instant" });
    const releaseMarketingScrollLock = () => {
      const overlays = [...document.querySelectorAll(
        '#attentive_overlay,#attentive_creative,#gorgias-chat-container,#PBarNextFrame,iframe[title*="Sign Up"]',
      )];
      const productInformation = document.querySelector<HTMLElement>(
        "#product-content-area,.s2s-family-details,.s2s-portrait-details,.product__info-container,.product-info,.product-single__meta",
      );
      const productDisplaced = Boolean(productInformation && Math.abs(productInformation.getBoundingClientRect().top) > innerHeight);
      const documentLocked = [getComputedStyle(document.documentElement).overflowY, getComputedStyle(document.body).overflowY].includes("hidden")
        || ["fixed", "absolute"].includes(getComputedStyle(document.body).position);
      if (!overlays.length && !(productDisplaced && documentLocked)) return;
      const lockedTop = Number.parseFloat(document.body.style.top || "0");
      overlays.forEach((node) => node.remove());
      for (const node of [document.documentElement, document.body]) {
        node.style.setProperty("overflow", "visible", "important");
        node.style.setProperty("overflow-y", "auto", "important");
        node.style.setProperty("height", "auto", "important");
        node.style.setProperty("position", "static", "important");
        node.style.setProperty("top", "auto", "important");
        node.style.setProperty("inset", "auto", "important");
        node.style.removeProperty("touch-action");
        node.scrollTop = 0;
      }
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      if (lockedTop < 0) scrollTo({ top: -lockedTop, behavior: "instant" });
      scrollTo({ top: 0, behavior: "instant" });
    };
    releaseMarketingScrollLock();
    if (!(window as any).__s2sMarketingUnlockTimer)
      (window as any).__s2sMarketingUnlockTimer = window.setInterval(releaseMarketingScrollLock, 100);
    await delay(200);
  }).catch(() => {});
  await settle(page);
  await releaseMarketingScrollLock(page);
}

async function releaseMarketingScrollLock(page: Page) {
  await page.evaluate(() => {
    const overlays = [...document.querySelectorAll(
      '#attentive_overlay,#attentive_creative,#gorgias-chat-container,#PBarNextFrame,iframe[title*="Sign Up"]',
    )];
    const information = document.querySelector<HTMLElement>(
      "#product-content-area,.s2s-family-details,.s2s-portrait-details,.product__info-container,.product-info,.product-single__meta",
    );
    const displaced = Boolean(information && Math.abs(information.getBoundingClientRect().top) > innerHeight);
    const locked = [getComputedStyle(document.documentElement).overflowY, getComputedStyle(document.body).overflowY].includes("hidden")
      || ["fixed", "absolute"].includes(getComputedStyle(document.body).position);
    if (!overlays.length && !(displaced && locked)) return;
    overlays.forEach((node) => node.remove());
    for (const node of [document.documentElement, document.body]) {
      node.style.cssText += ";overflow:visible!important;overflow-y:auto!important;height:auto!important;position:static!important;top:auto!important;inset:auto!important";
      node.scrollTop = 0;
    }
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(200);
}

async function inspect(page: Page) {
  return page.evaluate(`(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const metric = element => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(), id: element.id || null, className: String(element.className || ''),
        box: { x: box.x, y: box.y, top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height },
        clientWidth: element.clientWidth, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
        computed: { display: style.display, position: style.position, overflowX: style.overflowX, overflowY: style.overflowY,
          gap: style.gap, rowGap: style.rowGap, columnGap: style.columnGap, alignItems: style.alignItems,
          justifyContent: style.justifyContent, gridTemplateColumns: style.gridTemplateColumns, flexDirection: style.flexDirection,
          flexWrap: style.flexWrap, width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
          height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight,
          padding: style.padding, margin: style.margin, borderRadius: style.borderRadius, blockSize: style.blockSize,
          inlineSize: style.inlineSize, transform: style.transform, color: style.color, backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
          textAlign: style.textAlign, whiteSpace: style.whiteSpace, visibility: style.visibility, opacity: style.opacity }
      };
    };
    const relation = (element, container) => {
      if (!element || !container) return null;
      const box = element.getBoundingClientRect(), parent = container.getBoundingClientRect();
      return {
        parent: metric(container),
        offsetLeft: box.left - parent.left,
        offsetTop: box.top - parent.top,
        offsetRight: parent.right - box.right,
        offsetBottom: parent.bottom - box.bottom,
        widthRatio: parent.width ? box.width / parent.width : null,
        heightRatio: parent.height ? box.height / parent.height : null,
        sharedLeft: Math.abs(box.left - parent.left) <= 1,
        sharedRight: Math.abs(box.right - parent.right) <= 1
      };
    };
    const first = selectors => selectors.map(selector => document.querySelector(selector)).find(Boolean) || null;
    const thumbViewport = first(['[data-family-thumbs-viewport]','[data-portrait-thumbs-viewport]','.thumbs-splide .splide__track','#splide01-track']);
    const thumbTrack = thumbViewport?.querySelector('[data-family-thumbs-track],[data-portrait-thumbs-track],.splide__list') || first(['[data-family-thumbs-track]','[data-portrait-thumbs-track]']);
    const thumbItems = Array.from((thumbTrack || thumbViewport || document).querySelectorAll('[data-family-thumb],[data-portrait-thumb],.splide__slide')).filter(visible);
    const quantity = document.querySelector('input[name="quantity"]');
    const galleryStage = first(['.s2s-harold-stage','.s2s-family-stage','.s2s-portrait-stage','.product-main-splide .splide__track','.product__media-wrapper']);
    const galleryArrows = Array.from(document.querySelectorAll('[data-family-previous],[data-family-next],[data-portrait-previous],[data-portrait-next],.thumbs-splide .splide__arrow')).filter(visible);
    const radioLabels = Array.from(document.querySelectorAll('label')).filter(label => {
      const id = label.getAttribute('for');
      const input = id ? document.getElementById(id) : label.querySelector('input');
      return input?.getAttribute('type') === 'radio' && label.getAttribute('aria-hidden') !== 'true' && visible(label);
    });
    const informationColumn = first(['#product-content-area','.s2s-family-details','.s2s-portrait-details','.product__info-container','.product-info','.product-single__meta']);
    const purchase = quantity?.closest('.s2s-family-purchase,.product-form__buttons,.d-flex') || quantity?.parentElement;
    const submit = purchase?.querySelector('button[type="submit"],input[type="submit"]') || quantity?.closest('form')?.querySelector('button[type="submit"],input[type="submit"]');
    const thumbViewportMetric = metric(thumbViewport), quantityMetric = metric(quantity), submitMetric = metric(submit);
    const ratingNodes = Array.from(document.querySelectorAll('.loox-rating,[data-rating][data-raters],[data-s2s-product-rating],.s2s-home-card-rating,.s2s-collection-card__rating,.jdgm-prev-badge,.yotpo-bottomline,.okeReviews-reviewsSummary'));
    const cardSelector = '.product-item,.product-list-item,.product-card,.card-product,.card-wrapper,[data-product-card],[data-s2s-collection-card],.s2s-collection-card,li.grid__item,.grid-product';
    const reviewWidgetSelector = '#looxReviews,#loox-reviews-feed,.loox-widget,.jdgm-review-widget,.yotpo-main-widget,.okeReviews-widget-holder';
    const productCardFor = element => {
      const card = element?.closest(cardSelector);
      if (!card) return null;
      const link = card.matches('a[href*="/products/"]') ? card : card.querySelector('a[href*="/products/"]');
      return link ? card : null;
    };
    const widgetRoot = first(['#looxReviews','#loox-reviews-feed','.loox-widget','[data-loox-aggregate]','.jdgm-review-widget','.yotpo-main-widget','.okeReviews-widget-holder']);
    const widgetFrame = first(['#looxReviewsFrame','iframe[title*="review" i]','iframe[src*="loox" i]','iframe[src*="judge.me" i]','iframe[src*="yotpo" i]']);
    const productSummary = ratingNodes.find(element => !productCardFor(element) && !element.closest(reviewWidgetSelector)) || null;
    const cardRatings = ratingNodes.filter(element => element !== productSummary && !element.closest(reviewWidgetSelector) && Boolean(productCardFor(element)));
    const summaryContainer = productSummary?.closest('form,[data-product-form],.product__info-container,.product-info,.product-single__meta,.s2s-family-info,.s2s-family-details,.s2s-portrait-info,.s2s-portrait-details') || productSummary?.parentElement;
    const widgetContainer = widgetRoot?.closest('.shopify-section,section,main') || widgetRoot?.parentElement;
    const cardEntries = cardRatings.slice(0, 24).map((element, index) => {
      const card = productCardFor(element) || element.parentElement;
      return {
        index,
        rating: metric(element),
        card: metric(card),
        relation: relation(element, card),
        ratingValue: element.getAttribute('data-rating'),
        ratingCount: element.getAttribute('data-raters'),
        empty: !(element.textContent || '').trim() && !element.getAttribute('data-rating')
      };
    });
    const scriptUrls = Array.from(document.scripts).map(script => script.src).filter(Boolean);
    const frameUrls = Array.from(document.querySelectorAll('iframe[src]')).map(frame => frame.src).filter(Boolean);
    const documentWidth = document.documentElement.clientWidth;
    const overflowingElements = Array.from(document.querySelectorAll('body *')).filter(visible).map(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { tag: element.tagName.toLowerCase(), id: element.id || null, className: String(element.className || ''),
        box: { left: box.left, right: box.right, width: box.width }, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        overflowX: style.overflowX, position: style.position, transform: style.transform };
    }).filter(item => item.box.left < -1 || item.box.right > documentWidth + 1).sort((a, b) => b.box.right - a.box.right).slice(0, 24);
    const provider = scriptUrls.concat(frameUrls).some(url => /loox/i.test(url)) || document.querySelector('.loox-rating,#looxReviews') ? 'loox'
      : scriptUrls.concat(frameUrls).some(url => /judge\.me|judgeme/i.test(url)) || document.querySelector('.jdgm-prev-badge,.jdgm-review-widget') ? 'judge_me'
      : scriptUrls.concat(frameUrls).some(url => /yotpo/i.test(url)) || document.querySelector('.yotpo-bottomline,.yotpo-main-widget') ? 'yotpo'
      : scriptUrls.concat(frameUrls).some(url => /okendo|okeReviews/i.test(url)) || document.querySelector('.okeReviews-reviewsSummary,.okeReviews-widget-holder') ? 'okendo'
      : null;
    return {
      title: document.title,
      optionSelects: Array.from((informationColumn || document).querySelectorAll('select')).filter(visible).map(element => ({
        key: String(element.closest('[data-s2s-option-name]')?.getAttribute('data-s2s-option-name') || element.labels?.[0]?.textContent || element.name || element.id).toLowerCase().replace(/^option[-_ ]*/, '').replace(/[-_:]+/g, ' ').replace(/\\s+/g, ' ').trim(),
        tag: element.tagName.toLowerCase(), multiple: element.multiple, disabled: element.disabled,
        options: Array.from(element.options).map(option => ({ value: option.value, disabled: option.disabled })),
        metric: metric(element)
      })),
      visibleText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim(),
      fields: Array.from(document.querySelectorAll('input,select,textarea,button')).filter(visible).map(element => ({
        tag: element.tagName.toLowerCase(), type: element.type || null, name: element.name || null,
        value: element.value || null, required: Boolean(element.required), accept: element.accept || null,
        max: element.max || null, min: element.min || null,
        checked: 'checked' in element ? Boolean(element.checked) : null,
        text: (element.innerText || (element.labels && element.labels[0] && element.labels[0].innerText) || '').trim()
      })),
      sections: Array.from(document.querySelectorAll('main .shopify-section,main section,[role=main] section')).filter(visible).map(element => ({
        id: element.id || null, text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300)
      })),
      layout: {
        document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, overflowingElements },
        informationColumn: { metric: metric(informationColumn), relation: relation(informationColumn, informationColumn?.parentElement) },
        thumbnails: { viewport: thumbViewportMetric, track: metric(thumbTrack), count: thumbItems.length, items: thumbItems.slice(0, 8).map(metric),
          nativeHorizontalScrollbar: Boolean(thumbViewportMetric && thumbViewportMetric.scrollWidth > thumbViewportMetric.clientWidth + 1 && ['auto','scroll'].includes(thumbViewportMetric.computed.overflowX)) },
        gallery: {
          stage: metric(galleryStage), arrows: galleryArrows.map(metric),
          arrowRegion: galleryArrows.length && thumbViewport
            ? galleryArrows.every(arrow => {
                const center = arrow.getBoundingClientRect().top + arrow.getBoundingClientRect().height / 2;
                const box = thumbViewport.getBoundingClientRect();
                return center >= box.top - 4 && center <= box.bottom + 4;
              }) ? 'thumbnails' : 'stage'
            : galleryArrows.length ? 'unknown' : 'none'
        },
        controls: {
          radioLabels: radioLabels.map(label => ({
            text: (label.textContent || '').replace(/\s+/g,' ').trim(),
            value: (() => { const id = label.getAttribute('for'); const input = id ? document.getElementById(id) : label.querySelector('input'); return input?.value || null; })(),
            metric: metric(label),
            image: metric(label.querySelector('img')),
            treatment: (() => {
              const node = label.querySelector('img,[class*="swatch"],[class*="visual"],[class*="color"]');
              if (!node) return null;
              const style = getComputedStyle(node), box = node.getBoundingClientRect();
              return { present: box.width > 0 && box.height > 0, image: node.tagName === 'IMG', backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
            })(),
          }))
        },
        purchase: { row: metric(purchase), quantity: quantityMetric, submit: submitMetric,
          heightDelta: quantityMetric && submitMetric ? Math.abs(quantityMetric.box.height - submitMetric.box.height) : null,
          bottomDelta: quantityMetric && submitMetric ? Math.abs(quantityMetric.box.bottom - submitMetric.box.bottom) : null },
        reviews: {
          provider: {
            name: provider,
            confidence: provider ? 'high' : 'unknown',
            scriptOrigins: [...new Set(scriptUrls.filter(url => /loox|judge\.me|judgeme|yotpo|okendo|okeReviews/i.test(url)).map(url => { try { return new URL(url).origin; } catch { return url; } }))],
            frameOrigins: [...new Set(frameUrls.filter(url => /loox|judge\.me|judgeme|yotpo|okendo|okeReviews/i.test(url)).map(url => { try { return new URL(url).origin; } catch { return url; } }))]
          },
          productSummary: {
            present: Boolean(productSummary), visible: Boolean(productSummary && visible(productSummary)),
            metric: metric(productSummary), relation: relation(productSummary, summaryContainer),
            ratingValue: productSummary?.getAttribute('data-rating') || null,
            ratingCount: productSummary?.getAttribute('data-raters') || null,
            empty: Boolean(productSummary) && !(productSummary.textContent || '').trim() && !productSummary.getAttribute('data-rating')
          },
          widget: {
            present: Boolean(widgetRoot || widgetFrame), visible: Boolean((widgetRoot && visible(widgetRoot)) || (widgetFrame && visible(widgetFrame))),
            root: metric(widgetRoot), frame: metric(widgetFrame), relation: relation(widgetRoot || widgetFrame, widgetContainer),
            nativeHorizontalScrollbar: Boolean(widgetRoot && widgetRoot.scrollWidth > widgetRoot.clientWidth + 1 && ['auto','scroll'].includes(getComputedStyle(widgetRoot).overflowX))
          },
          cards: {
            count: cardEntries.length,
            items: cardEntries,
            visibleCount: cardEntries.filter(item => item.rating && item.rating.box.width > 0 && item.rating.box.height > 0).length
          }
        }
      }
    };
  })()`);
}

async function inspectInformationColumnScroll(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>(
      "#product-content-area,.s2s-family-details,.s2s-portrait-details,.product__info-container,.product-info,.product-single__meta",
    );
    if (!element) return null;
    const originalY = scrollY;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const documentTop = element.getBoundingClientRect().top + scrollY;
    const positions = [...new Set([0, Math.min(240, maxScroll), Math.min(480, maxScroll), Math.min(Math.max(0, documentTop), maxScroll), maxScroll])];
    const samples = positions.map((y) => {
      scrollTo({ top: y, behavior: "instant" });
      const box = element.getBoundingClientRect();
      return { direction: "forward", scrollY, top: box.top, bottom: box.bottom };
    });
    for (const y of [...positions].reverse()) {
      scrollTo({ top: y, behavior: "instant" });
      const box = element.getBoundingClientRect();
      samples.push({ direction: "reverse", scrollY, top: box.top, bottom: box.bottom });
    }
    scrollTo({ top: originalY, behavior: "instant" });
    const before = samples[0];
    const after = samples.find((sample) => sample.scrollY > 0) || before;
    const probe = after.scrollY - before.scrollY;
    const delta = before.top - after.top;
    const position = getComputedStyle(element).position;
    const forward = samples.filter((sample) => sample.direction === "forward");
    const tracksDocument = forward.length > 1 && forward.every((sample) => Math.abs((sample.top + sample.scrollY) - (forward[0].top + forward[0].scrollY)) <= 2);
    const holdsViewport = forward.length > 1 && forward.every((sample) => Math.abs(sample.top - forward[0].top) <= 2);
    const scrollLocked = maxScroll === 0 && (
      Math.abs(before.top) > innerHeight
      || [getComputedStyle(document.documentElement).overflowY, getComputedStyle(document.body).overflowY].includes("hidden")
    );
    const mode = maxScroll === 0
      ? scrollLocked ? "invalid-scroll-lock" : "not-scrollable"
      : tracksDocument
        ? "document-flow"
        : holdsViewport
          ? "fixed"
          : "bounded-sticky";
    const overflowAncestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if ([style.overflow, style.overflowY].some((value) => ["auto", "scroll", "hidden", "clip"].includes(value)))
        overflowAncestors.push({ tag: parent.tagName.toLowerCase(), id: parent.id || null, className: String(parent.className || ""), overflow: style.overflow, overflowY: style.overflowY });
    }
    const header = document.querySelector<HTMLElement>("header,[role=banner],.shopify-section-group-header-group");
    return {
      selector: element.id ? `#${element.id}` : `.${String(element.className).trim().split(/\s+/)[0]}`,
      position,
      computedTop: getComputedStyle(element).top,
      probe,
      beforeTop: before.top,
      afterTop: after.top,
      delta,
      mode,
      maxScroll,
      samples,
      overflowAncestors,
      headerBottom: header?.getBoundingClientRect().bottom ?? null,
    };
  });
}

async function snapshot(page: Page, root: string, state: string) {
  await mkdir(root, { recursive: true });
  const files: Record<string, string | null> = {};
  const capture = async (region: string, locator: ReturnType<Page["locator"]> | null) => {
    const file = join(root, `${state}-${region}.png`);
    if (locator && (!(await locator.count()) || !(await locator.first().isVisible().catch(() => false)))) {
      files[region] = null;
      return;
    }
    if (locator) await locator.first().screenshot({ path: file, animations: "disabled" });
    else await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
    files[region] = file;
  };
  await capture("full", null);
  await capture("main", page.locator("main,[role=main]").first());
  await capture("form", await productWorkflowScope(page));
  await capture("review-summary", page.locator('.loox-rating,[data-s2s-product-rating],.jdgm-prev-badge,.yotpo-bottomline,.okeReviews-reviewsSummary').filter({ visible: true }).first());
  await capture("reviews", page.locator('#looxReviews,#loox-reviews-feed,.loox-widget,.jdgm-review-widget,.yotpo-main-widget,.okeReviews-widget-holder,iframe[title*="review" i]').filter({ visible: true }).first());
  const data: any = await inspect(page);
  data.workflow = await inspectProductWorkflow(page);
  data.layout.informationColumn.scroll = await inspectInformationColumnScroll(page);
  if (data.layout.informationColumn.scroll?.mode === "invalid-scroll-lock")
    throw new Error("Rendered evidence invalid: a residual document scroll lock displaced the product information column.");
  data.evidence = {
    schemaVersion: PRODUCT_EVIDENCE_SCHEMA_VERSION,
    contractVersion: PRODUCT_EVIDENCE_CONTRACT_VERSION,
    collectorVersion: PRODUCT_EVIDENCE_COLLECTOR_VERSION,
    capturedAt: new Date().toISOString(),
    finalUrl: page.url(),
    canonical: await page.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null),
    viewport: page.viewportSize(),
    state,
    domHash: hash(await page.content()),
  };
  await write(join(root, `${state}.html`), await page.content());
  await json(join(root, `${state}.json`), data);
  return { state, files, data };
}

async function exercise(page: Page, root: string) {
  const states: any[] = [await snapshot(page, root, "initial")];
  const probeOptions = async (prefix:string) => {
    const groups = await inventoryOptionGroups(await productWorkflowScope(page));
    await json(join(root, `${prefix}-option-inventory.json`), {collectorVersion:PRODUCT_EVIDENCE_COLLECTOR_VERSION,groups});
    if(groups.reduce((n,g)=>n+g.values.length,0)>180)
      throw new Error('Option inventory exceeds bounded capture budget; revise the capture plan, do not truncate coverage.');
    let first=true;
    for(let index=0;index<groups.length;index++){
      const group=groups[index];
      if(group.disabled)continue; // Retained in inventory; not an actionable transition.
      if(!group.baseline)throw new Error('Option group has no reset baseline; plan its required precondition.');
      for(const value of group.values){
        await selectObservedOption(await productWorkflowScope(page),group,value);
        await settle(page);
        const state=`${prefix}-option-${index}-${hash(value).slice(0,12)}`;
        const capture=await snapshot(page,root,state);
        capture.data.optionAction={groupIndex:index,value,baseline:group.baseline};
        await json(join(root,`${state}.json`),capture.data);states.push(capture);
        if(prefix==='initial'&&first&&value!==group.baseline){states.push(await snapshot(page,root,'variant'));first=false;}
        // Isolate each observed option transition from the same precondition.
        // Some controlled configurators accept A→B but become internally stale
        // after screenshots/scroll probes, making B→C unreliable even though
        // baseline→C is valid. Resetting after every sample also prevents one
        // option's dependent DOM from shrinking the next planned denominator.
        if(value!==group.baseline){
          await selectObservedOption(await productWorkflowScope(page),group,group.baseline);
          await settle(page);
        }
      }
      await selectObservedOption(await productWorkflowScope(page),group,group.baseline);
      await settle(page);
      states.push(await snapshot(page,root,`${prefix}-option-${index}-reverse`));
    }
  };
  await probeOptions('initial');
  for (let step = 2; step <= 12; step++) {
    const productScope = await productWorkflowScope(page);
    // Source themes often include hidden icon/span text in the accessible name,
    // so an exact role-name query can miss a visibly rendered Next control.
    // Keep the lookup scoped to the product workflow and match rendered text.
    const next = productScope.locator('button,[role="button"]')
      .filter({ hasText: /^\s*next(?:\s*[→➜-])?\s*$/i })
      .filter({ visible: true })
      .first();
    if (!(await next.count())) break;
    // A rendered-state collector must traverse required-field boundaries instead
    // of treating native validation as the end of the workflow. Use synthetic,
    // non-submitted values so downstream UI states can be observed safely.
    for (const input of await productScope.locator('input[type="text"][required],input[type="email"][required],input[type="tel"][required],textarea[required]').all()) {
      if (await input.isVisible().catch(() => false)) await input.fill('Site2Shop evidence');
    }
    for (const checkbox of await productScope.locator('input[type="checkbox"][required]').all()) {
      if (await checkbox.isVisible().catch(() => false) && !(await checkbox.isChecked()))
        await checkbox.check({ force: true });
    }
    const evidencePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3v3qAAAAAElFTkSuQmCC', 'base64');
    for (const file of await productScope.locator('input[type="file"][required],input[type="file"][data-s2s-required-photo]').all()) {
      const hasFile = await file.evaluate((node: HTMLInputElement) => !!node.files?.length).catch(() => false);
      if (!hasFile) await file.setInputFiles({ name: 'site2shop-evidence.png', mimeType: 'image/png', buffer: evidencePng });
    }
    const controlState = async () =>
      await productScope.evaluate((form) => ({
        controls: Array.from(form.querySelectorAll("input,select,textarea,button")).filter((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        }).map((element: any) => ({
          tag: element.tagName,
          type: element.type || null,
          id: element.id || null,
          name: element.name || null,
          value: element.value || null,
          checked: typeof element.checked === "boolean" ? element.checked : null,
          label: element.tagName === "BUTTON" ? (element.textContent || "").replace(/\s+/g, " ").trim() : null,
        })),
      })).catch(() => null);
    const before = await controlState();
    await next.evaluate((node: HTMLButtonElement) => node.click());
    await settle(page);
    const after = await controlState();
    if (JSON.stringify(before) === JSON.stringify(after)) {
      const blocked = await snapshot(page, root, `blocked-step-${step}`);
      blocked.data.workflow.incompleteReason = blocked.data.workflow.validationError ? 'required-input-validation; downstream states not reached' : 'next action produced no observable field transition';
      await json(join(root, `blocked-step-${step}.json`), blocked.data);
      states.push(blocked);
      break;
    }
    states.push(await snapshot(page, root, `step-${step}`));
    await probeOptions(`step-${step}`);
  }
  const reverseScope = await productWorkflowScope(page);
  const previous = reverseScope.locator('[data-s2s-step-previous],button.btn-prev,button[aria-label="Previous"],button[aria-label="Back"]')
    .filter({ visible: true }).first();
  if (await previous.count()) {
    const before = await inspectProductWorkflow(page);
    await previous.evaluate((node: HTMLButtonElement) => node.click());
    await settle(page);
    const afterBack = await inspectProductWorkflow(page);
    const reverse = await snapshot(page, root, "reverse-step");
    reverse.data.workflow.transitionChanged = JSON.stringify(before.fields) !== JSON.stringify(afterBack.fields)
      || before.nextPresent !== afterBack.nextPresent || before.previousPresent !== afterBack.previousPresent;
    await json(join(root, "reverse-step.json"), reverse.data);
    states.push(reverse);
    const replayScope = await productWorkflowScope(page);
    const replayNext = replayScope.locator('button,[role="button"]')
      .filter({ hasText: /^\s*next(?:\s*[→➜-])?\s*$/i }).filter({ visible: true }).first();
    if (await replayNext.count()) {
      const beforeReplay = await inspectProductWorkflow(page);
      await replayNext.evaluate((node: HTMLButtonElement) => node.click());
      await settle(page);
      const afterReplay = await inspectProductWorkflow(page);
      const replayChanged = JSON.stringify(beforeReplay.fields) !== JSON.stringify(afterReplay.fields)
        || beforeReplay.nextPresent !== afterReplay.nextPresent || beforeReplay.previousPresent !== afterReplay.previousPresent;
      const replay = await snapshot(page, root, replayChanged ? "replay-step" : "replay-blocked");
      replay.data.workflow.transitionChanged = replayChanged;
      replay.data.workflow.incompleteReason = replayChanged ? null : "Next after Previous did not restore the forward state";
      await json(join(root, `${replay.state}.json`), replay.data);
      states.push(replay);
    }
  }
  const extrasScope = await productWorkflowScope(page);
  const checkbox = extrasScope.locator('input[type="checkbox"]').filter({visible:true}).first();
  if (await checkbox.count()) {
    const before = await checkbox.isChecked().catch(() => false);
    const id = await checkbox.getAttribute('id');
    const label = id ? extrasScope.locator(`label[for=${JSON.stringify(id)}]`).filter({visible:true}).first() : null;
    if (label && await label.count()) await label.evaluate((node: HTMLLabelElement) => node.click());
    else await checkbox.evaluate((node: HTMLInputElement) => node.click());
    await settle(page);
    const currentScope = await productWorkflowScope(page);
    const current = id ? currentScope.locator(`input[id=${JSON.stringify(id)}]`).first() : null;
    const after = current && await current.count() ? await current.isChecked().catch(() => before) : before;
    if (after !== before) states.push(await snapshot(page, root, "extras"));
  }
  return states;
}

async function cachedProductStates(root: string) {
  const stateNames = (await readdir(root).catch(() => []))
    .filter(name => /^(initial|variant|(?:blocked-)?step-\d+|reverse-step|replay-(?:step|blocked)|extras)\.json$/.test(name))
    .map(name => name.replace(/\.json$/, ''))
    .sort((a,b) => {
      const order=(value:string)=>value==='initial'?0:value==='variant'?1:value==='extras'?100:Number(value.match(/\d+$/)?.[0]||99);
      return order(a)-order(b);
    });
  const states: any[] = [];
  for (const state of stateNames) {
    const data = await readJson<any>(join(root, `${state}.json`)).catch(() => null);
    if (!data || !hasCurrentProductEvidenceState(data)) continue;
    const files: Record<string, string | null> = {};
    for (const region of ["full", "main", "form", "review-summary", "reviews"]) {
      const file = join(root, `${state}-${region}.png`);
      files[region] = await access(file).then(() => file).catch(() => null);
    }
    states.push({ state, files, data, reused: true });
  }
  const initial = states.find((state) => state.state === "initial");
  return initial && assessCapturedWorkflowPath(states).passed && !renderedEvidenceRejection({ title: initial.data?.title, visibleText: initial.data?.visibleText }) ? states : [];
}

function productUrl(base: string, handle: string) {
  const url = new URL(base);
  url.pathname = `/products/${handle}`;
  return url.href;
}

function buildReviewSystemEvidence(report: any, mode: "source" | "target") {
  const placements: any[] = [];
  const providers = new Map<string, number>();
  const providerEvidence: any[] = [];
  const missing: string[] = [];
  for (const family of report.families || []) {
    for (const expected of report.viewports || [])
      if (!(family.viewports || []).some((viewport: any) => viewport.name === expected.name))
        missing.push(`${family.suffix}:${expected.name}:review-layout`);
    for (const viewport of family.viewports || []) {
      const initial = viewport.states?.find((state: any) => state.state === "initial");
      const reviews = initial?.data?.layout?.reviews;
      const identity = `${family.suffix}:${viewport.name}`;
      if (!reviews) {
        missing.push(`${identity}:review-layout`);
        continue;
      }
      if (reviews.provider?.name)
        providers.set(reviews.provider.name, (providers.get(reviews.provider.name) || 0) + 1);
      if (reviews.provider) providerEvidence.push({ family: family.suffix, viewport: viewport.name, ...reviews.provider });
      const common = {
        family: family.suffix,
        representative: family.representative,
        url: family.url,
        viewport: viewport.name,
        width: viewport.width,
        height: viewport.height,
      };
      if (family.surfaceKind === "product" || !family.surfaceKind) {
        placements.push({ ...common, surface: "product_summary", screenshot: initial.files?.["review-summary"] || null, ...reviews.productSummary });
        placements.push({ ...common, surface: "product_widget", screenshot: initial.files?.reviews || null, ...reviews.widget });
      }
      placements.push({
        ...common,
        surface: family.surfaceKind === "home" ? "homepage_cards" : family.surfaceKind === "collection" ? "collection_cards" : family.surfaceKind === "search" ? "search_cards" : "product_recommendation_cards",
        screenshot: initial.files?.cards || initial.files?.main || null,
        ...reviews.cards,
        present: Boolean(reviews.cards?.count),
        visible: Boolean(reviews.cards?.visibleCount),
      });
    }
  }
  const provider = [...providers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const scope = [...new Set(placements.map((placement) => placement.surface))];
  const notCapturedByThisCommand = ["homepage_cards", "collection_cards", "search_cards"].filter((surface) => !scope.includes(surface));
  return {
    schemaVersion: 1,
    capturedAt: report.capturedAt,
    mode,
    sourceUrl: report.base,
    platform: {
      kind: /myshopify\.com|shopify/i.test(report.base) || provider ? "shopify" : "unknown",
      confidence: provider ? 0.95 : 0.5,
      signals: provider ? [`${provider}-storefront-integration`] : [],
    },
    provider: {
      decision: provider ? "known_provider" : "unknown",
      name: provider,
      confidence: provider ? "high" : "unknown",
      evidence: providerEvidence,
    },
    scope,
    notCapturedByThisCommand,
    placements,
    targetIntegration: {
      provider,
      status: mode === "target" && provider ? "installed" : "unknown",
      appBlockTypes: [],
      appEmbedRequired: provider === "loox",
      metafieldNamespaces: provider ? [provider] : [],
    },
    dataPolicy: { copySourceReviews: false, copySourceCounts: false },
    missing,
    status: missing.length || notCapturedByThisCommand.length ? "blocked" : "provisional",
  };
}

async function reviewSnapshot(page: Page, root: string) {
  await mkdir(root, { recursive: true });
  const files: Record<string, string | null> = {};
  const captureRegion = async (name: string, locator: ReturnType<Page["locator"]>) => {
    const file = join(root, `initial-${name}.png`);
    if (!(await locator.count()) || !(await locator.first().isVisible().catch(() => false))) {
      files[name] = null;
      return;
    }
    try {
      await locator.first().screenshot({ path: file, animations: "disabled" });
      files[name] = file;
    } catch {
      files[name] = null;
    }
  };
  const ratingSelector = '.loox-rating,[data-rating][data-raters],[data-s2s-product-rating],.s2s-home-card-rating,.s2s-collection-card__rating,.jdgm-prev-badge,.yotpo-bottomline,.okeReviews-reviewsSummary';
  await captureRegion("review-summary", page.locator(ratingSelector).filter({ visible: true }));
  await captureRegion("reviews", page.locator('#looxReviews,#loox-reviews-feed,.loox-widget,.jdgm-review-widget,.yotpo-main-widget,.okeReviews-widget-holder,iframe[title*="review" i]').filter({ visible: true }));
  const productCardLinks = page.locator('a[href*="/products/"]');
  await captureRegion("cards", page.locator('.product-item,.product-list-item,.product-card,.card-product,.card-wrapper,[data-product-card],[data-s2s-collection-card],.s2s-collection-card,li.grid__item,.grid-product').filter({ has: productCardLinks }).filter({ visible: true }));
  const data = await inspect(page);
  await write(join(root, "initial.html"), await page.content());
  await json(join(root, "initial.json"), data);
  return { state: "initial", files, data };
}

export async function captureReviewSystemEvidence(out: string, baseUrl?: string, collectionUrl?: string, force = false) {
  const ir = await readJson<any>(join(out, "site-ir.json"));
  const base = (await publicUrl(baseUrl || ir.sourceUrl)).href;
  const contracts = await loadProductFamilyContracts(out);
  const collectionAudit = await readJson<any>(join(out, "collection-family-evidence", "layout-audit.json")).catch(() => null);
  const surfaces = [
    ...contracts.map((contract) => ({
      suffix: contract.suffix,
      representative: contract.representative,
      surfaceKind: "product",
      url: productUrl(base, contract.representative),
    })),
    { suffix: "surface-home", representative: "home", surfaceKind: "home", url: base },
    { suffix: "surface-search", representative: "pet-search", surfaceKind: "search", url: new URL("/search?q=pet&type=product", base).href },
  ];
  const collection = collectionUrl || collectionAudit?.source;
  if (collection) surfaces.push({
    suffix: "surface-collection",
    representative: new URL(collection).pathname.split("/").filter(Boolean).pop() || "collection",
    surfaceKind: "collection",
    url: (await publicUrl(collection)).href,
  });
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: publicDnsBrowserArgs });
  const report: any = {
    schemaVersion: 1,
    mode: "source",
    base,
    capturedAt: new Date().toISOString(),
    viewports,
    families: surfaces.map((surface) => ({ ...surface, viewports: [], errors: [] })),
  };
  const jobs = report.families.flatMap((surface: any) => viewports.map((viewport) => ({ surface, viewport })));
  let cursor = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        const root = join(out, "review-system-evidence", "source", job.surface.suffix, job.viewport.name);
        if (!force) {
          const cached = await readJson<any>(join(root, "initial.json")).catch(() => null);
          if (cached?.layout?.reviews && !renderedEvidenceRejection({
            title: cached.title,
            visibleText: cached.visibleText,
          })) {
            const screenshot = async (name: string) => {
              const file = join(root, `initial-${name}.png`);
              return access(file).then(() => file).catch(() => null);
            };
            job.surface.viewports.push({
              ...job.viewport,
              states: [{
                state: "initial",
                files: {
                  "review-summary": await screenshot("review-summary"),
                  reviews: await screenshot("reviews"),
                  cards: await screenshot("cards"),
                },
                data: cached,
                reused: true,
              }],
            });
            continue;
          }
        }
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const page = await browser.newPage({ viewport: job.viewport, locale: "en-US", colorScheme: "light" });
          try {
            const response = await page.goto(job.surface.url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await settle(page);
            await assertRenderedEvidencePage(page, response, "source");
            await page.addStyleTag({ content: '#attentive_overlay,#attentive_creative,#gorgias-chat-container,#PBarNextFrame,iframe[title*="Sign Up"]{display:none!important}' });
            await hydrateRenderedReviews(page);
            job.surface.viewports.push({ ...job.viewport, states: [await reviewSnapshot(page, root)] });
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          } finally {
            await page.close();
          }
        }
        if (lastError) job.surface.errors.push(`${job.viewport.name}: ${String(lastError)}`);
      }
    }));
  } finally {
    await browser.close();
  }
  for (const surface of report.families)
    surface.viewports.sort((a: any, b: any) => viewports.findIndex((item) => item.name === a.name) - viewports.findIndex((item) => item.name === b.name));
  await json(join(out, "review-system-source-capture.json"), report);
  const evidence = buildReviewSystemEvidence(report, "source");
  await json(join(out, "review-system-evidence.json"), evidence);
  return evidence;
}

export async function captureProductFamilyEvidence(out: string, baseUrl?: string, mode: "source" | "target" = "source", onlySuffix?: string, force = false, extraRepresentatives: string[] = [], allowLocalPreflight = false) {
  const ir = await readJson<any>(join(out, "site-ir.json"));
  const requestedBase = new URL(baseUrl || ir.sourceUrl);
  const localPreflight = allowLocalPreflight && mode === "target"
    && ["localhost", "127.0.0.1", "::1"].includes(requestedBase.hostname)
    && requestedBase.protocol === "http:";
  const base = localPreflight ? requestedBase.href : (await publicUrl(requestedBase.href)).href;
  const targetPreviewUrls = mode === "target"
    ? await readJson<any>(join(out, "target-product-preview-urls.json")).catch(() => null)
    : null;
  const productPlan = mode === "target"
    ? await readJson<any>(join(out, "phase3-product-plan.json")).catch(() => null)
    : null;
  const contracts = (await loadProductFamilyContracts(out)).filter((contract) => !onlySuffix || contract.suffix === onlySuffix);
  if (!contracts.length) throw new Error(`No product family contract matches ${onlySuffix}.`);
  for (const representative of extraRepresentatives) {
    const portrait = contracts.find(contract => contract.suffix === 's2s-portrait');
    if (portrait) contracts.push({...portrait, suffix: `s2s-portrait-boundary-${representative}`, representative});
  }
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: publicDnsBrowserArgs });
  const report: any = {
    schemaVersion: PRODUCT_EVIDENCE_SCHEMA_VERSION,
    contractVersion: PRODUCT_EVIDENCE_CONTRACT_VERSION,
    collectorVersion: PRODUCT_EVIDENCE_COLLECTOR_VERSION,
    mode,
    base,
    capturedAt: new Date().toISOString(),
    stage: localPreflight ? "preflight" : mode === "target" ? "online" : "source",
    themeBuild: null,
    viewports,
    families: [],
  };
  const currentBuild = mode === "target"
    ? await readJson<any>(join(out, "theme-build.json")).catch(() => null)
    : null;
  const targetProgress = mode === "target" && !force
    ? await readJson<any>(join(out, "product-family-target-evidence.progress.json")).catch(() => null)
    : null;
  const reusableTargetFamilies = new Map<string, any>(
    targetProgress?.base === base
      && targetProgress?.themeBuild === currentBuild?.id
      && targetProgress?.stage === report.stage
      ? (targetProgress.families || [])
          .filter((family: any) => !family.errors?.length
            && REQUIRED_VIEWPORTS.every((required) => family.viewports?.some((viewport: any) =>
              viewport.name === required.name && viewport.states?.some((state: any) => state.state === "initial"))))
          .map((family: any) => [family.suffix, family])
      : [],
  );
  try {
    for (const contract of contracts) {
      const reusableTarget = reusableTargetFamilies.get(contract.suffix);
      if (reusableTarget) {
        report.themeBuild = targetProgress.themeBuild;
        report.families.push(reusableTarget);
        console.log(`[target] ${contract.suffix}: reused complete current-build capture`);
        continue;
      }
      const targetHandle = productPlan?.products?.find((product: any) =>
        product.sourceHandle === contract.representative || product.handle === contract.representative,
      )?.handle || contract.representative;
      const storedPreview = mode === "target" ? targetPreviewUrls?.urls?.[targetHandle] : null;
      const familyUrl = (() => {
        if (mode !== "target") return productUrl(base, targetHandle);
        const requested = new URL(base);
        const url = storedPreview ? new URL(storedPreview) : new URL(`/products/${targetHandle}`, requested);
        url.protocol = requested.protocol;
        url.host = requested.host;
        const requestedTheme = requested.searchParams.get("preview_theme_id");
        if (requestedTheme) url.searchParams.set("preview_theme_id", requestedTheme);
        else if (localPreflight) url.searchParams.delete("preview_theme_id");
        return url.href;
      })();
      const family: any = { suffix: contract.suffix, representative: contract.representative, targetHandle, url: familyUrl, viewports: [], errors: [] };
      // Product configurators frequently persist option state in cookies, local
      // storage, or provider-wide session state. Parallel viewports can then
      // reset each other's controlled radios and create false capture failures.
      // Keep source and target workflow replay serial and deterministic.
      // Local target preflight is generator-owned and keeps all configurator
      // state inside each page, so its three viewport captures can run in
      // parallel. Source/online captures remain serial because merchant apps
      // may persist option state across pages in the shared browser context.
      await pool([...viewports], localPreflight ? viewports.length : 1, async (viewport) => {
        const root = join(out, "product-family-evidence", mode, contract.suffix, viewport.name);
        if (mode === "source" && !force) {
          const states = await cachedProductStates(root);
          if (states.length) {
            family.viewports.push({ ...viewport, states });
            return;
          }
        }
        const page = await browser.newPage({ viewport, locale: "en-US", colorScheme: "light" });
        page.setDefaultTimeout(10000);
        try {
          let response: Awaited<ReturnType<typeof page.goto>> = null;
          let navigationError: unknown = null;
          for (let attempt = 0; attempt < (localPreflight ? 3 : 1); attempt++) {
            try {
              if (attempt) await page.waitForTimeout(750 + viewport.width);
              response = await page.goto(family.url, { waitUntil: "domcontentloaded", timeout: 60000 });
              if (!response || response.status() < 500) {
                navigationError = null;
                break;
              }
              navigationError = new Error(`HTTP ${response.status()}`);
            } catch (error) {
              navigationError = error;
            }
          }
          if (navigationError) throw navigationError;
          if (mode === "target") response = await unlockStorefrontIfNeeded(page, family.url) || response;
          await settle(page);
          await assertRenderedEvidencePage(page, response, mode);
          if (mode === "target") {
            const renderedBuild = await page.locator('meta[name="site2shop-build-id"]').first().getAttribute("content").catch(() => null);
            if (!renderedBuild) throw new Error("TARGET_EVIDENCE_INVALID: rendered theme build identity is missing");
            if (report.themeBuild && report.themeBuild !== renderedBuild)
              throw new Error("TARGET_EVIDENCE_INVALID: mixed theme builds in one evidence packet");
            report.themeBuild = renderedBuild;
          }
          if (localPreflight) {
            const requestedPath = new URL(family.url).pathname.replace(/\/+$/, "") || "/";
            const finalPath = new URL(page.url()).pathname.replace(/\/+$/, "") || "/";
            const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href").catch(() => null);
            const canonicalPath = canonical ? (new URL(canonical, family.url).pathname.replace(/\/+$/, "") || "/") : null;
            if (finalPath !== requestedPath || canonicalPath !== requestedPath)
              throw new Error(`TARGET_EVIDENCE_INVALID: local preview route/canonical does not match ${requestedPath}`);
          } else if (mode === "target" && new URL(family.url).pathname === "/products_preview") {
            const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href").catch(() => null);
            const expectedPath = `/products/${targetHandle}`;
            if (!canonical || new URL(canonical, family.url).pathname !== expectedPath)
              throw new Error(`TARGET_EVIDENCE_INVALID: draft preview canonical does not match ${expectedPath}`);
          } else await assertRenderedEvidenceRoute(page, family.url, mode);
          await page.addStyleTag({ content: '#attentive_overlay,#attentive_creative,#gorgias-chat-container,#PBarNextFrame,iframe[title*="Sign Up"]{display:none!important}' });
          await hydrateRenderedReviews(page);
          family.viewports.push({ ...viewport, states: await exercise(page, root) });
          console.log(`[${mode}] ${contract.suffix} ${viewport.name}: captured`);
        } catch (error) {
          family.errors.push(`${viewport.name}: ${String(error)}`);
          console.log(`[${mode}] ${contract.suffix} ${viewport.name}: failed ${String(error).slice(0,160)}`);
        } finally {
          await page.close();
        }
      });
      family.viewports.sort((a: any,b: any) => viewports.findIndex(v=>v.name===a.name)-viewports.findIndex(v=>v.name===b.name));
      report.families.push(family);
      await json(join(out, `product-family-${mode}-evidence.progress.json`), report);
    }
  } finally {
    await browser.close();
  }
  if (onlySuffix) {
    const existing = await readJson<any>(join(out, `product-family-${mode}-evidence.json`)).catch(() => null);
    if (hasCurrentProductEvidenceReport(existing) && existing.base === report.base) {
      const captured = new Map(report.families.map((family: any) => [family.suffix, family]));
      report.families = [
        ...(existing.families || []).filter((family: any) => !captured.has(family.suffix)),
        ...report.families,
      ];
    }
  }
  await json(join(out, `product-family-${mode}-evidence.json`), report);
  const reviewEvidence = buildReviewSystemEvidence(report, mode);
  await json(join(out, mode === "source" ? "review-system-product-source-evidence.json" : "review-system-target-evidence.json"), reviewEvidence);
  return report;
}

async function imageDiff(source: string, target: string) {
  const sourceMeta = await sharp(source).metadata();
  const targetMeta = await sharp(target).metadata();
  const width = Math.min(sourceMeta.width || 0, targetMeta.width || 0);
  const height = Math.min(sourceMeta.height || 0, targetMeta.height || 0);
  if (!width || !height) throw new Error("Screenshot has no measurable area.");
  const a = await sharp(source).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer();
  const b = await sharp(target).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer();
  const count = pixelmatch(a, b, undefined, width, height, { threshold: 0.1 });
  const heightPenalty = Math.abs((sourceMeta.height || height) - (targetMeta.height || height)) / Math.max(sourceMeta.height || height, targetMeta.height || height);
  return Number(Math.min(100, ((count / (width * height)) + heightPenalty) * 100).toFixed(2));
}

export async function verifyProductFamilyVisuals(out: string, targetBase: string, threshold = 12, capturedTarget?: any, stage: "preflight" | "online" = "online") {
  const source = await readJson<any>(join(out, "product-family-source-evidence.json"));
  if (!hasCurrentProductEvidenceReport(source))
    throw new Error("Visual verification blocked: source product evidence uses an incompatible schema, contract, or collector version; recapture it first.");
  const target = capturedTarget || await captureProductFamilyEvidence(out, targetBase, "target", undefined, false, [], stage === "preflight");
  if (!hasCurrentProductEvidenceReport(target) || target.base !== new URL(targetBase).href)
    throw new Error('Target evidence version or preview identity does not match this audit.');
  const comparisons: any[] = [];
  const contractChecks: any[] = [];
  const recommendationImplementation = await Promise.all([
    readFile(join(out, "theme", "sections", "s2s-product-recommendations.liquid"), "utf8"),
    readFile(join(out, "theme", "snippets", "s2s-product-rating.liquid"), "utf8"),
  ]).then(([section, rating]) => /s2s-product-recommendation-card/.test(section)
    && /render\s+['"]s2s-product-rating['"]/.test(section)
    && /loox-rating/.test(rating)).catch(() => false);
  const keyPhrases = ["Any Extras?", "Digital Download", "Santa Hat", "Skip the line"];
  const optionActionKey = (state: any) => {
    const action = state?.data?.optionAction;
    if (!action || action.groupIndex == null || action.value == null) return null;
    return `${action.groupIndex}:${String(action.value).toLowerCase().replace(/\s+/g, " ").trim()}`;
  };
  const matchingInteraction = (states: any[] | undefined, sourceState: any) => {
    const exact = states?.find((item: any) => item.state === sourceState.state);
    if (exact) return exact;
    const semantic = optionActionKey(sourceState);
    return semantic ? states?.find((item: any) => optionActionKey(item) === semantic) : undefined;
  };
  for (const family of source.families) {
    const targetFamily = target.families.find((item: any) => item.suffix === family.suffix);
    for (const requiredViewport of REQUIRED_VIEWPORTS) {
      const viewport = family.viewports.find((item: any) => item.name === requiredViewport.name);
      const targetViewport = targetFamily?.viewports.find((item: any) => item.name === requiredViewport.name);
      const sourceState = viewport?.states?.find((item: any) => item.state === "initial");
      const targetState = targetViewport?.states.find((item: any) => item.state === "initial");
      const sourceVariant = viewport?.states?.find((item: any) => item.state === "variant");
      const targetVariant = targetViewport?.states.find((item: any) => item.state === "variant");
      contractChecks.push({
        suffix: family.suffix,
        viewport: requiredViewport.name,
        check: "required-viewport-evidence",
        passed: Boolean(sourceState && targetState),
        sourcePresent: Boolean(sourceState),
        targetPresent: Boolean(targetState),
      });
      const relativeDelta = (actual: number, expected: number) => expected > 0 ? Math.abs(actual - expected) / expected : 0;
      for (const sourceInteraction of viewport?.states || []) {
        const targetInteraction = matchingInteraction(targetViewport?.states, sourceInteraction);
        const comparison = compareWorkflowState(sourceInteraction.data?.workflow, targetInteraction?.data?.workflow);
        contractChecks.push({
          suffix: family.suffix,
          viewport: requiredViewport.name,
          check: `interaction-state:${sourceInteraction.state}`,
          ...comparison,
        });
        contractChecks.push({
          suffix: family.suffix,
          viewport: requiredViewport.name,
          check: `option-select-state:${sourceInteraction.state}`,
          ...compareOptionSelects(sourceInteraction.data?.optionSelects, targetInteraction?.data?.optionSelects),
        });
        // This is a visual component contract, so match the customer-visible
        // label. Submitted values are validated by the workflow contract.
        const normalizeControl = (value: string) => String(value || "").toLowerCase()
          .replace(/\+?\$\s*\d+(?:\.\d{2})?/g, "")
          .replace(/limited edition|see details?/g, "")
          .replace(/[-_]+/g, "").replace(/\s+/g, "").trim();
        const sourceControls = sourceInteraction.data?.layout?.controls?.radioLabels || [];
        const targetControls = targetInteraction?.data?.layout?.controls?.radioLabels || [];
        const controlReasons: string[] = [];
        for (const sourceControl of sourceControls) {
          const sourceKeys = [...new Set([sourceControl.text, sourceControl.value].map(normalizeControl).filter(Boolean))];
          if (!sourceKeys.length) continue;
          const match = targetControls.find((item: any) => {
            const targetKeys = [item.text, item.value].map(normalizeControl).filter(Boolean);
            return targetKeys.some((key: string) => sourceKeys.includes(key));
          });
          if (!match) {
            controlReasons.push(`missing radio label: ${sourceControl.text}`);
            continue;
          }
          if ((sourceControl.image || sourceControl.treatment?.present) && !(match.image || match.treatment?.present))
            controlReasons.push(`image treatment missing: ${sourceControl.text}`);
          const sourceBox = sourceControl.metric?.box, targetBox = match.metric?.box;
          if (sourceBox && targetBox) {
            const widthDelta = relativeDelta(targetBox.width, sourceBox.width);
            const heightDelta = relativeDelta(targetBox.height, sourceBox.height);
            if (widthDelta > .2 || heightDelta > .2)
              controlReasons.push(`control geometry differs: ${sourceControl.text} (${widthDelta.toFixed(3)},${heightDelta.toFixed(3)})`);
          }
        }
        contractChecks.push({
          suffix: family.suffix,
          viewport: requiredViewport.name,
          check: `component-layout:${sourceInteraction.state}`,
          passed: Boolean(targetInteraction) && !controlReasons.length,
          tolerance: .2,
          reasons: controlReasons,
          sourceCount: sourceControls.length,
          targetCount: targetControls.length,
        });
      }
      for (const targetInteraction of targetViewport?.states || []) {
        if ((viewport?.states || []).some((state:any) => matchingInteraction([targetInteraction], state))) continue;
        contractChecks.push({suffix:family.suffix,viewport:requiredViewport.name,
          check:`interaction-state:${targetInteraction.state}`,passed:false,
          reasons:['target state has no matching source capture; source workflow coverage is incomplete']});
      }
      const sourcePath = assessCapturedWorkflowPath(viewport?.states);
      const targetPath = assessCapturedWorkflowPath(targetViewport?.states);
      contractChecks.push({suffix:family.suffix,viewport:requiredViewport.name,check:'reachable-workflow-path',
        passed:sourcePath.passed && targetPath.passed,source:sourcePath,target:targetPath,
        note:'This only checks reachable Next coverage, not successful uploads, reverse paths or cart submission.'});
      const sourceReverse = viewport?.states?.find((state: any) => state.state === "reverse-step");
      const sourceReplay = viewport?.states?.find((state: any) => state.state === "replay-step");
      const targetReverse = targetViewport?.states?.find((state: any) => state.state === "reverse-step");
      const targetReplay = targetViewport?.states?.find((state: any) => state.state === "replay-step");
      contractChecks.push({
        suffix: family.suffix,
        viewport: requiredViewport.name,
        check: "next-previous-next-replay",
        passed: !sourceReverse && !sourceReplay || Boolean(
          sourceReverse?.data?.workflow?.transitionChanged
          && sourceReplay?.data?.workflow?.transitionChanged
          && targetReverse?.data?.workflow?.transitionChanged
          && targetReplay?.data?.workflow?.transitionChanged,
        ),
        sourceReverse: Boolean(sourceReverse), sourceReplay: Boolean(sourceReplay),
        targetReverse: Boolean(targetReverse), targetReplay: Boolean(targetReplay),
      });
      const sourceText = sourceState?.data?.visibleText || "";
      const targetText = targetState?.data?.visibleText || "";
      for (const phrase of keyPhrases) {
        if (!sourceText.toLowerCase().includes(phrase.toLowerCase())) continue;
        contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: `text:${phrase}`, passed: targetText.toLowerCase().includes(phrase.toLowerCase()) });
      }
      const sourceFiles = (sourceState?.data?.fields || []).filter((field: any) => field.type === "file");
      const selects = compareOptionSelects(sourceState?.data?.optionSelects, targetState?.data?.optionSelects);
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "option-select-control-contract", ...selects });
      const targetFiles = (targetState?.data?.fields || []).filter((field: any) => field.type === "file");
      if (sourceFiles.length)
        contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "file-controls", passed: targetFiles.length >= sourceFiles.length && sourceFiles.every((field: any, index: number) => !field.required || targetFiles[index]?.required) });
      const valueFor = (state: any, name: string) => state?.data?.fields?.find((field: any) => field.name === name)?.value || null;
      const sourceVariantChanged = valueFor(sourceState, "id") !== valueFor(sourceVariant, "id");
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "variant-id-change", passed: !sourceVariantChanged || valueFor(targetState, "id") !== valueFor(targetVariant, "id") });
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "normalized-option-labels", passed: !/\b[^\n:]{1,40}::/.test(targetText) });
      const sourceSections = sourceState?.data?.sections?.length || 0;
      const targetSections = targetState?.data?.sections?.length || 0;
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "page-sections-preserved", passed: Boolean(sourceState && targetState) && targetSections >= sourceSections, sourceSections, targetSections });
      const sourceLayout = sourceState?.data?.layout;
      const targetLayout = targetState?.data?.layout;
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "no-visible-horizontal-scrollbar", passed: Boolean(targetLayout) && !targetLayout.document?.horizontalOverflow && !targetLayout.thumbnails?.nativeHorizontalScrollbar, documentOverflow: targetLayout?.document?.horizontalOverflow, thumbnailScrollbar: targetLayout?.thumbnails?.nativeHorizontalScrollbar });
      const sourceInformationScroll = sourceLayout?.informationColumn?.scroll;
      const targetInformationScroll = targetLayout?.informationColumn?.scroll;
      const sourceInformationMetric = sourceLayout?.informationColumn?.metric;
      const targetInformationMetric = targetLayout?.informationColumn?.metric;
      contractChecks.push({
        suffix: family.suffix,
        viewport: requiredViewport.name,
        check: "information-column-scroll-behavior",
        passed: Boolean(sourceInformationMetric && targetInformationMetric && sourceInformationScroll?.mode && targetInformationScroll?.mode)
          && targetInformationScroll.mode === sourceInformationScroll.mode,
        sourceMetricPresent: Boolean(sourceInformationMetric),
        targetMetricPresent: Boolean(targetInformationMetric),
        source: sourceInformationScroll,
        target: targetInformationScroll,
      });
      const purchaseApplicable = Boolean(sourceLayout?.purchase?.quantity && sourceLayout?.purchase?.submit);
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "purchase-controls-equal-height", passed: !purchaseApplicable || Boolean(targetLayout?.purchase?.quantity && targetLayout?.purchase?.submit) && targetLayout.purchase.heightDelta <= 1 && targetLayout.purchase.bottomDelta <= 1, heightDelta: targetLayout?.purchase?.heightDelta, bottomDelta: targetLayout?.purchase?.bottomDelta });
      const sourceReviews = sourceLayout?.reviews;
      const targetReviews = targetLayout?.reviews;
      for (const [surface, sourceComponent, targetComponent] of [
        ["product-summary", sourceReviews?.productSummary, targetReviews?.productSummary],
        ["product-widget", sourceReviews?.widget, targetReviews?.widget],
      ] as const) {
        // A provider can leave an empty, zero-height placeholder in the DOM for
        // products without review data. Presence alone is not rendered source
        // evidence and must not turn that placeholder into a required visible
        // target summary. Widgets remain required when they are visibly
        // rendered; summaries additionally need non-empty rendered content.
        const sourceRendered = reviewPlacementRequired(surface, sourceComponent);
        const required = sourceRendered;
        const sourceBox = sourceComponent?.metric?.box || sourceComponent?.root?.box || sourceComponent?.frame?.box;
        const targetBox = targetComponent?.metric?.box || targetComponent?.root?.box || targetComponent?.frame?.box;
        const reviewDeltas = sourceBox && targetBox ? {
          width: relativeDelta(targetBox.width, sourceBox.width),
          height: relativeDelta(targetBox.height, sourceBox.height),
          widthRatio: sourceComponent?.relation?.widthRatio != null && targetComponent?.relation?.widthRatio != null
            ? Math.abs(targetComponent.relation.widthRatio - sourceComponent.relation.widthRatio)
            : null,
        } : null;
        const relevantDeltas = surface === "product-widget"
          ? [reviewDeltas?.widthRatio, reviewDeltas?.width].filter((value) => value != null)
          : [reviewDeltas?.height, reviewDeltas?.widthRatio].filter((value) => value != null);
        const targetHasRenderedContent = targetComponent?.visible && (sourceComponent?.empty || !targetComponent?.empty);
        const targetDataMissing = required && targetComponent?.present && (
          surface === "product-summary"
            ? targetComponent?.empty && !sourceComponent?.empty
            : sourceComponent?.visible && !targetComponent?.visible
        );
        // Review totals belong to the target store and may legitimately be empty
        // during preflight. Treat provider binding/placement as the implementation
        // contract and report data availability separately; never copy source totals
        // merely to make a visual comparison pass.
        const targetBindingPlaced = Boolean(targetComponent?.present && targetBox)
          && (targetDataMissing || targetComponent?.relation?.widthRatio == null || sourceComponent?.relation?.widthRatio == null
            || Math.abs(targetComponent.relation.widthRatio - sourceComponent.relation.widthRatio) <= .2);
        const presentationPassed = targetDataMissing
          ? targetBindingPlaced
          : Boolean(targetHasRenderedContent) && relevantDeltas.every((delta: any) => delta <= .2);
        contractChecks.push({
          suffix: family.suffix,
          viewport: requiredViewport.name,
          check: `review-placement:${surface}`,
          passed: !required || targetBindingPlaced && presentationPassed,
          required,
          sourcePresent: sourceComponent?.present,
          sourceRendered,
          targetPresent: targetComponent?.present,
          tolerance: .2,
          deltas: reviewDeltas,
          dataBlocked: targetDataMissing,
          implementationPassed: !required || targetBindingPlaced,
          dataPassed: !targetDataMissing,
          reason: targetDataMissing ? "target review provider is connected but this product has no target review summary data; source totals must not be copied" : null,
        });
      }
      const sourceCard = sourceReviews?.cards?.items?.[0];
      const targetCard = targetReviews?.cards?.items?.[0];
      const cardRequired = Boolean(sourceReviews?.cards?.count);
      const targetCardDataBlocked = cardRequired && !targetReviews?.cards?.count;
      const cardDeltas = sourceCard?.rating?.box && targetCard?.rating?.box ? {
        width: relativeDelta(targetCard.rating.box.width, sourceCard.rating.box.width),
        height: relativeDelta(targetCard.rating.box.height, sourceCard.rating.box.height),
        offsetLeft: sourceCard.relation?.parent?.box?.width && targetCard.relation?.parent?.box?.width
          ? Math.abs((targetCard.relation.offsetLeft / targetCard.relation.parent.box.width) - (sourceCard.relation.offsetLeft / sourceCard.relation.parent.box.width))
          : null,
      } : null;
      contractChecks.push({
        suffix: family.suffix,
        viewport: requiredViewport.name,
        check: "review-placement:product-recommendation-card",
        passed: !cardRequired || (targetCardDataBlocked
          ? recommendationImplementation
          : Boolean(targetCard?.rating?.box) && Object.values(cardDeltas || {}).filter((value) => value != null).every((delta: any) => delta <= .2)),
        required: cardRequired,
        sourceCount: sourceReviews?.cards?.count || 0,
        targetCount: targetReviews?.cards?.count || 0,
        tolerance: .2,
        deltas: cardDeltas,
        dataBlocked: targetCardDataBlocked,
        implementationPassed: recommendationImplementation,
        reason: targetCardDataBlocked ? "target recommendations have no target-store data; generator-owned Loox rating slots are present and source review totals are not copied" : null,
      });
      const sourceThumb = sourceLayout?.thumbnails?.items?.[0]?.box;
      const targetThumb = targetLayout?.thumbnails?.items?.[0]?.box;
      const dimensionDeltas = sourceThumb && targetThumb ? { thumbnailWidth: relativeDelta(targetThumb.width, sourceThumb.width), thumbnailHeight: relativeDelta(targetThumb.height, sourceThumb.height) } : null;
      const layoutTolerance = .15;
      contractChecks.push({ suffix: family.suffix, viewport: requiredViewport.name, check: "layout-dimension-error", passed: Boolean(sourceState && targetState) && (!sourceThumb || Boolean(targetThumb) && Object.values(dimensionDeltas || {}).every((delta: any) => delta <= layoutTolerance)), tolerance: layoutTolerance, deltas: dimensionDeltas });
      const sourceArrowRegion = sourceLayout?.gallery?.arrowRegion;
      const targetArrowRegion = targetLayout?.gallery?.arrowRegion;
      contractChecks.push({
        suffix: family.suffix,
        viewport: requiredViewport.name,
        check: "gallery-arrow-placement",
        passed: !sourceArrowRegion || sourceArrowRegion === "none" || targetArrowRegion === sourceArrowRegion,
        source: sourceArrowRegion, target: targetArrowRegion,
      });
      for (const region of ["full", "main", "form"]) {
        const sourceFile = sourceState?.files?.[region];
        const targetFile = targetState?.files?.[region];
        let diffPercent: number | null = null;
        let error: string | null = null;
        try {
          if (!sourceFile || !targetFile) throw new Error("region missing");
          diffPercent = await imageDiff(sourceFile, targetFile);
        } catch (reason) { error = String(reason); }
        comparisons.push({ suffix: family.suffix, viewport: requiredViewport.name, region, diffPercent, threshold, passed: diffPercent !== null && diffPercent <= threshold, error });
      }
    }
  }
  const build = await readJson<any>(join(out, "theme-build.json")).catch(() => null);
  const deployment = await readJson<any>(join(out,'deployment.json')).catch(()=>null);
  const buildIdentityPassed = stage === "preflight"
    ? target.stage === "preflight" && target.themeBuild === build?.id
    : Boolean(deployment?.themeBuild && deployment.themeBuild===build?.id && target.themeBuild === build?.id && String(deployment.themeId)===new URL(targetBase).searchParams.get('preview_theme_id'));
  contractChecks.push({check:'preview-build-identity', stage, passed: buildIdentityPassed, localBuild:build?.id, renderedBuild: target.themeBuild, deployedBuild:deployment?.themeBuild});
  // The legacy relative-delta rows remain diagnostics. They cannot substitute for
  // plan-bound padding, placement, overflow, all-state and three-viewport checks.
  contractChecks.push(await executableEvidenceCheck(out, stage));
  const objectivePassed = contractChecks.length > 0 && contractChecks.every((item) => item.passed);
  const pixelDiagnosticsPassed = comparisons.length > 0 && comparisons.every((item) => item.passed);
  const report = {
    schemaVersion: 6,
    evidenceSchemaVersion: PRODUCT_EVIDENCE_SCHEMA_VERSION,
    evidenceContractVersion: PRODUCT_EVIDENCE_CONTRACT_VERSION,
    evidenceCollectorVersion: PRODUCT_EVIDENCE_COLLECTOR_VERSION,
    themeBuild: build?.id || null,
    targetBase,
    stage,
    threshold,
    checkedAt: new Date().toISOString(),
    requiredViewports: REQUIRED_VIEWPORTS.map(({ name, width, height }) => ({ name, width, height })),
    objectivePassed,
    pixelDiagnosticsPassed,
    passed: objectivePassed,
    comparisons,
    contractChecks,
  };
  await json(join(out, "product-family-visual-audit.json"), report);
  return report;
}

export async function assertDraftVisualAuditNotFailed(out: string) {
  const [audit, build] = await Promise.all([
    readJson<any>(join(out, "product-family-visual-audit.json")).catch(() => null),
    readJson<any>(join(out, "theme-build.json")),
  ]);
  if (!audit) throw new Error("Draft upload blocked: the required three-viewport visual audit is missing.");
  if (audit.evidenceSchemaVersion !== PRODUCT_EVIDENCE_SCHEMA_VERSION
    || audit.evidenceContractVersion !== PRODUCT_EVIDENCE_CONTRACT_VERSION
    || audit.evidenceCollectorVersion !== PRODUCT_EVIDENCE_COLLECTOR_VERSION)
    throw new Error("Draft upload blocked: the visual audit was produced from incompatible or stale evidence.");
  if (!hasRequiredViewportCoverage(audit))
    throw new Error("Draft upload blocked: desktop, tablet, and mobile visual/interaction evidence is incomplete.");
  if (!audit.contractChecks?.every((item: any) => item.passed)) throw new Error("Draft upload blocked: the current product-family objective layout or interaction contract failed.");
  if (audit.themeBuild !== build.id) {
    const incremental = await readJson<any>(join(out, "agent-visual-review.preflight.incremental.json")).catch(() => null);
    if (!incremental) throw new Error("Draft upload blocked: the visual audit is stale for the current generated theme build.");
    await assertAgentVisualReview(out, "preflight");
    return { ...audit, themeBuild: build.id, incrementalReview: incremental, baselineThemeBuild: audit.themeBuild };
  }
  return audit;
}

function hasRequiredViewportCoverage(audit: any) {
  const required = REQUIRED_VIEWPORTS.map(({ name }) => name);
  const declared = new Set((audit?.requiredViewports || []).map((item: any) => typeof item === "string" ? item : item.name));
  if (!required.every((name) => declared.has(name))) return false;
  const compared = new Set((audit?.comparisons || []).map((item: any) => item.viewport));
  const contracted = new Set((audit?.contractChecks || []).filter((item: any) => item.check === "required-viewport-evidence" && item.passed).map((item: any) => item.viewport));
  return required.every((name) => compared.has(name) && contracted.has(name));
}

export async function assertVisualAuditPassed(out: string) {
  const [audit, build] = await Promise.all([
    readJson<any>(join(out, "product-family-visual-audit.json")),
    readJson<any>(join(out, "theme-build.json")),
  ]);
  if (audit.evidenceSchemaVersion !== PRODUCT_EVIDENCE_SCHEMA_VERSION
    || audit.evidenceContractVersion !== PRODUCT_EVIDENCE_CONTRACT_VERSION
    || audit.evidenceCollectorVersion !== PRODUCT_EVIDENCE_COLLECTOR_VERSION)
    throw new Error("Publication blocked: the visual audit was produced from incompatible or stale evidence.");
  if (!audit.themeBuild || audit.themeBuild !== build.id)
    throw new Error("Publication blocked: the visual audit is stale for the current generated theme build.");
  if (!hasRequiredViewportCoverage(audit))
    throw new Error("Publication blocked: desktop, tablet, and mobile visual/interaction evidence is incomplete.");
  if (!audit.contractChecks?.every((item: any) => item.passed)) throw new Error("Publication blocked: the product-family objective layout or interaction contract failed.");
  return audit;
}

// Legacy inventory check is additional protection, never the presentation gate.
export async function assertReviewSystemViewportCoverage(out: string) {
  const evidence = await readJson<any>(join(out, "review-system-evidence.json")).catch(() => null);
  if (!evidence) throw new Error("Review-system gate blocked: review-system-evidence.json is missing; absence is not proof that the source has no reviews.");
  if (evidence.status === "not-applicable") {
    const { loadEvidencePlan, readArtifact, assertExecutableEvidence } = await import("./evidence-gate.js");
    const { analysis, planSha256 } = await loadEvidencePlan(out);
    if (evidence.planSha256 !== planSha256 || analysis.reviewSystem?.present !== false || !analysis.reviewSystem?.reason?.trim())
      throw new Error("Review-system gate blocked: not-applicable requires an independent, current, evidenced source classification.");
    await readArtifact(out, analysis.reviewSystem.evidence);
    await assertExecutableEvidence(out, "source");
    return evidence;
  }
  if (!Array.isArray(evidence.scope) || !evidence.scope.length || !Array.isArray(evidence.placements))
    throw new Error("Review-system gate blocked: review surface inventory is empty or malformed.");
  if (evidence.status === "blocked" || evidence.missing?.length || evidence.notCapturedByThisCommand?.length)
    throw new Error("Review-system gate blocked: the source review placement contract is incomplete.");
  const required = REQUIRED_VIEWPORTS.map(({ name }) => name);
  const missing: string[] = [];
  for (const surface of evidence.scope || [])
    for (const viewport of required)
      if (!(evidence.placements || []).some((placement: any) => placement.surface === surface && placement.viewport === viewport))
        missing.push(`${surface}:${viewport}`);
  if (missing.length)
    throw new Error(`Review-system gate blocked: desktop, tablet, and mobile placement evidence is incomplete (${missing.join(", ")}).`);
  return evidence;
}
