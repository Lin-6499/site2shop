import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Plan,Side} from './contracts.js';
import {canonical,contained,digest,readRef} from './artifacts.js';

export function mediaAssetKinds(project:any):('image'|'video')[]{
 const kinds=project.workflow?.mediaAssetKinds;
 if(kinds===undefined)return ['image'];
 if(!Array.isArray(kinds)||!kinds.length||new Set(kinds).size!==kinds.length||kinds.some(kind=>!['image','video'].includes(kind)))throw Error('workflow.mediaAssetKinds must list unique image/video kinds');
 return ['image','video'].filter(kind=>kinds.includes(kind)) as ('image'|'video')[];
}
export function verifyMediaObservationPolicy(project:any,environment:any){
 const kinds=mediaAssetKinds(project);
 if((kinds.includes('video')||environment?.mediaAssetKinds)&&canonical(environment?.mediaAssetKinds)!==canonical(kinds))throw Error('Media observation kinds missing or changed');
}
export type VerifiedMediaAssets={source:Map<string,string>;target:Map<string,string>;mapSha256:string;stage:'preflight'|'online';destinations:Map<string,string>};
export function usesMediaComparison(plan:Plan){return Object.values(plan.routes).some(route=>Object.values(route.components).some(component=>component.rules.some(rule=>rule.compare==='media')));}

/** Only exact preflight asset URLs whose input and served output bytes both match the declared digest. */
export async function loadVerifiedMediaAssets(projectRoot:string,project:any,stage:'preflight'|'online',output?:string):Promise<VerifiedMediaAssets>{
 const kinds=mediaAssetKinds(project);
 const mapFile=project.workflow?.mediaAssetMapFile;
 if(typeof mapFile!=='string'||!mapFile)throw Error('Media comparison requires workflow.mediaAssetMapFile');
 const bytes=await readFile(await contained(projectRoot,mapFile)),mapping=JSON.parse(bytes.toString());
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw Error('Media asset map must contain exact source URL records');
 const prefix=project.shopyy?.assetPathPrefix??project.siteId;
 if(typeof prefix!=='string'||!/^[-\w]+(?:\/[-\w]+)*$/.test(prefix))throw Error('Media comparison requires the renderer asset path prefix');
 const origin=stage==='preflight'?new URL(project.workflow?.localOrigin):null;if(origin&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw Error('Media comparison preflight origin must be local');
 const online=stage==='online'?await verifiedOnlineMediaReadback(projectRoot,project):null;
 const assetRoot=await contained(projectRoot,project.assetsDirectory),outputRoot=resolve(output||resolve(projectRoot,project.outputDirectory));
 const source=new Map<string,string>(),target=new Map<string,string>(),destinations=new Map<string,string>();
 for(const [url,entry]of Object.entries<any>(mapping)){
  if(!kinds.some(kind=>(entry?.contentType||'').toLowerCase().startsWith(kind+'/')))continue;
  const parsed=new URL(url);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.href!==url||typeof entry.relativePath!=='string'||/[?#\\\x00-\x20]/.test(entry.relativePath)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid media asset map record: '+url);
  const input=await readFile(await contained(assetRoot,entry.relativePath));
  if(digest(input)!==entry.sha256)throw Error('Media input content hash differs: '+entry.relativePath);
  const relative=project.shopyy?.assetDirectoryLayout==='tree'?entry.relativePath:'images/'+entry.relativePath;
  let targetUrl:string;
  if(online){const record=online.entries.get(entry.relativePath);if(!record||record.sha256!==entry.sha256||record.contentType!==mime(entry.contentType))throw Error('Media comparison needs target readback mapping for '+entry.relativePath);targetUrl=record.url;}else{
   const previewCopy='preview/assets/'+prefix+'/'+relative;
   const served=await readFile(await contained(outputRoot,await stat(join(outputRoot,previewCopy)).then(()=>previewCopy,()=> 'theme/assets/'+prefix+'/'+relative)));
   if(digest(served)!==entry.sha256)throw Error('Media target content hash differs: '+relative);
   targetUrl=new URL('/assets/'+prefix+'/'+relative,origin!).href;
  }
  if(stage==='online'&&Object.keys(mapping).some(sourceUrl=>new URL(sourceUrl).origin===new URL(targetUrl).origin))throw Error('Online media cannot fall back to a source asset origin');
  if(target.has(targetUrl)&&target.get(targetUrl)!==entry.sha256)throw Error('Conflicting media asset mapping: '+targetUrl);
  source.set(url,entry.sha256);target.set(targetUrl,entry.sha256);destinations.set(url,targetUrl);
 }
 return{source,target,destinations,stage,mapSha256:digest(bytes)};
}

/** Raw captures remain unchanged; only explicit media rules compare these derived identities. */
export function compareMediaImages(source:unknown,target:unknown,sourceUrl:string,targetUrl:string,assets?:VerifiedMediaAssets){
 if(!assets)throw Error('Media comparison requires a content-verified asset map');
 const identity=(value:unknown,side:Side,base:string)=>{
  if(!Array.isArray(value))throw Error('Media images observation must be an array');
  return value.map(image=>{
   if(!image||typeof image!=='object'||typeof image.src!=='string')throw Error('Media image URI missing');
   if(image.kind==='video'&&image.src===''&&image.loaded===false){const {src,...fields}=image;return{...fields,contentSha256:null};}
   const url=new URL(image.src,base).href,hash=assets[side].get(url);
   if(!hash)throw Error('Unmapped '+side+' media URI: '+url);
   const {src,...fields}=image;return{...fields,contentSha256:hash};
  });
 };
 return canonical(identity(source,'source',sourceUrl))===canonical(identity(target,'target',targetUrl));
}

const mime=(value:string)=>String(value||'').split(';')[0].trim().toLowerCase();
const publicUrl=(value:string)=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.href!==value)throw Error('Invalid exact media URL');return value;};
export async function verifiedOnlineMediaReadback(root:string,project:any){
 const file=project.workflow?.mediaAssetReadbackFile,store=String(project.workflow?.mediaAssetStoreId||'');
 if(typeof file!=='string'||!file||!/^\d+$/.test(store))throw Error('Media comparison needs target readback mapping and explicit mediaAssetStoreId');
 const manifest=JSON.parse(await readFile(await contained(root,file),'utf8'));
 if(manifest.schemaVersion!==1||String(manifest.storeId)!==store||!Array.isArray(manifest.entries))throw Error('Invalid media readback manifest/store');
 const entries=new Map<string,{url:string;sha256:string;contentType:string;delivery:'merchant-media'|'skin-asset'}>(),urls=new Set<string>(),inputs=[file];
 for(const row of manifest.entries){
  if(typeof row.relativePath!=='string'||!row.relativePath||/[?#\\\x00-\x20]/.test(row.relativePath)||String(row.storeId)!==store||!/^[a-f0-9]{64}$/.test(row.sourceSha256)||entries.has(row.relativePath))throw Error('Invalid/duplicate media readback entry');
  await contained(await contained(root,project.assetsDirectory),row.relativePath);
  const readback=JSON.parse((await readRef(root,row.readback)).toString()),delivery=row.delivery??'merchant-media';let url:string;
  if(delivery==='skin-asset'){
   const skin=String(project.workflow?.mediaAssetSkinId||''),deployment=JSON.parse((await readRef(root,row.deploymentEvidence)).toString());
   if(!/^\d+$/.test(skin)||String(deployment.store)!==store||String(deployment.skinId)!==skin||deployment.role!=='draft'||!/^[a-f0-9]{64}$/.test(deployment.buildId))throw Error('Skin media requires the actual expected draft/store deployment');
   await readRef(root,deployment.readback);inputs.push(row.deploymentEvidence.path,deployment.readback.path);url=publicUrl(readback.url);
  }else if(delivery==='merchant-media'){
   const upload=JSON.parse((await readRef(root,row.uploadEvidence)).toString());url=publicUrl(upload.params?.url);
   if(String(upload.storeId)!==store||upload.relativePath!==row.relativePath||upload.sourceSha256!==row.sourceSha256)throw Error('Media upload/readback identity differs');inputs.push(row.uploadEvidence.path);
  }else throw Error('Unknown media delivery');
  if(readback.url!==url||readback.status!==200||readback.sha256!==row.sourceSha256||!mediaAssetKinds(project).some(kind=>mime(readback.contentType).startsWith(kind+'/'))||urls.has(url))throw Error('Media upload/readback identity differs');
  if(digest(await readRef(root,readback.bytes))!==row.sourceSha256)throw Error('Media readback bytes differ');
  urls.add(url);entries.set(row.relativePath,{url,sha256:row.sourceSha256,contentType:mime(readback.contentType),delivery});inputs.push(row.readback.path,readback.bytes.path);
 }
 return {entries,inputFiles:[...new Set(inputs)]};
}
export function mediaNavigationDestination(mapping:any,assets?:VerifiedMediaAssets){
 const media=mapping?.media;if(!assets||mapping?.disposition!=='mapped-media'||!media||typeof media.sourceUrl!=='string'||!/^[a-f0-9]{64}$/.test(media.sha256)||assets?.source.get(media.sourceUrl)!==media.sha256)throw Error('Mapped media requires verified source content identity');
 const url=assets.destinations.get(media.sourceUrl);if(!url||assets.target.get(url)!==media.sha256)throw Error('Mapped media target readback missing');return url;
}


export async function merchantMediaDelivery(root:string,project:any){
 const declared=project.workflow?.merchantMediaFiles??[];if(!Array.isArray(declared)||new Set(declared.map((p:any)=>String(p).toLowerCase())).size!==declared.length)throw Error('merchantMediaFiles must list unique relative asset paths');
 const entries=new Map<string,{relativePath:string;sha256:string;targetUrl?:string;binding:string}>(),inputFiles:string[]=[];
 if(!declared.length)return{entries,inputFiles};
 if(project.shopyy?.templateProfile!=='liquid-default-v1')throw Error('Merchant media delivery requires the Liquid profile');
 const mapFile=project.workflow?.mediaAssetMapFile;if(typeof mapFile!=='string')throw Error('Merchant media requires mediaAssetMapFile');const map=JSON.parse(await readFile(await contained(root,mapFile),'utf8'));inputFiles.push(mapFile);
 const readback=project.workflow?.mediaAssetReadbackFile?await verifiedOnlineMediaReadback(root,project):null;if(readback)inputFiles.push(...readback.inputFiles);
 for(const relativePath of declared){
  if(typeof relativePath!=='string'||!relativePath||/[?#\\\x00-\x20]/.test(relativePath))throw Error('Invalid merchant media path');
  const records=Object.entries<any>(map).filter(([,row])=>row.relativePath===relativePath);if(!records.length||records.some(([,r])=>r.sha256!==records[0][1].sha256||!mediaAssetKinds(project).some(kind=>mime(r.contentType).startsWith(kind+'/'))))throw Error('Merchant media must match the declared asset map');
  const item=records[0][1],bytes=await readFile(await contained(await contained(root,project.assetsDirectory),relativePath));if(digest(bytes)!==item.sha256)throw Error('Merchant source bytes differ');
  const uploaded=readback?.entries.get(relativePath);if(uploaded&&(uploaded.delivery!=='merchant-media'||uploaded.sha256!==item.sha256||uploaded.contentType!==mime(item.contentType)||records.some(([url])=>new URL(url).origin===new URL(uploaded.url).origin)))throw Error('Merchant upload content differs');
  entries.set(relativePath,{relativePath,sha256:item.sha256,...(uploaded?{targetUrl:uploaded.url}:{}),binding:'lp_media_'+item.sha256.slice(0,24)});inputFiles.push(project.assetsDirectory+'/'+relativePath);
 }
 return{entries,inputFiles:[...new Set(inputFiles)]};
}
export function mediaDeliveryRecord(project:any,delivery:Awaited<ReturnType<typeof merchantMediaDelivery>>){
 const prefix=project.shopyy?.assetPathPrefix??project.siteId,items=[...delivery.entries.values()],relative=(item:any)=>project.shopyy.assetDirectoryLayout==='tree'?item.relativePath:'images/'+item.relativePath;
 return{merchant:items,pendingNativeBindings:items.filter(item=>!item.targetUrl).map(item=>item.binding),skinZipExcludedPaths:items.map(item=>'assets/'+prefix+'/'+relative(item)),previewCopies:items.map(item=>'preview/assets/'+prefix+'/'+relative(item))};
}
export async function verifyMediaDelivery(root:string,project:any,manifest:any,requireReady=false){
 const delivery=await merchantMediaDelivery(root,project),expected=mediaDeliveryRecord(project,delivery);
 if((delivery.entries.size||manifest.mediaDelivery?.merchant?.length)&&canonical(manifest.mediaDelivery)!==canonical(expected))throw Error('Merchant delivery manifest missing or changed');
 if(requireReady)assertNativeMediaReady({mediaDelivery:expected});return delivery;
}
export function assertNativeMediaReady(manifest:any){if(manifest.mediaDelivery?.pendingNativeBindings?.length)throw Error('Native merchant media is pending actual upload/readback; draft install and online validation are blocked');}
/** Preflight links are local; standard skin resources need no upload before build. */
export async function mediaNavigationBindings(root:string,project:any,inventory:any){
 const rows=Object.entries<any>(inventory.routes).filter(([,row])=>row.disposition==='mapped-media'),links=new Map<string,{preflight:string;online?:string;relative:string;merchantBinding?:string}>();if(!rows.length)return{links,inputFiles:[] as string[]};
 const file=project.workflow?.mediaAssetMapFile;if(typeof file!=='string')throw Error('Mapped media requires mediaAssetMapFile');
 const mapping=JSON.parse(await readFile(await contained(root,file),'utf8')),readback=project.workflow?.mediaAssetReadbackFile?await verifiedOnlineMediaReadback(root,project):null,merchant=await merchantMediaDelivery(root,project),prefix=project.shopyy?.assetPathPrefix??project.siteId,inputFiles=[file,...(readback?.inputFiles||[]),...merchant.inputFiles];
 if(typeof prefix!=='string'||!/^[-\w]+(?:\/[-\w]+)*$/.test(prefix))throw Error('Invalid media asset prefix');
 for(const [path,row] of rows){const item=mapping[row.media?.sourceUrl];if(!item||item.sha256!==row.media?.sha256||!mediaAssetKinds(project).some(kind=>mime(item.contentType).startsWith(kind+'/')))throw Error('Mapped media input identity differs');
  const input=project.assetsDirectory+'/'+item.relativePath;if(digest(await readFile(await contained(await contained(root,project.assetsDirectory),item.relativePath)))!==item.sha256)throw Error('Mapped media input bytes differ');
  const online=readback?.entries.get(item.relativePath);if(online&&(online.sha256!==item.sha256||online.contentType!==mime(item.contentType)||new URL(online.url).origin===new URL(row.media.sourceUrl).origin))throw Error('Mapped media readback differs');
  const relative=project.shopyy?.assetDirectoryLayout==='tree'?item.relativePath:'images/'+item.relativePath;links.set(path,{preflight:'/assets/'+prefix+'/'+relative,...(online?{online:online.url}:{}),relative,...(merchant.entries.has(item.relativePath)?{merchantBinding:merchant.entries.get(item.relativePath)!.binding}:{})});inputFiles.push(input);
 }
 return{links,inputFiles:[...new Set(inputFiles)]};
}
