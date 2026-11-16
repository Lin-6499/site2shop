import {dirname,join,resolve} from 'node:path';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {load} from 'cheerio';
import sharp from 'sharp';
import {jsonFile,readRef,writeJson,digest,canonical} from '../src/shopyy/artifacts.js';
import {prepareComposerInputs} from '../src/shopyy/composer-inputs.js';

// Prepare an isolated candidate: active asset manifest, families and routes remain untouched.
const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file);
const historical=process.argv.includes('--historical'),runFile='verification/recon-current/'+(historical?'coa-historical-detail-reconnaissance-run.json':'coa-detail-reconnaissance-run.json');
const run=await jsonFile(join(root,runFile));
const assets=await jsonFile(join(root,historical?'verification/coa-historical-public-assets.json':'verification/coa-detail-public-assets.json'));
const catalogFile='common/content/search-fixture.json',catalogBytes=await readFile(join(root,catalogFile)),catalog=JSON.parse(catalogBytes.toString());
if(assets.sourceSnapshot!==run.sourceSnapshot)throw Error('Same-snapshot assets required');
const originalAssetDirectory=join(root,project.assetsDirectory,'source-current');
const manifest=await jsonFile(join(originalAssetDirectory,'manifest.json'));
const verified:any[]=[];
for(const asset of assets.rows){
 const bytes=await readFile(join(originalAssetDirectory,asset.file)),metadata=await sharp(bytes).metadata();
 if(digest(bytes)!==asset.sha256||metadata.width!==asset.width||metadata.height!==asset.height)throw Error('Copied report image integrity mismatch');
 for(const ref of asset.evidence){
  const d=JSON.parse((await readRef(root,ref)).toString()),dom=load(d.structure);
  if(!dom('main img').toArray().some(n=>new URL(dom(n).attr('src')||'',project.sourceUrl).href===asset.url))throw Error('Image missing from exact report source evidence');
 }
 const prior=manifest.assets.find((a:any)=>a.url===asset.url&&a.kind==='image');
 if(prior&&prior.sha256!==asset.sha256)throw Error('Source asset URL changed since shared manifest');
 verified.push({...asset,evidence:[...new Map([...(prior?.evidence||[]),...asset.evidence].map((r:any)=>[r.sha256,r])).values()]});
}
const merged={...manifest,assets:[...manifest.assets.filter((a:any)=>!verified.some(v=>v.url===a.url&&v.kind===a.kind)),...verified]};
const candidateDirectory='staging/'+(historical?'coa-historical-candidate-assets':'coa-detail-candidate-assets')+'/source-current';
await mkdir(join(root,candidateDirectory),{recursive:true});
await writeJson(join(root,candidateDirectory,'manifest.json'),merged);
const projectCandidate=historical?'diagnostic-coa-historical-inputs.project.json':'diagnostic-coa-detail-inputs.project.json';
await writeJson(join(root,projectCandidate),{...project,assetsDirectory:dirname(candidateDirectory).replace(/\\/g,'/')});
const rows:any[]=[],blocked:any[]=[],dependencies=new Map<string,any>();
for(const page of run.rows){
 if(!page.passed||page.rows.length!==3||page.rows.some((r:any)=>!r.passed))throw Error('Three-device report page capture required');
 const observations=[];
 for(const row of page.rows){
  const d=JSON.parse((await readRef(root,row.structure)).toString()),dom=load(d.structure);
  if(dom('main').length!==1||dom('main h1').length!==1||!d.sourceSessionCurrent)throw Error('Report source page is not ready');
  const links=dom('main a').toArray().map(n=>({text:dom(n).text().trim(),href:dom(n).attr('href')||''}));
  const controls=dom('main button,main input,main select,main textarea').toArray().map(n=>({tag:n.tagName,text:dom(n).text().trim(),type:dom(n).attr('type'),ariaLabel:dom(n).attr('aria-label')}));
  observations.push({viewport:row.viewport,title:dom('main h1').text(),links,controls,source:row.structure,observation:d.componentObservation});
  for(const link of links){
   if(!link.href)continue;
   const url=new URL(link.href,project.sourceUrl),sourcePath=url.pathname+url.search;
   const existing=dependencies.get(url.href)||{url:url.href,sourcePath,kind:url.pathname.endsWith('.pdf')?'report-document':url.pathname.startsWith('/coa/')?'certificate-detail':'navigation',occurrences:[]};
   existing.occurrences.push({page:page.sourcePath,viewport:row.viewport,text:link.text,source:row.structure});dependencies.set(url.href,existing);
  }
 }
 if(observations.some(o=>o.title!==observations[0].title||canonical(o.links)!==canonical(observations[0].links)))throw Error('Report content/link destinations differ across viewports');
 const source=page.rows.find((r:any)=>r.viewport==='desktop').structure;
 const id='coa-'+page.sourcePath.slice(5),directory=`staging/coa/${historical?'historical-details':'details'}/${id}`,recipe=`contracts/page-recipes/${historical?'historical-':''}${id}.json`;
 await writeJson(join(root,recipe),{schemaVersion:2,sourcePath:page.sourcePath,componentSelectorsFile:'contracts/secondary-components.draft.json',outputDirectory:directory,fragments:[{id:'body',selector:'div.min-h-screen',rootAttributes:{'data-vr-storefront':'','data-vr-page':'coa-certificate-detail'},observation:source}]});
 try{await prepareComposerInputs(join(root,projectCandidate),recipe);}catch(error){blocked.push({sourcePath:page.sourcePath,reason:error instanceof Error?error.message:String(error),sourceEvidence:source,sourceAssetFailures:assets.failures});continue;}
 const html=await readFile(join(root,directory,'body.htm'),'utf8');
 rows.push({sourcePath:page.sourcePath,targetPath:'/pages/'+id,family:'coa-certificate-detail',bodyFile:directory+'/body.htm',bodySha256:digest(html),provenanceFile:directory+'/provenance.json',sourceEvidence:source,threeDeviceObservations:observations,data:{title:observations[0].title,sourcePath:page.sourcePath,targetCanonical:'/pages/'+id,family:'coa-certificate-detail',bodyFile:directory+'/body.htm',catalog,ui:{},publicUi:{},scope:'initial-certificate-page-input; report download, navigation and dynamic controls pending paired acceptance'}});
}
const identity=digest(canonical({sourceSnapshot:run.sourceSnapshot,rows:rows.map(r=>({sourcePath:r.sourcePath,bodySha256:r.bodySha256})),catalogSha256:digest(catalogBytes),blocked,assets:verified.map(a=>({url:a.url,sha256:a.sha256}))}));
const version=(historical?'r1-coa-historical-inputs-':'r3-coa-detail-inputs-')+identity.slice(0,12),handoff=join(root,'staging/handoff-inputs',version);
await mkdir(handoff,{recursive:false});
await writeFile(join(handoff,'catalog.json'),catalogBytes);
for(const row of rows){await mkdir(join(handoff,'pages',row.data.targetCanonical.slice(7)),{recursive:true});await cp(join(root,row.bodyFile),join(handoff,'pages',row.data.targetCanonical.slice(7),'body.htm'));row.frozenBodyFile=`staging/handoff-inputs/${version}/pages/${row.data.targetCanonical.slice(7)}/body.htm`;row.data.bodyFile=row.frozenBodyFile;}
await writeJson(join(handoff,'manifest.json'),{schemaVersion:1,version,status:'prepared-provisional-inputs-not-build-acceptance',sourceSnapshot:run.sourceSnapshot,sourceSnapshotMeaning:run.sourceSnapshotMeaning||'fixed original capture provenance',sourceRun:{path:runFile,sha256:digest(await readFile(join(root,runFile)))},catalog:{sourceFile:catalogFile,file:'catalog.json',sha256:digest(catalogBytes)},rows,blocked,dependencies:[...dependencies.values()],assets:{candidateManifest:candidateDirectory+'/manifest.json',candidateManifestSha256:digest(await readFile(join(root,candidateDirectory,'manifest.json'))),verified:verified.map(a=>({url:a.url,file:a.file,sha256:a.sha256,width:a.width,height:a.height,evidence:a.evidence})),failures:assets.failures},activeFamiliesModified:false,activeRoutesModified:false,activeAssetManifestModified:false,objectiveComparison:'pending',visualReview:'pending',onlineDestinationVerified:false,publicationAllowed:false});
console.log(JSON.stringify({version,pages:rows.length,blocked,verifiedImages:verified.length,dependencies:dependencies.size,sharedFilesModified:false,accepted:false,published:false}));
