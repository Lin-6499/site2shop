import {dirname,join,resolve} from 'node:path';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson,saveArtifact,safeBrowserError} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {sourceStorage} from '../src/shopyy/source-session.js';

// Explicit frozen source-snapshot paths only. The first pass is reconnaissance,
// never an accepted page contract; author route-specific readiness after review.
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file);
const routeNeeds=process.argv.find(v=>v.startsWith('--route-needs='))?.slice(14)||'staging/source-snapshots/home-source-r1-8863e9b51c8e/certificate-route-needs.json';
const paths=await jsonFile(join(root,routeNeeds));
const limit=Number(process.argv.find(v=>v.startsWith('--limit='))?.slice(8)||paths.sourcePaths.length);
const output=process.argv.find(v=>v.startsWith('--report='))?.slice(9)||'verification/recon-current/coa-detail-reconnaissance-run.json';
if(!/^verification\/[a-z0-9/-]+\.json$/.test(output))throw Error('Unsafe diagnostic report path');
const storage=await sourceStorage(project),rows:any[]=[],reportFile=join(root,output);
const previous=await jsonFile(reportFile).catch(()=>null),priorAttempt=previous?await saveArtifact(root,previous):null;
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
for(const sourcePath of paths.sourcePaths.slice(0,limit).filter((p:string)=>!only||only.includes(p))){
 if(!/^\/coa\/[a-z0-9-]+$/.test(sourcePath))throw Error('Unexpected frozen certificate path');
 const id='coa-detail-'+sourcePath.slice(5),selectors=`contracts/${id}.json`;
 await writeJson(join(root,selectors),{sourcePath,inspectionId:id,ready:'main h1',initialReady:'header [data-first-screen-marquee]',postReady:'main h1',captureStructure:true,
  contextNormalization:{id:'shipping-notice-dismissed',rationale:'Certificate page composition is compared without the independent shipping overlay.',preservedBranch:'verification/recon-current/context-overlay-source-run.json',dismissals:[{selector:'button[aria-label="Dismiss shipping notice"]',op:'press',value:'Enter',waitMs:15000}]},
  topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',components:{page:'div.min-h-screen',header:'div.min-h-screen > header',title:'main h1',content:'main',footer:'footer'}});
 try{
  const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storage});
  const metadata=[];
  for(const row of report.rows.filter((r:any)=>r.passed)){
   const d=JSON.parse((await readRef(root,row.structure)).toString()),dom=load(d.structure);
   metadata.push({viewport:row.viewport,title:d.title,headings:dom('h1,h2,h3').map((_,n)=>dom(n).text().trim()).get(),mainCount:dom('main').length,sectionCount:dom('section').length,links:dom('main a,section a').map((_,n)=>({text:dom(n).text().trim(),href:dom(n).attr('href')})).get(),publicImages:dom('main img').map((_,n)=>({alt:dom(n).attr('alt'),src:dom(n).attr('src')})).get()});
  }
  rows.push({sourcePath,...report,metadata});
 }catch(error){rows.push({sourcePath,passed:false,error:safeBrowserError(error)});}
 const combined=[...(only?previous?.rows||[]:[]).filter((r:any)=>!rows.some(n=>n.sourcePath===r.sourcePath)),...rows];
 await writeJson(reportFile,{kind:'certificate-detail-reconnaissance-not-settled-state-or-acceptance',sourceSnapshot:paths.sourceSnapshot,sourceSnapshotMeaning:'route-needs provenance only; captures have independent rendered hashes, source-version equality is not established',rows:combined,priorAttempt,sourceFormsSubmitted:false,published:false});
 console.log(JSON.stringify({sourcePath,passed:rows.at(-1).passed,devices:rows.at(-1).rows?.length}));
}
if(rows.some(r=>!r.passed))process.exitCode=1;
