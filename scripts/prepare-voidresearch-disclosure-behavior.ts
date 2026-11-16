import {dirname,join,resolve} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
const run=await jsonFile(join(root,'verification/recon-current/disclosure-development-source-run.json'));
const config=await jsonFile(join(root,project.familiesFile));
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
for(const group of run.groups.filter((g:any)=>!only||only.includes(g.id))){
 const rows=run.rows.filter((r:any)=>r.group===group.id);
 if(rows.length!==group.questions.length*2||rows.some((r:any)=>!r.passed))throw Error(`Incomplete disclosure source coverage: ${group.id}`);
 const initial=rows.find((r:any)=>r.state==='initial'),initialRow=initial.rows.find((r:any)=>r.viewport==='desktop');
 const $=load(JSON.parse((await readRef(root,initialRow.structure)).toString()).structure);
 const items=$('#faq button').toArray().map(button=>$(button).parent()[0]);
 if(items.length!==group.questions.length)throw Error('Unexpected disclosure button coverage');
 const path=(node:any)=>{
  const parts:string[]=[];for(let n=node;n&&n.attribs?.id!=='faq';n=n.parent){if(!n.parent)throw Error('Disclosure is outside #faq');parts.unshift(`${n.tagName}:nth-child(${n.parent.children.filter((c:any)=>c.type==='tag').indexOf(n)+1})`);}
  return '#faq > '+parts.join(' > ');
 };
 const templates:string[]=[],bindings:any[]=[];
 for(const[index,item]of items.entries()){
  const selector=path(item);bindings.push({index,selector});
  for(const variant of ['open','closed']){
   const state=rows.find((r:any)=>r.state===(variant==='closed'?`close-${index}`:index?`open-${index}`:'initial'));
   const row=state.rows.find((r:any)=>r.viewport==='desktop'),d=JSON.parse((await readRef(root,row.structure)).toString());
   if(!d.sourceSessionCurrent||d.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Stale disclosure source evidence');
   const recipe=`contracts/page-recipes/${group.id}-faq-${index}-${variant}.json`,directory=`staging/disclosures/${group.id}/${index}/${variant}`;
   await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:group.path,outputDirectory:directory,fragments:[{id:'item',selector,rootAttributes:{'data-vr-disclosure-index':String(index)},observation:row.structure}]});
   await prepareComposerInputs(file,recipe);
   templates.push(`<template data-vr-disclosure-template="${index}-${variant}">${await readFile(join(root,directory,'item.htm'),'utf8')}</template>`);
  }
 }
 const directory=join(root,'staging/disclosures',group.id);await mkdir(directory,{recursive:true});await writeFile(join(directory,'templates.htm'),templates.join('\n'));
 const page=config.pages.find((p:any)=>p.sourcePath===group.path),data=await jsonFile(join(root,page.dataFile));
 const bodyRecipe=`contracts/page-recipes/${group.id}-disclosure-body.json`;
 await writeJson(join(root,bodyRecipe),{schemaVersion:2,sourcePath:group.path,componentSelectorsFile:'contracts/secondary-components.draft.json',outputDirectory:dirname(data.bodyFile).replaceAll('\\','/'),fragments:[{id:'body',selector:'div.min-h-screen',rootAttributes:{'data-vr-storefront':'','data-vr-page':page.family},observation:initialRow.structure}]});
 await prepareComposerInputs(file,bodyRecipe);data.sourceEvidence=initialRow.structure;
 const privacy=[];
 for(const row of initial.rows){const d=JSON.parse((await readRef(root,row.structure)).toString());for(const boundary of d.privacyProjection||[])privacy.push({viewport:row.viewport,...boundary,sourceEvidence:row.structure});}
 if(privacy.length){
  if(privacy.length!==3||new Set(privacy.map(p=>p.id)).size!==1)throw Error('Privacy boundary needs all three observed device geometries');
  const desktop=privacy.find(p=>p.viewport==='desktop'),tablet=privacy.find(p=>p.viewport==='tablet'),mobile=privacy.find(p=>p.viewport==='mobile');
  const selector=`[data-vr-private-source-boundary="${desktop.id}"]`;
  const css=`${selector}{width:100%!important;height:${desktop.geometry.height}px!important}@media(min-width:640px) and (max-width:1023px){${selector}{height:${tablet.geometry.height}px!important}}@media(max-width:639px){${selector}{height:${mobile.geometry.height}px!important}}`;
  templates.unshift(`<style data-vr-privacy-projection>${css}</style>`);data.privacyBoundaries=privacy;
  await writeFile(join(directory,'templates.htm'),templates.join('\n'));
 }
 data.publicUi={...data.publicUi,disclosures:{items:bindings,initialOpen:0,single:true}};
 data.interactionTemplatesFile=`staging/disclosures/${group.id}/templates.htm`;
 await writeJson(join(root,page.dataFile),data);
 const template=await readFile(join(root,'common/composers/secondary.htm'),'utf8');
 const templateFile=`common/composers/${group.id}-disclosures.htm`;
 await writeFile(join(root,templateFile),template.replace('<script src=','{{fragment:interactionTemplatesFile}}\n<script src='));
 config.families[page.family].templateFile=templateFile;
 console.log(JSON.stringify({group:group.id,items:bindings.length,variants:templates.length,status:'source-backed-component-inputs-not-acceptance'}));
}
if(!process.argv.includes('--candidate-only'))await writeJson(join(root,project.familiesFile),config);
