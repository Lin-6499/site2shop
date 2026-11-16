import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {digest,writeJson} from '../src/shopyy/artifacts.js';
// This revision owns the complete emitted dispatcher CSS, not a generated-file-only edit.
const root=resolve('../voidresearch-shopyy'), prior='r5-membership-native-bbafdb4eb5e0', installed='r3-membership-native-abbc9d1a8a50';
const priorDir=join(root,'staging/local-inner-candidates',prior), priorBytes=await readFile(join(priorDir,'manifest.json')), m=JSON.parse(priorBytes.toString());
const original=JSON.parse(await readFile(join(root,'staging/local-inner-candidates',installed,'manifest.json'),'utf8'));
const parts=[];
for(const part of m.parts){
 let html=await readFile(join(priorDir,part.file),'utf8');
 if(digest(html)!==part.sha256)throw Error('Changed frozen prior '+part.file);
 if(part.file==='dispatcher.html'){
  if(!html.startsWith('<style>'))throw Error('Unexpected dispatcher style boundary');
  html=html.replace('<style>','<style>#vr-membership-route-host:not([data-ready="true"]){display:none!important}');
 }
 parts.push({...part,html,sha256:digest(html),characters:html.length});
}
const version='r6-membership-native-'+digest(parts.map(p=>p.html).join('')).slice(0,12),directory='staging/local-inner-candidates/'+version,dir=join(root,directory);
await mkdir(dir,{recursive:true});await mkdir(join(dir,'inputs'),{recursive:true});
for(const f of await readdir(join(priorDir,'inputs')))await writeFile(join(dir,'inputs',f),await readFile(join(priorDir,'inputs',f)));
for(const p of parts)await writeFile(join(dir,p.file),p.html);
const generatorBytes=await readFile(new URL(import.meta.url));await writeFile(join(dir,'inputs/membership-r6-generator.ts'),generatorBytes);
await writeJson(join(dir,'manifest.json'),{...m,version,priorTransport:{directory:'staging/local-inner-candidates/'+prior,manifestSha256:digest(priorBytes)},generator:{file:'inputs/membership-r6-generator.ts',sha256:digest(generatorBytes)},parts:parts.map(({html,...p})=>p),lifecyclePaintRepair:{rule:'#vr-membership-route-host:not([data-ready="true"]){display:none!important}',reason:'All same-ID clones lose ready on invalidation, including deep clones outside native block wrappers; each must cease painting immediately.',sharedLifecycleModuleChanged:false},independentReview:'pending',provisionalDraftTrialAllowed:false,targetReady:false,pending:['Independent r6 deep-clone and compound review','Actual native checkbox paint, keyboard focus and stable mounting after fresh exact writer readback','Whole-page native business and formal build acceptance remain incomplete']});
const manifestBytes=await readFile(join(dir,'manifest.json'));
await writeJson(join(root,'verification',version+'.proposed.json'),{kind:'member-checkbox-and-deep-clone-paint-repair',version,target:m.target,group:'自定义页面',publicationAllowed:false,targetReady:false,nativeTrialAllowed:'await-independent-code-and-compound-review',candidateManifest:{file:directory+'/manifest.json',sha256:digest(manifestBytes)},parts:parts.map((p,i)=>{const old=original.parts.find((x:any)=>x.file===p.file);return{id:p.id.slice(3),scope:'#'+p.id,file:directory+'/'+p.file,sha256:p.sha256,characters:p.characters,installOrder:i+1,stableMarkerKind:p.file==='dispatcher.html'?'div':'template',...(p.sha256===old.sha256?{alreadyExpectedExactFrom:installed}:{allowedPrevious:{version:installed,sha256:old.sha256,scope:'#'+p.id,requiresFreshExactReadbackAndBackup:true}})};}),constraints:['Only shared-styles and dispatcher differ from installed r3','Exactly six existing membership scopes; preserve Contact/COA/Policies and platform notice','Fresh exact readback and backup before replacement; dispatcher last; writer lease mandatory','No publish or activation'],nativeLifecycleGuard:m.nativeLifecycleGuard,sourceNativeControlAdapter:m.sourceNativeControlAdapter});
console.log(JSON.stringify({version,directory,manifestSha256:digest(manifestBytes),changed:parts.filter(p=>original.parts.find((x:any)=>x.file===p.file).sha256!==p.sha256).map(p=>p.file)}));
