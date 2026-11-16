import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {load} from 'cheerio';
import {canonical,contained,digest,jsonFile,readRef} from './artifacts.js';
import type {Capture,Plan,Ref} from './contracts.js';

export const PRESENTATION_STYLE_FIELDS=['width','height','fontSize','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','gridTemplateColumns','display','flexDirection','overflowX','overflowY'] as const;
type Sheet={index:number;media:string;disabled:boolean;sha256:string;body:Ref};
export function requiresVerifiedStylesheetProof(project:any,contract?:any){return project.workflow?.presentationBindingMode==='verified-source-stylesheet'||contract?.bindings?.some((b:any)=>b.mode==='verified-source-stylesheet')===true;}
export type LoadedStylesheetProof={schemaVersion:1;kind:'loaded-stylesheet-proof';side:'source'|'target';planSha256:string;route:string;viewport:string;state:string;capturedAt:string;finalUrl:string;stylesheets:(Sheet&{url:string;contentType:'text/css'})[];inlineStyles:Sheet[]};

/** Only contemporaneous response bytes / original inline text are evidence. No fetch fallback. */
export async function verifyLoadedStylesheetProof(evidenceRoot:string,capture:Capture):Promise<LoadedStylesheetProof>{
 const ref=(capture as Capture&{stylesheetProof?:Ref}).stylesheetProof;
 if(!ref)throw Error('Actual loaded stylesheet proof required');
 const proof:LoadedStylesheetProof=JSON.parse((await readRef(evidenceRoot,ref)).toString());
 if(proof.schemaVersion!==1||proof.kind!=='loaded-stylesheet-proof'||!Array.isArray(proof.stylesheets)||!Array.isArray(proof.inlineStyles))throw Error('Invalid loaded stylesheet proof');
 for(const key of ['side','planSha256','route','viewport','state','capturedAt','finalUrl'] as const)if(proof[key]!==capture[key])throw Error('Stylesheet proof is not bound to this actual capture: '+key);
 const indices=new Set<number>();
 for(const row of [...proof.stylesheets,...proof.inlineStyles]){
  if(!Number.isInteger(row.index)||row.index<0||indices.has(row.index)||typeof row.media!=='string'||typeof row.disabled!=='boolean'||row.sha256!==row.body?.sha256)throw Error('Invalid stylesheet order/media/disabled/body identity');
  indices.add(row.index);await readRef(evidenceRoot,row.body);
 }
 for(const row of proof.stylesheets){const url=new URL(row.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||row.contentType!=='text/css'||capture.side==='source'&&url.origin!==new URL(capture.finalUrl).origin)throw Error('Stylesheet is not an observed public CSS response');}
 if(!indices.size)throw Error('Loaded stylesheet proof is empty');
 return proof;
}

async function assetMap(projectRoot:string,project:any,ref?:Ref){
 if(project.shopyy?.assetDirectoryLayout!=='tree')throw Error('Stylesheet identity mode requires tree asset delivery');
 const file=project.workflow?.mediaAssetMapFile;
 if(typeof file!=='string')throw Error('Explicit project stylesheet asset map required');
 const bytes=await readFile(await contained(projectRoot,file));
 if(ref&&(ref.path!==file||digest(bytes)!==ref.sha256))throw Error('Stylesheet binding asset map is stale/unrelated');
 return JSON.parse(bytes.toString());
}
async function mappedSheet(projectRoot:string,project:any,map:any,row:LoadedStylesheetProof['stylesheets'][number],evidenceRoot:string){
 const mapped=map[row.url];
 if(!mapped||mapped.contentType?.split(';')[0]!=='text/css'||mapped.sha256!==row.sha256||typeof mapped.relativePath!=='string')throw Error('Source stylesheet has no exact identity asset mapping: '+row.url);
 const relative=mapped.relativePath;if(relative.startsWith('/')||relative.split(/[\\/]/).includes('..'))throw Error('Unsafe stylesheet asset path');
 const raw=await readRef(evidenceRoot,row.body),target=await readFile(await contained(projectRoot,project.assetsDirectory+'/'+relative));
 if(!raw.equals(target)||digest(target)!==mapped.sha256)throw Error('Source stylesheet bytes changed in target asset');
 // Imported / rewritten dependencies need a separately proved transform, not an identity claim.
 if(/@import\b|url\s*\(/i.test(raw.toString()))throw Error('Stylesheet identity mode does not yet support URL/import dependencies');
 return relative;
}
type Generated={preview:Map<string,string>;native:Map<string,string>;routes:Record<string,string>};
type Context={projectRoot:string;project:any;families:Generated};
type HtmlSheet={index:number;href?:string;text?:string;media:string;disabled:boolean};
function htmlSheets(html:string):HtmlSheet[]{const $=load(html);return $('link[rel="stylesheet"],style').toArray().map((node,index)=>({index,...(node.tagName==='style'?{text:$(node).text()}:{href:$(node).attr('href')}),media:$(node).attr('media')||'',disabled:$(node).is('[disabled]')}));}
function assertSubsequence(source:LoadedStylesheetProof,html:string,href:(url:string)=>string,map:any){
 const actual=htmlSheets(html);let cursor=-1;
 for(const row of [...source.stylesheets.map(x=>({...x,href:href(map[x.url].relativePath)})),...source.inlineStyles].sort((a,b)=>a.index-b.index)){
  const index=actual.findIndex((x,i)=>i>cursor&&x.media===row.media&&x.disabled===row.disabled&&('href'in row?x.href===row.href:x.text!==undefined&&digest(x.text)===row.sha256));
  if(index<0)throw Error('Generated HTML does not consume the captured stylesheet/inline sequence');cursor=index;
 }
}
/** Read-only diagnostic / build consumer check. It does not create a binding or contract. */
export async function verifyGeneratedStylesheetConsumption(context:Context,evidenceRoot:string,capture:Capture,route:any,stylesheetAssetMap:Ref){
 const {projectRoot,project,families}=context,proof=await verifyLoadedStylesheetProof(evidenceRoot,capture),map=await assetMap(projectRoot,project,stylesheetAssetMap);
 for(const row of proof.stylesheets)await mappedSheet(projectRoot,project,map,row,evidenceRoot);
 const config=await jsonFile(await contained(projectRoot,project.familiesFile)),page=config.pages.find((p:any)=>p.sourcePath===route.sourcePath||(p.sourceAliases||[]).some((a:any)=>a.sourcePath===route.sourcePath));
 if(!page)throw Error('Stylesheet route has no generated page owner');
 const index=config.pages.indexOf(page),fixture=families.preview.get('pages/'+index+'.html');if(!fixture)throw Error('Generated fixture stylesheet consumer missing');
 const prefix=project.shopyy.assetPathPrefix??project.siteId;
 assertSubsequence(proof,fixture,path=>'/assets/'+prefix+'/'+path,map);
 const family=config.families[page.family],nativeFile=page.nativeFile||family.nativeFile,native=families.native.get(nativeFile);if(!native)throw Error('Generated native stylesheet consumer missing');
 const layout=families.native.get('layout/theme.liquid')||'';
 assertSubsequence(proof,layout+'\n'+native,path=>project.shopyy.templateProfile==='liquid-default-v1'?`{{ '${prefix}/${path}' | ${project.shopyy.assetUrlFilter||'public_asset_abs_dir_url'} }}`:project.shopyy.assetRootExpression+'/'+path,map);
}
/** Build-time verification checks the actual rendered link consumer, not just a map declaration. */
export function createStylesheetBindingVerifier(context:Context){
 const cache=new Map<string,Promise<void>>();
 return async(evidenceRoot:string,capture:Capture,binding:any,route:any)=>{
  if(!binding.stylesheetAssetMap)throw Error('Hashed stylesheet asset map binding required');
  if(canonical(binding.stylesheetProof)!==canonical((capture as any).stylesheetProof))throw Error('Binding stylesheet proof differs from its source capture');
  const key=canonical([binding.sourceCapture,binding.stylesheetAssetMap,route.sourcePath]);
  let verified=cache.get(key);if(!verified){verified=(async()=>{
   await verifyGeneratedStylesheetConsumption(context,evidenceRoot,capture,route,binding.stylesheetAssetMap);
  })();cache.set(key,verified);}await verified;
 };
}

/** Actual paired responses must retain the source CSS bytes and relative cascade order. */
export async function verifyPairedStylesheetProof(projectRoot:string,project:any,plan:Plan,source:Capture,target:Capture,evidenceRoot:string):Promise<void>{
 if(source.side!=='source'||target.side!=='target'||source.route!==target.route||source.viewport!==target.viewport||source.state!==target.state||!plan.routes[source.route])throw Error('Stylesheet pair identity mismatch');
 const a=await verifyLoadedStylesheetProof(evidenceRoot,source),b=await verifyLoadedStylesheetProof(evidenceRoot,target),map=await assetMap(projectRoot,project);
 for(const row of a.stylesheets)await mappedSheet(projectRoot,project,map,row,evidenceRoot);
 const actual=[...b.stylesheets.map(x=>({...x,external:true})),...b.inlineStyles.map(x=>({...x,external:false}))].sort((x,y)=>x.index-y.index);let cursor=-1;
 for(const row of [...a.stylesheets.map(x=>({...x,external:true})),...a.inlineStyles.map(x=>({...x,external:false}))].sort((x,y)=>x.index-y.index)){
  const index=actual.findIndex((x,i)=>i>cursor&&x.external===row.external&&x.sha256===row.sha256&&x.media===row.media&&x.disabled===row.disabled);
  if(index<0)throw Error('Target did not actually load identical source stylesheets/inline CSS in order');
  const selected=actual[index];if('url'in selected&&typeof selected.url==='string'&&new URL(selected.url).origin===new URL(source.finalUrl).origin)throw Error('Target stylesheet must not load directly from the source origin');cursor=index;
 }
}
