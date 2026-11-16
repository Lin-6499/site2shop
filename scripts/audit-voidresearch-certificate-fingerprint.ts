import {chromium} from 'playwright';
import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,digest,safeBrowserError} from '../src/shopyy/artifacts.js';
import {sourceStorage,assertSourceUnblocked} from '../src/shopyy/source-session.js';
import {guardContext} from '../src/shopyy/browser.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),storageState=await sourceStorage(project);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({storageState,viewport:{width:1440,height:1000},serviceWorkers:'block'}),responses:any[]=[],jobs:Promise<void>[]=[];
try{
 await guardContext(context,new URL(project.sourceUrl).origin,'source',[],project);
 const page=await context.newPage();
 page.on('response',response=>{
  const url=new URL(response.url());
  if(url.origin!==new URL(project.sourceUrl).origin||!url.pathname.endsWith('.js')||jobs.length>=100)return;
  jobs.push((async()=>{try{
   const bytes=await response.body();if(bytes.length>3*1024*1024)return;
   const text=bytes.toString(),needles=['Check this file','Fingerprint of this file','SHA-256'];
   const excerpts=needles.flatMap(needle=>{const at=text.indexOf(needle);return at<0?[]:[{needle,offset:at,code:text.slice(Math.max(0,at-1800),Math.min(text.length,at+2200))}];});
   if(excerpts.length)responses.push({url:url.origin+url.pathname,sha256:digest(bytes),bytes:bytes.length,excerpts});
  }catch(error){responses.push({url:url.origin+url.pathname,error:safeBrowserError(error)});}})());
 });
 await page.goto(new URL('/coa/coa-2026-956935',project.sourceUrl).href,{waitUntil:'domcontentloaded',timeout:30000});
 await page.locator('main h1').waitFor({state:'visible',timeout:15000});await assertSourceUnblocked(page,project);
 await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>undefined);await Promise.all(jobs);
 const observation=await page.locator('main').evaluate(main=>({title:main.querySelector('h1')?.textContent,pdfLinks:[...main.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a=>new URL(a.href).pathname.endsWith('.pdf')).map(a=>a.href),publicSha256:[...main.querySelectorAll<HTMLElement>('[title]')].map(n=>n.title).filter(v=>/^[a-f0-9]{64}$/.test(v)),fileInputs:main.querySelectorAll('input[type=file]').length}));
 const report={kind:'observed-first-party-source-code-read-only-audit-not-runtime-or-behavior-acceptance',sourcePath:'/coa/coa-2026-956935',observation,responses,sourceFormsSubmitted:false,filesSelected:false,clipboardChanged:false,published:false};
 await writeJson(join(root,'verification/recon-current/coa-fingerprint-code-audit.json'),report);
 console.log(JSON.stringify({sourcePath:report.sourcePath,observedScripts:jobs.length,matchingModules:responses.filter(r=>r.excerpts?.length).map(r=>({url:r.url,sha256:r.sha256,excerpts:r.excerpts})),observation}));
}finally{await context.close();await browser.close();}
