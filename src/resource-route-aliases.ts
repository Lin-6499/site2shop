import {readdir,readFile,writeFile}from'node:fs/promises';import{join}from'node:path';
export function rewriteCollectionRoutes(text:string,aliases:Record<string,string>,sourceOrigin:string,targetOrigin:string){
 for(const[source,target]of Object.entries(aliases)){
  if(!/^[a-z0-9][a-z0-9-]*$/.test(source)||!/^[a-z0-9][a-z0-9-]*$/.test(target))throw Error('Unsafe collection alias');
  const route='/collections/'+source,replacement='/collections/'+target;
  // Do not rewrite longer handles, product handles, or query parameter values.
  const escaped=route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const domains=[sourceOrigin,targetOrigin].map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  text=text.replace(new RegExp('(?:'+domains+')?'+escaped+'(?=[/?#"\'\\s<>]|$)','g'),replacement);
 }
 return text;
}
export async function applyCollectionRouteAliases(out:string){
 const aliases=await readFile(join(out,'collection-handle-overrides.json'),'utf8').then(JSON.parse).catch(()=>({}));
 if(!Object.keys(aliases).length)return;
 const ir=JSON.parse(await readFile(join(out,'site-ir.json'),'utf8'));
 const deployment=JSON.parse(await readFile(join(out,'deployment.json'),'utf8'));
 async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.(liquid|json|js|html)$/.test(e.name)){const before=await readFile(p,'utf8'),after=rewriteCollectionRoutes(before,aliases,new URL(ir.sourceUrl).origin,'https://'+deployment.store);if(before!==after)await writeFile(p,after)}}}
 await walk(join(out,'theme'));
}
