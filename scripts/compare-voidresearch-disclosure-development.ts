import {resolve,join} from 'node:path';
import {jsonFile,readRef,writeJson,saveArtifact,canonical} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {withShopyyDevelopmentServer} from './lib/shopyy-development-server.js';
const file=resolve(process.argv[2]||''),only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
await withShopyyDevelopmentServer(file,async({root,origin,renderSha256})=>{
 const source=await jsonFile(join(root,'verification/recon-current/disclosure-development-source-run.json')),rows:any[]=[];
 const families=await jsonFile(join(root,'contracts/families.v2.json'));
 const targetFile=join(root,'diagnostic-disclosure-target.project.json');
 await writeJson(targetFile,{sourceUrl:origin,workflow:{sourceSession:{enabled:false},discoveryNetworkIdleMs:2000}});
 for(const state of source.rows.filter((r:any)=>!only||only.includes(r.group))){
  if(!state.passed)throw Error('Disclosure source state is incomplete');
  const id=`${state.group}-faq-${state.state}`,config=await jsonFile(join(root,`contracts/disclosure-${id}.json`)),sourceId=config.inspectionId,targetId=`local-${id}`;
  const targetPath=families.pages.find((p:any)=>p.sourcePath===state.sourcePath).targetPath,selectors=`contracts/disclosure-local-${id}.json`;
  await writeJson(join(root,selectors),{...config,sourcePath:targetPath,inspectionId:targetId,captureStructure:false});
  const target=await inspectSourceComponents(targetFile,selectors);
  for(const viewport of ['desktop','tablet','mobile']){
   const a=state.rows.find((r:any)=>r.viewport===viewport),b=target.rows.find((r:any)=>r.viewport===viewport);
   if(!a?.passed||!b?.passed){rows.push({group:state.group,state:state.state,viewport,errors:[a?.error,b?.error].filter(Boolean)});continue;}
   const s=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',sourceId),a.evidence)).toString()),t=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',targetId),b.evidence)).toString()),differences:any[]=[];
   for(const id of Object.keys(config.components))for(const field of ['visible','x','y','width','height','display','fontSize','lineHeight','fontFamily','overflowX','overflowY','parent','order','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','gridTemplateColumns','flexDirection','text','tag','role','scrollLeft']){
    const x=s.components[id][field],y=t.components[id][field];
    if(['x','y','width','height'].includes(field)?Math.abs(x-y)>2:canonical(x)!==canonical(y))differences.push({component:id,field,source:x,target:y});
   }
   rows.push({group:state.group,state:state.state,viewport,sourceId,targetId,source:a.evidence,target:b.evidence,sourceScreenshot:s.screenshot,targetScreenshot:t.screenshot,sourceFullPage:s.fullPage,targetFullPage:t.fullPage,differences});
  }
  console.log(JSON.stringify({group:state.group,state:state.state,errors:rows.filter(r=>r.group===state.group&&r.state===state.state).flatMap(r=>r.errors||[]).length,differences:rows.filter(r=>r.group===state.group&&r.state===state.state).flatMap(r=>r.differences||[]).length}));
 }
 const reportFile=join(root,'verification/recon-current/disclosure-development-comparison.json'),prior=await jsonFile(reportFile).catch(()=>null),priorAttempt=prior?await saveArtifact(root,prior):null;
 await writeJson(reportFile,{kind:'disclosure-development-comparison-not-acceptance',developmentRenderSha256:renderSha256,rows,priorAttempt,visualReview:'pending',sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false});
 if(rows.some(r=>r.errors?.length||r.differences?.length))process.exitCode=1;
});
