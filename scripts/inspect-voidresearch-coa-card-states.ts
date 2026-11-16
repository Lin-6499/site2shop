import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,saveArtifact,safeBrowserError} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),storageState=await sourceStorage(project);
const card='#coa-reports > div.grid > div:first-child',choose=(amount:string)=>({op:'click',selector:`${card} > div:nth-child(2) > button:text-is("${amount}")`,effect:'read-only'});
const previous={op:'click',selector:`${card} button:has-text("Previous Batches")`,effect:'read-only'};
const states=[{id:'initial',amount:'10mg',actions:[]},{id:'amount-20mg',amount:'20 mg',actions:[choose('20 mg')]},{id:'amount-30mg',amount:'30 mg',actions:[choose('30 mg')]},{id:'amount-reset',amount:'10mg',actions:[choose('20 mg'),choose('10mg')]},{id:'previous-open',amount:'10mg',actions:[previous]},{id:'previous-closed',amount:'10mg',actions:[previous,previous]},
 {id:'amount-20mg-previous-open',amount:'20 mg',actions:[choose('20 mg'),previous]},
 {id:'amount-30mg-previous-open',amount:'30 mg',actions:[choose('30 mg'),previous]},
 {id:'previous-open-amount-20mg',amount:'20 mg',actions:[previous,choose('20 mg')]},
 {id:'amount-20mg-previous-closed',amount:'20 mg',actions:[choose('20 mg'),previous,previous]}];
const reportFile=join(root,'verification/recon-current/coa-card-development-source-run.json'),prior=await jsonFile(reportFile).catch(()=>null),priorAttempt=prior?await saveArtifact(root,prior):null,rows:any[]=[];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
for(const state of states.filter(s=>!only||only.includes(s.id))){
 const selectors=`contracts/coa-card-development-${state.id}.json`;
 await writeJson(join(root,selectors),{sourcePath:'/coa',inspectionId:`coa-card-development-${state.id}`,captureStructure:true,initialReady:`${card} > div.mt-auto > button`,settleDocumentScroll:true,
  contextNormalization:{id:'shipping-notice-dismissed',rationale:'Inspect public report card controls with unobscured viewport; retain shipping overlay independent branches.',preservedBranch:'verification/recon-current/context-overlay-source-run.json',dismissals:[{selector:'button[aria-label="Dismiss shipping notice"]',op:'press',value:'Enter',waitMs:15000}]},
  topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',
  actions:[...state.actions,{op:'scroll',y:0,effect:'read-only'}],postReady:`${card} > div:nth-child(2) > button.text-white:text-is("${state.amount}")`,
  components:{header:'div.min-h-screen > header',spacer:'div.min-h-screen > div.h-16',hero:'div.min-h-screen > section:first-of-type',reports:'#coa-reports',card,footer:'footer'}});
 try{const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storageState});rows.push({...report,state:state.id,amount:state.amount});}
 catch(error){rows.push({state:state.id,amount:state.amount,passed:false,error:safeBrowserError(error)});}
 const combined=[...(only?prior?.rows||[]:[]).filter((r:any)=>!rows.some(n=>n.state===r.state)),...rows];
 await writeJson(reportFile,{kind:'read-only-coa-strength-and-history-observations-not-lab-report-ownership-or-clipboard-acceptance',rows:combined,priorAttempt,externalReportOpened:false,clipboardChanged:false,formsSubmitted:false,published:false});
 console.log(JSON.stringify({state:state.id,passed:rows.at(-1).passed}));
}
if(rows.some(r=>!r.passed))process.exitCode=1;
