import {dirname,resolve,join} from 'node:path';
import {jsonFile,writeJson,readRef,digest,safeBrowserError} from '../src/shopyy/artifacts.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {sourceStorage} from '../src/shopyy/source-session.js';
import {load} from 'cheerio';
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),storage=await sourceStorage(project),snapshot='home-source-r1-8863e9b51c8e';
const cases=[{id:'glp-3-rt',index:1},{id:'tesamorelin',index:2},{id:'ghk-cu',index:3},{id:'mots-c',index:4}],rows:any[]=[];
for(const entry of cases){const id='home-picks-strength-'+entry.id,selectors=`contracts/${id}.json`,card=`#researcher-picks > div > div:nth-child(${entry.index})`;
 await writeJson(join(root,selectors),{sourcePath:'/',inspectionId:id,captureStructure:true,topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'#shop',initialReady:'header [data-first-screen-marquee="true"]',actions:[{op:'click',selector:card+' button[aria-label^="Strength "]',effect:'read-only'}],components:{picks:'#shop',card,strengthButton:card+' button[aria-label^="Strength "]'}});
 try{const report=await inspectSourceComponents(file,selectors,{sourceStorageState:storage}),details=[];for(const row of report.rows){if(!row.structure){details.push({viewport:row.viewport,passed:false,reason:'structure missing'});continue;}const dom=JSON.parse((await readRef(root,row.structure)).toString()),$=load(dom.structure),selected=$(card);details.push({viewport:row.viewport,structure:row.structure,cardText:selected.text().replace(/\s+/g,' ').trim(),cardButtons:selected.find('button').map((_,n)=>({label:$(n).attr('aria-label')||$(n).text().trim(),role:$(n).attr('role')||null,expanded:$(n).attr('aria-expanded')||null})).get()});}rows.push({id:entry.id,sourceSnapshot:snapshot,report,details});console.log(JSON.stringify({id:entry.id,captures:report.rows.length,failed:report.rows.filter((r:any)=>!r.passed).length,details:details.map(d=>({viewport:d.viewport,buttons:d.cardButtons?.map((b:any)=>b.label)}))}));}
 catch(error){rows.push({id:entry.id,sourceSnapshot:snapshot,passed:false,error:safeBrowserError(error)});}
 await writeJson(join(root,'verification/recon-current/home-picks-strength-menu-run.json'),{kind:'read-only-strength-menu-observations-not-cart-or-fidelity-acceptance',sourceSnapshot:snapshot,rows,sourceCartMutation:false,sourceWishlistMutation:false,published:false});
}
