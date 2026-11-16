import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {unlockStorefrontIfNeeded} from '../.codex-build/src/storefront-auth.js';
const dir='../haroldhome-replication-20261022-v2/pop-art-repair';await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
try {for(const side of ['source','target']){
const page=await browser.newPage({viewport:{width:1345,height:960}});
const url=side==='source'?'https://haroldhome.co/products/custom-pop-art':'https://azhiip-13.myshopify.com/products/custom-pop-art?preview_theme_id=189701193927';
await page.goto(url,{waitUntil:'domcontentloaded'});if(side==='target')await unlockStorefrontIfNeeded(page,url);await page.waitForTimeout(1800);
await fs.writeFile(`${dir}/${side}.html`,await page.content());
const data=await page.evaluate(async()=>({url:location.href,theme:window.Shopify?.theme,text:document.querySelector('#product-content-area')?.innerText,inputs:[...document.querySelectorAll('#product-content-area input[type="radio"]')].map(n=>({name:n.name,value:n.value,id:n.id,checked:n.checked,label:document.querySelector(`label[for="${n.id}"]`)?.innerText})),scripts:[...document.scripts].map(n=>n.src).filter(Boolean),product:await fetch('/products/custom-pop-art.js').then(r=>r.json())}));
await fs.writeFile(`${dir}/${side}.json`,JSON.stringify(data,null,2));console.log(side,JSON.stringify({theme:data.theme,options:data.product.options,variants:data.product.variants.slice(0,5).map(v=>({options:v.options,featured_image:v.featured_image})),text:data.text?.slice(0,1300)}));
await page.screenshot({path:`${dir}/${side}-initial.png`});await page.close();
}}finally{await browser.close();}
