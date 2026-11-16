import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,safeBrowserError} from '../src/shopyy/artifacts.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed policy tabs');
const storageState=await sourceStorage(project),rows:any[]=[];
const states=['shipping','international','returns','terms','billing','privacy','research','complaints','contact'];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
if(only?.some(id=>!states.includes(id)))throw Error('Unknown policy tab');
for(const tab of states.filter(s=>!only||only.includes(s))){
 const selectors=`contracts/policy-development-${tab}.json`;
 await writeJson(join(root,selectors),{sourcePath:'/policies?tab=research',inspectionId:`policy-development-${tab}`,captureStructure:true,topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'body',actions:tab==='research'?[]:[{op:'click',selector:`#policy-tab-${tab}`,effect:'read-only'}],expectedFinalPath:`/policies?tab=${tab}`,postReady:`#policy-tab-${tab}[aria-selected=true]`,components:{header:'body > header',title:'main h1',tabs:'[role=tablist]',panel:'#policy-panel',footer:'body > footer'}});
 try{const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storageState});rows.push({tab,...report});console.log(JSON.stringify({tab,captures:report.rows.length,failed:report.rows.filter((r:any)=>!r.passed).length}));}
 catch(error){rows.push({tab,passed:false,error:safeBrowserError(error)});}
 await writeJson(join(root,'verification/recon-current/policy-development-source-run.json'),{kind:'policy-tab-observations-not-acceptance',rows,sourceSubmissionPerformed:false,published:false});
}
if(rows.some(r=>!r.passed))process.exitCode=1;
