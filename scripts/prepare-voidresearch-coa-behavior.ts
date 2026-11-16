import {dirname,join,resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file);
const run=await jsonFile(join(root,'verification/recon-current/coa-development-source-run.json'));
const observations=new Map<string,any>();
for(const state of run.rows){
 if(!state.passed||state.rows.length!==3)throw Error('Complete three-device COA state required: '+state.state);
 const records=[];
 for(const row of state.rows){
  const d=JSON.parse((await readRef(root,row.structure)).toString()),dom=load(d.structure);
  if(!d.sourceSessionCurrent||d.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Stale COA source session');
  if(dom('#coa-reports .animate-pulse').length)throw Error('COA loading skeleton is not a result state');
  const cards=dom('#coa-reports > div.grid > div').toArray().map(n=>({title:dom(n).find('> div:first-child p:first-child').text().trim(),text:dom(n).text()}));
  records.push({d,dom,cards,ref:row.structure});
 }
 if(records.some(r=>JSON.stringify(r.cards)!==JSON.stringify(records[0].cards)))throw Error('COA data differs across devices');
 observations.set(state.state,{state,...records[0],records});
}
const initial=observations.get('initial'),empty=observations.get('search-none'),ghk=observations.get('search-ghk');
if(initial.cards.length!==23||ghk.cards.length!==1||ghk.cards[0].title!=='GHK-CU'||empty.cards.length)throw Error('Reviewed source catalog/results changed; update the recipe');
const templates:string[]=[],directory='staging/coa',evidence=[...observations.values()].flatMap(o=>o.records.map((r:any)=>r.ref));
for(const stateId of ['initial','search-none']){
 const observed=observations.get(stateId),recipe=`contracts/page-recipes/coa-${stateId}.json`,outputDirectory=`${directory}/${stateId}`;
 const fragments=stateId==='initial'?initial.cards.map((_:any,index:number)=>({id:`card-${index}`,selector:`#coa-reports > div.grid > div:nth-child(${index+1})`,observation:observed.ref})):[{id:'empty',selector:'#coa-reports > div:last-child',observation:observed.ref}];
 await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:'/coa',outputDirectory,fragments});await prepareComposerInputs(file,recipe);
 for(const fragment of fragments)templates.push(`<template data-vr-coa-template="${fragment.id}">${await readFile(join(root,outputDirectory,fragment.id+'.htm'),'utf8')}</template>`);
}
await mkdir(join(root,directory),{recursive:true});await writeFile(join(root,directory,'templates.htm'),templates.join('\n'));
const config=await jsonFile(join(root,project.familiesFile)),page=config.pages.find((p:any)=>p.sourcePath==='/coa'),data=await jsonFile(join(root,page.dataFile));
const recipe='contracts/page-recipes/coa-behavior-body.json';
await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:'/coa',componentSelectorsFile:'contracts/secondary-components.draft.json',outputDirectory:dirname(data.bodyFile).replaceAll('\\','/'),fragments:[{id:'body',selector:'div.min-h-screen',rootAttributes:{'data-vr-storefront':'','data-vr-page':'coa'},observation:initial.ref}]});
await prepareComposerInputs(file,recipe);
data.coaTemplatesFile=directory+'/templates.htm';
data.publicUi={...data.publicUi,coa:{querySelector:'input[placeholder="Search COA..."]',resultsSelector:'#coa-reports > div:last-child',gridClass:initial.dom('#coa-reports > div.grid').attr('class'),cards:initial.cards.map((c:any,index:number)=>({title:c.title,search:c.title.toLowerCase(),template:`card-${index}`})),emptyText:empty.dom('#coa-reports > div:last-child').text(),emptyQuery:empty.state.query,evidence,scope:'observed-public-name-search-and-reset; strength/history controls and clipboard/external report/lot lookup not yet validated'}};
data.sourceEvidence=initial.ref;await writeJson(join(root,page.dataFile),data);
const template=await readFile(join(root,'common/composers/secondary.htm'),'utf8');await writeFile(join(root,'common/composers/coa.htm'),template.replace('<script src=','{{fragment:coaTemplatesFile}}\n<script src='));
// Re-read immediately before the single owned family binding write.
const latest=await jsonFile(join(root,project.familiesFile));latest.families.coa.templateFile='common/composers/coa.htm';await writeJson(join(root,project.familiesFile),latest);
console.log(JSON.stringify({sourcePath:'/coa',cards:initial.cards.length,states:observations.size,evidence:evidence.length,accepted:false,published:false}));
