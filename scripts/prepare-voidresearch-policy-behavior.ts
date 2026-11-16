import {dirname,join,resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
const run=await jsonFile(join(root,'verification/recon-current/policy-development-source-run.json'));
if(run.rows.length!==9||run.rows.some((s:any)=>!s.passed))throw Error('All nine three-device policy states required');
const panels:string[]=[],tabs:any[]=[];
for(const state of run.rows){
 const row=state.rows.find((r:any)=>r.viewport==='desktop'),d=JSON.parse((await readRef(root,row.structure)).toString());
 if(!d.sourceSessionCurrent||d.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Stale policy source session');
 const $=load(d.structure),selected=$(`#policy-tab-${state.tab}`),idle=$('[role=tab][aria-selected=false]').first();
 const recipe=`contracts/page-recipes/policy-panel-${state.tab}.json`,directory=`staging/policy-panels/${state.tab}`;
 await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:`/policies?tab=${state.tab}`,outputDirectory:directory,fragments:[{id:'panel',selector:'#policy-panel',observation:row.structure}]});
 await prepareComposerInputs(file,recipe);
 panels.push(`<template data-vr-policy-panel="${state.tab}">${await readFile(join(root,directory,'panel.htm'),'utf8')}</template>`);
 tabs.push({id:state.tab,selectedClass:selected.attr('class'),idleClass:idle.attr('class'),sourceEvidence:row.structure});
}
await writeFile(join(root,'staging/policy-panels/templates.htm'),panels.join('\n'));
const config=await jsonFile(join(root,project.familiesFile));
const secondary=await readFile(join(root,'common/composers/secondary.htm'),'utf8');
await writeFile(join(root,'common/composers/policy.htm'),secondary.replace('<script src=', '{{fragment:policyTemplatesFile}}\n<script src='));
config.families['policy-tabs'].templateFile='common/composers/policy.htm';
for(const page of config.pages.filter((p:any)=>p.family==='policy-tabs')){
 const data=await jsonFile(join(root,page.dataFile));
 data.publicUi={...data.publicUi,policy:{tabs:tabs.map(({id,selectedClass,idleClass})=>({id,selectedClass,idleClass})),defaultTab:new URL(page.sourcePath,project.sourceUrl).searchParams.get('tab')||'shipping'}};
 delete data.ui.policy;
 data.policyTemplatesFile='staging/policy-panels/templates.htm';
 await writeJson(join(root,page.dataFile),data);
}
await writeJson(join(root,project.familiesFile),config);
console.log(JSON.stringify({tabs:tabs.length,pages:config.pages.filter((p:any)=>p.family==='policy-tabs').length,sourceGatePassed:false,published:false}));
