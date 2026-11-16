import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {jsonFile,writeJson,digest,saveArtifact,readRef,canonical} from '../src/shopyy/artifacts.js';
import {animationContext} from '../src/shopyy/browser.js';

const root=dirname(resolve(process.argv[2])),inputVersion=process.argv.find(arg=>arg.startsWith('--source='))?.slice(9)||'r2-navigation-shell-c63ab218116d';
if(!/^r\d+-navigation-shell-[a-f0-9]{12}$/.test(inputVersion))throw Error('Invalid frozen source package');
const inputDir=join(root,'staging/handoff-packages',inputVersion),manifestBytes=await readFile(join(inputDir,'manifest.json')),input=JSON.parse(manifestBytes.toString());
if(input.sourceSnapshot!=='home-source-r1-8863e9b51c8e'||input.target.origin!=='https://pepsss.zenshop.cn'||input.target.skinId!=='504457'||input.target.role!=='draft'||input.publicationAllowed!==false)throw Error('Frozen navigation identity mismatch');
if(canonical(input.installationOrder)!==canonical(['styles-1.html','styles-2.html','navigation.html']))throw Error('Unexpected source package order');
const parts: {file:string,html:string,sha256:string}[]=[];
for(const file of input.installationOrder){const entry=input.parts.find((p:any)=>p.file===file),html=await readFile(join(inputDir,file),'utf8');if(!entry||digest(html)!==entry.sha256)throw Error('Frozen navigation input hash mismatch');parts.push({file,html,sha256:entry.sha256});}
// The old style-only wrappers must be hidden. In one shared wrapper their two
// placeholders would hide the navigation too; remove ONLY those exact markers.
const single=parts.map((part,index)=>index<2?part.html.replace(`<span hidden data-vr-style-package="navigation-${index+1}"></span>`,''):part.html).join('\n');
if(single.includes('<span hidden data-vr-style-package='))throw Error('Unexpected style marker remains');
const revision=process.argv.find(arg=>arg.startsWith('--revision='))?.slice(11)||'r2';if(!/^[a-z0-9-]{1,24}$/.test(revision))throw Error('Invalid package revision');
const sha=digest(single),version=revision+'-navigation-single-'+sha.slice(0,12),directory=join(root,'staging/handoff-packages',version);
if(await access(directory).then(()=>true,()=>false))throw Error('Immutable handoff version already exists');
await mkdir(join(directory,'inputs'),{recursive:true});
await writeFile(join(directory,'component.html'),single);await writeFile(join(directory,'inputs/source-manifest.json'),manifestBytes);
for(const part of parts)await writeFile(join(directory,'inputs',part.file),part.html);
const wrap=(html:string,id:string)=>`<div id="block-section-${id}"><div class="block_html">${html}</div></div>`;
const document=(body:string)=>`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px Georgia}.block_html{padding:0 15px}</style><body>${body}</body>`;
const baseline=document(parts.map((part,i)=>wrap(part.html,String(i))).join('')),candidate=document(wrap(single,'single'));
const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(req.url==='/baseline'?baseline:candidate));
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const verified=await jsonFile(join(root,'verification/asset-hosting-504457/report.json')),images=new Map();
for(const image of verified.rows||[])if(image.passed)images.set(image.targetUrl,{bytes:await readRef(join(root,'verification/asset-hosting-504457'),image.evidence),type:image.contentType});
const browser=await chromium.launch({headless:true}),rows:any[]=[];
try{for(const[viewport,size]of Object.entries({desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}})){
 const samples:any[]=[];
 for(const kind of ['baseline','single']){
  const context=await browser.newContext({viewport:size});
  try{await context.route('**/*',route=>{const known=images.get(route.request().url());return new URL(route.request().url()).origin===origin?route.continue():known?route.fulfill({status:200,contentType:known.type,body:known.bytes}):route.abort();});const page=await context.newPage();await page.goto(origin+'/'+kind);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.querySelector('[data-vr-storefront]')?.getAttribute('data-initialized')==='true');await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
   const states:any[]=[];
   const record=async(state:string)=>{await animationContext(page,'frame-zero',true);await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));states.push({state,geometry:await page.locator('#vr-block-navigation').evaluate(root=>{const box=root.getBoundingClientRect();return{scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,rootVisible:box.width>0&&box.height>0,nodes:[root,...root.querySelectorAll('*')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{tag:n.tagName,text:n.children.length?null:n.textContent,x:r.x,y:r.y,width:r.width,height:r.height,display:s.display,visibility:s.visibility,fontSize:s.fontSize,lineHeight:s.lineHeight}}),menus:document.querySelectorAll('[data-vr-component="mobilePanel"]').length,more:document.querySelectorAll('[data-vr-mobile-more]').length,announcement:document.querySelectorAll('[data-first-screen-marquee]').length,moreButtons:[...document.querySelectorAll('button[aria-label="More Void Research pages"]')].map(n=>({expanded:n.getAttribute('aria-expanded'),transform:n.querySelector('svg')?getComputedStyle(n.querySelector('svg')!).transform:null,inlineTransform:(n.querySelector('svg') as SVGElement)?.style.transform||null}))};}),screenshot:await saveArtifact(directory,await page.screenshot(),'png')});};
   await record('initial');
   if(viewport!=='desktop'){await page.getByRole('button',{name:'Toggle menu',exact:true}).click();await record('menu-open');await page.locator('[data-vr-component="mobilePanel"]').getByRole('button',{name:'More Void Research pages',exact:true}).click();await record('more-open');await page.keyboard.press('Escape');await record('menu-closed');}
   await page.getByRole('button',{name:'Hide these messages',exact:true}).click();await page.waitForFunction(()=>document.querySelector('header')?.getBoundingClientRect().height===65&&document.querySelector('[data-vr-component="headerSpacer"]')?.getBoundingClientRect().height===65);await record('announcement-dismissed');samples.push({kind,states});
  }finally{await context.close();}
 }
 const differences:any[]=[];for(let i=0;i<samples[0].states.length;i++){const a=samples[0].states[i],b=samples[1].states[i];if(canonical(a.geometry)!==canonical(b.geometry))differences.push({state:a.state,field:'complete-navigation-geometry-or-state'});if(a.screenshot.sha256!==b.screenshot.sha256)differences.push({state:a.state,field:'screenshot-bytes'});if(!a.geometry.rootVisible||!b.geometry.rootVisible)differences.push({state:a.state,field:'hidden-root'});}
 if(viewport!=='desktop')for(const sample of samples){const opened=sample.states.find((s:any)=>s.state==='more-open');if(!opened.geometry.moreButtons.some((b:any)=>b.expanded==='true'&&b.inlineTransform==='rotate(180deg)'&&b.transform==='matrix(-1, 0, 0, -1, 0, 0)'))differences.push({kind:sample.kind,state:'more-open',field:'expanded-chevron-presentation'});}
 rows.push({viewport,size,samples,differences,passed:!differences.length});console.log(JSON.stringify({viewport,differences:differences.length}));
}}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
await writeJson(join(directory,'component-comparison.json'),{kind:'frozen-three-part-navigation-versus-single-block-transport',rows,passed:rows.every(r=>r.passed),visualReview:'pending',notFullSourceSiteAcceptance:true,published:false});
await writeJson(join(directory,'manifest.json'),{schemaVersion:1,version,status:'provisional-editor-capacity-probe',target:input.target,sourceSnapshot:input.sourceSnapshot,component:{id:'navigation',scope:'#vr-block-navigation',file:'component.html',sha256:sha,characters:single.length},sourcePackage:{version:inputVersion,manifestSha256:digest(manifestBytes),installationOrder:input.installationOrder,parts:parts.map(({file,sha256})=>({file,sha256}))},transportChange:'Original part order and all CSS/navigation/runtime retained; only two exact hidden style-wrapper marker spans removed to prevent hiding the combined block.',editorCapacity:{testedLowerBound:91017,requiresExactReadback:true,onTruncation:'Restore the prior block immediately; use the original unchanged three-part package.'},objectivePassed:rows.every(r=>r.passed),comparisonFile:'component-comparison.json',comparisonSha256:digest(await readFile(join(directory,'component-comparison.json'))),routeDependencies:input.routeDependencies,pending:input.pending,agentVisualReview:'pending',publicationAllowed:false});
console.log(JSON.stringify({version,directory,characters:single.length,sha256:sha,objectivePassed:rows.every(r=>r.passed),published:false}));
if(rows.some(r=>!r.passed))process.exitCode=1;

