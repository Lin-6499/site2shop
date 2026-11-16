import {readFile,writeFile} from 'node:fs/promises';import {dirname,join,resolve} from 'node:path';
import {jsonFile,writeJson,digest} from '../src/shopyy/artifacts.js';import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';
const file=resolve(process.argv[2]),root=dirname(file),fragments=[];
for(const[id,mode,selector]of [['mobile-menu','menu','header > div.lg\\:hidden'],['mobile-more','more','header > div.lg\\:hidden nav > button[aria-label="More Void Research pages"] + div']]){
 const run=await jsonFile(join(root,`verification/recon-current/home-current-navigation-${mode}.json`));
 if(!run.passed||run.rows.length!==2)throw Error('Current two-device mobile navigation branch evidence required');
 fragments.push({id,selector,observation:run.rows.find((r:any)=>r.viewport==='mobile').structure,rootAttributes:{'data-vr-component':id==='mobile-menu'?'mobilePanel':'mobileMore'}});
}
const recipeFile='contracts/current-navigation-composer.recipe.json';await writeJson(join(root,recipeFile),{schemaVersion:2,sourcePath:'/',outputDirectory:'staging/navigation-current',fragments});await prepareComposerInputs(file,recipeFile);
const generated=await jsonFile(join(root,'staging/navigation-current/provenance.json')),provenance=await jsonFile(join(root,'staging/composers/provenance.json'));
for(const output of generated.outputs){await writeFile(join(root,'staging/composers',output.file),await readFile(join(root,'staging/navigation-current',output.file)));provenance.outputs=provenance.outputs.filter((o:any)=>o.id!==output.id);provenance.outputs.push({...output,recipeFile});}
await writeJson(join(root,'staging/composers/provenance.json'),provenance);console.log(JSON.stringify({prepared:generated.outputs.map((o:any)=>({id:o.id,sha256:o.sha256})),published:false}));
