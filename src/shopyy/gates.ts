import {verifyUnavailableDirectEntry,verifyUnavailableNavigation} from './unavailable-direct-entry.js';
import {verifyPublicCommerceCapture} from './public-commerce-capture.js';
import {verifySourceBaseline,verifyBaselineCheck} from './source-baseline.js';
import {validateStockControlsSpec,stockSnapshotResponsePath,verifyStockControlsEvidence,verifyStockControlsCapture} from './stock-controls.js';
import {requiresVerifiedStylesheetProof,verifyLoadedStylesheetProof,verifyPairedStylesheetProof} from './stylesheet-binding.js';
import {verifyFullPageGeometry} from './screenshot-geometry.js';
import {verifyReusedSourceSession} from './source-reuse.js';
import {validateSourceContext,verifySourceContextProof} from './source-context.js';
import {verifyMappedRedirect,verifyBrokenSourceLink} from './route-redirect.js';
import {verifyFamilySourceAliases} from './families.js';
import {navigationDataErrors,verifyNavigationData,verifyNavigationDataSources} from './navigation-data.js';
import {verifyDeclaredStateFields,routeInitialContextPolicy,verifyInitialContextRows} from './source-state-adapter.js';
import {verifyMediaDelivery} from './media-comparison.js';
import {mediaNavigationDestination,mediaAssetKinds} from './media-comparison.js';
import {verifyMediaObservationPolicy} from './media-comparison.js';
import {verifyVideoFrameProof,validVideoFrameSelection} from './video-frame-capture.js';
import {verifyViewportPixelProof} from './viewport-pixel-stability.js';
import {usesMediaComparison,loadVerifiedMediaAssets,compareMediaImages,type VerifiedMediaAssets} from './media-comparison.js';
import {interactionCoverageFindings} from './interaction-coverage-gate.js';
import {targetPathFor,mappedTargetPath,stageTargetErrors,validateTargetIdentityProof,type TargetStage} from './target-context.js';
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { buildIdentity, canonical, contained, digest, files, generatorIdentity, jsonFile, readRef, writeJson } from "./artifacts.js";
import { actionInputMatches,stateCanonicalRejection,COLLECTOR, VISUAL_FIELDS, applies, sequenceFor, actionsFor, type Plan, type Inventory, type Evidence, type Capture, type Review, type Finding, type Stage, type Ref } from "./contracts.js";
import {sourceSessionPolicy} from './source-session.js';
import {sourceReadQueryPolicy} from './source-read-queries.js';
import {sourcePrivacyPolicy} from './source-privacy.js';

export function validatePlan(plan: Plan): string[] {
  const errors: string[] = [];
  const need = (value: unknown, message: string) => { if (!value) errors.push(message); };
  need(plan?.schemaVersion === 2, "Plan v2 required; old existence/height checks cannot be reused");
  if (plan?.schemaVersion !== 2) return errors;
  need(!!plan.revision && /^https?:\/\//.test(plan.sourceUrl), "Plan identity missing");
  need(["desktop", "tablet", "mobile"].every(v => plan.viewports?.[v]?.width > 0 && plan.viewports[v].height > 0), "Desktop, tablet and mobile are mandatory");
  need(!!plan.environment?.locale && !!plan.environment?.timezoneId, "Locale/timezone preconditions missing");
  need(!plan.environment?.infiniteAnimations||['frame-zero','running'].includes(plan.environment.infiniteAnimations),'Unknown infinite-animation capture mode');
  need(!plan.environment?.rasterizeInfiniteFrameZero||plan.environment.infiniteAnimations==='frame-zero','Frame projection requires explicit frame-zero capture mode');
  need(plan.limits?.timeoutMs > 0 && plan.limits.timeoutMs <= 60000 && plan.limits.maxActionsPerRoute > 0 && plan.limits.maxRoutes > 0, "Finite capture limits required");
  need(Object.keys(plan.routes || {}).length > 0, "No planned routes");
  for (const [rid, route] of Object.entries(plan.routes || {})) {
    try{validateSourceContext(route.sourceContext);}catch(error){errors.push(`${rid}: ${String(error)}`);}
    need(!!route.family && !!route.rationale, `${rid}: family and representative rationale required`);
    need(route.sourcePath?.startsWith("/") && !route.sourcePath.startsWith("//") && route.targetPath?.startsWith("/") && !route.targetPath.startsWith("//"), `${rid}: relative source/target paths required`);
    need(Object.keys(route.components || {}).length > 0, `${rid}: no independent component inventory`);
    for (const [cid, component] of Object.entries(route.components || {})) {
      if(component.stockControls){try{validateStockControlsSpec(component.stockControls);}catch(error){errors.push(rid+'/'+cid+': '+String(error));}need(component.requiredFields.includes('stockControls')&&component.rules.some(r=>r.field==='stockControls'&&r.compare==='equal'),rid+'/'+cid+': full stock child array must be required and exact');}
      need(!component.topology||['physical','component-tree'].includes(component.topology),`${rid}/${cid}: unknown topology mode`);
      need(!!component.source && !!component.target, `${rid}/${cid}: both selectors required`);
      need(VISUAL_FIELDS.every(f => component.requiredFields?.includes(f)), `${rid}/${cid}: required geometry/topology fields omitted`);
      need(!!component.owner?.file && !!component.owner?.marker, `${rid}/${cid}: generator owner missing`);
      for (const field of component.requiredFields || []) {
        const rules = (component.rules || []).filter(r => r.field === field);
        need(rules.length === 1, `${rid}/${cid}/${field}: exactly one comparison rule required`);
      }
      for (const rule of component.rules || []) {
        need(["equal", "number", "media"].includes(rule.compare), `${rid}/${cid}: unsupported comparison`);
        need(rule.compare!=="media"||rule.field==="images",`${rid}/${cid}: media comparison is only supported for images`);
        need(rule.compare !== "number" || Number.isFinite(rule.tolerance) && rule.tolerance! >= 0 && !!rule.rationale, `${rid}/${cid}/${rule.field}: numeric tolerance needs rationale`);
      }
    }
    need(!!route.states?.initial, `${rid}: initial state required`);
    try{if(routeInitialContextPolicy(route))for(const side of ['source','target']as const)need(route.states?.initial?.assertions?.[side]?.length,`${rid}: initialized context requires explicit initial postconditions`);}catch(error){errors.push(`${rid}: ${String(error)}`);}
    for (const vp of Object.keys(plan.viewports)) {
    const seen = new Set(["initial"]), edges = new Set<string>(); let state = "initial", actionCount = (route.initialActions?.source?.length||0)+(route.initialActions?.target?.length||0)+(route.contextNormalization?.dismissals?.length||0)*2;
    for (const id of sequenceFor(route,vp) || []) {
      const edge = route.transitions?.[id];
      need(!!edge && applies(edge,vp) && edge.from === state && !edges.has(id), `${rid}/${vp}/${id}: invalid transition sequence`);
      if (!edge) continue;
      need(!!route.states[edge.from] && !!route.states[edge.to] && applies(route.states[edge.from],vp) && applies(route.states[edge.to],vp), `${rid}/${vp}/${id}: unknown/inapplicable endpoint state`);
      for (const side of ["source", "target"] as const) {
        need(Array.isArray(actionsFor(edge,vp,side)) && actionsFor(edge,vp,side).length > 0, `${rid}/${id}: ${side} action missing`);
        for (const action of actionsFor(edge,vp,side) || []) {
          need(["click", "fill", "select", "check", "uncheck", "hover", "press", "scroll", "history-back", "history-forward", "visit"].includes(action.op), `${rid}/${id}: unsupported action`);
          need(action.effect === "read-only" || side === "target" && action.effect === "local-fixture", `${rid}/${id}: source writes require a separately authorized adapter`);
          need(action.op.startsWith('history-')||action.op==='visit' ? typeof action.expectedPath==='string'&&/^\/(?!\/)/.test(action.expectedPath)&&!/[\\\x00-\x20#]/.test(action.expectedPath) : action.op === "scroll" ? Number.isFinite(action.y) : !!action.selector, `${rid}/${id}: action locator/value missing`);
          if (["fill", "select", "press"].includes(action.op)) need(actionInputMatches(actionsFor(edge,vp,side),action,edge.input), `${rid}/${id}: action input differs from semantic input`);
          for(const error of stageTargetErrors(action.expectedTargetPaths))errors.push(`${rid}/${id}: history ${error}`);
          actionCount++;
        }
      }
      state = edge.to; edges.add(id); seen.add(state);
    }
    need(actionCount <= plan.limits.maxActionsPerRoute, `${rid}: action budget exceeded`);
    need(Object.entries(route.states || {}).every(([id,s]) => !applies(s,vp) || seen.has(id)), `${rid}/${vp}: unvisited planned state`);
    need(Object.entries(route.transitions || {}).every(([id,e]) => !applies(e,vp) || edges.has(id)), `${rid}/${vp}: missing planned transition/reverse edge`);
    }
    for (const [sid, spec] of Object.entries(route.states || {})) {
      if(spec.targetCanonicalByStage!==undefined){need(!!spec.targetCanonicalByStage&&typeof spec.targetCanonicalByStage==='object'&&!Array.isArray(spec.targetCanonicalByStage),`${rid}/${sid}: target canonical stages must be explicit`);for(const[key,value]of Object.entries(spec.targetCanonicalByStage||{}))need(['preflight','online'].includes(key)&&(value===null||value.mode==='same-origin-path'&&Array.isArray(value.queryKeys)&&value.queryKeys.every(k=>['q','page'].includes(k))&&new Set(value.queryKeys).size===value.queryKeys.length),`${rid}/${sid}: invalid target canonical stage policy`);}
      need(spec.videoFrameCapture===undefined||validVideoFrameSelection(spec.videoFrameCapture),`${rid}/${sid}: invalid video frame selection`);
      if(Object.hasOwn(spec,'canonical')){
        const declaration=spec.canonical;
        need(!!declaration&&typeof declaration==='object'&&Object.keys(declaration).length===2&&Object.hasOwn(declaration,'source')&&Object.hasOwn(declaration,'target'),rid+'/'+sid+': canonical needs explicit source and target expectations');
        for(const side of ['source','target'] as const)if(declaration&&Object.hasOwn(declaration,side)&&declaration[side]!==null){
          let valid=false;try{const value=declaration[side]!,url=new URL(value);valid=typeof value==='string'&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash&&url.href===value&&!/[\\\x00-\x20]/.test(value)&&(side!=='source'||url.origin===new URL(plan.sourceUrl).origin);}catch{}
          need(valid,rid+'/'+sid+': canonical.'+side+' must be exact HTTP(S) URL without credentials/fragment, or null');
        }
      }
      for(const error of stageTargetErrors(spec.targetPaths))errors.push(`${rid}/${sid}: ${error}`);
      need(spec.components?.length > 0 && spec.components.every(id => !!route.components[id]), `${rid}/${sid}: component coverage missing`);
      for (const side of ["source", "target"] as const) need(!!spec.ready?.[side] && spec.paths?.[side]?.startsWith("/") && !spec.paths[side].startsWith("//") && Array.isArray(spec.assertions?.[side]) && spec.assertions[side].length > 0, `${rid}/${sid}: ready, path and observable postconditions required on ${side}`);
    }
    need(Object.keys(route.components || {}).every(id => Object.values(route.states || {}).some(s => s.components.includes(id))), `${rid}: inventoried component not assigned to a state`);
  }
  return errors;
}

export function compareCaptures(plan: Plan, routeId: string, state: string, source: Capture, target: Capture, inventory?: Inventory, stage:TargetStage='preflight',mediaAssets?:VerifiedMediaAssets) {
  const errors: string[] = [], route = plan.routes[routeId];
  for (const cid of route.states[state].components) {
    const s = source.components[cid], t = target.components[cid];
    if (!s || !t) { errors.push(`${cid}: source/target observation missing`); continue; }
    for (const rule of route.components[cid].rules) {
      if (!(rule.field in s) || !(rule.field in t) || s[rule.field]===undefined || t[rule.field]===undefined) { errors.push(`${cid}/${rule.field}: missing measurement`); continue; }
      if(rule.compare==='media'){
        try{if(stage==='online'&&mediaAssets?.stage!=='online')throw Error('Media comparison needs target readback mapping for online assets');if(!compareMediaImages(s[rule.field],t[rule.field],source.finalUrl,target.finalUrl,mediaAssets))errors.push(cid+'/'+rule.field+': media content/order/metadata mismatch');}catch(error){errors.push(cid+'/'+rule.field+': '+String(error));}
      } else if (rule.compare === "number") {
        if (!Number.isFinite(s[rule.field]) || !Number.isFinite(t[rule.field]) || Math.abs(s[rule.field] - t[rule.field]) > rule.tolerance!) errors.push(`${cid}/${rule.field}: ${s[rule.field]} != ${t[rule.field]}`);
      } else if (canonical(s[rule.field]) !== canonical(t[rule.field])) errors.push(`${cid}/${rule.field}: semantic/topology mismatch`);
    }
  }
  const normalized = (cap:Capture) => cap.controls.map(({selector,href,...control})=>{
    if(href&&mediaAssets){const exact=new URL(href,cap.finalUrl).href;const media=Object.values(inventory?.routes||{}).find(r=>r.disposition==='mapped-media'&&(cap.side==='source'?r.media?.sourceUrl===exact:mediaNavigationDestination(r,mediaAssets)===exact));if(media)return{...control,href:'media-sha256:'+media.media!.sha256};}
    if(href){const u=new URL(href,cap.finalUrl); if(u.origin===new URL(cap.finalUrl).origin){const path=u.pathname+u.search,mapping=inventory?.routes[path];if(mapping?.disposition==='removed'&&mapping.removal?.kind==='broken-source-link'){if(cap.side==='target'&&control.ariaDisabled!==true)errors.push('Evidenced broken link must be disabled: '+path);delete control.ariaDisabled;}href=cap.side==='source'?((mapping?mappedTargetPath(mapping,stage):undefined) || path):path;href+=u.hash}else href=u.href;}
    return {...control,href};
  });
  if (canonical(normalized(source)) !== canonical(normalized(target))) errors.push("Bidirectional control inventory differs (missing, extra, changed controls or destinations)");
  return errors;
}

export async function loadPlan(projectFile: string) {
  const { dirname, resolve } = await import("node:path");
  const projectRoot = dirname(resolve(projectFile)), project = await jsonFile(projectFile);
  const planFile = await contained(projectRoot, project.capturePlanFile);
  const bytes = await readFile(planFile), plan = JSON.parse(bytes.toString()) as Plan;
  return { projectRoot, project, plan, planSha256: digest(bytes), evidenceRoot: resolve(projectRoot, project.workflow?.evidenceDirectory || "verification/workflow"), output: resolve(projectRoot, project.outputDirectory) };
}

export async function gate(projectFile: string, stage: Stage | "plan", options: { requireReview?: boolean } = {}) {
  const ctx = await loadPlan(projectFile), findings: Finding[] = [];
  const add = (id: string, message: string, nextAction = "Repair the plan/capture/generator at the earliest incorrect layer, then replay the affected scope") => findings.push({ id, stage, message, nextAction });
  for (const error of validatePlan(ctx.plan)) add(`plan:${digest(error).slice(0,12)}`, error);
  if(ctx.project.workflow?.interactionCoverageRequired && !ctx.plan.interactionCoverage) add('interaction-coverage:missing-required-ref','Project requires a hash-bound full-site interaction coverage contract');
  for(const message of await interactionCoverageFindings(ctx.projectRoot,ctx.plan,stage)) add('interaction-coverage:'+digest(message).slice(0,12),message);
  let inventory: Inventory | undefined;
  try {
    inventory = JSON.parse((await readRef(ctx.projectRoot, ctx.plan.inventory)).toString());
    if (!inventory?.complete || inventory.schemaVersion !== 2) add("inventory:incomplete", "Route discovery has unresolved crawl failures or pending URLs");
    if (inventory?.sourceUrl.replace(/\/$/, "") !== ctx.plan.sourceUrl.replace(/\/$/, "")) add("inventory:identity", "Wrong source inventory");
    if (!inventory?.sources.some(s => s.kind === "sitemap") || !inventory?.sources.some(s => s.kind === "rendered")) add("inventory:union", "Sitemap and rendered navigation coverage required");
    if(!Object.keys(inventory?.routes||{}).length || inventory?.sources.some(s=>s.status==='failed')) add('inventory:failures','Empty inventory or failed reconnaissance sources');
    for(const source of inventory?.sources||[])if(source.status==='ok')try{await readRef(ctx.projectRoot,source.evidence!)}catch(error){add('inventory:provenance',String(error))}
    if(!inventory?.coverage || !Object.keys(ctx.plan.viewports).every(v=>inventory!.coverage.viewports.includes(v) && inventory!.coverage.surfaces.some(s=>s.viewport===v&&s.status==='captured')) || inventory.coverage.surfaces.some(s=>s.status!=='captured')) add('inventory:surfaces','Three-device navigation surfaces/states remain unexamined');
    try{const review=JSON.parse((await readRef(ctx.projectRoot,inventory?.coverage?.agentReview!)).toString());if(!review.reviewer||!review.rationale||!review.surfacesReviewed||review.pending?.length!==0||!Number.isFinite(Date.parse(review.reviewedAt)))throw Error('Reconnaissance review missing');}catch(error){add('inventory:review',String(error))}
    let staleSessions=0;const sessionPolicy=sourceSessionPolicy(ctx.project);
    for(const surface of inventory?.coverage?.surfaces||[])try{const bytes=await readRef(ctx.projectRoot,surface.evidence!),data=JSON.parse(bytes.toString());if(sessionPolicy&&(data.sourceSessionCurrent!==true||data.sourceSessionPolicySha256!==sessionPolicy))staleSessions++;if((data.sourceReadQueryPolicySha256||null)!==sourceReadQueryPolicy(ctx.project,surface.path))add(`inventory:read-query:${surface.id}`,'Source display-query policy changed; affected source state must be recaptured');}catch(error){add(`inventory:surface:${surface.id}`,String(error))}
    if(staleSessions)add('inventory:session',`${staleSessions} reconnaissance surfaces lack the current source authentication freshness policy`);
    for (const occurrence of inventory?.occurrences || []) if (!inventory?.routes[occurrence.path]) add(`navigation:${occurrence.id}`, "Discovered link has no disposition");
    if(ctx.project.familiesFile)try{const families=await jsonFile(await contained(ctx.projectRoot,ctx.project.familiesFile));if(families.pages?.some((page:any)=>page.sourceAliases?.length))await verifyFamilySourceAliases(ctx.projectRoot,ctx.project,families,inventory!);}catch(error){add('inventory:family-alias-content',String(error));}
    for (const [path, route] of Object.entries(inventory?.routes || {})) {
      if(route.directEntry)try{await verifyUnavailableDirectEntry(ctx.projectRoot,ctx.plan.sourceUrl,path,route);}catch(error){add(`route:${path}:direct-entry`,String(error));}
      for(const error of navigationDataErrors(route.dataAssertions))add(`route:${path}:data`,error);
      if(route.dataAssertions)try{await verifyNavigationDataSources(ctx.projectRoot,route,ctx.plan);}catch(error){add(`route:${path}:source-data`,String(error));}
      for(const error of stageTargetErrors(route.targetPaths))add(`route:${path}:stage-target`,error);
      if (route.disposition === "unresolved" || !route.rationale) add(`route:${path}`, "Route disposition/rationale unresolved");
      if(route.removal)try{await verifyBrokenSourceLink(ctx.projectRoot,inventory,path);}catch(error){add(`route:${path}:broken-source-link`,String(error));}
      if(route.disposition==='mapped-redirect')try{await verifyMappedRedirect(ctx.projectRoot,inventory,path);}catch(error){add(`route:${path}:redirect`,String(error));}
      if(route.disposition==='mapped-media'){try{if(!route.media||!/^https?:/.test(route.media.sourceUrl)||!/^[a-f0-9]{64}$/.test(route.media.sha256)||route.family||route.representative||route.targetPath||route.targetPaths)throw Error('Mapped media requires explicit source URL/SHA without HTML family/target paths');await readRef(ctx.projectRoot,route.evidence!);}catch(error){add(`route:${path}`,String(error));}}
      if (route.disposition === "mapped" && (!route.targetPath?.startsWith("/") || route.targetPath.startsWith("//") || !ctx.plan.routes[route.representative || ""])) add(`route:${path}`, "Mapped route requires local target and evidenced representative family");
      if (["external", "removed", "deferred-online"].includes(route.disposition)) {
        try { await readRef(ctx.projectRoot, route.evidence!); } catch { add(`route:${path}`, "Route exception requires hashed evidence; source content cannot silently become deferred"); }
      }
    }
  } catch (error) { add("inventory:artifact", String(error)); }
  for(const [rid,route]of Object.entries(ctx.plan.routes))for(const [cid,component]of Object.entries(route.components))if(component.stockControls)try{await verifyStockControlsEvidence(ctx.projectRoot,component.stockControls);}catch(error){add(`stock-branch:${rid}/${cid}`,String(error));}
  if(Object.values(ctx.plan.routes).some(route=>Object.values(route.components).some(component=>component.stockControls))||Object.values(inventory?.routes||{}).some((route:any)=>route.dataAssertions?.some((a:any)=>a.field==='stock'&&a.source?.kind==='captured-stock')))try{if(!stockSnapshotResponsePath(ctx.project))throw Error('Stock consumers require explicit project responsePath');}catch(error){add('stock:response-path',String(error));}
  if (stage === "plan" || findings.length) return { ...ctx, stage, passed: !findings.length, findings };
  const stylesheetContract=stage==='source'?undefined:ctx.project.pageContractsFile?await jsonFile(await contained(ctx.projectRoot,ctx.project.pageContractsFile)).catch(()=>undefined):undefined;const stylesheetMode=requiresVerifiedStylesheetProof(ctx.project,stylesheetContract);
  let evidence: Evidence;
  try { evidence = await jsonFile(join(ctx.evidenceRoot, `${stage}.json`)); }
  catch (error) { add("coverage:missing", `${stage} evidence missing: ${String(error)}`, "Run the planned capture/pair command"); return { ...ctx, stage, passed: false, findings }; }
  if(evidence.scope)add('coverage:scope-only','Scoped source collection is not whole-site evidence; global source/build acceptance remains blocked');
  let buildId: string | null = null;
  if (stage !== "source") {
    try {
      const build = await buildIdentity(ctx.output); buildId = build.id;await verifyMediaDelivery(ctx.projectRoot,ctx.project,build.manifest,stage==='online');
      if (build.manifest.inputs.planSha256 !== ctx.planSha256 || build.manifest.inputs.projectSha256 !== digest(await readFile(projectFile))) add("build:inputs", "Plan or project changed after build");
      for (const ref of build.manifest.inputs.files || []) await readRef(ctx.projectRoot, ref);
      if (build.manifest.inputs.generatorSha256 !== await generatorIdentity()) add("build:renderer", "Generator/workflow code changed after generation");
      if(ctx.project.assetsDirectory){const current=(await files(join(ctx.projectRoot,ctx.project.assetsDirectory))).map(f=>`${ctx.project.assetsDirectory}/${f}`);const recorded=build.manifest.inputs.files.filter((r:Ref)=>r.path.startsWith(ctx.project.assetsDirectory+'/')).map((r:Ref)=>r.path);if(canonical(current)!==canonical(recorded))add('build:assets','Asset input inventory changed');}
      if (build.manifest.prototype) add("build:prototype", "Prototype build cannot be accepted; source gate required");
    } catch (error) { add("build:integrity", String(error), "Regenerate from current verified source contracts"); }
  }
  if(evidence.stopped)add('coverage:stopped',`Capture stopped: ${evidence.stopped.kind}`);
  if (evidence.schemaVersion !== 2 || evidence.collectorVersion !== COLLECTOR || evidence.planSha256 !== ctx.planSha256 || evidence.buildId !== buildId || evidence.stage !== stage) add("coverage:identity", "Stale/wrong schema, plan, collector, stage or build");
  let review: Review | undefined;
  if (stage !== "source" && options.requireReview !== false) {
    try {
      review = JSON.parse((await readRef(ctx.evidenceRoot, evidence.review!)).toString());
      if (!review || review.schemaVersion !== 2 || review.planSha256 !== ctx.planSha256 || review.buildId !== buildId || review.stage !== stage || !review.reviewer?.trim() || !Number.isFinite(Date.parse(review.reviewedAt))) add("review:identity", "Review identity or timestamp missing/stale");
    } catch { add("review:missing", "Current-build agent visual review is missing", "Inspect every paired screenshot/state then submit explicit per-component verdicts"); }
  }
  let mediaAssets:VerifiedMediaAssets|undefined;
  if(stage!=='source'&&(usesMediaComparison(ctx.plan)||Object.values(inventory?.routes||{}).some(r=>r.disposition==='mapped-media'||r.dataAssertions?.some(a=>a.field==='hero'))))try{mediaAssets=await loadVerifiedMediaAssets(ctx.projectRoot,ctx.project,stage,ctx.output);}catch(error){add('media:asset-map',String(error));}
  let sourceBaseline:Awaited<ReturnType<typeof verifySourceBaseline>>|undefined;if(evidence.sourceBaseline)try{if(stage==='source')throw Error('Source index cannot use paired source baseline');sourceBaseline=await verifySourceBaseline(projectFile,ctx,evidence);}catch(error){add('source-baseline:identity',String(error));}
  const sessionKeys = new Set<string>();
  for (const session of evidence.sessions || []) {
    const key = `${session.route}/${session.viewport}`;
    if (sessionKeys.has(key) || !ctx.plan.routes[session.route] || !ctx.plan.viewports[session.viewport]) add(`session:${key}`, "Duplicate or unplanned session");
    sessionKeys.add(key);
  }
  for (const [rid, route] of Object.entries(ctx.plan.routes)) for (const [vp, viewport] of Object.entries(ctx.plan.viewports)) {
    const prefix = `${rid}/${vp}`, session = evidence.sessions?.find(s => s.route === rid && s.viewport === vp);
    if (!session) { add(prefix, "Required route/viewport missing"); continue; }
    for (const error of session.errors || []) add(`${prefix}:capture`, error);
    let sourceReuse:Awaited<ReturnType<typeof verifyReusedSourceSession>>|undefined;if(session.sourceReuse)try{if(stage!=='source')throw Error('Source reuse is only supported by the source index');sourceReuse=await verifyReusedSourceSession(ctx,session);}catch(error){add(`${prefix}:source-reuse`,String(error));}
    const baselineSession=sourceBaseline?.session(rid,vp),baselineOrigin=sourceBaseline?.origin(rid,vp);const sourceRoute=sourceReuse?.route||baselineOrigin?.route||route;
    try{
      const original=baselineSession?.initialContextLog?JSON.parse((await readRef(ctx.evidenceRoot,baselineSession.initialContextLog)).toString()):undefined;
      const actual=session.initialContextLog?JSON.parse((await readRef(ctx.evidenceRoot,session.initialContextLog)).toString()):undefined;
      if(actual&&!routeInitialContextPolicy(sourceRoute)&&(stage==='source'||!routeInitialContextPolicy(route)))throw Error('Undeclared initial context action log');
      if(baselineSession&&canonical(actual?.source)!==canonical(original?.source))throw Error('Paired source initial rows differ from original baseline Ref');
      for(const side of stage==='source'?['source']:['source','target']){const sideRoute=side==='source'?sourceRoute:route,policy=routeInitialContextPolicy(sideRoute),log=side==='source'&&baselineSession?original:actual;
        if(policy){const first=session.checks.find(c=>c.id==='state:initial')?.before[side as 'source'|'target'],cap=JSON.parse((await readRef(ctx.evidenceRoot,first!)).toString());verifyInitialContextRows(sideRoute,side,log,cap.capturedAt,cap.finalUrl,stage);}else if(log?.[side])throw Error('Undeclared initial context action rows');
      }
    }catch(error){add(`${prefix}:initial-context`,String(error));}
    const expected = [...Object.entries(route.states).filter(([,s])=>applies(s,vp)).map(([id]) => ({ id: `state:${id}`, state: id })), ...Object.entries(route.transitions).filter(([,e])=>applies(e,vp)).map(([id,e])=>({ id: `transition:${id}`, state: e.to }))];
    for (const item of expected) {
      const matches = session.checks.filter(c => c.id === item.id), check = matches[0];
      if(check?.sourceBaseline||baselineSession)try{if(!baselineSession)throw Error('Undeclared source baseline check');const original=baselineSession.checks.find(c=>c.id===item.id);if(!original)throw Error('Source baseline check missing');verifyBaselineCheck(check,original);if(original.actionLog){const previous=JSON.parse((await readRef(ctx.evidenceRoot,original.actionLog)).toString()),actual=JSON.parse((await readRef(ctx.evidenceRoot,check.actionLog!)).toString());if(actual.sourceMode!=='baseline-reused'||canonical(actual.source)!==canonical(previous.source))throw Error('Source baseline actual action rows changed');}}catch(error){add(`${prefix}/${item.id}:source-baseline`,String(error));}
      if (matches.length !== 1) { add(`${prefix}/${item.id}`, "Missing/duplicate planned state or transition"); continue; }
      const images: Ref[] = [], captures: Capture[] = [];
      const edge = item.id.startsWith("transition:") ? route.transitions[item.id.slice(11)] : null;
      for (const phase of edge ? ["before", "after"] as const : ["before"] as const) {
        const observed: Partial<Record<"source" | "target", Capture>> = {};
        for (const side of stage === "source" ? ["source"] as const : ["source", "target"] as const) {
          try {
            const cap: Capture = JSON.parse((await readRef(ctx.evidenceRoot, check[phase]?.[side]!)).toString());
            const stateId = edge ? phase === "before" ? edge.from : edge.to : item.state;
            if (cap.schemaVersion !== 2 || cap.collectorVersion !== COLLECTOR || cap.side !== side || cap.planSha256 !== (side==='source'?(sourceReuse?.planSha256||baselineOrigin?.planSha256||ctx.planSha256):ctx.planSha256) || cap.buildId !== (side === "source" ? null : buildId) || cap.route !== rid || cap.viewport !== vp || cap.state !== stateId || canonical(cap.viewportSize) !== canonical(viewport)) throw Error("Capture identity/context mismatch");
            if((cap.captureEnvironment?.initialContextPolicySha256||null)!==routeInitialContextPolicy(side==='source'?sourceRoute:route))throw Error('Capture initial context policy missing or changed');
            if(side==='source')verifyFullPageGeometry(cap.captureEnvironment);
            if(side==='source')verifySourceContextProof(ctx.plan.sourceUrl,route.sourceContext,cap.captureEnvironment?.sourceContext);
            const sessionPolicy=side==='source'?sourceSessionPolicy(ctx.project):null;
            if(sessionPolicy&&(cap.captureEnvironment?.sourceSessionCurrent!==true||cap.captureEnvironment.sourceSessionPolicySha256!==sessionPolicy))throw Error('Source authentication freshness context missing or changed');
            if(side==='source'&&(cap.captureEnvironment?.sourceReadQueryPolicySha256||null)!==sourceReadQueryPolicy(ctx.project,route.states[stateId].paths.source))throw Error('Source display-query policy missing or changed');
            if(side==='source'&&(cap.captureEnvironment?.sourcePrivacyPolicySha256||null)!==sourcePrivacyPolicy(ctx.project,route.states[stateId].paths.source))throw Error('Source privacy boundary policy missing or changed');
            if(ctx.plan.environment.infiniteAnimations){
              const environment=cap.captureEnvironment;
              if(environment?.infiniteAnimations!==ctx.plan.environment.infiniteAnimations||!Array.isArray(environment.animations))throw Error('Animation capture context missing or changed');
              if(!!environment.frameZeroRasterized!==!!ctx.plan.environment.rasterizeInfiniteFrameZero)throw Error('Animation frame projection context missing or changed');
              if(environment.infiniteAnimations==='frame-zero'&&environment.animations.some(a=>a.playState!=='paused'||a.currentTime!==0))throw Error('Infinite animation was not captured at the declared frame');
            }
            if(side==='target')validateTargetIdentityProof(ctx.project,stage==='online'?'online':'preflight',cap.finalUrl,cap.servedBuildId,buildId!,cap.targetIdentity);
            const wanted = side==='target'?targetPathFor(route.states[stateId],stage==='online'?'online':'preflight'):route.states[stateId].paths.source;
            const actual = new URL(cap.finalUrl);
            const base = side === "source" ? ctx.plan.sourceUrl : stage === "preflight" ? ctx.project.workflow?.localOrigin : ctx.project.workflow?.onlineOrigin;
            if (base && actual.origin !== new URL(base).origin) throw Error("Capture origin changed");
            if (actual.pathname + actual.search !== wanted || cap.status !== 200) throw Error("Capture final route/status mismatch");
            const canonicalError=stateCanonicalRejection(route.states[stateId],side,cap.canonical,cap.finalUrl,stage);if(canonicalError)throw Error(canonicalError);
            if (cap.assertions.length !== route.states[stateId].assertions[side].length || cap.assertions.some((a,i) => canonical(a.expected)!==canonical(route.states[stateId].assertions[side][i].expected) || canonical(a.actual) !== canonical(a.expected))) throw Error("Observable state postcondition failed");
            for (const cid of route.states[stateId].components) for (const field of route.components[cid].requiredFields) if (!(field in (cap.components[cid] || {}))) throw Error(`Missing independent measurement ${cid}/${field}`);
            for(const cid of route.states[stateId].components)if(route.components[cid].topology&&cap.components[cid]?.topologyMode!==route.components[cid].topology)throw Error('Component topology context missing or changed');
            if(stylesheetMode)await verifyLoadedStylesheetProof(ctx.evidenceRoot,cap);
            await verifyStockControlsCapture(ctx.evidenceRoot,cap,route.components,route.states[stateId].components,ctx.project);await verifyPublicCommerceCapture(ctx.evidenceRoot,ctx.project,cap);
            verifyDeclaredStateFields(route,stateId,cap);
            verifyMediaObservationPolicy(ctx.project,cap.captureEnvironment);
        verifyVideoFrameProof(ctx.project,route.states[stateId].videoFrameCapture,cap.captureEnvironment?.videoFrameCapture);
            await verifyViewportPixelProof(ctx.project,ctx.evidenceRoot,cap.screenshot,cap.captureEnvironment?.viewportPixelStability);
            for (const ref of [cap.screenshot, cap.fullPage]) { await readRef(ctx.evidenceRoot, ref); images.push(ref); }
            captures.push(cap); observed[side] = cap;
          } catch (error) { add(`${prefix}/${item.id}/${phase}/${side}`, String(error)); }
        }
        if(stylesheetMode&&observed.source&&observed.target)try{await verifyPairedStylesheetProof(ctx.projectRoot,ctx.project,ctx.plan,observed.source,observed.target,ctx.evidenceRoot);}catch(error){add(`${prefix}/${item.id}/${phase}:stylesheets`,String(error));}
        if (observed.source && observed.target) for (const error of compareCaptures(ctx.plan, rid, edge ? phase === "before" ? edge.from : edge.to : item.state, observed.source, observed.target,inventory,stage==='online'?'online':'preflight',mediaAssets)) add(`${prefix}/${item.id}:${digest(error).slice(0,8)}`, error);
      }
      if (edge) {
        try {
          const log = JSON.parse((await readRef(ctx.evidenceRoot, check.actionLog!)).toString());
          if (log.input !== edge.input || log.from !== edge.from || log.to !== edge.to) throw Error("Transition semantic precondition/input mismatch");
          for (const side of stage === "source" ? ["source"] as const : ["source", "target"] as const) {
            const actions = log[side];
            if (!Array.isArray(actions) || actions.length !== actionsFor(side==='source'?sourceRoute.transitions[item.id.slice(11)]:edge,vp,side).length) throw Error("Incomplete actual UI action log");
            for (let i = 0; i < actions.length; i++) if (actions[i].status !== "performed" || canonical(actions[i].action) !== canonical(actionsFor(side==='source'?sourceRoute.transitions[item.id.slice(11)]:edge,vp,side)[i]) || !Number.isFinite(Date.parse(actions[i].startedAt)) || !Number.isFinite(Date.parse(actions[i].endedAt)) || Date.parse(actions[i].endedAt) < Date.parse(actions[i].startedAt)) throw Error("Invalid action log/order");
            const before = captures.find(c => c.side === side && c.state === edge.from), after = [...captures].reverse().find(c => c.side === side && c.state === edge.to);
            if (!before || !after || Date.parse(before.capturedAt) > Date.parse(actions[0].startedAt) || Date.parse(after.capturedAt) < Date.parse(actions.at(-1).endedAt)) throw Error("Before/action/after chronology mismatch");
          }
        } catch (error) { add(`${prefix}/${item.id}:actions`, String(error)); }
      }
      if (stage !== "source") {
        for (const cid of route.states[item.state].components) {
          const owner = route.components[cid].owner;
          try { const value = await readFile(await contained(ctx.output, owner.file), "utf8"); if (!value.includes(owner.marker)) throw Error("Marker not generated"); }
          catch (error) { add(`${prefix}/${cid}:owner`, String(error)); }
        }
        if (options.requireReview !== false) {
          const row = review?.checks.filter(c => c.route === rid && c.viewport === vp && c.id === item.id);
          if (row?.length !== 1 || row[0].verdict !== "pass" || !row[0].rationale?.trim()) add(`${prefix}/${item.id}:review`, "Missing explicit passing paired-image review");
          else {
            const r = row[0];
            if (images.some(ref => !r.images.some(img => img.path === ref.path && img.sha256 === ref.sha256))) add(`${prefix}/${item.id}:images`, "Review did not inspect all before/after viewport and full-page images");
            for (const cid of new Set(captures.flatMap(c => Object.keys(c.components)))) if (!r.components.some(c => c.id === cid && c.verdict === "pass" && c.rationale?.trim())) add(`${prefix}/${item.id}/${cid}:review`, "Missing/failed component judgment");
            if (captures.some(c => Date.parse(c.capturedAt) > Date.parse(review!.reviewedAt))) add(`${prefix}/${item.id}:time`, "Review predates evidence");
          }
        }
      }
    }
  }
  if (stage !== "source") for (const [path, mapped] of Object.entries(inventory?.routes || {})) {
    if (!["mapped","mapped-redirect","mapped-media"].includes(mapped.disposition)) continue;
    for (const vp of Object.keys(ctx.plan.viewports)) {
      let expectedPath:string|undefined;try{expectedPath=mapped.disposition==='mapped-media'?mediaNavigationDestination(mapped,mediaAssets):mappedTargetPath(mapped,stage==='online'?'online':'preflight');}catch(error){add(`navigation:${path}/${vp}`,String(error));continue;}
      const rows = evidence.navigation?.filter(n => n.path === path && n.viewport === vp);
      if (rows?.length !== 1 || rows[0].status !== 200 || rows[0].finalPath !== expectedPath || !rows[0].passed) add(`navigation:${path}/${vp}`, "Mapped destination not verified");
      else try {
        const nav = JSON.parse((await readRef(ctx.evidenceRoot, rows[0].evidence)).toString());
        if(nav.kind==='direct-entry'){await verifyUnavailableNavigation(ctx.evidenceRoot,ctx.projectRoot,ctx.project,evidence,path,vp,mapped,nav,stage==='online'?ctx.project.workflow?.onlineOrigin:ctx.project.workflow?.localOrigin,expectedPath!,buildId!,stage==='online'?'online':'preflight',sourceBaseline?(rid,vp)=>sourceBaseline!.origin(rid,vp).planSha256:undefined);continue;}
        const originCapture:Capture=JSON.parse((await readRef(ctx.evidenceRoot,nav.fromCapture)).toString()),initialRoute=ctx.plan.routes[originCapture.route];
        if(routeInitialContextPolicy(initialRoute)){const log=JSON.parse((await readRef(ctx.evidenceRoot,nav.initialContextLog)).toString());verifyInitialContextRows(initialRoute,'target',log,nav.clickedAt,originCapture.finalUrl,stage);}
        const nativeStore=stage==='online'?String((await jsonFile(join(ctx.evidenceRoot,'deployment.json'))).store):undefined;
        await verifyNavigationData(ctx.projectRoot,ctx.project,path,mapped,nav.dataAssertions,stage==='online'?'online':'preflight',nativeStore,mediaAssets);
        if(mapped.disposition==='mapped-media'){
          if(nav.kind!=='clicked-media'||nav.finalPath!==expectedPath||nav.resourceUrl!==expectedPath||nav.status!==200||nav.passed!==true||nav.sourceSha256!==mapped.media?.sha256||nav.buildId!==buildId||nav.planSha256!==ctx.planSha256||!mediaAssetKinds(ctx.project).some(kind=>String(nav.contentType).startsWith(kind+'/'))||digest(await readRef(ctx.evidenceRoot,nav.bytes))!==mapped.media?.sha256)throw Error('Invalid clicked media content evidence');
          const from:Capture=JSON.parse((await readRef(ctx.evidenceRoot,nav.fromCapture)).toString());if(from.side!=='target'||from.buildId!==buildId||from.viewport!==vp||!from.controls.some(c=>c.selector===nav.selector&&c.href&&new URL(c.href,from.finalUrl).href===expectedPath&&new URL(nav.observedHref,from.finalUrl).href===expectedPath))throw Error('Media navigation occurrence is absent');
          continue;
        }
        if (nav.finalPath !== expectedPath || nav.buildId !== buildId || nav.servedBuildId!==buildId || nav.planSha256 !== ctx.planSha256 || nav.status !== 200 || nav.soft404 || !nav.canonicalValid || nav.kind!=='clicked-link') throw Error("Invalid clicked navigation evidence");
        validateTargetIdentityProof(ctx.project,stage==='online'?'online':'preflight',new URL(nav.finalPath,stage==='online'?ctx.project.workflow?.onlineOrigin:ctx.project.workflow?.localOrigin).href,nav.servedBuildId,buildId!,nav.targetIdentity);
        const from:Capture=JSON.parse((await readRef(ctx.evidenceRoot,nav.fromCapture)).toString());
        if(from.buildId!==buildId||from.viewport!==vp||!from.controls.some(c=>c.selector===nav.selector&&c.href&&new URL(c.href,from.finalUrl).pathname+new URL(c.href,from.finalUrl).search===expectedPath))throw Error('Navigation occurrence is not present in the observed page');
        await readRef(ctx.evidenceRoot,nav.screenshot);
      } catch (error) { add(`navigation:${path}/${vp}`, String(error)); }
    }
  }
  if (stage === "online") {
    try {
      const deployment = await jsonFile(join(ctx.evidenceRoot, "deployment.json"));
      if (ctx.project.workflow?.mediaAssetStoreId&&String(deployment.store)!==String(ctx.project.workflow.mediaAssetStoreId) || ctx.project.workflow?.mediaAssetSkinId&&String(deployment.skinId)!==String(ctx.project.workflow.mediaAssetSkinId))throw Error("Media readback store differs from draft deployment");
      if (deployment.buildId !== buildId || deployment.role !== "draft" || !deployment.skinId || !deployment.store || !deployment.readback) throw Error("Independent draft identity/readback missing");
      await readRef(ctx.evidenceRoot, deployment.readback);
      const online = await jsonFile(join(ctx.evidenceRoot, "online-capabilities.json"));
      for (const id of ["template-rendering", "asset-hosting", "product-fields", "sku-options", "cart-payload", "route-bindings"]) { const c = online[id]; if (!c || c.status !== "verified" || c.buildId !== buildId || c.skinId !== deployment.skinId) throw Error(`Unverified online capability: ${id}`); await readRef(ctx.evidenceRoot, c.evidence); }
    } catch (error) { add("online:capabilities", String(error), "Validate in the authorized SHOPYY draft skin after account access is available"); }
  }
  return { ...ctx, stage, buildId, passed: findings.length === 0, findings };
}

export async function recordGate(projectFile: string, stage: Stage | "plan", requireReview = true) {
  const result = await gate(projectFile, stage, { requireReview });
  const file = join(result.evidenceRoot, "repair-ledger.json");
  const old = await jsonFile(file).catch(() => ({ findings: [] }));
  const entries = new Map<string, any>((old.findings || []).map((f: any) => [f.id, f]));
  for (const finding of result.findings) {
    const previous = entries.get(finding.id);
    entries.set(finding.id, { ...previous, ...finding, status: "open", firstSeen: previous?.firstSeen || new Date().toISOString(), history: [...(previous?.history || []), { at: new Date().toISOString(), planSha256: result.planSha256, buildId: "buildId" in result ? result.buildId : null, message: finding.message }] });
  }
  // Only the fully reviewed current-stage pass closes findings; a missing capture cannot erase an older defect.
  if (result.passed && requireReview) for (const [id, finding] of entries) if (finding.stage === stage) entries.set(id, { ...finding, status: "resolved", resolvedPlan: result.planSha256, resolvedBuild: "buildId" in result ? result.buildId : null, resolvedAt: new Date().toISOString() });
  await writeJson(file, { schemaVersion: 2, findings: [...entries.values()] });
  const report = { schemaVersion: 2, stage, checks: requireReview ? "full" : "objective-only", planSha256: result.planSha256, buildId: "buildId" in result ? result.buildId : null, passed: result.passed, findings: result.findings, generatedAt: new Date().toISOString(), online: stage === "online" && result.passed ? "verified" : "not-verified" };
  await writeJson(join(result.evidenceRoot, `${stage}${requireReview ? "" : "-objective"}-report.json`), report);
  return report;
}
