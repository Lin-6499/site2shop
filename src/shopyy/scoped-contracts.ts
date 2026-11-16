import {verifyStockControlsCapture} from './stock-controls.js';
import {requiresVerifiedStylesheetProof,verifyLoadedStylesheetProof} from './stylesheet-binding.js';
import {verifySourceContextProof} from './source-context.js';
import {verifyMediaObservationPolicy} from './media-comparison.js';
import {verifyVideoFrameProof} from './video-frame-capture.js';
import {verifyViewportPixelProof} from './viewport-pixel-stability.js';
import { readFile, mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { dirname, basename, join, relative, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, contained, digest, readRef } from './artifacts.js';
import { sourceScopeIntent, type SourceScopeSpec } from './source-scope.js';
import { applies, type Capture, type Evidence, type Ref } from './contracts.js';
import { loadScopedPlan, validateCapturePlan, assertScopePlanMode, isSourceOnlyPlan, planMode, collectorFor, sourceCanonicalExpectation, captureActions as actionsFor, captureSequence as sequenceFor, verifySourceInventory, sourceGlobalPlanStatus } from './source-plan.js';
import { sourceSessionPolicy } from './source-session.js';
import { sourceReadQueryPolicy } from './source-read-queries.js';
import { sourcePrivacyPolicy } from './source-privacy.js';
import { sourceReadinessPolicy } from './source-safety-policy.js';
import {SOURCE_STATE_ADAPTER,SOURCE_STATE_FIELDS,stateMediaPolicy,verifyStateMediaProof,verifySourceScrollProof} from './source-state-adapter.js';

/** All paths are relative to the project root, except index (relative to evidenceRoot). */
export type ScopedContractInput = { scope: string; evidenceRoot: string; index: string };
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function requireThat(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function time(value: string) { const n = Date.parse(value); requireThat(Number.isFinite(n), 'Invalid evidence timestamp'); return n; }
function exactSet(actual: string[], expected: string[], label: string) {
  requireThat(equal([...actual].sort(), [...expected].sort()), `Missing/extra/duplicate ${label}`);
}
function within(parent: string, child: string) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\');
}
function safePath(path: string) {
  requireThat(typeof path === 'string' && /^\/(?!\/)/.test(path) && !/[\\\x00-\x20#]/.test(path), 'Invalid source path');
  const parsed = new URL(path, 'http://scope.invalid');
  requireThat(parsed.origin === 'http://scope.invalid' && parsed.pathname + parsed.search === path, 'Normalized source path is not exact');
}
function urlIdentity(value: string, expected: URL, canonicalUrl = false) {
  requireThat(typeof value === 'string' && !/[\\\x00-\x20]/.test(value), 'Invalid URL identity');
  const u = new URL(value);
  requireThat(!u.username && !u.password && !u.hash && u.origin === expected.origin && u.pathname === expected.pathname, 'Wrong URL/canonical identity');
  // Existing collector permits a canonical without the state query, but not a different query.
  requireThat(canonicalUrl ? !u.search || u.search === expected.search : u.search === expected.search, 'Wrong URL/canonical query');
  requireThat(u.href === value, 'Non-canonical URL spelling');
}

/** Pure, offline, fail-closed verification. Never reads scope-report or writes a gate/ledger. */
export async function verifyScopedSource(projectFile: string, input: ScopedContractInput) {
  const ctx = await loadScopedPlan(projectFile), { plan, project } = ctx;
  // Windows temp directories can be supplied using an 8.3 alias; establish one real root.
  const projectRoot = await realpath(ctx.projectRoot), actualProjectFile = await realpath(projectFile);
  const provenance: { root: 'project' | 'scope'; ref: Ref }[] = [];
  const refJson = async (root: string, ref: Ref, domain: 'project' | 'scope') => {
    const bytes = await readRef(root, ref); provenance.push({ root: domain, ref }); return JSON.parse(bytes.toString());
  };
  const projectBytes = await readFile(projectFile), projectSha256 = digest(projectBytes);
  const planPath = await contained(projectRoot, project.capturePlanFile);
  requireThat(digest(await readFile(planPath)) === ctx.planSha256, 'Plan changed while loading');
  const scopePath = await contained(projectRoot, input.scope), scopeBytes = await readFile(scopePath);
  provenance.push({ root: 'project', ref: { path: relative(projectRoot, actualProjectFile), sha256: projectSha256 } }, { root: 'project', ref: { path: project.capturePlanFile, sha256: ctx.planSha256 } }, { root: 'project', ref: { path: input.scope, sha256: digest(scopeBytes) } });
  const spec: SourceScopeSpec = JSON.parse(scopeBytes.toString()), intent = sourceScopeIntent(spec), intentSha256 = digest(canonical(intent));
  assertScopePlanMode(plan, spec);
  requireThat(/^[a-z][a-z0-9-]{1,63}$/.test(spec.scopeId) && spec.sourceActionPolicy === 'read-only', 'Invalid source scope');
  requireThat(spec.projectSha256 === projectSha256 && spec.planSha256 === ctx.planSha256 && equal(spec.inventory, plan.inventory) && project.sourceUrl === plan.sourceUrl, 'Current project/plan/inventory identity differs');
  const structural = validateCapturePlan(plan); requireThat(!structural.length, 'Structurally invalid full proposed plan: ' + structural.join('; '));
  const devices = ['desktop', 'tablet', 'mobile'];
  exactSet(spec.viewports, devices, 'scope devices'); exactSet(Object.keys(plan.viewports), devices, 'plan devices');
  requireThat(Array.isArray(spec.routeIds) && spec.routeIds.length > 0 && spec.routeIds.length <= plan.limits.maxRoutes && new Set(spec.routeIds).size === spec.routeIds.length && spec.routeIds.every(id => !!plan.routes[id]), 'Invalid scope route set');
  const inventory = await refJson(projectRoot, spec.inventory, 'project');
  requireThat(inventory.schemaVersion === 2 && inventory.sourceUrl.replace(/\/$/, '') === plan.sourceUrl.replace(/\/$/, ''), 'Wrong inventory schema/identity');
  // Inventory may honestly be incomplete; nevertheless every recorded provenance Ref must be intact.
  async function nestedRefs(value: any): Promise<void> {
    if (!value || typeof value !== 'object') return;
    if ('path' in value && 'sha256' in value) { await readRef(projectRoot, value); provenance.push({ root: 'project', ref: value }); return; }
    for (const item of Object.values(value)) await nestedRefs(item);
  }
  await nestedRefs(inventory);
  if (plan.interactionCoverage) await nestedRefs(plan.interactionCoverage);
  if (isSourceOnlyPlan(plan)) await verifySourceInventory(ctx, spec.routeIds);
  for (const id of spec.routeIds) {
    const route = plan.routes[id], mapping = inventory.routes?.[route.sourcePath];
    if (!isSourceOnlyPlan(plan)) requireThat(mapping?.disposition === 'mapped' && mapping.family === route.family && mapping.targetPath === route.targetPath && !!mapping.rationale?.trim(), 'Selected route has no exact reviewed mapping');
    safePath(route.sourcePath);
    for (const state of Object.values(route.states)) safePath(state.paths.source);
    for (const edge of Object.values(route.transitions)) for (const vp of devices) if (applies(edge, vp))
      requireThat(actionsFor(edge, vp, 'source').every(a => a.effect === 'read-only'), 'Unsafe source action');
  }
  const review = await refJson(projectRoot, spec.review, 'project');
  assertScopePlanMode(plan, spec, review);
  requireThat(review.kind === 'source-scope-review' && review.verdict === 'approved-for-source-capture-only' && typeof review.reviewer === 'string' && !!review.reviewer.trim() && review.intentSha256 === intentSha256 && review.projectSha256 === projectSha256 && review.planSha256 === ctx.planSha256 && review.inventorySha256 === spec.inventory.sha256 && equal(review.routeIds, spec.routeIds) && equal(review.viewports, spec.viewports) && review.sourceActionPolicy === 'read-only', 'Missing/stale independent scope review');
  const reviewedAt = time(review.reviewedAt);
  const evidenceRoot = await contained(projectRoot, input.evidenceRoot);
  const globalRoot = await realpath(ctx.evidenceRoot);
  requireThat(await contained(projectRoot, relative(projectRoot, globalRoot)) === globalRoot, 'Global evidence root escapes project');
  const expectedRoot = await contained(projectRoot, relative(projectRoot, join(globalRoot, 'source-scopes', spec.scopeId, intentSha256.slice(0, 12))));
  requireThat(evidenceRoot === expectedRoot, 'Wrong explicit scope evidence root');
  const frozenScope = await readFile(await contained(evidenceRoot, 'inputs/scope.json'));
  requireThat(digest(frozenScope) === digest(scopeBytes), 'Frozen scope differs from current scope');
  const frozenReview = await readFile(await contained(evidenceRoot, 'inputs/review.json'));
  requireThat(digest(frozenReview) === spec.review.sha256, 'Frozen review differs');
  provenance.push({ root: 'scope', ref: { path: 'inputs/scope.json', sha256: digest(frozenScope) } }, { root: 'scope', ref: { path: 'inputs/review.json', sha256: digest(frozenReview) } });
  requireThat(input.index === 'source-scope.json', 'Only the scope index is supported');
  const indexBytes = await readFile(await contained(evidenceRoot, input.index)), indexRef = { path: input.index, sha256: digest(indexBytes) };
  provenance.push({ root: 'scope', ref: indexRef });
  const evidence: Evidence = JSON.parse(indexBytes.toString());
  requireThat(!evidence.stopped,'Stopped source scope cannot be accepted');
  requireThat(evidence.schemaVersion === 2 && evidence.stage === 'source' && evidence.buildId === null && evidence.collectorVersion === collectorFor(plan) && evidence.planSha256 === ctx.planSha256 && equal(evidence.scope, { kind: 'source-capture-only', intentSha256, ...(isSourceOnlyPlan(plan) ? { planMode: 'source-only-v1', role: 'source-only' } : {}) }), 'Wrong scoped index identity');
  requireThat(time(evidence.capturedAt) >= reviewedAt && Array.isArray(evidence.navigation) && evidence.navigation.length === 0, 'Invalid scope index timestamp/navigation');
  exactSet(evidence.sessions.map(s => s.route + '/' + s.viewport), spec.routeIds.flatMap(r => devices.map(v => r + '/' + v)), 'scope sessions');
  const captures: { route: string; viewport: string; check: string; phase: string; sourceCapture: Ref; value: Capture }[] = [];
  const transitions: { route: string; viewport: string; id: string; actionLog: Ref; value: any }[] = [];
  const sessionPolicy = sourceSessionPolicy(project);
  for (const session of evidence.sessions) {
    const route = plan.routes[session.route], vp = session.viewport;
    requireThat(Array.isArray(session.errors) && !session.errors.length, 'Failed scope session');
    exactSet(session.checks.map(c => c.id), [ ...Object.entries(route.states).filter(([, s]) => applies(s, vp)).map(([id]) => 'state:' + id), ...Object.entries(route.transitions).filter(([, e]) => applies(e, vp)).map(([id]) => 'transition:' + id) ], 'state/edge checks');
    for (const check of session.checks) {
      const isEdge = check.id.startsWith('transition:'), id = check.id.slice(isEdge ? 11 : 6), edge = isEdge ? route.transitions[id] : null;
      requireThat(check.kind === (isEdge ? 'transition' : 'state') && equal(Object.keys(check.before), ['source']) && (isEdge ? !!check.after && equal(Object.keys(check.after), ['source']) : !check.after && !check.actionLog), 'Wrong source-only check shape');
      const checked: Capture[] = [];
      for (const phase of isEdge ? ['before', 'after'] as const : ['before'] as const) {
        const ref = check[phase]!.source!, cap: Capture = await refJson(evidenceRoot, ref, 'scope');
        const stateId = edge ? phase === 'before' ? edge.from : edge.to : id, state = route.states[stateId];
        requireThat(cap.schemaVersion === 2 && cap.collectorVersion === collectorFor(plan) && cap.side === 'source' && cap.buildId === null && cap.servedBuildId === null && !cap.targetIdentity && cap.planSha256 === ctx.planSha256 && cap.route === session.route && cap.viewport === vp && cap.state === stateId && equal(cap.viewportSize, plan.viewports[vp]) && cap.status === 200 && time(cap.capturedAt) >= time(evidence.capturedAt), 'Capture identity/status/context differs');
        const expected = new URL(state.paths.source, plan.sourceUrl);
        urlIdentity(cap.requestedUrl, expected); urlIdentity(cap.finalUrl, expected);
        requireThat(cap.canonical === null || typeof cap.canonical === 'string', 'Missing canonical observation');
        const canonicalExpectation = sourceCanonicalExpectation(plan, state);
        if (canonicalExpectation.declared) requireThat(cap.canonical === canonicalExpectation.value, 'Declared source canonical differs');
        else if (cap.canonical !== null) urlIdentity(cap.canonical, expected, true);
        requireThat(Number.isFinite(cap.scroll?.x) && Number.isFinite(cap.scroll?.y) && cap.scroll.x >= 0 && cap.scroll.y >= 0 && Array.isArray(cap.controls), 'Missing observed scroll/control inventory');
        requireThat(Array.isArray(cap.assertions) && cap.assertions.length === state.assertions.source.length && cap.assertions.every((a, i) => a.passed === true && equal(a.expected, state.assertions.source[i].expected) && equal(a.actual, a.expected)), 'Source assertion differs/failed');
        exactSet(Object.keys(cap.components), state.components, 'state components');
        for (const cid of state.components) {
          const component = route.components[cid], observed = cap.components[cid];
          for (const field of component.requiredFields) requireThat(Object.hasOwn(observed, field) && observed[field] !== undefined, 'Missing component field ' + cid + '/' + field);
          requireThat(typeof observed.visible === 'boolean' && ['x', 'y', 'width', 'height', 'order'].every(f => Number.isFinite(observed[f])) && observed.width >= 0 && observed.height >= 0 && Number.isInteger(observed.order) && observed.order >= 0 && ['display', 'fontSize', 'lineHeight', 'overflowX', 'overflowY'].every(f => typeof observed[f] === 'string') && (observed.parent === null || typeof observed.parent === 'string'), 'Invalid geometry/topology field values');
          for (const rule of component.rules) if (rule.compare === 'number') requireThat(Number.isFinite(observed[rule.field]), 'Non-numeric component field');
          if (component.topology) requireThat(observed.topologyMode === component.topology, 'Wrong topology policy');
        }
        if(requiresVerifiedStylesheetProof(project))await verifyLoadedStylesheetProof(evidenceRoot,cap);
        await verifyStockControlsCapture(evidenceRoot,cap,route.components as any,state.components,project);
        verifySourceContextProof(plan.sourceUrl,route.sourceContext,cap.captureEnvironment?.sourceContext);
        if (sessionPolicy) requireThat(cap.captureEnvironment?.sourceSessionCurrent === true && cap.captureEnvironment.sourceSessionPolicySha256 === sessionPolicy, 'Stale source session policy');
        requireThat((cap.captureEnvironment?.sourceReadQueryPolicySha256 || null) === sourceReadQueryPolicy(project, state.paths.source) && (cap.captureEnvironment?.sourcePrivacyPolicySha256 || null) === sourcePrivacyPolicy(project, state.paths.source), 'Stale query/privacy policy');
        const readinessHash = (cap.captureEnvironment as { sourceReadinessPolicySha256?: string } | undefined)?.sourceReadinessPolicySha256 || null;
         requireThat(readinessHash === (sourceReadinessPolicy(project, state.paths.source,stateId)?.sha256 || null), 'Stale/missing source media readiness policy');
         const environment=cap.captureEnvironment as any,mediaPolicy=stateMediaPolicy(project,state.paths.source,stateId);
         if(mediaPolicy)verifyStateMediaProof(mediaPolicy,environment?.sourceStateMedia);
         else requireThat(!environment?.sourceStateMedia,'Unplanned source state media proof');
         const observer='observer'in state?state.observer:undefined;
         requireThat((environment?.sourceStateObserver||undefined)===observer,'Missing/unplanned source state observer');
         if(observer===SOURCE_STATE_ADAPTER)for(const cid of state.components){const o=cap.components[cid];requireThat(SOURCE_STATE_FIELDS.every(f=>Object.hasOwn(o,f))&&Number.isFinite(o.viewportX)&&Number.isFinite(o.viewportY)&&typeof o.inViewport==='boolean'&&typeof o.focused==='boolean'&&Number.isInteger(o.tabIndex)&&[null,'true','false'].includes(o.ariaExpanded)&&typeof o.scrollLock?.locked==='boolean'&&['htmlOverflowX','htmlOverflowY'].every(f=>typeof o.scrollLock[f]==='string')&&['bodyOverflowX','bodyOverflowY','bodyPosition','bodyTop'].every(f=>o.scrollLock[f]===null||typeof o.scrollLock[f]==='string'),'Invalid raw source viewport/UI observation');}
        if (plan.environment.infiniteAnimations) requireThat(cap.captureEnvironment?.infiniteAnimations === plan.environment.infiniteAnimations && !!cap.captureEnvironment.frameZeroRasterized === !!plan.environment.rasterizeInfiniteFrameZero && Array.isArray(cap.captureEnvironment.animations) && (plan.environment.infiniteAnimations !== 'frame-zero' || cap.captureEnvironment.animations.every(a => a.currentTime === 0 && a.playState === 'paused')), 'Wrong animation context');
        verifyMediaObservationPolicy(ctx.project,cap.captureEnvironment);
        verifyVideoFrameProof(ctx.project,state.videoFrameCapture,cap.captureEnvironment?.videoFrameCapture);
            await verifyViewportPixelProof(ctx.project,evidenceRoot,cap.screenshot,cap.captureEnvironment?.viewportPixelStability);
        if(cap.captureEnvironment?.viewportPixelStability)for(const ref of cap.captureEnvironment.viewportPixelStability.frames)provenance.push({root:'scope',ref});
        for (const image of [cap.screenshot, cap.fullPage]) { const bytes = await readRef(evidenceRoot, image); requireThat(bytes.length > 0, 'Empty capture image'); provenance.push({ root: 'scope', ref: image }); }
        checked.push(cap); captures.push({ route: session.route, viewport: vp, check: check.id, phase, sourceCapture: ref, value: cap });
      }
      if (edge) {
        const log = await refJson(evidenceRoot, check.actionLog!, 'scope'), actions = actionsFor(edge, vp, 'source');
        requireThat(log.from === edge.from && log.to === edge.to && log.input === edge.input && !log.target && Array.isArray(log.source) && log.source.length === actions.length, 'Wrong/incomplete action log');
        let previous = time(checked[0].capturedAt);
        for (let i = 0; i < actions.length; i++) {
          const performed = log.source[i], start = time(performed.startedAt), end = time(performed.endedAt);
           requireThat(performed.status === 'performed' && (!performed.result || performed.result === 'performed') && (!performed.op || performed.op === actions[i].op) && !performed.error && equal(performed.action, actions[i]) && start >= previous && end >= start, 'Wrong action or unordered/invalid action times');
           if(actions[i].op==='scroll-into-view'||actions[i].op==='scroll-element')verifySourceScrollProof(actions[i],performed.observation);
          previous = end;
        }
        requireThat(time(checked[1].capturedAt) >= previous, 'After capture predates action');
        transitions.push({ route: session.route, viewport: vp, id, actionLog: check.actionLog!, value: log });
      }
    }
    // The sequence must be the actual capture chain, not merely a bag of successful edges.
    const initial = session.checks.find(c => c.id === 'state:initial')!;
    let current = initial.before.source!;
    const firstState = new Map<string, Ref>([['initial', current]]);
    for (const edgeId of sequenceFor(route, vp)) {
      const check = session.checks.find(c => c.id === 'transition:' + edgeId)!;
      requireThat(equal(check.before.source, current), 'Disconnected transition capture chain');
      current = check.after!.source!;
      const stateId = route.transitions[edgeId].to;
      if (!firstState.has(stateId)) firstState.set(stateId, current);
    }
    for (const [id, ref] of firstState) requireThat(equal(session.checks.find(c => c.id === 'state:' + id)!.before.source, ref), 'State capture differs from first reached state');
  }
  // Read-only global status is informative, never replaced by the scoped result.
  const global = await sourceGlobalPlanStatus(projectFile, plan);
  requireThat(digest(await readFile(projectFile)) === projectSha256 && digest(await readFile(planPath)) === ctx.planSha256 && digest(await readFile(scopePath)) === digest(scopeBytes), 'Inputs changed during verification');
  for (const item of provenance) await readRef(item.root === 'project' ? projectRoot : evidenceRoot, item.ref);
  return {
    schemaVersion: 1 as const, kind: 'reviewed-scoped-source-only' as const, passed: true,
    planMode: planMode(plan), role: 'source-only' as const,
    globalAccepted: false, formalBuildAllowed: false, published: false,
    roots: { project: projectRoot, scopeEvidence: evidenceRoot },
    provenance: { project: { path: relative(projectRoot, actualProjectFile), sha256: projectSha256 }, plan: { path: project.capturePlanFile, sha256: ctx.planSha256 }, scope: { path: input.scope, sha256: digest(scopeBytes) }, inventory: spec.inventory, review: spec.review, index: indexRef, intentSha256, references: provenance },
    scope: intent, sourceUrl: plan.sourceUrl, environment: plan.environment, viewports: plan.viewports,
    routes: Object.fromEntries(spec.routeIds.map(id => [id, plan.routes[id]])), captures, transitions,
    bindings: [], status: 'source-only-needs-generator-binding-not-global-acceptance',
    globalPlanGate: global
  };
}

/** Fresh scope-only directory; atomic no-clobber commit. Existing good exports are immutable. */
export async function exportScopedContracts(projectFile: string, input: ScopedContractInput & { output: string }) {
  const verified = await verifyScopedSource(projectFile, input), root = verified.roots.scopeEvidence;
  const projectRoot = verified.roots.project, target = resolve(projectRoot, input.output), parent = join(root, 'exports');
  requireThat(!isAbsolute(input.output) && !input.output.split(/[\\/]/).includes('..') && dirname(target) === parent && /^[a-z][a-z0-9-]{1,63}$/.test(basename(target)), 'Output must be a fresh named directory directly under this scope evidence root/exports');
  const ctx = await loadScopedPlan(projectFile);
  const globalRoot = await realpath(ctx.evidenceRoot);
  const forbidden = [...(typeof ctx.project.pageContractsFile === 'string' ? [resolve(projectRoot, ctx.project.pageContractsFile)] : []), join(globalRoot, 'source.json'), join(globalRoot, 'repair-ledger.json'), await realpath(projectFile), resolve(projectRoot, ctx.project.capturePlanFile)];
  requireThat(!forbidden.some(file => within(target, file)), 'Output overlaps global/project artifacts');
  if (typeof ctx.project.outputDirectory === 'string') { const buildRoot = resolve(projectRoot, ctx.project.outputDirectory); requireThat(!within(buildRoot, target) && !within(target, buildRoot), 'Output overlaps build directory'); }
  // Reject links on every output ancestor, even links resolving inside the project.
  let cursor = projectRoot;
  for (const segment of relative(projectRoot, root).split(/[\\/]/)) { cursor = join(cursor, segment); requireThat(!(await lstat(cursor)).isSymbolicLink(), 'Symlink in export ancestry'); }
  await mkdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  requireThat(!(await lstat(parent)).isSymbolicLink() && (await realpath(parent)) === parent, 'Unsafe exports directory');
  await mkdir(target); // exclusive: never reuse/overwrite a good contract or a failed attempt
  const temp = join(target, '.' + randomUUID() + '.tmp'), file = join(target, 'contracts.json');
  const handle = await open(temp, 'wx');
  try { await handle.writeFile(JSON.stringify(verified, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  try { await link(temp, file); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  // Commit has succeeded. Cleanup failure must not masquerade as a failed validation/export.
  const tempCleanupPending = await unlink(temp).then(() => false, () => true);
  return { file, status: verified.status, globalAccepted: false, formalBuildAllowed: false, published: false, ...(tempCleanupPending ? { tempCleanupPending: temp } : {}) };
}
