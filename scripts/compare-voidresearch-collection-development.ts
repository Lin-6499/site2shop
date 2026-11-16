import {resolve,join} from 'node:path';
import {jsonFile,readRef,writeJson,saveArtifact,canonical} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {withShopyyDevelopmentServer} from './lib/shopyy-development-server.js';
const file=resolve(process.argv[2]||''),only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
await withShopyyDevelopmentServer(file,async({root,origin,renderSha256})=>{
 const run=await jsonFile(join(root,'verification/recon-current/collection-development-source-run.json')),families=await jsonFile(join(root,'contracts/families.v2.json')),rows:any[]=[];
 const targetFile=join(root,'diagnostic-collection-target.project.json');await writeJson(targetFile,{sourceUrl:origin,workflow:{sourceSession:{enabled:false},discoveryNetworkIdleMs:100}});
 const assets=await jsonFile(join(root,'common/assets/images/source-current/manifest.json')),imageKey=(url:string)=>assets.assets.find((a:any)=>a.url===url)?.sha256||url.split('/').pop()?.split('.')[0];
 for(const state of run.rows.filter((r:any)=>!only||only.includes(r.state))){
  if(!state.passed)throw Error(`Incomplete source collection ${state.state}`);
  const config=await jsonFile(join(root,`contracts/collection-development-${state.state}.json`)),sourceId=config.inspectionId,targetId='local-'+sourceId,targetPath=families.pages.find((p:any)=>p.sourcePath===state.sourcePath)?.targetPath;
  if(!targetPath)throw Error('Missing mapped collection destination');const selectors=`contracts/collection-local-${state.state}.json`;
  const postReady=state.state==='category-kits'?config.postReady.replaceAll('a[href^="/product/"]','a[href^="/products/"]'):config.postReady;
  await writeJson(join(root,selectors),{...config,postReady,sourcePath:targetPath,inspectionId:targetId,captureStructure:false});const target=await inspectSourceComponents(targetFile,selectors);
  for(const viewport of ['desktop','tablet','mobile']){
   const a=state.rows.find((r:any)=>r.viewport===viewport),b=target.rows.find((r:any)=>r.viewport===viewport);if(!a?.passed||!b?.passed){rows.push({state:state.state,viewport,errors:[a?.error,b?.error].filter(Boolean)});continue;}
   const s=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',sourceId),a.evidence)).toString()),t=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',targetId),b.evidence)).toString()),differences:any[]=[];
   for(const id of Object.keys(config.components)){
    for(const field of ['visible','x','y','width','height','display','fontSize','lineHeight','fontFamily','overflowX','overflowY','parent','order','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','gridTemplateColumns','flexDirection','text','tag','role','value','checked','disabled','scrollLeft']){const x=s.components[id][field],y=t.components[id][field];if(['x','y','width','height'].includes(field)?Math.abs(x-y)>2:canonical(x)!==canonical(y))differences.push({component:id,field,source:x,target:y});}
    const images=(c:any)=>c.images.map((i:any)=>({alt:i.alt,loaded:i.loaded,identity:imageKey(i.src)}));if(canonical(images(s.components[id]))!==canonical(images(t.components[id])))differences.push({component:id,field:'images',source:images(s.components[id]),target:images(t.components[id])});
   }
   rows.push({state:state.state,viewport,sourceId,targetId,source:a.evidence,target:b.evidence,sourceScreenshot:s.screenshot,targetScreenshot:t.screenshot,sourceFullPage:s.fullPage,targetFullPage:t.fullPage,differences});
  }
  console.log(JSON.stringify({state:state.state,errors:rows.filter(r=>r.state===state.state).flatMap(r=>r.errors||[]).length,differences:rows.filter(r=>r.state===state.state).flatMap(r=>r.differences||[]).length}));
  const reportFile=join(root,'verification/recon-current/collection-development-comparison.json'),prior=await jsonFile(reportFile).catch(()=>null),priorAttempt=prior?await saveArtifact(root,prior):null;await writeJson(reportFile,{kind:'collection-development-comparison-not-acceptance',developmentRenderSha256:renderSha256,rows,priorAttempt,visualReview:'pending',sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false});
 }
 if(rows.some(r=>r.errors?.length||r.differences?.length))process.exitCode=1;
});
