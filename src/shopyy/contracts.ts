import type {StageTargets,TargetIdentityProof} from './target-context.js';
/** Platform-neutral evidence model. Selectors and mappings belong to the project. */
export type Side = "source" | "target";
export type Stage = "source" | "preflight" | "online";
export type Ref = { path: string; sha256: string };
export type Viewport = { width: number; height: number };
export type Action = {
  op: "click" | "fill" | "select" | "check" | "uncheck" | "hover" | "press" | "scroll" | "history-back" | "history-forward" | "visit";
  selector?: string; value?: string; y?: number; expectedPath?: string; expectedTargetPaths?: StageTargets;
  waitAfter?: {visible?:string;absent?:string;hidden?:string};
  effect: "read-only" | "local-fixture";
};
/** Enter can commit the business value already filled into this same control. */
export function actionInputMatches(actions:readonly {op:string;selector?:string;value?:string}[],action:{op:string;selector?:string;value?:string},input:string){
 if(!['fill','select','press'].includes(action.op)||action.value===input)return true;
 return action.op==='press'&&action.value==='Enter'&&!!action.selector&&actions.slice(0,actions.indexOf(action)).some(previous=>previous.op==='fill'&&previous.selector===action.selector&&previous.value===input);
}
export type Rule = { field: string; compare: "equal" | "number" | "media"; tolerance?: number; rationale?: string };
export type Component = {
  source: string; target: string;
  stockControls?:import('./stock-controls.js').StockControlsSpec;
  topology?:'physical'|'component-tree';
  selectorsByViewport?: Record<string, Record<Side, string>>;
  requiredFields: string[]; rules: Rule[];
  owner: { file: string; marker: string };
};
export type State = {
  targetCanonicalByStage?:Partial<Record<'preflight'|'online',null|{mode:'same-origin-path';queryKeys:string[]}>>;
  videoFrameCapture?:import('./video-frame-capture.js').VideoFrameSelection;
  canonical?:Record<Side,string|null>;
  viewports?: string[];
  components: string[];
  paths: Record<Side, string>;
  targetPaths?: StageTargets;
  ready: Record<Side, string>;
  assertions: Record<Side, { selector: string; read: "text" | "value" | "count" | "visible"; expected: unknown }[]>;
};
export type Transition = {
  viewports?: string[];
  from: string; to: string;
  input: string;
  actions: Record<Side, Action[]>;
  actionsByViewport?: Record<string, Record<Side, Action[]>>;
};
export type RoutePlan = {
  sourceContext?:import('./source-context.js').SourceContextPolicy; initialActions?:Record<Side,Action[]>; contextNormalization?:any; family: string; rationale: string; sourcePath: string; targetPath: string;
  components: Record<string, Component>;
  states: Record<string, State>; transitions: Record<string, Transition>;
  sequence: string[];
  sequencesByViewport?: Record<string, string[]>;
};
export type Plan = {
  interactionCoverage?: Ref;
  schemaVersion: 2; revision: string; sourceUrl: string;
  viewports: Record<string, Viewport>;
  routes: Record<string, RoutePlan>;
  inventory: Ref;
  limits: { timeoutMs: number; maxActionsPerRoute: number; maxRoutes: number };
  environment: { locale: string; timezoneId: string; infiniteAnimations?:'frame-zero'|'running';rasterizeInfiniteFrameZero?:boolean };
};
export type Inventory = {
  schemaVersion: 2; sourceUrl: string; complete: boolean;
  coverage: { viewports: string[]; surfaces: { id:string; viewport:string; path:string; state:string; status:"captured"|"pending"|"failed"; evidence?:Ref }[]; agentReview?:Ref };
  sources: { url: string; kind: "sitemap" | "rendered"; status: "ok" | "absent" | "failed"; evidence?: Ref }[];
  occurrences: { id: string; from: string; path: string; text: string; surface: string }[];
  routes: Record<string, {
    disposition: "mapped" | "mapped-redirect" | "mapped-media" | "external" | "removed" | "deferred-online" | "unresolved";
    removal?:{kind:'broken-source-link';behavior:'disabled';preserveHref:true;diagnostic:Ref};
    directEntry?:import('./unavailable-direct-entry.js').UnavailableDirectEntry;redirect?:{sourcePath:string;request:Ref;observation:Ref;finalUrlEvidence?:Ref};dataAssertions?:import('./navigation-data.js').NavigationDataAssertion[];media?:{sourceUrl:string;sha256:string}; targetPath?: string; targetPaths?:StageTargets; family?: string; representative?: string; rationale: string; evidence?: Ref;
  }>;
};
export type Capture = {
  schemaVersion: 2; collectorVersion: string; planSha256: string; buildId: string | null;
  side: Side; route: string; viewport: string; state: string;
  capturedAt: string; requestedUrl: string; finalUrl: string; canonical: string | null;
  viewportSize: Viewport; scroll: { x: number; y: number }; status: number;
  servedBuildId: string | null;
  targetIdentity?: TargetIdentityProof;
  components: Record<string, Record<string, any>>;
  controls: { tag: string; role: string | null; name: string; type: string | null; href:string|null; selector:string;ariaDisabled?:true }[];
  assertions: { passed: boolean; expected: unknown; actual: unknown }[];
  screenshot: Ref; fullPage: Ref;stylesheetProof?:Ref;stockSnapshot?:Ref;publicCommerceDom?:Ref;productSnapshot?:Ref;
  captureEnvironment?: {sourceContext?:import('./source-context.js').SourceContextProof;initialContextPolicySha256?:string;declaredStateFields?:unknown;mediaAssetKinds?:('image'|'video')[];videoFrameCapture?:any;viewportPixelStability?:import('./viewport-pixel-stability.js').ViewportPixelProof;infiniteAnimations:'frame-zero'|'running';frameZeroRasterized?:boolean;sourceSessionCurrent?:boolean;sourceSessionPolicySha256?:string;sourceReadQueryPolicySha256?:string;sourcePrivacyPolicySha256?:string|null;privacyProjection?:unknown[];animations:{name:string;duration:number|string;playState:string;currentTime:number|null}[]};
};
export type PairCheck = {
  sourceBaseline?:import('./source-baseline.js').SourceBaselineCheck;
  id: string; kind: "state" | "transition";
  before: Partial<Record<Side, Ref>>; after?: Partial<Record<Side, Ref>>;
  actionLog?: Ref;
};
export type Session = {
  sourceReuse?:import('./source-reuse.js').SourceReuseProof;
  initialContextLog?:Ref; route: string; viewport: string; checks: PairCheck[];
  errors: string[];
};
export type Review = {
  schemaVersion: 2; planSha256: string; buildId: string; stage: "preflight" | "online";
  reviewer: string; reviewedAt: string;
  checks: { route: string; viewport: string; id: string; verdict: "pass" | "fail";
    rationale: string; images: Ref[];
    components: { id: string; verdict: "pass" | "fail"; rationale: string }[];
  }[];
};
export type Evidence = {
  sourceBaseline?:import('./source-baseline.js').SourceBaselineProof;
  schemaVersion: 2; stage: Stage; planSha256: string; buildId: string | null;
  collectorVersion: string; scope?:{kind:'source-capture-only';intentSha256:string}; sessions: Session[]; capturedAt: string;
  stopped?:{kind:'source-protection';route:string;viewport:string;protection:import('./source-protection.js').SourceProtection;pendingSessions:{route:string;viewport:string}[]}|{kind:'manual-pause';route:string;viewport:string;flag:'source.pause';pendingSessions:{route:string;viewport:string}[]};
  navigation: { path: string; viewport: string; finalPath: string; canonical: string | null; status: number; passed: boolean; evidence: Ref }[];
  review?: Ref;
};
export type Finding = { id: string; stage: string; message: string; nextAction: string };
export const COLLECTOR = "shopyy-planned-browser-v2";
export const applies = (node: {viewports?:string[]}, vp:string) => !node.viewports || node.viewports.includes(vp);
export const sequenceFor = (route:RoutePlan,vp:string) => route.sequencesByViewport?.[vp] || route.sequence;
export const actionsFor = (edge:Transition,vp:string,side:Side) => edge.actionsByViewport?.[vp]?.[side] || edge.actions[side];
export const VISUAL_FIELDS = ["visible", "x", "y", "width", "height", "display", "fontSize", "lineHeight", "overflowX", "overflowY", "parent", "order"];

/** Explicit state expectations are exact; undeclared states retain same-origin/path behavior. */
export function canonicalExpectation(state:{canonical?:Partial<Record<Side,string|null>>},side:Side):{declared:false}|{declared:true;value:string|null}{
 return state.canonical&&Object.hasOwn(state.canonical,side)?{declared:true,value:state.canonical[side]!}:{declared:false};
}
export function stateCanonicalRejection(state:{canonical?:Partial<Record<Side,string|null>>;targetCanonicalByStage?:State['targetCanonicalByStage']},side:Side,actual:string|null,finalUrl:string,stage?:Stage){
 if(side==='target'&&stage&&stage!=='source'&&state.targetCanonicalByStage&&Object.hasOwn(state.targetCanonicalByStage,stage)){
  const rule=state.targetCanonicalByStage[stage];if(rule===null)return actual===null?null:'Declared stage target canonical differs';
  if(!rule||rule.mode!=='same-origin-path'||!Array.isArray(rule.queryKeys)||rule.queryKeys.some(key=>!['q','page'].includes(key))||new Set(rule.queryKeys).size!==rule.queryKeys.length)return 'Invalid target canonical stage policy';
  if(!actual)return 'Required native canonical missing';
  const expected=new URL(finalUrl),observed=new URL(actual,finalUrl),query=new URLSearchParams();for(const key of rule.queryKeys)for(const value of expected.searchParams.getAll(key))query.append(key,value);query.sort();expected.search=query.toString();expected.hash='';observed.searchParams.sort();
  return observed.href===expected.href?null:'Wrong native canonical origin/path/query';
 }
 const expectation=canonicalExpectation(state,side),url=new URL(finalUrl);
 if(expectation.declared){if(actual!==expectation.value)return 'Declared '+side+' canonical differs';if(actual&&new URL(actual).origin!==url.origin)return 'Wrong canonical origin';return null;}
 if(actual){const canonical=new URL(actual,finalUrl);if(canonical.origin!==url.origin||canonical.pathname!==url.pathname)return 'Wrong canonical';}
 return null;
}
