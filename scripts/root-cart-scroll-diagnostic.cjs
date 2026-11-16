'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(process.argv[2]),out=path.join(root,'verification/incremental-draft-504457/cart-scroll-current');await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),rows=[];
 try{for(const[device,viewport]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
  const context=await browser.newContext({viewport,storageState:'D:/Documents/deepseek-harness/默认工作区/shopyy-login/zenshop-state.json'}),page=await context.newPage(),blocked=[];
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin==='https://pepsss.zenshop.cn'&&!['GET','HEAD','OPTIONS'].includes(r.request().method())){blocked.push(new URL(r.request().url()).pathname);return r.abort();}return r.continue();});
  const sample=()=>page.evaluate(()=>({bodyClass:document.body.className,bodyOverflow:getComputedStyle(document.body).overflow,htmlOverflow:getComputedStyle(document.documentElement).overflow,scrollY,drawer:document.querySelectorAll('.minicart.minicart_on').length,empty:!!document.querySelector('.minicart.minicart_on')?.innerText.includes('Your Shopping Cart is Empty'),ownCart:document.querySelector('#vr-block-navigation button[aria-label^="Cart,"]')?.getAttribute('aria-label')}));
  const row={device,cycles:[],blocked};
  try{await page.goto('https://pepsss.zenshop.cn/?theme_id=504457&preview=1&is_theme_edit=1',{waitUntil:'domcontentloaded',timeout:30000});await page.locator('#vr-block-navigation[data-initialized=true]').waitFor({timeout:25000});
   for(const mode of ['X-rapid','X-settled','Escape-rapid','Escape-settled']){
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));const before=await sample();
    await page.getByRole('button',{name:/^Cart, [0-9]+ items$/}).click();await page.locator('.minicart.minicart_on').waitFor({state:'visible',timeout:15000});if(mode.endsWith('settled'))await page.waitForTimeout(800);const opened=await sample();
    if(mode.startsWith('X'))await page.locator('.minicart.minicart_on .close_btn').click();else await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.minicart.minicart_on'),{},{timeout:10000});await page.waitForTimeout(1000);const closed=await sample();
    await page.mouse.move(viewport.width/3,viewport.height/2);await page.mouse.wheel(0,400);await page.waitForTimeout(300);const afterWheel=await sample();
    row.cycles.push({mode,before,opened,closed,afterWheel,restored:closed.bodyOverflow===before.bodyOverflow&&afterWheel.scrollY>closed.scrollY});
   }
  }catch(e){row.error=String(e);}finally{await context.close();rows.push(row);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({kind:'read-only-current-native-empty-cart-scroll-race-diagnostic',rows,cartMutations:false,published:false},null,2));}
 }}finally{await browser.close();}
 console.log(JSON.stringify({report:path.join(out,'report.json'),rows}));
})().catch(e=>{console.error(e);process.exitCode=1;});
