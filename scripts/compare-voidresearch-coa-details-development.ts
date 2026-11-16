import {dirname,join,resolve,extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {jsonFile,writeJson,readRef,saveArtifact,digest,canonical} from '../src/shopyy/artifacts.js';
import {renderFamilies} from '../src/shopyy/families.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import {chromium} from 'playwright';

const file=resolve(process.argv[2]),root=dirname(file),project=await jsonFile(file);
const handoff=process.argv.find(v=>v.startsWith('--inputs='))?.slice(9)||'staging/handoff-inputs/r3-coa-detail-inputs-5c4264d41412';
const input=await jsonFile(join(root,handoff,'manifest.json'));
const historical=handoff.includes('historical');
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(',');
const rowsToTest=input.rows.filter((r:any)=>!only||only.includes(r.sourcePath));
const directory=historical?'staging/coa-historical-development':'staging/coa-detail-development';
const originalFamilies=await jsonFile(join(root,project.familiesFile)),proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
const families={schemaVersion:2,partials:originalFamilies.partials,families:{'coa-certificate-detail':{templateFile:'common/composers/secondary.htm'}},pages:input.rows.map((r:any,index:number)=>({sourcePath:r.sourcePath,targetPath:r.targetPath,family:r.family,nativeFile:`pages/coa-detail-${index}.htm`,data:r.data}))};
await writeJson(join(root,directory,'families.json'),families);
const inventory:any={schemaVersion:2,sourceUrl:project.sourceUrl,complete:false,role:'unapproved-certificate-detail-development-only',routes:{}};
for(const row of proposal.rows)inventory.routes[row.sourcePath]={disposition:'boundary',targetPath:row.targetPath,family:row.family,rationale:'Outside isolated detail-page diagnostic; navigation not accepted'};
for(const row of input.rows)inventory.routes[row.sourcePath]={disposition:'mapped',targetPath:row.targetPath,family:row.family,rationale:'Explicit captured detail-page fixture'};
for(const dependency of input.dependencies)if(!inventory.routes[dependency.sourcePath])inventory.routes[dependency.sourcePath]={disposition:'external',targetPath:dependency.url,family:'external-resource',rationale:'Preserve observed destination for isolated diagnostic; ownership/download validation pending'};
const invRef=await saveArtifact(root,inventory),plan=await jsonFile(join(root,project.capturePlanFile));
const candidateProject={...project,familiesFile:directory+'/families.json'};
const rendered=await renderFamilies(root,candidateProject,{...plan,inventory:invRef});
const css=await readFile(join(root,project.commonStyleFile)),runtime=await readFile(join(root,project.commonScriptFile));
const renderSha256=digest(canonical({pages:[...rendered.preview].map(([path,html])=>({path,sha256:digest(html)})),style:digest(css),runtime:digest(runtime)}));
const server=createServer(async(req,res)=>{try{
 if(req.method!=='GET'){res.writeHead(405).end();return;}
 const url=new URL(req.url!,'http://diagnostic'),route=rendered.routes[url.pathname];
 if(route){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(rendered.preview.get(route.replace(/^preview\//,'')));return;}
 if(url.pathname.endsWith('/styles/storefront-common.css')){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'}).end(css);return;}
 if(url.pathname.endsWith('/styles/page-contracts.css')){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'}).end('/* unaccepted development diagnostic */');return;}
 if(url.pathname.endsWith('/scripts/storefront-runtime.js')){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'}).end(runtime);return;}
 const name=url.pathname.split('/').pop()!;
 if(url.pathname.startsWith(`/assets/${project.siteId}/images/source-current/`)&&/^[a-f0-9]{64}\.(png|jpg|webp|svg|gif|avif)$/.test(name)){
  const mime:any={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif','.avif':'image/avif'};
  res.writeHead(200,{'Content-Type':mime[extname(name)]}).end(await readFile(join(root,project.assetsDirectory,'source-current',name)));return;
 }
 res.writeHead(404).end('Outside isolated diagnostic scope');
}catch{res.writeHead(500).end('Diagnostic resource failed');}});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${(server.address() as any).port}`,targetProject=historical?'diagnostic-coa-historical-target.project.json':'diagnostic-coa-detail-target.project.json',rows:any[]=[];
await writeJson(join(root,targetProject),{sourceUrl:origin,workflow:{sourceSession:{enabled:false},discoveryNetworkIdleMs:100}});
try{
 if(process.argv.includes('--search-smoke')){
  const browser=await chromium.launch({headless:true}),samples:any[]=[];
  try{for(const[device,width,height]of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844]] as const){
   const page=await browser.newPage({viewport:{width,height}}),errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+input.rows[0].targetPath,{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Search products',exact:true}).click();
   await page.getByPlaceholder('Search compounds…').fill('GHK');
   await page.locator('[data-vr-component="searchOverlay"] a').filter({hasText:/GHK/i}).first().waitFor({state:'visible',timeout:5000});
   const resultCount=await page.locator('[data-vr-component="searchOverlay"] a').count();
   await page.getByPlaceholder('Search compounds…').press('Escape');
   if(await page.locator('[data-vr-component="searchOverlay"]').count()||errors.length)throw Error('Certificate-page search smoke failed');
   samples.push({device,resultCount,errors,passed:true});await page.close();
  }}finally{await browser.close();}
  await writeJson(join(root,'verification/recon-current/coa-detail-search-smoke.json'),{kind:'local-only-certificate-header-search-smoke-not-source-fidelity',inputs:handoff,developmentRenderSha256:renderSha256,samples,sourceCompared:false,published:false});
  console.log(JSON.stringify({searchSmoke:samples}));
 }
 for(const page of rowsToTest){
 const id=page.sourcePath.slice(5),sourceId='coa-detail-'+id,config=await jsonFile(join(root,'contracts',sourceId+'.json'));
 const selectors=`contracts/coa-detail-local-${id}.json`,targetId='local-'+sourceId;
 await writeJson(join(root,selectors),{...config,sourcePath:page.targetPath,inspectionId:targetId,captureStructure:false});
 const target=await inspectSourceComponents(join(root,targetProject),selectors);
 for(const viewport of ['desktop','tablet','mobile']){
  const observation=page.threeDeviceObservations.find((r:any)=>r.viewport===viewport),b=target.rows.find((r:any)=>r.viewport===viewport);
  if(!b?.passed){rows.push({sourcePath:page.sourcePath,viewport,error:b?.error||'Missing target sample'});continue;}
  const source=JSON.parse((await readRef(root,observation.observation)).toString()),local=JSON.parse((await readRef(join(root,'verification/recon-current/inspections',targetId),b.evidence)).toString()),differences:any[]=[];
  for(const component of Object.keys(config.components))for(const field of ['visible','x','y','width','height','display','fontSize','lineHeight','fontFamily','overflowX','overflowY','parent','order','paddingTop','paddingBottom','paddingLeft','paddingRight','gap','gridTemplateColumns','flexDirection','text','tag','role','value','checked','disabled']){
   const x=source.components[component][field],y=local.components[component][field];
   if(['x','y','width','height'].includes(field)?Math.abs(x-y)>2:canonical(x)!==canonical(y))differences.push({component,field,source:x,target:y});
  }
  rows.push({sourcePath:page.sourcePath,viewport,sourceId,targetId,source:observation.observation,target:b.evidence,sourceScreenshot:source.screenshot,targetScreenshot:local.screenshot,sourceFullPage:source.fullPage,targetFullPage:local.fullPage,differences});
 }
 const reportFile=join(root,'verification/recon-current/'+(historical?'coa-historical-development-comparison.json':'coa-detail-development-comparison.json')),prior=await jsonFile(reportFile).catch(()=>null);
 const combined=[...(prior?.rows||[]).filter((r:any)=>r.sourcePath!==page.sourcePath),...rows.filter(r=>r.sourcePath===page.sourcePath)];
 await writeJson(reportFile,{kind:'isolated-certificate-initial-page-development-comparison-not-navigation-or-build-acceptance',inputs:handoff,inputManifestSha256:digest(await readFile(join(root,handoff,'manifest.json'))),developmentRenderSha256:renderSha256,rows:combined,blocked:input.blocked,visualReview:'pending',navigationAccepted:false,sourceGatePassed:false,buildCreated:false,draftChanged:false,published:false});
 console.log(JSON.stringify({sourcePath:page.sourcePath,samples:rows.filter(r=>r.sourcePath===page.sourcePath).length,errors:rows.filter(r=>r.sourcePath===page.sourcePath&&r.error).length,differences:rows.filter(r=>r.sourcePath===page.sourcePath).flatMap(r=>r.differences||[]).length}));
}}finally{await new Promise<void>(r=>server.close(()=>r()));}
if(rows.some(r=>r.error||r.differences?.length))process.exitCode=1;
