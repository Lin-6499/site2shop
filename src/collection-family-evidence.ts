import { chromium, type Page } from "playwright";
import pixelmatch from "pixelmatch";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { publicDnsBrowserArgs, publicUrl } from "./network.js";
import { assertRenderedEvidencePage, assertRenderedEvidenceRoute } from "./rendered-page-validity.js";
import { REQUIRED_VIEWPORTS } from "./types.js";
import { json, readJson } from "./util.js";
import { unlockStorefrontIfNeeded } from "./storefront-auth.js";
import { executableEvidenceCheck } from "./evidence-gate.js";

export const COLLECTION_EVIDENCE_SCHEMA_VERSION = 3;
export const COLLECTION_EVIDENCE_CONTRACT_VERSION = "collection-family-layout-v2";
export const COLLECTION_EVIDENCE_COLLECTOR_VERSION = "2.1.0";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(300);
}

async function hydrateFullPage(page: Page) {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let previousHeight = 0;
    let stablePasses = 0;
    for (let pass = 0; pass < 8 && stablePasses < 2; pass++) {
      const height = Math.min(document.documentElement.scrollHeight, 50000);
      for (let y = 0; y <= height; y += Math.max(500, Math.floor(innerHeight * .75))) {
        scrollTo({ top: y, behavior: "instant" });
        await delay(120);
      }
      const nextHeight = document.documentElement.scrollHeight;
      stablePasses = nextHeight === previousHeight ? stablePasses + 1 : 0;
      previousHeight = nextHeight;
    }
    document.querySelector("footer,#footer")?.scrollIntoView({ block: "end", behavior: "instant" });
    await delay(250);
    const pending = Array.from(document.images).filter((image) => !image.complete);
    await Promise.all(pending.map((image) => new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    })));
    scrollTo({ top: 0, behavior: "instant" });
  }).catch(() => {});
  await settle(page);
}

async function inspectCollection(page: Page) {
  return page.evaluate(`(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const metric = element => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height, top: box.top, right: box.right, bottom: box.bottom, left: box.left },
        computed: { display: style.display, gridTemplateColumns: style.gridTemplateColumns, gap: style.gap, rowGap: style.rowGap, columnGap: style.columnGap, overflowX: style.overflowX, aspectRatio: style.aspectRatio },
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const first = selectors => selectors.map(selector => document.querySelector(selector)).find(Boolean) || null;
    const grid = first(["[data-s2s-collection-grid]", ".product-list", ".collection-grid", ".grid--view-items", ".collection__products .grid"]);
    const cards = Array.from(document.querySelectorAll("[data-s2s-collection-card],.product-list-item,.grid-product,.card-wrapper,.product-card")).filter(visible);
    const card = cards[0] || null;
    const image = card?.querySelector("img") || null;
    const productLink = card?.querySelector('a[href*="/products/"]') || null;
    const productHandles = [...new Set(cards.map(item => item.querySelector('a[href*="/products/"]')?.href)
      .filter(Boolean).map(href => new URL(href).pathname.split('/products/')[1]?.split('/')[0]).filter(Boolean))];
    const ratingSelector = '.loox-rating,[data-rating][data-raters],[data-s2s-product-rating],.jdgm-prev-badge,.yotpo-bottomline,.okeReviews-reviewsSummary';
    const ratingEntries = cards.map((item, index) => {
      const rating = item.querySelector(ratingSelector);
      const binding = item.querySelector('[data-s2s-rating-binding]') || rating;
      const ratingValue = rating?.getAttribute('data-rating') || null;
      const ratingCount = rating?.getAttribute('data-raters') || null;
      return {
        index,
        rating: metric(rating),
        visible: Boolean(rating && visible(rating)),
        productId: binding?.getAttribute('data-id') || null,
        source: rating?.getAttribute('data-s2s-rating-source') || null,
        ratingValue,
        ratingCount,
        bound: Boolean(binding?.getAttribute('data-id')),
        dataAvailable: Boolean(ratingValue && Number(ratingCount) > 0),
        empty: Boolean(rating) && !(rating.textContent || '').trim() && !ratingValue,
      };
    });
    const lefts = [...new Set(cards.slice(0, 12).map((item) => Math.round(item.getBoundingClientRect().left)))];
    return {
      title: document.title,
      visibleText: (document.body.innerText || "").replace(/\\s+/g, " ").trim(),
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 },
      grid: metric(grid),
      columns: lefts.length,
      cardCount: cards.length,
      card: metric(card),
      image: metric(image),
      ratings: {
        count: ratingEntries.length,
        boundCount: ratingEntries.filter((item) => item.bound).length,
        dataAvailableCount: ratingEntries.filter((item) => item.dataAvailable).length,
        visibleCount: ratingEntries.filter((item) => item.visible && !item.empty).length,
        items: ratingEntries.slice(0, 12),
      },
      interactions: {
        productLink: productLink?.href || null,
        productHandles,
        sortControls: Array.from(document.querySelectorAll('select[name*="sort" i],[data-sort-by],button[aria-label*="sort" i]')).filter(visible).length,
        filterControls: Array.from(document.querySelectorAll('[data-filter],form[action*="collections"] input,button[aria-label*="filter" i]')).filter(visible).length,
        pagination: Boolean(first([".pagination", "[data-pagination]", 'a[rel="next"]'])),
      },
    };
  })()`);
}

async function screenshot(page: Page, root: string, side: "source" | "target") {
  await mkdir(root, { recursive: true });
  const files: Record<string, string | null> = {};
  const regions: Array<[string, ReturnType<Page["locator"]> | null]> = [
    ["full", null],
    ["grid", page.locator("[data-s2s-collection-grid],.product-list,.collection-grid,.grid--view-items,.collection__products .grid").first()],
    ["card", page.locator("[data-s2s-collection-card],.product-list-item,.grid-product,.card-wrapper,.product-card").first()],
  ];
  for (const [name, locator] of regions) {
    const file = join(root, `${side}-${name}.png`);
    try {
      if (locator && (!(await locator.count()) || !(await locator.isVisible()))) throw new Error("missing region");
      if (locator) await locator.screenshot({ path: file, animations: "disabled" });
      else await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      files[name] = file;
    } catch {
      files[name] = null;
    }
  }
  return files;
}

async function diffPercent(source: string | null, target: string | null) {
  if (!source || !target) return null;
  const [aMeta, bMeta] = await Promise.all([sharp(source).metadata(), sharp(target).metadata()]);
  const width = Math.min(aMeta.width || 0, bMeta.width || 0);
  const height = Math.min(aMeta.height || 0, bMeta.height || 0);
  if (!width || !height) return null;
  const [a, b] = await Promise.all([
    sharp(source).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer(),
    sharp(target).extract({ left: 0, top: 0, width, height }).ensureAlpha().raw().toBuffer(),
  ]);
  const pixels = pixelmatch(a, b, undefined, width, height, { threshold: .1 });
  const heightPenalty = Math.abs((aMeta.height || height) - (bMeta.height || height)) / Math.max(aMeta.height || height, bMeta.height || height);
  return Number(Math.min(100, (pixels / (width * height) + heightPenalty) * 100).toFixed(2));
}

function targetCollectionUrl(targetBase: string, source: string) {
  const target = new URL(targetBase);
  target.pathname = new URL(source).pathname;
  return target.href;
}

export async function verifyCollectionFamilyEvidence(out: string, targetBase: string, sourceUrl?: string, threshold = 20, targetOnly = false, stage: "preflight" | "online" = "online") {
  const previous = await readJson<any>(join(out, "collection-family-evidence/layout-audit.json")).catch(() => null);
  const sourceCandidate = sourceUrl || previous?.source;
  if (!sourceCandidate) throw new Error("A representative source collection URL is required.");
  const source = (await publicUrl(sourceCandidate)).href;
  const targetCandidate = new URL(targetCollectionUrl(targetBase, source));
  const localPreflight = stage === "preflight" && targetCandidate.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(targetCandidate.hostname);
  if (stage === "preflight" && !localPreflight)
    throw new Error("Collection preflight requires the local loopback preview.");
  const target = localPreflight ? targetCandidate.href : (await publicUrl(targetCandidate.href)).href;
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: publicDnsBrowserArgs });
  const build = await readJson<any>(join(out, "theme-build.json")).catch(() => null);
  const report: any = {
    schemaVersion: COLLECTION_EVIDENCE_SCHEMA_VERSION,
    stage,
    contractVersion: COLLECTION_EVIDENCE_CONTRACT_VERSION,
    collectorVersion: COLLECTION_EVIDENCE_COLLECTOR_VERSION,
    themeBuild: build?.id || null,
    family: "reference-product-grid",
    checkedAt: new Date().toISOString(),
    source,
    target,
    threshold,
    requiredViewports: REQUIRED_VIEWPORTS,
    assertions: {},
    sourceReferenceBounds: {},
    interactions: {},
    visual: {},
    errors: [],
    sourceEvidence: targetOnly ? { mode: "reused", checkedAt: previous?.checkedAt || null, schemaVersion: previous?.schemaVersion || null } : { mode: "captured" },
    passed: false,
  };
  try {
    for (const viewport of REQUIRED_VIEWPORTS) {
      const records: any = {};
      if (targetOnly) {
        const priorAssertion = previous?.assertions?.[viewport.name];
        const priorBounds = previous?.sourceReferenceBounds?.[viewport.name];
        const priorInteraction = previous?.interactions?.[viewport.name]?.source;
        const priorRegions = previous?.visual?.[viewport.name]?.regions;
        if (!priorAssertion || !priorBounds || !priorInteraction || !priorRegions) {
          report.errors.push(`${viewport.name}:source: reusable source evidence is incomplete`);
        } else {
          records.source = {
            data: {
              columns: priorAssertion.sourceColumns,
              grid: priorBounds.grid ? { box: priorBounds.grid } : null,
              card: priorBounds.card ? { box: priorBounds.card } : null,
              image: priorBounds.image ? { box: priorBounds.image } : null,
              ratings: { visibleCount: priorAssertion.ratings?.sourceVisible || 0 },
              interactions: priorInteraction,
            },
            files: Object.fromEntries(["full", "grid", "card"].map((region) => [region, priorRegions?.[region]?.source || null])),
          };
        }
      }
      for (const [side, url] of (targetOnly ? [["target", target]] : [["source", source], ["target", target]]) as ReadonlyArray<readonly ["source" | "target", string]>) {
        const page = await browser.newPage({ viewport, locale: "en-US", colorScheme: "light" });
        try {
          let response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
          if (side === "target") response = await unlockStorefrontIfNeeded(page, url) || response;
          await settle(page);
          await assertRenderedEvidencePage(page, response, side);
          if (side === "target" && localPreflight) {
            const requestedPath = new URL(url).pathname.replace(/\/+$/, "") || "/";
            const finalPath = new URL(page.url()).pathname.replace(/\/+$/, "") || "/";
            const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href").catch(() => null);
            const canonicalPath = canonical ? (new URL(canonical, url).pathname.replace(/\/+$/, "") || "/") : null;
            if (finalPath !== requestedPath || canonicalPath !== requestedPath)
              throw new Error(`TARGET_EVIDENCE_INVALID: local preview route/canonical does not match ${requestedPath}`);
            const renderedBuild = await page.locator('meta[name="site2shop-build-id"]').first().getAttribute("content").catch(() => null);
            if (!renderedBuild || renderedBuild !== report.themeBuild)
              throw new Error("TARGET_EVIDENCE_INVALID: rendered theme build identity is missing or stale");
          } else await assertRenderedEvidenceRoute(page, url, side);
          await page.addStyleTag({ content: '#attentive_overlay,#attentive_creative,#gorgias-chat-container,#PBarNextFrame,iframe[title*="Sign Up"]{display:none!important}' });
          await hydrateFullPage(page);
          const root = join(out, "collection-family-evidence", viewport.name);
          records[side] = { data: await inspectCollection(page), files: await screenshot(page, root, side) };
        } catch (error) {
          report.errors.push(`${viewport.name}:${side}: ${String(error)}`);
        } finally {
          await page.close();
        }
      }
      const sourceRecord = records.source;
      const targetRecord = records.target;
      if (!sourceRecord || !targetRecord) continue;
      const sourceData = sourceRecord.data;
      const targetData = targetRecord.data;
      const ratio = (metric: any) => metric?.box?.height ? metric.box.width / metric.box.height : null;
      const relative = (actual: number, expected: number) => expected ? Math.abs(actual - expected) / Math.abs(expected) : 0;
      const sourceImageRatio = ratio(sourceData.image);
      const targetImageRatio = ratio(targetData.image);
      const sizeDeltas = {
        gridWidth: sourceData.grid?.box?.width && targetData.grid?.box?.width ? relative(targetData.grid.box.width, sourceData.grid.box.width) : null,
        cardWidth: sourceData.card?.box?.width && targetData.card?.box?.width ? relative(targetData.card.box.width, sourceData.card.box.width) : null,
        imageRatio: sourceImageRatio != null && targetImageRatio != null ? relative(targetImageRatio, sourceImageRatio) : null,
      };
      const sourceRatingsRequired = sourceData.ratings?.visibleCount > 0;
      const ratingCoverage = sourceRatingsRequired
        ? Math.min(1, (targetData.ratings?.visibleCount || 0) / Math.max(1, sourceData.ratings.visibleCount))
        : 1;
      const ratingBindingCoverage = targetData.ratings?.count
        ? (targetData.ratings.boundCount || 0) / targetData.ratings.count
        : 0;
      report.sourceReferenceBounds[viewport.name] = { grid: sourceData.grid?.box || null, card: sourceData.card?.box || null, image: sourceData.image?.box || null };
      report.assertions[viewport.name] = {
        viewport: `${viewport.width}x${viewport.height}`,
        columns: targetData.columns,
        sourceColumns: sourceData.columns,
        grid: targetData.grid?.box || null,
        card: targetData.card?.box || null,
        image: targetData.image?.box || null,
        horizontalOverflow: targetData.document.horizontalOverflow,
        deltas: sizeDeltas,
        ratings: {
          required: sourceRatingsRequired,
          sourceVisible: sourceData.ratings?.visibleCount || 0,
          targetVisible: targetData.ratings?.visibleCount || 0,
          targetBound: targetData.ratings?.boundCount || 0,
          targetDataAvailable: targetData.ratings?.dataAvailableCount || 0,
          bindingCoverage: ratingBindingCoverage,
          dataCoverage: ratingCoverage,
          implementationPassed: ratingBindingCoverage === 1,
          dataPassed: ratingCoverage === 1,
        },
        // Collection acceptance verifies the target's review binding, not copied
        // source review totals. Target review-data availability remains explicit
        // diagnostics and is verified online against the target store's own data.
        passed: sourceData.columns === targetData.columns && !targetData.document.horizontalOverflow && ratingBindingCoverage === 1 && Object.values(sizeDeltas).filter((value) => value != null).every((value: any) => value <= .15),
      };
      report.interactions[viewport.name] = {
        source: sourceData.interactions,
        target: targetData.interactions,
        productIdentityPassed: JSON.stringify(sourceData.interactions.productHandles || []) === JSON.stringify(targetData.interactions.productHandles || []),
        passed: Boolean(targetData.interactions.productLink)
          && JSON.stringify(sourceData.interactions.productHandles || []) === JSON.stringify(targetData.interactions.productHandles || [])
          && (!sourceData.interactions.sortControls || targetData.interactions.sortControls > 0)
          && (!sourceData.interactions.filterControls || targetData.interactions.filterControls > 0)
          && (!sourceData.interactions.pagination || targetData.interactions.pagination),
      };
      const regions: any = {};
      for (const region of ["full", "grid", "card"])
        regions[region] = { source: sourceRecord.files[region], target: targetRecord.files[region], diffPercent: await diffPercent(sourceRecord.files[region], targetRecord.files[region]) };
      report.visual[viewport.name] = {
        regions,
        passed: Object.values(regions).every((item: any) => item.diffPercent != null && item.diffPercent <= threshold),
      };
    }
  } finally {
    await browser.close();
  }
  report.executableEvidence = await executableEvidenceCheck(out, stage);
  if (!report.executableEvidence.passed) report.errors.push(report.executableEvidence.reason);
  report.objectivePassed = !report.errors.length && REQUIRED_VIEWPORTS.every(({ name }) => report.assertions[name]?.passed && report.interactions[name]?.passed);
  report.pixelDiagnosticsPassed = REQUIRED_VIEWPORTS.every(({ name }) => report.visual[name]?.passed);
  report.passed = report.objectivePassed;
  await json(join(out, "collection-family-evidence/layout-audit.json"), report);
  return report;
}
