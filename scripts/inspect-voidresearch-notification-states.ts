import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,safeBrowserError,saveArtifact} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file),storageState=await sourceStorage(project),rows:any[]=[];
const entries=[{id:'launch',path:'/product/ghk-cu-capsules',button:'main button:has-text("Notify me")'},{id:'restock',path:'/product/cjc-no-dac',button:'button:has-text("Notify Me When Back In Stock")'}];
const reportFile=join(root,'verification/recon-current/notification-development-source-run.json'),previous=await jsonFile(reportFile).catch(()=>null),priorAttempt=previous?await saveArtifact(root,previous):null;
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
for(const entry of entries){
 for(const state of ['open','close','escape','close-keyboard']){
  if(only&&!only.includes(`${entry.id}:${state}`))continue;
  const actions:any[]=[{op:'click',selector:entry.button,effect:'read-only',waitAfter:{visible:'[role=dialog] h2'}}];
  if(state==='close')actions.push({op:'click',selector:'[role=dialog] button[aria-label="Close"]',effect:'read-only'});
  if(state==='close-keyboard')actions.push({op:'press',selector:'[role=dialog] button[aria-label="Close"]',value:'Enter',effect:'read-only'});
  if(state==='escape')actions.push({op:'press',selector:'[role=dialog]',value:'Escape',effect:'read-only'});
  actions.push({op:'scroll',y:0,effect:'read-only'});
  const selectors=`contracts/notification-${entry.id}-${state}.json`;
  await writeJson(join(root,selectors),{sourcePath:entry.path,inspectionId:`notification-${entry.id}-${state}`,captureStructure:true,contextNormalization:{id:'shipping-notice-dismissed',rationale:'Notification modal independently observed without the separate preserved shipping overlay',preservedBranch:'verification/recon-current/context-overlay-source-run.json',dismissals:[{selector:'button[aria-label="Dismiss shipping notice"]',op:'press',value:'Enter',waitMs:15000}]},topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'body',actions,...(state==='open'?{postReady:'[role=dialog]'}:{postAbsent:'[role=dialog]'}),components:{header:'div.min-h-screen > header',title:'h1',footer:'footer',...(state==='open'?{dialog:'[role=dialog]',dialogHeading:'[role=dialog] h2',email:'[role=dialog] input[type=email]',consent:'[role=dialog] input[type=checkbox]',form:'[role=dialog] form'}:{})}});
  try{const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storageState});rows.push({...report,notificationType:entry.id,state,sourcePath:entry.path});console.log(JSON.stringify({kind:entry.id,state,failed:report.rows.filter((r:any)=>!r.passed).length}));}
  catch(error){rows.push({notificationType:entry.id,state,sourcePath:entry.path,passed:false,error:safeBrowserError(error)});}
  const combined=[...(only?previous?.rows||[]:[]).filter((r:any)=>!rows.some(next=>next.sourcePath===r.sourcePath&&next.state===r.state)),...rows];
  await writeJson(reportFile,{kind:'notification-ui-observations-not-subscription-acceptance',rows:combined,priorAttempt,sourceSubmissionPerformed:false,marketingConsentGranted:false,published:false});
 }
}
if(rows.some(r=>!r.passed))process.exitCode=1;
