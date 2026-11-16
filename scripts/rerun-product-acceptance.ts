import {resolve} from 'node:path';
import {captureProductFamilyEvidence, verifyProductFamilyVisuals} from '../src/product-family-evidence.js';
import {readJson} from '../src/util.js';
import {mkdir,copyFile} from 'node:fs/promises';
const project=resolve('../westandwillow-phase3');
const out=resolve(project,'acceptance-20261022-workflow');
await mkdir(out,{recursive:true});
const compareOnly=process.argv.includes('--compare-only');
if(!compareOnly) for(const file of ['site-ir.json','product-family-contracts.json','deployment.json','theme-build.json']) await copyFile(resolve(project,file),resolve(out,file));
const deployment=await readJson<any>(resolve(out,'deployment.json'));
const extra=['custom-two-pet-portrait'];
const results=compareOnly ? null : await Promise.allSettled([
  captureProductFamilyEvidence(out,'https://westandwillow.com/','source',undefined,true,extra),
  captureProductFamilyEvidence(out,deployment.previewUrl,'target',undefined,true,extra),
]);
for(const result of results||[]) if(result.status==='rejected') throw result.reason;
const target=compareOnly ? await readJson<any>(resolve(out,'product-family-target-evidence.json')) : results?.[1].status==='fulfilled'?results[1].value:null;
const audit=await verifyProductFamilyVisuals(out,deployment.previewUrl,12,target);
console.log(JSON.stringify({passed:audit.passed,checks:audit.contractChecks.length,failed:audit.contractChecks.filter((c:any)=>!c.passed).length}));
process.exitCode=audit.passed?0:1;
