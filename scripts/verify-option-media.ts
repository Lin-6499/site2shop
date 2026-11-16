import { chromium } from 'playwright';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderPreview, serve } from '../src/preview.js';
import { mediaIdentity, validateOptionMediaContracts, type OptionMediaContract } from '../src/option-media-theme.js';
import { hash } from '../src/util.js';
import { unlockStorefrontIfNeeded } from '../src/storefront-auth.js';
import { compareOptionObservation, catalogAssetKey } from '../src/option-media-gate.js';

const out=resolve(process.argv[2]||'../westandwillow-phase3');
const online=process.argv.includes('--online');
const deployment=online?JSON.parse(await readFile(join(out,'deployment.json'),'utf8')):null;
const contract:OptionMediaContract=JSON.parse(await readFile(join(out,'option-media-contracts.json'),'utf8'));
const binding=JSON.parse(await readFile(join(out,'phase3-product-template-binding.json'),'utf8'));
const consumers=binding.products.filter((p:any)=>p.templateSuffix==='s2s-embroidered').map((p:any)=>p.handle);
validateOptionMediaContracts(contract,consumers);
if(!online)await renderPreview(out,consumers);
const local=online?null:await serve(out);
const browser=await chromium.launch({headless:true});
const folder=online?'option-media-online':'option-media-acceptance';
const root=join(out,folder);await mkdir(root,{recursive:true});
const aliasCache=new Map<string,any>();
if(online)for(const name of await readdir(root))if(/-catalog(?:-\d+)?\.json$/.test(name)){
 const previous=JSON.parse(await readFile(join(root,name),'utf8'));
 for(const alias of previous.imageAliases||[]){
  if(hash(await readFile(join(out,alias.aliasProof)))===alias.aliasSha256&&alias.aliasSha256===alias.canonicalSha256)aliasCache.set(alias.canonical+'|'+alias.alias,alias);
 }
}
async function proveAlias(request:any,canonical:URL,alias:URL){
 const cacheKey=canonical.href+'|'+alias.href;
 if(aliasCache.has(cacheKey))return aliasCache.get(cacheKey);
 const canonicalFetch=new URL(canonical.href),aliasFetch=new URL(alias.href);
 // Compare identical explicit renditions; multi-megabyte originals are not needed
 // to establish the CDN alias, and the observed full-size image is decoded separately.
 canonicalFetch.searchParams.set('width','320');aliasFetch.searchParams.set('width','320');
 const responses=await Promise.all([request.get(canonicalFetch.href,{timeout:60000}),request.get(aliasFetch.href,{timeout:60000})]);
 if(responses.some(r=>!r.ok()))throw Error('Catalog alias proof download failed');
 const buffers=await Promise.all(responses.map(r=>r.body()));
 const hashes=buffers.map(hash);
 if(hashes[0]!==hashes[1])throw Error('Catalog alias content differs');
 const proof=`${folder}/media-proof-${hashes[0]}.bin`;await writeFile(join(out,proof),buffers[0]);
 const record={canonical:canonical.href,alias:alias.href,canonicalFetchUrl:canonicalFetch.href,aliasFetchUrl:aliasFetch.href,renditionWidth:320,canonicalSha256:hashes[0],aliasSha256:hashes[1],canonicalProof:proof,aliasProof:proof};
 aliasCache.set(cacheKey,record);return record;
}
const build=JSON.parse(await readFile(join(out,'theme-build.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(out,'option-media-build.json'),'utf8'));
const report:any={schemaVersion:1,stage:'preflight',buildId:build.id,sourceSha256:hash(await readFile(join(out,'option-media-contracts.json'))),consumers,cases:[],limitations:['Local Liquid rendering is not online Shopify acceptance.','Scope: variant option presentation and media; does not accept unrelated page components or conditional paid add-ons.']};
if(online){report.stage='scoped-online';report.themeId=deployment.themeId;report.store=deployment.store;report.catalogs={};report.limitations=['Authorized scoped draft repair, not a full-theme release pass.','Scope: variant options and media; unrelated workflows remain unaccepted.'];}
if(online){
 const deltaBytes=await readFile(join(out,'option-media-draft-deployment.json')),delta=JSON.parse(deltaBytes.toString());
 if(delta.localBuildId!==build.id||delta.themeId!==deployment.themeId||!delta.remoteReadbackVerified||delta.published!==false||manifest.files.some((file:any)=>!delta.files.some((sent:any)=>sent.name===file.name&&sent.sha256===file.sha256)))throw Error('Scoped draft delta is stale or unverified');
 report.authorizedDeltaSha256=hash(deltaBytes);report.notFullSiteAcceptance=true;report.published=false;
}
const localCatalog=JSON.parse(await readFile(join(out,'phase3-content-plan.json'),'utf8'));
const previous=online&&process.argv.includes('--resume')?await readFile(join(root,'report.json'),'utf8').then(JSON.parse).catch(()=>null):null;
const canResume=previous&&previous.buildId===report.buildId&&previous.sourceSha256===report.sourceSha256&&previous.authorizedDeltaSha256===report.authorizedDeltaSha256;
let completed=false;
try{
 for(const handle of consumers){
  const source=contract.products[handle];
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
   const samples=source.observations.filter(o=>o.viewport.width===viewport.width);
   const old=canResume?previous.cases.filter((c:any)=>c.handle===handle&&c.width===viewport.width):[];
   const catalogRef=canResume?previous.catalogs?.[`${handle}-${viewport.width}`]:null;
   if(catalogRef&&old.length===samples.length&&old.every((c:any)=>!c.failures.length)){
    const catalogBytes=await readFile(join(out,catalogRef.path));if(hash(catalogBytes)!==catalogRef.sha256)throw Error('Resume catalog hash mismatch');
    for(const entry of old){const bytes=await readFile(join(out,entry.artifact));if(hash(bytes)!==entry.sha256||JSON.stringify(JSON.parse(bytes.toString()).source)!==JSON.stringify(samples[entry.step]))throw Error('Resume observation hash/source mismatch');}
    report.cases.push(...old);report.catalogs[`${handle}-${viewport.width}`]=catalogRef;report.catalogs[handle]=catalogRef;
    console.log(`${handle} ${viewport.width}: reused ${old.length} current, hash-verified observations`);continue;
   }
   const page=await browser.newPage({viewport});
   const url=online?`https://${deployment.store}/products/${handle}?preview_theme_id=${deployment.themeId}`:`${local!.url}/products/${handle}`;
   await page.goto(url,{waitUntil:'load'});
   if(online)await unlockStorefrontIfNeeded(page,url);
   if(new URL(page.url()).pathname!==`/products/${handle}`)throw Error('Invalid target route');
   await page.locator('[data-option-media-ready="true"]').waitFor();
   const area=page.locator('[data-s2s-option-contract-required]');
   const groups=area.locator('[data-s2s-option-group]');
   let catalog=localCatalog.records.find((r:any)=>r.handle===handle&&r.kind==='product')?.sourceSnapshot;
   if(online){
    const api=await page.request.get(`https://${deployment.store}/products/${handle}.js`);
    if(!api.ok())throw Error('Target catalog read failed');
    catalog={...await api.json(),url:api.url(),imageAliases:[]};
    const needed=catalog.images.filter((img:string)=>samples.some(s=>mediaIdentity(s.main)===mediaIdentity(img)));
    for(let start=0;start<needed.length;start+=6)await Promise.all(needed.slice(start,start+6).map(async(img:string)=>{
     const canonical=new URL(img,'https://'+deployment.store),alias=new URL('https://'+deployment.store+'/cdn/shop/files/'+canonical.pathname.split('/').pop()+canonical.search);
     catalog.imageAliases.push(await proveAlias(page.request,canonical,alias));
    }));
   }
   for(let step=0;step<samples.length;step++){
    const sample=samples[step],selected=sample.selected;
    for(let i=0;i<selected.length;i++){
     const input=groups.nth(i).locator(`input[value=${JSON.stringify(selected[i])}]`);
     if(!(await input.isChecked())){const id=await input.getAttribute('id');await area.locator(`label[for=${JSON.stringify(id)}]`).click();}
    }
    await page.waitForFunction(()=>!document.querySelector('[data-s2s-option-contract-required]')?.hasAttribute('aria-busy'));
    const main=area.locator('[data-family-slide]:not([hidden]) img');
    await main.scrollIntoViewIfNeeded();
    await main.evaluate((img:HTMLImageElement)=>Promise.race([img.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,8000))]));
    for(const img of await groups.locator('label img').all()){
     if(await img.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0))continue;
     await img.scrollIntoViewIfNeeded();
     await img.evaluate((node:HTMLImageElement)=>Promise.race([node.decode().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,4000))]));
    }
    const data=await area.evaluate(el=>{
     const form=el.querySelector('form')!;
     const variants=JSON.parse(form.querySelector('[data-s2s-variants]')?.textContent||'[]');
     const selected=[...form.querySelectorAll('[data-s2s-option-group]')].map(g=>g.querySelector<HTMLInputElement>('input:checked')?.value);
     const expected=variants.find((v:any)=>JSON.stringify(v.options)===JSON.stringify(selected));
     const img=el.querySelector<HTMLImageElement>('[data-family-slide]:not([hidden]) img');
     return {url:location.href,selected,variantId:el.getAttribute('data-s2s-selected-variant'),expectedVariant:expected,price:el.querySelector('[data-s2s-price]')?.textContent,buttonDisabled:el.querySelector<HTMLButtonElement>('[data-s2s-submit]')?.disabled,error:el.getAttribute('data-option-media-error'),main:img?.src,mainLoaded:!!img?.naturalWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,controls:[...form.querySelectorAll<HTMLInputElement>('input[data-s2s-option]')].map(input=>{const label=input.labels?.[0],b=label?.getBoundingClientRect(),img=label?.querySelector('img');return {value:input.value,group:input.dataset.s2sOption,checked:input.checked,width:b?.width,height:b?.height,asset:img?.src,assetLoaded:img?img.naturalWidth>0:true}})};
    });
    (data as any).buildId=await page.locator('meta[name="site2shop-build-id"]').getAttribute('content');
    (data as any).viewport=page.viewportSize();
    const disabledStates=await groups.locator('input[data-s2s-option]').evaluateAll(inputs=>inputs.map(e=>(e as HTMLInputElement).disabled));
    data.controls.forEach((c:any,i:number)=>c.disabled=disabledStates[i]);
    const positions=await groups.locator('input[data-s2s-option]').evaluateAll(inputs=>inputs.map(e=>{const b=(e as HTMLInputElement).labels?.[0]?.getBoundingClientRect();return {x:b?.x,y:b?.y}}));
    data.controls.forEach((c:any,i:number)=>Object.assign(c,positions[i]));
    (data as any).themeId=online?await page.evaluate(()=>((globalThis as any).Shopify?.theme?.id||null)):null;
    (data as any).canonical=online?await page.locator('link[rel="canonical"]').getAttribute('href'):null;
    const failures:string[]=[];
    if(JSON.stringify(data.selected)!==JSON.stringify(selected))failures.push('selected tuple');
    if(data.error)failures.push(data.error);
    if(mediaIdentity(data.main||'')!==mediaIdentity(sample.main||''))failures.push('semantic main image');
    if(!data.mainLoaded)failures.push('main image not loaded');
    if(!data.expectedVariant||String(data.expectedVariant.id)!==data.variantId)failures.push('target variant binding');
    if(data.expectedVariant&&Math.abs(Number(data.price?.replace(/[^\d.]/g,''))*100-data.expectedVariant.price)>.01)failures.push('target price');
    if(data.buttonDisabled===data.expectedVariant?.available)failures.push('availability');
    if(step>0&&new URL(data.url).searchParams.get('variant')!==data.variantId)failures.push('variant URL');
    if(data.overflow)failures.push('horizontal overflow');
    for(let group=0;group<source.groups.length;group++)for(const value of source.groups[group].values){
     const controls=data.controls.filter(c=>Number(c.group)===group&&c.value===value.value);
     if(controls.length!==1)failures.push(`missing semantic control ${group}/${value.value}`);
     else if(value.asset&&mediaIdentity(controls[0].asset||'')!==manifest.assetNames[value.asset])failures.push(`wrong semantic swatch ${group}/${value.value}`);
    }
    for(const c of data.controls){
     const original=sample.controls.find((v:any)=>v.value===c.value);
     if(original?.label&&(Math.abs(original.label.width-(c.width||0))>3||Math.abs(original.label.height-(c.height||0))>3))failures.push(`control dimensions: ${c.value}`);
     if(!c.assetLoaded)failures.push(`unloaded option asset: ${c.value}`);
    }
    if(online&&data.main&&!catalog.images.some((img:any)=>catalogAssetKey(img)===catalogAssetKey(data.main))&&!catalog.imageAliases.some((a:any)=>catalogAssetKey(a.alias)===catalogAssetKey(data.main))){
     const candidates=catalog.images.filter((img:string)=>mediaIdentity(img)===mediaIdentity(data.main!));
     if(candidates.length===1){
      // Shopify serves the same product bytes through both the API CDN and storefront proxy.
      // Prove the alias using original bytes, never merely a matching basename.
      const canonical=new URL(candidates[0],'https://'+deployment.store);
      const alias=new URL(data.main);for(const key of [...alias.searchParams.keys()])if(key!=='v')alias.searchParams.delete(key);
      if(alias.hostname!==deployment.store)throw Error('Unexpected asset alias host');
      catalog.imageAliases.push(await proveAlias(page.request,canonical,alias));
     }
    }
    failures.push(...compareOptionObservation(sample,data,catalog.variants,catalog.images,catalog.imageAliases));
    if(online&&String((data as any).themeId)!==String(deployment.themeId))failures.push('wrong draft theme');
    if(online&&new URL((data as any).canonical||data.url).pathname!==`/products/${handle}`)failures.push('wrong canonical route');
    const id=`${handle}-${viewport.width}-${step}`;
    const artifact=`${folder}/${id}.json`;
    const bytes=JSON.stringify({source:sample,target:data},null,2);await writeFile(join(out,artifact),bytes);
    report.cases.push({id,handle,width:viewport.width,step,selected,artifact,sha256:hash(bytes),failures});
    if(step===0||step===samples.length-1)await area.locator('.s2s-family-details').screenshot({path:join(root,`${id}.png`)});
   }
   if(online){const path=`${folder}/${handle}-catalog-${viewport.width}.json`,bytes=JSON.stringify(catalog,null,2);await writeFile(join(out,path),bytes);report.catalogs[`${handle}-${viewport.width}`]={path,sha256:hash(bytes)};report.catalogs[handle]={path,sha256:hash(bytes)};}
   console.log(`${handle} ${viewport.width}: ${report.cases.filter((c:any)=>c.handle===handle&&c.width===viewport.width&&c.failures.length).length}/${samples.length} failed`);
   await page.close();
  }
 }
 completed=true;
}finally{await browser.close();local?.server.close();report.expectedCaseCount=consumers.reduce((sum:number,handle:string)=>sum+contract.products[handle].observations.length,0);report.completed=completed;report.passed=completed&&report.cases.length===report.expectedCaseCount&&report.cases.every((c:any)=>!c.failures.length);await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));}
if(!report.passed)process.exitCode=1;
