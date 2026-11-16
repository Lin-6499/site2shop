import type {Page,Request} from 'playwright';
import {digest} from './artifacts.js';

type Rule={pathPattern:string;selector:string;expectedText?:string;requiredHrefQuery?:{selector:string;parameter:string;value:string};loadingSelectors?:string[];resourcePaths?:string[]};
type Project={sourceUrl:string;workflow?:{sourceRenderedReadiness?:{rules:Rule[]}}};
type Tracking={startedAt:number;pending:Set<Request>};
const tracking=new WeakMap<Page,Tracking>();
/** Start tracking before the real navigation/action, including its ensuing public fetches. */
export function beginSourceRenderedAction(page:Page){
 let state=tracking.get(page);
 if(!state){
  state={startedAt:Date.now(),pending:new Set()};tracking.set(page,state);
  page.on('request',request=>{if(['fetch','xhr'].includes(request.resourceType()))state!.pending.add(request);});
  const complete=(request:Request)=>state!.pending.delete(request);
  page.on('requestfinished',complete);page.on('requestfailed',complete);
 }
 state.startedAt=Date.now();
}
const diagnosticText=(text:string)=>text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,'[redacted-email]').replace(/\b(?:bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ig,'[redacted-token]');
const diagnosticUrl=(raw:string|null)=>{if(raw===null)return null;try{const u=new URL(raw);return{origin:u.origin,path:u.pathname,queryKeys:[...u.searchParams.keys()]};}catch{return '[invalid-url]';}};
function textChange(before:string,after:string){
 let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
 return{offset:start,before:diagnosticText(before.slice(Math.max(0,start-32),Math.min(before.length-end+32,start+192))),after:diagnosticText(after.slice(Math.max(0,start-32),Math.min(after.length-end+32,start+192))),beforeSha256:digest(before),afterSha256:digest(after)};
}

/** Require an actually settled rendered identity; networkidle alone can precede SPA DOM updates. */
export async function waitSourceRenderedReadiness(page:Page,project:Project,timeout=15000){
 if(!tracking.has(page))beginSourceRenderedAction(page);
 const state=tracking.get(page)!,started=Date.now(),budget=Math.max(timeout,2500);
 const rules=project.workflow?.sourceRenderedReadiness?.rules||[];
 for(const rule of rules){if(!rule||typeof rule.pathPattern!=='string'||typeof rule.selector!=='string'||!rule.selector)throw Error('Source rendered readiness requires pathPattern and selector');new RegExp(rule.pathPattern);}
 let previous='',stableSince=0,lastReason='rendered identity has not stabilized';
 let previousIdentity:any,lastPending='';const changes:any[]=[],resourceChanges:any[]=[];
 while(Date.now()-started<budget){
  const url=new URL(page.url()),matched=rules.filter(rule=>new RegExp(rule.pathPattern).test(url.pathname+url.search));
  const sample:any=await page.evaluate(`(${String.raw`rules=>{
   const visible=n=>{if(!n)return false;const r=n.getBoundingClientRect();if(!r.width||!r.height)return false;for(let p=n;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)return false;}return true;};
   const normalize=value=>value.trim().replace(/\s+/g,' ');
   const failures=[];
   for(const rule of rules){
    const node=document.querySelector(rule.selector);
    if(!visible(node))failures.push('selector not visible: '+rule.selector);
    else if(rule.expectedText!==undefined&&normalize(node.textContent||'')!==normalize(rule.expectedText))failures.push('expectedText differs: '+rule.selector);
    for(const selector of rule.loadingSelectors||[])if(visible(document.querySelector(selector)))failures.push('loading visible: '+selector);
    if(rule.requiredHrefQuery){const spec=rule.requiredHrefQuery,links=[...document.querySelectorAll(spec.selector)];if(!links.length||links.some(link=>!link.href||new URL(link.href,location.href).searchParams.get(spec.parameter)!==spec.value))failures.push('requiredHrefQuery differs: '+spec.selector);}
   }
   const main=document.querySelector('main,[role=main]')||document.body;
   return{identity:{url:location.href,title:document.title,main:normalize(main.innerText||''),canonical:document.querySelector('link[rel=canonical]')?.href||null},failures};
  }`})(${JSON.stringify(matched)})`);
  const resourcePaths=matched.flatMap(rule=>rule.resourcePaths||[]);
  const pending=[...state.pending].filter(request=>{const u=new URL(request.url());return u.origin===url.origin&&(!resourcePaths.length||resourcePaths.includes(u.pathname));}).length;
  const signature=digest(JSON.stringify(sample.identity)),now=Date.now();
  if(previousIdentity&&JSON.stringify(previousIdentity)!==JSON.stringify(sample.identity)){
   const change:any={elapsedMs:now-started,fields:Object.keys(sample.identity).filter(key=>sample.identity[key]!==previousIdentity[key])};
   if(change.fields.includes('main'))change.main=textChange(previousIdentity.main,sample.identity.main);
   if(change.fields.includes('title'))change.title={before:diagnosticText(previousIdentity.title).slice(0,240),after:diagnosticText(sample.identity.title).slice(0,240)};
   for(const field of ['url','canonical'])if(change.fields.includes(field))change[field]={before:diagnosticUrl(previousIdentity[field]),after:diagnosticUrl(sample.identity[field])};
   changes.push(change);if(changes.length>6)changes.shift();
  }
  previousIdentity=sample.identity;
  const pendingResources=[...state.pending].filter(request=>{const u=new URL(request.url());return u.origin===url.origin&&(!resourcePaths.length||resourcePaths.includes(u.pathname));}).map(request=>({method:request.method(),type:request.resourceType(),url:diagnosticUrl(request.url())}));
  const pendingIdentity=JSON.stringify(pendingResources);
  if(pendingIdentity!==lastPending){resourceChanges.push({elapsedMs:now-started,pending:pendingResources.slice(0,12)});if(resourceChanges.length>6)resourceChanges.shift();lastPending=pendingIdentity;}
  const valid=!sample.failures.length&&!pending;
  if(!valid){stableSince=0;previous=signature;}
  else if(!stableSince||signature!==previous){stableSince=now;previous=signature;}
  if(valid&&stableSince&&now-stableSince>=1500&&now-state.startedAt>=1500)return{kind:'source-rendered-readiness',actionStartedAt:new Date(state.startedAt).toISOString(),stableSince:new Date(stableSince).toISOString(),observedAt:new Date(now).toISOString(),stableMs:now-stableSince,identitySha256:signature,matchedRules:matched.map(r=>r.pathPattern)};
  lastReason=sample.failures.join('; ')||(pending?'public data requests still loading':'rendered identity has not stabilized for 1500ms');
  await page.waitForTimeout(100);
 }
 const error=Error('Source rendered readiness failed: '+lastReason);
 Object.assign(error,{sourceRenderedReadinessDiagnostic:{kind:'source-rendered-readiness-timeout',elapsedMs:Date.now()-started,lastReason,identityChanges:changes,pendingResourceChanges:resourceChanges,queryValuesRedacted:true,mainTextFragmentsLimited:true}});
 throw error;
}
