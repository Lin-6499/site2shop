import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const out=resolve('../voidresearch-shopyy/verification/incremental-draft-504457/contact-native-structure');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false}),context=await browser.newContext({storageState:resolve(state),viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page=await context.newPage();context.setDefaultTimeout(7000);
try{
 const url='https://pepsss.zenshop.cn/pages/Contact-Us?theme_id=504457&is_theme_edit=1&preview=1&device=computer';
 const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
 await page.locator('#card-header').waitFor({state:'attached',timeout:15000});
 const data=await page.locator('body').evaluate(b=>({title:document.title,path:location.pathname,cards:[...b.querySelectorAll('[id^="card-"]')].map(e=>({id:e.id,class:e.className,tag:e.tagName,text:(e as HTMLElement).innerText.slice(0,160),html:e.outerHTML.slice(0,6500)})),main:[...b.querySelectorAll('main')].map(e=>({id:e.id,class:e.className,html:e.outerHTML.slice(0,6500)}))}));
 const report={requestedUrl:url,status:response?.status(),...data,published:false,remoteWrites:false};await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await page.screenshot({path:join(out,'desktop.png')});console.log(JSON.stringify(report));
}finally{await context.close();await browser.close();}
