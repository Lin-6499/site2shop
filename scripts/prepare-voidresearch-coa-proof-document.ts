import {dirname,join,resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {jsonFile,writeJson,digest} from '../src/shopyy/artifacts.js';
import {publicAssetClient} from '../src/shopyy/public-http.js';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file),auditFile='verification/recon-current/coa-fingerprint-code-audit.json',auditBytes=await readFile(join(root,auditFile)),audit=JSON.parse(auditBytes.toString());
const module=audit.responses.find((r:any)=>r.excerpts?.some((e:any)=>e.needle==='Fingerprint of this file'));
if(!module||audit.observation.publicSha256.length!==1||!audit.observation.pdfLinks.length)throw Error('Observed fingerprint module and public document required');
const transport=await publicAssetClient(project),client=transport.client;
try{
 const moduleResponse=await client.get(module.url,{timeout:30000,maxRedirects:0});if(!moduleResponse.ok())throw Error('Observed source module unavailable');
 const moduleBytes=await moduleResponse.body();if(digest(moduleBytes)!==module.sha256)throw Error('Source module changed since rendered audit');
 const text=moduleBytes.toString(),fingerprints=[...text.matchAll(/["`]([^"`]+\.pdf)["`]:\{sha256:`([a-f0-9]{64})`,bytes:(\d+),recorded:`([^`]+)`\}/g)].map(m=>({path:m[1],sha256:m[2],bytes:Number(m[3]),recorded:m[4]}));
 const documentUrl=audit.observation.pdfLinks[0],url=new URL(documentUrl),expected=fingerprints.find(f=>f.path===url.pathname);
 if(!expected||expected.sha256!==audit.observation.publicSha256[0])throw Error('Module file identity does not match the rendered public hash');
 const response=await client.get(documentUrl,{timeout:30000,maxRedirects:0});if(!response.ok())throw Error('Public PDF HTTP '+response.status());
 const bytes=await response.body();if(bytes.length!==expected.bytes||digest(bytes)!==expected.sha256||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Public document differs from the published rendered hash/length or is not a PDF');
 const directory='verification/coa-proof-documents';await mkdir(join(root,directory),{recursive:true});const pdfFile=directory+'/'+expected.sha256+'.pdf';await writeFile(join(root,pdfFile),bytes);
 await writeJson(join(root,directory,'metadata.json'),{kind:'public-document-identity-verified-not-laboratory-vial-or-ownership-acceptance',sourcePath:audit.sourcePath,audit:{file:auditFile,sha256:digest(auditBytes)},module:{url:module.url,sha256:module.sha256},pdf:{url:documentUrl,file:pdfFile,...expected},effect:'GET only; no source form/file upload/clipboard mutation',publicTableEntries:fingerprints.length,sourceUiStateComparison:'pending',published:false});
 console.log(JSON.stringify({sourcePath:audit.sourcePath,pdf:{url:documentUrl,file:pdfFile,...expected},publicTableEntries:fingerprints.length,verified:true}));
}finally{await client.dispose();}
