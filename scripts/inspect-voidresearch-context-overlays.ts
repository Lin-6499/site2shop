import {dirname,join,resolve} from 'node:path';
import {jsonFile,saveArtifact,writeJson,safeBrowserError} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {sourceStorage} from '../src/shopyy/source-session.js';

// Preserve the shipping banner as its own visible/dismissed/fresh-context-reset
// branch, before normalizing it out of ordinary page composition comparisons.
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),storage=await sourceStorage(project);
const reportFile=join(root,'verification/recon-current/context-overlay-source-run.json');
const previous=await jsonFile(reportFile).catch(()=>null),priorAttempt=previous?await saveArtifact(root,previous):null,rows:any[]=[];
for(const state of ['visible','dismissed','fresh-context-reset']){
 const selectors=`contracts/context-shipping-${state}.json`;
 await writeJson(join(root,selectors),{sourcePath:'/membership',inspectionId:`context-shipping-${state}`,captureStructure:true,initialReady:'button[aria-label="Dismiss shipping notice"]',
  infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',
  ...(state==='dismissed'?{actions:[{op:'press',selector:'button[aria-label="Dismiss shipping notice"]',value:'Enter',effect:'read-only'}],postHidden:'button[aria-label="Dismiss shipping notice"]'}:{postReady:'button[aria-label="Dismiss shipping notice"]'}),
  components:{page:'div.min-h-screen',...(state==='dismissed'?{}:{notice:'body > div:has(#intl-waitlist-email)',dismiss:'button[aria-label="Dismiss shipping notice"]'})}});
 try{const result=await inspectSourceComponents(file,selectors,{sourceStorageState:storage});rows.push({state,reset:'fresh browser context from same manually authenticated source storage',...result});}
 catch(error){rows.push({state,passed:false,error:safeBrowserError(error)});}
 await writeJson(reportFile,{kind:'independent-source-overlay-context-branches-not-acceptance',rows,priorAttempt,storageMutatedByCollector:false,formsSubmitted:false,published:false});
 console.log(JSON.stringify({state,passed:rows.at(-1).passed}));
}
if(rows.some(r=>!r.passed))process.exitCode=1;
