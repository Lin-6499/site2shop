import type {Plan,Ref,Stage} from './contracts.js';

/** Integration: add interactionCoverage?: Ref to Plan. No existing Plan member changes. */
export type CoveragePlan=Plan&{interactionCoverage?:Ref};
export type CoverageStage=Stage|'plan';
export type CoverageBinding={status:'bound';kind:'state'|'transition';routeId:string;stateId:string;routeSide:'source'|'target';componentIds:string[];transitionId?:string;semanticInput?:string;sourceEvidenceKind?:'live-source'|'fixture'|'draft-proxy';targetEvidenceKind?:'native-formal'|'fixture'|'draft-proxy';capabilityStatus?:'verified-read-only'|'verified-native'|'blocked'};
export type CoverageRow={caseId:string;route:string;interaction:string;state:string;device:'desktop'|'tablet'|'mobile';owner:string;execution:{status:'pending';blocker:string}|CoverageBinding;targetStage:string;formalRouteStatus:string;capabilityBoundary:string|null;sourceContractStatus:string;fixedVersion:string|null};
export type InteractionCoverage={schemaVersion:1;scope:'full-site-required-interactions';requiredCount:number;sourceMatrix:Ref;rows:CoverageRow[]};
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string'&&!!x.trim();
const devices=['desktop','tablet','mobile'];
export const validCoverageRef=(r:unknown):r is Ref=>object(r)&&text(r.path)&&!/^([/\\]|[a-z]+:)/i.test(r.path)&&!r.path.split(/[\\/]/).includes('..')&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256);
const natural=(r:any)=>JSON.stringify([r.route,r.interaction,r.state,r.device,r.owner]);
const scopeKey=(r:any)=>JSON.stringify([r.caseId,r.route,r.interaction,r.state,r.device,r.owner]);
const applicable=(s:any,vp:string)=>!!s&&(!s.viewports||Array.isArray(s.viewports)&&s.viewports.includes(vp));
const targetPath=(s:any,stage:CoverageStage)=>s?.targetPaths?.[stage==='online'?'online':'preflight']??s?.paths?.target;

/** Structural/binding gate only. Existing capture/image/action/native identity gates remain mandatory. */
export function validateInteractionCoverage(plan:CoveragePlan,contract:unknown,stage:CoverageStage):string[]{
 const errors:string[]=[],buckets=new Map<string,{count:number;samples:string[]}>();
 const issue=(code:string,id:string)=>{const b=buckets.get(code)||{count:0,samples:[]};b.count++;if(b.samples.length<3)b.samples.push(id);buckets.set(code,b);};
 if(!object(plan)||!object(plan.routes)||!object(plan.viewports))return['interaction-coverage: valid executable plan routes/viewports required'];
 if(!['plan','source','preflight','online'].includes(stage))return['interaction-coverage: invalid gate stage'];
 if(!object(contract)||contract.schemaVersion!==1||contract.scope!=='full-site-required-interactions')return['interaction-coverage: schema1 full-site-required-interactions required'];
 if(!validCoverageRef(contract.sourceMatrix))errors.push('interaction-coverage: sourceMatrix requires contained relative path and exact SHA256');
 if(!Array.isArray(contract.rows))return[...errors,'interaction-coverage: rows array required'];
 const rows=contract.rows;if(!Number.isSafeInteger(contract.requiredCount)||contract.requiredCount<=0||rows.length!==contract.requiredCount)errors.push('interaction-coverage: positive requiredCount must equal all rows; shrinking scope requires a new reviewed hashed contract and source snapshot');
 if(plan.interactionCoverage!==undefined&&!validCoverageRef(plan.interactionCoverage))errors.push('interaction-coverage: invalid Plan.interactionCoverage ref');
 const ids=new Set<string>(),keys=new Set<string>(),seenDevices=new Set<string>();
 for(const unknownRow of rows){if(!object(unknownRow)){issue('invalid-row','<nonobject>');continue;}const r=unknownRow,id=text(r.caseId)?r.caseId:'<missing-caseId>';
  if(['caseId','route','interaction','state','device','owner','targetStage','formalRouteStatus','sourceContractStatus'].some(k=>!text(r[k]))){issue('incomplete-row',id);continue;}
  if(!Object.hasOwn(r,'fixedVersion')||r.fixedVersion!==null&&!text(r.fixedVersion)||!Object.hasOwn(r,'capabilityBoundary')||r.capabilityBoundary!==null&&!text(r.capabilityBoundary))issue('missing-version-or-capability-disposition',id);
  if(ids.has(r.caseId))issue('duplicate-caseId',id);ids.add(r.caseId);const key=natural(r);if(keys.has(key))issue('duplicate-required-identity',id);keys.add(key);
  const deviceValid=devices.includes(r.device);if(!deviceValid)issue('unknown-device',id);else{seenDevices.add(r.device);if(!plan.viewports?.[r.device])issue('device-not-in-plan',id);}
  if(!object(r.execution)){issue('missing-execution-or-pending-blocker',id);continue;}const e=r.execution;
  if(e.status==='pending'){if(!text(e.blocker))issue('pending-without-blocker',id);issue('pending-execution',id);continue;}
  if(e.status!=='bound'){issue('unknown-execution-status',id);continue;}if(!deviceValid)continue;
  if(!text(r.fixedVersion))issue('bound-version-missing',id);
  if(!['state','transition'].includes(e.kind)||!text(e.routeId)||!text(e.stateId)||!['source','target'].includes(e.routeSide)){issue('incomplete-bound-execution',id);continue;}
  const route=plan.routes?.[e.routeId];if(!route){issue('bound-route-missing',id);continue;}const state=route.states?.[e.stateId];if(!state){issue('bound-state-missing',id);continue;}
  if(!applicable(state,r.device))issue('bound-state-inapplicable-device',id);
  const expectedRoute=e.routeSide==='source'?state.paths?.source:targetPath(state,stage);if(r.route!==expectedRoute)issue('route-semantic-mismatch',id);
  if(r.state!==e.stateId)issue('state-semantic-mismatch',id);
  if(!Array.isArray(e.componentIds)||!e.componentIds.length||new Set(e.componentIds).size!==e.componentIds.length||e.componentIds.some((cid:any)=>!text(cid)||!state.components?.includes(cid)||!route.components?.[cid]||!text(route.components[cid].source)||!text(route.components[cid].target)||!text(route.components[cid].owner?.file)||!text(route.components[cid].owner?.marker)))issue('bound-component-or-owner-missing',id);
  if(e.kind==='state'){if(e.transitionId!==undefined||!['initial','default','render','initial-render'].includes(r.interaction)||e.stateId!=='initial')issue('interaction-cannot-be-initial-only-observation',id);}
  else{
   const edge=route.transitions?.[e.transitionId];if(!text(e.transitionId)||!edge){issue('bound-transition-missing',id);continue;}
   if(r.interaction!==e.transitionId||edge.to!==e.stateId)issue('transition-semantic-mismatch',id);
   if(typeof e.semanticInput!=='string'||e.semanticInput!==edge.input)issue('input-semantic-mismatch',id);
   if(!applicable(edge,r.device)||!applicable(route.states[edge.from],r.device)||!applicable(route.states[edge.to],r.device))issue('transition-endpoint-or-device',id);
   if(!(route.sequencesByViewport?.[r.device]??route.sequence)?.includes(e.transitionId))issue('transition-not-in-executable-sequence',id);
   for(const side of ['source','target'] as const){const actions=edge.actionsByViewport?.[r.device]?.[side]??edge.actions?.[side];if(!Array.isArray(actions)||!actions.length){issue('bound-action-missing',id);continue;}for(const a of actions){if(!object(a)){issue('bound-action-locator-missing',id);continue;}const ops=['click','fill','select','check','uncheck','hover','press','scroll','history-back','history-forward'];const located=typeof a.op==='string'&&(a.op==='scroll'?Number.isFinite(a.y):a.op.startsWith('history-')?text(a.expectedPath):text(a.selector));if(!ops.includes(a.op)||!located)issue('bound-action-locator-missing',id);if(['fill','select','press'].includes(a.op)&&a.value!==edge.input)issue('action-semantic-input-mismatch',id);if((stage==='source'&&side==='source'||stage==='online')&&a.effect!=='read-only')issue('fixture-action-cannot-promote',id);}}
  }
  if(stage==='source'||stage==='online'){
   if(e.sourceEvidenceKind!=='live-source'||r.sourceContractStatus!=='liveSourceVerified'||/fixture|proxy|draftQuery/i.test(r.targetStage))issue('source-provenance-not-live',id);
  }
  if(stage==='online'){
   if(e.targetEvidenceKind!=='native-formal'||r.targetStage!=='nativeFormalVerified'||r.formalRouteStatus!=='formalRouteVerified'||!['verified-read-only','verified-native'].includes(e.capabilityStatus))issue('online-formal-or-capability-unverified',id);
   try{if(new URL(targetPath(state,'online'),'https://owned.invalid').pathname!==new URL(route.targetPath,'https://owned.invalid').pathname)issue('online-draft-proxy-path',id);}catch{issue('online-invalid-target-path',id);}
  }
 }
 if(keys.size!==rows.length)errors.push('interaction-coverage: minimum distinct required rows not met');
 if(!devices.every(d=>seenDevices.has(d)))errors.push('interaction-coverage: full-site contract must include desktop/tablet/mobile; no invented fourth device');
 for(const[code,b]of buckets)errors.push(`interaction-coverage:${code}: ${b.count} row(s); samples=${b.samples.join(',')}`);
 return errors;
}

/** Match immutable minimum membership, not mutable evidence/status metadata. */
export function validateCoverageSourceMatrix(contract:unknown,snapshot:unknown):string[]{
 if(!object(contract)||!Array.isArray(contract.rows)||!object(snapshot)||!Array.isArray(snapshot.rows))return['interaction-coverage: sourceMatrix rows required'];
 const source=snapshot.rows;if(source.length!==contract.requiredCount||source.length!==contract.rows.length)return['interaction-coverage: sourceMatrix minimum membership/count differs'];
 const expected=new Set(source.map(scopeKey)),actual=new Set(contract.rows.map(scopeKey));if(expected.size!==source.length||actual.size!==contract.rows.length||expected.size!==actual.size||[...expected].some(k=>!actual.has(k)))return['interaction-coverage: sourceMatrix required identities omitted, duplicated or altered'];
 return[];
}
