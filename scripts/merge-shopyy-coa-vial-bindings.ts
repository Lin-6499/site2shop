import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('../voidresearch-shopyy'),dir=join(root,'verification/asset-hosting-504457'),newDir=join(dir,'coa-vials-r1');
const digest=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const oldRaw=await readFile(join(dir,'report.json'),'utf8'),newRaw=await readFile(join(newDir,'report.json'),'utf8');
const prior=JSON.parse(oldRaw),incoming=JSON.parse(newRaw);
for(const report of [prior,incoming])if(!report.passed||report.target?.origin!=='https://pepsss.zenshop.cn'||report.target?.skinId!=='504457'||!report.rows.every((r:any)=>r.passed&&r.sameBytes&&r.samePixels&&r.sameDimensions))throw Error('Unverified asset set');
const rows=new Map(prior.rows.map((r:any)=>[r.assetToken,r]));
for(const row of incoming.rows){
 const existing:any=rows.get(row.assetToken);if(existing&&JSON.stringify(existing)!==JSON.stringify(row))throw Error('Asset mapping conflict');
 const bytes=await readFile(join(newDir,row.evidence.path));if(digest(bytes)!==row.evidence.sha256||digest(bytes)!==row.targetSha256)throw Error('Asset evidence drift');
 await copyFile(join(newDir,row.evidence.path),join(dir,row.evidence.path));rows.set(row.assetToken,row);
}
const backup=join(dir,'report.before-coa-vials-r1.json');
await writeFile(backup,oldRaw,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
const merged={...prior,kind:'aggregate-independently-verified-uploaded-assets',rows:[...rows.values()].sort((a:any,b:any)=>a.assetToken.localeCompare(b.assetToken)),sourceReports:[{path:'report.before-coa-vials-r1.json',sha256:digest(oldRaw)},{path:'coa-vials-r1/report.json',sha256:digest(newRaw)}],passed:true,published:false};
await writeFile(join(dir,'report.json'),JSON.stringify(merged,null,2));
await writeFile(join(dir,'verified-asset-map.json'),JSON.stringify(Object.fromEntries(merged.rows.map((r:any)=>[r.assetToken,r.targetUrl])),null,2));
const bindingsFile=join(root,'verification/incremental-draft-504457/uploaded-asset-bindings.json'),bindingRaw=await readFile(bindingsFile,'utf8'),bindings=JSON.parse(bindingRaw),candidate=JSON.parse(await readFile(join(root,'verification/incremental-draft-504457/coa-vial-uploads/candidates.json'),'utf8'));
await writeFile(bindingsFile.replace('.json','.before-coa-vials-r1.json'),bindingRaw,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
const all=new Map(bindings.assets.map((a:any)=>[a.assetToken,a]));for(const a of candidate.assets){const row:any=rows.get(a.assetToken);if(!row||row.targetUrl!==a.targetUrl||row.sourceSha256!==a.sha256)throw Error('Binding differs from verified bytes');if(!all.has(a.assetToken))all.set(a.assetToken,a);}
await writeFile(bindingsFile,JSON.stringify({...bindings,assets:[...all.values()]},null,2));
console.log(JSON.stringify({verifiedAssets:merged.rows.length,bindings:all.size,published:false}));
