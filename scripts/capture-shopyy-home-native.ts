import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {animationContext} from '../src/shopyy/browser.js';
const state=process.argv[2];if(!state)throw Error('User-authorized authentication state path required');
const normalPreview=process.argv.includes('--normal-preview');
const revisionIndex=process.argv.indexOf('--revision'),revision=revisionIndex>=0?process.argv[revisionIndex+1]:'';
if(revision&&!/^[a-zA-Z0-9-]+$/.test(revision))throw Error('Invalid capture revision');
const root=resolve('../voidresearch-shopyy'),directory=join(root,'verification/incremental-draft-504457',(normalPreview?'native-home-normal':'native-home')+(revision?'-'+revision:''));
const raw=await readFile(join(root,'verification/incremental-draft-504457/home-current-server-readback.json'),'utf8');
const build=JSON.parse(raw),plan=JSON.parse(await readFile(join(root,'contracts/capture-plan.v2.json'),'utf8'));
if(build.target.skinId!=='504457'||build.target.role!=='draft'||build.publicationAllowed!==false||!build.blocks.every((b:any)=>b.exact))throw Error('Verified draft composition required');
const browser=await chromium.launch({channel:'chrome',headless:false}),rows:any[]=[];
try{
 await mkdir(directory,{recursive:true});
 for(const [device,viewport] of Object.entries(plan.viewports) as [string,{width:number;height:number}][]){
  const context=await browser.newContext({storageState:resolve(state),viewport,locale:plan.environment.locale,timezoneId:plan.environment.timezoneId,deviceScaleFactor:1});
  context.setDefaultTimeout(7000);const page=await context.newPage();
  const errors:{kind:string;text:string;url?:string}[]=[];
  const clean=(s:string)=>s.replace(/https?:\/\/[^\s)]+/g,value=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[url]';}}).replace(/[A-Za-z0-9_-]{80,}/g,'[long-value]').slice(0,240);
  page.on('pageerror',e=>errors.push({kind:e.name,text:clean(e.message)}));
  page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console-error',text:clean(m.text()),url:clean(m.location().url||'')});});
  page.on('response',r=>{if(r.status()>=400)errors.push({kind:'http-'+r.status(),text:r.request().resourceType(),url:clean(r.url())});});
  try{
   const url=new URL('/',build.target.origin);Object.entries({theme_id:'504457',is_theme_edit:'1',preview:'1',device:device==='mobile'?'phone':'computer'}).forEach(([k,v])=>url.searchParams.set(k,v));
   if(normalPreview)url.searchParams.delete('is_theme_edit');
   await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:25000});
   await page.locator('#vr-block-navigation[data-initialized="true"]').waitFor({timeout:15000});
   await page.waitForFunction(ids=>ids.every(id=>document.querySelectorAll('#'+id).length===1),build.order,{timeout:15000});
   await page.mouse.move(viewport.width*.5,viewport.height*.5);
   // Native scrolling loads lower-page lazy images; no DOM or resource substitution.
   for(let n=0;n<45;n++){
    const atEnd=await page.evaluate(()=>scrollY+innerHeight>=document.documentElement.scrollHeight-2);
    if(atEnd)break;await page.mouse.wheel(0,Math.max(400,viewport.height*.8));await page.waitForTimeout(100);
   }
   await page.keyboard.press('Control+Home');await page.waitForTimeout(350);
   await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(async()=>{
    const images=[...document.querySelectorAll('[id^="vr-block-"] img')] as HTMLImageElement[];
    await Promise.all(images.map(async image=>{const prior=image.getAttribute('loading');image.loading='eager';try{await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('image decode timeout')),6000))]);}catch{}finally{if(prior===null)image.removeAttribute('loading');else image.setAttribute('loading',prior);}}));
   });
   const animationEnvironment=await animationContext(page,plan.environment.infiniteAnimations||'frame-zero',true);
   const heroTransforms=await page.locator('#vr-block-hero img').evaluateAll(es=>es.map(e=>{const i=e as HTMLImageElement,s=getComputedStyle(e);return{url:i.currentSrc||i.src,inlineStyle:i.getAttribute('style'),r:s.getPropertyValue('--r'),transform:s.transform,rotate:s.rotate,animationName:s.animationName,animation:s.animation,ancestors:[i.parentElement,i.parentElement?.parentElement].filter(Boolean).map(p=>({tag:p!.tagName,transform:getComputedStyle(p!).transform,rotate:getComputedStyle(p!).rotate}))};}));
   const metrics=await page.evaluate(ids=>({viewport:{width:innerWidth,height:innerHeight},clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollContainers:[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+2&&/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.getBoundingClientRect().height>200).map(e=>({tag:e.tagName,id:e.id,class:e.className,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight})),roots:ids.map(id=>{const e=document.getElementById(id)!;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{id,x:r.x,y:r.y+scrollY,width:r.width,height:r.height,display:s.display,fontFamily:s.fontFamily,fontSize:s.fontSize};}),images:[...document.querySelectorAll('[id^="vr-block-"] img')].map(i=>{const e=i as HTMLImageElement;return{url:e.currentSrc||e.src,loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight};}),nativeHeaderHidden:document.getElementById('card-header')?getComputedStyle(document.getElementById('card-header')!).display==='none':null,nativeFooterHidden:document.getElementById('card-footer')?getComputedStyle(document.getElementById('card-footer')!).display==='none':null}),build.order);
   const previewNoticeVisible=await page.getByText(/Currently in Decoration Preview Mode|当前为装修预览模式/).filter({visible:true}).first().isVisible();
   const imageVisibility=await page.locator('[id^="vr-block-"] img').evaluateAll(es=>es.map(node=>{const e=node as HTMLImageElement,r=e.getBoundingClientRect();let rendered=r.width>0&&r.height>0;for(let p:Element|null=e;p;p=p.parentElement){const c=getComputedStyle(p);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0)rendered=false;}return{url:e.currentSrc||e.src,loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight,rendered,inViewport:rendered&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height},lazyOriginal:e.getAttribute('data-src')||e.getAttribute('data-original')};}));
   const reducedMotion=await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
   const viewportFile=device+'-viewport.png',fullFile=device+'-fullpage.png';
   await page.screenshot({path:join(directory,viewportFile),fullPage:false,animations:'allow'});
   await page.screenshot({path:join(directory,fullFile),fullPage:true,animations:'allow'});
   const refs=[];for(const file of [viewportFile,fullFile])refs.push({file,sha256:createHash('sha256').update(await readFile(join(directory,file))).digest('hex')});
   const final=new URL(page.url());
   rows.push({device,requestedURL:url.href,finalURL:{origin:final.origin,path:final.pathname,draftParams:Object.fromEntries([...final.searchParams].filter(([k])=>['theme_id','is_theme_edit','preview','device'].includes(k)))},metrics,imageVisibility,reducedMotion,imagePreparation:'Same source protocol: eager+decode observed images, restore original loading attribute',heroTransforms,animationEnvironment,errors,previewNoticeVisible,screenshots:refs,wholePageSourceComparison:'pending'});
   console.log(JSON.stringify({device,viewport:metrics.viewport,clientWidth:metrics.clientWidth,scrollWidth:metrics.scrollWidth,blocks:metrics.roots.length,unloadedImages:metrics.images.filter(i=>!i.loaded).length,previewNoticeVisible}));
  }catch(error){rows.push({device,failed:true,error:error instanceof Error?error.name:'Error'});console.log(JSON.stringify({device,failed:true}));}
  finally{await context.close();}
 }
}finally{await browser.close();}
const report={kind:'real-shopyy-draft-initial-three-device-capture-not-source-acceptance',normalPreview,capturedAt:new Date().toISOString(),target:build.target,compositionReportSha256:createHash('sha256').update(raw).digest('hex'),blocks:build.blocks,animationCapture:'Same capture-only animationContext frame-zero projection as source collector; draft code unchanged',rows,objectiveSourceComparison:'pending',visualReview:'pending',wholeSiteAccepted:false,published:false};
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));if(rows.some(r=>r.failed))process.exitCode=1;
