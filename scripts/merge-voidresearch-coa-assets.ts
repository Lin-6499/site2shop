import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import sharp from 'sharp';
import {digest,jsonFile,readRef,writeJson} from '../src/shopyy/artifacts.js';
const root=dirname(resolve(process.argv[2])),currentFile=join(root,'common/assets/images/source-current/manifest.json'),candidateFile=process.argv.find(arg=>arg.startsWith('--candidate='))?resolve(process.argv.find(arg=>arg.startsWith('--candidate='))!.slice(12)):join(root,'staging/coa-detail-candidate-assets/source-current/manifest.json');
const priorBytes=await readFile(currentFile),candidateBytes=await readFile(candidateFile),current=JSON.parse(priorBytes.toString()),candidate=JSON.parse(candidateBytes.toString());
if(current.sourceUrl!==candidate.sourceUrl||candidate.sourceUrl!=='https://voidresearch.shop/'||candidate.schemaVersion!==2)throw Error('Candidate origin or schema mismatch');
const known=new Map(current.assets.map((r:any)=>[r.url,r])),added:any[]=[];
for(const row of candidate.assets){const prior:any=known.get(row.url);if(prior){if(prior.sha256!==row.sha256||prior.file!==row.file)throw Error('Existing URL mapping differs; preserve and resolve explicitly');continue;}
 if(new URL(row.url).origin!==new URL(current.sourceUrl).origin||row.kind!=='image'||!/^([a-f0-9]{64})\.(jpg|png|webp)$/.test(row.file)||!row.file.startsWith(row.sha256)||row.evidence?.length<3)throw Error('Unexpected public image candidate');
 const bytes=await readFile(join(root,'common/assets/images/source-current',row.file)),meta=await sharp(bytes).metadata();
 if(digest(bytes)!==row.sha256||bytes.length!==row.bytes||meta.width!==row.width||meta.height!==row.height||row.contentType!==({jpeg:'image/jpeg',png:'image/png',webp:'image/webp'} as any)[meta.format!])throw Error('Image bytes, type or dimensions mismatch');
 const viewports=new Set<string>();for(const ref of row.evidence){const observed=JSON.parse((await readRef(root,ref)).toString());if(observed.kind!=='reconnaissance-not-acceptance'||new URL(observed.url).origin!==new URL(current.sourceUrl).origin||!JSON.stringify(observed.images).includes(row.url))throw Error('Image lacks rendered URL evidence');viewports.add(observed.viewport);}
 if(!['desktop','tablet','mobile'].every(v=>viewports.has(v)))throw Error('Image lacks three-device rendered provenance');
 added.push(row);known.set(row.url,row);
}
if(!added.length)throw Error('No new candidate assets to merge');
const version='coa-assets-'+digest(candidateBytes).slice(0,12),directory=join(root,'verification/asset-merges',version);
if(await access(directory).then(()=>true,()=>false))throw Error('Immutable merge record already exists');await mkdir(directory,{recursive:true});await writeFile(join(directory,'prior-manifest.json'),priorBytes);await writeFile(join(directory,'candidate-manifest.json'),candidateBytes);
const next={...current,assets:[...current.assets,...added]},nextBytes=JSON.stringify(next,null,2)+'\n';
await writeJson(join(directory,'report.json'),{kind:'strict-additive-copied-public-image-manifest-merge',priorSha256:digest(priorBytes),candidateSha256:digest(candidateBytes),nextSha256:digest(nextBytes),priorAssets:current.assets.length,added:added.map((a:any)=>({url:a.url,file:a.file,sha256:a.sha256,bytes:a.bytes,width:a.width,height:a.height})),preservedExistingMappings:true,preservedFailures:true,dimensionsBytesAndThreeDeviceProvenanceVerified:true,publicationAllowed:false});
// Reject a concurrent writer rather than replacing its newer manifest.
if(digest(await readFile(currentFile))!==digest(priorBytes))throw Error('Manifest changed during merge');await writeFile(currentFile,nextBytes);console.log(JSON.stringify({version,added:added.length,total:next.assets.length,report:join(directory,'report.json'),published:false}));
