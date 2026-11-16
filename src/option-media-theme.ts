import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const mediaIdentity = (url: string) => decodeURIComponent(new URL(url, 'https://asset.invalid').pathname.split('/').pop() || '').replace(/_\d+x\d*(?:_crop_[a-z]+)?(?=\.)/, '').toLowerCase();
export type OptionMediaContract = {schemaVersion:1;planSha256:string;products:Record<string,{
 source:string;options:string[];groups:Array<{name:string;values:Array<{value:string;kind:'text'|'image'|'color';asset:string|null;color:string|null}>}>;
 images:string[];variantMedia:Record<string,number|null>;observations:any[];
}>};

export function validateOptionMediaContracts(contract:OptionMediaContract, consumers:string[]) {
 const errors:string[]=[];
 if(contract.schemaVersion!==1||!contract.planSha256)errors.push('Missing option/media contract version or plan');
 for(const handle of consumers){
  const p=contract.products[handle];
  if(!p){errors.push(`${handle}: missing consumer`);continue}
  if(!p.groups.length||p.groups.length!==p.options.length)errors.push(`${handle}: incomplete option groups`);
  for(const g of p.groups)for(const v of g.values){
   if(!['text','image','color'].includes(v.kind))errors.push(`${handle}: missing presentation kind ${v.value}`);
   if(v.kind==='image'&&!v.asset)errors.push(`${handle}: missing semantic option asset ${v.value}`);
   if(v.kind==='color'&&!v.asset&&!v.color)errors.push(`${handle}: missing color treatment ${v.value}`);
  }
  for(const [tuple,index] of Object.entries(p.variantMedia))if(index!==null&&(!Number.isInteger(index)||!p.images[index]))errors.push(`${handle}: unresolved variant media ${tuple}`);
  for(const width of [1440,768,390]){
   const samples=p.observations.filter(o=>o.viewport?.width===width);
   if(!samples.length){errors.push(`${handle}: missing viewport ${width}`);continue}
   if(samples.length<2||JSON.stringify(samples[0].selected)!==JSON.stringify(samples.at(-1).selected))errors.push(`${handle}: missing reverse to baseline at ${width}`);
   for(let group=0;group<p.groups.length;group++)for(const value of p.groups[group].values){
    if(!samples.some(o=>o.selected[group]===value.value))errors.push(`${handle}: ${width} untested ${p.options[group]}=${value.value}`);
   }
   // This project adapter observed a color/style dependency. Its denominator
   // comes from the source option inventory, never successful target samples.
   const color=p.options.findIndex(n=>n.toLowerCase()==='color'),style=p.options.findIndex(n=>n.toLowerCase()==='embroidery style');
   if(color>=0&&style>=0)for(const c of p.groups[color].values)for(const s of p.groups[style].values){
    if(!samples.some(o=>o.selected[color]===c.value&&o.selected[style]===s.value))errors.push(`${handle}: missing dependent tuple ${width}/${c.value}/${s.value}`);
   }
   for(const sample of samples.slice(1)){
    const key=sample.selected.join('\u001f'),index=p.variantMedia[key];
    if(index===undefined)errors.push(`${handle}: source tuple missing ${key}`);
    else if(index!==null&&mediaIdentity(p.images[index])!==mediaIdentity(sample.main||''))errors.push(`${handle}: source media association differs at ${width}: ${key}`);
   }
  }
 }
 if(errors.length)throw Error(`Option/media evidence rejected:\n${errors.join('\n')}`);
}

const literal=(s:string)=>`'${s.replace(/'/g,'&#39;')}'`;
export async function buildOptionMediaArtifacts(out:string, contract:OptionMediaContract, consumers:string[]) {
 validateOptionMediaContracts(contract,consumers);
 const assetRoot=join(out,'option-media-assets');await mkdir(assetRoot,{recursive:true});
 const assets:Record<string,Buffer>={},assetNames:Record<string,string>={};
 for(const handle of consumers)for(const group of contract.products[handle].groups)for(const value of group.values){
  if(!value.asset||assetNames[value.asset])continue;
  const url=new URL(value.asset);
  if(url.protocol!=='https:'||url.hostname!==new URL(contract.products[handle].source).hostname)throw Error('Unapproved option asset origin');
  const ext=url.pathname.endsWith('.png')?'png':'jpg';
  const cacheName=createHash('sha256').update(value.asset).digest('hex').slice(0,20)+'.'+ext;
  let bytes=await readFile(join(assetRoot,cacheName)).catch(()=>null);
  if(!bytes){const response=await fetch(url);if(!response.ok)throw Error(`Option asset failed ${response.status}: ${url}`);bytes=Buffer.from(await response.arrayBuffer());await writeFile(join(assetRoot,cacheName),bytes)}
  if(!bytes.length)throw Error('Empty option asset');
  const name='s2s-option-'+createHash('sha256').update(bytes).digest('hex').slice(0,20)+'.'+ext;
  assets[name]=bytes;assetNames[value.asset]=name;
 }
 const visualOptionDocs=consumers.length
  ? `\n@param {string} option_name - Observed option name.\n@param {string} option_value - Observed option value.`
  : '';
 let visual=`{% doc %}\n@param {product} product - Current product.${visualOptionDocs}\n{% enddoc %}\n{% case product.handle %}`;
 let data=`{% doc %}\n@param {product} product - Current product.\n{% enddoc %}\n<script type="application/json" data-s2s-option-contract>{% case product.handle %}`;
 for(const handle of consumers){
  const p=contract.products[handle];
  visual+=`{% when ${literal(handle)} %}{% case option_name %}`;
  p.groups.forEach((group,i)=>{
   visual+=`{% when ${literal(p.options[i])} %}{% case option_value %}`;
   for(const value of group.values){
    visual+=`{% when ${literal(value.value)} %}`;
    if(value.asset)visual+=`<img src="{{ ${literal(assetNames[value.asset])} | asset_url }}" width="120" height="120" alt="" loading="lazy">`;
    else if(value.color)visual+=`<span class="s2s-contract-color" style="background:${value.color}"></span>`;
   }
   visual+='{% endcase %}';
  });
  visual+='{% endcase %}';
  const media=Object.fromEntries(Object.entries(p.variantMedia).map(([key,i])=>[key,i===null?null:mediaIdentity(p.images[i])]));
  const runtime={schemaVersion:1,handle,options:p.options,media,assets:p.groups.map(g=>g.values.map(v=>({value:v.value,asset:v.asset?assetNames[v.asset]:null,color:v.color}))),contractHash:createHash('sha256').update(JSON.stringify(p)).digest('hex')};
  data+=`{% when ${literal(handle)} %}${JSON.stringify(runtime).replace(/</g,'\\u003c')}`;
 }
 visual+='{% endcase %}';data+='{% else %}null{% endcase %}</script>';
 return {visual,data,assets,assetNames};
}

export const optionMediaScript=String.raw`(()=>{
 const identity=url=>{try{return decodeURIComponent(new URL(url,location.href).pathname.split('/').pop()||'').replace(/_\d+x\d*(?:_crop_[a-z]+)?(?=\.)/,'').toLowerCase()}catch{return ''}};
 document.querySelectorAll('[data-s2s-option-contract-required]').forEach(root=>{
  if(root.dataset.optionMediaReady)return;
  const form=root.querySelector('form');let contract;try{contract=JSON.parse(root.querySelector('[data-s2s-option-contract]')?.textContent||'null')}catch{}
  if(!form||!contract){root.dataset.optionMediaError='missing-contract';return}
  root.dataset.optionMediaReady='true';
  const groups=[...form.querySelectorAll('[data-s2s-option-group]')];
  const update=()=>{
   const values=groups.map(g=>g.querySelector('input:checked')?.value||g.querySelector('select')?.value||'');
   const key=values.join('\u001f'),media=contract.media[key];
   if(media===undefined){root.dataset.optionMediaError='unmapped-tuple';return}
   delete root.dataset.optionMediaError;
   if(media!==null){
    const slides=[...root.querySelectorAll('[data-family-slide]')];
    const index=slides.findIndex(s=>identity(s.querySelector('img')?.getAttribute('src'))===media);
    if(index<0){root.dataset.optionMediaError='missing-media:'+media;return}
    root.dispatchEvent(new CustomEvent('s2s:media:show',{detail:{index}}));
   }
   const variant=root.dataset.s2sSelectedVariant;
   if(variant){const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url)}
  };
  form.addEventListener('change',event=>{if(event.target.matches('[data-s2s-option]'))update()});
  // The source starts on its editorial hero until an option is changed.
  // Deep links are different: select the target-store variant tuple, never a source ID.
  const requested=new URL(location.href).searchParams.get('variant');
  if(requested){let variants=[];try{variants=JSON.parse(form.querySelector('[data-s2s-variants]')?.textContent||'[]')}catch{}
   const variant=variants.find(v=>String(v.id)===requested);
   if(variant){groups.forEach((g,i)=>g.querySelectorAll('input[type="radio"]').forEach(input=>input.checked=input.value===variant.options[i]));const first=groups[0]?.querySelector('input:checked');first?.dispatchEvent(new Event('change',{bubbles:true}))}
  }
 });
})();`;

export const optionMediaStyles=String.raw`
[data-s2s-option-contract-required] .s2s-family-value--color{width:32px;height:32px;min-width:32px;padding:0;border:0;border-radius:50%;overflow:visible}
[data-s2s-option-contract-required] .s2s-family-value--color img,[data-s2s-option-contract-required] .s2s-contract-color{display:block;width:32px;height:32px;border-radius:50%;padding:1.6px}
[data-s2s-option-contract-required] .s2s-family-value--color img{object-fit:cover}
[data-s2s-option-contract-required] .s2s-family-option--color input:checked+label{background:transparent;box-shadow:0 0 0 1px #1b2b2c}
[data-s2s-option-contract-required] .s2s-family-value--visual{background:transparent!important;color:inherit!important;box-shadow:none!important}
[data-s2s-option-contract-required] .s2s-family-option-visual img{box-sizing:border-box;display:block;width:100%;height:100%;border:1px solid transparent;border-radius:16px;object-fit:contain}
[data-s2s-option-contract-required] input:checked+.s2s-family-value--visual .s2s-family-option-visual img{border-color:#1b2b2c}
[data-s2s-option-contract-required] .s2s-family-value--visual>span:last-child{opacity:.6;font-size:14px}
[data-s2s-option-contract-required] .s2s-family-value:not(.s2s-family-value--color):not(.s2s-family-value--visual){min-height:34px;height:34px;padding:4px 12px;line-height:24px}
[data-s2s-option-contract-required] .s2s-family-values{gap:8px}
[data-s2s-option-contract-required] .s2s-family-option--color .s2s-family-values{padding-inline:4px}
[data-s2s-option-contract-required] .s2s-family-value--color:has(.s2s-contract-color){width:35.2px;min-width:35.2px;height:42.2px;min-height:42.2px}
[data-s2s-option-contract-required] .s2s-contract-color{padding:0;margin:1.6px}
[data-s2s-option-contract-required] .s2s-family-option:has(.s2s-family-value--visual) .s2s-family-values{width:calc(100% + 8px);margin-inline:-4px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0}
[data-s2s-option-contract-required] .s2s-family-value--visual{width:calc(100% - 8px);max-width:120px;margin:4px;justify-self:start}
[data-s2s-option-contract-required] .s2s-family-option-visual{min-width:0;border:0;border-radius:16px;overflow:visible}
[data-s2s-option-contract-required] .s2s-family-value--color img,[data-s2s-option-contract-required] .s2s-family-option-visual img{box-shadow:0 2px 4px rgba(0,0,0,.125)}
[data-s2s-option-contract-required] .s2s-family-option legend{font-family:Lora,serif;font-size:14px;line-height:21px}
[data-s2s-option-contract-required] .s2s-family-option--color [data-option-label]{opacity:.6}
@media(max-width:991px){[data-s2s-option-contract-required] .s2s-family-option:has(.s2s-family-value--visual) .s2s-family-values{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
