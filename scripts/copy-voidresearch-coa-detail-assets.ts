import {dirname,join,resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {jsonFile,writeJson,digest,saveArtifact,safeBrowserError} from '../src/shopyy/artifacts.js';
import {publicAssetClient} from '../src/shopyy/public-http.js';

// Copy only public image URLs actually rendered in the fixed certificate pages.
// Produce a merge candidate; the shared manifest is owned by the integration lane.
const historical=process.argv.includes('--historical'),runFile='verification/recon-current/'+(historical?'coa-historical-detail-reconnaissance-run.json':'coa-detail-reconnaissance-run.json'),output=historical?'verification/coa-historical-public-assets.json':'verification/coa-detail-public-assets.json';
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),run=await jsonFile(join(root,runFile));
const directory=join(root,project.assetsDirectory,'source-current'),manifest=await jsonFile(join(directory,'manifest.json'));
const priorCandidate=await jsonFile(join(root,output)).catch(()=>null);
if(priorCandidate&&priorCandidate.sourceSnapshot!==run.sourceSnapshot)throw Error('Asset candidate source snapshot changed');
const observed=new Map<string,any[]>();
for(const page of run.rows.filter((p:any)=>p.passed))for(const meta of page.metadata){
 const row=page.rows.find((r:any)=>r.viewport===meta.viewport);
 for(const img of meta.publicImages){const url=new URL(img.src,project.sourceUrl);if(url.origin!==new URL(project.sourceUrl).origin)throw Error('External report preview requires explicit review');const refs=observed.get(url.href)||[];refs.push(row.structure);observed.set(url.href,refs);}
}
const {client}=await publicAssetClient(project),rows:any[]=[],failures:any[]=[];
try{for(const[url,evidence]of observed){try{
 const prior=manifest.assets.find((a:any)=>a.url===url&&a.kind==='image')||priorCandidate?.rows?.find((a:any)=>a.url===url&&a.kind==='image'),priorBytes=prior?await readFile(join(directory,prior.file)).catch(()=>null):null;
 if(prior&&priorBytes&&digest(priorBytes)===prior.sha256){rows.push({...prior,evidence:[...new Map([...prior.evidence,...evidence].map((r:any)=>[r.sha256,r])).values()],reused:true});continue;}
 const response=await client.get(url,{timeout:30000,maxRedirects:0});if(!response.ok())throw Error('HTTP '+response.status());
 const contentType=response.headers()['content-type']?.split(';')[0].trim(),extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[contentType];
 if(!extension)throw Error('Unexpected report preview MIME');
 const bytes=await response.body();if(bytes.length>10*1024*1024)throw Error('Report preview exceeds image budget');
 const metadata=await sharp(bytes).metadata();if(!metadata.width||!metadata.height)throw Error('Report preview has no decoded dimensions');
 const sha256=digest(bytes),name=sha256+'.'+extension;await writeFile(join(directory,name),bytes);
 rows.push({url,kind:'image',contentType,bytes:bytes.length,sha256,file:name,evidence:[...new Map(evidence.map((r:any)=>[r.sha256,r])).values()],width:metadata.width,height:metadata.height});
 }catch(error){failures.push({url,error:safeBrowserError(error)});}
 console.log(JSON.stringify({completed:rows.length+failures.length,total:observed.size,failed:failures.length}));
}}finally{await client.dispose();}
const prior=await jsonFile(join(root,output)).catch(()=>null),priorAttempt=prior?await saveArtifact(root,prior):null;
await writeJson(join(root,output),{kind:'observed-public-certificate-preview-images-merge-candidate',sourceUrl:project.sourceUrl,sourceSnapshot:run.sourceSnapshot,sourceSnapshotMeaning:run.sourceSnapshotMeaning||'fixed original capture provenance',sourceRun:{file:runFile,sha256:digest(await readFile(join(root,runFile)))},rows,failures,priorAttempt,sharedManifestModified:false,accepted:false,published:false});
if(failures.length)process.exitCode=1;
