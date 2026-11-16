'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{chromium}=require('playwright');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const root=path.resolve(process.argv[2]),mode=process.argv[3],version=process.argv[4];
 if(!['collection','membership','policies'].includes(mode)||!/^r[0-9]+-[a-z0-9-]+-[a-f0-9]{12}$/.test(version))throw Error('Explicit page and immutable version required');
 const bytes=await fs.readFile(path.join(root,'staging/local-inner-candidates',version,'manifest.json')),manifest=JSON.parse(bytes),out=path.join(root,'verification/incremental-draft-504457',mode+'-root-independent',version);
 if(manifest.target.origin!=='https://pepsss.zenshop.cn'||manifest.target.skinId!=='504457'||manifest.publicationAllowed!==false)throw Error('Wrong draft identity');
 const pathname=mode==='collection'?'/collections/all':'/pages/'+mode,hostId='vr-'+mode+'-route-host',url='https://pepsss.zenshop.cn'+pathname+'?theme_id=504457&preview=1&is_theme_edit=1';
 await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),rows=[];
 try{for(const[device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
  const context=await browser.newContext({viewport,storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),page=await context.newPage();
  try{for(let cycle=0;cycle<2;cycle++){
   if(cycle===0)await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});else await page.reload({waitUntil:'domcontentloaded',timeout:30000});
   await page.locator('#'+hostId+'[data-ready=true]').waitFor({timeout:25000});await page.waitForTimeout(4000);
   const observed=await page.evaluate(({hostId,mode})=>{
    const h=document.getElementById(hostId),tail=document.getElementById('vr-collection-footer-host'),native=document.querySelector(mode==='collection'?'#MainContent>#block-section-13251221':'#MainContent>#block-section-13251243');
    const visible=e=>!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0;
    return{url:location.href,count:document.querySelectorAll('#'+hostId).length,ready:h?.dataset.ready,error:h?.dataset.error||h?.dataset.initializationError||null,hostVisible:visible(h),nativeVisible:visible(native),tailReady:tail?.dataset.ready||null,title:h?.querySelector('h1')?.textContent,brokenImages:h?[...h.querySelectorAll('img')].filter(i=>!i.complete||!i.naturalWidth).length:null,noticePresent:!!document.querySelector('#body_domain_prompt'),sortPresent:!!document.querySelector('#sort_by_select'),nativeProductLinks:native?.querySelectorAll('a[href^="/products/"]').length};
   },{hostId,mode});
   const images=[];for(const fullPage of [false,true]){const file=device+'-'+cycle+(fullPage?'-full':'-viewport')+'.png',data=await page.screenshot({fullPage,caret:'initial'});await fs.writeFile(path.join(out,file),data);images.push({file,sha256:hash(data)});}
   const readyAfterScreenshot=await page.locator('#'+hostId).getAttribute('data-ready');
   const passed=observed.url===url&&observed.count===1&&observed.ready==='true'&&!observed.error&&observed.hostVisible&&observed.brokenImages===0&&readyAfterScreenshot==='true'&&(mode==='collection'?observed.tailReady==='true'&&observed.nativeVisible&&observed.sortPresent&&!observed.nativeProductLinks:!observed.nativeVisible);
   rows.push({device,cycle,observed,images,readyAfterScreenshot,passed});
  }}catch(e){rows.push({device,passed:false,error:String(e)});}finally{await context.close();}
 }}finally{await browser.close();}
 const report={reviewer:'/root',mode,version,manifestSha256:hash(bytes),rows,passed:rows.length===6&&rows.every(r=>r.passed),scope:'Independent read-only three-device draft mount/reload, image review pending',wholePageAccepted:false,published:false};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(out,'report.json'),passed:report.passed,failures:rows.filter(r=>!r.passed)}));if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
