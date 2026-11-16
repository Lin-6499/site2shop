import {dirname,join,resolve,extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {jsonFile,readRef,writeJson,saveArtifact,canonical,digest} from '../src/shopyy/artifacts.js';
import {renderFamilies} from '../src/shopyy/families.js';
import {inspectSourceComponents} from '../src/shopyy/browser.js';
import type {Plan} from '../src/shopyy/contracts.js';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import {pathToFileURL} from 'node:url';
import type {SourceStorage} from '../src/shopyy/source-session.js';

// Live-source development diagnostic. No build ID, source approval, draft handoff or acceptance is produced.
const direct=!!process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
export async function compareHomeDevelopment(projectFile:string,scenario='initial',storageState?:SourceStorage){
const file=resolve(projectFile),root=dirname(file),project=await jsonFile(file);
const action=(op:string,selector:string,value?:string)=>({op,selector,effect:'read-only',...(value===undefined?{}:{value})});
const menu=action('click',"button[aria-label='Toggle menu']");
const search=action('click',"button[aria-label='Search products']");
const scenarios:Record<string,any>={
 initial:{},
 shippingNotice:{extra:{shippingNotice:'body > div:has(#intl-waitlist-email)'}},
 shippingDismissed:{actions:[action('press','button[aria-label="Dismiss shipping notice"]','Enter')],postAbsent:'body > div:has(#intl-waitlist-email)'},
 sections:{viewports:['desktop'],actions:[action('hover',"button[aria-label='Shop by section']")],extra:{sectionPanel:'[data-shop-section-menu="desktop"] > div'},postReady:'[data-shop-section-menu="desktop"] > div'},
 sectionsClosed:{viewports:['desktop'],actions:[action('hover',"button[aria-label='Shop by section']"),action('hover','h1')],postHidden:'[data-shop-section-menu="desktop"] > div'},
 more:{viewports:['desktop'],actions:[action('hover',"nav button[aria-label='More Void Research pages']")],extra:{morePanel:'nav > div.group > div'},postReady:'nav > div.group > div'},
 desktopMoreClosed:{viewports:['desktop'],actions:[action('hover',"nav button[aria-label='More Void Research pages']"),action('hover','h1')],postHidden:'nav > div.group > div'},
 mobileMenu:{viewports:['tablet','mobile'],actions:[menu],conditional:['mobilePanel'],postReady:'header > div.lg\\:hidden'},
 mobileMore:{viewports:['tablet','mobile'],actions:[menu,action('click',"header > div.lg\\:hidden button[aria-label='More Void Research pages']")],conditional:['mobilePanel'],postReady:'header > div.lg\\:hidden nav > button + div.pl-4'},
 menuClosed:{viewports:['tablet','mobile'],actions:[menu,menu],postAbsent:"header > div.lg\\:hidden"},
 moreClosed:{viewports:['tablet','mobile'],actions:[menu,action('click',"header > div.lg\\:hidden button[aria-label='More Void Research pages']"),action('click',"header > div.lg\\:hidden button[aria-label='More Void Research pages']")],conditional:['mobilePanel'],postAbsent:'header > div.lg\\:hidden nav > button + div.pl-4'},
 searchGHK:{actions:[search,action('fill',"input[placeholder='Search compounds…']",'GHK')],conditional:['searchOverlay'],postReady:'p:text-is("GHK-CU/KPV")'},
 searchNone:{actions:[search,action('fill',"input[placeholder='Search compounds…']",'zz-s2s-504457-no-match')],conditional:['searchOverlay'],postReady:'text=No compounds match'},
 searchReset:{actions:[search,action('fill',"input[placeholder='Search compounds…']",'GHK'),action('fill',"input[placeholder='Search compounds…']",'')],conditional:['searchOverlay'],postReady:'text=Start typing to search the catalog.'},
 searchClosed:{actions:[search,action('click',"button[aria-label='Close']")],postAbsent:"input[placeholder='Search compounds…']"},
 searchNavigate:{actions:[search,action('fill',"input[placeholder='Search compounds…']",'GHK'),action('click','button:has-text("View all results")')],destination:true,extra:{collectionIntro:'div.min-h-screen > section:nth-of-type(1)',collectionTrust:'div.min-h-screen > section:nth-of-type(2)',collectionFilters:'div.min-h-screen > section:nth-of-type(3)',collectionBox:'div.min-h-screen > section:nth-of-type(4)',collectionGrid:'div.min-h-screen > section:nth-of-type(5)',collectionNewsletter:'div.min-h-screen > section:nth-of-type(6)',catalogQuery:'input[placeholder="Search for products"]'},postReady:'h1:text-is("All Products")',sourceFinalPath:'/shop?q=GHK',targetFinalPath:'/collections/all?q=GHK',fieldsExtra:['value']},
 cart:{actions:[action('click',"button[aria-label='Cart, 0 items']")],conditional:['cartOverlay','cartPanel'],postReady:"button[aria-label='Close cart']"},
 cartClosed:{actions:[action('click',"button[aria-label='Cart, 0 items']"),action('click',"button[aria-label='Close cart']")],postAbsent:"button[aria-label='Close cart']"},
 footer:{actions:[{op:'scroll',y:999999,effect:'read-only'}]},
 picksRight:{actions:[action('click',"button[aria-label='Scroll researcher picks right']")],postReady:'#researcher-picks',settleScrollSelector:'#researcher-picks'},
 picksReset:{actions:[action('click',"button[aria-label='Scroll researcher picks right']"),action('click',"button[aria-label='Scroll researcher picks left']"),{op:'scroll',y:0,effect:'read-only'}],postReady:'#researcher-picks',settleScrollSelector:'#researcher-picks'},
};
scenarios.searchDirect={...scenarios.searchNavigate,actions:[],sourcePath:'/shop?q=GHK',targetPath:'/collections/all?q=GHK'};
const spec=scenarios[scenario];if(!spec)throw Error('Unknown development scenario');
const proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
const sourceInventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
const inventory=await saveArtifact(root,{...sourceInventory,complete:false,role:'unapproved-development-routing',routes:Object.fromEntries(proposal.rows.map((r:any)=>[r.sourcePath,{disposition:r.proposedDisposition,targetPath:r.targetPath,family:r.family,rationale:r.rationale}]))});
const plan=await jsonFile(join(root,project.capturePlanFile));
const rendered=await renderFamilies(root,project,{...plan,inventory} as Plan);
const css=await readFile(join(root,project.commonStyleFile)),runtime=await readFile(join(root,project.commonScriptFile));
const developmentRenderSha256=digest(canonical({pages:[...rendered.preview].map(([path,html])=>({path,sha256:digest(html)})),style:digest(css),runtime:digest(runtime)}));
const types:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif'};
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const u=new URL(req.url!,'http://diagnostic'),path=rendered.routes[u.pathname+u.search]||rendered.routes[u.pathname];
  if(path){res.writeHead(200,{'Content-Type':'text/html','X-Site2Shop-Diagnostic':'unapproved-development-only'}).end(rendered.preview.get(path.replace(/^preview\//,'')));return;}
  if(u.pathname.endsWith('/styles/storefront-common.css')){res.writeHead(200,{'Content-Type':'text/css'}).end(css);return;}
  if(u.pathname.endsWith('/styles/page-contracts.css')){res.writeHead(200,{'Content-Type':'text/css'}).end('/* Source bindings not yet approved. Development diagnostic only. */');return;}
  if(u.pathname.endsWith('/scripts/storefront-runtime.js')){res.writeHead(200,{'Content-Type':'application/javascript'}).end(runtime);return;}
  const name=u.pathname.split('/').pop()!;
  if(u.pathname.startsWith(`/assets/${project.siteId}/images/source-current/`)&&/^[a-f0-9]{64}\.(png|jpg|avif|webp|svg|gif)$/.test(name)){
   res.writeHead(200,{'Content-Type':types[extname(name)]}).end(await readFile(join(root,project.assetsDirectory,'source-current',name)));return;
  }
  res.writeHead(404).end('Unmapped development resource');
 }catch{res.writeHead(500).end('Development diagnostic resource error');}
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
try{
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const model=await jsonFile(join(root,spec.destination?'contracts/secondary-components.draft.json':'contracts/home-components.draft.json'));
 const components={...model.components,...Object.fromEntries((spec.conditional||[]).map((k:string)=>[k,model.conditionalComponents[k]])),...spec.extra};
 const targetComponents={...Object.fromEntries(Object.keys({...model.components,...Object.fromEntries((spec.conditional||[]).map((k:string)=>[k,model.conditionalComponents[k]]))}).map(k=>[k,`[data-vr-component="${k}"]`])),...spec.extra};
 const common={sourcePath:'/',topology:'component-tree',infiniteAnimations:'frame-zero',rasterizeInfiniteFrameZero:true,preloadImages:true,imageRoot:'div.min-h-screen',initialReady:'header [data-first-screen-marquee="true"]',actions:spec.actions,viewports:spec.viewports,postReady:spec.postReady,postAbsent:spec.postAbsent,postHidden:spec.postHidden,settleScrollSelector:spec.settleScrollSelector};
 const suffix=scenario==='initial'?'':`-${scenario.toLowerCase()}`;
 const sourceId=`home-development-source${suffix}`,targetId=`home-development-target${suffix}`;
 await writeJson(join(root,'contracts/development-source-selectors.json'),{...common,sourcePath:spec.sourcePath||'/',inspectionId:sourceId,components,expectedFinalPath:spec.sourceFinalPath,captureStructure:spec.destination===true});
 await writeJson(join(root,'contracts/development-target-selectors.json'),{...common,sourcePath:spec.targetPath||'/',inspectionId:targetId,components:targetComponents,expectedFinalPath:spec.targetFinalPath});
 const targetFile=join(root,'diagnostic-target.project.json');
 await writeJson(targetFile,{sourceUrl:origin,workflow:{sourceSession:{enabled:false},discoveryNetworkIdleMs:2000}});
 const source=await inspectSourceComponents(file,'contracts/development-source-selectors.json',{sourceStorageState:storageState});
 const target=await inspectSourceComponents(targetFile,'contracts/development-target-selectors.json');
 const base=join(root,'verification/recon-current/inspections'),comparisons:any[]=[];
 const fields=[...new Set(['visible',...plan.routes.home.components.heroHeading.requiredFields,...spec.fieldsExtra||[]])];
 for(const vp of spec.viewports||['desktop','tablet','mobile']){
  const a=source.rows.find(r=>r.viewport===vp),b=target.rows.find(r=>r.viewport===vp);
  if(!a?.passed||!b?.passed){comparisons.push({viewport:vp,errors:[a?.error,b?.error].filter(Boolean)});continue;}
  const s=JSON.parse((await readRef(join(base,sourceId),a.evidence)).toString());
  const t=JSON.parse((await readRef(join(base,targetId),b.evidence)).toString());
  const differences:any[]=[];
  for(const id of Object.keys(components))for(const field of fields){
   const x=s.components[id][field],y=t.components[id][field];
   const same=['x','y','width','height'].includes(field)?Math.abs(x-y)<=2:canonical(x)===canonical(y);
   if(!same)differences.push({component:id,field,source:x,target:y});
  }
  const sourcePixels=await sharp(await readRef(join(base,sourceId),s.screenshot)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const targetPixels=await sharp(await readRef(join(base,targetId),t.screenshot)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const w=sourcePixels.info.width,h=sourcePixels.info.height;
  const pixelDiagnostic=w===targetPixels.info.width&&h===targetPixels.info.height?{differentPixels:pixelmatch(sourcePixels.data,targetPixels.data,undefined,w,h,{threshold:0.1}),totalPixels:w*h,role:'diagnostic-only-no-acceptance-threshold'}:{error:'Screenshot dimensions differ'};
  comparisons.push({viewport:vp,source:a.evidence,target:b.evidence,...(a.structure?{sourceStructure:a.structure}:{}),differences,pixelDiagnostic,sourceScreenshot:s.screenshot,targetScreenshot:t.screenshot,sourceFullPage:s.fullPage,targetFullPage:t.fullPage});
 }
 const reportPath=join(root,`verification/recon-current/home-development-comparison${suffix}.json`);
 const prior=await jsonFile(reportPath).catch(()=>null);
 const priorAttempt=prior?await saveArtifact(root,{kind:'prior-development-comparison-attempt',report:prior}):null;
 const report={kind:'live-source-development-comparison-not-acceptance',scenario,sourceId,targetId,developmentRenderSha256,comparisons,priorAttempt,sourceInventoryApproved:false,formalSourceGatePassed:false,visualReview:'pending',buildCreated:false,draftChanged:false,published:false};
 await writeJson(reportPath,report);
 if(direct)console.log(JSON.stringify(report,null,2));
 return report;
}finally{await new Promise<void>(r=>server.close(()=>r()));}
}
if(direct)await compareHomeDevelopment(process.argv[2]||'',process.argv[3]||'initial');
