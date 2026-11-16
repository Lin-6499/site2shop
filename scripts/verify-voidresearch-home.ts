import {dirname,join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {digest,writeJson,safeBrowserError,jsonFile} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {compareHomeDevelopment} from './compare-voidresearch-home-development.js';

const project=resolve(process.argv[2]||''),root=dirname(project),summaryOnly=process.argv.includes('--summarize-existing');
const scenarios=['initial','shippingNotice','shippingDismissed','sections','sectionsClosed','more','desktopMoreClosed','mobileMenu','menuClosed','mobileMore','moreClosed','searchGHK','searchNone','searchReset','searchClosed','cart','cartClosed','footer','picksRight','picksReset','searchDirect','searchNavigate'];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
if(only?.some(v=>!scenarios.includes(v)))throw Error('Unknown development scenario subset');
const rows:any[]=[];
// Keep the authorized origin-scoped session in this process only. Never serialize it or pass it to target contexts.
const storageState=summaryOnly?undefined:await sourceStorage(await jsonFile(project));
for(const scenario of scenarios.filter(v=>!only||only.includes(v))){
 try{
 if(!summaryOnly)await compareHomeDevelopment(project,scenario,storageState);
 const file=`home-development-comparison${scenario==='initial'?'':`-${scenario.toLowerCase()}`}.json`;
 const bytes=await readFile(join(root,'verification/recon-current',file)),report=JSON.parse(bytes.toString());
 const desktop=['sections','sectionsClosed','more','desktopMoreClosed'].includes(scenario),mobile=['mobileMenu','menuClosed','mobileMore','moreClosed'].includes(scenario);
 const expected=desktop?['desktop']:mobile?['mobile','tablet']:['desktop','mobile','tablet'];
 if(report.scenario!==scenario||JSON.stringify(report.comparisons.map((r:any)=>r.viewport).sort())!==JSON.stringify(expected))throw Error('Missing or mismatched scenario viewport coverage');
 rows.push({scenario,report:{path:file,sha256:digest(bytes)},developmentRenderSha256:report.developmentRenderSha256||null,captures:report.comparisons.length,errors:report.comparisons.flatMap((r:any)=>r.errors||[]),differences:report.comparisons.flatMap((r:any)=>(r.differences||[]).map((d:any)=>({viewport:r.viewport,...d})))});
 console.log(JSON.stringify({scenario,captures:rows.at(-1).captures,errors:rows.at(-1).errors.length,differences:rows.at(-1).differences.length}));
 }catch(error){
  rows.push({scenario,report:null,developmentRenderSha256:null,captures:0,errors:[safeBrowserError(error)],differences:[]});
  console.log(JSON.stringify({scenario,status:'failed-attempt-recorded'}));
 }
}
const identities=[...new Set(rows.map(r=>r.developmentRenderSha256))];
const report={kind:'homepage-development-run-not-acceptance',capturedAt:new Date().toISOString(),project,renderIdentityConsistent:identities.length===1&&!!identities[0],developmentRenderSha256:identities.length===1?identities[0]:null,scenarios:rows,totalCapturePairs:rows.reduce((n,r)=>n+r.captures,0),visualReview:'requires-explicit-image-review',sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false};
await writeJson(join(root,'verification/recon-current/home-development-run.json'),report);
if(!report.renderIdentityConsistent||rows.some(r=>r.errors.length||r.differences.length))process.exitCode=1;
