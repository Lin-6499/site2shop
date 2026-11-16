import {chromium} from 'playwright';
import {dirname,join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {jsonFile,writeJson,saveArtifact,digest,safeBrowserError} from '../src/shopyy/artifacts.js';
import {sourceStorage,assertSourceUnblocked} from '../src/shopyy/source-session.js';
import {guardContext,animationContext,normalizeCaptureContext} from '../src/shopyy/browser.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),auditFile='verification/recon-current/coa-fingerprint-code-audit.json',auditBytes=await readFile(join(root,auditFile)),audit=JSON.parse(auditBytes.toString());
const module=audit.responses.find((r:any)=>r.excerpts?.some((e:any)=>e.needle==='Fingerprint of this file'));
if(!module)throw Error('Reviewed normal public-PDF GET and client-side hash/length implementation required');
const sourcePath='/coa/coa-2026-956935',expected='883409de9900b9586adb688b61eee1204dd0d71ba6117afd6aecdb5bafa41c3f',storageState=await sourceStorage(project),browser=await chromium.launch({headless:true}),directory='verification/recon-current/coa-proof-states',rows:any[]=[];
const previous=await jsonFile(join(root,directory,'source-run.json')).catch(()=>null),priorAttempt=previous?await saveArtifact(root,previous):null;
await mkdir(join(root,directory),{recursive:true});
try{for(const[viewport,size]of Object.entries(project.workflow.discoveryViewports||{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const context=await browser.newContext({storageState,viewport:size as any,locale:'en-US',serviceWorkers:'block'}),blocked:any[]=[];
 try{
  await guardContext(context,new URL(project.sourceUrl).origin,'source',blocked,project);
  const page=await context.newPage();await page.goto(new URL(sourcePath,project.sourceUrl).href,{waitUntil:'domcontentloaded',timeout:30000});await page.locator('[data-proof-seal]').waitFor({state:'visible',timeout:15000});await assertSourceUnblocked(page,project);
  const identity=await page.locator('[data-proof-seal] span[title]').getAttribute('title');if(identity!==expected)throw Error('Public proof identity changed from the frozen BPC-157 observation');
  await normalizeCaptureContext(page,{id:'shipping-notice-dismissed',rationale:'Fingerprint panel is checked independently of the retained shipping overlay branches',preservedBranch:'verification/recon-current/context-overlay-source-run.json',dismissals:[{selector:'button[aria-label="Dismiss shipping notice"]',op:'press',value:'Enter',waitMs:15000}]});
  const pdfUrl=(await page.locator('main a[href]').evaluateAll(links=>links.map(n=>(n as HTMLAnchorElement).href).filter(h=>new URL(h).pathname.endsWith('.pdf'))))[0];
  if(!pdfUrl||new URL(pdfUrl).origin!==new URL(project.sourceUrl).origin)throw Error('Expected one observed same-origin public PDF');
  const sample=async(state:string,condition:string)=>{
   await page.mouse.move(0,0);await page.locator('[data-proof-seal]').scrollIntoViewIfNeeded();await animationContext(page,'frame-zero',true);
   await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>undefined)));});
   const content=await page.locator('[data-proof-seal]').evaluate(panel=>{const r=panel.getBoundingClientRect();return{html:panel.outerHTML,text:panel.textContent,button:{text:panel.querySelector('button')?.textContent,disabled:panel.querySelector('button')?.disabled},status:panel.querySelector('[aria-live]')?.textContent,width:r.width,height:r.height,elements:[panel,...panel.querySelectorAll('*')].map(n=>{const box=n.getBoundingClientRect(),style=getComputedStyle(n);return{tag:n.tagName,text:n.children.length?null:n.textContent,x:box.x-r.x,y:box.y-r.y,width:box.width,height:box.height,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,color:style.color,background:style.backgroundColor,padding:style.padding,margin:style.margin,gap:style.gap,display:style.display,borderRadius:style.borderRadius,boxShadow:style.boxShadow,opacity:style.opacity};})};});
   rows.push({viewport,size,state,condition,pdfUrl,expectedSha256:expected,...content,screenshot:await saveArtifact(root,await page.locator('[data-proof-seal]').screenshot(),'png'),sourcePage:'same stable BPC-157 certificate identity; current first-party public PDF alias is separately recorded'});
  };
  await sample('initial','normal source page');
  let mode:'hold'|'normal'|'error'|'corrupt'='hold',release:()=>void=()=>{},held=new Promise<void>(r=>release=r),publicPdf:Buffer|undefined;
  await context.route(pdfUrl,async route=>{
   if(route.request().method()!=='GET'||route.request().frame().url()!==page.url())return route.fallback();
   if(mode==='hold'){await held;return route.continue();}
   if(mode==='error')return route.abort('connectionfailed');
   if(mode==='corrupt')return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-local-read-only-corrupt-fixture')});
   return route.continue();
  });
  const responsePromise=page.waitForResponse(r=>r.url()===pdfUrl&&r.request().method()==='GET',{timeout:30000});
  await page.getByRole('button',{name:'Check this file',exact:true}).click();await page.getByRole('button',{name:'Checking…',exact:true}).waitFor({state:'visible'});await sample('checking','public PDF GET temporarily held locally to observe the genuine loading branch; no response fabricated');mode='normal';release();
  const response=await responsePromise;await page.waitForFunction(()=>!!document.querySelector('[data-proof-seal] [aria-live]')?.textContent?.trim(),null,{timeout:20000});
  if(response.ok()){const bytes=await response.body();if(digest(bytes)!==expected||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Fetched public document does not match the rendered SHA-256');publicPdf=bytes;const docDir='verification/coa-proof-documents';await mkdir(join(root,docDir),{recursive:true});await writeFile(join(root,docDir,expected+'.pdf'),bytes);await writeJson(join(root,docDir,'observed-source-get.json'),{sourcePath,url:pdfUrl,sha256:expected,bytes:bytes.length,file:docDir+'/'+expected+'.pdf',sourceUiActualStatus:await page.locator('[data-proof-seal] [aria-live]').textContent(),uploaded:false,published:false});}
  await sample(response.ok()?'normal-result':'normal-read-error','actual unmodified source PDF response; HTTP '+response.status());
  mode='error';await page.getByRole('button',{name:'Check this file',exact:true}).click();await page.getByText('The file could not be read just now. Try again in a moment.',{exact:true}).waitFor({state:'visible'});await sample('read-error','controlled local network failure for this exact PDF GET; not a claim that the real provider failed');
  mode='corrupt';await page.getByRole('button',{name:'Check this file',exact:true}).click();await page.getByText('This file does not match the fingerprint we recorded.',{exact:true}).waitFor({state:'visible'});await sample('mismatch','controlled local corrupted GET response to exercise the existing client branch; real source PDF and backend unchanged');
  if(publicPdf){mode='normal';await page.getByRole('button',{name:'Check this file',exact:true}).click();await page.getByText(/^This file matches what we published/).waitFor({state:'visible'});await sample('retry-match','actual source PDF GET after local fault modes removed');}
  await assertSourceUnblocked(page,project);
 }catch(error){rows.push({viewport,passed:false,error:safeBrowserError(error)});}finally{await context.close();}
 await writeJson(join(root,directory,'source-run.json'),{kind:'stable-certificate-proof-ui-state-observations-with-explicit-client-fault-context-not-provider-outcome-claims',sourcePath,expectedSha256:expected,sourceModule:{url:module.url,sha256:module.sha256,auditFile,auditSha256:digest(auditBytes)},rows,priorAttempt,sourceRequests:'GET/HEAD/OPTIONS plus existing SDK renewal only; analytics POST blocked',clipboardChanged:false,filesUploaded:false,sourceFormsSubmitted:false,sourceBackendChanged:false,wholePageAcceptance:false,published:false});
 console.log(JSON.stringify({viewport,states:rows.filter(r=>r.viewport===viewport).map(r=>r.state||r.error),failed:rows.some(r=>r.viewport===viewport&&r.passed===false)}));
}}finally{await browser.close();}
if(rows.some(r=>r.passed===false))process.exitCode=1;
