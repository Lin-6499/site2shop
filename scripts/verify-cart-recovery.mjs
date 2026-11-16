import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {unlockStorefrontIfNeeded} from '../.codex-build/src/storefront-auth.js';
const project=path.resolve(process.argv[2]),folder=path.join(project,'cart-diagnostic/acceptance');await fs.mkdir(folder,{recursive:true});
const build=JSON.parse(await fs.readFile(path.join(project,'theme-build.json')));
const report={schemaVersion:1,themeId:'189701193927',themeBuild:build.id,scope:['wine-glass add','hat add','cart update/remove/empty'],sessions:[],passed:false,published:false};
const browser=await chromium.launch({headless:true});
async function test(viewport,dimensions){
 const context=await browser.newContext({viewport:dimensions,locale:'en-US'}),page=await context.newPage();page.setDefaultTimeout(15000);
 const session={viewport,steps:[],passed:false};report.sessions.push(session);const ownKeys=new Set();
 const cart=async()=>{const r=await context.request.get('https://azhiip-13.myshopify.com/cart.js');if(r.status()!==200)throw new Error('cart.js failed');return r.json();};
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 try{
  const wine='https://azhiip-13.myshopify.com/products/home-state-wine-glass?preview_theme_id=189701193927&country=US&currency=USD';await page.goto(wine,{waitUntil:'domcontentloaded'});await unlockStorefrontIfNeeded(page,wine);await page.waitForSelector('[data-s2s-submit]:not([disabled])');
  check((await cart()).item_count===0,'Isolated test context unexpectedly has existing cart items');
  for(const [type,handle,state]of [['wine','home-state-wine-glass','Arizona'],['hat','home-state-dad-hat','Alaska']]){
   if(type==='hat')await page.goto('https://azhiip-13.myshopify.com/products/'+handle+'?preview_theme_id=189701193927&country=US&currency=USD',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('[data-s2s-submit]:not([disabled])');await page.locator('select[name="option-state"]').selectOption(state);
   const selected=await page.locator('[data-s2s-family-product]').getAttribute('data-s2s-selected-variant');
   const added=page.waitForResponse(r=>r.url().includes('/cart/add.js')&&r.request().method()==='POST');
   await page.locator('[data-s2s-submit]').click();const response=await added;check(response.status()===200,'Add failed: '+response.status());const addedItem=await response.json();ownKeys.add(addedItem.key);
   await page.waitForURL('**/cart',{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-s2s-cart]');
   const data=await cart(),item=data.items.find(n=>n.key===addedItem.key);check(item&&String(item.variant_id)===selected&&item.quantity===1,'Wrong added variant/quantity');
   const identity=await page.evaluate(()=>({title:document.title,theme:String(window.Shopify?.theme?.id),build:document.querySelector('meta[name="site2shop-build-id"]')?.content,canonical:document.querySelector('link[rel="canonical"]')?.href,overflow:document.documentElement.scrollWidth>innerWidth}));
   check(identity.theme==='189701193927'&&identity.build===build.id&&new URL(identity.canonical).pathname==='/cart'&&!identity.overflow,'Wrong cart identity/layout');
   session.steps.push({action:'add-'+type,variant:selected,variantTitle:item.variant_title,quantity:item.quantity,cartCount:data.item_count,identity});
   await page.screenshot({path:path.join(folder,`${viewport}-after-${type}.png`),fullPage:true});
  }
  let data=await cart();const wineItem=data.items.find(n=>n.handle==='home-state-wine-glass'),hatItem=data.items.find(n=>n.handle==='home-state-dad-hat');
  const wineRow=page.locator('article[data-key="'+wineItem.key+'"]');await wineRow.locator('[data-s2s-quantity]').fill('2');
  await Promise.all([page.waitForResponse(r=>r.url().includes('/cart/update.js')&&r.request().method()==='POST'),page.locator('button[name="update"]').click()]);
  await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(500);data=await cart();
  check(data.items.find(n=>n.key===wineItem.key)?.quantity===2&&data.items.find(n=>n.key===hatItem.key)?.quantity===1,'Quantity update changed wrong line');
  session.steps.push({action:'quantity-update',wineQuantity:2,hatQuantity:1,totalPrice:data.total_price});
  await page.screenshot({path:path.join(folder,`${viewport}-updated.png`),fullPage:true});
  for(const item of [wineItem,hatItem]){
   const row=page.locator('article[data-key="'+item.key+'"]');await row.waitFor();
   await Promise.all([page.waitForResponse(r=>r.url().includes('/cart/update.js')&&r.request().method()==='POST'),row.locator('[data-s2s-remove]').click()]);
   await page.waitForTimeout(700);data=await cart();check(!data.items.some(n=>n.key===item.key),'Remove failed');
   session.steps.push({action:'remove-'+item.handle,remainingCount:data.item_count});
  }
  await page.waitForFunction(()=>document.querySelector('.s2s-cart')?.textContent.includes('Your cart is empty.'));
  check((await cart()).item_count===0,'Cart did not return to empty');await page.screenshot({path:path.join(folder,`${viewport}-empty.png`),fullPage:true});session.passed=true;
 }catch(error){session.error=String(error);await page.screenshot({path:path.join(folder,`${viewport}-failure.png`),fullPage:true}).catch(()=>{});}
 finally{const state=await cart().catch(()=>({items:[]}));for(const item of state.items)if(ownKeys.has(item.key))await context.request.post('https://azhiip-13.myshopify.com/cart/change.js',{data:{id:item.key,quantity:0}});session.remainingTestLines=(await cart().catch(()=>({items:[]}))).items.filter(n=>ownKeys.has(n.key)).length;await fs.writeFile(path.join(folder,`${viewport}.json`),JSON.stringify(session,null,2));await context.close();console.log(JSON.stringify(session));}
}
try{for(const [viewport,dimensions]of Object.entries({desktop:{width:1920,height:1080},tablet:{width:768,height:1024},mobile:{width:390,height:844}}))await test(viewport,dimensions);report.passed=report.sessions.every(s=>s.passed&&s.remainingTestLines===0);await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log('CART_RECOVERY_ACCEPTANCE',report.passed);}finally{await browser.close();}
