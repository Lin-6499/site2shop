import {observeScrollbarEnvironment} from './browser-rendering-policy.js';
import {beginSourceRenderedAction,waitSourceRenderedReadiness} from './source-rendered-readiness.js';
import type {Page,Response} from 'playwright';
import { join, dirname, resolve } from "node:path";
import { load } from "cheerio";
import { digest, jsonFile, readRef, saveArtifact, writeJson, safeBrowserError } from "./artifacts.js";
import type { Inventory } from "./contracts.js";
import { perform,guardContext } from './browser.js';
import { sourceStorage,sourceStorageCurrent, assertSourceUnblocked,sourceSessionPolicy,openSourceBrowser,observeBrowserContext } from './source-session.js';
import { assertRenderedEvidencePage } from '../rendered-page-validity.js';
import {admittedSourceReadQuery,sourceReadQueryPolicy} from './source-read-queries.js';
import {projectSourcePrivacy,sourcePrivacyPolicy} from './source-privacy.js';

const discoveryDocuments=new WeakMap<Page,Response>();
/** Use only an observed, visible real link; otherwise perform the declared navigation. */
export async function navigateDiscoveryPage(page:Page,url:string){
  beginSourceRenderedAction(page);
  if(!discoveryDocuments.has(page))page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())discoveryDocuments.set(page,response);});
  const prior=discoveryDocuments.get(page);
  const links=page.locator('a[href]');
  for(let i=0;i<await links.count();i++){
    const link=links.nth(i),href=await link.getAttribute('href');
    if(!href||new URL(href,page.url()).href!==url||!await link.isVisible())continue;
    await Promise.all([page.waitForURL(url,{waitUntil:'domcontentloaded',timeout:30000}),link.click({timeout:30000})]);
    return discoveryDocuments.get(page)||prior||null;
  }
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  if(response)discoveryDocuments.set(page,response);
  return response;
}
export function sourceRateLimited(status:number|undefined,text:string){return status===429||/error\s*1015|you are being rate limited|rate limit(?:ed|ing)? by cloudflare/i.test(text);}
async function assertDiscoveryRateLimit(page:Page,response:Response|null){
  if(sourceRateLimited(response?.status(),await page.title()+' '+await page.locator('body').innerText().catch(()=>'')))throw Error('SOURCE_RATE_LIMITED: HTTP 429 or Cloudflare Error 1015; traversal stopped');
}
async function assertDiscoveryPage(page:Page,response:Response|null){
  await assertDiscoveryRateLimit(page,response);
  await assertRenderedEvidencePage(page,response,'source');
}

/** Read-only reconnaissance. Output is an inventory, never an approved capture plan. */
export async function discover(projectFile: string, maxRoutes = 200, resume = false) {
  const projectRoot = dirname(resolve(projectFile)), project = await jsonFile(projectFile), origin = new URL(project.sourceUrl).origin;
  const queue = new Set<string>(["/", ...(project.workflow?.discoverySeeds || [])]), visited = new Set<string>();
  const viewports=project.workflow?.discoveryViewports||{desktop:{width:1440,height:1000},tablet:{width:768,height:1024},mobile:{width:375,height:812}};
  let inventory: Inventory = { schemaVersion: 2, sourceUrl: origin, complete: false, coverage:{viewports:Object.keys(viewports),surfaces:[]}, sources: [], occurrences: [], routes: {} };
  const boundaryFor = (path:string) => (project.workflow?.discoveryBoundaries || []).find((b:any) => {
    const pathname = new URL(path, origin).pathname;
    return pathname === b.path || b.includeDescendants && pathname.startsWith(b.path + '/');
  });
  const failures: {path:string; error:string}[] = [];
  let interrupted=false,attachedPage:Page|undefined;
  const settle = async (page:import('playwright').Page) => {
    await page.waitForLoadState('networkidle',{timeout:project.workflow?.discoveryNetworkIdleMs || 8000}).catch(()=>undefined);
  };
  const sessionPolicy=sourceSessionPolicy(project),staleSessions=new Set<string>();
  if(resume){
    const old:Inventory=await jsonFile(join(projectRoot,'contracts/route-inventory.v2.json'));
    if(old.schemaVersion!==2||old.sourceUrl!==origin)throw Error('Cannot resume another source/legacy inventory');
    for(const surface of old.coverage.surfaces){
      let data:any;try{data=JSON.parse((await readRef(projectRoot,surface.evidence!)).toString());}catch{staleSessions.add(surface.path);continue;}
      const size=(viewports as any)[surface.viewport];
      if(data.kind!=='reconnaissance-not-acceptance'||!size||data.viewportSize?.width!==size.width||data.viewportSize?.height!==size.height||data.requestedPath!==surface.path||data.state!==surface.state||new URL(data.url).origin!==origin)throw Error('Resume requires current three-device raw reconnaissance; previous login-wall/legacy captures cannot be reused');
      if(sessionPolicy&&(data.sourceSessionCurrent!==true||data.sourceSessionPolicySha256!==sessionPolicy))staleSessions.add(surface.path);
      if((data.sourceReadQueryPolicySha256||null)!==sourceReadQueryPolicy(project,surface.path))staleSessions.add(surface.path);
      if((data.sourcePrivacyPolicySha256||null)!==sourcePrivacyPolicy(project,surface.path))staleSessions.add(surface.path);
    }
    inventory=structuredClone(old);inventory.complete=false;delete inventory.coverage.agentReview;
    for(const [path,route]of Object.entries(old.routes))if(!boundaryFor(path)&&new URL(path,origin).origin===origin&&!/\.(?:png|jpe?g|webp|avif|svg|pdf|zip)$/i.test(new URL(path,origin).pathname))queue.add(path);
    for(const path of queue){
      const complete=Object.keys(viewports).every(vp=>['initial',...(project.workflow?.discoveryStates||[]).filter((s:any)=>s.path===path&&(!s.viewports||s.viewports.includes(vp))).map((s:any)=>s.state)].every(state=>old.coverage.surfaces.some(s=>s.path===path&&s.viewport===vp&&s.state===state&&s.status==='captured')));
      if(complete&&!staleSessions.has(path))visited.add(path);
    }
    const retry=new Set([...queue].filter(p=>!visited.has(p)));
    if(retry.size)await saveArtifact(projectRoot,{kind:'previous-discovery-attempt-not-acceptance',reason:staleSessions.size?'Source authentication freshness policy requires recapture':'Retry unresolved routes',inventory:old,analysis:await jsonFile(join(projectRoot,'contracts/site-analysis.json')).catch(()=>null)});
    inventory.sources=old.sources.filter(s=>!(s.kind==='rendered'&&retry.has(new URL(s.url).pathname+new URL(s.url).search)));
    inventory.coverage.surfaces=old.coverage.surfaces.filter(s=>!retry.has(s.path));
    inventory.occurrences=old.occurrences.filter(o=>!retry.has(o.from));
    console.log(JSON.stringify({kind:'discovery-resume',reusedRoutes:visited.size,pending:[...queue].filter(p=>!visited.has(p)).length,staleSessionRoutes:staleSessions.size,acceptance:'not-reviewed'}));
  }
  let storageState = await sourceStorage(project);
  const browser=await openSourceBrowser(project);
  const newContext=async()=>{
    const lease=await browser.createContext({storageState,serviceWorkers:'block',viewport:{width:1440,height:1000},locale:'en-US'});
    if(!lease.attached)await lease.context.route('**/*',route=>{
      const request=route.request();
      if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!admittedSourceReadQuery(project,{method:request.method(),url:request.url(),frameUrl:request.frame().url(),payload:request.postData()||'',navigation:request.isNavigationRequest(),resourceType:request.resourceType()})||request.isNavigationRequest()&&new URL(request.url()).origin!==origin)return route.abort('blockedbyclient');
      return route.continue();
    });
    return lease;
  };
  let lease=await newContext(),context=lease.context;
  const admit = (href: string, from: string, text: string, surface: string) => {
    const u = new URL(href, origin + from);
    if (["javascript:","data:"].includes(u.protocol)) {failures.push({path:from,error:'Scripted link requires a planned navigation action: '+href});return;}
    const external=u.origin!==origin||!["http:","https:"].includes(u.protocol);
    const path = external?u.href:u.pathname + u.search;
    const id = digest(`${from}\0${path}\0${text}\0${surface}\0${inventory.occurrences.length}`).slice(0,20);
    inventory.occurrences.push({ id, from, path, text, surface });
    if(external){inventory.routes[path]||={disposition:'unresolved',rationale:'External/contact destination requires explicit review and preservation'};return;}
    if (/\.(?:png|jpe?g|webp|avif|svg|pdf|zip)$/i.test(u.pathname)) {
      inventory.routes[path] ||= { disposition:"unresolved",rationale:"Linked downloadable/static resource requires an explicit copy or external disposition" };
    } else {
      const boundary = boundaryFor(path);
      if (boundary) {
        inventory.routes[path] ||= { disposition:'deferred-online', rationale:boundary.rationale };
        return;
      }
      queue.add(path);
    }
    inventory.routes[path] ||= { disposition:"unresolved",rationale:"Discovered destination; classify from rendered behavior before mapping" };
  };
  try {
    const sitemapQueue = resume ? [] : ["/sitemap.xml"], seenMaps = new Set<string>();
    while (sitemapQueue.length && seenMaps.size < 25) {
      const path = sitemapQueue.shift()!; if (seenMaps.has(path)) continue; seenMaps.add(path);
      try {
        const response = await context.request.get(origin + path, { timeout:20000 });
        if (response.status() === 404) { inventory.sources.push({url:origin+path,kind:"sitemap",status:"absent"}); continue; }
        if(response.status()===429){interrupted=true;throw Error('SOURCE_RATE_LIMITED: HTTP 429 sitemap; traversal stopped');}
        if (!response.ok()) throw Error(`HTTP ${response.status()}`);
        const xml = await response.text(), $ = load(xml, { xml:true });
        if (!$("urlset,sitemapindex").length) throw Error("Not a sitemap (possibly SPA fallback)");
        const evidence = await saveArtifact(projectRoot, xml, "xml");
        inventory.sources.push({url:origin+path,kind:"sitemap",status:"ok",evidence});
        for (const element of $("loc").toArray()) { const url = new URL($(element).text()); if (url.origin !== origin) continue; if ($(element).parent().is("sitemap")) sitemapQueue.push(url.pathname+url.search); else admit(url.href,path,"sitemap","sitemap"); }
      } catch (error) { inventory.sources.push({url:origin+path,kind:"sitemap",status:"failed"}); failures.push({path,error:safeBrowserError(error)});if(interrupted)break; }
    }
    if (sitemapQueue.length) failures.push({path:"sitemap",error:"Sitemap recursion budget exhausted"});
    // Bounded sequential traversal avoids hammering the source storefront.
    while (!interrupted&&[...queue].some(path=>!visited.has(path)) && visited.size < maxRoutes) {
      const path = [...queue].find(path=>!visited.has(path))!; visited.add(path);
      for(const [viewport,size] of Object.entries<any>(viewports)){
      if(!sourceStorageCurrent(project,storageState)){await lease.close();storageState=await sourceStorage(project);lease=await newContext();context=lease.context;}
      const page=attachedPage||await lease.newPage();
      try {
        if(lease.attached&&!attachedPage){attachedPage=page;await guardContext(page,origin,'source',undefined,project);}
        await page.setViewportSize(size);
        beginSourceRenderedAction(page);
        const response=lease.attached?await navigateDiscoveryPage(page,origin+path):await page.goto(origin+path,{waitUntil:"domcontentloaded",timeout:30000});
        await assertDiscoveryRateLimit(page,response);
        await settle(page);
        await waitSourceRenderedReadiness(page,project,15000);
        await assertDiscoveryPage(page,response);
        const actual = new URL(page.url()), expected = new URL(path,origin);
        const alias=project.workflow?.discoveryAliases?.[path];
        if(actual.origin!==origin || actual.pathname+actual.search!==(alias||expected.pathname+expected.search)) throw Error(`Discovery redirected away from the planned route to ${actual.pathname}; record the redirect separately before admitting it`);
        const surveys=[{state:'initial',actions:[]},...(project.workflow?.discoveryStates||[]).filter((s:any)=>s.path===path&&(!s.viewports||s.viewports.includes(viewport)))];
        for(const survey of surveys){
        const actionLog=[];
        if(survey.state!=='initial'){
          beginSourceRenderedAction(page);
          const stateResponse=lease.attached?await navigateDiscoveryPage(page,origin+path):await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:30000});
          await assertDiscoveryRateLimit(page,stateResponse);
          await settle(page);
          await assertDiscoveryPage(page,stateResponse);
          for(const action of survey.actions)actionLog.push(await perform(page,action,'source',10000,false));
          await settle(page);
          await waitSourceRenderedReadiness(page,project,15000);
          await assertDiscoveryPage(page,discoveryDocuments.get(page)||stateResponse);
        }
        const stateUrl=new URL(page.url());
        if(stateUrl.origin!==origin||boundaryFor(stateUrl.pathname+stateUrl.search))throw Error('Source state reached an authentication, personal-data or external navigation boundary; no page content was collected');
        await assertSourceUnblocked(page,project);
        const ready=project.workflow?.sourceReadiness?.[path];if(ready)await page.locator(ready).first().waitFor({state:'visible',timeout:30000});
        const privacy=await projectSourcePrivacy(page,project);
        const data = await page.evaluate(String.raw`(() => ({url:location.href,title:document.title,canonical:document.querySelector('link[rel=canonical]')?.href||null,
          headings:[...document.querySelectorAll('h1,h2,h3')].map(n=>({tag:n.tagName,text:n.textContent.trim()})),
          links:[...document.querySelectorAll('a[href]')].map(a=>({href:a.href,text:a.textContent.trim(),surface:a.closest('header')?'header':a.closest('footer')?'footer':'content'})),
          controls:[...document.querySelectorAll('button,input,select,textarea')].map(n=>({tag:n.tagName,role:n.getAttribute('role'),label:n.getAttribute('aria-label')||n.textContent.trim(),type:n.getAttribute('type')})),
          overlays:[...document.querySelectorAll('[role=dialog]')].map(n=>({text:n.textContent.trim(),visible:!!n.getBoundingClientRect().width})),
          viewportSize:{width:innerWidth,height:innerHeight},
          structure: (()=>{const n=document.body.cloneNode(true);n.querySelectorAll('script,noscript').forEach(s=>s.remove());n.querySelectorAll('input,textarea').forEach(s=>{s.removeAttribute('value');if(s.tagName==='TEXTAREA')s.textContent=''});return n.innerHTML})(),
          stylesheets:[...document.querySelectorAll('link[rel=stylesheet]')].map(n=>n.href),
          images:[...document.images].map(n=>({src:n.currentSrc||n.src,alt:n.alt,width:n.naturalWidth,height:n.naturalHeight})),
          integrationOrigins:[...new Set([...document.scripts].filter(s=>s.src).map(s=>new URL(s.src).origin))]
        }))()` ) as any;
        Object.assign(data,privacy);
        const screenshot=await saveArtifact(projectRoot,await page.screenshot({fullPage:true}),'png');
        const readQueryPolicy=sourceReadQueryPolicy(project,path);
        const evidence = await saveArtifact(projectRoot,{...data,browserContext:await observeBrowserContext(page),scrollbarEnvironment:await observeScrollbarEnvironment(page,project,!browser.attached),connectionMode:browser.attached?'existing-chrome':'isolated',viewport,state:survey.state,actionLog,screenshot,status:response?.status(),requestedPath:path,capturedAt:new Date().toISOString(),expectedRedirect:alias||null,kind:"reconnaissance-not-acceptance",...(sessionPolicy?{sourceSessionCurrent:true,sourceSessionPolicySha256:sessionPolicy}:{}),...(readQueryPolicy?{sourceReadQueryPolicySha256:readQueryPolicy}:{})});
        inventory.coverage.surfaces.push({id:`${path}/${viewport}/${survey.state}`,viewport,path,state:survey.state,status:response?.ok()?'captured':'failed',evidence});
        inventory.sources.push({url:origin+path,kind:"rendered",status:response?.ok()?"ok":"failed",evidence});
        if (!response?.ok()) failures.push({path,error:`HTTP ${response?.status()}`});
        inventory.routes[path] ||= {disposition:"unresolved",rationale:"Rendered route requires family/mapping decision",evidence};
        inventory.routes[path].evidence = evidence;
        for(const [boundaryPath, boundary] of Object.entries(inventory.routes)) if(boundary.disposition==='deferred-online'&&!boundary.evidence) boundary.evidence=evidence;
        for (const link of data.links) admit(link.href,path,link.text,`${viewport}/${survey.state}/${link.surface}`);
        if(new URL(data.url).origin!==origin)throw Error('Scripted source navigation left its source origin');
        if(new URL(data.url).pathname+new URL(data.url).search!==actual.pathname+actual.search)admit(data.url,path,`Observed ${survey.state} scripted navigation`,`${viewport}/${survey.state}/scripted`);
        }
      } catch(error) {failures.push({path,error:safeBrowserError(error)});inventory.sources.push({url:origin+path,kind:'rendered',status:'failed'});if(/SOURCE_RATE_LIMITED|HTTP 429|error\s*1015/i.test(String(error))){interrupted=true;visited.delete(path);}}
      finally {if(!lease.attached)await page.close();}
      if(interrupted)break;
      }
      await writeJson(join(projectRoot,"contracts","discovery-progress.json"),{visited:visited.size,queued:queue.size,failures});
      console.log(JSON.stringify({kind:'discovery-progress',visited:visited.size,queued:queue.size,path,failures:failures.length}));
      await writeJson(join(projectRoot,'contracts','route-inventory.v2.json'),inventory);
    }
    // Automated traversal cannot attest that all drawers, overlays and scripted surfaces were examined.
    inventory.complete = false;
    const crawlComplete=!interrupted&&!failures.length && [...queue].every(p=>visited.has(p));
    const path = join(projectRoot,"contracts","route-inventory.v2.json");
    await writeJson(path,inventory);
    await writeJson(join(projectRoot,"contracts","site-analysis.json"),{schemaVersion:2,sourceUrl:origin,kind:"reconnaissance",visited:visited.size,discovered:queue.size,crawlComplete,complete:inventory.complete,stoppedReason:interrupted?'source-rate-limit':null,failures,pending:[...queue].filter(p=>!visited.has(p)),navigationReview:'required: inspect three-device initial captures; add discoveryStates for menus, overlays, scripted navigation; classify all destinations; record hashed agentReview before setting complete',providers:{status:"requires-agent-classification",evidence:"route-inventory.v2.json sources"}});
    return {file:path,visited:visited.size,discovered:queue.size,complete:inventory.complete,unresolved:Object.keys(inventory.routes).length};
  } finally {await lease.close();await browser.close();}
}

export {runSourceWorkerOperation} from './source-worker-runtime.js';
