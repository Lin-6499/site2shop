'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),manifestFile=process.argv[3],sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const safe=f=>{const p=path.resolve(root,f);assert.ok(p.startsWith(root+path.sep),'outside project');return p;};
const read=async f=>JSON.parse(await fs.readFile(safe(f),'utf8'));
(async()=>{
 const manifestBytes=await fs.readFile(safe(manifestFile)),m=JSON.parse(manifestBytes),dir=path.dirname(manifestFile),checks=[];
 assert.equal(m.target.skinId,'504457');assert.equal(m.target.path,'/pages/coa');assert.equal(m.target.cmsId,6592689);assert.equal(m.target.pageKeys.length,9);
 assert.equal(m.baseline.fresh37Sha256,'e98ddab4fdc66fef31a446b84892b69a9adff1eadcfdea0db110d1bfeb43f911');
 assert.equal(m.parts.length,4);assert.deepEqual(m.parts.map(p=>p.index),[32,33,34,35]);assert.equal(m.unchangedOriginal33.length,33);
 for(const n of ['additions','deletions','reorders'])assert.equal(m[n],0);
 assert.equal(m.customBefore,37);assert.equal(m.customAfter,37);assert.equal(m.fixtureMarkerRequired,false);assert.equal(m.published,false);
 const baseline=await read(path.join(m.baseline.directory,'fresh37-baseline.json'));
 assert.equal(baseline.blocks.length,37);
 for(const b of m.unchangedOriginal33){assert.ok(![32,33,34,35].includes(b.index));assert.equal(b.rawSha256,baseline.blocks[b.index].sha256||baseline.blocks[b.index].rawSha256);}
 let encoded='';
 for(const p of m.parts){const bytes=await fs.readFile(safe(path.join(dir,p.file))),s=bytes.toString('utf8'),b=baseline.blocks[p.index],original=await fs.readFile(safe(b.file),'utf8');assert.equal(sha(bytes),p.sha256);assert.ok(s.startsWith(original),'retired prefix changed');assert.equal(sha(original),p.prefixRawSha256);assert.equal(p.nativeId,b.nativeId);assert.ok(s.length<=m.partBudget);if(p.index<35){const data=s.match(/<template id="vr-content-draft-r3-data-\d+">([^<]*)<\/template>/);assert.ok(data);encoded+=data[1];}checks.push({index:p.index,sha256:p.sha256,retiredPrefixExact:true,characters:s.length});}
 const modelBytes=await fs.readFile(safe(path.join(dir,m.model.file))),decoded=zlib.gunzipSync(Buffer.from(encoded,'base64'));assert.equal(sha(modelBytes),m.model.sha256);assert.equal(sha(decoded),sha(modelBytes));const model=JSON.parse(modelBytes);
 assert.deepEqual(model.pages.map(p=>p.key),m.target.pageKeys);assert.equal(model.assetBindings.length,10);assert.ok(model.assetBindings.every(a=>a.nativeReady&&a.nativeImageId&&/^https:\/\//.test(a.renderUrl)&&!a.renderUrl.includes('voidresearch.shop')));
 let sourceParts=0;for(const p of model.pages)for(const original of p.originalParts){const bytes=await fs.readFile(safe(original.file));assert.equal(sha(bytes),original.sha256);assert.equal(bytes.toString('utf8'),original.raw);sourceParts++;}
 assert.equal(sourceParts,m.sourcePartCount);
 for(const ref of m.inputs){const bytes=await fs.readFile(safe(ref.file));assert.equal(sha(bytes),ref.sha256,ref.file);if(ref.bytes!==undefined)assert.equal(bytes.length,ref.bytes);}
 const out='verification/content-draft-preview-r3-root-review';await fs.mkdir(safe(out),{recursive:true});
 const report={reviewer:'/root',manifest:{file:manifestFile,sha256:sha(manifestBytes)},version:m.version,checks,inputRefs:m.inputs.length,sourceParts,originals33Exact:true,originalRetiredPrefixes4Exact:true,modelGzipRoundtrip:true,nativeAssets:10,passed:true,scope:'Independent immutable input/hash/prefix/capacity review only. Does not approve installation or establish visual, live mount, canonical route or business acceptance.',installApproved:false,published:false,remoteWrites:false};
 await fs.writeFile(safe(out+'/packet-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,checks:'four exact parts'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
