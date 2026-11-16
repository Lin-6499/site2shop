import {verifyMappedRedirect,verifyBrokenSourceLink} from './route-redirect.js';
import {mediaNavigationBindings,merchantMediaDelivery} from './media-comparison.js';
import {mappedTargetPath,stageTargetErrors} from './target-context.js';
import {load} from 'cheerio';
import {readFile} from 'node:fs/promises';
import {contained,jsonFile,readRef,digest} from './artifacts.js';
import {escapeHtml} from '../util.js';
import type {Plan,Inventory} from './contracts.js';
import {renderedEvidenceRejection} from '../rendered-page-validity.js';

// Actual SHOPYY initial sync and retry both require names within 60 characters.
// Keep author/evidence paths unchanged; only native delivery uses this alias.
export function nativeFilePath(key:string){
 const slash=key.lastIndexOf('/'),name=key.slice(slash+1),limit=60;if(name.length<=limit)return key;
 const extension=name.match(/\.[^.]+$/)?.[0]||'';
 return key.slice(0,slash+1)+name.slice(0,limit-extension.length-13)+'-'+digest(name).slice(0,12)+extension;
}

function aliasContent(raw:any,expected:URL,canonical:URL){
 const actual=new URL(raw.finalUrl||raw.url),html=raw.bodyHtml??raw.structure;
 if(actual.href!==expected.href||raw.status!==200||typeof html!=='string'||renderedEvidenceRejection({status:raw.status,url:actual.href,title:raw.title,visibleText:raw.text}))throw Error('Family alias needs an actual normal exact owner/source page');
 const $=load(html),main=$('main');if(main.length!==1)throw Error('Family alias normal main evidence missing');main.find('script,style,noscript').remove();
 const normalize=(text:string)=>text.trim().replace(/\s+/g,' '),url=(value:string|undefined,currentDocument=false)=>{if(!value)return null;const u=new URL(value,actual);if(currentDocument&&u.origin===actual.origin&&u.pathname===actual.pathname&&u.search===actual.search){u.pathname=canonical.pathname;u.search=canonical.search;}return u.href;};
 return JSON.stringify({heading:main.find('h1').map((_,n)=>normalize($(n).text())).get(),text:normalize(main.text()),tree:main.find('*').addBack().map((_,n:any)=>({tag:n.tagName,class:$(n).attr('class')||'',role:$(n).attr('role')||'',name:$(n).attr('name')||'',type:$(n).attr('type')||'',href:url($(n).attr('href'),true),src:url($(n).attr('src')),poster:url($(n).attr('poster'))})).get()});
}

// Rich-text fixtures carry content, never source scripts or submission controls.
function fixtureHtml(value:unknown){
  const $=load(String(value),{},false);
  $('script,noscript,iframe,object,embed,base,form,input,button,textarea,select').remove();
  $('*').each((_,el)=>{for(const [name,value]of Object.entries($(el).attr()||{})){
    if(/^on/i.test(name)||name==='srcdoc'||(['href','src','action','formaction','xlink:href'].includes(name)&&/^\s*(?:javascript|vbscript|data):/i.test(value)))$(el).removeAttr(name);
  }});
  return $.html();
}

export async function verifyFamilySourceAliases(projectRoot:string,project:any,config:any,inventory:Inventory){
 const inputs=new Set<string>();
  // An alias is explicit source evidence for this exact page, never another composer or inferred route.
  const aliases=new Map<string,any>();
  const sourceUrl=(value:unknown)=>{if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[#\\\x00-\x20]/.test(value))throw Error('Unsafe family source alias path');const url=new URL(value,project.sourceUrl);if(url.pathname+url.search!==value)throw Error('Normalized family source alias path');return url;};
  const query=(url:URL)=>JSON.stringify([...url.searchParams.entries()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  for(const page of config.pages){
    if(page.sourceAliases===undefined)continue;
    if(!Array.isArray(page.sourceAliases))throw Error('Family sourceAliases must be an explicit array');
    const canonicalUrl=sourceUrl(page.sourcePath),owner=inventory.routes[page.sourcePath];
    if(!config.families[page.family]||stageTargetErrors({preflight:page.targetPath}).length||owner?.disposition!=='mapped'||owner.family!==page.family||owner.targetPath!==page.targetPath||stageTargetErrors(owner.targetPaths).length)throw Error('Family alias requires an existing canonical family/page');
    for(const alias of page.sourceAliases){
      const aliasUrl=sourceUrl(alias?.sourcePath),mapping=inventory.routes[alias.sourcePath];
      if(alias.sourcePath===page.sourcePath||aliases.has(alias.sourcePath)||config.pages.some((p:any)=>p.sourcePath===alias.sourcePath))throw Error('Duplicate/conflicting family source alias');
      if(!mapping||mapping.disposition!=='mapped'||mapping.family!==page.family||mapping.targetPath!==page.targetPath||stageTargetErrors(mapping.targetPaths).length||['preflight','online'].some(stage=>mappedTargetPath(mapping,stage as 'preflight'|'online')!==mappedTargetPath(owner,stage as 'preflight'|'online')))throw Error('Family source alias target/owner differs');
      if(!(aliasUrl.pathname===canonicalUrl.pathname||aliasUrl.pathname===canonicalUrl.pathname+'/'||aliasUrl.pathname+'/'===canonicalUrl.pathname)||query(aliasUrl)!==query(canonicalUrl))throw Error('Family source alias must preserve locale/path and complete query values');
      const proof=JSON.parse((await readRef(projectRoot,alias.canonicalEvidence)).toString());
      const actual=new URL(proof.finalUrl||proof.url,project.sourceUrl),canonical=typeof proof.canonical==='string'?new URL(proof.canonical,actual):null;
      if(proof.status!==200||typeof proof.title!=='string'||typeof(proof.bodyHtml??proof.structure)!=='string'||actual.href!==aliasUrl.href||canonical?.href!==canonicalUrl.href)throw Error('Family source alias lacks matching raw canonical evidence');
      const ownerProof=JSON.parse((await readRef(projectRoot,alias.ownerEvidence)).toString());if(aliasContent(proof,aliasUrl,canonicalUrl)!==aliasContent(ownerProof,canonicalUrl,canonicalUrl))throw Error('Family source alias normal content/business fields differ from owner');
      inputs.add(alias.canonicalEvidence.path);inputs.add(alias.ownerEvidence.path);aliases.set(alias.sourcePath,page);
    }
  }
 return{aliases,inputFiles:[...inputs]};
}

/** Project-owned HTML composers. Composer tokens are distinct from target syntax. */
export async function renderFamilies(projectRoot:string,project:any,plan:Plan){
  const inputs=new Set<string>([project.familiesFile]);
  const config=await jsonFile(await contained(projectRoot,project.familiesFile));
  if(config.schemaVersion!==2||!config.families||!Array.isArray(config.pages))throw Error('Family composer schema 2 required');
  const inventory:Inventory=JSON.parse((await readRef(projectRoot,plan.inventory)).toString());
  const merchantMedia=await merchantMediaDelivery(projectRoot,project);for(const file of merchantMedia.inputFiles)inputs.add(file);
  const mediaBindings=await mediaNavigationBindings(projectRoot,project,inventory);for(const file of mediaBindings.inputFiles)inputs.add(file);
  for(const [path,mapping]of Object.entries(inventory.routes))if(mapping.disposition==='mapped-redirect')for(const file of await verifyMappedRedirect(projectRoot,inventory,path))inputs.add(file);
  for(const [path,mapping]of Object.entries(inventory.routes))if(mapping.removal)inputs.add(await verifyBrokenSourceLink(projectRoot,inventory,path));
  const native=new Map<string,string>(),preview=new Map<string,string>(),routes:Record<string,string>={};
  const read=async(path:string)=>{inputs.add(path);return readFile(await contained(projectRoot,path),'utf8')};
  const liquid=project.shopyy.templateProfile==='liquid-default-v1';
  const assetPrefix=project.shopyy.assetPathPrefix??project.siteId;
  if(typeof assetPrefix!=='string'||!/^[-\w]+(?:\/[-\w]+)*$/.test(assetPrefix))throw Error('Unsafe asset path prefix');
  const nativeRoot=liquid?(project.shopyy.assetRootExpression||''):'';
  if(nativeRoot){
    const absolute=/^https:\/\//.test(nativeRoot),rootUrl=absolute?new URL(nativeRoot):null,bucketRoot=rootUrl?rootUrl.pathname.replace(/^\//,''):nativeRoot;
    if(!/^[-\w]+(?:\/[-\w]+)*$/.test(bucketRoot)||rootUrl&&(rootUrl.username||rootUrl.password||rootUrl.search||rootUrl.hash)||project.shopyy.assetUrlFilter!=='public_front_asset_url'||!project.shopyy.nativeAssetBindingFile)throw Error('Native asset root needs an actual target binding');
    const bindingFile=project.shopyy.nativeAssetBindingFile,binding=await jsonFile(await contained(projectRoot,bindingFile));inputs.add(bindingFile);
    const metadata=JSON.parse((await readRef(projectRoot,binding.metadata)).toString()),scope=JSON.parse((await readRef(projectRoot,binding.scope)).toString());inputs.add(binding.metadata.path);inputs.add(binding.scope.path);await readRef(projectRoot,scope.exactBindingReadback);inputs.add(scope.exactBindingReadback.path);
    if(binding.kind!=='target-native-asset-binding'||binding.assetRootExpression!==nativeRoot||String(binding.storeId)!==String(scope.storeId)||String(binding.skinId)!==String(scope.skinId)||String(metadata.theme_id)!==String(scope.skinId)||!metadata.path?.startsWith('assets/'+assetPrefix+'/')||metadata.content_oss_bucket!==bucketRoot+'/'+metadata.path.slice('assets/'.length))throw Error('Native asset root differs from actual skin metadata');
    if(absolute){
      const cdn=JSON.parse((await readRef(projectRoot,binding.cdnReadback)).toString()),http=JSON.parse((await readRef(projectRoot,binding.httpReadback)).toString());inputs.add(binding.cdnReadback.path);inputs.add(binding.httpReadback.path);
      if(String(cdn.storeId)!==String(scope.storeId)||String(cdn.skinId)!==String(scope.skinId)||new URL(cdn.imgcdn).origin!==rootUrl!.origin||new URL(bucketRoot,cdn.imgcdn+'/').href!==nativeRoot||http.status!==200||!/^image\//.test(http.contentType||'')||http.url!==new URL(metadata.content_oss_bucket,cdn.imgcdn+'/').href||String(http.storeId)!==String(scope.storeId)||String(http.skinId)!==String(scope.skinId)||!/^[-\w/]+\.[\w]+$/.test(http.relativePath||''))throw Error('Absolute native CDN root lacks actual scoped HTTP readback');
      const samplePath=project.assetsDirectory+'/'+http.relativePath,sample=await readFile(await contained(projectRoot,samplePath));inputs.add(samplePath);if(digest(sample)!==http.sha256)throw Error('Native CDN sample bytes differ from actual local asset');
    }
  }
  const nativePrefix=(nativeRoot?nativeRoot+'/':'')+assetPrefix;
  const ownedScriptVersion=liquid&&project.commonScriptFile?'?v='+digest(await readFile(await contained(projectRoot,project.commonScriptFile))):'';
  if(ownedScriptVersion)inputs.add(project.commonScriptFile);
  const ownedStyleVersion=liquid&&project.commonStyleFile?'?v='+digest(await readFile(await contained(projectRoot,project.commonStyleFile))):'';
  if(ownedStyleVersion)inputs.add(project.commonStyleFile);
  const outputFile=(file:unknown)=>{
    if(typeof file!=='string'||file.startsWith('/')||file.includes('\\')||file.includes(':')||file.split('/').includes('..')||!file.endsWith(liquid?'.liquid':'.htm'))throw Error('Unsafe native family output');
    return file;
  };
  const storeNative=(file:string,value:string)=>{if(native.has(file)&&native.get(file)!==value)throw Error(`Conflicting native page data: ${file}; use dynamic fields or distinct native files`);native.set(file,value)};
  const nativeExpression=(key:string)=>{
    const variable=project.shopyy.variableMap[key];
    const valid=liquid?/^[a-zA-Z_][\w.]*(?:\s*\|\s*[a-zA-Z_]\w*)*$/:/^\$[\w.]+$/;
    if(!valid.test(variable||''))throw Error(`Unknown native field ${key}`);
    return variable;
  };
  const aliasContract=await verifyFamilySourceAliases(projectRoot,project,config,inventory),aliases=aliasContract.aliases;for(const file of aliasContract.inputFiles)inputs.add(file);
  for(const [source,mapping]of Object.entries(inventory.routes))if(mapping.disposition==='mapped'&&!config.pages.some((p:any)=>p.sourcePath===source&&p.targetPath===mapping.targetPath&&p.family===mapping.family)&&!aliases.has(source))throw Error(`Mapped route lacks implemented family/page: ${source}`);
  const expand=async(raw:string,mode:'native'|'fixture',values:any,depth=0):Promise<string>=>{
    if(depth>20)throw Error('Recursive family include');
    raw=raw.replaceAll('{{mode}}',mode);
    raw=raw.replace(/\{\{#(fixture|native)\}\}([\s\S]*?)\{\{\/\1\}\}/g,(_,only,body)=>only===mode?body:'');
    for(const match of [...raw.matchAll(/\{\{fragment:([^{}]+)\}\}/g)]){
      const file=match[1].split('.').reduce((v:any,k:string)=>v?.[k],values);
      if(typeof file!=='string'||!file.endsWith('.htm'))throw Error('Owned HTML fragment path required');
      raw=raw.replace(match[0],await expand(await read(file),mode,values,depth+1));
    }
    for(const match of [...raw.matchAll(/\{\{include:([^{}]+)\}\}/g)]){
      const file=config.partials?.[match[1]];if(!file)throw Error('Unknown family partial');
      raw=raw.replace(match[0],await expand(await read(file),mode,values,depth+1));
    }
    for(const match of [...raw.matchAll(/\{\{#each:(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g)]){
      const variable=project.shopyy.variableMap[match[1]];
      if(!variable||(liquid&&!/^[a-zA-Z_][\w.]*$/.test(variable)))throw Error('Unknown list binding');
      const rows=values[match[1]];if(mode==='fixture'&&!Array.isArray(rows))throw Error('Missing fixture list');
      const out=mode==='native'?(liquid?`{% for vo in ${variable} %}${await expand(match[2],mode,{},depth+1)}{% endfor %}`:`<{foreach from=${variable} item=vo}>${await expand(match[2],mode,{},depth+1)}<{/foreach}>`):(await Promise.all(rows.map((r:any)=>expand(match[2],mode,r,depth+1)))).join('');
      raw=raw.replace(match[0],out);
    }
    raw=raw.replace(/\{\{(data|field|html|asset|route|json):([^{}]+)\}\}/g,(_,kind,key)=>{
      if(kind==='asset'){
        const merchant=merchantMedia.entries.get(key);if(mode==='native'&&merchant)return merchant.targetUrl?escapeHtml(merchant.targetUrl):"{{ settings."+merchant.binding+" | default: '' | escape }}";
        if(mode==='native'&&liquid){
          const filter=project.shopyy.assetUrlFilter||'public_asset_abs_dir_url';
          if(!/^[a-zA-Z_]\w*$/.test(filter)||!/^[-\w./]+$/.test(key)||key.split('/').includes('..')||key.startsWith('/'))throw Error('Invalid native asset binding');
          return `{{ '${nativePrefix}/${nativeFilePath(key)}' | ${filter} }}${key==='scripts/storefront-runtime.js'?ownedScriptVersion:key==='styles/storefront-common.css'?ownedStyleVersion:''}`;
        }
        return (mode==='native'?project.shopyy.assetRootExpression:`/assets/${assetPrefix}`)+'/'+escapeHtml(key);
      }
      if(kind==='route'){const mapping=inventory.routes[key];if(mapping?.disposition==='mapped-media'){const media=mediaBindings.links.get(key);if(!media)throw Error('Unmapped media link '+key);if(mode!=='native')return escapeHtml(media.preflight);if(media.online)return escapeHtml(media.online);if(media.merchantBinding)return "{{ settings."+media.merchantBinding+" | default: '' | escape }}";if(liquid)return "{{ '"+nativePrefix+'/'+nativeFilePath(media.relative)+"' | "+(project.shopyy.assetUrlFilter||'public_asset_abs_dir_url')+" }}";return project.shopyy.assetRootExpression+'/'+escapeHtml(media.relative);}const p=mapping&&mappedTargetPath(mapping,mode==='native'?'online':'preflight');if(!p)throw Error(`Unmapped family link ${key}`);return escapeHtml(p);}
      if((kind==='field'||kind==='html')&&mode==='native'){
        const variable=nativeExpression(key);
        return liquid?`{{ ${variable} | ${kind==='html'?'html_content_filter':'escape'} }}`:`<{${variable}|${kind==='html'?'default:""':'escape'}}>`;
      }
      const value=key==='$'?values:key.split('.').reduce((v:any,k:string)=>v?.[k],values);if(value===undefined)throw Error(`Missing fixture/content ${key}`);
      if(kind==='html')return fixtureHtml(value);
      if(kind==='json')return JSON.stringify(value).replace(/[<>&]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
      return escapeHtml(String(value));
    });
    if((liquid&&mode==='native')?/\{\{\s*(?:[#\/]|[a-zA-Z_]\w*:)/.test(raw):/\{\{/.test(raw))throw Error('Unexpanded composer token');
    return raw;
  };
  for(const item of config.nativeFiles||[]){
    const data=item.dataFile?JSON.parse(await read(item.dataFile)):(item.data||{});
    storeNative(outputFile(item.nativeFile),await expand(await read(item.templateFile),'native',data));
  }
  for(const [index,page]of config.pages.entries()){
    const mapping=inventory.routes[page.sourcePath],family=config.families[page.family];
    if(stageTargetErrors(mapping?.targetPaths).length)throw Error('Invalid stage-specific family route');
    if(!family||mapping?.disposition!=='mapped'||page.targetPath!==mapping.targetPath||page.family!==mapping.family)throw Error('Unplanned or unsupported page family');
    const data=page.dataFile?JSON.parse(await read(page.dataFile)):(page.data||{});
    const template=await read(family.templateFile),nativeFile=outputFile(page.nativeFile||family.nativeFile);
    const skin=await expand(template,'native',data),fixture=await expand(template,'fixture',data);
    if(!(skin.includes('styles/page-contracts.css')||(liquid&&native.get('layout/theme.liquid')?.includes('styles/page-contracts.css')))||!fixture.includes('styles/page-contracts.css'))throw Error('Family must load consumed page-contracts.css');
    const previewPath=mappedTargetPath(mapping,'preflight')!;if(Object.hasOwn(routes,previewPath))throw Error('Conflicting stage-specific preview route: '+previewPath);
    storeNative(nativeFile,skin);const file=`pages/${index}.html`;preview.set(file,fixture);routes[previewPath]=`preview/${file}`;
  }
  return {native,preview,routes,inputFiles:[...inputs].sort()};
}
