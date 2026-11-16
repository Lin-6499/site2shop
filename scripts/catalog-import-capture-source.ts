import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {sourceStorage,assertSourceUnblocked,isSourceSessionRefresh} from '../src/shopyy/source-session.js';
const root=resolve('../voidresearch-shopyy'),project=JSON.parse(await readFile(join(root,'shopyy.project.json'),'utf8'));
const routes=['/product/void-rt','/product/cartalax','/product/ara-290','/product/ll-37'];
const out=join(root,'verification/catalog-import-r1/source-first4');await mkdir(out,{recursive:true});
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const storageState=await sourceStorage(project),browser=await chromium.launch({headless:true});
const rows=[];
try{for(const [device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const context=await browser.newContext({storageState,viewport,locale:'en-US',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
 await context.route('**/*',r=>['GET','HEAD','OPTIONS'].includes(r.request().method())||isSourceSessionRefresh(r.request().method(),r.request().url(),project)?r.continue():r.abort('blockedbyclient'));
 try{const page=await context.newPage();for(const route of routes){try{
  const response=await page.goto('https://voidresearch.shop'+route,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('h1').first().waitFor({timeout:15000});await assertSourceUnblocked(page,project);
  if(new URL(page.url()).pathname!==route||response?.status()!==200)throw Error('Wrong actual product route/status');
  await page.waitForTimeout(800);await page.evaluate(async()=>{await document.fonts.ready;scrollTo({top:0,behavior:'instant'});});
  const data=await page.evaluate(()=>{const h1=document.querySelector('h1'),hero=h1?.closest('section');if(!hero)throw Error('Actual product hero missing');const text=hero.innerText,heading=[...document.querySelectorAll('h2')].find(h=>h.textContent==='Compound Information');return {title:h1.textContent?.trim(),canonical:document.querySelector('link[rel=canonical]')?.getAttribute('href'),heroText:text,heroHtml:hero.outerHTML,mainImages:[...hero.querySelectorAll('img')].map(i=>({src:i.currentSrc||i.src,srcAttribute:i.getAttribute('src'),alt:i.alt,loaded:i.complete&&i.naturalWidth>0,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight})),controls:[...hero.querySelectorAll('button,input,select')].map(n=>({tag:n.tagName,text:n.textContent?.trim(),type:n.getAttribute('type'),ariaLabel:n.getAttribute('aria-label'),options:n.tagName==='SELECT'?[...n.querySelectorAll('option')].map(o=>({text:o.textContent,value:o.value})):undefined})),priceLabels:text.match(/\$\d+\.\d{2}/g)||[],sizeLine:text.split('\n').find(l=>/^Size:/i.test(l.trim()))||null,compoundHtml:heading?.parentElement?.parentElement?.parentElement?.outerHTML||null,otherTitles:[...document.querySelectorAll('h2')].map(h=>h.textContent?.trim())};});
  const stem=device+'-'+route.split('/').at(-1),png=await page.screenshot({fullPage:false,caret:'initial'});await writeFile(join(out,stem+'.png'),png);const record={requestedRoute:route,url:page.url(),status:response?.status(),device,viewport,capturedAt:new Date().toISOString(),readOnly:true,sourceSessionCurrent:true,...data,screenshot:{file:stem+'.png',sha256:hash(png)}};const bytes=JSON.stringify(record,null,2);await writeFile(join(out,stem+'.json'),bytes);rows.push({device,route,file:stem+'.json',sha256:hash(bytes),title:data.title,sizeLine:data.sizeLine,priceLabels:data.priceLabels,passed:true});
 }catch(e){rows.push({device,route,passed:false,error:String(e)});}}}finally{await context.close();}
}}finally{await browser.close();}
await writeFile(join(out,'manifest.json'),JSON.stringify({kind:'real-initial-source-product-field-capture-not-whole-page-state-acceptance',credentialsStored:false,rows,passed:rows.length===12&&rows.every(r=>r.passed)},null,2));console.log(JSON.stringify({rows:rows.length,passed:rows.every(r=>r.passed),failed:rows.filter(r=>!r.passed),out}));
