import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {unlockStorefrontIfNeeded} from '../.codex-build/src/storefront-auth.js';
const project=path.resolve(process.argv[2]),dir=path.join(project,'cart-diagnostic');await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},locale:'en-US'}),page=await context.newPage();const network=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',async response=>{const url=response.url();if(/\/cart(?:\/add\.js|\.js|(?:\?|$))/.test(url)){const text=await response.text().catch(()=> '');network.push({url,status:response.status(),body:text.slice(0,1800)});}});
try{
 const url='https://azhiip-13.myshopify.com/products/home-state-wine-glass?preview_theme_id=189701193927&country=US&currency=USD';await page.goto(url,{waitUntil:'domcontentloaded'});await unlockStorefrontIfNeeded(page,url);await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
 const before=await page.evaluate(async()=>({url:location.href,theme:String(window.Shopify?.theme?.id),commerce:document.querySelector('#s2s-commerce-config')?.textContent,cart:await fetch('/cart.js').then(r=>r.json()),form:document.querySelector('.s2s-harold-form')?.getAttribute('action')}));
 await page.locator('select[name="option-state"]').selectOption('Arizona');
 const selected=await page.evaluate(()=>({variant:document.querySelector('[data-s2s-family-product]')?.dataset.s2sSelectedVariant,options:document.querySelector('[data-s2s-family-product]')?.dataset.s2sSelectedOptions}));
 await page.locator('[data-s2s-submit]').click();await page.waitForTimeout(6000);
 const after=await page.evaluate(()=>({url:location.href,title:document.title,theme:String(window.Shopify?.theme?.id),canonical:document.querySelector('link[rel="canonical"]')?.href,text:document.body.innerText.slice(-6000),status:document.querySelector('[data-s2s-status]')?.textContent}));
 await page.screenshot({path:path.join(dir,'after-add.png'),fullPage:true});await fs.writeFile(path.join(dir,'after-add.html'),await page.content());
 const cart=await context.request.get('https://azhiip-13.myshopify.com/cart.js').then(r=>r.json());
 const added=cart.items.filter(n=>!before.cart.items.some(old=>old.key===n.key)&&n.properties?._s2s_group);
 for(const item of added)await context.request.post('https://azhiip-13.myshopify.com/cart/change.js',{data:{id:item.key,quantity:0}});
 const report={before:{...before,cart:{item_count:before.cart.item_count}},selected,after,network:network.map(n=>({...n,body:n.body.replace(/("token"\s*:\s*")[^"]+/g,'$1[redacted]')})),errors,cartAfter:{item_count:cart.item_count,items:cart.items.map(n=>({title:n.title,variant_id:n.variant_id,quantity:n.quantity,properties:n.properties}))},testLinesRemoved:added.length};
 await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
