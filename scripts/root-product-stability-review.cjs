'use strict';
// Independent, read-only draft review; no clicks, submissions, or editor writes.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{chromium}=require('playwright');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const root=path.resolve(process.argv[2]),version=process.argv[3];
 if(!/^r3-product-native-(?:initial|body)-[a-f0-9]{12}$/.test(version))throw Error('Explicit frozen product version required');
 const manifestBytes=await fs.readFile(path.join(root,'staging/local-inner-candidates',version,'manifest.json'));
 const manifest=JSON.parse(manifestBytes),fullBody=version.includes('-body-'),defaultOut=fullBody?path.join(root,'verification/product-full-static-body-r4/root-independent'):path.join(root,'verification/incremental-draft-504457/product-r4-protection-repair/root-independent-stability'),out=process.argv[4]?path.resolve(root,process.argv[4]):defaultOut;
 if(!out.startsWith(path.join(root,'verification')+path.sep))throw Error('Review output must stay in project verification');
 if(manifest.target.origin!=='https://pepsss.zenshop.cn'||manifest.target.skinId!=='504457'||manifest.publicationAllowed!==false)throw Error('Wrong draft identity');
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const rows=[];
 try{for(const[device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
  const context=await browser.newContext({viewport,storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{for(let cycle=0;cycle<2;cycle++){
   const url='https://pepsss.zenshop.cn/products/bpc-157?theme_id=504457&preview=1&is_theme_edit=1';
   if(cycle===0)await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});else await page.reload({waitUntil:'domcontentloaded',timeout:30000});
   await page.locator('#vr-product-route-host[data-ready=true]').waitFor({timeout:25000});
   for(const delayMs of [0,1000,3000]){if(delayMs)await page.waitForTimeout(delayMs);
    const observed=await page.evaluate(()=>{
     const hosts=[...document.querySelectorAll('#vr-product-route-host')],h=hosts[0],native=document.querySelector('#MainContent>#block-section-13251244'),p=window.cuurentProductDetail?.product;
     return{url:location.href,hostCount:hosts.length,ready:h?.dataset.ready,error:h?.dataset.initializationError||null,hostVisible:!!h&&getComputedStyle(h).display!=='none'&&h.getBoundingClientRect().height>0,nativeVisible:!!native&&getComputedStyle(native).display!=='none',productId:p?.id,variantId:p?.variants?.[0]?.id,tabsMargin:document.querySelector('#product-tabs')?.style.marginBottom,title:h?.querySelector('h1')?.textContent,brokenImages:h?[...h.querySelectorAll('img')].filter(i=>!i.complete||!i.naturalWidth).length:null,noticePresent:!!document.querySelector('#body_domain_prompt')};
    });
    const lowerComponents=fullBody?await page.locator('#vr-product-route-host #vr-block-product-detail,#vr-product-route-host #vr-block-product-promo').count():0;
    const passed=observed.url===url&&observed.hostCount===1&&observed.ready==='true'&&!observed.error&&observed.hostVisible&&!observed.nativeVisible&&observed.productId===6523798&&observed.variantId===43547671&&observed.title==='BPC-157'&&observed.brokenImages===0&&(!fullBody||lowerComponents===2);
    rows.push({device,cycle,delayMs,observed,passed});
   }
   const file=device+'-reload-'+cycle+'.png',bytes=await page.screenshot({fullPage:false,caret:'initial'});await fs.writeFile(path.join(out,file),bytes);rows[rows.length-1].image={file,sha256:hash(bytes)};
   const readyAfterScreenshot=await page.locator('#vr-product-route-host').getAttribute('data-ready');rows[rows.length-1].readyAfterScreenshot=readyAfterScreenshot;rows[rows.length-1].passed=rows[rows.length-1].passed&&readyAfterScreenshot==='true';
   if(fullBody){const file=device+'-reload-'+cycle+'-full.png',bytes=await page.screenshot({fullPage:true,caret:'initial'});await fs.writeFile(path.join(out,file),bytes);rows[rows.length-1].fullImage={file,sha256:hash(bytes)};}
  }}catch(e){rows.push({device,passed:false,error:String(e)});}finally{await context.close();}
  if(errors.length)rows.push({device,passed:false,pageErrors:errors});
 }}finally{await browser.close();}
 const report={reviewer:'/root',kind:'independent-live-readonly-product-stability',version,manifestSha256:hash(manifestBytes),rows,passed:rows.length===18&&rows.every(r=>r.passed),wholeProductAccepted:false,published:false};
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(out,'report.json'),passed:report.passed,rows:rows.length,failures:rows.filter(r=>!r.passed)}));if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
