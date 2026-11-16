import {captureLongDocument} from './long-page-raster.js';
import {paintAutoVisibleContent} from './content-visibility-paint.js';
import {preserveNestedVerticalGutters,unchangedVerticalGutters} from './nested-vertical-gutter.js';
import {captureCaretScope} from './capture-caret.js';
import type {Page} from 'playwright';
const geometry=(page:Page)=>page.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,bodyWidth:document.body.getBoundingClientRect().width,documentScrollHeight:document.documentElement.scrollHeight,bodyScrollHeight:document.body.scrollHeight,bodyHeight:document.body.getBoundingClientRect().height,scrollHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight,document.documentElement.offsetHeight,document.body.offsetHeight,document.documentElement.clientHeight,document.body.clientHeight),scrollWidth:document.documentElement.scrollWidth,scrollX,scrollY}));

const captureLayout=(page:Page)=>page.evaluate(String.raw`(() => {
 const list=[...new Set(document.querySelectorAll('body > *,body > #__nuxt > *,header.landing-header,main,main > *,main section,footer.site-footer,.homepage-video-media'))].filter(n=>!n.matches('script,style,link,noscript')).slice(0,80);
 return {root:{scrollbarGutter:getComputedStyle(document.documentElement).scrollbarGutter,overflowY:getComputedStyle(document.documentElement).overflowY,fontStatus:document.fonts.status,styleSheetCount:document.styleSheets.length},nodes:list.map((n,index)=>{const rect=n.getBoundingClientRect(),css=getComputedStyle(n);return{index,selector:n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(n.classList.length?'.'+[...n.classList].join('.'):''),x:rect.x,y:rect.y+scrollY,width:rect.width,height:rect.height,paddingTop:css.paddingTop,paddingRight:css.paddingRight,paddingBottom:css.paddingBottom,paddingLeft:css.paddingLeft,marginTop:css.marginTop,marginBottom:css.marginBottom,fontSize:css.fontSize,lineHeight:css.lineHeight,display:css.display,boxSizing:css.boxSizing,contentVisibility:css.contentVisibility,containIntrinsicSize:css.containIntrinsicSize};}),videos:[...document.querySelectorAll('video')].slice(0,8).map((n,index)=>({index,readyState:n.readyState,networkState:n.networkState,videoWidth:n.videoWidth,videoHeight:n.videoHeight,paused:n.paused,currentTime:n.currentTime}))};
})()`);
function layoutChanges(before:any,after:any){
 if(!before||!after)return[];
 return before.nodes.map((node:any,index:number)=>{const current=after.nodes[index];return{selector:node.selector,index,fields:current?Object.keys(node).filter(field=>JSON.stringify(node[field])!==JSON.stringify(current[field])):['removed'],before:node,after:current||null};}).filter((change:any)=>change.fields.length).slice(0,32);
}

/** Reserve measured native gutters. Flex children keep their measured cross-size and visible scroll offset while Chromium omits scrollbar painting. */
async function preserveNativeGridGutters(page:Page,needed:boolean){
 const handle:any=await page.evaluateHandle(String.raw`(needed=>{
  if(!needed)return[];
  const entries=[];
  for(const node of document.body.querySelectorAll('*')){
   const css=getComputedStyle(node),grid=['grid','inline-grid'].includes(css.display),flex=['flex','inline-flex'].includes(css.display)&&css.flexDirection==='row'&&css.flexWrap==='nowrap';if((!grid&&!flex)||!['auto','scroll'].includes(css.overflowX)||node.scrollWidth<=node.clientWidth)continue;
   const rect=node.getBoundingClientRect(),gutter=node.offsetHeight-node.clientHeight-parseFloat(css.borderTopWidth)-parseFloat(css.borderBottomWidth);
   if(!rect.width||!rect.height||gutter<=0||(grid&&css.gridTemplateRows==='none'))continue;
   entries.push({node,selector:node.tagName.toLowerCase()+(node.id?'#'+node.id:'')+(node.classList.length?'.'+[...node.classList].join('.'):''),style:node.getAttribute('style'),properties:[...node.style].map(name=>({name,value:node.style.getPropertyValue(name),priority:node.style.getPropertyPriority(name)})),childProjections:flex?[...node.children].map(child=>{if(node.scrollLeft&&getComputedStyle(child).translate!=='none')throw Error('Native scrolling child already has a translate projection');return{node:child,style:child.getAttribute('style'),cssText:child.style.cssText,height:child.getBoundingClientRect().height,properties:['height','box-sizing','translate'].map(name=>({name,value:child.style.getPropertyValue(name),priority:child.style.getPropertyPriority(name)}))};}):[],height:rect.height,layout:grid?'grid':'flex-row',rows:css.gridTemplateRows,gutter,scrollLeft:node.scrollLeft,scrollTop:node.scrollTop,children:[...node.children].map(child=>{const r=child.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})});
   if(entries.length===64)break;
  }
  for(const entry of entries){entry.node.style.setProperty('height',entry.height+'px','important');entry.node.style.setProperty('box-sizing','border-box','important');if(entry.layout==='grid')entry.node.style.setProperty('grid-template-rows',entry.rows,'important');else{entry.node.style.setProperty('overflow-x','hidden','important');for(const child of entry.childProjections){child.node.style.setProperty('height',child.height+'px','important');child.node.style.setProperty('box-sizing','border-box','important');if(entry.scrollLeft)child.node.style.setProperty('translate',(-entry.scrollLeft)+'px 0','important');}void entry.node.offsetHeight;entry.node.scrollTo({left:0,top:entry.scrollTop,behavior:'instant'});}}
  return entries;
 })(`+JSON.stringify(needed)+`)`);
 const sample=():Promise<any[]>=>handle.evaluate((entries:any[])=>entries.map((entry:any)=>{const css=getComputedStyle(entry.node),r=entry.node.getBoundingClientRect();return{selector:entry.selector,layout:entry.layout,originalHeight:entry.height,gridRows:entry.rows,horizontalScrollProjection:entry.layout==='flex-row'&&entry.scrollLeft?'translated-children-at-scroll-origin':'none',originalScrollLeft:entry.scrollLeft,scrollLeft:entry.node.scrollLeft,childChanges:[...entry.node.children].map((child,index)=>{const r=child.getBoundingClientRect(),before=entry.children[index],actual={x:r.x,y:r.y,width:r.width,height:r.height};return{index,before,actual};}).filter(change=>JSON.stringify(change.before)!==JSON.stringify(change.actual)).slice(0,8),originalGutter:entry.gutter,height:r.height,gutter:entry.node.offsetHeight-entry.node.clientHeight-parseFloat(css.borderTopWidth)-parseFloat(css.borderBottomWidth),childrenUnchanged:[...entry.node.children].length===entry.children.length&&[...entry.node.children].every((child,index)=>{const r=child.getBoundingClientRect(),before=entry.children[index];return r.x===before.x&&r.y===before.y&&r.width===before.width&&r.height===before.height;})};}));
 return{sample,async restore(){await handle.evaluate((entries:any[])=>{
  for(const entry of entries){const node=entry.node;if(!node.isConnected)continue;
   for(const child of entry.childProjections||[]){for(const property of child.properties){if(property.value)child.node.style.setProperty(property.name,property.value,property.priority);else child.node.style.removeProperty(property.name);}if(child.node.style.cssText===child.cssText){if(child.style===null)child.node.removeAttribute('style');else child.node.setAttribute('style',child.style);}}
   for(const name of (entry.layout==='grid'?['height','box-sizing','grid-template-rows']:['height','box-sizing'])){const original=entry.properties.find((item:any)=>item.name===name);if(original)node.style.setProperty(name,original.value,original.priority);else node.style.removeProperty(name);}
   const overflow=entry.properties.find((item:any)=>item.name==='overflow-x');node.style.setProperty('overflow-x','hidden','important');void node.offsetHeight;
   if(overflow)node.style.setProperty('overflow-x',overflow.value,overflow.priority);else node.style.removeProperty('overflow-x');
   void node.offsetHeight;node.scrollTo({left:entry.scrollLeft,top:entry.scrollTop,behavior:'instant'});
   const restored=[...node.style].map(name=>({name,value:node.style.getPropertyValue(name),priority:node.style.getPropertyPriority(name)})).sort((a,b)=>a.name.localeCompare(b.name));
   if(JSON.stringify(restored)===JSON.stringify([...entry.properties].sort((a,b)=>a.name.localeCompare(b.name)))){if(entry.style===null)node.removeAttribute('style');else node.setAttribute('style',entry.style);}
  }
 });},async finish(bodyHadNoStyle:boolean){try{await handle.evaluate((entries:any[])=>{for(const entry of entries)if(entry.style===null&&entry.node.isConnected&&entry.node.style.length===0)entry.node.removeAttribute('style');});if(bodyHadNoStyle)await page.evaluate(()=>{if(document.body.style.length===0)document.body.removeAttribute('style');});}finally{await handle.dispose();}}};
}

/** Preserve normal content width when Chromium expands a full-page screenshot's height. */
export async function captureFullPagePreservingLayout(page:Page,observePhase?:(phase:string)=>Promise<void>,protectFinishedAnimations=false){
 const caret=await captureCaretScope(page);try{return await captureFullPageGeometry(page,observePhase,protectFinishedAnimations);}finally{await caret.close();}
}
async function captureFullPageGeometry(page:Page,observePhase?:(phase:string)=>Promise<void>,protectFinishedAnimations=false){
 const before=await page.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,bodyWidth:document.body.getBoundingClientRect().width,documentScrollHeight:document.documentElement.scrollHeight,bodyScrollHeight:document.body.scrollHeight,bodyHeight:document.body.getBoundingClientRect().height,scrollHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight,document.documentElement.offsetHeight,document.body.offsetHeight,document.documentElement.clientHeight,document.body.clientHeight),scrollWidth:document.documentElement.scrollWidth,scrollX,scrollY,rootInlineStyle:document.documentElement.getAttribute('style'),rootStyleProperties:[...document.documentElement.style].map(name=>({name,value:document.documentElement.style.getPropertyValue(name),priority:document.documentElement.style.getPropertyPriority(name)})),rootScrollbarGutter:getComputedStyle(document.documentElement).scrollbarGutter,bodyInlineStyle:document.body.getAttribute('style'),bodyStyleProperties:[...document.body.style].map(name=>({name,value:document.body.style.getPropertyValue(name),priority:document.body.style.getPropertyPriority(name)}))}));
 const snapshots:any={before:await captureLayout(page)};
 await observePhase?.('fullpage-before-gutters');
 const gutters=await preserveNativeGridGutters(page,before.scrollHeight>before.innerHeight||before.scrollWidth>before.innerWidth);
 await observePhase?.('fullpage-after-horizontal-gutters');
 const verticalGutters=await preserveNestedVerticalGutters(page);
 await observePhase?.('fullpage-after-vertical-gutters');
 let gutterProjection:any[]=[],restoredGutters:any[]=[],verticalProjection:any[]=[],verticalRestored:any[]=[];
 const projected=before.innerWidth>before.clientWidth&&before.scrollHeight>before.innerHeight;
 const {rootInlineStyle,rootStyleProperties,rootScrollbarGutter,bodyInlineStyle,bodyStyleProperties,...expectedGeometry}=before;
 const waitGeometry=async(phase:'projection'|'restore')=>{
  try{
   await page.waitForFunction(({expected,phase})=>innerWidth===expected.innerWidth&&innerHeight===expected.innerHeight&&document.documentElement.clientWidth===expected.clientWidth&&document.body.getBoundingClientRect().width===expected.bodyWidth&&(phase!=='restore'||Math.max(document.documentElement.scrollHeight,document.body.scrollHeight,document.documentElement.offsetHeight,document.body.offsetHeight,document.documentElement.clientHeight,document.body.clientHeight)===expected.scrollHeight&&document.body.getBoundingClientRect().height===expected.bodyHeight)&&scrollX===expected.scrollX&&scrollY===expected.scrollY,{expected:before,phase},{polling:'raf',timeout:3000});
  }catch{
   const actual=await geometry(page),differences=Object.entries(expectedGeometry).filter(([field,value])=>actual[field as keyof typeof actual]!==value).map(([field,value])=>({field,before:value,actual:actual[field as keyof typeof actual]}));
   snapshots[phase]=await captureLayout(page);
   const error=Error('Full-page screenshot '+phase+' geometry differs: '+differences.map(d=>d.field+' '+d.before+' -> '+d.actual).join('; '));
   Object.assign(error,{sourceScreenshotGeometryDiagnostic:{kind:'full-page-geometry-failure',phase,projection:projected?'body-width-preservation':'none',before:expectedGeometry,actual,differences,layoutSnapshots:snapshots,layoutChanges:{projection:layoutChanges(snapshots.before,snapshots.projected),afterScreenshot:layoutChanges(snapshots.before,snapshots.afterScreenshot),restore:layoutChanges(snapshots.before,snapshots[phase])}}});throw error;
  }
 };
 const contentPainting=await paintAutoVisibleContent(page);let contentVisibilityPainting:any[]=[];
 let image:Buffer;let animationProtection:any=null;let longPageRaster:any;let primaryCaptureError:any;
 try{
  if(projected){
   await page.evaluate(({width,gutter})=>{if(!gutter.includes('stable'))document.documentElement.style.setProperty('scrollbar-gutter','stable','important');document.body.style.setProperty('width',width+'px','important');document.body.style.setProperty('box-sizing','border-box','important');},{width:before.bodyWidth,gutter:before.rootScrollbarGutter});
   snapshots.projected=await captureLayout(page);
   await waitGeometry('projection');
  }
  await observePhase?.('fullpage-after-body-projection');
  const projectedGutters=await gutters.sample();if(projectedGutters.some(entry=>!entry.childrenUnchanged||entry.height!==entry.originalHeight))throw Object.assign(Error('Native scrolling gutter projection changed child geometry'),{sourceScreenshotGeometryDiagnostic:{kind:'native-scrolling-child-geometry-failure',phase:'projection',entries:projectedGutters}});
  const verticalBefore=await verticalGutters.sample();if(!unchangedVerticalGutters(verticalBefore))throw Object.assign(Error('Nested vertical gutter projection changed content geometry'),{sourceScreenshotGeometryDiagnostic:{kind:'nested-vertical-gutter-failure',phase:'projection',entries:verticalBefore}});
  contentVisibilityPainting=await contentPainting.project();
  await waitGeometry('restore');
  const finiteAnimationProtection=protectFinishedAnimations?await page.evaluate(()=>{const all=document.getAnimations();const finite=all.filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime));return{kind:'naturally-finished-finite-screenshot-protection',eligible:finite.length>0&&all.length===finite.length&&finite.every(a=>a.playState==='finished'),animations:all.map(a=>({name:a instanceof CSSAnimation?a.animationName:a instanceof CSSTransition?a.transitionProperty:'web-animation',playState:a.playState,currentTime:typeof a.currentTime==='number'?a.currentTime:null,endTime:a.effect?.getComputedTiming().endTime??null}))};}):null;
  animationProtection=finiteAnimationProtection?.eligible?finiteAnimationProtection:null;
  if(before.scrollHeight*await page.evaluate(()=>devicePixelRatio)>16384){animationProtection=null;const bounded=await captureLongDocument(page,before.innerWidth,before.scrollHeight);image=bounded.image;longPageRaster=bounded.proof;}else image=await page.screenshot({fullPage:true,animations:animationProtection?'disabled':'allow',caret:'initial'});
  await contentPainting.verify('afterScreenshot');
  await observePhase?.('fullpage-after-screenshot');
  gutterProjection=await gutters.sample();if(gutterProjection.some(entry=>!entry.childrenUnchanged||entry.height!==entry.originalHeight))throw Object.assign(Error('Full-page screenshot changed preserved native scrolling child geometry'),{sourceScreenshotGeometryDiagnostic:{kind:'native-scrolling-child-geometry-failure',phase:'afterScreenshot',entries:gutterProjection}});
  verticalProjection=await verticalGutters.sample();if(!unchangedVerticalGutters(verticalProjection))throw Object.assign(Error('Full-page screenshot changed nested vertical gutter content geometry'),{sourceScreenshotGeometryDiagnostic:{kind:'nested-vertical-gutter-failure',phase:'afterScreenshot',entries:verticalProjection}});
  snapshots.afterScreenshot=await captureLayout(page);
 }catch(error){primaryCaptureError=error;throw error;}finally{
  try{try{await contentPainting.restore();}finally{await gutters.restore();}await observePhase?.('fullpage-after-horizontal-restore');await verticalGutters.restore();await observePhase?.('fullpage-after-vertical-restore');
  await page.evaluate(({expected,projected})=>{if(projected){
   const root=document.documentElement,originalGutter=expected.rootStyleProperties.find(item=>item.name==='scrollbar-gutter');if(originalGutter)root.style.setProperty('scrollbar-gutter',originalGutter.value,originalGutter.priority);else root.style.removeProperty('scrollbar-gutter');const rootRestored=[...root.style].map(name=>({name,value:root.style.getPropertyValue(name),priority:root.style.getPropertyPriority(name)})).sort((a,b)=>a.name.localeCompare(b.name));if(JSON.stringify(rootRestored)===JSON.stringify([...expected.rootStyleProperties].sort((a,b)=>a.name.localeCompare(b.name)))){if(expected.rootInlineStyle===null)root.removeAttribute('style');else root.setAttribute('style',expected.rootInlineStyle);}
   for(const name of ['width','box-sizing']){const original=expected.bodyStyleProperties.find(item=>item.name===name);if(original)document.body.style.setProperty(name,original.value,original.priority);else document.body.style.removeProperty(name);}
   const restored=[...document.body.style].map(name=>({name,value:document.body.style.getPropertyValue(name),priority:document.body.style.getPropertyPriority(name)})).sort((a,b)=>a.name.localeCompare(b.name));
   if(JSON.stringify(restored)===JSON.stringify([...expected.bodyStyleProperties].sort((a,b)=>a.name.localeCompare(b.name)))){if(expected.bodyInlineStyle===null)document.body.removeAttribute('style');else document.body.setAttribute('style',expected.bodyInlineStyle);}
  }window.scrollTo({left:expected.scrollX,top:expected.scrollY,behavior:'instant'});},{expected:before,projected});
  await observePhase?.('fullpage-after-body-restore');
  await waitGeometry('restore');
  restoredGutters=await gutters.sample();if(restoredGutters.some(entry=>!entry.childrenUnchanged||entry.height!==entry.originalHeight||entry.gutter!==entry.originalGutter))throw Error('Native scrolling gutter restoration changed actual scrollbar or child geometry');
  verticalRestored=await verticalGutters.sample();if(!unchangedVerticalGutters(verticalRestored))throw Object.assign(Error('Nested vertical gutter restoration changed content geometry'),{sourceScreenshotGeometryDiagnostic:{kind:'nested-vertical-gutter-failure',phase:'restore',entries:verticalRestored}});
  }catch(restoreError){if(primaryCaptureError){primaryCaptureError.sourceScreenshotGeometryDiagnostic={kind:'primary-capture-and-restoration-failure',primary:primaryCaptureError.sourceScreenshotGeometryDiagnostic||{error:String(primaryCaptureError)},restoration:(restoreError as any).sourceScreenshotGeometryDiagnostic||{error:String(restoreError)}};throw primaryCaptureError;}throw restoreError;}finally{try{await verticalGutters.finish();}finally{await gutters.finish(before.bodyInlineStyle===null);}}
 }
 return{image,environment:{kind:'full-page-layout-preservation',...(longPageRaster?{longPageRaster}:{}),contentVisibilityPainting:{kind:'auto-visible-paint-projection',count:contentVisibilityPainting.length,geometryUnchanged:true,restored:true},...(animationProtection?{finiteAnimationProtection:animationProtection}:{}),projection:projected?'body-width-preservation':'none',rootScrollbarGutterProjection:projected?'stable-preserve-fixed-anchors':'none',before:expectedGeometry,nativeVerticalGutters:verticalProjection.map((entry,index)=>({...entry,restoredClientWidth:verticalRestored[index]?.clientWidth,restoredChildrenUnchanged:verticalRestored[index]?.childrenUnchanged})),nativeGridGutters:gutterProjection.map((entry,index)=>({...entry,restoredGutter:restoredGutters[index]?.gutter,restoredChildrenUnchanged:restoredGutters[index]?.childrenUnchanged})),fullPageNativeScrollbarPainting:gutterProjection.some(entry=>entry.gutter!==entry.originalGutter)?'omitted-by-browser-content-geometry-preserved':verticalProjection.length?'browser-managed-with-capture-only-gutter-preservation':'preserved',restored:true}};
}

/** Reject legacy classic-scrollbar full-page rasters whose fixed anchors shifted by the omitted gutter. */
export function verifyFullPageGeometry(environment:any){
 const proof=environment?.fullPageGeometry,before=proof?.before;const painting=proof?.contentVisibilityPainting;if(painting?.kind!=='auto-visible-paint-projection'||!Number.isInteger(painting.count)||painting.count<0||painting.geometryUnchanged!==true||painting.restored!==true)throw Error('Full-page content visibility painting proof missing');
 if(!before||!['innerWidth','clientWidth','scrollHeight','innerHeight'].every(field=>Number.isFinite(before[field])))throw Error('Full-page geometry proof missing');
 if(before.scrollHeight>16384){const raster=proof.longPageRaster;if(raster?.kind!=='bounded-document-clips-no-scroll'||!Array.isArray(raster.clips)||!raster.clips.length||raster.viewport?.innerWidth!==before.innerWidth||raster.viewport?.innerHeight!==before.innerHeight)throw Error('Long-page bounded raster proof missing');let y=0;for(const clip of raster.clips){if(clip.x!==0||clip.y!==y||clip.width!==before.innerWidth||!Number.isInteger(clip.height)||clip.height<1||clip.height>8192)throw Error('Long-page raster clip coverage differs');y+=clip.height;}if(y!==before.scrollHeight)throw Error('Long-page raster extent differs');}
 if(before.innerWidth>before.clientWidth&&before.scrollHeight>before.innerHeight&&(proof.rootScrollbarGutterProjection!=='stable-preserve-fixed-anchors'||proof.restored!==true))throw Error('Classic-scrollbar full-page fixed-anchor projection proof missing');
}
