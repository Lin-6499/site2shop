import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch();
try{
const page=await browser.newPage();
const results=[];
// Include actual nested swatch presentation, not only the label box.
await page.goto('https://westandwillow.com/products/custom-pet-embroidery-hoodie',{waitUntil:'domcontentloaded'});
await page.locator('#product-content-area input[name^="option-"]').first().waitFor({state:'attached'});
console.log('SWATCH_STYLE',JSON.stringify(await page.locator('#product-content-area').evaluate(el=>[...el.querySelectorAll<HTMLInputElement>('input[name^="option-"]')].filter(i=>['Black','Full Color','White Line'].includes(i.value)).map(i=>({value:i.value,nodes:[i.labels?.[0],...i.labels?.[0]?.querySelectorAll('*')||[]].map(e=>{if(!e)return null;const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,padding:s.padding,border:s.border,shadow:s.boxShadow,bg:s.backgroundColor,margin:s.margin}})})))));
for(const width of [1440,768,390]){
 await page.setViewportSize({width,height:1000});
 await page.goto('https://westandwillow.com/products/custom-pet-embroidery-hoodie',{waitUntil:'domcontentloaded'});
 await page.locator('#product-content-area input[name^="option-"]').first().waitFor({state:'attached'});
 results.push(await page.locator('#product-content-area').evaluate(el=>({width:innerWidth,groups:[...el.querySelectorAll<HTMLInputElement>('input:checked[name^="option-"]')].map(input=>({name:input.name,label:input.labels?.[0]?.outerHTML,ancestors:[input.labels?.[0],input.parentElement,input.parentElement?.parentElement,input.parentElement?.parentElement?.parentElement].map(e=>{if(!e)return null;const s=getComputedStyle(e),b=e.getBoundingClientRect();return {tag:e.tagName,cls:e.className,width:b.width,height:b.height,display:s.display,gap:s.gap,padding:s.padding,margin:s.margin,grid:s.gridTemplateColumns,maxWidth:s.maxWidth}})})),extras:[...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(e=>({id:e.id,html:e.parentElement?.outerHTML})),buttons:[...el.querySelectorAll('button')].map(e=>({text:e.textContent,attributes:[...e.attributes].map(a=>[a.name,a.value])}))})));
}
await writeFile('../westandwillow-phase3/option-media-evidence/layout-supplement.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}
