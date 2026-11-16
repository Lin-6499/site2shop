import {resolve,dirname,join} from 'node:path';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {collectSourceAssets} from '../src/shopyy/source-assets.js';
import {sourcePrivacyPolicy} from '../src/shopyy/source-privacy.js';
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),refs=new Map();
for(const name of ['collection','notification','disclosure','product','policy']){
 const run=await jsonFile(join(root,`verification/recon-current/${name}-development-source-run.json`)).catch(()=>null);
 for(const state of run?.rows||[])for(const row of state.rows||[]){if(!row.passed||!row.structure)continue;const data=await readRef(root,row.structure).then(b=>JSON.parse(b.toString())).catch(()=>null);if(!data)continue;if((data.sourcePrivacyPolicySha256||null)!==sourcePrivacyPolicy(project,data.requestedPath))continue;refs.set(row.structure.sha256,row.structure);}
}
const evidenceFile='contracts/supplemental-asset-observations.v2.json';await writeJson(join(root,evidenceFile),[...refs.values()]);project.workflow.sourceAssetObservationsFile=evidenceFile;await writeJson(file,project);
console.log(JSON.stringify({kind:'supplemental-rendered-asset-evidence',observations:refs.size}));console.log(JSON.stringify(await collectSourceAssets(file)));
