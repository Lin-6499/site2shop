import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const state=process.argv[2];if(!state)throw Error('Authorized state path required');
const out=resolve('../voidresearch-shopyy/verification/incremental-draft-504457/native-cart-recon');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false}),context=await browser.newContext({storageState:resolve(state),viewport:{width:1440,height:1000},locale:'en-US',timezoneId:'America/New_York'}),page=await context.newPage();context.setDefaultTimeout(7000);const network:any[]=[];
page.on('response',r=>{const u=new URL(r.url());if(u.origin==='https://pepsss.zenshop.cn'&&/cart|search/.test(u.pathname))network.push({method:r.request().method(),path:u.pathname,queryKeys:[...u.searchParams.keys()],status:r.status(),resourceType:r.request().resourceType()});});
try{
 await page.goto('https://pepsss.zenshop.cn/pages/Contact-Us?theme_id=504457&is_theme_edit=1&preview=1&device=computer',{waitUntil:'domcontentloaded',timeout:25000});await page.locator('#card-header').waitFor({state:'attached',timeout:15000});
 const controls=await page.locator('#card-header .header_icon a').evaluateAll(es=>es.map(e=>({tag:e.tagName,class:e.className,href:e.getAttribute('href'),title:e.getAttribute('title'),ariaLabel:e.getAttribute('aria-label'),text:(e as HTMLElement).innerText,html:e.outerHTML.slice(0,2000)})));
 const cart=page.locator('#card-header a.cart_icon').filter({visible:true});if(await cart.count()!==1)throw Error('Actual native cart entry absent/ambiguous');
 await cart.click();await page.waitForTimeout(1500);
 const structure=await page.locator('body').evaluate(b=>({url:{origin:location.origin,path:location.pathname},cartElements:[...b.querySelectorAll('[id*="cart"],[class*="cart"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).map(e=>({tag:e.tagName,id:e.id,class:e.className,text:(e as HTMLElement).innerText.slice(0,1000),html:e.outerHTML.slice(0,12000)})).slice(0,25)}));
 await writeFile(join(out,'report.json'),JSON.stringify({target:{origin:'https://pepsss.zenshop.cn',skinId:'504457',role:'draft'},controls,structure,network,cartMutation:false,orderSubmitted:false,published:false},null,2));await page.screenshot({path:join(out,'cart-open-desktop.png')});console.log(JSON.stringify({nativeHeaderControls:controls.length,cartElements:structure.cartElements.length,network,published:false}));
}finally{await context.close();await browser.close();}
