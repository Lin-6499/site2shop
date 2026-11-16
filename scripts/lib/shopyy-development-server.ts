import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve,extname} from 'node:path';
import {jsonFile,saveArtifact,digest,canonical} from '../../src/shopyy/artifacts.js';
import {renderFamilies} from '../../src/shopyy/families.js';
import type {Plan} from '../../src/shopyy/contracts.js';

/** Internal diagnostic rendering only: no package, build, approval or draft handoff. */
export async function withShopyyDevelopmentServer<T>(file:string,work:(ctx:{root:string;project:any;origin:string;renderSha256:string})=>Promise<T>){
 const root=dirname(resolve(file)),project=await jsonFile(file);
 const proposal=await jsonFile(join(root,'contracts/navigation-proposal.v2.json'));
 const source=await jsonFile(join(root,'contracts/route-inventory.v2.json'));
 const inventory=await saveArtifact(root,{...source,complete:false,role:'unapproved-development-routing',routes:Object.fromEntries(proposal.rows.map((r:any)=>[r.sourcePath,{disposition:r.proposedDisposition,targetPath:r.targetPath,family:r.family,rationale:r.rationale}]))});
 const plan=await jsonFile(join(root,project.capturePlanFile));
 const rendered=await renderFamilies(root,project,{...plan,inventory} as Plan);
 const css=await readFile(join(root,project.commonStyleFile)),runtime=await readFile(join(root,project.commonScriptFile));
 const renderSha256=digest(canonical({pages:[...rendered.preview].map(([path,html])=>({path,sha256:digest(html)})),style:digest(css),runtime:digest(runtime)}));
 const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif'};
 const server=createServer(async(req,res)=>{try{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const u=new URL(req.url!,'http://diagnostic'),path=rendered.routes[u.pathname+u.search]||rendered.routes[u.pathname];
  if(path){res.writeHead(200,{'Content-Type':'text/html','X-Site2Shop-Diagnostic':'unapproved-development-only'}).end(rendered.preview.get(path.replace(/^preview\//,'')));return;}
  if(u.pathname.endsWith('/styles/storefront-common.css')){res.writeHead(200,{'Content-Type':'text/css'}).end(css);return;}
  if(u.pathname.endsWith('/styles/page-contracts.css')){res.writeHead(200,{'Content-Type':'text/css'}).end('/* Pending source contracts; diagnostic only. */');return;}
  if(u.pathname.endsWith('/scripts/storefront-runtime.js')){res.writeHead(200,{'Content-Type':'application/javascript'}).end(runtime);return;}
  const name=u.pathname.split('/').pop()!;
  if(u.pathname.startsWith(`/assets/${project.siteId}/images/source-current/`)&&/^[a-f0-9]{64}\.(png|jpg|avif|webp|svg|gif)$/.test(name)){res.writeHead(200,{'Content-Type':mime[extname(name)]}).end(await readFile(join(root,project.assetsDirectory,'source-current',name)));return;}
  res.writeHead(404).end('Unmapped diagnostic destination');
 }catch{res.writeHead(500).end('Diagnostic resource failed');}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{return await work({root,project,origin:`http://127.0.0.1:${(server.address() as any).port}`,renderSha256});}
 finally{await new Promise<void>(r=>server.close(()=>r()));}
}
