import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { mkdir, writeFile, realpath, readFile, stat } from 'node:fs/promises';
import { contained, digest, jsonFile, readRef, writeJson, safeBrowserError } from './artifacts.js';
import type { Inventory, Ref } from './contracts.js';
import {sourceSessionPolicy} from './source-session.js';
import {sourceReadQueryPolicy} from './source-read-queries.js';
import {sourcePrivacyPolicy} from './source-privacy.js';
import {publicAssetClient} from './public-http.js';
import {sourceUrlMutationReason} from './source-safety-policy.js';

type PublicJsonOptions={publicJsonPlanFile:string;outputDirectory:string};
type VisualAssetResult={directory:string;downloaded:number;failed:number;passed:boolean};
type PublicJsonResult=VisualAssetResult&{kind:'source-public-data-not-acceptance';role:'public-content-data';formalCaptureEvidence:false;reused:number;pending:number};
const publicJsonRole={kind:'source-public-data-not-acceptance',role:'public-content-data',formalCaptureEvidence:false} as const;

/** Explicit public locale/warehouse query scope, backed by an actual resource observation. */
async function reviewedPublicQuery(root:string,plan:any,origin:string,prefix:string){
  const values=plan.publicQueryParameters;
  if(values===undefined){if(plan.publicQueryObservation!==undefined)throw Error('Public JSON query observation requires explicit query parameters');return null;}
  const certificateLibrary=prefix==='/api/products/coa/';
  if(plan.publicQueryMode!==undefined&&!(plan.publicQueryMode==='locale-only'&&prefix==='/api/products/slug/'))throw Error('Public JSON query mode must be an explicitly observed product locale-only scope');
  const localeOnly=certificateLibrary||plan.publicQueryMode==='locale-only';
  const queryKeys=localeOnly?['locale']:['locale','warehouseCode'];
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==queryKeys.length||!queryKeys.every(key=>Object.hasOwn(values,key))||
    typeof values.locale!=='string'||values.locale.length>35||!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(values.locale)||
    !localeOnly&&(typeof values.warehouseCode!=='string'||!/^[A-Z][A-Z0-9_-]{1,15}$/.test(values.warehouseCode)))throw Error('Public JSON query parameters allow only a safe locale and warehouseCode, or an explicitly observed locale-only scope');
  if(!plan.publicQueryObservation)throw Error('Reviewed public query observation Ref required');
  const observation=JSON.parse((await readRef(root,plan.publicQueryObservation)).toString());
  const matches=(url:URL)=>{
    const keys=[...url.searchParams.keys()];
    return keys.length===queryKeys.length&&new Set(keys).size===queryKeys.length&&keys.every(key=>queryKeys.includes(key))&&
      queryKeys.every(key=>url.searchParams.getAll(key).length===1&&url.searchParams.get(key)===values[key])&&(!certificateLibrary||url.pathname===prefix+'library');
  };
  if(observation.kind!=='planning-public-source-resources-not-acceptance'||observation.sourceOrigin!==origin||!Array.isArray(observation.rows)||!Array.isArray(observation.paths))throw Error('Public query observation identity/kind mismatch');
  const evidenced=observation.rows.some((row:any)=>{
    let page:URL;try{page=new URL(row.sourcePage);}catch{return false;}
    if(page.origin!==origin||page.username||page.password||/^\/api(?:\/|$)/i.test(page.pathname)||!Array.isArray(row.resources))return false;
    return row.resources.some((resource:any)=>{
      let url:URL;try{url=new URL(resource.resourceUrl);}catch{return false;}
      const slug=url.pathname.startsWith(prefix)?url.pathname.slice(prefix.length):'';
      return url.origin===origin&&!url.username&&!url.password&&!url.hash&&!String(resource.resourceUrl).includes('#')&&
        /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug)&&observation.paths.includes(url.pathname)&&!sourceUrlMutationReason(url.href)&&matches(url);
    });
  });
  if(!evidenced)throw Error('Public query locale/warehouse values are not evidenced by the reviewed resource observation');
  return{values:localeOnly?{locale:values.locale}:{locale:values.locale,warehouseCode:values.warehouseCode},observation:plan.publicQueryObservation,matches};
}

// This data channel is separate from rendered source evidence and visual-asset manifests.
async function collectPublicJson(root:string,project:any,options:PublicJsonOptions):Promise<PublicJsonResult>{
  if(project.workflow?.publicAssetTransport!=='existing-chrome-session')throw Error('Public JSON reads require the registered existing-Chrome session transport');
  if(!options||typeof options.publicJsonPlanFile!=='string'||typeof options.outputDirectory!=='string')throw Error('Public JSON plan and separate output directory required');
  const planPath=await contained(root,options.publicJsonPlanFile),planBytes=await readFile(planPath),plan=JSON.parse(planBytes.toString()),planSha256=digest(planBytes);
  const source=new URL(project.sourceUrl),identity=new URL(plan.sourceUrl);
  if(plan.schemaVersion!==1||plan.kind!=='source-public-data-request-plan'||identity.href!==source.href||source.username||source.password||!['http:','https:'].includes(source.protocol))throw Error('Invalid public JSON source request plan');
  const prefix=plan.allowedPathPrefix;
  const privateSegments=new Set(['auth','authentication','account','accounts','cart','admin','customer','customers','checkout','order','orders','payment','payments','private','session','sessions','token','tokens','user','users','internal']);
  if(typeof prefix!=='string'||!/^\/api\/(?:[a-z0-9_-]+\/)+$/.test(prefix)||prefix.split('/').some((s:string)=>privateSegments.has(s)))throw Error('Public JSON prefix must declare a public /api/ GET path');
  if(!Array.isArray(plan.provenance)||!plan.provenance.some((r:any)=>r.kind==='public-client-script')||!plan.provenance.some((r:any)=>r.kind==='published-catalog'))throw Error('Public JSON plan requires hashed public client-script and published-catalog provenance');
  for(const ref of plan.provenance)await readRef(root,ref);
  if(!Array.isArray(plan.requests)||!plan.requests.length)throw Error('Public JSON requests required');
  const publicQuery=await reviewedPublicQuery(root,plan,source.origin,prefix);
  const queryIdentity=publicQuery?{publicQueryParameters:publicQuery.values,publicQueryObservation:publicQuery.observation}:{};
  const ids=new Set<string>(),urls=new Set<string>();
  for(const request of plan.requests){
    if(!request||typeof request.id!=='string'||!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(request.id)||typeof request.url!=='string')throw Error('Public JSON request requires a safe slug id');
    const url=new URL(request.url);
    if(url.origin!==source.origin||url.username||url.password||url.hash||request.url.includes('#')||url.pathname!==prefix+request.id||sourceUrlMutationReason(url.href)||ids.has(request.id)||urls.has(url.href))throw Error('Public JSON URL must be unique, exact-prefix, same-origin, credential/hash-free and match its slug id');
    if(publicQuery?!publicQuery.matches(url):url.search||request.url.includes('?'))throw Error('Public JSON URL query is not within its explicitly reviewed locale/warehouse scope');
    ids.add(request.id);urls.add(url.href);
  }
  if(isAbsolute(options.outputDirectory)||options.outputDirectory.split(/[\\/]/).includes('..'))throw Error('Public JSON output must stay inside its project');
  const candidate=resolve(root,options.outputDirectory),relativeOutput=relative(root,candidate);
  if(!relativeOutput||relativeOutput.startsWith('..')||isAbsolute(relativeOutput))throw Error('Public JSON output must be a separate project subdirectory');
  if(project.assetsDirectory){const visual=resolve(root,project.assetsDirectory,'source-current'),fromVisual=relative(visual,candidate);if(!fromVisual||!fromVisual.startsWith('..')&&!isAbsolute(fromVisual))throw Error('Public JSON cannot share visual asset output');}
  let ancestor=candidate;while(!await stat(ancestor).catch(()=>null))ancestor=dirname(ancestor);
  const ancestorRelative=relative(root,await realpath(ancestor));if(ancestorRelative.startsWith('..')||isAbsolute(ancestorRelative))throw Error('Public JSON output escapes through a symlink');
  await mkdir(candidate,{recursive:true});const directory=await contained(root,options.outputDirectory),manifestFile=join(directory,'manifest.json');
  const prior=await jsonFile(manifestFile).catch(()=>null);
  if(prior&&prior.kind!==publicJsonRole.kind)throw Error('Public JSON output already belongs to a different artifact kind');
  const completed:any[]=[],failures:any[]=[],todo:any[]=[];
  for(const request of plan.requests){
    const previous=prior?.plan?.sha256===planSha256&&prior.sourceUrl===project.sourceUrl?prior.completed?.find((r:any)=>r.id===request.id&&r.sourceUrl===request.url&&r.status==='downloaded'):null;
    const bytes=previous&&previous.file===request.id+'.response.json'?await readFile(join(directory,previous.file)).catch(()=>null):null;
    if(bytes&&digest(bytes)===previous.sha256)completed.push({...previous,reused:true});else todo.push(request);
  }
  const manifest:any={schemaVersion:1,...publicJsonRole,sourceUrl:project.sourceUrl,plan:{path:options.publicJsonPlanFile,sha256:planSha256},provenance:plan.provenance,...queryIdentity,completed,failures,pending:[...todo],stopReason:null,acceptance:'public-data-only; not rendered UI capture, source gate, scope contract or storefront acceptance'};
  const persist=async()=>{manifest.updatedAt=new Date().toISOString();await writeJson(manifestFile,manifest)};
  await persist();
  if(!todo.length)return{...publicJsonRole,directory,downloaded:completed.length,reused:completed.length,failed:0,pending:0,passed:true};
  const {client,transport}=await publicAssetClient(project,todo.map(request=>request.url),{maxResponseBytes:5*1024*1024,readJsonErrorBodies:true});manifest.transport=transport;
  try{
    for(const [index,request]of todo.entries()){
      if(index)await new Promise(resolve=>setTimeout(resolve,1000));
      const record:any={...publicJsonRole,id:request.id,sourceUrl:request.url,provenance:plan.provenance,...queryIdentity,status:'failed'};
      try{
        const response=await client.get(request.url,{timeout:30000,maxRedirects:0});record.httpStatus=response.status();
        if(record.httpStatus===429){record.error='HTTP 429; stopped without retry';failures.push(record);manifest.pending=todo.slice(index);manifest.stopReason='http-429';await persist();break;}
        const type=(response.headers()['content-type']||'').split(';')[0].trim().toLowerCase();
        if(!(type==='application/json'||/^application\/[a-z0-9.+-]+\+json$/.test(type)))throw Error('Public data response must be JSON, never HTML or scripts');
        if(Number(response.headers()['content-length'])>5*1024*1024)throw Error('Public JSON response exceeds 5 MiB budget');
        const bytes=await response.body();if(bytes.length>5*1024*1024)throw Error('Public JSON response exceeds 5 MiB budget');
        record.file=request.id+'.response.json';record.sha256=digest(bytes);record.bytes=bytes.length;record.contentType=type;
        await writeFile(join(directory,record.file),bytes);
        const value=JSON.parse(bytes.toString('utf8'));if(value===null||typeof value!=='object')throw Error('Public JSON response must contain an object or array');
        if(record.httpStatus!==200)throw Error('HTTP '+record.httpStatus);
        if(!Array.isArray(value)&&value.code!==undefined){record.apiCode=value.code;if(Number(value.code)!==200)throw Error('API code '+String(value.code));}
        const product=Array.isArray(value)?null:value.data&&typeof value.data==='object'?value.data:value;
        if(product?.slug!==undefined&&product.slug!==request.id)throw Error('Public JSON product slug does not match its planned request');
        record.status='downloaded';completed.push(record);
      }catch(error){record.error=safeBrowserError(error);failures.push(record);}
      manifest.pending=todo.slice(index+1);await persist();
      console.log(JSON.stringify({kind:'public-json-read-progress',completed:completed.length,failed:failures.length,pending:manifest.pending.length,acceptance:'not-ui-evidence'}));
    }
  }finally{await client.dispose();}
  return{...publicJsonRole,directory,downloaded:completed.length,reused:completed.filter(r=>r.reused).length,failed:failures.length,pending:manifest.pending.length,passed:failures.length===0&&manifest.pending.length===0};
}

/** Copy only observed public visual assets; never source scripts, HTML responses or credentials. */
export function collectSourceAssets(projectFile:string,options:PublicJsonOptions):Promise<PublicJsonResult>;
export function collectSourceAssets(projectFile:string):Promise<VisualAssetResult>;
export async function collectSourceAssets(projectFile:string,options?:PublicJsonOptions):Promise<VisualAssetResult|PublicJsonResult>{
  const root=await realpath(dirname(resolve(projectFile))), project=await jsonFile(projectFile);
  if(options!==undefined)return collectPublicJson(root,project,options);
  const inventory:Inventory=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
  if(new URL(inventory.sourceUrl).origin!==new URL(project.sourceUrl).origin)throw Error('Asset inventory source mismatch');
  const base=await contained(root,project.assetsDirectory), directory=join(base,'source-current');
  if(isAbsolute(relative(root,directory))||relative(root,directory).startsWith('..'))throw Error('Asset directory escapes project');
  const observed=new Map<string,{kind:'image'|'stylesheet'|'video';evidence:Ref[]}>();
  const add=(url:string,kind:'image'|'stylesheet'|'video',evidence:Ref)=>{
    if(typeof url!=='string'||!url.trim())return;
    const u=new URL(url,project.sourceUrl);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return;
    if(u.origin!==new URL(project.sourceUrl).origin)return; // External assets need explicit provider review.
    const old=observed.get(u.href);if(old)old.evidence.push(evidence);else observed.set(u.href,{kind,evidence:[evidence]});
  };
  const addObserved=(data:any,evidence:Ref)=>{
    for(const image of data.images||[])add(image.src,'image',evidence);
    for(const stylesheet of [...(data.stylesheets||[]),...(data.styles||[])])add(typeof stylesheet==='string'?stylesheet:stylesheet?.href,'stylesheet',evidence);
    for(const media of data.media||[]){
      const tag=String(media.tag||media.tagName||'').toUpperCase();
      if(tag==='IMG')add(media.currentSrc||media.src,'image',evidence);
      if(tag==='VIDEO'||tag==='SOURCE'&&/\.(?:mp4|webm)(?:[?#]|$)/i.test(media.src||''))add(media.currentSrc||media.src,'video',evidence);
      if(tag==='VIDEO'&&media.poster)add(media.poster,'image',evidence);
    }
  };
  for(const surface of inventory.coverage.surfaces){
    if(surface.status!=='captured'||!surface.evidence)continue;
    const data=JSON.parse((await readRef(root,surface.evidence)).toString());
    if(data.kind!=='reconnaissance-not-acceptance'||!data.structure)throw Error('Current rendered asset observations required');
    addObserved(data,surface.evidence);
  }
  if(project.workflow?.sourceAssetObservationsFile){
    const refs:Ref[]=await jsonFile(await contained(root,project.workflow.sourceAssetObservationsFile));
    if(!Array.isArray(refs)||refs.length>2000)throw Error('Invalid supplemental asset evidence');
    for(const ref of refs){
      const data=JSON.parse((await readRef(root,ref)).toString()),path=data.requestedPath;
      if(data.kind!=='reconnaissance-not-acceptance'||!path||new URL(data.url).origin!==new URL(project.sourceUrl).origin||!data.structure)throw Error('Supplemental asset requires rendered source DOM evidence');
      const session=sourceSessionPolicy(project);
      if(session&&(data.sourceSessionCurrent!==true||data.sourceSessionPolicySha256!==session))throw Error('Supplemental source session is stale');
      if((data.sourceReadQueryPolicySha256||null)!==sourceReadQueryPolicy(project,path)||(data.sourcePrivacyPolicySha256||null)!==sourcePrivacyPolicy(project,path))throw Error('Supplemental source query/privacy policy changed');
      addObserved(data,ref);
    }
  }
  if(observed.size>1000)throw Error('Observed asset budget exceeded');
  const {client,transport}=await publicAssetClient(project,observed.keys());
  const assets:any[]=[],failures:any[]=[];
  await mkdir(directory,{recursive:true});
  const previous=await jsonFile(join(directory,'manifest.json')).catch(()=>null);
  try {
    const entries=[...observed];
    for(let offset=0;offset<entries.length;offset+=3){
    await Promise.all(entries.slice(offset,offset+3).map(async([url,observation])=>{
      try {
        const contentNamed=/\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:css|png|jpe?g|webp|avif|svg|gif|mp4|webm)$/.test(new URL(url).pathname);
        const prior=previous?.sourceUrl===project.sourceUrl&&(contentNamed||Date.now()-Date.parse(previous.collectedAt)<3600000)?previous.assets?.find((a:any)=>a.url===url):null;
        if(prior&&!prior.networkRefreshFailed&&/^[a-f0-9]{64}\.(?:css|png|jpg|webp|avif|svg|gif|mp4|webm)$/.test(prior.file)){
          const bytes=await readFile(join(directory,prior.file)).catch(()=>null);
          if(bytes&&digest(bytes)===prior.sha256){assets.push({...prior,reused:true,resourceCollectedAt:prior.resourceCollectedAt||previous.collectedAt,cacheBasis:contentNamed?'same-observed-content-named-url-and-verified-local-sha256':'one-hour-cache',evidence:[...new Map(observation.evidence.map(r=>[r.sha256,r])).values()]});return;}
        }
        const response=await client.get(url,{timeout:30000,maxRedirects:0});
        if(!response.ok())throw Error(`HTTP ${response.status()}`);
        const type=response.headers()['content-type']?.split(';')[0].trim();
        const extension=observation.kind==='stylesheet'&&type==='text/css'?'css':observation.kind==='image'?({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/avif':'avif','image/svg+xml':'svg','image/gif':'gif'} as Record<string,string>)[type]:observation.kind==='video'?({'video/mp4':'mp4','video/webm':'webm'} as Record<string,string>)[type]:null;
        if(!extension)throw Error(`Unexpected asset content type: ${type}`);
        const limitMiB=observation.kind==='video'?100:10;
        if(Number(response.headers()['content-length'])>limitMiB*1024*1024)throw Error(`Asset exceeds ${limitMiB} MiB budget`);
        const bytes=await response.body();if(bytes.length>limitMiB*1024*1024)throw Error(`Asset exceeds ${limitMiB} MiB budget`);
        if(/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(bytes.subarray(0,512).toString('utf8')))throw Error('HTML is not a public visual asset');
        const sha256=digest(bytes),file=`${sha256}.${extension}`;
        await writeFile(join(directory,file),bytes);
        assets.push({url,kind:observation.kind,contentType:type,bytes:bytes.length,sha256,file,evidence:[...new Map(observation.evidence.map(r=>[r.sha256,r])).values()]});
      }catch(error){failures.push({url,error:safeBrowserError(error)});}
    }));
    if(offset%30===0||offset+3>=entries.length)console.log(JSON.stringify({kind:'public-asset-copy-progress',completed:Math.min(offset+3,entries.length),total:entries.length,copied:assets.length,failed:failures.length}));
    }
    assets.sort((a,b)=>a.url.localeCompare(b.url));failures.sort((a,b)=>a.url.localeCompare(b.url));
    const manifest={schemaVersion:2,kind:'observed-public-visual-assets',sourceUrl:project.sourceUrl,collectedAt:new Date().toISOString(),transport,assets,failures,acceptance:'requires-page-contract-and-rendered-comparison'};
    await writeJson(join(directory,'manifest.json'),manifest);
    return{directory,downloaded:assets.length,failed:failures.length,passed:failures.length===0};
  }finally{await client.dispose();}
}
