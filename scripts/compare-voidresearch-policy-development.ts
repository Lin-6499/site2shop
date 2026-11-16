import {resolve,join} from 'node:path';
import {jsonFile,readRef,writeJson,saveArtifact,canonical} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {withShopyyDevelopmentServer} from './lib/shopyy-development-server.js';
const file=resolve(process.argv[2]||'');
await withShopyyDevelopmentServer(file,async({root,origin,renderSha256})=>{
 const source=await jsonFile(join(root,'verification/recon-current/policy-development-source-run.json')),rows:any[]=[];
 const targetFile=join(root,'diagnostic-policy-target.project.json');
 await writeJson(targetFile,{sourceUrl:origin,workflow:{sourceSession:{enabled:false},discoveryNetworkIdleMs:2000}});
 for(const state of source.rows){
  if(!state.passed)throw Error('Policy source state is incomplete');
  const config=await jsonFile(join(root,`contracts/policy-development-${state.tab}.json`)),sourceId=config.inspectionId,targetId=`policy-local-${state.tab}`;
  const selectors=`contracts/policy-local-${state.tab}.json`;
  await writeJson(join(root,selectors),{...config,sourcePath:'/pages/policies?tab=research',expectedFinalPath:`/pages/policies?tab=${state.tab}`,inspectionId:targetId,captureStructure:false,components:{...config.components,header:'[data-vr-storefront] > header',footer:'[data-vr-storefront] > footer'}});
  const target=await inspectSourceComponents(targetFile,selectors);
  for(const viewport of ['desktop','tablet','mobile']){
   const a=state.rows.find((r:any)=>r.viewport===viewport),b=target.rows.find((r:any)=>r.viewport===viewport);
   if(!a?.passed||!b?.passed){rows.push({tab:state.tab,viewport,errors:[a?.error,b?.error].filter(Boolean)});continue;}
   const s=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',sourceId),a.evidence)).toString()),t=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',targetId),b.evidence)).toString()),differences:any[]=[];
   for(const id of Object.keys(config.components))for(const field of ['visible','x','y','width','height','display','fontSize','lineHeight','fontFamily','overflowX','overflowY','parent','order','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','gridTemplateColumns','flexDirection','text','tag','role','value','checked','disabled','scrollLeft']){
    const x=s.components[id][field],y=t.components[id][field];
    if(['x','y','width','height'].includes(field)?Math.abs(x-y)>2:canonical(x)!==canonical(y))differences.push({component:id,field,source:x,target:y});
   }
   rows.push({tab:state.tab,viewport,sourceId,targetId,source:a.evidence,target:b.evidence,sourceScreenshot:s.screenshot,targetScreenshot:t.screenshot,sourceFullPage:s.fullPage,targetFullPage:t.fullPage,differences});
  }
  console.log(JSON.stringify({tab:state.tab,errors:rows.filter(r=>r.tab===state.tab).flatMap(r=>r.errors||[]).length,differences:rows.filter(r=>r.tab===state.tab).flatMap(r=>r.differences||[]).length}));
 }
 const reportFile=join(root,'verification/recon-current/policy-development-comparison.json'),prior=await jsonFile(reportFile).catch(()=>null),priorAttempt=prior?await saveArtifact(root,{kind:'prior-policy-development-comparison',report:prior}):null;
 await writeJson(reportFile,{kind:'policy-development-comparison-not-acceptance',developmentRenderSha256:renderSha256,rows,priorAttempt,visualReview:'pending',sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false});
 if(rows.some(r=>r.errors?.length||r.differences?.length))process.exitCode=1;
});
