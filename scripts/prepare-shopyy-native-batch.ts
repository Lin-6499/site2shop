import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('../voidresearch-shopyy'),base='verification/incremental-draft-504457',hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const homeRaw=await readFile(join(root,base,'home-current-server-readback.json'),'utf8'),home=JSON.parse(homeRaw),trial=JSON.parse(await readFile(join(root,'verification/contact-route-native-trial-plan.json'),'utf8')),contactRaw=await readFile(join(root,base,trial.version,'server-readback.json'),'utf8'),contact=JSON.parse(contactRaw);
if(home.target.skinId!=='504457'||home.target.role!=='draft'||home.blocks.length!==12||contact.parts.length!==4||home.published!==false||contact.published!==false)throw Error('Expected exact current draft compositions');
const batchId='home12-contact4-'+hash(homeRaw+contactRaw).slice(0,16),dir=join(root,base,'pipeline/batches',batchId);await mkdir(dir,{recursive:true});
const pages=[];
for(const [group,route,build,raw] of [['首页','/',home,homeRaw],['自定义页面','/pages/Contact-Us',contact,contactRaw]] as any){
 const parts=[];
 for(const part of build.blocks||build.parts){
  const file=part.readback?join(root,base,part.readback):join(root,base,trial.version,part.file),code=await readFile(file,'utf8');if(hash(code)!==part.sha256||part.exact!==true)throw Error('Saved part drift');
  const name=part.id+'.html';await writeFile(join(dir,name),code,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  parts.push({id:part.id,version:part.version||trial.version,codeFile:name,sha256:part.sha256,characters:code.length});
 }
 const readbackFile=group==='首页'?'home-server-readback.json':'contact-server-readback.json';await writeFile(join(dir,readbackFile),raw,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const versions=[...new Set(parts.map((p:any)=>p.version))],inputManifests=[];
 for(const version of versions){const file=group==='首页'?join(root,'staging/handoff-packages',String(version),'manifest.json'):join(root,'staging/local-inner-candidates',String(version),'manifest.json');const input=await readFile(file,'utf8'),name='input-'+version+'.json';await writeFile(join(dir,name),input,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});inputManifests.push({version,file:name,sha256:hash(input)});}
 pages.push({group,route,compositionId:build.compositionId,serverReadback:{file:readbackFile,sha256:hash(raw)},parts,inputManifests});
}
const assetsRaw=await readFile(join(root,'verification/asset-hosting-504457/report.json'),'utf8');await writeFile(join(dir,'verified-resource-dependencies.json'),assetsRaw,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
const batch={kind:'immutable-native-batch-for-independent-readonly-online-verification',batchId,target:home.target,requiredParams:{theme_id:'504457',preview:'1',is_theme_edit:'1'},pages,resourceDependencies:{file:'verified-resource-dependencies.json',sha256:hash(assetsRaw)},protocol:{writer:'/root',reader:'/root/independent_qa',beginAndEndVersionChecks:true,mismatchVerdict:'stale-requires-targeted-retest',remoteReaderWritesAllowed:false,pageGroupsLocked:true,otherWorkAllowed:'Unique new public media uploads and local work; no existing resources/page/global settings changed'},acceptance:{visual:'pending-independent-online',interactions:'pending-independent-online',navigation:'pending-independent-online',realProductCartMutation:'pending',wholeSite:false},published:false,publicationAllowed:false};
const batchFile=join(dir,'batch.json');await writeFile(batchFile,JSON.stringify(batch,null,2),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
const actual=await readFile(batchFile,'utf8');
const locks={target:home.target,batchId,batchFile:batchFile,owner:'/root/independent_qa',active:true,groups:pages.map(p=>p.group),releaseFile:join(dir,'readonly-release.json'),reason:'Independent native verification; writer may not modify these groups until explicit release',published:false};
await writeFile(join(root,base,'pipeline/page-locks.current.json'),JSON.stringify(locks,null,2));console.log(JSON.stringify({batchId,batchFile,batchSha256:hash(actual),lockedGroups:locks.groups,published:false}));
