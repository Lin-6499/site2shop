import {dirname,join,resolve} from 'node:path';
import {load} from 'cheerio';
import {jsonFile,saveArtifact,writeJson} from '../src/shopyy/artifacts.js';
import {renderFamilies} from '../src/shopyy/families.js';
import type {Plan} from '../src/shopyy/contracts.js';

// Parser/input diagnostic only. It neither approves inventory nor writes a build/handoff.
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
const proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
const sourceInventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const routes=Object.fromEntries(proposal.rows.map((r:any)=>[r.sourcePath,{disposition:r.proposedDisposition,targetPath:r.targetPath,family:r.family,rationale:r.rationale}]));
const inventory=await saveArtifact(root,{...sourceInventory,routes,complete:false,role:'unapproved-parser-diagnostic-only'});
const plan=await jsonFile(join(root,project.capturePlanFile));
const result=await renderFamilies(root,project,{...plan,inventory} as Plan);
const failures:any[]=[];
for(const[path,html]of result.preview){
 const $=load(html);
 if($('[data-vr-storefront]').length!==1||$('h1').length!==1)failures.push({path,reason:'Missing/ambiguous real page root or heading'});
 if($('script[src]').toArray().some(n=>/^https?:\/\/voidresearch\.shop/.test($(n).attr('src')||'')))failures.push({path,reason:'Source script must not be copied'});
}
for(const[path,html]of result.native)if(html.includes('data-vr-catalog')||html.includes('fixture-only-public-source-observations'))failures.push({path,reason:'Fixture catalog leaked into native output'});
const report={kind:'composer-parser-diagnostic-not-build-or-acceptance',previewPages:result.preview.size,nativeComposers:result.native.size,routeDestinations:Object.keys(result.routes).length,failures,passed:!failures.length,sourceInventoryApproved:false,buildCreated:false,draftChanged:false,published:false};
await writeJson(join(root,'verification/recon-current/composer-input-check.json'),report);
console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=2;
