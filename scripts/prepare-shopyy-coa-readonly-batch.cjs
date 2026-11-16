const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function prepare({projectRoot,finished,nativeBlockIds}){
 const root=path.resolve(projectRoot),base=path.join(root,'verification/incremental-draft-504457');
 const planFile=path.join(root,'verification/coa-native-trial-r3-da509ae2f7c0.proposed.json'),planRaw=await fs.readFile(planFile,'utf8'),plan=JSON.parse(planRaw);
 const oldFile=path.join(base,'r5-contact-route-gate-10c139d6005c/server-readback.json'),oldRaw=await fs.readFile(oldFile,'utf8'),old=JSON.parse(oldRaw);
 if(finished.status!=='transport-verified'||finished.rows.length!==13||finished.native.rows.length!==13||finished.published!==false||nativeBlockIds.length!==13||new Set(nativeBlockIds).size!==13)throw Error('Unverified composition');
 const codes=[];
 for(const p of old.parts)codes.push({...p,version:old.version,code:await fs.readFile(path.join(path.dirname(oldFile),p.file),'utf8')});
 for(const p of plan.parts)codes.push({...p,version:plan.version,code:await fs.readFile(path.join(root,p.file),'utf8')});
 for(let i=0;i<codes.length;i++)if(sha(codes[i].code)!==codes[i].sha256||finished.rows[i].sha256!==codes[i].sha256||finished.native.rows[i].sha256!==codes[i].sha256)throw Error('Composition bytes drift');
 const compositionId=sha(JSON.stringify(codes.map(p=>({id:p.id,sha256:p.sha256})))),batchId='content13-coa-contact-'+compositionId.slice(0,16),dir=path.join(base,'pipeline/batches',batchId);
 await fs.mkdir(dir,{recursive:true});
 const save=async(name,data)=>{try{await fs.writeFile(path.join(dir,name),data,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await fs.readFile(path.join(dir,name),'utf8')!==data)throw e;}};
 const parts=[];for(const p of codes){const codeFile=p.id+'.html';await save(codeFile,p.code);parts.push({id:p.id,version:p.version,codeFile,sha256:p.sha256,characters:p.code.length});}
 const receiptRaw=JSON.stringify(finished,null,2);await save('server-readback.json',receiptRaw);await save('coa-plan.json',planRaw);await save('contact-baseline.json',oldRaw);
 const dependencies=[];for(const name of ['verification/coa-r3-independent-review.json',plan.candidateManifest.file,'verification/asset-hosting-504457/report.json']){const data=await fs.readFile(path.join(root,name),'utf8'),file=path.basename(name)==='report.json'?'resource-report.json':path.basename(name);await save(file,data);dependencies.push({file,sha256:sha(data)});}
 const batch={kind:'immutable-native-batch-for-independent-readonly-online-verification',batchId,target:{origin:plan.target.origin,skinId:'504457',role:'draft'},requiredParams:plan.target.requiredParams,pages:['/pages/coa','/pages/Contact-Us'].map(route=>({group:'自定义页面',route,compositionId,nativeBlockIds,serverReadback:{file:'server-readback.json',sha256:sha(receiptRaw)},parts})),dependencies,protocol:{writer:'/root',reader:'/root/independent_qa',beginAndEndVersionChecks:true,mismatchVerdict:'stale-requires-targeted-retest',remoteReaderWritesAllowed:false,lockedGroups:['自定义页面'],otherWorkAllowed:'Product and collection groups; additive public media; local work. No shared content or global setting writes.'},acceptance:{scope:'COA directory capability and Contact regression; certificate detail, lot lookup, forms and commerce remain unbound',wholeSite:false,visual:'pending-independent-online'},published:false,publicationAllowed:false};
 const raw=JSON.stringify(batch,null,2);await save('batch.json',raw);const batchFile=path.join(dir,'batch.json');
 await fs.writeFile(path.join(base,'pipeline/page-locks.current.json'),JSON.stringify({target:batch.target,batchId,batchFile,owner:'/root/independent_qa',active:true,groups:['自定义页面'],releaseFile:path.join(dir,'readonly-release.json'),reason:'COA and Contact fixed composition independent native verification',published:false},null,2));
 return{batchId,batchFile,batchSha256:sha(raw),lockedGroups:['自定义页面']};
}
module.exports={prepare};
