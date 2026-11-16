import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {unlockStorefrontIfNeeded} from '../.codex-build/src/storefront-auth.js';
const project=path.resolve(process.argv[2]),stage=process.argv[3]||'preflight';
const build=JSON.parse(await fs.readFile(path.join(project,'theme-build.json')));
const folder=path.join(project,'state-product-repair',stage);await fs.mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true});const report={stage,themeBuild:build.id,themeId:stage==='online'?'189701193927':null,sessions:[],passed:false,unverified:[]};
let targetStorage;
async function capture(page,side,prefix){
 const data=await page.evaluate(()=>{const root=document.querySelector('#product-content-area');const box=n=>{if(!n)return null;const b=n.getBoundingClientRect(),s=getComputedStyle(n);return{width:b.width,height:b.height,visible:!!(b.width&&b.height)&&s.display!=='none',fontSize:parseFloat(s.fontSize),fontWeight:s.fontWeight};};const form=root.querySelector('form.s2s-harold-form')||[...root.querySelectorAll('form')].find(n=>n.querySelector('select[name="option-state"]'));return {country:window.Shopify?.country,currency:window.Shopify?.currency?.active,url:location.href,canonical:document.querySelector('link[rel="canonical"]')?.href,build:document.querySelector('meta[name="site2shop-build-id"]')?.content,themeId:String(window.Shopify?.theme?.id||''),title:box(root.querySelector('h1')),price:box(root.querySelector('.product-price-final,[data-s2s-price]')),priceText:root.querySelector('.product-price-final,[data-s2s-price]')?.textContent.trim(),quantity:box(form?.querySelector('input[name="quantity"]')),submit:box(form?.querySelector('button[type="submit"]')),select:box(form?.querySelector('select[name="option-state"]')),share:[...root.querySelectorAll('.product-social-sharing a')].map(n=>({href:n.href,box:box(n)})),paymentText:root.querySelector('[data-s2s-state-payments]')?.textContent.trim(),paymentIcons:[...root.querySelectorAll('svg[aria-labelledby^="pi-"]')].map(n=>n.querySelector('title')?.textContent),delivery:root.querySelector('[data-s2s-state-delivery],.edt')?.textContent.trim(),deliveryLink:root.querySelector('[data-s2s-state-delivery] a')?.getAttribute('href'),swatches:[...root.querySelectorAll('.s2s-harold-image-option label')].map(n=>({value:n.getAttribute('aria-label'),image:n.querySelector('img')?.currentSrc,loaded:!!n.querySelector('img')?.naturalWidth})),arrows:[...document.querySelectorAll('.s2s-harold-thumb-nav>.s2s-family-arrow, #product-wrapper .splide__arrow')].filter(n=>box(n)?.visible).length,overflow:document.documentElement.scrollWidth>innerWidth,selected:form?.querySelector('select[name="option-state"]')?.value};});
 await page.screenshot({path:path.join(folder,`${prefix}-${side}.png`),fullPage:true,animations:'disabled'});
 await fs.writeFile(path.join(folder,`${prefix}-${side}.json`),JSON.stringify(data,null,2));return data;
}
async function runCase(type,handle,viewport,dimensions){
 const source=await browser.newPage({viewport:dimensions,locale:'en-US'}),target=await browser.newPage({viewport:dimensions,locale:'en-US',...(targetStorage?{storageState:targetStorage}:{})});
 const targetUrl=stage==='online'?`https://azhiip-13.myshopify.com/products/${handle}?country=US&currency=USD&preview_theme_id=189701193927`:`http://127.0.0.1:4173/products/${handle}`;
 await Promise.all([source.goto(`https://haroldhome.co/products/${handle}?country=US&currency=USD`,{waitUntil:'domcontentloaded',timeout:60000}),target.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:60000})]);
 if(stage==='online'){await unlockStorefrontIfNeeded(target,targetUrl);if(new URL(target.url()).pathname!=='/products/'+handle)throw new Error('Target route was not restored after unlock');targetStorage=await target.context().storageState();}
 await Promise.all([source.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{}),target.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{})]);await target.waitForTimeout(1000);
 const prefix=`${type}-${viewport}`;const s=await capture(source,'source',prefix),t=await capture(target,'target',prefix);
 const checks={route:new URL(t.url).pathname==='/products/'+handle,market:s.currency==='USD'&&t.currency==='USD',price:s.priceText===t.priceText,titleSize:Math.abs(s.title.fontSize-t.title.fontSize)<.1,titleWeight:s.title.fontWeight===t.title.fontWeight,priceSize:Math.abs(s.price.fontSize-t.price.fontSize)<.1,priceWeight:s.price.fontWeight===t.price.fontWeight,selectHeight:Math.abs(s.select.height-t.select.height)<1,purchaseHeight:t.quantity.height===42&&t.submit.height===42,share:t.share.length===3&&t.share.every(n=>n.box.visible)&&t.share.every(n=>!n.href.includes('haroldhome.co')),overflow:!t.overflow,hatMedia:type!=='hat'||t.swatches.every(n=>n.loaded&&new URL(n.image).pathname.includes(n.value.toLowerCase()+'-front-')),arrows:(type==='hat'||viewport==='mobile')?t.arrows===0:t.arrows===2};
 if(stage==='online'){checks.build=t.build===build.id;checks.theme=t.themeId==='189701193927';checks.delivery=!!t.delivery;checks.payment=!!t.paymentText||t.paymentIcons.length>0;}
 const options=[];for(const value of ['Alaska','Alabama']){await Promise.all([source.locator('select[name="option-state"]').selectOption(value),target.locator('select[name="option-state"]').selectOption(value)]);options.push({value,source:await source.locator('select[name="option-state"]').inputValue(),target:await target.locator('select[name="option-state"]').inputValue()});}
 checks.options=options.every(n=>n.source===n.value&&n.target===n.value);
 const gallery=[];
 for(const index of [1,0]){
  await Promise.all([source.locator('.splide__slide[role="button"]').nth(index).press('Enter'),target.locator('[data-family-thumb]').nth(index).press('Enter')]);
  await target.waitForTimeout(500);
  await Promise.all([source.waitForFunction(()=>{const n=document.querySelector('li[id*="-main-slide"].is-active img');return n?.complete&&n.naturalWidth>0;},{},{timeout:15000}),target.waitForFunction(()=>{const n=document.querySelector('[data-family-slide]:not([hidden]) img');return n?.complete&&n.naturalWidth>0;},{},{timeout:15000})]);
  const media=await Promise.all([source.locator('li[id*="-main-slide"].is-active img').first().evaluate(n=>({src:n.currentSrc,loaded:!!n.naturalWidth})),target.locator('[data-family-slide]:not([hidden]) img').first().evaluate(n=>({src:n.currentSrc,loaded:!!n.naturalWidth}))]);
  gallery.push({index,action:'focus-thumbnail-and-press-enter',source:media[0],target:media[1]});
  await Promise.all([source.screenshot({path:path.join(folder,`${prefix}-source-gallery-${index}.png`),animations:'disabled'}),target.screenshot({path:path.join(folder,`${prefix}-target-gallery-${index}.png`),animations:'disabled'})]);
 }
 checks.gallery=gallery.every(g=>g.source.loaded&&g.target.loaded&&new URL(g.source.src).pathname.split('/').pop()===new URL(g.target.src).pathname.split('/').pop());
 const session={type,viewport,source:s,target:t,checks,options,gallery,passed:Object.values(checks).every(Boolean)};report.sessions.push(session);await fs.writeFile(path.join(folder,`${prefix}-session.json`),JSON.stringify(session,null,2));await fs.writeFile(path.join(folder,'progress.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({type,viewport,passed:session.passed,failed:Object.keys(checks).filter(k=>!checks[k])}));
 await source.close();await target.close();
}
try{
 const jobs=[['hat','home-state-dad-hat'],['wine-glass','home-state-wine-glass']].flatMap(([type,handle])=>Object.entries({desktop:{width:1920,height:1080},tablet:{width:768,height:1024},mobile:{width:390,height:844}}).map(([viewport,dimensions])=>({type,handle,viewport,dimensions})));
 let next=0;await Promise.all([0,1].map(async()=>{while(next<jobs.length){const job=jobs[next++];await runCase(job.type,job.handle,job.viewport,job.dimensions);}}));
 report.passed=report.sessions.every(s=>s.passed);
 report.unverified=['The source renders live payment and estimated delivery services. Target uses enabled payment types or an honest checkout fallback, and its own shipping policy rather than copied dates.'];
 await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
 for(const type of ['hat','wine-glass']){const panels=[];for(const viewport of ['desktop','tablet','mobile'])for(const side of ['source','target']){const input=await sharp(path.join(folder,`${type}-${viewport}-${side}.png`)).resize({width:460,height:1000,fit:'contain',background:'white'}).png().toBuffer();panels.push(input);}await sharp({create:{width:920,height:3000,channels:3,background:'white'}}).composite(panels.map((input,i)=>({input,left:i%2*460,top:Math.floor(i/2)*1000}))).png().toFile(path.join(folder,`${type}-paired.png`));}
 console.log('REPAIR_REVIEW',stage,'passed='+report.passed,folder);
}finally{await browser.close();}
