import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash } from './util.js';
import { readArtifact, evidenceRequire as requireEvidence } from './evidence-gate.js';
import { assertGeneratedThemeIntegrity } from './theme-integrity.js';
import { mediaIdentity, validateOptionMediaContracts, type OptionMediaContract } from './option-media-theme.js';

/** Recompute observed outcomes; report.passed is deliberately not trusted. */
export function catalogAssetKey(value:any){try{const url=new URL(typeof value==='string'?value:value.src,'https://asset.invalid');return url.hostname+url.pathname.replace(/_\d+x\d*(?:_crop_[a-z]+)?(?=\.)/,'')}catch{return ''}}
export function compareOptionObservation(source:any,target:any, variants:any[], images:any[], aliases:any[]=[]){
 const errors:string[]=[];
 if(JSON.stringify(target.selected)!==JSON.stringify(source.selected))errors.push('selected tuple differs');
 if(target.error)errors.push(target.error);
 if(mediaIdentity(target.main||'')!==mediaIdentity(source.main||''))errors.push('semantic main image differs');
 const assetKey=(value:any)=>{
  const key=catalogAssetKey(value);
  const alias=aliases.find(a=>catalogAssetKey(a.alias)===key&&a.aliasSha256===a.canonicalSha256&&/^[a-f0-9]{64}$/.test(a.aliasSha256)&&images.some(img=>catalogAssetKey(img)===catalogAssetKey(a.canonical))&&new URL(a.alias).hostname===new URL(target.url).hostname);
  return alias?catalogAssetKey(alias.canonical):key;
 };
 if(!target.main||!images.some(img=>assetKey(img)===assetKey(target.main)))errors.push('main image absent from independently captured catalog');
 const candidates=new Set(images.filter(img=>mediaIdentity(typeof img==='string'?img:img.src)===mediaIdentity(source.main||'')).map(assetKey));
 if(candidates.size!==1||!candidates.has(assetKey(target.main)))errors.push('ambiguous or wrong source-to-target media identity');
 if(!target.mainLoaded)errors.push('main image not loaded');
 const v=variants.find(v=>JSON.stringify(v.options)===JSON.stringify(source.selected));
 if(!v||String(v.id)!==target.variantId||JSON.stringify(v.options)!==JSON.stringify(target.selected))errors.push('variant binding');
 const price=typeof target.price==='string'?Number(target.price.replace(/[^\d.]/g,''))*100:NaN;
 if(!v||!Number.isFinite(price)||Math.abs(price-v.price)>.01)errors.push('price');
 if(!v||typeof target.buttonDisabled!=='boolean'||target.buttonDisabled===v.available)errors.push('availability');
 if(target.overflow!==false)errors.push('horizontal overflow');
 for(const c of target.controls||[]){
  const original=source.controls.find((s:any)=>s.value===c.value);
  if(!Number.isFinite(c.width)||!Number.isFinite(c.height)||!original?.label||Math.abs(original.label.width-c.width)>3||Math.abs(original.label.height-c.height)>3)errors.push(`control dimensions ${c.value}`);
  if(!Number.isFinite(c.x)||!Number.isFinite(original?.label?.x)||Math.abs(original.label.x-c.x)>3)errors.push(`control horizontal alignment ${c.value}`);
  if(c.checked!==(target.selected?.[Number(c.group)]===c.value))errors.push(`checked state ${c.value}`);
  if(typeof c.disabled!=='boolean'||c.disabled!==original?.disabled)errors.push(`disabled state ${c.value}`);
  if(!c.assetLoaded)errors.push(`unloaded option asset ${c.value}`);
 }
 if((target.controls||[]).length!==source.controls.length)errors.push('control coverage');
 return errors;
}

export async function assertOptionMediaAcceptance(out:string,stage:'preflight'|'online',routeIds?:string[]){
 const binding=JSON.parse(await readFile(join(out,'phase3-product-template-binding.json'),'utf8'));
 const consumers:string[]=binding.products.filter((p:any)=>p.templateSuffix==='s2s-embroidered').map((p:any)=>p.handle);
 if(!consumers.length)return {applicable:false};
 const scopePlan=routeIds?JSON.parse(await readFile(join(out,'capture-plan.json'),'utf8')):null;
 const scopedConsumers=routeIds?consumers.filter(handle=>routeIds.some(id=>new URL(scopePlan.routes[id].target.url).pathname.endsWith('/'+handle))):consumers;
 if(!scopedConsumers.length)return {applicable:false,reason:'No changed consumer; sealed baseline retains its option acceptance.'};
 const build=await assertGeneratedThemeIntegrity(out);
 const bytes=await readFile(join(out,'option-media-contracts.json'));
 const contract:OptionMediaContract=JSON.parse(bytes.toString());
 validateOptionMediaContracts(contract,consumers);
 const plan=JSON.parse(await readFile(join(out,'option-media-evidence/plan.json'),'utf8'));
 requireEvidence(JSON.stringify(plan.viewports.map((v:any)=>v.width).sort())===JSON.stringify([1440,768,390].sort()),'option viewport denominator incomplete');
 requireEvidence(hash(JSON.stringify(plan))===contract.planSha256,'option plan hash mismatch');
 requireEvidence(JSON.stringify([...plan.handles].sort())===JSON.stringify([...consumers].sort()),'option consumer inventory differs');
 const manifest=JSON.parse(await readFile(join(out,'option-media-build.json'),'utf8'));
 requireEvidence(manifest.contractHash===hash(bytes),'option build provenance stale');
 for(const file of manifest.files)requireEvidence(hash(await readFile(join(out,'theme',file.name)))===file.sha256,`option generated file changed: ${file.name}`);
 const report=JSON.parse(await readFile(join(out,stage==='online'?'option-media-online/report.json':'option-media-acceptance/report.json'),'utf8'));
 requireEvidence(report.stage===stage&&report.buildId===build.actual&&report.sourceSha256===hash(bytes),'option acceptance stale or wrong stage');
 if(stage==='online'){
  const deployment=JSON.parse(await readFile(join(out,'deployment.json'),'utf8'));
  requireEvidence(report.themeId===deployment.themeId&&report.store===deployment.store,'option online theme identity mismatch');
 }
 let count=0;
 const localCatalog=stage==='preflight'?JSON.parse(await readFile(join(out,'phase3-content-plan.json'),'utf8')):null;
 for(const handle of scopedConsumers){
  const p=contract.products[handle];
  const catalog=stage==='preflight'?localCatalog.records.find((r:any)=>r.handle===handle&&r.kind==='product')?.sourceSnapshot:await readArtifact(out,report.catalogs[handle]);
  requireEvidence(catalog?.variants?.length,'missing independent catalog evidence');
  if(stage==='online')requireEvidence(new URL(catalog.url).hostname===report.store,'catalog evidence from wrong store');
  for(const alias of catalog.imageAliases||[]){
   requireEvidence(hash(await readFile(join(out,alias.aliasProof)))===alias.aliasSha256&&hash(await readFile(join(out,alias.canonicalProof)))===alias.canonicalSha256&&alias.aliasSha256===alias.canonicalSha256,'unverified catalog asset alias');
  }
  for(const width of plan.viewports.map((v:any)=>v.width)){
   const samples=p.observations.filter(o=>o.viewport.width===width);
   for(let step=0;step<samples.length;step++){
    const sample=samples[step];
    const matching=report.cases.filter((c:any)=>c.handle===handle&&c.width===width&&c.step===step);
    requireEvidence(matching.length===1,`missing or duplicated option evidence ${handle}/${width}/${step}`);
    const entry=matching[0];
    const data=await readArtifact(out,{path:entry.artifact,sha256:entry.sha256});
    requireEvidence(data.target.buildId===build.actual,'option target artifact stale build');
    requireEvidence(data.target.viewport?.width===width,'option target viewport mismatch');
    if(stage==='online'){
     requireEvidence(new URL(data.target.url).hostname===report.store,'option online observation is not the intended storefront');
     requireEvidence(String(data.target.themeId)===String(report.themeId),'option online observation has no verified draft identity');
    }
    requireEvidence(JSON.stringify(data.source)===JSON.stringify(sample),'source sample was substituted');
    const errors=compareOptionObservation(sample,data.target,catalog.variants,catalog.images,catalog.imageAliases);
    requireEvidence(errors.length===0,`${handle}/${width}/${step}: ${errors.join('; ')}`);
    requireEvidence(new URL(data.target.url).pathname.endsWith(`/products/${handle}`),'option route mismatch');
    if(step>0)requireEvidence(new URL(data.target.url).searchParams.get('variant')===data.target.variantId,'option deep link mismatch');
    for(let group=0;group<p.groups.length;group++)for(const value of p.groups[group].values){
     const controls=data.target.controls.filter((c:any)=>Number(c.group)===group&&c.value===value.value);
     requireEvidence(controls.length===1,`missing semantic control ${handle}/${value.value}`);
     if(value.asset)requireEvidence(mediaIdentity(controls[0].asset||'')===manifest.assetNames[value.asset],`wrong-but-present option asset ${handle}/${value.value}`);
    }
    count++;
   }
  }
 }
 requireEvidence(report.cases.length===count,'unplanned option evidence');
 requireEvidence(count>0,'zero option observations');
 return {applicable:true,count,buildId:build.actual};
}
