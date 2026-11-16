import {resolve,join} from 'node:path';
import {jsonFile,readRef,writeJson,saveArtifact,canonical} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {withShopyyDevelopmentServer} from './lib/shopyy-development-server.js';

const file=resolve(process.argv[2]),only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
const mode=process.argv.includes('--cards')?'coa-card':'coa';
await withShopyyDevelopmentServer(file,async({root,origin,renderSha256})=>{
 const source=await jsonFile(join(root,`verification/recon-current/${mode}-development-source-run.json`)),rows:any[]=[],targetFile=join(root,`diagnostic-${mode}-target.project.json`);
 await writeJson(targetFile,{sourceUrl:origin,workflow:{sourceSession:{enabled:false},discoveryNetworkIdleMs:100}});
 for(const state of source.rows.filter((r:any)=>!only||only.includes(r.state))){
  if(!state.passed)throw Error('Incomplete source COA state');
  const config=await jsonFile(join(root,`contracts/${mode}-development-${state.state}.json`)),sourceId=config.inspectionId,targetId='local-'+sourceId,selectors=`contracts/${mode}-local-${state.state}.json`;
  await writeJson(join(root,selectors),{...config,sourcePath:'/pages/coa',inspectionId:targetId,captureStructure:false});
  const target=await inspectSourceComponents(targetFile,selectors);
  for(const viewport of ['desktop','tablet','mobile']){
   const a=state.rows.find((r:any)=>r.viewport===viewport),b=target.rows.find((r:any)=>r.viewport===viewport);
   if(!a?.passed||!b?.passed){rows.push({state:state.state,viewport,errors:[a?.error,b?.error].filter(Boolean)});continue;}
   const s=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',sourceId),a.evidence)).toString()),t=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',targetId),b.evidence)).toString()),differences:any[]=[];
   for(const id of Object.keys(config.components))for(const field of ['visible','x','y','width','height','display','fontSize','lineHeight','fontFamily','overflowX','overflowY','parent','order','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','gridTemplateColumns','flexDirection','text','tag','role','value','checked','disabled','scrollLeft']){
    const x=s.components[id][field],y=t.components[id][field];
    if(['x','y','width','height'].includes(field)?Math.abs(x-y)>2:canonical(x)!==canonical(y))differences.push({component:id,field,source:x,target:y});
   }
   rows.push({state:state.state,viewport,sourceId,targetId,source:a.evidence,target:b.evidence,sourceScreenshot:s.screenshot,targetScreenshot:t.screenshot,sourceFullPage:s.fullPage,targetFullPage:t.fullPage,differences});
  }
  console.log(JSON.stringify({state:state.state,errors:rows.filter(r=>r.state===state.state).flatMap(r=>r.errors||[]).length,differences:rows.filter(r=>r.state===state.state).flatMap(r=>r.differences||[]).length}));
 }
 const reportFile=join(root,`verification/recon-current/${mode}-development-comparison.json`),prior=await jsonFile(reportFile).catch(()=>null),priorAttempt=prior?await saveArtifact(root,prior):null;
 await writeJson(reportFile,{kind:mode==='coa'?'coa-public-search-development-comparison-not-strength-history-report-or-build-acceptance':'coa-representative-card-development-comparison-not-all-cards-report-clipboard-or-build-acceptance',developmentRenderSha256:renderSha256,rows,priorAttempt,...(source.newerAttempt?{newerSourceAttempt:source.newerAttempt,unexamined:source.unexamined}:{}),visualReview:'pending',sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false});
 if(rows.some(r=>r.errors?.length||r.differences?.length))process.exitCode=1;
});
