import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({storageState:resolve(state),viewport:{width:1440,height:1000}});
await context.route('**/*',r=>['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort());
const page=await context.newPage(),rows:any[]=[];
try{
 for(const route of ['/pages/coa','/pages/coa?theme_id=504457&preview=1','/pages/coa?theme_id=504457&preview=1&is_theme_edit=1']){
  const response=await page.goto('https://pepsss.zenshop.cn'+route,{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForFunction(()=>document.readyState==='complete',undefined,{timeout:12000}).catch(()=>{});
  if(route.includes('is_theme_edit'))await page.locator('#vr-coa-route-host[data-ready="true"]').waitFor({timeout:18000}).catch(()=>{});
  rows.push({requestedRoute:route,status:response?.status(),observation:await page.evaluate(()=>{
   const h=document.querySelector('#vr-coa-route-host'),native=document.querySelector('#MainContent>[data-section-type="page_detail"]'),body=native?.querySelector('.mo-editor-reset');
   return {pathname:location.pathname,query:location.search,hostPresent:!!h,ready:h?.getAttribute('data-ready'),mounted:h?.getAttribute('data-mounted'),initializationError:h?.getAttribute('data-initialization-error'),payloadCount:document.querySelectorAll('template[id^="vr-coa-payload-"]').length,cards:document.querySelectorAll('#coa-reports > div.grid > div').length,nativeVisible:!!native&&getComputedStyle(native).display!=='none',nativeBodyHtml:body?.innerHTML.slice(0,250),directoryVisible:!!h?.querySelector('#vr-block-coa-directory')&&getComputedStyle(h).display!=='none'};
  })});
 }
 const report={capturedAt:new Date().toISOString(),mode:'independent-read-only-audit',rows,remoteWrites:false,published:false};
 await writeFile(resolve('../voidresearch-shopyy/verification/incremental-draft-504457/coa-readonly-status-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await context.close();await browser.close();}
