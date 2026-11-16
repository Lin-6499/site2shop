import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {jsonFile,writeJson,digest} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
const file=resolve(process.argv[2]),root=dirname(file),run=await jsonFile(join(root,'verification/recon-current/home-header-announcement-current.json'));
if(!run.passed||run.rows.length!==3)throw Error('Three-device current homepage evidence is required');
const source=run.rows.find((r:any)=>r.viewport==='desktop').structure;
const selectors={header:'div.min-h-screen > header',hero:'div.min-h-screen > section:nth-of-type(1)','trust-strip':'div.min-h-screen > section:nth-of-type(2)','researcher-picks':'#shop','batch-testing':'div.min-h-screen > section:nth-of-type(4)',dispatch:'#dispatch','lot-lookup':'div.min-h-screen > section:nth-of-type(6)',quality:'#quality','assurance-newsletter':'div.min-h-screen > section:nth-of-type(8)',footer:'footer'};
const recipeFile='contracts/current-home-composer.recipe.json';
await writeJson(join(root,recipeFile),{schemaVersion:2,sourcePath:'/',componentSelectorsFile:'contracts/home-components.draft.json',outputDirectory:'staging/home-current',fragments:Object.entries(selectors).map(([id,selector])=>({id,selector,observation:source,rootAttributes:{'data-vr-component':({'researcher-picks':'researcherPicks','batch-testing':'batchTesting','assurance-newsletter':'assurance'} as Record<string,string>)[id]||id}}))});
await prepareComposerInputs(file,recipeFile);
const generated=await jsonFile(join(root,'staging/home-current/provenance.json')),provenance=await jsonFile(join(root,'staging/composers/provenance.json'));
for(const output of generated.outputs){await writeFile(join(root,'staging/composers',output.file),await readFile(join(root,'staging/home-current',output.file)));provenance.outputs=provenance.outputs.filter((o:any)=>o.id!==output.id);provenance.outputs.push({...output,recipeFile});}
await writeJson(join(root,'staging/composers/provenance.json'),provenance);
console.log(JSON.stringify({prepared:generated.outputs.map((o:any)=>({id:o.id,sha256:o.sha256})),published:false}));
