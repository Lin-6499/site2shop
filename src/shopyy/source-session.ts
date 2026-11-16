import {ownedHeadlessOptions,observeScrollbarEnvironment} from './browser-rendering-policy.js';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { digest, jsonFile, writeJson } from "./artifacts.js";
import { assertRenderedEvidencePage,renderedEvidenceRejection } from "../rendered-page-validity.js";
import {sourceUrlMutationReason,sourceSafeMethod,sourceNavigationOptions,waitSourceNavigation} from './source-safety-policy.js';
import {isolatedGuestContextPolicyHash,registerSourceContextPage,type SourceContextProof} from './source-context.js';

export type SourceSessionProject = { sourceUrl: string; workflow?: { preserveClassicScrollbars?:boolean; sourceSession?: { enabled?: boolean; connection?:{mode:'existing-chrome';userDataDir?:string;timeoutMs?:number}; readySelector?: string; blockedSelectors?:string[]; refreshOrigins?:string[];sessionStorageKey?:string; preferenceDismissals?:{selector:string;op:'click'|'press';value?:string;waitMs?:number}[] } } };
type Project=SourceSessionProject;

export function usesExistingChrome(project:Project){return project.workflow?.sourceSession?.connection?.mode==='existing-chrome';}

/** Chrome's user-approved local endpoint; this file contains no site credentials. */
export async function existingChromeEndpoint(project:Project){
  const connection=project.workflow?.sourceSession?.connection;
  if(connection?.mode!=='existing-chrome')throw Error('Existing Chrome connection is not configured');
  const directory=connection.userDataDir||join(homedir(),'AppData','Local','Google','Chrome','User Data');
  let value:string;
  try{value=await readFile(join(directory,'DevToolsActivePort'),'utf8');}
  catch{throw Error('Enable remote debugging in your normal Chrome at chrome://inspect/#remote-debugging, then approve the connection request.');}
  const [portText,socketPath]=value.trim().split(/\r?\n/),port=Number(portText);
  if(!Number.isInteger(port)||port<1||port>65535||!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(socketPath||''))throw Error('Chrome did not provide a valid local DevTools endpoint');
  return `ws://127.0.0.1:${port}${socketPath}`;
}

function sourceBrowserKey(project:Project){return JSON.stringify([new URL(project.sourceUrl).href,resolve(project.workflow?.sourceSession?.connection?.userDataDir||join(homedir(),'AppData','Local','Google','Chrome','User Data'))]);}
const borrowedSourceBrowsers=new Map<string,{browser:Browser}>();
/** Register a process-owned connection. Releasing never disconnects its transport. */
export function borrowSourceBrowser(project:Project,browser:Browser):()=>void{
  if(!usesExistingChrome(project))throw Error('Borrowed browser requires existing-chrome configuration');
  if(!browser.isConnected())throw Error('Cannot borrow a disconnected browser');
  const key=sourceBrowserKey(project),registration={browser};
  if(borrowedSourceBrowsers.has(key))throw Error('A source browser is already registered for this project connection');
  borrowedSourceBrowsers.set(key,registration);
  return()=>{if(borrowedSourceBrowsers.get(key)===registration)borrowedSourceBrowsers.delete(key);};
}

export type SourceContextLease={context:BrowserContext;attached:boolean;newPage:()=>Promise<Page>;close:()=>Promise<void>;sourceContextProof?:SourceContextProof};

/** Owned contexts are isolated; attached Chrome leases own only their newly created pages. */
export async function openSourceBrowser(project:Project,providedBrowser?:Browser,engine:Pick<typeof chromium,'launch'|'connectOverCDP'>=chromium){
  const attached=usesExistingChrome(project);
  const registered=attached?borrowedSourceBrowsers.get(sourceBrowserKey(project))?.browser:undefined;
  const borrowed=!!registered?.isConnected();
  const browser=borrowed?registered!:attached?await engine.connectOverCDP(await existingChromeEndpoint(project),{noDefaults:true,timeout:project.workflow?.sourceSession?.connection?.timeoutMs||120000}):providedBrowser||await engine.launch(ownedHeadlessOptions(project));
  const existing=attached?browser.contexts()[0]:undefined;
  if(attached&&!existing){if(!borrowed)await browser.close();throw Error('Running Chrome did not expose its existing context');}
  const leases=new Set<SourceContextLease>();
  let closed=false;
  return {attached,async createContext(options:BrowserContextOptions):Promise<SourceContextLease>{
    if(closed)throw Error('Source browser connection is closed');
    const context=existing||await browser.newContext(options),pages=new Set<Page>();let released=false;
    const lease:SourceContextLease={context,attached,async newPage(){
      if(released)throw Error('Source context lease is closed');
      const page=await context.newPage();pages.add(page);
      try{if(attached){if(options.viewport)await page.setViewportSize(options.viewport);await page.bringToFront();}return page;}
      catch(error){await page.close();pages.delete(page);throw error;}
    },async close(){if(released)return;released=true;leases.delete(lease);if(attached){for(const page of pages)await page.close().catch(()=>undefined);}else await context.close();}};
    leases.add(lease);return lease;
  },async close(){if(closed)return;closed=true;try{for(const lease of [...leases])await lease.close();}finally{
    // For connectOverCDP, Browser.close disconnects this Playwright transport;
    // it does not close the user's Chrome process or its default context.
    if(!borrowed&&(attached||!providedBrowser))await browser.close();}
  }};
}

/** Requested key names only, on an already registered same-origin page. Never reads values. */
export async function inspectSourceStorageKeyPresence(projectFile:string,keys:string[]){
 const project:Project=await jsonFile(projectFile),origin=new URL(project.sourceUrl).origin;
 if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||!key.length))throw Error('Expected explicit storage key names');
 if(!usesExistingChrome(project)||!borrowedSourceBrowsers.get(sourceBrowserKey(project))?.browser.isConnected())throw Error('Storage presence inspection requires a registered existing source browser');
 const factory=await openSourceBrowser(project),lease=await factory.createContext({});
 try{
  const page=lease.context.pages().find(page=>{try{return!page.isClosed()&&new URL(page.url()).origin===origin;}catch{return false;}});
  if(!page)throw Error('No existing same-origin source page for storage presence inspection');
  return await page.evaluate(({origin,keys})=>{
   if(location.origin!==origin)throw Error('Source storage presence origin mismatch');
   const requestedKeys=keys.map(key=>({key,present:false})),storage=window.localStorage;
   for(let index=0;index<storage.length;index++){const name=storage.key(index);for(const requested of requestedKeys)if(name===requested.key)requested.present=true;}
   return{origin:location.origin,requestedKeys,valuesRead:false as const,timestamp:new Date().toISOString()};
  },{origin,keys});
 }finally{await lease.close();}
}

/** Disposable guest context on the registered transport; never imports application state. */
export async function createIsolatedGuestContext(project:Project,options:Pick<BrowserContextOptions,'viewport'|'locale'|'timezoneId'>={}):Promise<SourceContextLease&{sourceContextProof:SourceContextProof}>{
 if(Object.keys(options).some(key=>!['viewport','locale','timezoneId'].includes(key)))throw Error('Isolated guest context accepts only viewport and declared environment');
 const origin=new URL(project.sourceUrl).origin,registered=usesExistingChrome(project)?borrowedSourceBrowsers.get(sourceBrowserKey(project))?.browser:undefined;
 if(!registered?.isConnected())throw Error('Guest context requires a registered existing source browser');
 const original=registered.contexts()[0],originalPage=original?.pages().find(page=>{try{return!page.isClosed()&&new URL(page.url()).origin===origin;}catch{return false;}});
 if(!originalPage)throw Error('Guest context requires an existing same-origin source page');
 let factory:Awaited<ReturnType<typeof openSourceBrowser>>|undefined,lease:SourceContextLease|undefined,stage='read-clearance-cookies';
 try{
  const clearance=(await original.cookies(origin)).filter(cookie=>['cf_clearance','__cf_bm','_cfuvid'].includes(cookie.name));
  stage='read-source-environment';const environment=options.locale&&options.timezoneId?null:await observeBrowserContext(originalPage);
  const isolated:Project={...project,workflow:{...project.workflow,sourceSession:{...project.workflow?.sourceSession}}};delete isolated.workflow!.sourceSession!.connection;
  stage='create-owned-context';factory=await openSourceBrowser(isolated,registered);lease=await factory.createContext({...options,locale:options.locale??environment!.locale,timezoneId:options.timezoneId??environment!.timezoneId,serviceWorkers:'block'});
  stage='install-read-only-guard';await guardSourceSession(lease.context,project);
  await lease.context.route('**/*',route=>['fetch','xhr'].includes(route.request().resourceType())&&route.request().method()!=='GET'?route.abort('blockedbyclient'):route.fallback());
  if(typeof lease.context.routeWebSocket!=='function')throw Error('WebSocket blocking unsupported');await lease.context.routeWebSocket('**/*',socket=>socket.close());
  stage='copy-clearance-cookies';if(clearance.length)await lease.context.addCookies(clearance);
  const proof:SourceContextProof={mode:'isolated-guest',policySha256:isolatedGuestContextPolicyHash(project.sourceUrl),ownedContext:true,registeredTransport:true,copiedClearanceCookieNames:clearance.map(cookie=>cookie.name),applicationCookiesCopied:false,storageStateImported:false,apiGetOnly:true,webSocketsBlocked:true},owned=lease,owner=factory;
  return{context:owned.context,attached:false,sourceContextProof:proof,async newPage(){const page=await owned.newPage();registerSourceContextPage(page,proof);return page;},async close(){try{await owned.close();}finally{await owner.close();}}};
 }catch{
  let closed=false;try{if(factory){await factory.close();closed=!!lease;}}catch{}
  const error=Error('Isolated guest context setup unavailable at '+stage) as Error&{sourceContextFailure?:unknown};error.sourceContextFailure={stage,ownedContextCreated:!!lease,ownedContextClosed:closed};throw error;
 }
}

async function ownedChromeProbeLease(project:Project):Promise<SourceContextLease&{copiedClearanceCookieNames:string[]}>{
 const origin=new URL(project.sourceUrl).origin,registered=usesExistingChrome(project)?borrowedSourceBrowsers.get(sourceBrowserKey(project))?.browser:undefined;
 if(!registered?.isConnected())throw Error('Guest context requires a registered existing source browser');
 const original=registered.contexts()[0];if(!original?.pages().some(page=>{try{return!page.isClosed()&&new URL(page.url()).origin===origin;}catch{return false;}}))throw Error('Guest context requires an existing same-origin source page');
 const clearance=(await original.cookies(origin)).filter(cookie=>['cf_clearance','__cf_bm','_cfuvid'].includes(cookie.name));
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--window-position=-10000,-10000']});let context:BrowserContext|undefined,closed=false;
 try{
  context=await browser.newContext({viewport:{width:768,height:1024},locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
  await guardSourceSession(context,project);await context.route('**/*',route=>['fetch','xhr'].includes(route.request().resourceType())&&route.request().method()!=='GET'?route.abort('blockedbyclient'):route.fallback());
  await context.routeWebSocket('**/*',socket=>socket.close());if(clearance.length)await context.addCookies(clearance);
  return{context,attached:false,copiedClearanceCookieNames:clearance.map(cookie=>cookie.name),newPage:()=>context!.newPage(),async close(){if(closed)return;closed=true;try{await context!.close();}finally{await browser.close();}}};
 }catch{try{await context?.close();}finally{await browser.close();}throw Error('Owned Chrome probe context unavailable');}
}

async function inspectIsolatedGuestProbe(projectFile:string,options:{path:string;ready:string;transport?:'owned-chrome'}){
 const project:Project=await jsonFile(projectFile),origin=new URL(project.sourceUrl).origin,url=new URL(options.path,project.sourceUrl);
 if(!options.path.startsWith('/')||options.path.startsWith('//')||url.origin!==origin||url.hash||sourceUrlMutationReason(url.href))throw Error('Guest probe requires a read-only same-origin public path');
 const report:{status:'normal'|'challenge'|'unsupported';stage:string;origin:string;requestedPath:string;httpStatus:number|null;ready:boolean;copiedClearanceCookieNames:string[];storageKeyPresence:null|{origin:string;requestedKeys:{key:string;present:boolean}[];valuesRead:false;timestamp:string};ownedContextCreated:boolean;ownedContextClosed:boolean;cartActionsPerformed:false;cookieValuesReturned:false;timestamp:string;reason?:string}={status:'unsupported',stage:'read-clearance-cookies',origin,requestedPath:options.path,httpStatus:null,ready:false,copiedClearanceCookieNames:[],storageKeyPresence:null,ownedContextCreated:false,ownedContextClosed:false,cartActionsPerformed:false,cookieValuesReturned:false,timestamp:new Date().toISOString()};
 let lease:SourceContextLease|undefined;
 try{
  report.stage='create-owned-context';lease=options.transport==='owned-chrome'?await ownedChromeProbeLease(project):await createIsolatedGuestContext(project);report.ownedContextCreated=true;report.copiedClearanceCookieNames=(lease as any).copiedClearanceCookieNames||lease.sourceContextProof?.copiedClearanceCookieNames||[];
  report.stage='navigate-public-page';const page=await lease.newPage(),response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});report.httpStatus=response?.status()??null;
  if(!response){report.reason='no-navigation-response';return report;}
  async function rejection(){const identity=await page.evaluate(()=>({title:document.title,visibleText:document.body?.innerText||''})),cfMitigated=await response?.headerValue('cf-mitigated');return renderedEvidenceRejection({...identity,cfMitigated})||renderedEvidenceRejection({...identity,cfMitigated,status:report.httpStatus??undefined});}
  let rejected=await rejection();if(rejected){report.status=rejected==='anti-bot challenge page'?'challenge':'unsupported';report.reason=rejected;return report;}
  report.stage='ready-check';try{await page.locator(options.ready).waitFor({state:'visible',timeout:15000});}catch{const rejected=await rejection();report.status=rejected==='anti-bot challenge page'?'challenge':'unsupported';report.reason=rejected||'ready-not-observed';return report;}report.ready=true;
  rejected=await rejection();if(rejected){report.status=rejected==='anti-bot challenge page'?'challenge':'unsupported';report.reason=rejected;return report;}
  const final=new URL(page.url());if(final.origin!==origin||final.pathname+final.search!==url.pathname+url.search){report.reason='unexpected-final-route';return report;}
  report.stage='storage-key-presence';report.storageKeyPresence=await page.evaluate(origin=>{if(location.origin!==origin)throw Error('Guest presence origin mismatch');let present=false;for(let index=0;index<localStorage.length;index++)if(localStorage.key(index)==='mall-auth-token')present=true;return{origin:location.origin,requestedKeys:[{key:'mall-auth-token',present}],valuesRead:false as const,timestamp:new Date().toISOString()};},origin);
  if(options.transport==='owned-chrome'){
   const measure=()=>page.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,bodyWidth:document.body.getBoundingClientRect().width,bodyHeight:document.body.getBoundingClientRect().height,scrollX,scrollY,locale:navigator.language,timezoneId:Intl.DateTimeFormat().resolvedOptions().timeZone}));
   const before=await measure();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const after=await measure();
   Object.assign(report,{transport:'owned-chrome',ownedBrowserClosed:false,applicationCookiesCopied:false,storageStateImported:false,apiGetOnly:true,webSocketsBlocked:true,viewportObservations:[before,after],viewportStable:before.innerWidth===768&&before.innerHeight===1024&&after.innerWidth===768&&after.innerHeight===1024});
  }
  report.status='normal';report.stage='complete';return report;
 }catch(error){const failure=(error as any)?.sourceContextFailure;if(failure){report.stage=failure.stage;report.ownedContextCreated=failure.ownedContextCreated;report.ownedContextClosed=failure.ownedContextClosed;}else if(!lease&&String(error).includes('registered existing source browser'))throw error;report.status='unsupported';report.reason='probe-operation-unavailable';return report;}
 finally{
  if(lease)try{await lease.close();report.ownedContextClosed=true;if(options.transport==='owned-chrome')Object.assign(report,{ownedBrowserClosed:true});}catch{report.status='unsupported';report.reason='owned-context-close-failed';}
 }
}

export async function observeBrowserContext(page:Page){return page.evaluate(()=>({locale:navigator.language,languages:[...navigator.languages],timezoneId:Intl.DateTimeFormat().resolvedOptions().timeZone}));}

/** Same URL mutation denylist as formal capture, before any refresh exception. */
export async function guardSourceSession(context:Pick<BrowserContext,'route'>|Pick<Page,'route'>,project:Project,allowRefresh=false){
  const origin=new URL(project.sourceUrl).origin;
  await context.route('**/*',route=>{
    const request=route.request();
    if(sourceUrlMutationReason(request.url())||request.isNavigationRequest()&&new URL(request.url()).origin!==origin)return route.abort('blockedbyclient');
    const refresh=allowRefresh&&!request.isNavigationRequest()&&['fetch','xhr'].includes(request.resourceType())&&new URL(request.frame().url()).origin===origin&&isSourceSessionRefresh(request.method(),request.url(),project);
    return sourceSafeMethod(request.method())||refresh?route.continue():route.abort('blockedbyclient');
  });
}
export type SourceStorage = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Inspect expiry privately in memory; never export the stored credentials. */
export function sourceStorageCurrent(project:Project,state:SourceStorage|undefined,now=Date.now()){
 const session=project.workflow?.sourceSession;
 if(usesExistingChrome(project)||!session?.enabled||!session.sessionStorageKey)return true;
 try{
  const origin=state?.origins.find(o=>o.origin===new URL(project.sourceUrl).origin);
  const value=origin?.localStorage.find(row=>row.name===session.sessionStorageKey)?.value;
  const token=JSON.parse(value||'null');
  return typeof token?.access_token==='string'&&!!token.access_token&&typeof token.refresh_token==='string'&&!!token.refresh_token&&typeof token.expires_at==='number'&&token.expires_at*1000>now+60000;
 }catch{return false;}
}

/** Non-secret policy identity; contains neither tokens nor user/customer identifiers. */
export function sourceSessionPolicy(project:Project){
  const session=project.workflow?.sourceSession;
  if(usesExistingChrome(project))return digest(JSON.stringify({version:1,mode:'existing-chrome',sourceUrl:project.sourceUrl,key:session?.sessionStorageKey||null,ready:session?.readySelector||null,blocked:session?.blockedSelectors||[]}));
  if(!session?.enabled||!session.sessionStorageKey)return null;
  return digest(JSON.stringify({version:1,minValidityMs:60000,sourceUrl:project.sourceUrl,key:session.sessionStorageKey,refreshOrigins:[...(session.refreshOrigins||[])].sort(),ready:session.readySelector||null,blocked:session.blockedSelectors||[],preferences:session.preferenceDismissals||[]}));
}

/** Only the source site's normal SDK may renew an existing manually established session. */
export function isSourceSessionRefresh(method:string,url:string,project:Project){
  const allowed=project.workflow?.sourceSession?.refreshOrigins||[];
  if(!project.workflow?.sourceSession?.enabled||method!=='POST'||allowed.length>5)return false;
  const u=new URL(url);
  return u.protocol==='https:'&&!u.username&&!u.password&&allowed.some(origin=>{try{return new URL(origin).origin===origin&&origin===u.origin;}catch{return false;}})&&u.pathname==='/auth/v1/token'&&u.searchParams.getAll('grant_type').length===1&&u.searchParams.get('grant_type')==='refresh_token'&&[...u.searchParams.keys()].every(k=>k==='grant_type');
}

export async function assertSourceUnblocked(page:Page,project:Project,requireCurrentSession=true){
  for(const selector of project.workflow?.sourceSession?.blockedSelectors||[])
    if(await page.locator(selector).first().isVisible())throw Error('Source login or personal verification UI is visible; the human must complete it before collection.');
  const key=project.workflow?.sourceSession?.enabled&&project.workflow.sourceSession.sessionStorageKey;
  if(requireCurrentSession&&key){
    const current=await page.evaluate(key=>{try{const session=JSON.parse(localStorage.getItem(key)||'null');return typeof session?.access_token==='string'&&session.access_token.length>0&&typeof session.refresh_token==='string'&&session.refresh_token.length>0&&typeof session.expires_at==='number'&&session.expires_at*1000>Date.now()+60000;}catch{return false;}},key);
    if(!current)throw Error('Source session expired or incomplete before collection; renew it in the dedicated source profile before recapturing.');
  }
}

/** Dedicated, local browser profile; never open/copy the user's everyday Chrome profile. */
export function sourceProfile(project: Project, profileRoot = join(homedir(), ".codex", "browser-profiles", "site2shop")) {
  const url = new URL(project.sourceUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("Source session requires an HTTP(S) origin without embedded credentials");
  return { origin: url.origin, directory: join(resolve(profileRoot), `source-${digest(url.origin).slice(0, 24)}`) };
}

async function verifyProfile(project: Project, profileRoot?: string) {
  const profile = sourceProfile(project, profileRoot);
  const marker = await jsonFile(join(profile.directory, "source-session.json")).catch(() => null);
  if (!marker || marker.origin !== profile.origin) throw Error("Source login session missing or belongs to another origin. Run shopyy-workflow source-session --project <file> --open, sign in yourself, then close its browser window.");
  return profile;
}

/** Credentials stay in memory/the local browser profile, never in evidence or project files. */
export async function sourceStorage(project: Project, profileRoot?: string): Promise<SourceStorage | undefined> {
  if(usesExistingChrome(project))return undefined;
  if (!project.workflow?.sourceSession?.enabled) return undefined;
  const profile = await verifyProfile(project, profileRoot);
  const context = await chromium.launchPersistentContext(profile.directory, { ...ownedHeadlessOptions(project), serviceWorkers: "block" });
  try {
    await guardSourceSession(context,project,true);
    // Playwright only exports localStorage/IndexedDB for origins visited in this context.
    const page = context.pages()[0] || await context.newPage();
    const response=await page.goto(project.sourceUrl, { ...sourceNavigationOptions(project), timeout: 30000 });
    await waitSourceNavigation(page,project,15000);
    if (project.workflow?.sourceSession?.readySelector) await page.locator(project.workflow.sourceSession.readySelector).first().waitFor({state:"visible",timeout:15000});
    await assertRenderedEvidencePage(page,response,'source');
    await assertSourceUnblocked(page,project,false);
    const expected=new URL(project.sourceUrl),actual=new URL(page.url());
    if(actual.origin!==expected.origin||actual.pathname+actual.search!==expected.pathname+expected.search)throw Error('Source session left its configured page; manual sign-in is required');
    const storageKey=project.workflow?.sourceSession?.sessionStorageKey;
    if(storageKey){
      if(!/^sb-[a-z0-9_-]+-auth-token$/.test(storageKey))throw Error('Unsupported source session readiness key');
      await page.waitForFunction(key=>{
        try{const session=JSON.parse(localStorage.getItem(key)||'null');return typeof session?.access_token==='string'&&session.access_token.length>0&&typeof session.refresh_token==='string'&&session.refresh_token.length>0&&typeof session.expires_at==='number'&&session.expires_at*1000>Date.now()+60000;}catch{return false;}
      },storageKey,{timeout:20000}).catch(()=>{throw Error('Source session did not renew; reopen the dedicated browser and sign in manually. No session values were exported to project files.');});
      await assertSourceUnblocked(page,project);
    }
    const state=await context.storageState({ indexedDB: true }),host=new URL(profile.origin).hostname;
    return {cookies:state.cookies.filter(c=>{const domain=c.domain.replace(/^\./,'');return host===domain||host.endsWith('.'+domain)}),origins:state.origins.filter(o=>o.origin===profile.origin)};
  }
  finally { await context.close(); }
}

export async function openSourceSession(projectFile: string) {
  const project: Project = await jsonFile(projectFile);
  if(usesExistingChrome(project))return checkSourceSession(projectFile);
  const profile = sourceProfile(project);
  // Profiles must stay outside the project so build input/evidence trees cannot include credentials.
  const projectRoot = dirname(resolve(projectFile));
  if (profile.directory === projectRoot || profile.directory.startsWith(projectRoot + "/") || profile.directory.startsWith(projectRoot + "\\")) throw Error("Source browser profile must be outside the project");
  await mkdir(profile.directory, { recursive: true });
  const markerFile = join(profile.directory, "source-session.json");
  const old = await readFile(markerFile, "utf8").then(JSON.parse).catch(() => null);
  if (old && old.origin !== profile.origin) throw Error("Source profile origin mismatch");
  await writeJson(markerFile, { schemaVersion: 1, origin: profile.origin, kind: "local-manual-login-profile" });
  const context = await chromium.launchPersistentContext(profile.directory, {
    headless: false, viewport: { width: 1440, height: 900 }, locale: "en-US", serviceWorkers: "block"
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(project.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log(JSON.stringify({ kind: "manual-login-required", sourceOrigin: profile.origin, instruction: "Sign in and complete any declarations yourself in the project browser. Close that browser window when finished. No credentials are exported to project/evidence files." }));
    await context.waitForEvent("close", { timeout: 0 });
  } finally { await context.close().catch(() => undefined); }
  return { sourceOrigin: profile.origin, browserClosed: true, sessionValidation: "required" };
}

/** Read-only real-page check; an existing profile is not proof that login is still valid. */
export async function checkSourceSession(projectFile: string,options?:{storageKeyPresence:string[]}|{isolatedGuestProbe:{path:string;ready:string;transport?:'owned-chrome'}}) {
  if(options!==undefined){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).length!==1)throw Error('Unsupported source session check option');
    if('storageKeyPresence'in options&&Object.hasOwn(options,'storageKeyPresence')&&Array.isArray(options.storageKeyPresence)&&options.storageKeyPresence.length===1&&options.storageKeyPresence[0]==='mall-auth-token')return inspectSourceStorageKeyPresence(projectFile,options.storageKeyPresence);
    if('isolatedGuestProbe'in options&&Object.hasOwn(options,'isolatedGuestProbe')){const probe=options.isolatedGuestProbe;if(probe&&typeof probe==='object'&&!Array.isArray(probe)&&Object.keys(probe).every(key=>['path','ready','transport'].includes(key))&&Object.hasOwn(probe,'path')&&Object.hasOwn(probe,'ready')&&typeof probe.path==='string'&&probe.path.length>0&&typeof probe.ready==='string'&&probe.ready.trim()&&(!Object.hasOwn(probe,'transport')||probe.transport==='owned-chrome'&&probe.path==='/catalog/'&&probe.ready==='main h1'))return inspectIsolatedGuestProbe(projectFile,probe);}
    throw Error('Unsupported source session check option');
  }
  const project: Project = await jsonFile(projectFile), storageState = await sourceStorage(project);
  const browser = await openSourceBrowser(project);
  try {
    const lease = await browser.createContext({ storageState, viewport: { width: 1440, height: 1000 }, locale: "en-US", serviceWorkers: "block" });
    const page = await lease.newPage();
    await guardSourceSession(page,project);
    const response = await page.goto(project.sourceUrl, { ...sourceNavigationOptions(project), timeout: 30000 });
    await waitSourceNavigation(page,project,15000);
    if (project.workflow?.sourceSession?.readySelector) await page.locator(project.workflow.sourceSession.readySelector).first().waitFor({ state: "visible", timeout: 15000 });
    await assertSourceUnblocked(page,project);
    await assertRenderedEvidencePage(page, response, "source");
    const expected = new URL(project.sourceUrl), actual = new URL(page.url());
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) throw Error("Source session redirected away from its configured route; manual sign-in is required");
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return { passed: true, sourceOrigin: expected.origin, path: actual.pathname, status: response?.status(), viewport, browserContext:await observeBrowserContext(page),scrollbarEnvironment:await observeScrollbarEnvironment(page,project,!browser.attached), connectionMode:browser.attached?'existing-chrome':'isolated', authenticatedProfileEnabled: !!project.workflow?.sourceSession?.enabled };
  } finally { await browser.close(); }
}

/** Explicitly configured visible dismissal controls only; no identity declarations or form submissions. */
export async function prepareSourcePreferences(projectFile:string){
  const project:Project=await jsonFile(projectFile);
  const profile=usesExistingChrome(project)?{origin:new URL(project.sourceUrl).origin}:await verifyProfile(project);
  const actions=project.workflow?.sourceSession?.preferenceDismissals||[];
  if(!actions.length||actions.length>10)throw Error('Configure a bounded sourceSession.preferenceDismissals list first');
  const attached=usesExistingChrome(project)?await openSourceBrowser(project):null;
  const lease=attached?await attached.createContext({viewport:{width:1440,height:1000}}):null;
  const context=lease?.context||await chromium.launchPersistentContext((profile as {directory:string}).directory,{...ownedHeadlessOptions(project),viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const rows:any[]=[];
  try{
    const page=lease?await lease.newPage():context.pages()[0]||await context.newPage();
    await guardSourceSession(lease?page:context,project);
    await page.goto(project.sourceUrl,{waitUntil:'load',timeout:30000});
    if(project.workflow?.sourceSession?.readySelector)await page.locator(project.workflow.sourceSession.readySelector).first().waitFor({state:'visible',timeout:15000});
    await assertSourceUnblocked(page,project);
    for(const action of actions){
      if(!['click','press'].includes(action.op)||action.op==='press'&&action.value!=='Enter')throw Error('Only button click or Enter dismissal is supported');
      const node=page.locator(action.selector);
      const visible=await page.waitForFunction(selector=>{
        const n=document.querySelector(selector);if(!n)return false;
        for(let p:Element|null=n;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}
        const r=n.getBoundingClientRect();return r.width>0&&r.height>0;
      },action.selector,{timeout:action.waitMs||15000}).then(()=>true).catch(()=>false);
      if(!visible){rows.push({selector:action.selector,status:'not-shown',note:'No dismissal action performed'});continue;}
      if(await node.count()!==1||await node.evaluate(n=>n.tagName)!=='BUTTON')throw Error('Dismissal must name exactly one observed button');
      const startedAt=new Date().toISOString();
      if(action.op==='press')await node.press('Enter');else await node.click({timeout:10000});
      rows.push({selector:action.selector,op:action.op,status:'performed',startedAt,endedAt:new Date().toISOString()});
    }
    const record={kind:'source-browser-preferences-not-acceptance',sourceOrigin:profile.origin,rows,capturedAt:new Date().toISOString(),note:'Local visible dismissal controls only; no credentials or storage contents recorded. Verify their effects in fresh source captures.'};
    await writeJson(join(dirname(resolve(projectFile)),'verification/recon-current/source-preferences.json'),record);
    return record;
  }finally{if(attached)await attached.close();else await context.close();}
}
