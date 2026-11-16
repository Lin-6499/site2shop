import {dirname,join,resolve} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson,digest} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file),run=await jsonFile(join(root,'verification/recon-current/collection-development-source-run.json'));
const grid='div.min-h-screen > section:nth-of-type(5)',filters='div.min-h-screen > section:nth-of-type(3)';
const observations=new Map<string,any>();
for(const state of run.rows){
 if(!state.passed||state.rows.length!==3)throw Error(`Incomplete source collection state: ${state.state}`);
 const records=[];
 for(const row of state.rows){const d=JSON.parse((await readRef(root,row.structure)).toString());if(!d.sourceSessionCurrent||d.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Stale collection evidence');records.push({d,ref:row.structure,$:load(d.structure)});}
 observations.set(state.state,{state,...records[0],records});
}
const cardSelector=grid+' > div.grid > div';
const extract=(o:any)=>o.$(cardSelector).toArray().map((n:any,index:number)=>({index,id:o.$(n).find('a[href^="/product/"]').first().attr('href'),text:o.$(n).find('a[href^="/product/"]').last().text().replace(/\s+/g,' ').trim()}));
for(const o of observations.values()){const signatures=o.records.map((r:any)=>JSON.stringify(extract(r)));if(signatures.some((s:string)=>s!==signatures[0]))throw Error(`Collection differs across device data contexts: ${o.state.state}`);}
const initial=observations.get('initial'),cards=extract(initial);if(!cards.length||cards.some((c:any)=>!c.id))throw Error('Observed card selector does not cover initial grid');
const directory='staging/collections',templates:string[]=[],outputs:any[]=[];
const prepare=async(stateId:string,fragments:any[])=>{const o=observations.get(stateId),out=`${directory}/${stateId}`,recipe=`contracts/page-recipes/collection-${stateId}.json`;
 await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:o.state.sourcePath,outputDirectory:out,fragments:fragments.map(f=>({...f,observation:o.ref}))});await prepareComposerInputs(file,recipe);
 for(const f of fragments){const html=await readFile(join(root,out,f.id+'.htm'),'utf8');templates.push(`<template data-vr-collection-template="${stateId}-${f.id}">${html}</template>`);outputs.push({stateId,id:f.id});}
};
// Source grid remounts after controls change. Use the observed reset cards for
// dynamic renders; retain the separately observed first-load body (including
// any actual image fallback) for the initial state.
const resetCards=extract(observations.get('filter-reset'));
if(JSON.stringify(resetCards.map((c:any)=>c.id))!==JSON.stringify(cards.map((c:any)=>c.id)))throw Error('Initial/reset product ordering differs; an explicit order model is required');
await prepare('filter-reset',cards.map((c:any)=>({id:'card-'+c.index,selector:`${cardSelector}:nth-child(${c.index+1})`}))); 
await prepare('search-none',[{id:'empty',selector:grid+' > div'}]);
const categories:any[]=[];
for(const id of ['initial','category-peptides','category-capsules','category-gluta','category-aminos','category-kits','category-raws','category-supplies']){
 const o=observations.get(id);if(!o)throw Error(`Missing category ${id}`);const list=extract(o),isKit=id==='category-kits';
 await prepare(id,[{id:'grid',selector:grid},...(isKit?list.map((c:any)=>({id:'card-'+c.index,selector:`${cardSelector}:nth-child(${c.index+1})`})) : [])]);
 const label=id==='initial'?null:id.slice(9),query=new URL(o.state.sourcePath,project.sourceUrl).searchParams.get('category');
 const countText=o.$(filters+' p').last().text().trim();
 const count=Number(countText.match(/^\d+/)?.[0]);if(count!==list.length)throw Error(`Collection declared/card count differs for ${id}: ${count}/${list.length}`);
 categories.push({id:label||'all',query,sourcePath:o.state.sourcePath,template:id+'-grid',cards:list.map((c:any)=>({id:c.id,search:c.text.toLowerCase(),template:(isKit?id:'filter-reset')+'-card-'+(isKit?c.index:cards.find((p:any)=>p.id===c.id)?.index)})),isKit,countText});
}
const order=(id:string)=>extract(observations.get(id)).map((c:any)=>c.id);
const filterButtons=initial.$(filters+' button').toArray().slice(-3).map((n:any)=>({label:initial.$(n).text(),idleClass:initial.$(n).attr('class')}));
const selectedClasses=Object.fromEntries(['initial','new','coming'].map((id,index)=>{const o=observations.get(id),buttons=o.$(filters+' button').toArray().slice(-3);return[['all','new','coming'][index],o.$(buttons[index]).attr('class')];}));
const idleClasses=Object.fromEntries(['all','new','coming'].map((id,index)=>{const o=observations.get(index===0?'new':'initial');return[id,o.$(filters+' button').toArray().slice(-3).map((n:any)=>o.$(n).attr('class'))[index]];}));
await mkdir(join(root,directory),{recursive:true});await writeFile(join(root,directory,'templates.htm'),templates.join('\n'));
const config=await jsonFile(join(root,project.familiesFile)),model={selectors:{grid,filters,query:'input[placeholder="Search for products"]',sort:'select'},categories,newIds:order('new'),comingIds:order('coming'),orders:{popularity:order('initial'),'price-asc':order('sort-price-asc'),'price-desc':order('sort-price-desc'),name:order('sort-name')},selectedClasses,idleClasses,evidence:[...observations.values()].flatMap(o=>o.records.map((r:any)=>r.ref)),scope:'observed-public-catalog-fixture; merchant catalog binding pending'};
for(const category of categories)category.targetPath=config.pages.find((p:any)=>p.sourcePath===category.sourcePath)?.targetPath;
for(const page of config.pages.filter((p:any)=>p.family==='collection')){
 const data=await jsonFile(join(root,page.dataFile)),observed=[...observations.values()].find(o=>o.state.sourcePath===page.sourcePath&&['initial','category-peptides','category-capsules','category-gluta','category-aminos','category-kits','category-raws','category-supplies'].includes(o.state.state));
 if(observed){const recipe=`contracts/page-recipes/collection-body-${digest(page.sourcePath).slice(0,16)}.json`;await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:page.sourcePath,componentSelectorsFile:'contracts/secondary-components.draft.json',outputDirectory:dirname(data.bodyFile).replaceAll('\\','/'),fragments:[{id:'body',selector:'div.min-h-screen',rootAttributes:{'data-vr-storefront':'','data-vr-page':page.family},observation:observed.ref}]});await prepareComposerInputs(file,recipe);}
 data.ui={...data.ui,collection:{...model,sourcePath:page.sourcePath}};data.collectionTemplatesFile=directory+'/templates.htm';await writeJson(join(root,page.dataFile),data);
}
const template=await readFile(join(root,'common/composers/secondary.htm'),'utf8');await writeFile(join(root,'common/composers/collection.htm'),template.replace('<script src=','{{fragment:collectionTemplatesFile}}\n<script src='));config.families.collection.templateFile='common/composers/collection.htm';await writeJson(join(root,project.familiesFile),config);
console.log(JSON.stringify({cards:cards.length,categories:categories.length,templates:templates.length,modelSha256:digest(JSON.stringify(model)),acceptance:false}));
