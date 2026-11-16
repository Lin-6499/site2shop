import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {jsonFile,writeJson,digest} from '../src/shopyy/artifacts.js';
const root=dirname(resolve(process.argv[2])),runFile='verification/recon-current/home-header-announcement-current.json',runBytes=await readFile(join(root,runFile)),run=JSON.parse(runBytes.toString());
const order=['header','hero','trust-strip','researcher-picks','batch-testing','dispatch','lot-lookup','quality','assurance-newsletter','footer'];
const files=[...order.map(id=>`staging/composers/${id}.htm`),'common/composers/home.htm','common/styles/source-observed.css','common/scripts/home-runtime.js','contracts/current-home-composer.recipe.json','contracts/home-components.draft.json'];
const rows=[];for(const file of files){const bytes=await readFile(join(root,file));rows.push({file,sha256:digest(bytes),bytes:bytes.length});}
const id=`home-source-r1-${digest(runBytes).slice(0,12)}`,directory=join(root,'staging/source-snapshots',id);
if(await access(directory).then(()=>true,()=>false))throw Error('Frozen snapshot already exists');
await mkdir(join(directory,'inputs'),{recursive:true});
for(const row of rows)await writeFile(join(directory,'inputs',row.file.replaceAll('/','__')),await readFile(join(root,row.file)));
await writeJson(join(directory,'manifest.json'),{schemaVersion:1,id,kind:'frozen-three-device-source-composition-not-acceptance',sourceRun:{file:runFile,sha256:digest(runBytes)},sourceRows:run.rows,order,spacer:{sourceHeights:{desktop:97,tablet:97,mobile:95},strategy:'ResizeObserver using actual header border box'},files:rows,missingInteractions:['new announcement dismiss/reopen','lot lookup request and results','new certificate detail destinations','new batch certificate carousel/overflow'],provisional:true,formalBuildAccepted:false,publicationAllowed:false});
const html=await readFile(join(root,'staging/composers/batch-testing.htm'),'utf8');
await writeJson(join(directory,'certificate-route-needs.json'),{sourceSnapshot:id,sourcePaths:[...new Set([...html.matchAll(/\{\{route:(\/coa\/[^{}]+)\}\}/g)].map(m=>m[1]))],status:'needs-COA-detail-route-disposition-and-target-binding',published:false});
console.log(JSON.stringify({id,directory,files:rows.length,order,published:false}));
