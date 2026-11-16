import {dirname,join,resolve} from 'node:path';
import {load} from 'cheerio';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';

const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed product recipe');
const run=await jsonFile(join(root,'verification/recon-current/product-development-source-run.json'));
if(run.sourcePath!=='/product/bpc-157'||run.rows.length!==8||run.rows.some((s:any)=>!s.passed))throw Error('All eight current product observation states required');
const prepared:any[]=[];
for(const state of run.rows){
 if(JSON.stringify(state.rows.map((r:any)=>r.viewport).sort())!==JSON.stringify(['desktop','mobile','tablet']))throw Error('Product state lacks three-device observations');
 for(const row of state.rows){
  const observation=JSON.parse((await readRef(root,row.structure)).toString());
  if(observation.sourceSessionCurrent!==true||observation.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error('Product observation has a stale source session policy');
  const selectors=`contracts/product-development-${state.state}.json`;
  const recipeFile=`contracts/page-recipes/bpc-${state.state}-${row.viewport}.json`;
  await writeJson(join(root,recipeFile),{schemaVersion:2,sourcePath:run.sourcePath,componentSelectorsFile:selectors,outputDirectory:`staging/product-bpc-states/${state.state}/${row.viewport}`,fragments:[{id:'hero',selector:'div.min-h-screen > section:first-of-type',observation:row.structure}]});
  const result=await prepareComposerInputs(file,recipeFile),$=load(observation.structure);
  const quantity=$('div:has(> button[aria-label="Increase quantity"])').text().trim();
  prepared.push({state:state.state,viewport:row.viewport,sourceEvidence:row.structure,quantity,selectedBundle:$('div.grid > button.border-brand').text().trim().replace(/\s+/g,' '),heroText:$('div.min-h-screen > section:first-of-type').text().trim().replace(/\s+/g,' '),directory:result.directory});
 }
}
await writeJson(join(root,'verification/recon-current/product-state-inputs.json'),{kind:'prepared-product-state-inputs-not-implementation-or-acceptance',sourcePath:run.sourcePath,prepared,note:'Bundle selection and quantity are independent observed controls. Preserve contextual price and coin differences; no invented price/coin formula, source cart request or native fixture fallback is authorized by these inputs.',localCompared:false,sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false});
console.log(JSON.stringify({prepared:prepared.length,states:run.rows.length,status:'inputs-only-not-attached-to-rendered-families'}));
