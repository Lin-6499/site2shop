import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,safeBrowserError,saveArtifact} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed disclosure controls');
const source=await sourceStorage(project),rows:any[]=[];
const groups=[{id:'contact',path:'/contact',questions:[
 'What are research peptides and what purpose do they serve?',
 'How does VoidResearch ensure the purity of every compound?',
 'Is it legal to order these compounds from outside the United States?',
 'Who is authorized to purchase from VoidResearch?',
]},{id:'affiliate',path:'/affiliate',questions:[
 'How much do I earn per referral?','How often do I get paid?','What does my referred researcher get?',
 'What unlocks at 25 sales?','What is an every-code sale?','How long is the referral tracking window?',
 'Is there a minimum referral requirement?',
]}];
const reportFile=join(root,'verification/recon-current/disclosure-development-source-run.json'),previous=await jsonFile(reportFile).catch(()=>null),priorAttempt=previous?await saveArtifact(root,previous):null;
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
for(const group of groups){
 const selector=(index:number)=>`button:has-text(${JSON.stringify(group.questions[index])})`;
 const panel=(index:number)=>`div:has(> ${selector(index)}) > div`;
 const states=[{id:'initial',index:0,open:true,actions:[]},...group.questions.flatMap((_,index)=>[
  ...(index?[{id:`open-${index}`,index,open:true,actions:[{op:'click',selector:selector(index),effect:'read-only'}]}]:[]),
  {id:`close-${index}`,index,open:false,actions:[...(index?[{op:'click',selector:selector(index),effect:'read-only'}]:[]),{op:'click',selector:selector(index),effect:'read-only'}]},
 ])];
 for(const state of states){
  const id=`${group.id}-faq-${state.id}`,selectors=`contracts/disclosure-${id}.json`;
  if(only&&!only.includes(`${group.id}:${state.id}`))continue;
  await writeJson(join(root,selectors),{sourcePath:group.path,inspectionId:id,captureStructure:true,initialReady:'header [data-first-screen-marquee]',settleDocumentScroll:true,contextNormalization:{id:'shipping-notice-dismissed',rationale:'Ordinary disclosure states share an unobscured viewport; preserve overlay branches separately.',preservedBranch:'verification/recon-current/context-overlay-source-run.json',dismissals:[{selector:'button[aria-label="Dismiss shipping notice"]',op:'press',value:'Enter',waitMs:15000}]},topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',actions:[...state.actions,{op:'scroll',y:0,effect:'read-only'}],...(state.open?{postReady:panel(state.index)}:{postAbsent:panel(state.index)}),components:{header:'div.min-h-screen > header',title:'h1',disclosures:'#faq',footer:'footer'}});
  try{const report=await inspectSourceComponents(file,selectors,{sourceStorageState:source});rows.push({group:group.id,sourcePath:group.path,state:state.id,index:state.index,open:state.open,...report});console.log(JSON.stringify({group:group.id,state:state.id,failed:report.rows.filter((r:any)=>!r.passed).length}));}
  catch(error){rows.push({group:group.id,sourcePath:group.path,state:state.id,index:state.index,open:state.open,passed:false,error:safeBrowserError(error)});}
  const combined=[...(only?previous?.rows||[]:[]).filter((r:any)=>!rows.some(n=>n.group===r.group&&n.state===r.state)),...rows];
  await writeJson(reportFile,{kind:'observed-disclosure-states-not-acceptance',groups,rows:combined,priorAttempt,sourceSubmissionPerformed:false,published:false});
 }
}
if(rows.some(r=>!r.passed))process.exitCode=1;
