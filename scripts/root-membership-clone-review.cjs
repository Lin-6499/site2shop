'use strict';
// Isolated browser DOM negative test. No server-side changes or form submission.
const fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(process.argv[2]),out=path.join(root,'verification/incremental-draft-504457/membership-root-independent/r6-membership-native-bddb76eb66f4');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),rows=[];
 try{for(const[device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
  const context=await browser.newContext({viewport,storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),page=await context.newPage();
  try{
   await page.goto('https://pepsss.zenshop.cn/pages/membership?theme_id=504457&preview=1&is_theme_edit=1',{waitUntil:'domcontentloaded',timeout:30000});
   await page.locator('#vr-membership-route-host[data-ready=true]').waitFor({timeout:25000});
   await page.evaluate(()=>document.getElementById('MainContent').append(document.getElementById('vr-membership-route-host').cloneNode(true)));
   await page.waitForTimeout(100);
   const actual=await page.evaluate(()=>({hosts:[...document.querySelectorAll('#vr-membership-route-host')].map(h=>({ready:h.getAttribute('data-ready'),display:getComputedStyle(h).display,height:h.getBoundingClientRect().height})),nativeVisible:getComputedStyle(document.getElementById('block-section-13251243')).display!=='none',notice:!!document.getElementById('body_domain_prompt')}));
   const passed=actual.hosts.length===2&&actual.hosts.every(h=>h.ready===null&&h.display==='none'&&h.height===0)&&actual.nativeVisible&&actual.notice;
   const file=device+'-deep-clone-revoked.png';await page.screenshot({path:path.join(out,file),caret:'initial'});rows.push({device,actual,image:file,passed});
  }catch(e){rows.push({device,passed:false,error:String(e)});}finally{await context.close();}
 }}finally{await browser.close();}
 const report={reviewer:'/root',version:'r6-membership-native-bddb76eb66f4',scope:'Live isolated cloned-ready-host negative checks on three devices',rows,passed:rows.length===3&&rows.every(r=>r.passed),serverMutation:false,published:false};
 await fs.writeFile(path.join(out,'deep-clone-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,rows}));if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
