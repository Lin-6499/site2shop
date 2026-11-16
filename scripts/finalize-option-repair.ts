import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertOptionMediaAcceptance, compareOptionObservation } from '../src/option-media-gate.js';
import { mediaIdentity } from '../src/option-media-theme.js';
import { hash } from '../src/util.js';

// Diagnostic-only attestation. It deliberately cannot satisfy the full online release gate.
const out=resolve(process.argv[2]||'../westandwillow-phase3');
const read=async(path:string)=>JSON.parse(await readFile(join(out,path),'utf8'));
const local=await assertOptionMediaAcceptance(out,'preflight');
const contract=await read('option-media-contracts.json'),manifest=await read('option-media-build.json');
const deltaBytes=await readFile(join(out,'option-media-draft-deployment.json')),delta=JSON.parse(deltaBytes.toString());
const report=await read('option-media-online/report.json');
const bindings=await read('phase3-product-template-binding.json');
if(JSON.stringify([...report.consumers].sort())!==JSON.stringify(bindings.products.filter((p:any)=>p.templateSuffix==='s2s-embroidered').map((p:any)=>p.handle).sort()))throw Error('Scoped consumer inventory differs');
if(!report.completed||report.stage!=='scoped-online'||report.buildId!==local.buildId||report.authorizedDeltaSha256!==hash(deltaBytes)||delta.localBuildId!==local.buildId||!delta.remoteReadbackVerified||delta.published!==false)throw Error('Invalid scoped deployment/report identity');
if(report.themeId!==delta.themeId||report.store!==delta.store||report.sourceSha256!==hash(await readFile(join(out,'option-media-contracts.json'))))throw Error('Wrong source/store/theme');
for(const file of manifest.files)if(!delta.files.some((f:any)=>f.name===file.name&&f.sha256===file.sha256)||hash(await readFile(join(out,'theme',file.name)))!==file.sha256)throw Error('Scoped code changed');
let count=0;
for(const handle of report.consumers){
 const product=contract.products[handle];
 for(const width of [1440,768,390]){
  const ref=report.catalogs[`${handle}-${width}`];
  const bytes=await readFile(join(out,ref.path));if(hash(bytes)!==ref.sha256)throw Error('Catalog digest mismatch');
  const catalog=JSON.parse(bytes.toString());
  if(new URL(catalog.url).hostname!==delta.store)throw Error('Wrong catalog host');
  for(const alias of catalog.imageAliases||[])if(hash(await readFile(join(out,alias.aliasProof)))!==alias.aliasSha256||hash(await readFile(join(out,alias.canonicalProof)))!==alias.canonicalSha256||alias.aliasSha256!==alias.canonicalSha256)throw Error('Invalid media alias bytes');
  const samples=product.observations.filter((s:any)=>s.viewport.width===width);
  for(let step=0;step<samples.length;step++){
   const entries=report.cases.filter((c:any)=>c.handle===handle&&c.width===width&&c.step===step);if(entries.length!==1)throw Error('Missing/duplicate case');
   const bytes=await readFile(join(out,entries[0].artifact));if(hash(bytes)!==entries[0].sha256)throw Error('Observation digest mismatch');
   const data=JSON.parse(bytes.toString()),url=new URL(data.target.url);
   if(JSON.stringify(data.source)!==JSON.stringify(samples[step])||data.target.viewport.width!==width||String(data.target.themeId)!==String(delta.themeId)||url.hostname!==delta.store||url.pathname!==`/products/${handle}`)throw Error('Wrong observed state or route');
   if(!data.target.canonical||new URL(data.target.canonical).pathname!==`/products/${handle}`||data.target.viewport.height!==samples[step].viewport.height)throw Error('Wrong canonical or viewport height');
   const failures=compareOptionObservation(data.source,data.target,catalog.variants,catalog.images,catalog.imageAliases);
   if(failures.length)throw Error(`${handle}/${width}/${step}: ${failures.join('; ')}`);
   if(step>0&&url.searchParams.get('variant')!==data.target.variantId)throw Error('Variant URL differs');
   for(let group=0;group<product.groups.length;group++)for(const value of product.groups[group].values){
    const controls=data.target.controls.filter((c:any)=>Number(c.group)===group&&c.value===value.value);
    if(controls.length!==1||value.asset&&mediaIdentity(controls[0].asset||'')!==manifest.assetNames[value.asset])throw Error('Wrong semantic swatch');
   }
   count++;
  }
 }
}
if(count!==local.count||count!==report.cases.length)throw Error('Incomplete scoped denominator');
const result={schemaVersion:1,kind:'scoped-option-repair-objective-attestation',buildId:local.buildId,store:delta.store,themeId:delta.themeId,consumers:report.consumers,viewports:[1440,768,390],cases:count,scopedObjectivePassed:true,notFullSiteAcceptance:true,published:false,authorizedDeltaSha256:hash(deltaBytes),onlineReportSha256:hash(await readFile(join(out,'option-media-online/report.json'))),checkedAt:new Date().toISOString(),unaccepted:['Full-site and full-page visual/workflow acceptance','Size Chart, conditional paid add-ons and cart submission','Existing unrelated gate failures; full draft build marker remains unchanged by scoped file upload']};
const visualPairs=[];
for(const handle of report.consumers)for(const [width,name] of [[1440,'desktop'],[768,'tablet'],[390,'mobile']] as const){
 const source=`option-media-evidence/${handle}/${name}-0.png`,target=`option-media-acceptance/${handle}-${width}-0.png`;
 visualPairs.push({handle,width,source,sourceSha256:hash(await readFile(join(out,source))),target,targetSha256:hash(await readFile(join(out,target)))});
}
(result as any).independentInitialVisualReview={reviewer:'/root/option_gate_review',skill:'shopify-site-replication',scope:'15 initial preflight pairs; source option assets/order, color-row indentation and unclipped style-card shadows',pairs:visualPairs,confirmedDefectsClosed:['color-row indentation','style-card shadow clipping'],notAFullOnlineVisualPass:true};
await writeFile(join(out,'option-media-repair-result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
