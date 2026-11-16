import {dirname,join,resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),run=await jsonFile(join(root,'verification/recon-current/coa-card-development-source-run.json'));
const choices=[{state:'initial',amount:'10mg',history:'closed'},{state:'amount-20mg',amount:'20 mg',history:'closed'},{state:'amount-30mg',amount:'30 mg',history:'closed'},{state:'previous-open',amount:'10mg',history:'open'},{state:'amount-20mg-previous-open',amount:'20 mg',history:'open'},{state:'amount-30mg-previous-open',amount:'30 mg',history:'open'}];
const selector='#coa-reports > div.grid > div:first-child',templates:string[]=[],variants:any[]=[],evidence:any[]=[];
for(const choice of choices){
 const state=run.rows.find((r:any)=>r.state===choice.state);if(!state?.passed||state.rows.length!==3)throw Error('Complete observed COA card state required');
 const signatures=[];
 for(const row of state.rows){
  const data=JSON.parse((await readRef(root,row.structure)).toString());if(!data.sourceSessionCurrent||data.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Stale COA card source session');
  const dom=load(data.structure),card=dom(selector);if(card.length!==1||card.find('> div:first-child p:first-child').text()!=='GLP-3 RT')throw Error('Unexpected representative card identity');
  if(card.find('> div:nth-child(2) > button').length!==3||card.find('> div.mt-3.border-t > button').length!==1)throw Error('Observed amount/history controls no longer match the declared delegated selectors');
  if(card.find('> div:nth-child(2) > button.text-white').text()!==choice.amount)throw Error('Observed COA strength differs from declared variant');
  const historicButtons=card.find('button').filter((_,n)=>dom(n).text()==='View').length;
  if(historicButtons!==(choice.history==='open'?4:0))throw Error('Observed history branch differs from declared variant');
  signatures.push(card.text());evidence.push(row.structure);
 }
 if(signatures.some(s=>s!==signatures[0]))throw Error('COA card data differs across viewports');
 const source=state.rows.find((r:any)=>r.viewport==='desktop').structure,directory=`staging/coa/card-variants/${choice.state}`,recipe=`contracts/page-recipes/coa-card-${choice.state}.json`;
 await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:'/coa',outputDirectory:directory,fragments:[{id:'card',selector,observation:source}]});await prepareComposerInputs(file,recipe);
 const id='glp-3-rt-'+choice.state;templates.push(`<template data-vr-coa-template="${id}">${await readFile(join(root,directory,'card.htm'),'utf8')}</template>`);variants.push({amount:choice.amount,history:choice.history,template:id});
}
const templateFile='staging/coa/card-variants/templates.htm';await writeFile(join(root,templateFile),templates.join('\n'));
const families=await jsonFile(join(root,project.familiesFile)),page=families.pages.find((p:any)=>p.sourcePath==='/coa'),data=await jsonFile(join(root,page.dataFile));
data.coaCardTemplatesFile=templateFile;
data.publicUi.coa.cardControls={cardsSelector:'#coa-reports > div.grid > div',titleSelector:':scope > div:first-child p:first-child',amountButtonsSelector:':scope > div:nth-child(2) > button',historyButtonSelector:':scope > div.mt-3.border-t > button'};
data.publicUi.coa.cardVariants={'GLP-3 RT':{initialAmount:'10mg',initialHistory:'closed',variants,evidence,unexamined:['other cards strength/history','clipboard copy','View COA destination']}};
await writeJson(join(root,page.dataFile),data);
const template=await readFile(join(root,'common/composers/coa.htm'),'utf8');
if(!template.includes('{{fragment:coaCardTemplatesFile}}'))await writeFile(join(root,'common/composers/coa.htm'),template.replace('<script src=','{{fragment:coaCardTemplatesFile}}\n<script src='));
console.log(JSON.stringify({representative:'GLP-3 RT',variants:variants.length,sourceReferences:evidence.length,accepted:false,published:false}));
