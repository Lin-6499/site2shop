'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(process.argv[2]),out=path.join(root,'verification/incremental-draft-504457/policies-root-independent/r5-policies-native-53a1244defcc');await fs.mkdir(out,{recursive:true});
 const tabs=JSON.parse(await fs.readFile(path.join(root,'staging/local-inner-candidates/r5-policies-native-53a1244defcc/inputs/public-ui.json'),'utf8')).policy.tabs.map(t=>t.id),browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),rows=[];
 try{for(const[device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
  const context=await browser.newContext({viewport,storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),page=await context.newPage();
  try{await page.goto('https://pepsss.zenshop.cn/pages/policies?theme_id=504457&preview=1&is_theme_edit=1',{waitUntil:'domcontentloaded',timeout:30000});await page.locator('#vr-policies-route-host[data-ready=true]').waitFor({timeout:25000});
   for(const tab of tabs){await page.locator('#policy-tab-'+tab).click();
    const actual=await page.evaluate(tab=>{
     const selected=[...document.querySelectorAll('#vr-block-policies [role=tab][aria-selected=true]')].map(n=>n.id),panel=document.querySelector('#vr-block-policies #policy-panel'),host=document.getElementById('vr-policies-route-host');
     const templates=[...document.querySelectorAll('template[id^="vr-policies-payload-states-"]')].flatMap(p=>[...p.content.querySelectorAll('template[data-vr-policy-panel]')]),source=templates.find(t=>t.dataset.vrPolicyPanel===tab);
     const sourcePanel=source?.content.querySelector('#policy-panel');
     return{selected,ready:host?.dataset.ready,panelText:panel?.innerText,panelMatchesFrozenState:!!sourcePanel&&panel?.innerHTML===sourcePanel.innerHTML,url:location.href};
    },tab);
    const file=device+'-tab-'+tab+'.png';await page.locator('#policy-panel').screenshot({path:path.join(out,file),caret:'initial'});
    rows.push({device,tab,actual,image:file,passed:actual.selected.length===1&&actual.selected[0]==='policy-tab-'+tab&&actual.ready==='true'&&actual.panelMatchesFrozenState&&!!actual.panelText});
   }
   await page.evaluate(()=>document.getElementById('MainContent').append(document.getElementById('vr-policies-route-host').cloneNode(true)));await page.waitForTimeout(100);
   const clone=await page.evaluate(()=>({hosts:[...document.querySelectorAll('#vr-policies-route-host')].map(h=>({ready:h.getAttribute('data-ready'),display:getComputedStyle(h).display,height:h.getBoundingClientRect().height})),nativeVisible:getComputedStyle(document.getElementById('block-section-13251243')).display!=='none'}));
   rows.push({device,state:'deep-clone',actual:clone,passed:clone.hosts.length===2&&clone.hosts.every(h=>!h.ready&&h.display==='none'&&h.height===0)&&clone.nativeVisible});
  }catch(e){rows.push({device,passed:false,error:String(e)});}finally{await context.close();}
 }}finally{await browser.close();}
 const report={reviewer:'/root',version:'r5-policies-native-53a1244defcc',scope:'Independent actual nine-tab frozen state content and live deep-clone rejection, three devices',rows,passed:rows.length===30&&rows.every(r=>r.passed),wholePageVisualAccepted:false,published:false};await fs.writeFile(path.join(out,'tabs-and-clone-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,rows:rows.length,failed:rows.filter(r=>!r.passed).map(r=>({device:r.device,tab:r.tab,state:r.state,error:r.error}))}));if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
