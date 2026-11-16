import { load } from 'cheerio';
import { mkdir, writeFile, realpath, readFile } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { contained, digest, jsonFile, readRef, writeJson } from './artifacts.js';
import {sourceSessionPolicy} from './source-session.js';
import {sourcePrivacyPolicy} from './source-privacy.js';

/** Prepare owned HTML inputs from selected, hashed public DOM observations; never an accepted build. */
export async function prepareComposerInputs(projectFile:string,recipeFile:string){
  const root=await realpath(dirname(resolve(projectFile))),project=await jsonFile(projectFile);
  const recipeBytes=await readFile(await contained(root,recipeFile)),recipe=JSON.parse(recipeBytes.toString());
  const componentBytes=recipe.componentSelectorsFile?await readFile(await contained(root,recipe.componentSelectorsFile)):null;
  const componentConfig=componentBytes?JSON.parse(componentBytes.toString()):null;
  const assetDirectory=await contained(root,project.assetsDirectory),assetManifest=await jsonFile(await contained(assetDirectory,'source-current/manifest.json'));
  if(recipe.schemaVersion!==2||assetManifest.sourceUrl!==project.sourceUrl)throw Error('Current source recipe and observed asset manifest required');
  if(recipe.outputDirectory&&!/^staging\/[a-z0-9/-]+$/.test(recipe.outputDirectory))throw Error('Unsafe staging output directory');
  const output=join(root,recipe.outputDirectory||'staging/composers'),outputs:any[]=[];
  await mkdir(output,{recursive:true});
  const outputPath=await realpath(output);if(isAbsolute(relative(root,outputPath))||relative(root,outputPath).startsWith('..'))throw Error('Composer output escapes project');
  const publicInputs:any[]=[];
  const media=new Map<string,any[]>();
  for(const binding of recipe.publicQueryInputs||[]){
    if(!/^[a-z][a-z0-9_-]{0,40}$/.test(binding.parameter)||/(pass|token|secret|session|email|auth|key|address|phone|name)/i.test(binding.parameter))throw Error('Sensitive or unsafe public query parameter');
    const url=new URL(recipe.sourcePath,project.sourceUrl),value=url.searchParams.get(binding.parameter);
    if(value===null)continue;
    if(value.length>200||value.includes('{{'))throw Error('Unsafe public query input value');
    const observed=JSON.parse((await readRef(root,binding.observation)).toString());
    if(observed.kind!=='planning-observation-not-acceptance'&&!(observed.schemaVersion===2&&observed.side==='source'))throw Error('Public input requires a hashed rendered source observation');
    const sessionPolicy=sourceSessionPolicy(project);
    if(sessionPolicy&&(observed.captureEnvironment?.sourceSessionCurrent!==true||observed.captureEnvironment.sourceSessionPolicySha256!==sessionPolicy))throw Error('Public input source authentication freshness policy is missing or changed');
    let selector=observed.selectors?.[binding.component];
    if(observed.schemaVersion===2&&observed.side==='source'){
      const planBytes=await readFile(await contained(root,project.capturePlanFile));
      if(digest(planBytes)!==observed.planSha256)throw Error('Public input source plan is stale');
      const component=JSON.parse(planBytes.toString()).routes[observed.route]?.components?.[binding.component];
      selector=component?.selectorsByViewport?.[observed.viewport]?.source||component?.source;
    }
    if(new URL(observed.sourceUrl||observed.finalUrl).origin!==new URL(project.sourceUrl).origin||observed.finalUrl!==url.href||selector!==binding.selector||observed.components?.[binding.component]?.value!==value)throw Error('Public query input is not backed by the declared source field and route');
    publicInputs.push({...binding,value});
  }
  const clean=(html:string,observation:any)=>{
    const $=load(html,null,false);
    $('script,noscript,iframe,object,embed,base').remove();
    $('*').each((_,node)=>{
      if(!('tagName' in node))return;
      for(const key of Object.keys(node.attribs||{}))if(/^on/i.test(key)||['action','formaction','srcdoc'].includes(key))$(node).removeAttr(key);
      if(['input','textarea'].includes(node.tagName)){ $(node).removeAttr('value');if(node.tagName==='textarea')$(node).text(''); }
      for(const name of ['href','src']){
        const value=$(node).attr(name);if(!value)continue;
        if(name==='href'){
          const url=new URL(value,new URL(recipe.sourcePath,project.sourceUrl));
          if(['mailto:','tel:'].includes(url.protocol))continue;
          if(!['http:','https:'].includes(url.protocol))throw Error('Scripted/unsafe link requires an owned action adapter');
          if(url.origin===new URL(project.sourceUrl).origin)$(node).attr(name,`{{route:${url.pathname+url.search}}}${url.hash}`);
        }else{
          if(value.startsWith('data:image/'))continue;
          let url=new URL(value,project.sourceUrl).href;
          if(node.tagName==='img'){
            const sets=[$(node).attr('srcset')||'',...$(node).parent('picture').find('source[srcset]').toArray().map(s=>$(s).attr('srcset')||'')];
            const candidates=sets.flatMap(s=>s.split(',').map(v=>v.trim().split(/\s+/)[0]).filter(Boolean).map(v=>new URL(v,project.sourceUrl).href));
            const matching=(media.get(observation.componentObservation?.sha256)||observation.images||[]).filter((i:any)=>i.alt===($(node).attr('alt')||'')&&(i.loaded===true||i.width>0));
            const rendered=[...new Set<string>(matching.filter((i:any)=>candidates.length?candidates.includes(i.src):true).map((i:any)=>i.src))];
            if(candidates.length&&rendered.length>1)throw Error('Ambiguous rendered picture resource; collect a more specific media contract');
            if(rendered.length===1)url=rendered[0];
          }
          const asset=assetManifest.assets.find((a:any)=>a.url===url&&a.kind==='image');
          if(!asset)throw Error(`Image has no copied, observed asset: ${url}`);
          $(node).attr(name,`{{asset:images/source-current/${asset.file}}}`).removeAttr('srcset').removeAttr('sizes');
        }
      }
      const style=$(node).attr('style');if(style&&/url\(\s*["']?(?:https?:|\/\/)/i.test(style))throw Error('Remote inline style resource requires an explicit asset mapping');
    });
    $('picture source').remove(); // The copied resource is the actual observed currentSrc, not a remote fallback.
    for(const binding of publicInputs){
      const input=$(binding.selector);
      if(input.length!==1||!input.is('input')||!['text','search'].includes(input.attr('type')||'text'))throw Error('Public query binding must target one ordinary search/text input');
      input.attr('value',binding.value);
    }
    return $.html().replace(/\{\{route:([^{}]+)\}\}/g,(_,key)=>`{{route:${key.replaceAll('&amp;','&')}}}`);
  };
  for(const item of recipe.fragments||[]){
    if(!/^[a-z0-9][a-z0-9-]*$/.test(item.id))throw Error('Unsafe composer fragment name');
    const bytes=await readRef(root,item.observation),observation=JSON.parse(bytes.toString());
    if(observation.kind!=='reconnaissance-not-acceptance'||observation.requestedPath!==recipe.sourcePath||new URL(observation.url).origin!==new URL(project.sourceUrl).origin)throw Error('Composer input lacks current public source DOM provenance');
    if((observation.sourcePrivacyPolicySha256||null)!==sourcePrivacyPolicy(project,recipe.sourcePath))throw Error('Composer source private-account boundary policy is stale');
    if(observation.componentObservation){
      const rendered=JSON.parse((await readRef(root,observation.componentObservation)).toString());
      if(rendered.kind!=='planning-observation-not-acceptance'||rendered.finalUrl!==observation.url||rendered.viewport!==observation.viewport)throw Error('Rendered media context does not match source structure');
      media.set(observation.componentObservation.sha256,Object.values<any>(rendered.components||{}).flatMap(c=>c.images||[]));
    }
    const $=load(observation.structure);
    for(const[id,selector]of Object.entries<string>({...componentConfig?.components,...componentConfig?.conditionalComponents})){
      const nodes=$(selector);if(nodes.length>1)throw Error(`Ambiguous component annotation: ${id}`);
      if(nodes.length===1)nodes.attr('data-vr-component',id);
    }
    const selected=$(item.selector);
    if(selected.length!==1)throw Error(`Composer fragment selector must be unique: ${item.id}`);
    if(item.keepChildren)selected.children().not(item.keepChildren).remove();
    if(item.asDiv)selected[0].name='div';
    for(const[key,value]of Object.entries<string>(item.rootAttributes||{})){
      if(!/^data-vr-[a-z-]+$/.test(key))throw Error('Only owned root data attributes may be added');
      selected.attr(key,value);
    }
    const html=clean($.html(selected),observation);
    const file=`${item.id}.htm`;await writeFile(join(output,file),html);
    outputs.push({id:item.id,file,sha256:digest(html),source:item.observation,selector:item.selector});
  }
  const record={schemaVersion:2,status:'prepared-inputs-not-build-or-acceptance',sourceUrl:project.sourceUrl,recipeFile,recipeSha256:digest(recipeBytes),componentSelectorsSha256:componentBytes?digest(componentBytes):null,outputs,pending:['Agent-authored family composition and behavior','Current schema 2 source contracts and consumed bindings','Real SHOPYY catalog/asset/route bindings before native delivery']};
  await writeJson(join(output,'provenance.json'),record);
  return{directory:output,prepared:outputs.length,status:record.status};
}
