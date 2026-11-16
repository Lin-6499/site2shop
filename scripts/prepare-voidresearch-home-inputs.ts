import {dirname,join,resolve} from 'node:path';
import {jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
import {sourceSessionPolicy} from '../src/shopyy/source-session.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';

// Bind the existing, independently selected fragments to the current discovery.
// This prepares inputs only; it neither approves inventory nor creates a build.
const file=resolve(process.argv[2]||''),root=dirname(file),project=await jsonFile(file);
if(new URL(project.sourceUrl).hostname!=='voidresearch.shop')throw Error('Site-specific observed homepage recipe');
const inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const recipeFile='contracts/home-composer.recipe.json',recipe=await jsonFile(join(root,recipeFile));
if(!recipe.fragments.some((f:any)=>f.id==='shipping-notice'))recipe.fragments.push({id:'shipping-notice',selector:'body > div:has(#intl-waitlist-email)'});
const states:Record<string,{state:string,viewport:string}>={
 'mobile-menu':{state:'mobile-menu-open',viewport:'mobile'},
 'mobile-more':{state:'mobile-more-open',viewport:'mobile'},
 'search-overlay':{state:'search-open',viewport:'desktop'},
 'cart-empty':{state:'cart-empty-open',viewport:'desktop'},
};
for(const fragment of recipe.fragments){
 const requested=states[fragment.id]||{state:'initial',viewport:'desktop'};
 const surface=inventory.coverage.surfaces.find((s:any)=>s.path==='/'&&s.state===requested.state&&s.viewport===requested.viewport);
 if(!surface)throw Error(`Missing current homepage observation: ${fragment.id}`);
 const observation=JSON.parse((await readRef(root,surface.evidence)).toString());
 if(observation.sourceSessionCurrent!==true||observation.sourceSessionPolicySha256!==sourceSessionPolicy(project))throw Error(`Stale source session evidence: ${fragment.id}`);
 fragment.observation=surface.evidence;
 // The empty-cart portal has its own header; the storefront header is a root child.
 if(fragment.id==='header')fragment.selector='div.min-h-screen > header';
}
await writeJson(join(root,recipeFile),recipe);
console.log(JSON.stringify(await prepareComposerInputs(file,recipeFile)));
