import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { incrementalContext, planIncrementalAcceptance, boundArtifact } from './incremental-acceptance.js';
import { assertEvidencePlan, evidenceRequire, loadEvidencePlan, saveEvidence, PROJECT_ROOT, type EvidenceStage } from "./evidence-gate.js";
import { atomicJson, captureCacheKey, loadCaptureCache, saveCaptureCache, sourceCaptureContract, stable } from "./capture-cache.js";
import { fileURLToPath } from "node:url";
import { capturePresentation, type PresentationLocator } from "./presentation-capture.js";
import { hash, readJson } from "./util.js";
import { assertRenderedEvidencePage, routeIdentityRejection } from "./rendered-page-validity.js";
import { unlockStorefrontIfNeeded } from "./storefront-auth.js";
import { publicUrl, publicDnsBrowserArgs } from "./network.js";
import { assertGeneratedThemeIntegrity } from "./theme-integrity.js";
import { captureInteractionControls } from './interaction-capture.js';

const active = (node: any, viewport: string) => !node.viewports || node.viewports.includes(viewport);
export const PLANNED_COLLECTOR_VERSION = "site2shop-planned-capture-v3";

export function assertCaptureAdapters(plan: any, side: "source" | "target") {
  for (const [rid, rp] of Object.entries<any>(plan.routes)) for (const vp of Object.keys(plan.viewports)) {
    for (const kind of ["states", "transitions"]) for (const [id, node] of Object.entries<any>(rp[kind])) {
      if (!active(node, vp)) continue;
      const config = node.capture?.[side];
      evidenceRequire(config?.ready?.selector && ["visible", "hidden", "attached"].includes(config.ready.state), `${rid}/${vp}/${id}: missing ready adapter`);
      for (const cid of node.components) evidenceRequire(config.components?.[cid]?.selector, `${rid}/${vp}/${id}: missing ${side} component ${cid}`);
      for (const probe of config.observations || []) evidenceRequire(probe.selector && ["count", "texts", "text", "value", "attribute", "visible"].includes(probe.read), `${rid}/${id}: unsupported observation adapter`);
    }
    const sequence = rp.captureSequence?.[vp] ?? rp.captureSequence;
    evidenceRequire(Array.isArray(sequence), `${rid}/${vp}: missing captureSequence`);
    let current = "initial", actions = 0;
    const visited = new Set([current]), edges = new Set();
    for (const id of sequence) {
      const edge = rp.transitions[id];
      evidenceRequire(edge && active(edge, vp) && edge.from === current && !edge.navigation && !edges.has(id), `${rid}/${vp}: unsupported/broken workflow sequence`);
      evidenceRequire(Array.isArray(edge.probe?.[side]) && edge.probe[side].length, `${rid}/${id}: missing action probe`);
      for (const step of edge.probe[side]) evidenceRequire(["click", "select", "fill", "check", "scroll"].includes(step.op)
        && step.effect === "read-only" && (step.op === "scroll" ? Number.isFinite(step.y) : !!step.selector), `${rid}/${id}: unsupported action adapter`);
      actions += edge.probe[side].length;
      current = edge.to;
      evidenceRequire(rp.states[current] && active(rp.states[current], vp), `${rid}/${id}: missing destination state`);
      visited.add(current); edges.add(id);
    }
    evidenceRequire(actions <= plan.limits.maxActionsPerRoute, `${rid}/${vp}: planned action budget exceeded`);
    evidenceRequire(Object.entries<any>(rp.states).every(([id, node]) => !active(node, vp) || visited.has(id)) && Object.entries<any>(rp.transitions).every(([id, node]) => !active(node, vp) || edges.has(id)), `${rid}/${vp}: captureSequence omits planned nodes`);
  }
}

export async function captureNavigationCoverage(out: string, plan: any, stage: EvidenceStage, buildId: string, themeId: string | null) {
  const inventory = JSON.parse(await readFile(join(out, plan.routeInventory.path), "utf8"));
  const analysis = JSON.parse(await readFile(join(out, plan.analysis.path), "utf8"));
  const report: any = { schemaVersion: 1, inventorySha256: plan.routeInventory.sha256, stage, buildId, themeId, surfaces: {}, routes: {} };
  const entries = Object.entries<any>(inventory.routes);
  const errors: string[] = [];
  let cursor = 0;
  let onlineBrowser: Browser | null = null;
  let onlineContext: BrowserContext | null = null;
  let surfaceBrowser: Browser | null = null;
  if (stage === "online") {
    evidenceRequire(themeId, "online navigation coverage requires a draft theme id");
    onlineBrowser = await chromium.launch({ headless: true, channel: "chromium", args: publicDnsBrowserArgs });
    onlineContext = await onlineBrowser.newContext({ locale: "en-US" });
    const page = await onlineContext.newPage();
    const first = entries[0]?.[1]?.target?.url;
    evidenceRequire(first, "online navigation coverage has no target routes");
    const preview = draftPreviewRoute(`https://${new URL(first).host}/?preview_theme_id=${themeId}`, first);
    let response = await page.goto(preview, { waitUntil: "domcontentloaded", timeout: 60000 });
    response = (await unlockStorefrontIfNeeded(page, preview)) || response;
    await assertRenderedEvidencePage(page, response, "target");
    await page.close();
  }
  if (stage === "preflight") surfaceBrowser = await chromium.launch({ headless: true });
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function onlineGet(url: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await onlineContext!.request.get(url, { maxRedirects: 20, headers: { "user-agent": "Site2Shop-Navigation-Probe/1.0" } });
      const status = response.status();
      if (![429, 503].includes(status)) {
        await wait(300);
        return response;
      }
      const retryAfter = Number(response.headers()["retry-after"] || 0) * 1000;
      await response.dispose();
      if (attempt === 3) throw new Error(`navigation route remained rate limited: ${status}`);
      await wait(Math.min(60000, Math.max(retryAfter, 5000 * (attempt + 1))));
    }
    throw new Error("navigation request retry loop exhausted");
  }
  async function preflightGet(url: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
        headers: { "user-agent": "Site2Shop-Navigation-Probe/1.0" },
      });
      if (![429, 502, 503].includes(response.status)) return response;
      await response.arrayBuffer().catch(() => undefined);
      if (attempt === 3) return response;
      await wait(1000 * (attempt + 1));
    }
    throw new Error("preflight navigation request retry loop exhausted");
  }
  async function worker() {
    while (cursor < entries.length) {
      const [routeId, route] = entries[cursor++];
      const expectedBase = stage === "preflight" ? route.localTarget || route.target : route.target;
      const expected = stage === "online"
        ? { ...expectedBase, url: draftPreviewRoute(`https://${new URL(expectedBase.url).host}/?preview_theme_id=${themeId}`, expectedBase.url) }
        : expectedBase;
      try {
        const response: any = stage === "online"
          ? await onlineGet(expected.url)
          : await preflightGet(expected.url);
        const html = await response.text();
        const status = typeof response.status === "function" ? response.status() : response.status;
        const finalUrl = typeof response.url === "function" ? response.url() : response.url;
        const ok = typeof response.ok === "function" ? response.ok() : response.ok;
        evidenceRequire(ok, `navigation route failed: ${routeId}/${status}`);
        evidenceRequire(!/\/(?:password|challenge|checkpoint)(?:\/|$)/i.test(new URL(finalUrl).pathname), `navigation interstitial: ${routeId}`);
        evidenceRequire(!/(?:page not found|404 not found|shop is unavailable)/i.test(html.slice(0, 16000)), `navigation soft 404: ${routeId}`);
        evidenceRequire(!/<form\b[^>]*action=["'][^"']*\/password/i.test(html), `storefront password page: ${routeId}`);
        const canonicalMatch = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i)
          || html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["']/i);
        evidenceRequire(canonicalMatch, `navigation canonical missing: ${routeId}`);
        const canonical = new URL(canonicalMatch[1], finalUrl).href;
        evidenceRequire(!routeIdentityRejection(expected.url, finalUrl), `navigation final route mismatch: ${routeId}`);
        evidenceRequire(!routeIdentityRejection(expected.canonical, canonical), `navigation canonical mismatch: ${routeId}`);
        const renderedBuild = html.match(/<meta\b[^>]*\bname=["']site2shop-build-id["'][^>]*\bcontent=["']([^"']+)["']/i)?.[1];
        evidenceRequire(renderedBuild === buildId, `navigation stale build: ${routeId}`);
        const artifact = await saveEvidence(out, html, "html");
        const probes: any = {};
        for (const [viewport, dimensions] of Object.entries<any>(plan.viewports)) {
          const data = { buildId, themeId, viewport: { name: viewport, ...dimensions }, capturedAt: new Date().toISOString(),
            httpStatus: status, pageKind: "content", soft404: false, requestedUrl: expected.url,
            finalUrl, canonical, redirectChain: [expected.url], artifact };
          probes[viewport] = await saveEvidence(out, JSON.stringify(data), "json");
        }
        report.routes[routeId] = probes;
      } catch (error) {
        const reason = String(error);
        errors.push(reason);
        report.routes[routeId] = { status: "failed", requestedUrl: expected.url, reason };
      }
    }
  }
  async function captureSurface(surface: any) {
    if (surface.region === "sitemap") return;
    const target = surface.target;
    const localOrigin = Object.values<any>(plan.routes)
      .map((route) => route.localTarget?.url)
      .find(Boolean);
    const expectedUrl = stage === "online"
      ? draftPreviewRoute(`https://${new URL(target.url).host}/?preview_theme_id=${themeId}`, target.url)
      : new URL(new URL(target.url).pathname + new URL(target.url).search, localOrigin).href;
    const context = stage === "online"
      ? onlineContext!
      : await surfaceBrowser!.newContext({ viewport: plan.viewports[surface.viewport], locale: "en-US" });
    const page = await context.newPage();
    if (stage === "online") await page.setViewportSize(plan.viewports[surface.viewport]);
    try {
      let response = await page.goto(expectedUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      response = (await unlockStorefrontIfNeeded(page, expectedUrl)) || response;
      await assertRenderedEvidencePage(page, response, "target");
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const identity = await page.evaluate(() => ({
        finalUrl: location.href,
        canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || "",
      }));
      evidenceRequire(new URL(identity.finalUrl).pathname === new URL(expectedUrl).pathname, `navigation surface route mismatch: ${surface.id}`);
      evidenceRequire(new URL(identity.canonical).pathname === new URL(target.canonical).pathname, `navigation surface canonical mismatch: ${surface.id}`);
      const links = await page.evaluate(() => {
        const roots = [...document.querySelectorAll("header, footer")];
        const seen = new Set<string>();
        return roots
          .flatMap((root) => [...root.querySelectorAll<HTMLAnchorElement>("a[href]")])
          .filter((anchor) => {
            try {
              // Dropdown/offcanvas triggers are interaction controls, not
              // navigation destinations. Their fallback href may be rewritten
              // to the store root during generation and must not create a new
              // route that was absent from the rendered source inventory.
              if (/^(dropdown|offcanvas|collapse)$/i.test(anchor.getAttribute("data-bs-toggle") || "")) return false;
              const raw = (anchor.getAttribute("href") || "").trim();
              if (!raw || raw.startsWith("#")) return false;
              const url = new URL(anchor.href, location.href);
              if (!/^https?:$/.test(url.protocol)) return false;
              const key = `${url.href}|${(anchor.textContent || "").trim()}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            } catch { return false; }
          })
          .map((anchor, index) => ({
            id: `route-${index + 1}`,
            href: anchor.getAttribute("href") || anchor.href,
            text: (anchor.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
          }));
      });
      const html = await page.evaluate(() => [...document.querySelectorAll("header, footer")].map((node) => node.outerHTML).join("\n"));
      const artifact = await saveEvidence(out, html, "html");
      report.surfaces[surface.id] = await saveEvidence(out, JSON.stringify({
        buildId,
        themeId,
        viewport: surface.viewport,
        state: surface.state,
        capturedAt: new Date().toISOString(),
        httpStatus: response?.status() || 200,
        pageKind: "content",
        soft404: false,
        url: expectedUrl,
        finalUrl: identity.finalUrl,
        canonical: identity.canonical,
        artifact,
        links,
      }), "json");
    } finally {
      await page.close();
      if (stage === "preflight") await context.close();
    }
  }
  try {
    // Cheap route health comes first. A known policy 404 must not wait behind
    // every product workflow or navigation-surface screenshot.
    await Promise.all(Array.from({ length: Math.min(stage === "online" ? 1 : 4, entries.length) }, () => worker()));
    if (errors.length) return { artifact: await saveEvidence(out, JSON.stringify(report), "json"), errors };
    for (const surface of analysis.navigationSurfaces || []) {
      try { await captureSurface(surface); }
      catch (error) { errors.push(`navigation surface ${surface.id}: ${String(error)}`); }
    }
    return { artifact: await saveEvidence(out, JSON.stringify(report), "json"), errors };
  } finally {
    await surfaceBrowser?.close().catch(() => {});
    await onlineContext?.close().catch(() => {});
    await onlineBrowser?.close().catch(() => {});
  }
}
async function assertPlannedRoute(page: Page, location: any) {
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  evidenceRequire(canonical, "canonical missing");
  evidenceRequire(!routeIdentityRejection(location.url, page.url()), "final route differs from planned route");
  evidenceRequire(!routeIdentityRejection(location.canonical, new URL(canonical, page.url()).href), "canonical differs from independently planned canonical");
}
function parts(pointer: string) {
  evidenceRequire(typeof pointer === "string" && pointer.startsWith("/") && !/~(?![01])/.test(pointer), "invalid observation pointer");
  const result = pointer.slice(1).split("/").map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  evidenceRequire(result.every(p => p && !["__proto__", "constructor", "prototype"].includes(p)), "unsafe observation pointer");
  return result;
}
function set(value: any, pointer: string, observed: any) {
  const path = parts(pointer), last = path.pop()!;
  for (const p of path) value = value[p] ||= {};
  evidenceRequire(!Object.hasOwn(value, last), `duplicate observation pointer ${pointer}`);
  value[last] = observed;
}
function get(value: any, pointer: string) { for (const p of parts(pointer)) value = value[p]; return value; }

async function waitForState(page: Page, node: any, side: "source" | "target") {
  const condition = node.capture?.[side]?.ready;
  evidenceRequire(condition?.selector && ["visible", "hidden", "attached"].includes(condition.state), "state needs an observable ready postcondition");
  const candidates = page.locator(condition.selector);
  const locator = condition.state === "visible" ? page.locator(`${condition.selector}:visible`).first() : candidates;
  await locator.waitFor({ state: condition.state, timeout: 15000 });
  if (condition.text !== undefined || condition.value !== undefined) {
    // Read through Playwright too: selectors such as :visible/:nth-match are
    // valid plan adapters, but invalid native document.querySelector CSS.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if ((condition.text === undefined || await locator.innerText() === condition.text)
        && (condition.value === undefined || await locator.inputValue() === condition.value)) break;
      await page.waitForTimeout(100);
    }
  }
  if (condition.text !== undefined) evidenceRequire(await locator.innerText() === condition.text, "state text postcondition failed");
  if (condition.value !== undefined) evidenceRequire(await locator.inputValue() === condition.value, "state value postcondition failed");
  await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 15000 });
  await page.waitForTimeout(1000);
}

export async function observePlannedState(page: Page, node: any, components: any[], side: "source" | "target") {
  await waitForState(page, node, side);
  const specs = node.components.map((cid: string) => components.find(c => c.id === cid));
  const rendered = specs.filter((c: any) => c?.acceptance?.kind === "rendered");
  const mappings: PresentationLocator[] = rendered.map((c: any) => {
    const locator = node.capture?.[side]?.components?.[c.id];
    evidenceRequire(locator, `${c.id}: independent ${side} locator mapping missing`);
    return { ...locator, id: c.id };
  });
  const measured = mappings.length ? await capturePresentation(page, mappings) : null;
  const result: any = measured ? { presentationContext: measured.presentationContext, presentationRaw: measured.presentationRaw, components: measured.components } : {};
  result.components ||= {};
  // A workflow contract can declare semantic components that are not geometry
  // contracts (for example the active form or the first lower-page section).
  // They still need bidirectional presence evidence for paired review.  Do not
  // silently drop them merely because their registry entry is not `rendered`.
  for (const cid of node.components as string[]) {
    if (result.components[cid]) continue;
    const locator = node.capture?.[side]?.components?.[cid];
    evidenceRequire(locator?.selector, `${cid}: independent ${side} locator mapping missing`);
    const candidates = page.locator(locator.selector);
    const count = await candidates.count();
    // Wrapper elements such as Shopify's product <form> may intentionally have
    // no box while their controls are visible.  Treat a semantic component as
    // visible when either its root or any descendant participates in layout.
    const visible = count > 0 && await candidates.evaluateAll(nodes => {
      for (const root of nodes) {
        for (const element of [root, ...root.querySelectorAll("*")]) {
          const style = getComputedStyle(element);
          if (style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse"
            && Number(style.opacity) !== 0 && element.getClientRects().length > 0) return true;
        }
      }
      return false;
    });
    result.components[cid] = { presence: count === 0 ? "absent" : visible ? "visible" : "hidden" };
  }
  for (const c of rendered) set(result, c.acceptance[`${side}Pointer`], measured.boxes[c.id]);
  for (const probe of node.capture?.[side]?.observations || []) {
    const locator = page.locator(probe.selector);
    const count = await locator.count();
    let value: any;
    if (probe.read === "count") value = count;
    else if (probe.read === "texts") value = await locator.allInnerTexts();
    else {
      evidenceRequire(count === 1, `ambiguous/missing observation: ${probe.pointer}`);
      if (probe.read === "text") value = await locator.innerText();
      else if (probe.read === "value") value = await locator.inputValue();
      else if (probe.read === "attribute") value = await locator.getAttribute(probe.attribute);
      else if (probe.read === "visible") value = await locator.isVisible();
      else throw new Error(`Unsupported observation adapter ${probe.read}`);
    }
    evidenceRequire(value !== null && value !== undefined, `missing observation ${probe.pointer}`);
    set(result, probe.pointer, value);
  }
  for (const rule of node.rules) evidenceRequire(get(result, rule[`${side}Pointer`]) !== undefined, `collector cannot provide ${rule.id}`);
  const interactionAdapter=node.capture?.[side]?.interactionInventory;
  if(interactionAdapter)result.interactionControls=await captureInteractionControls(page,interactionAdapter);
  return result;
}

export async function performPlannedAction(page: Page, edge: any, side: "source" | "target") {
  const steps = edge.probe?.[side];
  evidenceRequire(Array.isArray(steps) && steps.length, `transition ${edge.action}: missing explicit UI recipe`);
  const performed: any[] = [];
  for (const step of steps) {
    evidenceRequire(step.effect === "read-only", "this collector supports read-only probes only; use an authorized workflow adapter for uploads/cart/submission");
    const startedAt = new Date().toISOString();
    const control = step.selector ? page.locator(step.selector).nth(Number.isInteger(step.index) ? step.index : 0) : null;
    if (step.op === "click" && control) await control.click();
    else if (step.op === "select" && control) await control.selectOption(step.value);
    else if (step.op === "fill" && control) await control.fill(step.value);
    else if (step.op === "check" && control) await control.setChecked(step.checked);
    else if (step.op === "scroll" && Number.isFinite(step.y)) await page.evaluate(y => scrollTo({ top: y, behavior: "instant" }), step.y);
    else throw new Error(`Unsupported planned operation ${step.op}`);
    performed.push({ ...step, startedAt, endedAt: new Date().toISOString(), status: "performed" });
  }
  return performed;
}

function equivalent(node: any, side: string, before: any, after: any) {
  // A revisited semantic state may use a representative endpoint only when its
  // required observations still match. Preserve actual per-action snapshots too.
  for (const rule of node.rules) {
    const a = get(before, rule[`${side}Pointer`]), b = get(after, rule[`${side}Pointer`]);
    const same = rule.operator === "numeric"
      ? typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= Math.max(rule.tolerance.absolute, Math.abs(a) * rule.tolerance.relative)
      : JSON.stringify(a) === JSON.stringify(b);
    evidenceRequire(same, `revisited state differs for ${rule.id}; model it as a distinct state`);
  }
}

export function draftPreviewRoute(previewUrl: string, routeUrl: string) {
  const preview = new URL(previewUrl);
  const route = new URL(routeUrl);
  route.searchParams.forEach((value, key) => preview.searchParams.set(key, value));
  preview.pathname = route.pathname;
  preview.hash = route.hash;
  return preview.href;
}

// Formal capture is separate from heuristic diagnostic collectors. Every planned
// node remains in coverage, including failures; this function never creates passes.
export type CaptureOptions = { refresh?: boolean; cacheMaxAgeHours?: number; precheckOnly?: boolean };

export function isBusinessWriteRequest(requestUrl: string, method: string, pageUrl: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const url = new URL(requestUrl);
  const pageOrigin = new URL(pageUrl).origin;
  const safeSameOriginBootstrap = /^\/(?:\.well-known\/shopify\/(?:fec|monorail)(?:\/|$)|api\/(?:event\/)?collect(?:\/|$)|shopify_pay\/accelerated_checkout\/?$)/i.test(url.pathname);
  return (url.origin === pageOrigin && !safeSameOriginBootstrap)
    || /\/(cart|checkout|orders?|customers?|account|apps\/[^/]+\/(submit|upload))/i.test(url.pathname);
}
export async function capturePlannedEvidence(out: string, side: "source" | "target", stage: EvidenceStage = side === "source" ? "source" : "preflight", options: CaptureOptions = {}) {
  evidenceRequire((side === "source") === (stage === "source"), "capture side/stage mismatch");
  await assertEvidencePlan(out);
  const { plan, analysis, planSha256 } = await loadEvidencePlan(out);
  const incremental = side === 'target' ? await incrementalContext(out) : null;
  const captureRoutes = Object.fromEntries(Object.entries<any>(plan.routes).filter(([rid])=>!incremental||incremental.routeIds.includes(rid)));
  const coverageFilename = options.precheckOnly?`${stage}-precheck-coverage.json`:`${stage}-coverage${incremental ? '.incremental' : ''}.json`;
  const maxAgeHours = options.cacheMaxAgeHours ?? 24;
  evidenceRequire(Number.isFinite(maxAgeHours) && maxAgeHours >= 0 && maxAgeHours <= 24, "cache max age must be between 0 and 24 hours");
  evidenceRequire(plan.collectorVersion === PLANNED_COLLECTOR_VERSION, "plan targets a different collector version; revalidate adapter capabilities");
  assertCaptureAdapters(plan, side);
  const buildId = side === "target" ? (await assertGeneratedThemeIntegrity(out)).actual : null;
  const deployment = stage === "online" ? await readJson<any>(join(out, "deployment.json")) : null;
  if (deployment) evidenceRequire(deployment.role === "unpublished" && !deployment.published && deployment.themeBuild === buildId, "capture requires the current unpublished theme");
  const themeId = deployment ? String(deployment.themeId) : null;
  if(side==='target'&&!options.precheckOnly&&await readFile(join(out,'acceptance-dependencies.json')).catch(()=>null)) {
    const impact=await planIncrementalAcceptance(out);
    if(impact.zeroChanges&&impact.baseline){const baseline=await boundArtifact(out,impact.baseline);const retained={captureComplete:true,acceptance:'not-run',baselineUnchanged:true,buildId,stats:{capturedWorkflows:0,reusedWorkflows:Object.keys(plan.routes).length*Object.keys(plan.viewports).length},baseline:impact.baseline,routeReceipts:baseline.routeReceipts};await atomicJson(join(out,`${stage}-capture-result.json`),retained);return retained;}
  }
  const source = side === "target" ? await readJson<any>(join(out, "source-coverage.json")) : null;
  if (source) evidenceRequire(source.planSha256 === planSha256, "stale source coverage");
  const registry = side === "target" ? await readJson<any>(join(out, "generator-presentation-bindings.json")) : null;
  if (registry) evidenceRequire(registry.planSha256 === planSha256 && registry.buildId === buildId, "stale generator registry");
  const previous = await readFile(join(out, coverageFilename)).catch(() => null);
  const priorCoverage = previous ? await saveEvidence(out, previous, "json") : null;
  const originalPlan = await saveEvidence(out, await readFile(join(out, "capture-plan.json")), "json");
  const runtime = hash((await Promise.all(["planned-capture.ts", "capture-cache.ts", "presentation-capture.ts", "rendered-page-validity.ts", "storefront-auth.ts", "network.ts", "../package-lock.json"]
    .map(name => readFile(join(PROJECT_ROOT, 'src', name))))).map(bytes => hash(bytes)).join("|"));
  const coverage: any = { schemaVersion: 2, planSha256, stage, buildId, themeId, priorCoverage, routes: {} };
  if(incremental)coverage.incremental={routeIds:incremental.routeIds,baselineSha256:incremental.impact.baseline?.sha256,inputsDigest:incremental.impact.inputsDigest};
  for (const [rid, rp] of Object.entries<any>(captureRoutes)) {
    coverage.routes[rid] = { viewports: {} };
    for (const vp of Object.keys(plan.viewports)) {
      const result: any = { states: {}, transitions: {} };
      for (const kind of ["states", "transitions"]) for (const [id, node] of Object.entries<any>(rp[kind]))
        if (active(node, vp)) result[kind][id] = { status: "missing", reason: "planned node has not been exercised" };
      coverage.routes[rid].viewports[vp] = result;
    }
  }
  const stats = { reusedWorkflows: 0, capturedWorkflows: 0, totalWorkflows: Object.keys(captureRoutes).length * Object.keys(plan.viewports).length };
  const precheck: any = { planSha256, stage, buildId, startedAt: new Date().toISOString(), passed: false, workflows: {}, acceptance: "not-run" };
  const fingerprints = new Map<string, string>();
  const keys = new Map<string, string>();
  const verifiedCacheArtifacts = new Set<string>();
  const errors: string[] = [];
  const checkpoint = async () => {
    await atomicJson(join(out, coverageFilename), coverage);
    await atomicJson(join(out, `${stage}-capture-result.json`), { captureComplete: false, errors, planSha256, buildId, stats, acceptance: "not-run", precheckOnly: !!options.precheckOnly });
  };
  await checkpoint();
  if (side === "target" && !incremental) {
    try {
      const navigation = await captureNavigationCoverage(out, plan, stage, buildId!, themeId);
      coverage.navigation = navigation.artifact;
      errors.push(...navigation.errors.map(error => `precheck navigation: ${error}`));
    } catch (error) { errors.push(`precheck navigation: ${String(error)}`); }
    if (errors.length) {
      for (const route of Object.values<any>(coverage.routes)) for (const result of Object.values<any>(route.viewports))
        result.states.initial = { status: "failed", reason: errors.join("; ") };
      await checkpoint();
      await atomicJson(join(out, `${stage}-precheck.json`), { ...precheck, errors });
      evidenceRequire(false, errors.join("; "));
    }
  }
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: publicDnsBrowserArgs });
  try {
    for (const phase of ["precheck", "capture"] as const) {
    for (const [rid, rp] of Object.entries<any>(captureRoutes)) {
      const components = analysis.routes.find((r: any) => r.id === rid).components;
      for (const [vp, dimensions] of Object.entries<any>(plan.viewports)) {
        const slot = `${rid}/${vp}`;
        const result = coverage.routes[rid].viewports[vp];
        if (phase === "capture") {
          const contract = side === "source" ? sourceCaptureContract(plan, analysis, rid, vp) : { planSha256, rid, vp };
          const key = captureCacheKey(contract, runtime, stage, buildId, themeId);
          keys.set(slot, key);
          const cached = !options.refresh && maxAgeHours > 0
            ? await loadCaptureCache(out, key, fingerprints.get(slot)!, maxAgeHours * 3600000, verifiedCacheArtifacts)
            : { entry: null, reason: "forced-refresh" };
          result.cache = { key, reason: cached.reason };
          if (cached.entry) {
            const reused = structuredClone(cached.entry.result);
            if(side==='source')reused.sourceFingerprint=fingerprints.get(slot);
            // Target captures stay build-bound, but use the current valid source
            // baseline and generated-code bindings rather than stale manifest links.
            if (side === "target") {
              reused.sourceProvenance = source.routes[rid].viewports[vp].sourceProvenance;
              for (const kind of ["states", "transitions"]) for (const [id, record] of Object.entries<any>(reused[kind])) {
                record.source = source.routes[rid].viewports[vp][kind][id].source;
                record.presentationBindings = registry.entries.find((e: any) => e.routeId === rid && e.viewport === vp && e.kind === kind && e.nodeId === id)?.bindings;
              }
            }
            reused.cache = { key, reason: cached.reason, reused: true, checkedAt: new Date().toISOString() };
            coverage.routes[rid].viewports[vp] = reused;
            stats.reusedWorkflows++;
            await checkpoint();
            continue;
          }
          result.sourceProvenance = side === "source" ? originalPlan : source?.routes?.[rid]?.viewports?.[vp]?.sourceProvenance;
          if(side==='source')result.sourceFingerprint=fingerprints.get(slot);
        }
        const page = await browser.newPage({ viewport: dimensions, deviceScaleFactor: 1, locale: "en-US", colorScheme: "light" });
        page.setDefaultTimeout(15000);
        const denied: string[] = [];
        const blockedTelemetry: string[] = [];
        const baseLocation = side === "target" && stage === "preflight" ? rp.localTarget || rp.target : rp[side];
        const location = side === "target" && stage === "online"
          ? { ...baseLocation, url: draftPreviewRoute(deployment.previewUrl, baseLocation.url) }
          : baseLocation;
        let allowPassword = false;
        await page.route("**/*", async route => {
          const url = new URL(route.request().url()), method = route.request().method();
          const authorizedUnlock = allowPassword && method === "POST" && url.origin === new URL(location.url).origin && url.pathname === "/password";
          if (!["GET", "HEAD", "OPTIONS"].includes(method) && !authorizedUnlock) {
            // Rendered source pages routinely emit cross-origin analytics POSTs when a
            // read-only option or step button changes. Abort every write, but only
            // treat a same-origin/business endpoint as a workflow mutation. Otherwise
            // telemetry would make a safe client-side state transition impossible to
            // capture while still never allowing the analytics request to leave.
            const businessWrite = isBusinessWriteRequest(route.request().url(), method, location.url);
            (businessWrite ? denied : blockedTelemetry).push(`${method} ${url.origin}${url.pathname}`);
            await route.abort();
          } else await route.continue();
        });
        let current = "initial", response: any;
        const started = Date.now();
        const stateRefs = new Map<string, any>();
        const stateData = new Map<string, any>();
        const stateObservations = new Map<string, any>();
        try {
          if (!(stage === "preflight" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(location.url).hostname))) await publicUrl(location.url);
          // Keep the network write guard active even during password unlock.
          const transientStatuses = new Set([429, 500, 502, 503, 504]);
          const attempts = phase === "precheck" ? 2 : 3;
          for (let attempt = 0; attempt < attempts; attempt++) {
            try {
              response = await page.goto(location.url, { waitUntil: "domcontentloaded", timeout: phase === "precheck" ? 30000 : 60000 });
            } catch (error) {
              if (attempt === attempts - 1) throw error;
              await page.waitForTimeout(750 * (attempt + 1));
              continue;
            }
            const status = response?.status?.() || 0;
            if (!transientStatuses.has(status) || attempt === attempts - 1) break;
            await page.waitForTimeout(750 * (attempt + 1));
          }
          if (side === "target") {
            allowPassword = true;
            try { response = await unlockStorefrontIfNeeded(page, location.url) || response; }
            finally { allowPassword = false; }
          }
          await assertRenderedEvidencePage(page, response, side);
          await assertPlannedRoute(page, location);
          if (stage === "online") {
            const actual = await page.evaluate(() => String((window as any).Shopify?.theme?.id || ""));
            evidenceRequire(actual === String(deployment.themeId), "browser is not rendering the intended draft theme");
          }
          if (stage === "preflight") {
            const renderedBuild = await page.locator('meta[name="site2shop-build-id"]').getAttribute("content");
            evidenceRequire(renderedBuild === buildId, "local preview is stale or has no rendered build identity");
          }
          async function settleRenderedMedia() {
            // A DOM-ready page is not necessarily visually ready. Lazy/product media
            // often resolves one or two frames later, which previously produced white
            // placeholders in otherwise valid paired screenshots.
            await page.evaluate(async () => {
              await (document as any).fonts?.ready;
              const deadline = Date.now() + 15000;
              while (Date.now() < deadline) {
                const pending = [...document.images].filter(img => {
                  const box = img.getBoundingClientRect();
                  const style = getComputedStyle(img);
                  return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
                    && box.bottom >= 0 && box.top <= innerHeight && box.right >= 0 && box.left <= innerWidth
                    && (!img.complete || img.naturalWidth <= 0);
                });
                if (!pending.length) break;
                // A horizontally clipped thumbnail can still contribute to the visible
                // rail after one click. Force only current-viewport media to request now;
                // do not turn every hidden gallery asset into eager network work.
                pending.forEach(img => { img.loading = "eager"; });
                await Promise.all(pending.map(img => Promise.race([
                  img.decode().catch(() => undefined),
                  new Promise(resolve => setTimeout(resolve, 1500)),
                ])));
                await new Promise(resolve => setTimeout(resolve, 250));
              }
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            let broken = await page.evaluate(() => [...document.images].filter(img => {
              const box = img.getBoundingClientRect();
              const style = getComputedStyle(img);
              const visible = style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
                && box.bottom >= 0 && box.top <= innerHeight && box.right >= 0 && box.left <= innerWidth;
              return visible && (!img.complete || img.naturalWidth <= 0);
            }).map(img => img.currentSrc || img.src || img.alt || "unknown-image"));
            // Shopify CDN edges can occasionally reset one image request while the
            // same file remains healthy. A single failed request is not durable
            // evidence of a broken target. Retry only the currently visible broken
            // elements, with a cache-busting query, and still fail closed when the
            // asset cannot decode after two independent retries.
            for (let attempt = 0; side === "target" && broken.length && attempt < 2; attempt++) {
              await page.evaluate(async (retry) => {
                const images = [...document.images].filter(img => {
                  const box = img.getBoundingClientRect();
                  const style = getComputedStyle(img);
                  return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
                    && box.bottom >= 0 && box.top <= innerHeight && box.right >= 0 && box.left <= innerWidth
                    && (!img.complete || img.naturalWidth <= 0);
                });
                await Promise.all(images.map(img => new Promise<void>(resolve => {
                  const source = img.currentSrc || img.src;
                  if (!source) return resolve();
                  const done = () => resolve();
                  img.addEventListener("load", done, { once: true });
                  img.addEventListener("error", done, { once: true });
                  img.removeAttribute("srcset");
                  const url = new URL(source, location.href);
                  url.searchParams.set("s2s_media_retry", String(retry));
                  img.src = url.href;
                  setTimeout(done, 5000);
                })));
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              }, `${Date.now()}-${attempt}`);
              broken = await page.evaluate(() => [...document.images].filter(img => {
                const box = img.getBoundingClientRect();
                const style = getComputedStyle(img);
                const visible = style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
                  && box.bottom >= 0 && box.top <= innerHeight && box.right >= 0 && box.left <= innerWidth;
                return visible && (!img.complete || img.naturalWidth <= 0);
              }).map(img => img.currentSrc || img.src || img.alt || "unknown-image"));
            }
            // A source storefront can itself contain a stale or malformed image.
            // Preserve that defect as evidence instead of making the source
            // impossible to capture. Generated/target pages remain strict: they
            // may not introduce a visible broken asset.
            if (side === "target") evidenceRequire(!broken.length, `visible rendered media failed: ${broken.slice(0, 3).join(", ")}`);
            return broken;
          }
          async function state(id: string) {
            evidenceRequire(Date.now() - started <= plan.limits.maxMinutesPerRoute * 60000, "route capture budget exceeded");
            const node = rp.states[id];
            await assertRenderedEvidencePage(page, response, side);
            await assertPlannedRoute(page, location);
            const brokenVisibleMedia = await settleRenderedMedia();
            const observations = await observePlannedState(page, node, components, side);
            const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
            evidenceRequire(canonical, "canonical missing");
            const data: any = { schemaVersion: 2, ...Object.fromEntries(["planId", "revision", "contractVersion", "collectorVersion"].map(k => [k, plan[k]])),
              routeId: rid, kind: "states", nodeId: id, side, viewport: { name: vp, ...dimensions }, capturedAt: new Date().toISOString(),
              requestedUrl: location.url, finalUrl: page.url(), canonical: new URL(canonical, page.url()).href,
              httpStatus: response.status(), pageKind: "content", buildId, themeId, observations,
              renderedMedia: { brokenVisible: brokenVisibleMedia },
              artifacts: { dom: await saveEvidence(out, await page.content(), "html"), screenshot: await saveEvidence(out, await page.screenshot({ animations: "disabled", scale: "css" }), "png") } };
            if (id === "initial" || node.visualReview?.requiredRegions?.includes("full")) {
              const position = await page.evaluate(() => {
                const active = document.activeElement as HTMLElement | null;
                return {
                  x: scrollX,
                  y: scrollY,
                  focused: active ? {
                    tag: active.tagName,
                    id: active.id || null,
                    name: active.getAttribute("name"),
                    type: active.getAttribute("type"),
                    role: active.getAttribute("role"),
                  } : null,
                };
              });
              data.documentSize = await page.evaluate(() => ({ width: Math.max(innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth), height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight) }));
              data.artifacts.fullScreenshot = await saveEvidence(out, await page.screenshot({ fullPage: true, animations: "disabled", scale: "css" }), "png");
              // Chromium may scroll while stitching a full-page screenshot. Restore
              // the observed state before checking stability so the capture tool's
              // own implementation detail cannot masquerade as storefront drift.
              await page.evaluate(({ x, y }) => scrollTo(x, y), position);
              await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
              const after = await page.evaluate(() => {
                const active = document.activeElement as HTMLElement | null;
                return {
                  x: scrollX,
                  y: scrollY,
                  focused: active ? {
                    tag: active.tagName,
                    id: active.id || null,
                    name: active.getAttribute("name"),
                    type: active.getAttribute("type"),
                    role: active.getAttribute("role"),
                  } : null,
                };
              });
              evidenceRequire(stable(position) === stable(after), "full-page capture changed scroll/focus; recapture the state instead of accepting mismatched evidence");
            }
            const ref = await saveEvidence(out, JSON.stringify(data), "json");
            if (!stateRefs.has(id)) { stateRefs.set(id, ref); stateData.set(id, data); stateObservations.set(id, observations); attach("states", id, ref); await checkpoint(); }
            else equivalent(node, side, stateObservations.get(id), observations);
            return { ref, data };
          }
          function attach(kind: string, id: string, ref: any) {
            const baseline = source?.routes?.[rid]?.viewports?.[vp]?.[kind]?.[id];
            result[kind][id] = { ...(side === "target" ? { source: baseline?.source } : {}), [side]: ref };
            if (registry) result[kind][id].presentationBindings = registry.entries.find((e: any) => e.routeId === rid && e.viewport === vp && e.kind === kind && e.nodeId === id)?.bindings;
          }
          if (phase === "precheck") {
            const initial = await observePlannedState(page, rp.states.initial, components, side);
            const documentFingerprint = await page.evaluate(() => ({
              text: (document.querySelector("main") || document.body).innerText,
              controls: [...document.querySelectorAll("main input, main select, main button")].map(el => ({
                tag: el.tagName, name: el.getAttribute("name"), type: el.getAttribute("type"), text: el.textContent,
              })),
              images: [...document.querySelectorAll<HTMLImageElement>("main img")].map(el => el.currentSrc || el.src),
              assets: [...document.querySelectorAll("script[src], link[rel=stylesheet]")].map(el => el.getAttribute("src") || el.getAttribute("href")),
              inlineStyles: [...document.querySelectorAll("style")].map(el => el.textContent),
            }));
            // A freshness probe is not proof of every asynchronous state. Reuse
            // is also time-bounded, contract-bound, and explicitly refreshable.
            fingerprints.set(slot, hash(stable({ initial, documentFingerprint })));
            const sequence = rp.captureSequence?.[vp] ?? rp.captureSequence;
            evidenceRequire(Array.isArray(sequence), "route needs explicit captureSequence");
            if (sequence.length) {
              const edge = rp.transitions[sequence[0]];
              evidenceRequire(edge?.from === "initial" && !edge.navigation, "precheck requires supported initial transition");
              await performPlannedAction(page, edge, side);
              await observePlannedState(page, rp.states[edge.to], components, side);
              await observePlannedState(page, edge, components, side);
              evidenceRequire(!denied.length, `precheck attempted a business write: ${denied.join(", ")}`);
              await assertRenderedEvidencePage(page, response, side);
              await assertPlannedRoute(page, location);
            }
            precheck.workflows[slot] = { passed: true, fingerprint: fingerprints.get(slot), checkedAt: new Date().toISOString() };
            continue;
          }
          await state(current);
          const sequence = rp.captureSequence?.[vp] ?? rp.captureSequence;
          evidenceRequire(Array.isArray(sequence), "route needs explicit captureSequence (empty for static pages)");
          evidenceRequire(sequence.reduce((sum: number, id: string) => sum + (rp.transitions[id]?.probe?.[side]?.length || 0), 0) <= plan.limits.maxActionsPerRoute, "planned action budget exceeded");
          for (const edgeId of sequence) {
            const edge = rp.transitions[edgeId];
            evidenceRequire(edge && active(edge, vp) && edge.from === current, "capture sequence does not follow the planned graph");
            evidenceRequire(!result.transitions[edgeId]?.[side], "duplicate edge in sequence; use distinct planned occurrences");
            evidenceRequire(!edge.navigation, "cross-route probes need the navigation adapter; cannot be accepted as same-page transitions");
            const before = { ref: stateRefs.get(current), data: stateData.get(current) };
            evidenceRequire(before.ref && before.data, "transition source state has not been captured");
            const denialCount = denied.length;
            const actionLog = await performPlannedAction(page, edge, side);
            const after = await state(edge.to);
            const observations = await observePlannedState(page, edge, components, side);
            const trace = { from: edge.from, to: edge.to, action: edge.action, condition: edge.condition, status: "performed",
              beforeArtifactHash: stateRefs.get(edge.from).sha256, afterArtifactHash: stateRefs.get(edge.to).sha256,
              actualBefore: before.ref, actualAfter: after.ref, actionLog,
              blockedWrites: denied.slice(denialCount), blockedTelemetry: blockedTelemetry.splice(0) };
            const data = { ...after.data, kind: "transitions", nodeId: edgeId, observations,
              artifacts: { trace: await saveEvidence(out, JSON.stringify(trace), "json") } };
            attach("transitions", edgeId, await saveEvidence(out, JSON.stringify(data), "json"));
            current = edge.to;
            await checkpoint();
          }
          evidenceRequire(Object.values<any>(result.states).every(r => r[side]) && Object.values<any>(result.transitions).every(r => r[side]), "capture sequence did not visit every planned node");
          await saveCaptureCache(out, keys.get(slot)!, fingerprints.get(slot)!, result);
          stats.capturedWorkflows++;
        } catch (error) {
          errors.push(`${phase}/${rid}/${vp}/${current}: ${String(error)}`);
          result.captureFailure = { status: "failed", reason: String(error) };
          // Preserve observations but make the failure impossible to mistake for acceptance.
          result.states.initial = { ...result.states.initial, status: "failed", reason: String(error) };
          if (phase === "precheck") precheck.workflows[slot] = { passed: false, reason: String(error) };
        } finally { await page.close(); await checkpoint(); }
      }
    }
    if (phase === "precheck") {
      precheck.passed = errors.length === 0;
      await atomicJson(join(out, `${stage}-precheck.json`), { ...precheck, errors, completedAt: new Date().toISOString() });
      if (errors.length || options.precheckOnly) break;
    }
    }
  } finally { await browser.close(); }
  await atomicJson(join(out, `${stage}-capture-result.json`), { captureComplete: errors.length === 0 && !options.precheckOnly, errors, planSha256, buildId, stats, precheckOnly: !!options.precheckOnly,
    acceptance: "not-run", remaining: side === "target" ? ["navigation coverage", "executed negative tests", "objective gate", "paired agent visual review"] : ["source gate"] });
  evidenceRequire(!errors.length, errors.join("; "));
  return coverage;
}
