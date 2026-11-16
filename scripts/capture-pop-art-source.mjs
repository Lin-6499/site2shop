import fs from 'node:fs/promises';import {chromium}from'playwright';
const dir='../haroldhome-replication-20261022-v2/pop-art-repair';const browser=await chromium.launch({headless:true});
try{for(const [viewport,size]of Object.entries({desktop:{width:1920,height:1080},tablet:{width:768,height:1024},mobile:{width:390,height:844}})){
const p=await browser.newPage({viewport:size});await p.goto('https://haroldhome.co/products/custom-pop-art',{waitUntil:'domcontentloaded'});await p.waitForTimeout(1500);
const results=[];const snap=async(action)=>{await p.waitForTimeout(500);const state=await p.evaluate(()=>{const im=document.querySelector('[id$="-main"] .splide__slide.is-active img');return {selected:[...document.querySelectorAll('#product-content-area input[type=radio]:checked')].map(n=>({name:n.name,value:n.value})),media:im?.currentSrc||im?.src,decoded:!!im?.naturalWidth,text:document.querySelector('#product-content-area').innerText}});results.push({action,...state});console.log(viewport,action,state.media?.split('/').pop()?.split('?')[0]);};
await snap('initial');for(const color of ['Lavender','Peony','Tangerine','Pistachio']){await p.locator(`label[for="option-color-${color.toLowerCase()}"]`).click();await snap('color:'+color);}
await p.locator('.btn-next:visible').click();await snap('next');await p.screenshot({path:`${dir}/source-${viewport}-step2.png`});
for(const frame of ['White','Birch','Walnut','Black']){await p.locator(`label[for="option-frame-${frame.toLowerCase()}"]`).click();await snap('frame:'+frame);}
for(const size of ['12x16','18x24','24x36','9x12']){await p.locator(`label[for="option-canvas-size-${size}"]`).click();await snap('size:'+size);}
await p.locator('label[for="framing-swicher-no-frame"]').click();await snap('no-frame');await p.locator('label[for="framing-swicher-framing"]').click();await snap('framing');
await p.locator('.btn-prev:visible').click();await snap('previous');await p.locator('.btn-next:visible').click();await snap('next-replay');await p.locator('.btn-next:visible').click();await snap('personalization');await p.screenshot({path:`${dir}/source-${viewport}-step3.png`});
await fs.writeFile(`${dir}/source-${viewport}-transitions.json`,JSON.stringify(results,null,2));await p.close();
}}finally{await browser.close();}
