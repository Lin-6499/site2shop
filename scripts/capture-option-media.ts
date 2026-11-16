import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// Project adapter: discover consumers from template bindings, not a representative handle.
const out = resolve(process.argv[2] || '../westandwillow-phase3');
const initialOnly = process.argv.includes('--initial');
const root = join(out, 'option-media-evidence');
const bindings = JSON.parse(await readFile(join(out, 'phase3-product-template-binding.json'), 'utf8'));
const handles: string[] = bindings.products.filter((p: any) => p.templateSuffix === 's2s-embroidered').map((p: any) => p.handle);
const viewports = [{name:'desktop',width:1440,height:1000},{name:'tablet',width:768,height:1024},{name:'mobile',width:390,height:844}];
const plan = {schemaVersion:1,collectorVersion:'option-media-1',scope:'option presentation and media transitions',handles,viewports,groups:'every rendered variant group',transitions:'all individual values plus every color/style tuple, reverse to baseline',limits:{maxActionsPerRoute:180,maxMinutesPerRoute:12}};
await mkdir(root,{recursive:true});
await writeFile(join(root,'plan.json'),JSON.stringify(plan,null,2));
const contracts:any = initialOnly ? JSON.parse(await readFile(join(out,'option-media-contracts.json'),'utf8')) : {schemaVersion:1,planSha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),products:{}};
const browser = await chromium.launch({headless:true});
try {
 for(const handle of handles){
  const context=await browser.newContext();
  const page=await context.newPage();
  const url=`https://westandwillow.com/products/${handle}`;
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#product-content-area input[name^="option-"]').first().waitFor({state:'attached'});
  const raw=await page.locator('script').allTextContents();
  const text=raw.find(t=>t.includes('Shopify.current_product = Object.assign'));
  const match=text?.match(/Shopify\.current_product = Object\.assign\(\{\}, (\{[^\n]+\})\);/);
  if(!match)throw Error(`${handle}: rendered product JSON missing`);
  const product=JSON.parse(match[1]);
  for(const img of await page.locator('#product-content-area label img').all()){
   if(!(await img.isVisible()))continue;
   await img.scrollIntoViewIfNeeded({timeout:3000}).catch(()=>{});
   await img.evaluate((node:HTMLImageElement)=>Promise.race([node.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,3000))]));
  }
  const groups=await page.locator('#product-content-area').evaluate(el=>{
   const result:any[]=[];
   for(const input of el.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="option-"]')){
    let group=result.find(g=>g.name===input.name);
    if(!group){group={name:input.name,values:[]};result.push(group)}
    const label=input.labels?.[0],img=label?.querySelector('img');
    const fallback=label?.querySelector('.color-swatch-fallback');
    group.values.push({value:input.value,id:input.id,kind:fallback?'color':img?'image':'text',asset:img&&img.naturalWidth>0&&getComputedStyle(img).display!=='none'?img.src:null,color:fallback?getComputedStyle(fallback).backgroundColor:null,checked:input.checked,disabled:input.disabled});
   }return result;
  });
  if(!groups.length)throw Error(`${handle}: no groups`);
  const names=product.options.map((x:any)=>typeof x==='string'?x:x.name);
  const variantMedia:any={};
  for(const variant of product.variants){
   const src=variant.featured_image?.src;
   const index=src?product.images.findIndex((img:any)=>String(img).split('?')[0]===String(src).split('?')[0]):-1;
   variantMedia[variant.options.join('\u001f')]=index>=0?index:null;
  }
  const productDir=join(root,handle);await mkdir(productDir,{recursive:true});
  await writeFile(join(productDir,'product.json'),JSON.stringify(product,null,2));
  const observations:any[]=[];
  const baseline=groups.map((g:any)=>g.values.find((v:any)=>v.checked)?.value||g.values[0].value);
  const scenarios:string[][]=[baseline];
  groups.forEach((g:any,i:number)=>g.values.forEach((v:any)=>{const tuple=[...baseline];tuple[i]=v.value;scenarios.push(tuple)}));
  const color=names.findIndex((n:string)=>n.toLowerCase()==='color'),style=names.findIndex((n:string)=>n.toLowerCase()==='embroidery style');
  if(color>=0&&style>=0)for(const c of groups[color].values)for(const s of groups[style].values){const tuple=[...baseline];tuple[color]=c.value;tuple[style]=s.value;scenarios.push(tuple)}
  const unique=[...new Map(scenarios.map(t=>[JSON.stringify(t),t])).values()];unique.push(baseline);
  for(const viewport of viewports){
   await page.setViewportSize({width:viewport.width,height:viewport.height});
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.locator('#product-content-area input[name^="option-"]').first().waitFor({state:'attached'});
   await page.evaluate(()=>document.fonts.ready);
   for(const img of await page.locator('#product-content-area label img').all()){
    if(!(await img.isVisible()))continue;
    await img.scrollIntoViewIfNeeded({timeout:3000}).catch(()=>{});
    await img.evaluate((node:HTMLImageElement)=>Promise.race([node.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,3000))]));
   }
   for(let step=0;step<(initialOnly?1:unique.length);step++){
    const tuple=unique[step];
    for(let i=0;i<groups.length;i++){
     const selected=await page.locator(`input[name="${groups[i].name}"]:checked`).inputValue();
     if(selected!==tuple[i]){
      const choice=groups[i].values.find((v:any)=>v.value===tuple[i]);
      await page.locator(`label[for="${choice.id}"]`).click();
     }
    }
    await page.waitForTimeout(220);
    const data=await page.evaluate(()=>{
     const area=document.querySelector('#product-content-area')!;
     const img=document.querySelector<HTMLImageElement>('.main-splide .splide__slide.is-active img');
     return {url:location.href,canonical:document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,viewport:{width:innerWidth,height:innerHeight},selected:[...area.querySelectorAll<HTMLInputElement>('input[name^="option-"]:checked')].map(e=>e.value),main:img?.src,mainAlt:img?.alt,controls:[...area.querySelectorAll<HTMLInputElement>('input[name^="option-"]')].map(e=>{const label=e.labels?.[0],b=label?.getBoundingClientRect(),s=label?getComputedStyle(label):null;return {value:e.value,checked:e.checked,disabled:e.disabled,label:b&&s?{width:b.width,height:b.height,x:b.x,y:b.y,display:s.display,gap:s.gap,padding:s.padding,border:s.border,borderRadius:s.borderRadius,font:s.font}:null}}),bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};
    });
    if(new URL(data.url).pathname!==`/products/${handle}`||JSON.stringify(data.selected)!==JSON.stringify(tuple))throw Error(`${handle} ${viewport.name} ${step}: route/selection mismatch`);
    const name=`${viewport.name}-${step}`;
    await writeFile(join(productDir,`${name}.json`),JSON.stringify(data,null,2));
    // Every style and every color combination retains a rendered result, not just an asset URL.
    await page.locator('#product-content-area').screenshot({path:join(productDir,`${name}.png`)});
    observations.push({formFactor:viewport.name,tuple,...data,evidence:`option-media-evidence/${handle}/${name}.json`});
   }
   console.log(`${handle} ${viewport.name}: ${unique.length} transitions`);
  }
  const completeObservations=initialOnly?contracts.products[handle].observations.map((old:any)=>observations.find(o=>o.evidence===old.evidence)||old):observations;
  contracts.products[handle]={source:url,options:names,groups,images:product.images,variantMedia,observations:completeObservations};
  await writeFile(join(out,'option-media-contracts.json'),JSON.stringify(contracts,null,2));
  await context.close();
 }
}finally{await browser.close()}
console.log(`Captured ${handles.length} consumers`);
