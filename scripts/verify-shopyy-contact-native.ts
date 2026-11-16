import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const root=resolve('../voidresearch-shopyy'),plan=JSON.parse(await readFile(join(root,'verification/contact-route-native-trial-plan.json'),'utf8')),dir=join(root,'verification/incremental-draft-504457',plan.version),raw=await readFile(join(dir,'server-readback.json'),'utf8'),build=JSON.parse(raw),out=join(dir,'native-verification-r2');
if(build.version!==plan.version||build.parts.length!==4||!build.parts.every((p:any)=>p.exact)||build.target.role!=='draft'||build.target.skinId!=='504457'||build.published!==false)throw Error('Exact saved draft contact composition required');
await mkdir(out,{recursive:true});const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex'),browser=await chromium.launch({channel:'chrome',headless:false}),rows:any[]=[];
const url=(path:string,device:string)=>plan.target.origin+path+'?theme_id=504457&preview=1&is_theme_edit=1&device='+(device==='mobile'?'phone':'computer');
try{for(const [device,viewport] of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const context=await browser.newContext({storageState:resolve(state),viewport,locale:'en-US',timezoneId:'America/New_York'}),page=await context.newPage();context.setDefaultTimeout(7000);const row:any={device,states:[],isolation:[]};
 try{
  for(const stateName of ['initial','faq0closed','faq1open','faq2open','faq3open','faq3closed','faq0open','faq1closed']){
   const response=await page.goto(url('/pages/Contact-Us',device),{waitUntil:'domcontentloaded',timeout:25000});if(response?.status()!==200)throw Error('Contact native route not 200');
   await page.locator('#vr-contact-route-host[data-ready="true"]').waitFor({timeout:15000});await page.locator('#vr-block-navigation[data-initialized="true"]').waitFor();
   if(stateName!=='initial'){
    const [,indexText,desired]=stateName.match(/^faq(\d)(open|closed)$/)!,index=Number(indexText),item=page.locator('#vr-block-contact #faq > div:nth-child(2) > div').nth(index);
    await item.locator('button').click();if((desired==='closed'&&index!==0)||(desired==='open'&&index===0))await item.locator('button').click();
    if(await item.evaluate(e=>e.classList.contains('border-brand'))!==(desired==='open'))throw Error('Wrong actual native disclosure state');
   }
   await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
   const metrics=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth},ownedRoots:['vr-block-navigation','vr-block-contact','vr-block-ft'].map(id=>({id,count:document.querySelectorAll('#'+id).length,height:document.getElementById(id)?.getBoundingClientRect().height})),nativeHidden:['card-header','card-footer','block-section-13251243'].map(id=>({id,hidden:!!document.getElementById(id)&&getComputedStyle(document.getElementById(id)!).display==='none'})),bodySamples:[...document.querySelectorAll('#vr-block-contact>div,#vr-block-contact>div *')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,text:e.children.length?null:e.textContent,width:r.width,height:r.height,fontFamily:s.fontFamily,fontSize:s.fontSize,color:s.color,display:s.display};})}));
   if(metrics.ownedRoots.some(r=>r.count!==1)||metrics.nativeHidden.some(r=>!r.hidden)||metrics.viewport.scrollWidth>metrics.viewport.clientWidth)throw Error('Native contact structure/overflow failed');
   const previewNoticeVisible=await page.getByText(/Currently in Decoration Preview Mode|当前为装修预览模式/).filter({visible:true}).first().isVisible();if(!previewNoticeVisible)throw Error('Platform preview notice was hidden');
   let initialViewportContext;
   if(stateName==='initial'){
    // Capture the untouched initial viewport before locator.screenshot scrolls the component.
    await page.waitForFunction(()=>scrollY===0,undefined,{timeout:5000});
    initialViewportContext=await page.evaluate(()=>{const h=document.querySelector('[data-vr-component="header"]')!.getBoundingClientRect(),t=document.querySelector('#vr-block-contact h1')!.getBoundingClientRect();return{scrollY,headerBottom:h.bottom,titleTop:t.top,titleBottom:t.bottom,titleClearOfHeader:t.top>=h.bottom};});
    if(!initialViewportContext.titleClearOfHeader)throw Error('Actual initial Contact title is covered by fixed header');
    await page.screenshot({path:join(out,device+'-viewport.png')});await page.screenshot({path:join(out,device+'-fullpage.png'),fullPage:true});
   }
   const file=device+'-'+stateName+'-body.png';await page.locator('#vr-block-contact').screenshot({path:join(out,file),animations:'disabled'});
   row.states.push({state:stateName,metrics,initialViewportContext,previewNoticeVisible,screenshot:{file,sha256:hash(await readFile(join(out,file)))},passed:true});
  }
  for(const pathname of ['/pages/About-Us','/pages/Shipping-policy']){
   const response=await page.goto(url(pathname,device),{waitUntil:'domcontentloaded',timeout:25000});await page.locator('#card-header').waitFor({state:'attached'});await page.waitForTimeout(300);
   const observation=await page.evaluate(()=>({path:location.pathname,ownedContact:document.querySelectorAll('#vr-block-contact').length,mounted:document.querySelector('#vr-contact-route-host')?.getAttribute('data-mounted')||null,nativeHeaderVisible:getComputedStyle(document.getElementById('card-header')!).display!=='none',nativePageBodyVisible:[...document.querySelectorAll('#MainContent>[data-section-type="page_detail"]')].some(e=>getComputedStyle(e).display!=='none')}));
   const passed=response?.status()===200&&!observation.ownedContact&&!observation.mounted&&observation.nativeHeaderVisible&&observation.nativePageBodyVisible;row.isolation.push({...observation,status:response?.status(),passed});if(!passed)throw Error('Shared native page group route isolation failed');
  }
  row.passed=true;
 }catch(e){row.passed=false;row.error=e instanceof Error?e.message.slice(0,240):'Error';await page.screenshot({path:join(out,device+'-stopped.png')}).catch(()=>{});}
 finally{rows.push(row);console.log(JSON.stringify({device,states:row.states.length,isolation:row.isolation.length,passed:row.passed,error:row.error}));await context.close();}
}}finally{await browser.close();}
await writeFile(join(out,'report.json'),JSON.stringify({kind:'actual-native-contact-route-and-disclosure-verification-not-full-source-acceptance',version:plan.version,compositionId:build.compositionId,readbackSha256:hash(raw),target:build.target,rows,passed:rows.every(r=>r.passed),pairedSourceComparison:'pending',formSubmission:'unbound-not-submitted',wholeSiteAccepted:false,published:false},null,2));if(rows.some(r=>!r.passed))process.exitCode=1;
