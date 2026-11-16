import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {compileCustomBlock} from '../src/shopyy/custom-blocks.js';
import {animationContext} from '../src/shopyy/browser.js';
import {jsonFile,writeJson,digest,canonical,saveArtifact} from '../src/shopyy/artifacts.js';

const projectFile=resolve(process.argv[2]),root=dirname(projectFile),inputDirectory='staging/handoff-inputs/r1-coa-directory-inputs-fc249edf2a94';
const input=await jsonFile(join(root,inputDirectory,'manifest.json'));
const css=await readFile(join(root,inputDirectory,input.sharedStyle.file),'utf8'),body=await readFile(join(root,inputDirectory,input.body.file),'utf8'),runtime=await readFile(join(root,inputDirectory,input.runtime.file),'utf8'),model=JSON.parse(await readFile(join(root,inputDirectory,input.publicUi.file),'utf8'));
if(digest(css)!==input.sharedStyle.sha256||digest(body)!==input.body.sha256||digest(runtime)!==input.runtime.sha256)throw Error('Fixed directory input changed');
const templates=[];
for(const template of input.templates){const bytes=await readFile(join(root,inputDirectory,template.file),'utf8');if(digest(bytes)!==template.sha256)throw Error('Fixed template changed');templates.push(bytes);}
const html=[body,...templates].join('\n'),proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
const routeMap=Object.fromEntries(proposal.rows.filter((r:any)=>r.targetPath).map((r:any)=>[r.sourcePath,r.targetPath]));
const hosted=await jsonFile(join(root,'verification/asset-hosting-504457/verified-asset-map.json')),assets=await jsonFile(join(root,'common/assets/images/source-current/manifest.json'));
const assetMap:Record<string,string>={},copiedImages=new Map<string,any>();
for(const token of new Set([...html.matchAll(/\{\{asset:([^{}]+)\}\}/g)].map(m=>m[1]))){
 const asset=assets.assets.find((a:any)=>token==='images/source-current/'+a.file);if(!asset)throw Error('Missing copied component image');
 const bytes=await readFile(join(root,'common/assets/images/source-current',asset.file));if(digest(bytes)!==asset.sha256)throw Error('Component image hash changed');
 assetMap[token]=hosted[token]||'https://site2shop-assets.invalid/'+asset.file;
 copiedImages.set(assetMap[token],{bytes,type:asset.contentType});
}
const compilerPath=resolve('src/shopyy/custom-blocks.ts'),compiler=await readFile(compilerPath,'utf8');
const compiled=compileCustomBlock({id:'coa-directory',html,css,routeMap,assetMap});
const revision='r2-local-coa-directory-'+compiled.sha256.slice(0,12),directory=join(root,'staging/local-inner-candidates',revision);
await mkdir(dirname(directory),{recursive:true});
await mkdir(directory,{recursive:false});
await writeFile(join(directory,'component.static.html'),compiled.html);await writeFile(join(directory,'compiler.snapshot.ts'),compiler);
await writeFile(join(directory,'runtime.snapshot.js'),runtime);await writeJson(join(directory,'public-ui.json'),model);
const serialized=JSON.stringify(model).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
if(runtime.toLowerCase().includes('</script'))throw Error('Owned runtime contains an unsafe inline terminator');
const scripts=`<script type="application/json" data-vr-public-page-model>${serialized}</script><script>${runtime}</script>`;
const baselineHtml=html.replace(/\{\{(asset|route):([^{}]+)\}\}/g,(_,kind,key)=>(kind==='asset'?assetMap:routeMap)[key]);
const baseline=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body data-vr-mode="fixture"><div class="bg-[#f4f5f7] text-neutral-900 font-sans antialiased">${baselineHtml}</div>${scripts}</body></html>`;
const target=`<!doctype html><html><head><meta charset="utf-8"><style>html{font-size:14px}body{margin:0;font:14px Georgia;text-align:center}h3{font-size:30px;margin:10px}svg{display:inline}.block_html{padding:0 15px;width:calc(100% - 30px);max-width:1200px;margin:auto}[id^=block-section-]{margin-bottom:52px}</style></head><body data-vr-mode="fixture"><div id="block-section-fixture"><div class="block_html full_container_wrapper">${compiled.html}</div></div>${scripts}</body></html>`;
const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(req.url==='/source'?baseline:target));
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${(server.address() as any).port}`,browser=await chromium.launch({headless:true}),rows:any[]=[];
const amount=(value:string)=>async(page:any)=>page.locator('#coa-reports > div.grid > div:first-child > div:nth-child(2) > button').filter({hasText:new RegExp('^'+value+'$')}).click();
const history=async(page:any)=>page.locator('#coa-reports > div.grid > div:first-child button').filter({hasText:'Previous Batches'}).click();
const states=[{id:'initial',actions:[]},{id:'search-ghk',actions:[async(p:any)=>p.getByPlaceholder('Search COA...').fill('GHK')]},{id:'search-none',actions:[async(p:any)=>p.getByPlaceholder('Search COA...').fill('zz-no-coa')]},{id:'search-reset',actions:[async(p:any)=>p.getByPlaceholder('Search COA...').fill('GHK'),async(p:any)=>p.getByPlaceholder('Search COA...').fill('')]},{id:'amount-20mg',actions:[amount('20 mg')]},{id:'amount-30mg',actions:[amount('30 mg')]},{id:'amount-reset',actions:[amount('20 mg'),amount('10mg')]},{id:'previous-open',actions:[history]},{id:'previous-closed',actions:[history,history]}];
try{for(const[viewport,size]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const context=await browser.newContext({viewport:size});await context.route('**/*',r=>{const image=copiedImages.get(r.request().url());return new URL(r.request().url()).origin===origin?r.continue():image?r.fulfill({status:200,contentType:image.type,body:image.bytes}):r.abort();});
 try{for(const state of states){const samples=[];
  for(const side of ['source','target']){
   const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+(side==='source'?'/source':'/component'));await page.evaluate(()=>document.fonts.ready);
   await page.locator('img').evaluateAll(images=>images.forEach(i=>i.loading='eager'));
   await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
   for(const action of state.actions)await action(page);
   await page.mouse.move(0,0);
   await animationContext(page,'frame-zero',true);
   await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>undefined)));});
   const selector=side==='source'?'body > div':compiled.scope;
   const sample=await page.locator(selector).evaluate(root=>{const box=root.getBoundingClientRect();return[root,...root.querySelectorAll('*')].filter(n=>!n.matches('style,script')).map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{tag:n.tagName,text:n.children.length?null:n.textContent,x:r.x-box.x,y:r.y-box.y,width:r.width,height:r.height,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,display:s.display,padding:s.padding,margin:s.margin,gap:s.gap,grid:s.gridTemplateColumns,overflow:s.overflow,boxShadow:s.boxShadow};});});
   samples.push({side,sample,errors,screenshot:await saveArtifact(directory,await page.screenshot({fullPage:false}),'png'),fullPage:await saveArtifact(directory,await page.screenshot({fullPage:true}),'png')});await page.close();
  }
  const differences:any[]=[];
  if(samples[0].sample.length!==samples[1].sample.length)differences.push({field:'element-count',source:samples[0].sample.length,target:samples[1].sample.length});
  for(const[index,a]of samples[0].sample.entries()){const b=samples[1].sample[index];for(const key of Object.keys(a))if(['x','y','width','height'].includes(key)?Math.abs(a[key]-b?.[key])>.5:a[key]!==b?.[key])differences.push({index,field:key,source:a[key],target:b?.[key]});}
  rows.push({state:state.id,viewport,differences,errors:samples.flatMap(s=>s.errors),samples:samples.map(({side,screenshot,fullPage})=>({side,screenshot,fullPage}))});
  console.log(JSON.stringify({state:state.id,viewport,differences:differences.length,errors:rows.at(-1).errors.length}));
 }}finally{await context.close();}
}}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
if(compiler!==await readFile(compilerPath,'utf8'))throw Error('Shared compiler changed during the diagnostic; do not use these rows as a current package review');
await writeJson(join(directory,'manifest.json'),{kind:'local-only-coa-directory-static-transport-with-isolated-owned-runtime-diagnostic',version:revision,targetReady:false,inputDirectory,inputManifestSha256:digest(await readFile(join(root,inputDirectory,'manifest.json'))),component:{file:'component.static.html',sha256:compiled.sha256,characters:compiled.characters,scope:compiled.scope},compilerSha256:digest(compiler),captureContext:{pointer:[0,0],finiteTransitions:'normal completion awaited after each action',infiniteAnimations:'frame-zero'},rows,objectivePassed:rows.every(r=>!r.differences.length&&!r.errors.length),visualReview:'pending',singleRuntimeIntegration:'pending-A; runtime here runs in an isolated local document only',sourceFidelity:'prior fixed-baseline subset only; no current live source captured by this script',unboundCapabilities:input.unboundCapabilities,wholeSiteAcceptance:false,publicationAllowed:false});
if(rows.some(r=>r.differences.length||r.errors.length))process.exitCode=1;
console.log(JSON.stringify({version:revision,characters:compiled.characters,rows:rows.length,targetReady:false,passed:rows.every(r=>!r.differences.length&&!r.errors.length)}));
