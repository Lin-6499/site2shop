import {validateStockControlsSpec} from './stock-controls.js';
import {validateSourceContext} from './source-context.js';
import {validVideoFrameSelection} from './video-frame-capture.js';
import { readFile, realpath, mkdir, lstat } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { contained, digest, readRef } from './artifacts.js';
import { loadPlan, validatePlan, gate } from './gates.js';
import { actionInputMatches, COLLECTOR, VISUAL_FIELDS, applies, type Action, type Component, type State, type Transition, type RoutePlan, type Plan, type Ref, type Side } from './contracts.js';
import { sourceUrlMutationReason,sourceReadinessPolicy } from './source-safety-policy.js';
import {SOURCE_STATE_ADAPTER,SOURCE_STATE_FIELDS,validSemanticScroll,type SourceAction,type SourceAssertionRead} from './source-state-adapter.js';

export const SOURCE_ONLY_COLLECTOR = 'shopyy-source-only-plan-v1-browser-v2';
// Exact current OBSERVE component surface; unsupported measurements require an actual collector adapter.
export const SOURCE_OBSERVATION_FIELDS = [...VISUAL_FIELDS, 'fontFamily', 'topologyMode', 'physicalParent', 'physicalOrder', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'gridTemplateColumns', 'flexDirection', 'text', 'tag', 'role', 'value', 'checked', 'disabled', 'images', 'scrollWidth', 'clientWidth', 'scrollLeft','stockControls',...SOURCE_STATE_FIELDS];
const numericFields = ['x', 'y', 'width', 'height', 'order', 'physicalOrder', 'scrollWidth', 'clientWidth', 'scrollLeft','viewportX','viewportY','tabIndex'];
type SourceSide<T> = { source: T; target?: never };
export type SourceComponent = Omit<Component, 'target' | 'owner' | 'selectorsByViewport'> & { target?: never; owner?: never; selectorsByViewport?: Record<string, SourceSide<string>> };
export type SourceState = Omit<State, 'paths' | 'targetPaths' | 'ready' | 'assertions' | 'canonical'> & { paths: SourceSide<string>; ready: SourceSide<string>; assertions: SourceSide<{selector:string;read:SourceAssertionRead;expected:unknown}[]>; observer?:typeof SOURCE_STATE_ADAPTER; canonical?: SourceSide<string | null>; targetPaths?: never };
export type SourceTransition = Omit<Transition, 'actions' | 'actionsByViewport'> & { actions: SourceSide<SourceAction[]>; actionsByViewport?: Record<string, SourceSide<SourceAction[]>> };
export type SourceRoute = Omit<RoutePlan, 'targetPath' | 'components' | 'states' | 'transitions'> & { targetPath?: never; components: Record<string, SourceComponent>; states: Record<string, SourceState>; transitions: Record<string, SourceTransition> };
export type SourceOnlyPlan = Omit<Plan, 'schemaVersion' | 'routes' | 'interactionCoverage'> & { schemaVersion: 1; kind: 'source-only-plan'; routes: Record<string, SourceRoute>; interactionCoverage?: never };
export type CapturePlan = Plan | SourceOnlyPlan;
export type CaptureContext = Omit<Awaited<ReturnType<typeof loadPlan>>, 'plan' | 'output'> & { plan: CapturePlan; output?: string };
export const isSourceOnlyPlan = (plan: any): plan is SourceOnlyPlan => plan?.schemaVersion === 1 && plan?.kind === 'source-only-plan';
export const planMode = (plan: CapturePlan) => isSourceOnlyPlan(plan) ? 'source-only-v1' as const : 'bilateral-v2' as const;
export const collectorFor = (plan: CapturePlan) => isSourceOnlyPlan(plan) ? SOURCE_ONLY_COLLECTOR : COLLECTOR;
/** Exact state canonical expectation shared by source-only and bilateral collectors. */
export function sourceCanonicalExpectation(plan: CapturePlan, state: State | SourceState): { declared: false } | { declared: true; value: string | null } {
  if ('canonical' in state && state.canonical && Object.hasOwn(state.canonical,'source')) return { declared: true, value: state.canonical.source };
  return { declared: false };
}
export function bilateralPlan(plan: CapturePlan): Plan { if (plan.schemaVersion !== 2 || (plan as any).kind === 'source-only-plan') throw Error('Source-only plan cannot be used for target/build/preflight/online'); return plan; }
export function captureSequence(route: Pick<RoutePlan, 'sequence' | 'sequencesByViewport'>, viewport: string) { return route.sequencesByViewport?.[viewport] || route.sequence; }
export function captureActions(edge: { actions: { source: SourceAction[]; target?: SourceAction[] }; actionsByViewport?: Record<string, { source: SourceAction[]; target?: SourceAction[] }> }, viewport: string, side: Side) {
  const actions = edge.actionsByViewport?.[viewport]?.[side] || edge.actions[side];
  if (!actions) throw Error('Source-only plan has no target actions'); return actions;
}
const devices = ['desktop', 'tablet', 'mobile'];
const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: any, allowed: string[]) => object(value) && Object.keys(value).every(k => allowed.includes(k));
const text = (value: any) => typeof value === 'string' && !!value.trim();
const unique = (values: any) => Array.isArray(values) && values.length > 0 && values.every(text) && new Set(values).size === values.length;
const ref = (value: any) => keys(value, ['path', 'sha256']) && text(value.path) && /^[a-f0-9]{64}$/.test(value.sha256);
function path(value: any) {
  if (!text(value) || !/^\/(?!\/)/.test(value) || /[\\\x00-\x20#]/.test(value)) return false;
  const url = new URL(value, 'http://source.invalid');
  return url.origin === 'http://source.invalid' && url.pathname + url.search === value && !sourceUrlMutationReason(url.href);
}

/** Independent source validator. No projection to v2, target placeholders or owner inference. */
export function validateSourcePlan(plan: unknown): string[] {
  const errors: string[] = [], p: any = plan;
  const need = (value: unknown, message: string) => { if (!value) errors.push(message); };
  try {
    need(isSourceOnlyPlan(p), 'Explicit source-only-plan schemaVersion 1 required');
    if (!isSourceOnlyPlan(p)) return errors;
    need(keys(p, ['schemaVersion', 'kind', 'revision', 'sourceUrl', 'inventory', 'viewports', 'limits', 'environment', 'routes']), 'Unknown/source target plan fields');
    let origin: URL | undefined; try { origin = new URL(p.sourceUrl); } catch {}
    need(text(p.revision) && origin && ['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && !origin.hash && !sourceUrlMutationReason(origin.href), 'Source plan revision/origin identity required');
    need(ref(p.inventory), 'Hash-bound full inventory Ref required');
    need(keys(p.viewports, devices) && Object.keys(p.viewports).length === 3 && devices.every(v => keys(p.viewports[v], ['width', 'height']) && (['width', 'height'] as const).every(f => Number.isInteger(p.viewports[v][f]) && p.viewports[v][f] > 0)), 'Exactly desktop/tablet/mobile dimensions required');
    need(keys(p.environment, ['locale', 'timezoneId', 'infiniteAnimations', 'rasterizeInfiniteFrameZero']) && text(p.environment.locale) && text(p.environment.timezoneId), 'Source environment required');
    try { Intl.getCanonicalLocales(p.environment.locale); new Intl.DateTimeFormat('en', { timeZone: p.environment.timezoneId }); } catch { need(false, 'Invalid source locale/timezone'); }
    need(p.environment.infiniteAnimations === undefined || ['running', 'frame-zero'].includes(p.environment.infiniteAnimations), 'Invalid animation policy');
    need(p.environment.rasterizeInfiniteFrameZero === undefined || typeof p.environment.rasterizeInfiniteFrameZero === 'boolean', 'Frame rasterization must be boolean');
    need(!p.environment.rasterizeInfiniteFrameZero || p.environment.infiniteAnimations === 'frame-zero', 'Frame rasterization requires explicit frame-zero');
    need(keys(p.limits, ['timeoutMs', 'maxActionsPerRoute', 'maxRoutes']) && (['timeoutMs', 'maxActionsPerRoute', 'maxRoutes'] as const).every(f => Number.isInteger(p.limits[f]) && p.limits[f] > 0) && p.limits.timeoutMs <= 60000, 'Finite bounded source limits required');
    need(object(p.routes) && Object.keys(p.routes).length > 0 && Object.keys(p.routes).length <= p.limits.maxRoutes, 'Source route budget/coverage invalid');
    for (const [rid, route] of Object.entries<any>(p.routes || {})) {
      need(keys(route, ['family', 'rationale', 'sourcePath', 'sourceContext', 'components', 'states', 'transitions', 'sequence', 'sequencesByViewport']) && text(route.family) && text(route.rationale) && path(route.sourcePath), `${rid}: source family/path required; target/owner fields forbidden`);
      try{validateSourceContext(route.sourceContext);}catch(error){need(false,`${rid}: ${String(error)}`);}
      need(object(route.components) && Object.keys(route.components).length > 0, `${rid}: independent source components required`);
      for (const [cid, component] of Object.entries<any>(route.components || {})) {
        need(keys(component, ['source', 'topology', 'selectorsByViewport', 'requiredFields', 'rules','stockControls']) && text(component.source), `${rid}/${cid}: unique source selector required; target/owner forbidden`);
        need(!component.topology || ['physical', 'component-tree'].includes(component.topology), `${rid}/${cid}: invalid topology`);
        if(component.stockControls){try{validateStockControlsSpec(component.stockControls);}catch(error){need(false,rid+'/'+cid+': '+String(error));}need(component.requiredFields?.includes('stockControls')&&component.rules?.some((r:any)=>r.field==='stockControls'&&r.compare==='equal'),rid+'/'+cid+': stock child array required');}
        need(!component.selectorsByViewport || keys(component.selectorsByViewport, devices) && Object.values<any>(component.selectorsByViewport).every(s => keys(s, ['source']) && text(s.source)), `${rid}/${cid}: invalid source viewport selectors`);
        need(unique(component.requiredFields) && VISUAL_FIELDS.every(f => component.requiredFields.includes(f)), `${rid}/${cid}: VISUAL_FIELDS required`);
        need(component.requiredFields?.every((f: string) => SOURCE_OBSERVATION_FIELDS.includes(f)), `${rid}/${cid}: unsupported source measurement; implement/review a real adapter first`);
        need(Array.isArray(component.rules) && component.rules.length === component.requiredFields?.length, `${rid}/${cid}: exactly one predeclared rule per field required`);
        for (const field of component.requiredFields || []) need(component.rules?.filter((r: any) => r.field === field).length === 1, `${rid}/${cid}/${field}: missing/duplicate rule`);
        for (const rule of component.rules || []) need(keys(rule, ['field', 'compare', 'tolerance', 'rationale']) && component.requiredFields.includes(rule.field) && ['equal', 'number', 'media'].includes(rule.compare) && (rule.compare!=='media'||rule.field==='images') && (rule.compare !== 'number' || numericFields.includes(rule.field) && Number.isFinite(rule.tolerance) && rule.tolerance >= 0 && text(rule.rationale)), `${rid}/${cid}: invalid source rule/tolerance`);
      }
      need(object(route.states) && !!route.states.initial && object(route.transitions), `${rid}: source graph required`);
      need(!route.sequencesByViewport || keys(route.sequencesByViewport, devices), `${rid}: unknown sequence device`);
      for (const [sid, state] of Object.entries<any>(route.states || {})) {
        need(keys(state, ['viewports', 'components', 'paths', 'ready', 'assertions', 'canonical','observer','videoFrameCapture']) && (!state.viewports || unique(state.viewports) && state.viewports.every((v: string) => devices.includes(v))), `${rid}/${sid}: invalid source state/device`);
        need(state.videoFrameCapture===undefined||validVideoFrameSelection(state.videoFrameCapture),`${rid}/${sid}: invalid video frame selection`);
        need(state.observer===undefined||state.observer===SOURCE_STATE_ADAPTER,`${rid}/${sid}: unknown source observer mode`);
        need(!state.components?.some((cid:string)=>route.components[cid]?.requiredFields?.some((f:any)=>SOURCE_STATE_FIELDS.includes(f)))||state.observer===SOURCE_STATE_ADAPTER,`${rid}/${sid}: extended fields require explicit source observer`);
        need(unique(state.components) && state.components.every((c: string) => !!route.components[c]), `${rid}/${sid}: component coverage missing`);
        need(keys(state.paths, ['source']) && path(state.paths.source) && keys(state.ready, ['source']) && text(state.ready.source), `${rid}/${sid}: exact source path and ready required`);
        if (Object.hasOwn(state, 'canonical')) {
          let valid = keys(state.canonical, ['source']) && Object.hasOwn(state.canonical, 'source');
          if (valid && state.canonical.source !== null) {
            try { const expected = new URL(state.canonical.source); valid = typeof state.canonical.source === 'string' && ['http:', 'https:'].includes(expected.protocol) && expected.origin === origin?.origin && !expected.username && !expected.password && !expected.hash && expected.href === state.canonical.source && !/[\\\x00-\x20]/.test(state.canonical.source); } catch { valid = false; }
          }
          need(valid, `${rid}/${sid}: canonical.source must be exact same-origin HTTP(S) without credentials/fragment, or explicit null`);
        }
        need(keys(state.assertions, ['source']) && Array.isArray(state.assertions.source) && state.assertions.source.length > 0, `${rid}/${sid}: observable source assertions required`);
        for (const a of state.assertions?.source || []) {
          const extended=SOURCE_STATE_FIELDS.includes(a.read);
          const expected=extended?['viewportX','viewportY'].includes(a.read)?Number.isFinite(a.expected):a.read==='tabIndex'?Number.isInteger(a.expected):['inViewport','focused'].includes(a.read)?typeof a.expected==='boolean':a.read==='ariaExpanded'?[null,'true','false'].includes(a.expected):keys(a.expected,['htmlOverflowX','htmlOverflowY','bodyOverflowX','bodyOverflowY','bodyPosition','bodyTop','locked'])&&Object.keys(a.expected).length===7&&typeof a.expected.locked==='boolean'&&['htmlOverflowX','htmlOverflowY'].every(k=>text(a.expected[k]))&&['bodyOverflowX','bodyOverflowY','bodyPosition','bodyTop'].every(k=>a.expected[k]===null||text(a.expected[k])):a.read==='visible'?typeof a.expected==='boolean':a.read==='count'?Number.isInteger(a.expected)&&a.expected>=0:typeof a.expected==='string';
          need(keys(a,['selector','read','expected'])&&text(a.selector)&&['text','value','visible','count',...SOURCE_STATE_FIELDS].includes(a.read)&&Object.hasOwn(a,'expected')&&expected&&(!extended||state.observer===SOURCE_STATE_ADAPTER),`${rid}/${sid}: invalid executable assertion`);
        }
        for (const vp of devices) if (applies(state, vp)) { const selectors = state.components.map((c: string) => route.components[c].selectorsByViewport?.[vp]?.source || route.components[c].source); need(new Set(selectors).size === selectors.length, `${rid}/${sid}/${vp}: duplicate component source selectors`); }
      }
      for (const [eid, edge] of Object.entries<any>(route.transitions || {})) {
        need(keys(edge, ['viewports', 'from', 'to', 'input', 'actions', 'actionsByViewport']) && (!edge.viewports || unique(edge.viewports) && edge.viewports.every((v: string) => devices.includes(v))) && typeof edge.input === 'string' && !!route.states[edge.from] && !!route.states[edge.to], `${rid}/${eid}: invalid source edge endpoints`);
        need(keys(edge.actions, ['source']) && (!edge.actionsByViewport || keys(edge.actionsByViewport, devices) && Object.values<any>(edge.actionsByViewport).every(s => keys(s, ['source']) && Array.isArray(s.source) && s.source.length > 0)), `${rid}/${eid}: target actions forbidden; explicit overrides require source actions`);
        for (const vp of devices) if (applies(edge, vp)) {
          const actions = captureActions(edge, vp, 'source'); need(Array.isArray(actions) && actions.length > 0, `${rid}/${eid}/${vp}: actual source actions required`);
          for (const a of actions || []) {
            if(a.op==='scroll-into-view'||a.op==='scroll-element'){
              need(validSemanticScroll(a),`${rid}/${eid}: invalid bounded source semantic scroll`);
              need(a.waitAfter===undefined||keys(a.waitAfter,['visible','absent','hidden'])&&Object.keys(a.waitAfter).length>0&&Object.values(a.waitAfter).every(text),`${rid}/${eid}: invalid post-action readiness`);
              continue;
            }
            need(keys(a, ['op', 'selector', 'value', 'y', 'expectedPath', 'waitAfter', 'effect']) && a.effect === 'read-only' && ['click', 'fill', 'select', 'check', 'uncheck', 'hover', 'press', 'scroll', 'history-back', 'history-forward'].includes(a.op), `${rid}/${eid}: read-only supported actions only`);
            need(a.op?.startsWith('history-') ? path(a.expectedPath) : a.op === 'scroll' ? Number.isFinite(a.y) && a.y! >= 0 : text(a.selector), `${rid}/${eid}: source action locator/history/scroll missing`);
            need(actionInputMatches(actions,a,edge.input), `${rid}/${eid}: action differs from semantic input`);
             need(a.waitAfter === undefined || keys(a.waitAfter, ['visible', 'absent', 'hidden']) && Object.keys(a.waitAfter).length > 0 && Object.values(a.waitAfter).every(text), `${rid}/${eid}: invalid post-action readiness`);
          }
        }
      }
      for (const vp of devices) {
        const sequence = captureSequence(route, vp); need(Array.isArray(sequence), `${rid}/${vp}: explicit source sequence required`);
        const seen = new Set(['initial']), edges = new Set<string>(); let current = 'initial', count = 0;
        need(applies(route.states.initial, vp), `${rid}/${vp}: initial state inapplicable`);
        for (const id of sequence || []) {
          const edge = route.transitions[id]; need(edge && applies(edge, vp) && edge.from === current && !edges.has(id), `${rid}/${vp}/${id}: invalid/non-continuous/duplicate edge`); if (!edge) continue;
          need(applies(route.states[edge.from], vp) && applies(route.states[edge.to], vp), `${rid}/${vp}/${id}: inapplicable endpoint`);
          count += captureActions(edge, vp, 'source').length; current = edge.to; edges.add(id); seen.add(current);
        }
        need(count <= p.limits.maxActionsPerRoute, `${rid}/${vp}: source action budget exceeded`);
        need(current === 'initial', `${rid}/${vp}: source-only sequence must return to initial through explicit reverse/reset edges`);
        need(Object.entries<any>(route.states).every(([id, s]) => !applies(s, vp) || seen.has(id)) && Object.entries<any>(route.transitions).every(([id, e]) => !applies(e, vp) || edges.has(id)), `${rid}/${vp}: missing state/edge/reverse coverage`);
      }
      need(Object.keys(route.components).every(c => Object.values<any>(route.states).some(s => s.components.includes(c))), `${rid}: inventoried source component unobserved`);
    }
  } catch (error) { errors.push('Malformed source plan: ' + String(error)); }
  return errors;
}

export const validateCapturePlan = (plan: CapturePlan) => isSourceOnlyPlan(plan) ? validateSourcePlan(plan) : (plan as any)?.kind === 'source-only-plan' ? ['Source-only plan marker cannot be relabeled as bilateral'] : validatePlan(plan as Plan);
export function assertScopePlanMode(plan: CapturePlan, scope: any, review?: any) {
  const source = isSourceOnlyPlan(plan);
  if (source ? scope.schemaVersion !== 2 || scope.role !== 'source-only' || scope.planMode !== 'source-only-v1' : scope.schemaVersion !== 1 || scope.role !== undefined || scope.planMode !== undefined) throw Error('Scope plan mode/role mismatch');
  if (review && (source ? review.schemaVersion !== 2 || review.role !== 'source-only' || review.planMode !== 'source-only-v1' : review.schemaVersion !== 1 || review.role !== undefined || review.planMode !== undefined)) throw Error('Review plan mode/role mismatch');
}
export async function loadScopedPlan(projectFile: string): Promise<CaptureContext> {
  const projectRoot = await realpath(dirname(resolve(projectFile))), project = JSON.parse(await readFile(projectFile, 'utf8'));
  const bytes = await readFile(await contained(projectRoot, project.capturePlanFile)), plan = JSON.parse(bytes.toString());
  if(project.workflow?.sourceMediaReadiness?.schemaVersion===2){
    if(!isSourceOnlyPlan(plan))throw Error('State-specific source adapter requires source-only plan');
    const pairs=Object.values(plan.routes).flatMap(r=>Object.entries(r.states).map(([state,s])=>({path:s.paths.source,state})));
    for(const pair of pairs)sourceReadinessPolicy(project,pair.path,pair.state);
    for(const rule of project.workflow.sourceMediaReadiness.rules)for(const path of rule.paths)for(const state of rule.states)if(!pairs.some(p=>p.path===path&&p.state===state))throw Error('Source media policy names unplanned path/state pair');
  }
  if (!isSourceOnlyPlan(plan)) return loadPlan(projectFile);
  const name = project.workflow?.evidenceDirectory;
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.split(/[\\/]/).some(s => !s || s === '..' || s === '.')) throw Error('Source-only project requires an explicit contained evidenceDirectory');
  return { projectRoot, project, plan, planSha256: digest(bytes), evidenceRoot: resolve(projectRoot, name), output: typeof project.outputDirectory === 'string' ? resolve(projectRoot, project.outputDirectory) : undefined };
}
export async function sourceGlobalPlanStatus(projectFile: string, plan: CapturePlan) {
  if (isSourceOnlyPlan(plan)) return { passed: false, findingIds: ['plan:source-only-not-global'] };
  const report = await gate(projectFile, 'plan'); return { passed: report.passed, findingIds: report.findings.map(f => f.id) };
}
export async function ensureSourceEvidenceRoot(ctx: CaptureContext, tail: string[] = []) {
  if (!isSourceOnlyPlan(ctx.plan)) return;
  let cursor = ctx.projectRoot;
  for (const segment of [...ctx.project.workflow.evidenceDirectory.split(/[\\/]/), ...tail]) {
    cursor = join(cursor, segment); await mkdir(cursor).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
    const stat = await lstat(cursor); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe source-only evidence ancestry');
  }
}
/** Preserve the complete inventory, including unresolved target dispositions. */
export async function verifySourceInventory(ctx: CaptureContext, routeIds: string[]) {
  if (ctx.project.sourceUrl !== ctx.plan.sourceUrl) throw Error('Project/source-plan origin identity differs');
  const inventory = JSON.parse((await readRef(ctx.projectRoot, ctx.plan.inventory)).toString());
  if (inventory.schemaVersion !== 2 || inventory.sourceUrl?.replace(/\/$/, '') !== ctx.plan.sourceUrl.replace(/\/$/, '') || typeof inventory.complete !== 'boolean' || !Array.isArray(inventory.sources) || !Array.isArray(inventory.occurrences) || !object(inventory.routes) || !Array.isArray(inventory.coverage?.viewports) || !Array.isArray(inventory.coverage?.surfaces)) throw Error('Invalid complete inventory snapshot/source identity');
  if (!['sitemap', 'rendered'].every(kind => inventory.sources.some((s: any) => s.kind === kind))) throw Error('Full sitemap/rendered inventory provenance required');
  async function refs(value: any): Promise<void> { if (!object(value) && !Array.isArray(value)) return; if (object(value) && 'path' in value && 'sha256' in value) { await readRef(ctx.projectRoot, value); return; } for (const item of Object.values(value)) await refs(item); }
  await refs(inventory);
  for (const source of inventory.sources) { if (!['sitemap', 'rendered'].includes(source.kind) || !['ok', 'absent', 'failed'].includes(source.status)) throw Error('Invalid inventory source provenance/status'); if (source.status === 'ok') await readRef(ctx.projectRoot, source.evidence); }
  for (const surface of inventory.coverage.surfaces) { if (!devices.includes(surface.viewport) || !['captured', 'pending', 'failed'].includes(surface.status)) throw Error('Invalid inventory surface/status'); if (surface.status === 'captured') await readRef(ctx.projectRoot, surface.evidence); }
  for (const occurrence of inventory.occurrences) if (!inventory.routes[occurrence.path]) throw Error('Full inventory occurrence has no retained disposition');
  for (const id of routeIds) {
    const route = ctx.plan.routes[id], item = inventory.routes[route.sourcePath], identity = item?.source;
    if (!['unresolved', 'mapped'].includes(item?.disposition) || !text(item?.rationale) || identity?.family !== route.family || identity?.representative !== id || !text(identity?.rationale)) throw Error('Selected source family/classification identity differs');
    await readRef(ctx.projectRoot, identity.evidence);
  }
  return inventory;
}
