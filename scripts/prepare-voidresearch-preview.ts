import {dirname,join,resolve} from 'node:path';
import {jsonFile,saveArtifact,writeJson} from '../src/shopyy/artifacts.js';

// An explicit, separately configured provisional preview. Never approves the active inventory.
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
const proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
const inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const routing=await saveArtifact(root,{...inventory,complete:false,role:'unapproved-provisional-preview-routing',routes:Object.fromEntries(proposal.rows.map((r:any)=>[r.sourcePath,{disposition:r.proposedDisposition,targetPath:r.targetPath,family:r.family,rationale:r.rationale}]))});
const plan=await jsonFile(join(root,project.capturePlanFile));
await writeJson(join(root,'contracts/preview-plan.unaccepted.json'),{...plan,inventory:routing,status:'unaccepted-provisional-preview'});
await writeJson(join(root,'shopyy.preview.project.json'),{...project,capturePlanFile:'contracts/preview-plan.unaccepted.json',outputDirectory:'build/provisional-preview'});
console.log('Prepared separate unaccepted preview configuration. Active acceptance inventory unchanged.');
