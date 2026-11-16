import {captureUnavailableDirectEntry} from './unavailable-direct-entry.js';
import {preparePublicCommerceViewport,publicCommerceViewportProof} from './public-commerce-viewport.js';
import {snapshotPublicCommerceDom,publicCommerceDomEnabled,observeProductMetadata,captureProductMetadata,readObservedProductResponses,verifyPublicCommerceCapture} from './public-commerce-capture.js';
import {prepareSourceBaseline,baselineCheck} from './source-baseline.js';
import {observeStockAvailability,stockSnapshotResponsePath,readAvailableStockResponses,readStockResponseAudit,readStockFacts,stockFactsSemantics,readStockControls,type StockControlsSpec} from './stock-controls.js';
import {requiresVerifiedStylesheetProof,verifyPairedStylesheetProof} from './stylesheet-binding.js';
import {observeLoadedStylesheets,captureLoadedStylesheets} from './loaded-stylesheet-capture.js';
import {prepareObservedImages} from './observed-image-readiness.js';
import {prepareNaturalContentRendering,restoreNaturalContentRendering} from './content-visibility-paint.js';
import {SourcePauseRequested,sourcePauseRequested} from './source-pause.js';
import {prepareSourceReuse,sourceSessionKey,sourceSessionComplete,type SourceReuseSpec} from './source-reuse.js';
import {observeSourceProtection,type SourceProtection} from './source-protection.js';
import {validateSourceContext,observeSourceContext,isIsolatedGuestPage} from './source-context.js';
import {readNavigationData} from './navigation-data.js';
import {verifyMediaDelivery} from './media-comparison.js';
import {mediaNavigationDestination} from './media-comparison.js';
import {mediaAssetKinds} from './media-comparison.js';
import {installVideoCaptureAudioGuard,projectVideoCaptureFrame} from './video-frame-capture.js';
import {stableViewportScreenshot,viewportPixelPolicy} from './viewport-pixel-stability.js';
import {ownedHeadlessOptions,observeScrollbarEnvironment} from './browser-rendering-policy.js';
import {usesMediaComparison,loadVerifiedMediaAssets} from './media-comparison.js';
import {captureFullPagePreservingLayout} from './screenshot-geometry.js';
import {beginSourceRenderedAction,waitSourceRenderedReadiness} from './source-rendered-readiness.js';
import {prepareSourceScope,finishSourceScope,type ScopedContext} from './source-scope.js';
import {targetPathFor,mappedTargetPath,readTargetIdentity,type TargetStage} from './target-context.js';
import { chromium, type Page, type BrowserContext } from "playwright";
import { join, dirname, resolve,relative } from "node:path";
import { readFile } from "node:fs/promises";
import { assertRenderedEvidencePage, renderedEvidenceRejection } from "../rendered-page-validity.js";
import { stateCanonicalRejection,COLLECTOR, applies, type Action, type Capture, type Evidence, type Plan, type Ref, type RoutePlan, type Session, type Side } from "./contracts.js";
import { loadScopedPlan, isSourceOnlyPlan, bilateralPlan, collectorFor, captureSequence as sequenceFor, captureActions as actionsFor, type CaptureContext } from './source-plan.js';
import { buildIdentity, canonical, contained, digest, jsonFile, readRef, saveArtifact, writeJson, safeBrowserError } from "./artifacts.js";
import { compareCaptures, gate, loadPlan, recordGate } from "./gates.js";
import { sourceStorage,sourceStorageCurrent, assertSourceUnblocked,sourceSessionPolicy,isSourceSessionRefresh,type SourceStorage,openSourceBrowser,createIsolatedGuestContext,usesExistingChrome,observeBrowserContext } from "./source-session.js";
import {admittedSourceReadQuery,sourceReadQueryPolicy} from './source-read-queries.js';
import {projectSourcePrivacy,assertNoPrivateSourceIdentity} from './source-privacy.js';
import {sourceUrlMutationReason,sourceSafeMethod,waitSourceReadiness,assertSourceReadiness,sourceNavigationOptions,waitSourceNavigation} from './source-safety-policy.js';
import {SOURCE_STATE_ADAPTER,SOURCE_STATE_FIELDS,sourceStateFieldDifferences,sourceScreenshotAnimationObserver,declaredStateFieldPolicy,routeInitialContextPolicy,observeSourceFields,readSourceAssertion,performSourceScroll,stateMediaPolicy,sampleStateMedia,verifyStateMediaProof,type SourceAction} from './source-state-adapter.js';

const initialContextPages=new WeakMap<Page,string>();
export const OBSERVE = String.raw`({selectors,topologies={},mediaKinds=['image']}) => {
  const components = {},mediaSelector=mediaKinds.map(kind=>kind==='video'?'video':'img').join(',');
  const readableText=node=>{if(node.matches('script,style,noscript,template'))return '';const copy=node.cloneNode(true);copy.querySelectorAll('script,style,noscript,template').forEach(n=>n.remove());return copy.textContent.trim().replace(/\s+/g,' ');};
  const named=Object.entries(selectors).map(([id,selector])=>({id,node:document.querySelector(selector)}));
  const ids=new Map(named.filter(n=>n.node).map(n=>[n.node,n.id])),parents=new WeakMap(),orders=new Map();
  const logicalParent=node=>{if(parents.has(node))return parents.get(node);for(let p=node.parentElement;p;p=p.parentElement){if(ids.has(p)){parents.set(node,ids.get(p));return ids.get(p);}}parents.set(node,'document');return 'document';};
  const groups=new Map();for(const item of named)if(item.node){const parent=logicalParent(item.node);if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push(item);}
  for(const group of groups.values()){group.sort((a,b)=>a.node===b.node?0:(a.node.compareDocumentPosition(b.node)&Node.DOCUMENT_POSITION_FOLLOWING)?-1:1);group.forEach((item,index)=>orders.set(item.id,index));}
  for (const [id, selector] of Object.entries(selectors)) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1) throw Error(id + ': selector expected exactly one element, found ' + nodes.length);
    const node = nodes[0], rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    let visible = !!(rect.width && rect.height);
    for (let p = node; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) visible = false; }
    const physicalParent=node.parentElement?.tagName.toLowerCase(),physicalOrder=[...node.parentElement.children].indexOf(node),topologyMode=topologies[id]||'physical';
    const parent = topologyMode==='component-tree'?logicalParent(node):Object.entries(selectors).find(([key,s]) => key !== id && document.querySelector(s) === node.parentElement)?.[0] || physicalParent;
    const order=topologyMode==='component-tree'?orders.get(id):physicalOrder;
    components[id] = { visible, x:rect.x, y:rect.y + scrollY, width:rect.width, height:rect.height,
      display:css.display, fontSize:css.fontSize, lineHeight:css.lineHeight, fontFamily:css.fontFamily,
      overflowX:css.overflowX, overflowY:css.overflowY, parent,order,topologyMode,physicalParent,physicalOrder,
      paddingTop:css.paddingTop, paddingRight:css.paddingRight, paddingBottom:css.paddingBottom, paddingLeft:css.paddingLeft,
      gap:css.gap, gridTemplateColumns:css.gridTemplateColumns, flexDirection:css.flexDirection,
      text:readableText(node), tag:node.tagName.toLowerCase(), role:node.getAttribute('role'),
      value:'value' in node ? String(node.value) : null, checked:'checked' in node ? node.checked : null,
      disabled:'disabled' in node ? node.disabled : null,
      images:[...(node.matches(mediaSelector)?[node]:[]),...node.querySelectorAll(mediaSelector)].map(i => i.tagName==='VIDEO'?({alt:i.getAttribute('aria-label')||'',loaded:i.readyState>=2,src:i.currentSrc||i.src,kind:'video'}):({alt:i.alt,loaded:i.complete && i.naturalWidth > 0,src:i.currentSrc || i.src})),
      scrollWidth:node.scrollWidth, clientWidth:node.clientWidth,scrollLeft:node.scrollLeft };
  }
  const controls = [...document.querySelectorAll('a,button,input,select,textarea,[role=button]')].filter(n => {
    const r=n.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;
    for(let p=n;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)return false;}return true;
  }).map(n=>{const chain=[];for(let p=n;p&&p!==document.documentElement;p=p.parentElement){const peers=[...p.parentElement.children].filter(x=>x.tagName===p.tagName);chain.unshift(p.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(p)+1)+')')}return{tag:n.tagName.toLowerCase(),role:n.getAttribute('role'),name:(n.getAttribute('aria-label') || n.textContent || n.getAttribute('placeholder') || '').trim().replace(/\s+/g,' '),type:n.getAttribute('type'),href:n.hasAttribute('href')?n.href:null,...(n.getAttribute('aria-disabled')==='true'?{ariaDisabled:true}:{}),selector:chain.join(' > ')}});
  return {components,controls,viewportSize:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},canonical:document.querySelector('link[rel=canonical]')?.href || null};
}`;
const sourceProtectionResponses=new WeakMap<Page,SourceProtection>();
const navigationIdentity = new WeakMap<Page,{status:number;buildId:string|null;cfMitigated?:string|null}>();

/** Explicit capture context controls. Operate real visible dismissal buttons only;
 * never remove overlays or write browser storage to make a comparison pass.
 * Independent visible/dismissed/reset branches remain required by the plan.
 */
export async function normalizeCaptureContext(page:Page,config:any){
  if(!config)return [];
  if(!config.id||!config.rationale||!config.preservedBranch||!Array.isArray(config.dismissals)||config.dismissals.length>5)
    throw Error('Capture context requires an identity, rationale and preserved independent branch');
  const rows:any[]=[];
  for(const item of config.dismissals){
    if(typeof item.selector!=='string'||!item.selector||!['click','press'].includes(item.op)||item.op==='press'&&item.value!=='Enter'||!Number.isFinite(item.waitMs)||item.waitMs<0||item.waitMs>20000)
      throw Error('Only bounded visible button click/Enter context dismissals are supported');
    const button=page.locator(item.selector),startedAt=new Date().toISOString();
    const validateControl=async()=>{
      const count=await button.count();
      if(count>1)throw Error('Context dismissal selector strict mode violation: expected one actual button');
      if(count===1&&await button.evaluate(n=>n.tagName)!=='BUTTON')throw Error('Context dismissal must name one actual button');
    };
    // Selector semantics are required even when an overloaded renderer cannot
    // finish a short visibility wait. A wrong element is never "not shown".
    await validateControl();
    const shown=await button.waitFor({state:'visible',timeout:Math.max(1,item.waitMs)}).then(()=>true).catch(async error=>{
      await validateControl();
      if(error?.name!=='TimeoutError')throw error;
      return false;
    });
    if(!shown){rows.push({context:config.id,selector:item.selector,status:'not-shown',matchedCount:await button.count(),visible:false,startedAt,endedAt:new Date().toISOString(),preservedBranch:config.preservedBranch});continue;}
    if(await button.count()!==1||await button.evaluate(n=>n.tagName)!=='BUTTON')throw Error('Context dismissal must name one actual button');
    if(item.op==='press')await button.press('Enter');else await button.click();
    await button.waitFor({state:'hidden',timeout:15000});
    rows.push({context:config.id,selector:item.selector,op:item.op,matchedCount:1,visible:true,...(item.op==='press'?{value:'Enter'}:{}),status:'performed',startedAt,endedAt:new Date().toISOString(),preservedBranch:config.preservedBranch});
  }
  return rows;
}

async function assertCaptureContext(page:Page,config:any){
  for(const item of config?.dismissals||[])
    if(await page.locator(item.selector).isVisible())throw Error('A dismissed capture-context overlay reappeared; recapture the same context');
}

/** Wait for actual viewport scrolling to stop before resetting an explicit anchor.
 * Smooth-scroll transitions can otherwise race the following scrollTo(0, y).
 */
export async function settleDocumentScroll(page:Page,expectedY?:number){
  let previous:string|undefined,stable=0;
  for(let attempt=0;attempt<50;attempt++){
    const position=await page.evaluate(()=>JSON.stringify([scrollX,scrollY]));
    stable=position===previous?stable+1:0;previous=position;
    if(stable>=4){
      if(expectedY!==undefined&&Math.abs(JSON.parse(position)[1]-expectedY)>0.5)throw Error('Viewport scroll settled at a different anchor');
      return;
    }
    await page.waitForTimeout(50);
  }
  throw Error('Viewport scrolling did not settle');
}
export async function animationContext(page:Page,mode:'frame-zero'|'running',rasterize=false){
  const animations=await page.evaluate(async ({mode,rasterize})=>{
    const selected=document.getAnimations().filter(a=>a.effect?.getTiming().iterations===Infinity);
    if(mode==='frame-zero'){
      selected.forEach(a=>a.pause());
      await Promise.all(selected.map(a=>a.ready));
      selected.forEach(a=>{a.currentTime=0;});
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    }
    const result=selected.map(a=>{
    return{name:a instanceof CSSAnimation?a.animationName:'web-animation',duration:a.effect!.getTiming().duration,playState:a.playState,currentTime:typeof a.currentTime==='number'?a.currentTime:null};
    });
    if(mode==='frame-zero'&&rasterize){
      // Capture-only projection of the already observed frame, including animated custom properties.
      // Chromium can keep rendering an old compositor animation after WAAPI reports paused/time=0.
      const frozen=selected.map(a=>{
        const effect=a.effect as KeyframeEffect,target=effect.target as HTMLElement,css=getComputedStyle(target);
        const key=Symbol.for('site2shop.capture.originalStyles'),originals=((window as any)[key]||=new WeakMap());
        if(!originals.has(target))originals.set(target,target.getAttribute('style'));
        const keys=[...new Set(effect.getKeyframes().flatMap(frame=>Object.keys(frame)).filter(k=>!['offset','computedOffset','easing','composite'].includes(k)))];
        return{a,target,properties:keys.map(key=>({key,value:css.getPropertyValue(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))}))};
      });
      for(const {a,target,properties}of frozen){a.cancel();for(const{key,value}of properties)target.style.setProperty(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value,'important');}
    }
    return result;
  },{mode,rasterize});
  return{infiniteAnimations:mode,animations,...(rasterize?{frameZeroRasterized:true}:{})};
}

/** Agent-selected locators inform the independent plan; these observations do not bypass its gate. */
export async function inspectSourceComponents(projectFile:string,selectorsFile:string,options?:{sourceStorageState?:SourceStorage}){
  const root=dirname(resolve(projectFile)),project=await jsonFile(projectFile);
  const config=await jsonFile(await contained(root,selectorsFile));
  const sourceContext=validateSourceContext(config.sourceContext);
  if(!config.sourcePath?.startsWith('/')||config.sourcePath.startsWith('//')||!Object.keys(config.components||{}).length||Object.values(config.components).some(v=>typeof v!=='string'))throw Error('Independent source path and component locators required');
  const viewports=project.workflow?.discoveryViewports||{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}};
  const browserArgs:string[]=[];
  if(sourceContext&&options?.sourceStorageState)throw Error('Isolated guest cannot import source storage state');
  let storageState=sourceContext?undefined:options?.sourceStorageState??await sourceStorage(project);
  if(config.inspectionId&&!/^[a-z0-9-]{1,64}$/.test(config.inspectionId))throw Error('Unsafe inspection identifier');
  const browser=sourceContext?null:await openSourceBrowser(project);
  const rows:any[]=[],evidenceRoot=join(root,'verification/recon-current',...(config.inspectionId?['inspections',config.inspectionId]:[]));
  try{
    for(const [viewport,size]of Object.entries<any>(viewports)){
      if(config.viewports&&!config.viewports.includes(viewport))continue;
      if(!sourceContext&&!sourceStorageCurrent(project,storageState))storageState=await sourceStorage(project);
       const lease=sourceContext?await createIsolatedGuestContext(project,{viewport:size}):await browser!.createContext({storageState,viewport:size,locale:'en-US',serviceWorkers:'block'}),context=lease.context;
       const actionLog:any[]=[],blockedRequests:any[]=[];
       let videoProjection:any;let phase='create-page',diagnosticPage:Page|undefined,navigationStatus:number|null=null;
       const attemptStarted=Date.now();
       try{
        const admittedQueries:any[]=[];
        const page=await lease.newPage();diagnosticPage=page;await installVideoCaptureAudioGuard(page,project);
        page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())navigationStatus=response.status();});
        await guardContext(lease.attached?page:context,new URL(project.sourceUrl).origin,'source',blockedRequests,project,admittedQueries,[],!!sourceContext);
        const requestedUrl=new URL(config.sourcePath,project.sourceUrl).href;
        beginSourceRenderedAction(page);
        phase='navigation';const response=await page.goto(requestedUrl,{...sourceNavigationOptions(project),timeout:30000});
        phase='navigation-policy';await waitSourceNavigation(page,project,15000);
        phase='initial-ready';await page.locator(config.ready||'h1').waitFor({state:'visible',timeout:15000});
        phase='initial-network-idle';await page.waitForLoadState('networkidle',{timeout:project.workflow?.discoveryNetworkIdleMs||8000}).catch(()=>undefined);
        phase='initial-page-validity';await assertRenderedEvidencePage(page,response,'source');
        await assertSourceUnblocked(page,project);
        phase='initial-rendered-readiness';await waitSourceRenderedReadiness(page,project,15000);
        const privacy=await projectSourcePrivacy(page,project);
        const actual=new URL(page.url()),expected=new URL(requestedUrl);
        if(actual.origin!==expected.origin||actual.pathname+actual.search!==expected.pathname+expected.search)throw Error(`Source component inspection redirected to ${actual.origin}${actual.pathname}; query keys: ${[...actual.searchParams.keys()].join(',')}`);
        const prepareImages=async()=>{
          if(!config.preloadImages)return;
          const visibleImagesReady=(selector:string)=>[...(document.querySelector(selector)||document.body).querySelectorAll('img')].filter(i=>{
            const r=i.getBoundingClientRect();if(!(r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight))return false;
            for(let p:Element|null=i;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)return false;}return true;
          }).every(i=>i.complete&&i.naturalWidth>0);
          // Warm observed resources without rapid scroll/culling of composited text layers.
          // Restore the source attributes after decoding; no content or layout is changed.
          await page.evaluate(async selector=>{
            const images=[...(document.querySelector(selector)||document.body).querySelectorAll('img')];
            await Promise.all(images.map(async image=>{
              const original=image.getAttribute('loading');image.loading='eager';
              try{await image.decode();}catch{/* Visible broken resources fail the readiness check below. */}
              finally{if(original===null)image.removeAttribute('loading');else image.setAttribute('loading',original);}
            }));
          },config.imageRoot||'body');
          await page.waitForFunction(visibleImagesReady,config.imageRoot||'body',{timeout:15000});
        };
        // Warm the initial page before operating transient UI. A later destination
        // is decoded again below, so SPA navigation keeps its own image readiness.
        phase='initial-image-preparation';await prepareImages();
        await prepareNaturalContentRendering(page);
        const initialAnimationEnvironment=await animationContext(page,config.infiniteAnimations||'running',config.rasterizeInfiniteFrameZero===true);
        actionLog.push(...await normalizeCaptureContext(page,config.contextNormalization));
        await preparePublicCommerceViewport(page,publicCommerceDomEnabled(project,expected.pathname+expected.search));
        if(config.initialReady)await page.locator(config.initialReady).waitFor({state:'visible',timeout:15000});

        phase='actions';for(const action of config.actions||[]){
          if(config.settleDocumentScroll)await settleDocumentScroll(page);
          let index=-1;
          await perform(page,action,'source',15000,false,async row=>{if(index<0){index=actionLog.length;actionLog.push({...row});}else actionLog[index]={...row};await writeJson(join(evidenceRoot,`inspection-actions-${viewport}.json`),{kind:'planning-action-attempt-not-acceptance',actionLog});},false,project,config.contextNormalization);
          if(config.settleDocumentScroll)await settleDocumentScroll(page,action.op==='scroll'?action.y:undefined);
          if(config.settleScrollSelector){
            let previous:number|undefined,stable=0;
            for(let attempt=0;attempt<30;attempt++){
              const x=await page.locator(config.settleScrollSelector).evaluate(n=>n.scrollLeft);
              stable=x===previous?stable+1:0;previous=x;
              if(stable>=2)break;
              await page.waitForTimeout(100);
            }
            if(stable<2)throw Error('Scroll action did not settle');
          }
        }

        phase='destination-rendered-readiness';const renderedReadiness=await waitSourceRenderedReadiness(page,project,15000);

        phase='post-ready';if(config.postReady)await page.locator(config.postReady).waitFor({state:'visible',timeout:15000});

        phase='post-absent';if(config.postAbsent)await page.locator(config.postAbsent).waitFor({state:'detached',timeout:15000});

        phase='post-hidden';if(config.postHidden)await page.locator(config.postHidden).waitFor({state:'hidden',timeout:15000});

        phase='destination-validation';const expectedFinal=new URL(config.expectedFinalPath||config.sourcePath,project.sourceUrl);
        if(page.url()!==expectedFinal.href)throw Error('Planning action ended at an unexpected destination');
        await assertSourceUnblocked(page,project);
        phase='font-readiness';await page.waitForFunction("document.fonts.status === 'loaded'",null,{timeout:15000});
        phase='destination-image-preparation';await prepareImages();
        if(config.postReady&&!await page.locator(config.postReady).isVisible())throw Error('Planning postcondition disappeared while preparing destination images');
        await assertCaptureContext(page,config.contextNormalization);
        // Capture unmodified source markup before capture-only animation projection.
        const snapshotSourceDom=async()=>config.captureStructure?await snapshotPublicCommerceDom(page,config.components):null;

        const inspectorNaturalContent=await prepareNaturalContentRendering(page);
        const observedImageReadiness=await prepareObservedImages(page,Object.values(config.components),15000);
        phase='source-dom-snapshot';let sourceDom=await snapshotSourceDom();
        const sessionPolicy=sourceSessionPolicy(project);
        const destinationAnimationEnvironment=await animationContext(page,config.infiniteAnimations||'running',config.rasterizeInfiniteFrameZero===true);
        const isolatedContext=await observeSourceContext(page,project.sourceUrl,sourceContext);
        const captureEnvironment={publicCommerceViewport:await publicCommerceViewportProof(page),observedImageReadiness,naturalContentRendering:inspectorNaturalContent,...(isolatedContext?{sourceContext:isolatedContext}:{}),mediaAssetKinds:mediaAssetKinds(project),renderedReadiness,...privacy,...destinationAnimationEnvironment,animations:[...initialAnimationEnvironment.animations,...destinationAnimationEnvironment.animations],initialFrameNormalizedBeforeActions:true,...(sessionPolicy?{sourceSessionCurrent:true,sourceSessionPolicySha256:sessionPolicy}:{})};
        phase='component-stability';let observation:any,previous='',stable=0;
        for(let attempt=0;attempt<30;attempt++){
          observation=await page.evaluate(`(${OBSERVE})(${JSON.stringify({selectors:config.components,mediaKinds:mediaAssetKinds(project),topologies:Object.fromEntries(Object.keys(config.components).map(id=>[id,config.topology||'physical']))})})`);
          const signature=canonical(observation.components);
          stable=signature===previous?stable+1:0;previous=signature;
          if(stable>=2)break;
          await page.waitForTimeout(100);
        }
        if(stable<2)throw Error('Planning component measurements did not stabilize');
        if(sourceDom){
          const after=await page.evaluate(selectors=>Object.fromEntries(Object.entries(selectors).map(([id,selector])=>{const n=document.querySelector(selector as string),copy=n?.cloneNode(true) as Element|undefined;copy?.querySelectorAll('script,style,noscript,template').forEach(n=>n.remove());return[id,n?{text:n.matches('script,style,noscript,template')?'':copy?.textContent?.trim().replace(/\s+/g,' '),classes:n.getAttribute('class'),children:n.childElementCount}:null]})),config.components);
          if(canonical(sourceDom.componentSignatures)!==canonical(after))throw Error('Source composition changed after its DOM snapshot; recapture the settled state');
        }
         phase='source-readiness';await assertNoPrivateSourceIdentity(page,project);
         await waitSourceReadiness(page,project,15000);

        phase='video-frame-projection';videoProjection=await projectVideoCaptureFrame(page,project,config.videoFrameCapture);
        const stableViewport=await stableViewportScreenshot(page,evidenceRoot,project);
        const screenshot=await saveArtifact(evidenceRoot,stableViewport.image,'png');
        // Compositor commits can settle an animated element's overflow extent
        // after its visible pixels are already stable. Sample that extent at
        // the captured frame; text, topology and other geometry must stay fixed.
        const frameObservation:any=await page.evaluate(`(${OBSERVE})(${JSON.stringify({selectors:config.components,mediaKinds:mediaAssetKinds(project),topologies:Object.fromEntries(Object.keys(config.components).map(id=>[id,config.topology||'physical']))})})`);
        const withoutExtent=(components:any)=>Object.fromEntries(Object.entries<any>(components).map(([id,{scrollWidth,...rest}])=>[id,rest]));
        if(canonical(withoutExtent(observation.components))!==canonical(withoutExtent(frameObservation.components)))throw Error('Planning component state changed before the stable viewport frame');
        observation=frameObservation;

         phase='full-page-capture';const fullPageCapture=await captureFullPagePreservingLayout(page);
         const fullPage=await saveArtifact(evidenceRoot,fullPageCapture.image,'png');await videoProjection?.restore();
         await assertSourceReadiness(page,project);
        // A state can disappear during image decoding or stable-pixel sampling.
        // Never bind measurements of one state to screenshots of another.
        if(config.postReady&&!await page.locator(config.postReady).isVisible())throw Error('Planning postcondition disappeared during capture');
        if(config.postAbsent&&await page.locator(config.postAbsent).count())throw Error('Planning absent postcondition changed during capture');
        if(config.postHidden&&await page.locator(config.postHidden).isVisible())throw Error('Planning hidden postcondition changed during capture');
          await assertCaptureContext(page,config.contextNormalization);
        phase='final-component-validation';const finalObservation:any=await page.evaluate(`(${OBSERVE})(${JSON.stringify({selectors:config.components,mediaKinds:mediaAssetKinds(project),topologies:Object.fromEntries(Object.keys(config.components).map(id=>[id,config.topology||'physical']))})})`);
        if(canonical(observation.components)!==canonical(finalObservation.components)){
          const postCaptureGeometry=await page.evaluate(selectors=>({root:{innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,bodyHeight:document.body.getBoundingClientRect().height,scrollX,scrollY},gutters:selectors.flatMap<any>(selector=>{try{return[...document.querySelectorAll<HTMLElement>(selector)].map(n=>{const r=n.getBoundingClientRect(),css=getComputedStyle(n);return{selector,x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:n.clientWidth,clientHeight:n.clientHeight,scrollWidth:n.scrollWidth,scrollLeft:n.scrollLeft,gutter:n.offsetHeight-n.clientHeight-parseFloat(css.borderTopWidth)-parseFloat(css.borderBottomWidth),overflowX:css.overflowX,children:[...n.children].map(c=>{const r=c.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})};});}catch{return[{selector,unavailable:true}];}})}),fullPageCapture.environment.nativeGridGutters.map((g:any)=>g.selector));
          const change=await saveArtifact(evidenceRoot,{kind:'planning-state-changed-during-capture',before:observation.components,after:finalObservation.components,screenshot,fullPage,fullPageGeometry:fullPageCapture.environment,postCaptureGeometry});
          throw Error(`Planning component state changed during screenshot capture; diagnostic ${change.path}`);
        }
        // Bind markup/currentSrc to the actual final frame, including image error fallbacks.
        sourceDom=await snapshotSourceDom();
        const queryPolicy=sourceReadQueryPolicy(project,expectedFinal.pathname+expectedFinal.search);
        phase='save-evidence';await observeSourceContext(page,project.sourceUrl,sourceContext);const data={kind:'planning-observation-not-acceptance',sourceUrl:project.sourceUrl,requestedUrl,finalUrl:page.url(),status:response?.status(),viewport,capturedAt:new Date().toISOString(),selectors:config.components,...observation as any,captureEnvironment:{...captureEnvironment,scrollbarEnvironment:await observeScrollbarEnvironment(page,project,!usesExistingChrome(project)),fullPageGeometry:fullPageCapture.environment,...(videoProjection?{videoFrameCapture:videoProjection.proof}:{}),...(stableViewport.proof?{viewportPixelStability:stableViewport.proof}:{}),browserContext:await observeBrowserContext(page),connectionMode:sourceContext?'isolated-guest':lease.attached?'existing-chrome':'isolated',...(queryPolicy?{sourceReadQueryPolicySha256:queryPolicy}:{}),browserArgs,imagePreparation:config.preloadImages?'decode-observed-images-and-restore-loading-attributes':'none'},blockedRequests,admittedQueries,actionLog,screenshot,fullPage};
        const evidence=await saveArtifact(evidenceRoot,data),prefix=relative(root,evidenceRoot).replaceAll('\\','/');
        const structure=sourceDom?await saveArtifact(root,{...sourceDom,...privacy,kind:'reconnaissance-not-acceptance',requestedPath:expectedFinal.pathname+expectedFinal.search,viewport,viewportSize:observation.viewportSize,state:config.inspectionId||'planning-inspection',status:response?.status(),capturedAt:data.capturedAt,...(isolatedContext?{sourceContext:isolatedContext}:{}),...(sessionPolicy?{sourceSessionCurrent:true,sourceSessionPolicySha256:sessionPolicy}:{}),...(queryPolicy?{sourceReadQueryPolicySha256:queryPolicy}:{}),via:{initialPath:config.sourcePath,actionLog},componentObservation:{...evidence,path:prefix+'/'+evidence.path},screenshot:{...fullPage,path:prefix+'/'+fullPage.path}}):undefined;
        rows.push({viewport,passed:true,evidence,...(structure?{structure}:{})});
       }catch(error){
        const failureStage:any={phase,elapsedMs:Date.now()-attemptStarted,navigationStatus};
        // Only public page identity and locator state; no input/query values,
        // headers, storage, response bodies, or whole-page text are recorded.
        if(diagnosticPage&&!diagnosticPage.isClosed()){
          const page=diagnosticPage;
          try{const url=new URL(page.url());failureStage.page={origin:url.origin,pathname:url.pathname,queryKeys:[...url.searchParams.keys()],...await page.evaluate(()=>({title:document.title.slice(0,512),publicH1:[...document.querySelectorAll('h1')].slice(0,3).map(n=>(n as HTMLElement).innerText.slice(0,512))}))};}catch{/* Preserve the original failure when no document is available. */}
          failureStage.locators={};
          for(const [name,selector]of Object.entries({ready:config.ready||'h1',postReady:config.postReady})){
            if(typeof selector!=='string')continue;
            try{const locator=page.locator(selector),count=await locator.count();failureStage.locators[name]={count,firstVisible:count>0?await locator.first().isVisible():false};}catch{failureStage.locators[name]={unavailable:true};}
          }
        }
        const diagnostic=await saveArtifact(evidenceRoot,{kind:'failed-planning-attempt-not-acceptance',viewport,error:safeBrowserError(error),failureStage,...((error as any)?.sourceScreenshotGeometryDiagnostic?{screenshotGeometry:(error as any).sourceScreenshotGeometryDiagnostic}:{}),...((error as any)?.sourceRenderedReadinessDiagnostic?{renderedReadiness:(error as any).sourceRenderedReadinessDiagnostic}:{}),actionLog,blockedRequests});rows.push({viewport,passed:false,error:safeBrowserError(error),diagnostic});}
      finally{try{await videoProjection?.restore();}finally{try{if(diagnosticPage&&!diagnosticPage.isClosed())await restoreNaturalContentRendering(diagnosticPage);}finally{await lease.close();}}}
    }
    const report={kind:'planning-observation-not-acceptance',sourcePath:config.sourcePath,rows,passed:rows.every(r=>r.passed)};
    await writeJson(join(evidenceRoot,config.sourcePath==='/'?'component-inspection.json':`component-inspection-${digest(config.sourcePath).slice(0,12)}.json`),report);return report;
  }finally{await browser?.close();}
}

/** Observe actual public resource URLs from existing source pages without navigation or storage access. */
export async function inspectSourceResources(projectFile:string,paths:string[],options?:{includeModuleScripts?:boolean}){
 const root=dirname(resolve(projectFile)),project=await jsonFile(projectFile),origin=new URL(project.sourceUrl).origin;
 if(!Array.isArray(paths)||!paths.length||paths.some(path=>typeof path!=='string'||!/^\/(?!\/)/.test(path)||/[?#\\\x00-\x20]/.test(path)||new URL(path,origin).pathname!==path))throw Error('Resource paths must be exact same-origin paths without query or fragment');
 if(!usesExistingChrome(project))throw Error('Existing Chrome source connection is required for resource observations');
 const browser=await openSourceBrowser(project);
 try{
  const lease=await browser.createContext({});
  const rows:any[]=[];
  for(const page of lease.context.pages()){
   let url:URL;try{url=new URL(page.url());}catch{continue;}if(url.origin!==origin)continue;
   const resources=await page.evaluate(({origin,paths,includeModuleScripts})=>{
    const modules=new Set<string>();
    return performance.getEntriesByType('resource').filter(entry=>{
     const url=new URL(entry.name,location.href);if(url.origin!==origin)return false;
     if(paths.includes(url.pathname))return true;
     if(!includeModuleScripts||url.search||url.hash||!/^\/_nuxt\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.js$/.test(url.pathname)||modules.has(url.href))return false;
     modules.add(url.href);return modules.size<=200;
    }).map(entry=>({resourceUrl:entry.name,startTime:entry.startTime,duration:entry.duration}));
   },{origin,paths,includeModuleScripts:options?.includeModuleScripts===true});
   rows.push({sourcePage:page.url(),resources});
  }
  const record={kind:'planning-public-source-resources-not-acceptance',sourceOrigin:origin,paths,...(options?.includeModuleScripts?{includeModuleScripts:true,moduleScriptLimit:200,moduleScriptSelection:'same-origin /_nuxt/*.js without query/hash; observed performance entries only'}:{}),rows,observedAt:new Date().toISOString()};
  const evidenceRoot=join(root,'verification/recon-current'),evidence=await saveArtifact(evidenceRoot,record);
  return{...record,evidence};
 }finally{await browser.close();}
}

export async function guardContext(context: Pick<BrowserContext,'route'>|Pick<Page,'route'>, sourceOrigin: string, side: Side,blockedRequests?:any[],project?:any,admittedQueries?:any[],targetMediaNavigationUrls:string[]=[],isolatedGuest=false) {
  // Source browsing is read-only: never submit storefront, email, analytics or cart requests.
  await context.route("**/*", async route => {
    const request = route.request();
    if(side==='source'&&isolatedGuest&&['fetch','xhr'].includes(request.resourceType())&&request.method()!=='GET'){if(blockedRequests&&blockedRequests.length<100)blockedRequests.push({method:request.method(),reason:'isolated-guest-api-get-only',type:request.resourceType()});return route.abort('blockedbyclient');}
    const mutation=side==='source'?sourceUrlMutationReason(request.url()):null;
    if(mutation){if(blockedRequests&&blockedRequests.length<100)blockedRequests.push({method:request.method(),reason:mutation,type:request.resourceType()});return route.abort('blockedbyclient');}
    if (side === "source" && !sourceSafeMethod(request.method())) {
      // The manually established source session may renew through its existing
      // SDK. Reuse the exact policy used by sourceStorage; never allow sign-in,
      // signup, password or arbitrary source writes through this exception.
      if(project&&!request.isNavigationRequest()&&['fetch','xhr'].includes(request.resourceType())&&
        new URL(request.frame().url()).origin===sourceOrigin&&isSourceSessionRefresh(request.method(),request.url(),project))
        return route.continue();
      const admitted=project?admittedSourceReadQuery(project,{method:request.method(),url:request.url(),frameUrl:request.frame().url(),payload:request.postData()||'',navigation:request.isNavigationRequest(),resourceType:request.resourceType()}):null;
      if(admitted){if(admittedQueries&&admittedQueries.length<100)admittedQueries.push({...admitted,admittedAt:new Date().toISOString()});return route.continue();}
      if(blockedRequests&&blockedRequests.length<100){const u=new URL(request.url());blockedRequests.push({method:request.method(),origin:u.origin,path:u.pathname.split('/').map(s=>/^[\w-]{24,}$/.test(s)?'[opaque]':s).join('/'),type:request.resourceType(),...(u.pathname==='/auth/v1/token'?{grantType:u.searchParams.get('grant_type')}:{} )});}
      return route.abort("blockedbyclient");
    }
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.origin !== sourceOrigin && !(side==='target'&&request.method()==='GET'&&targetMediaNavigationUrls.includes(url.href))) return route.abort("blockedbyclient");
    await route.continue();
  });
}

async function hoverFailureDiagnostic(page:Page,selector:string,error:unknown){
 const actionability:any[]=[];for(const line of (error instanceof Error?error.message:'').split('\n')){
  if(/intercepts pointer events/.test(line)){const node=line.match(/<([a-zA-Z][\w-]*)\b([^>]*)>/),classes=node?.[2].match(/class=["']([^"']*)["']/);actionability.push({state:'pointer-intercept',tag:node?.[1]||null,className:classes?.[1]||null});}
  else for(const[state,pattern]of Object.entries({'outside-viewport':/outside of the viewport/,'not-visible':/not visible/,'not-stable':/not stable/,'visible-and-stable':/element is visible and stable/,'scrolling-into-view':/scrolling into view/,'done-scrolling':/done scrolling/,'retry-hover':/retrying hover/}))if(pattern.test(line)){actionability.push({state});break;}
 }
 const geometry=await page.evaluate<any>(String.raw`((selector)=>{const nodes=[...document.querySelectorAll(selector)];
  const rect=(n)=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left};};
  const describe=(n)=>n?{tag:n.tagName.toLowerCase(),className:n.getAttribute('class')||''}:null;
  const scroll=(n)=>n?{...describe(n),clientWidth:n.clientWidth,clientHeight:n.clientHeight,scrollWidth:n.scrollWidth,scrollHeight:n.scrollHeight,scrollLeft:n.scrollLeft,scrollTop:n.scrollTop,rect:rect(n)}:null;
  return{viewport:{innerWidth,innerHeight,scrollX,scrollY,compatMode:document.compatMode},scrollingElement:scroll(document.scrollingElement),body:scroll(document.body),documentElement:scroll(document.documentElement),targets:nodes.slice(0,4).map(n=>{const r=n.getBoundingClientRect(),css=getComputedStyle(n),rawX=r.x+r.width/2,rawY=r.y+r.height/2,x=Math.max(0,Math.min(innerWidth-1,rawX)),y=Math.max(0,Math.min(innerHeight-1,rawY)),hit=document.elementFromPoint(x,y);return{...describe(n),rect:rect(n),styles:{display:css.display,visibility:css.visibility,opacity:css.opacity,position:css.position,pointerEvents:css.pointerEvents,zIndex:css.zIndex},point:{rawX,rawY,x,y,clamped:x!==rawX||y!==rawY},hit:describe(hit),targetContainsHit:!!hit&&(hit===n||n.contains(hit)),ancestors:[n.parentElement,n.parentElement?.parentElement,document.body,document.documentElement].filter((a,i,list)=>a&&list.indexOf(a)===i).map(a=>{const css=getComputedStyle(a);return{...scroll(a),position:css.position,overflowX:css.overflowX,overflowY:css.overflowY};})};})};
 })(`+JSON.stringify(selector)+`)`);
 return{selector,actionability:actionability.slice(-40),...geometry};
}

export async function perform(page: Page, action: SourceAction, side: Side, timeout: number, local: boolean, journal?:(row:any)=>Promise<void>,sourceOnly=false,project?:any,normalization?:any) {
  if(side==='source'){if(isIsolatedGuestPage(page))await observeSourceContext(page,project?.sourceUrl||page.url(),{mode:'isolated-guest'});beginSourceRenderedAction(page);}
  const row:any={action,op:action.op,status:'started',startedAt:new Date().toISOString()};
  if(journal)await journal(row);
  try{
  if (side === "source" && action.effect !== "read-only" || action.effect === "local-fixture" && !local) throw Error("Action requires an authorized platform adapter");
  if(action.op==='scroll-into-view'||action.op==='scroll-element'){
    if(side!=='source'||!sourceOnly)throw Error('Semantic source scroll requires explicit source-only plan');
    row.observation=await performSourceScroll(page,action,timeout);
  }
  else if(action.op==='visit'){
    const before=new URL(page.url()),path=side==='source'?action.expectedPath:action.expectedTargetPaths?.[local?'preflight':'online'];
    if(!path||!/^\/(?!\/)/.test(path)||/[\\\x00-\x20#]/.test(path))throw Error('needs-target: visit requires an explicit exact path for the current side/stage');
    const expected=new URL(path,before);if(expected.origin!==before.origin)throw Error('Visit must remain on the current origin');
    const guard=async(route:any)=>{const request=route.request();if(request.isNavigationRequest()&&request.frame()===page.mainFrame()&&new URL(request.url()).origin!==before.origin)await route.abort('blockedbyclient');else await route.fallback();};await page.route('**/*',guard);
    try{const response=await page.goto(expected.href,{waitUntil:'domcontentloaded',timeout});await assertRenderedEvidencePage(page,response,side);if(page.url()!==expected.href)throw Error('Visit final URL differs from its exact declared route');row.navigation={requestedUrl:expected.href,finalUrl:page.url(),status:response?.status()};if(side==='source'){row.renderedReadiness=await waitSourceRenderedReadiness(page,project||{sourceUrl:before.origin},timeout);row.navigation.finalUrl=page.url();if(page.url()!==expected.href)throw Error('Visit rendered final URL differs from its exact declared route');}if(normalization)row.contextNormalization=await normalizeCaptureContext(page,normalization);row.publicCommerceViewport=await preparePublicCommerceViewport(page,publicCommerceDomEnabled(project||{},action.expectedPath||expected.pathname+expected.search));}finally{await page.unroute('**/*',guard);}
  }
  else if(action.op==='history-back'||action.op==='history-forward'){
    const before=new URL(page.url()),path=side==='target'?(action.expectedTargetPaths?.[local?'preflight':'online']??action.expectedPath):action.expectedPath;
    if(!path||!/^\/(?!\/)/.test(path)||/[\\\x00-\x20#]/.test(path))throw Error('History action needs exact safe expectedPath');
    const expected=new URL(path,before);if(expected.origin!==before.origin)throw Error('History expected origin mismatch');
    const guard=async(route:any)=>{const request=route.request();if(request.isNavigationRequest()&&request.frame()===page.mainFrame()&&new URL(request.url()).origin!==before.origin)await route.abort('blockedbyclient');else await route.fallback();};
    await page.route('**/*',guard);
    try{if(action.op==='history-back')await page.goBack({timeout,waitUntil:'domcontentloaded'});else await page.goForward({timeout,waitUntil:'domcontentloaded'});const actual=new URL(page.url());if(actual.origin!==expected.origin||actual.pathname+actual.search!==expected.pathname+expected.search||actual.hash)throw Error('History destination differs from reviewed exact path');}
    finally{await page.unroute('**/*',guard);}
  }
  else if (action.op === "scroll") await page.evaluate(`window.scrollTo(0, ${Number(action.y)})`);
  else {
    const node = page.locator(action.selector!);
    if (await node.count() !== 1) throw Error("Action selector is missing or ambiguous");
    if (action.op === "click") await node.click({ timeout });
    else if (action.op === "fill") await node.fill(action.value!, { timeout });
    else if (action.op === "select") await node.selectOption(action.value!, { timeout });
    else if (action.op === "check") await node.check({ timeout });
    else if (action.op === "uncheck") await node.uncheck({ timeout });
    else if (action.op === "hover") await node.hover({ timeout });
    else if (action.op === "press") await node.press(action.value!, { timeout });
    else throw Error('Unsupported action operation');
  }
  if(action.waitAfter?.visible)await page.locator(action.waitAfter.visible).waitFor({state:'visible',timeout});
  if(action.waitAfter?.absent)await page.locator(action.waitAfter.absent).waitFor({state:'detached',timeout});
  if(action.waitAfter?.hidden)await page.locator(action.waitAfter.hidden).waitFor({state:'hidden',timeout});
  Object.assign(row,{status:'performed',result:'performed',endedAt:new Date().toISOString()});
  if(journal)await journal(row);
  return row;
  }catch(error){if(action.op==='hover'&&action.selector)try{row.hoverFailure=await hoverFailureDiagnostic(page,action.selector,error);}catch{row.hoverFailure={unavailable:true};}Object.assign(row,{status:'failed',result:'failed',endedAt:new Date().toISOString(),error:safeBrowserError(error)});if(journal)await journal(row);throw error;}
}

async function initializeRouteContext(page:Page,route:any,side:Side,timeout:number,local:boolean,journal?:(data:any)=>Promise<void>,project?:any){
 const policy=routeInitialContextPolicy(route);if(!policy){await preparePublicCommerceViewport(page,publicCommerceDomEnabled(project||{},route.states.initial.paths.source));return undefined;}
 const data:any={normalization:await normalizeCaptureContext(page,route.contextNormalization),publicCommerceViewport:await preparePublicCommerceViewport(page,publicCommerceDomEnabled(project||{},route.states.initial.paths.source)),actions:[]};if(journal)await journal(data);
 for(const action of route.initialActions?.[side]||[]){let index=-1;await perform(page,action,side,timeout,local,async row=>{if(index<0){index=data.actions.length;data.actions.push({...row});}else data.actions[index]={...row};if(journal)await journal(data);},false,project,route.contextNormalization);}
 initialContextPages.set(page,policy);return data;
}

async function capture(page: Page, ctx: CaptureContext, routeId: string, vp: string, stateId: string, side: Side, origin: string, buildId: string | null, stage:TargetStage,stylesheetMode=false): Promise<{ ref: Ref; value: Capture }> {
  const route = ctx.plan.routes[routeId], state = route.states[stateId], timeout = ctx.plan.limits.timeoutMs;
  const fieldPolicy=isSourceOnlyPlan(ctx.plan)?null:declaredStateFieldPolicy(route,stateId);
  const initialPolicy=routeInitialContextPolicy(route);if(initialPolicy&&initialContextPages.get(page)!==initialPolicy)throw Error('Initial context actions were not performed for this page');if(stateId==='initial')await assertCaptureContext(page,route.contextNormalization);
  const extended=!!fieldPolicy||side==='source'&&isSourceOnlyPlan(ctx.plan)&&'observer'in state&&state.observer===SOURCE_STATE_ADAPTER;
  if(side==='source'&&ctx.project.workflow?.sourceMediaReadiness?.schemaVersion===2&&!isSourceOnlyPlan(ctx.plan))throw Error('State-specific natural media adapter requires source-only plan');
  const mediaPolicy=side==='source'?stateMediaPolicy(ctx.project,state.paths.source,stateId):null;
  const targetState = () => bilateralPlan(ctx.plan).routes[routeId].states[stateId];
  let naturalContentProof:any;let screenshotRefs:Partial<Record<"viewport"|"fullPage",Ref>>={};let screenshotAnimationObserver:Awaited<ReturnType<typeof sourceScreenshotAnimationObserver>>|undefined;const screenshotAnimationStages:any[]=[];let screenshotStateChanges:any;let publicCommerceDomChanges:any;let videoProjection:any;let checkpoint='state-ready',observation:any,observationReadAt:string|undefined;
  const checkpoints:{checkpoint:string;enteredAt:string}[]=[];
  const enter=(name:string)=>{checkpoint=name;checkpoints.push({checkpoint,enteredAt:new Date().toISOString()});};
  const assertionDetails:any[]=[];
  const diagnosticAssertion=(a:any)=>({...a,...(a.status==='reading'?{status:'read-error'}:{}),...(['text','value'].includes(a.read)?{expected:'[redacted:text-or-input-value]',actual:a.status==='read'?'[redacted:text-or-input-value]':null,redacted:true}:{})});
  try{
  for(const spec of side === 'source' ? state.assertions.source : targetState().assertions.target)assertionDetails.push({...spec,actual:null,passed:null,status:'not-read'});
  enter('state-ready');
  const renderedReadiness=side==='source'?await waitSourceRenderedReadiness(page,ctx.project,timeout):undefined;
  if(side==='source'&&new URL(page.url()).href!==new URL(state.paths.source,origin).href)throw Error('Source rendered state final route differs from plan');
  await page.locator(side === 'source' ? state.ready.source : targetState().ready.target).waitFor({ state: "visible", timeout });
   enter('media');
   if(side==='source'&&(extended||mediaPolicy))await assertSourceUnblocked(page,ctx.project);
   const readinessPolicy=side==='source'?await waitSourceReadiness(page,ctx.project,timeout,stateId):null;
  enter('identity');
  if(side==='source')await assertSourceUnblocked(page,ctx.project);
  const privacy=side==='source'?await projectSourcePrivacy(page,ctx.project):{};
  enter('fonts');
  await page.waitForFunction("document.fonts.status === 'loaded'", null, { timeout });
  await preparePublicCommerceViewport(page,publicCommerceDomEnabled(ctx.project,state.paths.source));
  enter('stability');
  naturalContentProof=await prepareNaturalContentRendering(page);
  const observedImageReadiness=await prepareObservedImages(page,state.components.filter(cid=>route.components[cid].requiredFields.includes('images')).map(cid=>(route.components[cid].selectorsByViewport?.[vp]?.[side]||route.components[cid][side])!),timeout);
  const infiniteAnimations=ctx.plan.environment.infiniteAnimations||'running';
  const sessionPolicy=side==='source'?sourceSessionPolicy(ctx.project):null;
  const readQueryPolicy=side==='source'?sourceReadQueryPolicy(ctx.project,new URL(page.url()).pathname+new URL(page.url()).search):null;
  const isolatedContext=side==='source'?await observeSourceContext(page,ctx.plan.sourceUrl,route.sourceContext):undefined;
  const animationEnvironment={publicCommerceViewport:await publicCommerceViewportProof(page),observedImageReadiness,naturalContentRendering:naturalContentProof,...(isolatedContext?{sourceContext:isolatedContext}:{}),...(initialPolicy?{initialContextPolicySha256:initialPolicy}:{}),...(fieldPolicy?{declaredStateFields:fieldPolicy}:{}),mediaAssetKinds:mediaAssetKinds(ctx.project),scrollbarEnvironment:await observeScrollbarEnvironment(page,ctx.project,side==='target'||!usesExistingChrome(ctx.project)),...(renderedReadiness?{renderedReadiness}:{}),browserContext:await observeBrowserContext(page),...privacy,...await animationContext(page,infiniteAnimations,ctx.plan.environment.rasterizeInfiniteFrameZero===true),...(readinessPolicy?{sourceReadinessPolicySha256:readinessPolicy}:{}),...(sessionPolicy?{sourceSessionCurrent:true,sourceSessionPolicySha256:sessionPolicy}:{}),...(readQueryPolicy?{sourceReadQueryPolicySha256:readQueryPolicy}:{})};
  const expected = new URL(side==='target'?targetPathFor(targetState(),stage):state.paths.source, origin);
   const selectors:Record<string,string> = Object.fromEntries(state.components.map(cid => [cid, (route.components[cid].selectorsByViewport?.[vp]?.[side] || route.components[cid][side])!]));
  const topologies=Object.fromEntries(state.components.map(cid=>[cid,route.components[cid].topology||'physical']));
  const stockSpecs:Record<string,StockControlsSpec>=Object.fromEntries(state.components.filter(cid=>route.components[cid].stockControls).map(cid=>[cid,route.components[cid].stockControls!]));const stockFactsBefore=side==='source'&&Object.keys(stockSpecs).length?await readStockFacts(page,ctx.evidenceRoot,stockSpecs,undefined,ctx.project):null;const stockResponsesBefore=side==='source'?await readAvailableStockResponses(page,ctx.evidenceRoot,ctx.project):[];
  const observeStockFields=async(observed:any)=>{for(const [cid,spec]of Object.entries(stockSpecs))observed.components[cid].stockControls=await readStockControls(page,selectors[cid],spec,stockFactsBefore?.find(f=>f.component===cid)?.status,OBSERVE);};
  // Poll geometry stability; no fixed wait can turn an animation/loading state into evidence.
  let previous = "", stable = 0;
  for (let n = 0; n < 30; n++) {
    observation = await page.evaluate(`(${OBSERVE})(${JSON.stringify({ selectors,topologies,mediaKinds:mediaAssetKinds(ctx.project) })})`);
    await observeStockFields(observation);
    if(extended){const fields=await observeSourceFields(page,selectors);for(const cid of state.components)Object.assign(observation.components[cid],fields[cid]);}
    observationReadAt=new Date().toISOString();
    const signature = canonical({ components: observation.components, viewport: observation.viewportSize });
    stable = signature === previous ? stable + 1 : 0; previous = signature;
    if (stable >= 2) break;
    if(extended||mediaPolicy)await page.waitForFunction(start=>performance.now()>start,await page.evaluate(()=>performance.now()),{polling:'raf',timeout});else await page.waitForTimeout(100);
  }
  if (stable < 2) throw Error("Layout did not stabilize; recapture after diagnosing the component");
  enter('identity');
  const url = new URL(page.url());
  const identity = navigationIdentity.get(page);
  if (!identity || identity.status !== 200) throw Error('Missing/successless actual document response');
  const targetIdentity=side==='target'?await readTargetIdentity(page,ctx.project,stage,identity.buildId,buildId!):null;
  const rejection=renderedEvidenceRejection({status:identity.status,url:page.url(),title:await page.title(),visibleText:await page.locator('body').innerText()});
  if(rejection)throw Error(rejection);
  if (url.origin !== expected.origin || url.pathname + url.search !== expected.pathname + expected.search) throw Error(`Wrong state route: ${url.href}`);
  const canonicalError=stateCanonicalRejection(state,side,observation.canonical,page.url(),stage);
  if(canonicalError)throw Error(canonicalError);
  if (canonical(observation.viewportSize) !== canonical(ctx.plan.viewports[vp])) throw Error("Actual viewport differs from plan");
  const assertions = [];
  enter('assertions');
  for (const spec of assertionDetails) {
    const locator = page.locator(spec.selector); let actual: unknown;
    spec.status='reading';
    if (spec.read === "count") actual = await locator.count();
    else { const count=await locator.count();if (count !== 1) {Object.assign(spec,{status:'selector-error',actual:{matchedCount:count},passed:false});throw Error(`State assertion selector is missing/ambiguous: ${spec.selector}; matchedCount=${count}`);} actual = SOURCE_STATE_FIELDS.includes(spec.read as any) ? await readSourceAssertion(page,spec.selector,spec.read) : spec.read === "text" ? (await locator.innerText()).trim() : spec.read === "value" ? await locator.inputValue() : await locator.isVisible(); }
    Object.assign(spec,{actual,passed:canonical(actual)===canonical(spec.expected),status:'read',readAt:new Date().toISOString()});
    assertions.push({ passed: canonical(actual) === canonical(spec.expected), expected: spec.expected, actual });
  }
  if (assertions.some(a => !a.passed)) {const failed=assertionDetails.filter(a=>!a.passed).map(diagnosticAssertion);throw Error(`State postcondition failed: ${stateId}; ${failed.map(a=>`${a.selector} read=${a.read} expected=${JSON.stringify(a.expected)} actual=${JSON.stringify(a.actual)}`).join('; ')}`);}
  enter('screenshot');
  if(extended){screenshotAnimationObserver=await sourceScreenshotAnimationObserver(page,selectors);screenshotAnimationStages.push({phase:'before-viewport',animations:await screenshotAnimationObserver.sample()});}
  const observeScreenshotPhase=async(phase:string)=>{if(screenshotAnimationObserver)screenshotAnimationStages.push({phase,animations:await screenshotAnimationObserver.sample(),viewport:await page.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,bodyWidth:document.body.getBoundingClientRect().width,scrollX,scrollY,styleSheetCount:document.styleSheets.length}))});};
  const capturedAt = new Date().toISOString();
  const sourceStateMedia=mediaPolicy?await sampleStateMedia(page,mediaPolicy):null;
  if(mediaPolicy)verifyStateMediaProof(mediaPolicy,sourceStateMedia);
  const stylesheetProof=stylesheetMode?await captureLoadedStylesheets(page,ctx.evidenceRoot,{side,planSha256:ctx.planSha256,route:routeId,viewport:vp,state:stateId,capturedAt,finalUrl:page.url()}):undefined;
  const publicDomEnabled=side==='source'&&publicCommerceDomEnabled(ctx.project,url.pathname+url.search);
  const publicDomBefore=publicDomEnabled?await snapshotPublicCommerceDom(page,selectors):null;
  videoProjection=await projectVideoCaptureFrame(page,ctx.project,state.videoFrameCapture);
  const stableViewport=infiniteAnimations==='frame-zero'||viewportPixelPolicy(ctx.project)||videoProjection?await stableViewportScreenshot(page,ctx.evidenceRoot,ctx.project):{image:await page.screenshot({fullPage:false,animations:'allow'})};
  const screenshot = await saveArtifact(ctx.evidenceRoot,stableViewport.image,"png");screenshotRefs.viewport=screenshot;
  if(stableViewport.proof)Object.assign(animationEnvironment,{viewportPixelStability:stableViewport.proof});
  if(screenshotAnimationObserver)screenshotAnimationStages.push({phase:'after-viewport',animations:await screenshotAnimationObserver.sample()});
  const fullPageCapture=await captureFullPagePreservingLayout(page,extended?observeScreenshotPhase:undefined,extended);
  if(screenshotAnimationObserver)screenshotAnimationStages.push({phase:'after-fullpage',animations:await screenshotAnimationObserver.sample()});
  if(naturalContentProof?.count)Object.assign(fullPageCapture.environment.contentVisibilityPainting,{preparedBeforeMeasurement:naturalContentProof.count,measuredAfterNaturalRendering:true});
  const fullPage=await saveArtifact(ctx.evidenceRoot,fullPageCapture.image,"png");screenshotRefs.fullPage=fullPage;
  await videoProjection?.restore();
  Object.assign(animationEnvironment,{fullPageGeometry:fullPageCapture.environment,...(videoProjection?{videoFrameCapture:videoProjection.proof}:{})});
  if(stateId==='initial')await assertCaptureContext(page,route.contextNormalization);
  if(side==='source'){await assertSourceReadiness(page,ctx.project,stateId);await observeSourceContext(page,ctx.plan.sourceUrl,route.sourceContext);}
  if(mediaPolicy&&canonical(sourceStateMedia)!==canonical(await sampleStateMedia(page,mediaPolicy)))throw Error('State media/UI changed during screenshots');
  if((fullPageCapture.environment as any).finiteAnimationProtection||fullPageCapture.environment.longPageRaster||Object.keys(stockSpecs).length||stockResponsesBefore.length){const final:any=await page.evaluate(`(${OBSERVE})(${JSON.stringify({selectors,topologies,mediaKinds:mediaAssetKinds(ctx.project)})})`);await observeStockFields(final);if(extended){const fields=await observeSourceFields(page,selectors);for(const cid of state.components)Object.assign(final.components[cid],fields[cid]);}const changes=state.components.flatMap(cid=>route.components[cid].requiredFields.filter(field=>canonical(final.components[cid][field])!==canonical(observation.components[cid][field])).map(field=>({component:cid,field})));if(canonical(final.controls)!==canonical(observation.controls))changes.push({component:'document',field:'controls'});if(changes.length){screenshotStateChanges={kind:'post-protected-screenshot-required-field-differences',changes};throw Error('Required fields/controls changed during protected screenshot: '+changes.map(row=>row.component+'/'+row.field).join('; '));}}
  if(extended){const final=await observeSourceFields(page,selectors);const changes=sourceStateFieldDifferences(observation.components,final,state.components);if(changes.length){screenshotStateChanges={kind:'observed-post-screenshot-state-differences',readAt:new Date().toISOString(),changes};throw Error('Source viewport/UI state changed during screenshots: '+changes.map(row=>row.component+'/'+row.fields.join(',')).join('; '));}}
  Object.assign(animationEnvironment,...(extended?[{sourceStateObserver:SOURCE_STATE_ADAPTER}]:[]),...(sourceStateMedia?[{sourceStateMedia}]:[]));

  if(stylesheetMode){const finalStylesheetProof=await captureLoadedStylesheets(page,ctx.evidenceRoot,{side,planSha256:ctx.planSha256,route:routeId,viewport:vp,state:stateId,capturedAt,finalUrl:page.url()});if(finalStylesheetProof.sha256!==stylesheetProof!.sha256)throw Error('Loaded stylesheet bytes/order changed during screenshots');}
  let stockSnapshot:Ref|undefined;if(stockFactsBefore||stockResponsesBefore.length){const stockFactsAfter=stockFactsBefore?await readStockFacts(page,ctx.evidenceRoot,stockSpecs,stockFactsBefore,ctx.project):[];const stockResponsesAfter=await readAvailableStockResponses(page,ctx.evidenceRoot,ctx.project);if(stockFactsBefore&&canonical(stockFactsSemantics(stockFactsBefore))!==canonical(stockFactsSemantics(stockFactsAfter)))throw Error('Actual stock status changed during capture');stockSnapshot=await saveArtifact(ctx.evidenceRoot,{schemaVersion:1,kind:'captured-stock-snapshot',responsePath:stockSnapshotResponsePath(ctx.project),side:'source',planSha256:ctx.planSha256,route:routeId,viewport:vp,state:stateId,capturedAt,finalUrl:page.url(),before:{facts:stockFactsBefore||[],responses:stockResponsesBefore},after:{facts:stockFactsAfter,responses:stockResponsesAfter}});}
  let publicCommerceDom:Ref|undefined,productSnapshot:Ref|undefined;
  if(publicDomBefore){const finalDom=await snapshotPublicCommerceDom(page,selectors);if(canonical(finalDom)!==canonical(publicDomBefore)){const failureIdentity={kind:'failed-public-commerce-dom-not-capture',accepted:false,side,planSha256:ctx.planSha256,route:routeId,viewport:vp,state:stateId,capturedAt,finalUrl:page.url(),status:identity.status};publicCommerceDomChanges={before:await saveArtifact(ctx.evidenceRoot,{...publicDomBefore,...failureIdentity,phase:'before-screenshots'}),after:await saveArtifact(ctx.evidenceRoot,{...finalDom,...failureIdentity,phase:'after-screenshots'})};throw Error('Actual public commerce DOM changed during screenshots');}const captureIdentity={side,planSha256:ctx.planSha256,route:routeId,viewport:vp,state:stateId,capturedAt,finalUrl:page.url(),status:identity.status};publicCommerceDom=await saveArtifact(ctx.evidenceRoot,{...finalDom,schemaVersion:1,kind:'captured-public-commerce-dom',...captureIdentity,stylesheetProof});productSnapshot=await captureProductMetadata(page,ctx.evidenceRoot,ctx.project,captureIdentity);}
  const value: Capture = { schemaVersion: 2, collectorVersion: collectorFor(ctx.plan), planSha256: ctx.planSha256, buildId: side === "source" ? null : buildId, servedBuildId:targetIdentity?.buildId||null,...(targetIdentity?.proof?{targetIdentity:targetIdentity.proof}:{}), side, route: routeId, viewport: vp, state: stateId, capturedAt, requestedUrl: expected.href, finalUrl: page.url(), status: identity.status, ...observation, assertions, screenshot, fullPage,stylesheetProof,stockSnapshot,publicCommerceDom,productSnapshot,captureEnvironment:animationEnvironment };
  await verifyPublicCommerceCapture(ctx.evidenceRoot,ctx.project,value);
  return { value, ref: await saveArtifact(ctx.evidenceRoot, value) };
  }catch(error){
    // Only reuse measurements actually read before failure. Never re-read a
    // recovered state and present it as the failing instant. No body/controls,
    // text, image URLs or form values are persisted in this diagnostic.
    const fields=['visible','x','y','width','height','display','fontSize','lineHeight','fontFamily','overflowX','overflowY','parent','order','topologyMode','physicalParent','physicalOrder','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','gridTemplateColumns','flexDirection','scrollWidth','clientWidth','scrollLeft','tag','role','checked','disabled'];
    const components=observation?Object.fromEntries(state.components.filter(cid=>observation.components[cid]).map(cid=>{const value=observation.components[cid];return[cid,{...Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])),...(Array.isArray(value.images)?{images:value.images.map((image:any)=>({loaded:image.loaded}))}:{})}];})):null;
    const diagnosticUrl=(raw:string)=>{const url=new URL(raw);url.username='';url.password='';url.hash='';for(const key of [...url.searchParams.keys()])url.searchParams.set(key,'[redacted]');return url.href;};
    const safeError=safeBrowserError(error).replace(/https?:\/\/[^\s)]+/g,raw=>{try{return diagnosticUrl(raw);}catch{return '[redacted-url]';}}).replace(/(?:set-cookie|cookie|authorization):[^\r\n]*/gi,'[redacted-header]');
    // Retained buffers from explicitly declared public GET observers, not a new page/network sample.
    const observedPublicResponses=side==='source'?await (async()=>{const result:any={};for(const [kind,read]of [['stock',()=>readAvailableStockResponses(page,ctx.evidenceRoot,ctx.project)],['products',()=>readObservedProductResponses(page,ctx.evidenceRoot)]] as const){try{const responses=await read();result[kind]={count:responses.length,responses};}catch(cause){result[kind]={unavailable:true,error:safeBrowserError(cause)};}}try{const audit=await readStockResponseAudit(page,ctx.evidenceRoot);result.stockAudit={...audit,currentCount:audit.current.length,priorCount:audit.prior.length};}catch(cause){result.stockAudit={unavailable:true,error:safeBrowserError(cause)};}return result;})():undefined;
    const diagnostic={kind:'failed-state-diagnostic-not-capture',accepted:false,screenshotRefs,...(observedPublicResponses?{observedPublicResponses}:{}),publicCommerceViewport:await publicCommerceViewportProof(page),...(publicCommerceDomChanges?{publicCommerceDomChanges}:{}),...(screenshotAnimationStages.length?{screenshotAnimationStages}:{}),...(screenshotStateChanges?{screenshotStateChanges}:{}),...((error as any)?.sourceScreenshotGeometryDiagnostic?{screenshotGeometry:(error as any).sourceScreenshotGeometryDiagnostic}:{}),...((error as any)?.sourceRenderedReadinessDiagnostic?{renderedReadiness:(error as any).sourceRenderedReadinessDiagnostic}:{}),route:routeId,viewport:vp,state:stateId,side,checkpoint,checkpoints,failedAt:new Date().toISOString(),error:safeError,actualUrl:diagnosticUrl(page.url()),urlQueryValuesRedacted:true,observation:components?{kind:'pre-failure-measurement',readAt:observationReadAt,components}:null,observationUnavailable:components?null:'No successful component measurement was read before failure; no after-failure sampling attempted',assertions:assertionDetails.map(diagnosticAssertion)};
    let ref:Ref;
    try{ref=await saveArtifact(ctx.evidenceRoot,diagnostic);}catch(persistenceError){throw Error(`Formal capture failed at ${checkpoint}: ${safeError}; diagnostic persistence failed: ${safeBrowserError(persistenceError)}`);}
    throw Error(`Formal capture failed at ${checkpoint}: ${safeError}; failed-state diagnostic ${ref.path}`);
  }finally{try{await videoProjection?.restore();}finally{await screenshotAnimationObserver?.close();}}
}

export async function collect(projectFile: string, stage: "source" | "preflight" | "online",options:{reuse?:SourceReuseSpec;sourceBaseline?:boolean}={}) {
  if(options.sourceBaseline&&stage==='source')throw Error('Source baseline is only for paired target capture');
  if(options.reuse&&stage!=='source')throw Error('Source reuse only applies to global source collection');
  if(isSourceOnlyPlan((await loadScopedPlan(projectFile)).plan))throw Error('Source-only plan cannot enter global capture/preflight/online; use a reviewed source-scope');
  const ctx = await loadPlan(projectFile), ready = await recordGate(projectFile, "plan");
  if (!ready.passed) throw Error(`Plan not ready (${ready.findings.length} findings); see plan-report.json`);
  const result=await collectWithContext(projectFile,stage,ctx,options);if('scopeComplete'in result)throw Error('Unexpected scoped report in global collector');return result;
}
export async function collectSourceScope(projectFile:string,scopeFile:string){const result=await collectWithContext(projectFile,'source',await prepareSourceScope(projectFile,scopeFile));if(!('scopeComplete'in result))throw Error('Scoped collector returned a global report');return result;}
async function collectWithContext(projectFile:string,stage:'source'|'preflight'|'online',ctx:ScopedContext,options:{reuse?:SourceReuseSpec;sourceBaseline?:boolean}={}){
  if(isSourceOnlyPlan(ctx.plan)&&(stage!=='source'||!ctx.sourceScope))throw Error('Source-only plan requires an explicit reviewed source scope; target/global capture forbidden');
  if(stage!=='source')bilateralPlan(ctx.plan);
  const targetOrigin = stage === "online" ? ctx.project.workflow?.onlineOrigin : ctx.project.workflow?.localOrigin;
  let targetStoreId:string|undefined;
  if (stage !== "source" && !targetOrigin) throw Error("Project must declare the exact target origin");
  if (stage === "preflight" && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(targetOrigin).hostname)) throw Error("Preflight target must be local");
  if (stage === "online") {
    const deployment = await jsonFile(join(ctx.evidenceRoot, "deployment.json"));
    targetStoreId=String(deployment.store);
    if (deployment.role !== "draft" || !deployment.skinId || new URL(targetOrigin).origin !== deployment.origin || ctx.project.workflow?.mediaAssetStoreId&&String(deployment.store)!==String(ctx.project.workflow.mediaAssetStoreId) || ctx.project.workflow?.mediaAssetSkinId&&String(deployment.skinId)!==String(ctx.project.workflow.mediaAssetSkinId)) throw Error("Online capture needs an identified draft skin");
  }
  const build = stage === "source" ? null : await buildIdentity(ctx.output!);
  if(build)await verifyMediaDelivery(ctx.projectRoot,ctx.project,build.manifest,stage==='online');
  const inventory = JSON.parse((await readRef(ctx.projectRoot, ctx.plan.inventory)).toString());
  const stylesheetContract=stage==='source'?undefined:ctx.project.pageContractsFile?await jsonFile(await contained(ctx.projectRoot,ctx.project.pageContractsFile)).catch(()=>undefined):undefined;const stylesheetMode=requiresVerifiedStylesheetProof(ctx.project,stylesheetContract);
  const mediaAssets=stage!=='source'&&(usesMediaComparison(bilateralPlan(ctx.plan))||Object.values<any>(inventory.routes).some(r=>r.disposition==='mapped-media'||r.dataAssertions?.some((a:any)=>a.field==='hero')))?await loadVerifiedMediaAssets(ctx.projectRoot,ctx.project,stage,ctx.output):undefined;
  const baseline=options.sourceBaseline?await prepareSourceBaseline(projectFile,{...ctx,plan:bilateralPlan(ctx.plan)},build!.id):null;
  const evidence: Evidence = { schemaVersion: 2, stage, planSha256: ctx.planSha256, buildId: build?.id || null, collectorVersion: collectorFor(ctx.plan),...(baseline?{sourceBaseline:baseline.proof}:{}),...(ctx.sourceScope?{scope:{kind:'source-capture-only' as const,intentSha256:ctx.sourceScope.intentSha256,...(isSourceOnlyPlan(ctx.plan)?{planMode:'source-only-v1',role:'source-only'}:{})}}:{}), sessions: [], navigation: [], capturedAt: new Date().toISOString() };
  const reusable=options.reuse?await prepareSourceReuse({...ctx,plan:bilateralPlan(ctx.plan)},options.reuse):null;
  let storageState = baseline?undefined:await sourceStorage(ctx.project);
  const browser = stage!=='source'||!usesExistingChrome(ctx.project)?await chromium.launch(ownedHeadlessOptions(ctx.project)):undefined;
  const sourceBrowser=baseline?undefined:await openSourceBrowser(ctx.project,browser).catch(async error=>{await browser?.close();throw error;});
  try {
    const pendingSessions=()=>Object.keys(ctx.plan.routes).flatMap(route=>Object.keys(ctx.plan.viewports).map(viewport=>({route,viewport}))).filter(p=>!evidence.sessions.some(session=>session.route===p.route&&session.viewport===p.viewport&&sourceSessionComplete(ctx.plan,session)));
    sourceSessions: for (const [rid, route] of Object.entries(ctx.plan.routes)) for (const [vp, viewport] of Object.entries(ctx.plan.viewports)) {
      if(stage==='source'&&await sourcePauseRequested(ctx.evidenceRoot)){evidence.stopped={kind:'manual-pause',route:rid,viewport:vp,flag:'source.pause',pendingSessions:pendingSessions()};await writeJson(join(ctx.evidenceRoot,ctx.sourceScope?'source-scope.json':stage+'.json'),evidence);break sourceSessions;}
      const reused=reusable?.sessions.get(sourceSessionKey(rid,vp));if(reused){evidence.sessions.push(reused);await writeJson(join(ctx.evidenceRoot,'source.json'),evidence);continue;}
      if(!baseline&&!sourceStorageCurrent(ctx.project,storageState))storageState=await sourceStorage(ctx.project);
      const session: Session = { route: rid, viewport: vp, checks: [], errors: [] }; evidence.sessions.push(session);
      const contexts: {close:()=>Promise<void>}[] = [], pages: Partial<Record<Side, Page>> = {};
      const sides: Side[] = stage === "source" ? ["source"] : baseline?["target"]:["source", "target"];
      const baselineSession=baseline?.session(rid,vp);
      const initialLog:any={policySha256:routeInitialContextPolicy(route)};if(baselineSession?.initialContextLog){const original=JSON.parse((await readRef(ctx.evidenceRoot,baselineSession.initialContextLog)).toString());initialLog.source=original.source;}
      const checkpoint=async()=>{if(stage==='source'){if(pages.source&&sourceProtectionResponses.has(pages.source))throw Error('Source API protection response observed');if(await sourcePauseRequested(ctx.evidenceRoot))throw new SourcePauseRequested();}};
      try {
        for (const side of sides) {
          const origin = side === "source" ? ctx.plan.sourceUrl : targetOrigin;
          const options={viewport,locale:ctx.plan.environment.locale,timezoneId:ctx.plan.environment.timezoneId,serviceWorkers:'block' as const,...(side==='source'?{storageState}:{})};
          const lease=side==='source'?(route.sourceContext?await createIsolatedGuestContext(ctx.project,{viewport,locale:ctx.plan.environment.locale,timezoneId:ctx.plan.environment.timezoneId}):await sourceBrowser!.createContext(options)):null;
          const context=lease?.context||await browser!.newContext(options);contexts.push(lease||context);
          const page=lease?await lease.newPage():await context.newPage();pages[side]=page;if(side==='source'){if(stockSnapshotResponsePath(ctx.project))observeStockAvailability(page,stockSnapshotResponsePath(ctx.project)!);observeProductMetadata(page,ctx.project);}if(stylesheetMode)observeLoadedStylesheets(page);await installVideoCaptureAudioGuard(page,ctx.project);
          await guardContext(lease?.attached?page:context,new URL(origin).origin,side,undefined,side==='source'?ctx.project:undefined,undefined,[],side==='source'&&!!route.sourceContext);
          if(lease?.attached){const actual=await observeBrowserContext(page);if(actual.locale!==ctx.plan.environment.locale||actual.timezoneId!==ctx.plan.environment.timezoneId)throw Error('Existing Chrome environment differs from plan: '+actual.locale+' / '+actual.timezoneId);}
          page.on('response', response=>{if(response.request().isNavigationRequest() && response.frame()===page.mainFrame())navigationIdentity.set(page,{status:response.status(),buildId:response.headers()['x-site2shop-build'] || null,cfMitigated:response.headers()['cf-mitigated']||null});if(side==='source'&&['fetch','xhr'].includes(response.request().resourceType())){const url=new URL(response.url()),status=response.status();if(url.origin===new URL(origin).origin&&(status===429||response.headers()['cf-mitigated']==='challenge'))sourceProtectionResponses.set(page,{reason:status===429?'http-429':'anti-bot-challenge',status,origin:url.origin,path:url.pathname.split('/').map(p=>/^[\w-]{24,}$/.test(p)?'[opaque]':p).join('/'),queryKeys:[...url.searchParams.keys()],detectedAt:new Date().toISOString()});}});
          if(side==='source')beginSourceRenderedAction(page);
          const response = await page.goto(new URL(side==='target'?targetPathFor(bilateralPlan(ctx.plan).routes[rid].states.initial,stage==='online'?'online':'preflight'):route.states.initial.paths.source, origin).href, { ...(side==='source'?sourceNavigationOptions(ctx.project):{waitUntil:'domcontentloaded' as const}), timeout: ctx.plan.limits.timeoutMs });
          if(side==='source')await waitSourceNavigation(page,ctx.project,ctx.plan.limits.timeoutMs);
          await assertRenderedEvidencePage(page, response, side);
          if(publicCommerceDomEnabled(ctx.project,route.states.initial.paths.source)){if(side==='source')await waitSourceRenderedReadiness(page,ctx.project,ctx.plan.limits.timeoutMs);await page.locator(side==='source'?route.states.initial.ready.source:bilateralPlan(ctx.plan).routes[rid].states.initial.ready.target).waitFor({state:'visible',timeout:ctx.plan.limits.timeoutMs});}
          await initializeRouteContext(page,route,side,ctx.plan.limits.timeoutMs,stage==='preflight',async data=>{initialLog[side]=data;session.initialContextLog=await saveArtifact(ctx.evidenceRoot,initialLog);},ctx.project);
        }
        const snapshot = async (state: string,baselineSource?:Ref) => {
          const refs: Partial<Record<Side, Ref>> = {}, values: Partial<Record<Side, Capture>> = {};
          for (const side of sides) { const item = await capture(pages[side]!, ctx, rid, vp, state, side, side === "source" ? ctx.plan.sourceUrl : targetOrigin, build?.id || null,stage==='online'?'online':'preflight',stylesheetMode); refs[side] = item.ref; values[side] = item.value; }
          if(baselineSession){const source=baselineSource||baselineSession.checks.find(c=>c.id==='state:'+state)!.before.source!;refs.source=source;values.source=JSON.parse((await readRef(ctx.evidenceRoot,source)).toString());}
          return { refs, values };
        };
        await checkpoint();
        let current = await snapshot("initial");
        session.checks.push({ id: "state:initial", kind: "state", before: current.refs,...(baselineSession?{sourceBaseline:baselineCheck(baselineSession.checks.find(c=>c.id==='state:initial')!)}:{}) });
        const stopOnDivergence = async (state: string, values: Partial<Record<Side, Capture>>) => {
          if (stage !== "source") { if(stylesheetMode)await verifyPairedStylesheetProof(ctx.projectRoot,ctx.project,bilateralPlan(ctx.plan),values.source!,values.target!,ctx.evidenceRoot);const errors = compareCaptures(bilateralPlan(ctx.plan), rid, state, values.source!, values.target!,inventory,stage==='online'?'online':'preflight',mediaAssets); if (errors.length) throw Error(`First divergence at ${state}: ${errors.join("; ")}`); }
        };
        await stopOnDivergence("initial", current.values);await checkpoint();
        for (const id of sequenceFor(route,vp)) {
          const edge = route.transitions[id], log: any = { from: edge.from, to: edge.to, input: edge.input };
          const attempt:any={kind:'transition-attempt-not-success-check',route:rid,viewport:vp,id,startedAt:new Date().toISOString(),status:'started',log};
          // Plan identifiers are not trusted as filesystem paths.
          const persist=()=>writeJson(join(ctx.evidenceRoot,'attempts',digest(canonical({rid,vp,id}))+'.json'),attempt);
          await persist();
          const before = current;const originalCheck=baselineSession?.checks.find(c=>c.id==='transition:'+id);if(originalCheck){const originalLog=JSON.parse((await readRef(ctx.evidenceRoot,originalCheck.actionLog!)).toString());log.source=originalLog.source;log.sourceMode='baseline-reused';}
          try{
             for (const side of sides) { log[side] = []; for (const action of actionsFor(edge,vp,side)) {
               let index=-1;
               if(side==='source'&&(action.op==='scroll-into-view'||action.op==='scroll-element'))await assertSourceUnblocked(pages[side]!,ctx.project);
              await perform(pages[side]!, action, side, ctx.plan.limits.timeoutMs, stage === "preflight",async row=>{if(index<0){index=log[side].length;log[side].push({...row});}else log[side][index]={...row};await persist();},isSourceOnlyPlan(ctx.plan),ctx.project,route.contextNormalization);
            } }
            current = await snapshot(edge.to,originalCheck?.after?.source);
            Object.assign(attempt,{status:'performed',endedAt:new Date().toISOString()});await persist();
          }catch(error){Object.assign(attempt,{status:'failed',endedAt:new Date().toISOString(),error:safeBrowserError(error)});await persist();throw error;}
          session.checks.push({ id: `transition:${id}`, kind: "transition", before: before.refs, after: current.refs, actionLog: await saveArtifact(ctx.evidenceRoot, log),...(originalCheck?{sourceBaseline:baselineCheck(originalCheck)}:{}) });
          if (!session.checks.some(c => c.id === `state:${edge.to}`)) session.checks.push({ id: `state:${edge.to}`, kind: "state", before: current.refs,...(baselineSession?{sourceBaseline:baselineCheck(baselineSession.checks.find(c=>c.id===`state:${edge.to}`)!)}:{}) });
          await stopOnDivergence(edge.to, current.values);await checkpoint();
        }
      } catch (error) { if(error instanceof SourcePauseRequested){evidence.stopped={kind:'manual-pause',route:rid,viewport:vp,flag:'source.pause',pendingSessions:pendingSessions()};await writeJson(join(ctx.evidenceRoot,ctx.sourceScope?'source-scope.json':stage+'.json'),evidence);}else{session.errors.push(String(error));
        if(pages.source){const identity=navigationIdentity.get(pages.source),protection=sourceProtectionResponses.get(pages.source)||await observeSourceProtection(pages.source,ctx.plan.sourceUrl,identity?.status,identity?.cfMitigated);if(protection){evidence.stopped={kind:'source-protection',route:rid,viewport:vp,protection,pendingSessions:pendingSessions()};await writeJson(join(ctx.evidenceRoot,ctx.sourceScope?'source-scope.json':stage+'.json'),evidence);}}
      }
      } finally { try{for(const page of Object.values(pages))if(page&&!page.isClosed())await restoreNaturalContentRendering(page);}finally{for (const context of contexts) await context.close();} }
      await writeJson(join(ctx.evidenceRoot, ctx.sourceScope?'source-scope.json':`${stage}.json`), evidence);
      if(evidence.stopped)break sourceSessions;
    }
    if (stage !== "source"&&!evidence.stopped) {
      for (const [path, mapping] of Object.entries<any>(inventory.routes)) if (["mapped","mapped-redirect","mapped-media"].includes(mapping.disposition)) for (const [vp, viewport] of Object.entries(ctx.plan.viewports)) {
        const expectedPath=mapping.disposition==='mapped-media'?mediaNavigationDestination(mapping,mediaAssets):mappedTargetPath(mapping,stage==='online'?'online':'preflight');
        const context = await browser!.newContext({ viewport }), page = await context.newPage();await installVideoCaptureAudioGuard(page,ctx.project);
        let row: any = { path, viewport: vp, status: 0, finalPath: "", canonical: null, passed: false };
        try {
          await guardContext(context,new URL(targetOrigin).origin,'target',undefined,undefined,undefined,mapping.disposition==='mapped-media'?[expectedPath!]:[]);
          page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())navigationIdentity.set(page,{status:response.status(),buildId:response.headers()['x-site2shop-build']||null,cfMitigated:response.headers()['cf-mitigated']||null})});
          let sourceLinkObserved=false,candidate: {capture:Capture;ref:Ref;selector:string}|undefined;
          for(const session of evidence.sessions.filter(s=>s.viewport===vp))for(const check of session.checks.filter(c=>c.kind==='state')){
            if(!check.before.source||!check.before.target)continue;
            const s:Capture=JSON.parse((await readRef(ctx.evidenceRoot,check.before.source)).toString()),t:Capture=JSON.parse((await readRef(ctx.evidenceRoot,check.before.target)).toString());
            const i=s.controls.findIndex(c=>c.href&&(mapping.disposition==='mapped-media'?new URL(c.href,s.finalUrl).href===mapping.media.sourceUrl:new URL(c.href,s.finalUrl).origin===new URL(ctx.plan.sourceUrl).origin&&new URL(c.href,s.finalUrl).pathname+new URL(c.href,s.finalUrl).search===path));
            if(i>=0)sourceLinkObserved=true;
            if(i>=0&&t.controls[i]?.href){candidate={capture:t,ref:check.before.target,selector:t.controls[i].selector};break;}
          }
          if(!candidate){if(!sourceLinkObserved&&mapping.directEntry){row={...row,...await captureUnavailableDirectEntry(page,ctx.evidenceRoot,ctx.projectRoot,ctx.project,evidence,path,vp,mapping,targetOrigin,expectedPath!,build!.id,stage==='online'?'online':'preflight',ctx.plan.limits.timeoutMs,baseline?(rid,vp)=>baseline.origin(rid,vp).planSha256:undefined)};}else throw Error('No observed source/target link to this route; add a navigation representative/state to the plan');}
          if(candidate){
          const spec=bilateralPlan(ctx.plan).routes[candidate.capture.route];
          await page.goto(new URL(targetPathFor(spec.states.initial,stage==='online'?'online':'preflight'),targetOrigin).href,{waitUntil:'domcontentloaded',timeout:ctx.plan.limits.timeoutMs});
          const initialRows=await initializeRouteContext(page,spec,'target',ctx.plan.limits.timeoutMs,stage==='preflight',undefined,ctx.project);if(initialRows)row.initialContextLog=await saveArtifact(ctx.evidenceRoot,{policySha256:routeInitialContextPolicy(spec),target:initialRows});
          if(candidate.capture.state!=='initial')for(const edgeId of sequenceFor(spec,vp)){const edge=spec.transitions[edgeId];for(const action of actionsFor(edge,vp,'target'))await perform(page,action,'target',ctx.plan.limits.timeoutMs,stage==='preflight');if(edge.to===candidate.capture.state)break;}
          const link=page.locator(candidate.selector),observedHref=await link.getAttribute('href');row.clickedAt=new Date().toISOString();
          if(mapping.disposition==='mapped-media'){
            if(!observedHref||new URL(observedHref,page.url()).href!==expectedPath)throw Error('Observed media link differs from verified destination');
            const responsePromise=context.waitForEvent('response',{predicate:r=>r.url()===expectedPath&&r.request().isNavigationRequest(),timeout:ctx.plan.limits.timeoutMs});
            const [response]=await Promise.all([responsePromise,link.click({timeout:ctx.plan.limits.timeoutMs})]),bytes=await response.body();
            const contentType=(response.headers()['content-type']||'').split(';')[0].trim().toLowerCase();
            if(response.status()!==200||digest(bytes)!==mapping.media.sha256||!mediaAssetKinds(ctx.project).some(kind=>contentType.startsWith(kind+'/')))throw Error('Clicked media response content/status differs');
            const destinationPage=response.frame().page();await destinationPage.waitForURL(expectedPath,{timeout:ctx.plan.limits.timeoutMs});
            row={...row,kind:'clicked-media',fromCapture:candidate.ref,selector:candidate.selector,observedHref,resourceUrl:response.url(),contentType,sourceSha256:mapping.media.sha256,bytes:await saveArtifact(ctx.evidenceRoot,bytes,'bin'),status:response.status(),finalPath:destinationPage.url(),passed:destinationPage.url()===expectedPath};
          }else{
          if(!observedHref||new URL(observedHref,page.url()).pathname+new URL(observedHref,page.url()).search!==expectedPath)throw Error('Observed link destination differs from route mapping');
          await link.click({timeout:ctx.plan.limits.timeoutMs});
          await page.waitForURL(u=>u.pathname+u.search===expectedPath,{timeout:ctx.plan.limits.timeoutMs});
          await page.waitForLoadState('domcontentloaded');
          const identity=navigationIdentity.get(page);
          if(identity?.status!==200)throw Error('Navigation reached wrong status');
          const verifiedIdentity=await readTargetIdentity(page,ctx.project,stage==='online'?'online':'preflight',identity.buildId,build!.id);
          const final = new URL(page.url()), canonicalUrl = await page.locator('link[rel="canonical"]').getAttribute("href").catch(()=>null);
          const body = await page.locator("body").innerText(), soft404 = /page not found|404 not found|outside .*scope/i.test(body);
          const rejection=renderedEvidenceRejection({status:identity.status,url:page.url(),title:await page.title(),visibleText:body});if(rejection)throw Error(rejection);
          const canonicalValid = !canonicalUrl || new URL(canonicalUrl, page.url()).pathname === final.pathname && new URL(canonicalUrl, page.url()).origin === final.origin;
          row = { ...row, kind:'clicked-link',fromCapture:candidate.ref,selector:candidate.selector,observedHref,servedBuildId:verifiedIdentity.buildId,...(verifiedIdentity.proof?{targetIdentity:verifiedIdentity.proof}:{}),screenshot:await saveArtifact(ctx.evidenceRoot,await page.screenshot(),'png'), status: identity.status, finalPath: final.pathname + final.search, canonical: canonicalUrl, soft404, canonicalValid,
            passed: final.origin === new URL(targetOrigin).origin && final.pathname + final.search === expectedPath && canonicalValid && !soft404 };
          }
          }
          if(mapping.dataAssertions){row.dataAssertions=await readNavigationData(page,ctx.projectRoot,ctx.project,path,mapping,stage==='online'?'online':'preflight',targetStoreId,mediaAssets);row.passed=row.passed&&row.dataAssertions.passed;}
        } catch (error) { row.error = String(error); }
        finally { await context.close(); }
        const ref = await saveArtifact(ctx.evidenceRoot, { ...row, buildId: build!.id, planSha256: ctx.planSha256 }); evidence.navigation.push({ ...row, evidence: ref });
      }
    }
    await writeJson(join(ctx.evidenceRoot, ctx.sourceScope?'source-scope.json':`${stage}.json`), evidence);
    return ctx.sourceScope?await finishSourceScope(projectFile,ctx,evidence):await recordGate(projectFile, stage, stage === "source");
  } finally { try{await sourceBrowser?.close();}finally{await browser?.close();} }
}

export async function prepareReview(projectFile: string, stage: "preflight" | "online") {
  const ctx = await loadPlan(projectFile), build = await buildIdentity(ctx.output), evidence: Evidence = await jsonFile(join(ctx.evidenceRoot, `${stage}.json`));
  const rows: any[] = [];
  for (const [rid, route] of Object.entries(ctx.plan.routes)) for (const vp of Object.keys(ctx.plan.viewports)) {
    for (const id of [...Object.entries(route.states).filter(([,s])=>applies(s,vp)).map(([x])=>`state:${x}`), ...Object.entries(route.transitions).filter(([,s])=>applies(s,vp)).map(([x])=>`transition:${x}`)]) {
      const check = evidence.sessions.find(s=>s.route===rid && s.viewport===vp)?.checks.find(c=>c.id===id), images: Ref[] = [];
      for (const phase of [check?.before, check?.after]) for (const ref of Object.values(phase || {})) { const capture: Capture = JSON.parse((await readRef(ctx.evidenceRoot, ref!)).toString()); images.push(capture.screenshot, capture.fullPage); }
      const componentIds = id.startsWith("state:") ? route.states[id.slice(6)].components : [...new Set([...route.states[route.transitions[id.slice(11)].from].components, ...route.states[route.transitions[id.slice(11)].to].components])];
      rows.push({ route: rid, viewport: vp, id, verdict: "pending", rationale: "", images, components: componentIds.map(id=>({id,verdict:"pending",rationale:""})) });
    }
  }
  const result = { schemaVersion: 2, stage, planSha256: ctx.planSha256, buildId: build.id, reviewer: "", reviewedAt: "", checks: rows };
  const path = join(ctx.evidenceRoot, `${stage}-review.pending.json`);
  await writeJson(path, result); return path;
}

export async function submitReview(projectFile: string, stage: "preflight" | "online", input: string) {
  const ctx = await loadPlan(projectFile), evidence: Evidence = await jsonFile(join(ctx.evidenceRoot, `${stage}.json`));
  // Failed submissions are preserved as failed evidence, never leave an earlier green review active.
  evidence.review = await saveArtifact(ctx.evidenceRoot, await readFile(input));
  await writeJson(join(ctx.evidenceRoot, `${stage}.json`), evidence);
  return recordGate(projectFile, stage);
}
