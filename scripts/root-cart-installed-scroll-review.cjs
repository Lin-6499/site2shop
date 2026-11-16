'use strict';
// Independent production replay. No injected repair, product change or cart line write.
const fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(process.argv[2]),out=path.join(root,'verification/incremental-draft-504457/cart-scroll-r4-root-independent');await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),rows=[];
 try{for(const[device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}}))for(const mode of ['fast-Escape','fast-same-Cart-reopen']){
  const context=await browser.newContext({viewport,storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json',serviceWorkers:'block'}),page=await context.newPage(),blocked=[];
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin==='https://pepsss.zenshop.cn'&&!['GET','HEAD','OPTIONS'].includes(r.request().method())){blocked.push(new URL(r.request().url()).pathname);return r.abort();}return r.continue();});
  const row={device,mode,samples:[],blocked},sample=async phase=>{const state=await page.evaluate(()=>({bodyClass:document.body.className,bodyOverflow:getComputedStyle(document.body).overflow,scrollY,open:document.querySelectorAll('.minicart.minicart_on').length,opacity:document.querySelector('.minicart')?getComputedStyle(document.querySelector('.minicart')).opacity:null,marker:document.getElementById('vr-block-native-cart-escape')?.dataset.scrollState,cart:document.querySelector('#vr-block-navigation button[aria-label^="Cart,"]')?.getAttribute('aria-label')}));row.samples.push({phase,...state});return state;};
  try{await page.goto('https://pepsss.zenshop.cn/?theme_id=504457&preview=1&is_theme_edit=1',{waitUntil:'domcontentloaded',timeout:30000});await page.locator('#vr-block-navigation[data-initialized=true]').waitFor({timeout:25000});
   const button=page.getByRole('button',{name:'Cart, 0 items',exact:true}),box=await button.boundingBox();if(!box)throw Error('Owned cart trigger missing');
   row.before=await sample('before');await button.click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));row.opened=await sample('early-open');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.minicart.minicart_on'),undefined,{timeout:2000});await sample('early-close');
   if(mode==='fast-same-Cart-reopen'){await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForFunction(()=>!!document.querySelector('.minicart.minicart_on'),undefined,{timeout:2000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await sample('early-reopen');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.minicart.minicart_on'),undefined,{timeout:2000});}
   for(const[phase,delay]of [['closed350',350],['closed1350',1000],['closed2350',1000]]){await page.waitForTimeout(delay);await sample(phase);}
   await page.mouse.move(viewport.width/3,viewport.height/2);await page.mouse.wheel(0,400);await page.waitForTimeout(300);row.final=await sample('after-wheel');
   row.image=device+'-'+mode+'.png';await page.screenshot({path:path.join(out,row.image),caret:'initial'});
   row.passed=row.opened.open===1&&row.before.bodyOverflow==='visible'&&row.samples.filter(s=>s.phase.startsWith('closed')).every(s=>s.open===0&&s.bodyOverflow==='visible')&&row.final.scrollY>0&&!blocked.length;
  }catch(e){row.passed=false;row.error=String(e);row.failureState=await sample('failure').catch(()=>null);}finally{await context.close();rows.push(row);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({reviewer:'/root',version:'r4-native-cart-escape-scroll-30e46d31f8f5',rows,passed:rows.length===6&&rows.every(r=>r.passed),freshContexts:true,repairInjected:false,serverWrites:false,wholeCartAccepted:false,published:false},null,2));}
 }}finally{await browser.close();}console.log(JSON.stringify({rows:rows.length,passed:rows.length===6&&rows.every(r=>r.passed),failures:rows.filter(r=>!r.passed)}));if(rows.length!==6||rows.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
