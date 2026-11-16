import type { Page } from 'playwright';
import type { Action } from './contracts.js';
import { canonical, digest } from './artifacts.js';

export const SOURCE_STATE_ADAPTER = 'source-state-natural-v1';
export const SOURCE_STATE_FIELDS = ['viewportX','viewportY','inViewport','ariaExpanded','tabIndex','focused','scrollLock'] as const;
/** Diagnostics for the exact post-screenshot observer read; never include text or input values. */
export function sourceStateFieldDifferences(before:Record<string,any>,after:Record<string,any>,components:string[]) {
 const safe=(value:any):any=>{
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(value===undefined)return {present:false};
  if(value==='true'||value==='false')return value==='true';
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>['htmlOverflowX','htmlOverflowY','bodyOverflowX','bodyOverflowY','bodyPosition','bodyTop','locked'].includes(key)).map(([key,item])=>[key,safe(item)]));
  if(typeof value==='string'){const px=/^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value)?Number.parseFloat(value):null;return {present:true,hidden:value==='hidden',clip:value==='clip',auto:value==='auto',scroll:value==='scroll',visible:value==='visible',fixed:value==='fixed',px};}
  return {present:true};
 };
 return components.flatMap(cid=>{const fields=SOURCE_STATE_FIELDS.filter(field=>canonical(before[cid]?.[field])!==canonical(after[cid]?.[field]));return fields.length?[{component:cid,fields,before:Object.fromEntries(SOURCE_STATE_FIELDS.map(field=>[field,safe(before[cid]?.[field])])),after:Object.fromEntries(SOURCE_STATE_FIELDS.map(field=>[field,safe(after[cid]?.[field])]))}]:[];});
}
/** Read-only finite-animation timing across the screenshot boundary. Holds node references, never writes DOM. */
export async function sourceScreenshotAnimationObserver(page:Page,selectors:Record<string,string>){
 const handle=await page.evaluateHandle(({selectors})=>({selectors,nodes:Object.entries(selectors).map(([id,selector])=>({id,node:document.querySelector(selector)})),animations:[] as Animation[]}),{selectors});
 return {sample:()=>handle.evaluate(scope=>{const animations=document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity&&a.effect instanceof KeyframeEffect&&a.effect.target instanceof Element&&scope.nodes.some(({id})=>{const node=document.querySelector(scope.selectors[id]);return node&&(a.effect as KeyframeEffect).target!.contains(node);})).slice(0,32);return animations.map(animation=>{let id=scope.animations.indexOf(animation);if(id<0){id=scope.animations.length;scope.animations.push(animation);}const target=(animation.effect as KeyframeEffect).target!,rect=target.getBoundingClientRect();return{id,name:animation instanceof CSSAnimation?animation.animationName:animation instanceof CSSTransition?animation.transitionProperty:'web-animation',currentTime:typeof animation.currentTime==='number'?animation.currentTime:null,startTime:typeof animation.startTime==='number'?animation.startTime:null,playState:animation.playState,duration:animation.effect!.getComputedTiming().duration,endTime:animation.effect!.getComputedTiming().endTime,transform:getComputedStyle(target).transform,className:target.getAttribute('class'),inlineAnimation:Object.fromEntries(['animation','animation-name','animation-duration','animation-delay','animation-fill-mode','animation-play-state','transform','transition'].map(property=>[property,(target as HTMLElement).style.getPropertyValue(property)])),components:scope.nodes.filter(({id})=>document.querySelector(scope.selectors[id])===target).map(({id})=>id),sameComponentNodes:scope.nodes.filter(({id})=>document.querySelector(scope.selectors[id])===target).every(({node})=>node===target),connected:target.isConnected,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};});}),close:()=>handle.dispose()};
}
export type SourceAssertionRead = 'text'|'value'|'visible'|'count'|typeof SOURCE_STATE_FIELDS[number];
export type ScrollSettle = { frames:number; tolerancePx:number };
export type SourceAction = Omit<Action,'op'> & {op:Action['op']|'scroll-into-view'|'scroll-element';x?:number;block?:'start'|'center'|'end'|'nearest';settle?:ScrollSettle};
const object=(x:any)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x:any,allowed:string[])=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const text=(x:any)=>typeof x==='string'&&!!x.trim();
const strings=(x:any)=>Array.isArray(x)&&x.every(text)&&new Set(x).size===x.length;
export const validScrollSettle=(x:any)=>keys(x,['frames','tolerancePx'])&&Number.isInteger(x.frames)&&x.frames>=6&&x.frames<=120&&Number.isFinite(x.tolerancePx)&&x.tolerancePx>=0&&x.tolerancePx<=0.5;
export function validSemanticScroll(a:any) {
  if(!keys(a,['op','selector','effect','x','block','settle','waitAfter'])||a.effect!=='read-only'||!text(a.selector)||!validScrollSettle(a.settle))return false;
  if(a.waitAfter!==undefined&&(!keys(a.waitAfter,['visible','absent','hidden'])||!Object.keys(a.waitAfter).length||!Object.values(a.waitAfter).every(text)))return false;
  if(a.op==='scroll-into-view')return !Object.hasOwn(a,'x')&&['start','center','end','nearest'].includes(a.block);
  return a.op==='scroll-element'&&!Object.hasOwn(a,'block')&&Number.isFinite(a.x)&&a.x>=0&&a.x<=1e7;
}

/** v2 is opt-in, state-specific and strict. Never reinterpret legacy/r3 policy bytes. */
export function stateMediaPolicy(project:any,path:string,state?:string) {
  const c=project.workflow?.sourceMediaReadiness;
  if(c?.schemaVersion!==2)return null;
  if(!keys(c,['schemaVersion','rationale','rules'])||!text(c.rationale)||!Array.isArray(c.rules)||!c.rules.length)throw Error('Invalid state-specific sourceMediaReadiness policy');
  for(const r of c.rules){
    if(!keys(r,['paths','states','absent','requiredImages','viewportImages','uiReady','coverage'])||!strings(r.paths)||!r.paths.length||r.paths.some((p:string)=>!/^\/(?!\/)/.test(p)||/[#\\\s]/.test(p))||!strings(r.states)||!r.states.length||!strings(r.absent)||!Array.isArray(r.requiredImages)||r.viewportImages!==true||!['domcontentloaded','domcontentloaded-jquery-ready'].includes(r.uiReady)||!['viewport','fullpage-after-traversal'].includes(r.coverage))throw Error('Invalid state-specific sourceMediaReadiness rule');
    const selectors=new Set<string>();
    for(const i of r.requiredImages){if(!keys(i,['selector','minCount'])||!text(i.selector)||!Number.isInteger(i.minCount)||i.minCount<1||selectors.has(i.selector))throw Error('Invalid state-specific required image');selectors.add(i.selector);}
    if(r.coverage==='fullpage-after-traversal'&&!r.requiredImages.length)throw Error('Fullpage state requires explicit necessary images');
  }
  if(!text(state))throw Error('State-specific readiness requires an explicit state identity');
  const matches=c.rules.filter((r:any)=>r.paths.includes(path)&&r.states.includes(state));
  if(matches.length!==1)throw Error('State-specific readiness requires exactly one current path/state rule');
  return {rule:matches[0],sha256:digest(canonical(c)),state:state!};
}

/** Shared browser function: actual rect intersection clipped through scroll ancestors.
 * Visibility is not viewport membership. No media attributes/styles are changed. */
export function readSourceElement(node:Element) {
  const r=node.getBoundingClientRect();let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),visible=r.width>0&&r.height>0;
  for(let p:Element|null=node;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)visible=false;if(p!==node){const q=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(c.overflowX)){left=Math.max(left,q.left+p.clientLeft);right=Math.min(right,q.left+p.clientLeft+p.clientWidth);}if(/hidden|clip|auto|scroll/.test(c.overflowY)){top=Math.max(top,q.top+p.clientTop);bottom=Math.min(bottom,q.top+p.clientTop+p.clientHeight);}}}
  const html=getComputedStyle(document.documentElement),body=document.body?getComputedStyle(document.body):null;
  return {viewportX:r.x,viewportY:r.y,inViewport:visible&&right>left&&bottom>top,ariaExpanded:node.getAttribute('aria-expanded'),tabIndex:(node as HTMLElement).tabIndex,focused:document.activeElement===node,scrollLock:{htmlOverflowX:html.overflowX,htmlOverflowY:html.overflowY,bodyOverflowX:body?.overflowX??null,bodyOverflowY:body?.overflowY??null,bodyPosition:body?.position??null,bodyTop:body?.top??null,locked:/hidden|clip/.test(html.overflowY)||!!body&&(/hidden|clip/.test(body.overflowY)||body.position==='fixed')}};
}
const reader=readSourceElement.toString();
export async function observeSourceFields(page:Page,selectors:Record<string,string>) {
  return page.evaluate<Record<string,ReturnType<typeof readSourceElement>>>(`(({selectors})=>{const read=(${reader});return Object.fromEntries(Object.entries(selectors).map(([id,s])=>{const nodes=document.querySelectorAll(s);if(nodes.length!==1)throw Error('Source observer selector must match exactly one element');return [id,read(nodes[0])]}));})(${JSON.stringify({selectors})})`);
}
export async function readSourceAssertion(page:Page,selector:string,read:string) {
  if(!SOURCE_STATE_FIELDS.includes(read as any))throw Error('Unknown source observation field');
  return (await observeSourceFields(page,{assertion:selector})).assertion[read as typeof SOURCE_STATE_FIELDS[number]];
}

/** Multiple animation frames + elapsed browser frames, not a fixed sleep. */
export async function settledSourceScroll(page:Page,selector:string|null,settle:ScrollSettle,timeout:number,expectedX?:number) {
  if(!validScrollSettle(settle)||!Number.isFinite(timeout)||timeout<=0||timeout>60000)throw Error('Invalid bounded settled-scroll policy');
  await page.evaluate(({selector,settle,expectedX})=>{(window as any)[Symbol.for('site2shop.sourceScrollSamples')]?.delete(JSON.stringify({selector,settle,expectedX}));},{selector,settle,expectedX});
  await page.waitForFunction(({selector,settle,expectedX})=>{
    const node=selector?document.querySelector(selector):null;if(selector&&(!node||document.querySelectorAll(selector).length!==1))throw Error('Scroll locator is missing/ambiguous');
    const x=node?node.scrollLeft:scrollX,y=node?node.scrollTop:scrollY;
    const key=JSON.stringify({selector,settle,expectedX});
    const store=((window as any)[Symbol.for('site2shop.sourceScrollSamples')]??=new Map());
    const now=performance.now();let s=store.get(key);
    if(!s||Math.abs(x-s.anchorX)>settle.tolerancePx||Math.abs(y-s.anchorY)>settle.tolerancePx)s={anchorX:x,anchorY:y,samples:[]};
    s.samples.push({x,y,time:now});if(s.samples.length>121)s.samples.shift();s.x=x;s.y=y;store.set(key,s);
    return s.samples.length>=settle.frames+1&&now-s.samples[0].time>=100&&(expectedX===undefined||Math.abs(x-expectedX)<=settle.tolerancePx);
  },{selector,settle,expectedX},{timeout,polling:'raf'});
  return page.evaluate(({selector,settle,expectedX})=>{
    const store=(window as any)[Symbol.for('site2shop.sourceScrollSamples')],key=JSON.stringify({selector,settle,expectedX}),s=store.get(key);store.delete(key);
    return {selector,frames:s.samples.length-1,elapsedMs:s.samples.at(-1).time-s.samples[0].time,samples:s.samples,x:s.x,y:s.y,expectedX:expectedX??null,tolerancePx:settle.tolerancePx,settled:true};
  },{selector,settle,expectedX});
}
export async function performSourceScroll(page:Page,a:SourceAction,timeout:number){
  if(!validSemanticScroll(a))throw Error('Invalid source-only semantic scroll action');
  const n=page.locator(a.selector!);if(await n.count()!==1)throw Error('Scroll selector missing/ambiguous');
  // Clear any failed previous sampling so a retry never inherits a passed wait.
  await page.evaluate(()=>{delete (window as any)[Symbol.for('site2shop.sourceScrollSamples')];});
  if(a.op==='scroll-into-view')await n.evaluate((el,block)=>el.scrollIntoView({block,inline:'nearest'}),a.block!);
  else await n.evaluate((el,x)=>{const c=getComputedStyle(el);if(!/auto|scroll/.test(c.overflowX)||el.scrollWidth<=el.clientWidth||x>el.scrollWidth-el.clientWidth)throw Error('Horizontal action requires actual scroll container and reachable x');el.scrollTo({left:x});},a.x!);
  const observation=await settledSourceScroll(page,a.op==='scroll-element'?a.selector!:null,a.settle!,timeout,a.op==='scroll-element'?a.x:undefined);
  const element=(await observeSourceFields(page,{action:a.selector!})).action;
  if(!element.inViewport)throw Error('Semantic scroll did not expose its actual element in viewport');
  return {adapter:SOURCE_STATE_ADAPTER,scroll:observation,element};
}

function stateMediaExpression(policy:NonNullable<ReturnType<typeof stateMediaPolicy>>){
  return `(({rule,state,sha256})=>{
    const read=(${reader});
    const image=i=>({src:i.currentSrc||i.src,complete:i.complete,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,loaded:i.complete&&i.naturalWidth>0&&i.naturalHeight>0,inViewport:read(i).inViewport,loading:i.getAttribute('loading')});
    const viewportImages=[...document.images].filter(i=>read(i).inViewport).map(image);
    const requiredImages=rule.requiredImages.map(spec=>{const nodes=[...document.querySelectorAll(spec.selector)];return {selector:spec.selector,minCount:spec.minCount,onlyImages:nodes.every(i=>i instanceof HTMLImageElement),images:nodes.filter(i=>i instanceof HTMLImageElement).map(image)};});
    const absent=rule.absent.map(selector=>({selector,count:document.querySelectorAll(selector).length}));
    const navigation=performance.getEntriesByType('navigation')[0];
    const ui={mode:rule.uiReady,domContentLoaded:document.readyState!=='loading'&&!!navigation&&navigation.domContentLoadedEventEnd>0,jqueryReady:rule.uiReady==='domcontentloaded-jquery-ready'?(typeof window.jQuery==='function'&&window.jQuery.isReady===true):null};
    const ready=ui.domContentLoaded&&(ui.jqueryReady===null||ui.jqueryReady===true)&&absent.every(a=>a.count===0)&&viewportImages.every(i=>i.loaded)&&requiredImages.every(s=>s.onlyImages&&s.images.length>=s.minCount&&s.images.every(i=>i.loaded));
    return {adapter:'${SOURCE_STATE_ADAPTER}',state,policySha256:sha256,coverage:rule.coverage,ui,absent,viewportImages,requiredImages,ready};
  })(${JSON.stringify({rule:policy.rule,state:policy.state,sha256:policy.sha256})})`;
}
export async function sampleStateMedia(page:Page,policy:NonNullable<ReturnType<typeof stateMediaPolicy>>){return page.evaluate<any>(stateMediaExpression(policy));}
export async function waitStateMedia(page:Page,policy:NonNullable<ReturnType<typeof stateMediaPolicy>>,timeout:number){
  if(!Number.isFinite(timeout)||timeout<=0||timeout>60000)throw Error('Invalid bounded natural media timeout');
  const started=Date.now();await page.waitForLoadState('domcontentloaded',{timeout});
  const remaining=timeout-(Date.now()-started);if(remaining<=0)throw Error('State readiness timeout before natural media');
  await page.waitForFunction(`(${stateMediaExpression(policy)}).ready`,null,{polling:'raf',timeout:remaining});
  const sample=await sampleStateMedia(page,policy);verifyStateMediaProof(policy,sample);return sample;
}

/** Offline verifier consumes the very same policy selection and checks actual raw proof. */
export function verifyStateMediaProof(policy:NonNullable<ReturnType<typeof stateMediaPolicy>>,proof:any){
  const r=policy.rule;
  if(proof?.adapter!==SOURCE_STATE_ADAPTER||proof.state!==policy.state||proof.policySha256!==policy.sha256||proof.coverage!==r.coverage||proof.ready!==true||proof.ui?.mode!==r.uiReady||proof.ui.domContentLoaded!==true||(r.uiReady==='domcontentloaded-jquery-ready'?proof.ui.jqueryReady!==true:proof.ui.jqueryReady!==null))throw Error('Missing/stale source state media/UI proof');
  const loaded=(i:any)=>typeof i.src==='string'&&!!i.src&&i.complete===true&&i.loaded===true&&Number.isFinite(i.naturalWidth)&&i.naturalWidth>0&&Number.isFinite(i.naturalHeight)&&i.naturalHeight>0;
  if(!Array.isArray(proof.viewportImages)||!proof.viewportImages.every((i:any)=>i.inViewport===true&&loaded(i))||!Array.isArray(proof.absent)||canonical(proof.absent)!==canonical(r.absent.map((selector:string)=>({selector,count:0})))||!Array.isArray(proof.requiredImages)||proof.requiredImages.length!==r.requiredImages.length)throw Error('Incomplete source state media proof');
  for(let n=0;n<r.requiredImages.length;n++){const spec=r.requiredImages[n],p=proof.requiredImages[n];if(p.selector!==spec.selector||p.minCount!==spec.minCount||p.onlyImages!==true||!Array.isArray(p.images)||p.images.length<spec.minCount||!p.images.every(loaded))throw Error('Required source media incomplete');}
}
export function verifySourceScrollProof(action:SourceAction,proof:any){
  if(!validSemanticScroll(action)||proof?.adapter!==SOURCE_STATE_ADAPTER||proof.scroll?.settled!==true||proof.scroll.frames<action.settle!.frames||proof.scroll.elapsedMs<100||proof.scroll.tolerancePx!==action.settle!.tolerancePx||proof.element?.inViewport!==true||!Number.isFinite(proof.scroll.x)||!Number.isFinite(proof.scroll.y))throw Error('Missing actual settled source scroll/intersection proof');
  const samples=proof.scroll.samples;
  if(!Array.isArray(samples)||samples.length!==proof.scroll.frames+1||samples.length>121||samples.some((s:any,i:number)=>!Number.isFinite(s.x)||!Number.isFinite(s.y)||!Number.isFinite(s.time)||i>0&&s.time<=samples[i-1].time||Math.abs(s.x-samples[0].x)>action.settle!.tolerancePx||Math.abs(s.y-samples[0].y)>action.settle!.tolerancePx)||samples.at(-1).time-samples[0].time!==proof.scroll.elapsedMs||samples.at(-1).x!==proof.scroll.x||samples.at(-1).y!==proof.scroll.y)throw Error('Invalid raw settled-scroll frame samples');
  if(action.op==='scroll-element'&&(proof.scroll.selector!==action.selector||proof.scroll.expectedX!==action.x||Math.abs(proof.scroll.x-action.x!)>action.settle!.tolerancePx))throw Error('Wrong horizontal scroll result');
  if(action.op==='scroll-into-view'&&(proof.scroll.selector!==null||proof.scroll.expectedX!==null))throw Error('Wrong semantic document scroll proof');
}

/** Bilateral opt-in is declared by the current state's required component fields. */
export function declaredStateFieldPolicy(route:any,stateId:string){
 const fieldsByComponent=Object.fromEntries(route.states[stateId].components.slice().sort().map((id:string)=>[id,SOURCE_STATE_FIELDS.filter(field=>route.components[id].requiredFields.includes(field))]).filter(([,fields]:any)=>fields.length));
 if(!Object.keys(fieldsByComponent).length)return null;const declaration={adapter:SOURCE_STATE_ADAPTER,fieldsByComponent};return{...declaration,policySha256:digest(canonical(declaration))};
}
export function verifyDeclaredStateFields(route:any,stateId:string,capture:any){
 const policy=declaredStateFieldPolicy(route,stateId),observed=capture.captureEnvironment?.declaredStateFields;
 if(!policy){if(observed)throw Error('Undeclared state field observation policy');return;}
 if(canonical(observed)!==canonical(policy))throw Error('Declared state field observation policy missing or changed');
 for(const [id,fields]of Object.entries(policy.fieldsByComponent))for(const field of fields as string[]){const value=capture.components?.[id]?.[field];
  const valid=field==='focused'||field==='inViewport'?typeof value==='boolean':field==='ariaExpanded'?value===null||typeof value==='string':field==='scrollLock'?object(value)&&typeof value.locked==='boolean':Number.isFinite(value);
  if(!Object.hasOwn(capture.components?.[id]||{},field)||value===undefined||!valid)throw Error('Missing/invalid independent state measurement '+id+'/'+field);
 }
}

export function routeInitialContextPolicy(route:any){
 if(route.initialActions===undefined&&route.contextNormalization===undefined)return null;
 const actions=route.initialActions,normalization=route.contextNormalization;
 if(actions!==undefined){if(!object(actions)||Object.keys(actions).some(k=>!['source','target'].includes(k)))throw Error('Initial actions require explicit bilateral source/target arrays');for(const side of ['source','target']){if(!Array.isArray(actions[side])||!actions[side].length||actions[side].length>20)throw Error('Initial actions must be nonempty and bounded');for(const a of actions[side])if(!['click','fill','select','check','uncheck','hover','press','scroll','visit'].includes(a.op)||!(a.effect==='read-only'||side==='target'&&a.effect==='local-fixture')||(a.op==='scroll'?!Number.isFinite(a.y):a.op==='visit'?typeof a.expectedPath!=='string'||!/^\/(?!\/)/.test(a.expectedPath)||/[\\\x00-\x20#]/.test(a.expectedPath):!text(a.selector))||(['fill','select','press'].includes(a.op)&&typeof a.value!=='string'))throw Error('Invalid actual initial UI action');}}
 if(normalization!==undefined){if(!normalization?.id||!normalization.rationale||!normalization.preservedBranch||!Array.isArray(normalization.dismissals)||normalization.dismissals.length>5||normalization.dismissals.some((d:any)=>!text(d.selector)||!['click','press'].includes(d.op)||d.op==='press'&&d.value!=='Enter'||!Number.isFinite(d.waitMs)||d.waitMs<0||d.waitMs>20000))throw Error('Invalid explicit initial context dismissals');}
 return digest(canonical({actions:actions??null,normalization:normalization??null}));
}
export function verifyInitialContextRows(route:any,side:string,log:any,cutoff:string,finalUrl?:string,stage?:string){
 const policy=routeInitialContextPolicy(route);if(!policy){if(log)throw Error('Undeclared initial context log');return;}
 if(log?.policySha256!==policy||!log[side]||!Number.isFinite(Date.parse(cutoff)))throw Error('Initial context policy/log missing or changed');
 const data=log[side],dismissals=route.contextNormalization?.dismissals||[],actions=route.initialActions?.[side]||[];
 if(!Array.isArray(data.normalization)||data.normalization.length!==dismissals.length||!Array.isArray(data.actions)||data.actions.length!==actions.length)throw Error('Initial context actual action count differs');
 let end=0;for(const [i,row]of data.normalization.entries()){const d=dismissals[i];if(row.selector!==d.selector||row.context!==route.contextNormalization.id||row.preservedBranch!==route.contextNormalization.preservedBranch||!['performed','not-shown'].includes(row.status)||!Number.isInteger(row.matchedCount)||row.matchedCount<0||row.matchedCount>1||row.visible!==(row.status==='performed')||row.status==='performed'&&(row.matchedCount!==1||row.op!==d.op))throw Error('Invalid visible/skip dismissal log');const start=Date.parse(row.startedAt),finish=Date.parse(row.endedAt);if(!Number.isFinite(start)||!Number.isFinite(finish)||start<end||finish<start)throw Error('Initial context chronology differs');end=finish;}
 for(const [i,row]of data.actions.entries()){const start=Date.parse(row.startedAt),finish=Date.parse(row.endedAt);if(row.status!=='performed'||canonical(row.action)!==canonical(actions[i])||!Number.isFinite(start)||!Number.isFinite(finish)||start<end||finish<start)throw Error('Invalid actual initial UI action log');end=finish;}
  for(const [index,row]of data.actions.entries())if(actions[index].op==='visit'){const action=actions[index],paths=side==='source'?[action.expectedPath]:[action.expectedTargetPaths?.[stage==='online'?'online':'preflight']];let url:URL;try{url=new URL(row.navigation.finalUrl);}catch{throw Error('Actual initial visit URL missing');}if(!finalUrl||url.origin!==new URL(finalUrl).origin||row.navigation.status!==200||row.navigation.requestedUrl!==url.href||!paths.includes(url.pathname+url.search)||url.hash)throw Error('Actual initial visit route/status differs');if(side==='source'){const ready=row.renderedReadiness;if(ready?.kind!=='source-rendered-readiness'||!Number.isFinite(ready.stableMs)||ready.stableMs<1500||!Number.isFinite(Date.parse(ready.actionStartedAt))||!Number.isFinite(Date.parse(ready.observedAt))||Date.parse(ready.actionStartedAt)<Date.parse(row.startedAt)||Date.parse(ready.observedAt)>Date.parse(row.endedAt))throw Error('Initial visit rendered readiness proof missing');}if(route.contextNormalization){const reset={contextNormalization:route.contextNormalization};verifyInitialContextRows(reset,side,{policySha256:routeInitialContextPolicy(reset),[side]:{normalization:row.contextNormalization,actions:[]}},row.endedAt);}}
 if(end>Date.parse(cutoff))throw Error('Initial context was not completed before capture');
}
